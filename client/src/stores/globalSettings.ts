import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import {
  DEFAULT_GLOBAL_SETTINGS,
  GLOBAL_SETTINGS_STORAGE_KEY,
  appearanceDefaults,
  exportDefaults,
  generalDefaults,
  migrateGlobalSettings,
  performanceDefaults,
  screensaverDefaults,
  serverSettingsFromClient,
  storageDefaults,
  type GlobalSettings,
  type GlobalSettingsAppearance,
  type GlobalSettingsCategory,
  type GlobalSettingsExport,
  type GlobalSettingsGeneral,
  type GlobalSettingsPerformance,
  type GlobalSettingsScreensaver,
  type GlobalSettingsStorage,
  type PreviewRendererMode,
  type ServerGlobalSettings,
} from '@shared/globalSettings'
import {
  ALL_SETTINGS_BACKUP_CATEGORIES,
  applySettingsBackupToGlobal,
  buildSettingsBackup,
  parseSettingsBackupJson,
  previewSettingsImport,
  settingsBackupFilename,
  type SettingsBackupCategory,
  type SettingsBackupEnvelope,
  type SettingsImportMode,
  type SettingsImportPreview,
  type YoutubeChannelBackupRecord,
} from '@shared/settingsBackup'
import { applyAppearance } from '../lib/appearance'
import { applyLanguage } from '../lib/locale'
import { APP_VERSION } from '../lib/appVersion'
import { loadSettingsTab, saveSettingsTab } from '../lib/settingsTabMemory'
import * as api from '../lib/api'
import {
  exportChannelsForBackup,
  importChannelsFromBackup,
  listSubscribeChannelPreferences,
  getSelectedSubscribeChannelId,
} from '../apps/frame-screensaver/lib/subscribeAnimation/subscribeAnimationChannelPreference'

const LEGACY_PREVIEW_RENDERER_KEY = 'ribo-screensaver-renderer'

const GLOBAL_SETTINGS_CATEGORIES = [
  'general',
  'appearance',
  'performance',
  'storage',
  'export',
  'integrations',
  'backup',
  'about',
] as const satisfies readonly GlobalSettingsCategory[]

function readLegacyPreviewRenderer(): PreviewRendererMode | null {
  try {
    const stored = localStorage.getItem(LEGACY_PREVIEW_RENDERER_KEY)
    if (stored === 'webgl2' || stored === 'canvas2d') return stored
  } catch {
    // ignore
  }
  return null
}

export type SettingsSaveState = 'idle' | 'saving' | 'saved' | 'error'

