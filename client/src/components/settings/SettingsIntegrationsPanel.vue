<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { EllipsisVertical, RefreshCw, Star } from '@lucide/vue'
import {
  getDefaultSubscribeChannelId,
  listSubscribeChannelPreferences,
  onSubscribeChannelsChanged,
  removeSubscribeChannelPreference,
  setDefaultSubscribeChannel,
  type SubscribeChannelPreference,
} from '../../apps/frame-screensaver/lib/subscribeAnimation/subscribeAnimationChannelPreference'
import * as api from '../../lib/api'
import { registerYoutubeChannel, refreshYoutubeChannel } from '../../lib/youtubeChannelLookup'
import { findProjectsReferencingChannel } from '../../lib/youtubeChannelProjectRefs'
import { useGlobalSettingsStore } from '../../stores/globalSettings'
import { usePlatformStore } from '../../stores/platform'
import AppDialog from '../ui/AppDialog.vue'
import SettingsRow from './SettingsRow.vue'

const store = useGlobalSettingsStore()
const platform = usePlatformStore()

const channels = ref<SubscribeChannelPreference[]>([])
const defaultId = ref<string | null>(null)
const addDraft = ref('')
const addBusy = ref(false)
const addError = ref<string | null>(null)
const addSuccess = ref<string | null>(null)
const menuOpenId = ref<string | null>(null)
const refreshingId = ref<string | null>(null)

const engines = ref<api.SystemInfo | null>(null)
const enginesLoading = ref(false)

const removeTarget = ref<SubscribeChannelPreference | null>(null)
const removeRefs = ref<Array<{ projectId: string; projectName: string }>>([])
const removeOpen = ref(false)

function refreshList(): void {
  channels.value = listSubscribeChannelPreferences()
  defaultId.value = getDefaultSubscribeChannelId()
}

let unsubscribe: (() => void) | null = null

onMounted(() => {
  refreshList()
  unsubscribe = onSubscribeChannelsChanged(refreshList)
  void refreshEngines()
})

onUnmounted(() => {
  unsubscribe?.()
})

watch(
  () => store.modalOpen && store.activeCategory === 'integrations',
  (open) => {
    if (open) {
      refreshList()
      void refreshEngines()
    }
  },
)

async function refreshEngines(): Promise<void> {
  enginesLoading.value = true
  try {
    engines.value = await api.fetchSystemInfo()
  } catch (error) {
    platform.toast(error instanceof Error ? error.message : 'Could not detect engines.', 'error')
  } finally {
    enginesLoading.value = false
  }
}

async function addChannel(): Promise<void> {
  addError.value = null
  addSuccess.value = null
  const draft = addDraft.value.trim()
  if (!draft) {
    addError.value = 'Enter a channel URL, ID, or @handle.'
    return
  }
  addBusy.value = true
  try {
    const existing = channels.value.find(
      (c) =>
        c.channelId === draft ||
        c.channelUrl === draft ||
        (c.channelHandle && `@${c.channelHandle}`.toLowerCase() === draft.toLowerCase()),
    )
    const result = await registerYoutubeChannel(draft, { select: channels.value.length === 0 })
    if (!result.ok) {
      addError.value = result.error
      return
    }
    if (existing && existing.channelId === result.channel.channelId) {
      addSuccess.value = 'Channel already registered — metadata updated.'
    } else {
      addSuccess.value = `Added ${result.channel.channelName}.`
      addDraft.value = ''
    }
    refreshList()
  } finally {
    addBusy.value = false
  }
}

async function onRefreshChannel(channel: SubscribeChannelPreference): Promise<void> {
  menuOpenId.value = null
  refreshingId.value = channel.channelId
  try {
    const result = await refreshYoutubeChannel(channel.channelId)
    if (!result.ok) {
      platform.toast(`${result.error} Previous metadata kept.`, 'info')
      return
    }
    platform.toast(`Refreshed ${result.channel.channelName}.`, 'success')
    refreshList()
  } finally {
    refreshingId.value = null
  }
}

function onSetDefault(channel: SubscribeChannelPreference): void {
  menuOpenId.value = null
  setDefaultSubscribeChannel(channel.channelId)
  refreshList()
  platform.toast(`${channel.channelName} is now the default channel.`, 'success')
}

function openChannel(channel: SubscribeChannelPreference): void {
  menuOpenId.value = null
  window.open(channel.channelUrl, '_blank', 'noopener,noreferrer')
}

