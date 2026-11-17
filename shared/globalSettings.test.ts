import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_FILENAME_PATTERN,
  DEFAULT_GLOBAL_SETTINGS,
  GLOBAL_SETTINGS_SCHEMA_VERSION,
  applyOverwriteProtection,
  cacheRetentionMs,
  expandFilenamePattern,
  migrateGlobalSettings,
  migrateServerGlobalSettings,
  sanitizeGeneratedFilename,
  validateFilenamePattern,
  validateGlobalSettings,
} from './globalSettings'

describe('globalSettings defaults', () => {
  it('exposes schema version 2 defaults', () => {
    assert.equal(DEFAULT_GLOBAL_SETTINGS.schemaVersion, GLOBAL_SETTINGS_SCHEMA_VERSION)
    assert.equal(GLOBAL_SETTINGS_SCHEMA_VERSION, 2)
    assert.equal(DEFAULT_GLOBAL_SETTINGS.general.language, 'en')
    assert.equal(DEFAULT_GLOBAL_SETTINGS.general.exportCompletionNotifications, true)
    assert.equal(DEFAULT_GLOBAL_SETTINGS.appearance.theme, 'dark')
    assert.equal(DEFAULT_GLOBAL_SETTINGS.appearance.accent, 'default')
    assert.equal(DEFAULT_GLOBAL_SETTINGS.appearance.density, 'comfortable')
    assert.equal(DEFAULT_GLOBAL_SETTINGS.appearance.interfaceAnimations, true)
    assert.equal(DEFAULT_GLOBAL_SETTINGS.storage.cacheRetention, 'never')
    assert.equal(DEFAULT_GLOBAL_SETTINGS.performance.autoCpuThreads, true)
    assert.equal(DEFAULT_GLOBAL_SETTINGS.export.filenamePattern, DEFAULT_FILENAME_PATTERN)
    assert.equal(DEFAULT_GLOBAL_SETTINGS.screensaver.renderingMode, 'optimized-cfr')
    assert.equal(DEFAULT_GLOBAL_SETTINGS.screensaver.encoder, 'cpu')
    assert.equal(DEFAULT_GLOBAL_SETTINGS.screensaver.previewRenderer, 'canvas2d')
  })
})

describe('migrateGlobalSettings', () => {
  it('returns defaults for null/corrupt input', () => {
    assert.deepEqual(migrateGlobalSettings(null), DEFAULT_GLOBAL_SETTINGS)
    assert.deepEqual(migrateGlobalSettings('bad'), DEFAULT_GLOBAL_SETTINGS)
    assert.deepEqual(migrateGlobalSettings({ schemaVersion: 1, general: true }), {
      ...DEFAULT_GLOBAL_SETTINGS,
      general: DEFAULT_GLOBAL_SETTINGS.general,
      appearance: DEFAULT_GLOBAL_SETTINGS.appearance,
      storage: DEFAULT_GLOBAL_SETTINGS.storage,
      performance: DEFAULT_GLOBAL_SETTINGS.performance,
      export: DEFAULT_GLOBAL_SETTINGS.export,
      screensaver: DEFAULT_GLOBAL_SETTINGS.screensaver,
    })
  })

  it('merges missing fields with defaults and migrates v1 → v2 appearance', () => {
    const migrated = migrateGlobalSettings({
      schemaVersion: 1,
      general: { desktopNotifications: true },
    })
    assert.equal(migrated.schemaVersion, 2)
    assert.equal(migrated.general.desktopNotifications, true)
    assert.equal(migrated.general.exportCompletionNotifications, true)
    assert.equal(migrated.general.language, 'en')
    assert.equal(migrated.appearance.theme, 'dark')
    assert.equal(migrated.storage.persistentAnimationCacheEnabled, true)
    assert.equal(migrated.screensaver.renderingMode, 'optimized-cfr')
  })

  it('accepts language and rejects invalid codes', () => {
    const ok = migrateGlobalSettings({
      schemaVersion: 2,
      general: { language: 'es' },
    })
    assert.equal(ok.general.language, 'es')
    const zh = migrateGlobalSettings({
      schemaVersion: 2,
      general: { language: 'zh' },
    })
    assert.equal(zh.general.language, 'zh')
    const bad = migrateGlobalSettings({
      schemaVersion: 2,
      general: { language: 'xx' },
    })
    assert.equal(bad.general.language, 'en')
  })

  it('accepts appearance preferences', () => {
    const migrated = migrateGlobalSettings({
      schemaVersion: 2,
      appearance: {
        theme: 'system',
        accent: 'teal',
        density: 'compact',
        interfaceAnimations: false,
      },
    })
    assert.equal(migrated.appearance.theme, 'system')
    assert.equal(migrated.appearance.accent, 'teal')
    assert.equal(migrated.appearance.density, 'compact')
    assert.equal(migrated.appearance.interfaceAnimations, false)
  })

  it('accepts screensaver output prefs', () => {
    const migrated = migrateGlobalSettings({
      schemaVersion: 1,
      screensaver: {
        renderingMode: 'fast-vfr',
        cfrQuality: 'high',
        profile: 'animated',
        previewRenderer: 'webgl2',
        encoder: 'auto',
      },
    })
    assert.equal(migrated.screensaver.renderingMode, 'fast-vfr')
    assert.equal(migrated.screensaver.cfrQuality, 'high')
    assert.equal(migrated.screensaver.previewRenderer, 'webgl2')
    assert.equal(migrated.screensaver.encoder, 'auto')
  })

  it('clamps invalid numbers and enums', () => {
    const migrated = migrateGlobalSettings({
      schemaVersion: 1,
      performance: {
        autoCpuThreads: false,
        cpuThreadLimit: 99,
        hardwareAcceleration: 'magic',
        minFreeDiskBytes: -1,
      },
      storage: { cacheRetention: 'forever' },
    })
    assert.equal(migrated.performance.cpuThreadLimit, 16)
    assert.equal(migrated.performance.hardwareAcceleration, 'auto')
    assert.equal(migrated.performance.minFreeDiskBytes, 0)
    assert.equal(migrated.storage.cacheRetention, 'never')
  })

  it('validateGlobalSettings aliases migrate', () => {
    assert.deepEqual(validateGlobalSettings({}), migrateGlobalSettings({}))
  })
})

