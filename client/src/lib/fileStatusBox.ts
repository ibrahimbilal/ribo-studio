import type { MessageKey } from '../i18n'

export type FileStatusBoxStatus = 'ready' | 'uploading' | 'error' | 'processing'

export const FILE_STATUS_LABEL_KEYS: Record<FileStatusBoxStatus, MessageKey> = {
  ready: 'common.fileStatus.uploaded',
  uploading: 'common.fileStatus.uploading',
  error: 'common.fileStatus.uploadFailed',
  processing: 'common.fileStatus.processing',
}

/** Optional override for the status line; null keeps FileStatusBox defaults. */
export function fileStatusBoxLabel(
  status: FileStatusBoxStatus,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
  options?: {
    uploadProgress?: number
    processingMessage?: string
  },
): string | null {
  if (status === 'uploading') {
    if (options?.uploadProgress != null) {
      return t('common.fileStatus.uploadingPercent', { percent: Math.round(options.uploadProgress * 100) })
    }
    return null
  }
  if (status === 'processing' && options?.processingMessage) {
    return options.processingMessage
  }
  return null
}