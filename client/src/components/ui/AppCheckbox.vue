<script setup lang="ts">
import { Check, Minus } from '@lucide/vue'
import { computed, useId } from 'vue'

const props = withDefaults(
  defineProps<{
    checked?: boolean
    indeterminate?: boolean
    disabled?: boolean
    ariaLabel?: string
  }>(),
  {
    checked: false,
    indeterminate: false,
    disabled: false,
  },
)

const emit = defineEmits<{
  change: [checked: boolean]
}>()

const inputId = useId()

const visualChecked = computed(() => props.checked || props.indeterminate)

function onChange(event: Event) {
  const next = (event.target as HTMLInputElement).checked
  emit('change', next)
}
</script>

<template>
  <span class="app-checkbox" :class="{ 'app-checkbox--disabled': disabled }">
    <input
      :id="inputId"
      class="app-checkbox__input"
      type="checkbox"
      :checked="checked"
      :disabled="disabled"
      :aria-checked="indeterminate ? 'mixed' : checked"
      :aria-label="ariaLabel"
      @change="onChange"
    />
    <span
      class="app-checkbox__box"
      :class="{
        'app-checkbox__box--on': visualChecked,
        'app-checkbox__box--indeterminate': indeterminate,
      }"
      aria-hidden="true"
    >
      <Minus v-if="indeterminate" class="app-checkbox__icon" :size="12" stroke-width="3" />
      <Check v-else-if="checked" class="app-checkbox__icon" :size="12" stroke-width="3" />
    </span>
  </span>
</template>
