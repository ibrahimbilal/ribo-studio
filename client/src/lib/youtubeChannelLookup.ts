/**
 * Shared YouTube channel metadata lookup with in-flight deduplication.
 * Reuses POST /api/youtube-channel-lookup (public page/oEmbed — no API key).
 */

import { normalizeYoutubeChannelInput, youtubeHandleFromUrl } from '@shared/youtubeChannel'
import * as api from './api'
import {
  channelMetadataAffectsCache,
  readSubscribeChannelPreference,
  upsertSubscribeChannelPreference,
  type SubscribeChannelPreference,
} from '../apps/frame-screensaver/lib/subscribeAnimation/subscribeAnimationChannelPreference'

const inflight = new Map<string, Promise<api.YoutubeChannelLookupResult>>()

function cacheKey(normalizedUrl: string): string {
  return normalizedUrl.toLowerCase()
}

export async function lookupYoutubeChannelDeduped(rawInput: string): Promise<api.YoutubeChannelLookupResult> {
  const normalized = normalizeYoutubeChannelInput(rawInput)
  if (!normalized.ok) throw new Error(normalized.error)
  const key = cacheKey(normalized.normalizedUrl)
  const existing = inflight.get(key)
  if (existing) return existing
  const promise = api.lookupYoutubeChannel(normalized.normalizedUrl).finally(() => {
    inflight.delete(key)
  })
  inflight.set(key, promise)
  return promise
}

export async function registerYoutubeChannel(
  rawInput: string,
  options?: { select?: boolean },
): Promise<
  | { ok: true; channel: SubscribeChannelPreference; cacheRelevantChange: boolean }
  | { ok: false; error: string }
> {
  const normalized = normalizeYoutubeChannelInput(rawInput)
  if (!normalized.ok) return normalized
  try {
    const meta = await lookupYoutubeChannelDeduped(normalized.normalizedUrl)
    if (!meta.channelId) {
      return { ok: false, error: 'Could not resolve a stable YouTube channel ID.' }
    }
    const before = readSubscribeChannelPreference(meta.channelId)
    const channel = upsertSubscribeChannelPreference(
      {
        channelId: meta.channelId,
        channelName: meta.channelName ?? meta.channelId,
        channelUrl: meta.channelUrl ?? normalized.normalizedUrl,
        channelAvatarUrl: meta.avatarUrl,
        channelSubscriberCount: meta.subscriberCount,
        channelHandle: normalized.handle ?? youtubeHandleFromUrl(meta.channelUrl),
        channelCardTheme: before?.channelCardTheme ?? 'light',
      },
      { select: options?.select !== false },
    )
    if (!channel) return { ok: false, error: 'Could not save that channel.' }
    return {
      ok: true,
      channel,
      cacheRelevantChange: channelMetadataAffectsCache(before, channel),
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Channel lookup failed.' }
  }
}

export async function refreshYoutubeChannel(
  channelId: string,
): Promise<
  | { ok: true; channel: SubscribeChannelPreference; cacheRelevantChange: boolean }
  | { ok: false; error: string; preserved: SubscribeChannelPreference | null }
> {
  const existing = readSubscribeChannelPreference(channelId)
  if (!existing) return { ok: false, error: 'Channel is not registered.', preserved: null }
  try {
    const meta = await lookupYoutubeChannelDeduped(existing.channelUrl || `https://www.youtube.com/channel/${channelId}`)
    if (!meta.channelId) {
      return { ok: false, error: 'Could not refresh channel metadata.', preserved: existing }
    }
    const channel = upsertSubscribeChannelPreference(
      {
        channelId: meta.channelId,
        channelName: meta.channelName ?? existing.channelName,
        channelUrl: meta.channelUrl ?? existing.channelUrl,
        channelAvatarUrl: meta.avatarUrl ?? existing.channelAvatarUrl,
        channelSubscriberCount: meta.subscriberCount ?? existing.channelSubscriberCount,
        channelHandle: existing.channelHandle ?? youtubeHandleFromUrl(meta.channelUrl),
        channelCardTheme: existing.channelCardTheme ?? 'light',
      },
      { select: false },
    )
    if (!channel) return { ok: false, error: 'Could not save refreshed metadata.', preserved: existing }
    return {
      ok: true,
      channel,
      cacheRelevantChange: channelMetadataAffectsCache(existing, channel),
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Refresh failed.',
      preserved: existing,
    }
  }
}
