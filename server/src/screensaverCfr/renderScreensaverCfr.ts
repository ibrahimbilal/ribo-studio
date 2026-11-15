import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  type ScreensaverCfrQuality,
} from '../../../shared/screensaver'
import {
  SUBSCRIBE_ANIMATION_FPS,
  type SubscribeAnimationSettings,
} from '../../../shared/screensaverSubscribeAnimation'
import { resolveScreensaverMuxEligibility } from '../../../shared/screensaverMuxStrategy'
import type { EncoderId } from '../encoders'
import { DiskIoSession, fileSizeOrZero } from '../diskIoTelemetry'
import { assertDiskSpace, estimateMuxOutputBytes } from '../diskSpace'
import { n, RenderCancelled, spawnFfmpeg, verifyVideoOutput } from '../ffmpegUtil'
import type { ScreensaverRenderHooks } from '../renderScreensaver'
import { muxScreensaverAudio } from '../screensaverAudioMux'
import { jobsDir } from '../storage'
import {
  cfrLibx264Args,
  resolveCfrEncodeSettings,
  type CfrEncodeSettings,
} from './encodingConfig'
import {
  animationFingerprint,
  compositionContentHash,
  createSegmentCache,
  dynamicSegmentCacheKey,
  staticSegmentCacheKey,
  type SegmentCache,
} from './segmentCache'
import {
  buildCfrTimeline,
  planStaticSegments,
  selectPreferredSegmentSeconds,
  staticRuns,
  type CfrTimeline,
} from './timeline'
import { validateCfrPackets } from './validate'

export interface CfrJob {
  id: string
  width: number
  height: number
  fps: number
  duration: number
  compositionPath: string
  musicPath: string | null
  audioAssetId?: string | null
  mediaPath: string
  mediaKind: 'image' | 'video'
  audioMode: 'none' | 'source' | 'upload'
  audioVolume: number
  audioFadeIn: number
  audioFadeOut: number
  loopAudio: boolean
  sourceHasAudio: boolean
  subscribeAnimation: SubscribeAnimationSettings | null
  animationDir: string | null
  animationOverlayX: number
  animationOverlayY: number
  cfrQuality: ScreensaverCfrQuality
}

interface ChosenEncoder {
  id: EncoderId
  label: string
  hardware: boolean
  args: string[]
}

interface ProgressWeights {
  prepare: number
  encode: number
  assemble: number
  audio: number
  validate: number
}

const WEIGHTS: ProgressWeights = {
  prepare: 0.05,
  encode: 0.55,
  assemble: 0.15,
  audio: 0.1,
  validate: 0.15,
}

