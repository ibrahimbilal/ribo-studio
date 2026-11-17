<script setup lang="ts">
import { Moon, Sun } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { resolveTheme, type ResolvedTheme } from '../../lib/appearance'
import { useGlobalSettingsStore } from '../../stores/globalSettings'
import { useI18n } from '../../i18n'

const store = useGlobalSettingsStore()
const { t } = useI18n()
const systemDark = ref(
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
)

let media: MediaQueryList | null = null
let onSystemChange: ((event: MediaQueryListEvent) => void) | null = null

onMounted(() => {
  media = window.matchMedia('(prefers-color-scheme: dark)')
  systemDark.value = media.matches
  onSystemChange = (event) => {
    systemDark.value = event.matches
  }
  media.addEventListener('change', onSystemChange)
})

onBeforeUnmount(() => {
  if (media && onSystemChange) media.removeEventListener('change', onSystemChange)
})

const resolved = computed((): ResolvedTheme =>
  resolveTheme(store.appearance.theme, systemDark.value),
)

const nextTheme = computed(() => (resolved.value === 'dark' ? 'light' : 'dark'))

const label = computed(() =>
  nextTheme.value === 'light' ? t('layout.switchToLight') : t('layout.switchToDark'),
)

function toggleTheme(): void {
  store.patchAppearance({ theme: nextTheme.value })
}
</script>

<template>
  <button
    class="focus-ring inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-sm text-zinc-300 hover:text-zinc-100"
    type="button"
    :aria-label="label"
    :title="label"
    @click="toggleTheme()"
  >
    <Sun v-if="resolved === 'dark'" :size="18" aria-hidden="true" />
    <Moon v-else :size="18" aria-hidden="true" />
  </button>
</template>
