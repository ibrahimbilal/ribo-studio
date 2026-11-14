import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  SCREENSAVER_PREPARE_PROGRESS_END,
  mapScreensaverPrepareProgress,
  screensaverPrepareOverall,
  screensaverPrepareUiProgress,
  screensaverPrepareWeights,
} from './screensaverPrepareProgress'

describe('screensaver prepare progress weights', () => {
  it('keeps animation-enabled weights summing to 1', () => {
    const w = screensaverPrepareWeights(true)
    assert.equal(w.composition + w.animation + w.upload, 1)
  })

  it('redistributes animation weight when disabled', () => {
    const w = screensaverPrepareWeights(false)
    assert.equal(w.animation, 0)
    assert.equal(w.composition + w.upload, 1)
  })

  it('maps overall completion into the prepare UI band without jumping backward', () => {
    const enabled = true
    const afterComposition = screensaverPrepareUiProgress(enabled, {
      composition: 1,
      animation: 0,
      upload: 0,
    })
    const midAnimation = screensaverPrepareUiProgress(enabled, {
      composition: 1,
      animation: 0.5,
      upload: 0,
    })
    const afterAnimation = screensaverPrepareUiProgress(enabled, {
      composition: 1,
      animation: 1,
      upload: 0,
    })
    const midUpload = screensaverPrepareUiProgress(enabled, {
      composition: 1,
      animation: 1,
      upload: 0.5,
    })
    const done = screensaverPrepareUiProgress(enabled, {
      composition: 1,
      animation: 1,
      upload: 1,
    })
    assert.ok(afterComposition < midAnimation)
    assert.ok(midAnimation < afterAnimation)
    assert.ok(afterAnimation < midUpload)
    assert.ok(midUpload < done)
    assert.equal(done, SCREENSAVER_PREPARE_PROGRESS_END)
    assert.equal(mapScreensaverPrepareProgress(1), SCREENSAVER_PREPARE_PROGRESS_END)
    assert.equal(screensaverPrepareOverall(screensaverPrepareWeights(true), { composition: 1, animation: 1, upload: 1 }), 1)
  })
})
