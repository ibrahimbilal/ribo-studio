import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeYoutubeChannelInput, youtubeHandleFromUrl } from './youtubeChannel'

describe('normalizeYoutubeChannelInput', () => {
  it('accepts channel ids', () => {
    const result = normalizeYoutubeChannelInput('UCxxxxxxxxxxxxxxxxxxxxxx')
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.channelId, 'UCxxxxxxxxxxxxxxxxxxxxxx')
    assert.match(result.normalizedUrl, /\/channel\/UC/)
  })

  it('accepts @handles', () => {
    const result = normalizeYoutubeChannelInput('@RiboGalleryTV')
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.handle, 'RiboGalleryTV')
    assert.equal(result.normalizedUrl, 'https://www.youtube.com/@RiboGalleryTV')
  })

  it('accepts channel URLs', () => {
    const result = normalizeYoutubeChannelInput('https://www.youtube.com/@Someone')
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.handle, 'Someone')
  })

  it('rejects empty input', () => {
    assert.equal(normalizeYoutubeChannelInput('').ok, false)
  })
})

describe('youtubeHandleFromUrl', () => {
  it('extracts handles', () => {
    assert.equal(youtubeHandleFromUrl('https://www.youtube.com/@DemoChannel'), 'DemoChannel')
    assert.equal(youtubeHandleFromUrl('https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx'), null)
  })
})
