import { DEFAULT_UPSCALE_LIMITS, type UpscaleOptions } from '@shared/imageUpscaler'
import type { MessageKey, MessageParams } from '../../../i18n'
import {
  cloneUpscaleOptions,
  extractUpscaleSettingsSnapshot,
  getCopiedUpscaleSettings,
  setCopiedUpscaleSettings,
} from './copyUpscaleSettings'
import { readLocalImage } from './localPreview'
import type { LocalUpscaleItem } from '../types'

type Translate = (key: MessageKey, params?: MessageParams) => string
type Toast = (message: string, kind?: 'info' | 'success' | 'error') => void

export interface UpscaleBatchItemsSlice {
  items: LocalUpscaleItem[]
  processing: boolean
}

export function renameUpscaleBatchItem(slice: UpscaleBatchItemsSlice, localId: string, name: string): void {
  const trimmed = name.trim()
  if (!trimmed) return
  const item = slice.items.find((entry) => entry.localId === localId)
  if (!item) return
  item.name = trimmed.slice(0, 80)
}

export async function duplicateUpscaleBatchItem(
  slice: UpscaleBatchItemsSlice,
  localId: string,
  t: Translate,
  toast: Toast,
): Promise<void> {
  if (slice.processing) return
  const item = slice.items.find((entry) => entry.localId === localId)
  if (!item) return
  if (slice.items.length >= DEFAULT_UPSCALE_LIMITS.maxBatch) {
    toast(t('upscaler.toast.batchLimit', { max: DEFAULT_UPSCALE_LIMITS.maxBatch }), 'info')
    return
  }
  try {
    const preview = await readLocalImage(item.file, 960)
    slice.items.push({
      localId: crypto.randomUUID(),
      file: item.file,
      name: item.name,
      previewUrl: preview.previewUrl,
      width: preview.width,
      height: preview.height,
      bytes: item.bytes,
      status: 'ready',
      error: null,
      warning: null,
      serverItemId: null,
      outputName: null,
      outputBytes: null,
      outputRevision: null,
      downloadedRevision: null,
      outputWidth: null,
      outputHeight: null,
      skippedResize: false,
      intermediateWidth: null,
      intermediateHeight: null,
      effectiveScale: null,
    })
  } catch {
    toast(t('upscaler.toast.readFailed', { name: item.name }))
  }
}

export function copyUpscaleBatchSettings(
  settings: UpscaleOptions,
  formatFromSource: boolean,
  bumpCopiedRevision: () => void,
  t: Translate,
  toast: Toast,
): void {
  setCopiedUpscaleSettings(extractUpscaleSettingsSnapshot(settings, formatFromSource))
  bumpCopiedRevision()
  toast(t('upscaler.toast.settingsCopied'), 'success')
}

export function pasteUpscaleBatchSettings(
  apply: (options: UpscaleOptions, formatFromSource: boolean) => void,
  t: Translate,
  toast: Toast,
): void {
  const snapshot = getCopiedUpscaleSettings()
  if (!snapshot) return
  apply(cloneUpscaleOptions(snapshot.options), snapshot.formatFromSource)
  toast(t('upscaler.toast.settingsPasted'), 'success')
}