import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { DEFAULT_SERVER_GLOBAL_SETTINGS, migrateServerGlobalSettings } from '../../shared/globalSettings'
import { getServerGlobalSettings, resetServerGlobalSettings, updateServerGlobalSettings } from './globalSettings'

describe('server global settings', () => {
  after(async () => {
    await resetServerGlobalSettings()
  })

  it('merges patches with defaults and keeps schema version', async () => {
    const saved = await updateServerGlobalSettings({
      storage: { ...DEFAULT_SERVER_GLOBAL_SETTINGS.storage, cacheRetention: '7d' },
      performance: { ...DEFAULT_SERVER_GLOBAL_SETTINGS.performance, autoCpuThreads: false, cpuThreadLimit: 2 },
    })
    assert.equal(saved.storage.cacheRetention, '7d')
    assert.equal(saved.performance.cpuThreadLimit, 2)
    assert.equal(getServerGlobalSettings().performance.autoCpuThreads, false)
  })

  it('recovers corrupt server payloads via migrate', () => {
    const recovered = migrateServerGlobalSettings({ schemaVersion: 'nope', storage: null, performance: 3 })
    assert.equal(recovered.schemaVersion, DEFAULT_SERVER_GLOBAL_SETTINGS.schemaVersion)
    assert.equal(recovered.storage.persistentAnimationCacheEnabled, true)
    assert.equal(recovered.performance.hardwareAcceleration, 'auto')
  })
})
