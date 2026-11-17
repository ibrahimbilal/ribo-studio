<script setup lang="ts">
import { Music, Pause, Play, Volume2, VolumeX } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import * as api from '../../../lib/api'
import { formatClock } from '../../../lib/format'
import { useScreensaverStore } from '../stores/screensaver'
import { useI18n } from '../../../i18n'
import { S } from '../lib/screensaverI18n'

type PlaylistTrack = {
  index: number
  name: string
  url: string
  duration: number
  trimStart: number
  trimEnd: number
}

type TimelineSegment = {
  track: PlaylistTrack
  start: number
  length: number
}

const store = useScreensaverStore()
const { t } = useI18n()
const audioEl = ref<HTMLAudioElement | null>(null)
const playing = ref(false)
const muted = ref(false)
const timelineTime = ref(0)
const ready = ref(false)
const seeking = ref(false)
const tracks = ref<PlaylistTrack[]>([])
const trackIndex = ref(0)
const playlistError = ref<string | null>(null)

let playlistLoadId = 0
let advanceLock = false

const visible = computed(
  () => store.audioMode === 'upload' && Boolean(store.audioUrl) && store.audioAvailability === 'available',
)

const segments = computed<TimelineSegment[]>(() => {
  let offset = 0
  return tracks.value.map((track) => {
    const length = Math.max(0, track.trimEnd - track.trimStart || track.duration)
    const segment = { track, start: offset, length }
    offset += length
    return segment
  })
})

const totalDuration = computed(() => segments.value.reduce((sum, segment) => sum + segment.length, 0))
const currentSegment = computed(() => segments.value[trackIndex.value] ?? null)
const isPlaylist = computed(() => tracks.value.length > 1)
const progress = computed(() => {
  if (totalDuration.value <= 0) return 0
  return Math.min(100, Math.max(0, (timelineTime.value / totalDuration.value) * 100))
})
const boundaryMarks = computed(() => {
  if (totalDuration.value <= 0 || segments.value.length < 2) return []
  return segments.value.slice(1).map((segment) => ({
    percent: (segment.start / totalDuration.value) * 100,
  }))
})
const label = computed(
  () => currentSegment.value?.track.name || store.audioFileName || t(S('previewAudio.fallbackLabel')),
)

function trackWindow(track: PlaylistTrack): { start: number; end: number; length: number } {
  const start = track.trimStart
  const end = track.trimEnd > track.trimStart ? track.trimEnd : Math.max(track.trimStart, track.duration)
  return { start, end, length: Math.max(0, end - start) }
}

function locateTimeline(time: number): { index: number; local: number } {
  const total = totalDuration.value
  const clamped = Math.max(0, Math.min(total > 0 ? total : time, time))
  for (let index = 0; index < segments.value.length; index += 1) {
    const segment = segments.value[index]!
    const end = segment.start + segment.length
    if (clamped < end || index === segments.value.length - 1) {
      return {
        index,
        local: segment.track.trimStart + Math.max(0, Math.min(segment.length, clamped - segment.start)),
      }
    }
  }
  const last = segments.value[segments.value.length - 1]
  if (!last) return { index: 0, local: 0 }
  return { index: last.track.index, local: last.track.trimEnd }
}

function syncFromElement() {
  const audio = audioEl.value
  const segment = currentSegment.value
  if (!audio || !segment) return
  const absolute = Number.isFinite(audio.currentTime) ? audio.currentTime : segment.track.trimStart
  if (!seeking.value) {
    timelineTime.value = segment.start + Math.max(0, absolute - segment.track.trimStart)
  }
  const { end } = trackWindow(segment.track)
  if (!seeking.value && !advanceLock && playing.value && absolute >= end - 0.05) {
    void advanceTrack(1)
  }
}

function applyPlaybackSettings() {
  const audio = audioEl.value
  if (!audio) return
  audio.loop = store.loopAudio && !isPlaylist.value
  audio.volume = muted.value ? 0 : Math.max(0, Math.min(1, store.audioVolume))
}

async function togglePlay() {
  const audio = audioEl.value
  const segment = currentSegment.value
  if (!audio || !ready.value || !segment) return
  if (audio.paused) {
    const { start, end } = trackWindow(segment.track)
    if (audio.currentTime < start || audio.currentTime >= end - 0.05) {
      try {
        audio.currentTime = start
      } catch {
        // ignore
      }
      timelineTime.value = segment.start
    }
    try {
      await audio.play()
      playing.value = true
    } catch {
      playing.value = false
    }
    return
  }
  audio.pause()
  playing.value = false
}

function toggleMute() {
  muted.value = !muted.value
  applyPlaybackSettings()
}

