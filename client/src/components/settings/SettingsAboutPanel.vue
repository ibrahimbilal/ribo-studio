<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Copy, ExternalLink, FolderOpen } from '@lucide/vue'
import { useI18n } from '../../i18n'
import { APP_VERSION } from '../../lib/appVersion'
import * as api from '../../lib/api'
import { formatBytes } from '../../lib/formatBytes'
import { usePlatformStore } from '../../stores/platform'
import { useGlobalSettingsStore } from '../../stores/globalSettings'
import SettingsRow from './SettingsRow.vue'

const store = useGlobalSettingsStore()
const { t } = useI18n()
const platform = usePlatformStore()
const info = ref<api.SystemInfo | null>(null)
const loading = ref(false)
const showChangelog = ref(false)

const changelogText = computed(() => t('about.changelogBody'))

async function refresh(): Promise<void> {
  loading.value = true
  try {
    info.value = await api.fetchSystemInfo()
  } catch (error) {
    platform.toast(error instanceof Error ? error.message : t('about.loadFailed'), 'error')
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
    platform.toast(t('about.copied'), 'success')
  } catch {
    platform.toast(t('about.copyFailed'), 'error')
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
    platform.toast(error instanceof Error ? error.message : t('about.openLogsFailed'), 'error')
  }
}
</script>

<template>
  <div>
    <h3 class="section-label">{{ t('about.section') }}</h3>
    <SettingsRow :label="t('about.application')">
      <span class="text-sm text-zinc-100">Ribo Studio</span>
    </SettingsRow>
    <SettingsRow :label="t('about.version')" :hint="t('about.versionHint')">
      <span class="text-sm text-zinc-100">v{{ info?.version || APP_VERSION }}</span>
    </SettingsRow>

    <h3 class="section-label mt-6">{{ t('about.system') }}</h3>
    <SettingsRow :label="t('about.os')">
      <span class="text-sm text-zinc-300">{{ info?.os || (loading ? t('about.loading') : '—') }}</span>
    </SettingsRow>
    <SettingsRow :label="t('about.cpu')">
      <span class="max-w-[18rem] text-end text-sm text-zinc-300">
        {{ info?.cpuModel || '—' }}
        <span v-if="info" class="block text-xs text-zinc-500">{{ info.cpuCount }} {{ t('about.logical') }}</span>
      </span>
    </SettingsRow>
    <SettingsRow :label="t('about.memory')">
      <span class="text-sm text-zinc-300">
        {{ formatBytes(info?.totalRamBytes) }}
        <span class="text-xs text-zinc-500"> / {{ formatBytes(info?.availableRamBytes) }} {{ t('about.free') }}</span>
      </span>
    </SettingsRow>
    <SettingsRow :label="t('about.gpu')" :hint="t('about.gpuHint')">
      <span class="max-w-[18rem] text-end text-sm text-zinc-300">
        {{ (info?.gpu || []).join(', ') || t('about.noneDetected') }}
      </span>
    </SettingsRow>
    <SettingsRow :label="t('about.ffmpeg')">
      <span class="max-w-[18rem] truncate text-end text-xs text-zinc-300">{{ info?.ffmpegVersion || '—' }}</span>
    </SettingsRow>
    <SettingsRow :label="t('about.ffprobe')">
      <span class="max-w-[18rem] truncate text-end text-xs text-zinc-300">{{ info?.ffprobeVersion || '—' }}</span>
    </SettingsRow>
    <SettingsRow :label="t('about.upscalers')">
      <span class="max-w-[18rem] text-end text-sm text-zinc-300">
        {{
          (info?.upscalerEngines || [])
            .map((engine) => `${engine.label}${engine.available ? '' : ` (${t('about.off')})`}`)
            .join(', ') || '—'
        }}
      </span>
    </SettingsRow>

    <h3 class="section-label mt-6 mb-3">{{ t('about.actions') }}</h3>
    <div class="flex flex-wrap gap-2">
      <button class="btn btn-ghost cursor-pointer" type="button" @click="copyInfo">
        <Copy :size="14" />
        {{ t('about.copyInfo') }}
      </button>
      <button class="btn btn-ghost cursor-pointer" type="button" @click="openGithub">
        <ExternalLink :size="14" />
        {{ t('about.openGithub') }}
      </button>
      <button class="btn btn-ghost cursor-pointer" type="button" @click="showChangelog = !showChangelog">
        {{ t('about.viewChangelog') }}
      </button>
      <button
        v-if="info?.capabilities.canOpenPaths"
        class="btn btn-ghost cursor-pointer"
        type="button"
        @click="openLogs"
      >
        <FolderOpen :size="14" />
        {{ t('about.openLogs') }}
      </button>
    </div>
    <p v-if="showChangelog" class="mt-3 whitespace-pre-wrap rounded-lg bg-inset p-3 text-xs text-zinc-400">
      {{ changelogText }}
    </p>
    <p class="mt-4 text-xs text-zinc-500">
      {{ t('about.updatesNote') }}
    </p>
  </div>
</template>
