/**
 * Packet-preserving duration recovery for STREAM_COPY exports.
 * Prefer STREAM_COPY_TRIM / corrected loop construction over lossy re-encode.
 */

import { copyFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AudioLooperFormat } from '../../shared/audioLooper'
import {
  audioDurationSlack,
  n,
  spawnFfmpeg,
  verifyAudioOutput,
  type FfmpegHooks,
  type VerifiedAudioOutput,
} from './ffmpegUtil'
import { ffmpegAudioPrefix, streamCopyConcatArgs, streamCopyLoopArgs } from './audioProcessing'
import { probeAudioDetails } from './probe'

export const MAX_STREAM_COPY_RECOVERY_ATTEMPTS = 3

export type DurationVerdict = 'ok' | 'overshoot' | 'undershoot'

export type StreamCopyRecoveryStrategy =
  | 'none'
  | 'STREAM_COPY_TRIM'
  | 'STREAM_COPY_RETRY_LOOP'
  | 'STREAM_COPY_EXPAND_PLAYLIST'
  | 'HIGH_QUALITY_REENCODE'

export interface DurationAssessment {
  targetSeconds: number
  actualSeconds: number
  streamDuration: number
  containerDuration: number
  startTime: number
  deltaSeconds: number
  slackSeconds: number
  verdict: DurationVerdict
  notes: string[]
}

export function assessAudioDuration(opts: {
  targetSeconds: number
  streamDuration: number
  containerDuration: number
  startTime?: number
}): DurationAssessment {
  const slackSeconds = audioDurationSlack(opts.targetSeconds)
  const streamDuration = opts.streamDuration > 0 ? opts.streamDuration : 0
  const containerDuration = opts.containerDuration > 0 ? opts.containerDuration : 0
  const startTime = opts.startTime ?? 0
  const notes: string[] = []

  // Prefer stream duration (content) over container (may include padding / priming).
  let actualSeconds = streamDuration || containerDuration
  if (streamDuration > 0 && containerDuration > 0 && Math.abs(streamDuration - containerDuration) > 0.02) {
    notes.push(
      `stream/container duration differ by ${(containerDuration - streamDuration).toFixed(3)}s (padding/encoder delay possible)`,
    )
  }
  if (Math.abs(startTime) > 0.001) {
    notes.push(`container start_time=${startTime.toFixed(3)}s`)
  }

  // If stream is within slack but container overshoots, treat as OK (padding only).
  if (streamDuration > 0) {
    const streamDelta = streamDuration - opts.targetSeconds
    if (Math.abs(streamDelta) <= slackSeconds) {
      if (containerDuration > opts.targetSeconds + slackSeconds) {
        notes.push('container overshoot ignored; stream duration within slack')
      }
      return {
        targetSeconds: opts.targetSeconds,
        actualSeconds: streamDuration,
        streamDuration,
        containerDuration,
        startTime,
        deltaSeconds: streamDelta,
        slackSeconds,
        verdict: 'ok',
        notes,
      }
    }
    actualSeconds = streamDuration
  }

  const deltaSeconds = actualSeconds - opts.targetSeconds
  let verdict: DurationVerdict = 'ok'
  if (deltaSeconds > slackSeconds) verdict = 'overshoot'
  else if (deltaSeconds < -slackSeconds) verdict = 'undershoot'

  return {
    targetSeconds: opts.targetSeconds,
    actualSeconds,
    streamDuration,
    containerDuration,
    startTime,
    deltaSeconds,
    slackSeconds,
    verdict,
    notes,
  }
}

export async function assessFileDuration(file: string, targetSeconds: number): Promise<DurationAssessment> {
  const probed = await probeAudioDetails(file)
  return assessAudioDuration({
    targetSeconds,
    streamDuration: probed.streamDuration,
    containerDuration: probed.containerDuration,
    startTime: probed.startTime,
  })
}

