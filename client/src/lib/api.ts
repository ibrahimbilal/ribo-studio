export interface ServerClip {
  id: string
  duration: number
  width: number
  height: number
  hasAudio: boolean
  size: number
  codec?: string | null
}

export interface ImportResult {
  ok: true
  platform: 'youtube' | 'tiktok' | 'instagram'
  url: string
  title: string | null
  thumbnail: string | null
  canDownload: false
  message: string
}

export interface JobStatus {
  id: string
  kind?: 'ranking' | 'screensaver' | 'audio-looper' | 'image-motion'
  outputExt?: string
  status: 'queued' | 'preparing' | 'rendering' | 'verifying' | 'done' | 'error' | 'cancelled'
  progress: number
  message: string
  error: string | null
  warning: string | null
  outputBytes: number | null
  outputDuration: number | null
  outputChannels?: number | null
  outputSampleRate?: number | null
  outputBitrate?: number | null
  outputCodec?: string | null
  outputChannelLayout?: string | null
  processingStrategy?: string | null
  processingLabel?: string | null
  lossyEncodeCount?: number | null
  queuePosition: number
  downloadName: string
  encoder?: string | null
  hardware?: boolean | null
  encodeFps?: number | null
  encodeSpeed?: number | null
  elapsedSec?: number | null
  etaSec?: number | null
  stage?: string | null
}

export interface AudioProbeDetails {
  duration: number
  codec: string | null
  codecProfile?: string | null
  formatName: string | null
  channels: number
  channelLayout: string | null
  sampleRate: number
  sampleFmt?: string | null
  bitsPerSample?: number
  streamBitrate?: number
  containerBitrate?: number
  bitrate: number
  bitrateMode?: 'cbr' | 'vbr' | 'unknown'
  size: number
}

export interface EncoderCatalog {
  version: string
  encoders: { id: string; label: string; hardware: boolean; listed: boolean; verified: boolean; detail: string | null }[]
  autoStill: string | null
  autoMotion: string | null
}

export async function health(): Promise<boolean> {
  try {
    const response = await fetch('/api/health')
    if (!response.ok) return false
    const data = (await response.json()) as { ok?: boolean; ffmpeg?: boolean }
    return Boolean(data.ok && data.ffmpeg)
  } catch {
    return false
  }
}

export function uploadClip(file: File, onProgress: (fraction: number) => void): Promise<ServerClip> {
  const body = new FormData()
  body.append('file', file, file.name)
  return sendForm<ServerClip>('/api/clips', body, onProgress)
}

export async function clipExists(id: string): Promise<boolean> {
  const response = await fetch(`/api/clips/${id}`)
  return response.ok
}

export async function deleteClip(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await fetch(`/api/clips/${id}`, { method: 'DELETE' })
  if (response.ok) return { ok: true }
  return { ok: false, error: await readError(response) }
}

