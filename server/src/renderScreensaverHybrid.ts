import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { SCREENSAVER_CFR_TIMESCALE } from '../../shared/screensaver'
import {
  SUBSCRIBE_ANIMATION_FPS,
  subscribeAnimationOccurrences,
  type SubscribeAnimationSettings,
} from '../../shared/screensaverSubscribeAnimation'
import { resolveScreensaverMuxEligibility } from '../../shared/screensaverMuxStrategy'
import type { EncoderId } from './encoders'
import { n, RenderCancelled, spawnFfmpeg, verifyVideoOutput } from './ffmpegUtil'
import type { ScreensaverRenderHooks } from './renderScreensaver'
import { muxScreensaverAudio } from './screensaverAudioMux'

/**
 * Shared MP4 track timescale for hybrid VFR segments.
 * Static (1 fps) and animation (SUBSCRIBE_ANIMATION_FPS) keep different packet
 * durations, but the same timescale so concat stream-copy preserves wall-clock
 * length. See docs/optimized-cfr-poc-report.md (64 s vs 60 s defect).
 */
const VFR_TIMESCALE = SCREENSAVER_CFR_TIMESCALE

export interface HybridJob {
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
  subscribeAnimation: SubscribeAnimationSettings
  animationDir: string
  animationOverlayX: number
  animationOverlayY: number
}

interface ChosenEncoder {
  id: EncoderId
  label: string
  hardware: boolean
  args: string[]
}

