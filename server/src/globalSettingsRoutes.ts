import { Router } from 'express'
import { migrateServerGlobalSettings } from '../../shared/globalSettings'
import { getServerGlobalSettings, loadServerGlobalSettings, updateServerGlobalSettings } from './globalSettings'

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function createGlobalSettingsRouter(): Router {
  const router = Router()

  router.get('/global-settings', async (_req, res) => {
    try {
      res.json(await loadServerGlobalSettings())
    } catch (error) {
      res.status(500).json({ error: messageOf(error, 'Could not load global settings.') })
    }
  })

  router.put('/global-settings', async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {}
      const normalized = migrateServerGlobalSettings({
        schemaVersion: getServerGlobalSettings().schemaVersion,
        storage: body.storage,
        performance: body.performance,
      })
      const saved = await updateServerGlobalSettings({
        storage: normalized.storage,
        performance: normalized.performance,
      })
      res.json(saved)
    } catch (error) {
      res.status(400).json({ error: messageOf(error, 'Could not save global settings.') })
    }
  })

  router.patch('/global-settings', async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {}
      const saved = await updateServerGlobalSettings({
        storage: body.storage,
        performance: body.performance,
      })
      res.json(saved)
    } catch (error) {
      res.status(400).json({ error: messageOf(error, 'Could not update global settings.') })
    }
  })

  return router
}
