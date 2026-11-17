<script setup lang="ts">
import FileDropZone from '../../../components/FileDropZone.vue'
import { useI18n } from '../../../i18n'
import { useThumbnailStore } from '../stores/thumbnail'

const store = useThumbnailStore()
const { t } = useI18n()

const accept = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp'

function onFiles(files: File[]) {
  if (files.length) void store.addImageFiles(files)
}

async function updateFromScreensaver(): Promise<void> {
  store.requestReplaceOnNextTransfer()
  const { createThumbnailFromScreensaver } = await import('../../frame-screensaver/lib/createThumbnail')
  await createThumbnailFromScreensaver()
  store.clearReplaceOnNextTransfer()
}
</script>

<template>
  <section class="shrink-0 space-y-3">
    <h3 class="section-label">{{ t('thumbnail.media.sectionImage') }}</h3>
    <FileDropZone
      multiple
      compact
      :accept="accept"
      :label="t('thumbnail.media.dropImages')"
      :formats="t('thumbnail.media.formats')"
      @files="onFiles"
    />
    <p v-if="store.hasComposition" class="text-xs leading-5 text-zinc-400">
      {{ t('thumbnail.media.screensaverCropNote') }}
    </p>
    <button
      v-if="store.doc.source.app === 'frame-screensaver'"
      class="btn btn-ghost w-full cursor-pointer"
      type="button"
      @click="updateFromScreensaver"
    >
      {{ t('thumbnail.media.updateFromScreensaver') }}
    </button>
  </section>
</template>
