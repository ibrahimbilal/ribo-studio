<script setup lang="ts">
import { ChevronDown, ChevronUp, FilePlus, GripVertical, Plus, RotateCcw, Trash2 } from '@lucide/vue'
import { ref } from 'vue'
import { useCardReorder } from '../composables/useCardReorder'
import { usePlayback } from '../composables/usePlayback'
import { formatClock, sourceLabel } from '../lib/format'
import { useI18n } from '../i18n'
import { useProjectStore } from '../stores/project'
import AppDialog from './ui/AppDialog.vue'
import FileDropZone from './FileDropZone.vue'

const store = useProjectStore()
const { t } = useI18n()
const playback = usePlayback()
const urlInput = ref('')
const listEl = ref<HTMLElement | null>(null)
const deleteAllOpen = ref(false)
const { instant, itemStyle, isPlaceholder, onGripPointerDown } = useCardReorder({
  list: listEl,
  onReorder: (from, to) => store.moveClip(from, to),
})
const fileDrag = ref(false)
const replaceInput = ref<HTMLInputElement | null>(null)
const replaceId = ref<string | null>(null)
let dragDepth = 0

function closeDeleteAll() {
  deleteAllOpen.value = false
}

async function confirmDeleteAll() {
  deleteAllOpen.value = false
  await store.removeAllClips()
}

function submitUrl() {
  const value = urlInput.value
  urlInput.value = ''
  void store.addUrl(value)
}

function onZoneFiles(files: File[]) {
  dragDepth = 0
  fileDrag.value = false
  if (files.length > 0) void store.addFiles(files)
}

function pickReplace(id: string) {
  replaceId.value = id
  replaceInput.value?.click()
}

function onReplace(event: Event) {
  const target = event.target
  const id = replaceId.value
  if (!(target instanceof HTMLInputElement) || !target.files?.[0] || !id) return
  void store.attachFile(id, target.files[0])
  target.value = ''
}

function isFileDrag(event: DragEvent): boolean {
  const types = event.dataTransfer?.types
  if (!types) return false
  const list = Array.from(types)
  return list.includes('Files') && !list.includes('application/x-ribo-clip')
}

function onFileDragEnter(event: DragEvent) {
  if (!isFileDrag(event)) return
  dragDepth += 1
  fileDrag.value = true
}

function onFileDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) fileDrag.value = false
}

function onSidebarDrop(event: DragEvent) {
  dragDepth = 0
  fileDrag.value = false
  if (!isFileDrag(event)) return
  const files = event.dataTransfer?.files
  if (files && files.length > 0) void store.addFiles(files)
}

function onSelectClip(id: string) {
  store.selectClip(id)
  const segment = playback.segments.value.find((item) => item.clip.id === id)
  if (segment) void playback.seek(segment.start)
}

function kept(duration: number, start: number, end: number): string {
  if (duration <= 0) return ''
  return formatClock(Math.max(0, end - start))
}
</script>

