<script setup lang="ts">
import {
  CircleSpeedLines,
  FileOutput,
  Film,
  ListVideo,
  MonitorPlay,
  Paintbrush,
  SlidersHorizontal,
  Volume2,
} from '@lucide/vue'
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import AppMobileTabs from '../../components/ui/AppMobileTabs.vue'
import AppSettingsTabs from '../../components/ui/AppSettingsTabs.vue'
import AppStudioExportBar from '../../components/ui/AppStudioExportBar.vue'
import ClipSidebar from '../../components/ClipSidebar.vue'
import ExportActionButton from '../../components/ExportActionButton.vue'
import PreviewStage from '../../components/PreviewStage.vue'
import SelectedClipPanel from '../../components/SelectedClipPanel.vue'
import StylePanel from '../../components/StylePanel.vue'
import RankingExportDetails from '../../components/RankingExportDetails.vue'
import { useI18n } from '../../i18n'
import { usePersistedSettingsTab } from '../../composables/usePersistedSettingsTab'
import { usePlayback } from '../../composables/usePlayback'
import { formatClock } from '../../lib/format'
import { useProjectStore } from '../../stores/project'
import ImageMotionShortsView from '../image-motion-shorts/ImageMotionShortsView.vue'
import ShortsModeBar from '../image-motion-shorts/components/ShortsModeBar.vue'
import { loadShortsMode, saveShortsMode, type ShortsEditorMode } from '../image-motion-shorts/lib/shortsMode'

const RANKING_INSPECTOR_TABS = ['clip', 'look', 'output', 'sound'] as const
const IMAGE_MOTION_INSPECTOR_TABS = ['motion', 'output', 'sound'] as const

const store = useProjectStore()
const { t } = useI18n()
const editorMode = ref<ShortsEditorMode>(loadShortsMode())
watch(editorMode, (mode) => saveShortsMode(mode))
const playback = usePlayback()
const tab = ref<'clips' | 'preview' | 'edit'>('preview')
const inspector = usePersistedSettingsTab('ranking', RANKING_INSPECTOR_TABS, 'look')
const imageMotionInspector = usePersistedSettingsTab('image-motion', IMAGE_MOTION_INSPECTOR_TABS, 'motion')
const tabs = computed(() => [
  { id: 'clips' as const, label: t('ranking.tabs.clips'), icon: ListVideo },
  { id: 'preview' as const, label: t('ranking.tabs.preview'), icon: MonitorPlay },
  { id: 'edit' as const, label: t('ranking.tabs.edit'), icon: SlidersHorizontal },
])
const inspectorTabs = computed(() => [
  { id: 'clip' as const, label: t('ranking.inspector.clip'), icon: Film },
  { id: 'look' as const, label: t('ranking.inspector.look'), icon: Paintbrush },
  { id: 'sound' as const, label: t('ranking.inspector.sound'), icon: Volume2 },
  { id: 'output' as const, label: t('ranking.inspector.output'), icon: FileOutput },
])
const imageMotionInspectorTabs = computed(() => [
  { id: 'motion' as const, label: t('imageMotion.settings.motion'), icon: CircleSpeedLines },
  { id: 'output' as const, label: t('imageMotion.settings.output'), icon: FileOutput },
  { id: 'sound' as const, label: t('imageMotion.settings.sound'), icon: Volume2 },
])

function styleFocus(): 'look' | 'sound' | 'output' {
  if (inspector.value === 'sound') return 'sound'
  if (inspector.value === 'output') return 'output'
  return 'look'
}

const exportStatus = computed(() => {
  if (store.exporting) {
    const queue =
      store.activeExportCount > 1
        ? t('ranking.export.queueSuffix', { n: store.activeExportCount })
        : ''
    return `${store.exportState.message}${queue}`
  }
  if (store.exportState.phase === 'error') return store.exportState.error ?? t('ranking.export.failed')
  if (store.exportState.phase === 'done') {
    const warning = store.exportState.warning ? `. ${store.exportState.warning}` : '.'
    return t('ranking.export.readyTapDownload', { warning })
  }
  if (store.exportBlocker) return store.exportBlocker
  return t('ranking.export.statusClips', { n: store.clips.length, duration: formatClock(playback.duration.value) })
})

