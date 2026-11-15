/**
 * Source-Quality-First audio processing planner.
 * Pure decision logic shared by Audio Looper and Screensaver.
 */

import {
  AUDIO_LOOPER_BITRATES,
  type AudioLooperBitrate,
  type AudioLooperFormat,
  type AudioLooperLoopMode,
  volumeToFfmpeg,
} from './audioLooper'
import { resolveOutputChannels } from './audioLooperChannels'

export const AUDIO_PROCESSING_STRATEGIES = [
  'STREAM_COPY',
  'LOSSLESS_PROCESSING',
  'HIGH_QUALITY_REENCODE',
] as const
export type AudioProcessingStrategy = (typeof AUDIO_PROCESSING_STRATEGIES)[number]

export const AUDIO_DESTINATIONS = [
  'looper-mp3',
  'looper-wav',
  'looper-flac',
  'mp4-aac',
  'mp4-copy',
] as const
export type AudioDestination = (typeof AUDIO_DESTINATIONS)[number]

export type AudioBitratePolicy = 'preserve' | 'max-source' | 'fallback' | 'none'

export type AudioBitrateMode = 'cbr' | 'vbr' | 'unknown'

/** Probed properties for one source audio stream (never invent missing fields). */
export interface AudioSourceProbe {
  codec: string | null
  codecProfile?: string | null
  formatName?: string | null
  /** Preferred reliable bitrate in bits/sec (0 when unknown). */
  bitrate: number
  streamBitrate?: number
  containerBitrate?: number
  bitrateMode?: AudioBitrateMode
  sampleRate: number
  channels: number
  channelLayout?: string | null
  sampleFmt?: string | null
  bitsPerSample?: number
  duration: number
  /** Trim window relative to the source. Untouched when start≈0 and end≈duration. */
  trimStart?: number
  trimEnd?: number
}

export interface AudioProcessingOperations {
  loopMode?: AudioLooperLoopMode
  volumePercent?: number
  fadeInSeconds?: number
  fadeOutSeconds?: number
  /** Seamless single-track wrap crossfade. */
  seamlessCrossfade?: boolean
  crossfadeSeconds?: number
  playlistCrossfade?: boolean
  playlistCrossfadeSeconds?: number
  normalizeLoudness?: boolean
  /** User-selected MP3 ladder bitrate (looper export). */
  userMp3Bitrate?: AudioLooperBitrate
  /** Screensaver / mux volume (1 = unity). */
  muxVolume?: number
  muxFadeIn?: number
  muxFadeOut?: number
}

export interface PlanAudioProcessingInput {
  sources: AudioSourceProbe[]
  destination: AudioDestination
  operations?: AudioProcessingOperations
  /** Looper export format when destination is looper-*. */
  looperFormat?: AudioLooperFormat
}

export interface AudioProcessingPlan {
  strategy: AudioProcessingStrategy
  reason: string
  expectedCodec: string
  bitratePolicy: AudioBitratePolicy
  /** Target bitrate in kbps when lossy encode is planned; null for copy/lossless. */
  targetBitrateKbps: number | null
  expectedSampleRate: number
  expectedChannels: number
  reencodeRequired: boolean
  /** Maximum lossy encodes allowed for this plan (0 or 1). */
  lossyEncodeBudget: number
  userLabel: 'Original Stream Preserved' | 'Lossless Processing' | 'High-Quality Re-encoding'
  limitations: string[]
}

const MP3_LADDER = [...AUDIO_LOOPER_BITRATES] as number[]
const AAC_MAX_STEREO_KBPS = 512
const DEFAULT_HQ_MP3_KBPS = 320
const DEFAULT_HQ_AAC_KBPS = 320

export function processingStrategyLabel(strategy: AudioProcessingStrategy): AudioProcessingPlan['userLabel'] {
  if (strategy === 'STREAM_COPY') return 'Original Stream Preserved'
  if (strategy === 'LOSSLESS_PROCESSING') return 'Lossless Processing'
  return 'High-Quality Re-encoding'
}

