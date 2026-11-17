<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ALL_SETTINGS_BACKUP_CATEGORIES,
  type SettingsBackupCategory,
  type SettingsBackupEnvelope,
  type SettingsImportMode,
  type SettingsImportPreview,
} from '@shared/settingsBackup'
import AppCheckbox from '../ui/AppCheckbox.vue'
import AppDialog from '../ui/AppDialog.vue'
import { useI18n, type MessageKey } from '../../i18n'
import { useGlobalSettingsStore } from '../../stores/globalSettings'
import { usePlatformStore } from '../../stores/platform'
import SettingsRow from './SettingsRow.vue'

const store = useGlobalSettingsStore()
const { t } = useI18n()
const platform = usePlatformStore()

const CATEGORY_KEYS: Record<SettingsBackupCategory, MessageKey> = {
  general: 'backup.catGeneral',
  appearance: 'backup.catAppearance',
  performance: 'backup.catPerformance',
  export: 'backup.catExport',
  storage: 'backup.catStorage',
  youtubeChannels: 'backup.catYoutube',
}

function categoryLabel(cat: SettingsBackupCategory): string {
  return t(CATEGORY_KEYS[cat])
}

const exportCats = ref<SettingsBackupCategory[]>([...ALL_SETTINGS_BACKUP_CATEGORIES])
const importCats = ref<SettingsBackupCategory[]>([...ALL_SETTINGS_BACKUP_CATEGORIES])
const importMode = ref<SettingsImportMode>('merge')
const dragOver = ref(false)
const importError = ref<string | null>(null)
const pendingEnvelope = ref<SettingsBackupEnvelope | null>(null)
const pendingPreview = ref<SettingsImportPreview | null>(null)
const pendingRaw = ref<string | null>(null)
const pendingBytes = ref(0)
const confirmOpen = ref(false)
const resetOpen = ref(false)
const resetScope = ref<'selected' | 'all'>('selected')
const resetCats = ref<SettingsBackupCategory[]>(['general', 'appearance', 'performance', 'export', 'storage'])

const fileInput = ref<HTMLInputElement | null>(null)

const canExport = computed(() => exportCats.value.length > 0)

function toggleExportCat(cat: SettingsBackupCategory, on: boolean): void {
  if (on) {
    if (!exportCats.value.includes(cat)) exportCats.value = [...exportCats.value, cat]
  } else {
    exportCats.value = exportCats.value.filter((c) => c !== cat)
  }
}

function toggleImportCat(cat: SettingsBackupCategory, on: boolean): void {
  if (on) {
    if (!importCats.value.includes(cat)) importCats.value = [...importCats.value, cat]
  } else {
    importCats.value = importCats.value.filter((c) => c !== cat)
  }
}

function downloadBackup(): void {
  if (!canExport.value) return
  const { filename, json } = store.exportSettingsBackup(exportCats.value)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  platform.toast(t('backup.downloaded'), 'success')
}

async function readFile(file: File): Promise<void> {
  importError.value = null
  pendingEnvelope.value = null
  pendingPreview.value = null
  pendingRaw.value = null
  if (!file.name.toLowerCase().endsWith('.json') && file.type && file.type !== 'application/json') {
    importError.value = t('backup.chooseJson')
    return
  }
  const text = await file.text()
  const result = store.previewBackupImport(text, file.size, importCats.value, importMode.value)
  if (!result.ok) {
    importError.value = result.error
    return
  }
  pendingEnvelope.value = result.envelope
  pendingRaw.value = text
  pendingBytes.value = file.size
  importCats.value = result.envelope.categories.filter((c) => importCats.value.includes(c))
  if (importCats.value.length === 0) importCats.value = [...result.envelope.categories]
  const refreshed = store.previewBackupImport(text, file.size, importCats.value, importMode.value)
  if (refreshed.ok) {
    pendingEnvelope.value = refreshed.envelope
    pendingPreview.value = refreshed.preview
  }
}

function onFilePicked(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) void readFile(file)
}

function onDrop(event: DragEvent): void {
  event.preventDefault()
  dragOver.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) void readFile(file)
}

function refreshPreview(): void {
  if (!pendingRaw.value) return
  const result = store.previewBackupImport(pendingRaw.value, pendingBytes.value, importCats.value, importMode.value)
  if (result.ok) {
    pendingEnvelope.value = result.envelope
    pendingPreview.value = result.preview
  }
}

