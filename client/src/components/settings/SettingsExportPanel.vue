<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  DEFAULT_FILENAME_PATTERN,
  expandFilenamePattern,
  validateFilenamePattern,
  type PreviewRendererMode,
} from '@shared/globalSettings'
import {
  SCREENSAVER_CFR_QUALITY_PRESETS,
  SCREENSAVER_PROFILES,
  SCREENSAVER_RENDER_MODES,
  type EncoderChoice,
  type ScreensaverCfrQuality,
  type ScreensaverProfile,
  type ScreensaverRenderMode,
} from '@shared/screensaver'
import ToggleSwitch from '../ToggleSwitch.vue'
import { useI18n } from '../../i18n'
import * as api from '../../lib/api'
import { webGl2Available } from '../../apps/frame-screensaver/lib/render/createScreensaverRenderer'
import { useGlobalSettingsStore } from '../../stores/globalSettings'
import SettingsRow from './SettingsRow.vue'

const store = useGlobalSettingsStore()
const { t } = useI18n()
const patternError = ref<string | null>(null)
const encoderOptions = ref<api.EncoderCatalog['encoders']>([])

const previewName = computed(() =>
  expandFilenamePattern(store.exportPrefs.filenamePattern || DEFAULT_FILENAME_PATTERN, {
    projectName: t('common.project'),
    appName: t('nav.screensaver'),
    date: '2026-11-16',
    time: '235900',
    resolution: '3840x2160',
    extension: 'mp4',
  }),
)

const hardwareEncoders = computed(() => encoderOptions.value.filter((item) => item.hardware && item.listed))
const selectedEncoder = computed(() => encoderOptions.value.find((item) => item.id === store.screensaver.encoder))
const renderModeDetail = computed(
  () => SCREENSAVER_RENDER_MODES.find((item) => item.id === store.screensaver.renderingMode)?.detail ?? '',
)
const qualityDetail = computed(
  () => SCREENSAVER_CFR_QUALITY_PRESETS.find((item) => item.id === store.screensaver.cfrQuality)?.detail ?? '',
)
const profileDetail = computed(
  () => SCREENSAVER_PROFILES.find((item) => item.id === store.screensaver.profile)?.detail ?? '',
)

function onPatternInput(value: string): void {
  const result = validateFilenamePattern(value)
  patternError.value = result.ok ? null : result.error
  if (result.ok) store.patchExport({ filenamePattern: result.value })
}

const supportsDirectoryPicker = computed(
  () => typeof window !== 'undefined' && 'showDirectoryPicker' in window,
)

async function refreshEncoders(): Promise<void> {
  try {
    const catalog = await api.fetchEncoders()
    encoderOptions.value = catalog.encoders
  } catch {
    encoderOptions.value = []
  }
}

onMounted(() => {
  void refreshEncoders()
})

watch(
  () => store.modalOpen && store.activeCategory === 'export',
  (open) => {
    if (open) void refreshEncoders()
  },
)
</script>

