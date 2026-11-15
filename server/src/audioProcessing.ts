/**
 * Server helpers for Source-Quality-First audio: logging, encode counting, FFmpeg builders.
 */

import { createHash } from 'node:crypto'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import {
  planAudioProcessing,
  processingStrategyLabel,
  type AudioProcessingPlan,
  type AudioSourceProbe,
  type PlanAudioProcessingInput,
} from '../../shared/audioProcessingPlan'
import type { AudioDetails } from './probe'
import { ffmpegBinary, ffprobeBinary } from './binaries'
import { n } from './ffmpegUtil'

const execFileAsync = promisify(execFile)

export class AudioEncodeCounter {
  lossyEncodeCount = 0
  losslessEncodeCount = 0
  decodeCount = 0

  recordLossyEncode(count = 1): void {
    this.lossyEncodeCount += Math.max(0, count)
  }

  recordLosslessEncode(count = 1): void {
    this.losslessEncodeCount += Math.max(0, count)
  }

  recordDecode(count = 1): void {
    this.decodeCount += Math.max(0, count)
  }

  get decodeRequired(): boolean {
    return this.decodeCount > 0
  }

  get streamCopy(): boolean {
    return this.lossyEncodeCount === 0 && this.losslessEncodeCount === 0 && this.decodeCount === 0
  }

  mergeFrom(other: AudioEncodeCounter): void {
    this.lossyEncodeCount += other.lossyEncodeCount
    this.losslessEncodeCount += other.losslessEncodeCount
    this.decodeCount += other.decodeCount
  }
}

/** Actual PCM bitrate in bits/sec (e.g. 44100 * 2 * 16 = 1_411_200). */
export function pcmBitrateBps(sampleRate: number, channels: number, bitsPerSample = 16): number {
  const rate = Math.round(sampleRate)
  const ch = Math.round(channels)
  const bits = Math.round(bitsPerSample)
  if (!(rate > 0) || !(ch > 0) || !(bits > 0)) return 0
  return rate * ch * bits
}

export function audioDetailsToProbe(
  details: AudioDetails,
  trim?: { trimStart?: number; trimEnd?: number },
): AudioSourceProbe {
  return {
    codec: details.codec,
    codecProfile: details.codecProfile,
    formatName: details.formatName,
    bitrate: details.bitrate,
    streamBitrate: details.streamBitrate,
    containerBitrate: details.containerBitrate,
    bitrateMode: details.bitrateMode,
    sampleRate: details.sampleRate,
    channels: details.channels,
    channelLayout: details.channelLayout,
    sampleFmt: details.sampleFmt,
    bitsPerSample: details.bitsPerSample,
    duration: details.duration,
    trimStart: trim?.trimStart,
    trimEnd: trim?.trimEnd,
  }
}

export interface AudioBitrateFields {
  originalSourceBitrate?: number
  currentStreamBitrate?: number
  targetEncodingBitrate?: number | null
  actualOutputBitrate?: number
}

function formatKbps(bps: number | null | undefined): string {
  if (bps == null || !(bps > 0)) return 'unknown'
  return `${Math.round(bps / 1000)} kbps`
}

function channelLabel(channels: number): string {
  if (channels === 1) return 'Mono'
  if (channels === 2) return 'Stereo'
  return channels > 0 ? String(channels) : 'unknown'
}

