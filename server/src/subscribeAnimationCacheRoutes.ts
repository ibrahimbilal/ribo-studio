import { Router } from 'express'
import multer from 'multer'
import { rm } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import {
  SUBSCRIBE_ANIMATION_DURATION_SEC,
  SUBSCRIBE_ANIMATION_EXPORT_FRAME_CAP,
  SUBSCRIBE_ANIMATION_FPS,
  isSubscribeAnimationStyle,
  type SubscribeAnimationStyle,
} from '../../shared/screensaverSubscribeAnimation'
import { isValidCacheKeyHex, type SubscribeAnimationCacheClearScope } from '../../shared/subscribeAnimationCache'
import type { SubscribeAnimationCacheKeyPayload } from '../../shared/subscribeAnimationCacheKey'
import { isYoutubeChannelId } from '../../shared/youtubeChannelId'
import { incomingDir } from './storage'
import {
  clearSubscribeAnimationCache,
  getCachedAnimation,
  getSubscribeAnimationCacheStats,
  getSubscribeChannelMeta,
  listMissingStaticCacheHints,
  listSubscribeChannelMetas,
  putCachedAnimation,
  storeChannelAvatar,
  upsertSubscribeChannelMeta,
} from './subscribeAnimationCache'

const entryUpload = multer({
  dest: incomingDir,
  limits: { fileSize: 12 * 1024 * 1024, files: SUBSCRIBE_ANIMATION_EXPORT_FRAME_CAP + 1 },
})

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function createSubscribeAnimationCacheRouter(): Router {
  const router = Router()

  router.get('/subscribe-animation-cache/status', async (req, res) => {
    try {
      const key = typeof req.query.key === 'string' ? req.query.key.trim() : ''
      if (!isValidCacheKeyHex(key)) {
        res.status(400).json({ error: 'Provide a valid cache key.' })
        return
      }
      const entry = await getCachedAnimation(key)
      if (!entry) {
        res.json({ ready: false, cacheKey: key })
        return
      }
      res.json({ ready: true, entry })
    } catch (error) {
      res.status(400).json({ error: messageOf(error, 'Cache status lookup failed.') })
    }
  })

  router.get('/subscribe-animation-cache/stats', async (_req, res) => {
    try {
      res.json(await getSubscribeAnimationCacheStats())
    } catch (error) {
      res.status(400).json({ error: messageOf(error, 'Could not read cache stats.') })
    }
  })

  router.get('/subscribe-animation-cache/channels', (_req, res) => {
    res.json({ channels: listSubscribeChannelMetas() })
  })

  router.get('/subscribe-animation-cache/channels/:channelId', (req, res) => {
    const channelId = req.params.channelId
    if (!isYoutubeChannelId(channelId)) {
      res.status(400).json({ error: 'Invalid YouTube channel ID.' })
      return
    }
    const meta = getSubscribeChannelMeta(channelId)
    if (!meta) {
      res.status(404).json({ error: 'Channel cache not found.' })
      return
    }
    res.json(meta)
  })

  router.post('/subscribe-animation-cache/channels', async (req, res) => {
    try {
      const channelId = typeof req.body?.channelId === 'string' ? req.body.channelId.trim() : ''
      if (!isYoutubeChannelId(channelId)) {
        res.status(400).json({ error: 'Invalid YouTube channel ID.' })
        return
      }
      const meta = await upsertSubscribeChannelMeta({
        channelId,
        channelName: typeof req.body?.channelName === 'string' ? req.body.channelName.slice(0, 120) : null,
        channelUrl: typeof req.body?.channelUrl === 'string' ? req.body.channelUrl.slice(0, 600) : null,
        subscriberCount: typeof req.body?.subscriberCount === 'string' ? req.body.subscriberCount.slice(0, 48) : null,
        avatarContentHash: typeof req.body?.avatarContentHash === 'string' ? req.body.avatarContentHash : null,
        avatarUrl: typeof req.body?.avatarUrl === 'string' ? req.body.avatarUrl.slice(0, 500) : null,
        updatedAt: Date.now(),
      })
      res.json(meta)
    } catch (error) {
      res.status(400).json({ error: messageOf(error, 'Could not store channel metadata.') })
    }
  })

  router.post('/subscribe-animation-cache/channels/:channelId/avatar', (req, res) => {
    entryUpload.single('avatar')(req, res, async (err) => {
      const file = req.file
      const channelId = req.params.channelId
      if (!isYoutubeChannelId(channelId)) {
        if (file?.path) await rm(file.path, { force: true }).catch(() => undefined)
        res.status(400).json({ error: 'Invalid YouTube channel ID.' })
        return
      }
      if (err || !file) {
        if (file?.path) await rm(file.path, { force: true }).catch(() => undefined)
        res.status(400).json({ error: messageOf(err, 'Avatar upload failed.') })
        return
      }
      try {
        const bytes = await readFile(file.path)
        const stored = await storeChannelAvatar(channelId, bytes, file.originalname || '.png')
        await rm(file.path, { force: true }).catch(() => undefined)
        res.json(stored)
      } catch (error) {
        await rm(file.path, { force: true }).catch(() => undefined)
        res.status(400).json({ error: messageOf(error, 'Avatar upload failed.') })
      }
    })
  })

  router.post('/subscribe-animation-cache/prepare-static', async (req, res) => {
    try {
      const candidates = Array.isArray(req.body?.candidates) ? req.body.candidates : []
      const normalized: Array<{ cacheKey: string; templateId: SubscribeAnimationStyle }> = []
      for (const item of candidates) {
        if (!item || typeof item !== 'object') continue
        const cacheKey = typeof item.cacheKey === 'string' ? item.cacheKey.trim() : ''
        const templateId = item.templateId
        if (!isValidCacheKeyHex(cacheKey) || !isSubscribeAnimationStyle(templateId)) continue
        normalized.push({ cacheKey, templateId })
      }
      const missing = listMissingStaticCacheHints(normalized)
      res.json({ missing })
    } catch (error) {
      res.status(400).json({ error: messageOf(error, 'Could not list missing static animations.') })
    }
  })

  router.post('/subscribe-animation-cache/entries', (req, res) => {
    entryUpload.fields([{ name: 'frames', maxCount: SUBSCRIBE_ANIMATION_EXPORT_FRAME_CAP }])(req, res, async (err) => {
      const files = req.files as { frames?: Express.Multer.File[] } | undefined
      const frames = files?.frames ?? []
      if (err) {
        await Promise.all(frames.map((file) => rm(file.path, { force: true }).catch(() => undefined)))
        res.status(400).json({ error: messageOf(err, 'Cache upload failed.') })
        return
      }
      try {
        const metaRaw = typeof req.body?.meta === 'string' ? req.body.meta : ''
        const meta = JSON.parse(metaRaw) as {
          cacheKey?: string
          kind?: string
          templateId?: string
          channelId?: string | null
          width?: number
          height?: number
          fps?: number
          durationSec?: number
          renderConfig?: SubscribeAnimationCacheKeyPayload
        }
        if (!isValidCacheKeyHex(meta.cacheKey)) throw new Error('Invalid cache key.')
        if (meta.kind !== 'static' && meta.kind !== 'dynamic') throw new Error('Invalid animation kind.')
        if (!isSubscribeAnimationStyle(meta.templateId)) throw new Error('Invalid template id.')
        if (!Number.isFinite(meta.width) || !Number.isFinite(meta.height)) throw new Error('Invalid dimensions.')
        if (!frames.length) throw new Error('Animation frames are required.')
        frames.sort((a, b) => a.originalname.localeCompare(b.originalname, undefined, { numeric: true }))
        const entry = await putCachedAnimation({
          cacheKey: meta.cacheKey!,
          kind: meta.kind,
          templateId: meta.templateId,
          channelId: meta.channelId ?? null,
          framePaths: frames.map((file) => file.path),
          width: Math.round(Number(meta.width)),
          height: Math.round(Number(meta.height)),
          fps: Number(meta.fps) || SUBSCRIBE_ANIMATION_FPS,
          durationSec: Number(meta.durationSec) || SUBSCRIBE_ANIMATION_DURATION_SEC,
          renderConfig: meta.renderConfig as SubscribeAnimationCacheKeyPayload,
        })
        res.json(entry)
      } catch (error) {
        await Promise.all(frames.map((file) => rm(file.path, { force: true }).catch(() => undefined)))
        res.status(400).json({ error: messageOf(error, 'Could not store cached animation.') })
      }
    })
  })

  router.post('/subscribe-animation-cache/clear', async (req, res) => {
    try {
      const scope = (typeof req.body?.scope === 'string' ? req.body.scope : 'all') as SubscribeAnimationCacheClearScope['scope']
      if (!['all', 'static', 'channel', 'entry'].includes(scope)) {
        res.status(400).json({ error: 'Invalid clear scope.' })
        return
      }
      const result = await clearSubscribeAnimationCache({
        scope,
        channelId: typeof req.body?.channelId === 'string' ? req.body.channelId : undefined,
        cacheKey: typeof req.body?.cacheKey === 'string' ? req.body.cacheKey : undefined,
      })
      res.json(result)
    } catch (error) {
      res.status(400).json({ error: messageOf(error, 'Could not clear cache.') })
    }
  })

  return router
}
