<script setup lang="ts">
import FileDropZone from '../../../components/FileDropZone.vue'
import { useScreensaverStore } from '../stores/screensaver'
import { useI18n } from '../../../i18n'
import { S } from '../lib/screensaverI18n'

const store = useScreensaverStore()
const { t } = useI18n()

const accept = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,.jpg,.jpeg,.png,.webp,.mp4,.mov,.webm'

function onFiles(files: File[]) {
  if (files.length) void store.addSourceFiles(files)
}
</script>

<template>
  <section class="space-y-3">
    <h3 class="section-label">{{ t(S('media.visualSource')) }}</h3>
    <FileDropZone
      multiple
      :accept="accept"
      :label="t(S('media.dropLabel'))"
      :formats="t(S('media.formats'))"
      @files="onFiles"
    />
    <p v-if="store.frameNotice" class="rounded-md border border-amber-900/70 bg-amber-950/40 px-2 py-1.5 text-xs text-amber-200">
      {{ store.frameNotice }}
    </p>
  </section>
</template>