export function logDurationAssessment(
  assessment: DurationAssessment,
  opts?: { recoveryStrategy?: StreamCopyRecoveryStrategy; attempt?: number },
): void {
  console.info(`[AudioDuration] target=${assessment.targetSeconds.toFixed(3)}s`)
  console.info(`[AudioDuration] actual=${assessment.actualSeconds.toFixed(3)}s`)
  console.info(`[AudioDuration] delta=${assessment.deltaSeconds.toFixed(3)}s`)
  console.info(`[AudioDuration] slack=±${assessment.slackSeconds.toFixed(3)}s`)
  console.info(`[AudioDuration] verdict=${assessment.verdict}`)
  if (assessment.notes.length) {
    for (const note of assessment.notes) console.info(`[AudioDuration] note: ${note}`)
  }
  if (opts?.recoveryStrategy) {
    console.info(`[AudioDuration] recoveryStrategy=${opts.recoveryStrategy}`)
  }
  if (opts?.attempt != null) {
    console.info(`[AudioDuration] recoveryAttempt=${opts.attempt}`)
  }
}

/** Packet-preserving trim: ffmpeg -i in -t TARGET -c:a copy out */
export function streamCopyTrimArgs(opts: {
  sourcePath: string
  outputPath: string
  targetSeconds: number
}): string[] {
  return [
    ...ffmpegAudioPrefix(),
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
  ]
}

export async function streamCopyTrimToDuration(opts: {
  sourcePath: string
  outputPath: string
  targetSeconds: number
  hooks: FfmpegHooks
}): Promise<void> {
  await spawnFfmpeg(
    streamCopyTrimArgs({
      sourcePath: opts.sourcePath,
      outputPath: opts.outputPath,
      targetSeconds: opts.targetSeconds,
    }),
    opts.targetSeconds,
    opts.hooks,
  )
}

export interface StreamCopyRecoveryContext {
  workPath: string
  dir: string
  targetSeconds: number
  format: AudioLooperFormat
  expectedChannels: number
  hooks: FfmpegHooks
  /** Rebuild stream-copy output with forced looping (undershoot recovery). */
  retryStreamCopyLoop: () => Promise<void>
  /** Optional: expand playlist concat entries then copy (undershoot recovery). */
  expandPlaylistAndCopy?: () => Promise<boolean>
}

export type StreamCopyRecoveryResult =
  | {
      preservedPackets: true
      verified: VerifiedAudioOutput
      strategy: StreamCopyRecoveryStrategy
      attempts: number
      assessment: DurationAssessment
    }
  | {
      preservedPackets: false
      strategy: 'HIGH_QUALITY_REENCODE'
      attempts: number
      assessment: DurationAssessment
      reencodeReason: string
    }

/**
 * Recover duration after STREAM_COPY without lossy re-encoding when possible.
 */
