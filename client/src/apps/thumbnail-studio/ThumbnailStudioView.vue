<script setup lang="ts">
import { FileOutput, Image as ImageIcon, Layers, MonitorPlay, Paintbrush, SlidersHorizontal } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from '../../i18n'
import AppDialog from '../../components/ui/AppDialog.vue'
import AppMobileTabs from '../../components/ui/AppMobileTabs.vue'
import AppSettingsTabs from '../../components/ui/AppSettingsTabs.vue'
import { usePersistedSettingsTab } from '../../composables/usePersistedSettingsTab'
import ThumbnailEditorCanvas from './components/ThumbnailEditorCanvas.vue'
import ThumbnailControls from './components/ThumbnailControls.vue'
import ThumbnailMediaPanel from './components/ThumbnailMediaPanel.vue'
import ThumbnailProjectList from './components/ThumbnailProjectList.vue'
import { useThumbnailStore } from './stores/thumbnail'

const THUMBNAIL_INSPECTOR_TABS = ['content', 'output', 'style'] as const

const store = useThumbnailStore()
const { t } = useI18n()
const tab = ref<'source' | 'preview' | 'settings'>('preview')
const inspector = usePersistedSettingsTab('thumbnail', THUMBNAIL_INSPECTOR_TABS, 'content')
const inspectorTabs = computed(() => [
  { id: 'content' as const, label: t('thumbnail.settings.tabContent'), icon: Layers },
  { id: 'output' as const, label: t('thumbnail.settings.tabOutput'), icon: FileOutput },
  { id: 'style' as const, label: t('thumbnail.settings.tabStyle'), icon: Paintbrush },
])
const tabs = computed(() => [
  { id: 'source' as const, label: t('thumbnail.tabSource'), icon: ImageIcon },
  { id: 'preview' as const, label: t('thumbnail.tabPreview'), icon: MonitorPlay },
  { id: 'settings' as const, label: t('thumbnail.tabSettings'), icon: SlidersHorizontal },
])

function onKey(event: KeyboardEvent) {
  const target = event.target
  if (target instanceof HTMLElement) {
    const tag = target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return
  }
  const meta = event.ctrlKey || event.metaKey
  if (!meta || event.key.toLowerCase() !== 'z') return
  event.preventDefault()
  if (event.shiftKey) store.redo()
  else store.undo()
}

onMounted(() => {
  void store.init().then(() => {
    void store.loadFrames()
    void store.consumeStoredTransfer()
  })
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="relative flex h-full min-h-0 min-w-0 overflow-hidden">
    <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden p-3 lg:flex-row">
    <AppMobileTabs v-model="tab" :items="tabs" />

    <aside
      class="studio-panel flex min-h-0 w-full shrink-0 flex-col overflow-hidden lg:h-full lg:w-[320px] lg:max-w-[320px] lg:flex-none"
      :class="tab === 'source' ? 'max-h-none flex-1' : 'hidden lg:flex'"
    >
      <div class="shrink-0 space-y-3 border-b border-zinc-800 p-4">
        <label class="block">
          <span class="section-label mb-1 block">{{ t('common.project') }}</span>
          <input
            class="field text-sm font-semibold"
            maxlength="80"
            type="text"
            :value="store.doc.name"
            @input="store.setName(($event.target as HTMLInputElement).value)"
          />
        </label>
        <ThumbnailMediaPanel />
      </div>
      <ThumbnailProjectList />
    </aside>

    <div
      class="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden"
      :class="tab === 'preview' ? 'flex' : 'hidden lg:flex'"
    >
      <div class="studio-stage flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden p-3">
        <ThumbnailEditorCanvas class="flex min-h-0 w-full min-w-0 flex-1 flex-col" />
      </div>
    </div>
    <ThumbnailControls
      v-model="inspector"
      :inspector-tabs="inspectorTabs"
      :class="tab === 'settings' ? 'flex max-h-none min-h-0 flex-1' : 'hidden min-h-0 flex-1 lg:flex'"
    />
    </div>
    <AppSettingsTabs v-model="inspector" :items="inspectorTabs" variant="rail" />
    <div v-if="!store.hydrated" class="scrim">
      {{ t('thumbnail.restoring') }}
    </div>
    <AppDialog :open="store.promptOpen" :title="t('thumbnail.replaceTitle')" @cancel="store.acceptTransfer('keep')">
      <p class="text-sm text-zinc-400">{{ t('thumbnail.replaceBody') }}</p>
      <template #actions>
        <button class="btn btn-ghost cursor-pointer" type="button" @click="store.acceptTransfer('keep')">{{ t('common.keep') }}</button>
        <button class="btn btn-primary cursor-pointer" type="button" @click="store.acceptTransfer('replace')">{{ t('common.replace') }}</button>
      </template>
    </AppDialog>
  </div>
</template>
