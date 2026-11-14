import type { SubscribeAnimationStyle } from './screensaverSubscribeAnimation'

/** Bump when draw/timeline/mouse code changes pixels for the same settings. */
export const SUBSCRIBE_ANIMATION_RENDERER_VERSION = 1

/** Bump when cache manifest schema or on-disk layout changes incompatibly. */
export const SUBSCRIBE_ANIMATION_CACHE_SCHEMA_VERSION = 1

export const SUBSCRIBE_ANIMATION_CACHE_FORMAT = 'png-seq' as const

export type SubscribeAnimationTemplateKind = 'static' | 'dynamic'

export type SubscribeAnimationChannelDep = 'channelName' | 'channelAvatar' | 'channelSubscriberCount' | 'channelCardTheme'

export interface SubscribeAnimationTemplateMeta {
  id: SubscribeAnimationStyle
  kind: SubscribeAnimationTemplateKind
  /** Channel fields that affect rendered pixels for this template. */
  channelDeps: readonly SubscribeAnimationChannelDep[]
}

export const SUBSCRIBE_ANIMATION_TEMPLATES: readonly SubscribeAnimationTemplateMeta[] = [
  { id: 'subscribe-only', kind: 'static', channelDeps: [] },
  { id: 'subscribe-alerts', kind: 'static', channelDeps: [] },
  { id: 'like-subscribe-alerts', kind: 'static', channelDeps: [] },
  {
    id: 'channel-card',
    kind: 'dynamic',
    channelDeps: ['channelName', 'channelAvatar', 'channelSubscriberCount', 'channelCardTheme'],
  },
] as const

export function subscribeAnimationTemplateMeta(style: SubscribeAnimationStyle): SubscribeAnimationTemplateMeta {
  const found = SUBSCRIBE_ANIMATION_TEMPLATES.find((item) => item.id === style)
  if (found) return found
  return { id: style, kind: 'static', channelDeps: [] }
}

export function isStaticSubscribeAnimationStyle(style: SubscribeAnimationStyle): boolean {
  return subscribeAnimationTemplateMeta(style).kind === 'static'
}

export function isDynamicSubscribeAnimationStyle(style: SubscribeAnimationStyle): boolean {
  return subscribeAnimationTemplateMeta(style).kind === 'dynamic'
}

export function staticSubscribeAnimationStyles(): SubscribeAnimationStyle[] {
  return SUBSCRIBE_ANIMATION_TEMPLATES.filter((item) => item.kind === 'static').map((item) => item.id)
}
