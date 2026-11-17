import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ACCENT_PALETTES, accentPalette } from './appearanceTokens'

describe('appearanceTokens', () => {
  it('includes the default Ribo accent and curated set', () => {
    assert.equal(ACCENT_PALETTES[0]?.id, 'default')
    assert.equal(ACCENT_PALETTES[0]?.brand, '#0078f8')
    assert.equal(ACCENT_PALETTES.length, 9)
  })

  it('falls back to default for unknown accents via accentPalette', () => {
    assert.equal(accentPalette('teal').id, 'teal')
    assert.equal(accentPalette('default').on, '#ffffff')
  })
})
