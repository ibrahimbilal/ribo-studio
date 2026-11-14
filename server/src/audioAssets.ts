import { randomUUID } from 'node:crypto'
import { copyFile, link, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  DEFAULT_AUDIO_LOOPER_LIMITS,
  MAX_AUDIO_LOOPER_TRACKS,
  normalizeSettings,
  type AudioLooperSettings,
} from '../../shared/audioLooper'
import { isLooperAudioRecipe, type LooperAudioRecipe } from '../../shared/looperAudioRecipe'
import { probeAudioDetails } from './probe'
import { safeAudioExt, tmpDir } from './storage'
import { audioDetailsToProbe } from './audioProcessing'

export const audioAssetsDir = path.join(tmpDir, 'audio-assets')
const registryPath = path.join(tmpDir, 'audio-assets.json')

export type AudioAssetOrigin = 'upload' | 'looper' | 'looper-plan'

export interface StoredAudioAsset {
  id: string
  /** Primary media path (first track or adopted file) — used for preview / simple mux. */
  path: string
  originalName: string
  mimeType: string
  size: number
  duration: number
  codec: string | null
  sampleRate: number
  channels: number
  bitrate: number
  createdAt: number
  origin: AudioAssetOrigin
  sourceJobId: string | null
  sourceApp: 'screensaver' | 'audio-looper'
  /** Directory containing recipe sources + recipe.json when origin is looper-plan. */
  recipeDir?: string | null
  recipe?: LooperAudioRecipe | null
}

const assets = new Map<string, StoredAudioAsset>()
const retainCounts = new Map<string, number>()

export async function ensureAudioAssets(): Promise<void> {
  await mkdir(audioAssetsDir, { recursive: true })
  await loadRegistry()
}

export function getAudioAsset(id: string): StoredAudioAsset | undefined {
  return assets.get(id)
}

export function audioAssetIsBusy(id: string): boolean {
  return (retainCounts.get(id) ?? 0) > 0
}

export function retainAudioAssets(ids: string[]): void {
  for (const id of ids) {
    if (!id) continue
    retainCounts.set(id, (retainCounts.get(id) ?? 0) + 1)
  }
}

export function releaseAudioAssets(ids: string[]): void {
  for (const id of ids) {
    if (!id) continue
    const next = (retainCounts.get(id) ?? 1) - 1
    if (next <= 0) retainCounts.delete(id)
    else retainCounts.set(id, next)
  }
}

function mimeForExt(ext: string): string {
  switch (ext) {
    case '.mp3':
      return 'audio/mpeg'
    case '.wav':
      return 'audio/wav'
    case '.flac':
      return 'audio/flac'
    case '.m4a':
      return 'audio/mp4'
    case '.aac':
      return 'audio/aac'
    case '.ogg':
      return 'audio/ogg'
    default:
      return 'application/octet-stream'
  }
}

async function persistAsset(
  filePath: string,
  originalName: string,
  options: {
    origin: AudioAssetOrigin
    sourceJobId: string | null
    sourceApp: StoredAudioAsset['sourceApp']
    mimeType?: string
    move?: boolean
  },
): Promise<StoredAudioAsset> {
  const ext = safeAudioExt(originalName)
  if (!ext) throw new Error('Background audio must be an MP3, WAV, FLAC, M4A, AAC, or OGG file.')
  const details = await probeAudioDetails(filePath)
  const id = randomUUID()
  const finalPath = path.join(audioAssetsDir, `${id}${ext}`)
  if (options.move) {
    await rename(filePath, finalPath)
  } else {
    try {
      await link(filePath, finalPath)
    } catch {
      await copyFile(filePath, finalPath)
    }
  }
  const info = await stat(finalPath)
  const stored: StoredAudioAsset = {
    id,
    path: finalPath,
    originalName: path.basename(originalName).slice(0, 180),
    mimeType: options.mimeType || mimeForExt(ext),
    size: info.size,
    duration: details.duration,
    codec: details.codec,
    sampleRate: details.sampleRate,
    channels: details.channels,
    bitrate: details.bitrate,
    createdAt: Date.now(),
    origin: options.origin,
    sourceJobId: options.sourceJobId,
    sourceApp: options.sourceApp,
    recipeDir: null,
    recipe: null,
  }
  assets.set(id, stored)
  await saveRegistry()
  return stored
}

