import {
  formatDurationLabel,
  MAX_DURATION_SECONDS,
  MIN_DURATION_SECONDS,
  type ScreensaverAudioMode,
} from '../../../../../shared/screensaver'
import {
  validateSubscribeAnimation,
  type SubscribeAnimationSettings,
} from '../../../../../shared/screensaverSubscribeAnimation'
import { isLiveRenderStatus, type ScreensaverProjectStatus } from './screensaverProjectModel'

/** Keep aligned with `DUPLICATE_EXPORT_MESSAGE` in `client/src/lib/exportFingerprint.ts`. */
const DUPLICATE_EXPORT_SKIP_LABEL = 'Change the project before exporting again.'

export const MAX_SCREENSAVER_EXPORT_JOBS = 12

export type ExportAllSkipReason =
  | 'no-media'
  | 'source-missing'
  | 'not-uploaded'
  | 'already-exporting'
  | 'invalid-mode'
  | 'invalid-cfr'
  | 'invalid-duration'
  | 'audio-missing'
  | 'audio-busy'
  | 'frame-missing'
  | 'subscribe-invalid'
  | 'duplicate-export'
  | 'queue-full'

export type ExportAllCandidate = {
  id: string
  name: string
  mediaKind: 'image' | 'video' | null
  serverId: string | null
  sourceMissing: boolean
  uploadReady: boolean
  renderStatus: ScreensaverProjectStatus
  mode: 'static' | 'loop'
  renderingMode: string
  durationSeconds: number
  audioMode: ScreensaverAudioMode
  audioAvailable: boolean
  audioBusy: boolean
  frameMissing: boolean
  subscribeAnimation: SubscribeAnimationSettings | null | undefined
  duplicateExport: boolean
  alreadyQueuedInClient: boolean
}

export type ExportAllDecision =
  | { id: string; name: string; kind: 'eligible' }
  | { id: string; name: string; kind: 'skipped'; reason: ExportAllSkipReason }

export function skipReasonLabel(reason: ExportAllSkipReason): string {
  switch (reason) {
    case 'no-media':
      return 'No media'
    case 'source-missing':
      return 'Source file missing'
    case 'not-uploaded':
      return 'Source not on the renderer'
    case 'already-exporting':
      return 'Already exporting'
    case 'invalid-mode':
      return 'Mode does not match media'
    case 'invalid-cfr':
      return 'Optimized CFR needs a static image'
    case 'invalid-duration':
      return `Duration must be between ${formatDurationLabel(MIN_DURATION_SECONDS)} and ${formatDurationLabel(MAX_DURATION_SECONDS)}`
    case 'audio-missing':
      return 'Background audio missing'
    case 'audio-busy':
      return 'Background audio still uploading'
    case 'frame-missing':
      return 'Selected frame missing'
    case 'subscribe-invalid':
      return 'Invalid subscribe animation'
    case 'duplicate-export':
      return DUPLICATE_EXPORT_SKIP_LABEL
    case 'queue-full':
      return `Export queue is full (${MAX_SCREENSAVER_EXPORT_JOBS} items)`
  }
}

export function evaluateExportCandidate(candidate: ExportAllCandidate): ExportAllDecision {
  if (candidate.mediaKind !== 'image' && candidate.mediaKind !== 'video') {
    return { id: candidate.id, name: candidate.name, kind: 'skipped', reason: 'no-media' }
  }
  if (candidate.sourceMissing) {
    return { id: candidate.id, name: candidate.name, kind: 'skipped', reason: 'source-missing' }
  }
  if (!candidate.serverId || !candidate.uploadReady) {
    return { id: candidate.id, name: candidate.name, kind: 'skipped', reason: 'not-uploaded' }
  }
  if (isLiveRenderStatus(candidate.renderStatus) || candidate.alreadyQueuedInClient) {
    return { id: candidate.id, name: candidate.name, kind: 'skipped', reason: 'already-exporting' }
  }
  if (candidate.mode === 'loop' && candidate.mediaKind !== 'video') {
    return { id: candidate.id, name: candidate.name, kind: 'skipped', reason: 'invalid-mode' }
  }
  if (candidate.mode === 'static' && candidate.mediaKind !== 'image') {
    return { id: candidate.id, name: candidate.name, kind: 'skipped', reason: 'invalid-mode' }
  }
  if (
    candidate.renderingMode === 'optimized-cfr' &&
    (candidate.mode !== 'static' || candidate.mediaKind !== 'image')
  ) {
    return { id: candidate.id, name: candidate.name, kind: 'skipped', reason: 'invalid-cfr' }
  }
  if (
    candidate.durationSeconds < MIN_DURATION_SECONDS ||
    candidate.durationSeconds > MAX_DURATION_SECONDS
  ) {
    return { id: candidate.id, name: candidate.name, kind: 'skipped', reason: 'invalid-duration' }
  }
  if (candidate.audioMode === 'upload') {
    if (candidate.audioBusy) {
      return { id: candidate.id, name: candidate.name, kind: 'skipped', reason: 'audio-busy' }
    }
    if (!candidate.audioAvailable) {
      return { id: candidate.id, name: candidate.name, kind: 'skipped', reason: 'audio-missing' }
    }
  }
  if (candidate.frameMissing) {
    return { id: candidate.id, name: candidate.name, kind: 'skipped', reason: 'frame-missing' }
  }
  if (candidate.subscribeAnimation?.enabled) {
    const animCheck = validateSubscribeAnimation(
      candidate.subscribeAnimation,
      candidate.durationSeconds,
      { staticImage: candidate.mode === 'static' && candidate.mediaKind === 'image' },
    )
    if (!animCheck.ok) {
      return { id: candidate.id, name: candidate.name, kind: 'skipped', reason: 'subscribe-invalid' }
    }
  }
  if (candidate.duplicateExport) {
    return { id: candidate.id, name: candidate.name, kind: 'skipped', reason: 'duplicate-export' }
  }
  return { id: candidate.id, name: candidate.name, kind: 'eligible' }
}

