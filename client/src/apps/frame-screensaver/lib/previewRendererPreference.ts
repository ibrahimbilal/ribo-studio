import type { PreviewRendererMode } from '@shared/globalSettings'

export type { PreviewRendererMode }

/** @deprecated Prefer Global Settings `screensaver.previewRenderer`. Kept for query-string overrides. */
export function readPreviewRendererMode(): PreviewRendererMode {
  try {
    const fromQuery = new URLSearchParams(window.location.search).get('screensaver_renderer')
    if (fromQuery === 'webgl2' || fromQuery === 'canvas2d' || fromQuery === 'auto') return fromQuery
  } catch {
    // ignore
  }
  return 'canvas2d'
}

/** @deprecated Preview renderer is persisted via Global Settings. */
export function writePreviewRendererMode(_mode: PreviewRendererMode): void {
  // no-op — Global Settings owns this preference.
}
