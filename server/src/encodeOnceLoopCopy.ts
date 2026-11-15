/**
 * Encode-Once Loop-Copy helpers (Screensaver MP4 audio optimization).
 * Encode one destination-compatible period, verify, then packet-copy loop.
 * Fallback to STANDARD_PROCESSING when verification fails.
 */

import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { ffmpegBinary, ffprobeBinary } from './binaries'
import { aacEncodeArgs, ffmpegAudioPrefix, pcmBitrateBps } from './audioProcessing'
import { n, spawnFfmpeg, type FfmpegHooks } from './ffmpegUtil'
import { probeAudioDetails } from './probe'
import { assessFileDuration, streamCopyTrimToDuration } from './audioDurationRecovery'

const execFileAsync = promisify(execFile)

export const AAC_LC_FRAME_SAMPLES = 1024

export interface EncodeOnceSource {
  path: string
  sampleRate: number
  channels: number
  trimStart?: number
  trimEnd?: number
  duration: number
}

export interface EncodeOncePeriodOpts {
  sources: EncodeOnceSource[]
  outputPath: string
  sampleRate: number
  channels: number
  bitrateKbps: number
  volume?: number
  workDir: string
  hooks: FfmpegHooks
  /** Prefer direct filter→AAC (no WAV). Falls back to WAV intermediate on failure. */
  allowWavFallback?: boolean
  /** Pad period with silence to the next AAC-LC frame boundary before encode. */
  frameAlignPad?: boolean
  /**
   * Destination-compatible period codec. Prefer `mp3` when AAC packet looping
   * fails continuity (MP3-in-MP4 is already accepted by canStreamCopyIntoMp4).
   */
  periodCodec?: 'aac' | 'mp3'
}

export interface EncodeOnceLoopOpts {
  periodPath: string
  outputPath: string
  targetSeconds: number
  hooks: FfmpegHooks
}

export interface BoundaryCheckResult {
  ok: boolean
  reasons: string[]
  periodSeconds: number
  streamDuration: number
  containerDuration: number
  startTime: number
  packetCount: number
  frameAligned: boolean
  residualSamples: number
  /** Max abs PCM near first interior loop join (encode-once vs continuous), if compared. */
  maxAbsDiffNearJoin?: number
  rmsDiffNearJoin?: number
}

export interface ContinuityCompareResult {
  ok: boolean
  reasons: string[]
  maxAbsDiff: number
  rmsDiff: number
  joinIndexSeconds: number
  windowSeconds: number
}

function nullHooks(): FfmpegHooks {
  return {
    cancelled: () => false,
    onProgress: () => undefined,
    registerKill: () => undefined,
  }
}

export function aacFrameDurationSeconds(sampleRate: number): number {
  const rate = sampleRate > 0 ? sampleRate : 48000
  return AAC_LC_FRAME_SAMPLES / rate
}

export function analyzeAacFrameAlignment(
  periodSeconds: number,
  sampleRate: number,
): { frameAligned: boolean; residualSamples: number; frameCount: number } {
  const rate = sampleRate > 0 ? sampleRate : 48000
  const totalSamples = Math.round(periodSeconds * rate)
  const residualSamples = ((totalSamples % AAC_LC_FRAME_SAMPLES) + AAC_LC_FRAME_SAMPLES) % AAC_LC_FRAME_SAMPLES
  const frameCount = Math.floor(totalSamples / AAC_LC_FRAME_SAMPLES)
  return {
    frameAligned: residualSamples === 0,
    residualSamples,
    frameCount,
  }
}

/** Snap period length up to the next whole AAC-LC frame boundary. */
export function snapPeriodSecondsToAacFrames(periodSeconds: number, sampleRate: number): number {
  const rate = sampleRate > 0 ? sampleRate : 48000
  const samples = Math.max(AAC_LC_FRAME_SAMPLES, Math.ceil(periodSeconds * rate))
  const aligned = Math.ceil(samples / AAC_LC_FRAME_SAMPLES) * AAC_LC_FRAME_SAMPLES
  return aligned / rate
}

