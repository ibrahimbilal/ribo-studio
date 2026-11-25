<script setup lang="ts">
import { ANCHORS, maxBadgeMarginPx } from '@shared/thumbnailLayout'
import { DURATION_BADGE_OPTIONS, RESOLUTION_BADGE_OPTIONS } from '@shared/thumbnailBadges'
import { BADGE_STYLES, THUMBNAIL_OUTPUTS, type BadgeStyleId } from '@shared/thumbnailProject'
import { FRAME_FILE_LIMIT } from '@shared/screensaverFrames'
import { Download, Trash2, X } from '@lucide/vue'
import { computed, onMounted } from 'vue'
import FileDropZone from '../../../components/FileDropZone.vue'
import SettingsAccordion from '../../../components/SettingsAccordion.vue'
import { DEFAULT_FRAMES } from '../../frame-screensaver/lib/defaultFrames'
import { S } from '../../frame-screensaver/lib/screensaverI18n'
import { useI18n, type MessageKey } from '../../../i18n'
import { usePersistedSettingsTab } from '../../../composables/usePersistedSettingsTab'
import { stylePreviewSvgUrl } from '../lib/badgeAssets'
import AppSettingsTabs from '../../../components/ui/AppSettingsTabs.vue'
import SliderField from '../../../components/SliderField.vue'
import ToggleSwitch from '../../../components/ToggleSwitch.vue'
import { useThumbnailStore } from '../stores/thumbnail'

const THUMBNAIL_TABS = ['content', 'output', 'style'] as const

const store = useThumbnailStore()
const { t } = useI18n()
const frameLimitMb = FRAME_FILE_LIMIT / (1024 * 1024)

onMounted(() => {
  void store.loadFrames()
})

function onFrameFiles(files: File[]) {
  if (files.length) void store.uploadFrames(files)
}

function clearSelectedFrame(frameId: string): void {
  if (store.composition.frameId !== frameId) return
  void store.selectFrame(frameId)
}

