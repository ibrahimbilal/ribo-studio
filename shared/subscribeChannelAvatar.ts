import { isYoutubeChannelId } from './youtubeChannelId'

/** Client + server path to a channel avatar stored under `server/tmp/subscribe-animation-cache/`. */
export function subscribeChannelCachedAvatarPath(channelId: string | null | undefined): string | null {
  if (!isYoutubeChannelId(channelId)) return null
  return `/api/screensaver/subscribe-animation-cache/channels/${encodeURIComponent(channelId)}/avatar`
}