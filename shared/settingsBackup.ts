/**
 * Versioned settings backup envelope (preferences only — never secrets or media).
 */

import {
  DEFAULT_GLOBAL_SETTINGS,
  GLOBAL_SETTINGS_SCHEMA_VERSION,
  migrateGlobalSettings,
  type GlobalSettings,
  type GlobalSettingsAppearance,
  type GlobalSettingsExport,
  type GlobalSettingsGeneral,
  type GlobalSettingsPerformance,
  type GlobalSettingsStorage,
} from './globalSettings'
import { isYoutubeChannelId } from './youtubeChannelId'

export const SETTINGS_BACKUP_FORMAT_ID = 'ribo-studio-settings'
export const SETTINGS_BACKUP_FORMAT_VERSION = 1
export const SETTINGS_BACKUP_MAX_BYTES = 2 * 1024 * 1024

export type SettingsBackupCategory =
  | 'general'
  | 'appearance'
  | 'performance'
  | 'export'
  | 'storage'
  | 'youtubeChannels'

export const ALL_SETTINGS_BACKUP_CATEGORIES: readonly SettingsBackupCategory[] = [
  'general',
  'appearance',
  'performance',
  'export',
  'storage',
  'youtubeChannels',
] as const

export interface YoutubeChannelBackupRecord {
  channelId: string
  channelName: string
  channelHandle: string | null
  channelUrl: string
  channelAvatarUrl: string | null
  channelSubscriberCount: string | null
  updatedAt: number
  isDefault?: boolean
}

export interface SettingsBackupPayload {
  general?: GlobalSettingsGeneral
  appearance?: GlobalSettingsAppearance
  performance?: GlobalSettingsPerformance
  export?: GlobalSettingsExport
  storage?: GlobalSettingsStorage
  youtubeChannels?: YoutubeChannelBackupRecord[]
  defaultChannelId?: string | null
}

export interface SettingsBackupEnvelope {
  formatId: typeof SETTINGS_BACKUP_FORMAT_ID
  formatVersion: number
  settingsSchemaVersion: number
  appVersion: string
  exportedAt: string
  categories: SettingsBackupCategory[]
  settings: SettingsBackupPayload
}

export type SettingsImportMode = 'merge' | 'replace-categories'

export interface SettingsImportPreview {
  exportedAt: string
  appVersion: string
  availableCategories: SettingsBackupCategory[]
  selectedCategories: SettingsBackupCategory[]
  changeCount: number
  invalidNotes: string[]
  machineSpecificNotes: string[]
  channelCount: number
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Reject prototype-polluting keys before merge. */
export function stripUnsafeKeys<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = stripUnsafeKeys(value as Record<string, unknown>)
    } else {
      out[key] = value
    }
  }
  return out as T
}

export function isSettingsBackupCategory(value: unknown): value is SettingsBackupCategory {
  return typeof value === 'string' && (ALL_SETTINGS_BACKUP_CATEGORIES as readonly string[]).includes(value)
}

function normalizeChannelRecord(raw: unknown): YoutubeChannelBackupRecord | null {
  if (!isPlainObject(raw)) return null
  if (!isYoutubeChannelId(raw.channelId)) return null
  const channelId = raw.channelId
  const channelName =
    typeof raw.channelName === 'string' && raw.channelName.trim()
      ? raw.channelName.trim().slice(0, 80)
      : channelId
  const channelUrl =
    typeof raw.channelUrl === 'string' && raw.channelUrl.trim()
      ? raw.channelUrl.trim().slice(0, 600)
      : `https://www.youtube.com/channel/${channelId}`
  const channelHandle =
    typeof raw.channelHandle === 'string' && raw.channelHandle.trim()
      ? raw.channelHandle.trim().replace(/^@/, '').slice(0, 64)
      : null
  return {
    channelId,
    channelName,
    channelHandle,
    channelUrl,
    channelAvatarUrl:
      typeof raw.channelAvatarUrl === 'string' && raw.channelAvatarUrl.trim()
        ? raw.channelAvatarUrl.trim().slice(0, 500)
        : null,
    channelSubscriberCount:
      typeof raw.channelSubscriberCount === 'string' && raw.channelSubscriberCount.trim()
        ? raw.channelSubscriberCount.trim().slice(0, 48)
        : null,
    updatedAt: Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : Date.now(),
    isDefault: raw.isDefault === true,
  }
}

