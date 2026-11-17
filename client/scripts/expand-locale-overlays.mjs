/**
 * One-off / maintenance: merge translated app namespaces into locale overlay files.
 * Usage: node client/scripts/expand-locale-overlays.mjs [--dry-run] [--locale=zh]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientRoot = join(__dirname, '..')
const localesDir = join(clientRoot, 'src/i18n/locales')
const messagesDir = join(clientRoot, 'src/i18n/messages')

const require = createRequire(import.meta.url)

/** @type {Record<string, string>} */
const LOCALE_TO_GOOGLE = {
  zh: 'zh-CN',
  hi: 'hi',
  es: 'es',
  ar: 'ar',
  fr: 'fr',
  bn: 'bn',
  pt: 'pt',
  ru: 'ru',
  ur: 'ur',
  id: 'id',
  de: 'de',
  ja: 'ja',
}

const NAMESPACES = [
  'common',
  'layout',
  'ranking',
  'imageMotion',
  'screensaver',
  'thumbnail',
  'upscaler',
  'looper',
  'settingsExtra',
]

/** Longest-first so substrings are not broken. */
const BRAND_TERMS = [
  'Image Motion Shorts',
  'Ranking Shorts',
  'Subscribe Animations',
  'Subscribe Animation',
  'Global Settings → Storage & Cache',
  'Global Settings → Export',
  'Real-ESRGAN',
  'Audio Looper',
  'Image Motion',
  'Image Upscaler',
  'Ribo Studio',
  'Optimized CFR',
  'Fast VFR',
  'WebGL2',
  'YouTube',
  'Screensaver',
  'Upscayl',
  'Lanczos3',
  'FFmpeg',
  'FFprobe',
  'Shorts',
  'oEmbed',
  'LUFS',
  'dBTP',
  'Full HD',
  'TikTok',
  'WebM',
  'JPEG',
  'WebP',
  'FLAC',
  'M4A',
  'AAC',
  'PCM',
  'MP4',
  'MOV',
  'PNG',
  'JPG',
  'MP3',
  'OGG',
  'WAV',
  'ZIP',
  'OAuth',
  'JSON',
  'API',
  'URL',
  'ID',
  'CFR',
  'VFR',
  'AI Lite',
  '2K',
  '4K',
  '8K',
].sort((a, b) => b.length - a.length)

const BATCH_SEP = '\n\u241E\u241E\u241E\n'
const CACHE_PATH = join(__dirname, '.locale-translation-cache.json')

/** Load English message objects by evaluating TS exports (simple object literals). */
function loadEnglishNamespace(name) {
  const file = join(messagesDir, `${name === 'settingsExtra' ? 'settingsExtra' : name}.ts`)
  const src = readFileSync(file, 'utf8')
  const match = src.match(/export const \w+ = (\{[\s\S]*\}) as const/)
  if (!match) throw new Error(`Could not parse ${file}`)
  // eslint-disable-next-line no-new-func
  return new Function(`return (${match[1]})`)()
}

function flattenStrings(obj, prefix = '', out = /** @type {Map<string, string>} */ (new Map())) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.set(path, v)
    else if (v && typeof v === 'object') flattenStrings(v, path, out)
  }
  return out
}

function unflattenStrings(flat) {
  /** @type {Record<string, unknown>} */
  const root = {}
  const entries = [...flat.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  for (const [path, value] of entries) {
    const parts = path.split('.')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i]
      if (!(p in node) || typeof node[p] !== 'object') node[p] = {}
      node = /** @type {Record<string, unknown>} */ (node[p])
    }
    node[parts[parts.length - 1]] = value
  }
  return root
}

function protectString(text) {
  const params = []
  let s = text.replace(/\{(\w+)\}/g, (_, name) => {
    const token = `@@PARAM${params.length}@@`
    params.push(`{${name}}`)
    return token
  })
  const brands = []
  // Opaque tokens — never HTML. Google mutates <span translate="no"> into visible UI junk.
  for (const term of BRAND_TERMS) {
    if (!s.includes(term)) continue
    brands.push(term)
    s = s.split(term).join(`@@BRAND${brands.length - 1}@@`)
  }
  return { s, params, brands }
}

function unprotectString(s, params, brands) {
  let out = s
  // Strip any legacy HTML brand wrappers Google may have mangled (translate/Translator/spantranslate).
  do {
    const prev = out
    out = out
      .replace(/<\/?span\b[^>]*>/gi, '')
      .replace(/<\/?spantranslate\b[^>]*>/gi, '')
      .replace(/<\/span>/gi, '')
    if (out === prev) break
  } while (true)
  brands.forEach((term, i) => {
    out = out.split(`@@BRAND${i}@@`).join(term)
  })
  params.forEach((p, i) => {
    out = out.split(`@@PARAM${i}@@`).join(p)
  })
  return out
}

/** Remove generated app namespaces; keep settings chrome (`shell` onward). */
function stripAppNamespaces(src, locale) {
  const exportMarker = `export const ${locale} = {`
  const exportIdx = src.indexOf(exportMarker)
  if (exportIdx === -1) throw new Error(`Missing export in locale ${locale}`)
  const shellIdx = src.indexOf('\n  shell: {', exportIdx)
  if (shellIdx === -1) return src
  const head = src.slice(0, exportIdx + exportMarker.length)
  const tail = src.slice(shellIdx)
  return `${head}\n${tail}`
}

function loadCache() {
  if (!existsSync(CACHE_PATH)) return /** @type {Record<string, Record<string, string>>} */ ({})
  return JSON.parse(readFileSync(CACHE_PATH, 'utf8'))
}

