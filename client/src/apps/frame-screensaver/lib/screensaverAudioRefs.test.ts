import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  canDeleteAudioAsset,
  countProjectsReferencingAudioAsset,
  projectHasBackgroundAudio,
} from './screensaverAudioRefs'

describe('screensaverAudioRefs', () => {
  const projects = [
    { id: 'p1', audioAssetId: 'asset-a', audioMode: 'upload' },
    { id: 'p2', audioAssetId: 'asset-a', audioMode: 'upload' },
    { id: 'p3', audioAssetId: 'asset-b', audioMode: 'upload' },
    { id: 'p4', audioAssetId: null, audioMode: 'none' },
  ]

  it('counts shared audio references across projects', () => {
    assert.equal(countProjectsReferencingAudioAsset(projects, 'asset-a'), 2)
    assert.equal(countProjectsReferencingAudioAsset(projects, 'asset-a', { exceptProjectId: 'p1' }), 1)
    assert.equal(countProjectsReferencingAudioAsset(projects, 'asset-b'), 1)
    assert.equal(countProjectsReferencingAudioAsset(projects, 'missing'), 0)
  })

  it('only allows delete when no other project references the asset', () => {
    assert.equal(canDeleteAudioAsset(projects, 'asset-a', { exceptProjectId: 'p1' }), false)
    assert.equal(canDeleteAudioAsset(projects, 'asset-b', { exceptProjectId: 'p3' }), true)
    assert.equal(canDeleteAudioAsset(projects, 'asset-a'), false)
  })

  it('detects projects that already have background audio', () => {
    assert.equal(projectHasBackgroundAudio({ audioMode: 'upload', audioAssetId: 'x' }), true)
    assert.equal(projectHasBackgroundAudio({ audioMode: 'none', audioFileName: 'a.mp3' }), true)
    assert.equal(projectHasBackgroundAudio({ audioMode: 'none', audioAssetId: null }), false)
  })
})