export async function renderScreensaverHybrid(
  job: HybridJob,
  encoder: ChosenEncoder,
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
  hooks.onStatus('rendering', 'Encoding subscribe animation segments')
  const occurrences = subscribeAnimationOccurrences(job.subscribeAnimation, job.duration)
  if (occurrences.length < 1) throw new Error('Subscribe animation does not fit in the export duration.')

  const animSec = occurrences[0]!.durationSec
  const animPath = path.join(workDir, 'seg-anim.mp4')
  const concatList = path.join(workDir, 'segments.txt')
  const videoOnly = path.join(workDir, 'video-only.mp4')
  const tempFiles: string[] = [animPath, concatList, videoOnly]
  let warning = inheritedWarning
  const eligibility = resolveScreensaverMuxEligibility()
  const expectAudio = wantsAudio(job)

  try {
    await encodeAnimationSegment(job, encoder, animPath, animSec, hooks, 0.5, eligibility.skipIntermediateFaststart)
    if (hooks.cancelled()) throw new RenderCancelled()

    type HybridPiece = { kind: 'static' | 'dynamic'; durationSec: number; path: string }
    const pieces: HybridPiece[] = []
    const staticByDuration = new Map<string, string>()
    let cursor = 0
    let staticIndex = 0

    const ensureStatic = async (durationSec: number, progressCap: number): Promise<string> => {
      const key = n(durationSec)
      const existing = staticByDuration.get(key)
      if (existing) return existing
      const file = path.join(workDir, `seg-static-${staticIndex}.mp4`)
      staticIndex += 1
      tempFiles.push(file)
      await encodeStaticSegment(job, encoder, file, durationSec, hooks, progressCap, eligibility.skipIntermediateFaststart)
      staticByDuration.set(key, file)
      return file
    }

    for (let index = 0; index < occurrences.length; index += 1) {
      const occurrence = occurrences[index]!
      const gap = occurrence.startSec - cursor
      if (gap >= 0.05) {
        const file = await ensureStatic(gap, 0.35 + (0.4 * index) / Math.max(1, occurrences.length))
        pieces.push({ kind: 'static', durationSec: gap, path: file })
      }
      pieces.push({ kind: 'dynamic', durationSec: occurrence.durationSec, path: animPath })
      cursor = occurrence.startSec + occurrence.durationSec
    }
    const tailSec = job.duration - cursor
    if (tailSec >= 0.05) {
      const file = await ensureStatic(tailSec, 0.9)
      pieces.push({ kind: 'static', durationSec: tailSec, path: file })
    }
    if (hooks.cancelled()) throw new RenderCancelled()

    const entries: string[] = ['ffconcat version 1.0']
    for (const piece of pieces) {
      entries.push(`file '${escapeConcatPath(piece.path)}'`)
      entries.push(`duration ${n(piece.durationSec)}`)
    }
    await writeFile(concatList, `${entries.join('\n')}\n`)

    let audioMeta: { processingStrategy?: string; processingLabel?: string; lossyEncodeCount?: number } = {
      lossyEncodeCount: 0,
    }

    const buildVideoOnly = async (): Promise<void> => {
      try {
        await concatCopy(concatList, videoOnly, job.duration, hooks, false)
      } catch (error) {
        if (hooks.cancelled() || error instanceof RenderCancelled) throw error
        warning = warning
          ? `${warning} Segment concat copy failed; re-encoded with VFR.`
          : 'Segment concat copy failed; re-encoded with VFR.'
        await concatReencode(job, encoder, concatList, videoOnly, hooks)
      }
    }

    if (eligibility.directVideoAssembly && !expectAudio) {
      try {
        hooks.onStatus('rendering', 'Muxing final video')
        await concatCopy(concatList, outputPath, job.duration, hooks, true)
      } catch (error) {
        if (hooks.cancelled() || error instanceof RenderCancelled) throw error
        warning = warning
          ? `${warning} Segment concat copy failed; re-encoded with VFR.`
          : 'Segment concat copy failed; re-encoded with VFR.'
        await concatReencode(job, encoder, concatList, videoOnly, hooks)
        audioMeta = await muxAudio(job, videoOnly, outputPath, workDir, hooks)
      }
    } else if (eligibility.directVideoAssembly && expectAudio) {
      try {
        hooks.onStatus('rendering', 'Muxing final video')
        const meta = await muxScreensaverAudio({
          job: {
            id: job.id,
            duration: job.duration,
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
          },
          videoInput: { kind: 'concat', listPath: concatList, timescale: VFR_TIMESCALE },
          outputPath,
          workDir,
          durationSec: job.duration,
          hooks,
          copyVideo: true,
          preferDirectAudioLoop: eligibility.directAudioPeriodLoop,
          onFaststartStatus: () => hooks.onStatus('rendering', 'Optimizing MP4 metadata'),
        })
        audioMeta = {
          processingStrategy: meta.processingStrategy,
          processingLabel: meta.processingLabel,
          lossyEncodeCount: meta.lossyEncodeCount,
        }
      } catch (error) {
        if (hooks.cancelled() || error instanceof RenderCancelled) throw error
        console.warn('[Hybrid] Direct concat mux failed; using video-only intermediate.', error)
        await rm(outputPath, { force: true }).catch(() => undefined)
        await buildVideoOnly()
        audioMeta = await muxAudio(job, videoOnly, outputPath, workDir, hooks)
      }
    } else {
      await buildVideoOnly()
      audioMeta = await muxAudio(job, videoOnly, outputPath, workDir, hooks)
    }

    if (hooks.cancelled()) throw new RenderCancelled()
    hooks.onStatus('verifying', 'Validating output')
    return {
      ...(await verifyVideoOutput(outputPath, job.width, job.height, job.duration, expectAudio)),
      warning,
      ...audioMeta,
    }
  } finally {
    await Promise.all(tempFiles.map((file) => rm(file, { force: true }).catch(() => undefined)))
  }
}

async function encodeStaticSegment(
  job: HybridJob,
  encoder: ChosenEncoder,
  output: string,
  durationSec: number,
  hooks: ScreensaverRenderHooks,
  progressCap: number,
  skipFaststart = true,
): Promise<void> {
  const frameCount = Math.max(1, Math.round(durationSec))
  const args = [
    '-y',
    '-hide_banner',
    '-progress',
    'pipe:1',
    '-nostats',
    '-loop',
    '1',
    '-framerate',
    '1',
    '-i',
    job.compositionPath,
    '-vf',
    `fps=1`,
    '-frames:v',
    String(frameCount),
    '-an',
    ...encoder.args,
    '-r',
    '1',
    '-video_track_timescale',
    String(VFR_TIMESCALE),
  ]
  if (!skipFaststart) args.push('-movflags', '+faststart')
  args.push(output)
  await spawnFfmpeg(args, durationSec, wrapProgress(hooks, progressCap))
}

