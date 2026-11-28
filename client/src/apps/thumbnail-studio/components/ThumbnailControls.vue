<script setup lang="ts">
import { BADGE_STYLES, THUMBNAIL_OUTPUTS, type BadgeStyleId } from '@shared/thumbnailProject'
import { Download } from '@lucide/vue'
import { computed, onMounted } from 'vue'
import SettingsAccordion from '../../../components/SettingsAccordion.vue'
import AppFramePickerList from '../../../components/ui/AppFramePickerList.vue'
import { S } from '../../frame-screensaver/lib/screensaverI18n'
import { useI18n } from '../../../i18n'
import { usePersistedSettingsTab } from '../../../composables/usePersistedSettingsTab'
import { stylePreviewSvgUrl } from '../lib/badgeAssets'
import AppSettingsTabs from '../../../components/ui/AppSettingsTabs.vue'
import SliderField from '../../../components/SliderField.vue'
import ThumbnailBadgeSettings from './ThumbnailBadgeSettings.vue'
import { useThumbnailStore } from '../stores/thumbnail'

const THUMBNAIL_TABS = ['content', 'output', 'style'] as const

const store = useThumbnailStore()
const { t } = useI18n()
onMounted(() => {
  void store.loadFrames()
})

function onFrameSelect(frameId: string): void {
  void store.selectFrame(frameId)
}

function onFrameClearSelection(frameId: string): void {
  if (store.composition.frameId !== frameId) return
  void store.selectFrame(frameId)
}
const group = usePersistedSettingsTab('thumbnail', THUMBNAIL_TABS, 'content')
const groupTabs = computed(() => [
  { id: 'content' as const, label: t('thumbnail.settings.tabContent') },
  { id: 'output' as const, label: t('thumbnail.settings.tabOutput') },
  { id: 'style' as const, label: t('thumbnail.settings.tabStyle') },
])

const badges = computed(() => [
  { id: 'resolution' as const, title: t('thumbnail.settings.resolutionBadge') },
  { id: 'duration' as const, title: t('thumbnail.settings.durationBadge') },
])

const anyBadgeEnabled = computed(() => store.doc.resolution.enabled || store.doc.duration.enabled)

const sharedStyle = computed(() =>
  store.doc.resolution.appearance.styleId === store.doc.duration.appearance.styleId ? store.doc.resolution.appearance.styleId : null,
)

function swatchUrl(styleId: BadgeStyleId): string | null {
  return stylePreviewSvgUrl(styleId)
}

function onExportSize(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  const [width, height] = value.split('x').map(Number)
  store.setExportSize(width, height)
}
</script>

<template>
  <aside class="studio-panel flex h-full min-h-0 w-full shrink-0 flex-col lg:w-[360px] lg:max-w-[360px] lg:flex-none">
    <div class="shrink-0 border-b border-zinc-800">
      <h2 class="px-4 pt-4 text-sm font-bold text-zinc-100">{{ t('thumbnail.settings.title') }}</h2>
      <AppSettingsTabs v-model="group" :items="groupTabs" />
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <Transition name="settings-pane" mode="out-in">
        <div v-if="group === 'content'" key="content">
          <SettingsAccordion :title="t(S('settings.frames.accordion'))" :open="false">
            <AppFramePickerList
              :selected-frame-id="store.composition.frameId"
              :uploaded-frames="store.frames"
              :uploading="store.frameUploading"
              @select="onFrameSelect"
              @clear-selection="onFrameClearSelection"
              @remove-uploaded="(id) => void store.removeFrame(id)"
              @upload="(files) => void store.uploadFrames(files)"
            />
          </SettingsAccordion>
          <ThumbnailBadgeSettings
            v-for="section in badges"
            :key="section.id"
            :badge-id="section.id"
            :title="section.title"
          />
        </div>
        <SettingsAccordion v-else-if="group === 'style'" key="style" :title="t('thumbnail.settings.badgeStyle')" :open="true">
          <p v-if="!anyBadgeEnabled" class="text-xs text-zinc-500">{{ t('thumbnail.settings.badgeStyleHint') }}</p>
          <div class="settings-reveal" :class="{ 'is-open': anyBadgeEnabled }" :inert="!anyBadgeEnabled">
            <div class="settings-reveal__inner">
              <div class="space-y-3">
                <p class="text-xs text-zinc-500">{{ t('thumbnail.settings.badgeStyleNote') }}</p>
                <SliderField
                  :label="t('thumbnail.settings.badgeSize')"
                  :model-value="Math.round(store.doc.resolution.appearance.scale * 100)"
                  :min="25"
                  :max="200"
                  suffix="%"
                  @update:model-value="store.setBadgeScale($event / 100)"
                />
                <div class="grid grid-cols-2 gap-2">
                  <button
                    v-for="style in BADGE_STYLES"
                    :key="style.id"
                    class="flex cursor-pointer items-center justify-center rounded-md border border-zinc-800 bg-inset p-2"
                    :class="sharedStyle === style.id ? 'border-brand ring-1 ring-brand' : 'hover:border-zinc-600'"
                    type="button"
                    :aria-label="style.label"
                    :aria-pressed="sharedStyle === style.id"
                    @click="store.setBadgeStyle(style.id)"
                  >
                    <img v-if="swatchUrl(style.id)" :src="swatchUrl(style.id)!" alt="" class="pointer-events-none h-10 w-auto max-w-full object-contain" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </SettingsAccordion>
        <SettingsAccordion v-else key="output" :title="t('thumbnail.settings.export')" :open="true">
          <label class="mb-0 block text-xs text-zinc-500">
            {{ t('thumbnail.settings.size') }}
            <select class="field mt-1" :value="`${store.doc.export.width}x${store.doc.export.height}`" @change="onExportSize">
              <option v-for="size in THUMBNAIL_OUTPUTS" :key="size.label" :value="`${size.width}x${size.height}`">{{ size.label }}</option>
            </select>
          </label>
          <div class="grid grid-cols-2 gap-2 mt-3">
            <button
              class="btn cursor-pointer text-xs"
              :class="store.doc.export.format === 'png' ? 'btn-primary' : 'btn-ghost'"
              type="button"
              @click="store.setExportFormat('png')"
            >
              PNG
            </button>
            <button
              class="btn cursor-pointer text-xs"
              :class="store.doc.export.format === 'jpeg' ? 'btn-primary' : 'btn-ghost'"
              type="button"
              @click="store.setExportFormat('jpeg')"
            >
              JPEG
            </button>
          </div>
          <SliderField
            v-if="store.doc.export.format === 'jpeg'"
            :label="t('thumbnail.settings.jpegQuality')"
            :model-value="Math.round(store.doc.export.jpegQuality * 100)"
            :min="50"
            :max="100"
            suffix="%"
            @update:model-value="store.setJpegQuality($event / 100)"
          />
        </SettingsAccordion>
      </Transition>
    </div>

    <div class="shrink-0 space-y-3 border-t border-zinc-800 p-4">
      <button
        class="btn btn-primary w-full cursor-pointer py-3 text-sm"
        type="button"
        :disabled="Boolean(store.exportDuplicateBlocker)"
        @click="store.download()"
      >
        <Download :size="16" />
        {{ t('thumbnail.settings.downloadThumbnail') }}
      </button>
      <p v-if="store.exportDuplicateBlocker" class="text-xs text-zinc-500">{{ store.exportDuplicateBlocker }}</p>
    </div>
  </aside>
</template>
