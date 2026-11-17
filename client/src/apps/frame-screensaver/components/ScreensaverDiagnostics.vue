<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { webGl2Available } from '../lib/render/createScreensaverRenderer'
import {
  exportPrepSnapshot,
  previewMetricsSnapshot,
  screensaverDiagnosticsEnabled,
  setScreensaverDiagnosticsEnabled,
  webGlContextLossCount,
} from '../lib/previewMetrics'
import { useI18n } from '../../../i18n'
import { S } from '../lib/screensaverI18n'

const { t } = useI18n()
const visible = ref(screensaverDiagnosticsEnabled())
const tick = ref(0)
let timer = 0

const metrics = computed(() => {
  void tick.value
  return previewMetricsSnapshot()
})
const exportPrep = computed(() => {
  void tick.value
  return exportPrepSnapshot()
})

const toggleLabel = computed(() => (visible.value ? t(S('diagnostics.hide')) : t(S('diagnostics.show'))))
const yesNo = (value: boolean) => (value ? t(S('diagnostics.yes')) : t(S('diagnostics.no')))

function fmtMs(value: number | null | undefined): string {
  if (value == null) return t(S('diagnostics.notMeasured'))
  return t(S('diagnostics.ms'), { value: value.toFixed(value < 100 ? 2 : 0) })
}

onMounted(() => {
  visible.value = screensaverDiagnosticsEnabled()
  timer = window.setInterval(() => {
    if (visible.value) tick.value += 1
  }, 500)
})

onBeforeUnmount(() => {
  window.clearInterval(timer)
})

function toggle(): void {
  visible.value = !visible.value
  setScreensaverDiagnosticsEnabled(visible.value)
}
</script>

<template>
  <div class="pointer-events-auto fixed end-4 bottom-4 z-40 max-w-xs">
    <button class="btn btn-ghost cursor-pointer text-xs" type="button" @click="toggle">
      {{ toggleLabel }}
    </button>
    <div v-if="visible" class="mt-2 rounded-lg border border-zinc-700 bg-app/95 p-3 text-xs text-zinc-300 shadow-lg">
      <p><span class="text-zinc-500">{{ t(S('diagnostics.backend')) }}</span> {{ metrics.lastBackend }}</p>
      <p>
        <span class="text-zinc-500">{{ t(S('diagnostics.webgl2')) }}</span> {{ yesNo(webGl2Available()) }}
      </p>
      <p><span class="text-zinc-500">{{ t(S('diagnostics.contextLosses')) }}</span> {{ webGlContextLossCount() }}</p>
      <p>
        <span class="text-zinc-500">{{ t(S('diagnostics.previewFps')) }}</span>
        {{ metrics.fps != null ? metrics.fps.toFixed(1) : t(S('diagnostics.notMeasured')) }}
      </p>
      <p><span class="text-zinc-500">{{ t(S('diagnostics.avgDraw')) }}</span> {{ fmtMs(metrics.avgDrawMs) }}</p>
      <p>
        <span class="text-zinc-500">{{ t(S('diagnostics.avgBake')) }}</span>
        {{ metrics.avgBakeMs != null ? fmtMs(metrics.avgBakeMs) : t(S('diagnostics.na')) }}
      </p>
      <p><span class="text-zinc-500">{{ t(S('diagnostics.avgComposite')) }}</span> {{ fmtMs(metrics.avgCompositeMs) }}</p>
      <p>
        <span class="text-zinc-500">{{ t(S('diagnostics.lastExportPrep')) }}</span>
        {{ exportPrep.ms != null ? fmtMs(exportPrep.ms) : t(S('diagnostics.notMeasured')) }}
      </p>
      <p>
        <span class="text-zinc-500">{{ t(S('diagnostics.exportWorker')) }}</span>
        {{
          exportPrep.ms != null
            ? yesNo(Boolean(exportPrep.usedWorker))
            : t(S('diagnostics.notMeasured'))
        }}
      </p>
      <p class="mt-2 text-zinc-500">{{ t(S('diagnostics.enableHint')) }}</p>
    </div>
  </div>
</template>