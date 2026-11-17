<script setup lang="ts">
defineProps<{
  label: string
  hint?: string
  tooltip?: string
}>()
</script>

<template>
  <div class="flex flex-col gap-2 border-b border-line py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-1.5">
        <p class="text-sm font-medium text-ink">{{ label }}</p>
        <span
          v-if="tooltip"
          class="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-line-strong text-[10px] font-bold text-faint"
          :title="tooltip"
          tabindex="0"
          :aria-label="tooltip"
        >
          ?
        </span>
      </div>
      <p v-if="hint" class="mt-0.5 text-xs text-faint">{{ hint }}</p>
    </div>
    <div class="flex shrink-0 items-center gap-2 sm:justify-end">
      <slot />
    </div>
  </div>
</template>
