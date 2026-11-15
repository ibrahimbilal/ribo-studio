/**
 * Playlist compatibility analysis for Audio Looper UI.
 * Uses planAudioProcessing / planAudioExecution as the single decision source —
 * this module only groups streams and surfaces planner diagnostics.
 */

import type { AudioLooperFormat, AudioLooperLoopMode } from './audioLooper'
import { audioChannelLabel } from './audioLooperChannels'
import {
  planAudioExecution,
  type AudioExecutionPlan,
  type AudioExecutionStrategy,
} from './audioExecutionPlan'
import {
  looperDestination,
  planAudioProcessing,
  processingStrategyLabel,
  type AudioDestination,
  type AudioProcessingOperations,
  type AudioProcessingPlan,
  type AudioSourceProbe,
} from './audioProcessingPlan'

export type CompatibilityTrackStatus = 'analyzing' | 'ready' | 'error'

export interface CompatibilityTrackInput {
  id: string
  fileName: string
  status: CompatibilityTrackStatus
  error?: string | null
  duration: number | null
  codec: string | null
  codecProfile?: string | null
  sampleRate: number | null
  channels: number | null
  channelLayout?: string | null
  bitrate?: number | null
  trimStart?: number
  trimEnd?: number | null
}

export interface StreamSignature {
  key: string
  codec: string
  sampleRate: number
  channels: number
  channelLayout: string
  codecProfile: string
  /** Human label e.g. "MP3 · 44.1 kHz · Stereo" */
  label: string
}

export type TrackMismatchField =
  | 'codec'
  | 'sampleRate'
  | 'channels'
  | 'channelLayout'
  | 'codecProfile'
  | 'metadata'
  | 'invalid'

export interface TrackMismatch {
  field: TrackMismatchField
  message: string
  actual: string
  expected: string
}

export type TrackCompatState =
  | 'analyzing'
  | 'stream-copy-ready'
  | 'processing-required'
  | 'unknown'
  | 'invalid'

export interface CompatibilityGroup {
  id: string
  signature: StreamSignature
  trackIds: string[]
  trackCount: number
  totalDurationSeconds: number
  /** Whether this group's streams can stream-copy into the selected destination (codec-wise). */
  destinationCopyOk: boolean
}

export interface DestinationPreview {
  destination: AudioDestination
  label: string
  strategy: AudioProcessingPlan['strategy']
  strategyLabel: string
  reason: string
}

export interface CompatibilitySuggestion {
  id: string
  message: string
}

export interface ProcessingImpactEstimate {
  targetDurationSeconds: number
  periodDurationSeconds: number
  repetitions: number
  decodeRequired: boolean
  resamplingRequired: boolean
  lossyEncodeRequired: boolean
  standardEncodeInputSeconds: number
  encodeOnceEncodeInputSeconds: number | null
  workloadReductionPercent: number | null
  executionStrategy: AudioExecutionStrategy | null
}

export interface PlaylistCompatibilityReport {
  trackCount: number
  analyzingCount: number
  invalidCount: number
  unknownCount: number
  groups: CompatibilityGroup[]
  recommendedGroupId: string | null
  selectedGroupId: string | null
  /** Tracks matching the selected / recommended group signature. */
  matchingTrackIds: string[]
  mismatchingTrackIds: string[]
  trackStates: Record<string, TrackCompatState>
  trackMismatches: Record<string, TrackMismatch[]>
  /** All tracks share one signature (or ≤1 ready track). */
  singleGroup: boolean
  sourcesCompatible: boolean
  qualityPlan: AudioProcessingPlan | null
  executionPlan: AudioExecutionPlan | null
  processingBlockedBySettings: boolean
  settingsBlockReason: string | null
  destinations: DestinationPreview[]
  suggestions: CompatibilitySuggestion[]
  impact: ProcessingImpactEstimate | null
  summaryLine: string
}

function normalizeCodec(codec: string | null | undefined): string {
  return (codec ?? '').toLowerCase().trim()
}

