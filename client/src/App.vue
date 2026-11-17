<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { X } from '@lucide/vue'
import AppHeader from './components/layout/AppHeader.vue'
import AppSidebar from './components/layout/AppSidebar.vue'
import MobileNavDrawer from './components/layout/MobileNavDrawer.vue'
import GlobalSettingsModal from './components/settings/GlobalSettingsModal.vue'
import { resumePersistedRenderJobs } from './lib/resumePersistedRenderJobs'
import { useGlobalSettingsStore } from './stores/globalSettings'
import { usePlatformStore } from './stores/platform'

const platform = usePlatformStore()
const globalSettings = useGlobalSettingsStore()
const route = useRoute()
const router = useRouter()
const navTrigger = ref<HTMLElement | null>(null)
const restoredLastApp = ref(false)

onMounted(() => {
  void globalSettings.hydrate().then(() => {
    maybeRestoreLastApp()
  })
  void platform.refreshServer().then(() => resumePersistedRenderJobs())
})

watch(
  () => route.path,
  (path) => {
    if (path !== '/') globalSettings.rememberAppPath(path)
  },
  { immediate: true },
)

function maybeRestoreLastApp(): void {
  if (restoredLastApp.value) return
  restoredLastApp.value = true
  if (!globalSettings.general.rememberLastApp) return
  if (route.path !== '/') return
  const last = globalSettings.general.lastAppPath
  if (!last || last === '/') return
  void router.replace(last)
}

function onOpenNav(trigger: HTMLElement) {
  navTrigger.value = trigger
  platform.openMobileNav()
}

function onCloseNav() {
  platform.closeMobileNav()
  navTrigger.value = null
}
</script>

<template>
  <div class="studio-shell flex h-[100dvh] overflow-hidden text-zinc-100">
    <AppSidebar />
    <div class="flex min-w-0 flex-1 flex-col">
      <AppHeader @open-nav="onOpenNav" />
      <main class="relative min-h-0 flex-1 overflow-hidden">
        <RouterView v-slot="{ Component }">
          <Transition name="page" mode="out-in">
            <component :is="Component" :key="route.path" class="h-full" />
          </Transition>
        </RouterView>
      </main>
    </div>
    <MobileNavDrawer :open="platform.mobileNavOpen" :trigger="navTrigger" @close="onCloseNav" />
    <GlobalSettingsModal />
    <div class="pointer-events-none fixed end-4 bottom-6 z-40 flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-2">
      <div
        v-for="item in platform.toasts"
        :key="item.id"
        class="toast"
        :class="item.tone === 'error' ? 'toast-error' : item.tone === 'success' ? 'toast-success' : undefined"
      >
        <div class="flex items-start gap-3">
          <p class="flex-1">{{ item.text }}</p>
          <button class="cursor-pointer text-zinc-400" type="button" aria-label="Dismiss" @click="platform.dismissToast(item.id)">
            <X :size="16" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