async function encodeAnimationSegment(
  job: HybridJob,
  encoder: ChosenEncoder,
  output: string,
  durationSec: number,
  hooks: ScreensaverRenderHooks,
  progressCap: number,
  skipFaststart = true,
): Promise<void> {
  const filterPath = path.join(path.dirname(output), 'seg-b-filter.txt')
  const ox = job.animationOverlayX
  const oy = job.animationOverlayY
  const animFps = String(SUBSCRIBE_ANIMATION_FPS)
  const lines = [
    `[0:v]fps=${animFps},trim=0:${n(durationSec)},setpts=PTS-STARTPTS[bg]`,
    `[1:v]format=rgba,fps=${animFps}[ov]`,
    `[bg][ov]overlay=${ox}:${oy}:format=auto[vout]`,
  ]
  await writeFile(filterPath, lines.join(';\n'))
  const args = [
    '-y',
    '-hide_banner',
    '-progress',
    'pipe:1',
    '-nostats',
    '-loop',
    '1',
    '-framerate',
    animFps,
    '-i',
    job.compositionPath,
    '-framerate',
    animFps,
    '-start_number',
    '1',
    '-i',
    path.join(job.animationDir, '%04d.png'),
    '-filter_complex_script',
    filterPath,
    '-map',
    '[vout]',
    '-an',
    ...encoder.args,
    '-r',
    animFps,
    '-frames:v',
    String(Math.max(1, Math.round(durationSec * SUBSCRIBE_ANIMATION_FPS))),
    '-video_track_timescale',
    String(VFR_TIMESCALE),
  ]
  if (!skipFaststart) args.push('-movflags', '+faststart')
  args.push(output)
  await spawnFfmpeg(args, durationSec, wrapProgress(hooks, progressCap))
}

async function concatCopy(
  listPath: string,
  output: string,
  expectedDuration: number,
  hooks: ScreensaverRenderHooks,
  faststart: boolean,
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
    '-c',
    'copy',
    '-avoid_negative_ts',
    'make_zero',
    '-video_track_timescale',
    String(VFR_TIMESCALE),
  ]
  if (faststart) args.push('-movflags', '+faststart')
  args.push(output)
  await spawnFfmpeg(args, expectedDuration, hooks)
}

function escapeConcatPath(file: string): string {
  return file.replace(/\\/g, '/').replace(/'/g, "'\\''")
}

async function concatReencode(job: HybridJob, encoder: ChosenEncoder, listPath: string, output: string, hooks: ScreensaverRenderHooks): Promise<void> {
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
    ...encoder.args,
    '-fps_mode',
    'vfr',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    output,
  ]
  await spawnFfmpeg(args, job.duration, hooks)
}

async function muxAudio(
  job: HybridJob,
  videoPath: string,
  outputPath: string,
  workDir: string,
  hooks: ScreensaverRenderHooks,
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
      n(job.duration + 0.05),
      '-movflags',
      '+faststart',
      outputPath,
    ]
    hooks.onStatus('rendering', 'Optimizing MP4 metadata')
    await spawnFfmpeg(args, job.duration, hooks)
    return { lossyEncodeCount: 0 }
  }
  const meta = await muxScreensaverAudio({
    job: {
      id: job.id,
      duration: job.duration,
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
    },
    videoPath,
    outputPath,
    workDir,
    durationSec: job.duration,
    hooks,
    copyVideo: true,
    onFaststartStatus: () => hooks.onStatus('rendering', 'Optimizing MP4 metadata'),
  })
  return {
    processingStrategy: meta.processingStrategy,
    processingLabel: meta.processingLabel,
    lossyEncodeCount: meta.lossyEncodeCount,
  }
}

function wantsAudio(job: HybridJob): boolean {
  if (job.audioVolume <= 0.001) return false
  if (job.audioMode === 'upload') return Boolean(job.musicPath || job.audioAssetId)
  if (job.audioMode === 'source') return job.sourceHasAudio && job.mediaKind === 'video'
  return false
}

function wrapProgress(hooks: ScreensaverRenderHooks, cap: number): ScreensaverRenderHooks {
  return {
    ...hooks,
    onProgress: (progress, message) => hooks.onProgress(Math.min(cap, progress * cap), message),
  }
}
