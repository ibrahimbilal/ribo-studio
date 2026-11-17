import {
  defaultSubscribeAnimation,
  sanitizeSubscribeAnimation,
  type SubscribeAnimationSettings,
} from '@shared/screensaverSubscribeAnimation'
import { youtubeHandleFromUrl } from '@shared/youtubeChannel'
import { isYoutubeChannelId } from '@shared/youtubeChannelId'
import type { YoutubeChannelBackupRecord } from '@shared/settingsBackup'

const STORAGE_KEY = 'ribo-screensaver-subscribe-channels'

type SubscribeChannelsListener = () => void
const channelListeners = new Set<SubscribeChannelsListener>()

/** Notify when saved YouTube channels change (Global Settings fetch, project select, etc.). */
export function onSubscribeChannelsChanged(listener: SubscribeChannelsListener): () => void {
  channelListeners.add(listener)
  return () => {
    channelListeners.delete(listener)
  }
}

function emitSubscribeChannelsChanged(): void {
  for (const listener of channelListeners) {
    try {
      listener()
    } catch {
      // Ignore listener failures.
    }
  }
}

export interface SubscribeChannelPreference {
  channelId: string
  channelName: string
  channelHandle: string | null
  channelUrl: string
  channelAvatarUrl: string | null
  channelSubscriberCount: string | null
  channelCardTheme?: SubscribeAnimationSettings['channelCardTheme']
  updatedAt: number
}

interface SubscribeChannelStore {
  selectedChannelId: string | null
  channels: SubscribeChannelPreference[]
}

function emptyStore(): SubscribeChannelStore {
  return { selectedChannelId: null, channels: [] }
}

function normalizeChannel(raw: Partial<SubscribeChannelPreference> | null | undefined): SubscribeChannelPreference | null {
  if (!raw || !isYoutubeChannelId(raw.channelId)) return null
  const channelId = raw.channelId
  const channelName =
    typeof raw.channelName === 'string' && raw.channelName.trim()
      ? raw.channelName.trim().slice(0, 80)
      : channelId
  const channelUrl =
    typeof raw.channelUrl === 'string' && raw.channelUrl.trim()
      ? raw.channelUrl.trim().slice(0, 600)
      : `https://www.youtube.com/channel/${channelId}`
  const handleFromField =
    typeof raw.channelHandle === 'string' && raw.channelHandle.trim()
      ? raw.channelHandle.trim().replace(/^@/, '').slice(0, 64)
      : null
  return {
    channelId,
    channelName,
    channelHandle: handleFromField ?? youtubeHandleFromUrl(channelUrl),
    channelUrl,
    channelAvatarUrl:
      typeof raw.channelAvatarUrl === 'string' && raw.channelAvatarUrl.trim()
        ? raw.channelAvatarUrl.trim().slice(0, 500)
        : null,
    channelSubscriberCount:
      typeof raw.channelSubscriberCount === 'string' && raw.channelSubscriberCount.trim()
        ? raw.channelSubscriberCount.trim().slice(0, 48)
        : null,
    channelCardTheme: raw.channelCardTheme === 'dark' ? 'dark' : 'light',
    updatedAt: Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : Date.now(),
  }
}

