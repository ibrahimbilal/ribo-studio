import { Router } from 'express'
import multer from 'multer'
import { createReadStream } from 'node:fs'
import { rm, statfs } from 'node:fs/promises'
import path from 'node:path'
import { MAX_AUDIO_LOOPER_TRACKS } from '../../shared/audioLooper'
import {
  SCREENSAVER_AUDIO_MAX_BYTES,
  formatScreensaverAudioLimitLabel,
  validateScreensaverAudioFileMeta,
} from '../../shared/screensaverAudio'
import {
  addAudioAssetFromLooperJob,
  addAudioAssetFromLooperPlan,
  addAudioAssetFromUpload,
  audioAssetPublicView,
  getAudioAsset,
  removeAudioAsset,
} from './audioAssets'
import { getJob, jobOutput } from './jobs'
import { incomingDir, safeAudioExt, safeDownloadName } from './storage'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const audioUpload = multer({
  dest: incomingDir,
  limits: { fileSize: SCREENSAVER_AUDIO_MAX_BYTES, files: 1 },
})

const looperPlanUpload = multer({
  dest: incomingDir,
  limits: { fileSize: SCREENSAVER_AUDIO_MAX_BYTES, files: MAX_AUDIO_LOOPER_TRACKS },
})

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

async function assertDiskSpace(neededBytes: number): Promise<void> {
  try {
    const info = await statfs(incomingDir)
    const free = Number(info.bavail) * Number(info.bsize)
    if (Number.isFinite(free) && free > 0 && free < neededBytes + 64 * 1024 * 1024) {
      throw new Error('Not enough free disk space for this audio file.')
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('disk space')) throw error
    // Some platforms omit reliable free-space stats — skip the check.
  }
}

export function createScreensaverAudioRouter(): Router {
  const router = Router()

  router.post('/audio', (req, res) => {
    audioUpload.single('file')(req, res, async (err) => {
      const file = req.file
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        if (file?.path) await rm(file.path, { force: true }).catch(() => undefined)
        res.status(400).json({
          error: `Background audio must be ${formatScreensaverAudioLimitLabel()} or smaller.`,
        })
        return
      }
      if (err) {
        if (file?.path) await rm(file.path, { force: true }).catch(() => undefined)
        res.status(400).json({ error: messageOf(err, 'Audio upload failed.') })
        return
      }
      if (!file) {
        res.status(400).json({ error: 'Choose an audio file.' })
        return
      }
      try {
        const problem = validateScreensaverAudioFileMeta({
          name: file.originalname,
          type: file.mimetype,
          size: file.size,
        })
        if (problem) throw new Error(problem)
        if (!safeAudioExt(file.originalname)) {
          throw new Error('Background audio must be an MP3, WAV, FLAC, M4A, AAC, or OGG file.')
        }
        await assertDiskSpace(file.size)
        const stored = await addAudioAssetFromUpload(file.path, file.originalname, file.mimetype)
        res.json(audioAssetPublicView(stored))
      } catch (error) {
        await rm(file.path, { force: true }).catch(() => undefined)
        res.status(400).json({ error: messageOf(error, 'Audio upload failed.') })
      }
    })
  })

  router.post('/audio/from-job', async (req, res) => {
    try {
      const jobId = typeof req.body?.jobId === 'string' ? req.body.jobId.trim() : ''
      if (!UUID.test(jobId)) {
        res.status(400).json({ error: 'Choose a completed Audio Looper export.' })
        return
      }
      const job = getJob(jobId)
      if (!job || job.kind !== 'audio-looper') {
        res.status(404).json({ error: 'That Audio Looper export is no longer available.' })
        return
      }
      if (job.status !== 'done') {
        res.status(409).json({ error: 'Wait until the Audio Looper export finishes.' })
        return
      }
      const output = jobOutput(jobId)
      if (!output) {
        res.status(404).json({ error: 'That Audio Looper export file is missing.' })
        return
      }
      await assertDiskSpace(job.outputBytes || 0)
      const ext = job.outputExt?.startsWith('.') ? job.outputExt : `.${job.outputExt || path.extname(output.path) || 'mp3'}`
      const name = `${safeDownloadName(job.downloadName || 'looper-audio')}${ext}`
      const stored = await addAudioAssetFromLooperJob(jobId, output.path, name)
      res.json(audioAssetPublicView(stored))
    } catch (error) {
      res.status(400).json({ error: messageOf(error, 'Could not transfer the Audio Looper export.') })
    }
  })

  /** Transfer original Looper sources + settings (no intermediate lossy export). */
  router.post('/audio/from-looper-plan', (req, res) => {
    looperPlanUpload.array('files', MAX_AUDIO_LOOPER_TRACKS)(req, res, async (err) => {
      const files = (req.files as Express.Multer.File[] | undefined) ?? []
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        await Promise.all(files.map((file) => rm(file.path, { force: true }).catch(() => undefined)))
        res.status(400).json({
          error: `Background audio must be ${formatScreensaverAudioLimitLabel()} or smaller.`,
        })
        return
      }
      if (err) {
        await Promise.all(files.map((file) => rm(file.path, { force: true }).catch(() => undefined)))
        res.status(400).json({ error: messageOf(err, 'Could not transfer the Audio Looper plan.') })
        return
      }
      try {
        if (files.length === 0) throw new Error('Choose at least one audio file.')
        let needed = 0
        for (const file of files) {
          needed += file.size
          if (!safeAudioExt(file.originalname)) {
            throw new Error('Background audio must be an MP3, WAV, FLAC, M4A, AAC, or OGG file.')
          }
        }
        await assertDiskSpace(needed)
        const stored = await addAudioAssetFromLooperPlan(
          files.map((file) => ({ path: file.path, originalName: file.originalname, size: file.size })),
          req.body?.settings,
        )
        res.json(audioAssetPublicView(stored))
      } catch (error) {
        await Promise.all(files.map((file) => rm(file.path, { force: true }).catch(() => undefined)))
        res.status(400).json({ error: messageOf(error, 'Could not transfer the Audio Looper plan.') })
      }
    })
  })

  router.get('/audio/:id', async (req, res) => {
    const id = String(req.params.id || '')
    if (!UUID.test(id)) {
      res.status(400).json({ error: 'Invalid audio id.' })
      return
    }
    const stored = getAudioAsset(id)
    if (!stored) {
      res.status(404).json({ error: 'That background audio file is no longer available.' })
      return
    }
    if (req.query.meta === '1' || req.query.meta === 'true') {
      res.json(audioAssetPublicView(stored))
      return
    }
    res.setHeader('Content-Type', stored.mimeType || 'application/octet-stream')
    res.setHeader('Content-Length', String(stored.size))
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${stored.originalName.replace(/"/g, '')}"`,
    )
    createReadStream(stored.path).pipe(res)
  })

  router.delete('/audio/:id', async (req, res) => {
    const id = String(req.params.id || '')
    if (!UUID.test(id)) {
      res.status(400).json({ error: 'Invalid audio id.' })
      return
    }
    const ok = await removeAudioAsset(id)
    if (!ok) {
      const stored = getAudioAsset(id)
      if (stored) {
        res.status(409).json({ error: 'That audio file is in use by a render.' })
        return
      }
      res.status(404).json({ error: 'That background audio file is no longer available.' })
      return
    }
    res.json({ ok: true })
  })

  return router
}

export { audioUpload }
