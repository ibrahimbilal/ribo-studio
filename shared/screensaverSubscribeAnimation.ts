import { DEFAULT_SCREENSAVER_OUTPUT } from './screensaver'
import { isAllowedYoutubeAvatarUrl, isYoutubeAvatarDataUrl } from './youtubeAvatar'
import { sanitizeYoutubeChannelId } from './youtubeChannelId'

export const SUBSCRIBE_ANIMATION_FPS = 60

export const SUBSCRIBE_ANIMATION_DURATION_SEC = 7

export const DEFAULT_SUBSCRIBE_CHANNEL_NAME = 'Ribo Gallery TV'

export const DEFAULT_SUBSCRIBE_CHANNEL_URL = 'https://www.youtube.com/@RiboGalleryTV'

export const SUBSCRIBE_ANIMATION_POSITIONS = ['bottom-left', 'bottom-center', 'bottom-right'] as const

export type SubscribeAnimationPosition = (typeof SUBSCRIBE_ANIMATION_POSITIONS)[number]

export const SUBSCRIBE_ANIMATION_STYLES = [
  { id: 'channel-card', label: 'Channel card' },
  { id: 'subscribe-only', label: 'Subscribe button only' },
  { id: 'subscribe-alerts', label: 'Subscribe + alerts' },
  { id: 'like-subscribe-alerts', label: 'Like + subscribe + alerts' },
] as const

export type SubscribeAnimationStyle = (typeof SUBSCRIBE_ANIMATION_STYLES)[number]['id']

export const SUBSCRIBE_CHANNEL_CARD_THEMES = ['light', 'dark'] as const

export type SubscribeChannelCardTheme = (typeof SUBSCRIBE_CHANNEL_CARD_THEMES)[number]

export const DEFAULT_SUBSCRIBE_EDGE_DISTANCE = 0

export const MIN_SUBSCRIBE_EDGE_DISTANCE = 0
export const MAX_SUBSCRIBE_EDGE_DISTANCE = 240

export const SUBSCRIBE_REPEAT_UNITS = ['off', 'minutes', 'hours'] as const

export type SubscribeRepeatUnit = (typeof SUBSCRIBE_REPEAT_UNITS)[number]

/** Default amount when the user enables minutes/hours repeat. */
export const DEFAULT_SUBSCRIBE_REPEAT_EVERY_VALUE = 30

export const MIN_SUBSCRIBE_REPEAT_EVERY_VALUE = 1
export const MAX_SUBSCRIBE_REPEAT_EVERY_VALUE_MINUTES = 24 * 60
export const MAX_SUBSCRIBE_REPEAT_EVERY_VALUE_HOURS = 24

/** Animation content width as a percent of export frame width. */
export const MIN_SUBSCRIBE_SIZE_PERCENT = 5
export const MAX_SUBSCRIBE_SIZE_PERCENT = 75

/** Max total PNG bytes for one subscribe animation upload (scales with frame count). */
export const SUBSCRIBE_ANIMATION_UPLOAD_BUDGET_BYTES = Math.ceil(72 * 1024 * 1024 * (SUBSCRIBE_ANIMATION_FPS / 30))

/** Heuristic: sparse transparent UI PNG ≈ this fraction of raw RGBA size. */
export const SUBSCRIBE_ANIMATION_PNG_SIZE_FACTOR = 0.35

export function subscribeDesignWidthForStyle(style: SubscribeAnimationStyle): number {
  switch (style) {
    case 'subscribe-only':
      return 168
    case 'subscribe-alerts':
      return 252
    case 'like-subscribe-alerts':
      return 336
    case 'channel-card':
    default:
      return 420
  }
}

export const DEFAULT_SUBSCRIBE_SIZE_PERCENT_BY_STYLE: Record<SubscribeAnimationStyle, number> = {
  'channel-card': 27,
  'subscribe-only': 12,
  'subscribe-alerts': 18,
  'like-subscribe-alerts': 25,
}

export function defaultSubscribeSizePercent(style: SubscribeAnimationStyle): number {
  return DEFAULT_SUBSCRIBE_SIZE_PERCENT_BY_STYLE[style]
}

/** @deprecated Use `defaultSubscribeSizePercent('channel-card')`. */
export const DEFAULT_SUBSCRIBE_SIZE_PERCENT = DEFAULT_SUBSCRIBE_SIZE_PERCENT_BY_STYLE['channel-card']

