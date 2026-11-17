<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../../i18n'
import type { ShortsEditorMode } from '../lib/shortsMode'

const model = defineModel<ShortsEditorMode>({ required: true })
const { t } = useI18n()

const items = computed(() => [
  { id: 'ranking' as const, label: t('imageMotion.shortsMode.ranking') },
  { id: 'image-motion' as const, label: t('imageMotion.shortsMode.imageMotion') },
])
</script>

<template>
  <div class="settings-tabs grid grid-cols-2 gap-1" role="tablist" :aria-label="t('imageMotion.shortsMode.ariaLabel')">
    <button
      v-for="item in items"
      :key="item.id"
      class="settings-tab btn cursor-pointer px-1 text-xs"
      :class="model === item.id ? 'btn-primary settings-tab--active' : 'btn-ghost'"
      type="button"
      role="tab"
      :aria-selected="model === item.id"
      @click="model = item.id"
    >
      {{ item.label }}
    </button>
  </div>
</template>
