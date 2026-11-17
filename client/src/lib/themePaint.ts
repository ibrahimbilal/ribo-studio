/**
 * Read live theme CSS variables for canvas UI paints (waveforms, etc.).
 * Application chrome only — never used by export/media bake paths.
 */

function readVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

export function themePreviewWellColor(): string {
  return readVar('--color-preview-well', '#07080b')
}

export function themeInkColor(): string {
  return readVar('--color-ink', '#f4f4f5')
}

/** Dim overlay for out-of-trim regions on waveform canvases. */
export function themeWaveformDimOverlay(): string {
  const theme = document.documentElement.dataset.theme
  return theme === 'light' ? 'rgba(17, 24, 39, 0.18)' : 'rgba(0, 0, 0, 0.55)'
}
