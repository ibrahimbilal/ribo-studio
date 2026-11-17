<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../i18n'
import AppExportAction from './ui/AppExportAction.vue'
import { useProjectStore } from '../stores/project'

const store = useProjectStore()
const { t } = useI18n()

const label = computed(() =>
  store.activeExportCount > 0 ? t('ranking.export.queueExport') : t('ranking.export.exportMp4'),
)
</script>

<template>
  <AppExportAction
    :label="label"
    :disabled="Boolean(store.exportBlocker)"
    :blocker="store.exportBlocker"
    @export="void store.startExport()"
  />
</template>
