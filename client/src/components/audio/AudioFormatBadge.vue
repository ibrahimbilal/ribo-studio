<script setup lang="ts">
import { computed } from 'vue'
import { audioFormatKey, audioFormatLabel } from '../../lib/media'

const props = withDefaults(
  defineProps<{
    /** File name (preferred) or an already-resolved format label like "MP3". */
    fileName?: string | null
    label?: string | null
    mimeType?: string | null
  }>(),
  {
    fileName: null,
    label: null,
    mimeType: null,
  },
)

const text = computed(() => {
  if (props.label) return props.label.toUpperCase()
  if (props.fileName) return audioFormatLabel(props.fileName, props.mimeType)
  return ''
})

const KNOWN_TONES = new Set(['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'])

const toneClass = computed(() => {
  const source = props.fileName || props.label || ''
  if (!source) return ''
  const key = audioFormatKey(source, props.mimeType)
  return KNOWN_TONES.has(key) ? `format-label--${key}` : ''
})
</script>

<template>
  <span
    v-if="text"
    class="format-label"
    :class="toneClass"
    :title="text"
  >
    {{ text }}
  </span>
</template>
