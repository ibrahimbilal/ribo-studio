/**
 * Apply Global Settings appearance to the document (UI chrome only).
 * Must never touch export / canvas / Subscribe Animation timelines.
 */

import { accentPalette } from '@shared/appearanceTokens'
import type { AccentColorId, GlobalSettingsAppearance, InterfaceDensity, ThemePreference } from '@shared/globalSettings'

export type ResolvedTheme = 'light' | 'dark'

let systemMedia: MediaQueryList | null = null
let systemListener: ((event: MediaQueryListEvent) => void) | null = null
let currentThemePreference: ThemePreference = 'dark'

export function resolveTheme(preference: ThemePreference, matchesDark?: boolean): ResolvedTheme {
  if (preference === 'light') return 'light'
  if (preference === 'dark') return 'dark'
  const dark =
    typeof matchesDark === 'boolean'
      ? matchesDark
      : typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  return dark ? 'dark' : 'light'
}

function setAccentVars(accent: AccentColorId): void {
  const palette = accentPalette(accent)
  const root = document.documentElement
  root.style.setProperty('--color-brand', palette.brand)
  root.style.setProperty('--color-brand-hover', palette.hover)
  root.style.setProperty('--color-brand-deep', palette.deep)
  root.style.setProperty('--color-brand-on', palette.on)
  root.style.setProperty('--color-brand-surface', palette.surface)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', palette.brand)
}

function setThemeAttrs(resolved: ResolvedTheme): void {
  const root = document.documentElement
  root.dataset.theme = resolved
  root.style.colorScheme = resolved
}

function setDensity(density: InterfaceDensity): void {
  document.documentElement.dataset.density = density
}

function setUiAnimations(enabled: boolean): void {
  document.documentElement.dataset.uiAnimations = enabled ? 'on' : 'off'
}

function detachSystemListener(): void {
  if (systemMedia && systemListener) {
    systemMedia.removeEventListener('change', systemListener)
  }
  systemMedia = null
  systemListener = null
}

function attachSystemListener(): void {
  detachSystemListener()
  if (typeof window === 'undefined' || !window.matchMedia) return
  systemMedia = window.matchMedia('(prefers-color-scheme: dark)')
  systemListener = (event) => {
    if (currentThemePreference !== 'system') return
    setThemeAttrs(resolveTheme('system', event.matches))
  }
  systemMedia.addEventListener('change', systemListener)
}

/** Apply appearance preferences immediately to the documentElement. */
export function applyAppearance(appearance: GlobalSettingsAppearance): void {
  currentThemePreference = appearance.theme
  const resolved = resolveTheme(appearance.theme)
  setThemeAttrs(resolved)
  setAccentVars(appearance.accent)
  setDensity(appearance.density)
  setUiAnimations(appearance.interfaceAnimations)
  if (appearance.theme === 'system') attachSystemListener()
  else detachSystemListener()
}

/**
 * Early boot (inline in index.html) should call a minimal version.
 * This helper mirrors that logic for tests / late hydrate.
 */
export function readAppearanceFromStorageRaw(raw: string | null): GlobalSettingsAppearance | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { appearance?: GlobalSettingsAppearance }
    if (!parsed?.appearance || typeof parsed.appearance !== 'object') return null
    return parsed.appearance
  } catch {
    return null
  }
}
