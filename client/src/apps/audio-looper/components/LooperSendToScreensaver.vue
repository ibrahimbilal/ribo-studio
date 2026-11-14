<script setup lang="ts">
import { MonitorPlay } from '@lucide/vue'
import { computed, ref } from 'vue'
import AppDialog from '../../../components/ui/AppDialog.vue'
import { usePlatformStore } from '../../../stores/platform'
import { useScreensaverStore } from '../../frame-screensaver/stores/screensaver'
import { sendLooperPlanToScreensaver, type SendToScreensaverTarget } from '../lib/sendToScreensaver'
import { useAudioLooperStore } from '../stores/audioLooper'

const store = useAudioLooperStore()
const platform = usePlatformStore()
const screensaver = useScreensaverStore()

const sendOpen = ref(false)
const sending = ref(false)
const selectedTarget = ref<SendToScreensaverTarget>('current')

const editableProjects = computed(() =>
  screensaver.projects.filter((project) => !project.live),
)

const canSend = computed(() => store.readyTracks.length > 0 && !sending.value && !store.sendBlocker)
const visible = computed(() => store.hasSource)

async function openSendDialog() {
  if (!canSend.value) return
  if (!screensaver.hydrated) await screensaver.init()
  selectedTarget.value = screensaver.projectId ? 'current' : 'new'
  sendOpen.value = true
}

function closeSendDialog() {
  if (sending.value) return
  sendOpen.value = false
}

async function confirmSend() {
  if (!canSend.value) return
  sending.value = true
  try {
    await sendLooperPlanToScreensaver(selectedTarget.value)
    platform.toast('Audio plan sent to Screensaver.', 'success')
    sendOpen.value = false
  } catch (error) {
    platform.toast(error instanceof Error ? error.message : 'Could not send audio to Screensaver.', 'error')
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <button
    v-if="visible"
    class="btn btn-ghost cursor-pointer px-2"
    type="button"
    :disabled="!canSend"
    :aria-label="sending ? 'Sending to Screensaver' : 'Send to Screensaver'"
    :title="sending ? 'Sending…' : 'Send to Screensaver'"
    @click="openSendDialog"
  >
    <MonitorPlay :size="18" aria-hidden="true" />
  </button>

  <AppDialog :open="sendOpen" title="Send to Screensaver" @cancel="closeSendDialog">
    <p class="text-sm text-zinc-300">
      Send the original tracks and loop settings so Screensaver can preserve quality — no intermediate lossy export.
    </p>
    <label class="mt-3 block text-xs font-medium uppercase tracking-wide text-zinc-400">Target project</label>
    <select v-model="selectedTarget" class="field mt-1" :disabled="sending">
      <option value="new">Create a new Screensaver project</option>
      <option v-if="screensaver.projectId" value="current">Current Screensaver project</option>
      <option v-for="project in editableProjects" :key="project.id" :value="project.id">
        {{ project.name }}
      </option>
    </select>
    <template #actions>
      <button class="btn btn-ghost cursor-pointer" type="button" :disabled="sending" @click="closeSendDialog">Cancel</button>
      <button class="btn btn-primary cursor-pointer" type="button" :disabled="sending" @click="confirmSend">
        {{ sending ? 'Sending…' : 'Send' }}
      </button>
    </template>
  </AppDialog>
</template>
