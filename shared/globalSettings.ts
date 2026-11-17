/**
 * Versioned Global Settings schema shared by client and server.
 * Client owns UX prefs (localStorage). Server owns render-affecting prefs (global-settings.json).
 */

import {
  DEFAULT_SCREENSAVER_CFR_QUALITY,
  DEFAULT_SCREENSAVER_RENDER_MODE,
  isEncoderChoice,
  isScreensaverCfrQuality,
  isScreensaverProfile,
  isScreensaverRenderMode,
  type EncoderChoice,
  type ScreensaverCfrQuality,
  type ScreensaverProfile,
  type ScreensaverRenderMode,
} from './screensaver'

export const GLOBAL_SETTINGS_SCHEMA_VERSION = 2

export const GLOBAL_SETTINGS_STORAGE_KEY = 'ribo-global-settings'

export type CacheRetentionPolicy = 'never' | '7d' | '30d' | '90d'

export type HardwareAccelerationMode = 'auto' | 'enabled' | 'disabled'

export type PreviewRendererMode = 'auto' | 'webgl2' | 'canvas2d'

export type ThemePreference = 'light' | 'dark' | 'system'

export type AccentColorId =
  | 'default'
  | 'blue'
  | 'indigo'
  | 'purple'
  | 'teal'
  | 'green'
  | 'orange'
  | 'red'
  | 'slate'

export type InterfaceDensity = 'compact' | 'comfortable'

export type GlobalSettingsCategory =
  | 'general'
  | 'appearance'
  | 'performance'
  | 'storage'
  | 'export'
  | 'integrations'
  | 'backup'
  | 'about'

export interface GlobalSettingsGeneral {
  desktopNotifications: boolean
  exportCompletionNotifications: boolean
  rememberLastApp: boolean
  lastAppPath: string | null
}

/** Application chrome only — never applied to exported media or canvas timelines. */
export interface GlobalSettingsAppearance {
  theme: ThemePreference
  accent: AccentColorId
  density: InterfaceDensity
  /** When false, reduce nonessential UI transitions. Always respects OS prefers-reduced-motion. */
  interfaceAnimations: boolean
}

export interface GlobalSettingsStorage {
  persistentAnimationCacheEnabled: boolean
  cacheRetention: CacheRetentionPolicy
  autoCleanAbandonedTemp: boolean
}

export interface GlobalSettingsPerformance {
  /** When true, server picks thread counts automatically. */
  autoCpuThreads: boolean
  /** Manual CPU thread limit (1–16). Ignored when autoCpuThreads is true. */
  cpuThreadLimit: number
  hardwareAcceleration: HardwareAccelerationMode
  /** Minimum free disk bytes required before starting a render job. */
  minFreeDiskBytes: number
}

export interface GlobalSettingsExport {
  filenamePattern: string
  rememberLastExportDirectory: boolean
  preventOverwrite: boolean
  openFolderAfterExport: boolean
  notifyOnComplete: boolean
  lastExportDirectory: string | null
}

/** Shared Screensaver output prefs (not per-project). */
export interface GlobalSettingsScreensaver {
  renderingMode: ScreensaverRenderMode
  cfrQuality: ScreensaverCfrQuality
  /** Fast VFR profile when renderingMode is fast-vfr. */
  profile: ScreensaverProfile
  previewRenderer: PreviewRendererMode
  encoder: EncoderChoice
}

export interface GlobalSettings {
  schemaVersion: number
  general: GlobalSettingsGeneral
  appearance: GlobalSettingsAppearance
  storage: GlobalSettingsStorage
  performance: GlobalSettingsPerformance
  export: GlobalSettingsExport
  screensaver: GlobalSettingsScreensaver
}

/** Subset persisted and enforced on the server. */
export interface ServerGlobalSettings {
  schemaVersion: number
  storage: GlobalSettingsStorage
  performance: GlobalSettingsPerformance
}

export const DEFAULT_FILENAME_PATTERN = '{projectName}-{appName}-{date}.{extension}'

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  schemaVersion: GLOBAL_SETTINGS_SCHEMA_VERSION,
  general: {
    desktopNotifications: false,
    exportCompletionNotifications: true,
    rememberLastApp: false,
    lastAppPath: null,
  },
  appearance: {
    theme: 'dark',
    accent: 'default',
    density: 'comfortable',
    interfaceAnimations: true,
  },
  storage: {
    persistentAnimationCacheEnabled: true,
    cacheRetention: 'never',
    autoCleanAbandonedTemp: true,
  },
  performance: {
    autoCpuThreads: true,
    cpuThreadLimit: 4,
    hardwareAcceleration: 'auto',
    minFreeDiskBytes: 2 * 1024 * 1024 * 1024,
  },
  export: {
    filenamePattern: DEFAULT_FILENAME_PATTERN,
    rememberLastExportDirectory: true,
    preventOverwrite: true,
    openFolderAfterExport: false,
    notifyOnComplete: true,
    lastExportDirectory: null,
  },
  screensaver: {
    renderingMode: DEFAULT_SCREENSAVER_RENDER_MODE,
    cfrQuality: DEFAULT_SCREENSAVER_CFR_QUALITY,
    profile: 'balanced',
    previewRenderer: 'canvas2d',
    encoder: 'cpu',
  },
}