export function buildSettingsBackup(options: {
  settings: GlobalSettings
  categories: SettingsBackupCategory[]
  appVersion: string
  channels?: YoutubeChannelBackupRecord[]
  defaultChannelId?: string | null
  exportedAt?: Date
}): SettingsBackupEnvelope {
  const selected = options.categories.filter(isSettingsBackupCategory)
  const cats = selected.length > 0 ? selected : [...ALL_SETTINGS_BACKUP_CATEGORIES]
  const settings: SettingsBackupPayload = {}
  if (cats.includes('general')) settings.general = { ...options.settings.general }
  if (cats.includes('appearance')) settings.appearance = { ...options.settings.appearance }
  if (cats.includes('performance')) settings.performance = { ...options.settings.performance }
  if (cats.includes('export')) {
    settings.export = {
      ...options.settings.export,
      // Machine-specific path excluded from portable backups.
      lastExportDirectory: null,
    }
  }
  if (cats.includes('storage')) settings.storage = { ...options.settings.storage }
  if (cats.includes('youtubeChannels')) {
    settings.youtubeChannels = (options.channels ?? []).map((channel) => ({ ...channel, isDefault: undefined }))
    settings.defaultChannelId = options.defaultChannelId ?? null
  }
  return {
    formatId: SETTINGS_BACKUP_FORMAT_ID,
    formatVersion: SETTINGS_BACKUP_FORMAT_VERSION,
    settingsSchemaVersion: GLOBAL_SETTINGS_SCHEMA_VERSION,
    appVersion: options.appVersion.slice(0, 32),
    exportedAt: (options.exportedAt ?? new Date()).toISOString(),
    categories: cats,
    settings,
  }
}

export type ParseBackupResult =
  | { ok: true; envelope: SettingsBackupEnvelope; notes: string[] }
  | { ok: false; error: string }