function askImport(): void {
  if (!pendingEnvelope.value || !pendingPreview.value) return
  refreshPreview()
  confirmOpen.value = true
}

function confirmImport(): void {
  confirmOpen.value = false
  const env = pendingEnvelope.value
  if (!env) return
  const result = store.applyBackupImport(env, importCats.value, importMode.value)
  if (!result.ok) {
    platform.toast(result.error, 'error')
    return
  }
  platform.toast(t('backup.importApplied'), 'success')
  pendingEnvelope.value = null
  pendingPreview.value = null
  pendingRaw.value = null
}

function askReset(scope: 'selected' | 'all'): void {
  resetScope.value = scope
  resetOpen.value = true
}

function confirmReset(): void {
  resetOpen.value = false
  if (resetScope.value === 'all') {
    store.resetAllPreferences()
    platform.toast(t('settingsExtra.backupResetAllToast'), 'success')
    return
  }
  const cats = resetCats.value.filter((c) => c !== 'youtubeChannels')
  store.resetSelectedCategories(cats)
  platform.toast(t('backup.resetDone'), 'success')
}
</script>

<template>
  <div>
    <h3 class="section-label">{{ t('backup.exportSection') }}</h3>
    <p class="mb-3 text-xs text-zinc-500">
      {{ t('settingsExtra.backupExportIntro') }}
    </p>
    <div class="space-y-2">
      <label
        v-for="cat in ALL_SETTINGS_BACKUP_CATEGORIES"
        :key="`export-${cat}`"
        class="flex items-center gap-2 text-sm text-zinc-200"
      >
        <AppCheckbox
          :checked="exportCats.includes(cat)"
          :aria-label="categoryLabel(cat)"
          @change="toggleExportCat(cat, $event)"
        />
        {{ categoryLabel(cat) }}
      </label>
    </div>
    <div class="mt-3">
      <button class="btn btn-primary cursor-pointer" type="button" :disabled="!canExport" @click="downloadBackup">
        {{ t('settingsExtra.backupExportJson') }}
      </button>
    </div>

    <h3 class="section-label mt-8 mb-1">{{ t('backup.importSection') }}</h3>
    <div
      class="rounded-lg border border-dashed px-4 py-6 text-center transition-colors"
      :class="dragOver ? 'border-brand bg-brand/10' : 'border-white/15 bg-inset/40'"
      @dragenter.prevent="dragOver = true"
      @dragover.prevent="dragOver = true"
      @dragleave.prevent="dragOver = false"
      @drop="onDrop"
    >
      <p class="text-sm text-zinc-300">{{ t('settingsExtra.backupDropFile') }}</p>
      <button class="btn btn-ghost mt-3 cursor-pointer" type="button" @click="fileInput?.click()">
        {{ t('settingsExtra.backupChooseFile') }}
      </button>
      <input ref="fileInput" class="hidden" type="file" accept="application/json,.json" @change="onFilePicked" />
    </div>
    <p v-if="importError" class="mt-2 text-xs text-amber-300">{{ importError }}</p>

    <div v-if="pendingPreview && pendingEnvelope" class="mt-4 space-y-3 rounded-lg border border-white/5 bg-inset/50 p-3">
      <h4 class="text-sm font-semibold text-zinc-100">{{ t('settingsExtra.backupImportPreview') }}</h4>
      <SettingsRow :label="t('settingsExtra.backupCreated')">
        <span class="text-xs text-zinc-300">{{ pendingPreview.exportedAt }}</span>
      </SettingsRow>
      <SettingsRow :label="t('settingsExtra.backupSourceVersion')">
        <span class="text-xs text-zinc-300">{{ pendingPreview.appVersion }}</span>
      </SettingsRow>
      <SettingsRow :label="t('settingsExtra.backupWillChange')">
        <span class="text-xs text-zinc-300">{{ pendingPreview.changeCount }}</span>
      </SettingsRow>
      <div class="space-y-2">
        <p class="text-xs text-zinc-500">{{ t('settingsExtra.backupCategoriesRestore') }}</p>
        <label
          v-for="cat in pendingPreview.availableCategories"
          :key="`import-${cat}`"
          class="flex items-center gap-2 text-sm text-zinc-200"
        >
          <AppCheckbox
            :checked="importCats.includes(cat)"
            :aria-label="categoryLabel(cat)"
            @change="
              toggleImportCat(cat, $event);
              refreshPreview()
            "
          />
          {{ categoryLabel(cat) }}
        </label>
      </div>
      <SettingsRow :label="t('backup.importMode')" :hint="t('backup.importModeHint')">
        <select v-model="importMode" class="field w-auto" @change="refreshPreview">
          <option value="merge">{{ t('backup.merge') }}</option>
          <option value="replace-categories">{{ t('backup.replaceSelected') }}</option>
        </select>
      </SettingsRow>
      <ul v-if="pendingPreview.invalidNotes.length" class="list-disc ps-4 text-xs text-amber-200">
        <li v-for="(note, i) in pendingPreview.invalidNotes" :key="i">{{ note }}</li>
      </ul>
      <ul v-if="pendingPreview.machineSpecificNotes.length" class="list-disc ps-4 text-xs text-zinc-400">
        <li v-for="(note, i) in pendingPreview.machineSpecificNotes" :key="i">{{ note }}</li>
      </ul>
      <button class="btn btn-primary cursor-pointer" type="button" :disabled="importCats.length === 0" @click="askImport">
        {{ t('settingsExtra.backupReviewImport') }}
      </button>
    </div>

    <h3 class="section-label mt-8">{{ t('backup.resetSection') }}</h3>
    <p class="mb-3 text-xs text-zinc-500">
      {{ t('settingsExtra.backupResetIntro') }}
    </p>
    <div class="space-y-2">
      <label
        v-for="cat in (['general', 'appearance', 'performance', 'export', 'storage'] as SettingsBackupCategory[])"
        :key="`reset-${cat}`"
        class="flex items-center gap-2 text-sm text-zinc-200"
      >
        <AppCheckbox
          :checked="resetCats.includes(cat)"
          :aria-label="categoryLabel(cat)"
          @change="
            (on) => {
              if (on) resetCats = [...resetCats, cat]
              else resetCats = resetCats.filter((c) => c !== cat)
            }
          "
        />
        {{ categoryLabel(cat) }}
      </label>
    </div>
    <div class="mt-3 flex flex-wrap gap-2">
      <button
        class="btn btn-ghost cursor-pointer"
        type="button"
        :disabled="resetCats.length === 0"
        @click="askReset('selected')"
      >
        {{ t('backup.resetSelected') }}
      </button>
      <button class="btn btn-ghost cursor-pointer" type="button" @click="askReset('all')">
        {{ t('backup.resetAll') }}
      </button>
    </div>

    <AppDialog :open="confirmOpen" :title="t('backup.confirmImportTitle')" @cancel="confirmOpen = false">
      <p class="text-sm text-zinc-300">
        {{
          t('settingsExtra.backupImportConfirm', {
            n: importCats.length,
            unit: importCats.length === 1 ? t('settingsExtra.backupImportCategory') : t('settingsExtra.backupImportCategories'),
            mode: importMode === 'merge' ? t('backup.merge') : t('backup.replaceSelected'),
          })
        }}
      </p>
      <p class="mt-2 text-xs text-zinc-500">{{ t('settingsExtra.backupImportRollback') }}</p>
      <template #actions>
        <button class="btn btn-ghost cursor-pointer" type="button" @click="confirmOpen = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary cursor-pointer" type="button" @click="confirmImport">{{ t('backup.applyImport') }}</button>
      </template>
    </AppDialog>

    <AppDialog
      :open="resetOpen"
      :title="resetScope === 'all' ? t('backup.confirmResetAllTitle') : t('backup.confirmResetSelectedTitle')"
      @cancel="resetOpen = false"
    >
      <p class="text-sm text-zinc-300">
        {{
          resetScope === 'all'
            ? t('settingsExtra.backupResetAllBody')
            : t('settingsExtra.backupResetSelectedBody', { categories: resetCats.map((c) => categoryLabel(c)).join(', ') })
        }}
      </p>
      <p class="mt-2 text-xs text-zinc-500">
        {{ t('settingsExtra.backupResetPreserve') }}
      </p>
      <template #actions>
        <button class="btn btn-ghost cursor-pointer" type="button" @click="resetOpen = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-danger cursor-pointer" type="button" @click="confirmReset">{{ t('common.reset') }}</button>
      </template>
    </AppDialog>
  </div>
</template>
