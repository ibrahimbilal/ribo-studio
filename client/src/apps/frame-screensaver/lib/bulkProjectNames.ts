/** Build display names when renaming multiple projects with one base name. */
export function bulkRenameNames(base: string, count: number): string[] {
  const trimmed = base.trim()
  if (!trimmed || count <= 0) return []
  if (count === 1) return [trimmed.slice(0, 80)]
  const names: string[] = []
  for (let i = 0; i < count; i += 1) {
    const suffix = ` (${i + 1})`
    const maxBase = Math.max(1, 80 - suffix.length)
    names.push(`${trimmed.slice(0, maxBase)}${suffix}`)
  }
  return names
}