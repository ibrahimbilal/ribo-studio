/**
 * Shared YouTube channel metadata lookup with in-flight deduplication.
 * Reuses POST /api/youtube-channel-lookup (public page/oEmbed — no API key).
 */

import { subscribeChannelCachedAvatarPath } from '@shared/subscribeChannelAvatar'
import { sha256Hex } from '@shared/subscribeAnimationCacheKey'
import { normalizeYoutubeChannelInput, youtubeHandleFromUrl } from '@shared/youtubeChannel'
import { isAllowedYoutubeAvatarUrl, isYoutubeAvatarDataUrl } from '@shared/youtubeAvatar'
import * as api from './api'
import { ingestSubscribeChannelAvatar } from '../apps/frame-screensaver/lib/subscribeAnimation/subscribeAnimationChannelAvatar'
import { resolveSubscribeAvatarContentHash } from '../apps/frame-screensaver/lib/subscribeAnimation/subscribeAnimationAvatarHash'
import {
  channelMetadataAffectsCache,
  readSubscribeChannelPreference,
  upsertSubscribeChannelPreference,
  type SubscribeChannelPreference,
} from '../apps/frame-screensaver/lib/subscribeAnimation/subscribeAnimationChannelPreference'

function dataUrlToBlob(dataUrl: string): { blob: Blob; filename: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl.trim())
  if (!match) return null
  try {
    const binary = atob(match[2])
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const mime = match[1].toLowerCase()
    const ext = mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : '.jpg'
    return { blob: new Blob([bytes], { type: match[1] }), filename: `avatar${ext}` }
  } catch {
    return null
  }
}

async function avatarContentHashFromDataUrl(dataUrl: string): Promise<string | null> {
  const packed = dataUrlToBlob(dataUrl)
  if (!packed) return null
  return sha256Hex(await packed.blob.arrayBuffer())
}

/** Remote/proxy `<img src>` when the on-disk avatar is missing or not registered on the server yet. */
export function youtubeChannelAvatarProxyImgSrc(url: string | null | undefined): string | null {
  const trimmed = url?.trim() || null
  if (!trimmed) return null
  if (isYoutubeAvatarDataUrl(trimmed)) return trimmed
  if (isAllowedYoutubeAvatarUrl(trimmed)) {
    return `/api/youtube-channel-avatar?url=${encodeURIComponent(trimmed)}`
  }
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) return trimmed
  return null
}

/** Prefer on-disk cache under `server/tmp/subscribe-animation-cache/` (lazy-filled on GET). */
export function youtubeChannelAvatarImgSrc(
  url: string | null | undefined,
  channelId?: string | null,
): string | null {
  const trimmed = url?.trim() || null
  const cached = subscribeChannelCachedAvatarPath(channelId)
  if (cached && trimmed) return cached
  return youtubeChannelAvatarProxyImgSrc(url)
}

export function onYoutubeChannelAvatarImgError(event: Event, channelAvatarUrl: string | null | undefined): void {
  const img = event.target
  if (!(img instanceof HTMLImageElement)) return
  const fallback = youtubeChannelAvatarProxyImgSrc(channelAvatarUrl)
  if (!fallback || img.dataset.avatarFallback === '1') return
  img.dataset.avatarFallback = '1'
  img.src = fallback
}

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

/** Save channel meta + avatar bytes to server tmp (one YouTube fetch at lookup; reuse from disk after). */
export async function persistYoutubeChannelMetaToServer(meta: api.YoutubeChannelLookupResult): Promise<void> {
  if (!meta.channelId) return
  let avatarContentHash: string | null = null
  const hasEmbeddedAvatar = Boolean(meta.avatarDataUrl && isYoutubeAvatarDataUrl(meta.avatarDataUrl))
  if (hasEmbeddedAvatar && meta.avatarDataUrl) {
    avatarContentHash = await avatarContentHashFromDataUrl(meta.avatarDataUrl)
  } else if (meta.avatarUrl) {
    avatarContentHash = await resolveSubscribeAvatarContentHash(meta.avatarUrl, meta.channelId)
  }
  try {
    await api.upsertSubscribeAnimationChannel({
      channelId: meta.channelId,
      channelName: meta.channelName,
      channelUrl: meta.channelUrl,
      subscriberCount: meta.subscriberCount,
      avatarContentHash,
      avatarUrl: meta.avatarUrl,
      clientProvidesAvatar: hasEmbeddedAvatar,
    })
  } catch {
    // Server channel metadata cache is best-effort; local registry still updates.
    return
  }
  if (hasEmbeddedAvatar && meta.avatarDataUrl) {
    const packed = dataUrlToBlob(meta.avatarDataUrl)
    if (packed) {
      try {
        await api.uploadSubscribeChannelAvatar(meta.channelId, packed.blob, packed.filename)
      } catch {
        // Disk avatar is optional; proxy fallback remains available.
      }
    }
  }
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
    await ingestSubscribeChannelAvatar(meta.avatarUrl, meta.avatarDataUrl, meta.channelId)
    await persistYoutubeChannelMetaToServer(meta)
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
    await ingestSubscribeChannelAvatar(meta.avatarUrl, meta.avatarDataUrl, meta.channelId)
    await persistYoutubeChannelMetaToServer(meta)
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