async function askRemove(channel: SubscribeChannelPreference): Promise<void> {
  menuOpenId.value = null
  removeTarget.value = channel
  removeRefs.value = await findProjectsReferencingChannel(channel.channelId)
  removeOpen.value = true
}

function confirmRemove(): void {
  const channel = removeTarget.value
  removeOpen.value = false
  if (!channel) return
  removeSubscribeChannelPreference(channel.channelId)
  refreshList()
  platform.toast(
    removeRefs.value.length
      ? `Removed ${channel.channelName} from the registry. Project channel data was preserved.`
      : `Removed ${channel.channelName}.`,
    'success',
  )
  removeTarget.value = null
  removeRefs.value = []
}

function formatUpdated(ts: number): string {
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return '—'
  }
}

const ffmpegPath = computed(() => engines.value?.enginePaths?.ffmpeg ?? null)
const ffprobePath = computed(() => engines.value?.enginePaths?.ffprobe ?? null)
</script>

<template>
  <div @click="menuOpenId = null">
    <h3 class="section-label">YouTube Channels</h3>
    <p class="mb-3 text-xs text-zinc-500">
      Shared channel registry for Subscribe Animations. New projects use the default channel; existing projects keep their own selection.
    </p>

    <div class="mb-4 space-y-2">
      <label class="block text-xs text-zinc-500">Add channel (URL, channel ID, or @handle)</label>
      <div class="flex flex-wrap gap-2">
        <input
          v-model="addDraft"
          class="field min-w-[14rem] flex-1"
          type="text"
          placeholder="https://www.youtube.com/@… or UC…"
          :disabled="addBusy"
          @keydown.enter.prevent="addChannel"
        />
        <button class="btn btn-primary cursor-pointer" type="button" :disabled="addBusy" @click="addChannel">
          {{ addBusy ? 'Looking up…' : 'Add Channel' }}
        </button>
      </div>
      <p v-if="addError" class="text-xs text-amber-300">{{ addError }}</p>
      <p v-else-if="addSuccess" class="text-xs text-emerald-300">{{ addSuccess }}</p>
    </div>

    <div v-if="channels.length === 0" class="rounded-lg bg-inset px-3 py-4 text-sm text-zinc-500">
      No channels registered yet.
    </div>
    <ul v-else class="space-y-2">
      <li
        v-for="channel in channels"
        :key="channel.channelId"
        class="relative flex items-start gap-3 rounded-lg border border-white/5 bg-inset/60 px-3 py-2"
      >
        <img
          v-if="channel.channelAvatarUrl"
          class="mt-0.5 h-9 w-9 rounded-full object-cover"
          :src="channel.channelAvatarUrl"
          alt=""
          width="36"
          height="36"
        />
        <span v-else class="mt-0.5 grid h-9 w-9 place-items-center rounded-full bg-ghost text-xs text-zinc-500">?</span>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <p class="truncate text-sm font-semibold text-zinc-100">{{ channel.channelName }}</p>
            <span
              v-if="channel.channelId === defaultId"
              class="inline-flex items-center gap-1 rounded bg-brand/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand"
            >
              <Star :size="10" />
              Default
            </span>
          </div>
          <p class="truncate text-xs text-zinc-500">
            <span v-if="channel.channelHandle">@{{ channel.channelHandle }} · </span>
            {{ channel.channelSubscriberCount || 'Subscribers unavailable' }}
          </p>
          <p class="text-[11px] text-zinc-600">Updated {{ formatUpdated(channel.updatedAt) }}</p>
        </div>
        <div class="relative shrink-0" @click.stop>
          <button
            class="focus-ring grid h-8 w-8 place-items-center rounded-lg text-zinc-400 hover:bg-white/5 hover:text-zinc-100 cursor-pointer"
            type="button"
            aria-label="Channel actions"
            :aria-expanded="menuOpenId === channel.channelId"
            @click="menuOpenId = menuOpenId === channel.channelId ? null : channel.channelId"
          >
            <EllipsisVertical :size="16" />
          </button>
          <div
            v-if="menuOpenId === channel.channelId"
            class="absolute right-0 z-10 mt-1 min-w-[11rem] rounded-lg border border-white/10 bg-elevated py-1 shadow-overlay"
            role="menu"
          >
            <button
              class="block w-full px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-white/5 cursor-pointer"
              type="button"
              role="menuitem"
              :disabled="channel.channelId === defaultId"
              @click="onSetDefault(channel)"
            >
              Set as Default
            </button>
            <button
              class="block w-full px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-white/5 cursor-pointer"
              type="button"
              role="menuitem"
              :disabled="refreshingId === channel.channelId"
              @click="onRefreshChannel(channel)"
            >
              {{ refreshingId === channel.channelId ? 'Refreshing…' : 'Refresh Channel Data' }}
            </button>
            <button
              class="block w-full px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-white/5 cursor-pointer"
              type="button"
              role="menuitem"
              @click="openChannel(channel)"
            >
              Open YouTube Channel
            </button>
            <button
              class="block w-full px-3 py-1.5 text-left text-xs text-amber-300 hover:bg-white/5 cursor-pointer"
              type="button"
              role="menuitem"
              @click="askRemove(channel)"
            >
              Remove Channel
            </button>
          </div>
        </div>
      </li>
    </ul>

    <h3 class="section-label mt-8">YouTube API Configuration</h3>
    <SettingsRow
      label="Metadata source"
      hint="Public channel pages and oEmbed. No OAuth or uploads."
      tooltip="API keys are not used and are never stored in settings backups."
    >
      <span class="text-sm text-zinc-300">Public lookup</span>
    </SettingsRow>
    <SettingsRow label="API key">
      <span class="text-sm text-zinc-500">Not required for this runtime</span>
    </SettingsRow>
    <p class="mt-1 text-xs text-zinc-500">
      Channel registration uses the existing server lookup. Credentials are never exposed in the browser or backup files.
    </p>

    <h3 class="section-label mt-8">External Engines</h3>
    <div class="mb-2 flex justify-end">
      <button class="btn btn-ghost cursor-pointer" type="button" :disabled="enginesLoading" @click="refreshEngines">
        <RefreshCw :size="14" :class="{ 'animate-spin': enginesLoading }" />
        Detect Engines
      </button>
    </div>
    <SettingsRow label="FFmpeg" :hint="ffmpegPath || undefined">
      <span class="max-w-[16rem] truncate text-right text-xs text-zinc-300">
        {{ engines?.ffmpegVersion || (enginesLoading ? 'Detecting…' : 'Unavailable') }}
      </span>
    </SettingsRow>
    <SettingsRow label="FFprobe" :hint="ffprobePath || undefined">
      <span class="max-w-[16rem] truncate text-right text-xs text-zinc-300">
        {{ engines?.ffprobeVersion || (enginesLoading ? 'Detecting…' : 'Unavailable') }}
      </span>
    </SettingsRow>
    <SettingsRow label="AI upscaling">
      <span class="max-w-[16rem] text-right text-xs text-zinc-300">
        {{
          (engines?.upscalerEngines || [])
            .map((e) => `${e.label}${e.available ? '' : ' (off)'}`)
            .join(', ') || '—'
        }}
      </span>
    </SettingsRow>
    <SettingsRow label="Hardware encoders" hint="Listed by capability; software renderers are excluded from GPU.">
      <span class="max-w-[16rem] text-right text-xs text-zinc-300">
        {{ (engines?.hardwareEncoders || []).map((e) => e.label).join(', ') || 'None detected' }}
      </span>
    </SettingsRow>
    <p class="mt-2 text-xs text-zinc-500">
      Executable paths are bundled with the app. Custom path configuration is not available in this runtime.
    </p>

    <AppDialog :open="removeOpen" title="Remove YouTube channel?" @cancel="removeOpen = false">
      <p class="text-sm text-zinc-300">
        Remove
        <strong class="text-zinc-100">{{ removeTarget?.channelName }}</strong>
        from the shared registry?
      </p>
      <p class="mt-2 text-xs text-zinc-500">
        Subscribe Animation caches are not deleted. Clear caches separately in Storage &amp; Cache if needed.
      </p>
      <div v-if="removeRefs.length" class="mt-3 rounded-lg bg-inset p-2 text-xs text-amber-200">
        <p class="font-semibold">Referenced by {{ removeRefs.length }} project(s):</p>
        <ul class="mt-1 list-disc pl-4 text-amber-100/90">
          <li v-for="ref in removeRefs.slice(0, 6)" :key="ref.projectId">{{ ref.projectName }}</li>
        </ul>
        <p class="mt-1">Those projects keep their channel metadata. Only the registry entry is removed.</p>
      </div>
      <template #actions>
        <button class="btn btn-ghost cursor-pointer" type="button" @click="removeOpen = false">Cancel</button>
        <button class="btn btn-danger cursor-pointer" type="button" @click="confirmRemove">Remove</button>
      </template>
    </AppDialog>
  </div>
</template>