/** True when volume/fades are effectively identity (Looper and Screensaver gains both). */
export function isPlainGain(operations?: AudioProcessingOperations): boolean {
  if (!operations) return true
  // Both gains must be unity when present — muxVolume must not hide volumePercent.
  if (operations.muxVolume != null && Math.abs(operations.muxVolume - 1) > 0.02) return false
  if (operations.volumePercent != null && Math.abs(volumeToFfmpeg(operations.volumePercent) - 1) > 0.02) {
    return false
  }
  const fadeIn = Math.max(operations.muxFadeIn ?? 0, operations.fadeInSeconds ?? 0)
  const fadeOut = Math.max(operations.muxFadeOut ?? 0, operations.fadeOutSeconds ?? 0)
  if (fadeIn > 0.05 || fadeOut > 0.05) return false
  return true
}

export function sourceNeedsSampleAccurateTrim(source: AudioSourceProbe): boolean {
  const duration = source.duration
  const start = source.trimStart ?? 0
  const end = source.trimEnd ?? duration
  if (!(duration > 0)) return false
  return start > 0.03 || end < duration - 0.05
}

export function snapMp3BitrateKbps(bitrateBps: number): AudioLooperBitrate {
  if (!(bitrateBps > 0)) return DEFAULT_HQ_MP3_KBPS as AudioLooperBitrate
  const kbps = Math.round(bitrateBps / 1000)
  let best: AudioLooperBitrate = 320
  let bestDist = Infinity
  for (const step of MP3_LADDER) {
    const dist = Math.abs(step - kbps)
    if (dist < bestDist || (dist === bestDist && step > best)) {
      best = step as AudioLooperBitrate
      bestDist = dist
    }
  }
  // Prefer not reducing below source: if between ladder rungs, pick the higher one when close.
  if (kbps > best && best < 320) {
    const higher = MP3_LADDER.find((step) => step >= kbps)
    if (higher) return higher as AudioLooperBitrate
  }
  return best
}

export function snapAacBitrateKbps(bitrateBps: number, channels: number): number {
  if (!(bitrateBps > 0)) return DEFAULT_HQ_AAC_KBPS
  const kbps = Math.round(bitrateBps / 1000)
  const cap = channels <= 1 ? 256 : AAC_MAX_STEREO_KBPS
  const ladder = [96, 128, 160, 192, 224, 256, 320, 384, 448, 512].filter((v) => v <= cap)
  let best = ladder[ladder.length - 1] ?? DEFAULT_HQ_AAC_KBPS
  let bestDist = Infinity
  for (const step of ladder) {
    const dist = Math.abs(step - kbps)
    if (dist < bestDist || (dist === bestDist && step > best)) {
      best = step
      bestDist = dist
    }
  }
  if (kbps > best) {
    const higher = ladder.find((step) => step >= kbps)
    if (higher) return higher
  }
  return Math.min(cap, Math.max(best, kbps > 0 ? Math.min(cap, kbps) : best))
}

export function maxReliableSourceBitrateBps(sources: AudioSourceProbe[]): number {
  let max = 0
  for (const source of sources) {
    const stream = source.streamBitrate && source.streamBitrate > 0 ? source.streamBitrate : 0
    const preferred = source.bitrate > 0 ? source.bitrate : stream
    if (preferred > max) max = preferred
  }
  return max
}

export function resolveCommonSampleRate(sources: AudioSourceProbe[]): { rate: number; reason: string } {
  const rates = sources.map((s) => Math.round(s.sampleRate)).filter((r) => r > 0)
  if (rates.length === 0) return { rate: 48000, reason: 'No sample rate metadata; using 48000 Hz fallback.' }
  const unique = [...new Set(rates)]
  if (unique.length === 1) {
    return { rate: unique[0]!, reason: 'Preserving shared source sample rate.' }
  }
  const highest = Math.max(...unique)
  return { rate: highest, reason: `Mixed sample rates; normalizing to highest source rate ${highest} Hz.` }
}

function normalizeCodec(codec: string | null | undefined): string {
  return (codec ?? '').toLowerCase().trim()
}