export async function importUrl(url: string): Promise<ImportResult> {
  const response = await fetch('/api/import-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as ImportResult
}

export interface YoutubeChannelLookupResult {
  ok: true
  channelName: string | null
  channelUrl: string | null
  channelId: string | null
  avatarUrl: string | null
  avatarDataUrl: string | null
  subscriberCount: string | null
  source: 'video-oembed' | 'channel-page'
}

export async function lookupYoutubeChannel(url: string): Promise<YoutubeChannelLookupResult> {
  const response = await fetch('/api/youtube-channel-lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as YoutubeChannelLookupResult
}

export function startExport(body: FormData, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<{ jobId: string }> {
  return sendForm('/api/export', body, onProgress, signal)
}

export interface ScreensaverMedia {
  id: string
  kind: 'image' | 'video'
  duration: number | null
  width: number
  height: number
  hasAudio: boolean
  size: number
}

export interface ImageMotionMedia {
  id: string
  width: number
  height: number
  size: number
}

export function uploadImageMotionMedia(file: File, onProgress: (fraction: number) => void): Promise<ImageMotionMedia> {
  const body = new FormData()
  body.append('file', file, file.name)
  return sendForm<ImageMotionMedia>('/api/image-motion/media', body, onProgress)
}

export async function imageMotionMediaExists(id: string): Promise<boolean> {
  const response = await fetch(`/api/clips/${id}`)
  return response.ok
}

export function startImageMotionExport(
  body: FormData,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<{ jobId: string }> {
  return sendForm('/api/image-motion/export', body, onProgress, signal)
}

export function uploadScreensaverMedia(file: File, onProgress: (fraction: number) => void): Promise<ScreensaverMedia> {
  const body = new FormData()
  body.append('file', file, file.name)
  return sendForm<ScreensaverMedia>('/api/screensaver/media', body, onProgress)
}

export interface ScreensaverAudioAssetTrack {
  index: number
  name: string
  duration: number
  trimStart: number
  trimEnd: number
}

export interface ScreensaverAudioAsset {
  id: string
  name: string
  mimeType: string
  size: number
  duration: number
  codec: string | null
  sampleRate: number
  channels: number
  bitrate?: number
  origin: 'upload' | 'looper' | 'looper-plan'
  sourceJobId: string | null
  sourceApp: 'screensaver' | 'audio-looper'
  hasRecipe?: boolean
  trackCount?: number
  tracks?: ScreensaverAudioAssetTrack[]
  createdAt: number
}

export function uploadScreensaverAudio(
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<ScreensaverAudioAsset> {
  const body = new FormData()
  body.append('file', file, file.name)
  return sendForm<ScreensaverAudioAsset>('/api/screensaver/audio', body, onProgress, signal)
}

export async function adoptLooperAudioForScreensaver(jobId: string): Promise<ScreensaverAudioAsset> {
  const response = await fetch('/api/screensaver/audio/from-job', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId }),
  })
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as ScreensaverAudioAsset
}

/** Upload original Looper sources + settings so Screensaver can encode once (or stream-copy). */
export async function uploadLooperPlanForScreensaver(
  files: File[],
  settings: unknown,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<ScreensaverAudioAsset> {
  const body = new FormData()
  for (const file of files) body.append('files', file, file.name)
  body.append('settings', JSON.stringify(settings))
  return sendForm<ScreensaverAudioAsset>('/api/screensaver/audio/from-looper-plan', body, onProgress ?? (() => undefined), signal)
}

/** Clone a looper-plan recipe with a new track order (server hardlinks sources). */
export async function cloneLooperPlanOrderForScreensaver(
  assetId: string,
  order: number[],
): Promise<ScreensaverAudioAsset> {
  const response = await fetch(`/api/screensaver/audio/${encodeURIComponent(assetId)}/clone-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order }),
  })
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as ScreensaverAudioAsset
}

export function screensaverAudioUrl(id: string): string {
  return `/api/screensaver/audio/${id}`
}

export function screensaverAudioTrackUrl(id: string, index: number): string {
  return `/api/screensaver/audio/${encodeURIComponent(id)}/track/${index}`
}

export async function fetchScreensaverAudioMeta(id: string): Promise<ScreensaverAudioAsset | null> {
  const response = await fetch(`/api/screensaver/audio/${id}?meta=1`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as ScreensaverAudioAsset
}

export async function deleteScreensaverAudio(id: string): Promise<void> {
  const response = await fetch(`/api/screensaver/audio/${id}`, { method: 'DELETE' })
  if (response.status === 404) return
  if (!response.ok) throw new Error(await readError(response))
}

export interface ScreensaverFrame {
  id: string
  name: string
  width: number
  height: number
}

export function screensaverFrameUrl(id: string): string {
  return `/api/screensaver/frames/${id}`
}

export async function listScreensaverFrames(): Promise<ScreensaverFrame[]> {
  const response = await fetch('/api/screensaver/frames')
  if (!response.ok) throw new Error(await readError(response))
  const data = (await response.json()) as { frames?: ScreensaverFrame[] }
  return data.frames ?? []
}

export function uploadScreensaverFrame(file: File): Promise<ScreensaverFrame> {
  const body = new FormData()
  body.append('file', file, file.name)
  return sendForm<ScreensaverFrame>('/api/screensaver/frames', body)
}

export async function deleteScreensaverFrame(id: string): Promise<void> {
  const response = await fetch(`/api/screensaver/frames/${id}`, { method: 'DELETE' })
  if (!response.ok) throw new Error(await readError(response))
}

export interface ServerUploadCleanup {
  /** When true (default), remove frames, clips, and export outputs on the server. */
  purgeAll?: boolean
  /** Finished export job to delete from server/tmp/outputs immediately. */
  jobId?: string | null
  mediaId?: string | null
  frameIds?: string[]
}

/** @deprecated Use ServerUploadCleanup */
export type ScreensaverUploadCleanup = ServerUploadCleanup

const UPLOAD_CLEANUP_URL = '/api/uploads/cleanup'

export async function cleanupServerUploads(payload: ServerUploadCleanup): Promise<void> {
  const response = await fetch(UPLOAD_CLEANUP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(await readError(response))
}

export function beaconCleanupServerUploads(payload: ServerUploadCleanup): void {
  const body = JSON.stringify(payload)
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    navigator.sendBeacon(UPLOAD_CLEANUP_URL, new Blob([body], { type: 'application/json' }))
    return
  }
  void fetch(UPLOAD_CLEANUP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => undefined)
}

export const cleanupScreensaverUploads = cleanupServerUploads
export const beaconCleanupScreensaverUploads = beaconCleanupServerUploads

export async function fetchTempStorageBytes(): Promise<number> {
  const response = await fetch('/api/storage/temp')
  if (!response.ok) throw new Error(await readError(response))
  const data = (await response.json()) as { bytes?: number }
  return typeof data.bytes === 'number' && Number.isFinite(data.bytes) ? data.bytes : 0
}

export async function cleanTempStorage(): Promise<number> {
  const response = await fetch('/api/storage/temp/clean', { method: 'POST' })
  if (!response.ok) throw new Error(await readError(response))
  const data = (await response.json()) as { bytes?: number }
  return typeof data.bytes === 'number' && Number.isFinite(data.bytes) ? data.bytes : 0
}

export async function fetchEncoders(): Promise<EncoderCatalog> {
  const response = await fetch('/api/encoders')
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as EncoderCatalog
}

export async function screensaverEncoders(): Promise<EncoderCatalog> {
  return fetchEncoders()
}

export function startScreensaverExport(
  body: FormData,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<{ jobId: string }> {
  return sendForm('/api/screensaver/export', body, onProgress, signal)
}

export function startAudioLooperExport(
  body: FormData,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<{ jobId: string }> {
  return sendForm('/api/audio-looper/export', body, onProgress, signal)
}

/** FFprobe metadata for an uploaded looper source (used when browser decode skips channel info). */
export async function probeLooperAudio(file: File, signal?: AbortSignal): Promise<AudioProbeDetails> {
  const body = new FormData()
  body.append('file', file, file.name)
  const response = await fetch('/api/audio-looper/probe', { method: 'POST', body, signal })
  if (!response.ok) {
    let message = `Request failed (${response.status}).`
    try {
      const data = (await response.json()) as { error?: string }
      if (data.error) message = data.error
    } catch {
      // Body was not JSON.
    }
    throw new Error(message)
  }
  return (await response.json()) as AudioProbeDetails
}

export async function getJob(id: string): Promise<JobStatus> {
  const response = await fetch(`/api/jobs/${id}`)
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as JobStatus
}

export async function fetchJob(id: string): Promise<JobStatus | null> {
  const response = await fetch(`/api/jobs/${id}`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as JobStatus
}

export async function listRecoverableJobs(): Promise<JobStatus[]> {
  const response = await fetch('/api/jobs/active')
  if (!response.ok) throw new Error(await readError(response))
  const data = (await response.json()) as { jobs?: JobStatus[] }
  return data.jobs ?? []
}

export async function cancelJob(id: string): Promise<void> {
  await fetch(`/api/jobs/${id}/cancel`, { method: 'POST' }).catch(() => undefined)
}

export interface SubscribeAnimationCacheEntry {
  cacheKey: string
  kind: 'static' | 'dynamic'
  templateId: string
  channelId: string | null
  frameCount: number
  width: number
  height: number
  fileSize: number
  createdAt: number
  lastUsedAt: number
  ready: true
}

export interface SubscribeAnimationCacheStats {
  totalBytes: number
  staticCount: number
  dynamicCount: number
  channelCount: number
  channels: Array<{
    channelId: string
    channelName: string | null
    bytes: number
    animationCount: number
    lastUsedAt: number | null
  }>
  maxBytes: number
}

export async function fetchSubscribeAnimationCacheStatus(
  cacheKey: string,
): Promise<{ ready: boolean; entry?: SubscribeAnimationCacheEntry }> {
  const response = await fetch(`/api/screensaver/subscribe-animation-cache/status?key=${encodeURIComponent(cacheKey)}`)
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as { ready: boolean; entry?: SubscribeAnimationCacheEntry }
}

export async function fetchSubscribeAnimationCacheStats(): Promise<SubscribeAnimationCacheStats> {
  const response = await fetch('/api/screensaver/subscribe-animation-cache/stats')
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as SubscribeAnimationCacheStats
}

export async function prepareStaticSubscribeAnimationHints(
  candidates: Array<{ cacheKey: string; templateId: string }>,
): Promise<{ missing: Array<{ cacheKey: string; templateId: string }> }> {
  const response = await fetch('/api/screensaver/subscribe-animation-cache/prepare-static', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidates }),
  })
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as { missing: Array<{ cacheKey: string; templateId: string }> }
}

export async function upsertSubscribeAnimationChannel(meta: {
  channelId: string
  channelName: string | null
  channelUrl: string | null
  subscriberCount: string | null
  avatarContentHash: string | null
  avatarUrl: string | null
}): Promise<void> {
  const response = await fetch('/api/screensaver/subscribe-animation-cache/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(meta),
  })
  if (!response.ok) throw new Error(await readError(response))
}

export interface SubscribeAnimationChannelCacheMeta {
  channelId: string
  channelName: string | null
  channelUrl: string | null
  subscriberCount: string | null
  avatarContentHash: string | null
  avatarUrl: string | null
  updatedAt: number
  fromCache?: boolean
}

export async function fetchSubscribeAnimationChannel(
  channelId: string,
): Promise<SubscribeAnimationChannelCacheMeta | null> {
  const response = await fetch(`/api/screensaver/subscribe-animation-cache/channels/${encodeURIComponent(channelId)}`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as SubscribeAnimationChannelCacheMeta
}

export async function listSubscribeAnimationChannels(): Promise<SubscribeAnimationChannelCacheMeta[]> {
  const response = await fetch('/api/screensaver/subscribe-animation-cache/channels')
  if (!response.ok) throw new Error(await readError(response))
  const data = (await response.json()) as { channels?: SubscribeAnimationChannelCacheMeta[] }
  return Array.isArray(data.channels) ? data.channels : []
}

export async function uploadSubscribeAnimationCacheEntry(options: {
  meta: Record<string, unknown>
  frames: Blob[]
  signal?: AbortSignal
}): Promise<SubscribeAnimationCacheEntry> {
  const body = new FormData()
  body.append('meta', JSON.stringify(options.meta))
  options.frames.forEach((blob, index) => {
    body.append('frames', blob, `frame-${String(index).padStart(4, '0')}.png`)
  })
  return sendForm('/api/screensaver/subscribe-animation-cache/entries', body, undefined, options.signal)
}

export async function clearSubscribeAnimationCache(scope: {
  scope: 'all' | 'static' | 'channel' | 'entry'
  channelId?: string
  cacheKey?: string
}): Promise<{ removed: number }> {
  const response = await fetch('/api/screensaver/subscribe-animation-cache/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(scope),
  })
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as { removed: number }
}

export async function fetchSubscribeAnimationCacheInventory(): Promise<SubscribeAnimationCacheInventory> {
  const response = await fetch('/api/screensaver/subscribe-animation-cache/inventory')
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as SubscribeAnimationCacheInventory
}

export interface SubscribeAnimationCacheInventoryEntry {
  cacheKey: string | null
  templateId: string
  name: string
  kind: 'static' | 'dynamic'
  status: 'cached' | 'not_cached' | 'outdated' | 'rendering' | 'failed'
  fileSize: number
  createdAt: number | null
  lastUsedAt: number | null
  channelId: string | null
  channelName: string | null
  channelCardTheme: string | null
  width: number | null
  height: number | null
  frameCount: number | null
  busy: boolean
}

export interface SubscribeAnimationCacheChannelGroup {
  channelId: string
  channelName: string | null
  channelAvatarUrl: string | null
  animationCount: number
  totalBytes: number
  lastUpdatedAt: number | null
  animations: SubscribeAnimationCacheInventoryEntry[]
}

export interface SubscribeAnimationCacheInventory {
  staticAnimations: SubscribeAnimationCacheInventoryEntry[]
  channels: SubscribeAnimationCacheChannelGroup[]
  entries: SubscribeAnimationCacheInventoryEntry[]
}

export interface StorageOverview {
  totalTempBytes: number
  temporaryFilesBytes: number
  subscribeAnimationCacheBytes: number
  staticAnimationCacheBytes: number
  dynamicAnimationCacheBytes: number
  availableDiskBytes: number | null
  cacheDirectory: string
  temporaryDirectory: string
  refreshedAt: number
}

export async function fetchStorageOverview(refresh = false): Promise<StorageOverview> {
  const response = await fetch(`/api/storage/overview${refresh ? '?refresh=1' : ''}`)
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as StorageOverview
}

export interface SystemInfo {
  appName: string
  version: string
  os: string
  platform: string
  arch: string
  cpuModel: string
  cpuCount: number
  totalRamBytes: number
  availableRamBytes: number | null
  gpu: string[]
  ffmpegVersion: string | null
  ffprobeVersion: string | null
  upscalerEngines: Array<{ id: string; available: boolean; label: string }>
  hardwareEncoders: Array<{ id: string; label: string; verified: boolean }>
  enginePaths?: {
    ffmpeg: string | null
    ffprobe: string | null
  }
  capabilities: {
    canOpenPaths: boolean
    sleepPrevention: false
    configurableTempDir: false
    maxFfmpegConcurrency: 1
    fileSystemAccessApiLikely: boolean
  }
  paths: {
    temporaryDirectory: string
    cacheDirectory: string
    logsDirectory: string | null
  }
  repositoryUrl: string
  homepageUrl: string
}

export async function fetchSystemInfo(): Promise<SystemInfo> {
  const response = await fetch('/api/system/info')
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as SystemInfo
}

export async function openSystemPath(target: 'temp' | 'cache' | 'logs'): Promise<{ ok: true; path: string }> {
  const response = await fetch('/api/system/open-path', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target }),
  })
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as { ok: true; path: string }
}

export async function fetchGlobalSettings(): Promise<import('@shared/globalSettings').ServerGlobalSettings> {
  const response = await fetch('/api/global-settings')
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as import('@shared/globalSettings').ServerGlobalSettings
}

export async function putGlobalSettings(
  payload: import('@shared/globalSettings').ServerGlobalSettings,
): Promise<import('@shared/globalSettings').ServerGlobalSettings> {
  const response = await fetch('/api/global-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as import('@shared/globalSettings').ServerGlobalSettings
}

function sendForm<T>(url: string, body: FormData, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const fail = (error: Error) => reject(error)
    xhr.open('POST', url)
    xhr.responseType = 'json'
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / Math.max(1, event.total))
    }
    xhr.onload = () => {
      const data = (xhr.response ?? parseJson(xhr.responseText)) as { error?: string }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as T)
        return
      }
      fail(new Error(data?.error || `Request failed (${xhr.status}).`))
    }
    xhr.onerror = () => fail(new Error('Cannot reach the renderer. Make sure the server is running.'))
    xhr.onabort = () => fail(new DOMException('The upload was cancelled.', 'AbortError'))
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(body)
  })
}

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string }
    if (data.error) return data.error
  } catch {
    // The body was not JSON.
  }
  return `Request failed (${response.status}).`
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
