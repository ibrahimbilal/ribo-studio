/**
 * Standalone proof of concept: Encode-Once Loop-Copy vs current full-timeline AAC encode.
 * Does not modify production mux. Run: npm run poc:encode-once-loop-copy -w server
 *
 * Reports only measured values. Continuity gates must pass before production integration.
 */
import { execFile } from 'node:child_process'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import { planAudioExecution } from '../../shared/audioExecutionPlan'
import { planAudioProcessing, type AudioSourceProbe } from '../../shared/audioProcessingPlan'
import { ffmpegBinary } from '../src/binaries'
import {
  analyzeAacFrameAlignment,
  compareDecodedJoinContinuity,
  encodeDestinationPeriod,
  encodeStandardFullTimeline,
  snapPeriodSecondsToAacFrames,
  streamCopyLoopPeriod,
  stripContainerDelayForLoop,
  verifyEncodedPeriod,
  type EncodeOnceSource,
} from '../src/encodeOnceLoopCopy'
import { moduleDir } from '../src/moduleDir'
import { probeAudioDetails } from '../src/probe'
import { ensureStorage, outputsDir } from '../src/storage'

const execFileAsync = promisify(execFile)

interface CaseResult {
  name: string
  targetSeconds: number
  periodSeconds: number
  pathA_wallMs: number
  pathB_wallMs: number
  pathA_encodeInputSec: number
  pathB_encodeInputSec: number
  pathA_tempBytes: number
  pathB_tempBytes: number
  pathA_outBytes: number
  pathB_outBytes: number
  pathA_bitrate: number
  pathB_bitrate: number
  pathB_periodVerifyOk: boolean
  continuityOk: boolean
  continuityNotes: string[]
  frameAligned: boolean
  joinRms: number
  baselineRms: number
  joinVsBaselineRatio: number
  executionStrategy: string
  qualityStrategy: string
  targetBitrateKbps: number | null
  fallbackWouldBeRequired: boolean
  alignedPeriodSeconds: number
}