function onKeyDown(event: KeyboardEvent) {
  if (editorMode.value !== 'ranking') return
  if (event.code !== 'Space') return
  const target = event.target
  if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return
  event.preventDefault()
  playback.toggle()
}

onMounted(() => {
  void store.init()
  window.addEventListener('keydown', onKeyDown)
  if (import.meta.env.DEV) {
    ;(window as unknown as { __ribo?: typeof store }).__ribo = store
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div class="relative flex h-full min-h-0 overflow-hidden text-zinc-100">
    <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <ShortsModeBar v-model="editorMode" variant="bar" rail-from="xl" />
      <ImageMotionShortsView
        v-if="editorMode === 'image-motion'"
        v-model="imageMotionInspector"
        :inspector-tabs="imageMotionInspectorTabs"
        class="min-h-0 flex-1"
      />
      <template v-else>
    <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden p-3">
    <AppMobileTabs v-model="tab" :items="tabs" hide-from="xl" />

    <div class="flex min-h-0 min-w-0 flex-1 gap-3 overflow-hidden">
      <div
        class="grid min-h-0 min-w-0 flex-1 gap-3 xl:grid-cols-[320px_minmax(0,1fr)_360px]"
      >
        <div class="studio-panel min-h-0 overflow-hidden xl:flex" :class="tab === 'clips' ? 'flex' : 'hidden'">
          <ClipSidebar class="h-full w-full" />
        </div>

        <div
          class="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden"
          :class="tab === 'preview' ? 'flex' : 'hidden xl:flex'"
        >
          <div class="studio-stage flex min-h-0 min-w-0 flex-1 basis-0 overflow-hidden">
            <PreviewStage class="h-full w-full" />
          </div>
          <AppStudioExportBar :status="exportStatus" :error="store.exportState.phase === 'error'">
            <ExportActionButton />
          </AppStudioExportBar>
        </div>

        <div class="studio-panel flex min-h-0 flex-col overflow-hidden xl:flex" :class="tab === 'edit' ? 'flex' : 'hidden'">
          <div class="shrink-0 border-b border-zinc-800 px-4 pb-0 pt-4 xl:border-b-0 xl:pb-3">
            <h2 class="text-sm font-bold text-zinc-100">{{ t('ranking.settingsTitle') }}</h2>
            <AppSettingsTabs v-model="inspector" :items="inspectorTabs" variant="bar" />
          </div>
          <div class="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <Transition name="settings-pane" mode="out-in">
              <div v-if="inspector === 'clip'" key="clip" class="w-full">
                <SelectedClipPanel class="h-full w-full" />
                <p v-if="!store.selectedClip" class="px-4 pb-4 mt-3 text-xs text-zinc-500">{{ t('ranking.selectClipHint') }}</p>
              </div>
              <StylePanel
                v-else
                :key="inspector"
                :focus="styleFocus()"
              />
            </Transition>
          </div>
        </div>
      </div>
      <div class="hidden xl:contents">
        <RankingExportDetails />
      </div>
    </div>
    </div>

    <div v-if="!store.hydrated" class="scrim">
      {{ t('ranking.restoringProject') }}
    </div>
      </template>
    </div>

    <aside
      class="relative z-30 hidden h-full w-16 shrink-0 flex-col overflow-visible border-s border-white/5 studio-shell xl:flex"
    >
      <ShortsModeBar v-model="editorMode" variant="rail" rail-from="xl" />
      <div class="mx-2 border-t border-white/5" aria-hidden="true" />
      <AppSettingsTabs
        v-if="editorMode === 'ranking'"
        v-model="inspector"
        :items="inspectorTabs"
        variant="rail"
        rail-from="xl"
        embedded
      />
      <AppSettingsTabs
        v-else
        v-model="imageMotionInspector"
        :items="imageMotionInspectorTabs"
        variant="rail"
        rail-from="xl"
        embedded
      />
    </aside>
  </div>
</template>
