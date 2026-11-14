/**
 * Unified Screensaver audio mux: stream-copy when plain+compatible, else one AAC encode.
 * Looper-plan recipes must honor the planner end-to-end (no unconditional WAV intermediate).
 */

import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { LooperAudioRecipe } from '../../shared/looperAudioRecipe'
import { assertPlaylistTimeline } from '../../shared/audioLooperPlaylist'
import {
  maxReliableSourceBitrateBps,
  planAudioProcessing,
  sourceNeedsSampleAccurateTrim,
  type AudioProcessingPlan,
  type AudioSourceProbe,
} from '../../shared/audioProcessingPlan'
import {
  aacEncodeArgs,
  AudioEncodeCounter,
  buildScreensaverAudioFilter,
  canStreamCopyIntoMp4,
  logAudioExport,
  logAudioPlan,
  pcmBitrateBps,
  streamCopyConcatArgs,
} from './audioProcessing'
import {
  assessAudioDuration,
  logDurationAssessment,
  streamCopyTrimToDuration,
} from './audioDurationRecovery'
import { n, spawnFfmpeg, type FfmpegHooks } from './ffmpegUtil'
import { probeAudioDetails } from './probe'
import { getAudioAsset, recipeSourcePaths, type StoredAudioAsset } from './audioAssets'
import { renderAudioLooper } from './renderAudioLooper'
import { jobsDir } from './storage'

export interface ScreensaverAudioJobLike {
  id: string
  duration: number
  audioMode: string
  audioVolume: number
  audioFadeIn: number
  audioFadeOut: number
  loopAudio: boolean
  musicPath?: string | null
  audioAssetId?: string | null
  sourceHasAudio?: boolean
  sourceAudioCodec?: string | null
  mediaKind?: string
  mediaPath?: string
}

export interface ScreensaverAudioMuxResult {
  processingStrategy: AudioProcessingPlan['strategy']
  processingLabel: AudioProcessingPlan['userLabel']
  processingReason: string
  lossyEncodeCount: number
  losslessEncodeCount: number
  streamCopy: boolean
  decodeRequired: boolean
}

function assetProbes(asset: StoredAudioAsset): AudioSourceProbe[] {
  if (asset.recipe?.tracks?.length) {
    return asset.recipe.tracks.map((track) => track.probe)
  }
  return [
    {
      codec: asset.codec,
      bitrate: asset.bitrate || 0,
      sampleRate: asset.sampleRate,
      channels: asset.channels,
      duration: asset.duration,
    },
  ]
}

function normalizeCodecName(codec: string | null | undefined): string {
  return (codec ?? '').toLowerCase().trim()
}

function isMp3Codec(codec: string): boolean {
  return codec === 'mp3' || codec === 'mp3float'
}

function isAacCodec(codec: string): boolean {
  return codec === 'aac' || codec === 'aac_latm'
}

/** True when Looper transforms require a decoded intermediate (not volume/fades alone). */
function recipeNeedsDecodedIntermediate(
  recipe: LooperAudioRecipe,
  probes: AudioSourceProbe[],
  sourceCount: number,
): boolean {
  if (recipe.settings.loopMode === 'seamless' && sourceCount === 1) return true
  if (sourceCount >= 2 && recipe.settings.playlistCrossfade) return true
  if (sourceCount >= 2 && recipe.settings.normalizeLoudness) return true
  if (probes.some((probe) => sourceNeedsSampleAccurateTrim(probe))) return true
  if (sourceCount >= 2) {
    const rates = probes.map((p) => Math.round(p.sampleRate)).filter((r) => r > 0)
    if (new Set(rates).size > 1) return true
    const channels = probes.map((p) => Math.round(p.channels))
    if (new Set(channels).size > 1) return true
    const codecs = probes.map((p) => normalizeCodecName(p.codec))
    if (new Set(codecs).size > 1) return true
  }
  return false
}

