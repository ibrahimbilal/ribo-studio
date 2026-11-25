import {
  aspectRatio,
  clampComposition,
  compositionForFit,
  cropForAspect,
  defaultComposition,
  placementForFit,
  sanitizeComposition,
  type CropAspect,
  type ScreensaverComposition,
} from '@shared/screensaverComposition'
import { FRAME_FILE_LIMIT, isBuiltinFrameId, NONE_FRAME_ID } from '@shared/screensaverFrames'
import { THUMBNAIL_CANVAS_COLOR, type ThumbnailDocument } from '@shared/thumbnailProject'
import { computed, ref, watch, type Ref } from 'vue'
import * as api from '../../../lib/api'
import { storeImageBlob } from '../lib/assetStore'
import { frameImageUrl } from '../../frame-screensaver/lib/frameImageUrl'

async function fileIsPng(file: File): Promise<boolean> {
  if (file.type === 'image/png') return true
  const slice = file.slice(0, 8)
  const buffer = await slice.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  return signature.every((byte, index) => bytes[index] === byte)
}

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not load image.'))
    image.src = url
  })
}

function cloneComposition(value: ScreensaverComposition): ScreensaverComposition {
  return JSON.parse(JSON.stringify(value)) as ScreensaverComposition
}

export interface ThumbnailEditorSliceOptions {
  doc: Ref<ThumbnailDocument>
  hasImage: Ref<boolean>
  hydrated: Ref<boolean>
  edit: (mutator: (draft: ThumbnailDocument) => void) => void
  scheduleSave: () => void
  toast: (message: string, tone?: 'info' | 'success' | 'error') => void
  refreshObjectUrl: () => Promise<void>
}

