import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildSubscribeAnimationCachePayload,
  resolveSubscribeAnimationCacheKey,
  stableStringify,
} from './subscribeAnimationCacheKey'
import { isYoutubeChannelId, youtubeChannelIdFromHtml, youtubeChannelIdFromUrl } from './youtubeChannelId'
import { isDynamicSubscribeAnimationStyle, isStaticSubscribeAnimationStyle } from './subscribeAnimationTemplates'

describe('subscribe animation template kinds', () => {
  it('classifies static vs dynamic styles', () => {
    assert.equal(isStaticSubscribeAnimationStyle('subscribe-only'), true)
    assert.equal(isStaticSubscribeAnimationStyle('subscribe-alerts'), true)
    assert.equal(isStaticSubscribeAnimationStyle('like-subscribe-alerts'), true)
    assert.equal(isDynamicSubscribeAnimationStyle('channel-card'), true)
    assert.equal(isStaticSubscribeAnimationStyle('channel-card'), false)
  })
})

describe('youtube channel id', () => {
  it('validates UC ids and extracts from URLs/HTML', () => {
    assert.equal(isYoutubeChannelId('UCxxxxxxxxxxxxxxxxxxxxxx'), true)
    assert.equal(isYoutubeChannelId('not-a-channel'), false)
    assert.equal(
      youtubeChannelIdFromUrl('https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx'),
      'UCxxxxxxxxxxxxxxxxxxxxxx',
    )
    assert.equal(youtubeChannelIdFromUrl('https://www.youtube.com/@Someone'), null)
    assert.equal(
      youtubeChannelIdFromHtml('{"channelId":"UCxxxxxxxxxxxxxxxxxxxxxx","title":"x"}'),
      'UCxxxxxxxxxxxxxxxxxxxxxx',
    )
  })
})

describe('subscribe animation cache key', () => {
  it('stable stringify sorts keys', () => {
    assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }))
  })

  it('excludes unused channel fields for static templates', async () => {
    const a = await resolveSubscribeAnimationCacheKey({
      style: 'subscribe-only',
      sizePercent: 12,
      edgeDistance: 0,
      outputWidth: 3840,
      channelName: 'A',
      channelId: 'UCxxxxxxxxxxxxxxxxxxxxxx',
      avatarContentHash: 'abc',
    })
    const b = await resolveSubscribeAnimationCacheKey({
      style: 'subscribe-only',
      sizePercent: 12,
      edgeDistance: 0,
      outputWidth: 3840,
      channelName: 'B',
      channelId: 'UCyyyyyyyyyyyyyyyyyyyyyy',
      avatarContentHash: 'def',
    })
    assert.equal(a.key, b.key)
    assert.equal(a.payload.kind, 'static')
    assert.equal(a.payload.channelId, undefined)
  })

  it('includes channel visual fields for dynamic templates', async () => {
    const base = {
      style: 'channel-card' as const,
      sizePercent: 27,
      edgeDistance: 0,
      outputWidth: 3840,
      channelId: 'UCxxxxxxxxxxxxxxxxxxxxxx',
      channelName: 'Ribo',
      channelSubscriberCount: '1M subscribers',
      channelCardTheme: 'light',
      avatarContentHash: 'hash1',
    }
    const a = await resolveSubscribeAnimationCacheKey(base)
    const renamed = await resolveSubscribeAnimationCacheKey({ ...base, channelName: 'Other' })
    const sameAvatarUrlChange = await resolveSubscribeAnimationCacheKey({ ...base, avatarContentHash: 'hash1' })
    const newAvatar = await resolveSubscribeAnimationCacheKey({ ...base, avatarContentHash: 'hash2' })
    assert.notEqual(a.key, renamed.key)
    assert.equal(a.key, sameAvatarUrlChange.key)
    assert.notEqual(a.key, newAvatar.key)
    assert.equal(a.payload.kind, 'dynamic')
  })

  it('does not include position or start time in payload', () => {
    const payload = buildSubscribeAnimationCachePayload({
      style: 'subscribe-only',
      sizePercent: 12,
      edgeDistance: 8,
      outputWidth: 1920,
    })
    const json = JSON.stringify(payload)
    assert.equal(json.includes('position'), false)
    assert.equal(json.includes('startSec'), false)
    assert.equal(payload.edgeDistance, 8)
  })
})
