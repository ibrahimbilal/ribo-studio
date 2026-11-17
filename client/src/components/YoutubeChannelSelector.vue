<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ExternalLink, Settings2 } from '@lucide/vue'
import {
  listSubscribeChannelPreferences,
  onSubscribeChannelsChanged,
  type SubscribeChannelPreference,
} from '../apps/frame-screensaver/lib/subscribeAnimation/subscribeAnimationChannelPreference'
import { useGlobalSettingsStore } from '../stores/globalSettings'

const props = defineProps<{
  modelValue: string | null
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [channelId: string]
  manage: []
}>()

const globalSettings = useGlobalSettingsStore()
const channels = ref<SubscribeChannelPreference[]>([])

function refresh(): void {
  channels.value = listSubscribeChannelPreferences()
}

let unsubscribe: (() => void) | null = null

onMounted(() => {
  refresh()
  unsubscribe = onSubscribeChannelsChanged(refresh)
})

onUnmounted(() => {
  unsubscribe?.()
})

const selected = computed(() => channels.value.find((c) => c.channelId === props.modelValue) ?? null)

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
</script>

<template>
  <div class="youtube-channel-selector">
    <div v-if="selected" class="youtube-channel-selector__current">
      <img
        v-if="selected.channelAvatarUrl"
        class="youtube-channel-selector__avatar"
        :src="selected.channelAvatarUrl"
        alt=""
        width="28"
        height="28"
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
        aria-label="Open YouTube channel"
        @click="openChannel"
      >
        <ExternalLink :size="14" />
      </button>
    </div>
    <select
      class="field mt-2"
      :value="modelValue ?? ''"
      :disabled="disabled || channels.length === 0"
      aria-label="YouTube channel"
      @change="onSelect"
    >
      <option v-if="channels.length === 0" value="">No channels registered</option>
      <option v-for="channel in channels" :key="channel.channelId" :value="channel.channelId">
        {{ channel.channelName }}
      </option>
    </select>
    <button
      class="mt-1 cursor-pointer text-xs font-semibold text-brand underline-offset-2 hover:underline"
      type="button"
      @click="openManage"
    >
      <span class="inline-flex items-center gap-1">
        <Settings2 :size="12" />
        Manage channels
      </span>
    </button>
  </div>
</template>
