/**
 * Apply Global Settings language to the document (UI chrome only).
 * Must never touch export / canvas / Subscribe Animation timelines.
 */

import { appLanguageMeta, type AppLanguage } from '@shared/globalSettings'

/** Apply language preference immediately to the documentElement. */
export function applyLanguage(language: AppLanguage): void {
  if (typeof document === 'undefined') return
  const meta = appLanguageMeta(language)
  document.documentElement.lang = language
  document.documentElement.dir = meta.dir
}
