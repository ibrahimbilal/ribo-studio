import { stat } from 'node:fs/promises'
import { execFileAsync, ffprobeBinary } from './binaries'

export interface Probe {
  duration: number
  width: number
  height: number
  hasAudio: boolean
  hasVideo: boolean
  codec: string | null
  size: number
}

interface ProbeStream {
  codec_type?: string
  codec_name?: string
  profile?: string
  pix_fmt?: string
  width?: number
  height?: number
  channels?: number
  channel_layout?: string
  sample_rate?: string
  sample_fmt?: string
  bits_per_sample?: number
  bits_per_raw_sample?: string
  bit_rate?: string
  duration?: string
  tags?: { rotate?: string }
  disposition?: { attached_pic?: number }
  side_data_list?: { rotation?: number }[]
}

interface ProbeJson {
  streams?: ProbeStream[]
  format?: {
    duration?: string
    start_time?: string
    bit_rate?: string
    format_name?: string
    size?: string
  }
}

export interface SourceDetails {
  codec: string | null
  pixFmt: string | null
  audioCodec: string | null
  width: number
  height: number
  duration: number
  startTime: number
}

export async function probeMedia(file: string): Promise<Probe> {
  const data = await readProbe(file)
  const streams = data.streams ?? []
  const video = streams.find((stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1)
  const hasAudio = streams.some((stream) => stream.codec_type === 'audio')
  const duration = positiveNumber(video?.duration) || positiveNumber(data.format?.duration)
  const info = await stat(file)

  if (!video || !video.width || !video.height || !duration) {
    throw new Error('This file does not contain a readable video stream.')
  }

  const rotation = streamRotation(video)
  const swap = rotation === 90 || rotation === 270
  return {
    duration,
    width: swap ? video.height : video.width,
    height: swap ? video.width : video.height,
    hasAudio,
    hasVideo: true,
    codec: video.codec_name ?? null,
    size: info.size,
  }
}

export async function probeSourceDetails(file: string): Promise<SourceDetails> {
  const data = await readProbe(file)
  const streams = data.streams ?? []
  const video = streams.find((stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1) ?? streams.find((stream) => stream.codec_type === 'video')
  const audio = streams.find((stream) => stream.codec_type === 'audio')
  return {
    codec: video?.codec_name ?? null,
    pixFmt: video?.pix_fmt ?? null,
    audioCodec: audio?.codec_name ?? null,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    duration: positiveNumber(video?.duration) || positiveNumber(data.format?.duration),
    startTime: finiteNumber(data.format?.start_time),
  }
}

export async function probeImage(file: string): Promise<{ width: number; height: number }> {
  const data = await readProbe(file)
  const stream =
    (data.streams ?? []).find((s) => s.codec_type === 'video') ??
    (data.streams ?? []).find((s) => s.codec_type === 'video' || s.codec_name === 'png' || s.codec_name === 'mjpeg')
  if (!stream?.width || !stream.height) {
    throw new Error('This image could not be read.')
  }
  return { width: stream.width, height: stream.height }
}

export type SniffedKind = 'jpeg' | 'png' | 'webp' | 'mp4' | 'mov' | 'webm' | null

export async function sniffMediaKind(filePath: string): Promise<SniffedKind> {
  const { readFile } = await import('node:fs/promises')
  const head = await readFile(filePath)
  const view = head.subarray(0, 16)
  if (view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) return 'jpeg'
  if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4e && view[3] === 0x47) return 'png'
  if (view[0] === 0x52 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x46 && view[8] === 0x57) return 'webp'
  if (view[4] === 0x66 && view[5] === 0x74 && view[6] === 0x79 && view[7] === 0x70) {
    const brand = head.subarray(8, 12).toString('ascii')
    if (brand.includes('qt')) return 'mov'
    return 'mp4'
  }
  if (view[0] === 0x1a && view[1] === 0x45 && view[2] === 0xdf && view[3] === 0xa3) return 'webm'
  return null
}

export async function probeStill(file: string): Promise<{ width: number; height: number }> {
  const data = await readProbe(file)
  const video = (data.streams ?? []).find((stream) => stream.codec_type === 'video')
  if (!video?.width || !video.height) {
    throw new Error('A title overlay was unreadable. Try the export again.')
  }
  return { width: video.width, height: video.height }
}

export type AudioBitrateMode = 'cbr' | 'vbr' | 'unknown'

export interface AudioDetails {
  /**
   * Preferred content duration for verification: stream duration when present,
   * otherwise container duration (may include padding / encoder delay).
   */
  duration: number
  /** Audio stream duration from ffprobe (0 when missing). */
  streamDuration: number
  /** Container/format duration from ffprobe (0 when missing). */
  containerDuration: number
  /** Container start_time (encoder delay / priming offset); may be negative. */
  startTime: number
  codec: string | null
  codecProfile: string | null
  /** Container / format name from ffprobe (e.g. mp3, wav, mov,mp4,m4a). */
  formatName: string | null
  channels: number
  channelLayout: string | null
  sampleRate: number
  sampleFmt: string | null
  bitsPerSample: number
  /** Stream bit_rate when present (bits/sec); 0 if missing. */
  streamBitrate: number
  /** Container format bit_rate when present (bits/sec); 0 if missing. */
  containerBitrate: number
  /**
   * Preferred bitrate for planning: stream bitrate when available, else container.
   * 0 when unknown — never invent a constant bitrate.
   */
  bitrate: number
  bitrateMode: AudioBitrateMode
  size: number
}

function inferBitrateMode(streamBitrate: number, containerBitrate: number): AudioBitrateMode {
  if (streamBitrate > 0) return 'cbr'
  if (containerBitrate > 0) return 'vbr'
  return 'unknown'
}

export async function probeAudioDetails(file: string): Promise<AudioDetails> {
  const data = await readProbe(file)
  const audio = (data.streams ?? []).find((stream) => stream.codec_type === 'audio')
  const streamDuration = positiveNumber(audio?.duration)
  const containerDuration = positiveNumber(data.format?.duration)
  const startTime = finiteNumber(data.format?.start_time)
  const duration = streamDuration || containerDuration
  if (!audio || !duration) throw new Error('This file does not contain a readable audio stream.')
  const info = await stat(file)
  const channels = Number.isFinite(audio.channels) ? Number(audio.channels) : 0
  const layout =
    typeof audio.channel_layout === 'string' && audio.channel_layout.trim()
      ? audio.channel_layout.trim()
      : null
  const streamBitrate = positiveNumber(audio.bit_rate)
  const containerBitrate = positiveNumber(data.format?.bit_rate)
  const bitrate = streamBitrate || containerBitrate || 0
  const bitsPerSample =
    (Number.isFinite(audio.bits_per_sample) && (audio.bits_per_sample ?? 0) > 0
      ? Number(audio.bits_per_sample)
      : 0) || positiveNumber(audio.bits_per_raw_sample) || 0
  return {
    duration,
    streamDuration,
    containerDuration,
    startTime,
    codec: audio.codec_name ?? null,
    codecProfile: typeof audio.profile === 'string' && audio.profile.trim() ? audio.profile.trim() : null,
    formatName: data.format?.format_name ?? null,
    channels,
    channelLayout: layout,
    sampleRate: positiveNumber(audio.sample_rate),
    sampleFmt: typeof audio.sample_fmt === 'string' && audio.sample_fmt.trim() ? audio.sample_fmt.trim() : null,
    bitsPerSample,
    streamBitrate,
    containerBitrate,
    bitrate,
    bitrateMode: inferBitrateMode(streamBitrate, containerBitrate),
    size: info.size,
  }
}

export async function probeAudioFile(file: string): Promise<{ duration: number }> {
  const data = await readProbe(file)
  const audio = (data.streams ?? []).find((stream) => stream.codec_type === 'audio')
  const duration = positiveNumber(audio?.duration) || positiveNumber(data.format?.duration)
  if (!audio || !duration) throw new Error('The background music file does not contain readable audio.')
  return { duration }
}

async function readProbe(file: string): Promise<ProbeJson> {
  try {
    const result = await execFileAsync(
      ffprobeBinary(),
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      { windowsHide: true, maxBuffer: 20 * 1024 * 1024 },
    )
    return JSON.parse(result.stdout) as ProbeJson
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr ?? '').trim() : ''
    console.error(`ffprobe failed for ${file}: ${stderr || (error instanceof Error ? error.message : 'unknown error')}`)
    throw new Error('This file could not be read. It may be corrupted or use an unsupported format.')
  }
}

function positiveNumber(value: string | undefined): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return parsed
}

function finiteNumber(value: string | undefined): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function streamRotation(stream: ProbeStream): number {
  const tag = Math.abs(Math.round(Number(stream.tags?.rotate ?? 0)))
  if (tag) return tag % 360
  const side = stream.side_data_list?.find((entry) => typeof entry.rotation === 'number')
  return Math.abs(Math.round(side?.rotation ?? 0)) % 360
}
