import {
  SUBSCRIBE_ANIMATION_DURATION_SEC,
  SUBSCRIBE_ANIMATION_FPS,
  type SubscribeAnimationSettings,
  type SubscribeAnimationStyle,
} from './screensaverSubscribeAnimation'
import {
  SUBSCRIBE_ANIMATION_CACHE_FORMAT,
  SUBSCRIBE_ANIMATION_CACHE_SCHEMA_VERSION,
  SUBSCRIBE_ANIMATION_RENDERER_VERSION,
  subscribeAnimationTemplateMeta,
  type SubscribeAnimationTemplateKind,
} from './subscribeAnimationTemplates'

export interface SubscribeAnimationCacheKeyInput {
  style: SubscribeAnimationStyle
  sizePercent: number
  edgeDistance: number
  outputWidth: number
  durationSec?: number
  fps?: number
  /** Required for dynamic templates when channel deps are used. */
  channelId?: string | null
  channelName?: string | null
  channelSubscriberCount?: string | null
  channelCardTheme?: string | null
  /** SHA-256 (or equivalent) of avatar image bytes; null when no avatar. */
  avatarContentHash?: string | null
}

export interface SubscribeAnimationCacheKeyPayload {
  schemaVersion: number
  rendererVersion: number
  format: typeof SUBSCRIBE_ANIMATION_CACHE_FORMAT
  kind: SubscribeAnimationTemplateKind
  templateId: SubscribeAnimationStyle
  sizePercent: number
  edgeDistance: number
  outputWidth: number
  durationSec: number
  fps: number
  channelId?: string
  channelName?: string
  channelSubscriberCount?: string
  channelCardTheme?: string
  avatarContentHash?: string
}

/** Stable JSON: sorted object keys, no whitespace variance. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(sortKeys)
  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) {
    const entry = obj[key]
    if (entry === undefined) continue
    out[key] = sortKeys(entry)
  }
  return out
}

export function buildSubscribeAnimationCachePayload(input: SubscribeAnimationCacheKeyInput): SubscribeAnimationCacheKeyPayload {
  const meta = subscribeAnimationTemplateMeta(input.style)
  const durationSec = input.durationSec ?? SUBSCRIBE_ANIMATION_DURATION_SEC
  const fps = input.fps ?? SUBSCRIBE_ANIMATION_FPS
  const payload: SubscribeAnimationCacheKeyPayload = {
    schemaVersion: SUBSCRIBE_ANIMATION_CACHE_SCHEMA_VERSION,
    rendererVersion: SUBSCRIBE_ANIMATION_RENDERER_VERSION,
    format: SUBSCRIBE_ANIMATION_CACHE_FORMAT,
    kind: meta.kind,
    templateId: input.style,
    sizePercent: Math.round(input.sizePercent * 10) / 10,
    edgeDistance: Math.round(input.edgeDistance),
    outputWidth: Math.round(input.outputWidth),
    durationSec,
    fps,
  }
  if (meta.kind === 'dynamic') {
    if (input.channelId) payload.channelId = input.channelId
    if (meta.channelDeps.includes('channelName') && input.channelName) {
      payload.channelName = input.channelName
    }
    if (meta.channelDeps.includes('channelSubscriberCount')) {
      payload.channelSubscriberCount = input.channelSubscriberCount ?? ''
    }
    if (meta.channelDeps.includes('channelCardTheme') && input.channelCardTheme) {
      payload.channelCardTheme = input.channelCardTheme
    }
    if (meta.channelDeps.includes('channelAvatar')) {
      payload.avatarContentHash = input.avatarContentHash ?? ''
    }
  }
  return payload
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('SHA-256 is not available in this environment.')
  }
  let bytes: Uint8Array<ArrayBuffer>
  if (typeof data === 'string') {
    bytes = new TextEncoder().encode(data)
  } else if (data instanceof Uint8Array) {
    const copy = new Uint8Array(data.byteLength)
    copy.set(data)
    bytes = copy
  } else {
    bytes = new Uint8Array(data)
  }
  const digest = await subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function resolveSubscribeAnimationCacheKey(input: SubscribeAnimationCacheKeyInput): Promise<{
  key: string
  payload: SubscribeAnimationCacheKeyPayload
  kind: SubscribeAnimationTemplateKind
}> {
  const payload = buildSubscribeAnimationCachePayload(input)
  const key = await sha256Hex(stableStringify(payload))
  return { key, payload, kind: payload.kind }
}

export function cacheKeyInputFromSettings(
  settings: SubscribeAnimationSettings,
  outputWidth: number,
  avatarContentHash: string | null,
): SubscribeAnimationCacheKeyInput {
  return {
    style: settings.style,
    sizePercent: settings.sizePercent,
    edgeDistance: settings.edgeDistance,
    outputWidth,
    durationSec: settings.durationSec,
    fps: SUBSCRIBE_ANIMATION_FPS,
    channelId: settings.channelId,
    channelName: settings.channelName,
    channelSubscriberCount: settings.channelSubscriberCount,
    channelCardTheme: settings.channelCardTheme,
    avatarContentHash,
  }
}
