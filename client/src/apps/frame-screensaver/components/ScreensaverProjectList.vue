<script setup lang="ts">
import { formatDurationLabel } from '@shared/screensaver'
import { Copy, Download, FileOutput, FolderOutput, ImagePlay, ImagePlus, Info, Music, Pencil, RotateCcw, Trash2 } from '@lucide/vue'
import { computed, ref } from 'vue'
import { formatBytes, formatClock } from '../../../lib/format'
import { audioFormatLabel } from '../../../lib/media'
import AppCheckbox from '../../../components/ui/AppCheckbox.vue'
import AppDialog from '../../../components/ui/AppDialog.vue'
import {
  deselectAllProjectIds,
  selectAllCheckboxState,
  selectAllProjectIds,
  toggleProjectSelection,
} from '../../../lib/multiSelect'
import { skipReasonLabel, type ExportAllDecision } from '../lib/exportAllPlan'
import { screensaverStatusLabel, type ScreensaverProjectStatus } from '../lib/screensaverProjectModel'
import { createThumbnailFromScreensaver } from '../lib/createThumbnail'
import { sendScreensaverImageToImageMotion } from '../lib/sendToImageMotion'
import { useScreensaverStore } from '../stores/screensaver'

const store = useScreensaverStore()
const renameId = ref<string | null>(null)
const renameValue = ref('')
const deleteId = ref<string | null>(null)
const deleteAllOpen = ref(false)
const downloadingAll = ref(false)
const exportAllOpen = ref(false)
const exportingAll = ref(false)
const exportAllEligible = ref<ExportAllDecision[]>([])
const exportAllSkipped = ref<Extract<ExportAllDecision, { kind: 'skipped' }>[]>([])
const exportAllSelectedIds = ref<string[]>([])
const infoTip = ref<{ id: string; kind: 'source' | 'audio'; x: number; y: number; above: boolean } | null>(null)

const deleteTarget = computed(() => store.projects.find((item) => item.id === deleteId.value) ?? null)
const downloadableCount = computed(
  () =>
    store.projects.filter(
      (item) => item.render.outputUrl && !item.outputMissing && item.render.status === 'completed',
    ).length,
)
const infoProject = computed(() => store.projects.find((item) => item.id === infoTip.value?.id) ?? null)
const exportAllEligibleIds = computed(() => exportAllEligible.value.map((item) => item.id))
const exportAllSelectedCount = computed(() => exportAllSelectedIds.value.length)
const exportAllSelectAllState = computed(() =>
  selectAllCheckboxState(exportAllSelectedIds.value.length, exportAllEligibleIds.value.length),
)
/** Fast gate for the header button; the confirm dialog runs the full eligibility plan. */
const approxExportableCount = computed(
  () =>
    store.projects.filter(
      (item) =>
        !item.live &&
        !item.sourceMissing &&
        item.upload.state === 'ready' &&
        Boolean(item.serverId),
    ).length,
)

function statusClass(status: ScreensaverProjectStatus): string {
  switch (status) {
    case 'rendering':
      return 'bg-brand/15 text-brand'
    case 'queued':
      return 'bg-amber-400/15 text-amber-200'
    case 'completed':
      return 'bg-emerald-400/15 text-emerald-200'
    case 'failed':
      return 'bg-red-400/15 text-red-200'
    case 'cancelled':
      return 'bg-zinc-700/80 text-zinc-300'
    default:
      return 'bg-zinc-800 text-zinc-300'
  }
}

function uploadIconClass(state: 'uploading' | 'ready' | 'error'): string {
  if (state === 'uploading') return 'text-brand'
  if (state === 'error') return 'text-red-300'
  return 'text-emerald-300'
}

function audioIconClass(state: string): string {
  if (state === 'uploading' || state === 'validating') return 'text-brand'
  if (state === 'error' || state === 'missing') return 'text-amber-200'
  if (state === 'available') return 'text-emerald-300'
  return 'text-zinc-400'
}

function uploadStatusLabel(project: (typeof store.projects)[number]): string {
  if (project.upload.state === 'uploading') return `Uploading ${Math.round(project.upload.progress * 100)}%`
  if (project.upload.state === 'error') return 'Upload failed'
  return 'Uploaded'
}

