import type { SubscribeAnimationStyle } from '@shared/screensaverSubscribeAnimation'

/** Style id → `screensaver.settings.subscribe.styles.*` path (no prefix). */
export const SUBSCRIBE_STYLE_I18N: Record<SubscribeAnimationStyle, string> = {
  'channel-card': 'settings.subscribe.styles.channelCard',
  'subscribe-only': 'settings.subscribe.styles.subscribeOnly',
  'subscribe-alerts': 'settings.subscribe.styles.subscribeAlerts',
  'like-subscribe-alerts': 'settings.subscribe.styles.likeSubscribeAlerts',
}