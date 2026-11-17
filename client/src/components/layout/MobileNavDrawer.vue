<script setup lang="ts">
import { Settings, X } from '@lucide/vue'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { navItems } from '../../app/navigation'
import { useI18n } from '../../i18n'
import { NAV_LABEL_KEYS } from '../../lib/navLabels'
import { useGlobalSettingsStore } from '../../stores/globalSettings'
import { usePlatformStore } from '../../stores/platform'
import AppVersionLabel from './AppVersionLabel.vue'

const platform = usePlatformStore()
const { t } = useI18n()
const globalSettings = useGlobalSettingsStore()
const route = useRoute()

function navLabel(path: string): string {
  const key = NAV_LABEL_KEYS[path]
  return key ? t(key) : path
}
const panelRef = ref<HTMLElement | null>(null)
let triggerEl: HTMLElement | null = null

const props = defineProps<{ open: boolean; trigger?: HTMLElement | null }>()
const emit = defineEmits<{ close: [] }>()

function openSettings(): void {
  emit('close')
  globalSettings.openModal('general')
}

function isActive(path: string): boolean {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) {
    event.preventDefault()
    emit('close')
  }
}

watch(
  () => props.open,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) {
      triggerEl = props.trigger ?? null
      window.setTimeout(() => {
        const first = panelRef.value?.querySelector<HTMLElement>('a, button')
        first?.focus()
      }, 50)
    } else if (triggerEl) {
      triggerEl.focus()
      triggerEl = null
    }
  },
)

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  document.body.style.overflow = ''
})

function onBackdropClick() {
  emit('close')
}

function onNavigate() {
  emit('close')
}

</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 xl:hidden">
      <div class="drawer-scrim-enter absolute inset-0 bg-black/60" aria-hidden="true" @click="onBackdropClick" />
      <div
        ref="panelRef"
        class="drawer-panel-enter absolute inset-y-0 start-0 flex h-full w-[min(280px,85vw)] flex-col border-e border-zinc-800 bg-chrome shadow-xl"
        role="dialog"
        aria-modal="true"
        :aria-label="t('layout.navigation')"
      >
        <div class="flex h-14 items-center justify-between border-b border-zinc-800 px-4">
          <div class="flex min-w-0 items-center gap-2 text-zinc-100">
            <RouterLink
              :to="{ name: 'dashboard' }"
              class="focus-ring shrink-0 rounded-sm"
              :aria-label="t('shell.goToDashboard')"
              @click="onNavigate"
            >
              <img src="/logo.png" alt="" class="h-8 w-8 object-contain" />
            </RouterLink>
            <span class="truncate text-sm font-black tracking-[0.06em]">Ribo Studio</span>
          </div>
          <button class="btn btn-ghost cursor-pointer" type="button" :aria-label="t('common.closeMenu')" @click="emit('close')">
            <X :size="20" />
          </button>
        </div>
        <nav class="flex flex-col gap-1 p-3">
          <RouterLink
            v-for="item in navItems"
            :key="item.path"
            :to="item.path"
            class="nav-link focus-ring flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold"
            :aria-label="navLabel(item.path)"
            :aria-current="isActive(item.path) ? 'page' : undefined"
            :class="
              isActive(item.path)
                ? 'nav-link--active bg-brand/15 text-brand'
                : 'text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100'
            "
            @click="onNavigate"
          >
            <component :is="item.icon" :size="18" />
            {{ navLabel(item.path) }}
          </RouterLink>
        </nav>
        <div class="mt-auto border-t border-zinc-800 p-3">
          <button
            class="nav-link focus-ring flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100"
            type="button"
            @click="openSettings"
          >
            <Settings :size="18" />
            {{ t('shell.globalSettings') }}
          </button>
          <AppVersionLabel show-brand />
        </div>
      </div>
    </div>
  </Teleport>
</template>