function audioStatusLabel(project: (typeof store.projects)[number]): string {
  const audio = project.audio
  if (audio.state === 'uploading') return `Uploading ${Math.round(audio.progress * 100)}%`
  if (audio.state === 'validating') return 'Checking audio…'
  if (audio.state === 'missing') return 'Audio missing'
  if (audio.state === 'error') return 'Audio failed'
  if (audio.state === 'available') return 'Audio ready'
  return 'Background audio'
}

function uploadMeta(project: (typeof store.projects)[number]): string {
  const parts: string[] = []
  if (project.upload.fileName) parts.push(audioFormatLabel(project.upload.fileName))
  if (project.upload.fileSize != null && project.upload.fileSize > 0) parts.push(formatBytes(project.upload.fileSize))
  if (project.upload.width > 0 && project.upload.height > 0) parts.push(`${project.upload.width}×${project.upload.height}`)
  if (project.upload.duration) parts.push(`${Math.round(project.upload.duration)}s`)
  return parts.join(' · ')
}

function audioMeta(project: (typeof store.projects)[number]): string {
  const audio = project.audio
  const parts: string[] = []
  if (audio.fileName) parts.push(audioFormatLabel(audio.fileName))
  if (audio.fileSize != null && audio.fileSize > 0) parts.push(formatBytes(audio.fileSize))
  if (audio.durationSec != null && audio.durationSec > 0) parts.push(formatClock(audio.durationSec))
  return parts.join(' · ')
}