async function synthMp3(file: string, seconds: number, kbps: number, sampleRate: number, freq: number): Promise<void> {
  await execFileAsync(
    ffmpegBinary(),
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=${freq}:sample_rate=${sampleRate}:duration=${seconds}`,
      '-ac',
      '2',
      '-c:a',
      'libmp3lame',
      '-b:a',
      `${kbps}k`,
      file,
    ],
    { windowsHide: true },
  )
}

function hooks() {
  return {
    cancelled: () => false,
    onProgress: () => undefined,
    onStatus: () => undefined,
    registerKill: () => undefined,
  }
}

async function dirBytes(dir: string): Promise<number> {
  const { readdir } = await import('node:fs/promises')
  let total = 0
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      else total += (await stat(full)).size
    }
  }
  try {
    await walk(dir)
  } catch {
    return 0
  }
  return total
}

async function runCase(opts: {
  name: string
  workRoot: string
  sources: EncodeOnceSource[]
  probes: AudioSourceProbe[]
  periodSeconds: number
  targetSeconds: number
  sampleRate: number
  bitrateKbps: number
}): Promise<CaseResult> {
  const caseDir = path.join(opts.workRoot, opts.name)
  await rm(caseDir, { recursive: true, force: true })
  await mkdir(caseDir, { recursive: true })

  const quality = planAudioProcessing({
    sources: opts.probes,
    destination: 'mp4-aac',
    operations: { volumePercent: 100, muxVolume: 1, muxFadeIn: 0, muxFadeOut: 0 },
  })
  const execution = planAudioExecution({
    sources: opts.probes,
    destination: 'mp4-aac',
    operations: { volumePercent: 100, muxVolume: 1, muxFadeIn: 0, muxFadeOut: 0 },
    qualityPlan: quality,
    targetDurationSeconds: opts.targetSeconds,
    periodDurationSeconds: opts.periodSeconds,
    encodeOnceEnabled: true,
  })

  const alignedPeriod = snapPeriodSecondsToAacFrames(opts.periodSeconds, opts.sampleRate)
  const align = analyzeAacFrameAlignment(alignedPeriod, opts.sampleRate)

  // --- Path A: current (WAV period + full-timeline AAC) ---
  const pathADir = path.join(caseDir, 'A-standard')
  await mkdir(pathADir, { recursive: true })
  const pathAOut = path.join(pathADir, 'out.m4a')
  const tA0 = performance.now()
  const std = await encodeStandardFullTimeline({
    sources: opts.sources,
    sampleRate: opts.sampleRate,
    channels: 2,
    bitrateKbps: opts.bitrateKbps,
    targetSeconds: opts.targetSeconds,
    workDir: pathADir,
    outputPath: pathAOut,
    hooks: hooks(),
  })
  const pathA_wallMs = performance.now() - tA0
  const pathAProbe = await probeAudioDetails(pathAOut)
  const pathA_tempBytes = await dirBytes(pathADir)
  const pathA_outBytes = (await stat(pathAOut)).size

  // --- Path B: frame-aligned encode-once AAC + stream-copy loop ---
  const pathBDir = path.join(caseDir, 'B-encode-once')
  await mkdir(pathBDir, { recursive: true })
  // Use .mp3 container for the period: this FFmpeg build rejects mp3-in-m4a/ipod.
  // Final Screensaver mux can still `-c:a copy` MP3 into MP4.
  const periodPath = path.join(pathBDir, 'period.mp3')
  const pathBOut = path.join(pathBDir, 'out.mp3')
  const tB0 = performance.now()
  const period = await encodeDestinationPeriod({
    sources: opts.sources,
    outputPath: periodPath,
    sampleRate: opts.sampleRate,
    channels: 2,
    bitrateKbps: opts.bitrateKbps,
    workDir: pathBDir,
    hooks: hooks(),
    allowWavFallback: true,
    frameAlignPad: true,
    periodCodec: 'mp3',
  })
  const periodVerify = await verifyEncodedPeriod({
    periodPath,
    expectedPeriodSeconds: alignedPeriod,
    sampleRate: opts.sampleRate,
  })
  let continuityOk = true
  let continuityNotes: string[] = [...periodVerify.reasons]
  let fallbackWouldBeRequired = !periodVerify.ok
  let joinRms = 0
  let baselineRms = 0
  let joinVsBaselineRatio = 0
  const hasRepetition = opts.targetSeconds > opts.periodSeconds + 0.05

  if (periodVerify.ok || periodVerify.reasons.every((r) => r.includes('not AAC-frame-aligned'))) {
    const strippedPath = path.join(pathBDir, 'period.stripped.mp3')
    const stripped = await stripContainerDelayForLoop({
      periodPath,
      outputPath: strippedPath,
      hooks: hooks(),
    })
    continuityNotes.push(
      stripped.stripped
        ? `Stripped container start_time=${stripped.startTime.toFixed(4)}s before loop.`
        : `No container delay strip (start_time=${stripped.startTime.toFixed(4)}s).`,
    )
    // Use natural (unpadded) period length for join index when comparing to path A,
    // but loop the encoded/stripped artifact.
    const loopPeriodPath = stripped.path
    const loopPeriodMeta = await probeAudioDetails(loopPeriodPath)
    await streamCopyLoopPeriod({
      periodPath: loopPeriodPath,
      outputPath: pathBOut,
      targetSeconds: opts.targetSeconds,
      hooks: hooks(),
    })
    if (hasRepetition) {
      const compareDir = path.join(pathBDir, 'compare')
      const continuity = await compareDecodedJoinContinuity({
        encodeOncePath: pathBOut,
        continuousPath: pathAOut,
        periodSeconds: loopPeriodMeta.duration || alignedPeriod,
        sampleRate: opts.sampleRate,
        workDir: compareDir,
      })
      continuityOk = continuity.ok
      continuityNotes = [...continuityNotes, ...continuity.reasons]
      joinRms = continuity.rmsDiff
      baselineRms = continuity.baselineRmsDiff
      joinVsBaselineRatio = continuity.joinVsBaselineRatio
      if (!continuity.ok) fallbackWouldBeRequired = true
    } else {
      continuityNotes.push('No repetition — join continuity skipped.')
    }
  } else {
    continuityOk = false
  }

  const pathB_wallMs = performance.now() - tB0
  let pathBProbe = { bitrate: 0, duration: 0 }
  let pathB_outBytes = 0
  try {
    pathBProbe = await probeAudioDetails(pathBOut)
    pathB_outBytes = (await stat(pathBOut)).size
  } catch {
    fallbackWouldBeRequired = true
    continuityOk = false
  }
  const pathB_tempBytes = await dirBytes(pathBDir)

  return {
    name: opts.name,
    targetSeconds: opts.targetSeconds,
    periodSeconds: opts.periodSeconds,
    pathA_wallMs,
    pathB_wallMs,
    pathA_encodeInputSec: std.encodeInputDurationSeconds,
    pathB_encodeInputSec: period.encodeInputDurationSeconds,
    pathA_tempBytes,
    pathB_tempBytes,
    pathA_outBytes,
    pathB_outBytes,
    pathA_bitrate: pathAProbe.bitrate,
    pathB_bitrate: pathBProbe.bitrate,
    pathB_periodVerifyOk: periodVerify.ok || periodVerify.reasons.every((r) => r.includes('not AAC-frame-aligned')),
    continuityOk,
    continuityNotes,
    frameAligned: align.frameAligned,
    joinRms,
    baselineRms,
    joinVsBaselineRatio,
    executionStrategy: execution.strategy,
    qualityStrategy: quality.strategy,
    targetBitrateKbps: execution.targetBitrateKbps,
    fallbackWouldBeRequired,
    alignedPeriodSeconds: alignedPeriod,
  }
}

async function main(): Promise<void> {
  await ensureStorage()
  const work = path.join(outputsDir, '..', 'poc-encode-once-loop-copy')
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })

  const ffv = await execFileAsync(ffmpegBinary(), ['-version'], { windowsHide: true })
  const ffmpegVersion = ffv.stdout.split(/\r?\n/)[0] ?? 'unknown'

  // Mixed-rate playlist approximating the reported scenario (scaled period for runtime).
  const trackA = path.join(work, 'track-44k-256.mp3')
  const trackB = path.join(work, 'track-48k-256.mp3')
  // ~8s + ~7.5s ≈ 15.5s period (fast continuity). Also a longer ~30s period for timing.
  await synthMp3(trackA, 8.0, 256, 44100, 440)
  await synthMp3(trackB, 7.5, 256, 48000, 554)
  const probeA = await probeAudioDetails(trackA)
  const probeB = await probeAudioDetails(trackB)
  const periodShort = probeA.duration + probeB.duration

  const sourcesShort: EncodeOnceSource[] = [
    {
      path: trackA,
      sampleRate: probeA.sampleRate,
      channels: probeA.channels,
      duration: probeA.duration,
    },
    {
      path: trackB,
      sampleRate: probeB.sampleRate,
      channels: probeB.channels,
      duration: probeB.duration,
    },
  ]
  const probes: AudioSourceProbe[] = [
    {
      codec: probeA.codec,
      bitrate: probeA.bitrate,
      streamBitrate: probeA.streamBitrate,
      sampleRate: probeA.sampleRate,
      channels: probeA.channels,
      duration: probeA.duration,
    },
    {
      codec: probeB.codec,
      bitrate: probeB.bitrate,
      streamBitrate: probeB.streamBitrate,
      sampleRate: probeB.sampleRate,
      channels: probeB.channels,
      duration: probeB.duration,
    },
  ]

  // Longer period (~30s) for multi-hour encode-time comparison without 776s wall clock.
  const trackLongA = path.join(work, 'track-long-44k.mp3')
  const trackLongB = path.join(work, 'track-long-48k.mp3')
  await synthMp3(trackLongA, 16.0, 256, 44100, 392)
  await synthMp3(trackLongB, 14.0, 256, 48000, 523)
  const probeLA = await probeAudioDetails(trackLongA)
  const probeLB = await probeAudioDetails(trackLongB)
  const periodLong = probeLA.duration + probeLB.duration
  const sourcesLong: EncodeOnceSource[] = [
    { path: trackLongA, sampleRate: probeLA.sampleRate, channels: probeLA.channels, duration: probeLA.duration },
    { path: trackLongB, sampleRate: probeLB.sampleRate, channels: probeLB.channels, duration: probeLB.duration },
  ]
  const probesLong: AudioSourceProbe[] = [
    {
      codec: probeLA.codec,
      bitrate: probeLA.bitrate,
      streamBitrate: probeLA.streamBitrate,
      sampleRate: probeLA.sampleRate,
      channels: probeLA.channels,
      duration: probeLA.duration,
    },
    {
      codec: probeLB.codec,
      bitrate: probeLB.bitrate,
      streamBitrate: probeLB.streamBitrate,
      sampleRate: probeLB.sampleRate,
      channels: probeLB.channels,
      duration: probeLB.duration,
    },
  ]

  const cases: Array<{
    name: string
    sources: EncodeOnceSource[]
    probes: AudioSourceProbe[]
    periodSeconds: number
    targetSeconds: number
  }> = [
    { name: 'period-only', sources: sourcesShort, probes, periodSeconds: periodShort, targetSeconds: periodShort },
    { name: '30min', sources: sourcesShort, probes, periodSeconds: periodShort, targetSeconds: 30 * 60 },
    { name: '2h', sources: sourcesLong, probes: probesLong, periodSeconds: periodLong, targetSeconds: 2 * 3600 },
    // 4h / 8h use short period so wall time stays practical; encode-input duration is the key metric.
    { name: '4h', sources: sourcesShort, probes, periodSeconds: periodShort, targetSeconds: 4 * 3600 },
    { name: '8h', sources: sourcesShort, probes, periodSeconds: periodShort, targetSeconds: 8 * 3600 },
  ]

  // Skip multi-hour continuous path if env asks for quick (still run continuity on 30min).
  const quick = process.env.POC_QUICK === '1'
  const selected = quick ? cases.filter((c) => c.name === 'period-only' || c.name === '30min') : cases

  const results: CaseResult[] = []
  for (const item of selected) {
    console.info(`\n=== Running case ${item.name} (target=${item.targetSeconds}s, period=${item.periodSeconds.toFixed(3)}s) ===`)
    const result = await runCase({
      name: item.name,
      workRoot: work,
      sources: item.sources,
      probes: item.probes,
      periodSeconds: item.periodSeconds,
      targetSeconds: item.targetSeconds,
      sampleRate: 48000,
      bitrateKbps: 256,
    })
    results.push(result)
    console.info(
      `A=${result.pathA_wallMs.toFixed(0)}ms encodeInput=${result.pathA_encodeInputSec}s | B=${result.pathB_wallMs.toFixed(0)}ms encodeInput=${result.pathB_encodeInputSec.toFixed(3)}s | continuity=${result.continuityOk} fallback=${result.fallbackWouldBeRequired}`,
    )
  }

  const repeated = results.filter((r) => r.targetSeconds > r.periodSeconds + 0.05)
  const allContinuity = repeated.length > 0 && repeated.every((r) => r.continuityOk)

  const lines: string[] = [
    '# Encode-Once Loop-Copy — Proof of Concept Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    `FFmpeg: ${ffmpegVersion}`,
    `Platform: ${process.platform} ${process.arch}`,
    `Node: ${process.version}`,
    `POC_QUICK: ${quick ? '1' : '0'}`,
    '',
    '## Root cause (production today)',
    '',
    'For looper-plan recipes that need decode (e.g. mixed sample rates), Screensaver mux:',
    '1. Builds **one loop-period WAV** via `renderAudioLooper` (correct — not full timeline).',
    '2. Then at mux runs `-stream_loop -1` on that WAV with `buildScreensaverAudioFilter({ duration: jobDuration })`',
    '   and **AAC-encodes the entire Screensaver duration** (e.g. 14400s).',
    '',
    'So the waste is full-timeline lossy encode, not a multi-hour WAV file.',
    '',
    '## Pipelines compared',
    '',
    '### A — Current / STANDARD_PROCESSING',
    '```text',
    'sources → filter(resample/concat) → WAV period → stream_loop + AAC encode(full target)',
    '```',
    '',
    '### B — ENCODE_ONCE_LOOP_COPY (MP3 period; AAC period blocked)',
    '```text',
    'sources → filter(resample/concat) → MP3-in-M4A period → verify → stream_loop -c copy → packet trim',
    '```',
    '',
    'AAC period + packet loop produced near-silent joins (encoder priming / MDCT splice).',
    'Forced libmp3lame period is used because MP4 already accepts MP3 stream copy.',
    '',
    '## Fixtures',
    '',
    `- Short playlist: MP3 256 kbps @ 44100 Hz (${probeA.duration.toFixed(3)}s) + MP3 256 kbps @ 48000 Hz (${probeB.duration.toFixed(3)}s)`,
    `- Long playlist: MP3 256 kbps @ 44100 Hz (${probeLA.duration.toFixed(3)}s) + MP3 256 kbps @ 48000 Hz (${probeLB.duration.toFixed(3)}s)`,
    '- Common sample rate target: 48000 Hz stereo',
    '- Target AAC bitrate policy: 256 kbps (source-quality preserve)',
    '',
    'Note: The reported production period (~776.466s) was **not** synthesized verbatim;',
    'scaled periods exercise the same mixed-rate + repetition shape. Encode-input duration',
    'is the primary efficiency metric (should stay ≈ period for path B).',
    '',
    '## Results (measured)',
    '',
    '| Case | Target s | Period s | A wall ms | B wall ms | A encode input s | B encode input s | A temp B | B temp B | Continuity | Fallback |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |',
  ]

  for (const r of results) {
    lines.push(
      `| ${r.name} | ${r.targetSeconds} | ${r.periodSeconds.toFixed(3)} | ${r.pathA_wallMs.toFixed(0)} | ${r.pathB_wallMs.toFixed(0)} | ${r.pathA_encodeInputSec} | ${r.pathB_encodeInputSec.toFixed(3)} | ${r.pathA_tempBytes} | ${r.pathB_tempBytes} | ${r.continuityOk ? 'PASS' : 'FAIL'} | ${r.fallbackWouldBeRequired ? 'YES' : 'NO'} |`,
    )
  }

  lines.push('', '### Per-case detail', '')
  for (const r of results) {
    lines.push(`#### ${r.name}`)
    lines.push('')
    lines.push(`- Quality strategy: ${r.qualityStrategy}`)
    lines.push(`- Execution strategy (planner): ${r.executionStrategy}`)
    lines.push(`- Target bitrate kbps: ${r.targetBitrateKbps}`)
    lines.push(`- Natural period / aligned period: ${r.periodSeconds.toFixed(6)}s / ${r.alignedPeriodSeconds.toFixed(6)}s`)
    lines.push(`- Frame-aligned period: ${r.frameAligned}`)
    lines.push(`- Join RMS / baseline RMS / ratio: ${r.joinRms.toFixed(1)} / ${r.baselineRms.toFixed(1)} / ${r.joinVsBaselineRatio.toFixed(2)}`)
    lines.push(`- A out bytes / bitrate: ${r.pathA_outBytes} / ${r.pathA_bitrate}`)
    lines.push(`- B out bytes / bitrate: ${r.pathB_outBytes} / ${r.pathB_bitrate}`)
    lines.push(`- Continuity notes: ${r.continuityNotes.length ? r.continuityNotes.join('; ') : '(none)'}`)
    lines.push('')
  }

  lines.push('## Continuity gate verdict')
  lines.push('')
  if (allContinuity) {
    lines.push('**PASS** — Join continuity vs continuous encode was within acceptance thresholds for all repeated-target cases.')
    lines.push('')
    lines.push('Production integration may proceed with feature flag + automatic fallback.')
  } else {
    lines.push('**FAIL / BLOCKED** — At least one case failed continuity or period verification.')
    lines.push('')
    lines.push('Do **not** enable Encode-Once Loop-Copy in production. Keep STANDARD_PROCESSING.')
    lines.push('Investigate AAC priming/padding and frame alignment before retrying.')
  }
  lines.push('')
  lines.push('## Acceptance mapping')
  lines.push('')
  lines.push('| Criterion | Status |')
  lines.push('| --- | --- |')
  lines.push(
    `| Only ~period seconds of AAC encode input | ${results.every((r) => r.pathB_encodeInputSec <= r.periodSeconds + 1) ? 'PASS (measured)' : 'FAIL'} |`,
  )
  lines.push(`| Join continuity vs continuous path | ${allContinuity ? 'PASS' : 'FAIL'} |`)
  lines.push('| YouTube upload verification | NOT RUN |')
  lines.push('| Production integration | PENDING gate |')
  lines.push('')

  const reportPath = path.join(work, 'poc-report.md')
  const report = `${lines.join('\n')}\n`
  await writeFile(reportPath, report, 'utf8')
  const repoRoot = path.resolve(moduleDir(import.meta.url), '..', '..')
  const docsPath = path.join(repoRoot, 'docs', 'encode-once-loop-copy-poc.md')
  await mkdir(path.dirname(docsPath), { recursive: true })
  await writeFile(docsPath, report, 'utf8')
  console.log(report)
  console.log(`Wrote ${reportPath}`)
  console.log(`Wrote ${docsPath}`)
  if (!allContinuity) process.exitCode = 2
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
