/**
 * Standalone PoC: Single-Pass Direct Mux vs legacy multi-pass assembly.
 *
 * Pipelines:
 *   A — Current: segments → full cfr-video.mp4 → (looped.mp3) → final
 *   B — Direct video: segments ffconcat → final (with prepared/materialized audio)
 *   C — Full direct: segments ffconcat + period -stream_loop → final
 *
 * Run: npm run poc:single-pass-direct-mux -w server
 * Optional: RIBO_POC_DIRECT_MUX_QUICK=1 (default short set), or
 *           RIBO_POC_DIRECT_MUX_LONG=1 to include 30m/2h measured runs.
 */
import { execFile } from 'node:child_process'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import { ffmpegBinary, ffprobeBinary } from '../src/binaries'
import {
  streamCopyLoopPeriod,
  stripContainerDelayForLoop,
} from '../src/encodeOnceLoopCopy'
import { moduleDir } from '../src/moduleDir'
import { probeAudioDetails } from '../src/probe'
import { validateCfrPackets } from '../src/screensaverCfr/validate'
import { ensureStorage, tmpDir } from '../src/storage'

const execFileAsync = promisify(execFile)
const ROOT = path.join(tmpDir, 'single-pass-direct-mux-poc')
const DOCS = path.resolve(moduleDir(import.meta.url), '..', '..', 'docs', 'single-pass-direct-mux-poc-report.md')
const TIMESCALE = 60000
const FPS = 30
const WIDTH = 640
const HEIGHT = 360
const SEGMENT_SEC = 2

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

async function runFfmpeg(args: string[]): Promise<void> {
  await execFileAsync(ffmpegBinary(), args, { windowsHide: true, maxBuffer: 20 * 1024 * 1024 })
}

async function makeStillSegment(out: string, frameCount: number): Promise<void> {
  await runFfmpeg([
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=c=0x224466:s=${WIDTH}x${HEIGHT}:r=${FPS}`,
    '-frames:v',
    String(frameCount),
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-g',
    String(FPS),
    '-video_track_timescale',
    String(TIMESCALE),
    out,
  ])
}

async function makeMp3Period(out: string, seconds: number, kbps = 192): Promise<void> {
  await runFfmpeg([
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
    '-ac',
    '2',
    '-c:a',
    'libmp3lame',
    '-b:a',
    `${kbps}k`,
    out,
  ])
}

async function writeConcat(listPath: string, files: string[]): Promise<void> {
  const lines = ['ffconcat version 1.0']
  for (const file of files) {
    lines.push(`file '${file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
  }
  await writeFile(listPath, `${lines.join('\n')}\n`)
}

async function probeFrames(file: string): Promise<number> {
  const { stdout } = await execFileAsync(
    ffprobeBinary(),
    ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file],
    { windowsHide: true },
  )
  return Number(String(stdout).trim()) || 0
}

interface PipelineResult {
  name: 'A' | 'B' | 'C' | 'A-noaudio' | 'B-noaudio'
  wallMs: number
  tempBytes: number
  outBytes: number
  frameCount: number
  expectedFrames: number
  cfrOk: boolean
  cfrReasons: string[]
  audioDuration: number | null
  fullVideoIntermediate: boolean
  fullAudioIntermediate: boolean
  ffmpegInvocations: number
}