export interface SubscribeAnimationSettings {
  enabled: boolean
  channelName: string
  startSec: number
  durationSec: number
  /**
   * When not `off`, replay the clip every N minutes/hours during export
   * (starts at `startSec`, then `startSec + k * interval`).
   */
  repeatEveryUnit: SubscribeRepeatUnit
  /** Amount paired with `repeatEveryUnit` (ignored when unit is `off`). */
  repeatEveryValue: number
  position: SubscribeAnimationPosition
  /** Content width as a percent of export frame width (see `subscribeAnimationLayout`). */
  sizePercent: number
  /** Horizontal inset from output frame edges (export px). Adds the same value to overlay bottom padding for slide room. */
  edgeDistance: number
  style: SubscribeAnimationStyle
  /** Loop subscribe animation on the main preview canvas while editing. */
  previewOnCanvas: boolean
  /** Channel card only: visual theme. */
  channelCardTheme: SubscribeChannelCardTheme
  /** YouTube channel or video URL used to fetch channel name / avatar. */
  channelUrl: string
  /** Canonical YouTube channel ID (`UC…`) when resolved; used for dynamic animation cache paths. */
  channelId: string | null
  /** Avatar for the channel card: data URL from lookup or a YouTube CDN URL. */
  channelAvatarUrl: string | null
  /** e.g. "1.23M subscribers" from YouTube lookup. */
  channelSubscriberCount: string | null
}

export function defaultSubscribeAnimation(): SubscribeAnimationSettings {
  return {
    enabled: true,
    channelName: DEFAULT_SUBSCRIBE_CHANNEL_NAME,
    startSec: 20,
    durationSec: SUBSCRIBE_ANIMATION_DURATION_SEC,
    repeatEveryUnit: 'off',
    repeatEveryValue: DEFAULT_SUBSCRIBE_REPEAT_EVERY_VALUE,
    position: 'bottom-center',
    sizePercent: defaultSubscribeSizePercent('channel-card'),
    edgeDistance: DEFAULT_SUBSCRIBE_EDGE_DISTANCE,
    style: 'channel-card',
    previewOnCanvas: true,
    channelCardTheme: 'light',
    channelUrl: DEFAULT_SUBSCRIBE_CHANNEL_URL,
    channelId: null,
    channelAvatarUrl: null,
    channelSubscriberCount: null,
  }
}

export function isSubscribeRepeatUnit(value: unknown): value is SubscribeRepeatUnit {
  return typeof value === 'string' && (SUBSCRIBE_REPEAT_UNITS as readonly string[]).includes(value)
}

/** Interval between animation starts in seconds, or `null` when repeat is off. */
export function subscribeRepeatIntervalSec(settings: Pick<SubscribeAnimationSettings, 'repeatEveryUnit' | 'repeatEveryValue'>): number | null {
  if (settings.repeatEveryUnit === 'off') return null
  const value = Math.max(0, Number(settings.repeatEveryValue))
  if (!Number.isFinite(value) || value < MIN_SUBSCRIBE_REPEAT_EVERY_VALUE) return null
  return settings.repeatEveryUnit === 'hours' ? value * 3600 : value * 60
}

export interface SubscribeAnimationOccurrence {
  startSec: number
  durationSec: number
}

/**
 * Wall-clock placements for export. Plays once at `startSec`, or repeats every
 * interval while each full clip still fits inside `exportDurationSec`.
 */
export function subscribeAnimationOccurrences(
  settings: Pick<SubscribeAnimationSettings, 'enabled' | 'startSec' | 'durationSec' | 'repeatEveryUnit' | 'repeatEveryValue'>,
  exportDurationSec: number,
): SubscribeAnimationOccurrence[] {
  if (!settings.enabled) return []
  if (!Number.isFinite(exportDurationSec) || exportDurationSec <= 0) return []
  const durationSec = Math.max(0, settings.durationSec)
  if (durationSec <= 0) return []
  const firstStart = Math.max(0, settings.startSec)
  if (firstStart + durationSec > exportDurationSec + 0.01) return []

  const intervalSec = subscribeRepeatIntervalSec(settings)
  if (intervalSec == null) {
    return [{ startSec: firstStart, durationSec }]
  }

  const step = Math.max(intervalSec, durationSec)
  const occurrences: SubscribeAnimationOccurrence[] = []
  let startSec = firstStart
  while (startSec + durationSec <= exportDurationSec + 0.01) {
    occurrences.push({ startSec, durationSec })
    startSec += step
  }
  return occurrences
}