<template>
  <aside
    class="flex min-h-0 flex-col border-zinc-800 xl:border-e"
    @dragenter.prevent="onFileDragEnter"
    @dragover.prevent
    @dragleave.prevent="onFileDragLeave"
    @drop.prevent="onSidebarDrop"
  >
    <div class="space-y-3 border-b border-zinc-800 p-4">
      <label class="block">
        <span class="mb-1 block section-label">{{ t('ranking.sidebar.project') }}</span>
        <input v-model="store.name" class="field text-sm font-semibold" maxlength="80" />
      </label>
      <form class="flex gap-2" @submit.prevent="submitUrl">
        <input v-model="urlInput" class="field" :placeholder="t('ranking.sidebar.urlPlaceholder')" />
        <button class="btn cursor-pointer btn-ghost shrink-0 px-2" type="submit" :aria-label="t('ranking.sidebar.addLink')" :title="t('ranking.sidebar.addLink')">
          <Plus :size="16" />
        </button>
      </form>
      <p v-if="store.urlNotice" class="text-xs leading-relaxed text-amber-200/90">{{ store.urlNotice }}</p>
      <FileDropZone
        compact
        accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v"
        multiple
        :label="t('ranking.sidebar.dropVideos')"
        formats="MP4, MOV, WebM"
        :ignore-types="['application/x-ribo-clip']"
        :highlighted="fileDrag"
        @files="onZoneFiles"
      />
    </div>

    <div class="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
      <h3 class="section-label">{{ t('ranking.sidebar.clips') }}</h3>
      <button
        class="btn btn-ghost cursor-pointer px-2 py-1 text-xs text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
        type="button"
        :disabled="store.clips.length === 0"
        @click="deleteAllOpen = true"
      >
        <Trash2 :size="14" />
        {{ t('common.deleteAll') }}
      </button>
    </div>

    <div
      ref="listEl"
      class="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3"
      :class="{ 'card-reorder-instant': instant }"
      @dragover.prevent
    >
      <p v-if="store.clips.length === 0" class="px-2 py-8 text-center text-sm text-zinc-500">
        {{ t('ranking.sidebar.emptyClips') }}
      </p>
      <article
        v-for="(clip, index) in store.clips"
        :key="clip.id"
        data-reorder-item
        class="card-reorder-item rounded-lg border cursor-pointer bg-inset p-2"
        :class="[
          store.selectedClipId === clip.id ? 'border-zinc-200' : 'border-zinc-800',
          isPlaceholder(index) ? 'card-reorder-placeholder' : '',
        ]"
        :style="itemStyle(index)"
        @click="onSelectClip(clip.id)"
      >
        <div class="flex gap-2">
          <button
            class="mt-1 w-5 shrink-0 cursor-grab touch-none select-none text-zinc-500"
            type="button"
            :aria-label="t('common.dragReorder')"
            @pointerdown.stop="onGripPointerDown($event, index)"
          >
            <GripVertical :size="16" />
          </button>
          <div class="relative h-16 w-11 shrink-0 overflow-hidden rounded bg-zinc-900">
            <img v-if="clip.thumbnail" :src="clip.thumbnail" alt="" class="h-full w-full object-cover" referrerpolicy="no-referrer" />
            <span v-else class="flex h-full items-center justify-center text-[10px] text-zinc-600">{{ index + 1 }}</span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="mb-1 flex items-center gap-2 text-xs text-zinc-500">
              <span class="font-semibold text-brand">{{ index + 1 }}</span>
              <span>{{ sourceLabel(clip.source) }}</span>
              <span v-if="clip.playAtEnd" class="font-semibold text-brand">{{ t('ranking.sidebar.playsLast') }}</span>
              <span v-if="clip.duration > 0" class="ms-auto tabular-nums">{{ kept(clip.duration, clip.trimStart, clip.trimEnd) }}</span>
            </div>
            <input
              v-model="clip.title"
              class="field py-1"
              maxlength="120"
              @click.stop
            />
          </div>
        </div>
        <div v-if="clip.uploadState === 'uploading'" class="mt-2 h-1 overflow-hidden rounded bg-zinc-800">
          <div class="h-full bg-brand" :style="{ width: `${Math.round(clip.uploadProgress * 100)}%` }"></div>
        </div>
        <p v-if="clip.error" class="mt-2 text-xs text-red-300">{{ clip.error }}</p>
        <div class="mt-2 flex">
          <button class="icon-action" type="button" :aria-label="t('common.moveUp')" :title="t('common.moveUp')" :disabled="index === 0" @click.stop="store.moveClip(index, index - 1)">
            <ChevronUp :size="16" />
          </button>
          <button class="icon-action" type="button" :aria-label="t('common.moveDown')" :title="t('common.moveDown')" :disabled="index === store.clips.length - 1" @click.stop="store.moveClip(index, index + 1)">
            <ChevronDown :size="16" />
          </button>
          <button v-if="clip.uploadState === 'error'" class="icon-action" type="button" :aria-label="t('common.retry')" :title="t('common.retry')" @click.stop="store.retryUpload(clip.id)">
            <RotateCcw :size="16" />
          </button>
          <button v-if="clip.uploadState === 'empty'" class="icon-action" type="button" :aria-label="t('common.browse')" :title="t('common.browse')" @click.stop="pickReplace(clip.id)">
            <FilePlus :size="16" />
          </button>
          <button class="icon-action icon-action--danger ms-auto" type="button" :aria-label="t('common.remove')" :title="t('common.remove')" @click.stop="store.removeClip(clip.id)">
            <Trash2 :size="16" />
          </button>
        </div>
      </article>
      <input ref="replaceInput" class="hidden" type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v" @change="onReplace" />
    </div>

    <AppDialog :open="deleteAllOpen" :title="t('ranking.sidebar.deleteAllTitle')" @cancel="closeDeleteAll">
      <p class="text-sm text-zinc-300">{{ t('ranking.sidebar.deleteAllBody') }}</p>
      <template #actions>
        <button class="btn btn-ghost cursor-pointer" type="button" @click="closeDeleteAll">{{ t('common.cancel') }}</button>
        <button class="btn btn-danger cursor-pointer" type="button" @click="confirmDeleteAll">{{ t('common.deleteAll') }}</button>
      </template>
    </AppDialog>
  </aside>
</template>
