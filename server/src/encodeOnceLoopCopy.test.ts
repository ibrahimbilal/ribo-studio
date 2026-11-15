import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  analyzeAacFrameAlignment,
  buildPeriodFilterGraph,
  snapPeriodSecondsToAacFrames,
} from './encodeOnceLoopCopy'
import { isEncodeOnceLoopCopyEnabled } from './audioPeriodCache'

describe('encodeOnceLoopCopy helpers', () => {
  it('snaps periods to AAC-LC frame boundaries at 48 kHz', () => {
    const snapped = snapPeriodSecondsToAacFrames(776.466, 48000)
    const align = analyzeAacFrameAlignment(snapped, 48000)
    assert.equal(align.frameAligned, true)
    assert.ok(snapped >= 776.466)
  })

  it('builds a two-input resample concat graph', () => {
    const graph = buildPeriodFilterGraph({
      sources: [
        { path: 'a.mp3', sampleRate: 44100, channels: 2, duration: 8 },
        { path: 'b.mp3', sampleRate: 48000, channels: 2, duration: 7.5 },
      ],
      sampleRate: 48000,
      channels: 2,
      padToSeconds: 15.594667,
    })
    assert.match(graph, /aresample=48000/)
    assert.match(graph, /concat=n=2/)
    assert.match(graph, /apad=whole_dur=/)
  })

  it('defaults encode-once feature flag to enabled', () => {
    assert.equal(isEncodeOnceLoopCopyEnabled({}), true)
    assert.equal(isEncodeOnceLoopCopyEnabled({ RIBO_ENCODE_ONCE_LOOP_COPY: '0' }), false)
    assert.equal(isEncodeOnceLoopCopyEnabled({ RIBO_ENCODE_ONCE_LOOP_COPY: 'false' }), false)
    assert.equal(isEncodeOnceLoopCopyEnabled({ RIBO_ENCODE_ONCE_LOOP_COPY: '1' }), true)
  })
})