function displayCodec(codec: string): string {
  const c = normalizeCodec(codec)
  if (c === 'mp3' || c === 'mp3float') return 'MP3'
  if (c === 'aac' || c === 'aac_latm') return 'AAC'
  if (c === 'flac') return 'FLAC'
  if (c.startsWith('pcm_')) return 'PCM'
  if (c === 'vorbis' || c === 'opus') return c.toUpperCase()
  return c ? c.toUpperCase() : 'Unknown'
}

function formatRate(hz: number): string {
  if (!(hz > 0)) return 'unknown'
  if (hz % 1000 === 0) return `${hz / 1000} kHz`
  return `${(hz / 1000).toFixed(1)} kHz`
}

export function buildStreamSignature(track: CompatibilityTrackInput): StreamSignature | null {
  const codec = normalizeCodec(track.codec)
  const sampleRate = track.sampleRate != null && track.sampleRate > 0 ? Math.round(track.sampleRate) : 0
  const channels = track.channels != null && track.channels > 0 ? Math.round(track.channels) : 0
  if (!codec || !sampleRate || !channels) return null
  const channelLayout = (track.channelLayout ?? '').toLowerCase().trim()
  const codecProfile = (track.codecProfile ?? '').toLowerCase().trim()
  const key = [codec, String(sampleRate), String(channels), channelLayout || '-', codecProfile || '-'].join('|')
  const channelText = audioChannelLabel(channels, track.channelLayout || null) || `${channels}ch`
  return {
    key,
    codec,
    sampleRate,
    channels,
    channelLayout,
    codecProfile,
    label: `${displayCodec(codec)} · ${formatRate(sampleRate)} · ${channelText}`,
  }
}

export function diagnoseTrackVsSignature(
  track: CompatibilityTrackInput,
  signature: StreamSignature,
): TrackMismatch[] {
  if (track.status === 'error') {
    return [
      {
        field: 'invalid',
        message: track.error || 'Invalid audio stream.',
        actual: 'Invalid',
        expected: 'Valid audio',
      },
    ]
  }
  if (track.status === 'analyzing') return []

  const mismatches: TrackMismatch[] = []
  const codec = normalizeCodec(track.codec)
  if (!codec || !(track.sampleRate && track.sampleRate > 0) || !(track.channels && track.channels > 0)) {
    mismatches.push({
      field: 'metadata',
      message: 'Missing stream metadata.',
      actual: 'Incomplete',
      expected: signature.label,
    })
    return mismatches
  }

  if (codec !== signature.codec) {
    mismatches.push({
      field: 'codec',
      message: 'Codec mismatch.',
      actual: displayCodec(codec),
      expected: displayCodec(signature.codec),
    })
  }
  if (Math.round(track.sampleRate) !== signature.sampleRate) {
    mismatches.push({
      field: 'sampleRate',
      message: 'Sample rate mismatch.',
      actual: formatRate(Math.round(track.sampleRate)),
      expected: formatRate(signature.sampleRate),
    })
  }
  if (Math.round(track.channels) !== signature.channels) {
    mismatches.push({
      field: 'channels',
      message: 'Channel count mismatch.',
      actual: audioChannelLabel(track.channels, track.channelLayout || null) || String(track.channels),
      expected: audioChannelLabel(signature.channels, signature.channelLayout || null) || String(signature.channels),
    })
  }
  const layout = (track.channelLayout ?? '').toLowerCase().trim()
  if (signature.channelLayout && layout && layout !== signature.channelLayout) {
    mismatches.push({
      field: 'channelLayout',
      message: 'Channel layout mismatch.',
      actual: layout,
      expected: signature.channelLayout,
    })
  }
  const profile = (track.codecProfile ?? '').toLowerCase().trim()
  if (signature.codecProfile && profile && profile !== signature.codecProfile) {
    mismatches.push({
      field: 'codecProfile',
      message: 'Codec profile mismatch.',
      actual: profile,
      expected: signature.codecProfile,
    })
  }
  return mismatches
}