export async function renderScreensaverCfr(
  job: CfrJob,
  _encoder: ChosenEncoder,
  outputPath: string,
  workDir: string,
  hooks: ScreensaverRenderHooks,
  inheritedWarning: string | null,
): Promise<{
  outputPath: string
  bytes: number
  duration: number
  warning: string | null
  processingStrategy?: string
  processingLabel?: string
  lossyEncodeCount?: number
}> {
  if (hooks.cancelled()) throw new RenderCancelled()
  hooks.onStatus('preparing', 'Preparing timeline')
  report(hooks, 0, 'Preparing timeline')

  const eligibility = resolveScreensaverMuxEligibility()
  const diskIo = new DiskIoSession(eligibility.strategy)
  const prepareStage = diskIo.beginStage('PREPARE_TIMELINE')

  const settings = resolveCfrEncodeSettings(job.cfrQuality, job.fps, job.width, job.height)
  const compositionHash = await compositionContentHash(job.compositionPath)
  const timeline = buildCfrTimeline({
    fps: job.fps,
    durationSec: job.duration,
    compositionKey: compositionHash,
    subscribeAnimation: job.subscribeAnimation,
  })
  prepareStage.end()

  const cache = await createSegmentCache(workDir)
  const segmentsDir = path.join(workDir, 'cfr-segments')
  await mkdir(segmentsDir, { recursive: true })

  let warning = inheritedWarning
  const concatEntries: string[] = []
  const boundaryIndexes: number[] = [0]
  let cursor = 0
  let framesEncoded = 0
  let encodeDone = 0
  const encodeTotal = estimateEncodeUnits(timeline, job.fps)
  const expectAudio = wantsAudio(job)
  const listPath = path.join(workDir, 'cfr-segments.ffconcat')
  const videoOnly = path.join(workDir, 'cfr-video.mp4')

  try {
    hooks.onStatus('rendering', 'Rendering unique video segments')
    report(hooks, WEIGHTS.prepare, 'Rendering unique video segments')
    const encodeStage = diskIo.beginStage('VIDEO_SEGMENT_ENCODE')

    for (const region of timeline.regions) {
      if (hooks.cancelled()) throw new RenderCancelled()
      if (region.kind === 'static') {
        const preferredSec = selectPreferredSegmentSeconds(region.frameCount, job.fps, 1)
        const plan = planStaticSegments(region.frameCount, job.fps, preferredSec)
        for (const frameCount of plan.uniqueFrameCounts) {
          await ensureStaticSegment({
            job,
            settings,
            cache,
            segmentsDir,
            compositionHash,
            frameCount,
            hooks,
            skipFaststart: eligibility.skipIntermediateFaststart,
            onEncoded: () => {
              framesEncoded += frameCount
              encodeDone += 1
              const ratio = WEIGHTS.prepare + WEIGHTS.encode * Math.min(1, encodeDone / Math.max(1, encodeTotal))
              report(hooks, ratio, 'Rendering unique video segments')
            },
          })
        }
        for (const frameCount of plan.references) {
          const key = staticSegmentCacheKey({ compositionHash, settings, frameCount, still: true })
          const file = await cache.get(key)
          if (!file) throw new Error(`Missing cached static segment (${frameCount} frames).`)
          concatEntries.push(file)
          cursor += frameCount
          boundaryIndexes.push(cursor)
        }
      } else {
        if (!job.animationDir || !job.subscribeAnimation) {
          throw new Error('Subscribe animation frames are missing.')
        }
        const file = await ensureDynamicSegment({
          job,
          settings,
          cache,
          segmentsDir,
          compositionHash,
          frameCount: region.frameCount,
          hooks,
          skipFaststart: eligibility.skipIntermediateFaststart,
          onEncoded: () => {
            framesEncoded += region.frameCount
            encodeDone += 1
            const ratio = WEIGHTS.prepare + WEIGHTS.encode * Math.min(1, encodeDone / Math.max(1, encodeTotal))
            report(hooks, ratio, 'Rendering unique video segments')
          },
        })
        concatEntries.push(file)
        cursor += region.frameCount
        boundaryIndexes.push(cursor)
      }
    }

    if (cursor !== timeline.totalFrames) {
      throw new Error(`Assembled ${cursor} frames, expected ${timeline.totalFrames}.`)
    }
    boundaryIndexes.pop()
    encodeStage.end({ ffmpegInvocations: framesEncoded > 0 ? encodeDone : 0 })

    if (hooks.cancelled()) throw new RenderCancelled()
    await writeConcatManifest(listPath, concatEntries)

    const estimatedFinal = estimateMuxOutputBytes({
      durationSec: timeline.durationSeconds,
      width: job.width,
      height: job.height,
      fps: job.fps,
      hasAudio: expectAudio,
    })
    // Single-pass needs ~1× final; legacy needs final + intermediate video (+ optional looped audio).
    const spaceNeeded = eligibility.directVideoAssembly
      ? estimatedFinal
      : estimatedFinal * 2 + (expectAudio ? Math.ceil(320_000 * timeline.durationSeconds / 8) : 0)
    await assertDiskSpace(jobsDir, spaceNeeded, 'Not enough free disk space for this Screensaver export.')

    let audioMeta: { processingStrategy?: string; processingLabel?: string; lossyEncodeCount?: number } = {
      lossyEncodeCount: 0,
    }
    let usedDirectVideo = false

    if (eligibility.directVideoAssembly) {
      try {
        audioMeta = await assembleDirect({
          job,
          settings,
          listPath,
          outputPath,
          workDir,
          durationSec: timeline.durationSeconds,
          hooks,
          diskIo,
          preferDirectAudioLoop: eligibility.directAudioPeriodLoop,
          expectAudio,
        })
        usedDirectVideo = true
        diskIo.markFullDurationVideo(false)
      } catch (error) {
        if (hooks.cancelled() || error instanceof RenderCancelled) throw error
        const reason = error instanceof Error ? error.message : String(error)
        console.warn(`[CFR] Single-pass direct mux failed; falling back to LEGACY_MULTI_PASS. ${reason}`)
        diskIo.markFallback(reason)
        await rm(outputPath, { force: true }).catch(() => undefined)
        await assertDiskSpace(
          jobsDir,
          estimatedFinal * 2 + (expectAudio ? Math.ceil(320_000 * timeline.durationSeconds / 8) : 0),
          'Not enough free disk space to fall back to multi-pass assembly.',
        )
        audioMeta = await assembleLegacy({
          job,
          settings,
          listPath,
          videoOnly,
          outputPath,
          workDir,
          durationSec: timeline.durationSeconds,
          hooks,
          diskIo,
          expectAudio,
        })
        diskIo.markFullDurationVideo(true)
      }
    } else {
      audioMeta = await assembleLegacy({
        job,
        settings,
        listPath,
        videoOnly,
        outputPath,
        workDir,
        durationSec: timeline.durationSeconds,
        hooks,
        diskIo,
        expectAudio,
      })
      diskIo.markFullDurationVideo(true)
    }

    if (hooks.cancelled()) throw new RenderCancelled()
    hooks.onStatus('verifying', 'Validating output')
    report(hooks, 1 - WEIGHTS.validate, 'Validating output')
    const verifyStage = diskIo.beginStage('VERIFICATION')
    const validation = await validateCfrPackets(outputPath, {
      fps: job.fps,
      expectedFrames: timeline.totalFrames,
      expectedDurationSec: timeline.durationSeconds,
      width: job.width,
      height: job.height,
      boundaryIndexes,
      expectAudio,
      onProgress: (ratio) => report(hooks, 1 - WEIGHTS.validate + WEIGHTS.validate * ratio, 'Validating output'),
    })
    if (!validation.ok) {
      throw new Error(`Optimized CFR validation failed: ${validation.reasons.join(' ')}`)
    }

    const verified = await verifyVideoOutput(
      outputPath,
      job.width,
      job.height,
      timeline.durationSeconds,
      expectAudio,
      undefined,
      {
        width: validation.streamInfo.width,
        height: validation.streamInfo.height,
        codec: validation.streamInfo.codec,
        duration: validation.streamInfo.formatDuration ?? validation.streamInfo.duration,
        hasAudio: validation.streamInfo.hasAudio,
        bytes: validation.bytes,
      },
    )
    verifyStage.end()
    diskIo.setFinalOutputBytes(verified.bytes)
    diskIo.logSummary()
    report(hooks, 1, 'Completed')
    if (framesEncoded > 0) {
      warning = joinWarning(
        warning,
        `Optimized CFR encoded ${framesEncoded} unique frames for ${timeline.totalFrames} output frames.`,
      )
    }
    console.info(`[CFR] Mux path: ${usedDirectVideo ? 'SINGLE_PASS_DIRECT_MUX' : 'LEGACY_MULTI_PASS'}`)
    return { ...verified, warning, ...audioMeta }
  } finally {
    await rm(videoOnly, { force: true }).catch(() => undefined)
    await rm(listPath, { force: true }).catch(() => undefined)
  }
}