export function createThumbnailEditorSlice(options: ThumbnailEditorSliceOptions) {
  const { doc, hasImage, hydrated, edit, scheduleSave, toast, refreshObjectUrl } = options

  const cropEditing = ref(false)
  const previewInteracting = ref(false)
  const compareAdjustments = ref(false)
  const frames = ref<api.ScreensaverFrame[]>([])
  const framesLoaded = ref(false)
  const frameUploading = ref(false)
  const frameImage = ref<HTMLImageElement | null>(null)
  const objectUrl = ref<string | null>(null)
  const history = ref<ScreensaverComposition[]>([])
  const historyIndex = ref(-1)
  let frameImageToken = 0
  let objectUrlValue: string | null = null

  const outputWidth = computed(() => doc.value.export.width)
  const outputHeight = computed(() => doc.value.export.height)
  const mediaKind = computed(() => (hasImage.value ? ('image' as const) : null))
  const sourceWidth = computed(() => doc.value.image.sourceWidth)
  const sourceHeight = computed(() => doc.value.image.sourceHeight)

  const composition = computed<ScreensaverComposition>(() => {
    const existing = sanitizeComposition(doc.value.image.composition)
    if (existing) return existing
    if (!hasImage.value || sourceWidth.value < 1 || sourceHeight.value < 1) {
      return defaultComposition()
    }
    return compositionForFit(
      doc.value.image.fit === 'cover' ? 'cover' : 'contain',
      sourceWidth.value,
      sourceHeight.value,
      outputWidth.value,
      outputHeight.value,
      THUMBNAIL_CANVAS_COLOR,
    )
  })

  const selectedFrameId = computed(() => {
    const fromComposition = composition.value.frameId
    if (fromComposition && fromComposition !== NONE_FRAME_ID) return fromComposition
    return doc.value.image.frameAssetId ? '__asset__' : NONE_FRAME_ID
  })

  function resetHistory(next: ScreensaverComposition): void {
    history.value = [cloneComposition(next)]
    historyIndex.value = 0
  }

  function ensureCompositionInDoc(): void {
    if (sanitizeComposition(doc.value.image.composition)) return
    if (!hasImage.value) return
    const next = composition.value
    edit((draft) => {
      draft.image.composition = cloneComposition(next)
      draft.image.fit = 'cover'
    })
    resetHistory(next)
  }

  function replaceComposition(value: ScreensaverComposition): void {
    const next = clampComposition({
      ...composition.value,
      ...value,
      adjustments: { ...composition.value.adjustments, ...value.adjustments },
      background: { ...composition.value.background, ...value.background },
      crop: { ...composition.value.crop, ...value.crop },
    })
    edit((draft) => {
      draft.image.composition = cloneComposition(next)
    })
  }

  function commitComposition(): void {
    ensureCompositionInDoc()
    const next = cloneComposition(composition.value)
    const stack = history.value.slice(0, historyIndex.value + 1)
    const last = stack[stack.length - 1]
    if (last && JSON.stringify(last) === JSON.stringify(next)) return
    stack.push(next)
    history.value = stack.slice(-50)
    historyIndex.value = history.value.length - 1
    scheduleSave()
  }

  function undo(): void {
    if (historyIndex.value <= 0) return
    historyIndex.value -= 1
    const snap = history.value[historyIndex.value]!
    edit((draft) => {
      draft.image.composition = cloneComposition(snap)
    })
    scheduleSave()
  }

  function redo(): void {
    if (historyIndex.value >= history.value.length - 1) return
    historyIndex.value += 1
    const snap = history.value[historyIndex.value]!
    edit((draft) => {
      draft.image.composition = cloneComposition(snap)
    })
    scheduleSave()
  }

  function fitContain(): void {
    ensureCompositionInDoc()
    const placement = placementForFit(
      'contain',
      sourceWidth.value || 1,
      sourceHeight.value || 1,
      outputWidth.value,
      outputHeight.value,
      composition.value.crop,
    )
    replaceComposition({ ...composition.value, ...placement })
    commitComposition()
  }

  function fitCover(): void {
    ensureCompositionInDoc()
    const placement = placementForFit(
      'cover',
      sourceWidth.value || 1,
      sourceHeight.value || 1,
      outputWidth.value,
      outputHeight.value,
      composition.value.crop,
    )
    replaceComposition({
      ...composition.value,
      ...placement,
      background: { ...composition.value.background, mode: 'color' },
    })
    commitComposition()
  }

  function centerHorizontal(): void {
    replaceComposition({ ...composition.value, x: (1 - composition.value.width) / 2 })
    commitComposition()
  }

  function centerVertical(): void {
    replaceComposition({ ...composition.value, y: (1 - composition.value.height) / 2 })
    commitComposition()
  }

  function resetTransform(): void {
    replaceComposition({
      ...composition.value,
      ...placementForFit(
        'contain',
        sourceWidth.value || 1,
        sourceHeight.value || 1,
        outputWidth.value,
        outputHeight.value,
        composition.value.crop,
      ),
      rotation: 0,
      flipH: false,
      flipV: false,
      opacity: 1,
    })
    commitComposition()
  }

  function setCropAspect(aspect: CropAspect, mediaW: number, mediaH: number): void {
    if (aspect === 'free') {
      replaceComposition({ ...composition.value, cropAspect: aspect })
      commitComposition()
      return
    }
    const ratio = aspectRatio(aspect, mediaW, mediaH, composition.value.customAspectW, composition.value.customAspectH)
    if (!ratio || mediaW < 1 || mediaH < 1) {
      replaceComposition({ ...composition.value, cropAspect: aspect })
      commitComposition()
      return
    }
    replaceComposition({
      ...composition.value,
      cropAspect: aspect,
      crop: cropForAspect(ratio * (mediaH / mediaW)),
    })
    commitComposition()
  }

  function resetCrop(): void {
    replaceComposition({ ...composition.value, crop: { x: 0, y: 0, w: 1, h: 1 }, cropAspect: 'free' })
    commitComposition()
  }

  function cropRatio(sourceW: number, sourceH: number): number | null {
    return aspectRatio(
      composition.value.cropAspect,
      sourceW,
      sourceH,
      composition.value.customAspectW,
      composition.value.customAspectH,
    )
  }

  function setPreviewInteracting(active: boolean): void {
    previewInteracting.value = active
  }

  async function syncFramePreview(frameId: string): Promise<void> {
    const token = ++frameImageToken
    if (!frameId || frameId === NONE_FRAME_ID) {
      frameImage.value = null
      return
    }
    try {
      const image = await loadHtmlImage(frameImageUrl(frameId))
      if (token !== frameImageToken) return
      frameImage.value = image
    } catch {
      if (token !== frameImageToken) return
      frameImage.value = null
    }
  }

  async function persistFrameAsset(frameId: string): Promise<void> {
    if (frameId === NONE_FRAME_ID) {
      edit((draft) => {
        draft.image.frameAssetId = null
      })
      await syncFramePreview(NONE_FRAME_ID)
      scheduleSave()
      return
    }
    try {
      const response = await fetch(frameImageUrl(frameId))
      if (!response.ok) throw new Error('The frame could not be loaded.')
      const blob = await response.blob()
      const name = isBuiltinFrameId(frameId) ? `frame-${frameId}` : `frame-${frameId.slice(0, 8)}.png`
      const asset = await storeImageBlob(blob, name, doc.value.id)
      edit((draft) => {
        draft.image.frameAssetId = asset.id
      })
      await syncFramePreview(frameId)
      scheduleSave()
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The frame could not be loaded.')
    }
  }

  async function loadFrames(): Promise<void> {
    if (framesLoaded.value) return
    try {
      frames.value = await api.listScreensaverFrames()
      framesLoaded.value = true
    } catch {
      frames.value = []
      framesLoaded.value = true
    }
  }

  async function uploadFrames(files: File[]): Promise<void> {
    if (frameUploading.value || files.length === 0) return
    frameUploading.value = true
    let lastUploadedId: string | null = null
    try {
      for (const file of files) {
        if (!(await fileIsPng(file))) {
          toast(`${file.name} is not a PNG file.`)
          continue
        }
        if (file.size > FRAME_FILE_LIMIT) {
          toast(`${file.name} is larger than ${FRAME_FILE_LIMIT / (1024 * 1024)} MB.`)
          continue
        }
        const saved = await api.uploadScreensaverFrame(file)
        frames.value = [saved, ...frames.value.filter((frame) => frame.id !== saved.id)]
        framesLoaded.value = true
        lastUploadedId = saved.id
      }
      if (lastUploadedId) {
        ensureCompositionInDoc()
        replaceComposition({ ...composition.value, frameId: lastUploadedId })
        commitComposition()
        await persistFrameAsset(lastUploadedId)
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The frame could not be uploaded.')
    } finally {
      frameUploading.value = false
    }
  }

  async function selectFrame(id: string): Promise<void> {
    ensureCompositionInDoc()
    const frameId = composition.value.frameId === id ? NONE_FRAME_ID : id
    replaceComposition({ ...composition.value, frameId })
    commitComposition()
    await persistFrameAsset(frameId)
  }

  function clearSelectedFrame(frameId: string): void {
    if (composition.value.frameId !== frameId) return
    void selectFrame(frameId)
  }

  async function removeFrame(id: string): Promise<void> {
    try {
      await api.deleteScreensaverFrame(id)
      frames.value = frames.value.filter((frame) => frame.id !== id)
      if (composition.value.frameId === id) {
        replaceComposition({ ...composition.value, frameId: NONE_FRAME_ID })
        commitComposition()
        await persistFrameAsset(NONE_FRAME_ID)
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The frame could not be removed.')
    }
  }

  function onProjectLoaded(): void {
    const comp = sanitizeComposition(doc.value.image.composition)
    if (comp) {
      resetHistory(comp)
      void syncFramePreview(comp.frameId)
    } else if (hasImage.value) {
      ensureCompositionInDoc()
      void syncFramePreview(composition.value.frameId)
    } else {
      history.value = []
      historyIndex.value = -1
      frameImage.value = null
    }
    void refreshObjectUrl()
  }

  watch(
    () => doc.value.image.assetId,
    () => {
      void refreshObjectUrl()
    },
  )

  watch(
    () => composition.value.frameId,
    (frameId) => {
      void syncFramePreview(frameId)
    },
  )

  watch(
    () => [outputWidth.value, outputHeight.value] as const,
    () => {
      if (!hasImage.value) return
      ensureCompositionInDoc()
    },
  )

  async function setObjectUrlFromAsset(assetId: string | null): Promise<void> {
    if (objectUrlValue) {
      URL.revokeObjectURL(objectUrlValue)
      objectUrlValue = null
    }
    objectUrl.value = null
    if (!assetId) return
    const { getImageAsset } = await import('../../../lib/idb')
    const asset = await getImageAsset(assetId)
    if (!asset) return
    objectUrlValue = URL.createObjectURL(asset.blob)
    objectUrl.value = objectUrlValue
  }

  return {
    cropEditing,
    previewInteracting,
    compareAdjustments,
    frames,
    framesLoaded,
    frameUploading,
    frameImage,
    objectUrl,
    outputWidth,
    outputHeight,
    mediaKind,
    sourceWidth,
    sourceHeight,
    composition,
    selectedFrameId,
    ensureCompositionInDoc,
    replaceComposition,
    commitComposition,
    undo,
    redo,
    fitContain,
    fitCover,
    centerHorizontal,
    centerVertical,
    resetTransform,
    setCropAspect,
    resetCrop,
    cropRatio,
    setPreviewInteracting,
    loadFrames,
    uploadFrames,
    selectFrame,
    clearSelectedFrame,
    removeFrame,
    onProjectLoaded,
    setObjectUrlFromAsset,
  }
}