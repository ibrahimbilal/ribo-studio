<script setup lang="ts">
import { computed } from 'vue'
import { Eye, RotateCcw, SquareSplitHorizontal, Trash2, X } from '@lucide/vue'
import { ADJUSTMENT_FIELDS } from '@shared/screensaverAdjust'
import { FRAME_FILE_LIMIT } from '@shared/screensaverFrames'
import { DURATION_PRESETS, SCREENSAVER_OUTPUTS } from '@shared/screensaver'
import {
  SUBSCRIBE_ANIMATION_DURATION_SEC,
  SUBSCRIBE_ANIMATION_FPS,
  SUBSCRIBE_ANIMATION_POSITIONS,
  SUBSCRIBE_ANIMATION_STYLES,
  SUBSCRIBE_CHANNEL_CARD_THEMES,
  SUBSCRIBE_REPEAT_UNITS,
  MAX_SUBSCRIBE_EDGE_DISTANCE,
  MIN_SUBSCRIBE_EDGE_DISTANCE,
  MIN_SUBSCRIBE_SIZE_PERCENT,
  MAX_SUBSCRIBE_SIZE_PERCENT,
  MIN_SUBSCRIBE_REPEAT_EVERY_VALUE,
  MAX_SUBSCRIBE_REPEAT_EVERY_VALUE_HOURS,
  MAX_SUBSCRIBE_REPEAT_EVERY_VALUE_MINUTES,
  defaultSubscribeSizePercent,
  type SubscribeAnimationStyle,
  type SubscribeRepeatUnit,
} from '@shared/screensaverSubscribeAnimation'
import AdvancedAudioControls from '../../../components/audio/AdvancedAudioControls.vue'
import AudioFileField from '../../../components/audio/AudioFileField.vue'
import FileDropZone from '../../../components/FileDropZone.vue'
import SettingsAccordion from '../../../components/SettingsAccordion.vue'
import YoutubeChannelSelector from '../../../components/YoutubeChannelSelector.vue'
import AppRadio from '../../../components/ui/AppRadio.vue'
import AppSettingsTabs from '../../../components/ui/AppSettingsTabs.vue'
import SliderField from '../../../components/SliderField.vue'
import ToggleSwitch from '../../../components/ToggleSwitch.vue'
import { useScreensaverStore } from '../stores/screensaver'
import { useGlobalSettingsStore } from '../../../stores/globalSettings'
import { DEFAULT_FRAMES } from '../lib/defaultFrames'
import type { SubscribeAnimationPosition } from '@shared/screensaverSubscribeAnimation'
import { useI18n } from '../../../i18n'
import { S } from '../lib/screensaverI18n'
import { DURATION_PRESET_I18N } from '../lib/durationPresetI18n'
import { SUBSCRIBE_STYLE_I18N } from '../lib/subscribeStyleI18n'

const store = useScreensaverStore()
const globalSettings = useGlobalSettingsStore()
const { t } = useI18n()

const POSITION_I18N: Record<SubscribeAnimationPosition, string> = {
  'bottom-left': 'settings.subscribe.positions.bottomLeft',
  'bottom-center': 'settings.subscribe.positions.bottomCenter',
  'bottom-right': 'settings.subscribe.positions.bottomRight',
}

function positionLabel(position: SubscribeAnimationPosition): string {
  return t(S(POSITION_I18N[position]))
}

function adjustmentLabel(key: (typeof ADJUSTMENT_FIELDS)[number]['key']): string {
  return t(S(`settings.adjustments.fields.${key}`))
}

function durationPresetLabel(seconds: number, fallback: string): string {
  const path = DURATION_PRESET_I18N[seconds]
  return path ? t(S(path)) : fallback
}

function onSubscribeStyleChange(event: Event) {
  const style = (event.target as HTMLSelectElement).value as SubscribeAnimationStyle
  store.replaceSubscribeAnimation({
    style,
    sizePercent: defaultSubscribeSizePercent(style),
    edgeDistance: 0,
  })
}