export function parseSettingsBackupJson(raw: string, byteLength?: number): ParseBackupResult {
  if (byteLength != null && byteLength > SETTINGS_BACKUP_MAX_BYTES) {
    return { ok: false, error: 'Backup file is too large.' }
  }
  if (raw.length > SETTINGS_BACKUP_MAX_BYTES) {
    return { ok: false, error: 'Backup file is too large.' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'Backup is not valid JSON.' }
  }
  if (!isPlainObject(parsed)) return { ok: false, error: 'Backup root must be an object.' }
  const clean = stripUnsafeKeys(parsed)
  if (clean.formatId !== SETTINGS_BACKUP_FORMAT_ID) {
    return { ok: false, error: 'Unrecognized backup format.' }
  }
  if (typeof clean.formatVersion !== 'number' || clean.formatVersion !== SETTINGS_BACKUP_FORMAT_VERSION) {
    return { ok: false, error: 'Unsupported backup format version.' }
  }
  if (typeof clean.settingsSchemaVersion !== 'number') {
    return { ok: false, error: 'Missing settings schema version.' }
  }
  if (clean.settingsSchemaVersion > GLOBAL_SETTINGS_SCHEMA_VERSION) {
    return { ok: false, error: 'Backup was created with a newer Ribo Studio schema and cannot be imported safely.' }
  }
  if (typeof clean.appVersion !== 'string' || !clean.appVersion.trim()) {
    return { ok: false, error: 'Missing application version.' }
  }
  if (typeof clean.exportedAt !== 'string' || !clean.exportedAt.trim()) {
    return { ok: false, error: 'Missing export timestamp.' }
  }
  if (!Array.isArray(clean.categories) || clean.categories.length === 0) {
    return { ok: false, error: 'Backup has no categories.' }
  }
  const categories = clean.categories.filter(isSettingsBackupCategory)
  if (categories.length === 0) return { ok: false, error: 'Backup has no supported categories.' }
  if (!isPlainObject(clean.settings)) return { ok: false, error: 'Backup settings payload is missing.' }

  const notes: string[] = []
  const settings: SettingsBackupPayload = {}
  const payload = stripUnsafeKeys(clean.settings)

  if (categories.includes('general') && payload.general != null) {
    settings.general = migrateGlobalSettings({ general: payload.general }).general
  }
  if (categories.includes('appearance') && payload.appearance != null) {
    settings.appearance = migrateGlobalSettings({ appearance: payload.appearance }).appearance
  }
  if (categories.includes('performance') && payload.performance != null) {
    settings.performance = migrateGlobalSettings({ performance: payload.performance }).performance
  }
  if (categories.includes('export') && payload.export != null) {
    const next = migrateGlobalSettings({ export: payload.export }).export
    if (
      isPlainObject(payload.export) &&
      typeof payload.export.lastExportDirectory === 'string' &&
      payload.export.lastExportDirectory.trim()
    ) {
      notes.push('Export directory path was omitted (machine-specific).')
    }
    settings.export = { ...next, lastExportDirectory: null }
  }
  if (categories.includes('storage') && payload.storage != null) {
    settings.storage = migrateGlobalSettings({ storage: payload.storage }).storage
  }
  if (categories.includes('youtubeChannels')) {
    const list = Array.isArray(payload.youtubeChannels) ? payload.youtubeChannels : []
    const channels: YoutubeChannelBackupRecord[] = []
    for (const item of list) {
      const channel = normalizeChannelRecord(item)
      if (channel) channels.push(channel)
      else notes.push('Skipped an invalid YouTube channel record.')
    }
    settings.youtubeChannels = channels
    settings.defaultChannelId =
      typeof payload.defaultChannelId === 'string' && isYoutubeChannelId(payload.defaultChannelId)
        ? payload.defaultChannelId
        : null
  }

  // Never accept credential-looking fields if present in older/hand-edited files.
  for (const key of Object.keys(payload)) {
    if (/api[_-]?key|token|password|secret|oauth|credential|session/i.test(key)) {
      notes.push(`Ignored sensitive field "${key}".`)
    }
  }

  return {
    ok: true,
    envelope: {
      formatId: SETTINGS_BACKUP_FORMAT_ID,
      formatVersion: SETTINGS_BACKUP_FORMAT_VERSION,
      settingsSchemaVersion: clean.settingsSchemaVersion,
      appVersion: clean.appVersion.trim().slice(0, 32),
      exportedAt: clean.exportedAt.trim().slice(0, 40),
      categories,
      settings,
    },
    notes,
  }
}

function countDiffs(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (!isPlainObject(a) || !isPlainObject(b)) return a === b ? 0 : 1
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  let n = 0
  for (const key of keys) n += countDiffs(a[key], b[key])
  return n
}

