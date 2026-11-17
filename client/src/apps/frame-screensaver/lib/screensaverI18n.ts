import type { MessageKey, MessageParams } from '../../../i18n'
import { translate } from '../../../i18n'
import type { AppLanguage } from '@shared/globalSettings'

/** Screensaver message path until `en.ts` spreads `messages/screensaver`. */
export function S(path: string): MessageKey {
  return `screensaver.${path}` as MessageKey
}

export function screensaverTranslate(language: AppLanguage, path: string, params?: MessageParams): string {
  return translate(language, S(path), params)
}