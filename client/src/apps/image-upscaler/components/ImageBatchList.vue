<script setup lang="ts">
import { formatBytes } from '@shared/imageUpscaler'
import { Download, Info, Trash2 } from '@lucide/vue'
import { computed, ref } from 'vue'
import AppCheckbox from '../../../components/ui/AppCheckbox.vue'
import AppDialog from '../../../components/ui/AppDialog.vue'
import { useI18n } from '../../../i18n'
import { audioFormatLabel } from '../../../lib/media'
import { bulkRenameNames } from '../../frame-screensaver/lib/bulkProjectNames'
import { useImageUpscalerStore } from '../stores/imageUpscaler'
import type { LocalUpscaleItem } from '../types'
import ImageBatchContextMenu from './ImageBatchContextMenu.vue'

const store = useImageUpscalerStore()
const { t } = useI18n()

function selectionIds(): string[] {
  return [...actionTargetIds.value]
}
const deleteAllOpen = ref(false)
const removeTargetIds = ref<string[]>([])
const infoTip = ref<{ id: string; x: number; y: number; above: boolean } | null>(null)
const cardSelectedIds = ref<string[]>([])
const contextMenu = ref<{ itemId: string; x: number; y: number } | null>(null)
const renameTargetIds = ref<string[]>([])
const renameValue = ref('')

const actionTargetIds = computed(() => {
  if (cardSelectedIds.value.length > 0) return [...cardSelectedIds.value]
  const id = contextMenu.value?.itemId
  return id ? [id] : []
})
const contextCanDeselectItem = computed(() => {
  const id = contextMenu.value?.itemId
  return Boolean(id && cardSelectedIds.value.includes(id))
})
const contextShowDeselectAll = computed(() => cardSelectedIds.value.length > 0)
const contextCanDeselectAll = computed(() => cardSelectedIds.value.length > 1)
const contextCanDownload = computed(() =>
  actionTargetIds.value.every((id) => {
    const item = store.items.find((entry) => entry.localId === id)
    return item?.status === 'completed'
  }),
)
const contextCanSendToScreensaver = computed(
  () => actionTargetIds.value.length === 1 && contextCanDownload.value,
)
const infoItem = computed(() => store.items.find((item) => item.localId === infoTip.value?.id) ?? null)

const removeDialogSingle = computed(() =>
  removeTargetIds.value.length === 1
    ? (store.items.find((item) => item.localId === removeTargetIds.value[0]) ?? null)
    : null,
)

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    ready: t('upscaler.batch.statusReady'),
    pending: t('upscaler.batch.statusPending'),
    processing: t('upscaler.batch.statusProcessing'),
    completed: t('upscaler.batch.statusCompleted'),
    failed: t('upscaler.batch.statusFailed'),
    cancelled: t('upscaler.batch.statusCancelled'),
  }
  return map[status] ?? status
}