function toProbe(track: CompatibilityTrackInput): AudioSourceProbe | null {
  if (track.status !== 'ready') return null
  if (!track.codec || !(track.sampleRate && track.sampleRate > 0) || !(track.channels && track.channels > 0)) {
    return null
  }
  const duration = track.duration && track.duration > 0 ? track.duration : 0
  const trimStart = track.trimStart ?? 0
  const trimEnd = track.trimEnd ?? duration
  return {
    codec: track.codec,
    codecProfile: track.codecProfile ?? null,
    bitrate: track.bitrate && track.bitrate > 0 ? track.bitrate : 0,
    streamBitrate: track.bitrate && track.bitrate > 0 ? track.bitrate : 0,
    sampleRate: track.sampleRate,
    channels: track.channels,
    channelLayout: track.channelLayout ?? null,
    duration,
    trimStart,
    trimEnd: trimEnd > 0 ? trimEnd : duration,
  }
}

function destinationCopyOk(signature: StreamSignature, destination: AudioDestination): boolean {
  const probe: AudioSourceProbe = {
    codec: signature.codec,
    codecProfile: signature.codecProfile || null,
    bitrate: 0,
    sampleRate: signature.sampleRate,
    channels: signature.channels,
    channelLayout: signature.channelLayout || null,
    duration: 10,
  }
  const plan = planAudioProcessing({
    sources: [probe],
    destination,
    operations: { volumePercent: 100, fadeInSeconds: 0, fadeOutSeconds: 0, muxVolume: 1 },
  })
  return plan.strategy === 'STREAM_COPY'
}

export interface AnalyzePlaylistCompatibilityInput {
  tracks: CompatibilityTrackInput[]
  format: AudioLooperFormat
  loopMode: AudioLooperLoopMode
  volumePercent: number
  fadeInSeconds: number
  fadeOutSeconds: number
  playlistCrossfade: boolean
  playlistCrossfadeSeconds: number
  normalizeLoudness: boolean
  mp3Bitrate?: number
  targetDurationSeconds: number
  /** Manual group override; null = use recommendation. */
  selectedGroupId?: string | null
  /** Include Screensaver destination previews. */
  includeScreensaver?: boolean
  encodeOnceEnabled?: boolean
}

function buildOperations(input: AnalyzePlaylistCompatibilityInput, multi: boolean): AudioProcessingOperations {
  return {
    loopMode: input.loopMode,
    volumePercent: input.volumePercent,
    fadeInSeconds: input.fadeInSeconds,
    fadeOutSeconds: input.fadeOutSeconds,
    seamlessCrossfade: input.loopMode === 'seamless' && !multi,
    playlistCrossfade: multi && input.playlistCrossfade,
    playlistCrossfadeSeconds: input.playlistCrossfadeSeconds,
    normalizeLoudness: multi && input.normalizeLoudness,
    userMp3Bitrate: input.mp3Bitrate as AudioProcessingOperations['userMp3Bitrate'],
    muxVolume: 1,
    muxFadeIn: 0,
    muxFadeOut: 0,
  }
}

