<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ChevronDown, Download, FolderOpen, Loader2, RefreshCw } from '@lucide/vue'
import {
  defaultSubscribeAnimation,
  defaultSubscribeSizePercent,
  type SubscribeAnimationSettings,
  type SubscribeAnimationStyle,
} from '@shared/screensaverSubscribeAnimation'
import type { CacheRetentionPolicy } from '@shared/globalSettings'
import { SUBSCRIBE_ANIMATION_STATIC_CACHE_WIDTH } from '@shared/subscribeAnimationCache'
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
import { useI18n, type MessageKey } from '../../i18n'
import { useGlobalSettingsStore } from '../../stores/globalSettings'
import { usePlatformStore } from '../../stores/platform'
import SettingsRow from './SettingsRow.vue'

const DEFAULT_CACHE_WIDTH = SUBSCRIBE_ANIMATION_STATIC_CACHE_WIDTH

const store = useGlobalSettingsStore()
const { t } = useI18n()
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

const retentionOptions = computed((): Array<{ id: CacheRetentionPolicy; label: string }> => [
  { id: 'never', label: t('settingsExtra.storageRetentionNever') },
  { id: '7d', label: t('settingsExtra.storageRetention7d') },
  { id: '30d', label: t('settingsExtra.storageRetention30d') },
  { id: '90d', label: t('settingsExtra.storageRetention90d') },
])

function statusLabel(status: api.SubscribeAnimationCacheInventoryEntry['status']): string {
  const key: Record<typeof status, MessageKey> = {
    cached: 'settingsExtra.storageStatusCached',
    not_cached: 'settingsExtra.storageStatusNotCached',
    outdated: 'settingsExtra.storageStatusOutdated',
    rendering: 'settingsExtra.storageStatusRendering',
    failed: 'settingsExtra.storageStatusFailed',
  }
  return t(key[status])
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
    platform.toast(error instanceof Error ? error.message : t('settingsExtra.storageRefreshFailed'), 'error')
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
    ...defaultSubscribeAnimation(),
    channelName: '',
    startSec: 0,
    sizePercent: defaultSubscribeSizePercent(style),
    style,
    previewOnCanvas: false,
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
    platform.toast(error instanceof Error ? error.message : t('settingsExtra.storageOpenFolderFailed'), 'error')
  }
}

function rebuildStaticCache(): void {
  askConfirm(t('settingsExtra.storageRebuildStaticTitle'), t('settingsExtra.storageRebuildStaticBody'), async () => {
    await api.clearSubscribeAnimationCache({ scope: 'static' })
    await prepareDefaultStaticAnimations(DEFAULT_CACHE_WIDTH)
  })
}

function clearAllCache(): void {
  askConfirm(t('settingsExtra.storageClearAllTitle'), t('settingsExtra.storageClearAllBody'), async () => {
    await api.clearSubscribeAnimationCache({ scope: 'all' })
  })
}

function clearStaticCache(): void {
  askConfirm(t('settingsExtra.storageClearStaticTitle'), t('settingsExtra.storageClearStaticBody'), async () => {
    await api.clearSubscribeAnimationCache({ scope: 'static' })
  })
}

function clearDynamicCache(): void {
  askConfirm(t('settingsExtra.storageClearDynamicTitle'), t('settingsExtra.storageClearDynamicBody'), async () => {
    const channels = inventory.value?.channels ?? []
    for (const channel of channels) {
      await api.clearSubscribeAnimationCache({ scope: 'channel', channelId: channel.channelId })
    }
  })
}

function clearChannelCache(channelId: string, label: string): void {
  askConfirm(t('settingsExtra.storageClearChannelTitle'), t('settingsExtra.storageClearChannelBody', { label }), async () => {
    await api.clearSubscribeAnimationCache({ scope: 'channel', channelId })
  })
}

function cleanTemp(): void {
  askConfirm(t('settingsExtra.storageCleanTempTitle'), t('settingsExtra.storageCleanTempBody'), async () => {
    await api.cleanTempStorage()
  })
}

async function generateStatic(style: SubscribeAnimationStyle): Promise<void> {
  await runAction(t('settingsExtra.storageGenerateStyle', { style }), async () => {
    await queueSubscribeAnimationPrepare(staticSettings(style), DEFAULT_CACHE_WIDTH, { priority: 1 })
  })
}

async function rebuildStatic(style: SubscribeAnimationStyle): Promise<void> {
  await runAction(t('settingsExtra.storageRebuildStyle', { style }), async () => {
    await rebuildSubscribeAnimation(staticSettings(style), DEFAULT_CACHE_WIDTH)
  })
}

async function deleteEntry(cacheKey: string | null): Promise<void> {
  if (!cacheKey) return
  askConfirm(t('settingsExtra.storageDeleteEntryTitle'), t('settingsExtra.storageDeleteEntryBody'), async () => {
    await api.clearSubscribeAnimationCache({ scope: 'entry', cacheKey })
  })
}

