import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { moduleDir } from './moduleDir'
import {
  addAudioAssetFromLooperPlan,
  addAudioAssetFromUpload,
  audioAssetIsBusy,
  cloneLooperPlanWithTrackOrder,
  ensureAudioAssets,
  getAudioAsset,
  purgeAudioAssets,
  releaseAudioAssets,
  removeAudioAsset,
  retainAudioAssets,
  sweepAudioAssets,
} from './audioAssets'
import { ffmpegBinary } from './binaries'
import { ensureStorage } from './storage'

const fixtures = path.join(moduleDir(import.meta.url), '../../tmp-test-audio-assets')

async function makeTone(file: string, seconds = 0.5): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const result = spawnSync(
    ffmpegBinary(),
    ['-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-c:a', 'libmp3lame', '-b:a', '128k', file],
    { windowsHide: true, encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr || 'ffmpeg tone failed')
}

describe('screensaver audio assets', () => {
  before(async () => {
    await ensureStorage()
    await ensureAudioAssets()
    await mkdir(fixtures, { recursive: true })
  })

  after(async () => {
    await rm(fixtures, { recursive: true, force: true }).catch(() => undefined)
  })

  it('stores an uploaded audio file and blocks delete while retained', async () => {
    const incoming = path.join(fixtures, `tone-${Date.now()}.mp3`)
    await makeTone(incoming)
    const stored = await addAudioAssetFromUpload(incoming, 'tone.mp3', 'audio/mpeg')
    assert.ok(getAudioAsset(stored.id))
    assert.ok(stored.size > 0)
    assert.ok(stored.duration > 0)

    retainAudioAssets([stored.id])
    assert.equal(audioAssetIsBusy(stored.id), true)
    assert.equal(await removeAudioAsset(stored.id), false)

    releaseAudioAssets([stored.id])
    assert.equal(await removeAudioAsset(stored.id), true)
    assert.equal(getAudioAsset(stored.id), undefined)
  })

  it('sweep keeps busy assets and drops stale unreferenced ones', async () => {
    const incoming = path.join(fixtures, `stale-${Date.now()}.mp3`)
    await makeTone(incoming)
    const stored = await addAudioAssetFromUpload(incoming, 'stale.mp3')
    const asset = getAudioAsset(stored.id)
    assert.ok(asset)
    asset.createdAt = Date.now() - 8 * 24 * 60 * 60 * 1000
    retainAudioAssets([stored.id])
    await sweepAudioAssets(7 * 24 * 60 * 60 * 1000)
    assert.ok(getAudioAsset(stored.id))
    releaseAudioAssets([stored.id])
    await sweepAudioAssets(7 * 24 * 60 * 60 * 1000)
    assert.equal(getAudioAsset(stored.id), undefined)
  })

  it('purge removes idle assets and keeps busy ones', async () => {
    const idlePath = path.join(fixtures, `purge-idle-${Date.now()}.mp3`)
    const busyPath = path.join(fixtures, `purge-busy-${Date.now()}.mp3`)
    await makeTone(idlePath)
    await makeTone(busyPath)
    const idle = await addAudioAssetFromUpload(idlePath, 'idle.mp3')
    const busy = await addAudioAssetFromUpload(busyPath, 'busy.mp3')
    retainAudioAssets([busy.id])
    await purgeAudioAssets()
    assert.equal(getAudioAsset(idle.id), undefined)
    assert.ok(getAudioAsset(busy.id))
    releaseAudioAssets([busy.id])
    await purgeAudioAssets()
    assert.equal(getAudioAsset(busy.id), undefined)
  })

  it('rejects non-audio uploads via extension check', async () => {
    const bogus = path.join(fixtures, `bogus-${Date.now()}.txt`)
    await writeFile(bogus, 'not audio')
    await assert.rejects(() => addAudioAssetFromUpload(bogus, 'notes.txt'), /MP3|WAV|FLAC|M4A|AAC|OGG/i)
  })

  it('clones a looper-plan recipe with a reordered playlist', async () => {
    const stamp = Date.now()
    const aPath = path.join(fixtures, `plan-a-${stamp}.mp3`)
    const bPath = path.join(fixtures, `plan-b-${stamp}.mp3`)
    await makeTone(aPath, 0.4)
    await makeTone(bPath, 0.6)
    const base = await addAudioAssetFromLooperPlan(
      [
        { path: aPath, originalName: 'a.mp3', size: (await stat(aPath)).size },
        { path: bPath, originalName: 'b.mp3', size: (await stat(bPath)).size },
      ],
      {
        targetDurationSeconds: 120,
        loopMode: 'simple',
        crossfadeSeconds: 0,
        fadeInSeconds: 0,
        fadeOutSeconds: 0,
        volumePercent: 100,
        format: 'mp3',
        mp3Bitrate: 320,
        filename: 'loop',
        playlistCrossfade: false,
        playlistCrossfadeSeconds: 3,
        normalizeLoudness: false,
        tracks: [
          { id: 'a', trimStart: 0, trimEnd: 0.4 },
          { id: 'b', trimStart: 0, trimEnd: 0.6 },
        ],
      },
    )
    const same = await cloneLooperPlanWithTrackOrder(base.id, [0, 1])
    assert.equal(same.id, base.id)

    const cloned = await cloneLooperPlanWithTrackOrder(base.id, [1, 0])
    assert.notEqual(cloned.id, base.id)
    assert.equal(cloned.origin, 'looper-plan')
    assert.equal(cloned.recipe?.tracks[0]?.originalName, 'b.mp3')
    assert.equal(cloned.recipe?.tracks[1]?.originalName, 'a.mp3')
    assert.equal(cloned.recipe?.settings.tracks?.[0]?.id, 'b')
    assert.equal(cloned.recipe?.settings.tracks?.[1]?.id, 'a')

    await removeAudioAsset(cloned.id)
    await removeAudioAsset(base.id)
  })
})
