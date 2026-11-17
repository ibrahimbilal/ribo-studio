import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  DEFAULT_SERVER_GLOBAL_SETTINGS,
  migrateServerGlobalSettings,
  type ServerGlobalSettings,
} from '../../shared/globalSettings'
import { tmpDir } from './storage'

const settingsPath = path.join(tmpDir, 'global-settings.json')

let cached: ServerGlobalSettings = structuredClone(DEFAULT_SERVER_GLOBAL_SETTINGS)
let loaded = false

export function getServerGlobalSettings(): ServerGlobalSettings {
  return cached
}

export async function loadServerGlobalSettings(): Promise<ServerGlobalSettings> {
  if (loaded) return cached
  try {
    const raw = await readFile(settingsPath, 'utf8')
    cached = migrateServerGlobalSettings(JSON.parse(raw))
  } catch {
    cached = structuredClone(DEFAULT_SERVER_GLOBAL_SETTINGS)
  }
  loaded = true
  return cached
}

async function persist(next: ServerGlobalSettings): Promise<void> {
  await mkdir(tmpDir, { recursive: true })
  const tmp = `${settingsPath}.${process.pid}.partial`
  await writeFile(tmp, JSON.stringify(next, null, 2), 'utf8')
  await rename(tmp, settingsPath)
}

export async function updateServerGlobalSettings(
  patch: Partial<Pick<ServerGlobalSettings, 'storage' | 'performance'>>,
): Promise<ServerGlobalSettings> {
  await loadServerGlobalSettings()
  const merged = migrateServerGlobalSettings({
    schemaVersion: cached.schemaVersion,
    storage: patch.storage ? { ...cached.storage, ...patch.storage } : cached.storage,
    performance: patch.performance ? { ...cached.performance, ...patch.performance } : cached.performance,
  })
  const unchanged = JSON.stringify(merged) === JSON.stringify(cached)
  cached = merged
  if (!unchanged) await persist(cached)
  return cached
}

export async function resetServerGlobalSettings(): Promise<ServerGlobalSettings> {
  cached = structuredClone(DEFAULT_SERVER_GLOBAL_SETTINGS)
  loaded = true
  await persist(cached)
  return cached
}