/** Build filter graph: trim/resample/concat one period to [aout]. */
export function buildPeriodFilterGraph(opts: {
  sources: EncodeOnceSource[]
  sampleRate: number
  channels: number
  volume?: number
  /** When set, pad concatenated period to this exact duration (AAC frame align). */
  padToSeconds?: number
}): string {
  const rate = Math.round(opts.sampleRate) || 48000
  const channels = Math.round(opts.channels) || 2
  const layout = channels === 1 ? 'mono' : channels === 2 ? 'stereo' : `${channels}c`
  const labels: string[] = []
  const lines: string[] = []

  opts.sources.forEach((source, index) => {
    const start = source.trimStart ?? 0
    const end = source.trimEnd ?? source.duration
    const parts = [
      `atrim=${n(start)}:${n(end)}`,
      'asetpts=PTS-STARTPTS',
      `aresample=${rate}`,
      `aformat=sample_fmts=fltp:channel_layouts=${layout}`,
    ]
    if (opts.volume != null && Math.abs(opts.volume - 1) > 0.001) {
      parts.push(`volume=${n(opts.volume)}`)
    }
    lines.push(`[${index}:a]${parts.join(',')}[a${index}]`)
    labels.push(`[a${index}]`)
  })

  const concatLabel = opts.padToSeconds && opts.padToSeconds > 0 ? '[apre]' : '[aout]'
  if (opts.sources.length === 1) {
    lines.push(`${labels[0]}anull${concatLabel}`)
  } else {
    lines.push(`${labels.join('')}concat=n=${opts.sources.length}:v=0:a=1${concatLabel}`)
  }
  if (opts.padToSeconds && opts.padToSeconds > 0) {
    lines.push(`[apre]apad=whole_dur=${n(opts.padToSeconds)},atrim=0:${n(opts.padToSeconds)},asetpts=PTS-STARTPTS[aout]`)
  }
  return lines.join(';\n')
}

async function atomicWriteFile(target: string, tempPath: string): Promise<void> {
  await rename(tempPath, target)
}

function siblingTemp(outputPath: string, tag: string): string {
  const ext = path.extname(outputPath) || '.m4a'
  const base = path.basename(outputPath, ext)
  return path.join(path.dirname(outputPath), `${base}.${tag}${ext}`)
}

/**
 * Encode one loop period directly to AAC/MP3-in-M4A (destination-compatible).
 * Avoids materializing a full-duration WAV; uses one-period filter graph.
 */
export async function encodeDestinationPeriod(opts: EncodeOncePeriodOpts): Promise<{
  outputPath: string
  usedWavIntermediate: boolean
  encodeInputDurationSeconds: number
  bitrateKbps: number
}> {
  await mkdir(opts.workDir, { recursive: true })
  const naturalPeriod = opts.sources.reduce((sum, source) => {
    const start = source.trimStart ?? 0
    const end = source.trimEnd ?? source.duration
    return sum + Math.max(0, end - start)
  }, 0)
  const periodSeconds = opts.frameAlignPad
    ? snapPeriodSecondsToAacFrames(naturalPeriod, opts.sampleRate)
    : naturalPeriod
  const filterPath = path.join(opts.workDir, 'period-filter.txt')
  const graph = buildPeriodFilterGraph({
    sources: opts.sources,
    sampleRate: opts.sampleRate,
    channels: opts.channels,
    volume: opts.volume,
    padToSeconds: opts.frameAlignPad ? periodSeconds : undefined,
  })
  await writeFile(filterPath, graph, 'utf8')

  const tempOut = siblingTemp(opts.outputPath, 'partial')
  await rm(tempOut, { force: true }).catch(() => undefined)

  const periodCodec = opts.periodCodec ?? 'aac'
  const encodeArgs =
    periodCodec === 'mp3'
      ? [
          '-c:a',
          'libmp3lame',
          '-b:a',
          `${Math.max(64, Math.round(opts.bitrateKbps))}k`,
          '-ar',
          String(Math.round(opts.sampleRate)),
          '-ac',
          String(Math.round(opts.channels)),
        ]
      : aacEncodeArgs({
          bitrateKbps: opts.bitrateKbps,
          sampleRate: opts.sampleRate,
          channels: opts.channels,
        })

  const args = [
    ...ffmpegAudioPrefix(),
    ...opts.sources.flatMap((source) => ['-i', source.path]),
    '-filter_complex_script',
    filterPath,
    '-map',
    '[aout]',
    ...encodeArgs,
    '-t',
    n(periodSeconds + 0.02),
    tempOut,
  ]

  try {
    await spawnFfmpeg(args, periodSeconds, opts.hooks)
    await atomicWriteFile(opts.outputPath, tempOut)
    return {
      outputPath: opts.outputPath,
      usedWavIntermediate: false,
      encodeInputDurationSeconds: periodSeconds,
      bitrateKbps: opts.bitrateKbps,
    }
  } catch (error) {
    await rm(tempOut, { force: true }).catch(() => undefined)
    if (opts.allowWavFallback === false) throw error

    // Safer fallback: one-period WAV then AAC (still not full-timeline encode).
    const wavPath = path.join(opts.workDir, 'period.wav')
    const wavArgs = [
      ...ffmpegAudioPrefix(),
      ...opts.sources.flatMap((source) => ['-i', source.path]),
      '-filter_complex_script',
      filterPath,
      '-map',
      '[aout]',
      '-c:a',
      'pcm_s16le',
      '-t',
      n(periodSeconds + 0.02),
      wavPath,
    ]
    await spawnFfmpeg(wavArgs, periodSeconds, opts.hooks)
    const aacArgs = [
      ...ffmpegAudioPrefix(),
      '-i',
      wavPath,
      ...encodeArgs,
      tempOut,
    ]
    await spawnFfmpeg(aacArgs, periodSeconds, opts.hooks)
    await atomicWriteFile(opts.outputPath, tempOut)
    return {
      outputPath: opts.outputPath,
      usedWavIntermediate: true,
      encodeInputDurationSeconds: periodSeconds,
      bitrateKbps: opts.bitrateKbps,
    }
  }
}

