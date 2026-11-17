<script setup lang="ts">
import AppEmptyState from '../../../components/ui/AppEmptyState.vue'
import { useImageUpscalerStore } from '../stores/imageUpscaler'

const store = useImageUpscalerStore()
</script>

<template>
  <div class="preview-well grid h-full min-h-[240px] place-items-center overflow-hidden rounded-xl border border-line">
    <img
      v-if="store.selected"
      :src="store.selected.previewUrl"
      :alt="`Preview of ${store.selected.name}`"
      class="max-h-full max-w-full object-contain"
    />
    <AppEmptyState
      v-else
      title="No image yet"
      text="Add an image to preview it. Nothing is resized until you upscale."
    />
  </div>
</template>
