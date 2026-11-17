import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_GLOBAL_SETTINGS } from './globalSettings'
import {
  SETTINGS_BACKUP_FORMAT_ID,
  applySettingsBackupToGlobal,
  buildSettingsBackup,
  parseSettingsBackupJson,
  previewSettingsImport,
  settingsBackupFilename,
  stripUnsafeKeys,
} from './settingsBackup'

describe('settingsBackup', () => {
  it('builds a versioned envelope without secrets or export paths', () => {
    const settings = {
      ...DEFAULT_GLOBAL_SETTINGS,
      export: { ...DEFAULT_GLOBAL_SETTINGS.export, lastExportDirectory: 'C:\\Users\\secret\\exports' },
    }
    const envelope = buildSettingsBackup({
      settings,
      categories: ['general', 'appearance', 'export'],
      appVersion: '1.5.0',
      exportedAt: new Date('2026-11-17T00:00:00.000Z'),
    })
    assert.equal(envelope.formatId, SETTINGS_BACKUP_FORMAT_ID)
    assert.equal(envelope.appVersion, '1.5.0')
    assert.equal(envelope.settings.export?.lastExportDirectory, null)
    assert.equal(envelope.settings.appearance?.theme, 'dark')
    assert.ok(!('apiKey' in envelope.settings))
  })

  it('rejects invalid JSON and unknown formats', () => {
    assert.equal(parseSettingsBackupJson('{').ok, false)
    assert.equal(parseSettingsBackupJson(JSON.stringify({ formatId: 'other' })).ok, false)
  })

  it('rejects newer unsupported schemas', () => {
    const envelope = buildSettingsBackup({
      settings: DEFAULT_GLOBAL_SETTINGS,
      categories: ['appearance'],
      appVersion: '9.0.0',
    })
    const raw = JSON.stringify({ ...envelope, settingsSchemaVersion: 999 })
    const parsed = parseSettingsBackupJson(raw)
    assert.equal(parsed.ok, false)
  })

  it('strips prototype pollution keys', () => {
    const cleaned = stripUnsafeKeys(JSON.parse('{"appearance":{"theme":"light"},"__proto__":{"polluted":true}}'))
    assert.equal((cleaned as { appearance: { theme: string } }).appearance.theme, 'light')
    assert.equal(Object.prototype.hasOwnProperty.call(cleaned, '__proto__'), false)
  })

  it('merges and replaces categories', () => {
    const current = {
      ...DEFAULT_GLOBAL_SETTINGS,
      general: { ...DEFAULT_GLOBAL_SETTINGS.general, desktopNotifications: true },
      appearance: { ...DEFAULT_GLOBAL_SETTINGS.appearance, accent: 'red' as const },
    }
    const envelope = buildSettingsBackup({
      settings: {
        ...DEFAULT_GLOBAL_SETTINGS,
        appearance: { ...DEFAULT_GLOBAL_SETTINGS.appearance, theme: 'light', accent: 'teal' },
      },
      categories: ['appearance'],
      appVersion: '1.5.0',
    })
    const merged = applySettingsBackupToGlobal(current, envelope, ['appearance'], 'merge')
    assert.equal(merged.appearance.theme, 'light')
    assert.equal(merged.appearance.accent, 'teal')
    assert.equal(merged.general.desktopNotifications, true)

    const replaced = applySettingsBackupToGlobal(current, envelope, ['appearance'], 'replace-categories')
    assert.equal(replaced.appearance.theme, 'light')
    assert.equal(replaced.general.desktopNotifications, true)
  })

  it('previews import change counts and channel notes', () => {
    const envelope = buildSettingsBackup({
      settings: {
        ...DEFAULT_GLOBAL_SETTINGS,
        appearance: { ...DEFAULT_GLOBAL_SETTINGS.appearance, theme: 'light' },
      },
      categories: ['appearance', 'youtubeChannels'],
      appVersion: '1.5.0',
      channels: [
        {
          channelId: 'UCxxxxxxxxxxxxxxxxxxxxxx',
          channelName: 'Demo',
          channelHandle: 'demo',
          channelUrl: 'https://www.youtube.com/@demo',
          channelAvatarUrl: null,
          channelSubscriberCount: null,
          updatedAt: 1,
        },
      ],
      defaultChannelId: 'UCxxxxxxxxxxxxxxxxxxxxxx',
    })
    const preview = previewSettingsImport({
      envelope,
      current: DEFAULT_GLOBAL_SETTINGS,
      selectedCategories: ['appearance', 'youtubeChannels'],
      mode: 'merge',
      currentChannelCount: 1,
    })
    assert.ok(preview.changeCount >= 1)
    assert.equal(preview.channelCount, 1)
    assert.ok(preview.machineSpecificNotes.length >= 1)
  })

  it('names backup files by date', () => {
    assert.equal(settingsBackupFilename(new Date('2026-11-17T12:00:00Z')), 'ribo-studio-settings-2026-11-17.json')
  })

  it('deduplicates channel records by stable id on parse', () => {
    const envelope = buildSettingsBackup({
      settings: DEFAULT_GLOBAL_SETTINGS,
      categories: ['youtubeChannels'],
      appVersion: '1.5.0',
      channels: [
        {
          channelId: 'UCxxxxxxxxxxxxxxxxxxxxxx',
          channelName: 'A',
          channelHandle: null,
          channelUrl: 'https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx',
          channelAvatarUrl: null,
          channelSubscriberCount: null,
          updatedAt: 1,
        },
        {
          channelId: 'not-a-channel',
          channelName: 'Bad',
          channelHandle: null,
          channelUrl: 'x',
          channelAvatarUrl: null,
          channelSubscriberCount: null,
          updatedAt: 1,
        },
      ],
    })
    const parsed = parseSettingsBackupJson(JSON.stringify(envelope))
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.envelope.settings.youtubeChannels?.length, 1)
    assert.ok(parsed.notes.some((n) => n.includes('invalid')))
  })
})
