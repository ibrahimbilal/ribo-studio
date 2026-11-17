<script setup lang="ts">
import { Image as ImageIcon, MonitorPlay, SlidersHorizontal } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AppMobileTabs from '../../components/ui/AppMobileTabs.vue'
import AppStudioExportBar from '../../components/ui/AppStudioExportBar.vue'
import ImageMediaLibrary from './components/ImageMediaLibrary.vue'
import ImageMotionExportAction from './components/ImageMotionExportAction.vue'
import ImageMotionExportDetails from './components/ImageMotionExportDetails.vue'
import ImageMotionPreview from './components/ImageMotionPreview.vue'
import ImageMotionSettings from './components/ImageMotionSettings.vue'
import ImageMotionTimeline from './components/ImageMotionTimeline.vue'
import { useImageMotionPlayback } from './composables/useImageMotionPlayback'
import { useI18n } from '../../i18n'
import { formatClock } from '../../lib/format'
import { useImageMotionStore } from './stores/imageMotion'

const store = useImageMotionStore()
const { t } = useI18n()
const playback = useImageMotionPlayback()
const tab = ref<'source' | 'preview' | 'settings'>('preview')
const tabs = computed(() => [
  { id: 'source' as const, label: t('imageMotion.tabs.images'), icon: ImageIcon },
  { id: 'preview' as const, label: t('imageMotion.tabs.preview'), icon: MonitorPlay },
  { id: 'settings' as const, label: t('imageMotion.tabs.settings'), icon: SlidersHorizontal },
])

const exportStatus = computed(() => {
  if (store.exporting) {
    const queue =
      store.activeExportCount > 1
        ? t('imageMotion.export.queueSuffix', { n: store.activeExportCount })
        : ''
    return `${store.exportState.message}${queue}`
  }
  if (store.exportState.phase === 'error') return store.exportState.error ?? t('imageMotion.export.failed')
  if (store.exportState.phase === 'done') {
    const warning = store.exportState.warning ? `. ${store.exportState.warning}` : '.'
    return t('imageMotion.export.readyTapDownload', { warning })
  }
  if (store.exportBlocker) return store.exportBlocker
  return t('imageMotion.export.statusImages', { n: store.segments.length, duration: formatClock(store.duration) })
})

function onKeyDown(event: KeyboardEvent) {
  if (event.code !== 'Space') return
  const target = event.target
  if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return
  event.preventDefault()
  playback.toggle()
}

onMounted(() => {
  void store.init()
  window.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div class="relative flex h-full min-h-0 flex-col gap-3 overflow-hidden">
    <AppMobileTabs v-model="tab" :items="tabs" hide-from="xl" />

    <div class="flex min-h-0 min-w-0 flex-1 gap-3 overflow-hidden">
      <div class="grid min-h-0 min-w-0 flex-1 gap-3 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
        <div class="studio-panel min-h-0 overflow-hidden xl:flex" :class="tab === 'source' ? 'flex' : 'hidden'">
          <ImageMediaLibrary class="h-full w-full" />
        </div>

        <div class="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden" :class="tab === 'preview' ? 'flex' : 'hidden xl:flex'">
          <div class="studio-stage flex min-h-0 min-w-0 flex-1 basis-0 overflow-hidden">
            <ImageMotionPreview class="h-full w-full" />
          </div>
          <ImageMotionTimeline />
          <AppStudioExportBar :status="exportStatus" :error="store.exportState.phase === 'error'">
            <ImageMotionExportAction />
          </AppStudioExportBar>
        </div>

        <div class="studio-panel flex min-h-0 flex-col overflow-hidden xl:flex" :class="tab === 'settings' ? 'flex' : 'hidden'">
          <ImageMotionSettings class="min-h-0 flex-1" />
        </div>
      </div>
      <div class="hidden xl:contents">
        <ImageMotionExportDetails />
      </div>
    </div>

    <div v-if="!store.hydrated" class="scrim">
      {{ t('imageMotion.restoringProject') }}
    </div>
  </div>
</template>