/** Move an uploaded temp file into the durable audio-asset store. */
export async function addAudioAssetFromUpload(
  filePath: string,
  originalName: string,
  mimeType?: string,
): Promise<StoredAudioAsset> {
  return persistAsset(filePath, originalName, {
    origin: 'upload',
    sourceJobId: null,
    sourceApp: 'screensaver',
    mimeType,
    move: true,
  })
}

/**
 * Adopt a finished Audio Looper output into the audio-asset store.
 * Copies (or hardlinks) so the 2-hour outputs sweep cannot delete the shared file.
 */
export async function addAudioAssetFromLooperJob(
  jobId: string,
  outputPath: string,
  originalName: string,
): Promise<StoredAudioAsset> {
  return persistAsset(outputPath, originalName, {
    origin: 'looper',
    sourceJobId: jobId,
    sourceApp: 'audio-looper',
    move: false,
  })
}

export interface LooperPlanUploadFile {
  path: string
  originalName: string
  size: number
}

/**
 * Store original Looper sources + settings as a recipe (no lossy intermediate export).
 */
export async function addAudioAssetFromLooperPlan(
  files: LooperPlanUploadFile[],
  settingsRaw: unknown,
): Promise<StoredAudioAsset> {
  if (files.length === 0) throw new Error('Choose at least one audio file.')
  if (files.length > MAX_AUDIO_LOOPER_TRACKS) {
    throw new Error(`Choose at most ${MAX_AUDIO_LOOPER_TRACKS} tracks.`)
  }
  for (const file of files) {
    if (file.size < 64) throw new Error('That audio file looks empty.')
    if (file.size > DEFAULT_AUDIO_LOOPER_LIMITS.maxFileBytes) {
      throw new Error(`Audio files must be ${DEFAULT_AUDIO_LOOPER_LIMITS.maxFileBytes / (1024 * 1024)} MB or smaller.`)
    }
  }

  let parsedSettings: unknown = settingsRaw
  if (typeof parsedSettings === 'string') {
    try {
      parsedSettings = JSON.parse(parsedSettings) as unknown
    } catch {
      throw new Error('Loop settings are not valid JSON.')
    }
  }
  const settings = normalizeSettings(parsedSettings) as AudioLooperSettings
  const id = randomUUID()
  const recipeDir = path.join(audioAssetsDir, id)
  await mkdir(recipeDir, { recursive: true })

  const tracks: LooperAudioRecipe['tracks'] = []
  let totalSize = 0
  let totalDuration = 0
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]!
      const ext = safeAudioExt(file.originalName) || '.bin'
      const fileName = `source-${index}${ext}`
      const dest = path.join(recipeDir, fileName)
      await rename(file.path, dest)
      const details = await probeAudioDetails(dest)
      const trim = settings.tracks?.[index]
      tracks.push({
        fileName,
        originalName: path.basename(file.originalName).slice(0, 180),
        probe: audioDetailsToProbe(details, {
          trimStart: trim?.trimStart,
          trimEnd: trim?.trimEnd ?? details.duration,
        }),
      })
      totalSize += (await stat(dest)).size
      totalDuration += details.duration
    }

    const recipe: LooperAudioRecipe = {
      version: 1,
      settings,
      tracks,
      createdAt: Date.now(),
    }
    await writeFile(path.join(recipeDir, 'recipe.json'), JSON.stringify(recipe), 'utf8')

    const first = tracks[0]!
    const firstPath = path.join(recipeDir, first.fileName)
    const stored: StoredAudioAsset = {
      id,
      path: firstPath,
      originalName: first.originalName || 'looper-plan',
      mimeType: mimeForExt(path.extname(first.fileName).toLowerCase()),
      size: totalSize,
      duration: totalDuration,
      codec: first.probe.codec,
      sampleRate: first.probe.sampleRate,
      channels: first.probe.channels,
      bitrate: first.probe.bitrate,
      createdAt: Date.now(),
      origin: 'looper-plan',
      sourceJobId: null,
      sourceApp: 'audio-looper',
      recipeDir,
      recipe,
    }
    assets.set(id, stored)
    await saveRegistry()
    return stored
  } catch (error) {
    await rm(recipeDir, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

export function recipeSourcePaths(stored: StoredAudioAsset): string[] {
  if (!stored.recipe || !stored.recipeDir) return [stored.path]
  return stored.recipe.tracks.map((track) => path.join(stored.recipeDir!, track.fileName))
}

export async function removeAudioAsset(id: string): Promise<boolean> {
  const stored = assets.get(id)
  if (!stored) return false
  if (audioAssetIsBusy(id)) return false
  assets.delete(id)
  if (stored.recipeDir) {
    await rm(stored.recipeDir, { recursive: true, force: true }).catch(() => undefined)
  } else {
    await rm(stored.path, { force: true }).catch(() => undefined)
  }
  await saveRegistry()
  return true
}

/** Public metadata — never expose filesystem paths. */
export function audioAssetPublicView(stored: StoredAudioAsset) {
  return {
    id: stored.id,
    name: stored.originalName,
    mimeType: stored.mimeType,
    size: stored.size,
    duration: stored.duration,
    codec: stored.codec,
    sampleRate: stored.sampleRate,
    channels: stored.channels,
    bitrate: stored.bitrate,
    origin: stored.origin,
    sourceJobId: stored.sourceJobId,
    sourceApp: stored.sourceApp,
    hasRecipe: Boolean(stored.recipe && stored.origin === 'looper-plan'),
    trackCount: stored.recipe?.tracks.length ?? 1,
    createdAt: stored.createdAt,
  }
}

/** Drop unreferenced assets older than `maxAgeMs` (default 7 days). */
export async function sweepAudioAssets(maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<void> {
  const cutoff = Date.now() - maxAgeMs
  for (const stored of [...assets.values()]) {
    if (stored.createdAt >= cutoff) continue
    if (audioAssetIsBusy(stored.id)) continue
    assets.delete(stored.id)
    if (stored.recipeDir) {
      await rm(stored.recipeDir, { recursive: true, force: true }).catch(() => undefined)
    } else {
      await rm(stored.path, { force: true }).catch(() => undefined)
    }
  }
  await saveRegistry()
  await purgeOrphanAudioFiles()
}

async function purgeOrphanAudioFiles(): Promise<void> {
  const { readdir } = await import('node:fs/promises')
  const known = new Set<string>()
  for (const stored of assets.values()) {
    known.add(path.basename(stored.path))
    if (stored.recipeDir) known.add(path.basename(stored.recipeDir))
  }
  let names: string[] = []
  try {
    names = await readdir(audioAssetsDir)
  } catch {
    return
  }
  for (const name of names) {
    if (known.has(name)) continue
    await rm(path.join(audioAssetsDir, name), { recursive: true, force: true }).catch(() => undefined)
  }
}

async function loadRegistry(): Promise<void> {
  let raw = ''
  try {
    raw = await readFile(registryPath, 'utf8')
  } catch {
    return
  }
  let parsed: Record<string, StoredAudioAsset> = {}
  try {
    parsed = JSON.parse(raw) as Record<string, StoredAudioAsset>
  } catch {
    return
  }
  for (const stored of Object.values(parsed)) {
    if (!stored?.id || !stored.path) continue
    try {
      await stat(stored.path)
      if (stored.recipe && !isLooperAudioRecipe(stored.recipe)) stored.recipe = null
      if (stored.bitrate == null) stored.bitrate = 0
      assets.set(stored.id, stored)
    } catch {
      // Drop rows whose files were already removed.
    }
  }
}

async function saveRegistry(): Promise<void> {
  const payload: Record<string, StoredAudioAsset> = {}
  for (const [id, stored] of assets) payload[id] = stored
  await writeFile(registryPath, JSON.stringify(payload), 'utf8')
}
