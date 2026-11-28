<script setup lang="ts">
import { ClipboardPaste, Copy, ImagePlay, ImagePlus, Files, Pencil, Square, SquareCheckBig } from '@lucide/vue'
import { computed } from 'vue'
import { useI18n } from '../../../i18n'
import AppStudioContextMenu from '../../../components/ui/AppStudioContextMenu.vue'
import AppStudioContextMenuItem from '../../../components/ui/AppStudioContextMenuItem.vue'
import AppStudioContextMenuSeparator from '../../../components/ui/AppStudioContextMenuSeparator.vue'
import { S } from '../lib/screensaverI18n'

const props = defineProps<{
  open: boolean
  x: number
  y: number
  selectionCount: number
  imageHandoffCount: number
  canPaste: boolean
  canImageHandoff: boolean
  canDeselectProject: boolean
  showSelectAll: boolean
  allItemsSelected: boolean
}>()

const emit = defineEmits<{
  close: []
  copySettings: []
  pasteSettings: []
  duplicate: []
  createThumbnail: []
  sendToImageMotion: []
  rename: []
  deselectProject: []
  selectAll: []
  deselectAll: []
}>()

const { t } = useI18n()
const multi = computed(() => props.selectionCount > 1)

function chooseAndClose(event: () => void) {
  event()
  emit('close')
}

function toggleSelectAll(): void {
  if (props.allItemsSelected) emit('deselectAll')
  else emit('selectAll')
}
</script>

<template>
  <AppStudioContextMenu :open="open" :x="x" :y="y" @close="emit('close')">
    <AppStudioContextMenuItem
      :label="t(S('projects.contextMenu.copySettings'))"
      :icon="Copy"
      @select="chooseAndClose(() => emit('copySettings'))"
    />
    <AppStudioContextMenuItem
      :label="multi ? t(S('projects.contextMenu.pasteMany'), { n: selectionCount }) : t(S('projects.contextMenu.pasteSettings'))"
      :icon="ClipboardPaste"
      :disabled="!canPaste"
      @select="chooseAndClose(() => canPaste && emit('pasteSettings'))"
    />
    <AppStudioContextMenuSeparator />
    <AppStudioContextMenuItem
      :label="multi ? t(S('projects.contextMenu.duplicateMany'), { n: selectionCount }) : t('common.duplicate')"
      :icon="Files"
      @select="chooseAndClose(() => emit('duplicate'))"
    />
    <AppStudioContextMenuItem
      v-if="canImageHandoff"
      :label="
        imageHandoffCount > 1
          ? t(S('projects.contextMenu.thumbnailMany'), { n: imageHandoffCount })
          : t(S('projects.createThumbnailTitle'))
      "
      :icon="ImagePlus"
      @select="chooseAndClose(() => emit('createThumbnail'))"
    />
    <AppStudioContextMenuItem
      v-if="canImageHandoff"
      :label="
        imageHandoffCount > 1
          ? t(S('projects.contextMenu.imageMotionMany'), { n: imageHandoffCount })
          : t(S('sendToImageMotion.title'))
      "
      :icon="ImagePlay"
      @select="chooseAndClose(() => emit('sendToImageMotion'))"
    />
    <AppStudioContextMenuSeparator />
    <AppStudioContextMenuItem
      :label="multi ? t(S('projects.contextMenu.renameMany'), { n: selectionCount }) : t(S('dialogs.rename.title'))"
      :icon="Pencil"
      @select="chooseAndClose(() => emit('rename'))"
    />
    <template v-if="canDeselectProject || showSelectAll">
      <AppStudioContextMenuSeparator />
      <AppStudioContextMenuItem
        v-if="canDeselectProject"
        :label="t(S('projects.contextMenu.deselectProject'))"
        :icon="Square"
        muted
        @select="chooseAndClose(() => emit('deselectProject'))"
      />
      <AppStudioContextMenuItem
        v-if="showSelectAll"
        :label="
          allItemsSelected
            ? t(S('projects.contextMenu.deselectAll'))
            : t(S('projects.contextMenu.selectAll'))
        "
        :icon="SquareCheckBig"
        muted
        @select="chooseAndClose(toggleSelectAll)"
      />
    </template>
  </AppStudioContextMenu>
</template>