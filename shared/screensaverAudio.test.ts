import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  SCREENSAVER_AUDIO_MAX_BYTES,
  formatScreensaverAudioLimitLabel,
  validateScreensaverAudioFileMeta,
} from './screensaverAudio'

describe('screensaverAudio limits', () => {
  it('allows a 329 MB mp3 under the 1 GiB cap', () => {
    assert.equal(
      validateScreensaverAudioFileMeta({
        name: 'loop.mp3',
        type: 'audio/mpeg',
        size: 329 * 1024 * 1024,
      }),
      null,
    )
  })

  it('allows a file just under the configured limit', () => {
    assert.equal(
      validateScreensaverAudioFileMeta({
        name: 'near-limit.wav',
        type: 'audio/wav',
        size: SCREENSAVER_AUDIO_MAX_BYTES - 1,
      }),
      null,
    )
  })

  it('rejects a file above the configured limit', () => {
    const message = validateScreensaverAudioFileMeta({
      name: 'too-big.mp3',
      type: 'audio/mpeg',
      size: SCREENSAVER_AUDIO_MAX_BYTES + 1,
    })
    assert.ok(message)
    assert.match(message, new RegExp(formatScreensaverAudioLimitLabel().replace('.', '\\.')))
  })

  it('accepts flac for screensaver transfers', () => {
    assert.equal(
      validateScreensaverAudioFileMeta({
        name: 'loop.flac',
        type: 'audio/flac',
        size: 12 * 1024 * 1024,
      }),
      null,
    )
  })

  it('rejects unsupported containers', () => {
    const message = validateScreensaverAudioFileMeta({
      name: 'clip.avi',
      type: 'video/avi',
      size: 1024,
    })
    assert.ok(message)
    assert.match(message, /MP3/i)
  })
})