async function seekTimeline(next: number) {
  if (!Number.isFinite(next) || segments.value.length === 0) return
  const total = totalDuration.value
  const clamped = Math.max(0, Math.min(total > 0 ? total : next, next))
  timelineTime.value = clamped
  const spot = locateTimeline(clamped)
  if (spot.index !== trackIndex.value) {
    trackIndex.value = spot.index
    await bindCurrentTrack({ autoplay: playing.value, localTime: spot.local })
    return
  }
  const audio = audioEl.value
  if (!audio) return
  try {
    audio.currentTime = spot.local
  } catch {
    // ignore
  }
}

function onSeekInput(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  seeking.value = true
  void seekTimeline(Number(target.value))
}

function onSeekCommit(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  seeking.value = true
  void seekTimeline(Number(target.value))
}

function onSeeked() {
  seeking.value = false
  syncFromElement()
}

function stopPlayback() {
  const audio = audioEl.value
  if (!audio) return
  audio.pause()
  playing.value = false
}

async function bindCurrentTrack(opts: { autoplay?: boolean; localTime?: number } = {}) {
  await nextTick()
  const audio = audioEl.value
  const segment = currentSegment.value
  if (!audio || !segment) return
  const wasPlaying = opts.autoplay ?? playing.value
  const { start } = trackWindow(segment.track)
  const local = opts.localTime != null ? opts.localTime : start
  stopPlayback()
  ready.value = false
  timelineTime.value = segment.start + Math.max(0, local - start)
  if (audio.getAttribute('src') !== segment.track.url) {
    audio.src = segment.track.url
    audio.load()
  } else {
    try {
      audio.currentTime = local
    } catch {
      // ignore
    }
    ready.value = audio.readyState >= 1
  }
  applyPlaybackSettings()
  if (wasPlaying) {
    try {
      await audio.play()
      playing.value = true
    } catch {
      playing.value = false
    }
  }
}

async function advanceTrack(step: number) {
  if (tracks.value.length === 0 || advanceLock) return
  advanceLock = true
  try {
    const count = tracks.value.length
    let next = trackIndex.value + step
    if (next >= count) {
      if (!store.loopAudio) {
        stopPlayback()
        trackIndex.value = count - 1
        timelineTime.value = totalDuration.value
        return
      }
      next = 0
    } else if (next < 0) {
      next = 0
    }
    trackIndex.value = next
    await bindCurrentTrack({ autoplay: true })
  } finally {
    advanceLock = false
  }
}

function onEnded() {
  if (isPlaylist.value) {
    void advanceTrack(1)
    return
  }
  playing.value = false
  if (store.loopAudio) return
  timelineTime.value = 0
}

function fallbackTracks(): PlaylistTrack[] {
  const url = store.audioUrl
  if (!url) return []
  const durationSec = store.audioDurationSec != null && store.audioDurationSec > 0 ? store.audioDurationSec : 0
  return [
    {
      index: 0,
      name: store.audioFileName || t(S('previewAudio.fallbackLabel')),
      url,
      duration: durationSec,
      trimStart: 0,
      trimEnd: durationSec,
    },
  ]
}

async function loadPlaylist() {
  const loadId = ++playlistLoadId
  playlistError.value = null
  if (!visible.value) {
    tracks.value = []
    trackIndex.value = 0
    timelineTime.value = 0
    return
  }

  const assetId = store.audioAssetId
  if (!assetId) {
    tracks.value = fallbackTracks()
    trackIndex.value = 0
    await bindCurrentTrack({ autoplay: false })
    return
  }

  try {
    const meta = await api.fetchScreensaverAudioMeta(assetId)
    if (loadId !== playlistLoadId) return
    if (!meta) {
      tracks.value = fallbackTracks()
      trackIndex.value = 0
      await bindCurrentTrack({ autoplay: false })
      return
    }
    const metaTracks = meta.tracks && meta.tracks.length > 0 ? meta.tracks : null
    if (meta.hasRecipe && metaTracks && metaTracks.length > 1) {
      tracks.value = metaTracks.map((track) => ({
        index: track.index,
        name: track.name,
        url: api.screensaverAudioTrackUrl(assetId, track.index),
        duration: track.duration,
        trimStart: track.trimStart,
        trimEnd: track.trimEnd > track.trimStart ? track.trimEnd : track.duration,
      }))
    } else if (metaTracks && metaTracks.length === 1) {
      const track = metaTracks[0]!
      tracks.value = [
        {
          index: 0,
          name: track.name || meta.name,
          url: store.audioUrl || api.screensaverAudioUrl(assetId),
          duration: track.duration || meta.duration,
          trimStart: track.trimStart,
          trimEnd: track.trimEnd > track.trimStart ? track.trimEnd : track.duration || meta.duration,
        },
      ]
    } else {
      tracks.value = [
        {
          index: 0,
          name: meta.name,
          url: store.audioUrl || api.screensaverAudioUrl(assetId),
          duration: meta.duration,
          trimStart: 0,
          trimEnd: meta.duration,
        },
      ]
    }
    trackIndex.value = 0
    await bindCurrentTrack({ autoplay: false })
  } catch (error) {
    if (loadId !== playlistLoadId) return
    playlistError.value = error instanceof Error ? error.message : t(S('previewAudio.loadError'))
    tracks.value = fallbackTracks()
    trackIndex.value = 0
    await bindCurrentTrack({ autoplay: false })
  }
}

