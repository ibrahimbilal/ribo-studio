import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { SCREENSAVER_CFR_TIMESCALE } from '../../shared/screensaver'
import { SUBSCRIBE_ANIMATION_FPS, type SubscribeAnimationSettings } from '../../shared/screensaverSubscribeAnimation'
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
  const startSec = job.subscribeAnimation.startSec
  const animSec = job.subscribeAnimation.durationSec
  const tailSec = job.duration - startSec - animSec
  if (tailSec < -0.01) throw new Error('Subscribe animation does not fit in the export duration.')

  const segA = path.join(workDir, 'seg-a.mp4')
  const segB = path.join(workDir, 'seg-b.mp4')
  const segC = path.join(workDir, 'seg-c.mp4')
  const concatList = path.join(workDir, 'segments.txt')
  const videoOnly = path.join(workDir, 'video-only.mp4')
  let warning = inheritedWarning

  try {
    if (startSec >= 0.05) {
      await encodeStaticSegment(job, encoder, segA, startSec, hooks, 0.33)
    }
    await encodeAnimationSegment(job, encoder, segB, animSec, hooks, 0.66)
    if (tailSec >= 0.05) {
      await encodeStaticSegment(job, encoder, segC, tailSec, hooks, 0.9)
    }
    if (hooks.cancelled()) throw new RenderCancelled()

    const entries: string[] = ['ffconcat version 1.0']
    if (startSec >= 0.05) {
      entries.push(`file '${escapeConcatPath(segA)}'`)
      entries.push(`duration ${n(startSec)}`)
    }
    entries.push(`file '${escapeConcatPath(segB)}'`)
    entries.push(`duration ${n(animSec)}`)
    if (tailSec >= 0.05) {
      entries.push(`file '${escapeConcatPath(segC)}'`)
      entries.push(`duration ${n(tailSec)}`)
    }
    await writeFile(concatList, `${entries.join('\n')}\n`)
    try {
      await concatCopy(concatList, videoOnly, job.duration, hooks)
    } catch (error) {
      if (hooks.cancelled() || error instanceof RenderCancelled) throw error
      warning = warning
        ? `${warning} Segment concat copy failed; re-encoded with VFR.`
        : 'Segment concat copy failed; re-encoded with VFR.'
      await concatReencode(job, encoder, concatList, videoOnly, hooks)
    }

    const audioMeta = await muxAudio(job, videoOnly, outputPath, workDir, hooks)
    if (hooks.cancelled()) throw new RenderCancelled()
    hooks.onStatus('verifying', 'Validating output')
    const expectAudio = wantsAudio(job)
    return {
      ...(await verifyVideoOutput(outputPath, job.width, job.height, job.duration, expectAudio)),
      warning,
      ...audioMeta,
    }
  } finally {
    await rm(segA, { force: true }).catch(() => undefined)
    await rm(segB, { force: true }).catch(() => undefined)
    await rm(segC, { force: true }).catch(() => undefined)
    await rm(concatList, { force: true }).catch(() => undefined)
    await rm(videoOnly, { force: true }).catch(() => undefined)
  }
}

async function encodeStaticSegment(
  job: HybridJob,
  encoder: ChosenEncoder,
  output: string,
  durationSec: number,
  hooks: ScreensaverRenderHooks,
  progressCap: number,
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
    '-movflags',
    '+faststart',
    output,
  ]
  await spawnFfmpeg(args, durationSec, wrapProgress(hooks, progressCap))
}

async function encodeAnimationSegment(
  job: HybridJob,
  encoder: ChosenEncoder,
  output: string,
  durationSec: number,
  hooks: ScreensaverRenderHooks,
  progressCap: number,
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
    '-movflags',
    '+faststart',
    output,
  ]
  await spawnFfmpeg(args, durationSec, wrapProgress(hooks, progressCap))
}

async function concatCopy(listPath: string, output: string, expectedDuration: number, hooks: ScreensaverRenderHooks): Promise<void> {
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
    '-movflags',
    '+faststart',
    output,
  ]
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
