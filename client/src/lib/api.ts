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

export function screensaverAudioUrl(id: string): string {
  return `/api/screensaver/audio/${id}`
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
