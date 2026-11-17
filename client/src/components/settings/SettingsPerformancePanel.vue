<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { HardwareAccelerationMode } from '@shared/globalSettings'
import ToggleSwitch from '../ToggleSwitch.vue'
import * as api from '../../lib/api'
import { formatBytes } from '../../lib/formatBytes'
import { useGlobalSettingsStore } from '../../stores/globalSettings'
import SettingsRow from './SettingsRow.vue'

const store = useGlobalSettingsStore()
const overview = ref<api.StorageOverview | null>(null)
const encoders = ref<api.EncoderCatalog | null>(null)

const hardwareOptions: Array<{ id: HardwareAccelerationMode; label: string }> = [
  { id: 'auto', label: 'Auto' },
  { id: 'enabled', label: 'Enabled' },
  { id: 'disabled', label: 'Disabled' },
]

const detectedHardware = computed(() => {
  const list = encoders.value?.encoders.filter((item) => item.hardware && item.listed) ?? []
  if (!list.length) return 'No hardware encoders detected'
  return list.map((item) => `${item.label}${item.verified ? '' : ' (unverified)'}`).join(', ')
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
    <h3 class="section-label">Export queue</h3>
    <SettingsRow
      label="Maximum concurrent export jobs"
      hint="Server encodes one FFmpeg job at a time. Queued jobs start automatically when the active job finishes."
      tooltip="Parallel FFmpeg encodes are not supported. This limit is fixed at 1."
    >
      <input class="field w-20" type="number" :value="1" disabled aria-label="Maximum concurrent export jobs" />
    </SettingsRow>

    <h3 class="section-label mt-6">Rendering resources</h3>
    <SettingsRow label="Automatic CPU thread management" hint="When on, Ribo picks safe thread counts from host CPU and memory.">
      <ToggleSwitch
        :model-value="store.performance.autoCpuThreads"
        aria-label="Automatic CPU thread management"
        @update:model-value="store.patchPerformance({ autoCpuThreads: $event })"
      />
    </SettingsRow>
    <SettingsRow
      label="CPU thread limit"
      hint="Applied to new encodes when automatic management is off (1–16)."
    >
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
    <SettingsRow label="Hardware acceleration" :hint="detectedHardware">
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

    <h3 class="section-label mt-6">Disk management</h3>
    <SettingsRow
      label="Minimum free disk space (GiB)"
      hint="Exports warn or refuse to start when free space falls below this floor."
    >
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
      label="Temporary directory"
      hint="Fixed to the server tmp folder in this runtime. Relocation is not supported."
      tooltip="server/tmp is the authoritative temporary root for clips, jobs, and outputs."
    >
      <code class="max-w-[16rem] truncate text-xs text-zinc-400">{{ overview?.temporaryDirectory || 'server/tmp' }}</code>
    </SettingsRow>
    <SettingsRow label="Available disk space">
      <span class="text-sm text-zinc-200">{{ formatBytes(overview?.availableDiskBytes) }}</span>
    </SettingsRow>
  </div>
</template>