function recipePeriodSeconds(recipe: LooperAudioRecipe, probes: AudioSourceProbe[]): number {
  if (probes.length >= 2) {
    const durations = probes.map((probe) => (probe.trimEnd ?? probe.duration) - (probe.trimStart ?? 0))
    return assertPlaylistTimeline(
      durations,
      Boolean(recipe.settings.playlistCrossfade),
      recipe.settings.playlistCrossfadeSeconds,
    )
  }
  const probe = probes[0]
  if (!probe) return 0
  return Math.max(0, (probe.trimEnd ?? probe.duration) - (probe.trimStart ?? 0))
}

interface PreparedRecipeAudio {
  musicPath: string
  codec: string | null
  /** Bitrate of the original uploaded lossy/lossless sources (planning). */
  originalSourceBitrate: number
  /** Actual bitrate of the file at musicPath (probe or PCM formula). */
  currentStreamBitrate: number
  sampleRate: number
  channels: number
  /** Volume/fades already applied — mux must not apply them again. */
  gainBaked: boolean
  /** Combined looper×screensaver gain when gain is not baked. */
  muxVolume: number
  muxFadeIn: number
  muxFadeOut: number
  counter: AudioEncodeCounter
  plannedStrategy: AudioProcessingPlan['strategy']
  plannedReason: string
  strategyChangeReason?: string
}

function combinedMuxGain(
  job: ScreensaverAudioJobLike,
  recipe: LooperAudioRecipe,
): { volume: number; fadeIn: number; fadeOut: number } {
  return {
    volume: (recipe.settings.volumePercent / 100) * job.audioVolume,
    fadeIn: Math.max(recipe.settings.fadeInSeconds, job.audioFadeIn),
    fadeOut: Math.max(recipe.settings.fadeOutSeconds, job.audioFadeOut),
  }
}

