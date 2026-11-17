/** Multi-select helpers for Looper → Screensaver project targets. */

import { translate, type MessageKey } from '../../../i18n'
import { useGlobalSettingsStore } from '../../../stores/globalSettings'
import type { AssignAudioAssetResult } from '../../frame-screensaver/lib/screensaverAudioRefs'

export type { AssignAudioAssetResult as SendTransferResult } from '../../frame-screensaver/lib/screensaverAudioRefs'
export {
  deselectAllProjectIds,
  selectAllCheckboxState,
  selectAllProjectIds,
  toggleProjectSelection,
  type SelectAllCheckboxState,
} from '../../../lib/multiSelect'

/** How playlist track order is applied when sending to multiple Screensaver projects. */
export type PlaylistOrderMode = 'shared' | 'unique'

export function isPlaylistOrderMode(value: unknown): value is PlaylistOrderMode {
  return value === 'shared' || value === 'unique'
}

function identityOrder(trackCount: number): number[] {
  return Array.from({ length: trackCount }, (_, index) => index)
}

function shuffleOrder(order: number[]): number[] {
  const next = order.slice()
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    const current = next[index]!
    next[index] = next[swap]!
    next[swap] = current
  }
  return next
}

function orderKey(order: number[]): string {
  return order.join(',')
}

/**
 * Build one track-index permutation per destination project.
 * - `shared`: every project keeps the current Looper playlist order.
 * - `unique`: the first project keeps the current order; later projects get a
 *   different shuffle when enough distinct permutations exist.
 */
export function playlistOrdersForProjects(
  trackCount: number,
  projectCount: number,
  mode: PlaylistOrderMode,
): number[][] {
  const count = Math.max(0, Math.floor(projectCount))
  const tracks = Math.max(0, Math.floor(trackCount))
  if (count === 0) return []
  const base = identityOrder(tracks)
  if (mode === 'shared' || tracks < 2 || count === 1) {
    return Array.from({ length: count }, () => base.slice())
  }

  const used = new Set<string>([orderKey(base)])
  const orders: number[][] = [base.slice()]
  for (let index = 1; index < count; index += 1) {
    let next = shuffleOrder(base)
    for (let attempt = 0; attempt < 24 && used.has(orderKey(next)); attempt += 1) {
      next = shuffleOrder(base)
    }
    used.add(orderKey(next))
    orders.push(next)
  }
  return orders
}

export function isIdentityTrackOrder(order: number[]): boolean {
  return order.every((value, index) => value === index)
}

function locT(key: MessageKey, params?: Record<string, string | number>): string {
  return translate(useGlobalSettingsStore().general.language, key, params)
}

export function sendButtonLabel(selectedCount: number, sending: boolean): string {
  if (sending) return locT('looper.sendScreensaver.sending')
  if (selectedCount <= 0) return locT('looper.sendScreensaver.send')
  if (selectedCount === 1) return locT('looper.sendScreensaver.sendOne')
  return locT('looper.sendScreensaver.sendMany', { count: selectedCount })
}

export function transferNotificationMessage(result: AssignAudioAssetResult): {
  text: string
  tone: 'success' | 'info' | 'error'
} {
  const ok = result.ok.length
  const failed = result.failed.length
  const skipped = result.skipped.length
  if (ok === 0 && failed === 0 && skipped === 0) {
    return { text: locT('looper.sendScreensaver.toastNone'), tone: 'info' }
  }
  if (ok > 0 && failed === 0 && skipped === 0) {
    return {
      text:
        ok === 1
          ? locT('looper.sendScreensaver.toastSuccess', { count: ok })
          : locT('looper.sendScreensaver.toastSuccessPlural', { count: ok }),
      tone: 'success',
    }
  }
  if (ok > 0 && failed > 0) {
    return {
      text:
        ok === 1 && failed === 1
          ? locT('looper.sendScreensaver.toastPartial', { ok, failed })
          : locT('looper.sendScreensaver.toastPartialPlural', { ok, failed }),
      tone: 'info',
    }
  }
  if (ok > 0 && skipped > 0 && failed === 0) {
    return {
      text:
        ok === 1
          ? locT('looper.sendScreensaver.toastSkipped', { ok, skipped })
          : locT('looper.sendScreensaver.toastSkippedPlural', { ok, skipped }),
      tone: 'info',
    }
  }
  if (failed > 0) {
    return {
      text:
        failed === 1
          ? locT('looper.sendScreensaver.toastFailed', { count: failed })
          : locT('looper.sendScreensaver.toastFailedPlural', { count: failed }),
      tone: 'error',
    }
  }
  return {
    text:
      skipped === 1
        ? locT('looper.sendScreensaver.toastSkippedOnly', { count: skipped })
        : locT('looper.sendScreensaver.toastSkippedOnlyPlural', { count: skipped }),
    tone: 'info',
  }
}
