<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { Cpu, Database, FileJson, FileOutput, Info, Palette, Plug, Settings2, X } from '@lucide/vue'
import type { GlobalSettingsCategory } from '@shared/globalSettings'
import { useI18n, type MessageKey } from '../../i18n'
import { useGlobalSettingsStore } from '../../stores/globalSettings'
import SettingsAboutPanel from './SettingsAboutPanel.vue'
import SettingsAppearancePanel from './SettingsAppearancePanel.vue'
import SettingsBackupPanel from './SettingsBackupPanel.vue'
import SettingsExportPanel from './SettingsExportPanel.vue'
import SettingsGeneralPanel from './SettingsGeneralPanel.vue'
import SettingsIntegrationsPanel from './SettingsIntegrationsPanel.vue'
import SettingsPerformancePanel from './SettingsPerformancePanel.vue'
import SettingsStoragePanel from './SettingsStoragePanel.vue'

const store = useGlobalSettingsStore()
const { t } = useI18n()
const titleId = useId()
const panelRef = ref<HTMLElement | null>(null)
let restore: HTMLElement | null = null

const categoryDefs: Array<{ id: GlobalSettingsCategory; labelKey: MessageKey; icon: typeof Settings2 }> = [
  { id: 'general', labelKey: 'settings.categories.general', icon: Settings2 },
  { id: 'appearance', labelKey: 'settings.categories.appearance', icon: Palette },
  { id: 'performance', labelKey: 'settings.categories.performance', icon: Cpu },
  { id: 'storage', labelKey: 'settings.categories.storage', icon: Database },
  { id: 'export', labelKey: 'settings.categories.export', icon: FileOutput },
  { id: 'integrations', labelKey: 'settings.categories.integrations', icon: Plug },
  { id: 'backup', labelKey: 'settings.categories.backup', icon: FileJson },
  { id: 'about', labelKey: 'settings.categories.about', icon: Info },
]

const categories = computed(() =>
  categoryDefs.map((item) => ({ ...item, label: t(item.labelKey) })),
)

const saveLabel = computed(() => {
  if (store.saveState === 'saving') return t('settings.saving')
  if (store.saveState === 'saved') return t('settings.saved')
  if (store.saveState === 'error') return store.saveError || t('settings.saveFailed')
  return ''
})

function onKey(event: KeyboardEvent): void {
  if (!store.modalOpen || event.key !== 'Escape') return
  event.preventDefault()
  store.closeModal()
}

watch(
  () => store.modalOpen,
  async (open) => {
    if (open) {
      restore = document.activeElement instanceof HTMLElement ? document.activeElement : null
      window.addEventListener('keydown', onKey)
      document.body.style.overflow = 'hidden'
      await nextTick()
      panelRef.value
        ?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
        ?.focus()
    } else {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      restore?.focus()
      restore = null
    }
  },
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="store.modalOpen"
        class="dialog-backdrop"
        @click.self="store.closeModal()"
      >
        <div
          ref="panelRef"
          class="global-settings-modal"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
        >
          <header class="global-settings-modal__header">
            <div>
              <h2 :id="titleId" class="text-lg font-bold text-ink">{{ t('settings.title') }}</h2>
              <p class="text-xs text-faint">{{ t('settings.subtitle') }}</p>
            </div>
            <div class="flex items-center gap-3">
              <span
                v-if="saveLabel"
                class="text-xs"
                :class="store.saveState === 'error' ? 'text-amber-600' : 'text-faint'"
                aria-live="polite"
              >
                {{ saveLabel }}
              </span>
              <button
                class="focus-ring grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-ghost hover:text-ink cursor-pointer"
                type="button"
                :aria-label="t('settings.close')"
                @click="store.closeModal()"
              >
                <X :size="18" />
              </button>
            </div>
          </header>

          <div class="global-settings-modal__body">
            <nav class="global-settings-modal__nav" :aria-label="t('settings.categoriesNav')">
              <button
                v-for="item in categories"
                :key="item.id"
                class="global-settings-modal__nav-item"
                type="button"
                :class="{ 'global-settings-modal__nav-item--active': store.activeCategory === item.id }"
                :aria-current="store.activeCategory === item.id ? 'page' : undefined"
                @click="store.setCategory(item.id)"
              >
                <component :is="item.icon" :size="16" class="shrink-0" />
                <span>{{ item.label }}</span>
              </button>
            </nav>
            <div class="global-settings-modal__content">
              <SettingsGeneralPanel v-if="store.activeCategory === 'general'" />
              <SettingsAppearancePanel v-else-if="store.activeCategory === 'appearance'" />
              <SettingsPerformancePanel v-else-if="store.activeCategory === 'performance'" />
              <SettingsStoragePanel v-else-if="store.activeCategory === 'storage'" />
              <SettingsExportPanel v-else-if="store.activeCategory === 'export'" />
              <SettingsIntegrationsPanel v-else-if="store.activeCategory === 'integrations'" />
              <SettingsBackupPanel v-else-if="store.activeCategory === 'backup'" />
              <SettingsAboutPanel v-else />
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
