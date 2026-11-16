<script setup lang="ts">
import { computed, useId } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue?: string | number | boolean | null
    value: string | number | boolean
    name?: string
    disabled?: boolean
    ariaLabel?: string
  }>(),
  {
    modelValue: null,
    disabled: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string | number | boolean]
}>()

const inputId = useId()
const checked = computed(() => props.modelValue === props.value)

function onChange() {
  if (props.disabled) return
  emit('update:modelValue', props.value)
}
</script>

<template>
  <span class="app-radio" :class="{ 'app-radio--disabled': disabled }">
    <input
      :id="inputId"
      class="app-radio__input"
      type="radio"
      :name="name"
      :value="String(value)"
      :checked="checked"
      :disabled="disabled"
      :aria-label="ariaLabel"
      @change="onChange"
    />
    <span class="app-radio__ring" :class="{ 'app-radio__ring--on': checked }" aria-hidden="true">
      <span class="app-radio__dot" />
    </span>
  </span>
</template>
