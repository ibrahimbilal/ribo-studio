import { describe, expect, it } from 'vitest'
import {
  applySettingsSnapshot,
  extractSettingsSnapshot,
  resolveAudioModeForPaste,
  resolveModeForPaste,
  setCopiedProjectSettings,
} from './copyProjectSettings'
import type { SavedScreensaverProject } from '../types'

function baseProject(overrides: Partial<SavedScreensaverProject> = {}): SavedScreensaverProject {
  return {
    version: 3,
    id: 'project-a',
    name: 'Test',
    mode: 'static',
    mediaKind: 'image',
    serverId: 'srv',
    fileName: 'photo.jpg',
    width: 1920,
    height: 1080,
    sourceDuration: null,
    hasAudio: false,
    thumbnail: null,
    outputWidth: 3840,
    outputHeight: 2160,
    fps: 30,
    durationSeconds: 14_400,
    durationPresetKey: '4h',
    fit: 'contain',
    loopType: 'hard',
    crossfadeSeconds: 0,
    audioMode: 'none',
    audioVolume: 100,
    audioFadeIn: 0,
    audioFadeOut: 0,
    loopAudio: true,
    backgroundColor: '#000000',
    audioFileName: null,
    ...overrides,
  }
}

describe('copyProjectSettings', () => {
  it('extracts and applies output settings without touching identity or media fields', () => {
    const source = baseProject({
      id: 'source-id',
      name: 'Source name',
      thumbnail: 'thumb:data',
      durationSeconds: 7200,
      fps: 60,
    })
    const snapshot = extractSettingsSnapshot(source)
    setCopiedProjectSettings(snapshot)

    const target = baseProject({
      id: 'target-id',
      name: 'Target name',
      fileName: 'other.png',
      serverId: 'other-srv',
      width: 1280,
      height: 720,
      thumbnail: 'keep-me',
      durationSeconds: 3600,
      fps: 24,
    })
    const updated = applySettingsSnapshot(target, snapshot)

    expect(updated.id).toBe('target-id')
    expect(updated.name).toBe('Target name')
    expect(updated.thumbnail).toBe('keep-me')
    expect(updated.serverId).toBe('other-srv')
    expect(updated.fps).toBe(60)
    expect(updated.durationSeconds).toBe(7200)
  })

  it('resolves audio mode safely for upload without files', () => {
    const source = baseProject({ audioMode: 'upload' })
    const snapshot = extractSettingsSnapshot(source)
    const target = baseProject({ audioAssetId: 'asset-1', audioFileName: 'song.mp3' })
    expect(resolveAudioModeForPaste(snapshot.audioMode, target)).toBe('upload')
    expect(resolveAudioModeForPaste(snapshot.audioMode, baseProject())).toBe('none')
  })

  it('resolves mode only when media kind matches', () => {
    expect(resolveModeForPaste('static', baseProject({ mediaKind: 'image' }))).toBe('static')
    expect(resolveModeForPaste('loop', baseProject({ mediaKind: 'image' }))).toBeNull()
    expect(resolveModeForPaste('loop', baseProject({ mediaKind: 'video' }))).toBe('loop')
  })
})