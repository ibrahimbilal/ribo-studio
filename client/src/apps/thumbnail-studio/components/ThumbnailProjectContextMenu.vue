<script setup lang="ts">
import { ClipboardPaste, Copy, Download, Files, Pencil, Square, SquareCheckBig, Trash2 } from '@lucide/vue'
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
  canDeselectProject: boolean
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
  delete: []
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
</script>

<template>
  <AppStudioContextMenu :open="open" :x="x" :y="y" @close="emit('close')">
    <AppStudioContextMenuItem
      :label="t('thumbnail.projects.contextMenu.copySettings')"
      :icon="Copy"
      @select="chooseAndClose(() => emit('copySettings'))"
    />
    <AppStudioContextMenuItem
      :label="
        multi
          ? t('thumbnail.projects.contextMenu.pasteMany', { n: selectionCount })
          : t('thumbnail.projects.contextMenu.pasteSettings')
      "
      :icon="ClipboardPaste"
      :disabled="!canPaste"
      @select="chooseAndClose(() => canPaste && emit('pasteSettings'))"
    />
    <AppStudioContextMenuSeparator />
    <AppStudioContextMenuItem
      :label="multi ? t('thumbnail.projects.contextMenu.duplicateMany', { n: selectionCount }) : t('common.duplicate')"
      :icon="Files"
      @select="chooseAndClose(() => emit('duplicate'))"
    />
    <AppStudioContextMenuItem
      :label="multi ? t('thumbnail.projects.contextMenu.downloadMany', { n: selectionCount }) : t('common.download')"
      :icon="Download"
      @select="chooseAndClose(() => emit('download'))"
    />
    <AppStudioContextMenuSeparator />
    <AppStudioContextMenuItem
      :label="multi ? t('thumbnail.projects.contextMenu.renameMany', { n: selectionCount }) : t('thumbnail.projects.renameTitle')"
      :icon="Pencil"
      @select="chooseAndClose(() => emit('rename'))"
    />
    <AppStudioContextMenuItem
      :label="multi ? t('thumbnail.projects.contextMenu.deleteMany', { n: selectionCount }) : t('common.delete')"
      :icon="Trash2"
      danger
      @select="chooseAndClose(() => emit('delete'))"
    />
    <template v-if="canDeselectProject || showSelectAll">
      <AppStudioContextMenuSeparator />
      <AppStudioContextMenuItem
        v-if="canDeselectProject"
        :label="t('thumbnail.projects.contextMenu.deselectProject')"
        :icon="Square"
        muted
        @select="chooseAndClose(() => emit('deselectProject'))"
      />
      <AppStudioContextMenuItem
        v-if="showSelectAll"
        :label="
          allItemsSelected
            ? t('thumbnail.projects.contextMenu.deselectAll')
            : t('thumbnail.projects.contextMenu.selectAll')
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