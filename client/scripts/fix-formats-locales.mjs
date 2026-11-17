/** Restore English `formats` strings where brand-list translation collapsed. */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const messagesDir = join(__dirname, '../src/i18n/messages')
const localesDir = join(__dirname, '../src/i18n/locales')

function load(name) {
  const src = readFileSync(join(messagesDir, `${name}.ts`), 'utf8')
  const match = src.match(/export const \w+ = (\{[\s\S]*\}) as const/)
  if (!match) throw new Error(`parse ${name}`)
  return new Function(`return (${match[1]})`)()
}

function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.set(path, v)
    else if (v && typeof v === 'object') flatten(v, path, out)
  }
  return out
}

const englishFormats = new Set()
for (const name of ['common', 'looper', 'screensaver', 'upscaler', 'thumbnail', 'imageMotion', 'ranking']) {
  for (const [p, v] of flatten(load(name))) {
    if (p === 'formats' || p.endsWith('.formats')) englishFormats.add(v)
  }
}

const badRe = /^[\s,،、，\-–—/|·]+$/u

for (const file of readdirSync(localesDir)) {
  if (!file.endsWith('.ts') || file === 'en.ts') continue
  const path = join(localesDir, file)
  let src = readFileSync(path, 'utf8')
  let fixCount = 0
  src = src.replace(/formats: '([^']*)'/g, (full, value) => {
    if (!badRe.test(value) && !/^[,،\s]+$/.test(value)) return full
    for (const en of englishFormats) {
      const commas = (value.match(/,/g) || []).length + (value.match(/،/g) || []).length
      const enCommas = (en.match(/,/g) || []).length
      if (commas === enCommas || (commas > 0 && en.includes(','))) {
        fixCount++
        return `formats: '${en.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
      }
    }
    return full
  })
  writeFileSync(path, src)
  console.log(file, fixCount, 'formats fixed')
}