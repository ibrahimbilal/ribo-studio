import {
  defaultSubscribeAnimation,
  defaultSubscribeSizePercent,
  sanitizeSubscribeAnimation,
  SUBSCRIBE_ANIMATION_DURATION_SEC,
  SUBSCRIBE_ANIMATION_FPS,
  type SubscribeAnimationSettings,
  type SubscribeAnimationStyle,
} from '@shared/screensaverSubscribeAnimation'
import {
  cacheKeyInputFromSettings,
  resolveSubscribeAnimationCacheKey,
  type SubscribeAnimationCacheKeyPayload,
} from '@shared/subscribeAnimationCacheKey'
import type { SubscribeAnimationCachePrepStatus } from '@shared/subscribeAnimationCache'
import { isDynamicSubscribeAnimationStyle, staticSubscribeAnimationStyles } from '@shared/subscribeAnimationTemplates'
import { isYoutubeChannelId } from '@shared/youtubeChannelId'
import * as api from '../../../../lib/api'
import { useGlobalSettingsStore } from '../../../../stores/globalSettings'
import { resolveSubscribeAvatarContentHash } from './subscribeAnimationAvatarHash'
import { preloadSubscribeChannelAvatar } from './subscribeAnimationChannelAvatar'
import { renderSubscribeAnimationFrames } from './subscribeAnimationExportFrames'
import { subscribeAnimationLayout } from './subscribeAnimationLayout'

const LOG = '[SubscribeAnimationCache]'

export type SubscribeCacheStatusMap = Record<string, SubscribeAnimationCachePrepStatus>

interface PrepJob {
  cacheKey: string
  settings: SubscribeAnimationSettings
  outputWidth: number
  priority: number
  resolve: (key: string) => void
  reject: (error: unknown) => void
}

const statusByKey = new Map<string, SubscribeAnimationCachePrepStatus>()
const inFlight = new Map<string, Promise<string>>()
const queue: PrepJob[] = []
let running = false
let exportBusy = false
let statusListeners = new Set<() => void>()

function log(message: string): void {
  console.log(`${LOG} ${message}`)
}

export function subscribeCacheStatus(cacheKey: string | null | undefined): SubscribeAnimationCachePrepStatus {
  if (!cacheKey) return 'not_prepared'
  return statusByKey.get(cacheKey) ?? 'not_prepared'
}

export function markSubscribeCacheReady(cacheKey: string): void {
  setStatus(cacheKey, 'ready')
}

export function onSubscribeCacheStatusChange(listener: () => void): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

function notifyStatus(): void {
  for (const listener of statusListeners) listener()
}

function setStatus(cacheKey: string, status: SubscribeAnimationCachePrepStatus): void {
  statusByKey.set(cacheKey, status)
  notifyStatus()
}

export function setSubscribeCacheExportBusy(busy: boolean): void {
  exportBusy = busy
  if (!busy) void pump()
}

export async function resolveCurrentSubscribeCacheKey(
  settings: SubscribeAnimationSettings,
  outputWidth: number,
): Promise<{ key: string; payload: SubscribeAnimationCacheKeyPayload; avatarContentHash: string | null }> {
  const avatarContentHash = await resolveSubscribeAvatarContentHash(
    settings.channelAvatarUrl,
    settings.channelId,
  )
  const resolved = await resolveSubscribeAnimationCacheKey(
    cacheKeyInputFromSettings(settings, outputWidth, avatarContentHash),
  )
  return { key: resolved.key, payload: resolved.payload, avatarContentHash }
}

async function uploadFrames(
  settings: SubscribeAnimationSettings,
  outputWidth: number,
  cacheKey: string,
  payload: SubscribeAnimationCacheKeyPayload,
  frames: Blob[],
  signal?: AbortSignal,
): Promise<void> {
  const layout = subscribeAnimationLayout(settings, outputWidth)
  await api.uploadSubscribeAnimationCacheEntry({
    meta: {
      cacheKey,
      kind: payload.kind,
      templateId: settings.style,
      channelId: settings.channelId,
      width: layout.width,
      height: layout.height,
      fps: SUBSCRIBE_ANIMATION_FPS,
      durationSec: settings.durationSec || SUBSCRIBE_ANIMATION_DURATION_SEC,
      renderConfig: payload,
    },
    frames,
    signal,
  })
}

