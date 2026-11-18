/** Per-scope last-visited settings tab (localStorage). Chrome-only; not project data. */

const PREFIX = 'ribo-settings-tab:'

export type SettingsTabScope =
  | 'ranking'
  | 'image-motion'
  | 'screensaver'
  | 'thumbnail'
  | 'looper'
  | 'global'

function storageKey(scope: SettingsTabScope): string {
  return `${PREFIX}${scope}`
}

export function loadSettingsTab<T extends string>(
  scope: SettingsTabScope,
  allowed: readonly T[],
  fallback: T,
): T {
  try {
    const raw = localStorage.getItem(storageKey(scope))
    if (raw != null && (allowed as readonly string[]).includes(raw)) {
      return raw as T
    }
  } catch {
    /* private mode / blocked storage */
  }
  return fallback
}

export function saveSettingsTab(scope: SettingsTabScope, value: string): void {
  try {
    localStorage.setItem(storageKey(scope), value)
  } catch {
    /* ignore quota / private mode */
  }
}
