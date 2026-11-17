import { createHash, randomUUID } from 'node:crypto'
import { copyFile, link, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  SUBSCRIBE_ANIMATION_CACHE_MAX_BYTES_DEFAULT,
  type SubscribeAnimationCacheClearScope,
  type SubscribeAnimationCacheEntryPublic,
  type SubscribeAnimationCacheManifest,
  type SubscribeAnimationCacheStats,
  type SubscribeAnimationChannelCacheMeta,
  validateCacheManifest,
  isValidCacheKeyHex,
} from '../../shared/subscribeAnimationCache'
import {
  SUBSCRIBE_ANIMATION_CACHE_FORMAT,
  SUBSCRIBE_ANIMATION_CACHE_SCHEMA_VERSION,
  SUBSCRIBE_ANIMATION_TEMPLATES,
  type SubscribeAnimationTemplateKind,
} from '../../shared/subscribeAnimationTemplates'
import type { SubscribeAnimationCacheKeyPayload } from '../../shared/subscribeAnimationCacheKey'
import {
  subscribeAnimationStyleLabel,
  type SubscribeAnimationStyle,
} from '../../shared/screensaverSubscribeAnimation'
import { isYoutubeChannelId } from '../../shared/youtubeChannelId'
import { tmpDir } from './storage'

export const subscribeAnimationCacheDir = path.join(tmpDir, 'subscribe-animation-cache')
const registryPath = path.join(tmpDir, 'subscribe-animation-cache.json')
const LOG = '[SubscribeAnimationCache]'

export interface StoredSubscribeAnimationCacheEntry {
  cacheKey: string
  kind: SubscribeAnimationTemplateKind
  templateId: SubscribeAnimationStyle
  channelId: string | null
  /** Channel card theme when template is channel-card (from renderConfig). */
  channelCardTheme: string | null
  dir: string
  frameCount: number
  width: number
  height: number
  fileSize: number
  createdAt: number
  lastUsedAt: number
}

interface RegistryFile {
  maxBytes: number
  entries: Record<string, StoredSubscribeAnimationCacheEntry>
  channels: Record<string, SubscribeAnimationChannelCacheMeta>
}

const entries = new Map<string, StoredSubscribeAnimationCacheEntry>()
const channels = new Map<string, SubscribeAnimationChannelCacheMeta>()
const retainCounts = new Map<string, number>()
const writeLocks = new Map<string, Promise<void>>()
let maxBytes = SUBSCRIBE_ANIMATION_CACHE_MAX_BYTES_DEFAULT

export async function ensureSubscribeAnimationCache(): Promise<void> {
  await mkdir(path.join(subscribeAnimationCacheDir, 'static'), { recursive: true })
  await mkdir(path.join(subscribeAnimationCacheDir, 'dynamic'), { recursive: true })
  await loadRegistry()
}

export function getSubscribeAnimationCacheEntry(cacheKey: string): StoredSubscribeAnimationCacheEntry | undefined {
  return entries.get(cacheKey)
}

export function subscribeAnimationCacheIsBusy(cacheKey: string): boolean {
  return (retainCounts.get(cacheKey) ?? 0) > 0
}

export function retainSubscribeAnimationCache(keys: string[]): void {
  for (const key of keys) {
    if (!key) continue
    retainCounts.set(key, (retainCounts.get(key) ?? 0) + 1)
  }
}

export function releaseSubscribeAnimationCache(keys: string[]): void {
  for (const key of keys) {
    if (!key) continue
    const next = (retainCounts.get(key) ?? 1) - 1
    if (next <= 0) retainCounts.delete(key)
    else retainCounts.set(key, next)
  }
}

function log(message: string): void {
  console.log(`${LOG} ${message}`)
}

function inventoryEntryName(templateId: SubscribeAnimationStyle, channelCardTheme: string | null | undefined): string {
  const base = subscribeAnimationStyleLabel(templateId)
  if (templateId !== 'channel-card' || !channelCardTheme) return base
  const style =
    channelCardTheme === 'dark' ? 'Dark' : channelCardTheme === 'light' ? 'Light' : channelCardTheme
  return `${base} - ${style}`
}