function onLoadedMetadata() {
  ready.value = true
  const audio = audioEl.value
  const segment = currentSegment.value
  if (audio && segment) {
    const { start } = trackWindow(segment.track)
    try {
      if (Math.abs(audio.currentTime - start) > 0.05 && timelineTime.value <= segment.start + 0.05) {
        audio.currentTime = start
      }
    } catch {
      // ignore
    }
  }
  syncFromElement()
  applyPlaybackSettings()
}

watch(
  () => [visible.value, store.audioUrl, store.audioAssetId, store.audioAvailability] as const,
  () => {
    void loadPlaylist()
  },
  { flush: 'post', immediate: true },
)

watch(
  () => [store.audioVolume, store.loopAudio, muted.value, isPlaylist.value] as const,
  () => applyPlaybackSettings(),
)

onBeforeUnmount(() => {
  playlistLoadId += 1
  stopPlayback()
  const audio = audioEl.value
  if (!audio) return
  audio.removeAttribute('src')
  audio.load()
})
</script>

<template>
  <div v-if="visible" class="mt-3 shrink-0 rounded-lg border border-line bg-elevated/90 px-3 py-2">
    <div class="flex min-w-0 items-center gap-3 text-zinc-200">
      <button
        class="cursor-pointer disabled:cursor-default disabled:opacity-40"
        type="button"
        :aria-label="playing ? t(S('previewAudio.pauseAria')) : t(S('previewAudio.playAria'))"
        :title="playing ? t(S('previewAudio.pauseTitle')) : t(S('previewAudio.playTitle'))"
        :disabled="!ready"
        @click="togglePlay"
      >
        <Pause v-if="playing" :size="18" />
        <Play v-else :size="18" />
      </button>
      <button
        class="cursor-pointer"
        type="button"
        :aria-label="muted ? t(S('previewAudio.unmuteAria')) : t(S('previewAudio.muteAria'))"
        :title="muted ? t(S('previewAudio.unmuteTitle')) : t(S('previewAudio.muteTitle'))"
        @click="toggleMute"
      >
        <VolumeX v-if="muted" :size="18" />
        <Volume2 v-else :size="18" />
      </button>
      <Music class="hidden size-4 shrink-0 text-zinc-500 sm:block" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate text-sm text-zinc-300" :title="label">{{ label }}</span>
      <span class="shrink-0 text-sm tabular-nums text-zinc-400">
        {{ formatClock(timelineTime) }} / {{ formatClock(totalDuration) }}
      </span>
    </div>
    <div class="relative mt-2">
      <div
        v-for="(mark, index) in boundaryMarks"
        :key="index"
        class="pointer-events-none absolute top-0 z-10 h-3 w-px -translate-x-1/2 bg-zinc-500"
        :style="{ left: `${mark.percent}%` }"
        aria-hidden="true"
      />
      <input
        class="preview-seek relative z-0"
        type="range"
        min="0"
        :max="Math.max(totalDuration, 0.01)"
        step="0.01"
        :value="Math.min(timelineTime, totalDuration || timelineTime)"
        :disabled="!ready || totalDuration <= 0"
        :style="{ '--progress': `${progress}%` }"
        :aria-label="t(S('previewAudio.seekAria'))"
        @pointerdown="seeking = true"
        @input="onSeekInput"
        @change="onSeekCommit"
        @pointerup="onSeekCommit"
        @pointercancel="onSeeked"
      />
    </div>
    <p v-if="playlistError" class="mt-1 text-xs text-amber-300">{{ playlistError }}</p>
    <audio
      ref="audioEl"
      class="hidden"
      preload="metadata"
      @loadedmetadata="onLoadedMetadata"
      @durationchange="syncFromElement"
      @timeupdate="syncFromElement"
      @seeked="onSeeked"
      @play="playing = true"
      @pause="playing = false"
      @ended="onEnded"
      @error="ready = false"
    />
  </div>
</template>

<style scoped>
.preview-seek {
  -webkit-appearance: none;
  appearance: none;
  display: block;
  width: 100%;
  height: 3px;
  border-radius: 999px;
  background: linear-gradient(to right, #f4f4f5 var(--progress, 0%), #3f3f46 var(--progress, 0%));
  cursor: pointer;
}

.preview-seek:disabled {
  cursor: default;
  opacity: 0.45;
}

.preview-seek::-webkit-slider-runnable-track {
  height: 3px;
  background: transparent;
}

.preview-seek::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 10px;
  height: 10px;
  margin-top: -3.5px;
  border: 0;
  border-radius: 999px;
  background: #f4f4f5;
}

.preview-seek::-moz-range-track {
  height: 3px;
  background: transparent;
  border: 0;
}

.preview-seek::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border: 0;
  border-radius: 999px;
  background: #f4f4f5;
}
</style>
