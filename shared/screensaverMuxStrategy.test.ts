import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isDirectAudioPeriodLoopEnabled,
  isSinglePassDirectMuxEnabled,
  resolveScreensaverMuxEligibility,
} from './screensaverMuxStrategy'

describe('screensaverMuxStrategy', () => {
  it('defaults single-pass and direct audio loop to enabled', () => {
    assert.equal(isSinglePassDirectMuxEnabled({}), true)
    assert.equal(isDirectAudioPeriodLoopEnabled({}), true)
    const e = resolveScreensaverMuxEligibility({})
    assert.equal(e.strategy, 'SINGLE_PASS_DIRECT_MUX')
    assert.equal(e.directVideoAssembly, true)
    assert.equal(e.directAudioPeriodLoop, true)
    assert.equal(e.skipIntermediateFaststart, true)
  })

  it('RIBO_SINGLE_PASS_DIRECT_MUX=0 forces legacy', () => {
    const e = resolveScreensaverMuxEligibility({ RIBO_SINGLE_PASS_DIRECT_MUX: '0' })
    assert.equal(e.strategy, 'LEGACY_MULTI_PASS')
    assert.equal(e.directVideoAssembly, false)
    assert.equal(isDirectAudioPeriodLoopEnabled({ RIBO_SINGLE_PASS_DIRECT_MUX: '0' }), false)
  })

  it('allows disabling direct audio loop independently', () => {
    const e = resolveScreensaverMuxEligibility({
      RIBO_SINGLE_PASS_DIRECT_MUX: '1',
      RIBO_DIRECT_AUDIO_PERIOD_LOOP: '0',
    })
    assert.equal(e.strategy, 'SINGLE_PASS_DIRECT_MUX')
    assert.equal(e.directVideoAssembly, true)
    assert.equal(e.directAudioPeriodLoop, false)
  })
})
