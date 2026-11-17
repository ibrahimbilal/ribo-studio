<script setup lang="ts">
import { formatBytes } from '@shared/imageUpscaler'
import { Download, Trash2 } from '@lucide/vue'
import { ref } from 'vue'
import AppDialog from '../../../components/ui/AppDialog.vue'
import { useI18n } from '../../../i18n'
import { useImageUpscalerStore } from '../stores/imageUpscaler'

const store = useImageUpscalerStore()
const { t } = useI18n()
const deleteAllOpen = ref(false)

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

function downloaded(item: { status: string; downloadedRevision: number | null; outputRevision: number | null }): boolean {
  return item.status === 'completed' && item.downloadedRevision != null && item.downloadedRevision === item.outputRevision
}

function closeDeleteAll() {
  deleteAllOpen.value = false
}

async function confirmDeleteAll() {
  deleteAllOpen.value = false
  await store.clearFiles()
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
        class="cursor-pointer rounded-lg border bg-inset p-2 transition-opacity"
        :class="[
          item.localId === store.selectedId ? 'border-zinc-200' : 'border-zinc-800',
          downloaded(item) ? 'opacity-50' : 'opacity-100',
        ]"
        :aria-current="item.localId === store.selectedId ? 'true' : undefined"
        @click="store.selectItem(item.localId)"
      >
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

        <div class="mt-2 flex" @click.stop>
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
            @click="store.removeItem(item.localId)"
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

    <AppDialog :open="deleteAllOpen" :title="t('upscaler.batch.deleteAllTitle')" @cancel="closeDeleteAll">
      <p class="text-sm text-zinc-300">{{ t('upscaler.batch.deleteAllBody') }}</p>
      <template #actions>
        <button class="btn btn-ghost cursor-pointer" type="button" @click="closeDeleteAll">{{ t('common.cancel') }}</button>
        <button class="btn btn-danger cursor-pointer" type="button" @click="confirmDeleteAll">{{ t('common.deleteAll') }}</button>
      </template>
    </AppDialog>
  </section>
</template>
