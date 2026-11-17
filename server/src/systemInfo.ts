import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ffmpegBinary, ffprobeBinary, execFileAsync } from './binaries'
import { encoderCatalog } from './encoders'
import { tmpDir } from './storage'
import { subscribeAnimationCacheDir } from './subscribeAnimationCache'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export interface SystemCapabilities {
  canOpenPaths: boolean
  sleepPrevention: false
  configurableTempDir: false
  maxFfmpegConcurrency: 1
  fileSystemAccessApiLikely: boolean
}

export interface SystemInfo {
  appName: string
  version: string
  os: string
  platform: NodeJS.Platform
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
  enginePaths: {
    ffmpeg: string | null
    ffprobe: string | null
  }
  capabilities: SystemCapabilities
  paths: {
    temporaryDirectory: string
    cacheDirectory: string
    logsDirectory: string | null
  }
  repositoryUrl: string
  homepageUrl: string
}

function firstLineVersion(stdout: string): string | null {
  const line = stdout.split(/\r?\n/).find((item) => item.trim())
  return line?.trim() || null
}

async function readPackageMeta(): Promise<{ version: string; repositoryUrl: string; homepageUrl: string }> {
  try {
    const raw = await readFile(path.join(rootDir, 'package.json'), 'utf8')
    const pkg = JSON.parse(raw) as {
      version?: string
      homepage?: string
      repository?: { url?: string } | string
    }
    const repo =
      typeof pkg.repository === 'string'
        ? pkg.repository
        : typeof pkg.repository?.url === 'string'
          ? pkg.repository.url
          : 'https://github.com/ibrahimbilal/ribo-studio'
    const repositoryUrl = repo.replace(/^git\+/, '').replace(/\.git$/, '')
    return {
      version: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
      repositoryUrl,
      homepageUrl: typeof pkg.homepage === 'string' ? pkg.homepage : repositoryUrl,
    }
  } catch {
    return {
      version: '0.0.0',
      repositoryUrl: 'https://github.com/ibrahimbilal/ribo-studio',
      homepageUrl: 'https://github.com/ibrahimbilal/ribo-studio#readme',
    }
  }
}

function isLocalRequestHost(host: string | undefined): boolean {
  if (!host) return true
  const hostname = host.split(':')[0]?.toLowerCase() ?? ''
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

function isSoftwareGpuLabel(label: string): boolean {
  const lower = label.toLowerCase()
  return (
    lower.includes('software') ||
    lower.includes('llvmpipe') ||
    lower.includes('swiftshader') ||
    lower.includes('microsoft basic render') ||
    lower.includes('cpu')
  )
}

export async function getSystemInfo(requestHost?: string): Promise<SystemInfo> {
  const [pkg, catalog] = await Promise.all([readPackageMeta(), encoderCatalog().catch(() => null)])
  let ffmpegVersion: string | null = null
  let ffprobeVersion: string | null = null
  let ffmpegPath: string | null = null
  let ffprobePath: string | null = null
  try {
    ffmpegPath = ffmpegBinary()
    const out = await execFileAsync(ffmpegPath, ['-version'], { windowsHide: true, maxBuffer: 1024 * 1024 })
    ffmpegVersion = firstLineVersion(out.stdout)
  } catch {
    ffmpegVersion = null
  }
  try {
    ffprobePath = ffprobeBinary()
    const out = await execFileAsync(ffprobePath, ['-version'], { windowsHide: true, maxBuffer: 1024 * 1024 })
    ffprobeVersion = firstLineVersion(out.stdout)
  } catch {
    ffprobeVersion = null
  }

  const hardwareEncoders = (catalog?.encoders ?? [])
    .filter((encoder) => encoder.hardware && encoder.listed)
    .map((encoder) => ({ id: encoder.id, label: encoder.label, verified: encoder.verified }))

  const gpu = hardwareEncoders
    .map((encoder) => encoder.label)
    .filter((label) => !isSoftwareGpuLabel(label))

  let upscalerEngines: SystemInfo['upscalerEngines'] = [
    { id: 'lanczos3', available: true, label: 'Lanczos3 (Sharp)' },
  ]
  try {
    const { createUpscaleEngineRegistry } = await import('./realesrganEngine')
    const engines = createUpscaleEngineRegistry()
    const caps = await engines.capabilities()
    upscalerEngines = Object.entries(caps.engines).map(([id, info]) => ({
      id,
      available: Boolean(info.available),
      label: id === 'realesrgan-lite' ? 'Real-ESRGAN Lite' : id === 'lanczos3' ? 'Lanczos3 (Sharp)' : id,
    }))
  } catch {
    // Optional AI engines may be unavailable.
  }

  const cpus = os.cpus()
  const freeMem = os.freemem()

  return {
    appName: 'Ribo Studio',
    version: pkg.version,
    os: `${os.type()} ${os.release()}`,
    platform: os.platform(),
    arch: os.arch(),
    cpuModel: cpus[0]?.model?.trim() || 'Unknown CPU',
    cpuCount: cpus.length || os.availableParallelism?.() || 1,
    totalRamBytes: os.totalmem(),
    availableRamBytes: Number.isFinite(freeMem) ? freeMem : null,
    gpu: [...new Set(gpu)],
    ffmpegVersion,
    ffprobeVersion,
    upscalerEngines,
    hardwareEncoders,
    enginePaths: {
      ffmpeg: ffmpegPath,
      ffprobe: ffprobePath,
    },
    capabilities: {
      canOpenPaths: isLocalRequestHost(requestHost),
      sleepPrevention: false,
      configurableTempDir: false,
      maxFfmpegConcurrency: 1,
      fileSystemAccessApiLikely: false,
    },
    paths: {
      temporaryDirectory: tmpDir,
      cacheDirectory: subscribeAnimationCacheDir,
      logsDirectory: tmpDir,
    },
    repositoryUrl: pkg.repositoryUrl,
    homepageUrl: pkg.homepageUrl,
  }
}

const ALLOWED_OPEN_TARGETS = new Set(['temp', 'cache', 'logs'])

export function resolveOpenTarget(target: string): string | null {
  if (!ALLOWED_OPEN_TARGETS.has(target)) return null
  if (target === 'cache') return subscribeAnimationCacheDir
  return tmpDir
}

export function openLocalPath(dirPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = os.platform()
    const cmd = platform === 'win32' ? 'cmd' : platform === 'darwin' ? 'open' : 'xdg-open'
    const args = platform === 'win32' ? ['/c', 'start', '', dirPath] : [dirPath]
    execFile(cmd, args, { windowsHide: true }, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

export { isLocalRequestHost }
