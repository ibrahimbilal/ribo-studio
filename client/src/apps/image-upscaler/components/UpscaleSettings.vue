<script setup lang="ts">
import { type ScaleFactor, type UpscaleEngineId } from '@shared/imageUpscaler'
import { computed } from 'vue'
import { useI18n } from '../../../i18n'
import { useImageUpscalerStore } from '../stores/imageUpscaler'

const store = useImageUpscalerStore()
const { t } = useI18n()
const scaleChoices = computed((): Array<{ id: ScaleFactor; label: string }> => [
  { id: 'auto', label: t('upscaler.settings.scaleAuto') },
  { id: 1, label: '1×' },
  { id: 2, label: '2×' },
  { id: 3, label: '3×' },
  { id: 4, label: '4×' },
])
const ai = computed(() => store.capabilities?.engines['realesrgan-lite'] ?? null)
const aiReady = computed(() => ai.value?.available === true)
const engines = computed((): Array<{ id: UpscaleEngineId; label: string }> => [
  { id: 'lanczos3', label: t('upscaler.settings.engineStandard') },
  { id: 'realesrgan-lite', label: t('upscaler.settings.engineAiLite') },
])
const aiUnavailableReason = computed(() => ai.value?.reason ?? t('upscaler.settings.aiLiteUnavailable'))
</script>

<template>
  <div class="space-y-5 mb-6">
    <div>
      <h2 class="section-label">{{ t('upscaler.settings.upscaling') }}</h2>
      <p class="mt-2 text-xs font-medium text-zinc-400">{{ t('upscaler.settings.engine') }}</p>
      <div class="mt-2 grid grid-cols-2 gap-2">
        <button
          v-for="engine in engines"
          :key="engine.id"
          class="btn cursor-pointer"
          :class="store.settings.engine === engine.id ? 'btn-primary' : 'btn-ghost'"
          type="button"
          :disabled="engine.id === 'realesrgan-lite' && !aiReady"
          :title="engine.id === 'realesrgan-lite' && !aiReady ? aiUnavailableReason : engine.label"
          @click="store.setEngine(engine.id)"
        >
          {{ engine.label }}
        </button>
      </div>
      <p class="mt-3 text-xs leading-relaxed text-zinc-500">{{ t('upscaler.settings.standardHint') }}</p>
      <p class="mt-2 text-xs leading-relaxed text-zinc-500">{{ t('upscaler.settings.aiLiteHint') }}</p>
      <p v-if="!store.capabilities" class="mt-2 text-xs text-zinc-500">{{ t('upscaler.settings.checkingAiLite') }}</p>
      <p v-else-if="!aiReady" class="mt-2 text-xs leading-relaxed text-amber-200">{{ aiUnavailableReason }}</p>
      <p v-else-if="store.settings.engine === 'realesrgan-lite' && ai?.matchesUpscaylLite" class="mt-2 text-xs leading-relaxed text-zinc-400">
        {{ t('upscaler.settings.aiLiteUpscaylMatch', { model: ai?.model ?? '', scale: ai?.scale ?? '' }) }}
      </p>
      <p v-else-if="store.settings.engine === 'realesrgan-lite'" class="mt-2 text-xs leading-relaxed text-amber-200">
        {{ t('upscaler.settings.aiLiteUpscaylMismatch', { model: ai?.model ?? '' }) }}
      </p>
    </div>

    <div>
      <p class="text-xs font-medium text-zinc-400">{{ t('upscaler.settings.factor') }}</p>
      <p class="mt-1 text-xs text-zinc-500">{{ t('upscaler.settings.factorHint') }}</p>
      <div class="mt-3 grid grid-cols-5 gap-2">
        <button
          v-for="scale in scaleChoices"
          :key="String(scale.id)"
          class="btn cursor-pointer px-2 text-xs"
          :class="store.settings.scaleFactor === scale.id ? 'btn-primary' : 'btn-ghost'"
          type="button"
          @click="store.settings.scaleFactor = scale.id"
        >
          {{ scale.label }}
        </button>
      </div>
      <p class="mt-3 text-xs text-zinc-500">{{ t('upscaler.settings.factorAutoHint') }}</p>
    </div>
  </div>
</template>
