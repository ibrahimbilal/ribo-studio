<script setup lang="ts">
import type { Component } from 'vue'
import { computed } from 'vue'
import { OUTPUTS, FRAME_RATES } from '@shared/frame'
import type { MotionEasing } from '@shared/imageMotion'
import AdvancedAudioControls from '../../../components/audio/AdvancedAudioControls.vue'
import AudioFileField from '../../../components/audio/AudioFileField.vue'
import SettingsAccordion from '../../../components/SettingsAccordion.vue'
import SliderField from '../../../components/SliderField.vue'
import AppSettingsTabs from '../../../components/ui/AppSettingsTabs.vue'
import { useGlobalSettingsStore } from '../../../stores/globalSettings'
import { useI18n } from '../../../i18n'
import { useImageMotionStore } from '../stores/imageMotion'

type ImageMotionInspectorTab = 'motion' | 'output' | 'sound'

const store = useImageMotionStore()
const globalSettings = useGlobalSettingsStore()
const { t } = useI18n()
const tab = defineModel<ImageMotionInspectorTab>({ required: true })

defineProps<{
  inspectorTabs: Array<{ id: ImageMotionInspectorTab; label: string; icon: Component }>
}>()

const selectedSegment = computed(() => store.selectedSegment)
const motion = computed(() => selectedSegment.value?.motion)
const slowMode = computed(() => motion.value?.mode === 'slow')

