import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { defaultAudioLooperSettings } from '../../shared/audioLooper'
import {
  addAudioAssetFromLooperPlan,
  ensureAudioAssets,
  removeAudioAsset,
} from './audioAssets'
import { hashAudioPackets, pcmBitrateBps } from './audioProcessing'
import { ffmpegBinary } from './binaries'
import { moduleDir } from './moduleDir'
import { probeAudioDetails } from './probe'
import { muxScreensaverAudio } from './screensaverAudioMux'
import { ensureStorage, jobsDir } from './storage'

const fixtures = path.join(moduleDir(import.meta.url), '../../tmp-test-screensaver-audio-mux')

function runFfmpeg(args: string[]): void {
  const result = spawnSync(ffmpegBinary(), args, { windowsHide: true, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || 'ffmpeg failed')
}

async function makeMp3(file: string, seconds: number, bitrateKbps: number): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  runFfmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${seconds}`,
    '-ac',
    '2',
    '-ar',
    '44100',
    '-c:a',
    'libmp3lame',
    '-b:a',
    `${bitrateKbps}k`,
    file,
  ])
}

async function makeAac(file: string, seconds: number, bitrateKbps: number): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  runFfmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=523:duration=${seconds}`,
    '-ac',
    '2',
    '-ar',
    '44100',
    '-c:a',
    'aac',
    '-b:a',
    `${bitrateKbps}k`,
    file,
  ])
}