async function materializeStreamCopyPlaylist(
  job: ScreensaverAudioJobLike,
  sources: string[],
  probes: AudioSourceProbe[],
  originalSourceBitrate: number,
  hooks: FfmpegHooks,
): Promise<PreparedRecipeAudio> {
  const dir = path.join(jobsDir, job.id, 'audio-recipe')
  await mkdir(dir, { recursive: true })
  const codec = normalizeCodecName(probes[0]?.codec)
  const ext = isAacCodec(codec) ? '.m4a' : isMp3Codec(codec) ? '.mp3' : '.bin'
  const outputPath = path.join(dir, `stream-copy-period${ext}`)
  const listPath = path.join(dir, 'concat-copy.txt')
  const lines: string[] = []
  for (let index = 0; index < sources.length; index += 1) {
    const sourcePath = sources[index]!
    const probe = probes[index]
    const file = sourcePath.replace(/\\/g, '/').replace(/'/g, "'\\''")
    lines.push(`file '${file}'`)
    const trimStart = probe?.trimStart ?? 0
    const trimEnd = probe?.trimEnd ?? probe?.duration ?? 0
    const duration = probe?.duration ?? 0
    if (trimStart > 0.03) lines.push(`inpoint ${n(trimStart)}`)
    if (duration > 0 && trimEnd < duration - 0.05) lines.push(`outpoint ${n(trimEnd)}`)
  }
  await writeFile(listPath, `${lines.join('\n')}\n`)
  // STREAM_COPY playlists never use crossfade; period is the sum of trimmed lengths.
  const durations = probes.map((probe) => (probe.trimEnd ?? probe.duration) - (probe.trimStart ?? 0))
  const periodSeconds = Math.min(assertPlaylistTimeline(durations, false, 0), job.duration)

  await spawnFfmpeg(
    streamCopyConcatArgs({
      listPath,
      outputPath,
      targetSeconds: periodSeconds,
      loop: false,
    }),
    periodSeconds,
    {
      cancelled: hooks.cancelled,
      onProgress: (progress, message) => hooks.onProgress(Math.min(0.4, progress * 0.4), message ?? 'Copying playlist'),
      onStats: hooks.onStats,
      onSpawn: hooks.onSpawn,
      registerKill: hooks.registerKill,
    },
  )

  let details = await probeAudioDetails(outputPath)
  const assessment = assessAudioDuration({
    targetSeconds: periodSeconds,
    streamDuration: details.streamDuration,
    containerDuration: details.containerDuration,
    startTime: details.startTime,
  })
  if (assessment.verdict === 'overshoot') {
    logDurationAssessment(assessment, { recoveryStrategy: 'STREAM_COPY_TRIM', attempt: 1 })
    const trimPath = path.join(dir, `stream-copy-period-trim${ext}`)
    await streamCopyTrimToDuration({
      sourcePath: outputPath,
      outputPath: trimPath,
      targetSeconds: periodSeconds,
      hooks: {
        cancelled: hooks.cancelled,
        onProgress: (progress, message) =>
          hooks.onProgress(Math.min(0.42, 0.4 + progress * 0.02), message ?? 'Trimming stream copy'),
        onStats: hooks.onStats,
        onSpawn: hooks.onSpawn,
        registerKill: hooks.registerKill,
      },
    })
    await renameQuiet(trimPath, outputPath)
    details = await probeAudioDetails(outputPath)
  }
  const counter = new AudioEncodeCounter()
  return {
    musicPath: outputPath,
    codec: details.codec ?? probes[0]?.codec ?? null,
    originalSourceBitrate,
    currentStreamBitrate: details.bitrate || originalSourceBitrate,
    sampleRate: details.sampleRate || probes[0]?.sampleRate || 0,
    channels: details.channels || probes[0]?.channels || 2,
    gainBaked: false,
    muxVolume: 1,
    muxFadeIn: 0,
    muxFadeOut: 0,
    counter,
    plannedStrategy: 'STREAM_COPY',
    plannedReason: 'MP3/AAC playlist stream copy into intermediate, then mux copy.',
  }
}

/**
 * Prepare looper-plan audio for mux without overriding STREAM_COPY via an unconditional WAV.
 */
async function materializeRecipeAudio(
  job: ScreensaverAudioJobLike,
  asset: StoredAudioAsset,
  hooks: FfmpegHooks,
): Promise<PreparedRecipeAudio | null> {
  if (!asset.recipe || asset.origin !== 'looper-plan') return null
  const recipe = asset.recipe
  const sources = recipeSourcePaths(asset)
  const probes = assetProbes(asset)
  const originalSourceBitrate = Math.max(
    maxReliableSourceBitrateBps(probes),
    (recipe.settings.mp3Bitrate || 0) * 1000,
  )
  const gain = combinedMuxGain(job, recipe)
  const plainMux = canStreamCopyIntoMp4({
    codec: probes[0]?.codec,
    volume: gain.volume,
    fadeIn: gain.fadeIn,
    fadeOut: gain.fadeOut,
  })
  const plan = planAudioProcessing({
    sources: probes,
    destination: plainMux ? 'mp4-copy' : 'mp4-aac',
    operations: {
      loopMode: recipe.settings.loopMode,
      volumePercent: recipe.settings.volumePercent,
      fadeInSeconds: recipe.settings.fadeInSeconds,
      fadeOutSeconds: recipe.settings.fadeOutSeconds,
      seamlessCrossfade: recipe.settings.loopMode === 'seamless',
      playlistCrossfade: recipe.settings.playlistCrossfade,
      playlistCrossfadeSeconds: recipe.settings.playlistCrossfadeSeconds,
      normalizeLoudness: recipe.settings.normalizeLoudness,
      userMp3Bitrate: recipe.settings.mp3Bitrate,
      muxVolume: job.audioVolume,
      muxFadeIn: job.audioFadeIn,
      muxFadeOut: job.audioFadeOut,
    },
  })
  logAudioPlan(plan, probes, {
    originalSourceBitrate,
    currentStreamBitrate: probes[0]?.bitrate || originalSourceBitrate,
    targetEncodingBitrate: plan.targetBitrateKbps != null ? plan.targetBitrateKbps * 1000 : null,
  })

  // --- STREAM_COPY: never decode, never WAV ---
  if (plan.strategy === 'STREAM_COPY') {
    if (sources.length === 1) {
      console.info('[AudioExport] Honoring STREAM_COPY: original source packets (no WAV intermediate).')
      return {
        musicPath: sources[0]!,
        codec: probes[0]?.codec ?? null,
        originalSourceBitrate,
        currentStreamBitrate: probes[0]?.bitrate || originalSourceBitrate,
        sampleRate: probes[0]?.sampleRate ?? 0,
        channels: probes[0]?.channels ?? 0,
        gainBaked: false,
        muxVolume: 1,
        muxFadeIn: 0,
        muxFadeOut: 0,
        counter: new AudioEncodeCounter(),
        plannedStrategy: 'STREAM_COPY',
        plannedReason: plan.reason,
      }
    }
    console.info('[AudioExport] Honoring STREAM_COPY: packet-preserving playlist concat (no WAV).')
    return materializeStreamCopyPlaylist(job, sources, probes, originalSourceBitrate, hooks)
  }

  // --- Volume/fades (and similar) without complex Looper graph: direct source → AAC at mux ---
  const needsIntermediate = recipeNeedsDecodedIntermediate(recipe, probes, sources.length)
  if (!needsIntermediate && sources.length === 1) {
    console.info(
      `[AudioExport] ${plan.strategy}: skipping WAV intermediate; direct source→AAC at mux. Reason: ${plan.reason}`,
    )
    return {
      musicPath: sources[0]!,
      codec: probes[0]?.codec ?? null,
      originalSourceBitrate,
      currentStreamBitrate: probes[0]?.bitrate || originalSourceBitrate,
      sampleRate: probes[0]?.sampleRate ?? 0,
      channels: probes[0]?.channels ?? 2,
      gainBaked: false,
      muxVolume: gain.volume,
      muxFadeIn: gain.fadeIn,
      muxFadeOut: gain.fadeOut,
      counter: new AudioEncodeCounter(),
      plannedStrategy: plan.strategy,
      plannedReason: plan.reason,
    }
  }

  // --- Complex Looper transforms: one loop period as WAV (not full job duration), then one AAC at mux ---
  const period = Math.max(0.25, Math.min(recipePeriodSeconds(recipe, probes), job.duration))
  console.info(
    `[AudioExport] ${plan.strategy}: WAV intermediate for one loop period (${period.toFixed(3)}s) — ${plan.reason}`,
  )
  const dir = path.join(jobsDir, job.id, 'audio-recipe')
  await mkdir(dir, { recursive: true })
  const settings = {
    ...recipe.settings,
    targetDurationSeconds: period,
    format: 'wav' as const,
    // Edge fades belong on the full mux timeline; keep period gain at looper volume only.
    volumePercent: recipe.settings.volumePercent,
    fadeInSeconds: 0,
    fadeOutSeconds: 0,
  }
  const playlist =
    sources.length >= 2
      ? sources.map((sourcePath, index) => {
          const track = recipe.tracks[index]
          const probe = track?.probe
          return {
            path: sourcePath,
            duration: probe?.duration ?? 0,
            sampleRate: probe?.sampleRate ?? 0,
            channels: probe?.channels ?? 0,
            trimStart: probe?.trimStart ?? 0,
            trimEnd: probe?.trimEnd ?? probe?.duration ?? 0,
            codec: probe?.codec,
            bitrate: probe?.bitrate,
            streamBitrate: probe?.streamBitrate,
            containerBitrate: probe?.containerBitrate,
            channelLayout: probe?.channelLayout,
          }
        })
      : undefined

  const result = await renderAudioLooper(
    {
      id: `${job.id}-audio`,
      sourcePath: sources[0]!,
      sourceDuration: probes[0]?.duration ?? 0,
      sourceSampleRate: probes[0]?.sampleRate ?? 0,
      sourceChannels: probes[0]?.channels ?? 0,
      sourceCodec: probes[0]?.codec,
      sourceBitrate: probes[0]?.bitrate,
      settings,
      sources: playlist,
    },
    {
      cancelled: hooks.cancelled,
      onProgress: (progress, message) => hooks.onProgress(Math.min(0.45, progress * 0.45), message),
      onStats: hooks.onStats,
      onSpawn: hooks.onSpawn,
      onStatus: (_status, message) => {
        hooks.onProgress(0.05, message)
      },
      registerKill: hooks.registerKill,
    },
  )

  const wavDetails = await probeAudioDetails(result.outputPath).catch(() => null)
  const sampleRate = wavDetails?.sampleRate || plan.expectedSampleRate || probes[0]?.sampleRate || 0
  const channels = wavDetails?.channels || plan.expectedChannels || probes[0]?.channels || 2
  const actualPcmBitrate =
    wavDetails && normalizeCodecName(wavDetails.codec).startsWith('pcm')
      ? pcmBitrateBps(sampleRate, channels, wavDetails.bitsPerSample || 16) || wavDetails.bitrate
      : pcmBitrateBps(sampleRate, channels, 16)

  const counter = new AudioEncodeCounter()
  counter.recordDecode(1)
  counter.recordLosslessEncode(1)
  // Carry any lossy from unexpected looper path (should be 0 for wav).
  counter.recordLossyEncode(result.lossyEncodeCount)

  return {
    musicPath: result.outputPath,
    codec: 'pcm_s16le',
    originalSourceBitrate,
    currentStreamBitrate: actualPcmBitrate,
    sampleRate,
    channels,
    // Looper volume baked into period; screensaver fades/volume still applied at mux for end-of-video fades.
    gainBaked: false,
    muxVolume: job.audioVolume,
    muxFadeIn: job.audioFadeIn,
    muxFadeOut: job.audioFadeOut,
    counter,
    plannedStrategy: plan.strategy,
    plannedReason: plan.reason,
  }
}

export async function muxScreensaverAudio(opts: {
  job: ScreensaverAudioJobLike
  videoPath: string
  outputPath: string
  workDir: string
  durationSec: number
  hooks: FfmpegHooks
  /** When true, video input is already the only input index 0. */
  copyVideo: boolean
}): Promise<ScreensaverAudioMuxResult> {
  const { job, videoPath, outputPath, workDir, durationSec, hooks, copyVideo } = opts
  const counter = new AudioEncodeCounter()
  const args = ['-y', '-hide_banner', '-progress', 'pipe:1', '-nostats', '-i', videoPath]

  if (job.audioVolume <= 0.001 || (job.audioMode === 'upload' && !job.musicPath && !job.audioAssetId)) {
    args.push(
      '-map',
      '0:v:0',
      '-c:v',
      'copy',
      '-an',
      '-t',
      n(durationSec + 0.02),
      '-movflags',
      '+faststart',
      outputPath,
    )
    await spawnFfmpeg(args, durationSec, hooks)
    return {
      processingStrategy: 'STREAM_COPY',
      processingLabel: 'Original Stream Preserved',
      processingReason: 'No audio',
      lossyEncodeCount: 0,
      losslessEncodeCount: 0,
      streamCopy: true,
      decodeRequired: false,
    }
  }

  let musicPath = job.musicPath ?? null
  let codec = job.sourceAudioCodec ?? null
  let originalSourceBitrate = 0
  let currentStreamBitrate = 0
  let sampleRate = 0
  let channels = 2
  let muxVolume = job.audioVolume
  let muxFadeIn = job.audioFadeIn
  let muxFadeOut = job.audioFadeOut
  let plannedStrategy: AudioProcessingPlan['strategy'] | null = null
  let plannedReason = ''
  let strategyChangeReason: string | undefined

  const asset = job.audioAssetId ? getAudioAsset(job.audioAssetId) : undefined
  if (asset?.origin === 'looper-plan' && asset.recipe) {
    const prepared = await materializeRecipeAudio(job, asset, hooks)
    if (prepared) {
      musicPath = prepared.musicPath
      codec = prepared.codec
      originalSourceBitrate = prepared.originalSourceBitrate
      currentStreamBitrate = prepared.currentStreamBitrate
      sampleRate = prepared.sampleRate
      channels = prepared.channels || 2
      muxVolume = prepared.muxVolume
      muxFadeIn = prepared.muxFadeIn
      muxFadeOut = prepared.muxFadeOut
      plannedStrategy = prepared.plannedStrategy
      plannedReason = prepared.plannedReason
      strategyChangeReason = prepared.strategyChangeReason
      counter.mergeFrom(prepared.counter)
    }
  } else if (asset) {
    musicPath = asset.path
    codec = asset.codec
    originalSourceBitrate = asset.bitrate
    currentStreamBitrate = asset.bitrate
    sampleRate = asset.sampleRate
    channels = asset.channels
  } else if (musicPath) {
    try {
      const details = await probeAudioDetails(musicPath)
      codec = details.codec
      originalSourceBitrate = details.bitrate
      currentStreamBitrate = details.bitrate
      sampleRate = details.sampleRate
      channels = details.channels
    } catch {
      // Keep unknowns; re-encode path will still run.
    }
  }

  const probes: AudioSourceProbe[] = [
    {
      codec,
      bitrate: originalSourceBitrate || currentStreamBitrate,
      streamBitrate: currentStreamBitrate,
      sampleRate: sampleRate || 48000,
      channels: channels || 2,
      duration: durationSec,
    },
  ]
  const plain = canStreamCopyIntoMp4({
    codec,
    volume: muxVolume,
    fadeIn: muxFadeIn,
    fadeOut: muxFadeOut,
  })
  const wavMaterialized = normalizeCodecName(codec).startsWith('pcm') || normalizeCodecName(codec) === 'flac'
  let plan = planAudioProcessing({
    sources: probes,
    destination: plain && !wavMaterialized ? 'mp4-copy' : 'mp4-aac',
    operations: {
      muxVolume,
      muxFadeIn,
      muxFadeOut,
      userMp3Bitrate: asset?.recipe?.settings.mp3Bitrate,
    },
  })

  // If recipe already decided STREAM_COPY and the prepared file is still copyable, keep it.
  if (plannedStrategy === 'STREAM_COPY' && plain && !wavMaterialized) {
    plan = {
      ...plan,
      strategy: 'STREAM_COPY',
      reason: plannedReason || plan.reason,
      reencodeRequired: false,
      lossyEncodeBudget: 0,
      userLabel: 'Original Stream Preserved',
      targetBitrateKbps: null,
      bitratePolicy: 'preserve',
    }
  } else if (plannedStrategy === 'STREAM_COPY' && (wavMaterialized || !plain)) {
    strategyChangeReason =
      strategyChangeReason ||
      `STREAM_COPY overridden at mux: ${wavMaterialized ? 'intermediate is PCM/FLAC' : 'volume/fades require encode'}`
    console.info(`[AudioExport] Strategy changed: ${strategyChangeReason}`)
  }

  logAudioPlan(plan, probes, {
    originalSourceBitrate,
    currentStreamBitrate,
    targetEncodingBitrate: plan.targetBitrateKbps != null ? plan.targetBitrateKbps * 1000 : null,
  })

  if (plan.strategy === 'STREAM_COPY' && musicPath && plain && !wavMaterialized) {
    if (job.audioMode === 'upload' || asset) {
      if (job.loopAudio) args.push('-stream_loop', '-1')
      args.push('-i', musicPath)
    } else if (job.audioMode === 'source' && job.mediaPath) {
      args.push('-stream_loop', '-1', '-i', job.mediaPath)
    }
    args.push(
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'copy',
      '-c:a',
      'copy',
      '-t',
      n(durationSec + 0.02),
      '-movflags',
      '+faststart',
      outputPath,
    )
    await spawnFfmpeg(args, durationSec, hooks)
    let actualOutputBitrate = currentStreamBitrate
    try {
      const out = await probeAudioDetails(outputPath)
      actualOutputBitrate = out.bitrate || actualOutputBitrate
    } catch {
      // optional
    }
    logAudioExport({
      streamCopy: true,
      decodeRequired: false,
      losslessEncodeCount: counter.losslessEncodeCount,
      lossyEncodeCount: counter.lossyEncodeCount,
      verification: 'Passed',
      actualOutputBitrate,
    })
    return {
      processingStrategy: 'STREAM_COPY',
      processingLabel: 'Original Stream Preserved',
      processingReason: plan.reason,
      lossyEncodeCount: counter.lossyEncodeCount,
      losslessEncodeCount: counter.losslessEncodeCount,
      streamCopy: true,
      decodeRequired: false,
    }
  }

  // Single filter + one AAC/MP3 encode (at most one additional lossy encode).
  const lines: string[] = []
  if ((job.audioMode === 'upload' || asset) && musicPath) {
    if (job.loopAudio) args.push('-stream_loop', '-1')
    args.push('-i', musicPath)
    lines.push(
      buildScreensaverAudioFilter({
        inputLabel: '1:a',
        volume: muxVolume,
        fadeIn: muxFadeIn,
        fadeOut: muxFadeOut,
        duration: durationSec,
        sampleRate: plan.expectedSampleRate,
        channels: plan.expectedChannels,
        forceResample: sampleRate > 0 && Math.round(sampleRate) !== plan.expectedSampleRate,
        forceStereo: plan.expectedChannels === 2 && channels !== 2,
      }),
    )
  } else if (job.audioMode === 'source' && job.mediaPath) {
    args.push('-stream_loop', '-1', '-i', job.mediaPath)
    lines.push(
      buildScreensaverAudioFilter({
        inputLabel: '1:a',
        volume: muxVolume,
        fadeIn: muxFadeIn,
        fadeOut: muxFadeOut,
        duration: durationSec,
        sampleRate: plan.expectedSampleRate,
        channels: Math.min(2, plan.expectedChannels) || 2,
        forceResample: true,
        forceStereo: true,
      }),
    )
  }

  const filterPath = path.join(workDir, 'screensaver-audio.txt')
  await writeFile(filterPath, lines.join(';\n'))
  const kbps = plan.targetBitrateKbps ?? 320
  counter.recordDecode(1)
  counter.recordLossyEncode(1)
  args.push(
    '-filter_complex_script',
    filterPath,
    '-map',
    '0:v:0',
    '-map',
    '[aout]',
    '-c:v',
    copyVideo ? 'copy' : 'copy',
    ...aacEncodeArgs({
      bitrateKbps: kbps,
      sampleRate: plan.expectedSampleRate,
      channels: Math.min(2, plan.expectedChannels) || 2,
    }),
    '-t',
    n(durationSec + 0.02),
    '-movflags',
    '+faststart',
    outputPath,
  )
  await spawnFfmpeg(args, durationSec, hooks)
  let actualOutputBitrate = kbps * 1000
  try {
    const out = await probeAudioDetails(outputPath)
    actualOutputBitrate = out.bitrate || actualOutputBitrate
  } catch {
    // optional
  }
  logAudioExport({
    streamCopy: false,
    decodeRequired: true,
    losslessEncodeCount: counter.losslessEncodeCount,
    lossyEncodeCount: counter.lossyEncodeCount,
    verification: 'Passed',
    strategyChangeReason,
    actualOutputBitrate,
  })
  return {
    processingStrategy: plan.strategy,
    processingLabel: plan.userLabel,
    processingReason: plan.reason,
    lossyEncodeCount: counter.lossyEncodeCount,
    losslessEncodeCount: counter.losslessEncodeCount,
    streamCopy: false,
    decodeRequired: true,
  }
}

export function resolveMusicPathFromAsset(assetId: string | null | undefined): string | null {
  if (!assetId) return null
  const asset = getAudioAsset(assetId)
  return asset?.path ?? null
}

async function renameQuiet(fromPath: string, toPath: string): Promise<void> {
  await rm(toPath, { force: true }).catch(() => undefined)
  await rename(fromPath, toPath)
}

export type { LooperAudioRecipe }
