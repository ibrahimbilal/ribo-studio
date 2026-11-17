<script setup lang="ts">
import type { ScreensaverAudioAvailability } from '@shared/screensaverAudio'
import { computed, toRef } from 'vue'
import { Trash } from '@lucide/vue'
import { useI18n } from '../../i18n'
import { formatBytes, formatClock } from '../../lib/format'
import { useAudioFileMeta } from '../../composables/useAudioFileMeta'
import FileDropZone from '../FileDropZone.vue'
import FileStatusBox from '../FileStatusBox.vue'
import AudioFormatBadge from './AudioFormatBadge.vue'

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
    replaceLabel?: string
    replaceDropLabel?: string
    backgroundAudioLabel?: string
    removeAudioLabel?: string
  }>(),
  {
    fileName: null,
    fileSize: null,
    previewUrl: null,
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

const { t } = useI18n()

const { durationSec } = useAudioFileMeta(toRef(props, 'previewUrl'))

const resolvedLabel = computed(() => props.label ?? t('common.audio.dropAudio'))
const resolvedDropLabel = computed(() => props.dropLabel ?? t('common.audio.dropToUpload'))
const resolvedReplaceLabel = computed(() => props.replaceLabel ?? t('common.audio.dropNewAudio'))
const resolvedReplaceDropLabel = computed(() => props.replaceDropLabel ?? t('common.audio.dropToReplace'))
const resolvedBackgroundAudioLabel = computed(() => props.backgroundAudioLabel ?? t('common.audio.backgroundAudio'))
const resolvedRemoveAudioLabel = computed(() => props.removeAudioLabel ?? t('common.audio.removeAudio'))
const resolvedFormats = computed(() => props.formats ?? t('common.audio.formats'))

const boxStatus = computed(() => {
  if (props.status === 'uploading' || props.status === 'validating') return 'uploading' as const
  if (props.status === 'error' || props.status === 'missing') return 'error' as const
  return 'ready' as const
})

const metaParts = computed(() => {
  const parts: string[] = []
  if (props.fileSize != null && props.fileSize > 0) parts.push(formatBytes(props.fileSize))
  if (durationSec.value != null) parts.push(formatClock(durationSec.value))
  if (props.status === 'uploading') parts.push(t('common.percent', { n: Math.round((props.progress || 0) * 100) }))
  if (props.status === 'validating') parts.push(t('common.audio.checking'))
  if (props.status === 'missing') parts.push(t('common.audio.missing'))
  if (props.status === 'error' && props.error) parts.push(props.error)
  return parts
})
</script>

<template>
  <div class="space-y-2">
    <FileDropZone
      :compact="compact"
      :accept="accept"
      :label="fileName ? resolvedReplaceLabel : resolvedLabel"
      :drop-label="fileName ? resolvedReplaceDropLabel : resolvedDropLabel"
      :formats="resolvedFormats"
      @files="emit('files', $event)"
    />
    <FileStatusBox
      v-if="!hideStatus && (fileName || status === 'uploading' || status === 'validating' || status === 'error' || status === 'missing')"
      :file-name="fileName || resolvedBackgroundAudioLabel"
      :status="boxStatus"
      :remove-label="resolvedRemoveAudioLabel"
      @remove="emit('clear')"
    >
      <template v-if="fileName || metaParts.length > 0" #meta>
        <span class="inline-flex flex-wrap items-center gap-1.5">
          <AudioFormatBadge v-if="fileName" :file-name="fileName" />
          <span v-if="metaParts.length > 0">{{ metaParts.join(' · ') }}</span>
        </span>
      </template>
    </FileStatusBox>
    <button
      v-else-if="hideStatus && fileName"
      class="btn btn-ghost cursor-pointer px-2 py-1 text-xs text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
      type="button"
      @click="emit('clear')"
    >
      <Trash class="size-4" />
      {{ resolvedRemoveAudioLabel }}
    </button>
  </div>
</template>