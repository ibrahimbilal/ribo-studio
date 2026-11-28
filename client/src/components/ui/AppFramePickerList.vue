<script setup lang="ts">
import { FRAME_FILE_LIMIT } from '@shared/screensaverFrames'
import { Trash2, X } from '@lucide/vue'
import FileDropZone from '../FileDropZone.vue'
import { screensaverFrameUrl, type ScreensaverFrame } from '../../lib/api'
import { DEFAULT_FRAMES } from '../../apps/frame-screensaver/lib/defaultFrames'
import { S } from '../../apps/frame-screensaver/lib/screensaverI18n'
import { useI18n } from '../../i18n'

const props = defineProps<{
  selectedFrameId: string
  uploadedFrames: ScreensaverFrame[]
  uploading?: boolean
  /** Megabytes; defaults from `FRAME_FILE_LIMIT`. */
  frameLimitMb?: number
}>()

const emit = defineEmits<{
  select: [frameId: string]
  clearSelection: [frameId: string]
  removeUploaded: [frameId: string]
  upload: [files: File[]]
}>()

const { t } = useI18n()

const limitMb = props.frameLimitMb ?? FRAME_FILE_LIMIT / (1024 * 1024)

function onUploadFiles(files: File[]) {
  if (files.length > 0) emit('upload', files)
}

const nameOverlayClass =
  'pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/85 via-black/45 to-transparent px-2 pt-5 pb-2 text-left text-[10px] font-semibold leading-tight text-zinc-100 truncate'
</script>

<template>
  <div v-if="DEFAULT_FRAMES.length > 0" class="grid grid-cols-2 gap-2">
    <div v-for="frame in DEFAULT_FRAMES" :key="frame.id" class="group/frame relative">
      <button
        class="relative block w-full cursor-pointer overflow-hidden rounded-md border bg-inset"
        :class="selectedFrameId === frame.id ? 'border-brand ring-1 ring-brand' : 'border-zinc-700 hover:border-zinc-500'"
        type="button"
        :aria-pressed="selectedFrameId === frame.id"
        :title="frame.name"
        @click="emit('select', frame.id)"
      >
        <img
          :src="frame.thumbUrl"
          :alt="frame.name"
          width="150"
          loading="lazy"
          decoding="async"
          class="aspect-video w-full object-contain"
        />
        <span :class="[nameOverlayClass, 'capitalize']" aria-hidden="true">{{ frame.name }}</span>
      </button>
      <button
        v-if="selectedFrameId === frame.id"
        class="absolute inset-0 flex cursor-pointer items-center justify-center rounded-md bg-black/55 opacity-0 transition-opacity duration-150 group-hover/frame:opacity-100"
        type="button"
        :aria-label="t(S('settings.frames.removeFromPreview'), { name: frame.name })"
        :title="t(S('settings.frames.remove'), { name: frame.name })"
        @click.stop="emit('clearSelection', frame.id)"
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
    :disabled="uploading"
    :label="t(S('settings.frames.uploadLabel'))"
    :drop-label="t(S('settings.frames.uploadDrop'))"
    :busy-label="t(S('settings.frames.uploadBusy'))"
    :hint="t(S('settings.frames.uploadHint'), { mb: limitMb })"
    @files="onUploadFiles"
  />
  <p v-if="uploadedFrames.length === 0" class="mt-2 text-xs text-zinc-500">{{ t(S('settings.frames.emptyHint')) }}</p>
  <div v-else class="mt-3 grid grid-cols-2 gap-2">
    <div v-for="frame in uploadedFrames" :key="frame.id" class="group/frame relative min-w-0">
      <button
        class="relative block w-full cursor-pointer overflow-hidden rounded-md border bg-inset"
        :class="selectedFrameId === frame.id ? 'border-brand ring-1 ring-brand' : 'border-zinc-700 hover:border-zinc-500'"
        type="button"
        :aria-pressed="selectedFrameId === frame.id"
        :title="frame.name"
        @click="emit('select', frame.id)"
      >
        <img :src="screensaverFrameUrl(frame.id)" :alt="frame.name" class="aspect-video w-full object-contain" />
        <span :class="nameOverlayClass" aria-hidden="true">{{ frame.name }}</span>
      </button>
      <button
        v-if="selectedFrameId === frame.id"
        class="absolute inset-0 flex cursor-pointer items-center justify-center rounded-md bg-black/55 opacity-0 transition-opacity duration-150 group-hover/frame:opacity-100"
        type="button"
        :aria-label="t(S('settings.frames.remove'), { name: frame.name })"
        :title="t(S('settings.frames.remove'), { name: frame.name })"
        @click.stop="emit('removeUploaded', frame.id)"
      >
        <Trash2 :size="20" class="text-white drop-shadow" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>