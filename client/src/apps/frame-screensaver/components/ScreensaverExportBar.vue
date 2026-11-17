<script setup lang="ts">
import { computed } from 'vue'
import AppExportAction from '../../../components/ui/AppExportAction.vue'
import { useScreensaverStore } from '../stores/screensaver'
import { useI18n } from '../../../i18n'
import { S } from '../lib/screensaverI18n'

const store = useScreensaverStore()
const { t } = useI18n()

const label = computed(() =>
  store.activeExportCount > 0 ? t(S('exportBar.queue')) : t(S('exportBar.exportMp4')),
)
</script>

<template>
  <AppExportAction
    :label="label"
    :disabled="Boolean(store.exportBlocker)"
    :blocker="store.exportBlocker"
    @export="void store.startExport()"
  >
    <p v-if="store.exportState.error" class="mt-2 text-xs text-red-300">{{ store.exportState.error }}</p>
    <button
      v-if="store.exportState.error && store.encoder !== 'cpu' && store.encoder !== 'auto'"
      class="btn btn-ghost mt-2 cursor-pointer"
      type="button"
      @click="store.exportWithCpu()"
    >
      {{ t(S('exportBar.cpuFallback')) }}
    </button>
  </AppExportAction>
</template>