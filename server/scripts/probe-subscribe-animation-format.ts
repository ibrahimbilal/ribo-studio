/**
 * Measures transparent animation storage candidates against the installed FFmpeg.
 * Writes server/tmp/subscribe-animation-format-probe.json — does not change the production format.
 */
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { ffmpegBinary } from '../src/binaries'
import { ensureStorage, tmpDir } from '../src/storage'
import { moduleDir } from '../src/moduleDir'

const root = path.resolve(moduleDir(import.meta.url), '..')
const outPath = path.join(root, 'tmp', 'subscribe-animation-format-probe.json')
const work = path.join(tmpDir, 'format-probe')

function run(args: string[]): Promise<{ code: number; stderr: string; ms: number }> {
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(ffmpegBinary(), args, { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('close', (code) => resolve({ code: code ?? 1, stderr, ms: Date.now() - started }))
  })
}

async function dirBytes(dir: string): Promise<number> {
  let total = 0
  for (const name of await readdir(dir)) {
    total += (await stat(path.join(dir, name))).size
  }
  return total
}

async function main(): Promise<void> {
  await ensureStorage()
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  const framesDir = path.join(work, 'frames')
  await mkdir(framesDir, { recursive: true })

  const frameCount = 30
  // Generate a short RGBA PNG sequence via lavfi.
  const gen = await run([
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=black@0.0:s=320x180:d=${frameCount / 30},format=rgba`,
    '-vf',
    "drawbox=x=40:y=40:w=120:h=40:color=red@0.8:t=fill",
    '-r',
    '30',
    path.join(framesDir, '%04d.png'),
  ])
  if (gen.code !== 0) throw new Error(`Frame gen failed: ${gen.stderr.slice(-400)}`)

  const pngBytes = await dirBytes(framesDir)
  const pngEncodeMs = gen.ms

  const webmPath = path.join(work, 'anim.webm')
  const webmEncode = await run([
    '-y',
    '-framerate',
    '30',
    '-i',
    path.join(framesDir, '%04d.png'),
    '-c:v',
    'libvpx-vp9',
    '-pix_fmt',
    'yuva420p',
    '-auto-alt-ref',
    '0',
    '-b:v',
    '0',
    '-crf',
    '30',
    webmPath,
  ])

  let webmBytes = 0
  let webmDecodeOk = false
  let webmDecodeMs = 0
  let webmAlphaNote = 'encode failed'
  if (webmEncode.code === 0) {
    webmBytes = (await stat(webmPath)).size
    const decodeDir = path.join(work, 'webm-decode')
    await mkdir(decodeDir, { recursive: true })
    const decode = await run([
      '-y',
      '-i',
      webmPath,
      '-frames:v',
      String(frameCount),
      path.join(decodeDir, '%04d.png'),
    ])
    webmDecodeMs = decode.ms
    webmDecodeOk = decode.code === 0
    webmAlphaNote = webmDecodeOk
      ? 'Decoded to PNG sequence; alpha preservation not pixel-compared in this probe.'
      : `decode failed: ${decode.stderr.slice(-200)}`
  } else {
    webmAlphaNote = `encode failed: ${webmEncode.stderr.slice(-300)}`
  }

  const report = {
    createdAt: new Date().toISOString(),
    ffmpeg: ffmpegBinary(),
    frameCount,
    candidates: {
      'png-seq': {
        encodeMs: pngEncodeMs,
        bytes: pngBytes,
        alpha: 'native (source format)',
        pipelineCompatible: true,
        notes: 'Matches existing hybrid/CFR overlay=%04d.png path.',
      },
      'webm-vp9-alpha': {
        encodeMs: webmEncode.ms,
        encodeOk: webmEncode.code === 0,
        decodeMs: webmDecodeMs,
        decodeOk: webmDecodeOk,
        bytes: webmBytes,
        alpha: webmAlphaNote,
        pipelineCompatible: false,
        notes: 'Would require overlay filter changes; not selected for production in this release.',
      },
    },
    selectedFormat: 'png-seq',
    selectionReason:
      'PNG sequence is already consumed by hybrid and Optimized CFR overlay pipelines with proven alpha. WebM VP9 alpha was probed but not adopted because compositing still expects %04d.png and switching would introduce a parallel decode path.',
  }

  await mkdir(path.dirname(outPath), { recursive: true })
  await writeFile(outPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  console.log(`Wrote ${outPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
