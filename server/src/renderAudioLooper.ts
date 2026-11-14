import { copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  LOUDNESS_TARGET_I,
  LOUDNESS_TARGET_LRA,
  LOUDNESS_TARGET_TP,
  outputExtension,
  volumeToFfmpeg,
  type AudioLooperSettings,
} from '../../shared/audioLooper'
import { pcmNormalizeFilter, resolveOutputChannels } from '../../shared/audioLooperChannels'
import { assertPlaylistTimeline, playlistPeriod } from '../../shared/audioLooperPlaylist'
import {
  looperDestination,
  maxReliableSourceBitrateBps,
  planAudioProcessing,
  sourceNeedsSampleAccurateTrim,
  type AudioProcessingPlan,
  type AudioSourceProbe,
} from '../../shared/audioProcessingPlan'
import {
  AudioEncodeCounter,
  logAudioExport,
  logAudioPlan,
  looperEncodeArgs,
  streamCopyConcatArgs,
  streamCopyLoopArgs,
} from './audioProcessing'
import {
  recoverStreamCopyDuration,
  writeExpandedPlaylistConcatList,
} from './audioDurationRecovery'
import {
  n,
  RenderCancelled,
  spawnFfmpeg,
  verifyAudioOutput,
  type FfmpegHooks,
  type FfmpegStats,
  type VerifiedAudioOutput,
} from './ffmpegUtil'
import { jobsDir, outputsDir } from './storage'

export interface AudioLooperPlaylistSource {
  path: string
  duration: number
  sampleRate: number
  channels: number
  trimStart: number
  trimEnd: number
  codec?: string | null
  bitrate?: number
  streamBitrate?: number
  containerBitrate?: number
  channelLayout?: string | null
}

export interface AudioLooperRenderRequest {
  sourcePath: string
  sourceDuration: number
  sourceSampleRate: number
  sourceChannels: number
  sourceCodec?: string | null
  sourceBitrate?: number
  /** Resolved target channel count. When omitted, derived from sources / sourceChannels. */
  targetChannels?: number
  settings: AudioLooperSettings
  /** Two or more sources use the playlist graph. One source keeps the existing loop. */
  sources?: AudioLooperPlaylistSource[]
}

export interface AudioLooperRenderHooks {
  cancelled: () => boolean
  onProgress: (progress: number, message?: string) => void
  onStats?: (stats: FfmpegStats) => void
  onSpawn?: (pid: number) => void
  onStatus: (status: 'preparing' | 'rendering' | 'verifying' | 'cancelled', message: string) => void
  registerKill: (kill: () => void) => void
}

export type AudioLooperRenderResult = VerifiedAudioOutput & {
  outputPath: string
  warning: string | null
  processingStrategy: AudioProcessingPlan['strategy']
  processingLabel: AudioProcessingPlan['userLabel']
  processingReason: string
  lossyEncodeCount: number
  reencoded: boolean
}

function toProbes(raw: AudioLooperRenderRequest): AudioSourceProbe[] {
  if (raw.sources && raw.sources.length >= 2) {
    return raw.sources.map((source) => ({
      codec: source.codec ?? null,
      bitrate: source.bitrate ?? 0,
      streamBitrate: source.streamBitrate,
      containerBitrate: source.containerBitrate,
      sampleRate: source.sampleRate,
      channels: source.channels,
      channelLayout: source.channelLayout,
      duration: source.duration,
      trimStart: source.trimStart,
      trimEnd: source.trimEnd,
    }))
  }
  const track = raw.settings.tracks?.[0]
  return [
    {
      codec: raw.sourceCodec ?? null,
      bitrate: raw.sourceBitrate ?? 0,
      sampleRate: raw.sourceSampleRate,
      channels: raw.sourceChannels,
      duration: raw.sourceDuration,
      trimStart: track?.trimStart,
      trimEnd: track?.trimEnd,
    },
  ]
}

