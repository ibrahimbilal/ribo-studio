<script setup lang="ts">
import ToggleSwitch from '../ToggleSwitch.vue'
import { useGlobalSettingsStore } from '../../stores/globalSettings'
import SettingsRow from './SettingsRow.vue'

const store = useGlobalSettingsStore()

async function onDesktopNotifications(value: boolean): Promise<void> {
  if (value && typeof Notification !== 'undefined' && Notification.permission === 'default') {
    try {
      await Notification.requestPermission()
    } catch {
      // Permission prompt may be blocked.
    }
  }
  store.patchGeneral({ desktopNotifications: value })
}
</script>

<template>
  <div>
    <h3 class="section-label">General</h3>
    <SettingsRow
      label="Desktop notifications"
      hint="Use the browser Notification API when a render finishes."
      tooltip="Requires browser permission. In-app notification panel still works independently."
    >
      <ToggleSwitch
        :model-value="store.general.desktopNotifications"
        aria-label="Desktop notifications"
        @update:model-value="onDesktopNotifications"
      />
    </SettingsRow>
    <SettingsRow
      label="Export completion notifications"
      hint="Show ready / failed rows in the header notification panel."
    >
      <ToggleSwitch
        :model-value="store.general.exportCompletionNotifications"
        aria-label="Export completion notifications"
        @update:model-value="store.patchGeneral({ exportCompletionNotifications: $event })"
      />
    </SettingsRow>
    <SettingsRow
      label="Remember last opened application"
      hint="Restores the last app route the next time you open the Dashboard."
    >
      <ToggleSwitch
        :model-value="store.general.rememberLastApp"
        aria-label="Remember last opened application"
        @update:model-value="store.patchGeneral({ rememberLastApp: $event })"
      />
    </SettingsRow>
    <div class="mt-4">
      <button class="btn btn-ghost cursor-pointer" type="button" @click="store.resetGeneral()">
        Reset General Settings
      </button>
    </div>
  </div>
</template>
