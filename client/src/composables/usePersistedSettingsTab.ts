import { ref, watch, type Ref } from 'vue'
import {
  loadSettingsTab,
  saveSettingsTab,
  type SettingsTabScope,
} from '../lib/settingsTabMemory'

/** Reactive settings-tab id that restores and persists per app/scope. */
export function usePersistedSettingsTab<T extends string>(
  scope: SettingsTabScope,
  allowed: readonly T[],
  fallback: T,
): Ref<T> {
  const tab = ref(loadSettingsTab(scope, allowed, fallback)) as Ref<T>
  watch(tab, (value) => saveSettingsTab(scope, value))
  return tab
}
