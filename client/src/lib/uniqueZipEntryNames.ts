/** Keep ZIP entry names unique within a batch while preserving order. */
export function uniqueZipEntryNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((raw) => {
    const trimmed = (raw.trim() || 'file').replace(/\\/g, '/').split('/').pop() ?? 'file'
    const extMatch = trimmed.match(/(\.[^./\\]+)$/)
    const ext = extMatch?.[1] ?? ''
    const base = ext ? trimmed.slice(0, -ext.length) : trimmed
    const key = trimmed.toLowerCase()
    const count = seen.get(key) ?? 0
    seen.set(key, count + 1)
    if (count === 0) return trimmed
    return `${base} (${count + 1})${ext}`
  })
}