function removeUploadedFrame(frameId: string): void {
  void store.removeFrame(frameId)
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

const ANCHOR_LABEL_KEYS: Record<string, MessageKey> = {
  'top-left': 'thumbnail.anchors.topLeft',
  'top-center': 'thumbnail.anchors.topCenter',
  'top-right': 'thumbnail.anchors.topRight',
  'middle-left': 'thumbnail.anchors.middleLeft',
  center: 'thumbnail.anchors.center',
  'middle-right': 'thumbnail.anchors.middleRight',
  'bottom-left': 'thumbnail.anchors.bottomLeft',
  'bottom-center': 'thumbnail.anchors.bottomCenter',
  'bottom-right': 'thumbnail.anchors.bottomRight',
}

function anchorLabel(id: string): string {
  const key = ANCHOR_LABEL_KEYS[id]
  return key ? t(key) : id
}

const marginMaxPx = computed(() => maxBadgeMarginPx(store.doc.export.width, store.doc.export.height))

const anyBadgeEnabled = computed(() => store.doc.resolution.enabled || store.doc.duration.enabled)

function onResolution(event: Event): void {
  store.setResolutionLabel((event.target as HTMLSelectElement).value)
}

function onDuration(event: Event): void {
  store.setDurationLabel((event.target as HTMLSelectElement).value)
}

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
            <div v-if="DEFAULT_FRAMES.length > 0" class="grid grid-cols-2 gap-2">
              <div v-for="frame in DEFAULT_FRAMES" :key="frame.id" class="group/frame relative">
                <button
                  class="block w-full cursor-pointer overflow-hidden rounded-md border bg-inset"
                  :class="store.composition.frameId === frame.id ? 'border-brand ring-1 ring-brand' : 'border-zinc-700 hover:border-zinc-500'"
                  type="button"
                  :aria-pressed="store.composition.frameId === frame.id"
                  :title="frame.name"
                  @click="store.selectFrame(frame.id)"
                >
                  <img :src="frame.thumbUrl" :alt="frame.name" width="150" loading="lazy" decoding="async" class="aspect-video w-full object-contain" />
                </button>
                <button
                  v-if="store.composition.frameId === frame.id"
                  class="absolute inset-0 flex cursor-pointer items-center justify-center rounded-md bg-black/55 opacity-0 transition-opacity duration-150 group-hover/frame:opacity-100"
                  type="button"
                  :aria-label="t(S('settings.frames.removeFromPreview'), { name: frame.name })"
                  :title="t(S('settings.frames.remove'), { name: frame.name })"
                  @click.stop="clearSelectedFrame(frame.id)"
                >
                  <X :size="22" class="text-white drop-shadow" aria-hidden="true" />
                </button>
              </div>
            </div>
            <FileDropZone
              class="mt-3"
              compact
              accept="image/png,.png"
              multiple
              :disabled="store.frameUploading"
              :label="t(S('settings.frames.uploadLabel'))"
              :drop-label="t(S('settings.frames.uploadDrop'))"
              :busy-label="t(S('settings.frames.uploadBusy'))"
              :hint="t(S('settings.frames.uploadHint'), { mb: frameLimitMb })"
              @files="onFrameFiles"
            />
            <p v-if="store.frames.length === 0" class="mt-2 text-xs text-zinc-500">{{ t(S('settings.frames.emptyHint')) }}</p>
            <div v-else class="mt-3 grid grid-cols-2 gap-2">
              <div v-for="frame in store.frames" :key="frame.id" class="group/frame relative min-w-0">
                <button
                  class="block w-full cursor-pointer overflow-hidden rounded-md border bg-inset"
                  :class="store.composition.frameId === frame.id ? 'border-brand ring-1 ring-brand' : 'border-zinc-700 hover:border-zinc-500'"
                  type="button"
                  :aria-pressed="store.composition.frameId === frame.id"
                  :title="frame.name"
                  @click="store.selectFrame(frame.id)"
                >
                  <img :src="`/api/screensaver/frames/${frame.id}`" :alt="frame.name" class="aspect-video w-full object-contain" />
                </button>
                <p class="mt-1 truncate px-0.5 text-xs font-semibold text-zinc-200" :title="frame.name">{{ frame.name }}</p>
                <button
                  v-if="store.composition.frameId === frame.id"
                  class="absolute inset-0 flex cursor-pointer items-center justify-center rounded-md bg-black/55 opacity-0 transition-opacity duration-150 group-hover/frame:opacity-100"
                  type="button"
                  :aria-label="t(S('settings.frames.remove'), { name: frame.name })"
                  :title="t(S('settings.frames.remove'), { name: frame.name })"
                  @click.stop="removeUploadedFrame(frame.id)"
                >
                  <Trash2 :size="20" class="text-white drop-shadow" aria-hidden="true" />
                </button>
              </div>
            </div>
          </SettingsAccordion>
          <SettingsAccordion v-for="section in badges" :key="section.id" :title="section.title" :open="true">
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm">{{ t('thumbnail.settings.showBadge') }}</span>
              <ToggleSwitch
                :model-value="store.doc[section.id].enabled"
                :aria-label="t('thumbnail.settings.showBadgeAria', { section: section.title })"
                @update:model-value="store.setBadgeEnabled(section.id, $event)"
              />
            </div>
            <div
              class="settings-reveal"
              :class="{ 'is-open': store.doc[section.id].enabled }"
              :inert="!store.doc[section.id].enabled"
            >
              <div class="settings-reveal__inner">
                <div class="space-y-3 pt-3">
                  <label v-if="section.id === 'resolution'" class="mb-0 block text-xs text-zinc-500">
                    {{ t('thumbnail.settings.resolution') }}
                    <select class="field mt-1" :value="store.doc.resolution.text" @change="onResolution">
                      <option v-for="option in RESOLUTION_BADGE_OPTIONS" :key="option.label" :value="option.label">{{ option.label }}</option>
                    </select>
                  </label>
                  <label v-else class="mb-0 block text-xs text-zinc-500">
                    {{ t('thumbnail.settings.duration') }}
                    <select class="field mt-1" :value="store.doc.duration.text" @change="onDuration">
                      <option v-for="option in DURATION_BADGE_OPTIONS" :key="option.label" :value="option.label">{{ option.label }}</option>
                    </select>
                  </label>
                  <div>
                    <p class="mb-2 text-xs text-zinc-500">{{ t('thumbnail.settings.position') }}</p>
                    <div class="grid grid-cols-3 gap-2">
                      <button
                        v-for="anchor in ANCHORS"
                        :key="anchor.id"
                        class="btn cursor-pointer px-1 py-2 text-xs leading-tight"
                        :class="store.doc[section.id].anchor === anchor.id && !store.doc[section.id].deliberate ? 'btn-primary' : 'btn-ghost'"
                        type="button"
                        @click="store.place(section.id, anchor.id)"
                      >
                        {{ anchorLabel(anchor.id) }}
                      </button>
                    </div>
                  </div>
                  <SliderField
                    v-if="!store.doc[section.id].deliberate"
                    :label="t('thumbnail.settings.distanceFromEdges')"
                    :model-value="Math.round(store.doc[section.id].margin)"
                    :min="0"
                    :max="marginMaxPx"
                    suffix="px"
                    @update:model-value="store.setMargin(section.id, $event)"
                  />
                  <SliderField
                    :label="store.doc[section.id].deliberate ? t('thumbnail.settings.horizontalPosition') : t('thumbnail.settings.horizontalOffset')"
                    :model-value="Math.round((store.doc[section.id].deliberate ? store.doc[section.id].x : store.doc[section.id].offsetX) * 100)"
                    :min="store.doc[section.id].deliberate ? 0 : -45"
                    :max="store.doc[section.id].deliberate ? 100 : 45"
                    suffix="%"
                    @update:model-value="store.setHorizontal(section.id, $event / 100)"
                  />
                  <SliderField
                    :label="store.doc[section.id].deliberate ? t('thumbnail.settings.verticalPosition') : t('thumbnail.settings.verticalOffset')"
                    :model-value="Math.round((store.doc[section.id].deliberate ? store.doc[section.id].y : store.doc[section.id].offsetY) * 100)"
                    :min="store.doc[section.id].deliberate ? 0 : -45"
                    :max="store.doc[section.id].deliberate ? 100 : 45"
                    suffix="%"
                    @update:model-value="store.setVertical(section.id, $event / 100)"
                  />
                  <button class="btn btn-ghost cursor-pointer text-xs" type="button" @click="store.resetPosition(section.id)">
                    {{ t('thumbnail.settings.resetPosition') }}
                  </button>
                </div>
              </div>
            </div>
          </SettingsAccordion>
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
          <div class="grid grid-cols-2 gap-2">
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