function isMp3Codec(codec: string): boolean {
  return codec === 'mp3' || codec === 'mp3float'
}

function isAacCodec(codec: string): boolean {
  return codec === 'aac' || codec === 'aac_latm'
}

function isLosslessCodec(codec: string): boolean {
  return (
    codec === 'flac' ||
    codec === 'pcm_s16le' ||
    codec === 'pcm_s24le' ||
    codec === 'pcm_s32le' ||
    codec === 'pcm_f32le' ||
    codec === 'pcm_s16be' ||
    codec.startsWith('pcm_')
  )
}

function streamsCompatibleForCopy(sources: AudioSourceProbe[]): { ok: boolean; reason: string } {
  if (sources.length === 0) return { ok: false, reason: 'No audio sources.' }
  const first = sources[0]!
  const codec = normalizeCodec(first.codec)
  if (!codec) return { ok: false, reason: 'Missing source codec.' }
  if (!(first.sampleRate > 0) || !(first.channels > 0)) {
    return { ok: false, reason: 'Incomplete source probe metadata (sample rate/channels).' }
  }
  const rate = Math.round(first.sampleRate)
  const channels = Math.round(first.channels)
  const layout = (first.channelLayout ?? '').toLowerCase().trim()
  const profile = (first.codecProfile ?? '').toLowerCase().trim()
  for (let i = 1; i < sources.length; i += 1) {
    const other = sources[i]!
    if (normalizeCodec(other.codec) !== codec) {
      return { ok: false, reason: 'Sources use different codecs.' }
    }
    if (Math.round(other.sampleRate) !== rate) {
      return { ok: false, reason: 'Sources use different sample rates.' }
    }
    if (Math.round(other.channels) !== channels) {
      return { ok: false, reason: 'Sources use different channel layouts.' }
    }
    const otherLayout = (other.channelLayout ?? '').toLowerCase().trim()
    if (layout && otherLayout && layout !== otherLayout) {
      return { ok: false, reason: 'Sources use different channel layout labels.' }
    }
    const otherProfile = (other.codecProfile ?? '').toLowerCase().trim()
    // Different bitrates remain OK; reject only when both profiles are known and disagree.
    if (profile && otherProfile && profile !== otherProfile) {
      return { ok: false, reason: 'Sources use different codec profiles.' }
    }
  }
  return { ok: true, reason: 'Sources share codec, sample rate, and channels.' }
}

function destinationAcceptsCopy(
  destination: AudioDestination,
  codec: string,
): { ok: boolean; expectedCodec: string; reason: string } {
  if (destination === 'looper-mp3') {
    if (isMp3Codec(codec)) return { ok: true, expectedCodec: 'mp3', reason: 'MP3 stream copy into MP3 container.' }
    return { ok: false, expectedCodec: 'mp3', reason: 'Destination MP3 requires same-codec source for copy.' }
  }
  if (destination === 'looper-wav') {
    if (codec === 'pcm_s16le') return { ok: true, expectedCodec: 'pcm_s16le', reason: 'PCM stream copy into WAV.' }
    return { ok: false, expectedCodec: 'pcm_s16le', reason: 'WAV export needs decode for non-pcm_s16le sources.' }
  }
  if (destination === 'looper-flac') {
    if (codec === 'flac') return { ok: true, expectedCodec: 'flac', reason: 'FLAC stream copy.' }
    return { ok: false, expectedCodec: 'flac', reason: 'FLAC export needs encode/decode for non-FLAC sources.' }
  }
  if (destination === 'mp4-copy' || destination === 'mp4-aac') {
    if (isAacCodec(codec)) return { ok: true, expectedCodec: 'aac', reason: 'AAC stream copy into MP4.' }
    if (isMp3Codec(codec)) return { ok: true, expectedCodec: 'mp3', reason: 'MP3 stream copy into MP4.' }
    return { ok: false, expectedCodec: 'aac', reason: 'MP4 mux requires AAC or MP3 for stream copy.' }
  }
  return { ok: false, expectedCodec: 'aac', reason: 'Unsupported destination.' }
}

