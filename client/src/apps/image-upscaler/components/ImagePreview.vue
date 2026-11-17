<script setup lang="ts">
import AppEmptyState from '../../../components/ui/AppEmptyState.vue'
import { useI18n } from '../../../i18n'
import { useImageUpscalerStore } from '../stores/imageUpscaler'

const store = useImageUpscalerStore()
const { t } = useI18n()
</script>

<template>
  <div class="preview-well grid h-full min-h-[240px] place-items-center overflow-hidden rounded-xl border border-line">
    <img
      v-if="store.selected"
      :src="store.selected.previewUrl"
      :alt="t('upscaler.preview.altTemplate', { name: store.selected.name })"
      class="max-h-full max-w-full object-contain"
    />
    <AppEmptyState
      v-else
      :title="t('upscaler.preview.emptyTitle')"
      :text="t('upscaler.preview.emptyText')"
    />
  </div>
</template>