/** Evaluate projects in list order; mark later ones queue-full once capacity is reached. */
export function planExportAll(
  candidates: readonly ExportAllCandidate[],
  options: { remainingQueueSlots: number } = { remainingQueueSlots: MAX_SCREENSAVER_EXPORT_JOBS },
): { eligible: ExportAllDecision[]; skipped: Extract<ExportAllDecision, { kind: 'skipped' }>[] } {
  const eligible: ExportAllDecision[] = []
  const skipped: Extract<ExportAllDecision, { kind: 'skipped' }>[] = []
  let slots = Math.max(0, options.remainingQueueSlots)

  for (const candidate of candidates) {
    const decision = evaluateExportCandidate(candidate)
    if (decision.kind === 'skipped') {
      skipped.push(decision)
      continue
    }
    if (slots <= 0) {
      skipped.push({ id: candidate.id, name: candidate.name, kind: 'skipped', reason: 'queue-full' })
      continue
    }
    eligible.push(decision)
    slots -= 1
  }

  return { eligible, skipped }
}

/** Keep download names unique within a batch while preserving project order. */
export function uniqueDownloadFilenames(names: readonly string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((raw) => {
    const base = (raw.trim() || 'screensaver').replace(/\.mp4$/i, '')
    const count = seen.get(base.toLowerCase()) ?? 0
    seen.set(base.toLowerCase(), count + 1)
    if (count === 0) return `${base}.mp4`
    return `${base} (${count + 1}).mp4`
  })
}

export function exportAllNotificationMessage(input: {
  submitted: number
  started: number
  queued: number
  skipped: number
}): { text: string; tone: 'success' | 'info' } {
  const { submitted, started, queued, skipped } = input
  if (submitted <= 0) {
    return {
      text:
        skipped > 0
          ? `No projects submitted. ${skipped} skipped.`
          : 'No projects are eligible for export.',
      tone: 'info',
    }
  }
  if (started > 0 && queued > 0) {
    return {
      text: `${started} project${started === 1 ? '' : 's'} started rendering. ${queued} project${queued === 1 ? '' : 's'} added to the queue.${skipped > 0 ? ` ${skipped} skipped.` : ''}`,
      tone: 'success',
    }
  }
  if (started > 0) {
    return {
      text: `${started} project${started === 1 ? '' : 's'} started rendering.${skipped > 0 ? ` ${skipped} skipped.` : ''}`,
      tone: 'success',
    }
  }
  if (queued > 0 && skipped > 0) {
    return {
      text: `${queued} project${queued === 1 ? '' : 's'} queued. ${skipped} skipped because they are already exporting or invalid.`,
      tone: 'info',
    }
  }
  if (queued > 0) {
    return {
      text: `${queued} project${queued === 1 ? '' : 's'} added to the queue.`,
      tone: 'success',
    }
  }
  return {
    text: `${submitted} project${submitted === 1 ? '' : 's'} submitted for export.`,
    tone: 'success',
  }
}

/** Queue position among client waiting jobs (idle/queued). Rendering job is not numbered. */
export function clientQueuePosition(
  projectId: string,
  jobs: readonly { projectId: string | null; phase: string }[],
): number | null {
  const waiting = jobs.filter(
    (job) =>
      job.projectId &&
      (job.phase === 'idle' || job.phase === 'queued'),
  )
  const index = waiting.findIndex((job) => job.projectId === projectId)
  return index >= 0 ? index + 1 : null
}