async function assembleDirect(opts: {
  job: CfrJob
  settings: CfrEncodeSettings
  listPath: string
  outputPath: string
  workDir: string
  durationSec: number
  hooks: ScreensaverRenderHooks
  diskIo: DiskIoSession
  preferDirectAudioLoop: boolean
  expectAudio: boolean
}): Promise<{ processingStrategy?: string; processingLabel?: string; lossyEncodeCount?: number }> {
  const { job, settings, listPath, outputPath, workDir, durationSec, hooks, diskIo } = opts
  if (!opts.expectAudio) {
    hooks.onStatus('rendering', 'Muxing final video')
    report(hooks, WEIGHTS.prepare + WEIGHTS.encode, 'Muxing final video')
    const stage = diskIo.beginStage('VIDEO_SEGMENT_ASSEMBLY')
    hooks.onStatus('rendering', 'Optimizing MP4 metadata')
    await concatCopy(listPath, outputPath, settings, durationSec, hooks, WEIGHTS.prepare + WEIGHTS.encode, WEIGHTS.assemble + WEIGHTS.audio, {
      faststart: true,
      progressLabel: 'Muxing final video',
    })
    const outBytes = await fileSizeOrZero(outputPath)
    stage.end({ outputBytes: outBytes, ffmpegInvocations: 1, faststartOps: 1, notes: 'no-audio-direct' })
    diskIo.markFullDurationAudio(false)
    return { lossyEncodeCount: 0 }
  }

  hooks.onStatus('rendering', 'Preparing audio period')
  report(hooks, WEIGHTS.prepare + WEIGHTS.encode, 'Preparing audio period')
  hooks.onStatus('rendering', 'Muxing final video')
  report(hooks, WEIGHTS.prepare + WEIGHTS.encode + WEIGHTS.assemble * 0.2, 'Muxing final video')
  const meta = await muxScreensaverAudio({
    job: audioJobSlice(job, durationSec),
    videoInput: { kind: 'concat', listPath, timescale: settings.timescale },
    outputPath,
    workDir,
    durationSec,
    hooks: {
      ...hooks,
      onProgress: (progress, message) =>
        hooks.onProgress(
          WEIGHTS.prepare + WEIGHTS.encode + WEIGHTS.assemble * 0.2 + progress * (WEIGHTS.assemble * 0.8 + WEIGHTS.audio),
          message ?? 'Muxing final video',
        ),
    },
    copyVideo: true,
    preferDirectAudioLoop: opts.preferDirectAudioLoop,
    diskIo,
    onFaststartStatus: () => {
      hooks.onStatus('rendering', 'Optimizing MP4 metadata')
      report(hooks, WEIGHTS.prepare + WEIGHTS.encode + WEIGHTS.assemble + WEIGHTS.audio * 0.85, 'Optimizing MP4 metadata')
    },
  })
  return {
    processingStrategy: meta.processingStrategy,
    processingLabel: meta.processingLabel,
    lossyEncodeCount: meta.lossyEncodeCount,
  }
}

