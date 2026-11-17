import { computed } from 'vue'
import type { AppLanguage } from '@shared/globalSettings'
import { useGlobalSettingsStore } from '../stores/globalSettings'
import { deepMerge } from './deepMerge'
import { ar } from './locales/ar'
import { bn } from './locales/bn'
import { de } from './locales/de'
import { en, type MessageOverlay, type MessageTree } from './locales/en'
import { es } from './locales/es'
import { fr } from './locales/fr'
import { hi } from './locales/hi'
import { id } from './locales/id'
import { ja } from './locales/ja'
import { pt } from './locales/pt'
import { ru } from './locales/ru'
import { ur } from './locales/ur'
import { zh } from './locales/zh'

export type { MessageOverlay, MessageTree }

type NestedKeyOf<T, Prefix extends string = ''> = T extends string
  ? Prefix
  : {
      [K in keyof T & string]: NestedKeyOf<T[K], Prefix extends '' ? K : `${Prefix}.${K}`>
    }[keyof T & string]

export type MessageKey = NestedKeyOf<MessageTree>

export type MessageParams = Record<string, string | number>

const overlays: Record<Exclude<AppLanguage, 'en'>, MessageOverlay> = {
  zh,
  hi,
  es,
  ar,
  fr,
  bn,
  pt,
  ru,
  ur,
  id,
  de,
  ja,
}

const catalogCache = new Map<AppLanguage, MessageTree>()

function catalogFor(language: AppLanguage): MessageTree {
  if (language === 'en') return en as unknown as MessageTree
  const cached = catalogCache.get(language)
  if (cached) return cached
  const merged = deepMerge(en as unknown as MessageTree, overlays[language])
  catalogCache.set(language, merged)
  return merged
}

function lookup(tree: MessageTree, key: string): string | undefined {
  const parts = key.split('.')
  let node: unknown = tree
  for (const part of parts) {
    if (!node || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

function applyParams(template: string, params?: MessageParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    return value == null ? match : String(value)
  })
}

/** Translate a dotted message key for the given language (falls back to English). */
export function translate(language: AppLanguage, key: MessageKey, params?: MessageParams): string {
  const text = lookup(catalogFor(language), key) ?? lookup(en as unknown as MessageTree, key) ?? key
  return applyParams(text, params)
}

export function messagesFor(language: AppLanguage): MessageTree {
  return catalogFor(language)
}

/** Reactive translator bound to Global Settings → Language. */
export function useI18n() {
  const store = useGlobalSettingsStore()
  const language = computed(() => store.general.language)
  const messages = computed(() => messagesFor(language.value))

  function t(key: MessageKey, params?: MessageParams): string {
    return translate(language.value, key, params)
  }

  return { t, language, messages }
}
