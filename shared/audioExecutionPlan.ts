/**
 * Execution planning for audio exports (how to run FFmpeg), separate from
 * quality strategies in audioProcessingPlan.ts (STREAM_COPY / LOSSLESS / HQ re-encode).
 *
 * Pure + deterministic. Does not invent probe fields.
 */

import {
  isPlainGain,
  planAudioProcessing,
  sourceNeedsSampleAccurateTrim,
  type AudioDestination,
  type AudioProcessingOperations,
  type AudioProcessingPlan,
  type AudioSourceProbe,
  type PlanAudioProcessingInput,
} from './audioProcessingPlan'

export const AUDIO_EXECUTION_STRATEGIES = [
  'DIRECT_STREAM_COPY',
  'STANDARD_PROCESSING',
  'ENCODE_ONCE_LOOP_COPY',
] as const
export type AudioExecutionStrategy = (typeof AUDIO_EXECUTION_STRATEGIES)[number]

/** Pipeline version baked into encoded-period cache keys. Bump when encode settings change. */
export const AUDIO_PERIOD_PIPELINE_VERSION = 'encode-once-v1'

export interface PlanAudioExecutionInput {
  sources: AudioSourceProbe[]
  destination: AudioDestination
  operations?: AudioProcessingOperations
  /** Quality plan from planAudioProcessing (optional; computed when omitted). */
  qualityPlan?: AudioProcessingPlan
  /** Final output / mux duration in seconds. */
  targetDurationSeconds: number
  /**
   * One complete loop period in seconds (playlist timeline or single-track trimmed length).
   * Must be > 0 when known.
   */
  periodDurationSeconds: number
  /**
   * When true, global fades/volume belong on the full mux timeline (Screensaver),
   * not baked into every repeated period.
   */
  globalGainOnFullTimeline?: boolean
  /** Minimum expected repetitions before encode-once is worth considering. */
  minRepetitionsForEncodeOnce?: number
  /** Feature flag / safe rollback. */
  encodeOnceEnabled?: boolean
}

export interface AudioExecutionPlan {
  strategy: AudioExecutionStrategy
  reason: string
  qualityPlan: AudioProcessingPlan
  periodDurationSeconds: number
  targetDurationSeconds: number
  expectedRepetitions: number
  /** Destination-compatible lossy codec for the encoded period (aac or mp3). */
  periodCodec: 'aac' | 'mp3' | null
  targetBitrateKbps: number | null
  expectedSampleRate: number
  expectedChannels: number
  /** Why encode-once was rejected (empty when eligible or not attempted). */
  ineligibilityReasons: string[]
  /** Encode-once is proposed; runtime must still verify AAC/packet continuity. */
  requiresBoundaryVerification: boolean
}

const DEFAULT_MIN_REPETITIONS = 2

function normalizeCodec(codec: string | null | undefined): string {
  return (codec ?? '').toLowerCase().trim()
}

function periodSecondsFromSources(sources: AudioSourceProbe[]): number {
  if (sources.length === 0) return 0
  let total = 0
  for (const source of sources) {
    const start = source.trimStart ?? 0
    const end = source.trimEnd ?? source.duration
    const len = Math.max(0, end - start)
    total += len
  }
  return total
}

/**
 * Transformations that must apply once on the full output timeline
 * (never once-per-period).
 */
