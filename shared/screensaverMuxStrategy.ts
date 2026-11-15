/**
 * Screensaver final-assembly / mux execution strategy.
 * Independent of video encoder, CFR quality, audio quality, and audio execution planners.
 */

export type ScreensaverMuxStrategy = 'LEGACY_MULTI_PASS' | 'SINGLE_PASS_DIRECT_MUX'

export interface ScreensaverMuxEligibility {
  strategy: ScreensaverMuxStrategy
  /** Concat demuxer feeds the final MP4 (no full-duration cfr-video / video-only intermediate). */
  directVideoAssembly: boolean
  /** Loop verified audio period with -stream_loop at mux (no full-duration looped.mp3). */
  directAudioPeriodLoop: boolean
  /** Omit +faststart on segment / intermediate artifacts. */
  skipIntermediateFaststart: boolean
}

function envFlagEnabled(raw: string | undefined, defaultEnabled: boolean): boolean {
  if (raw == null || raw.trim() === '') return defaultEnabled
  const v = raw.trim().toLowerCase()
  return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no'
}

/** Master switch. Default enabled; set RIBO_SINGLE_PASS_DIRECT_MUX=0 to force legacy multi-pass. */
export function isSinglePassDirectMuxEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envFlagEnabled(env.RIBO_SINGLE_PASS_DIRECT_MUX, true)
}

/**
 * Independent direct audio-period loop at mux.
 * Defaults to the master single-pass flag; override with RIBO_DIRECT_AUDIO_PERIOD_LOOP.
 */
export function isDirectAudioPeriodLoopEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.RIBO_DIRECT_AUDIO_PERIOD_LOOP
  if (raw == null || raw.trim() === '') return isSinglePassDirectMuxEnabled(env)
  return envFlagEnabled(raw, true)
}

export function resolveScreensaverMuxEligibility(
  env: NodeJS.ProcessEnv = process.env,
): ScreensaverMuxEligibility {
  const singlePass = isSinglePassDirectMuxEnabled(env)
  return {
    strategy: singlePass ? 'SINGLE_PASS_DIRECT_MUX' : 'LEGACY_MULTI_PASS',
    directVideoAssembly: singlePass,
    directAudioPeriodLoop: isDirectAudioPeriodLoopEnabled(env),
    skipIntermediateFaststart: true,
  }
}