<template>
  <div>
    <h3 class="section-label mb-3">{{ t('export.screensaverOutput') }}</h3>
    <p class="mb-2 text-xs text-zinc-500">
      {{ t('export.screensaverIntro') }}
    </p>
    <SettingsRow :label="t('export.renderingMode')" :hint="renderModeDetail">
      <select
        class="field w-auto min-w-[12rem]"
        :value="store.screensaver.renderingMode"
        @change="
          store.patchScreensaver({
            renderingMode: ($event.target as HTMLSelectElement).value as ScreensaverRenderMode,
          })
        "
      >
        <option v-for="item in SCREENSAVER_RENDER_MODES" :key="item.id" :value="item.id">
          {{ item.label }}{{ item.recommended ? ` — ${t('export.recommended')}` : ` — ${t('export.legacy')}` }}
        </option>
      </select>
    </SettingsRow>
    <SettingsRow
      v-if="store.screensaver.renderingMode === 'optimized-cfr'"
      :label="t('export.quality')"
      :hint="qualityDetail"
    >
      <select
        class="field w-auto min-w-[10rem]"
        :value="store.screensaver.cfrQuality"
        @change="
          store.patchScreensaver({
            cfrQuality: ($event.target as HTMLSelectElement).value as ScreensaverCfrQuality,
          })
        "
      >
        <option v-for="item in SCREENSAVER_CFR_QUALITY_PRESETS" :key="item.id" :value="item.id">
          {{ item.label }}{{ item.id === 'balanced' ? ` — ${t('export.default')}` : '' }}
        </option>
      </select>
    </SettingsRow>
    <SettingsRow v-else :label="t('export.profile')" :hint="profileDetail">
      <select
        class="field w-auto min-w-[10rem]"
        :value="store.screensaver.profile"
        @change="
          store.patchScreensaver({
            profile: ($event.target as HTMLSelectElement).value as ScreensaverProfile,
          })
        "
      >
        <option v-for="item in SCREENSAVER_PROFILES" :key="item.id" :value="item.id">{{ item.label }}</option>
      </select>
    </SettingsRow>
    <SettingsRow :label="t('export.previewRendering')" :hint="t('export.previewHint')">
      <select
        class="field w-auto min-w-[12rem]"
        :value="store.screensaver.previewRenderer"
        @change="
          store.patchScreensaver({
            previewRenderer: ($event.target as HTMLSelectElement).value as PreviewRendererMode,
          })
        "
      >
        <option value="auto">{{ t('export.previewAuto') }}</option>
        <option value="webgl2" :disabled="!webGl2Available()">{{ t('export.previewGpu') }}</option>
        <option value="canvas2d">{{ t('export.previewCpu') }}</option>
      </select>
    </SettingsRow>
    <div class="mb-4 mt-2">
      <button class="btn btn-ghost cursor-pointer" type="button" @click="store.resetScreensaver()">
        {{ t('export.resetScreensaver') }}
      </button>
    </div>

    <h3 class="section-label">{{ t('export.encoding') }}</h3>
    <p class="mb-2 text-xs text-zinc-500">
      {{ t('export.encodingIntro') }}
    </p>
    <SettingsRow
      :label="t('export.encodingMethod')"
      :hint="selectedEncoder && !selectedEncoder.verified ? selectedEncoder.detail || t('export.unavailable') : undefined"
    >
      <select
        class="field w-auto min-w-[12rem]"
        :value="store.screensaver.encoder"
        @change="
          store.patchScreensaver({
            encoder: ($event.target as HTMLSelectElement).value as EncoderChoice,
          })
        "
      >
        <option value="auto">{{ t('export.encodingAuto') }}</option>
        <option value="cpu">{{ t('export.encodingCpu') }}</option>
        <option
          v-for="item in hardwareEncoders"
          :key="item.id"
          :value="item.id"
          :disabled="!item.verified"
        >
          {{ item.label }}{{ item.verified ? '' : ` — ${t('export.encodingUnavailable')}` }}
        </option>
      </select>
    </SettingsRow>

    <h3 class="section-label">{{ t('export.prefs') }}</h3>
    <SettingsRow
      :label="t('export.filenamePattern')"
      :hint="t('export.filenameHint')"
      :tooltip="t('export.filenameTooltip')"
    >
      <input
        class="field min-w-[16rem]"
        type="text"
        :value="store.exportPrefs.filenamePattern"
        @change="onPatternInput(($event.target as HTMLInputElement).value)"
      />
    </SettingsRow>
    <p v-if="patternError" class="mb-2 text-xs text-amber-300">{{ patternError }}</p>
    <p class="mb-3 text-xs text-zinc-500">{{ t('export.preview') }}: {{ previewName }}</p>

    <SettingsRow :label="t('export.preventOverwrite')" :hint="t('export.preventOverwriteHint')">
      <ToggleSwitch
        :model-value="store.exportPrefs.preventOverwrite"
        :aria-label="t('export.preventOverwrite')"
        @update:model-value="store.patchExport({ preventOverwrite: $event })"
      />
    </SettingsRow>

    <SettingsRow
      :label="t('export.rememberDir')"
      :hint="t('export.rememberDirHint')"
      :tooltip="supportsDirectoryPicker ? t('export.rememberDirSupported') : t('export.rememberDirUnsupported')"
    >
      <ToggleSwitch
        :model-value="store.exportPrefs.rememberLastExportDirectory"
        :disabled="!supportsDirectoryPicker"
        :aria-label="t('export.rememberDir')"
        @update:model-value="store.patchExport({ rememberLastExportDirectory: $event })"
      />
    </SettingsRow>

    <SettingsRow
      v-if="supportsDirectoryPicker"
      :label="t('export.openFolder')"
      :hint="t('export.openFolderHint')"
    >
      <ToggleSwitch
        :model-value="store.exportPrefs.openFolderAfterExport"
        :aria-label="t('export.openFolder')"
        @update:model-value="store.patchExport({ openFolderAfterExport: $event })"
      />
    </SettingsRow>
    <SettingsRow
      v-else
      :label="t('export.openFolder')"
      :hint="t('export.openFolderUnsupported')"
    >
      <span class="text-xs text-zinc-500">{{ t('export.unavailable') }}</span>
    </SettingsRow>

    <SettingsRow :label="t('export.notifyComplete')" :hint="t('export.notifyCompleteHint')">
      <ToggleSwitch
        :model-value="store.exportPrefs.notifyOnComplete"
        :aria-label="t('export.notifyComplete')"
        @update:model-value="store.patchExport({ notifyOnComplete: $event })"
      />
    </SettingsRow>

    <SettingsRow :label="t('export.defaultDir')" :hint="t('export.defaultDirHint')">
      <span class="text-xs text-zinc-500">{{ t('export.browserDownload') }}</span>
    </SettingsRow>

    <div class="mt-4">
      <button class="btn btn-ghost cursor-pointer" type="button" @click="store.resetExport()">
        {{ t('export.reset') }}
      </button>
    </div>
  </div>
</template>
