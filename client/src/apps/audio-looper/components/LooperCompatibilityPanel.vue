<script setup lang="ts">
import { CircleCheck, CircleX, Info, LoaderCircle, TriangleAlert, Zap } from '@lucide/vue'
import { computed, ref } from 'vue'
import AppDialog from '../../../components/ui/AppDialog.vue'
import { formatClock } from '../../../lib/format'
import { useI18n } from '../../../i18n'
import { useAudioLooperStore } from '../stores/audioLooper'

const store = useAudioLooperStore()
const { t } = useI18n()
const confirmKeep = ref(false)
const confirmRemove = ref(false)
const showDestinations = ref(false)

const report = computed(() => store.compatibilityReport)
const selectedGroup = computed(() =>
  report.value.groups.find((g) => g.id === report.value.selectedGroupId) ?? null,
)

const keepPreview = computed(() => {
  const group = report.value.groups.find((g) => g.id === report.value.recommendedGroupId)
  const keepIds = new Set(group?.trackIds ?? [])
  const remain = store.tracks.filter((t) => keepIds.has(t.id))
  const remove = store.tracks.filter((t) => !keepIds.has(t.id))
  const remainDuration = remain.reduce((sum, t) => sum + Math.max(0, (t.trimEnd ?? t.duration ?? 0) - t.trimStart), 0)
  const removeDuration = remove.reduce((sum, t) => sum + Math.max(0, (t.trimEnd ?? t.duration ?? 0) - t.trimStart), 0)
  return {
    remain: remain.length,
    remove: remove.length,
    remainDuration,
    removeDuration,
    totalDuration: remainDuration + removeDuration,
  }
})

const statusIcon = computed(() => {
  if (report.value.analyzingCount > 0) return 'analyzing'
  if (report.value.invalidCount > 0 && report.value.matchingTrackIds.length === 0) return 'invalid'
  if (report.value.mismatchingTrackIds.length > 0) return 'warn'
  if (report.value.executionPlan?.strategy === 'ENCODE_ONCE_LOOP_COPY') return 'zap'
  if (report.value.qualityPlan?.strategy === 'STREAM_COPY') return 'ok'
  if (report.value.processingBlockedBySettings) return 'info'
  return 'warn'
})

function channelLabel(channels: number): string {
  if (channels === 1) return t('looper.compatibility.mono')
  if (channels === 2) return t('looper.compatibility.stereo')
  return t('looper.compatibility.channels', { count: channels })
}

function onKeepConfirm(): void {
  store.keepLargestCompatibleGroup()
  confirmKeep.value = false
}

function onRemoveConfirm(): void {
  store.removeIncompatibleTracks()
  confirmRemove.value = false
}
</script>

