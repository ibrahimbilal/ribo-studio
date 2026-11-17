<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '../../../i18n'
import AppExportStatusPanel from '../../../components/ui/AppExportStatusPanel.vue'
import { formatClock } from '../../../lib/format'
import { useImageMotionStore } from '../stores/imageMotion'

const store = useImageMotionStore()
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

const totalFrames = computed(() => Math.max(1, Math.round(store.duration * store.video.fps)))

const renderedFramesLabel = computed(() => {
  const enc = store.exportState.encodeProgress
  if (enc == null) return '—'
  const rendered = Math.min(totalFrames.value, Math.max(0, Math.round(totalFrames.value * enc)))
  return `${rendered.toLocaleString()} / ${totalFrames.value.toLocaleString()}`
})

function formatSeconds(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const total = Math.max(0, Math.round(value))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

const rows = computed(() => [
  { label: t('imageMotion.export.rows.stage'), value: store.exportState.stage || store.exportState.message || '—' },
  { label: t('imageMotion.export.rows.totalFrames'), value: totalFrames.value.toLocaleString() },
  { label: t('imageMotion.export.rows.renderedFrames'), value: renderedFramesLabel.value },
  { label: t('imageMotion.export.rows.encoding'), value: store.exportState.encoder || '—' },
  {
    label: t('imageMotion.export.rows.acceleration'),
    value:
      store.exportState.hardware == null
        ? '—'
        : store.exportState.hardware
          ? t('imageMotion.export.rows.accelerationActive')
          : t('imageMotion.export.rows.accelerationOff'),
  },
  {
    label: t('imageMotion.export.rows.speed'),
    value:
      store.exportState.encodeSpeed != null
        ? t('imageMotion.export.rows.speedRealtime', { n: store.exportState.encodeSpeed.toFixed(2) })
        : '—',
  },
  {
    label: t('imageMotion.export.rows.encodeFps'),
    value: store.exportState.encodeFps != null ? store.exportState.encodeFps.toFixed(1) : '—',
  },
  { label: t('imageMotion.export.rows.elapsed'), value: formatSeconds(store.exportState.elapsedSec) },
  {
    label: t('imageMotion.export.rows.remaining'),
    value: store.exportState.etaSec == null ? t('common.estimating') : formatSeconds(store.exportState.etaSec),
  },
  {
    label: t('imageMotion.export.rows.output'),
    value: `${store.video.width}×${store.video.height} · ${store.video.fps} fps · ${formatClock(store.duration)}`,
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
