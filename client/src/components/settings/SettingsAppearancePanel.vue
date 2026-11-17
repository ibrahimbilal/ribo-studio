<script setup lang="ts">
import { computed } from 'vue'
import { ACCENT_PALETTES } from '@shared/appearanceTokens'
import type { AccentColorId, InterfaceDensity, ThemePreference } from '@shared/globalSettings'
import ToggleSwitch from '../ToggleSwitch.vue'
import { useI18n } from '../../i18n'
import { useGlobalSettingsStore } from '../../stores/globalSettings'
import SettingsRow from './SettingsRow.vue'

const store = useGlobalSettingsStore()
const { t } = useI18n()

const themes = computed(() => [
  { id: 'light' as const, label: t('appearance.themeLight'), hint: t('appearance.themeLightHint') },
  { id: 'dark' as const, label: t('appearance.themeDark'), hint: t('appearance.themeDarkHint') },
  { id: 'system' as const, label: t('appearance.themeSystem'), hint: t('appearance.themeSystemHint') },
])

const densities = computed(() => [
  { id: 'comfortable' as const, label: t('appearance.densityComfortable') },
  { id: 'compact' as const, label: t('appearance.densityCompact') },
])

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
    <h3 class="section-label">{{ t('appearance.section') }}</h3>
    <p class="mb-3 text-xs text-zinc-500">
      {{ t('appearance.intro') }}
    </p>

    <SettingsRow :label="t('appearance.theme')" :hint="t('appearance.themeHint')">
      <div class="appearance-theme-grid" role="radiogroup" :aria-label="t('appearance.theme')">
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

    <SettingsRow :label="t('appearance.accent')" :hint="t('appearance.accentHint')">
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

    <SettingsRow :label="t('appearance.density')" :hint="t('appearance.densityHint')">
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
      :label="t('appearance.animations')"
      :hint="t('appearance.animationsHint')"
      :tooltip="t('appearance.animationsTooltip')"
    >
      <ToggleSwitch
        :model-value="store.appearance.interfaceAnimations"
        :aria-label="t('appearance.animations')"
        @update:model-value="store.patchAppearance({ interfaceAnimations: $event })"
      />
    </SettingsRow>

    <div class="mt-4">
      <button class="btn btn-ghost cursor-pointer" type="button" @click="store.resetAppearance()">
        {{ t('appearance.reset') }}
      </button>
    </div>
  </div>
</template>
