/**
 * Channel layout policy for Audio Looper processing and UI labels.
 *
 * - All mono → mono
 * - All stereo, or mixed mono+stereo → stereo (mono upmixed)
 * - Matching multi-channel (>2) → preserved for WAV/FLAC; MP3 downmixes to stereo
 * - Mixed multi-channel layouts → controlled downmix to stereo
 * - Unknown / missing counts are ignored; if none are known, default to stereo
 */

import type { AudioLooperFormat } from './audioLooper'

export type AudioChannelLayoutName = 'mono' | 'stereo' | `${number}c`

/** Resolve the output channel count from probed source tracks and the export format. */
export function resolveOutputChannels(
  sourceChannels: Array<number | null | undefined>,
  format: AudioLooperFormat = 'mp3',
): number {
  const known = sourceChannels
    .map((value) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0))
    .filter((value) => value > 0)
  if (known.length === 0) return 2

  const max = Math.max(...known)
  const min = Math.min(...known)

  if (max <= 1) return 1
  if (max === 2) return 2

  // Multi-channel: preserve only when every track matches and the codec can carry it.
  if (min === max && (format === 'wav' || format === 'flac')) return max
  return 2
}

/** FFmpeg `channel_layouts=` token for aformat / pan normalization. */
export function channelLayoutToken(channels: number): AudioChannelLayoutName {
  if (channels <= 1) return 'mono'
  if (channels === 2) return 'stereo'
  return `${Math.max(3, Math.round(channels))}c`
}

/**
 * Filter fragment that normalizes sample format, rate, and channel layout.
 * Mono→stereo uses FFmpeg's stereo layout (identical L/R from the mono signal).
 * Multi-channel→stereo uses FFmpeg's default downmix inside aformat.
 */
export function pcmNormalizeFilter(sampleRate: number, channels: number): string {
  const rate = sampleRate > 0 ? Math.round(sampleRate) : 48000
  const layout = channelLayoutToken(channels)
  return `aformat=sample_fmts=s16:sample_rates=${rate}:channel_layouts=${layout}`
}

/** User-facing channel label. Never falls back to file format. */
export function audioChannelLabel(
  channels: number | null | undefined,
  channelLayout?: string | null,
): string {
  if (channels == null || !Number.isFinite(channels) || channels < 1) return ''
  const count = Math.round(channels)
  if (count === 1) return 'Mono'
  if (count === 2) return 'Stereo'
  const layout = typeof channelLayout === 'string' ? channelLayout.trim() : ''
  // Prefer a verified layout name (e.g. 5.1, quad). Skip empty / unknown only.
  if (layout && layout.toLowerCase() !== 'unknown') return layout
  return `${count} ch`
}