async function readChannelCardThemeFromManifest(dir: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(dir, 'manifest.json'), 'utf8')
    const manifest = validateCacheManifest(JSON.parse(raw))
    const theme = manifest?.renderConfig?.channelCardTheme
    return typeof theme === 'string' && theme ? theme : null
  } catch {
    return null
  }
}

/** One dynamic channel-card cache per channel + theme (light/dark). */
function channelThemeSlotKey(entry: StoredSubscribeAnimationCacheEntry): string | null {
  if (entry.kind !== 'dynamic' || entry.templateId !== 'channel-card' || !entry.channelId) return null
  if (!entry.channelCardTheme) return null
  return `${entry.channelId}|${entry.templateId}|${entry.channelCardTheme}`
}

async function pruneDuplicateGroup(
  groups: Map<string, StoredSubscribeAnimationCacheEntry[]>,
  options: { keepCacheKey?: string; label: (entry: StoredSubscribeAnimationCacheEntry) => string },
): Promise<number> {
  let removed = 0
  for (const group of groups.values()) {
    if (group.length < 2 && !options.keepCacheKey) continue
    const keep =
      (options.keepCacheKey && group.find((item) => item.cacheKey === options.keepCacheKey)) ||
      [...group].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || (b.createdAt ?? 0) - (a.createdAt ?? 0))[0]
    if (!keep) continue
    for (const entry of group) {
      if (entry.cacheKey === keep.cacheKey) continue
      if (subscribeAnimationCacheIsBusy(entry.cacheKey)) continue
      entries.delete(entry.cacheKey)
      await rm(entry.dir, { recursive: true, force: true }).catch(() => undefined)
      removed += 1
      log(`Replaced stale ${options.label(entry)} cache ${entry.cacheKey.slice(0, 12)}…`)
    }
  }
  return removed
}

/**
 * Keep a single channel-card entry per (channelId, theme). Prefer `keepCacheKey`, else newest lastUsedAt.
 * Skips busy keys. Returns how many entries were removed.
 */
async function pruneChannelThemeDuplicates(options?: {
  keepCacheKey?: string
  channelId?: string
  channelCardTheme?: string | null
}): Promise<number> {
  const groups = new Map<string, StoredSubscribeAnimationCacheEntry[]>()
  for (const entry of entries.values()) {
    const slot = channelThemeSlotKey(entry)
    if (!slot) continue
    if (options?.channelId && entry.channelId !== options.channelId) continue
    if (options?.channelCardTheme && entry.channelCardTheme !== options.channelCardTheme) continue
    const list = groups.get(slot) ?? []
    list.push(entry)
    groups.set(slot, list)
  }

  return pruneDuplicateGroup(groups, {
    keepCacheKey: options?.keepCacheKey,
    label: (entry) => `channel-card (${entry.channelCardTheme})`,
  })
}

/**
 * Keep a single static entry per templateId. Prefer `keepCacheKey`, else newest lastUsedAt.
 * Skips busy keys. Returns how many entries were removed.
 */
async function pruneStaticTemplateDuplicates(options?: {
  keepCacheKey?: string
  templateId?: SubscribeAnimationStyle
}): Promise<number> {
  const groups = new Map<string, StoredSubscribeAnimationCacheEntry[]>()
  for (const entry of entries.values()) {
    if (entry.kind !== 'static') continue
    if (options?.templateId && entry.templateId !== options.templateId) continue
    const list = groups.get(entry.templateId) ?? []
    list.push(entry)
    groups.set(entry.templateId, list)
  }

  return pruneDuplicateGroup(groups, {
    keepCacheKey: options?.keepCacheKey,
    label: (entry) => `static (${entry.templateId})`,
  })
}