export function logAudioPlan(
  plan: AudioProcessingPlan,
  sources: AudioSourceProbe[],
  bitrates?: AudioBitrateFields & {
    executionStrategy?: string
    targetDurationSeconds?: number
    periodDurationSeconds?: number
  },
): void {
  console.info(`[AudioPlanner] Sources: ${sources.length}`)
  sources.forEach((source, index) => {
    const br = source.bitrate > 0 ? formatKbps(source.bitrate) : 'unknown'
    console.info(
      `[AudioPlanner] Track ${index + 1}: ${source.codec ?? 'unknown'} / ${br} / ${source.sampleRate || 'unknown'} Hz / ${channelLabel(source.channels)}`,
    )
  })
  const first = sources[0]
  if (first) {
    const original =
      bitrates?.originalSourceBitrate != null && bitrates.originalSourceBitrate > 0
        ? bitrates.originalSourceBitrate
        : first.bitrate
    const current =
      bitrates?.currentStreamBitrate != null && bitrates.currentStreamBitrate > 0
        ? bitrates.currentStreamBitrate
        : first.streamBitrate && first.streamBitrate > 0
          ? first.streamBitrate
          : first.bitrate
    console.info(`[AudioPlanner] originalSourceBitrate: ${formatKbps(original)}`)
    console.info(`[AudioPlanner] currentStreamBitrate: ${formatKbps(current)}`)
    if (bitrates?.targetEncodingBitrate != null || plan.targetBitrateKbps != null) {
      const target =
        bitrates?.targetEncodingBitrate != null
          ? bitrates.targetEncodingBitrate
          : plan.targetBitrateKbps != null
            ? plan.targetBitrateKbps * 1000
            : null
      console.info(`[AudioPlanner] targetEncodingBitrate: ${formatKbps(target)}`)
    }
    console.info(`[AudioPlanner] Common sample rate: ${plan.expectedSampleRate || 'unknown'} Hz`)
    console.info(`[AudioPlanner] Expected channels: ${channelLabel(plan.expectedChannels)}`)
  }
  console.info(`[AudioPlanner] Quality strategy: ${plan.strategy}`)
  if (bitrates?.executionStrategy) {
    console.info(`[AudioPlanner] Execution strategy: ${bitrates.executionStrategy}`)
  }
  console.info(`[AudioPlanner] Reason: ${plan.reason}`)
  console.info(`[AudioPlanner] Label: ${plan.userLabel}`)
  if (bitrates?.targetDurationSeconds != null) {
    console.info(`[AudioPlanner] Target duration: ${bitrates.targetDurationSeconds}s`)
  }
  if (bitrates?.periodDurationSeconds != null) {
    console.info(`[AudioPlanner] Loop period: ${bitrates.periodDurationSeconds}s`)
  }
}

export function logAudioExport(opts: {
  streamCopy: boolean
  decodeRequired: boolean
  losslessEncodeCount: number
  lossyEncodeCount: number
  verification: 'Passed' | 'Failed'
  strategyChangeReason?: string
  actualOutputBitrate?: number
  decodePerformed?: boolean
  resamplingPerformed?: boolean
  pcmMaterializationPerformed?: boolean
  lossyEncodeInputDurationSeconds?: number
  lossyGenerationsInFinalOutput?: number
  loopStreamCopy?: boolean
  finalMuxAudioStreamCopy?: boolean
  boundaryVerification?: 'Passed' | 'Failed' | 'Skipped'
  durationVerification?: 'Passed' | 'Failed' | 'Skipped'
  fallbackUsed?: boolean
}): void {
  if (opts.strategyChangeReason) {
    console.info(`[AudioExport] Strategy changed: ${opts.strategyChangeReason}`)
  }
  console.info(`[AudioExport] streamCopy: ${opts.streamCopy ? 'Yes' : 'No'}`)
  console.info(`[AudioExport] decodeRequired: ${opts.decodeRequired ? 'Yes' : 'No'}`)
  if (opts.decodePerformed != null) {
    console.info(`[AudioExport] Decode performed: ${opts.decodePerformed ? 'Yes' : 'No'}`)
  }
  if (opts.resamplingPerformed != null) {
    console.info(`[AudioExport] Resampling performed: ${opts.resamplingPerformed ? 'Yes' : 'No'}`)
  }
  if (opts.pcmMaterializationPerformed != null) {
    console.info(`[AudioExport] PCM materialization performed: ${opts.pcmMaterializationPerformed ? 'Yes' : 'No'}`)
  }
  console.info(`[AudioExport] losslessEncodeCount=${opts.losslessEncodeCount}`)
  console.info(`[AudioExport] lossyEncodeCount=${opts.lossyEncodeCount}`)
  if (opts.lossyEncodeInputDurationSeconds != null) {
    console.info(`[AudioExport] AAC/MP3 encode input duration: ${opts.lossyEncodeInputDurationSeconds.toFixed(3)}s`)
  }
  if (opts.lossyGenerationsInFinalOutput != null) {
    console.info(`[AudioExport] Lossy generations in final output: ${opts.lossyGenerationsInFinalOutput}`)
  }
  if (opts.loopStreamCopy != null) {
    console.info(`[AudioExport] Loop stream copy: ${opts.loopStreamCopy ? 'Yes' : 'No'}`)
  }
  if (opts.finalMuxAudioStreamCopy != null) {
    console.info(`[AudioExport] Final mux audio stream copy: ${opts.finalMuxAudioStreamCopy ? 'Yes' : 'No'}`)
  }
  if (opts.actualOutputBitrate != null && opts.actualOutputBitrate > 0) {
    console.info(`[AudioExport] actualOutputBitrate: ${formatKbps(opts.actualOutputBitrate)}`)
  }
  if (opts.boundaryVerification) {
    console.info(`[AudioExport] Boundary verification: ${opts.boundaryVerification}`)
  }
  if (opts.durationVerification) {
    console.info(`[AudioExport] Duration verification: ${opts.durationVerification}`)
  }
  if (opts.fallbackUsed != null) {
    console.info(`[AudioExport] Fallback used: ${opts.fallbackUsed ? 'Yes' : 'No'}`)
  }
  console.info(`[AudioExport] Verification: ${opts.verification}`)
}