export const DEFAULT_SERVER_GLOBAL_SETTINGS: ServerGlobalSettings = {
  schemaVersion: GLOBAL_SETTINGS_SCHEMA_VERSION,
  storage: { ...DEFAULT_GLOBAL_SETTINGS.storage },
  performance: { ...DEFAULT_GLOBAL_SETTINGS.performance },
}

const CACHE_RETENTION_VALUES: readonly CacheRetentionPolicy[] = ['never', '7d', '30d', '90d']
const HW_MODE_VALUES: readonly HardwareAccelerationMode[] = ['auto', 'enabled', 'disabled']
const THEME_VALUES: readonly ThemePreference[] = ['light', 'dark', 'system']
const ACCENT_VALUES: readonly AccentColorId[] = [
  'default',
  'blue',
  'indigo',
  'purple',
  'teal',
  'green',
  'orange',
  'red',
  'slate',
]
const DENSITY_VALUES: readonly InterfaceDensity[] = ['compact', 'comfortable']

const APP_PATHS = new Set(['/', '/shorts', '/screensaver', '/thumbnails', '/upscale', '/looper'])

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_VALUES as readonly string[]).includes(value)
}

export function isAccentColorId(value: unknown): value is AccentColorId {
  return typeof value === 'string' && (ACCENT_VALUES as readonly string[]).includes(value)
}

export function isInterfaceDensity(value: unknown): value is InterfaceDensity {
  return typeof value === 'string' && (DENSITY_VALUES as readonly string[]).includes(value)
}

export function isCacheRetentionPolicy(value: unknown): value is CacheRetentionPolicy {
  return typeof value === 'string' && (CACHE_RETENTION_VALUES as readonly string[]).includes(value)
}

export function isHardwareAccelerationMode(value: unknown): value is HardwareAccelerationMode {
  return typeof value === 'string' && (HW_MODE_VALUES as readonly string[]).includes(value)
}

export function cacheRetentionMs(policy: CacheRetentionPolicy): number | null {
  if (policy === 'never') return null
  if (policy === '7d') return 7 * 24 * 60 * 60 * 1000
  if (policy === '30d') return 30 * 24 * 60 * 60 * 1000
  if (policy === '90d') return 90 * 24 * 60 * 60 * 1000
  return null
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function asNullableString(value: unknown, maxLen = 500): string | null {
  if (value == null) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLen)
}

function sanitizeAppPath(value: unknown): string | null {
  const path = asNullableString(value, 64)
  if (!path) return null
  return APP_PATHS.has(path) ? path : null
}

export function validateFilenamePattern(pattern: string): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = pattern.trim()
  if (!trimmed) return { ok: false, error: 'Filename pattern cannot be empty.' }
  if (trimmed.length > 180) return { ok: false, error: 'Filename pattern is too long.' }
  if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
    return { ok: false, error: 'Filename pattern cannot include path separators or "..".' }
  }
  if (!trimmed.includes('{extension}')) {
    return { ok: false, error: 'Filename pattern must include {extension}.' }
  }
  return { ok: true, value: trimmed }
}

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g

export function sanitizeGeneratedFilename(name: string): string {
  let cleaned = name.replace(INVALID_FILENAME_CHARS, '_').replace(/\s+/g, ' ').trim()
  cleaned = cleaned.replace(/^\.+/, '').replace(/\.+$/g, '')
  if (!cleaned || cleaned === '.') cleaned = 'export'
  return cleaned.slice(0, 180)
}

export type FilenamePatternContext = {
  projectName?: string
  appName?: string
  date?: string
  time?: string
  resolution?: string
  extension: string
}

