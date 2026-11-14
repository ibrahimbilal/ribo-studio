import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  audioChannelLabel,
  channelLayoutToken,
  pcmNormalizeFilter,
  resolveOutputChannels,
} from './audioLooperChannels'

describe('audio looper channel policy', () => {
  it('keeps mono when every track is mono', () => {
    assert.equal(resolveOutputChannels([1, 1, 1], 'mp3'), 1)
    assert.equal(resolveOutputChannels([1], 'wav'), 1)
  })

  it('keeps stereo for stereo-only and mixed mono/stereo', () => {
    assert.equal(resolveOutputChannels([2, 2], 'mp3'), 2)
    assert.equal(resolveOutputChannels([1, 2], 'flac'), 2)
    assert.equal(resolveOutputChannels([2], 'wav'), 2)
  })

  it('downmixes multi-channel for mp3 and preserves matching multi for wav/flac', () => {
    assert.equal(resolveOutputChannels([6, 6], 'mp3'), 2)
    assert.equal(resolveOutputChannels([6, 6], 'wav'), 6)
    assert.equal(resolveOutputChannels([6, 6], 'flac'), 6)
    assert.equal(resolveOutputChannels([6, 2], 'wav'), 2)
  })

  it('defaults unknown counts to stereo', () => {
    assert.equal(resolveOutputChannels([null, 0, undefined], 'mp3'), 2)
    assert.equal(resolveOutputChannels([], 'wav'), 2)
  })

  it('builds pcm normalize filters and labels', () => {
    assert.equal(channelLayoutToken(1), 'mono')
    assert.equal(channelLayoutToken(2), 'stereo')
    assert.equal(channelLayoutToken(6), '6c')
    assert.match(pcmNormalizeFilter(48000, 1), /channel_layouts=mono/)
    assert.match(pcmNormalizeFilter(44100, 2), /sample_rates=44100.*channel_layouts=stereo/)
    assert.equal(audioChannelLabel(1), 'Mono')
    assert.equal(audioChannelLabel(2), 'Stereo')
    assert.equal(audioChannelLabel(6, '5.1'), '5.1')
    assert.equal(audioChannelLabel(8), '8 ch')
    assert.equal(audioChannelLabel(null), '')
    assert.equal(audioChannelLabel(0), '')
  })
})
