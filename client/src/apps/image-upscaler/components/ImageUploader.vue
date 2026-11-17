<script setup lang="ts">
import FileDropZone from '../../../components/FileDropZone.vue'
import { useI18n } from '../../../i18n'
import { useImageUpscalerStore } from '../stores/imageUpscaler'

const store = useImageUpscalerStore()
const { t } = useI18n()
</script>

<template>
  <FileDropZone
    compact
    accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
    multiple
    :disabled="store.processing"
    :label="store.items.length ? t('upscaler.uploader.addImages') : t('upscaler.uploader.dropImages')"
    :drop-label="store.items.length ? t('upscaler.uploader.dropToAdd') : t('upscaler.uploader.dropToUpload')"
    :formats="t('upscaler.uploader.formats')"
    @files="store.addFiles"
  />
</template>
