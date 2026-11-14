import {
  SUBSCRIBE_ANIMATION_CACHE_FORMAT,
  SUBSCRIBE_ANIMATION_CACHE_SCHEMA_VERSION,
  type SubscribeAnimationTemplateKind,
} from './subscribeAnimationTemplates'
import type { SubscribeAnimationStyle } from './screensaverSubscribeAnimation'
import type { SubscribeAnimationCacheKeyPayload } from './subscribeAnimationCacheKey'
import { isYoutubeChannelId } from './youtubeChannelId'

export const SUBSCRIBE_ANIMATION_CACHE_MAX_BYTES_DEFAULT = 2 * 1024 * 1024 * 1024

export type SubscribeAnimationCachePrepStatus =
  | 'not_prepared'
  | 'queued'
  | 'preparing'
  | 'ready'
  | 'failed'

export interface SubscribeAnimationCacheManifest {
  schemaVersion: number
  cacheKey: string
  templateId: SubscribeAnimationStyle
  kind: SubscribeAnimationTemplateKind
  channelId: string | null
  format: typeof SUBSCRIBE_ANIMATION_CACHE_FORMAT
  frameCount: number
  fps: number
  durationSec: number
  width: number
  height: number
  alpha: true
  fileSize: number
  createdAt: number
  lastUsedAt: number
  renderConfig: SubscribeAnimationCacheKeyPayload
}

export interface SubscribeAnimationCacheEntryPublic {
  cacheKey: string
  kind: SubscribeAnimationTemplateKind
  templateId: SubscribeAnimationStyle
  channelId: string | null
  frameCount: number
  width: number
  height: number
  fileSize: number
  createdAt: number
  lastUsedAt: number
  ready: true
}

export interface SubscribeAnimationChannelCacheMeta {
  channelId: string
  channelName: string | null
  channelUrl: string | null
  subscriberCount: string | null
  avatarContentHash: string | null
  avatarUrl: string | null
  updatedAt: number
  fromCache?: boolean
}

export interface SubscribeAnimationCacheStats {
  totalBytes: number
  staticCount: number
  dynamicCount: number
  channelCount: number
  channels: Array<{
    channelId: string
    channelName: string | null
    bytes: number
    animationCount: number
    lastUsedAt: number | null
  }>
  maxBytes: number
}

export interface SubscribeAnimationCacheClearScope {
  scope: 'all' | 'static' | 'channel' | 'entry'
  channelId?: string
  cacheKey?: string
}

export function isValidCacheKeyHex(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

export function validateCacheManifest(raw: unknown): SubscribeAnimationCacheManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Partial<SubscribeAnimationCacheManifest>
  if (data.schemaVersion !== SUBSCRIBE_ANIMATION_CACHE_SCHEMA_VERSION) return null
  if (!isValidCacheKeyHex(data.cacheKey)) return null
  if (data.format !== SUBSCRIBE_ANIMATION_CACHE_FORMAT) return null
  if (data.kind !== 'static' && data.kind !== 'dynamic') return null
  if (typeof data.templateId !== 'string') return null
  if (data.channelId != null && !isYoutubeChannelId(data.channelId)) return null
  if (!Number.isFinite(data.frameCount) || (data.frameCount as number) < 1) return null
  if (!Number.isFinite(data.fps) || (data.fps as number) < 1) return null
  if (!Number.isFinite(data.width) || (data.width as number) < 1) return null
  if (!Number.isFinite(data.height) || (data.height as number) < 1) return null
  if (data.alpha !== true) return null
  if (!Number.isFinite(data.fileSize) || (data.fileSize as number) < 0) return null
  if (!Number.isFinite(data.createdAt) || !Number.isFinite(data.lastUsedAt)) return null
  if (!data.renderConfig || typeof data.renderConfig !== 'object') return null
  return data as SubscribeAnimationCacheManifest
}