async function renderAndStore(
  settings: SubscribeAnimationSettings,
  outputWidth: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (isDynamicSubscribeAnimationStyle(settings.style) && !isYoutubeChannelId(settings.channelId)) {
    throw new Error('Register a YouTube channel before preparing the channel card animation cache.')
  }
  await preloadSubscribeChannelAvatar(settings.channelAvatarUrl, settings.channelId)
  const { key, payload } = await resolveCurrentSubscribeCacheKey(settings, outputWidth)
  const existing = await api.fetchSubscribeAnimationCacheStatus(key)
  if (existing.ready) {
    setStatus(key, 'ready')
    log(
      payload.kind === 'static'
        ? `Static cache HIT: ${settings.style}`
        : `Dynamic cache HIT: ${settings.channelId ?? 'unknown'}/${settings.style}`,
    )
    return key
  }
  log(
    payload.kind === 'static'
      ? `Static cache MISS: ${settings.style}`
      : `Dynamic cache MISS: ${settings.channelId ?? 'unknown'}/${settings.style}`,
  )
  setStatus(key, 'preparing')
  const started = performance.now()
  const frames = await renderSubscribeAnimationFrames(settings, outputWidth, onProgress)
  if (signal?.aborted) throw new DOMException('The animation prepare was cancelled.', 'AbortError')
  await uploadFrames(settings, outputWidth, key, payload, frames, signal)
  setStatus(key, 'ready')
  log(`Animation prepared in ${((performance.now() - started) / 1000).toFixed(1)}s`)
  return key
}

function enqueue(job: PrepJob): void {
  const existingIndex = queue.findIndex((item) => item.cacheKey === job.cacheKey)
  if (existingIndex >= 0) {
    const existing = queue[existingIndex]!
    if (job.priority > existing.priority) {
      queue.splice(existingIndex, 1)
      queue.unshift(job)
    } else {
      const prevResolve = existing.resolve
      const prevReject = existing.reject
      existing.resolve = (key) => {
        prevResolve(key)
        job.resolve(key)
      }
      existing.reject = (error) => {
        prevReject(error)
        job.reject(error)
      }
    }
    return
  }
  if (job.priority > 0) queue.unshift(job)
  else queue.push(job)
  setStatus(job.cacheKey, 'queued')
  log('Background render queued')
  void pump()
}

async function pump(): Promise<void> {
  if (running || exportBusy) return
  const next = queue.shift()
  if (!next) return
  running = true
  try {
    const key = await renderAndStore(next.settings, next.outputWidth)
    next.resolve(key)
  } catch (error) {
    setStatus(next.cacheKey, 'failed')
    next.reject(error)
  } finally {
    running = false
    void pump()
  }
}

export function queueSubscribeAnimationPrepare(
  settings: SubscribeAnimationSettings,
  outputWidth: number,
  options?: { priority?: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    void (async () => {
      try {
        if (!persistentCacheEnabled()) {
          reject(new Error('Persistent animation caching is disabled in Global Settings.'))
          return
        }
        const { key } = await resolveCurrentSubscribeCacheKey(settings, outputWidth)
        const inflight = inFlight.get(key)
        if (inflight) {
          log('Reusing existing rendering job')
          resolve(await inflight)
          return
        }
        const status = await api.fetchSubscribeAnimationCacheStatus(key)
        if (status.ready) {
          setStatus(key, 'ready')
          resolve(key)
          return
        }
        const promise = new Promise<string>((innerResolve, innerReject) => {
          enqueue({
            cacheKey: key,
            // Plain object copy — Vue reactive proxies cannot be structuredClone'd.
            settings: sanitizeSubscribeAnimation(settings),
            outputWidth,
            priority: options?.priority ?? 0,
            resolve: innerResolve,
            reject: innerReject,
          })
        })
        inFlight.set(key, promise)
        try {
          const result = await promise
          resolve(result)
        } catch (error) {
          reject(error)
        } finally {
          inFlight.delete(key)
        }
      } catch (error) {
        reject(error)
      }
    })()
  })
}