export async function renderAudioLooper(
  raw: AudioLooperRenderRequest & { id: string },
  hooks: AudioLooperRenderHooks,
): Promise<AudioLooperRenderResult> {
  if (hooks.cancelled()) throw new RenderCancelled()
  hooks.onStatus('preparing', 'Preparing audio')

  const target = raw.settings.targetDurationSeconds
  const ext = outputExtension(raw.settings.format)
  const dir = path.join(jobsDir, raw.id)
  await mkdir(dir, { recursive: true })
  const workPath = path.join(dir, `output${ext}`)
  const finalPath = path.join(outputsDir, `${raw.id}${ext}`)
  const outputChannels = resolveRenderChannels(raw)
  const counter = new AudioEncodeCounter()
  const probes = toProbes(raw)
  const needsLoop =
    raw.sources && raw.sources.length >= 2
      ? true
      : raw.sourceDuration < target
  const seamless = raw.settings.loopMode === 'seamless' && needsLoop && !(raw.sources && raw.sources.length >= 2)

  let plan = planAudioProcessing({
    sources: probes,
    destination: looperDestination(raw.settings.format),
    looperFormat: raw.settings.format,
    operations: {
      loopMode: raw.settings.loopMode,
      volumePercent: raw.settings.volumePercent,
      fadeInSeconds: raw.settings.fadeInSeconds,
      fadeOutSeconds: raw.settings.fadeOutSeconds,
      seamlessCrossfade: seamless,
      playlistCrossfade: Boolean(raw.sources && raw.sources.length >= 2 && raw.settings.playlistCrossfade),
      playlistCrossfadeSeconds: raw.settings.playlistCrossfadeSeconds,
      normalizeLoudness: Boolean(raw.sources && raw.sources.length >= 2 && raw.settings.normalizeLoudness),
      userMp3Bitrate: raw.settings.mp3Bitrate,
    },
  })
  logAudioPlan(plan, probes, {
    originalSourceBitrate: maxReliableSourceBitrateBps(probes),
    currentStreamBitrate: probes[0]?.bitrate || 0,
    targetEncodingBitrate: plan.targetBitrateKbps != null ? plan.targetBitrateKbps * 1000 : null,
  })

  let usedStreamCopy = false
  try {
    if (raw.sources && raw.sources.length >= 2) {
      if (plan.strategy === 'STREAM_COPY') {
        usedStreamCopy = await tryPlaylistStreamCopy(raw, workPath, dir, hooks, plan, counter, {})
        if (!usedStreamCopy) {
          plan = {
            ...plan,
            strategy: 'HIGH_QUALITY_REENCODE',
            reason: 'Stream copy playlist fell back after compatibility or duration check.',
            reencodeRequired: true,
            lossyEncodeBudget: 1,
            userLabel: 'High-Quality Re-encoding',
          }
          await renderPlaylist(raw, workPath, dir, hooks, outputChannels, plan, counter)
        }
      } else {
        await renderPlaylist(raw, workPath, dir, hooks, outputChannels, plan, counter)
      }
    } else {
      const needsTrim = probes[0] ? sourceNeedsSampleAccurateTrim(probes[0]) : false
      const prepared =
        needsTrim || plan.strategy !== 'STREAM_COPY'
          ? await maybeTrimSource(raw, dir, hooks, outputChannels)
          : raw
      const loopNeeded = prepared.sourceDuration < target
      const doSeamless = prepared.settings.loopMode === 'seamless' && loopNeeded
      if (doSeamless) {
        await renderSeamless(prepared, workPath, dir, hooks, outputChannels, plan, counter)
      } else if (plan.strategy === 'STREAM_COPY' && !needsTrim) {
        hooks.onStatus('rendering', loopNeeded ? 'Copying loop' : 'Copying audio')
        await spawnFfmpeg(
          streamCopyLoopArgs({
            sourcePath: prepared.sourcePath,
            outputPath: workPath,
            targetSeconds: target,
            loop: loopNeeded,
          }),
          target,
          wrapProgress(hooks, 0, 0.99),
        )
        usedStreamCopy = true
      } else {
        hooks.onStatus('rendering', loopNeeded ? 'Encoding loop' : 'Trimming audio')
        await spawnFfmpeg(
          simpleArgs(prepared, workPath, loopNeeded, outputChannels, plan, counter),
          target,
          wrapProgress(hooks, 0, 0.99),
        )
      }
    }
  } catch (error) {
    if (usedStreamCopy) {
      // Fall through to packet-preserving duration recovery (then re-encode only if needed).
      console.warn('[AudioExport] Stream copy spawn/process failed; attempting duration recovery before re-encode.', error)
    } else {
      throw error
    }
  }

  if (hooks.cancelled()) throw new RenderCancelled()
  hooks.onStatus('verifying', 'Checking the audio file')
  let verified: VerifiedAudioOutput
  try {
    if (usedStreamCopy) {
      const recovery = await recoverStreamCopyDuration({
        workPath,
        dir,
        targetSeconds: target,
        format: raw.settings.format,
        expectedChannels: outputChannels,
        hooks: wrapProgress(hooks, 0.9, 0.99),
        retryStreamCopyLoop: async () => {
          hooks.onStatus('rendering', 'Retrying stream copy with corrected loop duration')
          if (raw.sources && raw.sources.length >= 2) {
            await tryPlaylistStreamCopy(raw, workPath, dir, hooks, plan, counter, {
              forceLoop: true,
            })
          } else {
            const prepared = raw
            await spawnFfmpeg(
              streamCopyLoopArgs({
                sourcePath: prepared.sourcePath,
                outputPath: workPath,
                targetSeconds: target,
                loop: true,
              }),
              target,
              wrapProgress(hooks, 0.7, 0.9),
            )
          }
        },
        expandPlaylistAndCopy: async () => {
          if (!(raw.sources && raw.sources.length >= 2)) return false
          const listPath = path.join(dir, 'concat-copy-expanded.txt')
          const repeats = await writeExpandedPlaylistConcatList({
            listPath,
            entries: raw.sources.map((source) => ({
              path: source.path,
              trimStart: source.trimStart,
              trimEnd: source.trimEnd,
              duration: source.duration,
            })),
            targetSeconds: target,
          })
          console.info(`[AudioDuration] expanded playlist concat to ${repeats} cycle(s)`)
          hooks.onStatus('rendering', 'Retrying stream copy with expanded playlist')
          await spawnFfmpeg(
            streamCopyConcatArgs({
              listPath,
              outputPath: workPath,
              targetSeconds: target,
              loop: false,
            }),
            target,
            wrapProgress(hooks, 0.7, 0.9),
          )
          return true
        },
      })

      if (recovery.preservedPackets) {
        verified = recovery.verified
        if (recovery.strategy !== 'none') {
          plan = {
            ...plan,
            strategy: 'STREAM_COPY',
            reason: `Stream copy duration recovered via ${recovery.strategy} (${recovery.attempts} attempt(s)).`,
            reencodeRequired: false,
            lossyEncodeBudget: 0,
            userLabel: 'Original Stream Preserved',
          }
        }
        logAudioExport({
          streamCopy: true,
          decodeRequired: false,
          losslessEncodeCount: counter.losslessEncodeCount,
          lossyEncodeCount: counter.lossyEncodeCount,
          verification: 'Passed',
          strategyChangeReason:
            recovery.strategy !== 'none'
              ? `Duration recovery: ${recovery.strategy} (attempts=${recovery.attempts})`
              : undefined,
          actualOutputBitrate: verified.bitrate,
        })
      } else {
        const reencodeReason = recovery.reencodeReason
        console.warn(`[AudioExport] ${reencodeReason}`)
        counter.lossyEncodeCount = 0
        counter.losslessEncodeCount = 0
        counter.decodeCount = 0
        plan = {
          ...plan,
          strategy: 'HIGH_QUALITY_REENCODE',
          reason: reencodeReason,
          reencodeRequired: true,
          lossyEncodeBudget: 1,
          userLabel: 'High-Quality Re-encoding',
        }
        logAudioPlan(plan, probes, {
          originalSourceBitrate: maxReliableSourceBitrateBps(probes),
          targetEncodingBitrate: plan.targetBitrateKbps != null ? plan.targetBitrateKbps * 1000 : null,
        })
        // Re-encode from original sources/settings — never from a lossy intermediate.
        if (raw.sources && raw.sources.length >= 2) {
          await renderPlaylist(raw, workPath, dir, hooks, outputChannels, plan, counter)
        } else {
          const prepared = await maybeTrimSource(raw, dir, hooks, outputChannels)
          const loopNeeded = prepared.sourceDuration < target
          if (prepared.settings.loopMode === 'seamless' && loopNeeded) {
            await renderSeamless(prepared, workPath, dir, hooks, outputChannels, plan, counter)
          } else {
            await spawnFfmpeg(
              simpleArgs(prepared, workPath, loopNeeded, outputChannels, plan, counter),
              target,
              wrapProgress(hooks, 0, 0.99),
            )
          }
        }
        verified = await verifyAudioOutput(workPath, target, raw.settings.format, outputChannels)
        logAudioExport({
          streamCopy: false,
          decodeRequired: true,
          losslessEncodeCount: counter.losslessEncodeCount,
          lossyEncodeCount: counter.lossyEncodeCount,
          verification: 'Passed',
          strategyChangeReason: plan.reason,
          actualOutputBitrate: verified.bitrate,
        })
        usedStreamCopy = false
      }
    } else {
      verified = await verifyAudioOutput(workPath, target, raw.settings.format, outputChannels)
      logAudioExport({
        streamCopy: false,
        decodeRequired: counter.decodeRequired || plan.reencodeRequired,
        losslessEncodeCount: counter.losslessEncodeCount,
        lossyEncodeCount: counter.lossyEncodeCount,
        verification: 'Passed',
        actualOutputBitrate: verified.bitrate,
      })
    }
  } catch (error) {
    if (usedStreamCopy) {
      // Unexpected non-duration failure after stream copy — last-resort re-encode from originals.
      console.warn('[AudioExport] Stream copy failed unexpectedly; re-encoding from original sources.', error)
      counter.lossyEncodeCount = 0
      counter.losslessEncodeCount = 0
      counter.decodeCount = 0
      plan = {
        ...plan,
        strategy: 'HIGH_QUALITY_REENCODE',
        reason: 'Stream copy failed for a non-recoverable reason; re-encoded once from original sources.',
        reencodeRequired: true,
        lossyEncodeBudget: 1,
        userLabel: 'High-Quality Re-encoding',
      }
      logAudioPlan(plan, probes, {
        originalSourceBitrate: maxReliableSourceBitrateBps(probes),
        targetEncodingBitrate: plan.targetBitrateKbps != null ? plan.targetBitrateKbps * 1000 : null,
      })
      if (raw.sources && raw.sources.length >= 2) {
        await renderPlaylist(raw, workPath, dir, hooks, outputChannels, plan, counter)
      } else {
        const prepared = await maybeTrimSource(raw, dir, hooks, outputChannels)
        const loopNeeded = prepared.sourceDuration < target
        if (prepared.settings.loopMode === 'seamless' && loopNeeded) {
          await renderSeamless(prepared, workPath, dir, hooks, outputChannels, plan, counter)
        } else {
          await spawnFfmpeg(
            simpleArgs(prepared, workPath, loopNeeded, outputChannels, plan, counter),
            target,
            wrapProgress(hooks, 0, 0.99),
          )
        }
      }
      verified = await verifyAudioOutput(workPath, target, raw.settings.format, outputChannels)
      logAudioExport({
        streamCopy: false,
        decodeRequired: true,
        losslessEncodeCount: counter.losslessEncodeCount,
        lossyEncodeCount: counter.lossyEncodeCount,
        verification: 'Passed',
        strategyChangeReason: plan.reason,
        actualOutputBitrate: verified.bitrate,
      })
      usedStreamCopy = false
    } else {
      logAudioExport({
        streamCopy: false,
        decodeRequired: counter.decodeRequired || plan.reencodeRequired,
        losslessEncodeCount: counter.losslessEncodeCount,
        lossyEncodeCount: counter.lossyEncodeCount,
        verification: 'Failed',
      })
      throw error
    }
  }

  await moveOutput(workPath, finalPath)
  return {
    ...verified,
    outputPath: finalPath,
    warning: null,
    processingStrategy: plan.strategy,
    processingLabel: plan.userLabel,
    processingReason: plan.reason,
    lossyEncodeCount: counter.lossyEncodeCount,
    reencoded: counter.lossyEncodeCount > 0 || plan.reencodeRequired,
  }
}

