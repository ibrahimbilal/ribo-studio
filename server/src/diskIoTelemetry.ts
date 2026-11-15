/**
 * Lightweight per-stage disk / mux telemetry for Screensaver exports.
 * Estimates are labeled; process I/O counters are reported only when available.
 */

import { stat } from 'node:fs/promises'

const LOG = '[DiskIO]'

export type DiskIoStageName =
  | 'PREPARE_TIMELINE'
  | 'VIDEO_SEGMENT_ENCODE'
  | 'VIDEO_SEGMENT_ASSEMBLY'
  | 'AUDIO_PERIOD_PREPARE'
  | 'FINAL_MUX'
  | 'FASTSTART'
  | 'VERIFICATION'
  | 'FALLBACK'

export interface DiskIoStageSnapshot {
  name: DiskIoStageName
  wallMs: number
  inputBytes?: number
  outputBytes?: number
  tempBytesCreated?: number
  logicalBytesReadEst?: number
  logicalBytesWrittenEst?: number
  ffmpegInvocations?: number
  faststartOps?: number
  cacheHit?: boolean
  notes?: string
}

export interface DiskIoSessionSummary {
  strategy: string
  fullDurationVideoIntermediate: 'Created' | 'Skipped'
  fullDurationAudioIntermediate: 'Created' | 'Skipped'
  audioPeriodCache: 'HIT' | 'MISS' | 'N/A'
  fallbackUsed: boolean
  fallbackReason?: string
  finalOutputBytes?: number
  peakTemporaryBytes: number
  verificationMs?: number
  finalMuxMs?: number
  stages: DiskIoStageSnapshot[]
  ffmpegInvocations: number
  faststartOps: number
}

function diagEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.RIBO_DISK_IO_DIAG
  if (raw == null || raw.trim() === '') return false
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'on' || v === 'yes'
}

export async function fileSizeOrZero(file: string | null | undefined): Promise<number> {
  if (!file) return 0
  try {
    return (await stat(file)).size
  } catch {
    return 0
  }
}

/** Best-effort process I/O counters (Windows/Linux differ; may be unavailable). */
export function readProcessIoCounters(): { readBytes: number; writeBytes: number } | null {
  try {
    const usage = process.resourceUsage?.()
    if (!usage) return null
    const readBytes = Number((usage as NodeJS.ResourceUsage & { fsRead?: number }).fsRead ?? 0)
    const writeBytes = Number((usage as NodeJS.ResourceUsage & { fsWrite?: number }).fsWrite ?? 0)
    // On many platforms these are syscall counts, not bytes — only return when clearly byte-like.
    if (!Number.isFinite(readBytes) || !Number.isFinite(writeBytes)) return null
    if (readBytes <= 0 && writeBytes <= 0) return null
    // Heuristic: syscall counts stay small; treat large values as possible bytes.
    if (readBytes < 1_000_000 && writeBytes < 1_000_000) return null
    return { readBytes, writeBytes }
  } catch {
    return null
  }
}

export class DiskIoSession {
  private stages: DiskIoStageSnapshot[] = []
  private peakTemporaryBytes = 0
  private trackedTemp = new Map<string, number>()
  private ffmpegInvocations = 0
  private faststartOps = 0
  private audioPeriodCache: DiskIoSessionSummary['audioPeriodCache'] = 'N/A'
  private fullDurationVideoIntermediate: DiskIoSessionSummary['fullDurationVideoIntermediate'] = 'Skipped'
  private fullDurationAudioIntermediate: DiskIoSessionSummary['fullDurationAudioIntermediate'] = 'Skipped'
  private fallbackUsed = false
  private fallbackReason?: string
  private finalOutputBytes?: number
  private verificationMs?: number
  private finalMuxMs?: number
  private readonly verbose: boolean

  constructor(readonly strategy: string) {
    this.verbose = diagEnabled()
  }

