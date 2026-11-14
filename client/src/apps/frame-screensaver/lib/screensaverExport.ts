import { cancelJob, startScreensaverExport } from '../../../lib/api'
import { pollJobUntilDone, type JobPollUpdate } from '../../../lib/jobPoll'
import type { ExportState } from '../../../types'
import {
  SCREENSAVER_PREPARE_PROGRESS_END,
  screensaverPrepareUiProgress,
} from './screensaverPrepareProgress'

export type ScreensaverExportUpdate = JobPollUpdate & { phase?: ExportState['phase'] }

interface ScreensaverExportInput {
  projectJson: Record<string, unknown>
  audioFile: File | null
  compositionBlob: Blob | null
  frameBlob: Blob | null
  maskBlob: Blob | null
  animationFrameBlobs: Blob[] | null
  /** When true, upload weight follows the animation-enabled prepare curve. */
  animationEnabled?: boolean
  signal: AbortSignal
  onUpdate: (patch: ScreensaverExportUpdate) => void
}

export async function submitScreensaverExport(input: ScreensaverExportInput): Promise<string> {
  const body = new FormData()
  body.append('project', JSON.stringify(input.projectJson))
  if (input.audioFile) body.append('audio', input.audioFile, input.audioFile.name)
  if (input.compositionBlob) body.append('composition', input.compositionBlob, 'composition.png')
  if (input.frameBlob) body.append('frame', input.frameBlob, 'frame.png')
  if (input.maskBlob) body.append('mask', input.maskBlob, 'mask.png')
  if (input.animationFrameBlobs?.length) {
    input.animationFrameBlobs.forEach((blob, index) => {
      body.append('animationFrames', blob, `frame-${String(index).padStart(4, '0')}.png`)
    })
  }

  const animationEnabled = Boolean(input.animationEnabled)
  const uploadProgress = (fraction: number) =>
    screensaverPrepareUiProgress(animationEnabled, {
      composition: 1,
      animation: animationEnabled ? 1 : 0,
      upload: fraction,
    })

  input.onUpdate({
    phase: 'uploading',
    progress: uploadProgress(0),
    message: 'Sending export settings.',
    stage: 'Uploading export',
    error: null,
    warning: null,
    downloadUrl: null,
  })
  const started = await startScreensaverExport(
    body,
    (fraction) => {
      input.onUpdate({
        phase: 'uploading',
        progress: uploadProgress(fraction),
        message: 'Uploading export files.',
        stage: 'Uploading export',
      })
    },
    input.signal,
  )
  if (input.signal.aborted) {
    await cancelJob(started.jobId)
    throw new DOMException('The export was cancelled.', 'AbortError')
  }
  input.onUpdate({
    phase: 'queued',
    progress: SCREENSAVER_PREPARE_PROGRESS_END,
    message: 'Export queued on the renderer.',
    stage: 'Queued',
  })
  return started.jobId
}

export async function runScreensaverExport(input: ScreensaverExportInput): Promise<void> {
  const jobId = await submitScreensaverExport(input)
  try {
    await pollJobUntilDone(jobId, input.signal, (patch) => {
      input.onUpdate(patch as ScreensaverExportUpdate)
    }, SCREENSAVER_PREPARE_PROGRESS_END)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      input.onUpdate({ phase: 'cancelled', message: 'Export cancelled.', error: null })
      return
    }
    throw error
  }
}