export function subscribeAnimationFrameCount(durationSec: number): number {
  return Math.round(Math.max(0, durationSec) * SUBSCRIBE_ANIMATION_FPS)
}

/** Max `animationFrames` PNG parts at default clip length (screensaver export multer). */
export const SUBSCRIBE_ANIMATION_EXPORT_FRAME_CAP = subscribeAnimationFrameCount(SUBSCRIBE_ANIMATION_DURATION_SEC)

/** Multer `files` cap: animation PNGs plus optional audio, composition, frame, and mask. */
export const SCREENSAVER_EXPORT_MAX_MULTIPART_FILES = SUBSCRIBE_ANIMATION_EXPORT_FRAME_CAP + 4

export function isSubscribeAnimationPosition(value: unknown): value is SubscribeAnimationPosition {
  return typeof value === 'string' && (SUBSCRIBE_ANIMATION_POSITIONS as readonly string[]).includes(value)
}

export function isSubscribeAnimationStyle(value: unknown): value is SubscribeAnimationStyle {
  return typeof value === 'string' && SUBSCRIBE_ANIMATION_STYLES.some((item) => item.id === value)
}

export function isSubscribeChannelCardTheme(value: unknown): value is SubscribeChannelCardTheme {
  return typeof value === 'string' && (SUBSCRIBE_CHANNEL_CARD_THEMES as readonly string[]).includes(value)
}

function sanitizeChannelAvatarUrl(value: string): string | null {
  const trimmed = value.trim()
  if (isYoutubeAvatarDataUrl(trimmed)) return null
  if (isAllowedYoutubeAvatarUrl(trimmed)) return trimmed.slice(0, 500)
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) return trimmed.slice(0, 500)
  return null
}

export function subscribeAnimationStyleLabel(style: SubscribeAnimationStyle): string {
  return SUBSCRIBE_ANIMATION_STYLES.find((item) => item.id === style)?.label ?? style
}

export function sanitizeSubscribeAnimation(raw: unknown): SubscribeAnimationSettings {
  const defaults = defaultSubscribeAnimation()
  if (!raw || typeof raw !== 'object') return defaults
  const data = raw as Partial<SubscribeAnimationSettings>
  const enabled = Boolean(data.enabled)
  const channelName =
    typeof data.channelName === 'string' && data.channelName.trim()
      ? data.channelName.trim().slice(0, 80)
      : defaults.channelName
  const startSec = Number.isFinite(Number(data.startSec)) ? Math.max(0, Number(data.startSec)) : defaults.startSec
  const durationSec = SUBSCRIBE_ANIMATION_DURATION_SEC
  const repeatEveryUnit = isSubscribeRepeatUnit(data.repeatEveryUnit) ? data.repeatEveryUnit : defaults.repeatEveryUnit
  const repeatRaw = Number(data.repeatEveryValue)
  const repeatMax =
    repeatEveryUnit === 'hours' ? MAX_SUBSCRIBE_REPEAT_EVERY_VALUE_HOURS : MAX_SUBSCRIBE_REPEAT_EVERY_VALUE_MINUTES
  const repeatEveryValue = Number.isFinite(repeatRaw)
    ? Math.max(MIN_SUBSCRIBE_REPEAT_EVERY_VALUE, Math.min(repeatMax, Math.round(repeatRaw)))
    : defaults.repeatEveryValue
  const position = isSubscribeAnimationPosition(data.position) ? data.position : defaults.position
  const style = isSubscribeAnimationStyle(data.style) ? data.style : defaults.style
  const sizePercent = resolveSubscribeSizePercent(data, style, defaultSubscribeSizePercent(style))
  const edgeRaw = Number(data.edgeDistance)
  const edgeDistance = Number.isFinite(edgeRaw)
    ? Math.max(MIN_SUBSCRIBE_EDGE_DISTANCE, Math.min(MAX_SUBSCRIBE_EDGE_DISTANCE, Math.round(edgeRaw)))
    : defaults.edgeDistance
  const previewOnCanvas = data.previewOnCanvas === false ? false : defaults.previewOnCanvas
  const channelCardTheme = isSubscribeChannelCardTheme(data.channelCardTheme) ? data.channelCardTheme : defaults.channelCardTheme
  const channelUrl =
    typeof data.channelUrl === 'string' && data.channelUrl.trim()
      ? data.channelUrl.trim().slice(0, 600)
      : defaults.channelUrl
  const channelId =
    data.channelId === null
      ? null
      : sanitizeYoutubeChannelId(data.channelId) ?? defaults.channelId
  const channelAvatarUrl =
    typeof data.channelAvatarUrl === 'string' && data.channelAvatarUrl.trim()
      ? sanitizeChannelAvatarUrl(data.channelAvatarUrl)
      : data.channelAvatarUrl === null
        ? null
        : defaults.channelAvatarUrl
  const channelSubscriberCount =
    typeof data.channelSubscriberCount === 'string' && data.channelSubscriberCount.trim()
      ? data.channelSubscriberCount.trim().slice(0, 48)
      : data.channelSubscriberCount === null
        ? null
        : defaults.channelSubscriberCount
  return {
    enabled,
    channelName,
    startSec,
    durationSec,
    repeatEveryUnit,
    repeatEveryValue,
    position,
    sizePercent,
    edgeDistance,
    style,
    previewOnCanvas,
    channelCardTheme,
    channelUrl,
    channelId,
    channelAvatarUrl,
    channelSubscriberCount,
  }
}

