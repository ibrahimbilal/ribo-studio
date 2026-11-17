<script setup lang="ts">
import { ChevronDown, ChevronUp, CircleCheck, CircleX, GripVertical, LoaderCircle, Trash2, TriangleAlert, Zap } from '@lucide/vue'
import { computed, ref } from 'vue'
import AudioFormatBadge from '../../../components/audio/AudioFormatBadge.vue'
import { useCardReorder } from '../../../composables/useCardReorder'
import { useI18n } from '../../../i18n'
import { useAudioLooperStore } from '../stores/audioLooper'

const store = useAudioLooperStore()
const { t } = useI18n()
const listEl = ref<HTMLElement | null>(null)
const { instant, itemStyle, isPlaceholder, onGripPointerDown } = useCardReorder({
  list: listEl,
  onReorder: (from, to) => store.reorder(from, to),
})

const report = computed(() => store.compatibilityReport)
const expandedId = ref<string | null>(null)
const reorderEnabled = computed(() => !store.filterIncompatibleOnly && store.trackCount > 1)

function trackState(id: string) {
  return report.value.trackStates[id] ?? 'unknown'
}

function mismatchLine(id: string): string | null {
  const items = report.value.trackMismatches[id] ?? []
  if (!items.length) return null
  if (items.some((m) => m.field === 'sampleRate')) return t('looper.tracks.sampleRateMismatch')
  if (items.some((m) => m.field === 'codec')) return t('looper.tracks.codecMismatch')
  if (items.some((m) => m.field === 'channels' || m.field === 'channelLayout')) return t('looper.tracks.channelMismatch')
  if (items.some((m) => m.field === 'invalid')) return items[0]?.message ?? t('looper.tracks.invalidAudio')
  if (items.some((m) => m.field === 'metadata')) return t('looper.tracks.compatibilityUnknown')
  return items[0]?.message ?? t('looper.tracks.processingRequiredShort')
}

function toggleDetails(id: string): void {
  expandedId.value = expandedId.value === id ? null : id
}
</script>

<template>
  <div ref="listEl" class="space-y-2" :class="{ 'card-reorder-instant': instant }">
    <article
      v-for="(track, index) in store.visiblePlaybackTracks"
      :key="track.id"
      data-reorder-item
      class="card-reorder-item cursor-pointer rounded-lg border bg-inset p-2"
      :class="[
        store.selectedTrackId === track.id ? 'border-zinc-200' : 'border-zinc-800',
        store.sequenceTrackId === track.id && !isPlaceholder(index) ? 'ring-1 ring-brand/70' : '',
        isPlaceholder(index) ? 'card-reorder-placeholder' : '',
      ]"
      :style="itemStyle(index)"
      @click="store.selectTrack(track.id)"
    >
      <div class="flex gap-2">
        <button
          v-if="reorderEnabled"
          class="mt-0.5 w-5 shrink-0 cursor-grab touch-none select-none text-zinc-500"
          type="button"
          :aria-label="t('common.dragReorder')"
          @pointerdown.stop="onGripPointerDown($event, index)"
        >
          <GripVertical :size="16" />
        </button>
        <div class="min-w-0 flex-1">
          <div class="flex items-start gap-1.5">
            <span class="mt-0.5 shrink-0" :title="trackState(track.id)">
              <LoaderCircle
                v-if="trackState(track.id) === 'analyzing'"
                :size="14"
                class="animate-spin text-zinc-400"
                :aria-label="t('looper.tracks.analyzing')"
              />
              <CircleCheck
                v-else-if="trackState(track.id) === 'stream-copy-ready'"
                :size="14"
                class="text-emerald-400"
                :aria-label="t('looper.tracks.compatible')"
              />
              <CircleX
                v-else-if="trackState(track.id) === 'invalid'"
                :size="14"
                class="text-red-300"
                :aria-label="t('looper.tracks.invalidAudio')"
              />
              <TriangleAlert
                v-else-if="trackState(track.id) === 'processing-required' || trackState(track.id) === 'unknown'"
                :size="14"
                class="text-amber-300"
                :aria-label="t('looper.tracks.processingRequired')"
              />
              <Zap
                v-else
                :size="14"
                class="text-amber-300"
                :aria-label="t('looper.tracks.compatibility')"
              />
            </span>
            <p class="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-100" :title="store.displayName(track)">
              {{ store.displayName(track) }}
            </p>
            <AudioFormatBadge class="shrink-0 self-start" :file-name="track.fileName" />
          </div>
          <p class="mt-0.5 text-xs text-zinc-500">
            <template v-if="track.status === 'reading'">{{ t('looper.tracks.analyzingAudio') }}</template>
            <template v-else-if="track.status === 'error'">{{ track.error }}</template>
            <template v-else>{{ store.metaLabel(track) }}</template>
          </p>
          <p
            v-if="mismatchLine(track.id)"
            class="mt-0.5 text-xs text-amber-300/90"
          >
            {{ mismatchLine(track.id) }}
            <button
              class="ml-1 cursor-pointer text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline"
              type="button"
              @click.stop="toggleDetails(track.id)"
            >
              {{ expandedId === track.id ? t('looper.tracks.hide') : t('looper.tracks.why') }}
            </button>
          </p>
          <ul
            v-if="expandedId === track.id && (report.trackMismatches[track.id]?.length ?? 0) > 0"
            class="mt-1 space-y-0.5 rounded-md border border-zinc-800 bg-app/40 px-2 py-1.5 text-[0.7rem] text-zinc-400"
            @click.stop
          >
            <li v-for="(item, mi) in report.trackMismatches[track.id]" :key="mi">
              <span class="text-zinc-300">{{ item.field }}:</span>
              {{ item.actual }}
              <span v-if="item.expected">{{ t('looper.tracks.mismatchExpected', { expected: item.expected }) }}</span>
            </li>
          </ul>
          <p v-if="store.sequenceTrackId === track.id" class="mt-0.5 text-xs text-brand">{{ t('looper.tracks.playing') }}</p>
        </div>
      </div>
      <div v-if="store.trackCount > 1" class="mt-2 flex">
        <button
          v-if="reorderEnabled"
          class="icon-action"
          type="button"
          :aria-label="t('looper.tracks.ariaMoveUp')"
          :title="t('common.moveUp')"
          :disabled="index === 0"
          @click.stop="store.reorder(index, index - 1)"
        >
          <ChevronUp :size="16" />
        </button>
        <button
          v-if="reorderEnabled"
          class="icon-action"
          type="button"
          :aria-label="t('looper.tracks.ariaMoveDown')"
          :title="t('common.moveDown')"
          :disabled="index === store.visiblePlaybackTracks.length - 1"
          @click.stop="store.reorder(index, index + 1)"
        >
          <ChevronDown :size="16" />
        </button>
        <button class="icon-action icon-action--danger ms-auto" type="button" :aria-label="t('looper.tracks.ariaRemoveTrack')" :title="t('common.remove')" @click.stop="store.removeTrack(track.id)">
          <Trash2 :size="16" />
        </button>
      </div>
      <div v-else class="mt-2 flex justify-end">
        <button class="icon-action icon-action--danger" type="button" :aria-label="t('looper.tracks.ariaRemoveAudio')" :title="t('common.remove')" @click.stop="store.removeTrack(track.id)">
          <Trash2 :size="16" />
        </button>
      </div>
    </article>
  </div>
</template>