export function planAndLog(
  input: PlanAudioProcessingInput,
  bitrates?: AudioBitrateFields,
): AudioProcessingPlan {
  const plan = planAudioProcessing(input)
  logAudioPlan(plan, input.sources, {
    ...bitrates,
    targetEncodingBitrate:
      bitrates?.targetEncodingBitrate ??
      (plan.targetBitrateKbps != null ? plan.targetBitrateKbps * 1000 : null),
  })
  return plan
}

export function ffmpegAudioPrefix(): string[] {
  return ['-y', '-hide_banner', '-progress', 'pipe:1', '-nostats']
}

/** Stream-copy loop (or trim) without audio filters. */
export function streamCopyLoopArgs(opts: {
  sourcePath: string
  outputPath: string
  targetSeconds: number
  loop: boolean
}): string[] {
  const args = [...ffmpegAudioPrefix()]
  if (opts.loop) args.push('-stream_loop', '-1')
  args.push(
    '-i',
    opts.sourcePath,
    '-t',
    n(opts.targetSeconds),
    '-vn',
    '-map',
    '0:a:0',
    '-c:a',
    'copy',
    opts.outputPath,
  )
  return args
}

/** Concat demuxer + stream copy. */
export function streamCopyConcatArgs(opts: {
  listPath: string
  outputPath: string
  targetSeconds: number
  loop: boolean
}): string[] {
  const args = [...ffmpegAudioPrefix()]
  if (opts.loop) args.push('-stream_loop', '-1')
  args.push(
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    opts.listPath,
    '-t',
    n(opts.targetSeconds),
    '-vn',
    '-map',
    '0:a:0',
    '-c:a',
    'copy',
    opts.outputPath,
  )
  return args
}

export function looperEncodeArgs(opts: {
  format: 'mp3' | 'wav' | 'flac'
  mp3BitrateKbps?: number | null
}): string[] {
  if (opts.format === 'wav') return ['-c:a', 'pcm_s16le']
  if (opts.format === 'flac') return ['-c:a', 'flac']
  const kbps = opts.mp3BitrateKbps && opts.mp3BitrateKbps > 0 ? opts.mp3BitrateKbps : 320
  return ['-c:a', 'libmp3lame', '-b:a', `${kbps}k`]
}

/**
 * FFmpeg's native `aac` encoder often fails to exceed ~192–224 kbps stereo even when
 * `-b:a 320k` is requested. Prefer Media Foundation AAC when listed; otherwise use LAME
 * inside MP4 for high targets (MP3-in-MP4 is already accepted for stream-copy).
 */
const NATIVE_AAC_RELIABLE_MAX_KBPS = 192

let cachedAacEncoder: 'aac_mf' | 'aac' | null = null

function resolveAacEncoder(): 'aac_mf' | 'aac' {
  if (cachedAacEncoder) return cachedAacEncoder
  try {
    const out = execFileSync(ffmpegBinary(), ['-hide_banner', '-encoders'], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    })
    cachedAacEncoder = /\baac_mf\b/.test(out) ? 'aac_mf' : 'aac'
  } catch {
    cachedAacEncoder = 'aac'
  }
  return cachedAacEncoder
}

