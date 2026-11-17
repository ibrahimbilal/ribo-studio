<script setup lang="ts">
import { computed, ref } from 'vue'
import { AUDIO_LOOPER_BITRATES, AUDIO_LOOPER_FORMATS, type AudioLooperFormat, type AudioLooperLoopMode } from '@shared/audioLooper'
import ToggleSwitch from '../../../components/ToggleSwitch.vue'
import AppSettingsTabs from '../../../components/ui/AppSettingsTabs.vue'
import { useI18n, type MessageKey } from '../../../i18n'
import { formatDurationLabelI18n } from '../../../lib/formatDurationLabelI18n'
import { useAudioLooperStore } from '../stores/audioLooper'

const store = useAudioLooperStore()
const { t } = useI18n()
const customMinutes = ref(60)
const inspector = ref<'duration' | 'loop' | 'output'>('duration')

const outputDurationLabel = computed(() => formatDurationLabelI18n(store.targetDurationSeconds, t))

const DURATION_PRESET_I18N: Record<number, MessageKey> = {
  [30 * 60]: 'looper.presets.m30',
  [60 * 60]: 'looper.presets.h1',
  [2 * 60 * 60]: 'looper.presets.h2',
  [4 * 60 * 60]: 'looper.presets.h4',
  [6 * 60 * 60]: 'looper.presets.h6',
  [8 * 60 * 60]: 'looper.presets.h8',
  [10 * 60 * 60]: 'looper.presets.h10',
  [12 * 60 * 60]: 'looper.presets.h12',
}

const inspectorTabs = computed(() => [
  { id: 'duration' as const, label: t('looper.settings.tabDuration') },
  { id: 'loop' as const, label: t('looper.settings.tabLoop') },
  { id: 'output' as const, label: t('looper.settings.tabOutput') },
])

function presetLabel(seconds: number, fallback: string): string {
  const key = DURATION_PRESET_I18N[seconds]
  return key ? t(key) : fallback
}

function onCustomMinutes(): void {
  store.setCustomDurationMinutes(customMinutes.value)
}

function setMode(mode: AudioLooperLoopMode): void {
  store.setLoopMode(mode)
}

function setFormat(value: string): void {
  store.format = value as AudioLooperFormat
}

