<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../i18n'
import SliderField from '../SliderField.vue'
import ToggleSwitch from '../ToggleSwitch.vue'

const { t } = useI18n()

const keepAudio = defineModel<boolean>('keepAudio', { required: true })
const normalize = defineModel<boolean>('normalize', { required: true })
const originalVolume = defineModel<number>('originalVolume', { required: true })

const clipVolumeUi = computed({
  get: () => Math.round(originalVolume.value * 100),
  set: (value: number) => {
    originalVolume.value = value / 100
  },
})
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between text-xs text-zinc-300">
      <span>{{ t('ranking.style.keepOriginalAudio') }}</span>
      <ToggleSwitch v-model="keepAudio" :aria-label="t('ranking.style.keepOriginalAudio')" />
    </div>
    <div v-if="keepAudio" class="flex items-center justify-between text-xs text-zinc-300">
      <span>{{ t('ranking.style.normalizeAudio') }}</span>
      <ToggleSwitch v-model="normalize" :aria-label="t('ranking.style.normalizeAudio')" />
    </div>
    <SliderField
      v-if="keepAudio"
      :model-value="clipVolumeUi"
      :label="t('ranking.style.clipVolume')"
      :min="0"
      :max="100"
      suffix="%"
      @update:model-value="(v) => (clipVolumeUi = v)"
    />
  </div>
</template>