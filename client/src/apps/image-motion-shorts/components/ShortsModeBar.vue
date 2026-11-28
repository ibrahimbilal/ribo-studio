<script setup lang="ts">
import { ImagePlay, ListVideo } from '@lucide/vue'
import { computed } from 'vue'
import { useI18n } from '../../../i18n'
import type { ShortsEditorMode } from '../lib/shortsMode'

const { variant = 'responsive', railFrom = 'xl' } = defineProps<{
  variant?: 'rail' | 'bar' | 'responsive'
  railFrom?: 'lg' | 'xl'
}>()

const model = defineModel<ShortsEditorMode>({ required: true })
const { t } = useI18n()

const railVisibilityClass = railFrom === 'xl' ? 'hidden xl:flex' : 'hidden lg:flex'
const barHideClass = railFrom === 'xl' ? 'xl:hidden' : 'lg:hidden'

const showRail = variant === 'rail' || variant === 'responsive'
const showBar = variant === 'bar' || variant === 'responsive'

const items = computed(() => [
  { id: 'ranking' as const, label: t('imageMotion.shortsMode.ranking'), icon: ListVideo },
  { id: 'image-motion' as const, label: t('imageMotion.shortsMode.imageMotion'), icon: ImagePlay },
])

const tooltipClass =
  'pointer-events-none absolute end-[calc(100%+0.5rem)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-zinc-950 px-2.5 py-1.5 text-xs font-semibold text-zinc-100 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100'
</script>

<template>
  <nav
    v-if="showRail"
    class="flex shrink-0 flex-col gap-1 overflow-visible px-2 py-2"
    :class="variant === 'rail' ? 'flex' : railVisibilityClass"
    role="tablist"
    :aria-label="t('imageMotion.shortsMode.ariaLabel')"
    aria-orientation="vertical"
  >
    <button
      v-for="item in items"
      :key="`rail-${item.id}`"
      class="settings-tab group relative focus-ring flex items-center justify-center rounded-xl px-1 py-2.5"
      :class="
        model === item.id
          ? 'settings-tab--active nav-link--active bg-brand text-white'
          : 'cursor-pointer text-zinc-500 hover:bg-white/5 hover:text-zinc-100'
      "
      type="button"
      role="tab"
      :aria-selected="model === item.id"
      :aria-label="item.label"
      @click="model = item.id"
    >
      <component :is="item.icon" class="shrink-0" :size="18" />
      <span :class="tooltipClass" role="tooltip">
        {{ item.label }}
      </span>
    </button>
  </nav>

  <div
    v-if="showBar"
    class="settings-tabs grid grid-cols-2 gap-1 px-3 py-3"
    :class="variant === 'bar' ? barHideClass : variant === 'responsive' ? barHideClass : ''"
    role="tablist"
    :aria-label="t('imageMotion.shortsMode.ariaLabel')"
  >
    <button
      v-for="item in items"
      :key="`bar-${item.id}`"
      class="settings-tab btn cursor-pointer px-1 text-xs"
      :class="model === item.id ? 'btn-primary settings-tab--active' : 'btn-ghost'"
      type="button"
      role="tab"
      :aria-selected="model === item.id"
      @click="model = item.id"
    >
      {{ item.label }}
    </button>
  </div>
</template>