function repeatUnitLabel(unit: SubscribeRepeatUnit): string {
  if (unit === 'minutes') return t(S('settings.subscribe.repeatUnitMinutes'))
  if (unit === 'hours') return t(S('settings.subscribe.repeatUnitHours'))
  return t(S('settings.subscribe.repeatUnitOff'))
}

const repeatEveryMax = computed(() =>
  store.subscribeAnimation.repeatEveryUnit === 'hours'
    ? MAX_SUBSCRIBE_REPEAT_EVERY_VALUE_HOURS
    : MAX_SUBSCRIBE_REPEAT_EVERY_VALUE_MINUTES,
)

function onSubscribeRepeatUnitChange(event: Event) {
  const unit = (event.target as HTMLSelectElement).value as SubscribeRepeatUnit
  store.replaceSubscribeAnimation({ repeatEveryUnit: unit })
}

function onSubscribeChannelSelect(channelId: string) {
  const id = channelId.trim()
  if (!id) return
  void store.selectSubscribeChannel(id)
}

const customMinutes = defineModel<number>('customMinutes', { default: 60 })
const frameLimitMb = FRAME_FILE_LIMIT / (1024 * 1024)
const fpsOptions = computed(() =>
  store.effectiveRenderingMode === 'optimized-cfr' ? store.SCREENSAVER_CFR_FPS : store.SCREENSAVER_FPS,
)

function onFrameFiles(files: File[]) {
  if (files.length > 0) void store.uploadFrames(files)
}

function clearSelectedFrame(frameId: string): void {
  if (store.composition.frameId !== frameId) return
  store.selectFrame(frameId)
}

function removeUploadedFrame(frameId: string): void {
  void store.removeFrame(frameId)
}

function onAudioFiles(files: File[]) {
  const file = files[0]
  if (file) void store.setAudioFile(file)
}

function openGlobalOutputSettings(): void {
  globalSettings.openModal('export')
}

function openGlobalCacheSettings(): void {
  globalSettings.openModal('storage')
}

function openChannelIntegrations(): void {
  globalSettings.openModal('integrations')
}

function setPixel(key: 'x' | 'y' | 'width' | 'height', event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(value)) return
  const next = { ...store.composition }
  if (key === 'x') next.x = value / store.outputWidth
  if (key === 'y') next.y = value / store.outputHeight
  if (key === 'width') next.width = value / store.outputWidth
  if (key === 'height') next.height = value / store.outputHeight
  store.replaceComposition(next)
  store.commitComposition()
}

function setNumber(key: 'rotation', event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(value)) return
  store.replaceComposition({ ...store.composition, [key]: value })
  store.commitComposition()
}

function setOpacity(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(value)) return
  store.replaceComposition({ ...store.composition, opacity: value / 100 })
  store.commitComposition()
}

function toggleFlip(key: 'flipH' | 'flipV') {
  store.replaceComposition({ ...store.composition, [key]: !store.composition[key] })
  store.commitComposition()
}

function resetOne(key: (typeof ADJUSTMENT_FIELDS)[number]['key']) {
  store.composition.adjustments[key] = 0
  store.commitComposition()
}

function onCustomMinutes() {
  store.setCustomDurationMinutes(customMinutes.value)
}

