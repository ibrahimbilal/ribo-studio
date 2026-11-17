<script setup lang="ts">
import { Undo2, X } from '@lucide/vue'
import { computed } from 'vue'
import { useI18n } from '../i18n'
import { useProjectStore } from '../stores/project'
import ColorSwatches from './ColorSwatches.vue'
import FileDropZone from './FileDropZone.vue'
import SliderField from './SliderField.vue'
import ToggleSwitch from './ToggleSwitch.vue'

const store = useProjectStore()
const { t } = useI18n()

const keptLabel = computed(() => {
  const clip = store.selectedClip
  if (!clip) return '0'
  return secondsLabel(clip.trimEnd - clip.trimStart)
})
const totalLabel = computed(() => {
  const clip = store.selectedClip
  if (!clip) return '0'
  return secondsLabel(clip.duration)
})

function secondsLabel(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const rounded = Math.round(value)
  if (Math.abs(value - rounded) < 0.05) return String(rounded)
  return value.toFixed(1)
}

function onReplaceFiles(files: File[]) {
  const id = store.selectedClipId
  const file = files[0]
  if (!id || !file) return
  void store.attachFile(id, file)
}

function onCustomColor(event: Event) {
  const target = event.target
  const id = store.selectedClipId
  if (!(target instanceof HTMLInputElement) || !id) return
  store.setRankColor(id, target.value)
}

function onTitleColor(event: Event) {
  const target = event.target
  const id = store.selectedClipId
  if (!(target instanceof HTMLInputElement) || !id) return
  store.setTitleColor(id, target.value)
}
</script>

<template>
  <aside v-if="store.selectedClip" class="flex min-h-0 flex-col border-zinc-800 bg-sidebar xl:border-e">
    <div class="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
      <p class="section-label">{{ t('ranking.selectedClip.title') }}</p>
      <button class="text-zinc-400 cursor-pointer" type="button" :aria-label="t('ranking.selectedClip.close')" :title="t('common.close')" @click="store.closeSelectedPanel">
        <X :size="16" />
      </button>
    </div>
    <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
      <p class="truncate text-sm">{{ store.selectedClip.title }}</p>
      <label class="flex items-center justify-between gap-3 rounded-md border border-zinc-800 bg-inset px-3 py-2 text-xs text-zinc-200">
        <span>
          <span class="block font-semibold">{{ t('ranking.selectedClip.playAtEnd') }}</span>
          <span class="mt-1 block text-xs leading-relaxed text-zinc-500">{{ t('ranking.selectedClip.playAtEndHint') }}</span>
        </span>
        <ToggleSwitch
          :model-value="store.selectedClip.playAtEnd"
          :aria-label="t('ranking.selectedClip.playAtEnd')"
          @update:model-value="store.setPlayAtEnd(store.selectedClip.id, $event)"
        />
      </label>
      <div v-if="store.selectedClip.duration > 0" class="space-y-2">
        <SliderField
          :label="t('ranking.selectedClip.trimStart')"
          :model-value="store.selectedClip.trimStart"
          :min="0"
          :max="store.selectedClip.duration"
          :step="1"
          suffix="s"
          @update:model-value="store.setTrim(store.selectedClip.id, $event, store.selectedClip.trimEnd)"
        />
        <SliderField
          :label="t('ranking.selectedClip.trimEnd')"
          :model-value="store.selectedClip.trimEnd"
          :min="0"
          :max="store.selectedClip.duration"
          :step="1"
          suffix="s"
          @update:model-value="store.setTrim(store.selectedClip.id, store.selectedClip.trimStart, $event)"
        />
        <p class="text-xs text-zinc-500">{{ t('ranking.selectedClip.keepingDuration', { kept: keptLabel, total: totalLabel }) }}</p>
      </div>
      <div class="space-y-2">
        <p class="text-xs text-zinc-400">{{ t('ranking.selectedClip.numberColor') }}</p>
        <ColorSwatches :model-value="store.selectedClip.rankColor" @pick="store.setRankColor(store.selectedClip.id, $event)" />
        <div class="flex flex-wrap items-center gap-2">
          <label class="btn cursor-pointer btn-ghost px-2 py-1">
            {{ t('ranking.selectedClip.custom') }}
            <input
              type="color"
              :value="store.selectedClip.rankColor || store.style.ranking.color"
              :aria-label="t('ranking.selectedClip.customNumberColor')"
              @input="onCustomColor"
            />
          </label>
          <button class="btn cursor-pointer btn-ghost px-2 py-1" type="button" :aria-label="t('ranking.selectedClip.useDefaultNumberColor')" :title="t('ranking.selectedClip.useDefaultNumberColor')" @click="store.setRankColor(store.selectedClip.id, null)">
            <Undo2 :size="16" />
          </button>
        </div>
      </div>
      <div class="space-y-2">
        <p class="text-xs text-zinc-400">{{ t('ranking.selectedClip.titleColor') }}</p>
        <ColorSwatches :model-value="store.selectedClip.titleColor" @pick="store.setTitleColor(store.selectedClip.id, $event)" />
        <div class="flex flex-wrap items-center gap-2">
          <label class="btn cursor-pointer btn-ghost px-2 py-1">
            {{ t('ranking.selectedClip.custom') }}
            <input
              type="color"
              :value="store.selectedClip.titleColor || store.style.caption.color"
              :aria-label="t('ranking.selectedClip.customTitleColor')"
              @input="onTitleColor"
            />
          </label>
          <button class="btn cursor-pointer btn-ghost px-2 py-1" type="button" :aria-label="t('ranking.selectedClip.useDefaultTitleColor')" :title="t('ranking.selectedClip.useDefaultTitleColor')" @click="store.setTitleColor(store.selectedClip.id, null)">
            <Undo2 :size="16" />
          </button>
        </div>
      </div>
      <FileDropZone
        compact
        accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v"
        :label="t('ranking.selectedClip.dropReplace')"
        :drop-label="t('ranking.selectedClip.dropToReplace')"
        formats="MP4, MOV, WebM"
        @files="onReplaceFiles"
      />
    </div>
  </aside>
</template>