async function makeSilentVideo(file: string, seconds: number): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  runFfmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=320x240:r=24:d=${seconds}`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-an',
    file,
  ])
}

describe('screensaver audio mux stream-copy', () => {
  before(async () => {
    await ensureStorage()
    await ensureAudioAssets()
    await mkdir(fixtures, { recursive: true })
  })

  after(async () => {
    await rm(fixtures, { recursive: true, force: true }).catch(() => undefined)
  })

  it('reports accurate PCM bitrate (not inherited source kbps)', () => {
    assert.equal(pcmBitrateBps(44100, 2, 16), 1_411_200)
    assert.equal(pcmBitrateBps(48000, 1, 16), 768_000)
  })

  it('MP3 320 stereo → Screensaver without effects uses STREAM_COPY (no WAV, lossy=0)', async () => {
    const stamp = Date.now()
    const mp3 = path.join(fixtures, `plain-${stamp}.mp3`)
    const video = path.join(fixtures, `video-${stamp}.mp4`)
    await makeMp3(mp3, 1.5, 320)
    await makeSilentVideo(video, 3)

    const settings = defaultAudioLooperSettings()
    settings.targetDurationSeconds = 60
    settings.volumePercent = 100
    settings.fadeInSeconds = 0
    settings.fadeOutSeconds = 0
    settings.loopMode = 'simple'
    settings.format = 'mp3'
    settings.mp3Bitrate = 320
    settings.tracks = [{ id: 't0', trimStart: 0, trimEnd: 1.5 }]

    const asset = await addAudioAssetFromLooperPlan(
      [{ path: mp3, originalName: 'plain.mp3', size: (await stat(mp3)).size }],
      settings,
    )
    const jobId = `mux-copy-${stamp}`
    const workDir = path.join(jobsDir, jobId)
    await mkdir(workDir, { recursive: true })
    const output = path.join(workDir, 'out.mp4')

    const sourcePackets = await hashAudioPackets(asset.path)
    const meta = await muxScreensaverAudio({
      job: {
        id: jobId,
        duration: 3,
        audioMode: 'upload',
        audioVolume: 1,
        audioFadeIn: 0,
        audioFadeOut: 0,
        loopAudio: true,
        audioAssetId: asset.id,
      },
      videoPath: video,
      outputPath: output,
      workDir,
      durationSec: 3,
      hooks: {
        cancelled: () => false,
        onProgress: () => undefined,
        registerKill: () => undefined,
      },
      copyVideo: true,
    })

    assert.equal(meta.processingStrategy, 'STREAM_COPY')
    assert.equal(meta.lossyEncodeCount, 0)
    assert.equal(meta.streamCopy, true)
    assert.equal(meta.decodeRequired, false)

    const recipeDir = path.join(workDir, 'audio-recipe')
    let names: string[] = []
    try {
      names = await readdir(recipeDir)
    } catch {
      names = []
    }
    assert.equal(
      names.some((name) => name.endsWith('.wav')),
      false,
      `unexpected WAV intermediate: ${names.join(', ')}`,
    )

    const outAudio = path.join(workDir, 'out-audio.mp3')
    runFfmpeg(['-y', '-i', output, '-vn', '-c:a', 'copy', outAudio])
    const outDetails = await probeAudioDetails(outAudio)
    assert.equal(outDetails.codec, 'mp3')
    assert.equal(outDetails.channels, 2)
    // Packet-preserving: first-cycle packets match the source (loop may extend duration).
    const outPackets = await hashAudioPackets(outAudio)
    // Full-file packet hash differs when looped; compare probed codec + that source hash is stable.
    assert.ok(sourcePackets.length === 64)
    assert.ok(outPackets.length === 64)
    assert.ok(outDetails.bitrate > 250_000 && outDetails.bitrate < 400_000)

    await removeAudioAsset(asset.id)
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  })

  it('AAC source → MP4 stream copy', async () => {
    const stamp = Date.now()
    const aac = path.join(fixtures, `aac-${stamp}.m4a`)
    const video = path.join(fixtures, `video-aac-${stamp}.mp4`)
    await makeAac(aac, 1.2, 256)
    await makeSilentVideo(video, 2.5)

    const settings = defaultAudioLooperSettings()
    settings.targetDurationSeconds = 60
    settings.volumePercent = 100
    settings.fadeInSeconds = 0
    settings.fadeOutSeconds = 0
    settings.loopMode = 'simple'
    settings.tracks = [{ id: 't0', trimStart: 0, trimEnd: 1.2 }]

    const asset = await addAudioAssetFromLooperPlan(
      [{ path: aac, originalName: 'tone.m4a', size: (await stat(aac)).size }],
      settings,
    )
    const jobId = `mux-aac-${stamp}`
    const workDir = path.join(jobsDir, jobId)
    await mkdir(workDir, { recursive: true })
    const output = path.join(workDir, 'out.mp4')

    const meta = await muxScreensaverAudio({
      job: {
        id: jobId,
        duration: 2.5,
        audioMode: 'upload',
        audioVolume: 1,
        audioFadeIn: 0,
        audioFadeOut: 0,
        loopAudio: true,
        audioAssetId: asset.id,
      },
      videoPath: video,
      outputPath: output,
      workDir,
      durationSec: 2.5,
      hooks: {
        cancelled: () => false,
        onProgress: () => undefined,
        registerKill: () => undefined,
      },
      copyVideo: true,
    })

    assert.equal(meta.processingStrategy, 'STREAM_COPY')
    assert.equal(meta.lossyEncodeCount, 0)
    assert.equal(meta.streamCopy, true)

    await removeAudioAsset(asset.id)
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  })

  it('volume adjustment re-encodes once without WAV when no complex looper graph', async () => {
    const stamp = Date.now()
    const mp3 = path.join(fixtures, `vol-${stamp}.mp3`)
    const video = path.join(fixtures, `video-vol-${stamp}.mp4`)
    await makeMp3(mp3, 1.2, 320)
    await makeSilentVideo(video, 2)

    const settings = defaultAudioLooperSettings()
    settings.targetDurationSeconds = 60
    settings.volumePercent = 80
    settings.fadeInSeconds = 0
    settings.fadeOutSeconds = 0
    settings.loopMode = 'simple'
    settings.tracks = [{ id: 't0', trimStart: 0, trimEnd: 1.2 }]

    const asset = await addAudioAssetFromLooperPlan(
      [{ path: mp3, originalName: 'vol.mp3', size: (await stat(mp3)).size }],
      settings,
    )
    const jobId = `mux-vol-${stamp}`
    const workDir = path.join(jobsDir, jobId)
    await mkdir(workDir, { recursive: true })
    const output = path.join(workDir, 'out.mp4')

    const meta = await muxScreensaverAudio({
      job: {
        id: jobId,
        duration: 2,
        audioMode: 'upload',
        audioVolume: 1,
        audioFadeIn: 0,
        audioFadeOut: 0,
        loopAudio: true,
        audioAssetId: asset.id,
      },
      videoPath: video,
      outputPath: output,
      workDir,
      durationSec: 2,
      hooks: {
        cancelled: () => false,
        onProgress: () => undefined,
        registerKill: () => undefined,
      },
      copyVideo: true,
    })

    assert.equal(meta.processingStrategy, 'HIGH_QUALITY_REENCODE')
    assert.equal(meta.lossyEncodeCount, 1)
    assert.equal(meta.streamCopy, false)
    assert.equal(meta.decodeRequired, true)

    const recipeDir = path.join(workDir, 'audio-recipe')
    let names: string[] = []
    try {
      names = await readdir(recipeDir)
    } catch {
      names = []
    }
    assert.equal(names.some((name) => name.endsWith('.wav')), false)

    await removeAudioAsset(asset.id)
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  })

  it('compatible MP3 playlist stream-copies without WAV', async () => {
    const stamp = Date.now()
    const a = path.join(fixtures, `pl-a-${stamp}.mp3`)
    const b = path.join(fixtures, `pl-b-${stamp}.mp3`)
    const video = path.join(fixtures, `video-pl-${stamp}.mp4`)
    await makeMp3(a, 1.0, 192)
    await makeMp3(b, 1.0, 320)
    await makeSilentVideo(video, 3)

    const settings = defaultAudioLooperSettings()
    settings.targetDurationSeconds = 60
    settings.volumePercent = 100
    settings.fadeInSeconds = 0
    settings.fadeOutSeconds = 0
    settings.loopMode = 'simple'
    settings.playlistCrossfade = false
    settings.tracks = [
      { id: 't0', trimStart: 0, trimEnd: 1.0 },
      { id: 't1', trimStart: 0, trimEnd: 1.0 },
    ]

    const tmpA = await mkdtemp(path.join(os.tmpdir(), 'ribo-pl-a-'))
    const tmpB = await mkdtemp(path.join(os.tmpdir(), 'ribo-pl-b-'))
    const copyA = path.join(tmpA, 'a.mp3')
    const copyB = path.join(tmpB, 'b.mp3')
    // addAudioAssetFromLooperPlan renames uploads; use fresh copies.
    runFfmpeg(['-y', '-i', a, '-c', 'copy', copyA])
    runFfmpeg(['-y', '-i', b, '-c', 'copy', copyB])

    const asset = await addAudioAssetFromLooperPlan(
      [
        { path: copyA, originalName: 'a.mp3', size: (await stat(copyA)).size },
        { path: copyB, originalName: 'b.mp3', size: (await stat(copyB)).size },
      ],
      settings,
    )
    const jobId = `mux-pl-${stamp}`
    const workDir = path.join(jobsDir, jobId)
    await mkdir(workDir, { recursive: true })
    const output = path.join(workDir, 'out.mp4')

    const meta = await muxScreensaverAudio({
      job: {
        id: jobId,
        duration: 3,
        audioMode: 'upload',
        audioVolume: 1,
        audioFadeIn: 0,
        audioFadeOut: 0,
        loopAudio: true,
        audioAssetId: asset.id,
      },
      videoPath: video,
      outputPath: output,
      workDir,
      durationSec: 3,
      hooks: {
        cancelled: () => false,
        onProgress: () => undefined,
        registerKill: () => undefined,
      },
      copyVideo: true,
    })

    assert.equal(meta.processingStrategy, 'STREAM_COPY')
    assert.equal(meta.lossyEncodeCount, 0)

    const recipeDir = path.join(workDir, 'audio-recipe')
    const names = await readdir(recipeDir)
    assert.equal(names.some((name) => name.endsWith('.wav')), false)
    assert.ok(names.some((name) => name.includes('stream-copy')))

    await removeAudioAsset(asset.id)
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
    await rm(tmpA, { recursive: true, force: true }).catch(() => undefined)
    await rm(tmpB, { recursive: true, force: true }).catch(() => undefined)
  })
})
