/**
 * Remove leaked Google-Translate brand-protection <span> tags from locale overlays + cache.
 * Usage: node client/scripts/strip-locale-spans.mjs
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const localesDir = join(__dirname, '..', 'src/i18n/locales')
const cachePath = join(__dirname, '.locale-translation-cache.json')

function stripSpans(s) {
  let prev
  do {
    prev = s
    // Normal + Google-mangled open tags (space dropped: <spantranslate="no">)
    s = s
      .replace(/<\/?span\b[^>]*>/gi, '')
      .replace(/<\/?spantranslate\b[^>]*>/gi, '')
      .replace(/<\/span>/gi, '')
  } while (s !== prev)
  return s
}

let filesFixed = 0
let spansRemoved = 0

const SPAN_RE = /<\/?span(?:translate)?\b/gi

for (const f of readdirSync(localesDir).filter((x) => x.endsWith('.ts') && x !== 'en.ts')) {
  const path = join(localesDir, f)
  const src = readFileSync(path, 'utf8')
  const before = (src.match(SPAN_RE) || []).length
  if (!before) continue
  const out = stripSpans(src)
  const after = (out.match(SPAN_RE) || []).length
  writeFileSync(path, out, 'utf8')
  filesFixed += 1
  spansRemoved += before - after
  process.stderr.write(`${f}: removed ${before - after} span tokens (left ${after})\n`)
}

if (existsSync(cachePath)) {
  const cache = JSON.parse(readFileSync(cachePath, 'utf8'))
  let cacheHits = 0
  for (const locale of Object.keys(cache)) {
    for (const key of Object.keys(cache[locale])) {
      const v = cache[locale][key]
      if (typeof v === 'string' && /<\/?span(?:translate)?\b/i.test(v)) {
        cache[locale][key] = stripSpans(v)
        cacheHits += 1
      }
    }
  }
  writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8')
  process.stderr.write(`cache: cleaned ${cacheHits} entries\n`)
}

process.stderr.write(`Done. files=${filesFixed} spanTokensRemoved=${spansRemoved}\n`)
