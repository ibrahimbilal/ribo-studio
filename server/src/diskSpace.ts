/**
 * Free-space checks for long Screensaver exports.
 */

import { statfs } from 'node:fs/promises'

const SAFETY_MARGIN_BYTES = 64 * 1024 * 1024

export async function assertDiskSpace(
  dir: string,
  neededBytes: number,
  message = 'Not enough free disk space for this export.',
): Promise<void> {
  try {
    const info = await statfs(dir)
    const free = Number(info.bavail) * Number(info.bsize)
    if (Number.isFinite(free) && free > 0 && free < neededBytes + SAFETY_MARGIN_BYTES) {
      const needGiB = ((neededBytes + SAFETY_MARGIN_BYTES) / (1024 ** 3)).toFixed(2)
      const freeGiB = (free / (1024 ** 3)).toFixed(2)
      throw new Error(`${message} Need about ${needGiB} GiB free; about ${freeGiB} GiB available.`)
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('disk space')) throw error
    // Some platforms omit reliable free-space stats — skip the check.
  }
}

/** Rough H.264+audio final size estimate for free-space planning (logical, not measured). */
export function estimateMuxOutputBytes(opts: {
  durationSec: number
  width: number
  height: number
  fps: number
  hasAudio: boolean
  audioBitrateBps?: number
}): number {
  const pixels = opts.width * opts.height
  // Conservative photographic CFR band (~3 Mbit/s at 4K60); scale softly with resolution/fps.
  const refPixels = 3840 * 2160
  const refFps = 60
  const videoBps = 3_000_000 * (pixels / refPixels) * (opts.fps / refFps)
  const audioBps = opts.hasAudio ? opts.audioBitrateBps ?? 320_000 : 0
  return Math.ceil((videoBps + audioBps) * Math.max(0, opts.durationSec) / 8)
}