export function previewSettingsImport(options: {
  envelope: SettingsBackupEnvelope
  current: GlobalSettings
  selectedCategories: SettingsBackupCategory[]
  mode: SettingsImportMode
  currentChannelCount: number
  parseNotes?: string[]
}): SettingsImportPreview {
  const selected = options.selectedCategories.filter((c) => options.envelope.categories.includes(c))
  const invalidNotes = [...(options.parseNotes ?? [])]
  const machineSpecificNotes: string[] = []
  let changeCount = 0

  const next = { ...options.current }
  for (const cat of selected) {
    if (cat === 'general' && options.envelope.settings.general) {
      const applied =
        options.mode === 'replace-categories'
          ? { ...DEFAULT_GLOBAL_SETTINGS.general, ...options.envelope.settings.general, lastAppPath: options.current.general.lastAppPath }
          : { ...options.current.general, ...options.envelope.settings.general, lastAppPath: options.current.general.lastAppPath }
      changeCount += countDiffs(options.current.general, applied)
      next.general = applied
    }
    if (cat === 'appearance' && options.envelope.settings.appearance) {
      const applied =
        options.mode === 'replace-categories'
          ? { ...DEFAULT_GLOBAL_SETTINGS.appearance, ...options.envelope.settings.appearance }
          : { ...options.current.appearance, ...options.envelope.settings.appearance }
      changeCount += countDiffs(options.current.appearance, applied)
    }
    if (cat === 'performance' && options.envelope.settings.performance) {
      const applied =
        options.mode === 'replace-categories'
          ? { ...DEFAULT_GLOBAL_SETTINGS.performance, ...options.envelope.settings.performance }
          : { ...options.current.performance, ...options.envelope.settings.performance }
      changeCount += countDiffs(options.current.performance, applied)
    }
    if (cat === 'export' && options.envelope.settings.export) {
      const applied =
        options.mode === 'replace-categories'
          ? {
              ...DEFAULT_GLOBAL_SETTINGS.export,
              ...options.envelope.settings.export,
              lastExportDirectory: options.current.export.lastExportDirectory,
            }
          : {
              ...options.current.export,
              ...options.envelope.settings.export,
              lastExportDirectory: options.current.export.lastExportDirectory,
            }
      changeCount += countDiffs(
        { ...options.current.export, lastExportDirectory: null },
        { ...applied, lastExportDirectory: null },
      )
      machineSpecificNotes.push('Last export directory is kept local and not overwritten.')
    }
    if (cat === 'storage' && options.envelope.settings.storage) {
      const applied =
        options.mode === 'replace-categories'
          ? { ...DEFAULT_GLOBAL_SETTINGS.storage, ...options.envelope.settings.storage }
          : { ...options.current.storage, ...options.envelope.settings.storage }
      changeCount += countDiffs(options.current.storage, applied)
    }
    if (cat === 'youtubeChannels') {
      const incoming = options.envelope.settings.youtubeChannels?.length ?? 0
      changeCount += incoming
      if (options.currentChannelCount > 0) {
        machineSpecificNotes.push('YouTube channels are merged by channel ID; existing projects keep their references.')
      }
    }
  }

  return {
    exportedAt: options.envelope.exportedAt,
    appVersion: options.envelope.appVersion,
    availableCategories: options.envelope.categories,
    selectedCategories: selected,
    changeCount,
    invalidNotes,
    machineSpecificNotes: [...new Set(machineSpecificNotes)],
    channelCount: options.envelope.settings.youtubeChannels?.length ?? 0,
  }
}

export function applySettingsBackupToGlobal(
  current: GlobalSettings,
  envelope: SettingsBackupEnvelope,
  selectedCategories: SettingsBackupCategory[],
  mode: SettingsImportMode,
): GlobalSettings {
  let next = structuredClone(current)
  for (const cat of selectedCategories) {
    if (!envelope.categories.includes(cat)) continue
    if (cat === 'general' && envelope.settings.general) {
      const base = mode === 'replace-categories' ? DEFAULT_GLOBAL_SETTINGS.general : next.general
      next = {
        ...next,
        general: {
          ...base,
          ...envelope.settings.general,
          lastAppPath: next.general.lastAppPath,
        },
      }
    }
    if (cat === 'appearance' && envelope.settings.appearance) {
      const base = mode === 'replace-categories' ? DEFAULT_GLOBAL_SETTINGS.appearance : next.appearance
      next = { ...next, appearance: { ...base, ...envelope.settings.appearance } }
    }
    if (cat === 'performance' && envelope.settings.performance) {
      const base = mode === 'replace-categories' ? DEFAULT_GLOBAL_SETTINGS.performance : next.performance
      next = { ...next, performance: { ...base, ...envelope.settings.performance } }
    }
    if (cat === 'export' && envelope.settings.export) {
      const base = mode === 'replace-categories' ? DEFAULT_GLOBAL_SETTINGS.export : next.export
      next = {
        ...next,
        export: {
          ...base,
          ...envelope.settings.export,
          lastExportDirectory: next.export.lastExportDirectory,
        },
      }
    }
    if (cat === 'storage' && envelope.settings.storage) {
      const base = mode === 'replace-categories' ? DEFAULT_GLOBAL_SETTINGS.storage : next.storage
      next = { ...next, storage: { ...base, ...envelope.settings.storage } }
    }
  }
  return migrateGlobalSettings(next)
}

export function settingsBackupFilename(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `ribo-studio-settings-${y}-${m}-${d}.json`
}