async function runWithAudio(opts: {
  label: 'A' | 'B' | 'C'
  caseDir: string
  segments: string[]
  periodPath: string
  targetSec: number
  expectedFrames: number
}): Promise<PipelineResult> {
  const dir = path.join(opts.caseDir, opts.label)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const listPath = path.join(dir, 'segments.ffconcat')
  await writeConcat(listPath, opts.segments)
  const strippedPath = path.join(dir, 'period.stripped.mp3')
  const stripped = await stripContainerDelayForLoop({
    periodPath: opts.periodPath,
    outputPath: strippedPath,
    hooks: hooks(),
  })
  const out = path.join(dir, 'final.mp4')
  let ffmpegInvocations = 1 // strip may or may not spawn; count below
  let fullVideo = false
  let fullAudio = false
  const t0 = performance.now()

  if (opts.label === 'A') {
    const videoOnly = path.join(dir, 'cfr-video.mp4')
    await runFfmpeg([
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', listPath,
      '-map', '0:v:0', '-c:v', 'copy',
      '-video_track_timescale', String(TIMESCALE),
      '-movflags', '+faststart',
      videoOnly,
    ])
    fullVideo = true
    const looped = path.join(dir, 'looped.mp3')
    await streamCopyLoopPeriod({
      periodPath: stripped.path,
      outputPath: looped,
      targetSeconds: opts.targetSec,
      hooks: hooks(),
    })
    fullAudio = true
    await runFfmpeg([
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', videoOnly,
      '-i', looped,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy', '-c:a', 'copy',
      '-t', String(opts.targetSec + 0.02),
      '-movflags', '+faststart',
      out,
    ])
    ffmpegInvocations = 3 + (stripped.stripped ? 1 : 0)
  } else if (opts.label === 'B') {
    const looped = path.join(dir, 'looped.mp3')
    await streamCopyLoopPeriod({
      periodPath: stripped.path,
      outputPath: looped,
      targetSeconds: opts.targetSec,
      hooks: hooks(),
    })
    fullAudio = true
    await runFfmpeg([
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', listPath,
      '-i', looped,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy', '-c:a', 'copy',
      '-video_track_timescale', String(TIMESCALE),
      '-t', String(opts.targetSec + 0.02),
      '-movflags', '+faststart',
      out,
    ])
    ffmpegInvocations = 2 + (stripped.stripped ? 1 : 0)
  } else {
    await runFfmpeg([
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', listPath,
      '-stream_loop', '-1', '-i', stripped.path,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy', '-c:a', 'copy',
      '-video_track_timescale', String(TIMESCALE),
      '-t', String(opts.targetSec + 0.02),
      '-movflags', '+faststart',
      out,
    ])
    ffmpegInvocations = 1 + (stripped.stripped ? 1 : 0)
  }

  const wallMs = performance.now() - t0
  const validation = await validateCfrPackets(out, {
    fps: FPS,
    expectedFrames: opts.expectedFrames,
    expectedDurationSec: opts.targetSec,
    width: WIDTH,
    height: HEIGHT,
    expectAudio: true,
  })
  let audioDuration: number | null = null
  try {
    audioDuration = (await probeAudioDetails(out)).duration
  } catch {
    audioDuration = null
  }
  return {
    name: opts.label,
    wallMs,
    tempBytes: await dirBytes(dir),
    outBytes: (await stat(out)).size,
    frameCount: await probeFrames(out),
    expectedFrames: opts.expectedFrames,
    cfrOk: validation.ok,
    cfrReasons: validation.reasons,
    audioDuration,
    fullVideoIntermediate: fullVideo,
    fullAudioIntermediate: fullAudio,
    ffmpegInvocations,
  }
}

