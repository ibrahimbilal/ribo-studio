<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ChevronDown, Download, FolderOpen, Loader2, RefreshCw } from '@lucide/vue'
import {
  DEFAULT_SUBSCRIBE_EDGE_DISTANCE,
  defaultSubscribeSizePercent,
  SUBSCRIBE_ANIMATION_DURATION_SEC,
  type SubscribeAnimationSettings,
  type SubscribeAnimationStyle,
} from '@shared/screensaverSubscribeAnimation'
import type { CacheRetentionPolicy } from '@shared/globalSettings'
import ToggleSwitch from '../ToggleSwitch.vue'
import AppDialog from '../ui/AppDialog.vue'
import * as api from '../../lib/api'
import { formatBytes } from '../../lib/formatBytes'
import {
  prepareDefaultStaticAnimations,
  queueSubscribeAnimationPrepare,
  rebuildSubscribeAnimation,
} from '../../apps/frame-screensaver/lib/subscribeAnimation/subscribeAnimationCachePrep'
import { registerSubscribeChannelFromYoutubeUrl } from '../../apps/frame-screensaver/lib/subscribeAnimation/registerSubscribeChannelFromYoutubeUrl'
import { useGlobalSettingsStore } from '../../stores/globalSettings'
import { usePlatformStore } from '../../stores/platform'
import SettingsRow from './SettingsRow.vue'

const DEFAULT_CACHE_WIDTH = 3840

const store = useGlobalSettingsStore()
const platform = usePlatformStore()

const overview = ref<api.StorageOverview | null>(null)
const inventory = ref<api.SubscribeAnimationCacheInventory | null>(null)
const loading = ref(false)
const busyLabel = ref<string | null>(null)
const expandedChannels = ref<Record<string, boolean>>({})
const channelUrlDraft = ref('')
const channelFetchBusy = ref(false)
const confirm = ref<{
  title: string
  body: string
  action: () => Promise<void>
} | null>(null)

const retentionOptions: Array<{ id: CacheRetentionPolicy; label: string }> = [
  { id: 'never', label: 'Never' },
  { id: '7d', label: 'After 7 days' },
  { id: '30d', label: 'After 30 days' },
  { id: '90d', label: 'After 90 days' },
]

const statusLabel: Record<api.SubscribeAnimationCacheInventoryEntry['status'], string> = {
  cached: 'Cached',
  not_cached: 'Not Cached',
  outdated: 'Outdated',
  rendering: 'Rendering',
  failed: 'Failed',
}

async function refresh(force = true): Promise<void> {
  loading.value = true
  try {
    const [nextOverview, nextInventory] = await Promise.all([
      api.fetchStorageOverview(force),
      api.fetchSubscribeAnimationCacheInventory(),
    ])
    overview.value = nextOverview
    inventory.value = nextInventory
  } catch (error) {
    platform.toast(error instanceof Error ? error.message : 'Could not refresh storage.', 'error')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void refresh(true)
})

watch(
  () => store.modalOpen && store.activeCategory === 'storage',
  (open) => {
    if (open) void refresh(false)
  },
)

function formatDate(value: number | null): string {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return '—'
  }
}

function staticSettings(style: SubscribeAnimationStyle): SubscribeAnimationSettings {
  return {
    enabled: true,
    channelName: '',
    startSec: 0,
    durationSec: SUBSCRIBE_ANIMATION_DURATION_SEC,
    position: 'bottom-center',
    sizePercent: defaultSubscribeSizePercent(style),
    edgeDistance: DEFAULT_SUBSCRIBE_EDGE_DISTANCE,
    style,
    previewOnCanvas: false,
    channelCardTheme: 'light',
    channelUrl: '',
    channelId: null,
    channelAvatarUrl: null,
    channelSubscriberCount: null,
  }
}

async function runAction(label: string, fn: () => Promise<void>): Promise<void> {
  busyLabel.value = label
  try {
    await fn()
    await refresh(true)
    platform.toast(label, 'success')
  } catch (error) {
    platform.toast(error instanceof Error ? error.message : label, 'error')
  } finally {
    busyLabel.value = null
  }
}

function askConfirm(title: string, body: string, action: () => Promise<void>): void {
  confirm.value = { title, body, action }
}

async function confirmAction(): Promise<void> {
  const current = confirm.value
  confirm.value = null
  if (!current) return
  await runAction(current.title, current.action)
}

async function openPath(target: 'temp' | 'cache'): Promise<void> {
  try {
    await api.openSystemPath(target)
  } catch (error) {
    platform.toast(error instanceof Error ? error.message : 'Could not open folder.', 'error')
  }
}

