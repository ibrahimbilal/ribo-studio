<script setup lang="ts">
import { ClipboardPaste, Copy, Download, Files, MonitorPlay, Pencil, Square, SquareCheckBig, Trash2 } from '@lucide/vue'
import { computed } from 'vue'
import { useI18n } from '../../../i18n'
import AppStudioContextMenu from '../../../components/ui/AppStudioContextMenu.vue'
import AppStudioContextMenuItem from '../../../components/ui/AppStudioContextMenuItem.vue'
import AppStudioContextMenuSeparator from '../../../components/ui/AppStudioContextMenuSeparator.vue'

const props = defineProps<{
  open: boolean
  x: number
  y: number
  selectionCount: number
  canPaste: boolean
  canDownload: boolean
  canSendToScreensaver: boolean
  canDeselectItem: boolean
  showSelectAll: boolean
  allItemsSelected: boolean
}>()

const emit = defineEmits<{
  close: []
  copySettings: []
  pasteSettings: []
  duplicate: []
  rename: []
  download: []
  sendToScreensaver: []
  remove: []
  deselectItem: []
  selectAll: []
  deselectAll: []
}>()

const { t } = useI18n()
const multi = computed(() => props.selectionCount > 1)

function chooseAndClose(event: () => void) {
  event()
  emit('close')
}
</script>

<template>
  <AppStudioContextMenu :open="open" :x="x" :y="y" @close="emit('close')">
    <AppStudioContextMenuItem
      :label="t('upscaler.batch.contextMenu.copySettings')"
      :icon="Copy"
      @select="chooseAndClose(() => emit('copySettings'))"
    />
    <AppStudioContextMenuItem
      :label="t('upscaler.batch.contextMenu.pasteSettings')"
      :icon="ClipboardPaste"
      :disabled="!canPaste"
      @select="chooseAndClose(() => canPaste && emit('pasteSettings'))"
    />
    <AppStudioContextMenuSeparator />
    <AppStudioContextMenuItem
      :label="multi ? t('upscaler.batch.contextMenu.duplicateMany', { n: selectionCount }) : t('common.duplicate')"
      :icon="Files"
      @select="chooseAndClose(() => emit('duplicate'))"
    />
    <AppStudioContextMenuItem
      :label="multi ? t('upscaler.batch.contextMenu.downloadMany', { n: selectionCount }) : t('common.download')"
      :icon="Download"
      :disabled="!canDownload"
      @select="chooseAndClose(() => canDownload && emit('download'))"
    />
    <AppStudioContextMenuItem
      v-if="canSendToScreensaver"
      :label="t('upscaler.sendToScreensaver')"
      :icon="MonitorPlay"
      @select="chooseAndClose(() => emit('sendToScreensaver'))"
    />
    <AppStudioContextMenuSeparator />
    <AppStudioContextMenuItem
      :label="multi ? t('upscaler.batch.contextMenu.renameMany', { n: selectionCount }) : t('common.rename')"
      :icon="Pencil"
      @select="chooseAndClose(() => emit('rename'))"
    />
    <AppStudioContextMenuItem
      :label="multi ? t('upscaler.batch.contextMenu.removeMany', { n: selectionCount }) : t('common.remove')"
      :icon="Trash2"
      danger
      @select="chooseAndClose(() => emit('remove'))"
    />
    <template v-if="canDeselectItem || showSelectAll">
      <AppStudioContextMenuSeparator />
      <AppStudioContextMenuItem
        v-if="canDeselectItem"
        :label="t('upscaler.batch.contextMenu.deselectItem')"
        :icon="Square"
        muted
        @select="chooseAndClose(() => emit('deselectItem'))"
      />
      <AppStudioContextMenuItem
        v-if="showSelectAll"
        :label="
          allItemsSelected
            ? t('upscaler.batch.contextMenu.deselectAll')
            : t('upscaler.batch.contextMenu.selectAll')
        "
        :icon="SquareCheckBig"
        muted
        @select="
          chooseAndClose(() => emit(allItemsSelected ? 'deselectAll' : 'selectAll'))
        "
      />
    </template>
  </AppStudioContextMenu>
</template>