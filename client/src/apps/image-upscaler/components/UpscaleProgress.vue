<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../../i18n'
import { useImageUpscalerStore } from '../stores/imageUpscaler'

const store = useImageUpscalerStore()
const { t } = useI18n()
const active = computed(() => store.items.find((item) => item.status === 'processing'))
const finished = computed(() => store.items.filter((item) => item.status === 'completed' || item.status === 'failed' || item.status === 'cancelled').length)
</script>

<template>
  <div v-if="store.processing || store.completedCount || store.items.some((item) => item.status === 'failed')" class="rounded-lg border border-zinc-800 bg-inset p-3" aria-live="polite">
    <div class="flex items-center justify-between gap-3 text-xs text-zinc-300">
      <span>{{ t('upscaler.progress.finishedTemplate', { finished, total: store.items.length }) }}</span>
      <span v-if="active">{{ t('upscaler.progress.processingTemplate', { name: active.name }) }}</span>
      <span v-else-if="store.processing">{{ t('upscaler.progress.waiting') }}</span>
    </div>
    <div v-if="store.processing" class="mt-2 h-1 overflow-hidden rounded bg-zinc-800">
      <div class="upscale-indeterminate h-full w-1/3 rounded bg-brand"></div>
    </div>
    <p v-if="store.processing && store.jobEngine === 'realesrgan-lite'" class="mt-2 text-xs text-zinc-500">{{ t('upscaler.progress.aiLiteNote') }}</p>
    <p v-else class="mt-2 text-xs text-zinc-500">{{ t('upscaler.progress.genericNote') }}</p>
  </div>
</template>

<style scoped>
.upscale-indeterminate {
  animation: upscale-slide 1.1s ease-in-out infinite;
}
@keyframes upscale-slide {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(320%); }
}
</style>
