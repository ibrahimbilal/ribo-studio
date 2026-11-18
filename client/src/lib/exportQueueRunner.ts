import { pollJobUntilDone, type JobPollUpdate } from './jobPoll'

export type ExportQueueSubmit = (
  signal: AbortSignal,
  onUpdate: (patch: JobPollUpdate) => void,
) => Promise<string>

export type ExportQueueItem = {
  id: string
  signal: AbortSignal
  submit: ExportQueueSubmit
  onUpdate: (patch: JobPollUpdate) => void
  onComplete: (result: 'done' | 'error' | 'cancelled') => void
}

const prepQueue: ExportQueueItem[] = []
let draining = false

/** One client prep/upload at a time; server jobs may stack and encode sequentially. */
export function enqueueExportWork(item: ExportQueueItem): void {
  prepQueue.push(item)
  item.onUpdate({ phase: 'idle', progress: 0, message: 'Waiting in export queue.' })
  void drainPrepQueue()
}

export function pendingPrepCount(): number {
  return prepQueue.length + (draining ? 1 : 0)
}

async function drainPrepQueue(): Promise<void> {
  if (draining) return
  draining = true
  try {
    while (prepQueue.length > 0) {
      const item = prepQueue.shift()
      if (!item) break
      if (item.signal.aborted) {
        item.onComplete('cancelled')
        continue
      }
      try {
        // Elapsed starts when status leaves queued (preparing/rendering), not while waiting.
        let renderStarted: number | null = null
        let prepareHandoffProgress = 0.16
        const onUpdate = (patch: JobPollUpdate) => {
          if (typeof patch.progress === 'number' && Number.isFinite(patch.progress)) {
            prepareHandoffProgress = Math.max(prepareHandoffProgress, patch.progress)
          }
          const phase = patch.phase
          const waiting =
            phase == null ||
            phase === 'idle' ||
            phase === 'overlays' ||
            phase === 'uploading' ||
            phase === 'queued'
          if (
            !waiting &&
            renderStarted == null &&
            (phase === 'preparing' || phase === 'rendering' || phase === 'verifying')
          ) {
            renderStarted = Date.now()
          }
          let elapsedSec: number | null = null
          if (waiting) {
            elapsedSec = null
          } else if (renderStarted != null) {
            const localElapsed = Math.round(((Date.now() - renderStarted) / 1000) * 10) / 10
            const serverElapsed = patch.elapsedSec
            elapsedSec =
              serverElapsed != null && Number.isFinite(serverElapsed)
                ? Math.max(serverElapsed, localElapsed)
                : localElapsed
          } else if (patch.elapsedSec != null && Number.isFinite(patch.elapsedSec)) {
            elapsedSec = patch.elapsedSec
          }
          item.onUpdate({ ...patch, elapsedSec })
        }
        const jobId = await item.submit(item.signal, onUpdate)
        if (item.signal.aborted) {
          item.onComplete('cancelled')
          continue
        }
        void pollJobUntilDone(jobId, item.signal, onUpdate, prepareHandoffProgress)
          .then(() => {
            item.onComplete('done')
          })
          .catch((error) => {
            if (item.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
              item.onComplete('cancelled')
              return
            }
            item.onComplete('error')
          })
      } catch (error) {
        if (item.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
          item.onComplete('cancelled')
          continue
        }
        const text = error instanceof Error ? error.message : 'Export failed.'
        item.onUpdate({ phase: 'error', error: text, message: text })
        item.onComplete('error')
      }
    }
  } finally {
    draining = false
    if (prepQueue.length > 0) void drainPrepQueue()
  }
}
