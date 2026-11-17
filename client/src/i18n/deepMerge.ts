/** Deep-merge message overlays onto the English tree (missing keys keep English). */

export type DeepPartial<T> = T extends string
  ? string
  : { [K in keyof T]?: DeepPartial<T[K]> }

export function deepMerge<T>(base: T, overlay?: DeepPartial<T> | null): T {
  if (overlay == null) return base
  if (typeof base === 'string') {
    return (typeof overlay === 'string' ? overlay : base) as T
  }
  if (!base || typeof base !== 'object') return base
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(overlay as Record<string, unknown>)) {
    if (value === undefined) continue
    const current = out[key]
    if (typeof current === 'object' && current && typeof value === 'object' && value) {
      out[key] = deepMerge(current, value as DeepPartial<typeof current>)
    } else if (typeof value === 'string' || typeof value === 'object') {
      out[key] = value
    }
  }
  return out as T
}