async function assembleLegacy(opts: {
  job: CfrJob
  settings: CfrEncodeSettings
  listPath: string
  videoOnly: string
  outputPath: string
  workDir: string
  durationSec: number
  hooks: ScreensaverRenderHooks
  diskIo: DiskIoSession
  expectAudio: boolean
}): Promise<{ processingStrategy?: string; processingLabel?: string; lossyEncodeCount?: number }> {
  const { job, settings, listPath, videoOnly, outputPath, workDir, durationSec, hooks, diskIo } = opts
  hooks.onStatus('rendering', 'Assembling video')
  report(hooks, WEIGHTS.prepare + WEIGHTS.encode, 'Assembling video')
  const stage = diskIo.beginStage('VIDEO_SEGMENT_ASSEMBLY')
  await concatCopy(listPath, videoOnly, settings, durationSec, hooks, WEIGHTS.prepare + WEIGHTS.encode, WEIGHTS.assemble, {
    faststart: false,
    progressLabel: 'Assembling video',
  })
  await diskIo.trackTempFile(videoOnly)
  stage.end({ outputBytes: await fileSizeOrZero(videoOnly), ffmpegInvocations: 1, notes: 'legacy-intermediate' })

  if (hooks.cancelled()) throw new RenderCancelled()
  hooks.onStatus('rendering', opts.expectAudio ? 'Preparing audio period' : 'Muxing final video')
  report(hooks, WEIGHTS.prepare + WEIGHTS.encode + WEIGHTS.assemble, opts.expectAudio ? 'Preparing audio period' : 'Muxing final video')
  return muxAudio(job, videoOnly, outputPath, workDir, durationSec, hooks, diskIo)
}

function audioJobSlice(job: CfrJob, durationSec: number) {
  return {
    id: job.id,
    duration: durationSec,
    audioMode: job.audioMode,
    audioVolume: job.audioVolume,
    audioFadeIn: job.audioFadeIn,
    audioFadeOut: job.audioFadeOut,
    loopAudio: job.loopAudio,
    musicPath: job.musicPath,
    audioAssetId: job.audioAssetId,
    sourceHasAudio: job.sourceHasAudio,
    mediaKind: job.mediaKind,
    mediaPath: job.mediaPath,
  }
}