/**
 * Attempt to neutralize container start_time / encoder delay before packet looping.
 * Returns the path to use for looping (may be the original when start_time≈0).
 */
export async function stripContainerDelayForLoop(opts: {
  periodPath: string
  outputPath: string
  hooks: FfmpegHooks
}): Promise<{ path: string; stripped: boolean; startTime: number }> {
  const details = await probeAudioDetails(opts.periodPath)
  const startTime = details.startTime
  if (!(Math.abs(startTime) > 0.0005)) {
    return { path: opts.periodPath, stripped: false, startTime }
  }
  // Positive start_time: skip that many seconds. Negative: shift with avoid_negative_ts.
  const args = [...ffmpegAudioPrefix(), '-i', opts.periodPath]
  if (startTime > 0) {
    args.push('-ss', n(startTime))
  }
  args.push('-vn', '-map', '0:a:0', '-c:a', 'copy', '-avoid_negative_ts', 'make_zero', opts.outputPath)
  await spawnFfmpeg(args, Math.max(0.5, details.duration), opts.hooks)
  return { path: opts.outputPath, stripped: true, startTime }
}

/** Packet-copy repeat of a verified period to target duration, then packet-safe trim. */
export async function streamCopyLoopPeriod(opts: EncodeOnceLoopOpts): Promise<void> {
  const tempOut = siblingTemp(opts.outputPath, 'partial')
  let requestSeconds = opts.targetSeconds + 0.05
  let lastActual = 0

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await rm(tempOut, { force: true }).catch(() => undefined)
    await spawnFfmpeg(
      [
        ...ffmpegAudioPrefix(),
        '-stream_loop',
        '-1',
        '-i',
        opts.periodPath,
        '-t',
        n(requestSeconds),
        '-vn',
        '-map',
        '0:a:0',
        '-c:a',
        'copy',
        tempOut,
      ],
      opts.targetSeconds,
      opts.hooks,
    )

    const assessment = await assessFileDuration(tempOut, opts.targetSeconds)
    lastActual = assessment.actualSeconds

    if (assessment.verdict === 'ok') {
      await atomicWriteFile(opts.outputPath, tempOut)
      return
    }

    if (assessment.verdict === 'overshoot') {
      const trimmed = siblingTemp(opts.outputPath, 'trim')
      await streamCopyTrimToDuration({
        sourcePath: tempOut,
        outputPath: trimmed,
        targetSeconds: opts.targetSeconds,
        hooks: opts.hooks,
      })
      await rm(tempOut, { force: true }).catch(() => undefined)
      await atomicWriteFile(opts.outputPath, trimmed)
      return
    }

    // Undershoot: encoder delay / timestamp gaps shrink effective content — request more input time.
    const deficit = opts.targetSeconds - assessment.actualSeconds
    const grow = Math.max(deficit * 1.5, opts.targetSeconds * 0.01, 0.25)
    requestSeconds += grow
  }

  await rm(tempOut, { force: true }).catch(() => undefined)
  throw new Error(
    `Encode-once loop undershoot after retries: actual=${lastActual.toFixed(3)}s target=${opts.targetSeconds.toFixed(3)}s`,
  )
}

