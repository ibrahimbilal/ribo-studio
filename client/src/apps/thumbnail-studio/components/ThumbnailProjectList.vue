<script setup lang="ts">
import { Download, Info, Trash2 } from '@lucide/vue'
import { computed, ref } from 'vue'
import { useI18n } from '../../../i18n'
import { formatBytes } from '../../../lib/format'
import { audioFormatLabel } from '../../../lib/media'
import AppCheckbox from '../../../components/ui/AppCheckbox.vue'
import AppDialog from '../../../components/ui/AppDialog.vue'
import { bulkRenameNames } from '../../frame-screensaver/lib/bulkProjectNames'
import ThumbnailProjectContextMenu from './ThumbnailProjectContextMenu.vue'
import { useThumbnailStore } from '../stores/thumbnail'

const store = useThumbnailStore()
const { t } = useI18n()
const deleteTargetIds = ref<string[]>([])
const deleteAllOpen = ref(false)
const downloadingAll = ref(false)
const infoTip = ref<{ id: string; x: number; y: number; above: boolean } | null>(null)
const cardSelectedIds = ref<string[]>([])
const contextMenu = ref<{ projectId: string; x: number; y: number } | null>(null)
const renameTargetIds = ref<string[]>([])
const renameValue = ref('')

const actionTargetIds = computed(() => {
  if (cardSelectedIds.value.length > 0) return [...cardSelectedIds.value]
  const id = contextMenu.value?.projectId
  return id ? [id] : []
})
const pasteTargetIds = computed(() => actionTargetIds.value)
const contextCanDeselectProject = computed(() => {
  const id = contextMenu.value?.projectId
  return Boolean(id && cardSelectedIds.value.includes(id))
})
const contextShowDeselectAll = computed(() => cardSelectedIds.value.length > 0)
const contextCanDeselectAll = computed(() => cardSelectedIds.value.length > 1)

const deleteDialogSingle = computed(() =>
  deleteTargetIds.value.length === 1
    ? (store.projects.find((item) => item.id === deleteTargetIds.value[0]) ?? null)
    : null,
)
const downloadableCount = computed(
  () => store.projects.filter((item) => !item.downloadedUnchanged).length,
)
const infoProject = computed(() => store.projects.find((item) => item.id === infoTip.value?.id) ?? null)

type UploadState = 'uploading' | 'processing' | 'ready' | 'error'

function statusClass(state: UploadState): string {
  switch (state) {
    case 'uploading':
    case 'processing':
      return 'bg-brand/15 text-brand'
    case 'error':
      return 'bg-red-400/15 text-red-200'
    default:
      return 'bg-emerald-400/15 text-emerald-200'
  }
}

function statusLabel(state: UploadState): string {
  switch (state) {
    case 'uploading':
      return t('thumbnail.status.uploading')
    case 'processing':
      return t('thumbnail.status.processing')
    case 'error':
      return t('thumbnail.status.error')
    default:
      return t('thumbnail.status.ready')
  }
}

function uploadIconClass(state: UploadState): string {
  if (state === 'uploading' || state === 'processing') return 'text-brand'
  if (state === 'error') return 'text-red-300'
  return 'text-emerald-300'
}

function uploadStatusLabel(project: (typeof store.projects)[number]): string {
  if (project.upload.state === 'uploading') return t('thumbnail.projects.uploadUploading')
  if (project.upload.state === 'processing') return t('thumbnail.projects.uploadReading')
  if (project.upload.state === 'error') return t('thumbnail.projects.uploadFailed')
  return t('thumbnail.projects.uploadDone')
}

function uploadMeta(project: (typeof store.projects)[number]): string {
  const parts: string[] = []
  if (project.upload.fileName) parts.push(audioFormatLabel(project.upload.fileName))
  if (project.upload.fileSize != null && project.upload.fileSize > 0) parts.push(formatBytes(project.upload.fileSize))
  if (project.upload.width > 0 && project.upload.height > 0) parts.push(`${project.upload.width}×${project.upload.height}`)
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

function showUploadInfo(event: MouseEvent | FocusEvent, id: string) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const above = rect.bottom + 132 > window.innerHeight
  infoTip.value = {
    id,
    x: Math.max(8, Math.min(rect.left, window.innerWidth - 232)),
    y: above ? rect.top - 8 : rect.bottom + 8,
    above,
  }
}