function estimateEncodeUnits(timeline: CfrTimeline, fps: number): number {
  let units = 0
  for (const run of staticRuns(timeline)) {
    const preferredSec = selectPreferredSegmentSeconds(run.frameCount, fps, 1)
    units += planStaticSegments(run.frameCount, fps, preferredSec).uniqueFrameCounts.length
  }
  units += timeline.regions.filter((region) => region.kind === 'dynamic').length
  return Math.max(1, units)
}

async function ensureStaticSegment(options: {
  job: CfrJob
  settings: CfrEncodeSettings
  cache: SegmentCache
  segmentsDir: string
  compositionHash: string
  frameCount: number
  hooks: ScreensaverRenderHooks
  skipFaststart: boolean
  onEncoded: () => void
}): Promise<string> {
  const key = staticSegmentCacheKey({
    compositionHash: options.compositionHash,
    settings: options.settings,
    frameCount: options.frameCount,
    still: true,
  })
  const cached = await options.cache.get(key)
  if (cached) {
    options.onEncoded()
    return cached
  }
  if (options.hooks.cancelled()) throw new RenderCancelled()
  const output = path.join(options.segmentsDir, `static-${options.frameCount}.mp4`)
  const args = [
    '-y',
    '-hide_banner',
    '-progress',
    'pipe:1',
    '-nostats',
    '-loop',
    '1',
    '-framerate',
    String(options.settings.fps),
    '-i',
    options.job.compositionPath,
    '-vf',
    `fps=${options.settings.fps},setsar=1`,
    '-frames:v',
    String(options.frameCount),
    '-an',
    ...cfrLibx264Args(options.settings, true),
  ]
  if (!options.skipFaststart) {
    args.push('-movflags', '+faststart')
  }
  args.push(output)
  const expectedSec = options.frameCount / options.settings.fps
  await spawnFfmpeg(args, expectedSec, options.hooks)
  const stored = await options.cache.put(key, output)
  options.onEncoded()
  return stored
}

async function ensureDynamicSegment(options: {
  job: CfrJob
  settings: CfrEncodeSettings
  cache: SegmentCache
  segmentsDir: string
  compositionHash: string
  frameCount: number
  hooks: ScreensaverRenderHooks
  skipFaststart: boolean
  onEncoded: () => void
}): Promise<string> {
  const pngCount = Math.max(
    1,
    Math.round((options.frameCount / options.settings.fps) * SUBSCRIBE_ANIMATION_FPS),
  )
  const animFingerprint = await animationFingerprint(options.job.animationDir!, pngCount)
  const key = dynamicSegmentCacheKey({
    compositionHash: options.compositionHash,
    animationFingerprint: animFingerprint,
    settings: options.settings,
    frameCount: options.frameCount,
    overlayX: options.job.animationOverlayX,
    overlayY: options.job.animationOverlayY,
  })
  const cached = await options.cache.get(key)
  if (cached) {
    options.onEncoded()
    return cached
  }
  if (options.hooks.cancelled()) throw new RenderCancelled()

  const filterPath = path.join(options.segmentsDir, `anim-${options.frameCount}-filter.txt`)
  const ox = options.job.animationOverlayX
  const oy = options.job.animationOverlayY
  const outFps = String(options.settings.fps)
  const srcFps = String(SUBSCRIBE_ANIMATION_FPS)
  const durationSec = options.frameCount / options.settings.fps
  const lines = [
    `[0:v]fps=${outFps},trim=0:${n(durationSec)},setpts=PTS-STARTPTS,setsar=1[bg]`,
    `[1:v]format=rgba,fps=${outFps}[ov]`,
    `[bg][ov]overlay=${ox}:${oy}:format=auto[vout]`,
  ]
  await writeFile(filterPath, lines.join(';\n'))
  const output = path.join(options.segmentsDir, `anim-${options.frameCount}.mp4`)
  const args = [
    '-y',
    '-hide_banner',
    '-progress',
    'pipe:1',
    '-nostats',
    '-loop',
    '1',
    '-framerate',
    outFps,
    '-i',
    options.job.compositionPath,
    '-framerate',
    srcFps,
    '-start_number',
    '1',
    '-i',
    path.join(options.job.animationDir!, '%04d.png'),
    '-filter_complex_script',
    filterPath,
    '-map',
    '[vout]',
    '-an',
    '-frames:v',
    String(options.frameCount),
    ...cfrLibx264Args(options.settings, false),
  ]
  if (!options.skipFaststart) {
    args.push('-movflags', '+faststart')
  }
  args.push(output)
  await spawnFfmpeg(args, durationSec, options.hooks)
  const stored = await options.cache.put(key, output)
  options.onEncoded()
  return stored
}

