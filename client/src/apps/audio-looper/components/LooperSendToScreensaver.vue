<script setup lang="ts">
import { FolderOutput } from '@lucide/vue'
import { computed, ref } from 'vue'
import AppCheckbox from '../../../components/ui/AppCheckbox.vue'
import AppDialog from '../../../components/ui/AppDialog.vue'
import { usePlatformStore } from '../../../stores/platform'
import { projectHasBackgroundAudio } from '../../frame-screensaver/lib/screensaverAudioRefs'
import { useScreensaverStore } from '../../frame-screensaver/stores/screensaver'
import {
  sendLooperPlanToScreensaverProjects,
  transferNotificationMessage,
} from '../lib/sendToScreensaver'
import {
  deselectAllProjectIds,
  selectAllCheckboxState,
  selectAllProjectIds,
  sendButtonLabel,
  toggleProjectSelection,
} from '../lib/sendToScreensaverSelection'
import { useAudioLooperStore } from '../stores/audioLooper'

const store = useAudioLooperStore()
const platform = usePlatformStore()
const screensaver = useScreensaverStore()

const sendOpen = ref(false)
const sending = ref(false)
const selectedIds = ref<string[]>([])

const editableProjects = computed(() =>
  screensaver.projects.filter((project) => project.mediaKind === 'image' || project.mediaKind === 'video'),
)

const editableIds = computed(() => editableProjects.value.map((project) => project.id))

const selectedCount = computed(() => selectedIds.value.length)

const selectAllState = computed(() =>
  selectAllCheckboxState(selectedIds.value.length, editableIds.value.length),
)

const canOpen = computed(() => store.readyTracks.length > 0 && !sending.value && !store.sendBlocker)
const canSend = computed(() => canOpen.value && selectedCount.value > 0)
const visible = computed(() => store.hasSource)

const projectsWithExistingAudio = computed(() =>
  editableProjects.value.filter(
    (project) => selectedIds.value.includes(project.id) && projectHasBackgroundAudio(project),
  ),
)

const liveSelected = computed(() =>
  editableProjects.value.filter((project) => selectedIds.value.includes(project.id) && project.live),
)

const primaryLabel = computed(() => sendButtonLabel(selectedCount.value, sending.value))

async function openSendDialog() {
  if (!canOpen.value) return
  if (!screensaver.hydrated) await screensaver.init()
  const firstId = editableIds.value[0]
  selectedIds.value = firstId ? [firstId] : []
  sendOpen.value = true
}

function closeSendDialog() {
  if (sending.value) return
  sendOpen.value = false
}

function toggleProject(id: string) {
  selectedIds.value = toggleProjectSelection(selectedIds.value, id)
}

function onSelectAllChange(checked: boolean) {
  selectedIds.value = checked ? selectAllProjectIds(editableIds.value) : deselectAllProjectIds()
}

function statusLabel(project: (typeof editableProjects.value)[number]): string {
  if (project.live) return project.render.status === 'queued' ? 'Queued' : 'Rendering'
  if (project.audio.present) return 'Has audio'
  return 'No audio'
}

async function confirmSend() {
  if (!canSend.value || sending.value) return
  sending.value = true
  try {
    const result = await sendLooperPlanToScreensaverProjects(selectedIds.value)
    const notice = transferNotificationMessage(result)
    platform.toast(notice.text, notice.tone)
    if (result.ok.length > 0) sendOpen.value = false
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
    :disabled="!canOpen"
    :aria-label="sending ? 'Sending to Screensaver' : 'Send to Screensaver'"
    :title="sending ? 'Sending…' : 'Send to Screensaver'"
    @click="openSendDialog"
  >
    <FolderOutput :size="18" aria-hidden="true" />
  </button>

  <AppDialog :open="sendOpen" title="Send to Screensaver" @cancel="closeSendDialog">
    <p class="text-sm text-zinc-300">
      Send the original tracks and loop settings so Screensaver can preserve quality — no intermediate lossy export.
      One shared audio asset is attached to every selected project.
    </p>

    <div
      v-if="editableIds.length > 0"
      class="mt-3 flex items-center justify-between gap-2"
    >
      <label class="inline-flex cursor-pointer items-center gap-2.5 text-sm text-zinc-200">
        <AppCheckbox
          :checked="selectAllState === 'checked'"
          :indeterminate="selectAllState === 'indeterminate'"
          :disabled="sending"
          aria-label="Select all projects"
          @change="onSelectAllChange"
        />
        Select all
      </label>
      <p class="text-xs text-zinc-400">
        {{ selectedIds.length }} of {{ editableIds.length }} selected
      </p>
    </div>

    <div class="mt-3 max-h-56 space-y-1 overflow-y-auto rounded-md border border-zinc-800 bg-inset p-1">
      <p v-if="editableProjects.length === 0" class="px-2 py-6 text-center text-sm text-zinc-500">
        No saved Screensaver projects yet. Create one in Screensaver first.
      </p>
      <label
        v-for="project in editableProjects"
        :key="project.id"
        class="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-white/5"
        :class="
          selectedIds.includes(project.id)
            ? 'bg-brand/10 ring-1 ring-inset ring-brand/35'
            : ''
        "
      >
        <AppCheckbox
          class="shrink-0"
          :checked="selectedIds.includes(project.id)"
          :disabled="sending"
          :aria-label="`Select ${project.name}`"
          @change="() => toggleProject(project.id)"
        />
        <div class="h-10 w-16 shrink-0 overflow-hidden rounded bg-zinc-900">
          <img v-if="project.thumbnail" :src="project.thumbnail" alt="" class="h-full w-full object-cover" />
          <span v-else class="flex h-full items-center justify-center text-[10px] text-zinc-600">No image</span>
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-zinc-100" :title="project.name">{{ project.name }}</p>
          <p class="mt-0.5 text-xs text-zinc-500">
            {{ project.mediaLabel }} · {{ statusLabel(project) }}
            <span v-if="project.live" class="text-amber-200"> · skipping while export is active</span>
          </p>
        </div>
      </label>
    </div>

    <p v-if="projectsWithExistingAudio.length > 0" class="mt-3 text-sm text-amber-200">
      {{ projectsWithExistingAudio.length === 1
        ? `“${projectsWithExistingAudio[0]?.name}” already has background audio. It will be replaced.`
        : `${projectsWithExistingAudio.length} selected projects already have background audio. Existing audio will be replaced.` }}
    </p>
    <p v-if="liveSelected.length > 0" class="mt-2 text-sm text-zinc-400">
      Projects that are rendering or queued will be skipped so active export jobs keep their snapshots.
    </p>

    <template #actions>
      <button class="btn btn-ghost cursor-pointer" type="button" :disabled="sending" @click="closeSendDialog">
        Cancel
      </button>
      <button
        class="btn btn-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
        type="button"
        :disabled="!canSend"
        @click="confirmSend"
      >
        {{ primaryLabel }}
      </button>
    </template>
  </AppDialog>
</template>
