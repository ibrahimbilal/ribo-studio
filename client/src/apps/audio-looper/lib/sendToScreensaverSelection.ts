/** Multi-select helpers for Looper → Screensaver project targets. */

import type { AssignAudioAssetResult } from '../../frame-screensaver/lib/screensaverAudioRefs'

export type { AssignAudioAssetResult as SendTransferResult } from '../../frame-screensaver/lib/screensaverAudioRefs'
export {
  deselectAllProjectIds,
  selectAllCheckboxState,
  selectAllProjectIds,
  toggleProjectSelection,
  type SelectAllCheckboxState,
} from '../../../lib/multiSelect'

export function sendButtonLabel(selectedCount: number, sending: boolean): string {
  if (sending) return 'Sending…'
  if (selectedCount <= 0) return 'Send'
  if (selectedCount === 1) return 'Send to 1 project'
  return `Send to ${selectedCount} projects`
}

export function transferNotificationMessage(result: AssignAudioAssetResult): {
  text: string
  tone: 'success' | 'info' | 'error'
} {
  const ok = result.ok.length
  const failed = result.failed.length
  const skipped = result.skipped.length
  if (ok === 0 && failed === 0 && skipped === 0) {
    return { text: 'No Screensaver projects were updated.', tone: 'info' }
  }
  if (ok > 0 && failed === 0 && skipped === 0) {
    return {
      text: `Audio successfully sent to ${ok} Screensaver project${ok === 1 ? '' : 's'}.`,
      tone: 'success',
    }
  }
  if (ok > 0 && failed > 0) {
    return {
      text: `Audio sent to ${ok} project${ok === 1 ? '' : 's'}. ${failed} project${failed === 1 ? '' : 's'} could not be updated.`,
      tone: 'info',
    }
  }
  if (ok > 0 && skipped > 0 && failed === 0) {
    return {
      text: `Audio sent to ${ok} project${ok === 1 ? '' : 's'}. ${skipped} skipped.`,
      tone: 'info',
    }
  }
  if (failed > 0) {
    return {
      text: `Could not update ${failed} project${failed === 1 ? '' : 's'}.`,
      tone: 'error',
    }
  }
  return {
    text: `${skipped} project${skipped === 1 ? '' : 's'} skipped.`,
    tone: 'info',
  }
}