function needsDecodedTransforms(input: PlanAudioProcessingInput, outputChannels: number): {
  needed: boolean
  reason: string
} {
  const ops = input.operations ?? {}
  if (ops.seamlessCrossfade) return { needed: true, reason: 'Seamless loop requires decoded equal-power crossfade.' }
  if (ops.playlistCrossfade && (ops.playlistCrossfadeSeconds ?? 0) > 0.01) {
    return { needed: true, reason: 'Playlist crossfade requires decoded audio.' }
  }
  if (ops.normalizeLoudness) return { needed: true, reason: 'Loudness matching requires decoded audio.' }
  if (!isPlainGain(ops)) return { needed: true, reason: 'Volume or fades require decoded audio.' }

  for (const source of input.sources) {
    if (sourceNeedsSampleAccurateTrim(source)) {
      return { needed: true, reason: 'Sample-accurate trim requires decoded audio.' }
    }
    if (source.channels > 0 && Math.round(source.channels) !== outputChannels) {
      return { needed: true, reason: 'Channel layout normalization requires decoded audio.' }
    }
  }

  const rates = input.sources.map((s) => Math.round(s.sampleRate)).filter((r) => r > 0)
  if (rates.length >= 2 && new Set(rates).size > 1) {
    return { needed: true, reason: 'Mixed sample rates require resampling.' }
  }

  return { needed: false, reason: 'No decoded transforms requested.' }
}

function targetLossyBitrateKbps(
  destination: AudioDestination,
  sources: AudioSourceProbe[],
  ops: AudioProcessingOperations | undefined,
  channels: number,
): { kbps: number; policy: AudioBitratePolicy } {
  const maxBps = maxReliableSourceBitrateBps(sources)
  if (destination === 'looper-mp3') {
    const user = ops?.userMp3Bitrate ?? 192
    if (maxBps > 0) {
      const snapped = snapMp3BitrateKbps(maxBps)
      return { kbps: Math.max(user, snapped), policy: 'max-source' }
    }
    return { kbps: Math.max(user, DEFAULT_HQ_MP3_KBPS), policy: 'fallback' }
  }
  if (destination === 'mp4-aac' || destination === 'mp4-copy') {
    if (maxBps > 0) {
      return { kbps: snapAacBitrateKbps(maxBps, channels), policy: sources.length > 1 ? 'max-source' : 'preserve' }
    }
    return { kbps: DEFAULT_HQ_AAC_KBPS, policy: 'fallback' }
  }
  return { kbps: 0, policy: 'none' }
}

/**
 * Select STREAM_COPY, LOSSLESS_PROCESSING, or HIGH_QUALITY_REENCODE.
 */