describe('migrateServerGlobalSettings', () => {
  it('keeps only storage and performance', () => {
    const server = migrateServerGlobalSettings({
      schemaVersion: 1,
      storage: { persistentAnimationCacheEnabled: false, cacheRetention: '30d', autoCleanAbandonedTemp: false },
      performance: { autoCpuThreads: false, cpuThreadLimit: 2, hardwareAcceleration: 'disabled', minFreeDiskBytes: 1000 },
    })
    assert.equal(server.storage.cacheRetention, '30d')
    assert.equal(server.performance.cpuThreadLimit, 2)
    assert.equal(server.performance.hardwareAcceleration, 'disabled')
  })
})

describe('cacheRetentionMs', () => {
  it('maps policies', () => {
    assert.equal(cacheRetentionMs('never'), null)
    assert.equal(cacheRetentionMs('7d'), 7 * 24 * 60 * 60 * 1000)
    assert.equal(cacheRetentionMs('30d'), 30 * 24 * 60 * 60 * 1000)
    assert.equal(cacheRetentionMs('90d'), 90 * 24 * 60 * 60 * 1000)
  })
})

describe('filename helpers', () => {
  it('validates patterns', () => {
    assert.equal(validateFilenamePattern('{projectName}.{extension}').ok, true)
    assert.equal(validateFilenamePattern('../secret.{extension}').ok, false)
    assert.equal(validateFilenamePattern('{projectName}').ok, false)
    assert.equal(validateFilenamePattern('').ok, false)
  })

  it('sanitizes and expands filenames', () => {
    assert.equal(sanitizeGeneratedFilename('a/b<>c?.mp4'), 'a_b__c_.mp4')
    const name = expandFilenamePattern('{projectName}-{appName}-{date}.{extension}', {
      projectName: 'My Project',
      appName: 'Screensaver',
      date: '2026-11-16',
      extension: 'mp4',
    })
    assert.equal(name, 'My Project-Screensaver-2026-11-16.mp4')
  })

  it('prevents overwrite with numeric suffix', () => {
    assert.equal(applyOverwriteProtection('out.mp4', ['out.mp4']), 'out (2).mp4')
    assert.equal(applyOverwriteProtection('out.mp4', ['out.mp4', 'out (2).mp4']), 'out (3).mp4')
    assert.equal(applyOverwriteProtection('out.mp4', ['other.mp4']), 'out.mp4')
  })
})
