<script setup lang="ts">
import { computed, ref } from 'vue'
import AppExportStatusPanel from '../../../components/ui/AppExportStatusPanel.vue'
import { useScreensaverStore } from '../stores/screensaver'
import { useI18n } from '../../../i18n'
import { S } from '../lib/screensaverI18n'

const store = useScreensaverStore()
const { t } = useI18n()
const open = ref(false)

const visible = computed(() => {
  const phase = store.exportState.phase
  if (phase === 'done') return Boolean(store.exportState.encoder)
  if (phase === 'error') return true
  return (
    store.exporting ||
    phase === 'queued' ||
    phase === 'preparing' ||
    phase === 'rendering' ||
    phase === 'verifying' ||
    phase === 'uploading' ||
    phase === 'overlays'
  )
})

const tone = computed(() => {
  if (store.exportState.phase === 'error') return 'error' as const
  if (store.exportState.phase === 'done') return 'done' as const
  return 'active' as const
})

const totalFrames = computed(() => Math.max(1, Math.round(store.durationSeconds * store.fps)))

const dash = computed(() => t(S('exportDetails.dash')))

const renderedFramesLabel = computed(() => {
  const enc = store.exportState.encodeProgress
  if (enc == null) return dash.value
  const rendered = Math.min(totalFrames.value, Math.max(0, Math.round(totalFrames.value * enc)))
  return `${rendered.toLocaleString()} / ${totalFrames.value.toLocaleString()}`
})

function formatSeconds(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return dash.value
  const total = Math.max(0, Math.round(value))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

const rows = computed(() => [
  { label: t(S('exportDetails.stage')), value: store.exportState.stage || store.exportState.message || dash.value },
  { label: t(S('exportDetails.totalFrames')), value: totalFrames.value.toLocaleString() },
  { label: t(S('exportDetails.renderedFrames')), value: renderedFramesLabel.value },
  { label: t(S('exportDetails.encoding')), value: store.exportState.encoder || dash.value },
  {
    label: t(S('exportDetails.acceleration')),
    value:
      store.exportState.hardware == null
        ? dash.value
        : store.exportState.hardware
          ? t(S('exportDetails.accelerationActive'))
          : t(S('exportDetails.accelerationOff')),
  },
  {
    label: t(S('exportDetails.speed')),
    value:
      store.exportState.encodeSpeed != null
        ? t(S('exportDetails.speedValue'), { speed: store.exportState.encodeSpeed.toFixed(2) })
        : dash.value,
  },
  {
    label: t(S('exportDetails.encodeFps')),
    value: store.exportState.encodeFps != null ? store.exportState.encodeFps.toFixed(1) : dash.value,
  },
  { label: t(S('exportDetails.elapsed')), value: formatSeconds(store.exportState.elapsedSec) },
  {
    label: t(S('exportDetails.remaining')),
    value: store.exportState.etaSec == null ? t('common.estimating') : formatSeconds(store.exportState.etaSec),
  },
  {
    label: t(S('exportDetails.output')),
    value: t(S('exportDetails.outputValue'), {
      width: store.outputWidth,
      height: store.outputHeight,
      fps: store.fps,
      duration: store.durationLabel,
    }),
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
