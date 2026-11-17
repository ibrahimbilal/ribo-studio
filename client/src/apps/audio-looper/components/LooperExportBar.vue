<script setup lang="ts">
import { computed } from 'vue'
import AppExportAction from '../../../components/ui/AppExportAction.vue'
import { useI18n } from '../../../i18n'
import { useAudioLooperStore } from '../stores/audioLooper'

const store = useAudioLooperStore()
const { t } = useI18n()

const label = computed(() => (store.activeExportCount > 0 ? t('looper.export.queueExport') : t('looper.export.exportLoop')))
</script>

<template>
  <AppExportAction
    :label="label"
    :disabled="Boolean(store.exportBlocker)"
    :blocker="store.exportBlocker"
    :hint="t('looper.export.hint')"
    @export="store.startExport()"
  />
</template>