function formatUpdated(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function showInfoTip(event: MouseEvent | FocusEvent, id: string, kind: 'source' | 'audio') {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const above = rect.bottom + 132 > window.innerHeight
  infoTip.value = {
    id,
    kind,
    x: Math.max(8, Math.min(rect.left, window.innerWidth - 232)),
    y: above ? rect.top - 8 : rect.bottom + 8,
    above,
  }
}

function hideInfoTip() {
  infoTip.value = null
}

function startRename(id: string, name: string) {
  renameId.value = id
  renameValue.value = name
}

function closeRename() {
  renameId.value = null
}

async function confirmRename() {
  if (!renameId.value) return
  await store.renameProject(renameId.value, renameValue.value)
  renameId.value = null
}

function startDelete(id: string) {
  deleteId.value = id
}

function closeDelete() {
  deleteId.value = null
}

async function confirmDelete() {
  if (!deleteId.value) return
  const id = deleteId.value
  deleteId.value = null
  await store.deleteProject(id)
}

function closeDeleteAll() {
  deleteAllOpen.value = false
}

async function confirmDeleteAll() {
  deleteAllOpen.value = false
  await store.deleteAllProjects()
}

async function downloadAll() {
  if (downloadingAll.value) return
  downloadingAll.value = true
  try {
    await store.downloadAllProjectOutputs()
  } finally {
    downloadingAll.value = false
  }
}

async function openExportAll() {
  if (exportingAll.value) return
  const plan = await store.buildExportAllPlan()
  exportAllEligible.value = plan.eligible
  exportAllSkipped.value = plan.skipped
  exportAllSelectedIds.value = selectAllProjectIds(plan.eligible.map((item) => item.id))
  exportAllOpen.value = true
}

function closeExportAll() {
  if (exportingAll.value) return
  exportAllOpen.value = false
}

function toggleExportAllProject(id: string) {
  exportAllSelectedIds.value = toggleProjectSelection(exportAllSelectedIds.value, id)
}

function onExportAllSelectAllChange(checked: boolean) {
  exportAllSelectedIds.value = checked
    ? selectAllProjectIds(exportAllEligibleIds.value)
    : deselectAllProjectIds()
}

async function confirmExportAll() {
  if (exportingAll.value || exportAllSelectedIds.value.length === 0) return
  exportingAll.value = true
  try {
    const selectedIds = [...exportAllSelectedIds.value]
    exportAllOpen.value = false
    await store.exportAllProjects(selectedIds)
  } finally {
    exportingAll.value = false
  }
}

function canImageHandoff(project: (typeof store.projects)[number]): boolean {
  return project.mediaKind === 'image' && !project.sourceMissing && project.upload.state === 'ready'
}

async function ensureProjectOpen(id: string): Promise<boolean> {
  if (id === store.projectId) return true
  return store.openProject(id)
}

async function createThumbnailFor(id: string) {
  if (!(await ensureProjectOpen(id))) return
  await createThumbnailFromScreensaver('snapshot', id)
}

async function sendToImageMotionFor(id: string) {
  if (!(await ensureProjectOpen(id))) return
  await sendScreensaverImageToImageMotion(id)
}

async function openSoundSettingsFor(id: string) {
  hideInfoTip()
  if (!(await ensureProjectOpen(id))) return
  store.openSoundSettings()
}
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col">
    <div class="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
      <h3 class="section-label">Projects</h3>
      <div class="flex items-center gap-1">
        <button
          class="btn btn-ghost cursor-pointer px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
          type="button"
          :disabled="approxExportableCount === 0 || exportingAll"
          :title="exportingAll ? 'Submitting…' : 'Export all eligible projects'"
          @click="openExportAll"
        >
          <FolderOutput  :size="14" />
          Export all
        </button>
        <button
          class="btn btn-ghost cursor-pointer px-2 py-1 text-xs text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
          type="button"
          :disabled="store.projects.length === 0"
          @click="deleteAllOpen = true"
        >
          <Trash2 :size="14" />
          Delete all
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
      <p v-if="store.projects.length === 0" class="px-2 py-8 text-center text-sm text-zinc-500">
        Drop an image or video to create a project.
      </p>

      <article
        v-for="project in store.projects"
        :key="project.id"
        class="cursor-pointer rounded-lg border bg-inset p-2 transition-opacity"
        :class="[
          project.id === store.projectId ? 'border-zinc-200' : 'border-zinc-800',
          project.downloadedUnchanged ? 'opacity-50' : 'opacity-100',
        ]"
        :data-project-id="project.id"
        :aria-current="project.id === store.projectId ? 'true' : undefined"
        @click="store.openProject(project.id)"
      >
        <div class="flex gap-2">
          <div class="h-14 w-24 shrink-0 overflow-hidden rounded bg-zinc-900">
            <img v-if="project.thumbnail" :src="project.thumbnail" alt="" class="h-full w-full object-cover" />
            <span v-else class="flex h-full items-center justify-center text-[10px] text-zinc-600">No image</span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-start gap-2">
              <p class="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-100" :title="project.name">{{ project.name }}</p>
              <span class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" :class="statusClass(project.render.status)">
                {{ screensaverStatusLabel(project.render.status, project.queuePosition) }}
              </span>
            </div>
            <p class="mt-0.5 truncate text-xs text-zinc-500">
              {{ project.mediaLabel }} · {{ formatDurationLabel(project.durationSeconds) }} · {{ project.outputWidth }}×{{ project.outputHeight }}
            </p>
            <p class="mt-0.5 text-xs text-zinc-500">{{ formatUpdated(project.updatedAt) }}</p>
          </div>
        </div>

        <div v-if="project.live" class="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            class="h-full rounded-full bg-brand transition-[width] duration-300 ease-out"
            :style="{ width: `${Math.round(Math.min(1, Math.max(0, project.render.progress)) * 100)}%` }"
          />
        </div>

        <p v-if="project.sourceMissing" class="mt-2 text-xs text-amber-200">Source file is no longer available.</p>
        <p v-if="project.frameMissing" class="mt-1 text-xs text-amber-200">Selected frame is no longer on the server.</p>
        <p v-if="project.outputMissing" class="mt-1 text-xs text-amber-200">Rendered video is no longer available.</p>
        <p v-if="project.render.status === 'failed' && project.render.error" class="mt-1 text-xs text-red-300">{{ project.render.error }}</p>

        <div class="mt-2 flex" @click.stop>
          <button
            class="rounded-sm inline-flex size-7 cursor-pointer items-center justify-center bg-transparent hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            :class="uploadIconClass(project.upload.state)"
            type="button"
            aria-label="Upload details"
            @mouseenter="showInfoTip($event, project.id, 'source')"
            @mouseleave="hideInfoTip"
            @focus="showInfoTip($event, project.id, 'source')"
            @blur="hideInfoTip"
          >
            <Info :size="16" />
          </button>
          <button
            v-if="project.audio.present"
            class="rounded-sm inline-flex size-7 cursor-pointer items-center justify-center bg-transparent hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            :class="audioIconClass(project.audio.state)"
            type="button"
            aria-label="Open Sound settings"
            title="Sound settings"
            @mouseenter="showInfoTip($event, project.id, 'audio')"
            @mouseleave="hideInfoTip"
            @focus="showInfoTip($event, project.id, 'audio')"
            @blur="hideInfoTip"
            @click="openSoundSettingsFor(project.id)"
          >
            <Music :size="16" />
          </button>
          <button
            class="rounded-sm inline-flex size-7 cursor-pointer items-center justify-center bg-transparent text-zinc-300 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            type="button"
            aria-label="Rename project"
            title="Rename"
            @click="startRename(project.id, project.name)"
          >
            <Pencil :size="16" />
          </button>
          <button
            class="rounded-sm inline-flex size-7 cursor-pointer items-center justify-center bg-transparent text-zinc-300 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            type="button"
            aria-label="Duplicate project"
            title="Duplicate"
            @click="store.duplicateProject(project.id)"
          >
            <Copy :size="16" />
          </button>
          <button
            v-if="canImageHandoff(project)"
            class="rounded-sm inline-flex size-7 cursor-pointer items-center justify-center bg-transparent text-zinc-300 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            type="button"
            aria-label="Create Thumbnail"
            title="Create Thumbnail"
            @click="createThumbnailFor(project.id)"
          >
            <ImagePlus :size="16" />
          </button>
          <button
            v-if="canImageHandoff(project)"
            class="rounded-sm inline-flex size-7 cursor-pointer items-center justify-center bg-transparent text-zinc-300 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            type="button"
            aria-label="Send image to Image Motion Shorts"
            title="Send image to Image Motion Shorts"
            @click="sendToImageMotionFor(project.id)"
          >
            <ImagePlay :size="16" />
          </button>
          <button
            v-if="project.render.outputUrl && !project.outputMissing"
            class="rounded-sm inline-flex size-7 cursor-pointer items-center justify-center bg-transparent text-zinc-300 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            type="button"
            aria-label="Download video"
            title="Download"
            @click="store.downloadProjectOutput(project.id)"
          >
            <Download :size="16" />
          </button>
          <button
            v-if="project.render.status === 'failed'"
            class="rounded-sm inline-flex size-7 cursor-pointer items-center justify-center bg-transparent text-zinc-300 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            type="button"
            aria-label="Retry render"
            title="Retry"
            @click="store.retryProject(project.id)"
          >
            <RotateCcw :size="16" />
          </button>
          <button
            class="ml-auto rounded-sm inline-flex size-7 cursor-pointer items-center justify-center bg-transparent text-red-300 hover:bg-red-500/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            aria-label="Delete project"
            title="Delete"
            :disabled="project.live"
            @click="startDelete(project.id)"
          >
            <Trash2 :size="16" />
          </button>
        </div>
      </article>
    </div>

    <div class="shrink-0 border-t border-zinc-800 p-3">
      <button
        class="btn btn-ghost w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
        type="button"
        :disabled="downloadableCount === 0 || downloadingAll"
        @click="downloadAll"
      >
        <Download :size="16" />
        Download all
      </button>
    </div>

    <Teleport to="body">
      <div
        v-if="infoTip && infoProject"
        class="pointer-events-none fixed z-50 w-56 rounded-md border border-zinc-800 bg-elevated p-2 text-xs text-zinc-200 shadow-[var(--shadow-overlay)]"
        :style="{
          left: `${infoTip.x}px`,
          top: `${infoTip.y}px`,
          transform: infoTip.above ? 'translateY(-100%)' : undefined,
        }"
      >
        <template v-if="infoTip.kind === 'source'">
          <p class="font-semibold" :class="uploadIconClass(infoProject.upload.state)">{{ uploadStatusLabel(infoProject) }}</p>
          <p v-if="infoProject.upload.fileName" class="mt-1 truncate text-zinc-100">{{ infoProject.upload.fileName }}</p>
          <p v-if="uploadMeta(infoProject)" class="mt-1 text-zinc-500">{{ uploadMeta(infoProject) }}</p>
          <p v-if="infoProject.upload.error" class="mt-1 text-red-300">{{ infoProject.upload.error }}</p>
        </template>
        <template v-else>
          <p class="font-semibold" :class="audioIconClass(infoProject.audio.state)">{{ audioStatusLabel(infoProject) }}</p>
          <p v-if="infoProject.audio.fileName" class="mt-1 truncate text-zinc-100">{{ infoProject.audio.fileName }}</p>
          <p v-if="audioMeta(infoProject)" class="mt-1 text-zinc-500">{{ audioMeta(infoProject) }}</p>
          <p v-if="infoProject.audio.error" class="mt-1 text-amber-200">{{ infoProject.audio.error }}</p>
        </template>
      </div>
    </Teleport>

    <AppDialog :open="renameId !== null" title="Rename project" @cancel="closeRename">
      <label class="block">
        <span class="section-label mb-1 block">Name</span>
        <input v-model="renameValue" class="field text-sm" type="text" maxlength="80" @keydown.enter.prevent="confirmRename" />
      </label>
      <template #actions>
        <button class="btn btn-ghost cursor-pointer" type="button" @click="closeRename">Cancel</button>
        <button class="btn btn-primary cursor-pointer" type="button" @click="confirmRename">Save</button>
      </template>
    </AppDialog>

    <AppDialog :open="deleteTarget !== null" title="Delete project" @cancel="closeDelete">
      <p class="text-sm text-zinc-300">
        Delete “{{ deleteTarget?.name }}”? The project is removed from this browser. A render that is still running is left alone.
      </p>
      <template #actions>
        <button class="btn btn-ghost cursor-pointer" type="button" @click="closeDelete">Cancel</button>
        <button class="btn btn-danger cursor-pointer" type="button" @click="confirmDelete">Delete</button>
      </template>
    </AppDialog>

    <AppDialog :open="deleteAllOpen" title="Delete all projects" @cancel="closeDeleteAll">
      <p class="text-sm text-zinc-300">
        Delete every screensaver project on this browser? Projects that are still rendering are kept.
      </p>
      <template #actions>
        <button class="btn btn-ghost cursor-pointer" type="button" @click="closeDeleteAll">Cancel</button>
        <button class="btn btn-danger cursor-pointer" type="button" @click="confirmDeleteAll">Delete all</button>
      </template>
    </AppDialog>

    <AppDialog :open="exportAllOpen" title="Export all projects" @cancel="closeExportAll">
      <p class="text-sm text-zinc-300">
        Submit selected projects to the existing render queue using each project’s saved settings.
      </p>

      <div
        v-if="exportAllEligible.length > 0"
        class="mt-3 flex items-center justify-between gap-2"
      >
        <label class="inline-flex cursor-pointer items-center gap-2.5 text-sm text-zinc-200">
          <AppCheckbox
            :checked="exportAllSelectAllState === 'checked'"
            :indeterminate="exportAllSelectAllState === 'indeterminate'"
            :disabled="exportingAll"
            aria-label="Select all eligible projects"
            @change="onExportAllSelectAllChange"
          />
          Select all
        </label>
        <p class="text-xs text-zinc-400">
          {{ exportAllSelectedCount }} of {{ exportAllEligible.length }} selected
          <span v-if="exportAllSkipped.length > 0"> · {{ exportAllSkipped.length }} skipped</span>
        </p>
      </div>
      <p v-else class="mt-3 text-sm text-zinc-400">
        No eligible projects
        <span v-if="exportAllSkipped.length > 0"> · {{ exportAllSkipped.length }} skipped</span>
      </p>

      <div
        v-if="exportAllEligible.length > 0"
        class="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md border border-zinc-800 bg-inset p-1"
      >
        <label
          v-for="item in exportAllEligible"
          :key="item.id"
          class="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-white/5"
          :class="
            exportAllSelectedIds.includes(item.id)
              ? 'bg-brand/10 ring-1 ring-inset ring-brand/35'
              : ''
          "
        >
          <AppCheckbox
            class="shrink-0"
            :checked="exportAllSelectedIds.includes(item.id)"
            :disabled="exportingAll"
            :aria-label="`Select ${item.name}`"
            @change="() => toggleExportAllProject(item.id)"
          />
          <span class="min-w-0 flex-1 truncate text-sm text-zinc-100" :title="item.name">{{ item.name }}</span>
        </label>
      </div>

      <ul v-if="exportAllSkipped.length > 0" class="mt-3 max-h-28 space-y-1 overflow-y-auto text-xs text-zinc-500">
        <li v-for="item in exportAllSkipped" :key="item.id">
          {{ item.name }} — {{ skipReasonLabel(item.reason) }}
        </li>
      </ul>
      <template #actions>
        <button class="btn btn-ghost cursor-pointer" type="button" :disabled="exportingAll" @click="closeExportAll">
          Cancel
        </button>
        <button
          class="btn btn-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
          type="button"
          :disabled="exportingAll || exportAllSelectedCount === 0"
          @click="confirmExportAll"
        >
          <FileOutput :size="16" aria-hidden="true" />
          {{
            exportingAll
              ? 'Submitting…'
              : exportAllSelectedCount === 1
                ? 'Export 1 project'
                : `Export ${exportAllSelectedCount} projects`
          }}
        </button>
      </template>
    </AppDialog>
  </section>
</template>
