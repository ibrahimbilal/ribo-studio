<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { HardwareAccelerationMode } from '@shared/globalSettings'
import ToggleSwitch from '../ToggleSwitch.vue'
import { useI18n } from '../../i18n'
import * as api from '../../lib/api'
import { formatBytes } from '../../lib/formatBytes'
import { useGlobalSettingsStore } from '../../stores/globalSettings'
import SettingsRow from './SettingsRow.vue'

const store = useGlobalSettingsStore()
const { t } = useI18n()
const overview = ref<api.StorageOverview | null>(null)
const encoders = ref<api.EncoderCatalog | null>(null)

const hardwareOptions = computed(() => [
  { id: 'auto' as const, label: t('performance.hwAuto') },
  { id: 'enabled' as const, label: t('performance.hwEnabled') },
  { id: 'disabled' as const, label: t('performance.hwDisabled') },
])

const detectedHardware = computed(() => {
  const list = encoders.value?.encoders.filter((item) => item.hardware && item.listed) ?? []
  if (!list.length) return t('performance.noHardware')
  return list
    .map((item) => `${item.label}${item.verified ? '' : ` ${t('performance.unverified')}`}`)
    .join(', ')
})

const minFreeGb = computed({
  get: () => Math.round((store.performance.minFreeDiskBytes / (1024 ** 3)) * 10) / 10,
  set: (value: number) => {
    const gb = Number.isFinite(value) ? Math.max(0, value) : 0
    store.patchPerformance({ minFreeDiskBytes: Math.round(gb * 1024 ** 3) })
  },
})

async function refresh(): Promise<void> {
  try {
    const [nextOverview, nextEncoders] = await Promise.all([
      api.fetchStorageOverview(false),
      api.fetchEncoders().catch(() => null),
    ])
    overview.value = nextOverview
    encoders.value = nextEncoders
  } catch {
    // Panel still shows settings without live detection.
  }
}

onMounted(() => {
  void refresh()
})

watch(
  () => store.modalOpen && store.activeCategory === 'performance',
  (open) => {
    if (open) void refresh()
  },
)
</script>

<template>
  <div>
    <h3 class="section-label">{{ t('performance.exportQueue') }}</h3>
    <SettingsRow
      :label="t('performance.maxConcurrent')"
      :hint="t('performance.maxConcurrentHint')"
      :tooltip="t('performance.maxConcurrentTooltip')"
    >
      <input
        class="field w-20"
        type="number"
        :value="1"
        disabled
        :aria-label="t('performance.maxConcurrent')"
      />
    </SettingsRow>

    <h3 class="section-label mt-6">{{ t('performance.resources') }}</h3>
    <SettingsRow :label="t('performance.autoCpu')" :hint="t('performance.autoCpuHint')">
      <ToggleSwitch
        :model-value="store.performance.autoCpuThreads"
        :aria-label="t('performance.autoCpu')"
        @update:model-value="store.patchPerformance({ autoCpuThreads: $event })"
      />
    </SettingsRow>
    <SettingsRow :label="t('performance.cpuLimit')" :hint="t('performance.cpuLimitHint')">
      <input
        class="field w-24"
        type="number"
        min="1"
        max="16"
        :disabled="store.performance.autoCpuThreads"
        :value="store.performance.cpuThreadLimit"
        @change="
          store.patchPerformance({
            cpuThreadLimit: Number(($event.target as HTMLInputElement).value) || 4,
          })
        "
      />
    </SettingsRow>
    <SettingsRow :label="t('performance.hardware')" :hint="detectedHardware">
      <select
        class="field w-auto min-w-[9rem]"
        :value="store.performance.hardwareAcceleration"
        @change="
          store.patchPerformance({
            hardwareAcceleration: ($event.target as HTMLSelectElement).value as HardwareAccelerationMode,
          })
        "
      >
        <option v-for="option in hardwareOptions" :key="option.id" :value="option.id">{{ option.label }}</option>
      </select>
    </SettingsRow>

    <h3 class="section-label mt-6">{{ t('performance.disk') }}</h3>
    <SettingsRow :label="t('performance.minFree')" :hint="t('performance.minFreeHint')">
      <input
        class="field w-24"
        type="number"
        min="0"
        step="0.5"
        :value="minFreeGb"
        @change="minFreeGb = Number(($event.target as HTMLInputElement).value)"
      />
    </SettingsRow>
    <SettingsRow
      :label="t('performance.tempDir')"
      :hint="t('performance.tempDirHint')"
      :tooltip="t('performance.tempDirTooltip')"
    >
      <code class="max-w-[16rem] truncate text-xs text-zinc-400">{{ overview?.temporaryDirectory || 'server/tmp' }}</code>
    </SettingsRow>
    <SettingsRow :label="t('performance.availableDisk')">
      <span class="text-sm text-zinc-200">{{ formatBytes(overview?.availableDiskBytes) }}</span>
    </SettingsRow>
  </div>
</template>
