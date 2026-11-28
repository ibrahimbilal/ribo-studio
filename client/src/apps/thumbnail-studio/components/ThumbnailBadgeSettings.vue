<script setup lang="ts">
import { ANCHORS, maxBadgeMarginPx } from '@shared/thumbnailLayout'
import { DURATION_BADGE_OPTIONS, RESOLUTION_BADGE_OPTIONS } from '@shared/thumbnailBadges'
import type { BadgeId } from '@shared/thumbnailProject'
import { computed } from 'vue'
import SettingsAccordion from '../../../components/SettingsAccordion.vue'
import SliderField from '../../../components/SliderField.vue'
import ToggleSwitch from '../../../components/ToggleSwitch.vue'
import { useI18n, type MessageKey } from '../../../i18n'
import { useThumbnailStore } from '../stores/thumbnail'

const props = defineProps<{
  badgeId: BadgeId
  title: string
}>()

const store = useThumbnailStore()
const { t } = useI18n()

const badge = computed(() => store.doc[props.badgeId])

const labelOptions = computed(() =>
  props.badgeId === 'resolution' ? RESOLUTION_BADGE_OPTIONS : DURATION_BADGE_OPTIONS,
)

const textFieldLabel = computed(() =>
  props.badgeId === 'resolution' ? t('thumbnail.settings.resolution') : t('thumbnail.settings.duration'),
)

const marginMaxPx = computed(() => maxBadgeMarginPx(store.doc.export.width, store.doc.export.height))

const ANCHOR_LABEL_KEYS: Record<string, MessageKey> = {
  'top-left': 'thumbnail.anchors.topLeft',
  'top-center': 'thumbnail.anchors.topCenter',
  'top-right': 'thumbnail.anchors.topRight',
  'middle-left': 'thumbnail.anchors.middleLeft',
  center: 'thumbnail.anchors.center',
  'middle-right': 'thumbnail.anchors.middleRight',
  'bottom-left': 'thumbnail.anchors.bottomLeft',
  'bottom-center': 'thumbnail.anchors.bottomCenter',
  'bottom-right': 'thumbnail.anchors.bottomRight',
}

function anchorLabel(id: string): string {
  const key = ANCHOR_LABEL_KEYS[id]
  return key ? t(key) : id
}

function onLabelChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  store.setBadgeText(props.badgeId, value)
}
</script>

<template>
  <SettingsAccordion :title="title" :open="true">
    <div class="flex items-center justify-between gap-3">
      <span class="text-sm">{{ t('thumbnail.settings.showBadge') }}</span>
      <ToggleSwitch
        :model-value="badge.enabled"
        :aria-label="t('thumbnail.settings.showBadgeAria', { section: title })"
        @update:model-value="store.setBadgeEnabled(badgeId, $event)"
      />
    </div>
    <div class="settings-reveal" :class="{ 'is-open': badge.enabled }" :inert="!badge.enabled">
      <div class="settings-reveal__inner">
        <div class="space-y-3 pt-3">
          <label class="block text-xs text-zinc-500">
            {{ textFieldLabel }}
            <select class="field mt-1" :value="badge.text" @change="onLabelChange">
              <option v-for="option in labelOptions" :key="option.label" :value="option.label">{{ option.label }}</option>
            </select>
          </label>
          <div class="block">
            <p class="mb-2 text-xs text-zinc-500">{{ t('thumbnail.settings.position') }}</p>
            <div class="grid grid-cols-3 gap-2">
              <button
                v-for="anchor in ANCHORS"
                :key="anchor.id"
                class="btn cursor-pointer px-1 py-2 text-xs leading-tight"
                :class="badge.anchor === anchor.id && !badge.deliberate ? 'btn-primary' : 'btn-ghost'"
                type="button"
                @click="store.place(badgeId, anchor.id)"
              >
                {{ anchorLabel(anchor.id) }}
              </button>
            </div>
          </div>
          <SliderField
            v-if="!badge.deliberate"
            :label="t('thumbnail.settings.distanceFromEdges')"
            :model-value="Math.round(badge.margin)"
            :min="0"
            :max="marginMaxPx"
            suffix="px"
            @update:model-value="store.setMargin(badgeId, $event)"
          />
          <SliderField
            :label="badge.deliberate ? t('thumbnail.settings.horizontalPosition') : t('thumbnail.settings.horizontalOffset')"
            :model-value="Math.round((badge.deliberate ? badge.x : badge.offsetX) * 100)"
            :min="badge.deliberate ? 0 : -45"
            :max="badge.deliberate ? 100 : 45"
            suffix="%"
            @update:model-value="store.setHorizontal(badgeId, $event / 100)"
          />
          <SliderField
            :label="badge.deliberate ? t('thumbnail.settings.verticalPosition') : t('thumbnail.settings.verticalOffset')"
            :model-value="Math.round((badge.deliberate ? badge.y : badge.offsetY) * 100)"
            :min="badge.deliberate ? 0 : -45"
            :max="badge.deliberate ? 100 : 45"
            suffix="%"
            @update:model-value="store.setVertical(badgeId, $event / 100)"
          />
          <button class="btn btn-ghost cursor-pointer text-xs" type="button" @click="store.resetPosition(badgeId)">
            {{ t('thumbnail.settings.resetPosition') }}
          </button>
        </div>
      </div>
    </div>
  </SettingsAccordion>
</template>