export async function probePacketStats(file: string): Promise<{
  packetCount: number
  firstPts: number | null
  lastPts: number | null
  firstDts: number | null
  lastDts: number | null
}> {
  const result = await execFileAsync(
    ffprobeBinary(),
    [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'packet=pts_time,dts_time,duration_time,size',
      '-of',
      'csv=p=0',
      file,
    ],
    { windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
  )
  const lines = result.stdout.split(/\r?\n/).filter(Boolean)
  let firstPts: number | null = null
  let lastPts: number | null = null
  let firstDts: number | null = null
  let lastDts: number | null = null
  for (const line of lines) {
    const [pts, dts] = line.split(',')
    const ptsN = pts != null && pts !== 'N/A' ? Number(pts) : NaN
    const dtsN = dts != null && dts !== 'N/A' ? Number(dts) : NaN
    if (Number.isFinite(ptsN)) {
      if (firstPts == null) firstPts = ptsN
      lastPts = ptsN
    }
    if (Number.isFinite(dtsN)) {
      if (firstDts == null) firstDts = dtsN
      lastDts = dtsN
    }
  }
  return { packetCount: lines.length, firstPts, lastPts, firstDts, lastDts }
}

/**
 * Structural gates on the encoded period before loop-copy.
 * Does not claim gapless continuity by itself — pair with compareDecodedJoinContinuity.
 */
export async function verifyEncodedPeriod(opts: {
  periodPath: string
  expectedPeriodSeconds: number
  sampleRate: number
  slackSeconds?: number
}): Promise<BoundaryCheckResult> {
  const reasons: string[] = []
  const details = await probeAudioDetails(opts.periodPath)
  const packets = await probePacketStats(opts.periodPath)
  const slack = opts.slackSeconds ?? Math.max(0.05, Math.min(0.5, opts.expectedPeriodSeconds * 0.01))
  const delta = details.duration - opts.expectedPeriodSeconds
  if (Math.abs(delta) > slack) {
    reasons.push(
      `Period duration ${details.duration.toFixed(3)}s vs expected ${opts.expectedPeriodSeconds.toFixed(3)}s (Δ=${delta.toFixed(3)}s)`,
    )
  }
  if (packets.packetCount < 1) reasons.push('Encoded period has no audio packets.')
  if (packets.firstPts != null && packets.lastPts != null && packets.lastPts < packets.firstPts) {
    reasons.push('Packet PTS not monotonic.')
  }

  const align = analyzeAacFrameAlignment(opts.expectedPeriodSeconds, opts.sampleRate)
  // Non-frame-aligned periods are allowed but flagged — continuity compare decides acceptance.
  if (!align.frameAligned) {
    reasons.push(
      `Period is not AAC-frame-aligned (residual ${align.residualSamples} samples @ ${opts.sampleRate} Hz).`,
    )
  }

  // Frame alignment warning alone should not hard-fail here; caller uses continuity compare.
  const hardFail = reasons.filter((r) => !r.includes('not AAC-frame-aligned'))
  return {
    ok: hardFail.length === 0,
    reasons,
    periodSeconds: details.duration,
    streamDuration: details.streamDuration,
    containerDuration: details.containerDuration,
    startTime: details.startTime,
    packetCount: packets.packetCount,
    frameAligned: align.frameAligned,
    residualSamples: align.residualSamples,
  }
}

/** Decode a PCM window (s16le mono downmix) around a timestamp for analysis. */
export async function decodePcmWindow(opts: {
  file: string
  startSeconds: number
  durationSeconds: number
  sampleRate: number
  workPath: string
}): Promise<Int16Array> {
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    n(Math.max(0, opts.startSeconds)),
    '-t',
    n(opts.durationSeconds),
    '-i',
    opts.file,
    '-ac',
    '1',
    '-ar',
    String(Math.round(opts.sampleRate)),
    '-f',
    's16le',
    opts.workPath,
  ]
  await execFileAsync(ffmpegBinary(), args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
  const buf = await readFile(opts.workPath)
  return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2))
}