function rebuildStaticCache(): void {
  askConfirm('Rebuild static cache', 'Clear and regenerate all static Subscribe Animation caches?', async () => {
    await api.clearSubscribeAnimationCache({ scope: 'static' })
    await prepareDefaultStaticAnimations(DEFAULT_CACHE_WIDTH)
  })
}

function clearAllCache(): void {
  askConfirm('Clear all animation cache', 'Delete every Subscribe Animation cache entry?', async () => {
    await api.clearSubscribeAnimationCache({ scope: 'all' })
  })
}

function clearStaticCache(): void {
  askConfirm('Clear static cache', 'Delete static animation caches only?', async () => {
    await api.clearSubscribeAnimationCache({ scope: 'static' })
  })
}

function clearDynamicCache(): void {
  askConfirm('Clear dynamic cache', 'Delete all per-channel dynamic animation caches?', async () => {
    const channels = inventory.value?.channels ?? []
    for (const channel of channels) {
      await api.clearSubscribeAnimationCache({ scope: 'channel', channelId: channel.channelId })
    }
  })
}

function clearChannelCache(channelId: string, label: string): void {
  askConfirm('Clear channel cache', `Delete all cached animations for ${label}?`, async () => {
    await api.clearSubscribeAnimationCache({ scope: 'channel', channelId })
  })
}

function cleanTemp(): void {
  askConfirm('Clean temporary files', 'Remove disposable temp files (frames, idle uploads, finished outputs)?', async () => {
    await api.cleanTempStorage()
  })
}

async function generateStatic(style: SubscribeAnimationStyle): Promise<void> {
  await runAction(`Generate ${style}`, async () => {
    await queueSubscribeAnimationPrepare(staticSettings(style), DEFAULT_CACHE_WIDTH, { priority: 1 })
  })
}

async function rebuildStatic(style: SubscribeAnimationStyle): Promise<void> {
  await runAction(`Rebuild ${style}`, async () => {
    await rebuildSubscribeAnimation(staticSettings(style), DEFAULT_CACHE_WIDTH)
  })
}

async function deleteEntry(cacheKey: string | null): Promise<void> {
  if (!cacheKey) return
  askConfirm('Delete cache entry', 'Remove this cached animation from disk?', async () => {
    await api.clearSubscribeAnimationCache({ scope: 'entry', cacheKey })
  })
}

async function fetchChannelFromUrl(): Promise<void> {
  const target = channelUrlDraft.value.trim()
  if (!target) {
    platform.toast('Paste a YouTube channel or video link first.', 'info')
    return
  }
  channelFetchBusy.value = true
  try {
    const { lookup } = await registerSubscribeChannelFromYoutubeUrl(target, {
      prepareCacheWidth: canManageCache.value ? DEFAULT_CACHE_WIDTH : null,
    })
    channelUrlDraft.value = lookup.channelUrl ?? target
    await refresh(true)
    platform.toast(lookup.channelName ? `Loaded ${lookup.channelName}.` : 'Channel info updated.', 'success')
  } catch (error) {
    platform.toast(error instanceof Error ? error.message : 'Could not load channel info.', 'error')
  } finally {
    channelFetchBusy.value = false
  }
}

const canManageCache = computed(() => store.storage.persistentAnimationCacheEnabled)
</script>