export function hasFullTimelineTransforms(
  operations: AudioProcessingOperations | undefined,
  opts?: { globalGainOnFullTimeline?: boolean },
): { blocked: boolean; reasons: string[] } {
  const ops = operations ?? {}
  const reasons: string[] = []
  if (ops.seamlessCrossfade) reasons.push('Seamless loop crossfade requires continuous encode across wrap.')
  if (ops.playlistCrossfade && (ops.playlistCrossfadeSeconds ?? 0) > 0.01) {
    // Playlist crossfade between tracks is per-period; wrap crossfade would be full-timeline.
    // Treat enabled playlist crossfade as needing STANDARD until wrap semantics are verified.
    reasons.push('Playlist crossfade needs STANDARD_PROCESSING until wrap semantics are verified for encode-once.')
  }
  if (ops.normalizeLoudness) {
    reasons.push('Loudness matching across a playlist is not verified for encode-once periods.')
  }

  const global = opts?.globalGainOnFullTimeline !== false
  if (global) {
    const fadeIn = Math.max(ops.muxFadeIn ?? 0, 0)
    const fadeOut = Math.max(ops.muxFadeOut ?? 0, 0)
    // Looper fades baked into a period that is then looped would repeat — only mux fades are full-timeline.
    if (fadeIn > 0.05) reasons.push('Global fade-in must apply once on the full timeline.')
    if (fadeOut > 0.05) reasons.push('Global fade-out must apply once on the full timeline (never per period).')
  }

  return { blocked: reasons.length > 0, reasons }
}

/**
 * Per-period transforms that remain eligible for encode-once after quality planning
 * already decided decode/re-encode is required.
 */
export function perPeriodTransformsOk(input: PlanAudioExecutionInput): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  const ops = input.operations ?? {}

  // Sample-accurate trims are applied while building the period — OK.
  for (const source of input.sources) {
    if (sourceNeedsSampleAccurateTrim(source)) {
      // eligible
    }
  }

  // Constant gain baked into the period is OK when mux gain is unity (or applied only at mux once).
  if (!isPlainGain({ volumePercent: ops.volumePercent, fadeInSeconds: 0, fadeOutSeconds: 0 })) {
    // Non-unity looper volume is fine if baked into the single period once.
  }

  if (ops.seamlessCrossfade) {
    reasons.push('Seamless crossfade is not eligible for encode-once loop-copy.')
  }

  return { ok: reasons.length === 0, reasons }
}

/**
 * Select DIRECT_STREAM_COPY | STANDARD_PROCESSING | ENCODE_ONCE_LOOP_COPY.
 * Quality semantics stay in planAudioProcessing; this only chooses execution shape.
 */
