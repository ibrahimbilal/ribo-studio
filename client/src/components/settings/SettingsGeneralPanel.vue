<script setup lang="ts">
import { APP_LANGUAGES, type AppLanguage } from '@shared/globalSettings'
import ToggleSwitch from '../ToggleSwitch.vue'
import { useI18n } from '../../i18n'
import { useGlobalSettingsStore } from '../../stores/globalSettings'
import SettingsRow from './SettingsRow.vue'

const store = useGlobalSettingsStore()
const { t } = useI18n()

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
    <h3 class="section-label">{{ t('general.section') }}</h3>
    <SettingsRow :label="t('general.language')" :hint="t('general.languageHint')">
      <select
        class="field w-auto min-w-[12rem]"
        :value="store.general.language"
        :aria-label="t('general.language')"
        @change="store.patchGeneral({ language: ($event.target as HTMLSelectElement).value as AppLanguage })"
      >
        <option v-for="item in APP_LANGUAGES" :key="item.id" :value="item.id">{{ item.nativeLabel }}</option>
      </select>
    </SettingsRow>
    <SettingsRow
      :label="t('general.desktopNotifications')"
      :hint="t('general.desktopNotificationsHint')"
      :tooltip="t('general.desktopNotificationsTooltip')"
    >
      <ToggleSwitch
        :model-value="store.general.desktopNotifications"
        :aria-label="t('general.desktopNotifications')"
        @update:model-value="onDesktopNotifications"
      />
    </SettingsRow>
    <SettingsRow
      :label="t('general.exportCompletionNotifications')"
      :hint="t('general.exportCompletionNotificationsHint')"
    >
      <ToggleSwitch
        :model-value="store.general.exportCompletionNotifications"
        :aria-label="t('general.exportCompletionNotifications')"
        @update:model-value="store.patchGeneral({ exportCompletionNotifications: $event })"
      />
    </SettingsRow>
    <SettingsRow :label="t('general.rememberLastApp')" :hint="t('general.rememberLastAppHint')">
      <ToggleSwitch
        :model-value="store.general.rememberLastApp"
        :aria-label="t('general.rememberLastApp')"
        @update:model-value="store.patchGeneral({ rememberLastApp: $event })"
      />
    </SettingsRow>
    <div class="mt-4">
      <button class="btn btn-ghost cursor-pointer" type="button" @click="store.resetGeneral()">
        {{ t('general.reset') }}
      </button>
    </div>
  </div>
</template>