async function tryPlaylistStreamCopy(
  raw: AudioLooperRenderRequest & { id: string },
  workPath: string,
  dir: string,
  hooks: AudioLooperRenderHooks,
  _plan: AudioProcessingPlan,
  _counter: AudioEncodeCounter,
  options: { forceLoop?: boolean } = {},
): Promise<boolean> {
  const sources = raw.sources ?? []
  if (sources.length < 2) return false
  if (raw.settings.playlistCrossfade || raw.settings.normalizeLoudness) return false
  const listPath = path.join(dir, 'concat-copy.txt')
  const lines: string[] = []
  for (const source of sources) {
    const file = source.path.replace(/\\/g, '/').replace(/'/g, "'\\''")
    lines.push(`file '${file}'`)
    if (source.trimStart > 0.03) lines.push(`inpoint ${n(source.trimStart)}`)
    if (source.trimEnd < source.duration - 0.05) lines.push(`outpoint ${n(source.trimEnd)}`)
  }
  const durations = sources.map((source) => source.trimEnd - source.trimStart)
  const period = assertPlaylistTimeline(durations, false, 0)
  const target = raw.settings.targetDurationSeconds
  const needsRepeat = options.forceLoop || period < target - 0.001
  // Concat demuxer + -stream_loop is unreliable for long targets; expand the list instead.
  if (needsRepeat) {
    await writeExpandedPlaylistConcatList({
      listPath,
      entries: sources.map((source) => ({
        path: source.path,
        trimStart: source.trimStart,
        trimEnd: source.trimEnd,
        duration: source.duration,
      })),
      targetSeconds: target,
    })
  } else {
    await writeFile(listPath, `${lines.join('\n')}\n`)
  }
  hooks.onStatus('rendering', needsRepeat ? 'Copying playlist loop' : 'Copying playlist')
  await spawnFfmpeg(
    streamCopyConcatArgs({ listPath, outputPath: workPath, targetSeconds: target, loop: false }),
    target,
    wrapProgress(hooks, 0, 0.99),
  )
  return true
}

export function resolveRenderChannels(raw: AudioLooperRenderRequest): number {
  if (raw.targetChannels != null && raw.targetChannels > 0) return Math.round(raw.targetChannels)
  if (raw.sources && raw.sources.length >= 2) {
    return resolveOutputChannels(
      raw.sources.map((source) => source.channels),
      raw.settings.format,
    )
  }
  return resolveOutputChannels([raw.sourceChannels], raw.settings.format)
}

function wrapProgress(hooks: AudioLooperRenderHooks, from: number, to: number): FfmpegHooks {
  return {
    cancelled: hooks.cancelled,
    onProgress: (progress, message) => {
      hooks.onProgress(from + (to - from) * Math.max(0, Math.min(1, progress)), message)
    },
    onStats: hooks.onStats,
    onSpawn: hooks.onSpawn,
    registerKill: hooks.registerKill,
  }
}

function ffmpegPrefix(): string[] {
  return ['-y', '-hide_banner', '-progress', 'pipe:1', '-nostats']
}

function encodeArgs(settings: AudioLooperSettings, plan?: AudioProcessingPlan, counter?: AudioEncodeCounter): string[] {
  const args = looperEncodeArgs({
    format: settings.format,
    mp3BitrateKbps: plan?.targetBitrateKbps ?? settings.mp3Bitrate,
  })
  // Count only the final lossy encode here; intermediate PCM steps are tracked by callers when needed.
  if (settings.format === 'mp3' && counter) counter.recordLossyEncode(1)
  return args
}

/** Volume/fades only — duration is enforced with -t, not unconditional atrim. */
function outputFilter(settings: AudioLooperSettings, duration: number): string | null {
  const parts: string[] = []
  const volume = volumeToFfmpeg(settings.volumePercent)
  if (Math.abs(volume - 1) > 0.001) parts.push(`volume=${n(volume)}`)
  if (settings.fadeInSeconds > 0.01) parts.push(`afade=t=in:st=0:d=${n(settings.fadeInSeconds)}`)
  if (settings.fadeOutSeconds > 0.01) {
    const start = Math.max(0, duration - settings.fadeOutSeconds)
    parts.push(`afade=t=out:st=${n(start)}:d=${n(settings.fadeOutSeconds)}`)
  }
  return parts.length ? parts.join(',') : null
}

function simpleArgs(
  raw: AudioLooperRenderRequest & { id: string },
  workPath: string,
  loop: boolean,
  outputChannels: number,
  plan?: AudioProcessingPlan,
  counter?: AudioEncodeCounter,
): string[] {
  const target = raw.settings.targetDurationSeconds
  const args = [...ffmpegPrefix()]
  if (loop) args.push('-stream_loop', '-1')
  args.push('-i', raw.sourcePath, '-t', n(target), '-vn', '-map', '0:a:0')
  const sampleRate = plan?.expectedSampleRate || raw.sourceSampleRate
  const filter = composeAudioFilter(raw.settings, target, raw.sourceChannels, outputChannels, sampleRate)
  if (filter) args.push('-filter:a', filter)
  args.push(...encodeArgs(raw.settings, plan, counter), workPath)
  return args
}

/** Volume/fades/trim, plus channel normalize when the source layout differs from the target. */
function composeAudioFilter(
  settings: AudioLooperSettings,
  duration: number,
  sourceChannels: number,
  outputChannels: number,
  sampleRate: number,
): string | null {
  const parts: string[] = []
  if (sourceChannels > 0 && sourceChannels !== outputChannels) {
    parts.push(pcmNormalizeFilter(sampleRate > 0 ? sampleRate : 48000, outputChannels))
  } else if (outputChannels > 2 || (sourceChannels > 2 && settings.format === 'mp3')) {
    parts.push(pcmNormalizeFilter(sampleRate > 0 ? sampleRate : 48000, outputChannels))
  }
  const tail = outputFilter(settings, duration)
  if (tail) parts.push(tail)
  return parts.length ? parts.join(',') : null
}

async function renderSeamless(
  raw: AudioLooperRenderRequest & { id: string },
  workPath: string,
  dir: string,
  hooks: AudioLooperRenderHooks,
  outputChannels: number,
  plan?: AudioProcessingPlan,
  counter?: AudioEncodeCounter,
): Promise<void> {
  const D = raw.sourceDuration
  const C = raw.settings.crossfadeSeconds
  const P = D - C
  if (!(P > 0) || C >= D) {
    throw new Error('Crossfade must be shorter than the source audio.')
  }

  const rate = plan?.expectedSampleRate || (raw.sourceSampleRate > 0 ? raw.sourceSampleRate : 48000)
  const pcm = pcmNormalizeFilter(rate, outputChannels)
  const cyclePath = path.join(dir, 'cycle.wav')
  const xfPath = path.join(dir, 'xf.wav')
  const midPath = path.join(dir, 'mid.wav')
  const listPath = path.join(dir, 'cycle.txt')
  const midDuration = D - 2 * C
  const hasMid = midDuration > 0.001

  hooks.onStatus('preparing', 'Building seamless loop cycle')
  await spawnFfmpeg(
    [
      ...ffmpegPrefix(),
      '-i',
      raw.sourcePath,
      '-filter_complex',
      [
        `[0:a]${pcm},asplit=2[head][tail]`,
        `[head]atrim=0:${n(C)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${n(C)}:curve=esin[h]`,
        `[tail]atrim=${n(D - C)}:${n(D)},asetpts=PTS-STARTPTS,afade=t=out:st=0:d=${n(C)}:curve=esin[t]`,
        `[t][h]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[xf]`,
      ].join(';'),
      '-map',
      '[xf]',
      '-t',
      n(C),
      '-vn',
      '-c:a',
      'pcm_s16le',
      xfPath,
    ],
    C,
    wrapProgress(hooks, 0, 0.04),
  )

  if (hooks.cancelled()) throw new RenderCancelled()

  if (hasMid) {
    await spawnFfmpeg(
      [
        ...ffmpegPrefix(),
        '-i',
        raw.sourcePath,
        '-filter:a',
        `${pcm},atrim=${n(C)}:${n(D - C)},asetpts=PTS-STARTPTS`,
        '-t',
        n(midDuration),
        '-vn',
        '-map',
        '0:a:0',
        '-c:a',
        'pcm_s16le',
        midPath,
      ],
      midDuration,
      wrapProgress(hooks, 0.04, 0.07),
    )
    const { writeFile } = await import('node:fs/promises')
    const xfEntry = xfPath.replace(/\\/g, '/')
    const midEntry = midPath.replace(/\\/g, '/')
    await writeFile(listPath, `file '${xfEntry}'\nfile '${midEntry}'\n`)
    await spawnFfmpeg(
      [
        ...ffmpegPrefix(),
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listPath,
        '-c:a',
        'pcm_s16le',
        cyclePath,
      ],
      P,
      wrapProgress(hooks, 0.07, 0.09),
    )
  } else {
    await copyFile(xfPath, cyclePath)
  }

  if (hooks.cancelled()) throw new RenderCancelled()
  hooks.onStatus('rendering', 'Encoding seamless loop')

  const target = raw.settings.targetDurationSeconds
  const filter = outputFilter(raw.settings, target)
  const args = [...ffmpegPrefix(), '-stream_loop', '-1', '-i', cyclePath, '-t', n(target), '-vn', '-map', '0:a:0']
  if (filter) args.push('-filter:a', filter)
  args.push(...encodeArgs(raw.settings, plan, counter), workPath)
  await spawnFfmpeg(args, target, wrapProgress(hooks, 0.08, 0.99))
}

const FALLBACK_SAMPLE_RATE = 48000
const LIMITER = 'alimiter=limit=0.95:level=disabled'

export function playlistStreamArgs(
  cyclePath: string,
  settings: AudioLooperSettings,
  workPath: string,
  loop: boolean,
  plan?: AudioProcessingPlan,
  counter?: AudioEncodeCounter,
): string[] {
  const target = settings.targetDurationSeconds
  const args = [...ffmpegPrefix()]
  if (loop) args.push('-stream_loop', '-1')
  args.push('-i', cyclePath, '-t', n(target), '-vn', '-map', '0:a:0')
  const filter = outputFilter(settings, target)
  if (filter) args.push('-filter:a', filter)
  args.push(...encodeArgs(settings, plan, counter), workPath)
  return args
}

async function maybeTrimSource(
  raw: AudioLooperRenderRequest & { id: string },
  dir: string,
  hooks: AudioLooperRenderHooks,
  outputChannels: number,
): Promise<AudioLooperRenderRequest & { id: string }> {
  const track = raw.settings.tracks?.[0]
  if (!track) return raw
  const untouched = track.trimStart <= 0.03 && track.trimEnd >= raw.sourceDuration - 0.05
  if (untouched) return raw
  const trimEnd = Math.min(track.trimEnd, raw.sourceDuration)
  const duration = trimEnd - track.trimStart
  if (!(duration > 0)) throw new Error('Each trim must be longer than zero.')
  const trimmedPath = path.join(dir, 'trimmed.wav')
  const pcm = pcmNormalizeFilter(raw.sourceSampleRate > 0 ? raw.sourceSampleRate : FALLBACK_SAMPLE_RATE, outputChannels)
  hooks.onStatus('preparing', 'Trimming audio')
  await spawnFfmpeg(
    [
      ...ffmpegPrefix(),
      '-i',
      raw.sourcePath,
      '-filter:a',
      `atrim=${n(track.trimStart)}:${n(trimEnd)},asetpts=PTS-STARTPTS,${pcm}`,
      '-t',
      n(duration),
      '-vn',
      '-c:a',
      'pcm_s16le',
      trimmedPath,
    ],
    duration,
    wrapProgress(hooks, 0, 0.08),
  )
  return {
    ...raw,
    sourcePath: trimmedPath,
    sourceDuration: duration,
    sourceSampleRate: raw.sourceSampleRate > 0 ? raw.sourceSampleRate : FALLBACK_SAMPLE_RATE,
    sourceChannels: outputChannels,
    targetChannels: outputChannels,
  }
}

async function renderPlaylist(
  raw: AudioLooperRenderRequest & { id: string },
  workPath: string,
  dir: string,
  hooks: AudioLooperRenderHooks,
  outputChannels: number,
  plan?: AudioProcessingPlan,
  counter?: AudioEncodeCounter,
): Promise<void> {
  const sources = raw.sources ?? []
  const durations = sources.map((source) => source.trimEnd - source.trimStart)
  const crossfadeOn = raw.settings.playlistCrossfade
  const crossfade = crossfadeOn ? raw.settings.playlistCrossfadeSeconds : 0
  const period = assertPlaylistTimeline(durations, crossfadeOn, crossfade)
  const analyzeEnd = raw.settings.normalizeLoudness ? 0.4 : 0.18
  const sampleRate =
    plan?.expectedSampleRate ||
    Math.max(...sources.map((s) => s.sampleRate).filter((r) => r > 0), FALLBACK_SAMPLE_RATE)
  const pcm = pcmNormalizeFilter(sampleRate, outputChannels)

  const prepared: string[] = []
  for (let index = 0; index < sources.length; index += 1) {
    if (hooks.cancelled()) throw new RenderCancelled()
    const source = sources[index]
    if (!source) continue
    const label = raw.settings.normalizeLoudness
      ? `Matching loudness ${index + 1} of ${sources.length}`
      : `Preparing track ${index + 1} of ${sources.length}`
    hooks.onStatus('preparing', label)
    const out = path.join(dir, `track-${index}.wav`)
    const from = (index / sources.length) * analyzeEnd
    const to = ((index + 1) / sources.length) * analyzeEnd
    await prepareTrack(source, out, raw.settings.normalizeLoudness, pcm, hooks, from, to)
    prepared.push(out)
  }

  if (hooks.cancelled()) throw new RenderCancelled()
  hooks.onStatus('preparing', 'Building the sequence')
  const cyclePath = path.join(dir, 'cycle.wav')
  if (crossfadeOn) {
    await buildCrossfadeCycle(prepared, durations, crossfade, period, cyclePath, dir, hooks, analyzeEnd, pcm)
  } else {
    await concatWavs(prepared, cyclePath, period, raw.settings.normalizeLoudness, hooks, analyzeEnd, analyzeEnd + 0.08)
  }

  if (hooks.cancelled()) throw new RenderCancelled()
  const target = raw.settings.targetDurationSeconds
  const loop = period < target - 0.001
  hooks.onStatus('rendering', loop ? 'Encoding loop' : 'Trimming audio')
  await spawnFfmpeg(
    playlistStreamArgs(cyclePath, raw.settings, workPath, loop, plan, counter),
    target,
    wrapProgress(hooks, analyzeEnd + 0.1, 0.99),
  )
}

async function prepareTrack(
  source: AudioLooperPlaylistSource,
  outPath: string,
  normalize: boolean,
  pcm: string,
  hooks: AudioLooperRenderHooks,
  from: number,
  to: number,
): Promise<void> {
  const duration = source.trimEnd - source.trimStart
  const trimmed = `atrim=${n(source.trimStart)}:${n(source.trimEnd)},asetpts=PTS-STARTPTS,${pcm}`
  if (!normalize) {
    await spawnFfmpeg(
      [...ffmpegPrefix(), '-i', source.path, '-filter:a', trimmed, '-t', n(duration), '-vn', '-c:a', 'pcm_s16le', outPath],
      duration,
      wrapProgress(hooks, from, to),
    )
    return
  }
  const measured = await spawnFfmpeg(
    [
      ...ffmpegPrefix(),
      '-i',
      source.path,
      '-filter:a',
      `${trimmed},loudnorm=I=${LOUDNESS_TARGET_I}:TP=${LOUDNESS_TARGET_TP}:LRA=${LOUDNESS_TARGET_LRA}:print_format=json`,
      '-f',
      'null',
      '-',
    ],
    duration,
    wrapProgress(hooks, from, from + (to - from) * 0.45),
  )
  const stats = parseLoudnorm(measured)
  const loudness = stats
    ? `loudnorm=I=${LOUDNESS_TARGET_I}:TP=${LOUDNESS_TARGET_TP}:LRA=${LOUDNESS_TARGET_LRA}:measured_I=${stats.i}:measured_TP=${stats.tp}:measured_LRA=${stats.lra}:measured_thresh=${stats.thresh}:offset=${stats.offset}:linear=true`
    : `loudnorm=I=${LOUDNESS_TARGET_I}:TP=${LOUDNESS_TARGET_TP}:LRA=${LOUDNESS_TARGET_LRA}`
  await spawnFfmpeg(
    [
      ...ffmpegPrefix(),
      '-i',
      source.path,
      '-filter:a',
      `${trimmed},${loudness}`,
      '-t',
      n(duration),
      '-vn',
      '-c:a',
      'pcm_s16le',
      outPath,
    ],
    duration,
    wrapProgress(hooks, from + (to - from) * 0.45, to),
  )
}

function parseLoudnorm(stderr: string): { i: string; tp: string; lra: string; thresh: string; offset: string } | null {
  const blocks = stderr.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/g)
  const raw = blocks?.at(-1)
  if (!raw) return null
  try {
    const json = JSON.parse(raw) as Record<string, unknown>
    const i = loudnormNumber(json.input_i)
    const tp = loudnormNumber(json.input_tp)
    const lra = loudnormNumber(json.input_lra)
    const thresh = loudnormNumber(json.input_thresh)
    const offset = loudnormNumber(json.target_offset)
    if (!i || !tp || !lra || !thresh || !offset) return null
    return { i, tp, lra, thresh, offset }
  } catch {
    return null
  }
}