function saveCache(cache) {
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8')
}

async function googleTranslateBatch(texts, target) {
  if (texts.length === 0) return []
  const joined = texts.join(BATCH_SEP)
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=' +
    encodeURIComponent(target) +
    '&dt=t&q=' +
    encodeURIComponent(joined)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Translate HTTP ${res.status}`)
  const data = await res.json()
  const translated = data[0].map((chunk) => chunk[0]).join('')
  return translated.split(BATCH_SEP)
}

async function translateFlat(flatEn, locale, cache) {
  const google = LOCALE_TO_GOOGLE[locale]
  if (!google) throw new Error(`Unknown locale ${locale}`)
  if (!cache[locale]) cache[locale] = {}

  const result = new Map()
  const pending = []
  const pendingKeys = []

  for (const [key, en] of flatEn) {
    const cacheKey = key
    if (cache[locale][cacheKey]) {
      result.set(key, cache[locale][cacheKey])
      continue
    }
    const { s, params, brands } = protectString(en)
    pending.push({ key, en, s, params, brands })
    pendingKeys.push(key)
  }

  const CHUNK = 40
  for (let i = 0; i < pending.length; i += CHUNK) {
    const slice = pending.slice(i, i + CHUNK)
    const inputs = slice.map((p) => p.s)
    let outs
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        outs = await googleTranslateBatch(inputs, google)
        break
      } catch (err) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
        if (attempt === 4) throw err
      }
    }
    if (outs.length !== slice.length) {
      throw new Error(`Batch size mismatch ${outs.length} vs ${slice.length}`)
    }
    slice.forEach((p, j) => {
      const translated = unprotectString(outs[j], p.params, p.brands)
      cache[locale][p.key] = translated
      result.set(p.key, translated)
    })
    saveCache(cache)
    process.stderr.write(
      `  ${locale}: translated ${Math.min(i + CHUNK, pending.length)}/${pending.length}\n`,
    )
    await new Promise((r) => setTimeout(r, 350))
  }

  for (const [key, en] of flatEn) {
    if (!result.has(key)) result.set(key, cache[locale][key] ?? en)
  }
  return result
}

function tsString(value) {
  return (
    "'" +
    value
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\r\n/g, '\n')
      .replace(/\n/g, '\\n') +
    "'"
  )
}

function serializeObject(obj, indent = 2) {
  const pad = (n) => ' '.repeat(n)
  const lines = []
  const keys = Object.keys(obj)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    const v = obj[key]
  const keyPart = /^[a-zA-Z_$][\w$]*$/.test(key) ? key : tsString(key)
    if (typeof v === 'string') {
      lines.push(`${pad(indent)}${keyPart}: ${tsString(v)},`)
    } else if (v && typeof v === 'object') {
      lines.push(`${pad(indent)}${keyPart}: {`)
      lines.push(serializeObject(v, indent + 2))
      lines.push(`${pad(indent)}},`)
    }
  }
  return lines.join('\n')
}

function buildNamespaceBlock(namespace, tree) {
  return `  ${namespace}: {\n${serializeObject(tree, 4)}\n  },`
}

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const refreshCache = argv.includes('--refresh')
const localeArg = argv.find((a) => a.startsWith('--locale='))
const onlyLocale = localeArg ? localeArg.split('=')[1] : null

const english = {}
for (const ns of NAMESPACES) {
  english[ns] = loadEnglishNamespace(ns)
}

/** @type {Map<string, string>} */
const flatEn = new Map()
for (const ns of NAMESPACES) {
  const inner = flattenStrings(english[ns])
  for (const [path, value] of inner) flatEn.set(`${ns}.${path}`, value)
}

let cache = refreshCache ? {} : loadCache()
if (refreshCache && existsSync(CACHE_PATH)) {
  writeFileSync(CACHE_PATH, '{}', 'utf8')
}
const locales = onlyLocale ? [onlyLocale] : Object.keys(LOCALE_TO_GOOGLE)

for (const locale of locales) {
  const localePath = join(localesDir, `${locale}.ts`)
  let src = stripAppNamespaces(readFileSync(localePath, 'utf8'), locale)

  if (refreshCache) cache[locale] = {}
  process.stderr.write(`Translating ${locale} (${flatEn.size} strings)…\n`)
  const flatTranslated = await translateFlat(flatEn, locale, cache)

  const blocks = []
  for (const ns of NAMESPACES) {
    const sub = new Map()
    for (const [path, value] of flatTranslated) {
      if (!path.startsWith(`${ns}.`)) continue
      sub.set(path.slice(ns.length + 1), value)
    }
    blocks.push(buildNamespaceBlock(ns, unflattenStrings(sub)))
  }

  const insert = blocks.join('\n') + '\n'
  const marker = `export const ${locale} = {`
  const idx = src.indexOf(marker)
  if (idx === -1) throw new Error(`Could not find export in ${localePath}`)
  const afterBrace = idx + marker.length
  src = `${src.slice(0, afterBrace)}\n${insert}${src.slice(afterBrace).replace(/^\n/, '')}`

  if (dryRun) {
    process.stdout.write(`--- ${locale}.ts (dry run, first 2000 chars) ---\n`)
    process.stdout.write(src.slice(0, 2000) + '\n')
  } else {
    writeFileSync(localePath, src, 'utf8')
    process.stderr.write(`Wrote ${localePath}\n`)
  }
}

saveCache(cache)
process.stderr.write('Done.\n')