async function fetchChannelFromUrl(): Promise<void> {
  const target = channelUrlDraft.value.trim()
  if (!target) {
    platform.toast(t('settingsExtra.storagePasteYoutube'), 'info')
    return
  }
  channelFetchBusy.value = true
  try {
    const { lookup } = await registerSubscribeChannelFromYoutubeUrl(target, {
      prepareCacheWidth: canManageCache.value ? DEFAULT_CACHE_WIDTH : null,
    })
    channelUrlDraft.value = lookup.channelUrl ?? target
    await refresh(true)
    platform.toast(
      lookup.channelName
        ? t('settingsExtra.storageChannelLoaded', { name: lookup.channelName })
        : t('settingsExtra.storageChannelUpdated'),
      'success',
    )
  } catch (error) {
    platform.toast(error instanceof Error ? error.message : t('settingsExtra.storageChannelLoadFailed'), 'error')
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
        <h3 class="section-label mb-0">{{ t('storage.overview') }}</h3>
        <button
          class="btn btn-ghost cursor-pointer"
          type="button"
          :disabled="loading"
          @click="refresh(true)"
        >
          <RefreshCw :size="14" />
          {{ t('common.refresh') }}
        </button>
      </div>
      <div class="grid gap-2 sm:grid-cols-2">
        <div class="rounded-lg bg-inset px-3 py-2 text-sm">
          <p class="text-xs text-zinc-500">{{ t('settingsExtra.storageTotalCacheTemp') }}</p>
          <p class="font-semibold text-zinc-100">{{ formatBytes(overview?.totalTempBytes) }}</p>
        </div>
        <div class="rounded-lg bg-inset px-3 py-2 text-sm">
          <p class="text-xs text-zinc-500">{{ t('settingsExtra.storageSubscribeCache') }}</p>
          <p class="font-semibold text-zinc-100">{{ formatBytes(overview?.subscribeAnimationCacheBytes) }}</p>
        </div>
        <div class="rounded-lg bg-inset px-3 py-2 text-sm">
          <p class="text-xs text-zinc-500">{{ t('settingsExtra.storageStaticDynamic') }}</p>
          <p class="font-semibold text-zinc-100">
            {{ formatBytes(overview?.staticAnimationCacheBytes) }}
            /
            {{ formatBytes(overview?.dynamicAnimationCacheBytes) }}
          </p>
        </div>
        <div class="rounded-lg bg-inset px-3 py-2 text-sm">
          <p class="text-xs text-zinc-500">{{ t('settingsExtra.storageTemporaryFiles') }}</p>
          <p class="font-semibold text-zinc-100">{{ formatBytes(overview?.temporaryFilesBytes) }}</p>
        </div>
        <div class="rounded-lg bg-inset px-3 py-2 text-sm">
          <p class="text-xs text-zinc-500">{{ t('settingsExtra.storageAvailableDisk') }}</p>
          <p class="font-semibold text-zinc-100">{{ formatBytes(overview?.availableDiskBytes) }}</p>
        </div>
      </div>
      <SettingsRow :label="t('settingsExtra.storageCacheDirectory')" :hint="overview?.cacheDirectory || '—'">
        <button class="btn btn-ghost cursor-pointer" type="button" @click="openPath('cache')">
          <FolderOpen :size="14" />
          {{ t('common.open') }}
        </button>
      </SettingsRow>
      <SettingsRow :label="t('settingsExtra.storageTempDirectory')" :hint="overview?.temporaryDirectory || '—'">
        <button class="btn btn-ghost cursor-pointer" type="button" @click="openPath('temp')">
          <FolderOpen :size="14" />
          {{ t('common.open') }}
        </button>
      </SettingsRow>
    </div>

    <div>
      <h3 class="section-label">{{ t('settingsExtra.storageSubscribeSection') }}</h3>
      <SettingsRow
        :label="t('settingsExtra.storagePersistentCaching')"
        :hint="t('settingsExtra.storagePersistentCachingHint')"
      >
        <ToggleSwitch
          :model-value="store.storage.persistentAnimationCacheEnabled"
          :aria-label="t('settingsExtra.storagePersistentCachingAria')"
          @update:model-value="store.patchStorage({ persistentAnimationCacheEnabled: $event })"
        />
      </SettingsRow>
      <SettingsRow :label="t('settingsExtra.storageAutoCleanup')" :hint="t('settingsExtra.storageAutoCleanupHint')">
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
          @click="runAction(t('settingsExtra.storagePreRenderStatic'), () => prepareDefaultStaticAnimations(DEFAULT_CACHE_WIDTH))"
        >
          {{ t('settingsExtra.storagePreRenderEligible') }}
        </button>
        <button
          class="btn btn-ghost cursor-pointer"
          type="button"
          :disabled="!canManageCache || Boolean(busyLabel)"
          @click="rebuildStaticCache"
        >
          {{ t('settingsExtra.storageRebuildCache') }}
        </button>
        <button
          class="btn btn-danger cursor-pointer"
          type="button"
          :disabled="Boolean(busyLabel)"
          @click="clearAllCache"
        >
          {{ t('common.clearAll') }}
        </button>
        <button
          class="btn btn-ghost cursor-pointer"
          type="button"
          :disabled="Boolean(busyLabel)"
          @click="clearStaticCache"
        >
          {{ t('settingsExtra.storageClearStatic') }}
        </button>
        <button
          class="btn btn-ghost cursor-pointer"
          type="button"
          :disabled="Boolean(busyLabel)"
          @click="clearDynamicCache"
        >
          {{ t('settingsExtra.storageClearDynamic') }}
        </button>
      </div>
      <p v-if="busyLabel" class="mt-2 text-xs text-zinc-400">{{ busyLabel }}…</p>
    </div>

    <div>
      <h3 class="section-label mb-1">{{ t('storage.inventory') }}</h3>
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
                {{ t('settingsExtra.storageStaticMeta') }} · {{ statusLabel(item.status) }} · {{ formatBytes(item.fileSize) }} ·
                {{ formatDate(item.lastUsedAt || item.createdAt) }}
              </p>
            </div>
            <div class="flex flex-wrap gap-1">
              <button class="btn btn-ghost cursor-pointer" type="button" :disabled="!canManageCache" @click="generateStatic(item.templateId as SubscribeAnimationStyle)">
                {{ t('settingsExtra.storageGenerate') }}
              </button>
              <button class="btn btn-ghost cursor-pointer" type="button" :disabled="!canManageCache || !item.cacheKey" @click="rebuildStatic(item.templateId as SubscribeAnimationStyle)">
                {{ t('settingsExtra.storageRebuild') }}
              </button>
              <button class="btn btn-danger cursor-pointer" type="button" :disabled="!item.cacheKey || item.busy" @click="deleteEntry(item.cacheKey)">
                {{ t('common.delete') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div>
      <h3 class="section-label mb-3">{{ t('settingsExtra.storageDynamicSection') }}</h3>
      <label class="block text-xs text-zinc-500">{{ t('settingsExtra.storageYoutubeUrlLabel') }}</label>
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
          :aria-label="t('settingsExtra.storageFetchChannel')"
          :title="t('settingsExtra.storageFetch')"
          :disabled="channelFetchBusy"
          @click="void fetchChannelFromUrl()"
        >
          <Loader2 v-if="channelFetchBusy" :size="16" class="animate-spin" />
          <Download v-else :size="16" />
        </button>
      </div>
      <p class="mt-1 text-xs text-zinc-500">
        {{ t('settingsExtra.storageDynamicHint') }}
      </p>
      <p v-if="!(inventory?.channels?.length)" class="mt-3 text-sm text-zinc-500">{{ t('settingsExtra.storageNoChannelCaches') }}</p>
      <div class="mt-3 space-y-2">
        <div
          v-for="channel in inventory?.channels ?? []"
          :key="channel.channelId"
          class="rounded-lg border border-white/5 bg-inset"
        >
          <button
            class="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-start"
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
              <p class="truncate text-sm font-medium text-zinc-100">{{ channel.channelName || t('settingsExtra.storageUnknownChannel') }}</p>
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
                {{ t('settingsExtra.storageClearChannel') }}
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
                    {{ statusLabel(item.status) }} · {{ formatBytes(item.fileSize) }} ·
                    {{ formatDate(item.lastUsedAt || item.createdAt) }}
                  </p>
                </div>
                <button class="btn btn-danger cursor-pointer" type="button" :disabled="!item.cacheKey || item.busy" @click="deleteEntry(item.cacheKey)">
                  {{ t('common.delete') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div>
      <h3 class="section-label">{{ t('settingsExtra.storageTempSection') }}</h3>
      <SettingsRow
        :label="t('settingsExtra.storageCleanUnused')"
        :hint="t('settingsExtra.storageCleanUnusedHint')"
      >
        <button
          class="btn btn-ghost cursor-pointer"
          type="button"
          :disabled="Boolean(busyLabel)"
          @click="cleanTemp"
        >
          {{ t('settingsExtra.storageCleanNow') }}
        </button>
      </SettingsRow>
      <SettingsRow :label="t('settingsExtra.storageAutoAbandoned')" :hint="t('settingsExtra.storageAutoAbandonedHint')">
        <ToggleSwitch
          :model-value="store.storage.autoCleanAbandonedTemp"
          :aria-label="t('settingsExtra.storageAutoAbandonedAria')"
          @update:model-value="store.patchStorage({ autoCleanAbandonedTemp: $event })"
        />
      </SettingsRow>
    </div>

    <AppDialog :open="Boolean(confirm)" :title="confirm?.title || ''" @cancel="confirm = null">
      <p class="text-sm text-zinc-300">{{ confirm?.body }}</p>
      <template #actions>
        <button class="btn btn-ghost cursor-pointer" type="button" @click="confirm = null">{{ t('common.cancel') }}</button>
        <button class="btn btn-danger cursor-pointer" type="button" @click="confirmAction">{{ t('common.confirm') }}</button>
      </template>
    </AppDialog>
  </div>
</template>
