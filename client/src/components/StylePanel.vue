<script setup lang="ts">
import { OUTPUTS, FRAME_RATES, frameMetrics } from '@shared/frame'
import { Hash, ListOrdered, Minus, Palette, Plus, SlidersHorizontal, TextAlignCenter, TextAlignEnd, TextAlignStart, Trash2, Trophy, X } from '@lucide/vue'
import { computed, ref } from 'vue'
import { useI18n } from '../i18n'
import { usePlayback } from '../composables/usePlayback'
import { formatRank, pageLabel } from '../lib/format'
import { FONT_OPTIONS } from '../lib/presets'
import { useGlobalSettingsStore } from '../stores/globalSettings'
import { useProjectStore } from '../stores/project'
import ColorField from './ColorField.vue'
import ColorSwatches from './ColorSwatches.vue'
import AdvancedAudioControls from './audio/AdvancedAudioControls.vue'
import AudioFileField from './audio/AudioFileField.vue'
import SourceClipAudioControls from './audio/SourceClipAudioControls.vue'
import SettingsAccordion from './SettingsAccordion.vue'
import SliderField from './SliderField.vue'
import ToggleSwitch from './ToggleSwitch.vue'

const store = useProjectStore()
const { t } = useI18n()
const aligns = computed(() => [
  { id: 'left' as const, icon: TextAlignStart, label: t('ranking.style.alignLeft') },
  { id: 'center' as const, icon: TextAlignCenter, label: t('ranking.style.alignCenter') },
  { id: 'right' as const, icon: TextAlignEnd, label: t('ranking.style.alignRight') },
])
const presets = computed(() => [
  { id: 'classic' as const, label: t('ranking.style.presetClassic'), icon: Trophy },
  { id: 'tier' as const, label: t('ranking.style.presetTier'), icon: ListOrdered },
  { id: 'minimal' as const, label: t('ranking.style.presetMinimal'), icon: Minus },
])
const globalSettings = useGlobalSettingsStore()
const playback = usePlayback()

const props = withDefaults(defineProps<{ focus?: 'look' | 'sound' | 'output' | 'all' }>(), { focus: 'all' })
const showLook = computed(() => props.focus === 'look' || props.focus === 'all')
const showSound = computed(() => props.focus === 'sound' || props.focus === 'all')
const showOutput = computed(() => props.focus === 'output' || props.focus === 'all')
const exampleIndex = computed(() => {
  if (playback.activeIndex.value >= 0) return playback.activeIndex.value
  const selected = store.clips.findIndex((clip) => clip.id === store.selectedClipId)
  return selected >= 0 ? selected : 0
})
const exampleTotal = computed(() => Math.max(store.clips.length, 1))
const pageExample = computed(
  () => `${pageLabel(exampleIndex.value, exampleTotal.value)} ${t('ranking.style.exampleTitleSuffix')}`,
)
const numberExample = computed(
  () => `${formatRank(exampleIndex.value, store.style.ranking.format)} ${t('ranking.style.exampleTitleSuffix')}`,
)
const wordIndex = ref(0)
const activeWord = computed(() => store.spans[Math.min(wordIndex.value, Math.max(0, store.spans.length - 1))] ?? null)
const bannerLimit = computed(() => Math.round(store.style.video.height * 0.42))
const metrics = computed(() => frameMetrics(store.style.video.width, store.style.video.height, store.style.banner.height))
const layoutMetrics = computed(() =>
  frameMetrics(
    store.style.video.width,
    store.style.video.height,
    store.style.banner.visible === false ? 0 : store.style.banner.height,
  ),
)

function onMusicFiles(files: File[]) {
  const file = files[0]
  if (file) void store.setMusic(file)
}

function onBannerHeight(value: number) {
  const even = Math.round(value) % 2 === 0 ? Math.round(value) : Math.round(value) - 1
  store.style.banner.height = Math.max(80, even)
}