function loudnormNumber(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).trim()
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null
  return text
}

async function buildCrossfadeCycle(
  tracks: string[],
  durations: number[],
  crossfade: number,
  period: number,
  cyclePath: string,
  dir: string,
  hooks: AudioLooperRenderHooks,
  progressFrom: number,
  pcm: string,
): Promise<void> {
  let current = tracks[0]
  let currentDuration = durations[0] ?? 0
  if (!current) throw new Error('Add at least two tracks.')
  for (let index = 1; index < tracks.length; index += 1) {
    if (hooks.cancelled()) throw new RenderCancelled()
    const next = tracks[index]
    if (!next) continue
    const joined = path.join(dir, `join-${index}.wav`)
    const outDuration = currentDuration + (durations[index] ?? 0) - crossfade
    await spawnFfmpeg(
      [
        ...ffmpegPrefix(),
        '-i',
        current,
        '-i',
        next,
        '-filter_complex',
        `[0:a][1:a]acrossfade=d=${n(crossfade)}:c1=esin:c2=esin,${pcm}`,
        '-t',
        n(outDuration),
        '-c:a',
        'pcm_s16le',
        joined,
      ],
      outDuration,
      wrapProgress(hooks, progressFrom, progressFrom + 0.06),
    )
    current = joined
    currentDuration = outDuration
  }

  const bodyDuration = currentDuration
  const expectedBody = playlistPeriod(durations, 0) - (durations.length - 1) * crossfade
  if (Math.abs(bodyDuration - expectedBody) > 0.25 && bodyDuration + 1e-3 < crossfade * 2) {
    throw new Error('Crossfade removes the whole sequence. Shorten the transition.')
  }

  const xfPath = path.join(dir, 'xf.wav')
  await spawnFfmpeg(
    [
      ...ffmpegPrefix(),
      '-i',
      current,
      '-filter_complex',
      [
        '[0:a]asplit=2[head][tail]',
        `[head]atrim=0:${n(crossfade)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${n(crossfade)}:curve=esin[h]`,
        `[tail]atrim=${n(Math.max(0, bodyDuration - crossfade))}:${n(bodyDuration)},asetpts=PTS-STARTPTS,afade=t=out:st=0:d=${n(crossfade)}:curve=esin[t]`,
        '[t][h]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[xf]',
      ].join(';'),
      '-map',
      '[xf]',
      '-t',
      n(crossfade),
      '-c:a',
      'pcm_s16le',
      xfPath,
    ],
    crossfade,
    wrapProgress(hooks, progressFrom + 0.06, progressFrom + 0.08),
  )

  const midDuration = bodyDuration - 2 * crossfade
  if (midDuration > 0.001) {
    const midPath = path.join(dir, 'mid.wav')
    await spawnFfmpeg(
      [
        ...ffmpegPrefix(),
        '-i',
        current,
        '-filter:a',
        `atrim=${n(crossfade)}:${n(bodyDuration - crossfade)},asetpts=PTS-STARTPTS`,
        '-t',
        n(midDuration),
        '-vn',
        '-c:a',
        'pcm_s16le',
        midPath,
      ],
      midDuration,
      wrapProgress(hooks, progressFrom + 0.08, progressFrom + 0.1),
    )
    await concatWavs([xfPath, midPath], cyclePath, period, true, hooks, progressFrom + 0.1, progressFrom + 0.12)
    return
  }
  await spawnFfmpeg(
    [
      ...ffmpegPrefix(),
      '-i',
      xfPath,
      '-filter:a',
      `${LIMITER},atrim=0:${n(period)},asetpts=PTS-STARTPTS`,
      '-t',
      n(period),
      '-c:a',
      'pcm_s16le',
      cyclePath,
    ],
    period,
    wrapProgress(hooks, progressFrom + 0.08, progressFrom + 0.12),
  )
}

