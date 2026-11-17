<script setup lang="ts">
import { Settings } from '@lucide/vue'
import { RouterLink, useRoute } from 'vue-router'
import { navItems } from '../../app/navigation'
import { useGlobalSettingsStore } from '../../stores/globalSettings'
import AppVersionLabel from './AppVersionLabel.vue'

const route = useRoute()
const globalSettings = useGlobalSettingsStore()

function isActive(path: string): boolean {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}

function openSettings(): void {
  globalSettings.openModal('general')
}
</script>

<template>
  <aside
    class="relative z-30 hidden h-full w-16 shrink-0 flex-col overflow-visible border-r border-line bg-chrome xl:flex"
  >
    <div class="flex h-16 items-center justify-center">
      <RouterLink
        :to="{ name: 'dashboard' }"
        class="group relative focus-ring grid h-11 w-11 place-items-center rounded-2xl"
        aria-label="Ribo Studio, go to dashboard"
      >
        <img src="/logo.png" alt="" class="h-7 w-7 object-contain" />
        <span
          class="pointer-events-none absolute left-[calc(100%+0.5rem)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs font-semibold text-ink opacity-0 shadow-overlay transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
          role="tooltip"
        >
          Dashboard
        </span>
      </RouterLink>
    </div>
    <nav class="flex flex-1 flex-col gap-1 px-2" aria-label="Main">
      <RouterLink
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="nav-link group relative focus-ring flex items-center justify-center rounded-xl px-1 py-2.5"
        :class="
          isActive(item.path)
            ? 'nav-link--active bg-brand text-brand-on'
            : 'text-faint hover:bg-ghost hover:text-ink'
        "
        :aria-current="isActive(item.path) ? 'page' : undefined"
        :aria-label="item.label"
      >
        <component :is="item.icon" class="shrink-0" :size="18" />
        <span
          class="pointer-events-none absolute left-[calc(100%+0.5rem)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs font-semibold text-ink opacity-0 shadow-overlay transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
          role="tooltip"
        >
          {{ item.label }}
        </span>
      </RouterLink>
    </nav>
    <AppVersionLabel compact class="mx-1 mb-1" />
    <div class="mx-2 mb-3 flex flex-col gap-1">
      <button
        class="group relative focus-ring flex cursor-pointer items-center justify-center rounded-xl py-2 text-faint hover:bg-ghost hover:text-ink"
        type="button"
        aria-label="Open Global Settings"
        @click="openSettings"
      >
        <Settings :size="16" />
        <span
          class="pointer-events-none absolute left-[calc(100%+0.5rem)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs font-semibold text-ink opacity-0 shadow-overlay transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
          role="tooltip"
        >
          Global Settings
        </span>
      </button>
    </div>
  </aside>
</template>
