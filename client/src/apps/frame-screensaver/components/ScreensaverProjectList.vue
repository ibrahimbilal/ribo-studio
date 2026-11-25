<script setup lang="ts">
import { MAX_DURATION_SECONDS, MIN_DURATION_SECONDS } from '@shared/screensaver'
import { Download, FileOutput, FolderOutput, Info, Music, RotateCcw, Trash2 } from '@lucide/vue'
import { computed, ref } from 'vue'
import { formatBytes, formatClock } from '../../../lib/format'
import { formatDurationLabelI18n } from '../../../lib/formatDurationLabelI18n'
import { audioFormatLabel } from '../../../lib/media'
import AppCheckbox from '../../../components/ui/AppCheckbox.vue'
import AppDialog from '../../../components/ui/AppDialog.vue'
import {
  deselectAllProjectIds,
  selectAllCheckboxState,
  selectAllProjectIds,
  toggleProjectSelection,
} from '../../../lib/multiSelect'
import {
  EXPORT_ALL_SKIP_I18N,
  MAX_SCREENSAVER_EXPORT_JOBS,
  type ExportAllDecision,
  type ExportAllSkipReason,
} from '../lib/exportAllPlan'
import type { ScreensaverProjectStatus } from '../lib/screensaverProjectModel'
import { useI18n } from '../../../i18n'
import { S } from '../lib/screensaverI18n'
import { bulkRenameNames } from '../lib/bulkProjectNames'
import { createThumbnailFromScreensaver } from '../lib/createThumbnail'
import { sendScreensaverImageToImageMotion } from '../lib/sendToImageMotion'
import { useScreensaverStore } from '../stores/screensaver'
import ScreensaverProjectContextMenu from './ScreensaverProjectContextMenu.vue'

const store = useScreensaverStore()
const { t } = useI18n()
const renameTargetIds = ref<string[]>([])
const renameValue = ref('')
const deleteTargetIds = ref<string[]>([])
const deleteAllOpen = ref(false)
const downloadingAll = ref(false)
const exportAllOpen = ref(false)
const exportingAll = ref(false)
const exportAllEligible = ref<ExportAllDecision[]>([])
const exportAllSkipped = ref<Extract<ExportAllDecision, { kind: 'skipped' }>[]>([])
const exportAllSelectedIds = ref<string[]>([])
const infoTip = ref<{ id: string; kind: 'source' | 'audio'; x: number; y: number; above: boolean } | null>(null)
const cardSelectedIds = ref<string[]>([])
const contextMenu = ref<{ projectId: string; x: number; y: number } | null>(null)

const actionTargetIds = computed(() => {
  if (cardSelectedIds.value.length > 0) return [...cardSelectedIds.value]
  const id = contextMenu.value?.projectId
  return id ? [id] : []
})
const pasteTargetIds = computed(() => actionTargetIds.value)
const imageHandoffTargetIds = computed(() =>
  actionTargetIds.value.filter((id) => {
    const project = store.projects.find((item) => item.id === id)
    return project ? canImageHandoff(project) : false
  }),
)
const contextMenuImageHandoff = computed(() => imageHandoffTargetIds.value.length > 0)
const contextCanDeselectProject = computed(() => {
  const id = contextMenu.value?.projectId
  return Boolean(id && cardSelectedIds.value.includes(id))
})
const contextShowSelectAll = computed(() => store.projects.length > 1 && cardSelectedIds.value.length > 0)
const contextAllItemsSelected = computed(
  () =>
    store.projects.length > 0 &&
    cardSelectedIds.value.length === store.projects.length,
)