async function loadRegistry(): Promise<void> {
  let raw = ''
  try {
    raw = await readFile(registryPath, 'utf8')
  } catch {
    return
  }
  let parsed: RegistryFile
  try {
    parsed = JSON.parse(raw) as RegistryFile
  } catch {
    return
  }
  if (Number.isFinite(parsed.maxBytes) && parsed.maxBytes > 0) maxBytes = parsed.maxBytes
  entries.clear()
  channels.clear()
  for (const entry of Object.values(parsed.entries ?? {})) {
    if (!entry?.cacheKey || !entry.dir || !isValidCacheKeyHex(entry.cacheKey)) continue
    try {
      await stat(path.join(entry.dir, 'manifest.json'))
      const channelCardTheme =
        typeof entry.channelCardTheme === 'string' && entry.channelCardTheme
          ? entry.channelCardTheme
          : await readChannelCardThemeFromManifest(entry.dir)
      entries.set(entry.cacheKey, {
        ...entry,
        channelCardTheme,
      })
    } catch {
      // Drop missing entries.
    }
  }
  for (const channel of Object.values(parsed.channels ?? {})) {
    if (!channel?.channelId || !isYoutubeChannelId(channel.channelId)) continue
    channels.set(channel.channelId, channel)
  }
  const prunedDynamic = await pruneChannelThemeDuplicates()
  const prunedStatic = await pruneStaticTemplateDuplicates()
  if (prunedDynamic + prunedStatic > 0) await saveRegistry()
}

async function saveRegistry(): Promise<void> {
  const data: RegistryFile = {
    maxBytes,
    entries: Object.fromEntries(entries),
    channels: Object.fromEntries(channels),
  }
  await writeFile(registryPath, JSON.stringify(data))
}

function entryDirFor(kind: SubscribeAnimationTemplateKind, templateId: string, cacheKey: string, channelId: string | null): string {
  if (kind === 'static') {
    return path.join(subscribeAnimationCacheDir, 'static', templateId, cacheKey)
  }
  if (!channelId || !isYoutubeChannelId(channelId)) {
    throw new Error('Dynamic subscribe animation cache entries require a valid YouTube channel ID.')
  }
  return path.join(subscribeAnimationCacheDir, 'dynamic', channelId, 'animations', templateId, cacheKey)
}

function channelDir(channelId: string): string {
  return path.join(subscribeAnimationCacheDir, 'dynamic', channelId)
}

export async function upsertSubscribeChannelMeta(meta: SubscribeAnimationChannelCacheMeta): Promise<SubscribeAnimationChannelCacheMeta> {
  if (!isYoutubeChannelId(meta.channelId)) throw new Error('Invalid YouTube channel ID.')
  const dir = channelDir(meta.channelId)
  await mkdir(path.join(dir, 'assets'), { recursive: true })
  await mkdir(path.join(dir, 'animations'), { recursive: true })
  const next: SubscribeAnimationChannelCacheMeta = {
    ...meta,
    updatedAt: Date.now(),
    fromCache: false,
  }
  channels.set(meta.channelId, next)
  await writeFile(path.join(dir, 'channel.json'), JSON.stringify(next, null, 2))
  await saveRegistry()
  log(`Channel resolved: ${meta.channelId}`)
  return next
}

export function getSubscribeChannelMeta(channelId: string): SubscribeAnimationChannelCacheMeta | undefined {
  const found = channels.get(channelId)
  if (!found) return undefined
  return { ...found, fromCache: true }
}

export function listSubscribeChannelMetas(): SubscribeAnimationChannelCacheMeta[] {
  return [...channels.values()]
    .map((channel) => ({ ...channel, fromCache: true }))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

export async function storeChannelAvatar(
  channelId: string,
  bytes: Buffer,
  extension: string,
): Promise<{ contentHash: string; relativePath: string }> {
  if (!isYoutubeChannelId(channelId)) throw new Error('Invalid YouTube channel ID.')
  const ext = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) throw new Error('Avatar must be PNG, JPEG, or WebP.')
  const contentHash = createHash('sha256').update(bytes).digest('hex')
  const dir = path.join(channelDir(channelId), 'assets')
  await mkdir(dir, { recursive: true })
  const fileName = `${contentHash}${ext === '.jpeg' ? '.jpg' : ext}`
  const dest = path.join(dir, fileName)
  try {
    await stat(dest)
  } catch {
    const tmp = `${dest}.${randomUUID()}.partial`
    await writeFile(tmp, bytes)
    await rename(tmp, dest)
  }
  const existing = channels.get(channelId)
  if (existing) {
    channels.set(channelId, { ...existing, avatarContentHash: contentHash, updatedAt: Date.now() })
    await writeFile(path.join(channelDir(channelId), 'channel.json'), JSON.stringify(channels.get(channelId), null, 2))
    await saveRegistry()
  }
  return { contentHash, relativePath: `assets/${fileName}` }
}