function statusClass(status: string): string {
  switch (status) {
    case 'processing':
      return 'bg-brand/15 text-brand'
    case 'pending':
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

type SourceState = 'ready' | 'processing' | 'error'

function sourceState(item: LocalUpscaleItem): SourceState {
  if (item.status === 'failed') return 'error'
  if (item.status === 'pending' || item.status === 'processing') return 'processing'
  return 'ready'
}

function sourceIconClass(state: SourceState): string {
  if (state === 'processing') return 'text-brand'
  if (state === 'error') return 'text-red-300'
  return 'text-emerald-300'
}

function sourceStatusLabel(item: LocalUpscaleItem): string {
  const state = sourceState(item)
  if (state === 'processing') return t('upscaler.batch.sourceProcessing')
  if (state === 'error') return t('upscaler.batch.sourceFailed')
  return t('upscaler.batch.sourceReady')
}

function sourceMeta(item: LocalUpscaleItem): string {
  const parts: string[] = []
  parts.push(audioFormatLabel(item.name))
  if (item.bytes > 0) parts.push(formatBytes(item.bytes))
  if (item.width > 0 && item.height > 0) parts.push(`${item.width}×${item.height}`)
  return parts.join(' · ')
}

function downloaded(item: { status: string; downloadedRevision: number | null; outputRevision: number | null }): boolean {
  return item.status === 'completed' && item.downloadedRevision != null && item.downloadedRevision === item.outputRevision
}

function showSourceInfo(event: MouseEvent | FocusEvent, id: string) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const above = rect.bottom + 148 > window.innerHeight
  infoTip.value = {
    id,
    x: Math.max(8, Math.min(rect.left, window.innerWidth - 232)),
    y: above ? rect.top - 8 : rect.bottom + 8,
    above,
  }
}

function hideSourceInfo() {
  infoTip.value = null
}

function onCardCheckboxChange(id: string, checked: boolean) {
  cardSelectedIds.value = checked
    ? [...new Set([...cardSelectedIds.value, id])]
    : cardSelectedIds.value.filter((item) => item !== id)
}

function onItemContextMenu(event: MouseEvent, itemId: string) {
  event.preventDefault()
  hideSourceInfo()
  if (!cardSelectedIds.value.includes(itemId)) {
    cardSelectedIds.value = [itemId]
  }
  contextMenu.value = { itemId, x: event.clientX, y: event.clientY }
}

function closeContextMenu() {
  contextMenu.value = null
}

function contextCopySettings() {
  store.copyUpscaleSettings()
}

function contextPasteSettings() {
  store.pasteUpscaleSettings()
}

function openRenameDialog(ids: string[]) {
  if (!ids.length) return
  renameTargetIds.value = [...ids]
  if (ids.length === 1) {
    const item = store.items.find((entry) => entry.localId === ids[0])
    renameValue.value = item?.name ?? ''
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
    store.renameItem(ids[index]!, names[index]!)
  }
  renameTargetIds.value = []
}

function contextRename() {
  const ids = selectionIds()
  if (!ids.length) return
  openRenameDialog(ids)
}

async function contextDuplicate() {
  const ids = selectionIds()
  if (!ids.length) return
  for (const id of ids) await store.duplicateItem(id)
  cardSelectedIds.value = []
}

function contextDownload() {
  for (const id of selectionIds()) store.downloadItem(id)
}

function contextSendToScreensaver() {
  const id = selectionIds()[0]
  if (!id) return
  void store.requestSend(id)
}

function contextRemove() {
  const ids = selectionIds()
  if (!ids.length) return
  openRemoveDialog(ids)
}

function contextDeselectItem() {
  const id = contextMenu.value?.itemId
  if (!id) return
  cardSelectedIds.value = cardSelectedIds.value.filter((item) => item !== id)
}

function contextDeselectAll() {
  cardSelectedIds.value = []
}

function openRemoveDialog(ids: string[]) {
  removeTargetIds.value = [...ids]
}

function closeRemove() {
  removeTargetIds.value = []
}

function confirmRemove() {
  const ids = removeTargetIds.value
  if (!ids.length) return
  removeTargetIds.value = []
  for (const id of ids) store.removeItem(id)
  cardSelectedIds.value = cardSelectedIds.value.filter((id) => !ids.includes(id))
}

function closeDeleteAll() {
  deleteAllOpen.value = false
}

async function confirmDeleteAll() {
  deleteAllOpen.value = false
  await store.clearFiles()
  cardSelectedIds.value = []
}
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col">
    <div class="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
      <h3 class="section-label">{{ t('upscaler.batch.section') }}</h3>
      <button
        class="btn btn-ghost cursor-pointer px-2 py-1 text-xs text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
        type="button"
        :disabled="store.items.length === 0 || store.processing"
        @click="deleteAllOpen = true"
      >
        <Trash2 :size="14" />
        {{ t('common.deleteAll') }}
      </button>
    </div>

    <div class="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
      <p v-if="store.items.length === 0" class="px-2 py-8 text-center text-sm text-zinc-500">
        {{ t('upscaler.batch.empty') }}
      </p>

      <article
        v-for="item in store.items"
        :key="item.localId"
        class="relative cursor-pointer rounded-lg border bg-inset p-2 transition-opacity"
        :class="[
          item.localId === store.selectedId ? 'border-zinc-200' : 'border-zinc-800',
          downloaded(item) ? 'opacity-50' : 'opacity-100',
          cardSelectedIds.includes(item.localId) ? 'ring-1 ring-inset ring-brand/40' : '',
        ]"
        :aria-current="item.localId === store.selectedId ? 'true' : undefined"
        @click="store.selectItem(item.localId)"
        @contextmenu="onItemContextMenu($event, item.localId)"
      >
        <div class="absolute start-2 top-2 z-10" @click.stop>
          <AppCheckbox
            :checked="cardSelectedIds.includes(item.localId)"
            :aria-label="t('upscaler.batch.selectAria', { name: item.name })"
            @change="(checked) => onCardCheckboxChange(item.localId, checked)"
          />
        </div>
        <div class="flex gap-2">
          <div class="h-14 w-14 shrink-0 overflow-hidden rounded bg-zinc-900">
            <img :src="item.previewUrl" alt="" class="h-full w-full object-cover" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-start gap-2">
              <p class="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-100" :title="item.name">{{ item.name }}</p>
              <span class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" :class="statusClass(item.status)">
                {{ statusLabel(item.status) }}
              </span>
            </div>
            <p class="mt-0.5 truncate text-xs text-zinc-500">
              {{ item.width }}×{{ item.height }} · {{ formatBytes(item.bytes) }}
              <template v-if="item.outputWidth && item.outputHeight"> · {{ item.outputWidth }}×{{ item.outputHeight }}</template>
            </p>
          </div>
        </div>

        <p v-if="item.error" class="mt-2 text-xs text-red-300">{{ item.error }}</p>

        <div class="mt-2 flex items-center" @click.stop>
          <button
            class="icon-action"
            :class="sourceIconClass(sourceState(item))"
            type="button"
            :aria-label="t('upscaler.batch.ariaSourceDetails')"
            @mouseenter="showSourceInfo($event, item.localId)"
            @mouseleave="hideSourceInfo"
            @focus="showSourceInfo($event, item.localId)"
            @blur="hideSourceInfo"
          >
            <Info :size="16" />
          </button>
          <button
            v-if="item.status === 'completed'"
            class="icon-action"
            type="button"
            :aria-label="t('upscaler.batch.ariaDownload')"
            :title="t('common.download')"
            @click="store.downloadItem(item.localId)"
          >
            <Download :size="16" />
          </button>
          <button
            class="icon-action icon-action--danger ms-auto"
            type="button"
            :aria-label="t('upscaler.batch.ariaRemove')"
            :title="t('common.remove')"
            :disabled="store.processing"
            @click="openRemoveDialog([item.localId])"
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
        :disabled="store.downloadableCount === 0"
        @click="store.downloadZip()"
      >
        <Download :size="16" />
        {{ t('upscaler.batch.downloadAll') }}
      </button>
    </div>

    <ImageBatchContextMenu
      :open="contextMenu !== null"
      :x="contextMenu?.x ?? 0"
      :y="contextMenu?.y ?? 0"
      :selection-count="actionTargetIds.length"
      :can-paste="store.hasCopiedUpscaleSettings"
      :can-download="contextCanDownload"
      :can-send-to-screensaver="contextCanSendToScreensaver"
      :can-deselect-item="contextCanDeselectItem"
      :show-deselect-all="contextShowDeselectAll"
      :can-deselect-all="contextCanDeselectAll"
      @close="closeContextMenu"
      @copy-settings="contextCopySettings"
      @paste-settings="contextPasteSettings"
      @duplicate="contextDuplicate"
      @rename="contextRename"
      @download="contextDownload"
      @send-to-screensaver="contextSendToScreensaver"
      @remove="contextRemove"
      @deselect-item="contextDeselectItem"
      @deselect-all="contextDeselectAll"
    />

    <Teleport to="body">
      <div
        v-if="infoTip && infoItem"
        class="pointer-events-none fixed z-50 w-56 rounded-md border border-zinc-800 bg-elevated p-2 text-xs text-zinc-200 shadow-[var(--shadow-overlay)]"
        :style="{
          left: `${infoTip.x}px`,
          top: `${infoTip.y}px`,
          transform: infoTip.above ? 'translateY(-100%)' : undefined,
        }"
      >
        <p class="font-semibold" :class="sourceIconClass(sourceState(infoItem))">{{ sourceStatusLabel(infoItem) }}</p>
        <p class="mt-1 truncate text-zinc-100">{{ infoItem.name }}</p>
        <p v-if="sourceMeta(infoItem)" class="mt-1 text-zinc-500">{{ sourceMeta(infoItem) }}</p>
        <p v-if="infoItem.outputWidth && infoItem.outputHeight" class="mt-1 text-zinc-500">
          {{ t('upscaler.beforeAfter') }}: {{ infoItem.outputWidth }}×{{ infoItem.outputHeight }}
        </p>
        <p v-if="infoItem.error" class="mt-1 text-red-300">{{ infoItem.error }}</p>
        <p v-else-if="infoItem.warning" class="mt-1 text-amber-200">{{ infoItem.warning }}</p>
      </div>
    </Teleport>

    <AppDialog
      :open="renameTargetIds.length > 0"
      :title="renameTargetIds.length > 1 ? t('upscaler.batch.renameTitleMany') : t('upscaler.batch.renameTitle')"
      @cancel="closeRename"
    >
      <label class="block">
        <span class="section-label mb-1 block">{{ t('upscaler.batch.name') }}</span>
        <input v-model="renameValue" class="field text-sm" type="text" maxlength="80" @keydown.enter.prevent="confirmRename" />
      </label>
      <p v-if="renameTargetIds.length > 1" class="mt-2 text-xs text-zinc-400">
        {{ t('upscaler.batch.renameBulkHint', { example: bulkRenameNames(renameValue || 'Name', 2)[1] ?? 'Name (2)' }) }}
      </p>
      <template #actions>
        <button class="btn btn-ghost cursor-pointer" type="button" @click="closeRename">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary cursor-pointer" type="button" @click="confirmRename">{{ t('common.save') }}</button>
      </template>
    </AppDialog>

    <AppDialog
      :open="removeTargetIds.length > 0"
      :title="removeTargetIds.length > 1 ? t('upscaler.batch.removeTitleMany') : t('upscaler.batch.removeTitle')"
      @cancel="closeRemove"
    >
      <p class="text-sm text-zinc-300">
        <template v-if="removeDialogSingle">
          {{ t('upscaler.batch.removeBody', { name: removeDialogSingle.name }) }}
        </template>
        <template v-else>
          {{ t('upscaler.batch.removeBodyMany', { n: removeTargetIds.length }) }}
        </template>
      </p>
      <template #actions>
        <button class="btn btn-ghost cursor-pointer" type="button" @click="closeRemove">{{ t('common.cancel') }}</button>
        <button class="btn btn-danger cursor-pointer" type="button" @click="confirmRemove">{{ t('common.remove') }}</button>
      </template>
    </AppDialog>

    <AppDialog :open="deleteAllOpen" :title="t('upscaler.batch.deleteAllTitle')" @cancel="closeDeleteAll">
      <p class="text-sm text-zinc-300">{{ t('upscaler.batch.deleteAllBody') }}</p>
      <template #actions>
        <button class="btn btn-ghost cursor-pointer" type="button" @click="closeDeleteAll">{{ t('common.cancel') }}</button>
        <button class="btn btn-danger cursor-pointer" type="button" @click="confirmDeleteAll">{{ t('common.deleteAll') }}</button>
      </template>
    </AppDialog>
  </section>
</template>