/** Merge server-cached channels into localStorage so the dropdown matches disk cache. */
export function mergeSubscribeChannelsFromServer(
  serverChannels: Array<{
    channelId: string
    channelName?: string | null
    channelUrl?: string | null
    subscriberCount?: string | null
    avatarUrl?: string | null
    updatedAt?: number
  }>,
): SubscribeChannelPreference[] {
  const store = readStore()
  const byId = new Map(store.channels.map((item) => [item.channelId, item]))
  for (const remote of serverChannels) {
    if (!isYoutubeChannelId(remote.channelId)) continue
    const existing = byId.get(remote.channelId)
    const remoteUpdated = Number.isFinite(remote.updatedAt) ? Number(remote.updatedAt) : 0
    const localUpdated = existing?.updatedAt ?? 0
    // Prefer the newer side so a local Refresh is not clobbered by stale server meta.
    const preferLocal = Boolean(existing && localUpdated > remoteUpdated)
    const merged = normalizeChannel(
      preferLocal
        ? {
            ...existing,
            channelUrl: existing!.channelUrl || remote.channelUrl || undefined,
            channelAvatarUrl: existing!.channelAvatarUrl ?? remote.avatarUrl ?? null,
            channelSubscriberCount: existing!.channelSubscriberCount ?? remote.subscriberCount ?? null,
            channelName: existing!.channelName || remote.channelName || existing!.channelId,
            updatedAt: localUpdated,
          }
        : {
            channelId: remote.channelId,
            channelName: remote.channelName ?? existing?.channelName ?? remote.channelId,
            channelHandle: existing?.channelHandle ?? null,
            channelUrl: remote.channelUrl ?? existing?.channelUrl ?? undefined,
            channelAvatarUrl: remote.avatarUrl ?? existing?.channelAvatarUrl ?? null,
            channelSubscriberCount: remote.subscriberCount ?? existing?.channelSubscriberCount ?? null,
            channelCardTheme: existing?.channelCardTheme ?? 'light',
            updatedAt: Math.max(localUpdated, remoteUpdated, Date.now()),
          },
    )
    if (merged) byId.set(merged.channelId, merged)
  }
  const channels = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  // Never steal the user's selected channel during a server sync.
  const selectedChannelId =
    store.selectedChannelId && byId.has(store.selectedChannelId)
      ? store.selectedChannelId
      : store.selectedChannelId && !byId.has(store.selectedChannelId)
        ? channels[0]?.channelId ?? null
        : store.selectedChannelId ?? channels[0]?.channelId ?? null
  writeStore({ selectedChannelId, channels })
  emitSubscribeChannelsChanged()
  return channels
}

function readStore(): SubscribeChannelStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      // Migrate legacy single-channel key.
      const legacy = localStorage.getItem('ribo-screensaver-subscribe-channel')
      if (!legacy) return emptyStore()
      const single = normalizeChannel(JSON.parse(legacy) as Partial<SubscribeChannelPreference>)
      if (!single) return emptyStore()
      const migrated: SubscribeChannelStore = { selectedChannelId: single.channelId, channels: [single] }
      writeStore(migrated)
      try {
        localStorage.removeItem('ribo-screensaver-subscribe-channel')
      } catch {
        // ignore
      }
      return migrated
    }
    const data = JSON.parse(raw) as Partial<SubscribeChannelStore> & Partial<SubscribeChannelPreference>
    // Legacy accidental single-object under new key.
    if (data.channelId && !Array.isArray(data.channels)) {
      const single = normalizeChannel(data)
      if (!single) return emptyStore()
      return { selectedChannelId: single.channelId, channels: [single] }
    }
    const channels = Array.isArray(data.channels)
      ? data.channels.map((item) => normalizeChannel(item)).filter((item): item is SubscribeChannelPreference => Boolean(item))
      : []
    const selectedChannelId =
      typeof data.selectedChannelId === 'string' && isYoutubeChannelId(data.selectedChannelId)
        ? data.selectedChannelId
        : channels[0]?.channelId ?? null
    if (selectedChannelId && !channels.some((item) => item.channelId === selectedChannelId)) {
      return { selectedChannelId: channels[0]?.channelId ?? null, channels }
    }
    return { selectedChannelId, channels }
  } catch {
    return emptyStore()
  }
}

function writeStore(store: SubscribeChannelStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // localStorage may be blocked.
  }
}