export async function validateCachedAnimation(cacheKey: string): Promise<StoredSubscribeAnimationCacheEntry | null> {
  const started = Date.now()
  const entry = entries.get(cacheKey)
  if (!entry) {
    log(`Cache MISS: ${cacheKey.slice(0, 12)}…`)
    return null
  }
  try {
    const manifestRaw = await readFile(path.join(entry.dir, 'manifest.json'), 'utf8')
    const manifest = validateCacheManifest(JSON.parse(manifestRaw))
    if (!manifest || manifest.cacheKey !== cacheKey) {
      log(`Cache invalidated: bad manifest ${cacheKey.slice(0, 12)}…`)
      await quarantineEntry(cacheKey)
      return null
    }
    for (let i = 1; i <= manifest.frameCount; i += 1) {
      const framePath = path.join(entry.dir, `${String(i).padStart(4, '0')}.png`)
      const info = await stat(framePath)
      if (!info.isFile() || info.size <= 0) {
        log(`Cache invalidated: missing/empty frame ${i}`)
        await quarantineEntry(cacheKey)
        return null
      }
    }
    entry.lastUsedAt = Date.now()
    entries.set(cacheKey, entry)
    await saveRegistry()
    const label = entry.kind === 'dynamic' && entry.channelId
      ? `${entry.channelId}/${entry.templateId}`
      : entry.templateId
    log(`${entry.kind === 'static' ? 'Static' : 'Dynamic'} cache HIT: ${label} (${Date.now() - started}ms)`)
    log('Cache validation passed')
    return entry
  } catch (error) {
    log(`Cache invalidated: ${error instanceof Error ? error.message : 'validation failed'}`)
    await quarantineEntry(cacheKey)
    return null
  }
}

