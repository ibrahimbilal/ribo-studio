<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Copy, ExternalLink, FolderOpen } from '@lucide/vue'
import { APP_VERSION } from '../../lib/appVersion'
import * as api from '../../lib/api'
import { formatBytes } from '../../lib/formatBytes'
import { usePlatformStore } from '../../stores/platform'
import { useGlobalSettingsStore } from '../../stores/globalSettings'
import SettingsRow from './SettingsRow.vue'

const store = useGlobalSettingsStore()
const platform = usePlatformStore()
const info = ref<api.SystemInfo | null>(null)
const loading = ref(false)
const showChangelog = ref(false)

const changelogText = computed(() => {
  return [
    'See CHANGELOG.md in the repository for the full Keep a Changelog history.',
    'Open the GitHub repository or the local project CHANGELOG.md for release notes.',
  ].join('\n')
})

async function refresh(): Promise<void> {
  loading.value = true
  try {
    info.value = await api.fetchSystemInfo()
  } catch (error) {
    platform.toast(error instanceof Error ? error.message : 'Could not load system info.', 'error')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void refresh()
})

watch(
  () => store.modalOpen && store.activeCategory === 'about',
  (open) => {
    if (open) void refresh()
  },
)

function systemText(): string {
  const data = info.value
  const lines = [
    `Application: Ribo Studio`,
    `Version: ${data?.version || APP_VERSION}`,
    `OS: ${data?.os || '—'} (${data?.arch || '—'})`,
    `CPU: ${data?.cpuModel || '—'} (${data?.cpuCount ?? '—'} logical)`,
    `RAM: ${formatBytes(data?.totalRamBytes)} total / ${formatBytes(data?.availableRamBytes)} available`,
    `GPU / HW encoders: ${(data?.gpu || []).join(', ') || 'None detected'}`,
    `FFmpeg: ${data?.ffmpegVersion || '—'}`,
    `FFprobe: ${data?.ffprobeVersion || '—'}`,
    `Upscaler engines: ${(data?.upscalerEngines || []).map((e) => `${e.label}${e.available ? '' : ' (unavailable)'}`).join(', ') || '—'}`,
    `Max FFmpeg concurrency: ${data?.capabilities.maxFfmpegConcurrency ?? 1}`,
    `Configurable temp dir: ${data?.capabilities.configurableTempDir ? 'yes' : 'no'}`,
    `Sleep prevention: ${data?.capabilities.sleepPrevention ? 'yes' : 'no'}`,
  ]
  return lines.join('\n')
}

async function copyInfo(): Promise<void> {
  try {
    await navigator.clipboard.writeText(systemText())
    platform.toast('System information copied.', 'success')
  } catch {
    platform.toast('Could not copy to clipboard.', 'error')
  }
}

function openGithub(): void {
  const url = info.value?.repositoryUrl || 'https://github.com/ibrahimbilal/ribo-studio'
  window.open(url, '_blank', 'noopener,noreferrer')
}

async function openLogs(): Promise<void> {
  try {
    await api.openSystemPath('logs')
  } catch (error) {
    platform.toast(error instanceof Error ? error.message : 'Could not open logs folder.', 'error')
  }
}
</script>

<template>
  <div>
    <h3 class="section-label">About</h3>
    <SettingsRow label="Application">
      <span class="text-sm text-zinc-100">Ribo Studio</span>
    </SettingsRow>
    <SettingsRow label="Version" hint="From the authoritative package.json SemVer.">
      <span class="text-sm text-zinc-100">v{{ info?.version || APP_VERSION }}</span>
    </SettingsRow>

    <h3 class="section-label mt-6">System</h3>
    <SettingsRow label="Operating system">
      <span class="text-sm text-zinc-300">{{ info?.os || (loading ? 'Loading…' : '—') }}</span>
    </SettingsRow>
    <SettingsRow label="CPU">
      <span class="max-w-[18rem] text-right text-sm text-zinc-300">
        {{ info?.cpuModel || '—' }}
        <span v-if="info" class="block text-xs text-zinc-500">{{ info.cpuCount }} logical</span>
      </span>
    </SettingsRow>
    <SettingsRow label="Memory">
      <span class="text-sm text-zinc-300">
        {{ formatBytes(info?.totalRamBytes) }}
        <span class="text-xs text-zinc-500"> / {{ formatBytes(info?.availableRamBytes) }} free</span>
      </span>
    </SettingsRow>
    <SettingsRow label="GPU / hardware encoders" hint="Software renderers are never listed as dedicated GPUs.">
      <span class="max-w-[18rem] text-right text-sm text-zinc-300">
        {{ (info?.gpu || []).join(', ') || 'None detected' }}
      </span>
    </SettingsRow>
    <SettingsRow label="FFmpeg">
      <span class="max-w-[18rem] truncate text-right text-xs text-zinc-300">{{ info?.ffmpegVersion || '—' }}</span>
    </SettingsRow>
    <SettingsRow label="FFprobe">
      <span class="max-w-[18rem] truncate text-right text-xs text-zinc-300">{{ info?.ffprobeVersion || '—' }}</span>
    </SettingsRow>
    <SettingsRow label="AI upscaling engines">
      <span class="max-w-[18rem] text-right text-sm text-zinc-300">
        {{
          (info?.upscalerEngines || [])
            .map((engine) => `${engine.label}${engine.available ? '' : ' (off)'}`)
            .join(', ') || '—'
        }}
      </span>
    </SettingsRow>

    <h3 class="section-label mt-6 mb-3">Actions</h3>
    <div class="flex flex-wrap gap-2">
      <button class="btn btn-ghost cursor-pointer" type="button" @click="copyInfo">
        <Copy :size="14" />
        Copy System Information
      </button>
      <button class="btn btn-ghost cursor-pointer" type="button" @click="openGithub">
        <ExternalLink :size="14" />
        Open GitHub
      </button>
      <button class="btn btn-ghost cursor-pointer" type="button" @click="showChangelog = !showChangelog">
        View Changelog
      </button>
      <button
        v-if="info?.capabilities.canOpenPaths"
        class="btn btn-ghost cursor-pointer"
        type="button"
        @click="openLogs"
      >
        <FolderOpen :size="14" />
        Open Logs Directory
      </button>
    </div>
    <p v-if="showChangelog" class="mt-3 whitespace-pre-wrap rounded-lg bg-inset p-3 text-xs text-zinc-400">
      {{ changelogText }}
    </p>
    <p class="mt-4 text-xs text-zinc-500">
      Check for Updates is not available in this local runtime. Use GitHub Releases when upgrading.
    </p>
  </div>
</template>
