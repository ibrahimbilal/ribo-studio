/**
 * Verified encoded audio-period cache for Encode-Once Loop-Copy.
 * Keys exclude final Screensaver duration (period content only).
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash as createHashStream } from 'node:crypto'
import { AUDIO_PERIOD_PIPELINE_VERSION, buildEncodedPeriodCacheKey } from '../../shared/audioExecutionPlan'
import { tmpDir } from './storage'

export const audioPeriodCacheDir = path.join(tmpDir, 'audio-period-cache')
const LOG = '[AudioPeriodCache]'

/** Soft cap — oldest unused entries pruned when exceeded. */
export const AUDIO_PERIOD_CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024 // 2 GiB

const retainCounts = new Map<string, number>()
const inflight = new Map<string, Promise<string>>()

export function isEncodeOnceLoopCopyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.RIBO_ENCODE_ONCE_LOOP_COPY
  if (raw == null || raw.trim() === '') return true
  const v = raw.trim().toLowerCase()
  return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no'
}

export async function ensureAudioPeriodCache(): Promise<void> {
  await mkdir(audioPeriodCacheDir, { recursive: true })
}

function keyHex(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export function retainAudioPeriodCache(key: string): void {
  if (!key) return
  const hex = keyHex(key)
  retainCounts.set(hex, (retainCounts.get(hex) ?? 0) + 1)
}

export function releaseAudioPeriodCache(key: string): void {
  if (!key) return
  const hex = keyHex(key)
  const next = (retainCounts.get(hex) ?? 1) - 1
  if (next <= 0) retainCounts.delete(hex)
  else retainCounts.set(hex, next)
}

function cachePathForKey(key: string): string {
  return path.join(audioPeriodCacheDir, `${keyHex(key)}.mp3`)
}

function metaPathForKey(key: string): string {
  return `${cachePathForKey(key)}.ok`
}

export async function hashFileContent(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHashStream('sha256')
    const stream = createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

export async function lookupAudioPeriodCache(key: string): Promise<string | null> {
  const file = cachePathForKey(key)
  const meta = metaPathForKey(key)
  try {
    await stat(meta)
    await stat(file)
    return file
  } catch {
    return null
  }
}

/**
 * Dedup concurrent builders for the same key. Builder must write a verified artifact
 * to a temp path; this function atomically publishes it into the cache.
 */
export async function getOrCreateAudioPeriod(
  key: string,
  build: (tempPath: string) => Promise<void>,
): Promise<{ path: string; cacheHit: boolean }> {
  await ensureAudioPeriodCache()
  const existing = await lookupAudioPeriodCache(key)
  if (existing) {
    console.info(`${LOG} hit key=${key.slice(0, 64)}…`)
    return { path: existing, cacheHit: true }
  }

  const pending = inflight.get(key)
  if (pending) {
    const pathReady = await pending
    return { path: pathReady, cacheHit: true }
  }

  const work = (async () => {
    const finalPath = cachePathForKey(key)
    const meta = metaPathForKey(key)
    const tempPath = path.join(audioPeriodCacheDir, `${path.basename(finalPath, '.mp3')}.${Date.now()}.partial.mp3`)
    try {
      await build(tempPath)
      await rm(finalPath, { force: true }).catch(() => undefined)
      await rename(tempPath, finalPath)
      await writeFile(meta, JSON.stringify({ key, createdAt: Date.now(), pipeline: AUDIO_PERIOD_PIPELINE_VERSION }), 'utf8')
      console.info(`${LOG} store key=${key.slice(0, 64)}…`)
      await pruneAudioPeriodCache().catch(() => undefined)
      return finalPath
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined)
      await rm(finalPath, { force: true }).catch(() => undefined)
      await rm(meta, { force: true }).catch(() => undefined)
      throw error
    } finally {
      inflight.delete(key)
    }
  })()

  inflight.set(key, work)
  const pathReady = await work
  return { path: pathReady, cacheHit: false }
}

export async function copyCachedPeriodTo(dest: string, cacheKey: string): Promise<boolean> {
  const hit = await lookupAudioPeriodCache(cacheKey)
  if (!hit) return false
  await copyFile(hit, dest)
  return true
}

export async function pruneAudioPeriodCache(maxBytes = AUDIO_PERIOD_CACHE_MAX_BYTES): Promise<void> {
  await ensureAudioPeriodCache()
  const names = await readdir(audioPeriodCacheDir)
  const files: Array<{ file: string; meta: string; mtime: number; size: number; keyHex: string }> = []
  for (const name of names) {
    if (!name.endsWith('.mp3') || name.includes('.partial.')) continue
    const file = path.join(audioPeriodCacheDir, name)
    const meta = `${file}.ok`
    try {
      const st = await stat(file)
      await stat(meta)
      const keyHex = name.replace(/\.mp3$/, '')
      if ((retainCounts.get(keyHex) ?? 0) > 0) continue
      files.push({ file, meta, mtime: st.mtimeMs, size: st.size, keyHex })
    } catch {
      // ignore incomplete
    }
  }
  let total = files.reduce((sum, f) => sum + f.size, 0)
  if (total <= maxBytes) return
  files.sort((a, b) => a.mtime - b.mtime)
  for (const entry of files) {
    if (total <= maxBytes) break
    await rm(entry.file, { force: true }).catch(() => undefined)
    await rm(entry.meta, { force: true }).catch(() => undefined)
    total -= entry.size
    console.info(`${LOG} pruned ${path.basename(entry.file)}`)
  }
}

export { buildEncodedPeriodCacheKey, AUDIO_PERIOD_PIPELINE_VERSION }
