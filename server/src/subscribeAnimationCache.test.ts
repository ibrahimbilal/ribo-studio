import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { buildSubscribeAnimationCachePayload, resolveSubscribeAnimationCacheKey } from '../../shared/subscribeAnimationCacheKey'
import {
  applySubscribeAnimationCacheRetention,
  clearSubscribeAnimationCache,
  ensureSubscribeAnimationCache,
  getCachedAnimation,
  getSubscribeAnimationCacheStats,
  listSubscribeAnimationCacheInventory,
  materializeCachedAnimation,
  putCachedAnimation,
  releaseSubscribeAnimationCache,
  retainSubscribeAnimationCache,
  setSubscribeAnimationCacheMaxBytes,
  subscribeAnimationCacheDir,
  upsertSubscribeChannelMeta,
  validateCachedAnimation,
} from './subscribeAnimationCache'
import { ensureStorage, jobsDir, tmpDir } from './storage'
import { rm } from 'node:fs/promises'

async function writeTinyPng(filePath: string): Promise<void> {
  // 1x1 transparent PNG
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  await writeFile(filePath, png)
}

describe('subscribe animation persistent cache', () => {
  before(async () => {
    await ensureStorage()
    await ensureSubscribeAnimationCache()
    await clearSubscribeAnimationCache({ scope: 'all' })
  })

  after(async () => {
    await clearSubscribeAnimationCache({ scope: 'all' })
  })

  it('stores static and dynamic entries under separate trees and reuses by key', async () => {
    const staticResolved = await resolveSubscribeAnimationCacheKey({
      style: 'subscribe-only',
      sizePercent: 12,
      edgeDistance: 0,
      outputWidth: 1920,
    })
    const staging = path.join(tmpDir, `anim-cache-test-${Date.now()}`)
    await mkdir(staging, { recursive: true })
    const frames = [path.join(staging, 'a.png'), path.join(staging, 'b.png')]
    await writeTinyPng(frames[0]!)
    await writeTinyPng(frames[1]!)

    const stored = await putCachedAnimation({
      cacheKey: staticResolved.key,
      kind: 'static',
      templateId: 'subscribe-only',
      channelId: null,
      framePaths: frames,
      width: 10,
      height: 10,
      fps: 60,
      durationSec: 7,
      renderConfig: staticResolved.payload,
    })
    assert.equal(stored.ready, true)
    const hit = await getCachedAnimation(staticResolved.key)
    assert.ok(hit)
    assert.equal(hit!.frameCount, 2)

    const channelId = 'UCxxxxxxxxxxxxxxxxxxxxxx'
    await upsertSubscribeChannelMeta({
      channelId,
      channelName: 'Channel A',
      channelUrl: `https://www.youtube.com/channel/${channelId}`,
      subscriberCount: '1M subscribers',
      avatarContentHash: createHash('sha256').update('avatar-a').digest('hex'),
      avatarUrl: null,
      updatedAt: Date.now(),
    })
    const dynamicResolved = await resolveSubscribeAnimationCacheKey({
      style: 'channel-card',
      sizePercent: 27,
      edgeDistance: 0,
      outputWidth: 1920,
      channelId,
      channelName: 'Channel A',
      channelSubscriberCount: '1M subscribers',
      channelCardTheme: 'light',
      avatarContentHash: createHash('sha256').update('avatar-a').digest('hex'),
    })
    const stagingB = path.join(tmpDir, `anim-cache-dyn-${Date.now()}`)
    await mkdir(stagingB, { recursive: true })
    const dynFrames = [path.join(stagingB, 'a.png'), path.join(stagingB, 'b.png')]
    await writeTinyPng(dynFrames[0]!)
    await writeTinyPng(dynFrames[1]!)
    await putCachedAnimation({
      cacheKey: dynamicResolved.key,
      kind: 'dynamic',
      templateId: 'channel-card',
      channelId,
      framePaths: dynFrames,
      width: 20,
      height: 20,
      fps: 60,
      durationSec: 7,
      renderConfig: dynamicResolved.payload,
    })
    const inventoryAfterDynamic = listSubscribeAnimationCacheInventory()
    const channelAGroup = inventoryAfterDynamic.channels.find((item) => item.channelId === channelId)
    assert.ok(channelAGroup)
    assert.ok(channelAGroup!.animations.some((item) => item.name === 'Channel card - Light'))

    const channelB = 'UCyyyyyyyyyyyyyyyyyyyyyy'
    await upsertSubscribeChannelMeta({
      channelId: channelB,
      channelName: 'Channel B',
      channelUrl: `https://www.youtube.com/channel/${channelB}`,
      subscriberCount: '2M subscribers',
      avatarContentHash: createHash('sha256').update('avatar-b').digest('hex'),
      avatarUrl: null,
      updatedAt: Date.now(),
    })

    const stats = await getSubscribeAnimationCacheStats()
    assert.equal(stats.staticCount, 1)
    assert.equal(stats.dynamicCount, 1)
    assert.equal(stats.channelCount, 2)

    const dest = path.join(jobsDir, `materialize-${Date.now()}`, 'anim')
    await materializeCachedAnimation(staticResolved.key, dest)
    const again = await validateCachedAnimation(staticResolved.key)
    assert.ok(again)

    // Changing unused project-ish fields is not part of the key payload.
    const payload = buildSubscribeAnimationCachePayload({
      style: 'subscribe-only',
      sizePercent: 12,
      edgeDistance: 0,
      outputWidth: 1920,
    })
    assert.equal(JSON.stringify(payload).includes('startSec'), false)

    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    await rm(stagingB, { recursive: true, force: true }).catch(() => undefined)
    await rm(path.dirname(dest), { recursive: true, force: true }).catch(() => undefined)
  })

  it('replaces older channel-card cache for the same theme when channel data changes', async () => {
    const channelId = 'UCzzzzzzzzzzzzzzzzzzzzzz'
    await upsertSubscribeChannelMeta({
      channelId,
      channelName: 'Channel Z',
      channelUrl: `https://www.youtube.com/channel/${channelId}`,
      subscriberCount: '100K subscribers',
      avatarContentHash: createHash('sha256').update('avatar-z1').digest('hex'),
      avatarUrl: null,
      updatedAt: Date.now(),
    })
    const first = await resolveSubscribeAnimationCacheKey({
      style: 'channel-card',
      sizePercent: 27,
      edgeDistance: 0,
      outputWidth: 1920,
      channelId,
      channelName: 'Channel Z',
      channelSubscriberCount: '100K subscribers',
      channelCardTheme: 'light',
      avatarContentHash: createHash('sha256').update('avatar-z1').digest('hex'),
    })
    const staging = path.join(tmpDir, `anim-cache-theme-replace-${Date.now()}`)
    await mkdir(staging, { recursive: true })
    const firstFrames = [path.join(staging, 'a1.png')]
    await writeTinyPng(firstFrames[0]!)
    await putCachedAnimation({
      cacheKey: first.key,
      kind: 'dynamic',
      templateId: 'channel-card',
      channelId,
      framePaths: firstFrames,
      width: 20,
      height: 20,
      fps: 60,
      durationSec: 7,
      renderConfig: first.payload,
    })

    const second = await resolveSubscribeAnimationCacheKey({
      style: 'channel-card',
      sizePercent: 27,
      edgeDistance: 0,
      outputWidth: 1920,
      channelId,
      channelName: 'Channel Z',
      channelSubscriberCount: '250K subscribers',
      channelCardTheme: 'light',
      avatarContentHash: createHash('sha256').update('avatar-z2').digest('hex'),
    })
    assert.notEqual(first.key, second.key)
    const secondFrames = [path.join(staging, 'a2.png')]
    await writeTinyPng(secondFrames[0]!)
    await putCachedAnimation({
      cacheKey: second.key,
      kind: 'dynamic',
      templateId: 'channel-card',
      channelId,
      framePaths: secondFrames,
      width: 20,
      height: 20,
      fps: 60,
      durationSec: 7,
      renderConfig: second.payload,
    })

    const inventory = listSubscribeAnimationCacheInventory()
    const group = inventory.channels.find((item) => item.channelId === channelId)
    assert.ok(group)
    const lightCards = group!.animations.filter((item) => item.channelCardTheme === 'light')
    assert.equal(lightCards.length, 1)
    assert.equal(lightCards[0]!.cacheKey, second.key)
    assert.equal(await getCachedAnimation(first.key), null)
    assert.ok(await getCachedAnimation(second.key))

    const dark = await resolveSubscribeAnimationCacheKey({
      style: 'channel-card',
      sizePercent: 27,
      edgeDistance: 0,
      outputWidth: 1920,
      channelId,
      channelName: 'Channel Z',
      channelSubscriberCount: '250K subscribers',
      channelCardTheme: 'dark',
      avatarContentHash: createHash('sha256').update('avatar-z2').digest('hex'),
    })
    const darkFrames = [path.join(staging, 'a3.png')]
    await writeTinyPng(darkFrames[0]!)
    await putCachedAnimation({
      cacheKey: dark.key,
      kind: 'dynamic',
      templateId: 'channel-card',
      channelId,
      framePaths: darkFrames,
      width: 20,
      height: 20,
      fps: 60,
      durationSec: 7,
      renderConfig: dark.payload,
    })
    const afterDark = listSubscribeAnimationCacheInventory().channels.find((item) => item.channelId === channelId)
    assert.equal(afterDark!.animations.length, 2)
    assert.ok(afterDark!.animations.some((item) => item.channelCardTheme === 'light' && item.cacheKey === second.key))
    assert.ok(afterDark!.animations.some((item) => item.channelCardTheme === 'dark' && item.cacheKey === dark.key))

    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
  })

  it('does not delete retained entries during LRU clear-all of busy keys', async () => {
    const resolved = await resolveSubscribeAnimationCacheKey({
      style: 'subscribe-alerts',
      sizePercent: 18,
      edgeDistance: 0,
      outputWidth: 1280,
    })
    const staging = path.join(tmpDir, `anim-cache-retain-${Date.now()}`)
    await mkdir(staging, { recursive: true })
    const frames = [path.join(staging, 'a.png')]
    await writeTinyPng(frames[0]!)
    await putCachedAnimation({
      cacheKey: resolved.key,
      kind: 'static',
      templateId: 'subscribe-alerts',
      channelId: null,
      framePaths: frames,
      width: 8,
      height: 8,
      fps: 60,
      durationSec: 7,
      renderConfig: resolved.payload,
    })
    retainSubscribeAnimationCache([resolved.key])
    await clearSubscribeAnimationCache({ scope: 'all' })
    const still = await getCachedAnimation(resolved.key)
    assert.ok(still, 'retained entry must survive clear-all')
    releaseSubscribeAnimationCache([resolved.key])
    const cleared2 = await clearSubscribeAnimationCache({ scope: 'entry', cacheKey: resolved.key })
    assert.equal(cleared2.removed, 1)
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
  })

  it('quarantines corrupt manifests and reports miss', async () => {
    const resolved = await resolveSubscribeAnimationCacheKey({
      style: 'like-subscribe-alerts',
      sizePercent: 25,
      edgeDistance: 4,
      outputWidth: 1280,
    })
    const staging = path.join(tmpDir, `anim-cache-corrupt-${Date.now()}`)
    await mkdir(staging, { recursive: true })
    const frames = [path.join(staging, 'a.png'), path.join(staging, 'b.png')]
    await writeTinyPng(frames[0]!)
    await writeTinyPng(frames[1]!)
    await putCachedAnimation({
      cacheKey: resolved.key,
      kind: 'static',
      templateId: 'like-subscribe-alerts',
      channelId: null,
      framePaths: frames,
      width: 8,
      height: 8,
      fps: 60,
      durationSec: 7,
      renderConfig: resolved.payload,
    })
    const entry = await validateCachedAnimation(resolved.key)
    assert.ok(entry)
    await writeFile(path.join(entry!.dir, 'manifest.json'), '{bad')
    const miss = await validateCachedAnimation(resolved.key)
    assert.equal(miss, null)
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
  })

  it('keeps cache root outside jobsDir', () => {
    assert.ok(subscribeAnimationCacheDir.includes('subscribe-animation-cache'))
    assert.equal(subscribeAnimationCacheDir.includes(`${path.sep}jobs${path.sep}`), false)
    setSubscribeAnimationCacheMaxBytes(2 * 1024 * 1024 * 1024)
  })

  it('lists inventory with static templates and skips retained keys during retention cleanup', async () => {
    const resolved = await resolveSubscribeAnimationCacheKey({
      style: 'subscribe-alerts',
      sizePercent: 18,
      edgeDistance: 2,
      outputWidth: 1920,
    })
    const staging = path.join(tmpDir, `anim-cache-retention-${Date.now()}`)
    await mkdir(staging, { recursive: true })
    const frames = [path.join(staging, 'a.png')]
    await writeTinyPng(frames[0]!)
    await putCachedAnimation({
      cacheKey: resolved.key,
      kind: 'static',
      templateId: 'subscribe-alerts',
      channelId: null,
      framePaths: frames,
      width: 8,
      height: 8,
      fps: 60,
      durationSec: 7,
      renderConfig: resolved.payload,
    })
    const inventory = listSubscribeAnimationCacheInventory()
    assert.ok(inventory.staticAnimations.some((item) => item.templateId === 'subscribe-only'))
    assert.ok(inventory.staticAnimations.some((item) => item.cacheKey === resolved.key && item.status === 'cached'))

    retainSubscribeAnimationCache([resolved.key])
    const skipped = await applySubscribeAnimationCacheRetention(1)
    assert.equal(skipped.removed, 0)
    releaseSubscribeAnimationCache([resolved.key])

    const entry = await validateCachedAnimation(resolved.key)
    assert.ok(entry)
    entry!.lastUsedAt = Date.now() - 60_000
    const removed = await applySubscribeAnimationCacheRetention(1000)
    assert.equal(removed.removed >= 1, true)
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
  })
})
