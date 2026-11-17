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
import * as api from '../../lib/api'
import { webGl2Available } from '../../apps/frame-screensaver/lib/render/createScreensaverRenderer'
import { useGlobalSettingsStore } from '../../stores/globalSettings'
import SettingsRow from './SettingsRow.vue'

const store = useGlobalSettingsStore()
const patternError = ref<string | null>(null)
const encoderOptions = ref<api.EncoderCatalog['encoders']>([])

const previewName = computed(() =>
  expandFilenamePattern(store.exportPrefs.filenamePattern || DEFAULT_FILENAME_PATTERN, {
    projectName: 'My Project',
    appName: 'Screensaver',
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
    <h3 class="section-label mb-3">Screensaver output</h3>
    <p class="mb-2 text-xs text-zinc-500">
      Shared across all Screensaver projects. Changing these updates the editor immediately.
    </p>
    <SettingsRow label="Rendering mode" :hint="renderModeDetail">
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
          {{ item.label }}{{ item.recommended ? ' — Recommended' : ' — Legacy' }}
        </option>
      </select>
    </SettingsRow>
    <SettingsRow
      v-if="store.screensaver.renderingMode === 'optimized-cfr'"
      label="Quality"
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
          {{ item.label }}{{ item.id === 'balanced' ? ' — Default' : '' }}
        </option>
      </select>
    </SettingsRow>
    <SettingsRow v-else label="Profile" :hint="profileDetail">
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
    <SettingsRow
      label="Preview rendering"
      hint="Editor preview only. Export still bakes on the CPU."
    >
      <select
        class="field w-auto min-w-[12rem]"
        :value="store.screensaver.previewRenderer"
        @change="
          store.patchScreensaver({
            previewRenderer: ($event.target as HTMLSelectElement).value as PreviewRendererMode,
          })
        "
      >
        <option value="auto">Auto (GPU when available)</option>
        <option value="webgl2" :disabled="!webGl2Available()">GPU (WebGL2)</option>
        <option value="canvas2d">CPU (Canvas 2D)</option>
      </select>
    </SettingsRow>
    <div class="mb-4 mt-2">
      <button class="btn btn-ghost cursor-pointer" type="button" @click="store.resetScreensaver()">
        Reset Screensaver output
      </button>
    </div>

    <h3 class="section-label">Encoding</h3>
    <p class="mb-2 text-xs text-zinc-500">
      Shared by Screensaver and both Shorts apps (Ranking and Image Motion).
    </p>
    <SettingsRow
      label="Encoding method"
      :hint="selectedEncoder && !selectedEncoder.verified ? selectedEncoder.detail || 'Unavailable' : undefined"
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
        <option value="auto">Auto (recommended)</option>
        <option value="cpu">CPU</option>
        <option
          v-for="item in hardwareEncoders"
          :key="item.id"
          :value="item.id"
          :disabled="!item.verified"
        >
          {{ item.label }}{{ item.verified ? '' : ' — unavailable' }}
        </option>
      </select>
    </SettingsRow>

    <h3 class="section-label">Export preferences</h3>
    <SettingsRow
      label="Default filename pattern"
      hint="Placeholders: {projectName} {appName} {date} {time} {resolution} {extension}"
      tooltip="Invalid characters and path traversal are stripped when generating download names."
    >
      <input
        class="field min-w-[16rem]"
        type="text"
        :value="store.exportPrefs.filenamePattern"
        @change="onPatternInput(($event.target as HTMLInputElement).value)"
      />
    </SettingsRow>
    <p v-if="patternError" class="mb-2 text-xs text-amber-300">{{ patternError }}</p>
    <p class="mb-3 text-xs text-zinc-500">Preview: {{ previewName }}</p>

    <SettingsRow
      label="Prevent accidental overwriting"
      hint="Adds a numeric suffix when a matching download name was used in this session."
    >
      <ToggleSwitch
        :model-value="store.exportPrefs.preventOverwrite"
        aria-label="Prevent accidental overwriting"
        @update:model-value="store.patchExport({ preventOverwrite: $event })"
      />
    </SettingsRow>

    <SettingsRow
      label="Remember last export directory"
      hint="Uses the File System Access API when the browser supports it."
      :tooltip="
        supportsDirectoryPicker
          ? 'Supported in this browser.'
          : 'Not supported in this browser — downloads use the browser download folder.'
      "
    >
      <ToggleSwitch
        :model-value="store.exportPrefs.rememberLastExportDirectory"
        :disabled="!supportsDirectoryPicker"
        aria-label="Remember last export directory"
        @update:model-value="store.patchExport({ rememberLastExportDirectory: $event })"
      />
    </SettingsRow>

    <SettingsRow
      v-if="supportsDirectoryPicker"
      label="Open output folder after export"
      hint="Only available with local folder access."
    >
      <ToggleSwitch
        :model-value="store.exportPrefs.openFolderAfterExport"
        aria-label="Open output folder after export"
        @update:model-value="store.patchExport({ openFolderAfterExport: $event })"
      />
    </SettingsRow>
    <SettingsRow
      v-else
      label="Open output folder after export"
      hint="Not supported in this browser environment."
    >
      <span class="text-xs text-zinc-500">Unavailable</span>
    </SettingsRow>

    <SettingsRow
      label="Notify when export completes"
      hint="Works with General → export completion and desktop notification toggles."
    >
      <ToggleSwitch
        :model-value="store.exportPrefs.notifyOnComplete"
        aria-label="Notify when export completes"
        @update:model-value="store.patchExport({ notifyOnComplete: $event })"
      />
    </SettingsRow>

    <SettingsRow
      label="Default output directory"
      hint="Browser downloads do not expose a writable default folder. Use Save As / download UI instead."
    >
      <span class="text-xs text-zinc-500">Browser download location</span>
    </SettingsRow>

    <div class="mt-4">
      <button class="btn btn-ghost cursor-pointer" type="button" @click="store.resetExport()">
        Reset export preferences
      </button>
    </div>
  </div>
</template>
