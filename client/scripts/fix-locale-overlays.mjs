/**
 * Deduplicate locale overlays, restore MT-mangled brand tokens, rewrite clean files.
 * Usage: node client/scripts/fix-locale-overlays.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const localesDir = join(__dirname, '..', 'src/i18n/locales')
const messagesDir = join(__dirname, '..', 'src/i18n/messages')
const CACHE_PATH = join(__dirname, '.locale-translation-cache.json')

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

function loadEnglishNamespace(name) {
  const file = join(messagesDir, `${name}.ts`)
  const src = readFileSync(file, 'utf8')
  const match = src.match(/export const \w+ = (\{[\s\S]*\}) as const/)
  if (!match) throw new Error(`Could not parse ${file}`)
  return new Function(`return (${match[1]})`)()
}

function flattenStrings(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.set(path, v)
    else if (v && typeof v === 'object') flattenStrings(v, path, out)
  }
  return out
}

function unflattenStrings(flat) {
  const root = {}
  for (const [path, value] of [...flat.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const parts = path.split('.')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i]
      if (!(p in node) || typeof node[p] !== 'object') node[p] = {}
      node = node[p]
    }
    node[parts[parts.length - 1]] = value
  }
  return root
}

function brandsFor(english) {
  const brands = []
  let s = english
  for (const term of BRAND_TERMS) {
    if (!s.includes(term)) continue
    brands.push(term)
    s = s.split(term).join(`#${brands.length - 1}#`)
  }
  return brands
}

function stripTranslateSpans(s) {
  let out = s
  do {
    const prev = out
    out = out
      .replace(/<\/?span\b[^>]*>/gi, '')
      .replace(/<\/?spantranslate\b[^>]*>/gi, '')
      .replace(/<\/span>/gi, '')
    if (out === prev) break
  } while (true)
  return out
}

function restoreMangled(translated, english) {
  const brands = brandsFor(english)
  const params = [...english.matchAll(/\{(\w+)\}/g)].map((m) => m[0])
  let out = stripTranslateSpans(translated)
  const brandRe = /\uE000(?:BRAND|MARKE|MARCA|MARQUE|Marke|marca|marque)(\d+)\uE001/gi
  out = out.replace(brandRe, (_, i) => brands[Number(i)] ?? _)
  out = out.replace(/\uE000PARAM(\d+)\uE001/gi, (_, i) => params[Number(i)] ?? _)
  out = out.replace(/[\uE000\uE001]*MARKE(\d+)[\uE000\uE001]*/gi, (_, i) => brands[Number(i)] ?? _)
  out = out.replace(/[\uE000\uE001]*MARCA(\d+)[\uE000\uE001]*/gi, (_, i) => brands[Number(i)] ?? _)
  out = out.replace(/[\uE000\uE001]*MARQUE(\d+)[\uE000\uE001]*/gi, (_, i) => brands[Number(i)] ?? _)
  out = out.replace(/[\uE000\uE001]*BRAND(\d+)[\uE000\uE001]*/gi, (_, i) => brands[Number(i)] ?? _)
  out = out.replace(/\uE000|\uE001||/g, '')
  out = out.replace(/__BRAND_(\d+)__/g, (_, i) => brands[Number(i)] ?? _)
  out = out.replace(/__PARAM_(\d+)__/g, (_, i) => params[Number(i)] ?? _)
  out = out.replace(/@@BRAND(\d+)@@/g, (_, i) => brands[Number(i)] ?? _)
  out = out.replace(/@@PARAM(\d+)@@/g, (_, i) => params[Number(i)] ?? _)
  return out
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
  for (const key of Object.keys(obj)) {
    const v = obj[key]
    const keyPart = /^[a-zA-Z_$][\w$]*$/.test(key) ? key : tsString(key)
    if (typeof v === 'string') lines.push(`${pad(indent)}${keyPart}: ${tsString(v)},`)
    else if (v && typeof v === 'object') {
      lines.push(`${pad(indent)}${keyPart}: {`)
      lines.push(serializeObject(v, indent + 2))
      lines.push(`${pad(indent)}},`)
    }
  }
  return lines.join('\n')
}

const flatEn = new Map()
for (const ns of NAMESPACES) {
  for (const [path, value] of flattenStrings(loadEnglishNamespace(ns))) {
    flatEn.set(`${ns}.${path}`, value)
  }
}

const cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, 'utf8')) : {}
const locales = ['zh', 'hi', 'es', 'ar', 'fr', 'bn', 'pt', 'ru', 'ur', 'id', 'de', 'ja']

for (const locale of locales) {
  const path = join(localesDir, `${locale}.ts`)
  const src = readFileSync(path, 'utf8')
  const shellIdx = src.lastIndexOf('\n  shell: {')
  if (shellIdx === -1) throw new Error(`No shell section in ${locale}`)
  const chrome = src.slice(shellIdx) // from shell through satisfies MessageOverlay

  const localeCache = cache[locale] || {}
  const flatFixed = new Map()
  for (const [key, en] of flatEn) {
    let value = localeCache[key] ?? en
    if (/[\uE000\uE001]|MARKE\d|MARCA\d|MARQUE\d|BRAND\d/.test(value)) {
      value = restoreMangled(value, en)
    }
    // If still identical mangled garbage for pure brand strings, use English
    if (/MARKE|MARCA|||\uE000/.test(value)) value = en
    flatFixed.set(key, value)
    localeCache[key] = value
  }
  cache[locale] = localeCache

  const blocks = []
  for (const ns of NAMESPACES) {
    const sub = new Map()
    for (const [pathKey, value] of flatFixed) {
      if (!pathKey.startsWith(`${ns}.`)) continue
      sub.set(pathKey.slice(ns.length + 1), value)
    }
    blocks.push(`  ${ns}: {\n${serializeObject(unflattenStrings(sub), 4)}\n  },`)
  }

  const out =
    `import type { MessageOverlay } from './en'\n\n` +
    `export const ${locale} = {\n` +
    blocks.join('\n') +
    chrome

  // chrome already starts with `\n  shell` and ends with `} satisfies MessageOverlay`
  writeFileSync(path, out.replace(/\n{3,}/g, '\n\n'), 'utf8')
  process.stderr.write(`Rebuilt ${locale}.ts\n`)
}

writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8')
process.stderr.write('Done.\n')