export function planAudioProcessing(input: PlanAudioProcessingInput): AudioProcessingPlan {
  const sources = input.sources
  const limitations: string[] = []
  if (sources.length === 0) {
    return {
      strategy: 'HIGH_QUALITY_REENCODE',
      reason: 'No audio sources provided.',
      expectedCodec: input.destination.startsWith('looper') ? 'mp3' : 'aac',
      bitratePolicy: 'fallback',
      targetBitrateKbps: DEFAULT_HQ_AAC_KBPS,
      expectedSampleRate: 48000,
      expectedChannels: 2,
      reencodeRequired: true,
      lossyEncodeBudget: 1,
      userLabel: 'High-Quality Re-encoding',
      limitations: ['Missing sources'],
    }
  }

  const format: AudioLooperFormat =
    input.looperFormat ??
    (input.destination === 'looper-wav' ? 'wav' : input.destination === 'looper-flac' ? 'flac' : 'mp3')
  const expectedChannels = resolveOutputChannels(
    sources.map((s) => s.channels),
    format,
  )
  const { rate: expectedSampleRate, reason: rateReason } = resolveCommonSampleRate(sources)
  if (rateReason.includes('Mixed')) limitations.push(rateReason)

  const ops = input.operations ?? {}
  const transform = needsDecodedTransforms(input, expectedChannels)

  // Caller sets seamlessCrossfade when the Seamless engine will actually run.
  if (ops.seamlessCrossfade && sources.length === 1) {
    const lossy = format === 'mp3' || input.destination === 'mp4-aac'
    const bit = targetLossyBitrateKbps(input.destination === 'mp4-copy' ? 'mp4-aac' : input.destination, sources, ops, expectedChannels)
    return {
      strategy: lossy && format !== 'wav' && format !== 'flac' ? 'HIGH_QUALITY_REENCODE' : 'LOSSLESS_PROCESSING',
      reason: 'Seamless loop requires decoded equal-power crossfade.',
      expectedCodec:
        input.destination === 'looper-wav'
          ? 'pcm_s16le'
          : input.destination === 'looper-flac'
            ? 'flac'
            : input.destination.startsWith('mp4')
              ? 'aac'
              : 'mp3',
      bitratePolicy: lossy ? bit.policy : 'none',
      targetBitrateKbps: lossy ? bit.kbps : null,
      expectedSampleRate,
      expectedChannels,
      reencodeRequired: lossy || format === 'flac',
      lossyEncodeBudget: lossy ? 1 : 0,
      userLabel: lossy ? 'High-Quality Re-encoding' : 'Lossless Processing',
      limitations,
    }
  }

  if (transform.needed) {
    const wantLosslessOut =
      input.destination === 'looper-wav' ||
      input.destination === 'looper-flac' ||
      (format === 'wav' || format === 'flac')
    const lossyFinal =
      input.destination === 'looper-mp3' ||
      input.destination === 'mp4-aac' ||
      (input.destination === 'mp4-copy' && true)
    // When transforms are required for MP4, final codec is AAC (one encode).
    if (input.destination.startsWith('mp4')) {
      const bit = targetLossyBitrateKbps('mp4-aac', sources, ops, expectedChannels)
      return {
        strategy: 'HIGH_QUALITY_REENCODE',
        reason: transform.reason,
        expectedCodec: 'aac',
        bitratePolicy: bit.policy,
        targetBitrateKbps: bit.kbps,
        expectedSampleRate,
        expectedChannels: Math.min(expectedChannels, 2) || 2,
        reencodeRequired: true,
        lossyEncodeBudget: 1,
        userLabel: 'High-Quality Re-encoding',
        limitations,
      }
    }
    if (wantLosslessOut && !lossyFinal) {
      return {
        strategy: 'LOSSLESS_PROCESSING',
        reason: transform.reason,
        expectedCodec: format === 'flac' ? 'flac' : 'pcm_s16le',
        bitratePolicy: 'none',
        targetBitrateKbps: null,
        expectedSampleRate,
        expectedChannels,
        reencodeRequired: format === 'flac',
        lossyEncodeBudget: 0,
        userLabel: 'Lossless Processing',
        limitations,
      }
    }
    const bit = targetLossyBitrateKbps(input.destination, sources, ops, expectedChannels)
    return {
      strategy: format === 'wav' || format === 'flac' ? 'LOSSLESS_PROCESSING' : 'HIGH_QUALITY_REENCODE',
      reason: transform.reason,
      expectedCodec: format === 'wav' ? 'pcm_s16le' : format === 'flac' ? 'flac' : 'mp3',
      bitratePolicy: format === 'mp3' ? bit.policy : 'none',
      targetBitrateKbps: format === 'mp3' ? bit.kbps : null,
      expectedSampleRate,
      expectedChannels,
      reencodeRequired: format !== 'wav',
      lossyEncodeBudget: format === 'mp3' ? 1 : 0,
      userLabel: format === 'mp3' ? 'High-Quality Re-encoding' : 'Lossless Processing',
      limitations,
    }
  }

  const compat = streamsCompatibleForCopy(sources)
  const codec = normalizeCodec(sources[0]!.codec)
  const dest = destinationAcceptsCopy(input.destination, codec)

  if (compat.ok && dest.ok && isPlainGain(ops)) {
    // Destination mp4-aac with compatible stream still prefers copy when plain.
    if (input.destination === 'mp4-aac' && (isAacCodec(codec) || isMp3Codec(codec))) {
      return {
        strategy: 'STREAM_COPY',
        reason: `${dest.reason} ${compat.reason}`,
        expectedCodec: dest.expectedCodec,
        bitratePolicy: 'preserve',
        targetBitrateKbps: null,
        expectedSampleRate: Math.round(sources[0]!.sampleRate) || expectedSampleRate,
        expectedChannels: Math.round(sources[0]!.channels) || expectedChannels,
        reencodeRequired: false,
        lossyEncodeBudget: 0,
        userLabel: 'Original Stream Preserved',
        limitations,
      }
    }
    if (input.destination !== 'mp4-aac' || dest.ok) {
      return {
        strategy: 'STREAM_COPY',
        reason: `${dest.reason} ${compat.reason}`,
        expectedCodec: dest.expectedCodec,
        bitratePolicy: 'preserve',
        targetBitrateKbps: null,
        expectedSampleRate: Math.round(sources[0]!.sampleRate) || expectedSampleRate,
        expectedChannels: Math.round(sources[0]!.channels) || expectedChannels,
        reencodeRequired: false,
        lossyEncodeBudget: 0,
        userLabel: 'Original Stream Preserved',
        limitations,
      }
    }
  }

  // Compatible streams but destination needs a different codec (e.g. FLAC → MP3, or WAV → MP4).
  if (input.destination.startsWith('mp4')) {
    const bit = targetLossyBitrateKbps('mp4-aac', sources, ops, expectedChannels)
    return {
      strategy: 'HIGH_QUALITY_REENCODE',
      reason: dest.ok ? 'Destination requires AAC encoding.' : dest.reason,
      expectedCodec: 'aac',
      bitratePolicy: bit.policy,
      targetBitrateKbps: bit.kbps,
      expectedSampleRate,
      expectedChannels: Math.min(expectedChannels, 2) || 2,
      reencodeRequired: true,
      lossyEncodeBudget: 1,
      userLabel: 'High-Quality Re-encoding',
      limitations: [...limitations, compat.ok ? '' : compat.reason].filter(Boolean),
    }
  }

  if (input.destination === 'looper-wav') {
    return {
      strategy: 'LOSSLESS_PROCESSING',
      reason: dest.reason,
      expectedCodec: 'pcm_s16le',
      bitratePolicy: 'none',
      targetBitrateKbps: null,
      expectedSampleRate,
      expectedChannels,
      reencodeRequired: false,
      lossyEncodeBudget: 0,
      userLabel: 'Lossless Processing',
      limitations,
    }
  }

  if (input.destination === 'looper-flac') {
    if (isLosslessCodec(codec) && codec !== 'flac') {
      return {
        strategy: 'LOSSLESS_PROCESSING',
        reason: 'Converting lossless source to FLAC without additional lossy compression.',
        expectedCodec: 'flac',
        bitratePolicy: 'none',
        targetBitrateKbps: null,
        expectedSampleRate,
        expectedChannels,
        reencodeRequired: true,
        lossyEncodeBudget: 0,
        userLabel: 'Lossless Processing',
        limitations,
      }
    }
  }

  const bit = targetLossyBitrateKbps(input.destination, sources, ops, expectedChannels)
  return {
    strategy: 'HIGH_QUALITY_REENCODE',
    reason: !compat.ok ? compat.reason : dest.reason,
    expectedCodec: 'mp3',
    bitratePolicy: bit.policy,
    targetBitrateKbps: bit.kbps,
    expectedSampleRate,
    expectedChannels,
    reencodeRequired: true,
    lossyEncodeBudget: 1,
    userLabel: 'High-Quality Re-encoding',
    limitations,
  }
}

/** Map looper export format to planner destination. */
export function looperDestination(format: AudioLooperFormat): AudioDestination {
  if (format === 'wav') return 'looper-wav'
  if (format === 'flac') return 'looper-flac'
  return 'looper-mp3'
}
