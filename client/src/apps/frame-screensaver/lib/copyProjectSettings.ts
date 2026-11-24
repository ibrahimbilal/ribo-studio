import { clampComposition, compositionForFit, type ScreensaverComposition } from '@shared/screensaverComposition'
import {
  type EncoderChoice,
  type ScreensaverAudioMode,
  type ScreensaverCfrQuality,
  type ScreensaverFit,
  type ScreensaverLoop,
  type ScreensaverMode,
  type ScreensaverProfile,
  type ScreensaverRenderMode,
} from '@shared/screensaver'
import {
  defaultSubscribeAnimation,
  sanitizeSubscribeAnimation,
  type SubscribeAnimationSettings,
} from '@shared/screensaverSubscribeAnimation'
import type { SavedScreensaverProject } from '../types'

/** Editor / export settings only — no project ids, names, thumbnails, or media blobs. */
export interface ScreensaverProjectSettingsSnapshot {
  mode: ScreensaverMode
  outputWidth: number
  outputHeight: number
  fps: number
  durationSeconds: number
  durationPresetKey: string
  fit: ScreensaverFit
  loopType: ScreensaverLoop
  crossfadeSeconds: number
  audioMode: ScreensaverAudioMode
  audioVolume: number
  audioFadeIn: number
  audioFadeOut: number
  loopAudio: boolean
  backgroundColor: string
  profile?: ScreensaverProfile
  encoder?: EncoderChoice
  renderingMode?: ScreensaverRenderMode
  cfrQuality?: ScreensaverCfrQuality
  composition: ScreensaverComposition
  subscribeAnimation: SubscribeAnimationSettings
}

let sessionCopiedSettings: ScreensaverProjectSettingsSnapshot | null = null

export function getCopiedProjectSettings(): ScreensaverProjectSettingsSnapshot | null {
  return sessionCopiedSettings
}

export function setCopiedProjectSettings(value: ScreensaverProjectSettingsSnapshot | null): void {
  sessionCopiedSettings = value
}

export function hasCopiedProjectSettings(): boolean {
  return sessionCopiedSettings != null
}

function cloneComposition(value: ScreensaverComposition): ScreensaverComposition {
  return structuredClone(value)
}

export function extractSettingsSnapshot(project: SavedScreensaverProject): ScreensaverProjectSettingsSnapshot {
  const composition = project.composition
    ? clampComposition(project.composition)
    : compositionForFit(
        project.fit,
        project.width,
        project.height,
        project.outputWidth,
        project.outputHeight,
        project.backgroundColor,
      )
  return {
    mode: project.mode,
    outputWidth: project.outputWidth,
    outputHeight: project.outputHeight,
    fps: project.fps,
    durationSeconds: project.durationSeconds,
    durationPresetKey: project.durationPresetKey,
    fit: project.fit,
    loopType: project.loopType,
    crossfadeSeconds: project.crossfadeSeconds,
    audioMode: project.audioMode,
    audioVolume: project.audioVolume,
    audioFadeIn: project.audioFadeIn,
    audioFadeOut: project.audioFadeOut,
    loopAudio: project.loopAudio,
    backgroundColor: project.backgroundColor,
    profile: project.profile,
    encoder: project.encoder,
    renderingMode: project.renderingMode,
    cfrQuality: project.cfrQuality,
    composition: cloneComposition(composition),
    subscribeAnimation: sanitizeSubscribeAnimation(project.subscribeAnimation ?? defaultSubscribeAnimation()),
  }
}

export function resolveModeForPaste(sourceMode: ScreensaverMode, target: SavedScreensaverProject): ScreensaverMode | null {
  if (target.mediaKind === 'image' && sourceMode === 'static') return 'static'
  if (target.mediaKind === 'video' && sourceMode === 'loop') return 'loop'
  return null
}

export function resolveAudioModeForPaste(
  sourceMode: ScreensaverAudioMode,
  target: SavedScreensaverProject,
): ScreensaverAudioMode {
  if (sourceMode === 'none') return 'none'
  if (sourceMode === 'source') {
    if (target.mediaKind === 'video' && target.hasAudio) return 'source'
    return target.audioMode === 'upload' && (target.audioAssetId || target.audioFileName) ? 'upload' : 'none'
  }
  if (sourceMode === 'upload') {
    if (target.audioAssetId || target.audioFileName) return 'upload'
    if (target.mediaKind === 'video' && target.hasAudio) return 'source'
    return 'none'
  }
  return 'none'
}

export function applySettingsSnapshot(
  target: SavedScreensaverProject,
  source: ScreensaverProjectSettingsSnapshot,
): SavedScreensaverProject {
  const mode = resolveModeForPaste(source.mode, target) ?? target.mode
  const audioMode = resolveAudioModeForPaste(source.audioMode, target)
  return {
    ...target,
    mode,
    outputWidth: source.outputWidth,
    outputHeight: source.outputHeight,
    fps: source.fps,
    durationSeconds: source.durationSeconds,
    durationPresetKey: source.durationPresetKey,
    fit: source.fit,
    loopType: source.loopType,
    crossfadeSeconds: source.crossfadeSeconds,
    audioMode,
    audioVolume: source.audioVolume,
    audioFadeIn: source.audioFadeIn,
    audioFadeOut: source.audioFadeOut,
    loopAudio: source.loopAudio,
    backgroundColor: source.backgroundColor,
    profile: source.profile,
    encoder: source.encoder,
    renderingMode: source.renderingMode,
    cfrQuality: source.cfrQuality,
    composition: cloneComposition(source.composition),
    subscribeAnimation: sanitizeSubscribeAnimation(source.subscribeAnimation),
  }
}