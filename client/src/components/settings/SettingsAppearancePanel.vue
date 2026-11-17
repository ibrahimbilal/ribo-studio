<script setup lang="ts">
import { ACCENT_PALETTES } from '@shared/appearanceTokens'
import type { AccentColorId, InterfaceDensity, ThemePreference } from '@shared/globalSettings'
import ToggleSwitch from '../ToggleSwitch.vue'
import { useGlobalSettingsStore } from '../../stores/globalSettings'
import SettingsRow from './SettingsRow.vue'

const store = useGlobalSettingsStore()

const themes: Array<{ id: ThemePreference; label: string; hint: string }> = [
  { id: 'light', label: 'Light', hint: 'Bright surfaces' },
  { id: 'dark', label: 'Dark', hint: 'Studio default' },
  { id: 'system', label: 'System', hint: 'Match OS' },
]

const densities: Array<{ id: InterfaceDensity; label: string }> = [
  { id: 'comfortable', label: 'Comfortable' },
  { id: 'compact', label: 'Compact' },
]

function setTheme(theme: ThemePreference): void {
  store.patchAppearance({ theme })
}

function setAccent(accent: AccentColorId): void {
  store.patchAppearance({ accent })
}

function setDensity(density: InterfaceDensity): void {
  store.patchAppearance({ density })
}
</script>

<template>
  <div>
    <h3 class="section-label">Appearance</h3>
    <p class="mb-3 text-xs text-zinc-500">
      Controls application chrome only. Exported videos, Subscribe Animations, and canvas timelines are never affected.
    </p>

    <SettingsRow label="Theme" hint="Applied immediately and persisted across restarts.">
      <div class="appearance-theme-grid" role="radiogroup" aria-label="Theme">
        <button
          v-for="item in themes"
          :key="item.id"
          type="button"
          class="appearance-theme-card"
          :class="{ 'appearance-theme-card--active': store.appearance.theme === item.id }"
          :aria-checked="store.appearance.theme === item.id"
          role="radio"
          @click="setTheme(item.id)"
        >
          <span class="appearance-theme-card__preview" :data-preview="item.id" aria-hidden="true" />
          <span class="appearance-theme-card__label">{{ item.label }}</span>
          <span class="appearance-theme-card__hint">{{ item.hint }}</span>
        </button>
      </div>
    </SettingsRow>

    <SettingsRow label="Accent color" hint="Semantic brand accent for buttons, focus, and selection.">
      <div class="appearance-accent-grid" role="list">
        <button
          v-for="swatch in ACCENT_PALETTES"
          :key="swatch.id"
          type="button"
          class="appearance-accent-swatch"
          :class="{ 'appearance-accent-swatch--active': store.appearance.accent === swatch.id }"
          :title="swatch.label"
          :aria-label="swatch.label"
          :aria-pressed="store.appearance.accent === swatch.id"
          :style="{ '--swatch': swatch.brand }"
          @click="setAccent(swatch.id)"
        />
      </div>
    </SettingsRow>

    <SettingsRow label="Interface density" hint="Spacing for navigation, lists, forms, and settings rows.">
      <div class="flex flex-wrap gap-2">
        <button
          v-for="item in densities"
          :key="item.id"
          type="button"
          class="btn cursor-pointer"
          :class="store.appearance.density === item.id ? 'btn-primary' : 'btn-ghost'"
          @click="setDensity(item.id)"
        >
          {{ item.label }}
        </button>
      </div>
    </SettingsRow>

    <SettingsRow
      label="Enable interface animations"
      hint="Decorative UI transitions only. Always respects the OS reduced-motion preference."
      tooltip="Does not affect exported media, Subscribe Animations, Screensaver, Image Motion, or Ranking timelines."
    >
      <ToggleSwitch
        :model-value="store.appearance.interfaceAnimations"
        aria-label="Enable interface animations"
        @update:model-value="store.patchAppearance({ interfaceAnimations: $event })"
      />
    </SettingsRow>

    <div class="mt-4">
      <button class="btn btn-ghost cursor-pointer" type="button" @click="store.resetAppearance()">
        Reset Appearance
      </button>
    </div>
  </div>
</template>