async function runNoAudio(opts: {
  label: 'A-noaudio' | 'B-noaudio'
  caseDir: string
  segments: string[]
  targetSec: number
  expectedFrames: number
}): Promise<PipelineResult> {
  const dir = path.join(opts.caseDir, opts.label)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const listPath = path.join(dir, 'segments.ffconcat')
  await writeConcat(listPath, opts.segments)
  const out = path.join(dir, 'final.mp4')
  let fullVideo = false
  let ffmpegInvocations = 0
  const t0 = performance.now()
  if (opts.label === 'A-noaudio') {
    const videoOnly = path.join(dir, 'cfr-video.mp4')
    await runFfmpeg([
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', listPath,
      '-map', '0:v:0', '-c:v', 'copy',
      '-video_track_timescale', String(TIMESCALE),
      '-movflags', '+faststart',
      videoOnly,
    ])
    await runFfmpeg([
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', videoOnly,
      '-map', '0:v:0', '-c:v', 'copy', '-an',
      '-t', String(opts.targetSec + 0.02),
      '-movflags', '+faststart',
      out,
    ])
    fullVideo = true
    ffmpegInvocations = 2
  } else {
    await runFfmpeg([
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', listPath,
      '-map', '0:v:0', '-c:v', 'copy', '-an',
      '-video_track_timescale', String(TIMESCALE),
      '-movflags', '+faststart',
      out,
    ])
    ffmpegInvocations = 1
  }
  const wallMs = performance.now() - t0
  const validation = await validateCfrPackets(out, {
    fps: FPS,
    expectedFrames: opts.expectedFrames,
    expectedDurationSec: opts.targetSec,
    width: WIDTH,
    height: HEIGHT,
    expectAudio: false,
  })
  return {
    name: opts.label,
    wallMs,
    tempBytes: await dirBytes(dir),
    outBytes: (await stat(out)).size,
    frameCount: await probeFrames(out),
    expectedFrames: opts.expectedFrames,
    cfrOk: validation.ok,
    cfrReasons: validation.reasons,
    audioDuration: null,
    fullVideoIntermediate: fullVideo,
    fullAudioIntermediate: false,
    ffmpegInvocations,
  }
}

function fmtMs(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`
}

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GiB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(2)} MiB`
  return `${(n / 1024).toFixed(1)} KiB`
}

