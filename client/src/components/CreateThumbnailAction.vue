<script setup lang="ts">
import { ImagePlus } from '@lucide/vue'

defineProps<{
  disabled?: boolean
}>()

const emit = defineEmits<{
  create: []
}>()
</script>

<template>
  <button
    class="btn btn-ghost cursor-pointer px-2"
    type="button"
    aria-label="Create Thumbnail"
    title="Create Thumbnail"
    :disabled="disabled"
    @click="emit('create')"
  >
    <ImagePlus :size="18" />
  </button>
</template>