function pcmStats(a: Int16Array, b: Int16Array): { maxAbsDiff: number; rmsDiff: number } {
  const len = Math.min(a.length, b.length)
  if (len === 0) return { maxAbsDiff: 0, rmsDiff: 0 }
  let maxAbs = 0
  let sumSq = 0
  for (let i = 0; i < len; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    const ad = Math.abs(d)
    if (ad > maxAbs) maxAbs = ad
    sumSq += d * d
  }
  return { maxAbsDiff: maxAbs, rmsDiff: Math.sqrt(sumSq / len) }
}

export interface ContinuityCompareResultExtended extends ContinuityCompareResult {
  baselineRmsDiff: number
  baselineMaxAbsDiff: number
  joinVsBaselineRatio: number
}

/**
 * Compare decoded audio around the first loop join between encode-once output
 * and a continuous full-timeline encode reference.
 *
 * Independent lossy encodes are never bit-identical. We measure a mid-period
 * baseline (no splice) and only fail when the join is substantially worse.
 */
export async function compareDecodedJoinContinuity(opts: {
  encodeOncePath: string
  continuousPath: string
  periodSeconds: number
  sampleRate: number
  workDir: string
  /** Half-window on each side of the join. */
  windowSeconds?: number
  /** Fail when join RMS exceeds baseline RMS × this factor (and above floor). */
  joinVsBaselineFactor?: number
  /** Absolute RMS floor below which join is always accepted. */
  rmsFloor?: number
  /** Absolute peak floor. */
  absFloor?: number
}): Promise<ContinuityCompareResultExtended> {
  const window = opts.windowSeconds ?? 0.08
  const join = opts.periodSeconds
  const duration = window * 2
  await mkdir(opts.workDir, { recursive: true })

  async function windowAt(label: string, center: number): Promise<{ maxAbsDiff: number; rmsDiff: number }> {
    const start = Math.max(0, center - window)
    const once = await decodePcmWindow({
      file: opts.encodeOncePath,
      startSeconds: start,
      durationSeconds: duration,
      sampleRate: opts.sampleRate,
      workPath: path.join(opts.workDir, `${label}.once.s16`),
    })
    const cont = await decodePcmWindow({
      file: opts.continuousPath,
      startSeconds: start,
      durationSeconds: duration,
      sampleRate: opts.sampleRate,
      workPath: path.join(opts.workDir, `${label}.cont.s16`),
    })
    return pcmStats(once, cont)
  }

  // Baseline: middle of first period (no packet splice).
  const baselineCenter = Math.min(opts.periodSeconds * 0.5, Math.max(window * 2, opts.periodSeconds - window * 3))
  const baseline = await windowAt('baseline', baselineCenter)
  const joinStats = await windowAt('join', join)

  const factor = opts.joinVsBaselineFactor ?? 2.5
  const rmsFloor = opts.rmsFloor ?? 4000
  const absFloor = opts.absFloor ?? 16000
  const ratio = baseline.rmsDiff > 1 ? joinStats.rmsDiff / baseline.rmsDiff : joinStats.rmsDiff
  const reasons: string[] = []

  if (joinStats.rmsDiff > Math.max(rmsFloor, baseline.rmsDiff * factor)) {
    reasons.push(
      `Join RMS diff ${joinStats.rmsDiff.toFixed(1)} exceeds max(floor=${rmsFloor}, baseline ${baseline.rmsDiff.toFixed(1)}×${factor})`,
    )
  }
  if (joinStats.maxAbsDiff > Math.max(absFloor, baseline.maxAbsDiff * factor)) {
    reasons.push(
      `Join peak abs ${joinStats.maxAbsDiff} exceeds max(floor=${absFloor}, baseline ${baseline.maxAbsDiff}×${factor})`,
    )
  }

  // Near-silence spike unique to encode-once at the join.
  const onceJoin = await decodePcmWindow({
    file: opts.encodeOncePath,
    startSeconds: Math.max(0, join - 0.01),
    durationSeconds: 0.02,
    sampleRate: opts.sampleRate,
    workPath: path.join(opts.workDir, 'silence.once.s16'),
  })
  const contJoin = await decodePcmWindow({
    file: opts.continuousPath,
    startSeconds: Math.max(0, join - 0.01),
    durationSeconds: 0.02,
    sampleRate: opts.sampleRate,
    workPath: path.join(opts.workDir, 'silence.cont.s16'),
  })
  let onceEnergy = 0
  let contEnergy = 0
  for (let i = 0; i < onceJoin.length; i += 1) onceEnergy += Math.abs(onceJoin[i] ?? 0)
  for (let i = 0; i < contJoin.length; i += 1) contEnergy += Math.abs(contJoin[i] ?? 0)
  const onceMean = onceJoin.length ? onceEnergy / onceJoin.length : 0
  const contMean = contJoin.length ? contEnergy / contJoin.length : 0
  if (contMean > 500 && onceMean < contMean * 0.05) {
    reasons.push(`Encode-once join near-silent vs continuous (meanAbs ${onceMean.toFixed(1)} vs ${contMean.toFixed(1)})`)
  }

  return {
    ok: reasons.length === 0,
    reasons,
    maxAbsDiff: joinStats.maxAbsDiff,
    rmsDiff: joinStats.rmsDiff,
    baselineRmsDiff: baseline.rmsDiff,
    baselineMaxAbsDiff: baseline.maxAbsDiff,
    joinVsBaselineRatio: ratio,
    joinIndexSeconds: join,
    windowSeconds: window,
  }
}