function buildSuggestions(opts: {
  report: Omit<
    PlaylistCompatibilityReport,
    'suggestions' | 'summaryLine' | 'impact' | 'destinations'
  > & { destinations?: DestinationPreview[] }
  input: AnalyzePlaylistCompatibilityInput
  selected: CompatibilityGroup | null
}): CompatibilitySuggestion[] {
  const out: CompatibilitySuggestion[] = []
  const { report, input, selected } = opts
  const mismatchCount = report.mismatchingTrackIds.length

  if (mismatchCount > 0 && selected) {
    const rates = new Set(
      report.mismatchingTrackIds
        .map((id) => input.tracks.find((t) => t.id === id)?.sampleRate)
        .filter((r): r is number => r != null && r > 0)
        .map((r) => Math.round(r)),
    )
    if (rates.size > 0 && ![...rates].every((r) => r === selected.signature.sampleRate)) {
      out.push({
        id: 'remove-sample-rate',
        message: `Remove ${mismatchCount} track${mismatchCount === 1 ? '' : 's'} with a different sample rate to enable direct stream copy.`,
      })
    } else {
      out.push({
        id: 'remove-mismatch',
        message: `Remove ${mismatchCount} incompatible track${mismatchCount === 1 ? '' : 's'} to keep a stream-copy compatible playlist.`,
      })
    }
  }

  if (report.sourcesCompatible && report.processingBlockedBySettings && report.settingsBlockReason) {
    const reason = report.settingsBlockReason
    if (/crossfade/i.test(reason)) {
      out.push({ id: 'disable-crossfade', message: 'Disable playlist crossfade to preserve the original audio streams.' })
    } else if (/volume|fade/i.test(reason)) {
      out.push({
        id: 'reset-gain',
        message: 'Set volume to 100% and clear fades to enable direct stream copy.',
      })
    } else if (/seamless/i.test(reason)) {
      out.push({ id: 'simple-loop', message: 'Use Simple loop mode to allow stream copy when tracks are compatible.' })
    } else if (/loudness/i.test(reason)) {
      out.push({ id: 'disable-loudnorm', message: 'Disable loudness matching to preserve the original audio streams.' })
    } else {
      out.push({ id: 'settings-block', message: reason })
    }
  }

  if (input.format !== 'mp3' && report.qualityPlan?.expectedCodec === 'mp3') {
    // no-op
  }
  if (
    input.format !== 'mp3' &&
    selected &&
    (selected.signature.codec === 'mp3' || selected.signature.codec === 'mp3float')
  ) {
    out.push({
      id: 'select-mp3-out',
      message: 'Select MP3 output to preserve the original MP3 streams.',
    })
  }

  if (report.executionPlan?.strategy === 'ENCODE_ONCE_LOOP_COPY') {
    out.push({
      id: 'encode-once',
      message:
        'Mixed sample rates or transforms require processing. Encode-Once Loop-Copy may reduce repeated encoding for long Screensaver exports.',
    })
  }

  return out
}

