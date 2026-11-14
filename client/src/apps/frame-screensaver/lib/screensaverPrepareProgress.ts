/**
 * Weighted client prepare/upload progress for Screensaver exports.
 * Maps into the UI band before server rendering (~0–18%), matching jobPoll's
 * preparing floor at 0.2 and rendering at 0.2 + encode×0.75.
 */

/** End of client prepare+upload band (server preparing snaps to ~0.2). */
export const SCREENSAVER_PREPARE_PROGRESS_END = 0.18

export interface ScreensaverPrepareWeights {
  composition: number
  animation: number
  upload: number
}

export function screensaverPrepareWeights(animationEnabled: boolean): ScreensaverPrepareWeights {
  if (animationEnabled) {
    return { composition: 0.15, animation: 0.55, upload: 0.3 }
  }
  return { composition: 0.4, animation: 0, upload: 0.6 }
}

/** Overall 0–1 prepare completion from per-step fractions (each 0–1). */
export function screensaverPrepareOverall(
  weights: ScreensaverPrepareWeights,
  steps: { composition: number; animation: number; upload: number },
): number {
  const c = clamp01(steps.composition)
  const a = clamp01(steps.animation)
  const u = clamp01(steps.upload)
  return clamp01(weights.composition * c + weights.animation * a + weights.upload * u)
}

/** Map overall 0–1 prepare completion into export UI progress. */
export function mapScreensaverPrepareProgress(overall01: number): number {
  return clamp01(overall01) * SCREENSAVER_PREPARE_PROGRESS_END
}

export function screensaverPrepareUiProgress(
  animationEnabled: boolean,
  steps: { composition: number; animation: number; upload: number },
): number {
  return mapScreensaverPrepareProgress(screensaverPrepareOverall(screensaverPrepareWeights(animationEnabled), steps))
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}
