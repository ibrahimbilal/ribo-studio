import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isPlainGain,
  looperDestination,
  maxReliableSourceBitrateBps,
  planAudioProcessing,
  resolveCommonSampleRate,
  snapAacBitrateKbps,
  snapMp3BitrateKbps,
  type AudioSourceProbe,
} from './audioProcessingPlan'

function mp3Source(overrides: Partial<AudioSourceProbe> = {}): AudioSourceProbe {
  return {
    codec: 'mp3',
    bitrate: 320_000,
    streamBitrate: 320_000,
    sampleRate: 44100,
    channels: 2,
    duration: 10,
    ...overrides,
  }
}

describe('audioProcessingPlan', () => {
  it('stream-copies a plain MP3 loop to looper-mp3', () => {
    const plan = planAudioProcessing({
      sources: [mp3Source()],
      destination: 'looper-mp3',
      looperFormat: 'mp3',
      operations: { volumePercent: 100, fadeInSeconds: 0, fadeOutSeconds: 0, userMp3Bitrate: 192 },
    })
    assert.equal(plan.strategy, 'STREAM_COPY')
    assert.equal(plan.lossyEncodeBudget, 0)
    assert.equal(plan.reencodeRequired, false)
  })

  it('stream-copies compatible MP3 playlist with different bitrates', () => {
    const plan = planAudioProcessing({
      sources: [
        mp3Source({ bitrate: 128_000, streamBitrate: 128_000 }),
        mp3Source({ bitrate: 320_000, streamBitrate: 320_000 }),
      ],
      destination: 'looper-mp3',
      operations: { volumePercent: 100 },
    })
    assert.equal(plan.strategy, 'STREAM_COPY')
    assert.equal(plan.lossyEncodeBudget, 0)
  })

  it('uses highest source bitrate when re-encoding a mixed-codec playlist', () => {
    const plan = planAudioProcessing({
      sources: [
        mp3Source({ bitrate: 128_000 }),
        { codec: 'aac', bitrate: 256_000, sampleRate: 44100, channels: 2, duration: 8 },
      ],
      destination: 'looper-mp3',
      operations: { volumePercent: 100, userMp3Bitrate: 192 },
    })
    assert.equal(plan.strategy, 'HIGH_QUALITY_REENCODE')
    assert.equal(plan.targetBitrateKbps, 256)
    assert.equal(plan.lossyEncodeBudget, 1)
  })

  it('requires decode for crossfade and volume', () => {
    const xf = planAudioProcessing({
      sources: [mp3Source(), mp3Source()],
      destination: 'looper-mp3',
      operations: { playlistCrossfade: true, playlistCrossfadeSeconds: 3, userMp3Bitrate: 192 },
    })
    assert.notEqual(xf.strategy, 'STREAM_COPY')
    const vol = planAudioProcessing({
      sources: [mp3Source()],
      destination: 'looper-mp3',
      operations: { volumePercent: 80 },
    })
    assert.notEqual(vol.strategy, 'STREAM_COPY')
  })

  it('stream-copies AAC/MP3 into MP4 when plain', () => {
    const aac = planAudioProcessing({
      sources: [{ codec: 'aac', bitrate: 256_000, sampleRate: 48000, channels: 2, duration: 5 }],
      destination: 'mp4-aac',
      operations: { muxVolume: 1, muxFadeIn: 0, muxFadeOut: 0 },
    })
    assert.equal(aac.strategy, 'STREAM_COPY')
    const mp3 = planAudioProcessing({
      sources: [mp3Source()],
      destination: 'mp4-copy',
      operations: { muxVolume: 1, muxFadeIn: 0, muxFadeOut: 0 },
    })
    assert.equal(mp3.strategy, 'STREAM_COPY')
  })

  it('re-encodes to AAC once when MP4 mux has fades', () => {
    const plan = planAudioProcessing({
      sources: [mp3Source({ bitrate: 320_000 })],
      destination: 'mp4-aac',
      operations: { muxVolume: 1, muxFadeIn: 2, muxFadeOut: 3 },
    })
    assert.equal(plan.strategy, 'HIGH_QUALITY_REENCODE')
    assert.equal(plan.expectedCodec, 'aac')
    assert.equal(plan.targetBitrateKbps, 320)
    assert.equal(plan.lossyEncodeBudget, 1)
  })

  it('preserves shared sample rate and picks highest when mixed', () => {
    assert.equal(resolveCommonSampleRate([mp3Source(), mp3Source()]).rate, 44100)
    assert.equal(
      resolveCommonSampleRate([mp3Source({ sampleRate: 44100 }), mp3Source({ sampleRate: 48000 })]).rate,
      48000,
    )
  })

  it('snaps bitrates without inventing missing values', () => {
    assert.equal(snapMp3BitrateKbps(320_000), 320)
    assert.equal(snapMp3BitrateKbps(0), 320)
    assert.equal(snapAacBitrateKbps(192_000, 2), 192)
    assert.equal(maxReliableSourceBitrateBps([mp3Source({ bitrate: 128_000 }), mp3Source({ bitrate: 320_000 })]), 320_000)
  })

  it('detects plain gain and maps looper destinations', () => {
    assert.equal(isPlainGain({ volumePercent: 100 }), true)
    assert.equal(isPlainGain({ muxVolume: 0.7 }), false)
    assert.equal(isPlainGain({ volumePercent: 80, muxVolume: 1 }), false)
    assert.equal(isPlainGain({ volumePercent: 100, muxVolume: 1, fadeInSeconds: 0, muxFadeIn: 0 }), true)
    assert.equal(looperDestination('flac'), 'looper-flac')
  })

  it('does not stream-copy into MP4 when Looper volume is below unity', () => {
    const plan = planAudioProcessing({
      sources: [mp3Source()],
      destination: 'mp4-copy',
      operations: { volumePercent: 80, muxVolume: 1, muxFadeIn: 0, muxFadeOut: 0 },
    })
    assert.equal(plan.strategy, 'HIGH_QUALITY_REENCODE')
    assert.equal(plan.lossyEncodeBudget, 1)
  })
})