export interface SubscribeAnimationValidation {
  ok: boolean
  message: string | null
}

function clampSubscribeSizePercent(value: number): number {
  return Math.max(MIN_SUBSCRIBE_SIZE_PERCENT, Math.min(MAX_SUBSCRIBE_SIZE_PERCENT, Math.round(value * 10) / 10))
}

/** Maps persisted `sizePercent` or legacy design `scale` (0.5–1.5) to output-relative percent. */
function resolveSubscribeSizePercent(
  data: Partial<SubscribeAnimationSettings> & { scale?: number },
  style: SubscribeAnimationStyle,
  fallback: number,
): number {
  const percentRaw = Number(data.sizePercent)
  if (Number.isFinite(percentRaw)) return clampSubscribeSizePercent(percentRaw)
  const scaleRaw = Number(data.scale)
  if (Number.isFinite(scaleRaw) && scaleRaw >= MIN_SUBSCRIBE_SIZE_PERCENT && scaleRaw <= MAX_SUBSCRIBE_SIZE_PERCENT) {
    return clampSubscribeSizePercent(scaleRaw)
  }
  if (Number.isFinite(scaleRaw) && scaleRaw >= 0.5 && scaleRaw <= 1.5) {
    const designWidth = subscribeDesignWidthForStyle(style)
    const legacyContentWidth = designWidth * scaleRaw
    return clampSubscribeSizePercent((legacyContentWidth / DEFAULT_SCREENSAVER_OUTPUT.width) * 100)
  }
  return fallback
}

export function validateSubscribeAnimation(
  settings: SubscribeAnimationSettings,
  exportDurationSec: number,
  options?: { staticImage?: boolean },
): SubscribeAnimationValidation {
  if (!settings.enabled) return { ok: true, message: null }
  if (options?.staticImage === false) {
    return { ok: false, message: 'Subscribe animation is only supported for static image exports.' }
  }
  if (!Number.isFinite(exportDurationSec) || exportDurationSec <= 0) {
    return { ok: false, message: 'Export duration is invalid.' }
  }
  if (settings.startSec < 0) {
    return { ok: false, message: 'Animation start time must be zero or greater.' }
  }
  if (settings.repeatEveryUnit !== 'off') {
    const intervalSec = subscribeRepeatIntervalSec(settings)
    if (intervalSec == null) {
      return { ok: false, message: 'Repeat interval must be at least 1 minute or 1 hour.' }
    }
    if (intervalSec + 0.01 < settings.durationSec) {
      return { ok: false, message: 'Repeat interval must be at least as long as the animation.' }
    }
  }
  const occurrences = subscribeAnimationOccurrences(settings, exportDurationSec)
  if (occurrences.length < 1) {
    return { ok: false, message: 'The animation must fit inside the export duration.' }
  }
  if (subscribeAnimationFrameCount(settings.durationSec) < 1) {
    return { ok: false, message: 'Animation duration is too short.' }
  }
  return { ok: true, message: null }
}
