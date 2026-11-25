import { clampComposition, sanitizeComposition, type ScreensaverComposition } from '@shared/screensaverComposition'
import { NONE_FRAME_ID } from '@shared/screensaverFrames'
import type { NormCrop } from '@shared/thumbnailLayout'
import {
  syncPresetBadgeCoords,
  type ThumbnailBadge,
  type ThumbnailDocument,
  type ThumbnailExportSettings,
  type ThumbnailFit,
} from '@shared/thumbnailProject'

/** Badges, export, placement, and frame — not project id, name, or artwork. */
export interface ThumbnailProjectSettingsSnapshot {
  export: ThumbnailExportSettings
  resolution: ThumbnailBadge
  duration: ThumbnailBadge
  imageFit: ThumbnailFit
  imageCrop: NormCrop
  composition: ScreensaverComposition | null
}

let sessionCopiedSettings: ThumbnailProjectSettingsSnapshot | null = null

export function getCopiedThumbnailSettings(): ThumbnailProjectSettingsSnapshot | null {
  return sessionCopiedSettings
}

export function setCopiedThumbnailSettings(value: ThumbnailProjectSettingsSnapshot | null): void {
  sessionCopiedSettings = value
}

export function hasCopiedThumbnailSettings(): boolean {
  return sessionCopiedSettings != null
}

function cloneBadge(badge: ThumbnailBadge): ThumbnailBadge {
  return structuredClone(badge)
}

function cloneComposition(value: ScreensaverComposition): ScreensaverComposition {
  return structuredClone(clampComposition(value))
}

export function extractThumbnailSettingsSnapshot(document: ThumbnailDocument): ThumbnailProjectSettingsSnapshot {
  const composition = sanitizeComposition(document.image.composition)
  return {
    export: { ...document.export },
    resolution: cloneBadge(document.resolution),
    duration: cloneBadge(document.duration),
    imageFit: document.image.fit,
    imageCrop: { ...document.image.crop },
    composition: composition ? cloneComposition(composition) : null,
  }
}

export function applyThumbnailSettingsSnapshot(
  target: ThumbnailDocument,
  source: ThumbnailProjectSettingsSnapshot,
): ThumbnailDocument {
  const exportSettings = { ...source.export }
  const resolution = cloneBadge(source.resolution)
  const duration = cloneBadge(source.duration)
  syncPresetBadgeCoords(resolution, exportSettings.width, exportSettings.height)
  syncPresetBadgeCoords(duration, exportSettings.width, exportSettings.height)
  const composition = source.composition ? cloneComposition(source.composition) : null
  const frameId = composition?.frameId ?? NONE_FRAME_ID
  const clearFrame = !composition || frameId === NONE_FRAME_ID
  return {
    ...target,
    export: exportSettings,
    resolution,
    duration,
    image: {
      ...target.image,
      fit: source.imageFit,
      crop: { ...source.imageCrop },
      composition: composition ? { ...composition } : null,
      frameAssetId: clearFrame ? null : target.image.frameAssetId,
    },
    updatedAt: Date.now(),
  }
}

export function frameIdFromSnapshot(snapshot: ThumbnailProjectSettingsSnapshot): string {
  const frameId = snapshot.composition?.frameId
  if (!frameId || frameId === NONE_FRAME_ID) return NONE_FRAME_ID
  return frameId
}