<template>
  <div class="space-y-6">
    <div>
      <div class="mb-2 flex items-center justify-between gap-2">
        <h3 class="section-label mb-0">Storage overview</h3>
        <button
          class="btn btn-ghost cursor-pointer"
          type="button"
          :disabled="loading"
          @click="refresh(true)"
        >
          <RefreshCw :size="14" />
          Refresh
        </button>
      </div>
      <div class="grid gap-2 sm:grid-cols-2">
        <div class="rounded-lg bg-inset px-3 py-2 text-sm">
          <p class="text-xs text-zinc-500">Total cache / temp</p>
          <p class="font-semibold text-zinc-100">{{ formatBytes(overview?.totalTempBytes) }}</p>
        </div>
        <div class="rounded-lg bg-inset px-3 py-2 text-sm">
          <p class="text-xs text-zinc-500">Subscribe Animation cache</p>
          <p class="font-semibold text-zinc-100">{{ formatBytes(overview?.subscribeAnimationCacheBytes) }}</p>
        </div>
        <div class="rounded-lg bg-inset px-3 py-2 text-sm">
          <p class="text-xs text-zinc-500">Static / Dynamic</p>
          <p class="font-semibold text-zinc-100">
            {{ formatBytes(overview?.staticAnimationCacheBytes) }}
            /
            {{ formatBytes(overview?.dynamicAnimationCacheBytes) }}
          </p>
        </div>
        <div class="rounded-lg bg-inset px-3 py-2 text-sm">
          <p class="text-xs text-zinc-500">Temporary files</p>
          <p class="font-semibold text-zinc-100">{{ formatBytes(overview?.temporaryFilesBytes) }}</p>
        </div>
        <div class="rounded-lg bg-inset px-3 py-2 text-sm">
          <p class="text-xs text-zinc-500">Available disk</p>
          <p class="font-semibold text-zinc-100">{{ formatBytes(overview?.availableDiskBytes) }}</p>
        </div>
      </div>
      <SettingsRow label="Cache directory" :hint="overview?.cacheDirectory || '—'">
        <button class="btn btn-ghost cursor-pointer" type="button" @click="openPath('cache')">
          <FolderOpen :size="14" />
          Open
        </button>
      </SettingsRow>
      <SettingsRow label="Temporary directory" :hint="overview?.temporaryDirectory || '—'">
        <button class="btn btn-ghost cursor-pointer" type="button" @click="openPath('temp')">
          <FolderOpen :size="14" />
          Open
        </button>
      </SettingsRow>
    </div>

    <div>
      <h3 class="section-label">Subscribe Animation cache</h3>
      <SettingsRow
        label="Persistent animation caching"
        hint="When off, exports render frames on demand and do not read or write the cache."
      >
        <ToggleSwitch
          :model-value="store.storage.persistentAnimationCacheEnabled"
          aria-label="Persistent animation caching"
          @update:model-value="store.patchStorage({ persistentAnimationCacheEnabled: $event })"
        />
      </SettingsRow>
      <SettingsRow label="Automatic cleanup" hint="Based on last successful usage. Busy export files are never deleted.">
        <select
          class="field w-auto min-w-[10rem]"
          :value="store.storage.cacheRetention"
          @change="store.patchStorage({ cacheRetention: ($event.target as HTMLSelectElement).value as CacheRetentionPolicy })"
        >
          <option v-for="option in retentionOptions" :key="option.id" :value="option.id">{{ option.label }}</option>
        </select>
      </SettingsRow>
      <div class="mt-3 flex flex-wrap gap-2">
        <button
          class="btn btn-ghost cursor-pointer"
          type="button"
          :disabled="!canManageCache || Boolean(busyLabel)"
          @click="runAction('Pre-render static animations', () => prepareDefaultStaticAnimations(DEFAULT_CACHE_WIDTH))"
        >
          Pre-render eligible
        </button>
        <button
          class="btn btn-ghost cursor-pointer"
          type="button"
          :disabled="!canManageCache || Boolean(busyLabel)"
          @click="rebuildStaticCache"
        >
          Rebuild cache
        </button>
        <button
          class="btn btn-danger cursor-pointer"
          type="button"
          :disabled="Boolean(busyLabel)"
          @click="clearAllCache"
        >
          Clear all
        </button>
        <button
          class="btn btn-ghost cursor-pointer"
          type="button"
          :disabled="Boolean(busyLabel)"
          @click="clearStaticCache"
        >
          Clear static
        </button>
        <button
          class="btn btn-ghost cursor-pointer"
          type="button"
          :disabled="Boolean(busyLabel)"
          @click="clearDynamicCache"
        >
          Clear dynamic
        </button>
      </div>
      <p v-if="busyLabel" class="mt-2 text-xs text-zinc-400">{{ busyLabel }}…</p>
    </div>

    <div>
      <h3 class="section-label">Animation inventory</h3>
      <div class="space-y-2">
        <div
          v-for="item in inventory?.staticAnimations ?? []"
          :key="item.cacheKey || item.templateId"
          class="rounded-lg border border-white/5 bg-inset px-3 py-2"
        >
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p class="text-sm font-medium text-zinc-100">{{ item.name }}</p>
              <p class="text-xs text-zinc-500">
                Static · {{ statusLabel[item.status] }} · {{ formatBytes(item.fileSize) }} ·
                {{ formatDate(item.lastUsedAt || item.createdAt) }}
              </p>
            </div>
            <div class="flex flex-wrap gap-1">
              <button class="btn btn-ghost cursor-pointer" type="button" :disabled="!canManageCache" @click="generateStatic(item.templateId as SubscribeAnimationStyle)">
                Generate
              </button>
              <button class="btn btn-ghost cursor-pointer" type="button" :disabled="!canManageCache || !item.cacheKey" @click="rebuildStatic(item.templateId as SubscribeAnimationStyle)">
                Rebuild
              </button>
              <button class="btn btn-danger cursor-pointer" type="button" :disabled="!item.cacheKey || item.busy" @click="deleteEntry(item.cacheKey)">
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div>
      <h3 class="section-label mb-3">Dynamic channel cache</h3>
      <label class="block text-xs text-zinc-500">YouTube channel or video URL</label>
      <div class="mt-1 flex gap-2">
        <input
          v-model="channelUrlDraft"
          class="field min-w-0 flex-1"
          type="url"
          placeholder="https://www.youtube.com/@…"
          :disabled="channelFetchBusy"
          @keydown.enter.prevent="void fetchChannelFromUrl()"
        />
        <button
          class="btn btn-ghost shrink-0 cursor-pointer px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
          type="button"
          aria-label="Fetch channel"
          title="Fetch"
          :disabled="channelFetchBusy"
          @click="void fetchChannelFromUrl()"
        >
          <Loader2 v-if="channelFetchBusy" :size="16" class="animate-spin" />
          <Download v-else :size="16" />
        </button>
      </div>
      <p class="mt-1 text-xs text-zinc-500">
        Fetch registers the channel (same registry as Integrations) and caches the Channel card animation. Manage defaults and removals under Integrations.
      </p>
      <p v-if="!(inventory?.channels?.length)" class="mt-3 text-sm text-zinc-500">No channel caches yet.</p>
      <div class="mt-3 space-y-2">
        <div
          v-for="channel in inventory?.channels ?? []"
          :key="channel.channelId"
          class="rounded-lg border border-white/5 bg-inset"
        >
          <button
            class="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left"
            type="button"
            @click="expandedChannels[channel.channelId] = !expandedChannels[channel.channelId]"
          >
            <img
              v-if="channel.channelAvatarUrl"
              :src="channel.channelAvatarUrl"
              alt=""
              class="h-8 w-8 rounded-full object-cover"
            />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-zinc-100">{{ channel.channelName || 'Unknown channel' }}</p>
              <p class="truncate text-xs text-zinc-500">
                {{ channel.channelId }} · {{ channel.animationCount }} · {{ formatBytes(channel.totalBytes) }} ·
                {{ formatDate(channel.lastUpdatedAt) }}
              </p>
            </div>
            <ChevronDown
              :size="16"
              class="shrink-0 text-zinc-500 transition-transform"
              :class="expandedChannels[channel.channelId] ? 'rotate-180' : ''"
            />
          </button>
          <div v-if="expandedChannels[channel.channelId]" class="space-y-2 border-t border-white/5 px-3 py-2">
            <div class="flex flex-wrap gap-2">
              <button
                class="btn btn-danger cursor-pointer"
                type="button"
                @click="clearChannelCache(channel.channelId, channel.channelName || channel.channelId)"
              >
                Clear channel
              </button>
            </div>
            <div
              v-for="item in channel.animations"
              :key="item.cacheKey || item.templateId"
              class="rounded-md bg-chrome/60 px-2 py-2"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p class="text-sm text-zinc-100">{{ item.name }}</p>
                  <p class="text-xs text-zinc-500">
                    {{ statusLabel[item.status] }} · {{ formatBytes(item.fileSize) }} ·
                    {{ formatDate(item.lastUsedAt || item.createdAt) }}
                  </p>
                </div>
                <button class="btn btn-danger cursor-pointer" type="button" :disabled="!item.cacheKey || item.busy" @click="deleteEntry(item.cacheKey)">
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div>
      <h3 class="section-label">Temporary files</h3>
      <SettingsRow
        label="Clean unused temporary files"
        hint="Keeps subscribe animation cache, active jobs, and files still in use."
      >
        <button
          class="btn btn-ghost cursor-pointer"
          type="button"
          :disabled="Boolean(busyLabel)"
          @click="cleanTemp"
        >
          Clean now
        </button>
      </SettingsRow>
      <SettingsRow label="Automatic abandoned temp cleanup" hint="Server sweep removes abandoned temp directories periodically.">
        <ToggleSwitch
          :model-value="store.storage.autoCleanAbandonedTemp"
          aria-label="Automatic abandoned temp cleanup"
          @update:model-value="store.patchStorage({ autoCleanAbandonedTemp: $event })"
        />
      </SettingsRow>
    </div>

    <AppDialog :open="Boolean(confirm)" :title="confirm?.title || ''" @cancel="confirm = null">
      <p class="text-sm text-zinc-300">{{ confirm?.body }}</p>
      <template #actions>
        <button class="btn btn-ghost cursor-pointer" type="button" @click="confirm = null">Cancel</button>
        <button class="btn btn-danger cursor-pointer" type="button" @click="confirmAction">Confirm</button>
      </template>
    </AppDialog>
  </div>
</template>
