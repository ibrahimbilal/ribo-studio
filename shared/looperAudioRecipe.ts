/**
 * Durable Looper → Screensaver processing recipe (sources + settings, no lossy intermediate).
 */

import type { AudioLooperSettings } from './audioLooper'
import type { AudioSourceProbe } from './audioProcessingPlan'

export interface LooperAudioRecipeTrack {
  /** Basename inside the recipe directory (e.g. source-0.mp3). */
  fileName: string
  originalName: string
  probe: AudioSourceProbe
}

export interface LooperAudioRecipe {
  version: 1
  settings: AudioLooperSettings
  tracks: LooperAudioRecipeTrack[]
  createdAt: number
}

export function isLooperAudioRecipe(value: unknown): value is LooperAudioRecipe {
  if (!value || typeof value !== 'object') return false
  const raw = value as LooperAudioRecipe
  return raw.version === 1 && Array.isArray(raw.tracks) && raw.tracks.length > 0 && Boolean(raw.settings)
}