async function concatWavs(
  files: string[],
  outPath: string,
  duration: number,
  limit: boolean,
  hooks: AudioLooperRenderHooks,
  from: number,
  to: number,
): Promise<void> {
  const tail = limit ? `${LIMITER},` : ''
  const filterTail = `${tail}atrim=0:${n(duration)},asetpts=PTS-STARTPTS`
  if (files.length <= 1) {
    const only = files[0]
    if (!only) throw new Error('The sequence is empty.')
    await spawnFfmpeg(
      [...ffmpegPrefix(), '-i', only, '-filter:a', filterTail, '-t', n(duration), '-c:a', 'pcm_s16le', outPath],
      duration,
      wrapProgress(hooks, from, to),
    )
    return
  }
  const inputs = files.flatMap((file) => ['-i', file])
  const pads = files.map((_, index) => `[${index}:a]`).join('')
  await spawnFfmpeg(
    [
      ...ffmpegPrefix(),
      ...inputs,
      '-filter_complex',
      `${pads}concat=n=${files.length}:v=0:a=1,${filterTail}`,
      '-t',
      n(duration),
      '-c:a',
      'pcm_s16le',
      outPath,
    ],
    duration,
    wrapProgress(hooks, from, to),
  )
}

async function moveOutput(from: string, to: string): Promise<void> {
  await mkdir(path.dirname(to), { recursive: true })
  try {
    await rename(from, to)
  } catch {
    await copyFile(from, to)
    await rm(from, { force: true }).catch(() => undefined)
  }
}
