import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { estimateMuxOutputBytes } from './diskSpace'

describe('diskSpace', () => {
  it('estimates larger outputs for longer duration and audio', () => {
    const short = estimateMuxOutputBytes({
      durationSec: 60,
      width: 3840,
      height: 2160,
      fps: 60,
      hasAudio: false,
    })
    const long = estimateMuxOutputBytes({
      durationSec: 3600,
      width: 3840,
      height: 2160,
      fps: 60,
      hasAudio: false,
    })
    const withAudio = estimateMuxOutputBytes({
      durationSec: 3600,
      width: 3840,
      height: 2160,
      fps: 60,
      hasAudio: true,
      audioBitrateBps: 256_000,
    })
    assert.ok(long > short * 50)
    assert.ok(withAudio > long)
  })
})