export const useGlobalSettingsStore = defineStore('globalSettings', () => {
  const settings = ref<GlobalSettings>(structuredClone(DEFAULT_GLOBAL_SETTINGS))
  const hydrated = ref(false)
  const modalOpen = ref(false)
  const activeCategory = ref<GlobalSettingsCategory>(
    loadSettingsTab('global', GLOBAL_SETTINGS_CATEGORIES, 'general'),
  )
  watch(activeCategory, (value) => saveSettingsTab('global', value))
  const saveState = ref<SettingsSaveState>('idle')
  const saveError = ref<string | null>(null)
  let saveTimer: number | null = null
  let savedClearTimer: number | null = null
  let serverSyncTimer: number | null = null

  const general = computed(() => settings.value.general)
  const appearance = computed(() => settings.value.appearance)
  const storage = computed(() => settings.value.storage)
  const performance = computed(() => settings.value.performance)
  const exportPrefs = computed(() => settings.value.export)
  const screensaver = computed(() => settings.value.screensaver)

  function readLocal(): GlobalSettings {
    try {
      const raw = localStorage.getItem(GLOBAL_SETTINGS_STORAGE_KEY)
      if (!raw) return structuredClone(DEFAULT_GLOBAL_SETTINGS)
      return migrateGlobalSettings(JSON.parse(raw))
    } catch {
      return structuredClone(DEFAULT_GLOBAL_SETTINGS)
    }
  }

  function writeLocal(next: GlobalSettings): void {
    try {
      localStorage.setItem(GLOBAL_SETTINGS_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Quota / private mode — keep in-memory settings.
    }
  }

  function markSaving(): void {
    saveState.value = 'saving'
    saveError.value = null
    if (savedClearTimer != null) {
      window.clearTimeout(savedClearTimer)
      savedClearTimer = null
    }
  }

  function markSaved(): void {
    saveState.value = 'saved'
    savedClearTimer = window.setTimeout(() => {
      if (saveState.value === 'saved') saveState.value = 'idle'
      savedClearTimer = null
    }, 1600)
  }

  function markError(message: string): void {
    saveState.value = 'error'
    saveError.value = message
  }

  function schedulePersist(): void {
    markSaving()
    if (saveTimer != null) window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      writeLocal(settings.value)
      markSaved()
      scheduleServerSync()
    }, 220)
  }

  function scheduleServerSync(): void {
    if (serverSyncTimer != null) window.clearTimeout(serverSyncTimer)
    serverSyncTimer = window.setTimeout(() => {
      void syncServerPrefs()
    }, 320)
  }

  async function syncServerPrefs(): Promise<void> {
    try {
      const payload = serverSettingsFromClient(settings.value)
      const remote = await api.putGlobalSettings(payload)
      settings.value = {
        ...settings.value,
        storage: remote.storage,
        performance: remote.performance,
      }
      writeLocal(settings.value)
    } catch (error) {
      markError(error instanceof Error ? error.message : 'Could not sync server settings.')
    }
  }

  function paintAppearance(): void {
    applyAppearance(settings.value.appearance)
  }

  function paintLanguage(): void {
    applyLanguage(settings.value.general.language)
  }

  async function hydrate(): Promise<void> {
    let hadScreensaverSection = false
    try {
      const raw = localStorage.getItem(GLOBAL_SETTINGS_STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      hadScreensaverSection = Boolean(parsed && typeof parsed === 'object' && parsed.screensaver)
    } catch {
      hadScreensaverSection = false
    }
    settings.value = readLocal()
    const legacyPreview = readLegacyPreviewRenderer()
    // One-time migrate old `ribo-screensaver-renderer` when Global Settings had no screensaver section yet.
    if (legacyPreview && !hadScreensaverSection) {
      settings.value = {
        ...settings.value,
        screensaver: { ...settings.value.screensaver, previewRenderer: legacyPreview },
      }
    }
    try {
      const remote = await api.fetchGlobalSettings()
      settings.value = {
        ...settings.value,
        storage: remote.storage,
        performance: remote.performance,
        schemaVersion: Math.max(settings.value.schemaVersion, remote.schemaVersion),
      }
    } catch {
      // Offline / starting up — local prefs still apply.
    }
    writeLocal(settings.value)
    paintAppearance()
    paintLanguage()
    hydrated.value = true
  }

  function openModal(category: GlobalSettingsCategory = activeCategory.value): void {
    activeCategory.value = category
    modalOpen.value = true
  }

  function closeModal(): void {
    modalOpen.value = false
  }

  function setCategory(category: GlobalSettingsCategory): void {
    activeCategory.value = category
  }

  function patchGeneral(patch: Partial<GlobalSettingsGeneral>): void {
    settings.value = {
      ...settings.value,
      general: { ...settings.value.general, ...patch },
    }
    if (patch.language != null) paintLanguage()
    schedulePersist()
  }

  function patchAppearance(patch: Partial<GlobalSettingsAppearance>): void {
    settings.value = {
      ...settings.value,
      appearance: { ...settings.value.appearance, ...patch },
    }
    paintAppearance()
    schedulePersist()
  }

  function patchStorage(patch: Partial<GlobalSettingsStorage>): void {
    settings.value = {
      ...settings.value,
      storage: { ...settings.value.storage, ...patch },
    }
    schedulePersist()
  }

  function patchPerformance(patch: Partial<GlobalSettingsPerformance>): void {
    settings.value = {
      ...settings.value,
      performance: { ...settings.value.performance, ...patch },
    }
    schedulePersist()
  }

  function patchExport(patch: Partial<GlobalSettingsExport>): void {
    settings.value = {
      ...settings.value,
      export: { ...settings.value.export, ...patch },
    }
    schedulePersist()
  }

  function patchScreensaver(patch: Partial<GlobalSettingsScreensaver>): void {
    settings.value = {
      ...settings.value,
      screensaver: { ...settings.value.screensaver, ...patch },
    }
    schedulePersist()
  }

  function resetGeneral(): void {
    const lastAppPath = settings.value.general.lastAppPath
    settings.value = {
      ...settings.value,
      general: { ...generalDefaults(), lastAppPath },
    }
    paintLanguage()
    schedulePersist()
  }

  function resetAppearance(): void {
    settings.value = {
      ...settings.value,
      appearance: appearanceDefaults(),
    }
    paintAppearance()
    schedulePersist()
  }

  function resetExport(): void {
    settings.value = {
      ...settings.value,
      export: exportDefaults(),
      screensaver: screensaverDefaults(),
    }
    schedulePersist()
  }

  function resetPerformance(): void {
    settings.value = {
      ...settings.value,
      performance: performanceDefaults(),
    }
    schedulePersist()
  }

  function resetStoragePrefs(): void {
    settings.value = {
      ...settings.value,
      storage: storageDefaults(),
    }
    schedulePersist()
  }

  function resetScreensaver(): void {
    const encoder = settings.value.screensaver.encoder
    settings.value = {
      ...settings.value,
      // Encoding method is shared across apps — keep it when resetting Screensaver-only output.
      screensaver: { ...screensaverDefaults(), encoder },
    }
    schedulePersist()
  }

  /** Reset preference categories only — never projects, caches, media, channels, or credentials. */
  function resetSelectedCategories(categories: SettingsBackupCategory[]): void {
    let next = { ...settings.value }
    for (const cat of categories) {
      if (cat === 'general') next = { ...next, general: { ...generalDefaults(), lastAppPath: next.general.lastAppPath } }
      if (cat === 'appearance') next = { ...next, appearance: appearanceDefaults() }
      if (cat === 'performance') next = { ...next, performance: performanceDefaults() }
      if (cat === 'export') next = { ...next, export: exportDefaults() }
      if (cat === 'storage') next = { ...next, storage: storageDefaults() }
      // youtubeChannels intentionally excluded — separate explicit actions.
    }
    settings.value = migrateGlobalSettings(next)
    paintAppearance()
    paintLanguage()
    schedulePersist()
  }

  function resetAllPreferences(): void {
    const lastAppPath = settings.value.general.lastAppPath
    settings.value = {
      ...structuredClone(DEFAULT_GLOBAL_SETTINGS),
      general: { ...DEFAULT_GLOBAL_SETTINGS.general, lastAppPath },
      screensaver: { ...screensaverDefaults(), encoder: settings.value.screensaver.encoder },
    }
    paintAppearance()
    paintLanguage()
    schedulePersist()
  }

  function rememberAppPath(path: string): void {
    if (!settings.value.general.rememberLastApp) return
    if (settings.value.general.lastAppPath === path) return
    patchGeneral({ lastAppPath: path })
  }

  function applyServerSnapshot(remote: ServerGlobalSettings): void {
    settings.value = {
      ...settings.value,
      storage: remote.storage,
      performance: remote.performance,
    }
    writeLocal(settings.value)
  }

  function replaceSettings(next: GlobalSettings): void {
    settings.value = migrateGlobalSettings(next)
    paintAppearance()
    paintLanguage()
    writeLocal(settings.value)
    scheduleServerSync()
    markSaved()
  }

  function createSettingsSnapshot(): GlobalSettings {
    return structuredClone(settings.value)
  }

  function exportSettingsBackup(categories: SettingsBackupCategory[] = [...ALL_SETTINGS_BACKUP_CATEGORIES]): {
    filename: string
    json: string
    envelope: SettingsBackupEnvelope
  } {
    const channels = exportChannelsForBackup()
    const envelope = buildSettingsBackup({
      settings: settings.value,
      categories,
      appVersion: APP_VERSION,
      channels: channels.channels,
      defaultChannelId: channels.defaultChannelId,
    })
    return {
      filename: settingsBackupFilename(),
      json: `${JSON.stringify(envelope, null, 2)}\n`,
      envelope,
    }
  }

  function previewBackupImport(
    raw: string,
    byteLength: number,
    selectedCategories: SettingsBackupCategory[],
    mode: SettingsImportMode,
  ): { ok: true; envelope: SettingsBackupEnvelope; preview: SettingsImportPreview } | { ok: false; error: string } {
    const parsed = parseSettingsBackupJson(raw, byteLength)
    if (!parsed.ok) return parsed
    const preview = previewSettingsImport({
      envelope: parsed.envelope,
      current: settings.value,
      selectedCategories,
      mode,
      currentChannelCount: listSubscribeChannelPreferences().length,
      parseNotes: parsed.notes,
    })
    return { ok: true, envelope: parsed.envelope, preview }
  }

  function applyBackupImport(
    envelope: SettingsBackupEnvelope,
    selectedCategories: SettingsBackupCategory[],
    mode: SettingsImportMode,
  ): { ok: true } | { ok: false; error: string } {
    const snapshot = createSettingsSnapshot()
    try {
      const next = applySettingsBackupToGlobal(settings.value, envelope, selectedCategories, mode)
      replaceSettings(next)
      if (selectedCategories.includes('youtubeChannels') && envelope.settings.youtubeChannels) {
        importChannelsFromBackup({
          channels: envelope.settings.youtubeChannels as YoutubeChannelBackupRecord[],
          defaultChannelId: envelope.settings.defaultChannelId ?? null,
          replaceExisting: false,
        })
      }
      return { ok: true }
    } catch (error) {
      replaceSettings(snapshot)
      return { ok: false, error: error instanceof Error ? error.message : 'Import failed and was rolled back.' }
    }
  }

  watch(
    () => settings.value.appearance,
    () => {
      if (hydrated.value) paintAppearance()
    },
    { deep: true },
  )

  return {
    settings,
    hydrated,
    modalOpen,
    activeCategory,
    saveState,
    saveError,
    general,
    appearance,
    storage,
    performance,
    exportPrefs,
    screensaver,
    hydrate,
    openModal,
    closeModal,
    setCategory,
    patchGeneral,
    patchAppearance,
    patchStorage,
    patchPerformance,
    patchExport,
    patchScreensaver,
    resetGeneral,
    resetAppearance,
    resetExport,
    resetPerformance,
    resetStoragePrefs,
    resetScreensaver,
    resetSelectedCategories,
    resetAllPreferences,
    rememberAppPath,
    applyServerSnapshot,
    syncServerPrefs,
    replaceSettings,
    createSettingsSnapshot,
    exportSettingsBackup,
    previewBackupImport,
    applyBackupImport,
    getSelectedSubscribeChannelId,
  }
})
