import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { defaultAudioLooperSettings } from '../../shared/audioLooper'
import {
  assessAudioDuration,
  recoverStreamCopyDuration,
  streamCopyTrimToDuration,
} from './audioDurationRecovery'
import { audioDurationSlack } from './ffmpegUtil'
import { ffmpegBinary } from './binaries'
import { moduleDir } from './moduleDir'
import { probeAudioDetails } from './probe'
import { renderAudioLooper } from './renderAudioLooper'
import { ensureStorage, jobsDir, outputsDir } from './storage'

const fixtures = path.join(moduleDir(import.meta.url), '../../tmp-test-audio-duration-recovery')

function runFfmpeg(args: string[]): void {
  const result = spawnSync(ffmpegBinary(), args, { windowsHide: true, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || 'ffmpeg failed')
}

async function makeMp3(file: string, seconds: number, bitrateKbps = 192): Promise<void> {
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

describe('audio duration assessment', () => {
  it('keeps the existing slack policy', () => {
    assert.equal(audioDurationSlack(5), 0.25)
    assert.equal(audioDurationSlack(60), 0.6)
    assert.equal(audioDurationSlack(14400), 1.5)
  })

  it('classifies overshoots from 26ms through 60s', () => {
    const target = 60
    const slack = audioDurationSlack(target)
    for (const overshoot of [0.026, 0.25, 1, 2, 10, 60]) {
      const assessment = assessAudioDuration({
        targetSeconds: target,
        streamDuration: target + overshoot,
        containerDuration: target + overshoot,
      })
      if (overshoot <= slack) {
        assert.equal(assessment.verdict, 'ok', `overshoot ${overshoot}s should be within slack ${slack}`)
      } else {
        assert.equal(assessment.verdict, 'overshoot', `overshoot ${overshoot}s`)
        assert.ok(Math.abs(assessment.deltaSeconds - overshoot) < 1e-9)
      }
    }
  })

  it('prefers stream duration when container includes padding', () => {
    const assessment = assessAudioDuration({
      targetSeconds: 10,
      streamDuration: 10.05,
      containerDuration: 12.5,
      startTime: -0.026,
    })
    assert.equal(assessment.verdict, 'ok')
    assert.equal(assessment.actualSeconds, 10.05)
    assert.ok(assessment.notes.some((note) => /stream\/container|start_time|container overshoot/i.test(note)))
  })

  it('classifies undershoot beyond slack', () => {
    const assessment = assessAudioDuration({
      targetSeconds: 10,
      streamDuration: 9.5,
      containerDuration: 9.5,
    })
    assert.equal(assessment.verdict, 'undershoot')
  })
})

describe('STREAM_COPY_TRIM recovery', () => {
  before(async () => {
    await ensureStorage()
    await mkdir(fixtures, { recursive: true })
  })

  after(async () => {
    await rm(fixtures, { recursive: true, force: true }).catch(() => undefined)
  })

  for (const overshoot of [0.026, 0.25, 1, 2, 10, 60]) {
    it(`trims ${overshoot}s overshoot with STREAM_COPY_TRIM and zero lossy encodes`, async () => {
      const target = 8
      const slack = audioDurationSlack(target)
      const generatedLen = target + overshoot
      const stamp = `${Date.now()}-${overshoot}`
      const generated = path.join(fixtures, `gen-${stamp}.mp3`)
      const workDir = path.join(jobsDir, `dur-rec-${stamp}`)
      await mkdir(workDir, { recursive: true })
      const workPath = path.join(workDir, 'output.mp3')

      await makeMp3(generated, generatedLen, 256)
      // Seed work file as an intentional overshoot (simulates stream-copy frame overshoot).
      runFfmpeg(['-y', '-i', generated, '-c:a', 'copy', workPath])

      const before = await probeAudioDetails(workPath)
      const beforeActual = before.streamDuration || before.duration
      assert.ok(
        beforeActual >= target + overshoot - 0.35,
        `expected seeded overshoot ~${overshoot}s, got duration ${beforeActual}`,
      )
      const needsTrim = beforeActual > target + slack

      const recovery = await recoverStreamCopyDuration({
        workPath,
        dir: workDir,
        targetSeconds: target,
        format: 'mp3',
        expectedChannels: 2,
        hooks: {
          cancelled: () => false,
          onProgress: () => undefined,
          registerKill: () => undefined,
        },
        retryStreamCopyLoop: async () => {
          throw new Error('retry should not be required for pure overshoot trim tests')
        },
      })

      assert.equal(recovery.preservedPackets, true)
      if (!needsTrim) {
        assert.equal(recovery.strategy, 'none')
      } else {
        assert.equal(recovery.strategy, 'STREAM_COPY_TRIM')
        assert.ok(recovery.attempts >= 1)
      }
      const after = await probeAudioDetails(workPath)
      const actual = after.streamDuration || after.duration
      assert.ok(actual <= target + slack + 0.05, `final duration ${actual} exceeds slack`)
      assert.ok(actual >= target - slack - 0.05, `final duration ${actual} undershoots`)
      assert.equal(after.codec, 'mp3')
      assert.equal(after.channels, 2)

      await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
    })
  }

  it('renderAudioLooper stream-copy loop stays packet-preserving after duration recovery', async () => {
    const stamp = Date.now()
    const source = path.join(fixtures, `loop-src-${stamp}.mp3`)
    await makeMp3(source, 1.7, 320)
    const info = await probeAudioDetails(source)
    const id = `loop-rec-${stamp}`
    const result = await renderAudioLooper(
      {
        id,
        sourcePath: source,
        sourceDuration: info.duration,
        sourceSampleRate: info.sampleRate,
        sourceChannels: info.channels,
        sourceCodec: 'mp3',
        sourceBitrate: info.bitrate,
        settings: {
          ...defaultAudioLooperSettings(),
          targetDurationSeconds: 60,
          loopMode: 'simple',
          format: 'mp3',
          mp3Bitrate: 128,
          volumePercent: 100,
          fadeInSeconds: 0,
          fadeOutSeconds: 0,
          filename: 'loop-rec',
        },
      },
      {
        cancelled: () => false,
        onProgress: () => undefined,
        onStatus: () => undefined,
        registerKill: () => undefined,
      },
    )

    assert.equal(result.processingStrategy, 'STREAM_COPY')
    assert.equal(result.lossyEncodeCount, 0)
    assert.equal(result.reencoded, false)
    const slack = audioDurationSlack(60)
    assert.ok(result.duration <= 60 + slack + 0.05)
    assert.ok(result.duration >= 60 - slack - 0.05)

    await rm(path.join(outputsDir, `${id}.mp3`), { force: true }).catch(() => undefined)
    await rm(path.join(jobsDir, id), { recursive: true, force: true }).catch(() => undefined)
  })

  it('mixed-bitrate playlist stream-copy recovers without lossy re-encode when possible', async () => {
    const stamp = Date.now()
    const a = path.join(fixtures, `pl-a-${stamp}.mp3`)
    const b = path.join(fixtures, `pl-b-${stamp}.mp3`)
    await makeMp3(a, 1.4, 128)
    await makeMp3(b, 1.4, 320)
    const id = `pl-rec-${stamp}`
    const result = await renderAudioLooper(
      {
        id,
        sourcePath: a,
        sourceDuration: 1.4,
        sourceSampleRate: 44100,
        sourceChannels: 2,
        sourceCodec: 'mp3',
        sourceBitrate: 128000,
        settings: {
          ...defaultAudioLooperSettings(),
          targetDurationSeconds: 60,
          loopMode: 'simple',
          format: 'mp3',
          mp3Bitrate: 128,
          volumePercent: 100,
          fadeInSeconds: 0,
          fadeOutSeconds: 0,
          playlistCrossfade: false,
          filename: 'pl-rec',
        },
        sources: [
          {
            path: a,
            duration: 1.4,
            sampleRate: 44100,
            channels: 2,
            trimStart: 0,
            trimEnd: 1.4,
            codec: 'mp3',
            bitrate: 128000,
          },
          {
            path: b,
            duration: 1.4,
            sampleRate: 44100,
            channels: 2,
            trimStart: 0,
            trimEnd: 1.4,
            codec: 'mp3',
            bitrate: 320000,
          },
        ],
      },
      {
        cancelled: () => false,
        onProgress: () => undefined,
        onStatus: () => undefined,
        registerKill: () => undefined,
      },
    )

    assert.equal(result.lossyEncodeCount, 0)
    assert.equal(result.processingStrategy, 'STREAM_COPY')
    const slack = audioDurationSlack(60)
    assert.ok(result.duration <= 60 + slack + 0.05)
    assert.ok(result.duration >= 60 - slack - 0.05)

    await rm(path.join(outputsDir, `${id}.mp3`), { force: true }).catch(() => undefined)
    await rm(path.join(jobsDir, id), { recursive: true, force: true }).catch(() => undefined)
  })

  it('direct STREAM_COPY_TRIM helper preserves mp3 packets for a 2s overshoot', async () => {
    const stamp = Date.now()
    const generated = path.join(fixtures, `direct-gen-${stamp}.mp3`)
    const trimmed = path.join(fixtures, `direct-trim-${stamp}.mp3`)
    await makeMp3(generated, 12, 192)
    await streamCopyTrimToDuration({
      sourcePath: generated,
      outputPath: trimmed,
      targetSeconds: 10,
      hooks: {
        cancelled: () => false,
        onProgress: () => undefined,
        registerKill: () => undefined,
      },
    })
    const out = await probeAudioDetails(trimmed)
    const slack = audioDurationSlack(10)
    const actual = out.streamDuration || out.duration
    assert.ok(actual <= 10 + slack + 0.05)
    assert.ok(actual >= 10 - slack - 0.05)
    assert.equal(out.codec, 'mp3')
    assert.equal(out.channels, 2)
  })
})
