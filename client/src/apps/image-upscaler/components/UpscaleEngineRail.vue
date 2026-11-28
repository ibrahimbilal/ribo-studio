<script setup lang="ts">
import { ImageUpscale, CpuAi } from '@lucide/vue'
import type { UpscaleEngineId } from '@shared/imageUpscaler'
import { computed } from 'vue'
import { useI18n } from '../../../i18n'
import { useImageUpscalerStore } from '../stores/imageUpscaler'

const { variant = 'responsive', railFrom = 'lg' } = defineProps<{
  variant?: 'rail' | 'bar' | 'responsive'
  railFrom?: 'lg' | 'xl'
}>()

const store = useImageUpscalerStore()
const { t } = useI18n()

const railVisibilityClass = railFrom === 'xl' ? 'hidden xl:flex' : 'hidden lg:flex'
const barHideClass = railFrom === 'xl' ? 'xl:hidden' : 'lg:hidden'

const showRail = variant === 'rail' || variant === 'responsive'
const showBar = variant === 'bar' || variant === 'responsive'

const ai = computed(() => store.capabilities?.engines['realesrgan-lite'] ?? null)
const aiReady = computed(() => ai.value?.available === true)
const aiUnavailableReason = computed(() => ai.value?.reason ?? t('upscaler.settings.aiLiteUnavailable'))

const engines = computed(() => [
  { id: 'lanczos3' as const, label: t('upscaler.settings.engineStandard'), icon: ImageUpscale },
  { id: 'realesrgan-lite' as const, label: t('upscaler.settings.engineAiLite'), icon: CpuAi },
])

const tooltipClass =
  'pointer-events-none absolute end-[calc(100%+0.5rem)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-zinc-950 px-2.5 py-1.5 text-xs font-semibold text-zinc-100 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100'

function engineDisabled(id: UpscaleEngineId): boolean {
  return id === 'realesrgan-lite' && !aiReady.value
}

function tooltipFor(id: UpscaleEngineId, label: string): string {
  if (engineDisabled(id)) return aiUnavailableReason.value
  return label
}

function selectEngine(id: UpscaleEngineId): void {
  if (engineDisabled(id)) return
  store.setEngine(id)
}
</script>

<template>
  <nav
    v-if="showRail"
    class="flex shrink-0 flex-col gap-1 overflow-visible px-2 py-2"
    :class="variant === 'rail' ? 'flex' : railVisibilityClass"
    role="radiogroup"
    :aria-label="t('upscaler.settings.engine')"
  >
    <button
      v-for="engine in engines"
      :key="`rail-${engine.id}`"
      class="settings-tab group relative focus-ring flex items-center justify-center rounded-xl px-1 py-2.5"
      :class="[
        store.settings.engine === engine.id
          ? 'settings-tab--active nav-link--active bg-brand text-white'
          : 'cursor-pointer text-zinc-500 hover:bg-white/5 hover:text-zinc-100',
        engineDisabled(engine.id) ? 'cursor-not-allowed opacity-40' : '',
      ]"
      type="button"
      role="radio"
      :aria-checked="store.settings.engine === engine.id"
      :aria-disabled="engineDisabled(engine.id)"
      :aria-label="tooltipFor(engine.id, engine.label)"
      @click="selectEngine(engine.id)"
    >
      <component :is="engine.icon" class="shrink-0" :size="18" />
      <span :class="tooltipClass" role="tooltip">
        {{ tooltipFor(engine.id, engine.label) }}
      </span>
    </button>
  </nav>

  <div
    v-if="showBar"
    class="settings-tabs grid grid-cols-2 gap-1 border-b border-zinc-800 px-3 py-3"
    :class="variant === 'bar' ? barHideClass : variant === 'responsive' ? barHideClass : ''"
    role="radiogroup"
    :aria-label="t('upscaler.settings.engine')"
  >
    <button
      v-for="engine in engines"
      :key="`bar-${engine.id}`"
      class="settings-tab btn cursor-pointer px-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
      :class="store.settings.engine === engine.id ? 'btn-primary settings-tab--active' : 'btn-ghost'"
      type="button"
      role="radio"
      :aria-checked="store.settings.engine === engine.id"
      :disabled="engineDisabled(engine.id)"
      :title="tooltipFor(engine.id, engine.label)"
      @click="selectEngine(engine.id)"
    >
      {{ engine.label }}
    </button>
  </div>
</template>