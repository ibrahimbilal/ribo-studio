import { statfs } from 'node:fs/promises'
import path from 'node:path'
import { subscribeAnimationCacheDir, getSubscribeAnimationCacheStats } from './subscribeAnimationCache'
import { measureTempDirBytes, tmpDir } from './storage'

export interface StorageOverview {
  totalTempBytes: number
  /** Temp excluding subscribe-animation-cache. */
  temporaryFilesBytes: number
  subscribeAnimationCacheBytes: number
  staticAnimationCacheBytes: number
  dynamicAnimationCacheBytes: number
  availableDiskBytes: number | null
  cacheDirectory: string
  temporaryDirectory: string
  refreshedAt: number
}

let cached: StorageOverview | null = null
let cachedAt = 0
const TTL_MS = 4000

async function freeDiskBytes(dir: string): Promise<number | null> {
  try {
    const info = await statfs(dir)
    const free = Number(info.bavail) * Number(info.bsize)
    return Number.isFinite(free) && free >= 0 ? free : null
  } catch {
    return null
  }
}

async function measureDirBytes(dir: string): Promise<number> {
  const { readdir, stat } = await import('node:fs/promises')
  let total = 0
  let names: string[] = []
  try {
    names = await readdir(dir)
  } catch {
    return 0
  }
  for (const name of names) {
    const full = path.join(dir, name)
    try {
      const info = await stat(full)
      if (info.isDirectory()) total += await measureDirBytes(full)
      else total += info.size
    } catch {
      // ignore
    }
  }
  return total
}

export async function getStorageOverview(force = false): Promise<StorageOverview> {
  const now = Date.now()
  if (!force && cached && now - cachedAt < TTL_MS) return cached

  const [totalTempBytes, cacheStats, availableDiskBytes, staticBytes, dynamicBytes] = await Promise.all([
    measureTempDirBytes(),
    getSubscribeAnimationCacheStats(),
    freeDiskBytes(tmpDir),
    measureDirBytes(path.join(subscribeAnimationCacheDir, 'static')),
    measureDirBytes(path.join(subscribeAnimationCacheDir, 'dynamic')),
  ])

  const subscribeAnimationCacheBytes = cacheStats.totalBytes
  // Prefer measured dirs when registry under-counts orphan files; still report registry total as primary.
  const measuredCache = staticBytes + dynamicBytes
  const cacheBytes = Math.max(subscribeAnimationCacheBytes, measuredCache)

  cached = {
    totalTempBytes,
    temporaryFilesBytes: Math.max(0, totalTempBytes - cacheBytes),
    subscribeAnimationCacheBytes: cacheBytes,
    staticAnimationCacheBytes: staticBytes,
    dynamicAnimationCacheBytes: dynamicBytes,
    availableDiskBytes,
    cacheDirectory: subscribeAnimationCacheDir,
    temporaryDirectory: tmpDir,
    refreshedAt: now,
  }
  cachedAt = now
  return cached
}

export function invalidateStorageOverviewCache(): void {
  cached = null
  cachedAt = 0
}
