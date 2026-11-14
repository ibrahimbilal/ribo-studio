import {
  defaultSubscribeAnimation,
  sanitizeSubscribeAnimation,
  type SubscribeAnimationSettings,
} from '@shared/screensaverSubscribeAnimation'
import { isYoutubeChannelId } from '@shared/youtubeChannelId'

const STORAGE_KEY = 'ribo-screensaver-subscribe-channels'

export interface SubscribeChannelPreference {
  channelId: string
  channelName: string
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
  return {
    channelId,
    channelName,
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
    const merged = normalizeChannel({
      channelId: remote.channelId,
      channelName: remote.channelName ?? existing?.channelName ?? remote.channelId,
      channelUrl: remote.channelUrl ?? existing?.channelUrl ?? null,
      channelAvatarUrl: remote.avatarUrl ?? existing?.channelAvatarUrl ?? null,
      channelSubscriberCount: remote.subscriberCount ?? existing?.channelSubscriberCount ?? null,
      channelCardTheme: existing?.channelCardTheme ?? 'light',
      updatedAt: Math.max(existing?.updatedAt ?? 0, remote.updatedAt ?? 0, Date.now()),
    })
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
  return channels.find((item) => item.channelId === channelId) ?? found
}

export function upsertSubscribeChannelPreference(
  settings: Pick<
    SubscribeAnimationSettings,
    'channelId' | 'channelName' | 'channelUrl' | 'channelAvatarUrl' | 'channelSubscriberCount' | 'channelCardTheme'
  >,
  options?: { select?: boolean },
): SubscribeChannelPreference | null {
  const next = normalizeChannel({
    ...settings,
    updatedAt: Date.now(),
  })
  if (!next) return null
  const store = readStore()
  const index = store.channels.findIndex((item) => item.channelId === next.channelId)
  const channels = [...store.channels]
  if (index >= 0) channels[index] = { ...channels[index]!, ...next, updatedAt: Date.now() }
  else channels.push(next)
  const select = options?.select !== false
  writeStore({
    channels,
    selectedChannelId: select ? next.channelId : store.selectedChannelId ?? next.channelId,
  })
  return next
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
