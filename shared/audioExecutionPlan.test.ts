import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildEncodedPeriodCacheKey,
  hasFullTimelineTransforms,
  planAudioExecution,
} from './audioExecutionPlan'
import { planAudioProcessing, type AudioSourceProbe } from './audioProcessingPlan'

function mp3(overrides: Partial<AudioSourceProbe> = {}): AudioSourceProbe {
  return {
    codec: 'mp3',
    bitrate: 256_000,
    streamBitrate: 256_000,
    sampleRate: 44100,
    channels: 2,
    duration: 400,
    ...overrides,
  }
}

describe('audioExecutionPlan', () => {
  it('selects DIRECT_STREAM_COPY when quality plan is STREAM_COPY', () => {
    const sources = [mp3(), mp3({ sampleRate: 44100, duration: 376.466 })]
    const quality = planAudioProcessing({
      sources,
      destination: 'mp4-copy',
      operations: { muxVolume: 1, muxFadeIn: 0, muxFadeOut: 0, volumePercent: 100 },
    })
    // Same rate → may stream copy; if not, still test direct when strategy matches.
    const plan = planAudioExecution({
      sources: [mp3()],
      destination: 'mp4-copy',
      operations: { muxVolume: 1, muxFadeIn: 0, muxFadeOut: 0, volumePercent: 100 },
      qualityPlan: { ...quality, strategy: 'STREAM_COPY', reencodeRequired: false, lossyEncodeBudget: 0 },
      targetDurationSeconds: 14400,
      periodDurationSeconds: 776.466,
    })
    assert.equal(plan.strategy, 'DIRECT_STREAM_COPY')
  })

  it('selects ENCODE_ONCE_LOOP_COPY for mixed-rate MP3 playlist without global fades', () => {
    const sources = [
      mp3({ sampleRate: 44100, duration: 400 }),
      mp3({ sampleRate: 48000, duration: 376.466, bitrate: 256_000 }),
    ]
    const plan = planAudioExecution({
      sources,
      destination: 'mp4-aac',
      operations: {
        volumePercent: 100,
        muxVolume: 1,
        muxFadeIn: 0,
        muxFadeOut: 0,
        playlistCrossfade: false,
      },
      targetDurationSeconds: 14400,
      periodDurationSeconds: 776.466,
      encodeOnceEnabled: true,
      globalGainOnFullTimeline: true,
    })
    assert.equal(plan.strategy, 'ENCODE_ONCE_LOOP_COPY')
    assert.equal(plan.requiresBoundaryVerification, true)
    assert.equal(plan.qualityPlan.strategy, 'HIGH_QUALITY_REENCODE')
    assert.ok((plan.targetBitrateKbps ?? 0) >= 256)
  })

  it('rejects encode-once when global fade-out is set', () => {
    const sources = [mp3({ sampleRate: 44100 }), mp3({ sampleRate: 48000, duration: 300 })]
    const plan = planAudioExecution({
      sources,
      destination: 'mp4-aac',
      operations: { muxVolume: 1, muxFadeIn: 0, muxFadeOut: 3, volumePercent: 100 },
      targetDurationSeconds: 14400,
      periodDurationSeconds: 700,
      encodeOnceEnabled: true,
    })
    assert.equal(plan.strategy, 'STANDARD_PROCESSING')
    assert.ok(plan.ineligibilityReasons.some((r) => /fade-out/i.test(r)))
  })

  it('rejects encode-once for seamless and when target ≤ period', () => {
    const seamless = planAudioExecution({
      sources: [mp3()],
      destination: 'mp4-aac',
      operations: { seamlessCrossfade: true, muxVolume: 1 },
      targetDurationSeconds: 14400,
      periodDurationSeconds: 400,
      encodeOnceEnabled: true,
    })
    assert.equal(seamless.strategy, 'STANDARD_PROCESSING')

    const short = planAudioExecution({
      sources: [mp3({ sampleRate: 44100 }), mp3({ sampleRate: 48000 })],
      destination: 'mp4-aac',
      operations: { muxVolume: 1 },
      targetDurationSeconds: 100,
      periodDurationSeconds: 200,
      encodeOnceEnabled: true,
    })
    assert.equal(short.strategy, 'STANDARD_PROCESSING')
  })

  it('honors feature flag off and looper destinations', () => {
    const sources = [mp3({ sampleRate: 44100 }), mp3({ sampleRate: 48000 })]
    const flagged = planAudioExecution({
      sources,
      destination: 'mp4-aac',
      operations: { muxVolume: 1 },
      targetDurationSeconds: 3600,
      periodDurationSeconds: 100,
      encodeOnceEnabled: false,
    })
    assert.equal(flagged.strategy, 'STANDARD_PROCESSING')

    const looper = planAudioExecution({
      sources,
      destination: 'looper-mp3',
      operations: { volumePercent: 100 },
      targetDurationSeconds: 3600,
      periodDurationSeconds: 100,
      encodeOnceEnabled: true,
    })
    assert.equal(looper.strategy, 'STANDARD_PROCESSING')
  })

  it('flags full-timeline transforms and builds stable cache keys', () => {
    const blocked = hasFullTimelineTransforms({ muxFadeOut: 2 })
    assert.equal(blocked.blocked, true)
    const key1 = buildEncodedPeriodCacheKey({
      sourceContentHashes: ['a', 'b'],
      sourceOrder: [0, 1],
      trimStarts: [0, 0],
      trimEnds: [10, 10],
      volumePercent: 100,
      loopMode: 'simple',
      playlistCrossfade: false,
      playlistCrossfadeSeconds: 0,
      normalizeLoudness: false,
      outputCodec: 'aac',
      sampleRate: 48000,
      channels: 2,
      targetBitrateKbps: 256,
      encoderId: 'aac_mf',
    })
    const key2 = buildEncodedPeriodCacheKey({
      sourceContentHashes: ['a', 'b'],
      sourceOrder: [0, 1],
      trimStarts: [0, 0],
      trimEnds: [10, 10],
      volumePercent: 100,
      loopMode: 'simple',
      playlistCrossfade: false,
      playlistCrossfadeSeconds: 0,
      normalizeLoudness: false,
      outputCodec: 'aac',
      sampleRate: 48000,
      channels: 2,
      targetBitrateKbps: 256,
      encoderId: 'aac_mf',
    })
    assert.equal(key1, key2)
    assert.ok(!key1.includes('14400'))
  })
})
