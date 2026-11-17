<script setup lang="ts">
import { computed } from 'vue'
import { RotateCcw } from '@lucide/vue'
import { formatHms } from '@shared/audioLooper'
import { formatBytes, formatClock } from '../../../lib/format'
import AppPanel from '../../../components/ui/AppPanel.vue'
import { useI18n } from '../../../i18n'
import { WAVEFORM_MAX_BYTES } from '../lib/waveform'
import { useAudioLooperStore } from '../stores/audioLooper'
import LooperPlayer from './LooperPlayer.vue'
import LooperSequencePlayer from './LooperSequencePlayer.vue'

const store = useAudioLooperStore()
const { t } = useI18n()
const selected = computed(() => store.selectedTrack)
const skippedWaveform = computed(() => (selected.value?.fileSize ?? 0) > WAVEFORM_MAX_BYTES)
const repeatsLabel = computed(() => {
  if (!store.sequencePeriod) return '—'
  const value = store.estimatedRepeats
  if (!Number.isFinite(value) || value <= 0) return '—'
  return value.toFixed(value % 1 ? 2 : 0)
})
const sourcePanelTitle = computed(() =>
  store.trackCount >= 2 ? t('looper.preview.selectedTrack') : t('looper.preview.sourcePreview'),
)
const durationRowLabel = computed(() =>
  store.trackCount >= 2 ? t('looper.preview.sequenceDuration') : t('looper.preview.sourceDuration'),
)

function onTrimStart(event: Event): void {
  const track = selected.value
  if (!track?.duration) return
  const value = Number((event.target as HTMLInputElement).value)
  store.setTrim(track.id, value, track.trimEnd ?? track.duration)
}

function onTrimEnd(event: Event): void {
  const track = selected.value
  if (!track?.duration) return
  const value = Number((event.target as HTMLInputElement).value)
  store.setTrim(track.id, track.trimStart, value)
}
</script>

<template>
  <div class="space-y-3">
    <AppPanel v-if="store.trackCount >= 2" :title="t('looper.preview.sequence')">
      <LooperSequencePlayer />
      <p v-if="store.playlistCrossfade && !store.settingsError" class="mt-3 text-xs text-zinc-500">
        {{ t('looper.preview.crossfadePreviewNote') }}
      </p>
      <p v-if="store.normalizeLoudness" class="mt-2 text-xs text-zinc-500">
        {{ t('looper.preview.loudnessNote') }}
      </p>
      <div v-if="store.normalizeLoudness" class="mt-3 flex flex-wrap items-center gap-2">
        <button
          class="btn btn-ghost cursor-pointer text-xs"
          type="button"
          :disabled="store.mixPreviewState === 'running' || Boolean(store.settingsError)"
          @click="store.previewMix()"
        >
          {{ store.mixPreviewState === 'running' ? t('looper.preview.preparingMix') : t('looper.preview.previewMix') }}
        </button>
        <button
          v-if="store.mixPreviewUrl"
          class="btn btn-ghost cursor-pointer text-xs"
          type="button"
          @click="store.clearMixPreview()"
        >
          {{ t('looper.preview.closeMix') }}
        </button>
      </div>
      <p v-if="store.mixPreviewError" class="mt-2 text-xs text-red-300">{{ store.mixPreviewError }}</p>
    </AppPanel>

    <AppPanel :title="sourcePanelTitle">
      <p class="truncate text-sm text-zinc-300">{{ selected ? store.displayName(selected) : store.fileName }}</p>
      <p class="mt-1 text-xs text-zinc-500">
        {{ t('looper.preview.trimmedLength') }}
        {{ selected && store.trimmedLength(selected) > 0 ? formatClock(store.trimmedLength(selected)) : '—' }}
      </p>
      <LooperPlayer class="mt-3" />
      <div
        v-if="selected?.duration"
        class="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-x-2 gap-y-1"
      >
        <label class="text-xs text-zinc-500" for="looper-trim-start">{{ t('looper.preview.start') }}</label>
        <label class="text-xs text-zinc-500" for="looper-trim-end">{{ t('looper.preview.end') }}</label>
        <div />
        <input
          id="looper-trim-start"
          class="field tabular-nums"
          type="number"
          min="0"
          :max="selected.duration"
          step="0.1"
          :value="selected.trimStart.toFixed(2)"
          @change="onTrimStart"
        />
        <input
          id="looper-trim-end"
          class="field tabular-nums"
          type="number"
          min="0"
          :max="selected.duration"
          step="0.1"
          :value="(selected.trimEnd ?? selected.duration).toFixed(2)"
          @change="onTrimEnd"
        />
        <button
          class="btn btn-ghost h-full min-h-0 self-stretch px-2"
          type="button"
          :aria-label="t('looper.preview.resetTrim')"
          :title="t('looper.preview.resetTrim')"
          :disabled="selected.trimStart <= 0.01 && (selected.trimEnd ?? selected.duration) >= selected.duration - 0.01"
          @click="store.resetTrim(selected.id)"
        >
          <RotateCcw :size="16" />
        </button>
      </div>
      <p v-if="skippedWaveform" class="mt-3 text-xs text-zinc-500">
        {{ t('looper.preview.waveformSkipped') }}
      </p>
    </AppPanel>

    <AppPanel :title="t('looper.preview.loopPlan')" class="text-sm text-zinc-300">
      <dl class="grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-zinc-400">
        <div>{{ durationRowLabel }}</div>
        <div class="text-zinc-200 tabular-nums">{{ store.sequencePeriod > 0 ? formatHms(Math.round(store.sequencePeriod)) : '—' }}</div>
        <div>{{ t('looper.preview.targetDuration') }}</div>
        <div class="text-zinc-200 tabular-nums">{{ formatHms(store.targetDurationSeconds) }}</div>
        <div>{{ t('looper.preview.estimatedRepeats') }}</div>
        <div class="text-zinc-200 tabular-nums">{{ repeatsLabel }}</div>
        <div>{{ t('looper.preview.approximateSize') }}</div>
        <div class="text-zinc-200">{{ t('looper.preview.sizeEstimate', { size: formatBytes(store.estimatedBytes) }) }}</div>
      </dl>
      <p v-if="store.settingsError" class="mt-3 text-xs text-amber-300">{{ store.settingsError }}</p>
      <p v-else-if="store.willTrim" class="mt-3 text-xs text-amber-300">
        {{ t('looper.preview.trimTargetNote') }}
      </p>
      <p v-else-if="store.trackCount < 2 && store.loopMode === 'seamless'" class="mt-3 text-xs text-zinc-500">
        {{ t('looper.preview.seamlessNote') }}
      </p>
      <p v-else-if="store.trackCount >= 2 && store.playlistCrossfade" class="mt-3 text-xs text-zinc-500">
        {{ t('looper.preview.playlistJoinNote') }}
      </p>
    </AppPanel>
  </div>
</template>