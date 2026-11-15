import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  analyzePlaylistCompatibility,
  buildStreamSignature,
  diagnoseTrackVsSignature,
  type CompatibilityTrackInput,
} from './audioCompatibility'

function track(overrides: Partial<CompatibilityTrackInput> & { id: string; fileName: string }): CompatibilityTrackInput {
  return {
    status: 'ready',
    duration: 60,
    codec: 'mp3',
    sampleRate: 44100,
    channels: 2,
    channelLayout: 'stereo',
    bitrate: 256_000,
    trimStart: 0,
    trimEnd: 60,
    ...overrides,
  }
}

describe('audioCompatibility', () => {
  it('groups by codec/rate/channels and ignores bitrate differences', () => {
    const report = analyzePlaylistCompatibility({
      tracks: [
        track({ id: 'a', fileName: 'a.mp3', bitrate: 128_000 }),
        track({ id: 'b', fileName: 'b.mp3', bitrate: 320_000 }),
        track({ id: 'c', fileName: 'c.mp3', sampleRate: 48000, bitrate: 256_000 }),
      ],
      format: 'mp3',
      loopMode: 'simple',
      volumePercent: 100,
      fadeInSeconds: 0,
      fadeOutSeconds: 0,
      playlistCrossfade: false,
      playlistCrossfadeSeconds: 0,
      normalizeLoudness: false,
      targetDurationSeconds: 3600,
    })
    assert.equal(report.groups.length, 2)
    assert.equal(report.recommendedGroupId, report.groups[0]!.id)
    assert.equal(report.groups[0]!.trackCount, 2)
    assert.equal(report.mismatchingTrackIds.length, 1)
    assert.ok(report.trackMismatches[report.mismatchingTrackIds[0]!]?.some((m) => m.field === 'sampleRate'))
  })

  it('keeps tracks compatible when settings block stream copy', () => {
    const report = analyzePlaylistCompatibility({
      tracks: [track({ id: 'a', fileName: 'a.mp3' }), track({ id: 'b', fileName: 'b.mp3' })],
      format: 'mp3',
      loopMode: 'simple',
      volumePercent: 80,
      fadeInSeconds: 0,
      fadeOutSeconds: 0,
      playlistCrossfade: false,
      playlistCrossfadeSeconds: 0,
      normalizeLoudness: false,
      targetDurationSeconds: 600,
    })
    assert.equal(report.sourcesCompatible, true)
    assert.equal(report.processingBlockedBySettings, true)
    assert.equal(report.qualityPlan?.strategy, 'HIGH_QUALITY_REENCODE')
    assert.ok(report.suggestions.some((s) => /volume|fade/i.test(s.message)))
  })

  it('recommends largest group by track count then duration', () => {
    const report = analyzePlaylistCompatibility({
      tracks: [
        track({ id: '1', fileName: '1.mp3', duration: 10, trimEnd: 10 }),
        track({ id: '2', fileName: '2.mp3', duration: 10, trimEnd: 10 }),
        track({ id: '3', fileName: '3.mp3', sampleRate: 48000, duration: 100, trimEnd: 100 }),
      ],
      format: 'mp3',
      loopMode: 'simple',
      volumePercent: 100,
      fadeInSeconds: 0,
      fadeOutSeconds: 0,
      playlistCrossfade: false,
      playlistCrossfadeSeconds: 0,
      normalizeLoudness: false,
      targetDurationSeconds: 3600,
    })
    assert.equal(report.groups[0]!.trackCount, 2)
    assert.equal(report.recommendedGroupId, report.groups[0]!.id)
  })

  it('lists multiple mismatch reasons and builds signatures', () => {
    const sig = buildStreamSignature(track({ id: 'a', fileName: 'a.mp3' }))
    assert.ok(sig)
    const mismatches = diagnoseTrackVsSignature(
      track({ id: 'b', fileName: 'b.mp3', codec: 'aac', sampleRate: 48000, channels: 1 }),
      sig!,
    )
    assert.ok(mismatches.some((m) => m.field === 'codec'))
    assert.ok(mismatches.some((m) => m.field === 'sampleRate'))
    assert.ok(mismatches.some((m) => m.field === 'channels'))
  })

  it('surfaces encode-once eligibility for mixed-rate long targets', () => {
    const report = analyzePlaylistCompatibility({
      tracks: [
        track({ id: 'a', fileName: 'a.mp3', sampleRate: 44100, duration: 400, trimEnd: 400 }),
        track({ id: 'b', fileName: 'b.mp3', sampleRate: 48000, duration: 400, trimEnd: 400 }),
      ],
      format: 'mp3',
      loopMode: 'simple',
      volumePercent: 100,
      fadeInSeconds: 0,
      fadeOutSeconds: 0,
      playlistCrossfade: false,
      playlistCrossfadeSeconds: 0,
      normalizeLoudness: false,
      targetDurationSeconds: 14400,
      includeScreensaver: true,
      encodeOnceEnabled: true,
    })
    assert.equal(report.executionPlan?.strategy, 'ENCODE_ONCE_LOOP_COPY')
    assert.ok(report.impact?.encodeOnceEncodeInputSeconds != null)
    assert.ok((report.impact?.workloadReductionPercent ?? 0) > 50)
  })
})
