import {
  defaultSubscribeAnimation,
  defaultSubscribeSizePercent,
  type SubscribeAnimationSettings,
} from '@shared/screensaverSubscribeAnimation'
import * as api from '../../../../lib/api'
import { ingestSubscribeChannelAvatar } from './subscribeAnimationChannelAvatar'
import { resolveSubscribeAvatarContentHash } from './subscribeAnimationAvatarHash'
import {
  type SubscribeChannelPreference,
  upsertSubscribeChannelPreference,
} from './subscribeAnimationChannelPreference'
import { queueSubscribeAnimationPrepare } from './subscribeAnimationCachePrep'

export interface RegisteredSubscribeChannel {
  settings: Pick<
    SubscribeAnimationSettings,
    | 'channelUrl'
    | 'channelId'
    | 'channelName'
    | 'channelAvatarUrl'
    | 'channelSubscriberCount'
    | 'channelCardTheme'
  >
  preference: SubscribeChannelPreference | null
  lookup: api.YoutubeChannelLookupResult
}

/** Lookup a YouTube URL, upsert server + local channel prefs, optionally warm the channel-card cache. */
export async function registerSubscribeChannelFromYoutubeUrl(
  rawUrl: string,
  options?: {
    channelCardTheme?: SubscribeAnimationSettings['channelCardTheme']
    /** When set, queue a channel-card cache prepare at this output width. */
    prepareCacheWidth?: number | null
  },
): Promise<RegisteredSubscribeChannel> {
  const target = rawUrl.trim()
  if (!target) throw new Error('Paste a YouTube channel or video link first.')

  const lookup = await api.lookupYoutubeChannel(target)
  await ingestSubscribeChannelAvatar(lookup.avatarUrl, lookup.avatarDataUrl)
  const avatarContentHash = await resolveSubscribeAvatarContentHash(lookup.avatarUrl)
  const channelCardTheme = options?.channelCardTheme === 'dark' ? 'dark' : 'light'

  if (lookup.channelId) {
    try {
      await api.upsertSubscribeAnimationChannel({
        channelId: lookup.channelId,
        channelName: lookup.channelName,
        channelUrl: lookup.channelUrl,
        subscriberCount: lookup.subscriberCount,
        avatarContentHash,
        avatarUrl: lookup.avatarUrl,
      })
    } catch {
      // Channel metadata cache is best-effort.
    }
  }

  const settings: RegisteredSubscribeChannel['settings'] = {
    channelUrl: lookup.channelUrl ?? target,
    channelId: lookup.channelId,
    channelName: lookup.channelName ?? '',
    channelAvatarUrl: lookup.avatarUrl,
    channelSubscriberCount: lookup.subscriberCount,
    channelCardTheme,
  }

  const preference = upsertSubscribeChannelPreference(settings, { select: true })

  const prepareWidth = options?.prepareCacheWidth
  if (prepareWidth && lookup.channelId) {
    const prepSettings: SubscribeAnimationSettings = {
      ...defaultSubscribeAnimation(),
      channelName: settings.channelName || preference?.channelName || '',
      startSec: 0,
      sizePercent: defaultSubscribeSizePercent('channel-card'),
      style: 'channel-card',
      previewOnCanvas: false,
      channelCardTheme,
      channelUrl: settings.channelUrl,
      channelId: settings.channelId,
      channelAvatarUrl: settings.channelAvatarUrl,
      channelSubscriberCount: settings.channelSubscriberCount,
    }
    void queueSubscribeAnimationPrepare(prepSettings, prepareWidth, { priority: 10 }).catch(() => undefined)
  }

  return { settings, preference, lookup }
}