const zoom = computed({
  get: () => motion.value?.zoom ?? 1,
  set: (value: number) => store.patchSelectedMotion({ zoom: value }),
})
const travel = computed({
  get: () => Math.round((motion.value?.travelDistance ?? 0.3) * 100),
  set: (value: number) => store.patchSelectedMotion({ travelDistance: value / 100 }),
})
const start = computed({
  get: () => Math.round((motion.value?.startPosition ?? 0) * 100),
  set: (value: number) => store.patchSelectedMotion({ startPosition: value / 100 }),
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="shrink-0 border-b border-zinc-800 px-4 pb-0 pt-4 xl:border-b-0 xl:pb-3">
      <h2 class="text-sm font-bold text-zinc-100">{{ t('imageMotion.settings.title') }}</h2>
      <AppSettingsTabs v-model="tab" :items="inspectorTabs" variant="bar" />
    </div>
    <div class="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <Transition name="settings-pane" mode="out-in">
        <div :key="tab">
          <div v-if="tab === 'motion' && !selectedSegment" class="px-4 py-8 text-center text-sm text-zinc-500">
            {{ t('imageMotion.settings.selectImageHint') }}
          </div>
          <template v-else-if="tab === 'motion' && motion">
            <SettingsAccordion :title="t('imageMotion.settings.motion')" open>
              <div class="space-y-3">
                <label class="block">
                  <span class="section-label mb-1 block">{{ t('imageMotion.settings.mode') }}</span>
                  <select
                    class="field w-full"
                    :value="motion.mode"
                    @change="store.patchSelectedMotion({ mode: ($event.target as HTMLSelectElement).value as 'full' | 'slow' })"
                  >
                    <option value="full">{{ t('imageMotion.settings.modeFull') }}</option>
                    <option value="slow">{{ t('imageMotion.settings.modeSlow') }}</option>
                  </select>
                </label>
                <label class="block">
                  <span class="section-label mb-1 block">{{ t('imageMotion.settings.direction') }}</span>
                  <select
                    class="field w-full"
                    :value="motion.direction"
                    @change="store.patchSelectedMotion({ direction: ($event.target as HTMLSelectElement).value as 'rtl' | 'ltr' })"
                  >
                    <option value="rtl">{{ t('imageMotion.settings.directionRtl') }}</option>
                    <option value="ltr">{{ t('imageMotion.settings.directionLtr') }}</option>
                  </select>
                </label>
                <label class="block">
                  <span class="section-label mb-1 block">{{ t('imageMotion.settings.easing') }}</span>
                  <select
                    class="field w-full"
                    :value="motion.easing"
                    @change="store.patchSelectedMotion({ easing: ($event.target as HTMLSelectElement).value as MotionEasing })"
                  >
                    <option value="linear">{{ t('imageMotion.settings.easingLinear') }}</option>
                    <option value="easeInOut">{{ t('imageMotion.settings.easingEaseInOut') }}</option>
                    <option value="easeIn">{{ t('imageMotion.settings.easingEaseIn') }}</option>
                    <option value="easeOut">{{ t('imageMotion.settings.easingEaseOut') }}</option>
                  </select>
                </label>
                <SliderField v-model="zoom" :label="t('imageMotion.settings.zoom')" :min="1" :max="2" :step="0.05" suffix="×" />
                <template v-if="slowMode">
                  <SliderField v-model="travel" :label="t('imageMotion.settings.travelDistance')" :min="5" :max="100" suffix="%" />
                  <SliderField v-model="start" :label="t('imageMotion.settings.startPosition')" :min="0" :max="100" suffix="%" />
                </template>
                <button type="button" class="btn btn-ghost w-full cursor-pointer" @click="store.resetMotionDefaults()">{{ t('imageMotion.settings.resetDefaults') }}</button>
              </div>
            </SettingsAccordion>
            <SettingsAccordion :title="t('imageMotion.settings.transitionNext')" open>
              <div class="space-y-3">
                <label class="block">
                  <span class="section-label mb-1 block">{{ t('imageMotion.settings.type') }}</span>
                  <select
                    class="field w-full"
                    :value="selectedSegment!.transitionAfter.type"
                    @change="store.patchSelectedTransition({ type: ($event.target as HTMLSelectElement).value as 'cut' | 'fade' })"
                  >
                    <option value="cut">{{ t('imageMotion.settings.transitionCut') }}</option>
                    <option value="fade">{{ t('imageMotion.settings.transitionFade') }}</option>
                  </select>
                </label>
                <label v-if="selectedSegment!.transitionAfter.type === 'fade'" class="block">
                  <span class="section-label mb-1 block">{{ t('imageMotion.settings.crossfade') }}</span>
                  <input
                    class="field w-full"
                    type="number"
                    min="0.1"
                    max="3"
                    step="0.1"
                    :value="selectedSegment!.transitionAfter.fadeDuration"
                    @change="store.patchSelectedTransition({ fadeDuration: Number(($event.target as HTMLInputElement).value) })"
                  />
                </label>
              </div>
            </SettingsAccordion>
          </template>

          <SettingsAccordion v-else-if="tab === 'output'" :title="t('imageMotion.settings.video')" open>
            <div class="space-y-3">
              <label class="block">
                <span class="section-label mb-1 block">{{ t('imageMotion.settings.resolution') }}</span>
                <select
                  class="field w-full"
                  :value="`${store.video.width}x${store.video.height}`"
                  @change="(e) => {
                    const [w, h] = (e.target as HTMLSelectElement).value.split('x').map(Number)
                    store.setResolution(w!, h!)
                  }"
                >
                  <option v-for="out in OUTPUTS" :key="out.label" :value="`${out.width}x${out.height}`">{{ out.label }}</option>
                </select>
              </label>
              <label class="block">
                <span class="section-label mb-1 block">{{ t('imageMotion.settings.frameRate') }}</span>
                <select class="field w-full" :value="store.video.fps" @change="store.setFps(Number(($event.target as HTMLSelectElement).value))">
                  <option v-for="fps in FRAME_RATES" :key="fps" :value="fps">{{ t('imageMotion.settings.fpsSuffix', { fps }) }}</option>
                </select>
              </label>
            </div>
          </SettingsAccordion>

          <SettingsAccordion v-else :title="t('imageMotion.settings.backgroundMusic')" open>
            <div class="space-y-3">
              <AudioFileField
                :file-name="store.musicName"
                :file-size="store.musicFileSize"
                :preview-url="store.musicUrl"
                :label="t('imageMotion.settings.dropAudio')"
                :drop-label="t('common.dropHere')"
                :replace-label="t('ranking.style.dropNewAudio')"
                :replace-drop-label="t('ranking.style.dropToReplaceAudio')"
                :background-audio-label="t('ranking.style.backgroundAudioName')"
                :remove-audio-label="t('ranking.style.removeAudio')"
                @files="(files) => void store.setMusic(files[0] ?? null)"
                @clear="void store.setMusic(null)"
              />
              <AdvancedAudioControls
                v-model:volume="store.audio.musicVolume"
                v-model:fade-in="store.audio.musicFadeIn"
                v-model:fade-out="store.audio.musicFadeOut"
                v-model:loop="store.audio.loopMusic"
                :volume-label="t('imageMotion.settings.volume')"
                :loop-label="t('imageMotion.settings.loopAudio')"
                :fade-in-label="t('imageMotion.settings.fadeIn')"
                :fade-out-label="t('imageMotion.settings.fadeOut')"
              />
            </div>
          </SettingsAccordion>
        </div>
      </Transition>
    </div>
  </div>
</template>
