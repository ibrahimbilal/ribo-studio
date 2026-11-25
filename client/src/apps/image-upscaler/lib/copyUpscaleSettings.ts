import type { UpscaleOptions } from '@shared/imageUpscaler'
import { toRaw } from 'vue'

/** Upscale export options only — not queue items, names, or server job ids. */
export interface UpscaleSettingsSnapshot {
  options: UpscaleOptions
  formatFromSource: boolean
}

let sessionCopiedSettings: UpscaleSettingsSnapshot | null = null

export function getCopiedUpscaleSettings(): UpscaleSettingsSnapshot | null {
  return sessionCopiedSettings
}

export function setCopiedUpscaleSettings(value: UpscaleSettingsSnapshot | null): void {
  sessionCopiedSettings = value
}

export function hasCopiedUpscaleSettings(): boolean {
  return sessionCopiedSettings != null
}

export function cloneUpscaleOptions(options: UpscaleOptions): UpscaleOptions {
  return structuredClone(toRaw(options) as UpscaleOptions)
}

export function extractUpscaleSettingsSnapshot(
  options: UpscaleOptions,
  formatFromSource: boolean,
): UpscaleSettingsSnapshot {
  return { options: cloneUpscaleOptions(options), formatFromSource }
}