function persistentCacheEnabled(): boolean {
  try {
    return useGlobalSettingsStore().storage.persistentAnimationCacheEnabled
  } catch {
    return true
  }
}

export async function getOrRenderSubscribeAnimation(
  settings: SubscribeAnimationSettings,
  outputWidth: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ cacheKey: string; frames: Blob[] | null }> {
  setSubscribeCacheExportBusy(true)
  try {
    if (!persistentCacheEnabled()) {
      log('Persistent cache disabled; rendering frames for upload')
      const frames = await renderSubscribeAnimationFrames(settings, outputWidth, onProgress)
      return { cacheKey: '', frames }
    }
    const { key } = await resolveCurrentSubscribeCacheKey(settings, outputWidth)
    const inflight = inFlight.get(key)
    if (inflight) {
      log('Reusing existing rendering job')
      const cacheKey = await inflight
      return { cacheKey, frames: null }
    }
    const status = await api.fetchSubscribeAnimationCacheStatus(key)
    if (status.ready) {
      setStatus(key, 'ready')
      log('Cached animation reused without rendering')
      return { cacheKey: key, frames: null }
    }
    const promise = renderAndStore(settings, outputWidth, onProgress, signal)
    inFlight.set(key, promise)
    try {
      const cacheKey = await promise
      return { cacheKey, frames: null }
    } finally {
      inFlight.delete(key)
    }
  } catch (error) {
    log(`Cache prepare failed; falling back to upload path: ${error instanceof Error ? error.message : 'error'}`)
    const frames = await renderSubscribeAnimationFrames(settings, outputWidth, onProgress)
    return { cacheKey: '', frames }
  } finally {
    setSubscribeCacheExportBusy(false)
  }
}

export async function prepareDefaultStaticAnimations(outputWidth: number): Promise<void> {
  if (!persistentCacheEnabled()) {
    log('Persistent cache disabled; skipping static pre-render')
    return
  }
  const candidates: Array<{ cacheKey: string; templateId: SubscribeAnimationStyle; settings: SubscribeAnimationSettings }> = []
  for (const style of staticSubscribeAnimationStyles()) {
    const settings: SubscribeAnimationSettings = {
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
    const { key } = await resolveCurrentSubscribeCacheKey(settings, outputWidth)
    candidates.push({ cacheKey: key, templateId: style, settings })
  }
  const { missing } = await api.prepareStaticSubscribeAnimationHints(
    candidates.map(({ cacheKey, templateId }) => ({ cacheKey, templateId })),
  )
  const missingKeys = new Set(missing.map((item: { cacheKey: string }) => item.cacheKey))
  for (const item of candidates) {
    if (!missingKeys.has(item.cacheKey)) {
      setStatus(item.cacheKey, 'ready')
      continue
    }
    void queueSubscribeAnimationPrepare(item.settings, outputWidth, { priority: 0 }).catch(() => undefined)
  }
}

export async function rebuildSubscribeAnimation(
  settings: SubscribeAnimationSettings,
  outputWidth: number,
): Promise<string> {
  const { key } = await resolveCurrentSubscribeCacheKey(settings, outputWidth)
  try {
    await api.clearSubscribeAnimationCache({ scope: 'entry', cacheKey: key })
  } catch {
    // ignore
  }
  setStatus(key, 'not_prepared')
  return queueSubscribeAnimationPrepare(settings, outputWidth, { priority: 10 })
}
