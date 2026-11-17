<script setup lang="ts">
import { Shuffle, Trash2 } from '@lucide/vue'
import { computed, ref } from 'vue'
import FileDropZone from '../../../components/FileDropZone.vue'
import AppDialog from '../../../components/ui/AppDialog.vue'
import { useI18n } from '../../../i18n'
import { useAudioLooperStore } from '../stores/audioLooper'
import LooperCompatibilityPanel from './LooperCompatibilityPanel.vue'
import LooperTrackList from './LooperTrackList.vue'

const store = useAudioLooperStore()
const { t } = useI18n()
const confirmClear = ref(false)

const shuffleLabel = computed(() => (store.shuffled ? t('looper.source.reshuffle') : t('looper.source.shuffle')))

function onFiles(files: File[]): void {
  if (files.length) void store.addFiles(files)
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="shrink-0 space-y-3 border-b border-zinc-800 p-4">
      <label class="block">
        <span class="section-label mb-1 block">{{ t('common.project') }}</span>
        <input v-model="store.name" class="field text-sm font-semibold" type="text" maxlength="80" />
      </label>
      <FileDropZone
        compact
        accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg"
        multiple
        :label="store.hasSource ? t('looper.source.addAudio') : t('looper.source.dropAudio')"
        :drop-label="store.hasSource ? t('looper.source.dropToAdd') : t('looper.source.dropToUpload')"
        :formats="t('looper.source.formats')"
        @files="onFiles"
      />
      <p v-if="store.pickError" class="text-xs text-red-300">{{ store.pickError }}</p>
    </div>

    <div class="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
      <h3 class="section-label">{{ t('looper.source.tracks') }}</h3>
      <div class="flex items-center gap-1">
        <button
          class="btn btn-ghost cursor-pointer px-2 py-1 text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
          type="button"
          :disabled="store.trackCount < 2"
          :aria-label="shuffleLabel"
          :title="shuffleLabel"
          @click="store.shuffleTracks()"
        >
          <Shuffle :size="14" />
        </button>
        <button
          class="btn btn-ghost cursor-pointer px-2 py-1 text-xs text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
          type="button"
          :disabled="!store.hasSource"
          @click="confirmClear = true"
        >
          <Trash2 :size="14" />
          {{ t('common.deleteAll') }}
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3">
      <p v-if="!store.hasSource" class="px-2 py-8 text-center text-sm text-zinc-500">
        {{ t('looper.source.emptyTracks') }}
      </p>
      <template v-else>
        <LooperTrackList />
        <LooperCompatibilityPanel />
      </template>
    </div>

    <AppDialog :open="confirmClear" :title="t('looper.source.clearTitle')" @cancel="confirmClear = false">
      <p class="text-sm text-zinc-400">{{ t('looper.source.clearBody') }}</p>
      <template #actions>
        <button class="btn btn-ghost cursor-pointer" type="button" @click="confirmClear = false">{{ t('looper.source.keepTracks') }}</button>
        <button
          class="btn btn-danger cursor-pointer"
          type="button"
          @click="store.clearTracks(); confirmClear = false"
        >
          {{ t('looper.source.removeAll') }}
        </button>
      </template>
    </AppDialog>
  </div>
</template>