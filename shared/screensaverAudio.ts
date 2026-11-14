/** Screensaver background-audio limits and availability (shared client/server contract). */

export const SCREENSAVER_AUDIO_MAX_BYTES = 1024 * 1024 * 1024 // 1 GiB

/** Ranking / Image Motion music stay on the legacy 40 MiB cap. */
export const DEFAULT_BACKGROUND_AUDIO_MAX_BYTES = 40 * 1024 * 1024

export const SCREENSAVER_AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] as const

export type ScreensaverAudioExtension = (typeof SCREENSAVER_AUDIO_EXTENSIONS)[number]

export const SCREENSAVER_AUDIO_ACCEPT =
  'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac'

export const SCREENSAVER_AUDIO_FORMATS_LABEL = 'MP3, WAV, FLAC, M4A, AAC, OGG'

/** Explicit client-side availability for uploaded / transferred background audio. */
export type ScreensaverAudioAvailability =
  | 'idle'
  | 'uploading'
  | 'validating'
  | 'available'
  | 'missing'
  | 'error'

export function isScreensaverAudioExtension(value: string): value is ScreensaverAudioExtension {
  return (SCREENSAVER_AUDIO_EXTENSIONS as readonly string[]).includes(value.toLowerCase())
}

export function formatScreensaverAudioLimitLabel(maxBytes = SCREENSAVER_AUDIO_MAX_BYTES): string {
  const gib = maxBytes / (1024 * 1024 * 1024)
  if (Number.isInteger(gib) || Math.abs(gib - Math.round(gib)) < 1e-9) {
    return `${Math.round(gib)} GiB`
  }
  const mib = maxBytes / (1024 * 1024)
  return `${Math.round(mib)} MiB`
}

export function validateScreensaverAudioFileMeta(input: {
  name: string
  type?: string | null
  size: number
  maxBytes?: number
}): string | null {
  const maxBytes = input.maxBytes ?? SCREENSAVER_AUDIO_MAX_BYTES
  const extension = input.name.split('.').pop()?.toLowerCase() ?? ''
  const extensionOk = isScreensaverAudioExtension(extension)
  const typeOk = Boolean(input.type && /^audio\//.test(input.type))
  if (!extensionOk && !typeOk) {
    return `Background audio must be an ${SCREENSAVER_AUDIO_FORMATS_LABEL} file.`
  }
  if (input.size > maxBytes) {
    return `Background audio must be ${formatScreensaverAudioLimitLabel(maxBytes)} or smaller.`
  }
  return null
}