<template>
  <section
    v-if="store.hasSource"
    class="rounded-lg border border-zinc-800 bg-elevated/60 p-3"
    :aria-label="t('looper.compatibility.aria')"
  >
    <div class="flex items-start gap-2">
      <LoaderCircle
        v-if="statusIcon === 'analyzing'"
        :size="16"
        class="mt-0.5 shrink-0 animate-spin text-zinc-400"
        aria-hidden="true"
      />
      <CircleCheck
        v-else-if="statusIcon === 'ok'"
        :size="16"
        class="mt-0.5 shrink-0 text-emerald-400"
        aria-hidden="true"
      />
      <Zap
        v-else-if="statusIcon === 'zap'"
        :size="16"
        class="mt-0.5 shrink-0 text-amber-300"
        aria-hidden="true"
      />
      <CircleX
        v-else-if="statusIcon === 'invalid'"
        :size="16"
        class="mt-0.5 shrink-0 text-red-300"
        aria-hidden="true"
      />
      <Info
        v-else-if="statusIcon === 'info'"
        :size="16"
        class="mt-0.5 shrink-0 text-sky-300"
        aria-hidden="true"
      />
      <TriangleAlert
        v-else
        :size="16"
        class="mt-0.5 shrink-0 text-amber-300"
        aria-hidden="true"
      />
      <div class="min-w-0 flex-1">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">{{ t('looper.compatibility.title') }}</h3>
          <button
            class="cursor-pointer px-1.5 py-0.5 text-zinc-400 hover:text-zinc-300"
            type="button"
            :aria-expanded="store.compatibilityDetailsOpen"
            :aria-label="t('looper.compatibility.detailsAria')"
            :title="t('looper.compatibility.details')"
            @click="store.compatibilityDetailsOpen = !store.compatibilityDetailsOpen"
          >
            <Info :size="14" />
          </button>
        </div>
        <p class="mt-1 text-sm text-zinc-200">{{ report.summaryLine }}</p>
        <p v-if="selectedGroup" class="mt-0.5 text-xs text-zinc-500">
          {{ t('looper.compatibility.reference', { label: selectedGroup.signature.label }) }}
        </p>
      </div>
    </div>

    <div
      v-if="!report.singleGroup && report.groups.length > 1"
      class="mt-3 space-y-1.5"
    >
      <p class="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-zinc-500">{{ t('looper.compatibility.groups') }}</p>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="(group, index) in report.groups"
          :key="group.id"
          class="cursor-pointer rounded-md border px-2 py-1 text-left text-xs transition-colors"
          type="button"
          :class="
            group.id === report.selectedGroupId
              ? 'border-brand/50 bg-brand/15 text-zinc-100'
              : 'border-zinc-700 bg-inset text-zinc-300 hover:border-zinc-500'
          "
          @click="store.selectCompatibilityGroup(group.id)"
        >
          <span class="font-semibold">{{ String.fromCharCode(65 + index) }}</span>
          <span class="text-zinc-400"> · {{ group.signature.label }}</span>
          <span class="text-zinc-500"> · {{ group.trackCount }}</span>
          <span
            v-if="group.id === report.recommendedGroupId"
            class="ml-1 text-[0.65rem] uppercase tracking-wide text-brand"
          >{{ t('looper.compatibility.recommended') }}</span>
        </button>
      </div>
    </div>

    <div v-if="store.compatibilityDetailsOpen" class="mt-3 space-y-3 border-t border-zinc-800 pt-3 text-xs text-zinc-400">
      <div class="grid grid-cols-2 gap-x-3 gap-y-1">
        <span>{{ t('looper.compatibility.tracks') }}</span><span class="text-zinc-200">{{ report.trackCount }}</span>
        <span>{{ t('looper.compatibility.matching') }}</span><span class="text-zinc-200">{{ report.matchingTrackIds.length }}</span>
        <span>{{ t('looper.compatibility.needProcessing') }}</span><span class="text-zinc-200">{{ report.mismatchingTrackIds.length }}</span>
        <span>{{ t('looper.compatibility.unknown') }}</span><span class="text-zinc-200">{{ report.unknownCount }}</span>
        <span>{{ t('looper.compatibility.invalid') }}</span><span class="text-zinc-200">{{ report.invalidCount }}</span>
      </div>

      <div v-if="report.qualityPlan" class="space-y-1">
        <p class="font-semibold text-zinc-300">{{ t('looper.compatibility.expectedProcessing') }}</p>
        <p class="text-zinc-200">{{ report.qualityPlan.userLabel }}</p>
        <p>{{ report.qualityPlan.reason }}</p>
        <p>
          {{ t('looper.compatibility.output') }}
          <span class="text-zinc-200">
            {{ report.qualityPlan.expectedCodec.toUpperCase() }}
            <template v-if="report.qualityPlan.targetBitrateKbps != null">
              · {{ report.qualityPlan.targetBitrateKbps }} kbps
            </template>
            <template v-else-if="report.qualityPlan.strategy === 'STREAM_COPY'">
              {{ t('looper.compatibility.originalBitrate') }}
            </template>
            · {{ Math.round(report.qualityPlan.expectedSampleRate / 100) / 10 }} kHz
            · {{ channelLabel(report.qualityPlan.expectedChannels) }}
          </span>
        </p>
      </div>

      <div v-if="report.executionPlan" class="space-y-1">
        <p class="font-semibold text-zinc-300">{{ t('looper.compatibility.expectedExecution') }}</p>
        <p class="text-zinc-200">{{ report.executionPlan.strategy.split('_').join(' ') }}</p>
        <p>{{ report.executionPlan.reason }}</p>
      </div>

      <div v-if="report.impact && report.impact.lossyEncodeRequired" class="space-y-1">
        <p class="font-semibold text-zinc-300">{{ t('looper.compatibility.processingImpact') }}</p>
        <p>{{ t('looper.compatibility.targetPeriod', { target: formatClock(report.impact.targetDurationSeconds), period: formatClock(report.impact.periodDurationSeconds) }) }}</p>
        <p>
          {{ t('looper.compatibility.standardEncode', { duration: formatClock(report.impact.standardEncodeInputSeconds) }) }}
        </p>
        <p v-if="report.impact.encodeOnceEncodeInputSeconds != null">
          {{ t('looper.compatibility.encodeOnce', { duration: formatClock(report.impact.encodeOnceEncodeInputSeconds) }) }}
          <template v-if="report.impact.workloadReductionPercent != null">
            {{ t('looper.compatibility.encodeReduction', { percent: report.impact.workloadReductionPercent.toFixed(1) }) }}
          </template>
        </p>
        <p class="text-zinc-500">{{ t('looper.compatibility.encodeNote') }}</p>
      </div>

      <div>
        <button
          class="cursor-pointer text-xs text-zinc-400 hover:text-zinc-300"
          type="button"
          @click="showDestinations = !showDestinations"
        >
          {{ showDestinations ? t('looper.compatibility.hideDestinations') : t('looper.compatibility.showDestinations') }}
        </button>
        <ul v-if="showDestinations" class="mt-1 space-y-1">
          <li v-for="dest in report.destinations" :key="dest.destination">
            <span class="text-zinc-300">{{ dest.label }}:</span>
            {{ dest.strategyLabel }}
          </li>
        </ul>
      </div>

      <ul v-if="report.suggestions.length" class="space-y-1">
        <li v-for="tip in report.suggestions" :key="tip.id" class="text-zinc-300">
          · {{ tip.message }}
        </li>
      </ul>
    </div>

    <div class="mt-3 flex flex-wrap gap-1.5">
      <button
        class="btn btn-ghost cursor-pointer px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
        type="button"
        :disabled="report.mismatchingTrackIds.length === 0 && !store.filterIncompatibleOnly"
        @click="store.filterIncompatibleOnly = !store.filterIncompatibleOnly"
      >
        {{ store.filterIncompatibleOnly ? t('looper.compatibility.showAllTracks') : t('looper.compatibility.showIncompatible') }}
      </button>
      <button
        class="btn btn-ghost cursor-pointer px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
        type="button"
        :disabled="report.groups.length < 2 || keepPreview.remove === 0"
        @click="confirmKeep = true"
      >
        {{ t('looper.compatibility.keepLargest') }}
      </button>
      <button
        class="btn btn-ghost cursor-pointer px-2 py-1 text-xs text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
        type="button"
        :disabled="report.mismatchingTrackIds.length === 0"
        @click="confirmRemove = true"
      >
        {{ t('looper.compatibility.removeIncompatible') }}
      </button>
    </div>

    <AppDialog :open="confirmKeep" :title="t('looper.compatibility.keepTitle')" @cancel="confirmKeep = false">
      <p class="text-sm text-zinc-400">
        {{
          t('looper.compatibility.keepBody', {
            remain: keepPreview.remain,
            remainDuration: formatClock(keepPreview.remainDuration),
            remove: keepPreview.remove,
            removeDuration: formatClock(keepPreview.removeDuration),
          })
        }}
      </p>
      <template #actions>
        <button class="btn btn-ghost cursor-pointer" type="button" @click="confirmKeep = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary cursor-pointer" type="button" @click="onKeepConfirm">{{ t('looper.compatibility.keepAction') }}</button>
      </template>
    </AppDialog>

    <AppDialog :open="confirmRemove" :title="t('looper.compatibility.removeTitle')" @cancel="confirmRemove = false">
      <p class="text-sm text-zinc-400">
        {{
          t('looper.compatibility.removeBody', {
            count: report.mismatchingTrackIds.length,
            group: selectedGroup?.signature.label ?? t('looper.compatibility.selectedGroupFallback'),
          })
        }}
      </p>
      <template #actions>
        <button class="btn btn-ghost cursor-pointer" type="button" @click="confirmRemove = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-danger cursor-pointer" type="button" @click="onRemoveConfirm">{{ t('common.remove') }}</button>
      </template>
    </AppDialog>
  </section>
</template>