async function quarantineEntry(cacheKey: string): Promise<void> {
  const entry = entries.get(cacheKey)
  if (!entry) return
  if (subscribeAnimationCacheIsBusy(cacheKey)) return
  entries.delete(cacheKey)
  await saveRegistry()
  const quarantine = `${entry.dir}.invalid-${Date.now()}`
  try {
    await rename(entry.dir, quarantine)
    await rm(quarantine, { recursive: true, force: true })
  } catch {
    await rm(entry.dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function getCachedAnimation(cacheKey: string): Promise<SubscribeAnimationCacheEntryPublic | null> {
  const entry = await validateCachedAnimation(cacheKey)
  if (!entry) return null
  return {
    cacheKey: entry.cacheKey,
    kind: entry.kind,
    templateId: entry.templateId,
    channelId: entry.channelId,
    frameCount: entry.frameCount,
    width: entry.width,
    height: entry.height,
    fileSize: entry.fileSize,
    createdAt: entry.createdAt,
    lastUsedAt: entry.lastUsedAt,
    ready: true,
  }
}

export async function materializeCachedAnimation(cacheKey: string, destDir: string): Promise<StoredSubscribeAnimationCacheEntry> {
  const entry = await validateCachedAnimation(cacheKey)
  if (!entry) throw new Error('Cached subscribe animation is missing or invalid.')
  await mkdir(destDir, { recursive: true })
  for (let i = 1; i <= entry.frameCount; i += 1) {
    const name = `${String(i).padStart(4, '0')}.png`
    const src = path.join(entry.dir, name)
    const dest = path.join(destDir, name)
    try {
      await link(src, dest)
    } catch {
      await copyFile(src, dest)
    }
  }
  log('Cached animation reused without rendering')
  return entry
}

async function withWriteLock<T>(cacheKey: string, fn: () => Promise<T>): Promise<T> {
  const previous = writeLocks.get(cacheKey) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  writeLocks.set(
    cacheKey,
    previous.then(() => gate),
  )
  await previous
  try {
    return await fn()
  } finally {
    release()
    if (writeLocks.get(cacheKey) === gate) writeLocks.delete(cacheKey)
  }
}

export async function putCachedAnimation(options: {
  cacheKey: string
  kind: SubscribeAnimationTemplateKind
  templateId: SubscribeAnimationStyle
  channelId: string | null
  framePaths: string[]
  width: number
  height: number
  fps: number
  durationSec: number
  renderConfig: SubscribeAnimationCacheKeyPayload
}): Promise<SubscribeAnimationCacheEntryPublic> {
  {
    const { getServerGlobalSettings } = await import('./globalSettings')
    if (!getServerGlobalSettings().storage.persistentAnimationCacheEnabled) {
      throw new Error('Persistent animation caching is disabled in Global Settings.')
    }
  }
  if (!isValidCacheKeyHex(options.cacheKey)) throw new Error('Invalid cache key.')
  if (options.framePaths.length < 1) throw new Error('Animation frames are required.')
  if (options.kind === 'dynamic' && !isYoutubeChannelId(options.channelId)) {
    throw new Error('Dynamic animations require a valid channel ID.')
  }

  return withWriteLock(options.cacheKey, async () => {
    const existing = await validateCachedAnimation(options.cacheKey)
    if (existing) {
      log(`Reusing existing cache entry: ${options.cacheKey.slice(0, 12)}…`)
      return (await getCachedAnimation(options.cacheKey))!
    }

    const finalDir = entryDirFor(options.kind, options.templateId, options.cacheKey, options.channelId)
    const tmpDirPath = `${finalDir}.tmp-${randomUUID()}`
    await mkdir(tmpDirPath, { recursive: true })
    let fileSize = 0
    try {
      for (let i = 0; i < options.framePaths.length; i += 1) {
        const dest = path.join(tmpDirPath, `${String(i + 1).padStart(4, '0')}.png`)
        await rename(options.framePaths[i]!, dest)
        fileSize += (await stat(dest)).size
      }
      const now = Date.now()
      const manifest: SubscribeAnimationCacheManifest = {
        schemaVersion: SUBSCRIBE_ANIMATION_CACHE_SCHEMA_VERSION,
        cacheKey: options.cacheKey,
        templateId: options.templateId,
        kind: options.kind,
        channelId: options.channelId,
        format: SUBSCRIBE_ANIMATION_CACHE_FORMAT,
        frameCount: options.framePaths.length,
        fps: options.fps,
        durationSec: options.durationSec,
        width: options.width,
        height: options.height,
        alpha: true,
        fileSize,
        createdAt: now,
        lastUsedAt: now,
        renderConfig: options.renderConfig,
      }
      await writeFile(path.join(tmpDirPath, 'manifest.json'), JSON.stringify(manifest, null, 2))
      await rm(finalDir, { recursive: true, force: true }).catch(() => undefined)
      await mkdir(path.dirname(finalDir), { recursive: true })
      await rename(tmpDirPath, finalDir)

      const stored: StoredSubscribeAnimationCacheEntry = {
        cacheKey: options.cacheKey,
        kind: options.kind,
        templateId: options.templateId,
        channelId: options.channelId,
        channelCardTheme:
          typeof options.renderConfig.channelCardTheme === 'string' && options.renderConfig.channelCardTheme
            ? options.renderConfig.channelCardTheme
            : null,
        dir: finalDir,
        frameCount: options.framePaths.length,
        width: options.width,
        height: options.height,
        fileSize,
        createdAt: now,
        lastUsedAt: now,
      }
      entries.set(options.cacheKey, stored)
      if (stored.kind === 'dynamic' && stored.templateId === 'channel-card' && stored.channelId && stored.channelCardTheme) {
        await pruneChannelThemeDuplicates({
          keepCacheKey: stored.cacheKey,
          channelId: stored.channelId,
          channelCardTheme: stored.channelCardTheme,
        })
      } else if (stored.kind === 'static') {
        await pruneStaticTemplateDuplicates({
          keepCacheKey: stored.cacheKey,
          templateId: stored.templateId,
        })
      }
      await saveRegistry()
      await sweepSubscribeAnimationCacheLru()
      log(`Animation prepared and stored (${options.framePaths.length} frames, ${(fileSize / 1024 / 1024).toFixed(1)} MB)`)
      return {
        cacheKey: stored.cacheKey,
        kind: stored.kind,
        templateId: stored.templateId,
        channelId: stored.channelId,
        frameCount: stored.frameCount,
        width: stored.width,
        height: stored.height,
        fileSize: stored.fileSize,
        createdAt: stored.createdAt,
        lastUsedAt: stored.lastUsedAt,
        ready: true,
      }
    } catch (error) {
      await rm(tmpDirPath, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  })
}

export async function getSubscribeAnimationCacheStats(): Promise<SubscribeAnimationCacheStats> {
  let totalBytes = 0
  let staticCount = 0
  let dynamicCount = 0
  const perChannel = new Map<string, { bytes: number; animationCount: number; lastUsedAt: number | null }>()

  for (const entry of entries.values()) {
    totalBytes += entry.fileSize
    if (entry.kind === 'static') staticCount += 1
    else {
      dynamicCount += 1
      if (entry.channelId) {
        const cur = perChannel.get(entry.channelId) ?? { bytes: 0, animationCount: 0, lastUsedAt: null }
        cur.bytes += entry.fileSize
        cur.animationCount += 1
        cur.lastUsedAt = Math.max(cur.lastUsedAt ?? 0, entry.lastUsedAt)
        perChannel.set(entry.channelId, cur)
      }
    }
  }

  const channelList = [...channels.values()].map((channel) => {
    const stats = perChannel.get(channel.channelId) ?? { bytes: 0, animationCount: 0, lastUsedAt: null as number | null }
    return {
      channelId: channel.channelId,
      channelName: channel.channelName,
      bytes: stats.bytes,
      animationCount: stats.animationCount,
      lastUsedAt: stats.lastUsedAt,
    }
  })

  return {
    totalBytes,
    staticCount,
    dynamicCount,
    channelCount: channels.size,
    channels: channelList,
    maxBytes,
  }
}

export async function clearSubscribeAnimationCache(scope: SubscribeAnimationCacheClearScope): Promise<{ removed: number }> {
  let removed = 0
  const keys = [...entries.keys()]
  for (const key of keys) {
    const entry = entries.get(key)
    if (!entry) continue
    if (subscribeAnimationCacheIsBusy(key)) continue
    let match = false
    if (scope.scope === 'all') match = true
    else if (scope.scope === 'static') match = entry.kind === 'static'
    else if (scope.scope === 'channel') match = entry.channelId === scope.channelId
    else if (scope.scope === 'entry') match = entry.cacheKey === scope.cacheKey
    if (!match) continue
    entries.delete(key)
    await rm(entry.dir, { recursive: true, force: true }).catch(() => undefined)
    removed += 1
  }
  if (scope.scope === 'channel' && scope.channelId && isYoutubeChannelId(scope.channelId)) {
    const busy = [...entries.values()].some((e) => e.channelId === scope.channelId && subscribeAnimationCacheIsBusy(e.cacheKey))
    if (!busy) {
      channels.delete(scope.channelId)
      await rm(channelDir(scope.channelId), { recursive: true, force: true }).catch(() => undefined)
    }
  }
  if (scope.scope === 'all') {
    for (const channelId of [...channels.keys()]) {
      const busy = [...entries.values()].some((e) => e.channelId === channelId && subscribeAnimationCacheIsBusy(e.cacheKey))
      if (busy) continue
      channels.delete(channelId)
      await rm(channelDir(channelId), { recursive: true, force: true }).catch(() => undefined)
    }
  }
  await saveRegistry()
  log(`Cleared cache scope=${scope.scope} removed=${removed}`)
  return { removed }
}

export async function sweepSubscribeAnimationCacheLru(): Promise<void> {
  const stats = await getSubscribeAnimationCacheStats()
  if (stats.totalBytes <= maxBytes) {
    await purgeAbandonedTempDirs()
    return
  }
  const ordered = [...entries.values()]
    .filter((entry) => !subscribeAnimationCacheIsBusy(entry.cacheKey))
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt)
  let total = stats.totalBytes
  for (const entry of ordered) {
    if (total <= maxBytes) break
    entries.delete(entry.cacheKey)
    await rm(entry.dir, { recursive: true, force: true }).catch(() => undefined)
    total -= entry.fileSize
    log(`LRU removed: ${entry.cacheKey.slice(0, 12)}…`)
  }
  await saveRegistry()
  await purgeAbandonedTempDirs()
}

async function purgeAbandonedTempDirs(): Promise<void> {
  async function walk(dir: string): Promise<void> {
    let names: string[] = []
    try {
      names = await readdir(dir)
    } catch {
      return
    }
    for (const name of names) {
      const full = path.join(dir, name)
      if (name.includes('.tmp-') || name.includes('.invalid-') || name.includes('.partial')) {
        try {
          const info = await stat(full)
          if (Date.now() - info.mtimeMs > 60 * 60 * 1000) {
            await rm(full, { recursive: true, force: true })
          }
        } catch {
          // ignore
        }
        continue
      }
      try {
        const info = await stat(full)
        if (info.isDirectory()) await walk(full)
      } catch {
        // ignore
      }
    }
  }
  await walk(subscribeAnimationCacheDir)
}

export function setSubscribeAnimationCacheMaxBytes(bytes: number): void {
  if (Number.isFinite(bytes) && bytes > 0) maxBytes = bytes
}

export function listMissingStaticCacheHints(
  candidates: Array<{ cacheKey: string; templateId: SubscribeAnimationStyle }>,
): Array<{ cacheKey: string; templateId: SubscribeAnimationStyle }> {
  return candidates.filter((item) => {
    if (entries.has(item.cacheKey)) return false
    // One-slot policy: any existing static entry for this template counts as prepared.
    return ![...entries.values()].some((entry) => entry.kind === 'static' && entry.templateId === item.templateId)
  })
}

export type SubscribeAnimationCacheInventoryStatus =
  | 'cached'
  | 'not_cached'
  | 'outdated'
  | 'rendering'
  | 'failed'

export interface SubscribeAnimationCacheInventoryEntry {
  cacheKey: string | null
  templateId: SubscribeAnimationStyle
  name: string
  kind: SubscribeAnimationTemplateKind
  status: SubscribeAnimationCacheInventoryStatus
  fileSize: number
  createdAt: number | null
  lastUsedAt: number | null
  channelId: string | null
  channelName: string | null
  channelCardTheme: string | null
  width: number | null
  height: number | null
  frameCount: number | null
  busy: boolean
}

export interface SubscribeAnimationCacheChannelGroup {
  channelId: string
  channelName: string | null
  channelAvatarUrl: string | null
  animationCount: number
  totalBytes: number
  lastUpdatedAt: number | null
  animations: SubscribeAnimationCacheInventoryEntry[]
}

export interface SubscribeAnimationCacheInventory {
  staticAnimations: SubscribeAnimationCacheInventoryEntry[]
  channels: SubscribeAnimationCacheChannelGroup[]
  entries: SubscribeAnimationCacheInventoryEntry[]
}

function entryStatus(entry: StoredSubscribeAnimationCacheEntry | undefined): SubscribeAnimationCacheInventoryStatus {
  if (!entry) return 'not_cached'
  if (subscribeAnimationCacheIsBusy(entry.cacheKey)) return 'rendering'
  return 'cached'
}

export function listSubscribeAnimationCacheInventory(): SubscribeAnimationCacheInventory {
  const staticAnimations: SubscribeAnimationCacheInventoryEntry[] = SUBSCRIBE_ANIMATION_TEMPLATES.filter(
    (template) => template.kind === 'static',
  ).map((template) => {
    const match = [...entries.values()].find((entry) => entry.kind === 'static' && entry.templateId === template.id)
    return {
      cacheKey: match?.cacheKey ?? null,
      templateId: template.id,
      name: inventoryEntryName(template.id, match?.channelCardTheme),
      kind: 'static',
      status: entryStatus(match),
      fileSize: match?.fileSize ?? 0,
      createdAt: match?.createdAt ?? null,
      lastUsedAt: match?.lastUsedAt ?? null,
      channelId: null,
      channelName: null,
      channelCardTheme: match?.channelCardTheme ?? null,
      width: match?.width ?? null,
      height: match?.height ?? null,
      frameCount: match?.frameCount ?? null,
      busy: match ? subscribeAnimationCacheIsBusy(match.cacheKey) : false,
    }
  })

  for (const entry of entries.values()) {
    if (entry.kind !== 'static') continue
    if (staticAnimations.some((item) => item.cacheKey === entry.cacheKey)) continue
    staticAnimations.push({
      cacheKey: entry.cacheKey,
      templateId: entry.templateId,
      name: inventoryEntryName(entry.templateId, entry.channelCardTheme),
      kind: 'static',
      status: entryStatus(entry),
      fileSize: entry.fileSize,
      createdAt: entry.createdAt,
      lastUsedAt: entry.lastUsedAt,
      channelId: null,
      channelName: null,
      channelCardTheme: entry.channelCardTheme,
      width: entry.width,
      height: entry.height,
      frameCount: entry.frameCount,
      busy: subscribeAnimationCacheIsBusy(entry.cacheKey),
    })
  }

  const channelGroups: SubscribeAnimationCacheChannelGroup[] = []
  for (const meta of listSubscribeChannelMetas()) {
    const animations = [...entries.values()]
      .filter((entry) => entry.kind === 'dynamic' && entry.channelId === meta.channelId)
      .map((entry) => ({
        cacheKey: entry.cacheKey,
        templateId: entry.templateId,
        name: inventoryEntryName(entry.templateId, entry.channelCardTheme),
        kind: 'dynamic' as const,
        status: entryStatus(entry),
        fileSize: entry.fileSize,
        createdAt: entry.createdAt,
        lastUsedAt: entry.lastUsedAt,
        channelId: entry.channelId,
        channelName: meta.channelName,
        channelCardTheme: entry.channelCardTheme,
        width: entry.width,
        height: entry.height,
        frameCount: entry.frameCount,
        busy: subscribeAnimationCacheIsBusy(entry.cacheKey),
      }))
    channelGroups.push({
      channelId: meta.channelId,
      channelName: meta.channelName,
      channelAvatarUrl: meta.avatarUrl,
      animationCount: animations.length,
      totalBytes: animations.reduce((sum, item) => sum + item.fileSize, 0),
      lastUpdatedAt: Math.max(meta.updatedAt ?? 0, ...animations.map((item) => item.lastUsedAt ?? 0)) || null,
      animations,
    })
  }

  const knownChannels = new Set(channelGroups.map((item) => item.channelId))
  for (const entry of entries.values()) {
    if (entry.kind !== 'dynamic' || !entry.channelId || knownChannels.has(entry.channelId)) continue
    knownChannels.add(entry.channelId)
    channelGroups.push({
      channelId: entry.channelId,
      channelName: null,
      channelAvatarUrl: null,
      animationCount: 1,
      totalBytes: entry.fileSize,
      lastUpdatedAt: entry.lastUsedAt,
      animations: [
        {
          cacheKey: entry.cacheKey,
          templateId: entry.templateId,
          name: inventoryEntryName(entry.templateId, entry.channelCardTheme),
          kind: 'dynamic',
          status: entryStatus(entry),
          fileSize: entry.fileSize,
          createdAt: entry.createdAt,
          lastUsedAt: entry.lastUsedAt,
          channelId: entry.channelId,
          channelName: null,
          channelCardTheme: entry.channelCardTheme,
          width: entry.width,
          height: entry.height,
          frameCount: entry.frameCount,
          busy: subscribeAnimationCacheIsBusy(entry.cacheKey),
        },
      ],
    })
  }

  return {
    staticAnimations,
    channels: channelGroups,
    entries: [...staticAnimations, ...channelGroups.flatMap((channel) => channel.animations)],
  }
}

/** Remove cache entries older than retention based on lastUsedAt. Never deletes busy keys. */
export async function applySubscribeAnimationCacheRetention(maxAgeMs: number | null): Promise<{ removed: number }> {
  if (maxAgeMs == null || maxAgeMs <= 0) return { removed: 0 }
  const cutoff = Date.now() - maxAgeMs
  let removed = 0
  for (const entry of [...entries.values()]) {
    if (subscribeAnimationCacheIsBusy(entry.cacheKey)) continue
    const stamp = entry.lastUsedAt || entry.createdAt
    if (stamp >= cutoff) continue
    entries.delete(entry.cacheKey)
    await rm(entry.dir, { recursive: true, force: true }).catch(() => undefined)
    removed += 1
  }
  if (removed > 0) await saveRegistry()
  if (removed > 0) log(`Retention cleanup removed=${removed}`)
  return { removed }
}