function onWordColor(color: string) {
  if (!activeWord.value) return
  const index = store.spans.findIndex((span) => span.id === activeWord.value?.id)
  if (index >= 0) store.setSpanColor(index, color)
}

function onAddPaletteColor(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  store.addPaletteColor(target.value)
}

function onResolution(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  const [width, height] = target.value.split('x').map(Number)
  if (width && height) store.setResolution(width, height)
}

function setTitleHideAfterEnabled(enabled: boolean) {
  if (enabled && store.style.ranking.titleHideAfter <= 0) store.style.ranking.titleHideAfter = 3
  if (!enabled) store.style.ranking.titleHideAfter = 0
}
</script>

<template>
  <aside class="min-h-0 overflow-y-auto border-zinc-800">
    <SettingsAccordion v-show="showLook" :title="t('ranking.style.presets')" open>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="preset in presets"
            :key="preset.id"
            class="btn cursor-pointer"
            :class="store.activePreset === preset.id ? 'btn-primary' : 'btn-ghost'"
            type="button"
            @click="store.applyPreset(preset.id)"
          >
            <component :is="preset.icon" :size="16" />
            {{ preset.label }}
          </button>
          <button class="btn cursor-pointer" :class="store.activePreset === 'custom' ? 'btn-primary' : 'btn-ghost'" type="button">
            <SlidersHorizontal :size="16" />
            {{ t('ranking.style.custom') }}
          </button>
        </div>
        <template v-if="store.style.ranking.visible">
          <div class="mt-3 grid grid-cols-2 gap-2">
            <button
              class="btn cursor-pointer"
              :class="store.style.ranking.display !== 'page' ? 'btn-primary' : 'btn-ghost'"
              type="button"
              @click="store.style.ranking.display = 'stack'"
            >
              <ListOrdered :size="16" />
              {{ t('ranking.style.allNumbers') }}
            </button>
            <button
              class="btn cursor-pointer"
              :class="store.style.ranking.display === 'page' ? 'btn-primary' : 'btn-ghost'"
              type="button"
              @click="store.style.ranking.display = 'page'"
            >
              <Hash :size="16" />
              {{ t('ranking.style.currentNumber') }}
            </button>
          </div>
          <div v-if="store.style.ranking.display === 'page'" class="mt-2 grid grid-cols-2 gap-2">
            <button
              class="btn cursor-pointer"
              :class="store.style.ranking.pageStyle !== 'number' ? 'btn-primary' : 'btn-ghost'"
              type="button"
              @click="store.style.ranking.pageStyle = 'fraction'"
            >
              {{ pageExample }}
            </button>
            <button
              class="btn cursor-pointer"
              :class="store.style.ranking.pageStyle === 'number' ? 'btn-primary' : 'btn-ghost'"
              type="button"
              @click="store.style.ranking.pageStyle = 'number'"
            >
              {{ numberExample }}
            </button>
          </div>
          <p class="mt-2 text-xs leading-relaxed text-zinc-500">
            <template v-if="store.style.ranking.display === 'page'">{{ t('ranking.style.paginationShows', { pageExample, numberExample }) }}</template>
            <template v-else>{{ t('ranking.style.allNumbersHint') }}</template>
          </p>
        </template>
    </SettingsAccordion>

    <SettingsAccordion v-show="showLook" :title="t('ranking.style.colorSets')">
        <p class="text-xs leading-relaxed text-zinc-500">{{ t('ranking.style.colorSetsHint') }}</p>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="set in store.colorSets"
            :key="set.id"
            class="btn cursor-pointer"
            :class="store.activeColorSetId === set.id ? 'btn-primary' : 'btn-ghost'"
            type="button"
            @click="store.setActiveColorSet(set.id)"
          >
            {{ set.name || t('common.untitled') }}
          </button>
          <button class="btn cursor-pointer btn-ghost px-2" type="button" :aria-label="t('ranking.style.addColorSet')" :title="t('ranking.style.addColorSet')" @click="store.addColorSet">
            <Plus :size="16" />
          </button>
        </div>
        <label class="block text-xs text-zinc-400">
          {{ t('ranking.style.setName') }}
          <input class="field mt-1" maxlength="40" :value="store.activeColorSet?.name ?? ''" @input="store.renameColorSet(($event.target as HTMLInputElement).value)" />
        </label>
        <div class="flex flex-wrap gap-2">
          <span
            v-for="color in store.activeColors"
            :key="color"
            class="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-inset py-1 ps-1 pe-2"
          >
            <span class="h-5 w-5 rounded-full border border-white/20" :style="{ background: color }"></span>
            <button
              class="cursor-pointer text-zinc-400 disabled:cursor-not-allowed"
              type="button"
              :aria-label="t('ranking.style.removeColor', { color })"
              :disabled="store.activeColors.length <= 1"
              @click="store.removePaletteColor(color)"
            >
              <X :size="12" />
            </button>
          </span>
        </div>
        <div class="flex flex-wrap gap-2">
          <label class="btn cursor-pointer btn-ghost">
            <input type="color" value="#ffffff" :aria-label="t('ranking.style.addColor')" @change="onAddPaletteColor" />
            {{ t('ranking.style.addColor') }}
          </label>
          <button v-if="store.colorSets.length > 1" class="btn cursor-pointer btn-danger" type="button" @click="store.removeColorSet(store.activeColorSetId)">
            <Trash2 :size="16" />
            {{ t('ranking.style.deleteSet') }}
          </button>
          <button class="btn cursor-pointer btn-ghost" type="button" @click="store.resetColorSets">{{ t('ranking.style.resetDefaults') }}</button>
        </div>
    </SettingsAccordion>

    <SettingsAccordion v-show="showLook" :title="t('ranking.style.titleSection')">
        <div class="flex items-center justify-between text-xs text-zinc-300">
          <span>{{ t('ranking.style.showTitle') }}</span>
          <ToggleSwitch v-model="store.style.banner.visible" :aria-label="t('ranking.style.showTitle')" />
        </div>
        <p v-if="store.style.banner.visible === false" class="text-xs leading-relaxed text-zinc-500">{{ t('ranking.style.titleHiddenHint') }}</p>
        <template v-if="store.style.banner.visible !== false">
          <textarea
            class="field min-h-20 resize-y"
            :value="store.titleText"
            maxlength="180"
            @input="store.setTitleText(($event.target as HTMLTextAreaElement).value)"
          ></textarea>
          <p class="text-xs text-zinc-500">{{ t('ranking.style.titleLinesHint') }}</p>
          <div class="flex flex-wrap gap-2">
            <template v-for="(span, index) in store.spans" :key="span.id">
              <span v-if="span.breakBefore" class="basis-full"></span>
              <div class="chip cursor-pointer" :class="activeWord?.id === span.id ? 'ring-2 ring-brand' : ''" @click="wordIndex = index">
                <span>{{ span.text }}</span>
                <input
                  type="color"
                  :value="span.color"
                  :aria-label="t('ranking.style.customColorForWord', { word: span.text })"
                  @input="store.setSpanColor(index, ($event.target as HTMLInputElement).value)"
                />
              </div>
            </template>
          </div>
          <div v-if="activeWord" class="space-y-2">
            <p class="text-xs text-zinc-500">{{ t('ranking.style.colorSetForWord', { word: activeWord.text }) }}</p>
            <ColorSwatches :model-value="activeWord.color" @pick="onWordColor" />
          </div>
          <ColorField v-model="store.style.banner.background" :label="t('ranking.style.bannerBackground')" />
          <label class="block text-xs text-zinc-400">
            {{ t('ranking.style.font') }}
            <select v-model="store.style.banner.fontFamily" class="field mt-1">
              <option v-for="font in FONT_OPTIONS" :key="font" :value="font">{{ font }}</option>
            </select>
          </label>
          <label class="block text-xs text-zinc-400">
            {{ t('ranking.style.weight') }}
            <select v-model.number="store.style.banner.fontWeight" class="field mt-1">
              <option :value="400">{{ t('ranking.style.weightRegular') }}</option>
              <option :value="500">{{ t('ranking.style.weightMedium') }}</option>
              <option :value="700">{{ t('ranking.style.weightBold') }}</option>
              <option :value="800">{{ t('ranking.style.weightExtraBold') }}</option>
            </select>
          </label>
          <div class="flex gap-2">
            <button
              v-for="align in aligns"
              :key="align.id"
              class="btn cursor-pointer flex-1"
              :class="store.style.banner.align === align.id ? 'btn-primary' : 'btn-ghost'"
              type="button"
              :aria-label="align.label"
              :title="align.label"
              @click="store.style.banner.align = align.id"
            >
              <component :is="align.icon" :size="16" />
            </button>
          </div>
          <SliderField v-model="store.style.banner.fontSize" :label="t('ranking.style.fontSize')" :min="28" :max="140" suffix="px" />
          <SliderField :label="t('ranking.style.bannerHeight')" :model-value="metrics.bannerHeight" :min="80" :max="bannerLimit" :step="2" suffix="px" @update:model-value="onBannerHeight" />
          <SliderField v-model="store.style.banner.lineHeight" :label="t('ranking.style.lineSpacing')" :min="0.9" :max="1.6" :step="0.01" />
          <SliderField v-model="store.style.banner.outlineWidth" :label="t('ranking.style.textOutline')" :min="0" :max="12" suffix="px" />
          <ColorField v-model="store.style.banner.outlineColor" :label="t('ranking.style.outlineColor')" />
          <div class="flex items-center justify-between text-xs text-zinc-300">
            <span>{{ t('ranking.style.textShadow') }}</span>
            <ToggleSwitch v-model="store.style.banner.shadow" :aria-label="t('ranking.style.textShadow')" />
          </div>
        </template>
    </SettingsAccordion>

    <SettingsAccordion v-show="showLook" :title="t('ranking.style.rankingSection')">
        <div class="flex items-center justify-between text-xs text-zinc-300">
          <span>{{ t('ranking.style.showRankingNumbers') }}</span>
          <ToggleSwitch v-model="store.style.ranking.visible" :aria-label="t('ranking.style.showRankingNumbers')" />
        </div>
        <div class="flex items-center justify-between text-xs text-zinc-300">
          <span>{{ t('ranking.style.showClipTitles') }}</span>
          <ToggleSwitch v-model="store.style.caption.enabled" :aria-label="t('ranking.style.showClipTitles')" />
        </div>
        <div v-if="store.style.caption.enabled" class="flex items-center justify-between text-xs text-zinc-300">
          <span>{{ t('ranking.style.showPreviousTitles') }}</span>
          <ToggleSwitch v-model="store.style.ranking.showPreviousTitles" :aria-label="t('ranking.style.showPreviousTitles')" />
        </div>
        <p v-if="store.style.caption.enabled" class="text-xs leading-relaxed text-zinc-500">{{ t('ranking.style.previousTitlesHint') }}</p>
        <div v-if="store.style.caption.enabled" class="flex items-center justify-between text-xs text-zinc-300">
          <span>{{ t('ranking.style.hideTitleAfter') }}</span>
          <ToggleSwitch
            :model-value="store.style.ranking.titleHideAfter > 0"
            :aria-label="t('ranking.style.hideTitleAfter')"
            @update:model-value="setTitleHideAfterEnabled"
          />
        </div>
        <SliderField
          v-if="store.style.caption.enabled && store.style.ranking.titleHideAfter > 0"
          v-model="store.style.ranking.titleHideAfter"
          :label="t('ranking.style.hideAfter')"
          :min="0.5"
          :max="30"
          :step="0.5"
          suffix="s"
        />
        <p v-if="store.style.caption.enabled && store.style.ranking.titleHideAfter > 0" class="text-xs leading-relaxed text-zinc-500">
          {{ t('ranking.style.hideTitleHint') }}
        </p>
        <p
          v-if="!store.style.ranking.visible && !store.style.caption.enabled"
          class="text-xs leading-relaxed text-zinc-500"
        >
          {{ t('ranking.style.rankingHiddenHint') }}
        </p>
        <template v-if="store.style.ranking.visible">
          <ColorField v-model="store.style.ranking.color" :label="t('ranking.style.numberColor')" />
          <button class="btn cursor-pointer btn-ghost px-2 py-1" type="button" @click="store.cycleRankColors">
            <Palette :size="16" />
            {{ t('ranking.style.cycleAcrossClips') }}
          </button>
          <label class="block text-xs text-zinc-400">
            {{ t('ranking.style.font') }}
            <select v-model="store.style.ranking.fontFamily" class="field mt-1">
              <option v-for="font in FONT_OPTIONS" :key="font" :value="font">{{ font }}</option>
            </select>
          </label>
          <label class="block text-xs text-zinc-400">
            {{ t('ranking.style.format') }}
            <select v-model="store.style.ranking.format" class="field mt-1">
              <option value="dot">1.</option>
              <option value="plain">1</option>
              <option value="hash">#1</option>
              <option value="pad">01</option>
            </select>
          </label>
          <SliderField v-model="store.style.ranking.fontSize" :label="t('ranking.style.numberSize')" :min="36" :max="360" suffix="px" />
          <SliderField v-model="store.style.ranking.outlineWidth" :label="t('ranking.style.outline')" :min="0" :max="28" suffix="px" />
          <ColorField v-model="store.style.ranking.outlineColor" :label="t('ranking.style.outlineColor')" />
          <SliderField v-model="store.style.ranking.opacity" :label="t('ranking.style.opacity')" :min="0.2" :max="1" :step="0.05" />
          <div class="flex items-center justify-between text-xs text-zinc-300">
            <span>{{ t('ranking.style.numberShadow') }}</span>
            <ToggleSwitch v-model="store.style.ranking.shadow" :aria-label="t('ranking.style.numberShadow')" />
          </div>
        </template>
        <template v-if="store.style.ranking.visible || store.style.caption.enabled">
          <label class="block text-xs text-zinc-400">
            {{ t('ranking.style.sortRanking') }}
            <select v-model="store.style.ranking.sort" class="field mt-1">
              <option value="list">{{ t('ranking.style.sortAsListed') }}</option>
              <option value="reverse">{{ t('ranking.style.sortReverse') }}</option>
              <option value="title">{{ t('ranking.style.sortTitleAz') }}</option>
              <option value="titleDesc">{{ t('ranking.style.sortTitleZa') }}</option>
            </select>
          </label>
          <p class="text-xs leading-relaxed text-zinc-500">{{ t('ranking.style.sortHint') }}</p>
          <SliderField v-model="store.style.ranking.itemSpacing" :label="t('ranking.style.itemSpacing')" :min="0" :max="100" suffix="%" />
          <SliderField v-model="store.style.ranking.positionX" :label="t('ranking.style.leftPosition')" :min="0" :max="Math.round(store.style.video.width * 0.7)" suffix="px" />
          <SliderField v-model="store.style.ranking.positionY" :label="t('ranking.style.topPosition')" :min="0" :max="Math.round(layoutMetrics.videoHeight * 0.95)" suffix="px" />
        </template>
        <template v-if="store.style.caption.enabled">
          <SliderField v-model="store.style.caption.fontSize" :label="t('ranking.style.clipTitleSize')" :min="18" :max="90" suffix="px" />
          <p class="text-xs leading-relaxed text-zinc-500">{{ t('ranking.style.perClipTitleColor') }}</p>
        </template>
    </SettingsAccordion>

    <SettingsAccordion v-show="showOutput" :title="t('ranking.style.videoSection')" open>
        <label class="block text-xs text-zinc-400">
          {{ t('ranking.style.output') }}
          <select class="field mt-1" :value="`${store.style.video.width}x${store.style.video.height}`" @change="onResolution">
            <option v-for="output in OUTPUTS" :key="output.label" :value="`${output.width}x${output.height}`">{{ t('ranking.style.outputAspect', { label: output.label }) }}</option>
          </select>
        </label>
        <label class="block text-xs text-zinc-400">
          {{ t('ranking.style.frameRate') }}
          <select v-model.number="store.style.video.fps" class="field mt-1">
            <option v-for="fps in FRAME_RATES" :key="fps" :value="fps">{{ t('ranking.style.fpsSuffix', { fps }) }}</option>
          </select>
        </label>
        <label class="block text-xs text-zinc-400">
          {{ t('ranking.style.scaling') }}
          <select v-model="store.style.video.scaleMode" class="field mt-1">
            <option value="crop">{{ t('ranking.style.scaleCrop') }}</option>
            <option value="fit">{{ t('ranking.style.scaleFit') }}</option>
            <option value="blur">{{ t('ranking.style.scaleBlur') }}</option>
          </select>
        </label>
        <ColorField v-if="store.style.video.scaleMode !== 'crop'" v-model="store.style.video.backgroundColor" :label="t('ranking.style.paddingColor')" />
        <label class="block text-xs text-zinc-400">
          {{ t('ranking.style.transition') }}
          <select v-model="store.style.video.transition" class="field mt-1">
            <option value="cut">{{ t('ranking.style.transitionCut') }}</option>
            <option value="fade">{{ t('ranking.style.transitionFade') }}</option>
          </select>
        </label>
        <SliderField
          v-if="store.style.video.transition === 'fade'"
          v-model="store.style.video.fadeDuration"
          :label="t('ranking.style.crossfade')"
          :min="0.1"
          :max="1"
          :step="0.05"
          suffix="s"
        />
    </SettingsAccordion>

    <SettingsAccordion v-show="showSound" :title="t('ranking.style.audioSection')" open>
      <SourceClipAudioControls
        v-model:keep-audio="store.style.video.keepAudio"
        v-model:normalize="store.style.video.normalize"
        v-model:original-volume="store.style.video.originalVolume"
      />
      <div class="space-y-2 border-t border-zinc-800 pt-3">
        <p class="section-label">{{ t('ranking.style.backgroundMusic') }}</p>
        <AudioFileField
          :file-name="store.musicName"
          :file-size="store.musicFileSize"
          :preview-url="store.musicUrl"
          :label="t('ranking.style.dropAudio')"
          :drop-label="t('common.dropHere')"
          :replace-label="t('ranking.style.dropNewAudio')"
          :replace-drop-label="t('ranking.style.dropToReplaceAudio')"
          :background-audio-label="t('ranking.style.backgroundAudioName')"
          :remove-audio-label="t('ranking.style.removeAudio')"
          @files="onMusicFiles"
          @clear="store.setMusic(null)"
        />
        <AdvancedAudioControls
          v-if="store.musicName"
          v-model:volume="store.style.video.musicVolume"
          v-model:fade-in="store.style.video.musicFadeIn"
          v-model:fade-out="store.style.video.musicFadeOut"
          :volume-label="t('ranking.style.musicVolume')"
          :fade-in-label="t('ranking.style.fadeIn')"
          :fade-out-label="t('ranking.style.fadeOut')"
          volume-as-percent
          :show-loop="false"
        />
      </div>
    </SettingsAccordion>
  </aside>
</template>