function setBitrate(value: string): void {
  store.mp3Bitrate = Number(value) as (typeof AUDIO_LOOPER_BITRATES)[number]
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="shrink-0 border-b border-zinc-800">
      <h2 class="px-4 pt-4 text-sm font-bold text-zinc-100">{{ t('looper.settings.title') }}</h2>
      <AppSettingsTabs v-model="inspector" :items="inspectorTabs" />
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <Transition name="settings-pane" mode="out-in">
        <div v-if="inspector === 'duration'" key="duration" class="space-y-3">
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="preset in store.presets"
              :key="preset.seconds"
              class="btn cursor-pointer text-xs"
              :class="store.durationPresetKey === String(preset.seconds) ? 'btn-primary' : 'btn-ghost'"
              type="button"
              @click="store.setDurationPreset(preset.seconds)"
            >
              {{ presetLabel(preset.seconds, preset.label) }}
            </button>
          </div>
          <div class="space-y-1">
            <label class="text-xs text-zinc-500">{{ t('looper.settings.customMinutes') }}</label>
            <div class="flex gap-2">
              <input v-model.number="customMinutes" class="field flex-1" type="number" min="5" max="600" step="1" />
              <button class="btn btn-ghost cursor-pointer" type="button" @click="onCustomMinutes">{{ t('common.apply') }}</button>
            </div>
            <p class="text-xs text-zinc-500">{{ t('looper.settings.outputDuration', { label: outputDurationLabel }) }}</p>
          </div>
        </div>
        <div v-else-if="inspector === 'loop'" key="loop" class="space-y-3">
          <p v-if="!store.hasSource" class="text-xs text-zinc-500">{{ t('looper.settings.addAudioHint') }}</p>
          <template v-else-if="store.trackCount >= 2">
            <div class="flex items-center justify-between gap-3 text-sm text-zinc-200">
              <span :title="t('looper.settings.crossfadeTitle')">{{ t('looper.settings.crossfade') }}</span>
              <ToggleSwitch
                :model-value="store.playlistCrossfade"
                :disabled="store.readyTracks.length >= 2 && store.playlistLimit < 0.05"
                :aria-label="t('looper.settings.crossfade')"
                @update:model-value="store.setPlaylistCrossfade"
              />
            </div>
            <p v-if="store.readyTracks.length >= 2 && store.playlistLimit < 0.05" class="text-xs text-amber-300">
              {{ t('looper.settings.tracksTooShort') }}
            </p>
            <label v-if="store.playlistCrossfade" class="block">
              <span class="mb-1 flex justify-between text-xs text-zinc-500">
                <span>{{ t('looper.settings.transition') }}</span>
                <span class="tabular-nums text-zinc-300">{{ store.playlistCrossfadeSeconds.toFixed(2) }}s</span>
              </span>
              <input
                class="w-full accent-brand"
                type="range"
                min="0.05"
                :max="Math.max(0.05, store.playlistLimit || 3)"
                step="0.05"
                :value="store.playlistCrossfadeSeconds"
                @input="store.playlistCrossfadeSeconds = Number(($event.target as HTMLInputElement).value)"
              />
              <p class="mt-1 text-xs text-zinc-500">{{ t('looper.settings.crossfadeDefaultHint') }}</p>
            </label>
            <div class="flex items-center justify-between gap-3 text-sm text-zinc-200">
              <span :title="t('looper.settings.matchLoudnessTitle')">{{ t('looper.settings.matchLoudness') }}</span>
              <ToggleSwitch v-model="store.normalizeLoudness" :aria-label="t('looper.settings.matchLoudness')" />
            </div>
            <p v-if="store.settingsError" class="text-xs text-amber-300">{{ store.settingsError }}</p>
          </template>
          <template v-else>
            <div class="grid grid-cols-2 gap-2">
              <button class="btn cursor-pointer text-xs" :class="store.loopMode === 'simple' ? 'btn-primary' : 'btn-ghost'" type="button" @click="setMode('simple')">{{ t('looper.settings.simple') }}</button>
              <button class="btn cursor-pointer text-xs" :class="store.loopMode === 'seamless' ? 'btn-primary' : 'btn-ghost'" type="button" :disabled="!store.seamlessAvailable" @click="setMode('seamless')">{{ t('looper.settings.seamless') }}</button>
            </div>
            <p v-if="!store.seamlessAvailable" class="text-xs text-zinc-500">{{ t('looper.settings.seamlessUnavailable') }}</p>
            <p v-else class="text-xs text-zinc-500">{{ t('looper.settings.loopSimpleHint') }}</p>
            <label v-if="store.loopMode === 'seamless'" class="block">
              <span class="mb-1 flex justify-between text-xs text-zinc-500">
                <span>{{ t('looper.settings.crossfade') }}</span>
                <span class="tabular-nums text-zinc-300">{{ store.crossfadeSeconds.toFixed(2) }}s</span>
              </span>
              <input class="w-full accent-brand" type="range" min="0.01" :max="store.maxCrossfade" step="0.01" :value="store.crossfadeSeconds" @input="store.crossfadeSeconds = Number(($event.target as HTMLInputElement).value)" />
            </label>
          </template>
          <template v-if="store.hasSource">
            <label class="block">
              <span class="mb-1 flex justify-between text-xs text-zinc-500">
                <span>{{ t('looper.settings.fadeIn') }}</span>
                <span class="tabular-nums text-zinc-300">{{ store.fadeInSeconds.toFixed(1) }}s</span>
              </span>
              <input class="w-full accent-brand" type="range" min="0" max="30" step="0.1" :value="store.fadeInSeconds" @input="store.fadeInSeconds = Number(($event.target as HTMLInputElement).value)" />
            </label>
            <label class="block">
              <span class="mb-1 flex justify-between text-xs text-zinc-500">
                <span>{{ t('looper.settings.fadeOut') }}</span>
                <span class="tabular-nums text-zinc-300">{{ store.fadeOutSeconds.toFixed(1) }}s</span>
              </span>
              <input class="w-full accent-brand" type="range" min="0" max="30" step="0.1" :value="store.fadeOutSeconds" @input="store.fadeOutSeconds = Number(($event.target as HTMLInputElement).value)" />
            </label>
            <label class="block">
              <span class="mb-1 flex justify-between text-xs text-zinc-500">
                <span>{{ t('looper.settings.volume') }}</span>
                <span class="tabular-nums text-zinc-300">{{ Math.round(store.volumePercent) }}%</span>
              </span>
              <input class="w-full accent-brand" type="range" min="0" max="200" step="1" :value="store.volumePercent" @input="store.volumePercent = Number(($event.target as HTMLInputElement).value)" />
            </label>
          </template>
        </div>
        <div v-else key="output" class="space-y-3">
          <label class="block">
            <span class="mb-1 block text-xs text-zinc-500">{{ t('looper.settings.format') }}</span>
            <select class="field" :value="store.format" @change="setFormat(($event.target as HTMLSelectElement).value)">
              <option v-for="item in AUDIO_LOOPER_FORMATS" :key="item" :value="item">{{ item.toUpperCase() }}</option>
            </select>
          </label>
          <label v-if="store.format === 'mp3'" class="block">
            <span class="mb-1 block text-xs text-zinc-500">{{ t('looper.settings.mp3Bitrate') }}</span>
            <select class="field" :value="store.mp3Bitrate" @change="setBitrate(($event.target as HTMLSelectElement).value)">
              <option v-for="rate in AUDIO_LOOPER_BITRATES" :key="rate" :value="rate">{{ rate }} kbps</option>
            </select>
            <p class="mt-1 text-xs text-zinc-500">{{ store.mp3BitrateHint }}</p>
          </label>
          <p v-else-if="store.format === 'wav'" class="text-xs text-zinc-500">{{ t('looper.settings.wavHint') }}</p>
          <p v-else class="text-xs text-zinc-500">{{ t('looper.settings.flacHint') }}</p>
        </div>
      </Transition>
    </div>
  </div>
</template>