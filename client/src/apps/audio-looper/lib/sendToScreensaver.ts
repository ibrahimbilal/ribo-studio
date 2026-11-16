import { router } from '../../../app/router'
import * as api from '../../../lib/api'
import { useScreensaverStore } from '../../frame-screensaver/stores/screensaver'
import { useAudioLooperStore } from '../stores/audioLooper'
import {
  isIdentityTrackOrder,
  playlistOrdersForProjects,
  transferNotificationMessage,
  type PlaylistOrderMode,
  type SendTransferResult,
} from './sendToScreensaverSelection'

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
 * Upload the Looper plan once, then attach audio to every selected project.
 * `shared` playlist order reuses one asset; `unique` clones hardlinked recipe variants per project.
 */
export async function sendLooperPlanToScreensaverProjects(
  projectIds: string[],
  options: { createNew?: boolean; navigate?: boolean; playlistOrderMode?: PlaylistOrderMode } = {},
): Promise<SendTransferResult> {
  const looper = useAudioLooperStore()
  const files = looper.readyTracks.map((track) => track.file)
  if (files.length === 0) throw new Error('Add at least one audio track first.')
  if (projectIds.length === 0 && !options.createNew) {
    throw new Error('Select at least one Screensaver project.')
  }

  const settings = looper.buildExportSettings()
  const baseAsset = await api.uploadLooperPlanForScreensaver(files, settings)
  const screensaver = useScreensaverStore()
  if (!screensaver.hydrated) await screensaver.init()

  const mode: PlaylistOrderMode = options.playlistOrderMode ?? 'shared'
  const uniqueIds = [...new Set(projectIds.filter(Boolean))]
  const useUnique = mode === 'unique' && files.length >= 2 && uniqueIds.length > 1

  if (!useUnique) {
    const result = await screensaver.assignAudioAssetToProjects(baseAsset, uniqueIds, {
      createNew: options.createNew === true,
    })
    if (options.navigate !== false && result.ok.length > 0) {
      await router.push('/screensaver')
    }
    return result
  }

  const orders = playlistOrdersForProjects(files.length, uniqueIds.length, 'unique')
  const result: SendTransferResult = { ok: [], failed: [], skipped: [] }
  const assetsByOrder = new Map<string, api.ScreensaverAudioAsset>()

  if (options.createNew) {
    const created = await screensaver.assignAudioAssetToProjects(baseAsset, [], { createNew: true })
    result.ok.push(...created.ok)
    result.failed.push(...created.failed)
    result.skipped.push(...created.skipped)
  }

  for (let index = 0; index < uniqueIds.length; index += 1) {
    const projectId = uniqueIds[index]!
    const order = orders[index] ?? orders[0]!
    const orderKey = order.join(',')
    try {
      let asset = assetsByOrder.get(orderKey)
      if (!asset) {
        asset =
          isIdentityTrackOrder(order)
            ? baseAsset
            : await api.cloneLooperPlanOrderForScreensaver(baseAsset.id, order)
        assetsByOrder.set(orderKey, asset)
      }
      const partial = await screensaver.assignAudioAssetToProjects(asset, [projectId])
      result.ok.push(...partial.ok)
      result.failed.push(...partial.failed)
      result.skipped.push(...partial.skipped)
    } catch (error) {
      const summary = screensaver.projects.find((item) => item.id === projectId)
      result.failed.push({
        id: projectId,
        name: summary?.name || 'Screensaver project',
        reason: error instanceof Error ? error.message : 'Could not attach audio.',
      })
    }
  }

  if (options.navigate !== false && result.ok.length > 0) {
    await router.push('/screensaver')
  }
  return result
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

export async function sendLooperJobToScreensaverProjects(
  jobId: string,
  projectIds: string[],
  options: { createNew?: boolean; navigate?: boolean } = {},
): Promise<SendTransferResult> {
  if (projectIds.length === 0 && !options.createNew) {
    throw new Error('Select at least one Screensaver project.')
  }
  const asset = await api.adoptLooperAudioForScreensaver(jobId)
  const screensaver = useScreensaverStore()
  if (!screensaver.hydrated) await screensaver.init()
  const result = await screensaver.assignAudioAssetToProjects(asset, projectIds, {
    createNew: options.createNew === true,
  })
  if (options.navigate !== false && result.ok.length > 0) {
    await router.push('/screensaver')
  }
  return result
}

export { transferNotificationMessage }

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