export function analyzePlaylistCompatibility(
  input: AnalyzePlaylistCompatibilityInput,
): PlaylistCompatibilityReport {
  const destination = looperDestination(input.format)
  const analyzingCount = input.tracks.filter((t) => t.status === 'analyzing').length
  const invalidCount = input.tracks.filter((t) => t.status === 'error').length
  const ready = input.tracks.filter((t) => t.status === 'ready')

  const bucket = new Map<string, { signature: StreamSignature; tracks: CompatibilityTrackInput[] }>()
  let unknownCount = 0
  for (const track of ready) {
    const signature = buildStreamSignature(track)
    if (!signature) {
      unknownCount += 1
      continue
    }
    const existing = bucket.get(signature.key)
    if (existing) existing.tracks.push(track)
    else bucket.set(signature.key, { signature, tracks: [track] })
  }

  const groups: CompatibilityGroup[] = [...bucket.values()]
    .map((entry) => {
      const totalDurationSeconds = entry.tracks.reduce((sum, t) => {
        const start = t.trimStart ?? 0
        const end = t.trimEnd ?? t.duration ?? 0
        return sum + Math.max(0, end - start)
      }, 0)
      return {
        // Stable id = signature key (survives re-sort when tracks change).
        id: entry.signature.key,
        signature: entry.signature,
        trackIds: entry.tracks.map((t) => t.id),
        trackCount: entry.tracks.length,
        totalDurationSeconds,
        destinationCopyOk: destinationCopyOk(entry.signature, destination),
      }
    })
    .sort((a, b) => {
      if (b.trackCount !== a.trackCount) return b.trackCount - a.trackCount
      return b.totalDurationSeconds - a.totalDurationSeconds
    })

  const destinationPreferred = groups.filter((g) => g.destinationCopyOk)
  const recommendPool = destinationPreferred.length > 0 ? destinationPreferred : groups
  const recommendedGroupId = recommendPool[0]?.id ?? null

  const selectedGroupId =
    input.selectedGroupId && groups.some((g) => g.id === input.selectedGroupId)
      ? input.selectedGroupId
      : recommendedGroupId
  const selected = groups.find((g) => g.id === selectedGroupId) ?? null

  const matchingTrackIds = selected ? [...selected.trackIds] : []
  const matchingSet = new Set(matchingTrackIds)
  const mismatchingTrackIds = ready
    .filter((t) => buildStreamSignature(t) && !matchingSet.has(t.id))
    .map((t) => t.id)

  const trackStates: Record<string, TrackCompatState> = {}
  const trackMismatches: Record<string, TrackMismatch[]> = {}
  for (const track of input.tracks) {
    if (track.status === 'analyzing') {
      trackStates[track.id] = 'analyzing'
      trackMismatches[track.id] = []
      continue
    }
    if (track.status === 'error') {
      trackStates[track.id] = 'invalid'
      trackMismatches[track.id] = diagnoseTrackVsSignature(track, selected?.signature ?? {
        key: '',
        codec: '',
        sampleRate: 0,
        channels: 0,
        channelLayout: '',
        codecProfile: '',
        label: 'Valid audio',
      })
      continue
    }
    const signature = buildStreamSignature(track)
    if (!signature) {
      trackStates[track.id] = 'unknown'
      trackMismatches[track.id] = [
        {
          field: 'metadata',
          message: 'Compatibility unknown — incomplete stream metadata.',
          actual: 'Incomplete',
          expected: selected?.signature.label ?? 'Complete probe',
        },
      ]
      continue
    }
    if (!selected) {
      trackStates[track.id] = 'stream-copy-ready'
      trackMismatches[track.id] = []
      continue
    }
    const mismatches = diagnoseTrackVsSignature(track, selected.signature)
    trackMismatches[track.id] = mismatches
    trackStates[track.id] = mismatches.length === 0 ? 'stream-copy-ready' : 'processing-required'
  }

  // Full playlist probes for actual export plan (includes mismatches).
  const allProbes = ready.map(toProbe).filter((p): p is AudioSourceProbe => p != null)
  const multi = allProbes.length >= 2
  const operations = buildOperations(input, multi)

  const qualityPlan =
    allProbes.length > 0
      ? planAudioProcessing({
          sources: allProbes,
          destination,
          looperFormat: input.format,
          operations,
        })
      : null

  const periodDuration = allProbes.reduce((sum, p) => {
    const start = p.trimStart ?? 0
    const end = p.trimEnd ?? p.duration
    return sum + Math.max(0, end - start)
  }, 0)

  const executionPlan =
    qualityPlan && allProbes.length > 0
      ? planAudioExecution({
          sources: allProbes,
          destination: 'mp4-aac',
          operations: { ...operations, muxVolume: 1, muxFadeIn: 0, muxFadeOut: 0 },
          qualityPlan: planAudioProcessing({
            sources: allProbes,
            destination: 'mp4-aac',
            operations: { ...operations, muxVolume: 1, muxFadeIn: 0, muxFadeOut: 0 },
          }),
          targetDurationSeconds: input.targetDurationSeconds,
          periodDurationSeconds: periodDuration,
          encodeOnceEnabled: input.encodeOnceEnabled !== false,
          globalGainOnFullTimeline: true,
        })
      : null

  const sourcesCompatible = groups.length <= 1 && unknownCount === 0 && invalidCount === 0 && analyzingCount === 0
  const settingsBlockReason =
    qualityPlan && qualityPlan.strategy !== 'STREAM_COPY' && sourcesCompatible ? qualityPlan.reason : null
  const processingBlockedBySettings = Boolean(settingsBlockReason)

  const destinations: DestinationPreview[] = []
  if (allProbes.length > 0) {
    for (const item of [
      { destination: looperDestination('mp3'), label: 'MP3 Export' },
      { destination: looperDestination('wav'), label: 'WAV Export' },
      { destination: looperDestination('flac'), label: 'FLAC Export' },
      ...(input.includeScreensaver !== false
        ? [{ destination: 'mp4-copy' as const, label: 'Screensaver MP4' }]
        : []),
    ]) {
      const plan = planAudioProcessing({
        sources: allProbes,
        destination: item.destination,
        looperFormat: item.destination === 'looper-wav' ? 'wav' : item.destination === 'looper-flac' ? 'flac' : 'mp3',
        operations,
      })
      destinations.push({
        destination: item.destination,
        label: item.label,
        strategy: plan.strategy,
        strategyLabel: processingStrategyLabel(plan.strategy),
        reason: plan.reason,
      })
    }
  }

  const decodeRequired = qualityPlan ? qualityPlan.strategy !== 'STREAM_COPY' : false
  const resamplingRequired = Boolean(
    qualityPlan?.limitations.some((l) => /mixed sample/i.test(l)) ||
      (qualityPlan && /resampling|sample rate/i.test(qualityPlan.reason)),
  )
  const lossyEncodeRequired = Boolean(qualityPlan && qualityPlan.lossyEncodeBudget > 0)
  const repetitions = periodDuration > 0 ? input.targetDurationSeconds / periodDuration : 0
  const encodeOnce =
    executionPlan?.strategy === 'ENCODE_ONCE_LOOP_COPY' ? periodDuration : null
  const impact: ProcessingImpactEstimate | null =
    allProbes.length > 0 && input.targetDurationSeconds > 0
      ? {
          targetDurationSeconds: input.targetDurationSeconds,
          periodDurationSeconds: periodDuration,
          repetitions,
          decodeRequired,
          resamplingRequired,
          lossyEncodeRequired,
          standardEncodeInputSeconds: lossyEncodeRequired ? input.targetDurationSeconds : 0,
          encodeOnceEncodeInputSeconds: encodeOnce,
          workloadReductionPercent:
            encodeOnce != null && input.targetDurationSeconds > 0
              ? Math.max(0, Math.min(99.9, (1 - encodeOnce / input.targetDurationSeconds) * 100))
              : null,
          executionStrategy: executionPlan?.strategy ?? null,
        }
      : null

  const base = {
    trackCount: input.tracks.length,
    analyzingCount,
    invalidCount,
    unknownCount,
    groups,
    recommendedGroupId,
    selectedGroupId,
    matchingTrackIds,
    mismatchingTrackIds,
    trackStates,
    trackMismatches,
    singleGroup: groups.length <= 1,
    sourcesCompatible,
    qualityPlan,
    executionPlan,
    processingBlockedBySettings,
    settingsBlockReason,
  }

  const suggestions = buildSuggestions({ report: base, input, selected })

  let summaryLine = 'Upload audio to see compatibility.'
  if (input.tracks.length === 0) {
    summaryLine = 'Upload audio to see compatibility.'
  } else if (analyzingCount > 0) {
    summaryLine = `Analyzing ${analyzingCount} track${analyzingCount === 1 ? '' : 's'}…`
  } else if (invalidCount > 0 && ready.length === 0) {
    summaryLine = 'No valid audio streams found.'
  } else if (selected && mismatchingTrackIds.length === 0 && sourcesCompatible) {
    if (processingBlockedBySettings) {
      summaryLine = `All tracks compatible. Direct stream copy unavailable — ${settingsBlockReason}`
    } else if (qualityPlan?.strategy === 'STREAM_COPY') {
      summaryLine = `All ${ready.length} track${ready.length === 1 ? '' : 's'} match · Stream Copy Ready`
    } else {
      summaryLine = `All tracks compatible · ${processingStrategyLabel(qualityPlan?.strategy ?? 'HIGH_QUALITY_REENCODE')}`
    }
  } else if (selected) {
    summaryLine = `${matchingTrackIds.length} of ${ready.length} tracks match ${selected.signature.label}`
  }

  return {
    ...base,
    destinations,
    suggestions,
    impact,
    summaryLine,
  }
}

export function formatCompatibilityKbps(bitrate: number | null | undefined): string | null {
  if (bitrate == null || !(bitrate > 0)) return null
  return `${Math.max(1, Math.round(bitrate / 1000))} kbps`
}