function hideUploadInfo() {
  infoTip.value = null
}

function onCardCheckboxChange(id: string, checked: boolean) {
  cardSelectedIds.value = checked
    ? [...new Set([...cardSelectedIds.value, id])]
    : cardSelectedIds.value.filter((item) => item !== id)
}

function onProjectContextMenu(event: MouseEvent, projectId: string) {
  event.preventDefault()
  hideUploadInfo()
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

function contextRename() {
  openRenameDialog(actionTargetIds.value)
}

async function contextDuplicate() {
  for (const id of actionTargetIds.value) {
    await store.duplicateProject(id)
  }
  cardSelectedIds.value = []
}

async function contextDownload() {
  for (const id of actionTargetIds.value) {
    await store.downloadProject(id)
  }
}

function contextDelete() {
  openDeleteDialog(actionTargetIds.value)
}

function contextDeselectProject() {
  const id = contextMenu.value?.projectId
  if (!id) return
  cardSelectedIds.value = cardSelectedIds.value.filter((item) => item !== id)
}

function contextDeselectAll() {
  cardSelectedIds.value = []
}

function openDeleteDialog(ids: string[]) {
  deleteTargetIds.value = [...ids]
}

function closeDelete() {
  deleteTargetIds.value = []
}

async function confirmDelete() {
  const ids = deleteTargetIds.value
  if (!ids.length) return
  deleteTargetIds.value = []
  for (const id of ids) await store.deleteProject(id)
  cardSelectedIds.value = cardSelectedIds.value.filter((id) => !ids.includes(id))
}

function closeDeleteAll() {
  deleteAllOpen.value = false
}

async function confirmDeleteAll() {
  deleteAllOpen.value = false
  await store.deleteAllProjects()
  cardSelectedIds.value = []
}

async function downloadAll() {
  if (downloadingAll.value || store.exporting) return
  downloadingAll.value = true
  try {
    await store.downloadAllProjects()
  } finally {
    downloadingAll.value = false
  }
}
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col">
    <div class="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
      <h3 class="section-label">{{ t('thumbnail.projects.section') }}</h3>
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

    <div class="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
      <p v-if="store.projects.length === 0" class="px-2 py-8 text-center text-sm text-zinc-500">
        {{ t('thumbnail.projects.empty') }}
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
            :aria-label="t('thumbnail.projects.selectAria', { name: project.name })"
            @change="(checked) => onCardCheckboxChange(project.id, checked)"
          />
        </div>
        <div class="flex gap-2">
          <div class="h-14 w-24 shrink-0 overflow-hidden rounded bg-zinc-900">
            <img v-if="project.previewUrl" :src="project.previewUrl" alt="" class="h-full w-full object-cover" />
            <span v-else class="flex h-full items-center justify-center text-[10px] text-zinc-600">{{ t('thumbnail.projects.noImage') }}</span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-start gap-2">
              <p class="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-100" :title="project.name">{{ project.name }}</p>
              <span class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" :class="statusClass(project.upload.state)">
                {{ statusLabel(project.upload.state) }}
              </span>
            </div>
            <p class="mt-0.5 truncate text-xs text-zinc-500">{{ project.exportLabel }}</p>
            <p class="mt-0.5 text-xs text-zinc-500">{{ formatUpdated(project.updatedAt) }}</p>
          </div>
        </div>

        <div class="mt-2 flex items-center" @click.stop>
          <button
            class="icon-action"
            :class="uploadIconClass(project.upload.state)"
            type="button"
            :aria-label="t('thumbnail.projects.ariaUploadDetails')"
            @mouseenter="showUploadInfo($event, project.id)"
            @mouseleave="hideUploadInfo"
            @focus="showUploadInfo($event, project.id)"
            @blur="hideUploadInfo"
          >
            <Info :size="16" />
          </button>
          <button
            class="icon-action"
            type="button"
            :aria-label="t('thumbnail.projects.ariaDownload')"
            :title="t('common.download')"
            @click="store.downloadProject(project.id)"
          >
            <Download :size="16" />
          </button>
          <button
            class="icon-action icon-action--danger ms-auto"
            type="button"
            :aria-label="t('thumbnail.projects.ariaDelete')"
            :title="t('common.delete')"
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
        :disabled="downloadableCount === 0 || downloadingAll || store.exporting"
        @click="downloadAll"
      >
        <Download :size="16" />
        {{ t('thumbnail.projects.downloadAll') }}
      </button>
    </div>

    <ThumbnailProjectContextMenu
      :open="contextMenu !== null"
      :x="contextMenu?.x ?? 0"
      :y="contextMenu?.y ?? 0"
      :selection-count="actionTargetIds.length"
      :can-paste="store.hasCopiedProjectSettings && pasteTargetIds.length > 0"
      :can-deselect-project="contextCanDeselectProject"
      :show-deselect-all="contextShowDeselectAll"
      :can-deselect-all="contextCanDeselectAll"
      @close="closeContextMenu"
      @copy-settings="contextCopySettings"
      @paste-settings="contextPasteSettings"
      @duplicate="contextDuplicate"
      @rename="contextRename"
      @download="contextDownload"
      @delete="contextDelete"
      @deselect-project="contextDeselectProject"
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
        <p class="font-semibold" :class="uploadIconClass(infoProject.upload.state)">{{ uploadStatusLabel(infoProject) }}</p>
        <p v-if="infoProject.upload.fileName" class="mt-1 truncate text-zinc-100">{{ infoProject.upload.fileName }}</p>
        <p v-if="uploadMeta(infoProject)" class="mt-1 text-zinc-500">{{ uploadMeta(infoProject) }}</p>
        <p v-if="infoProject.upload.error" class="mt-1 text-red-300">{{ infoProject.upload.error }}</p>
      </div>
    </Teleport>

    <AppDialog
      :open="renameTargetIds.length > 0"
      :title="renameTargetIds.length > 1 ? t('thumbnail.projects.renameTitleMany') : t('thumbnail.projects.renameTitle')"
      @cancel="closeRename"
    >
      <label class="block">
        <span class="section-label mb-1 block">{{ t('thumbnail.projects.name') }}</span>
        <input v-model="renameValue" class="field text-sm" type="text" maxlength="80" @keydown.enter.prevent="confirmRename" />
      </label>
      <p v-if="renameTargetIds.length > 1" class="mt-2 text-xs text-zinc-400">
        {{ t('thumbnail.projects.renameBulkHint', { example: bulkRenameNames(renameValue || 'Name', 2)[1] ?? 'Name (2)' }) }}
      </p>
      <template #actions>
        <button class="btn btn-ghost cursor-pointer" type="button" @click="closeRename">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary cursor-pointer" type="button" @click="confirmRename">{{ t('common.save') }}</button>
      </template>
    </AppDialog>

    <AppDialog
      :open="deleteTargetIds.length > 0"
      :title="deleteTargetIds.length > 1 ? t('thumbnail.projects.deleteTitleMany') : t('thumbnail.projects.deleteTitle')"
      @cancel="closeDelete"
    >
      <p class="text-sm text-zinc-300">
        <template v-if="deleteDialogSingle">
          {{ t('thumbnail.projects.deleteBody', { name: deleteDialogSingle.name }) }}
        </template>
        <template v-else>
          {{ t('thumbnail.projects.deleteBodyMany', { n: deleteTargetIds.length }) }}
        </template>
      </p>
      <template #actions>
        <button class="btn btn-ghost cursor-pointer" type="button" @click="closeDelete">{{ t('common.cancel') }}</button>
        <button class="btn btn-danger cursor-pointer" type="button" @click="confirmDelete">{{ t('common.delete') }}</button>
      </template>
    </AppDialog>

    <AppDialog :open="deleteAllOpen" :title="t('thumbnail.projects.deleteAllTitle')" @cancel="closeDeleteAll">
      <p class="text-sm text-zinc-300">{{ t('thumbnail.projects.deleteAllBody') }}</p>
      <template #actions>
        <button class="btn btn-ghost cursor-pointer" type="button" @click="closeDeleteAll">{{ t('common.cancel') }}</button>
        <button class="btn btn-danger cursor-pointer" type="button" @click="confirmDeleteAll">{{ t('common.deleteAll') }}</button>
      </template>
    </AppDialog>
  </section>
</template>