export function planAudioExecution(input: PlanAudioExecutionInput): AudioExecutionPlan {
  const qualityInput: PlanAudioProcessingInput = {
    sources: input.sources,
    destination: input.destination,
    operations: input.operations,
  }
  const qualityPlan = input.qualityPlan ?? planAudioProcessing(qualityInput)
  const period =
    input.periodDurationSeconds > 0
      ? input.periodDurationSeconds
      : periodSecondsFromSources(input.sources)
  const target = Math.max(0, input.targetDurationSeconds)
  const repetitions = period > 0 ? target / period : 0
  const minReps = input.minRepetitionsForEncodeOnce ?? DEFAULT_MIN_REPETITIONS
  const ineligibility: string[] = []

  const base = {
    qualityPlan,
    periodDurationSeconds: period,
    targetDurationSeconds: target,
    expectedRepetitions: repetitions,
    targetBitrateKbps: qualityPlan.targetBitrateKbps,
    expectedSampleRate: qualityPlan.expectedSampleRate,
    expectedChannels: qualityPlan.expectedChannels,
  }

  if (qualityPlan.strategy === 'STREAM_COPY' && !qualityPlan.reencodeRequired) {
    return {
      ...base,
      strategy: 'DIRECT_STREAM_COPY',
      reason: qualityPlan.reason,
      periodCodec: null,
      ineligibilityReasons: [],
      requiresBoundaryVerification: false,
    }
  }

  const destIsMp4 = input.destination === 'mp4-aac' || input.destination === 'mp4-copy'
  if (!destIsMp4) {
    return {
      ...base,
      strategy: 'STANDARD_PROCESSING',
      reason: 'Encode-once loop-copy is only for Screensaver MP4 mux destinations.',
      periodCodec: null,
      ineligibilityReasons: ['Destination is not MP4 mux.'],
      requiresBoundaryVerification: false,
    }
  }

  if (input.encodeOnceEnabled === false) {
    return {
      ...base,
      strategy: 'STANDARD_PROCESSING',
      reason: 'Encode-once disabled by feature flag.',
      periodCodec: qualityPlan.expectedCodec === 'mp3' ? 'mp3' : 'aac',
      ineligibilityReasons: ['Feature flag encodeOnceEnabled=false'],
      requiresBoundaryVerification: false,
    }
  }

  if (!(period > 0) || !(target > 0)) {
    ineligibility.push('Missing period or target duration.')
  }
  if (target <= period + 0.05) {
    ineligibility.push('Target duration is not longer than one period (no repetition benefit).')
  }
  if (repetitions < minReps) {
    ineligibility.push(`Expected repetitions ${repetitions.toFixed(2)} < minimum ${minReps}.`)
  }

  const full = hasFullTimelineTransforms(input.operations, {
    globalGainOnFullTimeline: input.globalGainOnFullTimeline,
  })
  if (full.blocked) ineligibility.push(...full.reasons)

  const per = perPeriodTransformsOk(input)
  if (!per.ok) ineligibility.push(...per.reasons)

  if (input.sources.length === 0) {
    ineligibility.push('No audio sources.')
  }
  for (const source of input.sources) {
    if (!normalizeCodec(source.codec) && !(source.sampleRate > 0)) {
      ineligibility.push('Incomplete source probe metadata.')
      break
    }
  }

  // Encode-once applies when quality already requires a lossy encode (or lossless period then lossy).
  if (qualityPlan.lossyEncodeBudget < 1 && qualityPlan.strategy !== 'LOSSLESS_PROCESSING') {
    // STREAM_COPY already handled; pure lossless without later AAC is not an MP4 path we optimize here.
  }

  if (ineligibility.length > 0) {
    return {
      ...base,
      strategy: 'STANDARD_PROCESSING',
      reason: ineligibility[0]!,
      periodCodec: 'aac',
      ineligibilityReasons: ineligibility,
      requiresBoundaryVerification: false,
    }
  }

  // POC: AAC period packet-loop failed continuity (near-silent joins). MP3 periods passed.
  // MP4 mux already accepts MP3 stream copy via canStreamCopyIntoMp4 / destinationAcceptsCopy.
  const periodCodec: 'aac' | 'mp3' = 'mp3'

  return {
    ...base,
    strategy: 'ENCODE_ONCE_LOOP_COPY',
    reason:
      'Encode one MP3 period (AAC packet-loop blocked by continuity), verify, then stream-copy loop to target duration.',
    periodCodec,
    ineligibilityReasons: [],
    requiresBoundaryVerification: true,
  }
}

/** Deterministic cache key inputs (caller supplies content hashes). */
export interface EncodedPeriodCacheKeyInput {
  sourceContentHashes: string[]
  sourceOrder: number[]
  trimStarts: number[]
  trimEnds: number[]
  volumePercent: number
  loopMode: string
  playlistCrossfade: boolean
  playlistCrossfadeSeconds: number
  normalizeLoudness: boolean
  outputCodec: string
  sampleRate: number
  channels: number
  targetBitrateKbps: number
  encoderId: string
  pipelineVersion?: string
}

export function buildEncodedPeriodCacheKey(input: EncodedPeriodCacheKeyInput): string {
  const version = input.pipelineVersion ?? AUDIO_PERIOD_PIPELINE_VERSION
  const parts = [
    version,
    input.sourceContentHashes.join(','),
    input.sourceOrder.join(','),
    input.trimStarts.map((v) => v.toFixed(3)).join(','),
    input.trimEnds.map((v) => v.toFixed(3)).join(','),
    String(Math.round(input.volumePercent)),
    input.loopMode,
    input.playlistCrossfade ? '1' : '0',
    input.playlistCrossfadeSeconds.toFixed(3),
    input.normalizeLoudness ? '1' : '0',
    input.outputCodec,
    String(Math.round(input.sampleRate)),
    String(Math.round(input.channels)),
    String(Math.round(input.targetBitrateKbps)),
    input.encoderId,
  ]
  return parts.join('|')
}
