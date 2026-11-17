<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../i18n'
import SliderField from '../SliderField.vue'
import ToggleSwitch from '../ToggleSwitch.vue'

const props = withDefaults(
  defineProps<{
    volumeLabel?: string
    volumeAsPercent?: boolean
    showLoop?: boolean
    showFades?: boolean
    loopLabel?: string
    fadeInLabel?: string
    fadeOutLabel?: string
  }>(),
  {
    volumeAsPercent: true,
    showLoop: true,
    showFades: true,
  },
)

const { t } = useI18n()

const volume = defineModel<number>('volume', { required: true })
const fadeIn = defineModel<number>('fadeIn')
const fadeOut = defineModel<number>('fadeOut')
const loop = defineModel<boolean>('loop')

const resolvedVolumeLabel = computed(() => props.volumeLabel ?? t('common.audio.volume'))
const resolvedLoopLabel = computed(() => props.loopLabel ?? t('common.audio.loopAudio'))
const resolvedFadeInLabel = computed(() => props.fadeInLabel ?? t('common.audio.fadeIn'))
const resolvedFadeOutLabel = computed(() => props.fadeOutLabel ?? t('common.audio.fadeOut'))

const volumeUi = computed({
  get: () => (props.volumeAsPercent ? Math.round(volume.value * 100) : volume.value),
  set: (value: number) => {
    volume.value = props.volumeAsPercent ? value / 100 : value
  },
})
</script>

<template>
  <div class="space-y-3">
    <SliderField
      :model-value="volumeUi"
      :label="resolvedVolumeLabel"
      :min="0"
      :max="volumeAsPercent ? 100 : 1"
      :step="volumeAsPercent ? 1 : 0.05"
      :suffix="volumeAsPercent ? '%' : undefined"
      @update:model-value="(v) => (volumeUi = v)"
    />
    <div v-if="showLoop && loop !== undefined" class="flex items-center justify-between gap-3 text-sm">
      <span>{{ resolvedLoopLabel }}</span>
      <ToggleSwitch v-model="loop" :aria-label="resolvedLoopLabel" />
    </div>
    <SliderField
      v-if="showFades && fadeIn !== undefined"
      :model-value="fadeIn"
      :label="resolvedFadeInLabel"
      :min="0"
      :max="30"
      :step="0.5"
      @update:model-value="(v) => (fadeIn = v)"
    />
    <SliderField
      v-if="showFades && fadeOut !== undefined"
      :model-value="fadeOut"
      :label="resolvedFadeOutLabel"
      :min="0"
      :max="30"
      :step="0.5"
      @update:model-value="(v) => (fadeOut = v)"
    />
  </div>
</template>