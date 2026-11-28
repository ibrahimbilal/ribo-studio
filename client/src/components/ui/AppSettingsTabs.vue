<script setup lang="ts" generic="T extends string">
import type { Component } from 'vue'

export interface SettingsTabItem<Id extends string = string> {
  id: Id
  label: string
  icon: Component
}

const { variant = 'responsive', railFrom = 'lg', embedded = false } = defineProps<{
  items: SettingsTabItem<T>[]
  variant?: 'rail' | 'bar' | 'responsive'
  /** Minimum viewport width before the outside rail is shown (mobile uses the bar). */
  railFrom?: 'lg' | 'xl'
  /** Nest rail inside a parent chrome column (no outer border / full-height shell). */
  embedded?: boolean
}>()

const railVisibilityClass = railFrom === 'xl' ? 'hidden xl:flex' : 'hidden lg:flex'
const barHideClass = railFrom === 'xl' ? 'xl:hidden' : 'lg:hidden'

const model = defineModel<T>({ required: true })

const showRail = variant === 'rail' || variant === 'responsive'
const showBar = variant === 'bar' || variant === 'responsive'

const tooltipClass =
  'pointer-events-none absolute end-[calc(100%+0.5rem)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-zinc-950 px-2.5 py-1.5 text-xs font-semibold text-zinc-100 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100'
</script>

<template>
  <nav
    v-if="showRail"
    class="settings-tabs-rail relative z-30 flex-col overflow-visible"
    :class="
      embedded
        ? 'flex min-h-0 flex-1'
        : [railVisibilityClass, 'h-full w-16 shrink-0 border-s border-white/5 studio-shell']
    "
    role="tablist"
    aria-orientation="vertical"
  >
    <div class="flex flex-1 flex-col gap-1 overflow-y-clip overflow-x-visible px-2 py-2">
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
    </div>
  </nav>

  <nav
    v-if="showBar"
    class="settings-tabs grid gap-1 border-b border-zinc-800 px-3 py-3"
    :class="[items.length >= 4 ? 'grid-cols-4' : 'grid-cols-3', variant === 'bar' ? barHideClass : variant === 'responsive' ? barHideClass : '']"
    role="tablist"
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
  </nav>
</template>