const inspectorTabs = computed(() => [
  { id: 'content' as const, label: t(S('settings.inspector.content')) },
  { id: 'output' as const, label: t(S('settings.inspector.output')) },
  { id: 'sound' as const, label: t(S('settings.inspector.sound')) },
  { id: 'style' as const, label: t(S('settings.inspector.style')) },
])
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="shrink-0 border-b border-zinc-800">
      <h2 class="px-4 pt-4 text-sm font-bold text-zinc-100">{{ t(S('settings.title')) }}</h2>
      <AppSettingsTabs v-model="store.settingsInspector" :items="inspectorTabs" :cols="4" />
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <Transition name="settings-pane" mode="out-in">
        <div :key="store.settingsInspector">
          <SettingsAccordion v-show="store.settingsInspector === 'content'" :title="t(S('settings.subscribe.accordion'))" :open="true">
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm">{{ t(S('settings.subscribe.enable')) }}</span>
              <ToggleSwitch
                :model-value="store.subscribeAnimation.enabled"
                :aria-label="t(S('settings.subscribe.enableAria'))"
                @update:model-value="(value) => store.replaceSubscribeAnimation({ enabled: value })"
              />
            </div>
            <p class="mt-1 text-xs text-zinc-500">
              {{
                t(S('settings.subscribe.hint'), {
                  fps: SUBSCRIBE_ANIMATION_FPS,
                  seconds: SUBSCRIBE_ANIMATION_DURATION_SEC,
                })
              }}
            </p>
            <div
              class="settings-reveal"
              :class="{ 'is-open': store.subscribeAnimation.enabled }"
              :inert="!store.subscribeAnimation.enabled"
            >
              <div class="settings-reveal__inner">
                <div class="space-y-0 pt-3">
                  <label class="block text-xs text-zinc-500">{{ t(S('settings.subscribe.style')) }}</label>
                  <select
                    class="field mt-1"
                    :value="store.subscribeAnimation.style"
                    @change="onSubscribeStyleChange"
                  >
                    <option v-for="item in SUBSCRIBE_ANIMATION_STYLES" :key="item.id" :value="item.id">
                      {{ t(S(SUBSCRIBE_STYLE_I18N[item.id])) }}
                    </option>
                  </select>
                  <div
                    class="settings-reveal"
                    :class="{ 'is-open': store.subscribeAnimation.style === 'channel-card' }"
                    :inert="store.subscribeAnimation.style !== 'channel-card'"
                  >
                    <div class="settings-reveal__inner">
                      <div class="pt-3">
                        <label class="block text-xs text-zinc-500">{{ t(S('settings.subscribe.channelCardTheme')) }}</label>
                        <select
                          class="field mt-1"
                          :value="store.subscribeAnimation.channelCardTheme"
                          @change="store.replaceSubscribeAnimation({ channelCardTheme: ($event.target as HTMLSelectElement).value as never })"
                        >
                          <option v-for="item in SUBSCRIBE_CHANNEL_CARD_THEMES" :key="item" :value="item">
                            {{ item === 'light' ? t(S('settings.subscribe.themeLight')) : t(S('settings.subscribe.themeDark')) }}
                          </option>
                        </select>
                        <label class="mt-3 block text-xs text-zinc-500">{{ t(S('settings.subscribe.channel')) }}</label>
                        <YoutubeChannelSelector
                          class="mt-1"
                          :model-value="store.subscribeAnimation.channelId"
                          @update:model-value="onSubscribeChannelSelect"
                          @manage="openChannelIntegrations"
                        />
                      </div>
                    </div>
                  </div>
                  <label class="mt-3 block text-xs text-zinc-500">{{ t(S('settings.subscribe.startSec')) }}</label>
                  <input
                    class="field mt-1"
                    type="number"
                    min="0"
                    :max="Math.max(0, store.durationSeconds - SUBSCRIBE_ANIMATION_DURATION_SEC)"
                    step="1"
                    :value="store.subscribeAnimation.startSec"
                    @change="store.replaceSubscribeAnimation({ startSec: Number(($event.target as HTMLInputElement).value) })"
                  />
                  <label class="mt-3 block text-xs text-zinc-500">{{ t(S('settings.subscribe.repeatEvery')) }}</label>
                  <div class="mt-1 flex gap-2">
                    <select
                      class="field min-w-0 flex-1"
                      :value="store.subscribeAnimation.repeatEveryUnit"
                      @change="onSubscribeRepeatUnitChange"
                    >
                      <option v-for="unit in SUBSCRIBE_REPEAT_UNITS" :key="unit" :value="unit">
                        {{ repeatUnitLabel(unit) }}
                      </option>
                    </select>
                    <input
                      v-if="store.subscribeAnimation.repeatEveryUnit !== 'off'"
                      class="field w-24 shrink-0"
                      type="number"
                      :min="MIN_SUBSCRIBE_REPEAT_EVERY_VALUE"
                      :max="repeatEveryMax"
                      step="1"
                      :value="store.subscribeAnimation.repeatEveryValue"
                      @change="store.replaceSubscribeAnimation({ repeatEveryValue: Number(($event.target as HTMLInputElement).value) })"
                    />
                  </div>
                  <p class="mt-1 text-xs text-zinc-500">{{ t(S('settings.subscribe.repeatEveryHint')) }}</p>
                  <label class="mt-3 block text-xs text-zinc-500">{{ t(S('settings.subscribe.position')) }}</label>
                  <select
                    class="field mt-1"
                    :value="store.subscribeAnimation.position"
                    @change="store.replaceSubscribeAnimation({ position: ($event.target as HTMLSelectElement).value as never })"
                  >
                    <option v-for="item in SUBSCRIBE_ANIMATION_POSITIONS" :key="item" :value="item">{{ positionLabel(item) }}</option>
                  </select>
                  <SliderField
                    class="mt-3"
                    :label="t(S('settings.subscribe.size'))"
                    :min="MIN_SUBSCRIBE_SIZE_PERCENT"
                    :max="MAX_SUBSCRIBE_SIZE_PERCENT"
                    :step="1"
                    :model-value="store.subscribeAnimation.sizePercent"
                    @update:model-value="(v) => store.replaceSubscribeAnimation({ sizePercent: v })"
                  />
                  <SliderField
                    class="mt-3"
                    :label="t(S('settings.subscribe.edgeDistance'))"
                    :min="MIN_SUBSCRIBE_EDGE_DISTANCE"
                    :max="MAX_SUBSCRIBE_EDGE_DISTANCE"
                    :step="4"
                    :model-value="store.subscribeAnimation.edgeDistance"
                    @update:model-value="(v) => store.replaceSubscribeAnimation({ edgeDistance: v })"
                  />
                  <p class="mt-1 text-xs text-zinc-500">{{ t(S('settings.subscribe.edgeHint')) }}</p>
                  <div class="mt-3 flex items-center justify-between gap-3">
                    <span class="text-sm">{{ t(S('settings.subscribe.previewOnCanvas')) }}</span>
                    <ToggleSwitch
                      :model-value="store.subscribeAnimation.previewOnCanvas"
                      :aria-label="t(S('settings.subscribe.previewOnCanvasAria'))"
                      @update:model-value="(value) => store.replaceSubscribeAnimation({ previewOnCanvas: value })"
                    />
                  </div>
                  <p class="mt-1 text-xs text-zinc-500">{{ t(S('settings.subscribe.previewOnCanvasHint')) }}</p>
                  <p class="mt-3 text-xs text-zinc-500">
                    {{ t(S('settings.subscribe.cacheHintBefore')) }}
                    <button class="cursor-pointer font-semibold text-brand underline-offset-2 hover:underline" type="button" @click="openGlobalCacheSettings">
                      {{ t(S('settings.subscribe.cacheHintLink')) }}
                    </button>{{ t(S('settings.subscribe.cacheHintAfter')) }}
                  </p>
                </div>
              </div>
            </div>
          </SettingsAccordion>
          <SettingsAccordion v-show="store.settingsInspector === 'content'" :title="t(S('settings.frames.accordion'))" :open="false">
            <div v-if="DEFAULT_FRAMES.length > 0" class="grid grid-cols-2 gap-2">
              <div v-for="frame in DEFAULT_FRAMES" :key="frame.id" class="group/frame relative">
                <button
                  class="block w-full cursor-pointer overflow-hidden rounded-md border bg-inset"
                  :class="store.composition.frameId === frame.id ? 'border-brand ring-1 ring-brand' : 'border-zinc-700 hover:border-zinc-500'"
                  type="button"
                  :aria-pressed="store.composition.frameId === frame.id"
                  :title="frame.name"
                  @click="store.selectFrame(frame.id)"
                >
                  <img
                    :src="frame.thumbUrl"
                    :alt="frame.name"
                    width="150"
                    loading="lazy"
                    decoding="async"
                    class="aspect-video w-full object-contain"
                  />
                </button>
                <button
                  v-if="store.composition.frameId === frame.id"
                  class="absolute inset-0 flex cursor-pointer items-center justify-center rounded-md bg-black/55 opacity-0 transition-opacity duration-150 group-hover/frame:opacity-100"
                  type="button"
                  :aria-label="t(S('settings.frames.removeFromPreview'), { name: frame.name })"
                  :title="t(S('settings.frames.remove'), { name: frame.name })"
                  @click.stop="clearSelectedFrame(frame.id)"
                >
                  <X :size="22" class="text-white drop-shadow" aria-hidden="true" />
                </button>
              </div>
            </div>
            <FileDropZone
              class="mt-3"
              compact
              accept="image/png,.png"
              multiple
              :disabled="store.frameUploading"
              :label="t(S('settings.frames.uploadLabel'))"
              :drop-label="t(S('settings.frames.uploadDrop'))"
              :busy-label="t(S('settings.frames.uploadBusy'))"
              :hint="t(S('settings.frames.uploadHint'), { mb: frameLimitMb })"
              @files="onFrameFiles"
            />
            <p v-if="store.frames.length === 0" class="mt-2 text-xs text-zinc-500">
              {{ t(S('settings.frames.emptyHint')) }}
            </p>
            <div v-else class="mt-3 grid grid-cols-2 gap-2">
              <div v-for="frame in store.frames" :key="frame.id" class="group/frame relative min-w-0">
                <button
                  class="block w-full cursor-pointer overflow-hidden rounded-md border bg-inset"
                  :class="store.composition.frameId === frame.id ? 'border-brand ring-1 ring-brand' : 'border-zinc-700 hover:border-zinc-500'"
                  type="button"
                  :aria-pressed="store.composition.frameId === frame.id"
                  :title="frame.name"
                  @click="store.selectFrame(frame.id)"
                >
                  <img :src="`/api/screensaver/frames/${frame.id}`" :alt="frame.name" class="aspect-video w-full object-contain" />
                </button>
                <p class="mt-1 truncate px-0.5 text-xs font-semibold text-zinc-200" :title="frame.name">{{ frame.name }}</p>
                <button
                  v-if="store.composition.frameId === frame.id"
                  class="absolute inset-0 flex cursor-pointer items-center justify-center rounded-md bg-black/55 opacity-0 transition-opacity duration-150 group-hover/frame:opacity-100"
                  type="button"
                  :aria-label="t(S('settings.frames.remove'), { name: frame.name })"
                  :title="t(S('settings.frames.remove'), { name: frame.name })"
                  @click.stop="removeUploadedFrame(frame.id)"
                >
                  <Trash2 :size="20" class="text-white drop-shadow" aria-hidden="true" />
                </button>
              </div>
            </div>
          </SettingsAccordion>

          <SettingsAccordion v-show="store.settingsInspector === 'output'" :title="t(S('settings.duration.accordion'))" :open="true">
            <div class="grid grid-cols-2 gap-2">
              <button
                v-for="preset in DURATION_PRESETS"
                :key="preset.seconds"
                class="btn cursor-pointer text-xs"
                :class="store.durationPresetKey === String(preset.seconds) ? 'btn-primary' : 'btn-ghost'"
                type="button"
                @click="store.setDurationPreset(String(preset.seconds), preset.seconds)"
              >
                {{ durationPresetLabel(preset.seconds, preset.label) }}
              </button>
            </div>
            <div class="mt-3 space-y-1">
              <label class="text-xs text-zinc-500">{{ t(S('settings.duration.customMinutes')) }}</label>
              <div class="flex gap-2">
                <input v-model.number="customMinutes" class="field flex-1" type="number" min="5" max="600" step="1" />
                <button class="btn btn-ghost cursor-pointer" type="button" @click="onCustomMinutes">{{ t('common.apply') }}</button>
              </div>
              <p class="text-xs text-zinc-500">{{ t(S('settings.duration.output'), { label: store.durationLabel }) }}</p>
            </div>
          </SettingsAccordion>

          <SettingsAccordion v-show="store.settingsInspector === 'output'" :title="t(S('settings.output.accordion'))" :open="false">
            <label class="text-xs text-zinc-500">{{ t(S('settings.output.resolution')) }}</label>
            <select
              class="field mt-1"
              :value="`${store.outputWidth}x${store.outputHeight}`"
              @change="
                (e) => {
                  const [w, h] = (e.target as HTMLSelectElement).value.split('x').map(Number)
                  store.setResolution(w, h)
                }
              "
            >
              <option v-for="output in SCREENSAVER_OUTPUTS" :key="output.label" :value="`${output.width}x${output.height}`">
                {{ output.label }}
              </option>
            </select>
            <label class="mb-0 block text-xs text-zinc-500">{{ t(S('settings.output.frameRate')) }}</label>
            <select v-model.number="store.fps" class="field mt-1 mb-0">
              <option v-for="rate in fpsOptions" :key="rate" :value="rate">{{ t(S('settings.output.fpsOption'), { fps: rate }) }}</option>
            </select>
            <p class="mt-1 text-xs text-zinc-500">
              {{
                store.effectiveRenderingMode === 'optimized-cfr'
                  ? t(S('settings.output.cfrHint'))
                  : t(S('settings.output.vfrHint'))
              }}
            </p>
            <label class="mt-3 mb-0 block text-xs text-zinc-500">{{ t(S('settings.output.fit')) }}</label>
            <select class="field mt-1" :value="store.fit" @change="store.setFit(($event.target as HTMLSelectElement).value as 'contain' | 'cover' | 'blur')">
              <option value="contain">{{ t(S('settings.output.fitContain')) }}</option>
              <option value="cover">{{ t(S('settings.output.fitCover')) }}</option>
              <option value="blur">{{ t(S('settings.output.fitBlur')) }}</option>
            </select>

            <p class="text-xs text-zinc-500">
              {{ t(S('settings.output.globalHintBefore')) }}
              <button class="cursor-pointer font-semibold text-brand underline-offset-2 hover:underline" type="button" @click="openGlobalOutputSettings">
                {{ t(S('settings.output.globalHintLink')) }}
              </button>{{ t(S('settings.output.globalHintAfter')) }}
            </p>
          </SettingsAccordion>

          <SettingsAccordion v-show="store.settingsInspector === 'output'" :title="t(S('settings.mode.accordion'))" :open="false">
            <div class="space-y-2" role="radiogroup" :aria-label="t(S('settings.mode.groupAria'))">
              <label class="flex cursor-pointer items-center gap-2.5 text-sm">
                <AppRadio v-model="store.mode" name="screensaver-mode" value="static" :aria-label="t(S('settings.mode.staticArt'))" />
                {{ t(S('settings.mode.staticArtLabel')) }}
              </label>
              <label class="flex cursor-pointer items-center gap-2.5 text-sm">
                <AppRadio v-model="store.mode" name="screensaver-mode" value="loop" :aria-label="t(S('settings.mode.loopingVideo'))" />
                {{ t(S('settings.mode.loopingVideoLabel')) }}
              </label>
            </div>
          </SettingsAccordion>

          <SettingsAccordion v-show="store.settingsInspector === 'output'" v-if="store.mode === 'loop'" :title="t(S('settings.loop.accordion'))">
            <div class="space-y-2" role="radiogroup" :aria-label="t(S('settings.loop.groupAria'))">
              <label class="flex cursor-pointer items-center gap-2.5 text-sm">
                <AppRadio v-model="store.loopType" name="screensaver-loop-type" value="hard" :aria-label="t(S('settings.loop.hardAria'))" />
                {{ t(S('settings.loop.hard')) }}
              </label>
              <label class="flex cursor-pointer items-center gap-2.5 text-sm">
                <AppRadio
                  v-model="store.loopType"
                  name="screensaver-loop-type"
                  value="smooth"
                  :aria-label="t(S('settings.loop.smoothAria'))"
                />
                {{ t(S('settings.loop.smooth')) }}
              </label>
            </div>
            <SliderField
              v-if="store.loopType === 'smooth'"
              class="mt-3"
              :label="t(S('settings.loop.crossfade'))"
              :min="0.25"
              :max="5"
              :step="0.25"
              :model-value="store.crossfadeSeconds"
              @update:model-value="(v) => (store.crossfadeSeconds = v)"
            />
          </SettingsAccordion>

          <SettingsAccordion v-show="store.settingsInspector === 'sound'" :title="t(S('settings.audio.accordion'))" :open="true">
            <select v-model="store.audioMode" class="field">
              <option value="none">{{ t(S('settings.audio.none')) }}</option>
              <option value="source" :disabled="!store.hasAudio">{{ t(S('settings.audio.source')) }}</option>
              <option value="upload">{{ t(S('settings.audio.upload')) }}</option>
            </select>
            <AudioFileField
              v-if="store.audioMode === 'upload'"
              class="mt-3"
              :hide-status="!store.showAudioStatusBox"
              :file-name="store.audioFileName"
              :file-size="store.audioFileSize"
              :preview-url="store.audioUrl"
              :status="store.audioAvailability"
              :progress="store.audioUploadProgress"
              :error="store.audioError"
              accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
              formats="MP3, WAV, FLAC, M4A, AAC, OGG"
              :label="t(S('settings.audio.dropAudio'))"
              :drop-label="t(S('settings.audio.dropToUpload'))"
              :replace-label="t(S('settings.audio.dropNewAudio'))"
              :replace-drop-label="t(S('settings.audio.dropToReplace'))"
              :background-audio-label="t(S('settings.audio.upload'))"
              :remove-audio-label="t(S('settings.audio.removeAudio'))"
              @files="onAudioFiles"
              @clear="store.clearAudio()"
            />
            <AdvancedAudioControls
              v-if="store.audioMode !== 'none'"
              class="mt-3"
              v-model:volume="store.audioVolume"
              v-model:fade-in="store.audioFadeIn"
              v-model:fade-out="store.audioFadeOut"
              v-model:loop="store.loopAudio"
              volume-as-percent
              :volume-label="t(S('settings.audio.volume'))"
              :fade-in-label="t(S('settings.audio.fadeIn'))"
              :fade-out-label="t(S('settings.audio.fadeOut'))"
              :loop-label="t(S('settings.audio.loopBackground'))"
            />
          </SettingsAccordion>

          <SettingsAccordion v-show="store.settingsInspector === 'style'" :title="t(S('settings.adjustments.accordion'))">
            <div
              @pointerdown="store.setPreviewInteracting(true)"
              @pointerup="store.setPreviewInteracting(false)"
              @pointerleave="store.setPreviewInteracting(false)"
              @pointercancel="store.setPreviewInteracting(false)"
            >
            <div class="mb-2 flex gap-2">
              <button
                class="btn btn-ghost cursor-pointer px-2 py-1"
                type="button"
                :aria-label="t(S('settings.adjustments.resetAllAria'))"
                :title="t(S('settings.adjustments.resetAll'))"
                @click="store.resetAdjustments()"
              >
                <RotateCcw :size="16" />
              </button>
              <button
                class="btn cursor-pointer px-2 py-1"
                :class="store.compareAdjustments ? 'btn-primary' : 'btn-ghost'"
                type="button"
                :aria-label="store.compareAdjustments ? t(S('settings.adjustments.showingOriginalAria')) : t(S('settings.adjustments.beforeAfterAria'))"
                :title="store.compareAdjustments ? t(S('settings.adjustments.showingOriginal')) : t(S('settings.adjustments.beforeAfter'))"
                @click="store.compareAdjustments = !store.compareAdjustments"
              >
                <Eye v-if="store.compareAdjustments" :size="16" />
                <SquareSplitHorizontal v-else :size="16" />
              </button>
            </div>
            <div v-for="field in ADJUSTMENT_FIELDS" :key="field.key" class="flex items-center gap-2">
              <SliderField
                class="flex-1"
                :label="adjustmentLabel(field.key)"
                :min="field.min"
                :max="field.max"
                :step="1"
                :model-value="store.composition.adjustments[field.key]"
                @update:model-value="(value) => (store.composition.adjustments[field.key] = value)"
                @change="store.commitComposition()"
              />
              <button
                class="btn btn-ghost mt-4 shrink-0 cursor-pointer px-2 py-1"
                type="button"
                :aria-label="t(S('settings.adjustments.resetField'), { label: adjustmentLabel(field.key) })"
                :title="t(S('settings.adjustments.resetField'), { label: adjustmentLabel(field.key) })"
                @click="resetOne(field.key)"
              >
                <RotateCcw :size="16" />
              </button>
            </div>
            </div>
          </SettingsAccordion>

          <SettingsAccordion v-show="store.settingsInspector === 'style'" :title="t(S('settings.background.accordion'))">
            <select v-model="store.composition.background.mode" class="field" @change="store.commitComposition()">
              <option value="color">{{ t(S('settings.background.color')) }}</option>
              <option value="black">{{ t(S('settings.background.black')) }}</option>
              <option value="white">{{ t(S('settings.background.white')) }}</option>
              <option value="blur">{{ t(S('settings.background.blur')) }}</option>
              <option value="transparent">{{ t(S('settings.background.transparent')) }}</option>
            </select>
            <label v-if="store.composition.background.mode === 'color' || store.composition.background.mode === 'transparent'" class="mt-2 block text-xs text-zinc-500">
              {{ t(S('settings.background.colorLabel')) }}
              <input v-model="store.composition.background.color" class="mt-1" type="color" @change="store.backgroundColor = store.composition.background.color; store.commitComposition()" />
            </label>
            <SliderField
              v-if="store.composition.background.mode === 'blur'"
              class="mt-2"
              :label="t(S('settings.background.blurStrength'))"
              :min="0"
              :max="100"
              :step="1"
              :model-value="store.composition.background.blur"
              @update:model-value="(value) => (store.composition.background.blur = value)"
              @change="store.commitComposition()"
            />
            <p class="mt-2 text-xs text-zinc-500">{{ t(S('settings.background.mp4Hint')) }}</p>
          </SettingsAccordion>

          <SettingsAccordion v-show="store.settingsInspector === 'style'" :title="t(S('settings.transform.accordion'))">
            <div class="grid grid-cols-2 gap-2">
              <label class="text-xs text-zinc-500">{{ t(S('settings.transform.x')) }}<input class="field mt-1" type="number" :value="Math.round(store.composition.x * store.outputWidth)" @change="setPixel('x', $event)" /></label>
              <label class="text-xs text-zinc-500">{{ t(S('settings.transform.y')) }}<input class="field mt-1" type="number" :value="Math.round(store.composition.y * store.outputHeight)" @change="setPixel('y', $event)" /></label>
              <label class="text-xs text-zinc-500">{{ t(S('settings.transform.width')) }}<input class="field mt-1" type="number" min="2" :value="Math.round(store.composition.width * store.outputWidth)" @change="setPixel('width', $event)" /></label>
              <label class="text-xs text-zinc-500">{{ t(S('settings.transform.height')) }}<input class="field mt-1" type="number" min="2" :value="Math.round(store.composition.height * store.outputHeight)" @change="setPixel('height', $event)" /></label>
              <label class="text-xs text-zinc-500">{{ t(S('settings.transform.rotation')) }}<input class="field mt-1" type="number" min="-180" max="180" step="0.1" :value="store.composition.rotation" @change="setNumber('rotation', $event)" /></label>
              <label class="text-xs text-zinc-500">{{ t(S('settings.transform.opacity')) }}<input class="field mt-1" type="number" min="0" max="100" :value="Math.round(store.composition.opacity * 100)" @change="setOpacity($event)" /></label>
            </div>
            <div class="mt-2 grid grid-cols-2 gap-2">
              <button class="btn cursor-pointer" :class="store.composition.flipH ? 'btn-primary' : 'btn-ghost'" type="button" @click="toggleFlip('flipH')">{{ t(S('settings.transform.flipH')) }}</button>
              <button class="btn cursor-pointer" :class="store.composition.flipV ? 'btn-primary' : 'btn-ghost'" type="button" @click="toggleFlip('flipV')">{{ t(S('settings.transform.flipV')) }}</button>
            </div>
          </SettingsAccordion>

          <p class="px-4 pb-4 mt-3 text-xs text-zinc-500">
            {{ t(S('settings.sizeEstimate'), { gb: (store.sizeEstimate / (1024 * 1024 * 1024)).toFixed(2) }) }}
          </p>
        </div>
      </Transition>
    </div>
  </div>
</template>
