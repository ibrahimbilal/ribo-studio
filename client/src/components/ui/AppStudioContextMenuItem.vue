<script setup lang="ts">
import type { Component } from 'vue'

const props = withDefaults(
  defineProps<{
    label: string
    icon?: Component
    disabled?: boolean
    muted?: boolean
    danger?: boolean
  }>(),
  {
    disabled: false,
    muted: false,
    danger: false,
  },
)

const emit = defineEmits<{
  select: []
}>()

function onClick() {
  if (props.disabled) return
  emit('select')
}
</script>

<template>
  <button
    class="flex w-full items-center gap-2 px-3 py-1.5 text-start text-xs hover:bg-white/5"
    :class="
      disabled
        ? 'cursor-not-allowed text-zinc-500'
        : danger
          ? 'cursor-pointer text-red-300'
          : muted
            ? 'cursor-pointer text-zinc-300'
            : 'cursor-pointer text-zinc-200'
    "
    type="button"
    role="menuitem"
    :disabled="disabled"
    @click="onClick"
  >
    <component :is="icon" v-if="icon" :size="14" aria-hidden="true" />
    {{ label }}
  </button>
</template>