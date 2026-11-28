<script setup lang="ts">
import {
  DEFAULT_UPSCALE_LIMITS,
  resolveEffectiveScale,
  resolveExportDimensions,
  resolveIntermediateDimensions,
  type ScaleFactor,
} from '@shared/imageUpscaler'
import { ArrowRight } from '@lucide/vue'
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
const aiUnavailableReason = computed(() => ai.value?.reason ?? t('upscaler.settings.aiLiteUnavailable'))

const resultDimensions = computed(() => {
  const item = store.selected
  if (!item || item.width < 1 || item.height < 1) return null
  const { effectiveScale } = resolveEffectiveScale(
    store.settings,
    item.width,
    item.height,
    DEFAULT_UPSCALE_LIMITS,
  )
  const intermediate = resolveIntermediateDimensions(item.width, item.height, effectiveScale)
  const { width, height } = resolveExportDimensions(
    item.width,
    item.height,
    intermediate.width,
    intermediate.height,
    store.settings,
  )
  const isAuto = store.settings.scaleFactor === 'auto'
  return {
    source: `${item.width}×${item.height}`,
    output: `${width}×${height}`,
    scaleLabel: isAuto
      ? t('upscaler.settings.factorResultScaleAuto', { scale: effectiveScale })
      : t('upscaler.settings.factorResultScale', { scale: effectiveScale }),
  }
})
</script>

<template>
  <div class="space-y-5 mb-6">
    <div>
      <h2 class="section-label">{{ t('upscaler.settings.upscaling') }}</h2>
      <p v-if="store.settings.engine === 'lanczos3'" class="mt-2 text-xs leading-relaxed text-zinc-500">
        {{ t('upscaler.settings.standardHint') }}
      </p>
      <template v-else-if="store.settings.engine === 'realesrgan-lite'">
        <p class="mt-2 text-xs leading-relaxed text-zinc-500">{{ t('upscaler.settings.aiLiteHint') }}</p>
        <p v-if="!store.capabilities" class="mt-2 text-xs text-zinc-500">{{ t('upscaler.settings.checkingAiLite') }}</p>
        <p v-else-if="!aiReady" class="mt-2 text-xs leading-relaxed text-amber-200">{{ aiUnavailableReason }}</p>
        <p v-else-if="ai?.matchesUpscaylLite" class="mt-2 text-xs leading-relaxed text-zinc-400">
          {{ t('upscaler.settings.aiLiteUpscaylMatch', { model: ai?.model ?? '', scale: ai?.scale ?? '' }) }}
        </p>
        <p v-else class="mt-2 text-xs leading-relaxed text-amber-200">
          {{ t('upscaler.settings.aiLiteUpscaylMismatch', { model: ai?.model ?? '' }) }}
        </p>
      </template>
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
      <div
        v-if="resultDimensions"
        class="mt-3 rounded-lg border border-zinc-800 bg-inset p-3"
        aria-live="polite"
      >
        <p class="text-xs font-medium text-zinc-400 mb-2">{{ t('upscaler.settings.factorResultLabel') }}
          <span class="inline-flex rounded-md bg-brand/15 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-brand">
            {{ resultDimensions.scaleLabel }}
          </span>
        </p>
        <div class="flex items-center gap-2">
          <span class="min-w-0 flex-1 truncate text-xs tabular-nums text-zinc-500">{{ resultDimensions.source }}</span>
          <ArrowRight class="shrink-0 text-zinc-600" :size="14" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate text-end text-sm font-semibold tabular-nums text-zinc-100">
            {{ resultDimensions.output }}
          </span>
        </div>
      </div>
      <p
        v-else
        class="mt-3 rounded-lg border border-dashed border-zinc-800 bg-inset/50 px-3 py-2.5 text-center text-xs leading-relaxed text-zinc-500"
      >
        {{ t('upscaler.settings.factorResultPickImage') }}
      </p>
      <p class="mt-2 text-xs text-zinc-500">{{ t('upscaler.settings.factorAutoHint') }}</p>
    </div>
  </div>
</template>