async function writeConcatManifest(listPath: string, files: string[]): Promise<void> {
  const lines = ['ffconcat version 1.0']
  for (const file of files) {
    lines.push(`file '${escapeConcatPath(file)}'`)
  }
  await writeFile(listPath, `${lines.join('\n')}\n`)
}

function escapeConcatPath(file: string): string {
  return file.replace(/\\/g, '/').replace(/'/g, "'\\''")
}

async function concatCopy(
  listPath: string,
  output: string,
  settings: CfrEncodeSettings,
  expectedDuration: number,
  hooks: ScreensaverRenderHooks,
  progressBase: number,
  progressSpan: number,
  options: { faststart: boolean; progressLabel: string },
): Promise<void> {
  const args = [
    '-y',
    '-hide_banner',
    '-progress',
    'pipe:1',
    '-nostats',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-map',
    '0:v:0',
    '-c:v',
    'copy',
    '-video_track_timescale',
    String(settings.timescale),
  ]
  if (options.faststart) {
    args.push('-movflags', '+faststart')
  }
  args.push(output)
  if (!args.includes('copy') || args.some((arg) => arg.includes('libx264') || arg.startsWith('h264_'))) {
    throw new Error('CFR assembly must use stream copy.')
  }
  await spawnFfmpeg(args, expectedDuration, {
    ...hooks,
    onProgress: (progress, message) =>
      hooks.onProgress(progressBase + progress * progressSpan, message ?? options.progressLabel),
  })
}

async function muxAudio(
  job: CfrJob,
  videoPath: string,
  outputPath: string,
  workDir: string,
  durationSec: number,
  hooks: ScreensaverRenderHooks,
  diskIo?: DiskIoSession,
): Promise<{ processingStrategy?: string; processingLabel?: string; lossyEncodeCount?: number }> {
  if (!wantsAudio(job)) {
    const args = [
      '-y',
      '-hide_banner',
      '-progress',
      'pipe:1',
      '-nostats',
      '-i',
      videoPath,
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
    ]
    hooks.onStatus('rendering', 'Optimizing MP4 metadata')
    await spawnFfmpeg(args, durationSec, hooks)
    diskIo?.beginStage('FINAL_MUX').end({ ffmpegInvocations: 1, faststartOps: 1, notes: 'legacy-no-audio-remux' })
    diskIo?.markFullDurationAudio(false)
    return { lossyEncodeCount: 0 }
  }
  const meta = await muxScreensaverAudio({
    job: audioJobSlice(job, durationSec),
    videoPath,
    outputPath,
    workDir,
    durationSec,
    hooks,
    copyVideo: true,
    preferDirectAudioLoop: false,
    diskIo,
    onFaststartStatus: () => {
      hooks.onStatus('rendering', 'Optimizing MP4 metadata')
      report(hooks, WEIGHTS.prepare + WEIGHTS.encode + WEIGHTS.assemble + WEIGHTS.audio * 0.85, 'Optimizing MP4 metadata')
    },
  })
  return {
    processingStrategy: meta.processingStrategy,
    processingLabel: meta.processingLabel,
    lossyEncodeCount: meta.lossyEncodeCount,
  }
}

function wantsAudio(job: CfrJob): boolean {
  if (job.audioVolume <= 0.001) return false
  if (job.audioMode === 'upload') return Boolean(job.musicPath || job.audioAssetId)
  if (job.audioMode === 'source') return job.sourceHasAudio && job.mediaKind === 'video'
  return false
}

function report(hooks: ScreensaverRenderHooks, progress: number, message: string): void {
  hooks.onProgress(Math.max(0, Math.min(0.99, progress)), message)
}

function joinWarning(current: string | null, next: string): string {
  return current ? `${current} ${next}` : next
}
