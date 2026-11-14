import { router } from '../../../app/router'
import * as api from '../../../lib/api'
import { useScreensaverStore } from '../../frame-screensaver/stores/screensaver'
import { useAudioLooperStore } from '../stores/audioLooper'

export type SendToScreensaverTarget = 'new' | 'current' | string

/**
 * Transfer current Looper sources + settings as a Screensaver audio recipe
 * (no intermediate lossy export required).
 */
export async function sendLooperPlanToScreensaver(target: SendToScreensaverTarget): Promise<void> {
  const looper = useAudioLooperStore()
  const files = looper.readyTracks.map((track) => track.file)
  if (files.length === 0) throw new Error('Add at least one audio track first.')

  const settings = looper.buildExportSettings()
  const asset = await api.uploadLooperPlanForScreensaver(files, settings)
  await assignAsset(asset, target)
}

/**
 * Adopt a finished Audio Looper job output as Screensaver background audio
 * without downloading/re-uploading the file through the browser.
 */
export async function sendLooperJobToScreensaver(
  jobId: string,
  target: SendToScreensaverTarget,
): Promise<void> {
  const asset = await api.adoptLooperAudioForScreensaver(jobId)
  await assignAsset(asset, target)
}

async function assignAsset(asset: api.ScreensaverAudioAsset, target: SendToScreensaverTarget): Promise<void> {
  const screensaver = useScreensaverStore()
  if (!screensaver.hydrated) await screensaver.init()

  if (target === 'new') {
    await screensaver.newProject()
  } else if (target !== 'current') {
    await screensaver.openProject(target)
  }

  const assigned = await screensaver.assignAudioAsset(asset, {
    replaceConfirm: target !== 'new',
  })
  if (!assigned) return
  await router.push('/screensaver')
}