export async function recoverStreamCopyDuration(
  ctx: StreamCopyRecoveryContext,
): Promise<StreamCopyRecoveryResult> {
  let attempts = 0
  let lastAssessment = await assessFileDuration(ctx.workPath, ctx.targetSeconds)
  logDurationAssessment(lastAssessment, { recoveryStrategy: 'none', attempt: 0 })

  if (lastAssessment.verdict === 'ok') {
    const verified = await verifyAudioOutput(ctx.workPath, ctx.targetSeconds, ctx.format, ctx.expectedChannels)
    return {
      verified,
      strategy: 'none',
      attempts: 0,
      assessment: lastAssessment,
      preservedPackets: true,
    }
  }

  while (attempts < MAX_STREAM_COPY_RECOVERY_ATTEMPTS) {
    attempts += 1
    if (lastAssessment.verdict === 'overshoot') {
      const strategy: StreamCopyRecoveryStrategy = 'STREAM_COPY_TRIM'
      logDurationAssessment(lastAssessment, { recoveryStrategy: strategy, attempt: attempts })
      const trimPath = path.join(ctx.dir, `stream-copy-trim-${attempts}${path.extname(ctx.workPath)}`)
      await streamCopyTrimToDuration({
        sourcePath: ctx.workPath,
        outputPath: trimPath,
        targetSeconds: ctx.targetSeconds,
        hooks: {
          cancelled: ctx.hooks.cancelled,
          onProgress: (progress, message) =>
            ctx.hooks.onProgress(Math.min(0.99, 0.85 + progress * 0.1), message ?? 'Trimming stream copy'),
          onStats: ctx.hooks.onStats,
          onSpawn: ctx.hooks.onSpawn,
          registerKill: ctx.hooks.registerKill,
        },
      })
      await replaceWorkFile(trimPath, ctx.workPath)
      lastAssessment = await assessFileDuration(ctx.workPath, ctx.targetSeconds)
      logDurationAssessment(lastAssessment, { recoveryStrategy: strategy, attempt: attempts })
      if (lastAssessment.verdict === 'ok') {
        const verified = await verifyAudioOutput(
          ctx.workPath,
          ctx.targetSeconds,
          ctx.format,
          ctx.expectedChannels,
        )
        return {
          verified,
          strategy,
          attempts,
          assessment: lastAssessment,
          preservedPackets: true,
        }
      }
      // Trim can undershoot on coarse packet boundaries — try loop rebuild next.
      continue
    }

    if (lastAssessment.verdict === 'undershoot') {
      let strategy: StreamCopyRecoveryStrategy = 'STREAM_COPY_RETRY_LOOP'
      logDurationAssessment(lastAssessment, { recoveryStrategy: strategy, attempt: attempts })
      let expanded = false
      if (attempts >= 2 && ctx.expandPlaylistAndCopy) {
        strategy = 'STREAM_COPY_EXPAND_PLAYLIST'
        logDurationAssessment(lastAssessment, { recoveryStrategy: strategy, attempt: attempts })
        expanded = await ctx.expandPlaylistAndCopy()
      }
      if (!expanded) {
        await ctx.retryStreamCopyLoop()
      }
      lastAssessment = await assessFileDuration(ctx.workPath, ctx.targetSeconds)
      logDurationAssessment(lastAssessment, { recoveryStrategy: strategy, attempt: attempts })
      if (lastAssessment.verdict === 'ok') {
        const verified = await verifyAudioOutput(
          ctx.workPath,
          ctx.targetSeconds,
          ctx.format,
          ctx.expectedChannels,
        )
        return {
          verified,
          strategy,
          attempts,
          assessment: lastAssessment,
          preservedPackets: true,
        }
      }
      if (lastAssessment.verdict === 'overshoot') {
        // Fall through to next iteration for STREAM_COPY_TRIM.
        continue
      }
      continue
    }
  }

  const reason = `Packet-preserving duration recovery failed after ${attempts} attempt(s): actual=${lastAssessment.actualSeconds.toFixed(3)}s target=${lastAssessment.targetSeconds.toFixed(3)}s delta=${lastAssessment.deltaSeconds.toFixed(3)}s slack=±${lastAssessment.slackSeconds.toFixed(3)}s`
  console.info(`[AudioDuration] recoveryStrategy=HIGH_QUALITY_REENCODE`)
  console.info(`[AudioDuration] reencodeReason=${reason}`)
  return {
    strategy: 'HIGH_QUALITY_REENCODE',
    attempts,
    assessment: lastAssessment,
    preservedPackets: false,
    reencodeReason: reason,
  }
}

async function replaceWorkFile(fromPath: string, workPath: string): Promise<void> {
  const backup = `${workPath}.pre-trim`
  try {
    await copyFile(workPath, backup)
  } catch {
    // optional backup
  }
  await rm(workPath, { force: true }).catch(() => undefined)
  await rename(fromPath, workPath)
  await rm(backup, { force: true }).catch(() => undefined)
}

/** Build a concat list that repeats the playlist until it covers targetSeconds. */
export async function writeExpandedPlaylistConcatList(opts: {
  listPath: string
  entries: Array<{ path: string; trimStart: number; trimEnd: number; duration: number }>
  targetSeconds: number
}): Promise<number> {
  const period = opts.entries.reduce((sum, entry) => sum + Math.max(0, entry.trimEnd - entry.trimStart), 0)
  if (!(period > 0)) throw new Error('Playlist period is empty.')
  const repeats = Math.max(1, Math.ceil((opts.targetSeconds + 0.05) / period))
  const lines: string[] = []
  for (let cycle = 0; cycle < repeats; cycle += 1) {
    for (const entry of opts.entries) {
      const file = entry.path.replace(/\\/g, '/').replace(/'/g, "'\\''")
      lines.push(`file '${file}'`)
      if (entry.trimStart > 0.03) lines.push(`inpoint ${n(entry.trimStart)}`)
      if (entry.trimEnd < entry.duration - 0.05) lines.push(`outpoint ${n(entry.trimEnd)}`)
    }
  }
  await writeFile(opts.listPath, `${lines.join('\n')}\n`)
  return repeats
}

export { streamCopyLoopArgs, streamCopyConcatArgs }
