<script setup lang="ts">
import { BroomSparkles, Loader2 } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import * as api from '../../lib/api'
import { formatTempSize } from '../../lib/format'
import { usePlatformStore } from '../../stores/platform'
import { useI18n } from '../../i18n'

const platform = usePlatformStore()
const { t } = useI18n()
const bytes = ref<number | null>(null)
const busy = ref(false)

const label = computed(() => (bytes.value == null ? '…' : formatTempSize(bytes.value)))

async function refresh(): Promise<void> {
  try {
    bytes.value = await api.fetchTempStorageBytes()
  } catch {
    bytes.value = null
  }
}

async function cleanTemp(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    bytes.value = await api.cleanTempStorage()
    platform.toast(t('layout.tempCleared'), 'success')
  } catch (error) {
    platform.toast(error instanceof Error ? error.message : t('layout.tempClearFailed'), 'error')
    await refresh()
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  void refresh()
})
</script>

<template>
  <button
    class="focus-ring inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-sm px-2 text-xs font-semibold text-zinc-300 hover:text-zinc-100 disabled:cursor-wait disabled:opacity-60"
    type="button"
    :disabled="busy"
    :aria-label="t('layout.clearTemp', { size: label })"
    :title="t('layout.clearTempTitle', { size: label })"
    @click="void cleanTemp()"
  >
    <Loader2 v-if="busy" class="animate-spin" :size="18" />
    <BroomSparkles v-else :size="18" />
    <span class="tabular-nums">{{ label }}</span>
  </button>
</template>
