/**
 * Accent palettes for application chrome only.
 * Never consumed by export / canvas / Subscribe Animation render paths.
 */

import type { AccentColorId } from './globalSettings'

export interface AccentPalette {
  id: AccentColorId
  label: string
  brand: string
  hover: string
  deep: string
  on: string
  surface: string
}

/** Default Ribo Studio brand blue and curated accents. */
export const ACCENT_PALETTES: readonly AccentPalette[] = [
  {
    id: 'default',
    label: 'Ribo Blue',
    brand: '#0078f8',
    hover: '#2898ff',
    deep: '#0060c4',
    on: '#ffffff',
    surface: '#132d52',
  },
  {
    id: 'blue',
    label: 'Blue',
    brand: '#2563eb',
    hover: '#3b82f6',
    deep: '#1d4ed8',
    on: '#ffffff',
    surface: '#1e3a5f',
  },
  {
    id: 'indigo',
    label: 'Indigo',
    brand: '#4f46e5',
    hover: '#6366f1',
    deep: '#4338ca',
    on: '#ffffff',
    surface: '#2e2a5a',
  },
  {
    id: 'purple',
    label: 'Purple',
    brand: '#9333ea',
    hover: '#a855f7',
    deep: '#7e22ce',
    on: '#ffffff',
    surface: '#3b2458',
  },
  {
    id: 'teal',
    label: 'Teal',
    brand: '#0d9488',
    hover: '#14b8a6',
    deep: '#0f766e',
    on: '#ffffff',
    surface: '#1a3d3a',
  },
  {
    id: 'green',
    label: 'Green',
    brand: '#16a34a',
    hover: '#22c55e',
    deep: '#15803d',
    on: '#ffffff',
    surface: '#1a3d28',
  },
  {
    id: 'orange',
    label: 'Orange',
    brand: '#ea580c',
    hover: '#f97316',
    deep: '#c2410c',
    on: '#ffffff',
    surface: '#4a2c18',
  },
  {
    id: 'red',
    label: 'Red',
    brand: '#dc2626',
    hover: '#ef4444',
    deep: '#b91c1c',
    on: '#ffffff',
    surface: '#4a1c1c',
  },
  {
    id: 'slate',
    label: 'Slate',
    brand: '#64748b',
    hover: '#94a3b8',
    deep: '#475569',
    on: '#ffffff',
    surface: '#2a3038',
  },
] as const

export function accentPalette(id: AccentColorId): AccentPalette {
  return ACCENT_PALETTES.find((item) => item.id === id) ?? ACCENT_PALETTES[0]!
}
