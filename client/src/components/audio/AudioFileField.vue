<script setup lang="ts">
import type { ScreensaverAudioAvailability } from '@shared/screensaverAudio'
import { computed, toRef } from 'vue'
import { audioFormatLabel } from '../../lib/media'
import { formatBytes, formatClock } from '../../lib/format'
import { useAudioFileMeta } from '../../composables/useAudioFileMeta'
import { Trash } from '@lucide/vue'
import FileDropZone from '../FileDropZone.vue'
import FileStatusBox from '../FileStatusBox.vue'

const props = withDefaults(
  defineProps<{
    fileName?: string | null
    fileSize?: number | null
    previewUrl?: string | null
    label?: string
    dropLabel?: string
    formats?: string
    accept?: string
    compact?: boolean
    status?: ScreensaverAudioAvailability | 'ready'
    progress?: number
    error?: string | null
    /** When true, only the drop zone is shown (status lives elsewhere, e.g. project cards). */
    hideStatus?: boolean
  }>(),
  {
    fileName: null,
    fileSize: null,
    previewUrl: null,
    label: 'Drop audio here',
    dropLabel: 'Drop to upload',
    formats: 'MP3, WAV, M4A, AAC, OGG',
    accept: 'audio/*,.mp3,.wav,.m4a,.aac,.ogg',
    compact: true,
    status: 'idle',
    progress: 0,
    error: null,
    hideStatus: false,
  },
)

const emit = defineEmits<{
  files: [files: File[]]
  clear: []
}>()

const { durationSec } = useAudioFileMeta(toRef(props, 'previewUrl'))

const formatLabel = computed(() => (props.fileName ? audioFormatLabel(props.fileName) : ''))

const boxStatus = computed(() => {
  if (props.status === 'uploading' || props.status === 'validating') return 'uploading' as const
  if (props.status === 'error' || props.status === 'missing') return 'error' as const
  return 'ready' as const
})

const metaParts = computed(() => {
  const parts: string[] = []
  if (formatLabel.value) parts.push(formatLabel.value)
  if (props.fileSize != null && props.fileSize > 0) parts.push(formatBytes(props.fileSize))
  if (durationSec.value != null) parts.push(formatClock(durationSec.value))
  if (props.status === 'uploading') parts.push(`${Math.round((props.progress || 0) * 100)}%`)
  if (props.status === 'validating') parts.push('Checking…')
  if (props.status === 'missing') parts.push('Missing')
  if (props.status === 'error' && props.error) parts.push(props.error)
  return parts
})
</script>

<template>
  <div class="space-y-2">
    <FileDropZone
      :compact="compact"
      :accept="accept"
      :label="fileName ? 'Drop a new audio file here' : label"
      :drop-label="fileName ? 'Drop to replace' : dropLabel"
      :formats="formats"
      @files="emit('files', $event)"
    />
    <FileStatusBox
      v-if="!hideStatus && (fileName || status === 'uploading' || status === 'validating' || status === 'error' || status === 'missing')"
      :file-name="fileName || 'Background audio'"
      :status="boxStatus"
      remove-label="Remove audio"
      @remove="emit('clear')"
    >
      <template v-if="metaParts.length > 0" #meta>
        {{ metaParts.join(' · ') }}
      </template>
    </FileStatusBox>
    <button
      v-else-if="hideStatus && fileName"
      class="btn btn-ghost cursor-pointer px-2 py-1 text-xs text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
      type="button"
      @click="emit('clear')"
    >
      <Trash class="size-4" />
      Remove audio
    </button>
  </div>
</template>
