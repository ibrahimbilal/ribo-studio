<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '../i18n'
import AppExportStatusPanel from './ui/AppExportStatusPanel.vue'
import { usePlayback } from '../composables/usePlayback'
import { formatClock } from '../lib/format'
import { useProjectStore } from '../stores/project'

const store = useProjectStore()
const playback = usePlayback()
const { t } = useI18n()
const open = ref(false)

const visible = computed(
  () => store.exporting || Boolean(store.exportState.encoder) || store.exportState.phase === 'done',
)

const tone = computed(() => {
  if (store.exportState.phase === 'error') return 'error' as const
  if (store.exportState.phase === 'done') return 'done' as const
  return 'active' as const
})

function formatSeconds(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const total = Math.max(0, Math.round(value))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

const totalFrames = computed(() => Math.max(1, Math.round(playback.duration.value * store.style.video.fps)))

const renderedFramesLabel = computed(() => {
  const enc = store.exportState.encodeProgress
  if (enc == null) return '—'
  const rendered = Math.min(totalFrames.value, Math.max(0, Math.round(totalFrames.value * enc)))
  return `${rendered.toLocaleString()} / ${totalFrames.value.toLocaleString()}`
})

const rows = computed(() => [
  { label: t('ranking.export.rows.stage'), value: store.exportState.stage || store.exportState.message || '—' },
  { label: t('ranking.export.rows.totalFrames'), value: totalFrames.value.toLocaleString() },
  { label: t('ranking.export.rows.renderedFrames'), value: renderedFramesLabel.value },
  { label: t('ranking.export.rows.encoding'), value: store.exportState.encoder || '—' },
  {
    label: t('ranking.export.rows.acceleration'),
    value:
      store.exportState.hardware == null
        ? '—'
        : store.exportState.hardware
          ? t('ranking.export.rows.accelerationActive')
          : t('ranking.export.rows.accelerationOff'),
  },
  {
    label: t('ranking.export.rows.speed'),
    value:
      store.exportState.encodeSpeed != null
        ? t('ranking.export.rows.speedRealtime', { n: store.exportState.encodeSpeed.toFixed(2) })
        : '—',
  },
  {
    label: t('ranking.export.rows.encodeFps'),
    value: store.exportState.encodeFps != null ? store.exportState.encodeFps.toFixed(1) : '—',
  },
  { label: t('ranking.export.rows.elapsed'), value: formatSeconds(store.exportState.elapsedSec) },
  {
    label: t('ranking.export.rows.remaining'),
    value: store.exportState.etaSec == null ? t('common.estimating') : formatSeconds(store.exportState.etaSec),
  },
  {
    label: t('ranking.export.rows.output'),
    value: `${store.style.video.width}×${store.style.video.height} · ${store.style.video.fps} fps · ${formatClock(playback.duration.value)}`,
  },
])
</script>

<template>
  <AppExportStatusPanel
    v-if="visible"
    :open="open"
    :rows="rows"
    :progress="store.exportState.progress"
    :tone="tone"
    @toggle="open = !open"
  />
</template>
