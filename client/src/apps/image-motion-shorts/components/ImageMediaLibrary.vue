<script setup lang="ts">
import { ChevronDown, ChevronUp, GripVertical, Trash2 } from '@lucide/vue'
import { ref } from 'vue'
import { useCardReorder } from '../../../composables/useCardReorder'
import FileDropZone from '../../../components/FileDropZone.vue'
import AppDialog from '../../../components/ui/AppDialog.vue'
import { useI18n } from '../../../i18n'
import { formatClock } from '../../../lib/format'
import { useImageMotionStore } from '../stores/imageMotion'

const store = useImageMotionStore()
const { t } = useI18n()
const listEl = ref<HTMLElement | null>(null)
const deleteAllOpen = ref(false)
const { instant, itemStyle, isPlaceholder, onGripPointerDown } = useCardReorder({
  list: listEl,
  onReorder: (from, to) => store.reorder(from, to),
})

function onFiles(files: File[]) {
  if (files.length) void store.addFiles(files)
}

function aspect(width: number, height: number): string {
  if (!width || !height) return ''
  return `${(width / height).toFixed(2)}:1`
}

function closeDeleteAll() {
  deleteAllOpen.value = false
}

async function confirmDeleteAll() {
  deleteAllOpen.value = false
  await store.deleteAllSegments()
}
</script>

<template>
  <aside class="flex h-full min-h-0 flex-col bg-sidebar">
    <div class="space-y-3 border-b border-zinc-800 p-4">
      <label class="block">
        <span class="section-label mb-1 block">{{ t('imageMotion.library.project') }}</span>
        <input v-model="store.name" class="field text-sm font-semibold" type="text" maxlength="80" />
      </label>
      <FileDropZone
        compact
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        multiple
        :label="t('imageMotion.library.dropImages')"
        formats="JPG, PNG, WebP"
        @files="onFiles"
      />
    </div>

    <div class="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
      <h3 class="section-label">{{ t('imageMotion.library.images') }}</h3>
      <button
        class="btn btn-ghost cursor-pointer px-2 py-1 text-xs text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
        type="button"
        :disabled="store.segments.length === 0"
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
    >
      <p v-if="store.segments.length === 0" class="px-2 py-8 text-center text-sm text-zinc-500">
        {{ t('imageMotion.library.emptyImages') }}
      </p>
      <article
        v-for="(segment, index) in store.segments"
        :key="segment.id"
        data-reorder-item
        class="card-reorder-item cursor-pointer rounded-lg border bg-inset p-2"
        :class="[
          store.selectedSegmentId === segment.id ? 'border-zinc-200' : 'border-zinc-800',
          isPlaceholder(index) ? 'card-reorder-placeholder' : '',
        ]"
        :style="itemStyle(index)"
        @click="store.selectSegment(segment.id)"
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
            <img v-if="store.objectUrlFor(segment.id)" :src="store.objectUrlFor(segment.id)!" alt="" class="h-full w-full object-cover" />
            <span v-else class="flex h-full items-center justify-center text-[10px] text-zinc-600">{{ index + 1 }}</span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="mb-1 flex items-center gap-2 text-xs text-zinc-500">
              <span class="font-semibold text-brand">{{ index + 1 }}</span>
              <span>{{ segment.serverId ? t('imageMotion.library.ready') : t('imageMotion.library.uploading') }}</span>
              <span class="ms-auto tabular-nums">{{ formatClock(segment.motion.duration) }}</span>
            </div>
            <p class="truncate text-sm font-semibold text-zinc-100" :title="segment.fileName">{{ segment.fileName }}</p>
            <p class="mt-0.5 text-xs text-zinc-500">
              {{ segment.width }}×{{ segment.height }}
              <span v-if="aspect(segment.width, segment.height)"> · {{ aspect(segment.width, segment.height) }}</span>
            </p>
          </div>
        </div>
        <label class="mt-2 flex items-center gap-2 text-xs text-zinc-400" @click.stop>
          {{ t('imageMotion.library.duration') }}
          <input
            class="field w-20 py-1 tabular-nums"
            type="number"
            min="0.3"
            step="0.5"
            :value="segment.motion.duration"
            @change="store.setSegmentDuration(segment.id, Number(($event.target as HTMLInputElement).value))"
          />
          <span>{{ t('imageMotion.library.seconds') }}</span>
        </label>
        <div class="mt-2 flex">
          <button class="icon-action" type="button" :aria-label="t('common.moveUp')" :title="t('common.moveUp')" :disabled="index === 0" @click.stop="store.reorder(index, index - 1)">
            <ChevronUp :size="16" />
          </button>
          <button class="icon-action" type="button" :aria-label="t('common.moveDown')" :title="t('common.moveDown')" :disabled="index === store.segments.length - 1" @click.stop="store.reorder(index, index + 1)">
            <ChevronDown :size="16" />
          </button>
          <button class="icon-action icon-action--danger ms-auto" type="button" :aria-label="t('common.remove')" :title="t('common.remove')" @click.stop="store.removeSegment(segment.id)">
            <Trash2 :size="16" />
          </button>
        </div>
      </article>
    </div>

    <AppDialog :open="deleteAllOpen" :title="t('imageMotion.library.deleteAllTitle')" @cancel="closeDeleteAll">
      <p class="text-sm text-zinc-300">{{ t('imageMotion.library.deleteAllBody') }}</p>
      <template #actions>
        <button class="btn btn-ghost cursor-pointer" type="button" @click="closeDeleteAll">{{ t('common.cancel') }}</button>
        <button class="btn btn-danger cursor-pointer" type="button" @click="confirmDeleteAll">{{ t('common.deleteAll') }}</button>
      </template>
    </AppDialog>
  </aside>
</template>