export function listSubscribeChannelPreferences(): SubscribeChannelPreference[] {
  return [...readStore().channels].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getSelectedSubscribeChannelId(): string | null {
  return readStore().selectedChannelId
}

/** Alias: selected channel is the Global Settings default channel. */
export function getDefaultSubscribeChannelId(): string | null {
  return getSelectedSubscribeChannelId()
}

export function readSubscribeChannelPreference(channelId?: string | null): SubscribeChannelPreference | null {
  const store = readStore()
  const id = channelId ?? store.selectedChannelId
  if (!id) return null
  return store.channels.find((item) => item.channelId === id) ?? null
}

export function selectSubscribeChannelPreference(channelId: string): SubscribeChannelPreference | null {
  const store = readStore()
  const found = store.channels.find((item) => item.channelId === channelId)
  if (!found) return null
  const channels = store.channels.map((item) =>
    item.channelId === channelId ? { ...item, updatedAt: Date.now() } : item,
  )
  writeStore({ channels, selectedChannelId: channelId })
  emitSubscribeChannelsChanged()
  return channels.find((item) => item.channelId === channelId) ?? found
}

export function setDefaultSubscribeChannel(channelId: string): SubscribeChannelPreference | null {
  return selectSubscribeChannelPreference(channelId)
}

export function upsertSubscribeChannelPreference(
  settings: Partial<
    Pick<
      SubscribeAnimationSettings,
      'channelId' | 'channelName' | 'channelUrl' | 'channelAvatarUrl' | 'channelSubscriberCount' | 'channelCardTheme'
    >
  > & {
    channelId?: string | null
    channelHandle?: string | null
  },
  options?: { select?: boolean },
): SubscribeChannelPreference | null {
  const next = normalizeChannel({
    channelId: settings.channelId ?? undefined,
    channelName: settings.channelName,
    channelHandle: settings.channelHandle ?? youtubeHandleFromUrl(settings.channelUrl),
    channelUrl: settings.channelUrl ?? undefined,
    channelAvatarUrl: settings.channelAvatarUrl,
    channelSubscriberCount: settings.channelSubscriberCount,
    channelCardTheme: settings.channelCardTheme,
    updatedAt: Date.now(),
  })
  if (!next) return null
  const store = readStore()
  const index = store.channels.findIndex((item) => item.channelId === next.channelId)
  const channels = [...store.channels]
  if (index >= 0) {
    const prev = channels[index]!
    channels[index] = {
      ...prev,
      ...next,
      // Preserve previously valid metadata when a refresh omits fields.
      channelAvatarUrl: next.channelAvatarUrl ?? prev.channelAvatarUrl,
      channelSubscriberCount: next.channelSubscriberCount ?? prev.channelSubscriberCount,
      channelHandle: next.channelHandle ?? prev.channelHandle,
      updatedAt: Date.now(),
    }
  } else {
    channels.push(next)
  }
  const select = options?.select !== false
  writeStore({
    channels,
    selectedChannelId: select ? next.channelId : store.selectedChannelId ?? next.channelId,
  })
  emitSubscribeChannelsChanged()
  return channels.find((item) => item.channelId === next.channelId) ?? next
}

/**
 * Remove a channel from the registry. Does not delete Subscribe Animation caches.
 * Returns false when the channel is missing.
 */
export function removeSubscribeChannelPreference(channelId: string): boolean {
  if (!isYoutubeChannelId(channelId)) return false
  const store = readStore()
  if (!store.channels.some((item) => item.channelId === channelId)) return false
  const channels = store.channels.filter((item) => item.channelId !== channelId)
  const selectedChannelId =
    store.selectedChannelId === channelId ? channels[0]?.channelId ?? null : store.selectedChannelId
  writeStore({ channels, selectedChannelId })
  emitSubscribeChannelsChanged()
  return true
}

export function applyChannelPreferenceToSettings(
  base: SubscribeAnimationSettings,
  pref: SubscribeChannelPreference,
): SubscribeAnimationSettings {
  return sanitizeSubscribeAnimation({
    ...base,
    channelId: pref.channelId,
    channelName: pref.channelName,
    channelUrl: pref.channelUrl,
    channelAvatarUrl: pref.channelAvatarUrl,
    channelSubscriberCount: pref.channelSubscriberCount,
    channelCardTheme: pref.channelCardTheme ?? base.channelCardTheme,
  })
}

/** Defaults for a new/blank project, using the selected saved channel when available. */
export function defaultSubscribeAnimationWithPreference(): SubscribeAnimationSettings {
  const base = defaultSubscribeAnimation()
  const pref = readSubscribeChannelPreference()
  if (!pref) return base
  return applyChannelPreferenceToSettings(base, pref)
}

export function rememberSubscribeChannelFromSettings(settings: SubscribeAnimationSettings): void {
  upsertSubscribeChannelPreference(settings, { select: true })
}

export function exportChannelsForBackup(): {
  channels: YoutubeChannelBackupRecord[]
  defaultChannelId: string | null
} {
  const store = readStore()
  return {
    defaultChannelId: store.selectedChannelId,
    channels: store.channels.map((channel) => ({
      channelId: channel.channelId,
      channelName: channel.channelName,
      channelHandle: channel.channelHandle,
      channelUrl: channel.channelUrl,
      channelAvatarUrl: channel.channelAvatarUrl,
      channelSubscriberCount: channel.channelSubscriberCount,
      updatedAt: channel.updatedAt,
    })),
  }
}

export function importChannelsFromBackup(options: {
  channels: YoutubeChannelBackupRecord[]
  defaultChannelId?: string | null
  replaceExisting?: boolean
}): void {
  const store = options.replaceExisting ? emptyStore() : readStore()
  const byId = new Map(store.channels.map((item) => [item.channelId, item]))
  for (const incoming of options.channels) {
    const normalized = normalizeChannel({
      channelId: incoming.channelId,
      channelName: incoming.channelName,
      channelHandle: incoming.channelHandle,
      channelUrl: incoming.channelUrl,
      channelAvatarUrl: incoming.channelAvatarUrl,
      channelSubscriberCount: incoming.channelSubscriberCount,
      updatedAt: incoming.updatedAt,
      channelCardTheme: byId.get(incoming.channelId)?.channelCardTheme ?? 'light',
    })
    if (!normalized) continue
    const existing = byId.get(normalized.channelId)
    if (existing) {
      byId.set(normalized.channelId, {
        ...existing,
        ...normalized,
        channelAvatarUrl: normalized.channelAvatarUrl ?? existing.channelAvatarUrl,
        channelSubscriberCount: normalized.channelSubscriberCount ?? existing.channelSubscriberCount,
        channelHandle: normalized.channelHandle ?? existing.channelHandle,
        updatedAt: Math.max(existing.updatedAt, normalized.updatedAt),
      })
    } else {
      byId.set(normalized.channelId, normalized)
    }
  }
  const channels = [...byId.values()]
  let selectedChannelId = store.selectedChannelId
  if (options.defaultChannelId && byId.has(options.defaultChannelId)) {
    // Deterministic: keep existing default unless none set.
    if (!selectedChannelId || !byId.has(selectedChannelId)) {
      selectedChannelId = options.defaultChannelId
    }
  }
  if (selectedChannelId && !byId.has(selectedChannelId)) {
    selectedChannelId = channels[0]?.channelId ?? null
  }
  writeStore({ channels, selectedChannelId })
  emitSubscribeChannelsChanged()
}

/** Fields that affect Subscribe Animation cache identity / painted channel chrome. */
export function channelMetadataAffectsCache(
  before: SubscribeChannelPreference | null,
  after: SubscribeChannelPreference | null,
): boolean {
  if (!before || !after) return false
  if (before.channelId !== after.channelId) return true
  return (
    before.channelName !== after.channelName ||
    before.channelAvatarUrl !== after.channelAvatarUrl ||
    before.channelSubscriberCount !== after.channelSubscriberCount
  )
}