  beginStage(name: DiskIoStageName): { end: (extra?: Partial<DiskIoStageSnapshot>) => void } {
    const started = performance.now()
    return {
      end: (extra = {}) => {
        const wallMs = performance.now() - started
        const snap: DiskIoStageSnapshot = { name, wallMs, ...extra }
        this.stages.push(snap)
        if (typeof snap.ffmpegInvocations === 'number') this.ffmpegInvocations += snap.ffmpegInvocations
        if (typeof snap.faststartOps === 'number') this.faststartOps += snap.faststartOps
        if (name === 'VERIFICATION') this.verificationMs = wallMs
        if (name === 'FINAL_MUX') this.finalMuxMs = wallMs
        if (this.verbose) {
          console.info(
            `${LOG} Stage: ${name} wallMs=${wallMs.toFixed(1)}` +
              (snap.outputBytes != null ? ` out=${snap.outputBytes}` : '') +
              (snap.notes ? ` ${snap.notes}` : ''),
          )
        }
      },
    }
  }

  noteFfmpeg(count = 1, faststart = false): void {
    this.ffmpegInvocations += count
    if (faststart) this.faststartOps += 1
  }

  async trackTempFile(file: string): Promise<void> {
    const size = await fileSizeOrZero(file)
    this.trackedTemp.set(file, size)
    this.recomputePeak()
  }

  untrackTempFile(file: string): void {
    this.trackedTemp.delete(file)
  }

  setPeakTemporaryBytes(bytes: number): void {
    if (bytes > this.peakTemporaryBytes) this.peakTemporaryBytes = bytes
  }

  private recomputePeak(): void {
    let sum = 0
    for (const size of this.trackedTemp.values()) sum += size
    this.setPeakTemporaryBytes(sum)
  }

  markFullDurationVideo(created: boolean): void {
    this.fullDurationVideoIntermediate = created ? 'Created' : 'Skipped'
  }

  markFullDurationAudio(created: boolean): void {
    this.fullDurationAudioIntermediate = created ? 'Created' : 'Skipped'
  }

  markAudioPeriodCache(hit: boolean | null): void {
    if (hit == null) this.audioPeriodCache = 'N/A'
    else this.audioPeriodCache = hit ? 'HIT' : 'MISS'
  }

  markFallback(reason: string): void {
    this.fallbackUsed = true
    this.fallbackReason = reason
  }

  setFinalOutputBytes(bytes: number): void {
    this.finalOutputBytes = bytes
  }

  summarize(): DiskIoSessionSummary {
    return {
      strategy: this.strategy,
      fullDurationVideoIntermediate: this.fullDurationVideoIntermediate,
      fullDurationAudioIntermediate: this.fullDurationAudioIntermediate,
      audioPeriodCache: this.audioPeriodCache,
      fallbackUsed: this.fallbackUsed,
      fallbackReason: this.fallbackReason,
      finalOutputBytes: this.finalOutputBytes,
      peakTemporaryBytes: this.peakTemporaryBytes,
      verificationMs: this.verificationMs,
      finalMuxMs: this.finalMuxMs,
      stages: [...this.stages],
      ffmpegInvocations: this.ffmpegInvocations,
      faststartOps: this.faststartOps,
    }
  }

  logSummary(): void {
    const s = this.summarize()
    console.info(`${LOG} Strategy: ${s.strategy}`)
    console.info(`${LOG} Full-duration video intermediate: ${s.fullDurationVideoIntermediate}`)
    console.info(`${LOG} Full-duration audio intermediate: ${s.fullDurationAudioIntermediate}`)
    console.info(`${LOG} Audio period cache: ${s.audioPeriodCache}`)
    if (s.finalMuxMs != null) console.info(`${LOG} Final mux duration: ${s.finalMuxMs.toFixed(0)}ms`)
    if (s.finalOutputBytes != null) console.info(`${LOG} Final output bytes: ${s.finalOutputBytes}`)
    console.info(`${LOG} Peak temporary bytes: ${s.peakTemporaryBytes}`)
    if (s.verificationMs != null) console.info(`${LOG} Verification duration: ${s.verificationMs.toFixed(0)}ms`)
    console.info(`${LOG} FFmpeg invocations: ${s.ffmpegInvocations}`)
    console.info(`${LOG} Faststart operations: ${s.faststartOps}`)
    console.info(`${LOG} Fallback used: ${s.fallbackUsed ? `Yes (${s.fallbackReason ?? 'unknown'})` : 'No'}`)
  }
}