export function aacEncodeArgs(opts: {
  bitrateKbps: number
  sampleRate?: number
  channels?: number
}): string[] {
  const kbps = Math.max(64, Math.round(opts.bitrateKbps))
  const aac = resolveAacEncoder()
  const codec = aac === 'aac_mf' ? 'aac_mf' : kbps > NATIVE_AAC_RELIABLE_MAX_KBPS ? 'libmp3lame' : 'aac'
  const args = ['-c:a', codec, '-b:a', `${kbps}k`]
  if (opts.sampleRate && opts.sampleRate > 0) args.push('-ar', String(Math.round(opts.sampleRate)))
  if (opts.channels && opts.channels > 0) args.push('-ac', String(Math.round(opts.channels)))
  return args
}

/**
 * Conditional screensaver audio filter — resample/layout only when needed.
 */
export function buildScreensaverAudioFilter(opts: {
  inputLabel: string
  volume: number
  fadeIn: number
  fadeOut: number
  duration: number
  sampleRate?: number
  channels?: number
  forceResample?: boolean
  forceStereo?: boolean
}): string {
  const parts: string[] = []
  const rate = opts.sampleRate && opts.sampleRate > 0 ? Math.round(opts.sampleRate) : 0
  const channels = opts.channels && opts.channels > 0 ? Math.round(opts.channels) : 0
  if (opts.forceResample && rate > 0) {
    parts.push(`aresample=${rate}`)
  }
  if (opts.forceStereo || (channels > 0 && channels !== 2)) {
    const layout = channels === 1 ? 'mono' : channels === 2 || opts.forceStereo ? 'stereo' : `${channels}c`
    parts.push(`aformat=sample_fmts=fltp:channel_layouts=${layout}`)
  } else if (parts.length > 0) {
    parts.push('aformat=sample_fmts=fltp')
  }
  if (Math.abs(opts.volume - 1) > 0.001) parts.push(`volume=${n(opts.volume)}`)
  parts.push(`atrim=0:${n(opts.duration)}`, 'asetpts=PTS-STARTPTS')
  if (opts.fadeIn > 0.01) parts.push(`afade=t=in:st=0:d=${n(opts.fadeIn)}`)
  if (opts.fadeOut > 0.01) {
    parts.push(`afade=t=out:st=${n(Math.max(0, opts.duration - opts.fadeOut))}:d=${n(opts.fadeOut)}`)
  }
  return `[${opts.inputLabel}]${parts.join(',')}[aout]`
}

export function wantsScreensaverAudio(job: {
  audioVolume: number
  audioMode: string
  musicPath?: string | null
  sourceHasAudio?: boolean
  mediaKind?: string
}): boolean {
  if (job.audioVolume <= 0.001) return false
  if (job.audioMode === 'upload') return Boolean(job.musicPath)
  if (job.audioMode === 'source') return Boolean(job.sourceHasAudio && job.mediaKind === 'video')
  return false
}

/** Whether mux can stream-copy without audioFilterLine. */
export function canStreamCopyIntoMp4(opts: {
  codec: string | null | undefined
  volume: number
  fadeIn: number
  fadeOut: number
}): boolean {
  if (Math.abs(opts.volume - 1) > 0.02) return false
  if (opts.fadeIn > 0.05 || opts.fadeOut > 0.05) return false
  const codec = (opts.codec ?? '').toLowerCase().trim()
  return codec === 'aac' || codec === 'aac_latm' || codec === 'mp3' || codec === 'mp3float'
}

/**
 * Hash concatenated packet data sizes + dts for stream-copy verification (not whole-file hash).
 */
export async function hashAudioPackets(file: string): Promise<string> {
  const result = await execFileAsync(
    ffprobeBinary(),
    [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'packet=size,dts,pts,flags',
      '-of',
      'csv=p=0',
      file,
    ],
    { windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
  )
  return createHash('sha256').update(result.stdout).digest('hex')
}

export { planAudioProcessing, processingStrategyLabel }
export type { AudioProcessingPlan, AudioSourceProbe, PlanAudioProcessingInput }
