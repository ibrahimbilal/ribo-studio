<script setup lang="ts">
import { AudioLines, Clock, FileOutput, MonitorPlay, Repeat, SlidersHorizontal } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { useI18n } from '../../i18n'
import AppMobileTabs from '../../components/ui/AppMobileTabs.vue'
import AppSettingsTabs from '../../components/ui/AppSettingsTabs.vue'
import { usePersistedSettingsTab } from '../../composables/usePersistedSettingsTab'
import AppStudioExportBar from '../../components/ui/AppStudioExportBar.vue'
import LooperExportBar from './components/LooperExportBar.vue'
import LooperPreview from './components/LooperPreview.vue'
import LooperSendToScreensaver from './components/LooperSendToScreensaver.vue'
import LooperSettings from './components/LooperSettings.vue'
import LooperSourcePanel from './components/LooperSourcePanel.vue'
import { useAudioLooperStore } from './stores/audioLooper'

const LOOPER_INSPECTOR_TABS = ['duration', 'loop', 'output'] as const

const store = useAudioLooperStore()
const { t } = useI18n()
const inspector = usePersistedSettingsTab('looper', LOOPER_INSPECTOR_TABS, 'duration')
const inspectorTabs = computed(() => [
  { id: 'duration' as const, label: t('looper.settings.tabDuration'), icon: Clock },
  { id: 'loop' as const, label: t('looper.settings.tabLoop'), icon: Repeat },
  { id: 'output' as const, label: t('looper.settings.tabOutput'), icon: FileOutput },
])
const hasSource = computed(() => store.hasSource)
const tab = ref<'source' | 'preview' | 'settings'>(store.hasSource ? 'preview' : 'source')
const tabs = computed(() => [
  { id: 'source' as const, label: t('looper.tabSource'), icon: AudioLines },
  { id: 'preview' as const, label: t('looper.tabPreview'), icon: MonitorPlay },
  { id: 'settings' as const, label: t('looper.tabSettings'), icon: SlidersHorizontal },
])

watch(hasSource, (has) => {
  if (!has) tab.value = 'source'
  else if (tab.value === 'source') tab.value = 'preview'
})
</script>

<template>
  <div class="relative flex h-full min-h-0 overflow-hidden">
    <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden p-3 lg:flex-row">
    <AppMobileTabs v-model="tab" :items="tabs" />

    <aside
      class="studio-panel flex min-h-0 w-full shrink-0 flex-col overflow-hidden lg:h-full lg:w-[320px] lg:max-w-[320px] lg:flex-none"
      :class="tab === 'source' ? 'max-h-none flex-1' : 'hidden lg:flex'"
    >
      <LooperSourcePanel class="min-h-0 flex-1" />
    </aside>

    <div
      class="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden"
      :class="tab === 'preview' ? 'flex' : 'hidden lg:flex'"
    >
      <div class="studio-stage flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden p-3">
        <LooperPreview v-if="hasSource" class="min-h-0 flex-1 overflow-y-auto" />
        <div v-else class="grid min-h-0 flex-1 place-items-center px-6 text-center text-sm text-zinc-500">
          {{ t('looper.emptyPreview') }}
        </div>
      </div>
      <AppStudioExportBar :status="store.exportStatusLabel">
        <template #actions>
          <LooperSendToScreensaver />
        </template>
        <LooperExportBar />
      </AppStudioExportBar>
    </div>

    <aside
      class="studio-panel flex min-h-0 w-full shrink-0 flex-col lg:h-full lg:w-[360px] lg:max-w-[360px] lg:flex-none"
      :class="tab === 'settings' ? 'max-h-none flex-1' : 'hidden lg:flex'"
    >
      <LooperSettings v-model="inspector" :inspector-tabs="inspectorTabs" class="min-h-0 flex-1" />
    </aside>
    </div>
    <AppSettingsTabs v-model="inspector" :items="inspectorTabs" variant="rail" />
  </div>
</template>