async function main(): Promise<void> {
  await ensureStorage()
  await rm(ROOT, { recursive: true, force: true })
  await mkdir(ROOT, { recursive: true })

  const long = process.env.RIBO_POC_DIRECT_MUX_LONG === '1'
  const targets = long
    ? [30, 120, 1800, 7200]
    : process.env.RIBO_POC_DIRECT_MUX_QUICK === '0'
      ? [30, 120, 300]
      : [30, 120]

  const shared = path.join(ROOT, 'shared')
  await mkdir(shared, { recursive: true })
  const segA = path.join(shared, 'seg-a.mp4')
  const segB = path.join(shared, 'seg-b.mp4')
  await makeStillSegment(segA, SEGMENT_SEC * FPS)
  await makeStillSegment(segB, SEGMENT_SEC * FPS)
  const periodPath = path.join(shared, 'period.mp3')
  await makeMp3Period(periodPath, 5.0)

  const { stdout: ffv } = await execFileAsync(ffmpegBinary(), ['-version'], { windowsHide: true })
  const ffmpegVersion = String(ffv).split('\n')[0] ?? 'unknown'

  const rows: PipelineResult[] = []
  for (const targetSec of targets) {
    const expectedFrames = targetSec * FPS
    const repeats = Math.ceil(targetSec / SEGMENT_SEC)
    const segments: string[] = []
    for (let i = 0; i < repeats; i += 1) {
      segments.push(i % 2 === 0 ? segA : segB)
    }
    // Trim last segment count by writing a custom short segment when needed.
    const exactFrames = expectedFrames
    const fullSegs = Math.floor(exactFrames / (SEGMENT_SEC * FPS))
    const rem = exactFrames % (SEGMENT_SEC * FPS)
    const caseSegments: string[] = []
    for (let i = 0; i < fullSegs; i += 1) caseSegments.push(i % 2 === 0 ? segA : segB)
    if (rem > 0) {
      const remPath = path.join(shared, `seg-rem-${rem}.mp4`)
      try {
        await stat(remPath)
      } catch {
        await makeStillSegment(remPath, rem)
      }
      caseSegments.push(remPath)
    }

    const caseDir = path.join(ROOT, `${targetSec}s`)
    await mkdir(caseDir, { recursive: true })
    console.info(`\n=== Target ${targetSec}s (${exactFrames} frames) ===`)
    for (const label of ['A', 'B', 'C'] as const) {
      console.info(`Running pipeline ${label}…`)
      const result = await runWithAudio({
        label,
        caseDir,
        segments: caseSegments,
        periodPath,
        targetSec,
        expectedFrames: exactFrames,
      })
      rows.push(result)
      console.info(
        `  ${label}: wall=${fmtMs(result.wallMs)} temp=${fmtBytes(result.tempBytes)} out=${fmtBytes(result.outBytes)} cfr=${result.cfrOk ? 'PASS' : 'FAIL'}`,
      )
      if (!result.cfrOk) console.info(`  reasons: ${result.cfrReasons.join('; ')}`)
    }
    for (const label of ['A-noaudio', 'B-noaudio'] as const) {
      console.info(`Running pipeline ${label}…`)
      const result = await runNoAudio({
        label,
        caseDir,
        segments: caseSegments,
        targetSec,
        expectedFrames: exactFrames,
      })
      rows.push(result)
      console.info(
        `  ${label}: wall=${fmtMs(result.wallMs)} temp=${fmtBytes(result.tempBytes)} cfr=${result.cfrOk ? 'PASS' : 'FAIL'}`,
      )
    }
  }

  const critical = rows.filter((r) => r.name === 'C' || r.name === 'B-noaudio')
  const criticalOk = critical.every((r) => r.cfrOk)
  const allCfrOk = rows.every((r) => r.cfrOk)
  const md: string[] = [
    '# Single-Pass Direct Mux — Proof of Concept Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    `FFmpeg: ${ffmpegVersion}`,
    `Platform: ${process.platform} ${process.arch}`,
    `Node: ${process.version}`,
    `Resolution: ${WIDTH}x${HEIGHT} @ ${FPS} fps (representative segments; not 4K wall-time)`,
    `Long run: ${long ? 'yes' : 'no'} (set RIBO_POC_DIRECT_MUX_LONG=1 for 30m/2h)`,
    '',
    '## Pipelines',
    '',
    '- **A** Current: segments → full video intermediate (+faststart) → looped.mp3 → final (+faststart)',
    '- **B** Direct video: segments ffconcat → final with materialized looped.mp3',
    '- **C** Full direct: segments ffconcat + period `-stream_loop` → final (no looped.mp3)',
    '- **A-noaudio / B-noaudio**: legacy remux vs direct concat to final',
    '',
    '## Results (measured)',
    '',
    '| Case | Pipeline | Wall | Temp bytes | Out bytes | Frames | CFR | Full video temp | Full audio temp | FFmpeg ops |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | ---: |',
  ]
  for (const r of rows) {
    const caseName = `${r.expectedFrames / FPS}s`
    md.push(
      `| ${caseName} | ${r.name} | ${fmtMs(r.wallMs)} | ${fmtBytes(r.tempBytes)} | ${fmtBytes(r.outBytes)} | ${r.frameCount}/${r.expectedFrames} | ${r.cfrOk ? 'PASS' : 'FAIL'} | ${r.fullVideoIntermediate ? 'Yes' : 'No'} | ${r.fullAudioIntermediate ? 'Yes' : 'No'} | ${r.ffmpegInvocations} |`,
    )
  }
  md.push('')
  md.push('## Correctness gate')
  md.push('')
  md.push(
    criticalOk
      ? 'Production gates **C** (full direct) and **B-noaudio** (direct video, no audio) passed CFR packet validation.'
      : 'Critical pipelines C / B-noaudio FAILED — do not treat as production-ready.',
  )
  if (!allCfrOk) {
    md.push('')
    md.push(
      'Note: Pipelines **A/B** may fail the strict ±0.25s audio-duration CFR check when `streamCopyLoopPeriod` undershoots slightly; **C** avoids that by applying `-t` at the final mux. This is a measured advantage of direct period looping, not a regression of C.',
    )
  }
  md.push('')
  md.push('## Notes')
  md.push('')
  md.push('- Temp bytes include the final output under the case directory.')
  md.push('- Long 4K wall-clock times are not extrapolated from these runs.')
  md.push('- Production enables SINGLE_PASS_DIRECT_MUX by default with LEGACY_MULTI_PASS fallback.')
  md.push('')

  await writeFile(DOCS, `${md.join('\n')}\n`)
  console.info(`\nWrote ${DOCS}`)
  if (!criticalOk) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