/** Current production-like path: period WAV then continuous AAC encode for full target. */
export async function encodeStandardFullTimeline(opts: {
  sources: EncodeOnceSource[]
  sampleRate: number
  channels: number
  bitrateKbps: number
  targetSeconds: number
  volume?: number
  workDir: string
  outputPath: string
  hooks?: FfmpegHooks
}): Promise<{ outputPath: string; wavBytes: number; encodeInputDurationSeconds: number }> {
  const hooks = opts.hooks ?? nullHooks()
  await mkdir(opts.workDir, { recursive: true })
  const filterPath = path.join(opts.workDir, 'std-filter.txt')
  await writeFile(
    filterPath,
    buildPeriodFilterGraph({
      sources: opts.sources,
      sampleRate: opts.sampleRate,
      channels: opts.channels,
      volume: opts.volume,
    }),
    'utf8',
  )
  const periodSeconds = opts.sources.reduce((sum, source) => {
    const start = source.trimStart ?? 0
    const end = source.trimEnd ?? source.duration
    return sum + Math.max(0, end - start)
  }, 0)
  const wavPath = path.join(opts.workDir, 'period.wav')
  await spawnFfmpeg(
    [
      ...ffmpegAudioPrefix(),
      ...opts.sources.flatMap((source) => ['-i', source.path]),
      '-filter_complex_script',
      filterPath,
      '-map',
      '[aout]',
      '-c:a',
      'pcm_s16le',
      '-t',
      n(periodSeconds + 0.02),
      wavPath,
    ],
    periodSeconds,
    hooks,
  )
  const wavBytes = (await stat(wavPath)).size
  await spawnFfmpeg(
    [
      ...ffmpegAudioPrefix(),
      '-stream_loop',
      '-1',
      '-i',
      wavPath,
      '-t',
      n(opts.targetSeconds),
      ...aacEncodeArgs({
        bitrateKbps: opts.bitrateKbps,
        sampleRate: opts.sampleRate,
        channels: opts.channels,
      }),
      opts.outputPath,
    ],
    opts.targetSeconds,
    hooks,
  )
  return {
    outputPath: opts.outputPath,
    wavBytes,
    encodeInputDurationSeconds: opts.targetSeconds,
  }
}

export async function fileSha256(file: string): Promise<string> {
  const buf = await readFile(file)
  return createHash('sha256').update(buf).digest('hex')
}

export { pcmBitrateBps }
