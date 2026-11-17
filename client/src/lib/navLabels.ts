import type { MessageKey } from '../i18n'

/** Map nav paths to i18n message keys (shell + dashboard). */
export const NAV_LABEL_KEYS: Record<string, MessageKey> = {
  '/': 'shell.dashboard',
  '/shorts': 'nav.shorts',
  '/screensaver': 'nav.screensaver',
  '/thumbnails': 'nav.thumbnails',
  '/upscale': 'nav.upscale',
  '/looper': 'nav.looper',
}

export const NAV_DESC_KEYS: Record<string, MessageKey> = {
  '/shorts': 'nav.shortsDesc',
  '/screensaver': 'nav.screensaverDesc',
  '/thumbnails': 'nav.thumbnailsDesc',
  '/upscale': 'nav.upscaleDesc',
  '/looper': 'nav.looperDesc',
}
