<script setup lang="ts">
import { ClipboardPaste, Copy, ImagePlay, ImagePlus, Files, Pencil, Square, SquareCheckBig, Trash2 } from '@lucide/vue'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from '../../../i18n'
import { S } from '../lib/screensaverI18n'

const props = defineProps<{
  open: boolean
  x: number
  y: number
  selectionCount: number
  imageHandoffCount: number
  deleteCount: number
  canPaste: boolean
  canDelete: boolean
  canImageHandoff: boolean
  canDeselectProject: boolean
  showDeselectAll: boolean
  canDeselectAll: boolean
}>()

const emit = defineEmits<{
  close: []
  copySettings: []
  pasteSettings: []
  duplicate: []
  createThumbnail: []
  sendToImageMotion: []
  rename: []
  delete: []
  deselectProject: []
  deselectAll: []
}>()

const { t } = useI18n()
const menuRef = ref<HTMLElement | null>(null)
const position = ref({ left: props.x, top: props.y })

const style = computed(() => ({
  left: `${position.value.left}px`,
  top: `${position.value.top}px`,
}))

const multi = computed(() => props.selectionCount > 1)

function clampPosition() {
  const el = menuRef.value
  if (!el) {
    position.value = { left: props.x, top: props.y }
    return
  }
  const pad = 8
  const rect = el.getBoundingClientRect()
  const maxX = Math.max(pad, window.innerWidth - rect.width - pad)
  const maxY = Math.max(pad, window.innerHeight - rect.height - pad)
  position.value = {
    left: Math.min(Math.max(pad, props.x), maxX),
    top: Math.min(Math.max(pad, props.y), maxY),
  }
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

function onDocumentPointerDown(event: PointerEvent) {
  const el = menuRef.value
  if (!el || el.contains(event.target as Node)) return
  emit('close')
}

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      document.removeEventListener('keydown', onDocumentKeydown)
      document.removeEventListener('pointerdown', onDocumentPointerDown, true)
      return
    }
    position.value = { left: props.x, top: props.y }
    await nextTick()
    clampPosition()
    document.addEventListener('keydown', onDocumentKeydown)
    document.addEventListener('pointerdown', onDocumentPointerDown, true)
  },
)

watch(
  () => [props.x, props.y] as const,
  async () => {
    if (!props.open) return
    position.value = { left: props.x, top: props.y }
    await nextTick()
    clampPosition()
  },
)

onUnmounted(() => {
  document.removeEventListener('keydown', onDocumentKeydown)
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
})

function chooseAndClose(event: () => void) {
  event()
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="menuRef"
      class="fixed z-[60] min-w-[12.5rem] rounded-lg border border-white/10 bg-elevated py-1 shadow-overlay"
      role="menu"
      :style="style"
      @contextmenu.prevent
    >
      <button
        class="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-start text-xs text-zinc-200 hover:bg-white/5"
        type="button"
        role="menuitem"
        @click="chooseAndClose(() => emit('copySettings'))"
      >
        <Copy :size="14" aria-hidden="true" />
        {{ t(S('projects.contextMenu.copySettings')) }}
      </button>
      <button
        class="flex w-full items-center gap-2 px-3 py-1.5 text-start text-xs hover:bg-white/5"
        :class="canPaste ? 'cursor-pointer text-zinc-200' : 'cursor-not-allowed text-zinc-500'"
        type="button"
        role="menuitem"
        :disabled="!canPaste"
        @click="chooseAndClose(() => canPaste && emit('pasteSettings'))"
      >
        <ClipboardPaste :size="14" aria-hidden="true" />
        {{
          multi
            ? t(S('projects.contextMenu.pasteMany'), { n: selectionCount })
            : t(S('projects.contextMenu.pasteSettings'))
        }}
      </button>
      <div class="my-1 border-t border-zinc-800" role="separator" />
      <button
        class="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-start text-xs text-zinc-200 hover:bg-white/5"
        type="button"
        role="menuitem"
        @click="chooseAndClose(() => emit('duplicate'))"
      >
        <Files :size="14" aria-hidden="true" />
        {{
          multi ? t(S('projects.contextMenu.duplicateMany'), { n: selectionCount }) : t('common.duplicate')
        }}
      </button>
      <button
        v-if="canImageHandoff"
        class="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-start text-xs text-zinc-200 hover:bg-white/5"
        type="button"
        role="menuitem"
        @click="chooseAndClose(() => emit('createThumbnail'))"
      >
        <ImagePlus :size="14" aria-hidden="true" />
        {{
          imageHandoffCount > 1
            ? t(S('projects.contextMenu.thumbnailMany'), { n: imageHandoffCount })
            : t(S('projects.createThumbnailTitle'))
        }}
      </button>
      <button
        v-if="canImageHandoff"
        class="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-start text-xs text-zinc-200 hover:bg-white/5"
        type="button"
        role="menuitem"
        @click="chooseAndClose(() => emit('sendToImageMotion'))"
      >
        <ImagePlay :size="14" aria-hidden="true" />
        {{
          imageHandoffCount > 1
            ? t(S('projects.contextMenu.imageMotionMany'), { n: imageHandoffCount })
            : t(S('sendToImageMotion.title'))
        }}
      </button>
      <div class="my-1 border-t border-zinc-800" role="separator" />
      <button
        class="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-start text-xs text-zinc-200 hover:bg-white/5"
        type="button"
        role="menuitem"
        @click="chooseAndClose(() => emit('rename'))"
      >
        <Pencil :size="14" aria-hidden="true" />
        {{
          multi ? t(S('projects.contextMenu.renameMany'), { n: selectionCount }) : t(S('dialogs.rename.title'))
        }}
      </button>
      <button
        class="flex w-full items-center gap-2 px-3 py-1.5 text-start text-xs hover:bg-white/5"
        :class="canDelete ? 'cursor-pointer text-red-300' : 'cursor-not-allowed text-zinc-500'"
        type="button"
        role="menuitem"
        :disabled="!canDelete"
        @click="chooseAndClose(() => canDelete && emit('delete'))"
      >
        <Trash2 :size="14" aria-hidden="true" />
        {{
          deleteCount > 1 ? t(S('projects.contextMenu.deleteMany'), { n: deleteCount }) : t('common.delete')
        }}
      </button>
      <template v-if="canDeselectProject || showDeselectAll">
        <div class="my-1 border-t border-zinc-800" role="separator" />
        <button
          v-if="canDeselectProject"
          class="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-start text-xs text-zinc-300 hover:bg-white/5"
          type="button"
          role="menuitem"
          @click="chooseAndClose(() => emit('deselectProject'))"
        >
          <Square :size="14" aria-hidden="true" />
          {{ t(S('projects.contextMenu.deselectProject')) }}
        </button>
        <button
          v-if="showDeselectAll"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-start text-xs hover:bg-white/5"
          :class="canDeselectAll ? 'cursor-pointer text-zinc-300' : 'cursor-not-allowed text-zinc-500'"
          type="button"
          role="menuitem"
          :disabled="!canDeselectAll"
          @click="chooseAndClose(() => canDeselectAll && emit('deselectAll'))"
        >
          <SquareCheckBig :size="14" aria-hidden="true" />
          {{ t(S('projects.contextMenu.deselectAll')) }}
        </button>
      </template>
    </div>
  </Teleport>
</template>