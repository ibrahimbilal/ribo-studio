<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../../i18n'
import AppExportAction from '../../../components/ui/AppExportAction.vue'
import { useImageMotionStore } from '../stores/imageMotion'

const store = useImageMotionStore()
const { t } = useI18n()
const label = computed(() =>
  store.activeExportCount > 0 ? t('imageMotion.export.queueExport') : t('imageMotion.export.exportMp4'),
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
