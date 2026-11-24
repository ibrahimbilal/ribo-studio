<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ExternalLink, Settings2, RefreshCcw } from '@lucide/vue'
import {
  listSubscribeChannelPreferences,
  onSubscribeChannelsChanged,
  type SubscribeChannelPreference,
} from '../apps/frame-screensaver/lib/subscribeAnimation/subscribeAnimationChannelPreference'
import {
  onYoutubeChannelAvatarImgError,
  refreshYoutubeChannel,
  youtubeChannelAvatarImgSrc,
} from '../lib/youtubeChannelLookup'
import { useI18n } from '../i18n'
import { useGlobalSettingsStore } from '../stores/globalSettings'
import { usePlatformStore } from '../stores/platform'

const props = defineProps<{
  modelValue: string | null
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [channelId: string]
  manage: []
}>()

const { t } = useI18n()
const globalSettings = useGlobalSettingsStore()
const platform = usePlatformStore()
const channels = ref<SubscribeChannelPreference[]>([])
const refreshing = ref(false)

function refreshList(): void {
  channels.value = listSubscribeChannelPreferences()
}

let unsubscribe: (() => void) | null = null

onMounted(() => {
  refreshList()
  unsubscribe = onSubscribeChannelsChanged(refreshList)
})

onUnmounted(() => {
  unsubscribe?.()
})

const selected = computed(() => channels.value.find((c) => c.channelId === props.modelValue) ?? null)
const selectedAvatarSrc = computed(() =>
  youtubeChannelAvatarImgSrc(selected.value?.channelAvatarUrl, selected.value?.channelId),
)

function onSelect(event: Event): void {
  const value = (event.target as HTMLSelectElement).value.trim()
  if (value) emit('update:modelValue', value)
}

function openManage(): void {
  emit('manage')
  globalSettings.openModal('integrations')
}

function openChannel(): void {
  const url = selected.value?.channelUrl
  if (!url) return
  window.open(url, '_blank', 'noopener,noreferrer')
}

async function refreshChannels(): Promise<void> {
  if (refreshing.value || props.disabled) return
  const selectedId = props.modelValue
  const list = selectedId
    ? channels.value.filter((channel) => channel.channelId === selectedId)
    : channels.value
  if (list.length === 0) {
    platform.toast(t('settingsExtra.youtubeSelectorNothingToRefresh'), 'info')
    return
  }
  refreshing.value = true
  try {
    let okCount = 0
    let lastName = ''
    let lastError = ''
    for (const channel of list) {
      const result = await refreshYoutubeChannel(channel.channelId)
      if (result.ok) {
        okCount += 1
        lastName = result.channel.channelName
      } else {
        lastError = result.error
      }
    }
    refreshList()
    if (okCount === 0) {
      platform.toast(lastError || t('settingsExtra.youtubeSelectorRefreshFailed'), 'error')
      return
    }
    // Re-emit selection so the host store reapplies refreshed name/avatar/subs.
    if (props.modelValue) emit('update:modelValue', props.modelValue)
    if (okCount === 1) {
      platform.toast(t('settingsExtra.youtubeSelectorRefreshedOne', { name: lastName }), 'success')
    } else {
      platform.toast(t('settingsExtra.youtubeSelectorRefreshedMany', { count: okCount }), 'success')
    }
  } catch (error) {
    platform.toast(
      error instanceof Error ? error.message : t('settingsExtra.youtubeSelectorRefreshFailed'),
      'error',
    )
  } finally {
    refreshing.value = false
  }
}
</script>

<template>
  <div class="youtube-channel-selector">
    <div v-if="selected" class="youtube-channel-selector__current">
      <img
        v-if="selectedAvatarSrc"
        class="youtube-channel-selector__avatar"
        :src="selectedAvatarSrc"
        alt=""
        width="28"
        height="28"
        @error="onYoutubeChannelAvatarImgError($event, selected?.channelAvatarUrl)"
      />
      <span v-else class="youtube-channel-selector__avatar youtube-channel-selector__avatar--empty" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium text-zinc-100">{{ selected.channelName }}</p>
        <p v-if="selected.channelHandle" class="truncate text-xs text-zinc-500">@{{ selected.channelHandle }}</p>
      </div>
      <button
        v-if="selected.channelUrl"
        class="focus-ring grid h-8 w-8 place-items-center rounded-lg text-zinc-400 hover:bg-white/5 hover:text-zinc-100 cursor-pointer"
        type="button"
        :aria-label="t('settingsExtra.youtubeSelectorOpen')"
        @click="openChannel"
      >
        <ExternalLink :size="14" />
      </button>
    </div>
    <select
      class="field mt-2"
      :value="modelValue ?? ''"
      :disabled="disabled || channels.length === 0"
      :aria-label="t('settingsExtra.youtubeSelectorLabel')"
      @change="onSelect"
    >
      <option v-if="channels.length === 0" value="">{{ t('settingsExtra.youtubeSelectorEmpty') }}</option>
      <option v-for="channel in channels" :key="channel.channelId" :value="channel.channelId">
        {{ channel.channelName }}
      </option>
    </select>

    <div class="flex items-center gap-1">
      <button
        class="mt-1 cursor-pointer text-xs font-semibold text-brand underline-offset-2 hover:underline"
        type="button"
        :disabled="disabled"
        @click="openManage"
      >
        <span class="inline-flex items-center gap-1">
          <Settings2 :size="12" />
          {{ t('settingsExtra.youtubeSelectorManage') }}
        </span>
      </button>

      <button
        class="mt-1 ms-auto cursor-pointer text-xs font-semibold text-brand underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        type="button"
        :title="t('settingsExtra.youtubeSelectorRefresh')"
        :aria-label="t('settingsExtra.youtubeSelectorRefresh')"
        :disabled="disabled || refreshing || channels.length === 0"
        @click="void refreshChannels()"
      >
        <span class="inline-flex items-center gap-1">
          <RefreshCcw :size="12" :class="refreshing ? 'animate-spin' : undefined" />
          <span class="sr-only">{{ refreshing ? t('settingsExtra.youtubeSelectorRefreshing') : t('settingsExtra.youtubeSelectorRefresh') }}</span>
        </span>
      </button>
    </div>
  </div>
</template>