const deleteDialogSingle = computed(() =>
  deleteTargetIds.value.length === 1
    ? (store.projects.find((item) => item.id === deleteTargetIds.value[0]) ?? null)
    : null,
)
const deleteDialogDeletableCount = computed(
  () => deleteTargetIds.value.filter((id) => !store.projects.find((item) => item.id === id)?.live).length,
)
const downloadableCount = computed(
  () =>
    store.projects.filter(
      (item) =>
        item.render.outputUrl &&
        !item.outputMissing &&
        item.render.status === 'completed' &&
        !item.downloadedUnchanged,
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

function projectStatusLabel(status: ScreensaverProjectStatus, queuePosition?: number | null): string {
  if (status === 'queued' && queuePosition != null && queuePosition > 0) {
    return t(S('status.queuedPosition'), { n: queuePosition })
  }
  return t(S(`status.${status}`))
}

function uploadStatusLabel(project: (typeof store.projects)[number]): string {
  if (project.upload.state === 'uploading') {
    return t(S('projects.upload.uploading'), { percent: Math.round(project.upload.progress * 100) })
  }
  if (project.upload.state === 'error') return t(S('projects.upload.failed'))
  return t(S('projects.upload.uploaded'))
}

function audioStatusLabel(project: (typeof store.projects)[number]): string {
  const audio = project.audio
  if (audio.state === 'uploading') {
    return t(S('projects.audio.uploading'), { percent: Math.round(audio.progress * 100) })
  }
  if (audio.state === 'validating') return t(S('projects.audio.validating'))
  if (audio.state === 'missing') return t(S('projects.audio.missing'))
  if (audio.state === 'error') return t(S('projects.audio.failed'))
  if (audio.state === 'available') return t(S('projects.audio.ready'))
  return t(S('projects.audio.background'))
}

function mediaKindLabel(kind: 'image' | 'video' | null): string {
  if (kind === 'image') return t(S('mediaKind.oneImage'))
  if (kind === 'video') return t(S('mediaKind.oneVideo'))
  return t(S('mediaKind.none'))
}

function skipReasonText(reason: ExportAllSkipReason): string {
  const path = EXPORT_ALL_SKIP_I18N[reason]
  if (reason === 'invalid-duration') {
    return t(S(path), {
      min: formatDurationLabelI18n(MIN_DURATION_SECONDS, t),
      max: formatDurationLabelI18n(MAX_DURATION_SECONDS, t),
    })
  }
  if (reason === 'queue-full') {
    return t(S(path), { max: MAX_SCREENSAVER_EXPORT_JOBS })
  }
  return t(S(path))
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

function openRenameDialog(ids: string[]) {
  if (!ids.length) return
  renameTargetIds.value = [...ids]
  if (ids.length === 1) {
    const project = store.projects.find((item) => item.id === ids[0])
    renameValue.value = project?.name ?? ''
  } else {
    renameValue.value = ''
  }
}

function closeRename() {
  renameTargetIds.value = []
}

async function confirmRename() {
  const ids = renameTargetIds.value
  if (!ids.length) return
  const names = bulkRenameNames(renameValue.value, ids.length)
  if (!names.length) return
  for (let index = 0; index < ids.length; index += 1) {
    await store.renameProject(ids[index]!, names[index]!)
  }
  renameTargetIds.value = []
}

function openDeleteDialog(ids: string[]) {
  deleteTargetIds.value = [...ids]
}

function closeDelete() {
  deleteTargetIds.value = []
}

async function confirmDelete() {
  const ids = deleteTargetIds.value.filter((id) => !store.projects.find((item) => item.id === id)?.live)
  if (!ids.length) {
    deleteTargetIds.value = []
    return
  }
  for (const id of ids) {
    await store.deleteProject(id)
  }
  cardSelectedIds.value = cardSelectedIds.value.filter((id) => !ids.includes(id))
  deleteTargetIds.value = []
}

function pruneSelection() {
  const existing = new Set(store.projects.map((item) => item.id))
  cardSelectedIds.value = cardSelectedIds.value.filter((id) => existing.has(id))
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
  await createThumbnailFromScreensaver(id)
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

function onCardCheckboxChange(projectId: string, checked: boolean) {
  cardSelectedIds.value = checked
    ? [...new Set([...cardSelectedIds.value, projectId])]
    : cardSelectedIds.value.filter((id) => id !== projectId)
}

function onProjectContextMenu(event: MouseEvent, projectId: string) {
  event.preventDefault()
  hideInfoTip()
  if (!cardSelectedIds.value.includes(projectId)) {
    cardSelectedIds.value = [projectId]
  }
  contextMenu.value = { projectId, x: event.clientX, y: event.clientY }
}

function closeContextMenu() {
  contextMenu.value = null
}

async function contextCopySettings() {
  const id = contextMenu.value?.projectId
  if (!id) return
  await store.copyProjectSettings(id)
}

async function contextPasteSettings() {
  if (pasteTargetIds.value.length === 0) return
  await store.pasteProjectSettings(pasteTargetIds.value)
}

function contextRename() {
  openRenameDialog(actionTargetIds.value)
}

async function contextDuplicate() {
  const ids = actionTargetIds.value
  if (!ids.length) return
  let lastCopyId: string | null = null
  let copied = 0
  for (const id of ids) {
    const copyId = await store.duplicateProject(id, { openAfter: false })
    if (copyId) {
      lastCopyId = copyId
      copied += 1
    }
  }
  if (copied === 1 && lastCopyId) await store.openProject(lastCopyId)
  pruneSelection()
}

async function contextCreateThumbnail() {
  for (const id of imageHandoffTargetIds.value) {
    await createThumbnailFor(id)
  }
}

async function contextSendToImageMotion() {
  for (const id of imageHandoffTargetIds.value) {
    await sendToImageMotionFor(id)
  }
}

function contextDeselectProject() {
  const id = contextMenu.value?.projectId
  if (!id) return
  cardSelectedIds.value = cardSelectedIds.value.filter((item) => item !== id)
}

function contextSelectAll() {
  cardSelectedIds.value = selectAllProjectIds(store.projects.map((item) => item.id))
}

function contextDeselectAll() {
  cardSelectedIds.value = deselectAllProjectIds()
}
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col">
    <div class="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
      <h3 class="section-label">{{ t(S('projects.title')) }}</h3>
      <div class="flex items-center gap-1">
        <button
          class="btn btn-ghost cursor-pointer px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
          type="button"
          :disabled="approxExportableCount === 0 || exportingAll"
          :title="exportingAll ? t(S('projects.submitting')) : t(S('projects.exportAllTitle'))"
          @click="openExportAll"
        >
          <FolderOutput  :size="14" />
          {{ t(S('projects.exportAll')) }}
        </button>
        <button
          class="btn btn-ghost cursor-pointer px-2 py-1 text-xs text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
          type="button"
          :disabled="store.projects.length === 0"
          @click="deleteAllOpen = true"
        >
          <Trash2 :size="14" />
          {{ t('common.deleteAll') }}
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
      <p v-if="store.projects.length === 0" class="px-2 py-8 text-center text-sm text-zinc-500">
        {{ t(S('projects.empty')) }}
      </p>

      <article
        v-for="project in store.projects"
        :key="project.id"
        class="relative cursor-pointer rounded-lg border bg-inset p-2 transition-opacity"
        :class="[
          project.id === store.projectId ? 'border-zinc-200' : 'border-zinc-800',
          project.downloadedUnchanged ? 'opacity-50' : 'opacity-100',
          cardSelectedIds.includes(project.id) ? 'ring-1 ring-inset ring-brand/40' : '',
        ]"
        :data-project-id="project.id"
        :aria-current="project.id === store.projectId ? 'true' : undefined"
        @click="store.openProject(project.id)"
        @contextmenu="onProjectContextMenu($event, project.id)"
      >
        <div class="absolute start-2 top-2 z-10" @click.stop>
          <AppCheckbox
            :checked="cardSelectedIds.includes(project.id)"
            :aria-label="t(S('projects.selectAria'), { name: project.name })"
            @change="(checked) => onCardCheckboxChange(project.id, checked)"
          />
        </div>
        <div class="flex gap-2">
          <div class="h-14 w-24 shrink-0 overflow-hidden rounded bg-zinc-900">
            <img v-if="project.thumbnail" :src="project.thumbnail" alt="" class="h-full w-full object-cover" />
            <span v-else class="flex h-full items-center justify-center text-[10px] text-zinc-600">{{ t(S('projects.noImage')) }}</span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-start gap-2">
              <p class="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-100" :title="project.name">{{ project.name }}</p>
              <span class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" :class="statusClass(project.render.status)">
                {{ projectStatusLabel(project.render.status, project.queuePosition) }}
              </span>
            </div>
            <p class="mt-0.5 truncate text-xs text-zinc-500">
              {{ mediaKindLabel(project.mediaKind) }} · {{ formatDurationLabelI18n(project.durationSeconds, t) }} · {{ project.outputWidth }}×{{ project.outputHeight }}
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

        <p v-if="project.sourceMissing" class="mt-2 text-xs text-amber-200">{{ t(S('projects.sourceMissing')) }}</p>
        <p v-if="project.frameMissing" class="mt-1 text-xs text-amber-200">{{ t(S('projects.frameMissing')) }}</p>
        <p v-if="project.outputMissing" class="mt-1 text-xs text-amber-200">{{ t(S('projects.outputMissing')) }}</p>
        <p v-if="project.render.status === 'failed' && project.render.error" class="mt-1 text-xs text-red-300">{{ project.render.error }}</p>

        <div class="mt-2 flex items-center" @click.stop>
          <button
            class="icon-action"
            :class="uploadIconClass(project.upload.state)"
            type="button"
            :aria-label="t('common.uploadDetails')"
            @mouseenter="showInfoTip($event, project.id, 'source')"
            @mouseleave="hideInfoTip"
            @focus="showInfoTip($event, project.id, 'source')"
            @blur="hideInfoTip"
          >
            <Info :size="16" />
          </button>
          <button
            v-if="project.audio.present"
            class="icon-action"
            :class="audioIconClass(project.audio.state)"
            type="button"
            :aria-label="t(S('projects.openSound'))"
            :title="t(S('projects.soundSettings'))"
            @mouseenter="showInfoTip($event, project.id, 'audio')"
            @mouseleave="hideInfoTip"
            @focus="showInfoTip($event, project.id, 'audio')"
            @blur="hideInfoTip"
            @click="openSoundSettingsFor(project.id)"
          >
            <Music :size="16" />
          </button>
          <button
            v-if="project.render.outputUrl && !project.outputMissing"
            class="icon-action"
            type="button"
            :aria-label="t(S('projects.downloadAria'))"
            :title="t('common.download')"
            @click="store.downloadProjectOutput(project.id)"
          >
            <Download :size="16" />
          </button>
          <button
            v-if="project.render.status === 'failed'"
            class="icon-action"
            type="button"
            :aria-label="t(S('projects.retryAria'))"
            :title="t('common.retry')"
            @click="store.retryProject(project.id)"
          >
            <RotateCcw :size="16" />
          </button>
          <button
            class="icon-action icon-action--danger ms-auto"
            type="button"
            :aria-label="t(S('projects.deleteAria'))"
            :title="t('common.delete')"
            :disabled="project.live"
            @click="openDeleteDialog([project.id])"
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
        {{ t(S('projects.downloadAll')) }}
      </button>
    </div>

    <ScreensaverProjectContextMenu
      :open="contextMenu !== null"
      :x="contextMenu?.x ?? 0"
      :y="contextMenu?.y ?? 0"
      :selection-count="actionTargetIds.length"
      :image-handoff-count="imageHandoffTargetIds.length"
      :can-paste="store.hasCopiedProjectSettings && pasteTargetIds.length > 0"
      :can-image-handoff="contextMenuImageHandoff"
      :can-deselect-project="contextCanDeselectProject"
      :show-select-all="contextShowSelectAll"
      :all-items-selected="contextAllItemsSelected"
      @close="closeContextMenu"
      @copy-settings="contextCopySettings"
      @paste-settings="contextPasteSettings"
      @duplicate="contextDuplicate"
      @create-thumbnail="contextCreateThumbnail"
      @send-to-image-motion="contextSendToImageMotion"
      @rename="contextRename"
      @deselect-project="contextDeselectProject"
      @select-all="contextSelectAll"
      @deselect-all="contextDeselectAll"
    />

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

    <AppDialog
      :open="renameTargetIds.length > 0"
      :title="renameTargetIds.length > 1 ? t(S('dialogs.rename.titleMany')) : t(S('dialogs.rename.title'))"
      @cancel="closeRename"
    >
      <label class="block">
        <span class="section-label mb-1 block">{{ t(S('dialogs.rename.name')) }}</span>
        <input v-model="renameValue" class="field text-sm" type="text" maxlength="80" @keydown.enter.prevent="confirmRename" />
      </label>
      <p v-if="renameTargetIds.length > 1" class="mt-2 text-xs text-zinc-400">
        {{ t(S('dialogs.rename.bulkHint'), { example: bulkRenameNames(renameValue || 'Name', 2)[1] ?? 'Name (2)' }) }}
      </p>
      <template #actions>
        <button class="btn btn-ghost cursor-pointer" type="button" @click="closeRename">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary cursor-pointer" type="button" @click="confirmRename">{{ t('common.save') }}</button>
      </template>
    </AppDialog>

    <AppDialog
      :open="deleteTargetIds.length > 0"
      :title="deleteTargetIds.length > 1 ? t(S('dialogs.delete.titleMany')) : t(S('dialogs.delete.title'))"
      @cancel="closeDelete"
    >
      <p class="text-sm text-zinc-300">
        <template v-if="deleteDialogSingle">
          {{ t(S('dialogs.delete.body'), { name: deleteDialogSingle.name }) }}
        </template>
        <template v-else>
          {{ t(S('dialogs.delete.bodyMany'), { n: deleteDialogDeletableCount }) }}
        </template>
      </p>
      <template #actions>
        <button class="btn btn-ghost cursor-pointer" type="button" @click="closeDelete">{{ t('common.cancel') }}</button>
        <button class="btn btn-danger cursor-pointer" type="button" @click="confirmDelete">{{ t('common.delete') }}</button>
      </template>
    </AppDialog>

    <AppDialog :open="deleteAllOpen" :title="t(S('dialogs.deleteAll.title'))" @cancel="closeDeleteAll">
      <p class="text-sm text-zinc-300">
        {{ t(S('dialogs.deleteAll.body')) }}
      </p>
      <template #actions>
        <button class="btn btn-ghost cursor-pointer" type="button" @click="closeDeleteAll">{{ t('common.cancel') }}</button>
        <button class="btn btn-danger cursor-pointer" type="button" @click="confirmDeleteAll">{{ t('common.deleteAll') }}</button>
      </template>
    </AppDialog>

    <AppDialog :open="exportAllOpen" :title="t(S('dialogs.exportAll.title'))" @cancel="closeExportAll">
      <p class="text-sm text-zinc-300">
        {{ t(S('dialogs.exportAll.intro')) }}
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
            :aria-label="t(S('dialogs.exportAll.selectAllAria'))"
            @change="onExportAllSelectAllChange"
          />
          {{ t(S('dialogs.exportAll.selectAll')) }}
        </label>
        <p class="text-xs text-zinc-400">
          {{ t(S('dialogs.exportAll.selected'), { selected: exportAllSelectedCount, total: exportAllEligible.length }) }}
          <span v-if="exportAllSkipped.length > 0">
            {{ t(S('dialogs.exportAll.skippedSuffix'), { n: exportAllSkipped.length }) }}
          </span>
        </p>
      </div>
      <p v-else class="mt-3 text-sm text-zinc-400">
        {{ t(S('dialogs.exportAll.noEligible')) }}
        <span v-if="exportAllSkipped.length > 0">
          {{ t(S('dialogs.exportAll.skippedSuffixShort'), { n: exportAllSkipped.length }) }}
        </span>
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
            :aria-label="t(S('dialogs.exportAll.selectProject'), { name: item.name })"
            @change="() => toggleExportAllProject(item.id)"
          />
          <span class="min-w-0 flex-1 truncate text-sm text-zinc-100" :title="item.name">{{ item.name }}</span>
        </label>
      </div>

      <ul v-if="exportAllSkipped.length > 0" class="mt-3 max-h-28 space-y-1 overflow-y-auto text-xs text-zinc-500">
        <li v-for="item in exportAllSkipped" :key="item.id">
          {{ t(S('dialogs.exportAll.skippedLine'), { name: item.name, reason: skipReasonText(item.reason) }) }}
        </li>
      </ul>
      <template #actions>
        <button class="btn btn-ghost cursor-pointer" type="button" :disabled="exportingAll" @click="closeExportAll">
          {{ t('common.cancel') }}
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
              ? t(S('dialogs.exportAll.submitting'))
              : exportAllSelectedCount === 1
                ? t(S('dialogs.exportAll.exportOne'))
                : t(S('dialogs.exportAll.exportMany'), { n: exportAllSelectedCount })
          }}
        </button>
      </template>
    </AppDialog>
  </section>
</template>