export function expandFilenamePattern(pattern: string, ctx: FilenamePatternContext): string {
  const validated = validateFilenamePattern(pattern)
  const base = validated.ok ? validated.value : DEFAULT_FILENAME_PATTERN
  const now = new Date()
  const date =
    ctx.date ??
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const time =
    ctx.time ?? `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
  const ext = (ctx.extension || 'mp4').replace(/^\./, '').toLowerCase()
  const raw = base
    .replaceAll('{projectName}', sanitizeGeneratedFilename(ctx.projectName?.trim() || 'Untitled'))
    .replaceAll('{appName}', sanitizeGeneratedFilename(ctx.appName?.trim() || 'export'))
    .replaceAll('{date}', date)
    .replaceAll('{time}', time)
    .replaceAll('{resolution}', sanitizeGeneratedFilename(ctx.resolution?.trim() || 'output'))
    .replaceAll('{extension}', ext)
  return sanitizeGeneratedFilename(raw)
}

export function applyOverwriteProtection(filename: string, existingNames: Iterable<string>): string {
  const known = new Set([...existingNames].map((n) => n.toLowerCase()))
  if (!known.has(filename.toLowerCase())) return filename
  const dot = filename.lastIndexOf('.')
  const stem = dot > 0 ? filename.slice(0, dot) : filename
  const ext = dot > 0 ? filename.slice(dot) : ''
  for (let i = 2; i < 10_000; i += 1) {
    const candidate = `${stem} (${i})${ext}`
    if (!known.has(candidate.toLowerCase())) return candidate
  }
  return `${stem}-${Date.now()}${ext}`
}

function normalizeGeneral(raw: unknown, fallback: GlobalSettingsGeneral): GlobalSettingsGeneral {
  const data = raw && typeof raw === 'object' ? (raw as Partial<GlobalSettingsGeneral>) : {}
  return {
    desktopNotifications: asBool(data.desktopNotifications, fallback.desktopNotifications),
    exportCompletionNotifications: asBool(
      data.exportCompletionNotifications,
      fallback.exportCompletionNotifications,
    ),
    rememberLastApp: asBool(data.rememberLastApp, fallback.rememberLastApp),
    lastAppPath: sanitizeAppPath(data.lastAppPath),
  }
}

function normalizeAppearance(raw: unknown, fallback: GlobalSettingsAppearance): GlobalSettingsAppearance {
  const data = raw && typeof raw === 'object' ? (raw as Partial<GlobalSettingsAppearance>) : {}
  return {
    theme: isThemePreference(data.theme) ? data.theme : fallback.theme,
    accent: isAccentColorId(data.accent) ? data.accent : fallback.accent,
    density: isInterfaceDensity(data.density) ? data.density : fallback.density,
    interfaceAnimations: asBool(data.interfaceAnimations, fallback.interfaceAnimations),
  }
}

function normalizeStorage(raw: unknown, fallback: GlobalSettingsStorage): GlobalSettingsStorage {
  const data = raw && typeof raw === 'object' ? (raw as Partial<GlobalSettingsStorage>) : {}
  return {
    persistentAnimationCacheEnabled: asBool(
      data.persistentAnimationCacheEnabled,
      fallback.persistentAnimationCacheEnabled,
    ),
    cacheRetention: isCacheRetentionPolicy(data.cacheRetention) ? data.cacheRetention : fallback.cacheRetention,
    autoCleanAbandonedTemp: asBool(data.autoCleanAbandonedTemp, fallback.autoCleanAbandonedTemp),
  }
}

function normalizePerformance(raw: unknown, fallback: GlobalSettingsPerformance): GlobalSettingsPerformance {
  const data = raw && typeof raw === 'object' ? (raw as Partial<GlobalSettingsPerformance>) : {}
  return {
    autoCpuThreads: asBool(data.autoCpuThreads, fallback.autoCpuThreads),
    cpuThreadLimit: asNumber(data.cpuThreadLimit, fallback.cpuThreadLimit, 1, 16),
    hardwareAcceleration: isHardwareAccelerationMode(data.hardwareAcceleration)
      ? data.hardwareAcceleration
      : fallback.hardwareAcceleration,
    minFreeDiskBytes: asNumber(data.minFreeDiskBytes, fallback.minFreeDiskBytes, 0, 1024 * 1024 * 1024 * 1024),
  }
}

function normalizeExport(raw: unknown, fallback: GlobalSettingsExport): GlobalSettingsExport {
  const data = raw && typeof raw === 'object' ? (raw as Partial<GlobalSettingsExport>) : {}
  const patternRaw = typeof data.filenamePattern === 'string' ? data.filenamePattern : fallback.filenamePattern
  const validated = validateFilenamePattern(patternRaw)
  return {
    filenamePattern: validated.ok ? validated.value : fallback.filenamePattern,
    rememberLastExportDirectory: asBool(data.rememberLastExportDirectory, fallback.rememberLastExportDirectory),
    preventOverwrite: asBool(data.preventOverwrite, fallback.preventOverwrite),
    openFolderAfterExport: asBool(data.openFolderAfterExport, fallback.openFolderAfterExport),
    notifyOnComplete: asBool(data.notifyOnComplete, fallback.notifyOnComplete),
    lastExportDirectory: asNullableString(data.lastExportDirectory, 500),
  }
}

function isPreviewRendererMode(value: unknown): value is PreviewRendererMode {
  return value === 'auto' || value === 'webgl2' || value === 'canvas2d'
}

function normalizeScreensaver(raw: unknown, fallback: GlobalSettingsScreensaver): GlobalSettingsScreensaver {
  const data = raw && typeof raw === 'object' ? (raw as Partial<GlobalSettingsScreensaver>) : {}
  return {
    renderingMode: isScreensaverRenderMode(data.renderingMode) ? data.renderingMode : fallback.renderingMode,
    cfrQuality: isScreensaverCfrQuality(data.cfrQuality) ? data.cfrQuality : fallback.cfrQuality,
    profile: isScreensaverProfile(data.profile) ? data.profile : fallback.profile,
    previewRenderer: isPreviewRendererMode(data.previewRenderer) ? data.previewRenderer : fallback.previewRenderer,
    encoder: isEncoderChoice(data.encoder) ? data.encoder : fallback.encoder,
  }
}

/** Merge unknown / corrupt input with defaults. Never throws. */
export function migrateGlobalSettings(raw: unknown): GlobalSettings {
  try {
    if (!raw || typeof raw !== 'object') return structuredClone(DEFAULT_GLOBAL_SETTINGS)
    const data = raw as Partial<GlobalSettings> & { schemaVersion?: unknown }
    const version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0
    // v1 → v2 adds appearance (defaults). Later branches can transform further.
    void version
    return {
      schemaVersion: GLOBAL_SETTINGS_SCHEMA_VERSION,
      general: normalizeGeneral(data.general, DEFAULT_GLOBAL_SETTINGS.general),
      appearance: normalizeAppearance(data.appearance, DEFAULT_GLOBAL_SETTINGS.appearance),
      storage: normalizeStorage(data.storage, DEFAULT_GLOBAL_SETTINGS.storage),
      performance: normalizePerformance(data.performance, DEFAULT_GLOBAL_SETTINGS.performance),
      export: normalizeExport(data.export, DEFAULT_GLOBAL_SETTINGS.export),
      screensaver: normalizeScreensaver(data.screensaver, DEFAULT_GLOBAL_SETTINGS.screensaver),
    }
  } catch {
    return structuredClone(DEFAULT_GLOBAL_SETTINGS)
  }
}

export function validateGlobalSettings(raw: unknown): GlobalSettings {
  return migrateGlobalSettings(raw)
}

export function migrateServerGlobalSettings(raw: unknown): ServerGlobalSettings {
  const full = migrateGlobalSettings(
    raw && typeof raw === 'object'
      ? {
          schemaVersion: (raw as ServerGlobalSettings).schemaVersion,
          general: DEFAULT_GLOBAL_SETTINGS.general,
          appearance: DEFAULT_GLOBAL_SETTINGS.appearance,
          storage: (raw as ServerGlobalSettings).storage,
          performance: (raw as ServerGlobalSettings).performance,
          export: DEFAULT_GLOBAL_SETTINGS.export,
          screensaver: DEFAULT_GLOBAL_SETTINGS.screensaver,
        }
      : null,
  )
  return {
    schemaVersion: GLOBAL_SETTINGS_SCHEMA_VERSION,
    storage: full.storage,
    performance: full.performance,
  }
}

export function generalDefaults(): GlobalSettingsGeneral {
  return { ...DEFAULT_GLOBAL_SETTINGS.general }
}

export function appearanceDefaults(): GlobalSettingsAppearance {
  return { ...DEFAULT_GLOBAL_SETTINGS.appearance }
}

export function exportDefaults(): GlobalSettingsExport {
  return { ...DEFAULT_GLOBAL_SETTINGS.export }
}

export function performanceDefaults(): GlobalSettingsPerformance {
  return { ...DEFAULT_GLOBAL_SETTINGS.performance }
}

export function storageDefaults(): GlobalSettingsStorage {
  return { ...DEFAULT_GLOBAL_SETTINGS.storage }
}

export function screensaverDefaults(): GlobalSettingsScreensaver {
  return { ...DEFAULT_GLOBAL_SETTINGS.screensaver }
}

export function serverSettingsFromClient(settings: GlobalSettings): ServerGlobalSettings {
  return {
    schemaVersion: GLOBAL_SETTINGS_SCHEMA_VERSION,
    storage: { ...settings.storage },
    performance: { ...settings.performance },
  }
}
