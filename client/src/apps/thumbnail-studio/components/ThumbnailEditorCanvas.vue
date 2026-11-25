<script setup lang="ts">
import {
  AlignHorizontalJustifyCenter,
  AlignVerticalJustifyCenter,
  Check,
  Crop,
  Expand,
  Redo2,
  RefreshCw,
  RotateCcw,
  Scan,
  Shrink,
  Undo2,
  ZoomIn,
  ZoomOut,
} from '@lucide/vue'
import type { BadgeId } from '@shared/thumbnailProject'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useScreensaverDrawScheduler } from '../../frame-screensaver/composables/useScreensaverDrawScheduler'
import { imageContains } from '../../frame-screensaver/lib/composeCanvas'
import { createCanvas2DScreensaverRenderer } from '../../frame-screensaver/lib/render/createScreensaverRenderer'
import type { ScreensaverImageRenderer, ScreensaverRenderInput } from '../../frame-screensaver/lib/render/types'
import { S } from '../../frame-screensaver/lib/screensaverI18n'
import { useThumbnailStore } from '../stores/thumbnail'
import { BRAND } from '../../../lib/brand'
import { useI18n } from '../../../i18n'
import ThumbnailBadge from './ThumbnailBadge.vue'

const store = useThumbnailStore()
const { t } = useI18n()
const badgeIds = ['resolution', 'duration'] as const
const dragging = ref<BadgeId | null>(null)
const badgeShell = ref<HTMLElement | null>(null)
let badgeDrag: { id: BadgeId; grabX: number; grabY: number } | null = null
const shell = ref<HTMLElement | null>(null)
const shellHeight = ref(180)
const displaySize = ref({ width: 640, height: 360 })
const desktopPreview = ref(false)
let desktopPreviewMq: MediaQueryList | null = null

function syncDesktopPreview(): void {
  desktopPreview.value = desktopPreviewMq?.matches ?? false
}

function previewPixelSize(boxW: number, boxH: number): { width: number; height: number } {
  const outW = Math.max(1, store.outputWidth)
  const outH = Math.max(1, store.outputHeight)
  const aspect = outH / outW
  const widthCap = Math.max(240, boxW)
  if (!desktopPreview.value || boxH < 120) {
    const height = Math.round(widthCap * aspect)
    return { width: widthCap, height }
  }
  let width = widthCap
  let height = Math.round(width * aspect)
  if (height > boxH) {
    height = Math.max(180, boxH)
    width = Math.round(height / aspect)
  }
  return { width, height }
}
const previewCanvas = ref<HTMLCanvasElement | null>(null)
/** New DOM canvas per backend switch (WebGL and 2D cannot share one canvas). */
const previewCanvasKey = ref(0)
const overlayCanvas = ref<HTMLCanvasElement | null>(null)
const media = ref<CanvasImageSource | null>(null)
const mediaWidth = ref(0)
const mediaHeight = ref(0)
const selected = ref(false)
const zoom = ref(1)
const panX = ref(0)
const panY = ref(0)
let renderer: ScreensaverImageRenderer | null = null
const scheduler = useScreensaverDrawScheduler(() => renderer)
async function remountPreviewRenderer(): Promise<void> {
  scheduler.cancel()
  renderer?.dispose()
  renderer = null
  previewCanvasKey.value += 1
  await nextTick()
  await mountRenderer()
  resize()
}

async function mountRenderer(): Promise<void> {
  const preview = previewCanvas.value
  if (!preview) return
  renderer = await createCanvas2DScreensaverRenderer(preview)
  if (shell.value) {
    const { width, height } = previewPixelSize(shell.value.clientWidth, shell.value.clientHeight)
    shellHeight.value = height
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    renderer.resize(width, height, Math.round(width * ratio), Math.round(height * ratio))
  }
  draw()
}
let gesture: null | { kind: 'move' | 'scale' | 'rotate'; startX: number; startY: number; originX: number; originY: number; originW: number; originH: number; originRot: number; startAngle: number } = null
let cropGesture: null | { kind: 'move' | 'resize'; handle: string; start: { x: number; y: number; w: number; h: number }; pointer: { x: number; y: number } } = null
let pointers = new Map<number, { x: number; y: number }>()
let pinch: { dist: number; zoom: number } | null = null

const cropAspects = computed(
  () =>
    [
      ['free', t(S('canvas.cropAspects.free'))],
      ['16:9', t(S('canvas.cropAspects.r169'))],
      ['4:3', t(S('canvas.cropAspects.r43'))],
      ['3:2', t(S('canvas.cropAspects.r32'))],
      ['1:1', t(S('canvas.cropAspects.r11'))],
      ['original', t(S('canvas.cropAspects.original'))],
      ['custom', t(S('canvas.cropAspects.custom'))],
    ] as const,
)

const viewLabel = computed(() => `${Math.round(zoom.value * 100)}%`)
const badgeFrameWidth = computed(() => {
  const overlay = overlayCanvas.value
  if (!overlay) return 640
  const rect = overlay.getBoundingClientRect()
  return Math.max(1, rect.width)
})

function drawPreviewOverlayContents(ctx: CanvasRenderingContext2D, element: HTMLCanvasElement) {
  drawOutputFrameBorder(ctx, element)
  if (selected.value && media.value) drawHandles(ctx, element)
}

let mediaLoadId = 0

function loadMedia(url: string | null) {
  const loadId = ++mediaLoadId
  media.value = null
  mediaWidth.value = 0
  mediaHeight.value = 0
  selected.value = false
  if (!url) {
    resetView()
    draw()
    return
  }
  const image = new Image()
  image.onload = () => {
    if (loadId !== mediaLoadId) return
    media.value = image
    mediaWidth.value = image.naturalWidth
    mediaHeight.value = image.naturalHeight
    if (store.hasImage) store.ensureCompositionInDoc()
    draw()
  }
  image.src = url
}

function badgePoint(event: PointerEvent): { x: number; y: number } | null {
  const rect = badgeShell.value?.getBoundingClientRect()
  if (!rect || rect.width < 1 || rect.height < 1) return null
  return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }
}

function onBadgePointerDown(id: BadgeId, event: PointerEvent): void {
  const shellEl = badgeShell.value
  const target = event.currentTarget as HTMLElement | null
  if (!shellEl || !target) return
  const shellRect = shellEl.getBoundingClientRect()
  const badgeRect = target.getBoundingClientRect()
  const at = badgePoint(event)
  if (!at) return
  const centerX = (badgeRect.left + badgeRect.width / 2 - shellRect.left) / shellRect.width
  const centerY = (badgeRect.top + badgeRect.height / 2 - shellRect.top) / shellRect.height
  badgeDrag = { id, grabX: at.x - centerX, grabY: at.y - centerY }
  dragging.value = id
  target.setPointerCapture(event.pointerId)
  event.preventDefault()
}

function onBadgePointerMove(event: PointerEvent): void {
  if (!badgeDrag) return
  const at = badgePoint(event)
  if (!at) return
  store.moveBadge(badgeDrag.id, at.x - badgeDrag.grabX, at.y - badgeDrag.grabY)
}

function onBadgePointerUp(): void {
  badgeDrag = null
  dragging.value = null
}

function resize() {
  const preview = previewCanvas.value
  const overlay = overlayCanvas.value
  const host = shell.value
  if (!preview || !overlay || !host) return
  const { width, height } = previewPixelSize(host.clientWidth, host.clientHeight)
  shellHeight.value = height
  displaySize.value = { width, height }
  const ratio = Math.min(2, window.devicePixelRatio || 1)
  const pixelWidth = Math.round(width * ratio)
  const pixelHeight = Math.round(height * ratio)
  for (const element of [preview, overlay]) {
    element.style.width = `${width}px`
    element.style.height = `${height}px`
    element.width = pixelWidth
    element.height = pixelHeight
  }
  renderer?.resize(width, height, pixelWidth, pixelHeight)
  draw()
}

function buildRenderInput(): ScreensaverRenderInput {
  return {
    composition: store.composition,
    compareAdjustments: store.compareAdjustments,
    frame: store.frameImage,
    source: media.value,
    sourceWidth: mediaWidth.value,
    sourceHeight: mediaHeight.value,
    view: { panX: panX.value, panY: panY.value, zoom: zoom.value },
    previewReducedQuality: store.previewInteracting ?? false,
  }
}

function draw() {
  const preview = previewCanvas.value
  const overlay = overlayCanvas.value
  if (!preview || !overlay) return
  const octx = overlay.getContext('2d')
  if (!octx) return
  octx.setTransform(1, 0, 0, 1, 0, 0)
  octx.clearRect(0, 0, overlay.width, overlay.height)
  if (store.cropEditing && media.value) {
    const pctx = preview.getContext('2d')
    pctx?.clearRect(0, 0, preview.width, preview.height)
    drawCrop(octx, overlay)
    return
  }
  scheduler.scheduleDraw(() => buildRenderInput(), () => {
    const ctx = overlay.getContext('2d')
    if (!ctx) return
    drawPreviewOverlayContents(ctx, overlay)
  })
}

function drawOutputFrameBorder(ctx: CanvasRenderingContext2D, element: HTMLCanvasElement) {
  const corners = [
    forward(0, 0, element),
    forward(1, 0, element),
    forward(1, 1, element),
    forward(0, 1, element),
  ]
  const w = element.width
  const h = element.height
  const viewChanged =
    Math.abs(zoom.value - 1) > 0.004 || Math.abs(panX.value) > 0.001 || Math.abs(panY.value) > 0.001

  if (viewChanged) {
    ctx.save()
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)'
    ctx.beginPath()
    ctx.rect(0, 0, w, h)
    ctx.moveTo(corners[0].x, corners[0].y)
    for (let i = 1; i < corners.length; i += 1) ctx.lineTo(corners[i].x, corners[i].y)
    ctx.closePath()
    ctx.fill('evenodd')
    ctx.restore()
  }

  ctx.save()
  ctx.strokeStyle = '#F4320B'
  ctx.lineWidth = Math.max(2, Math.round(Math.min(w, h) / 360))
  ctx.setLineDash([10, 8])
  ctx.beginPath()
  corners.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)))
  ctx.closePath()
  ctx.stroke()
  ctx.restore()
}

function drawCrop(ctx: CanvasRenderingContext2D, element: HTMLCanvasElement) {
  const box = sourceBox(element)
  ctx.fillStyle = '#101114'
  ctx.fillRect(0, 0, element.width, element.height)
  if (media.value) ctx.drawImage(media.value, box.x, box.y, box.w, box.h)
  const crop = store.composition.crop
  const rect = {
    x: box.x + crop.x * box.w,
    y: box.y + crop.y * box.h,
    w: crop.w * box.w,
    h: crop.h * box.h,
  }
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(0, 0, element.width, element.height)
  ctx.save()
  ctx.beginPath()
  ctx.rect(rect.x, rect.y, rect.w, rect.h)
  ctx.clip()
  ctx.clearRect(rect.x, rect.y, rect.w, rect.h)
  if (media.value) ctx.drawImage(media.value, box.x, box.y, box.w, box.h)
  ctx.restore()
  ctx.strokeStyle = BRAND
  ctx.lineWidth = 2
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
}

function drawHandles(ctx: CanvasRenderingContext2D, element: HTMLCanvasElement) {
  const corners = imageCorners().map((point) => forward(point.x, point.y, element))
  ctx.strokeStyle = BRAND
  ctx.lineWidth = 2
  ctx.beginPath()
  corners.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)))
  ctx.closePath()
  ctx.stroke()
  for (const point of corners) {
    ctx.fillStyle = '#101114'
    ctx.strokeStyle = BRAND
    ctx.fillRect(point.x - 6, point.y - 6, 12, 12)
    ctx.strokeRect(point.x - 6, point.y - 6, 12, 12)
  }
  const top = forward(store.composition.x + store.composition.width / 2, store.composition.y, element)
  const knob = { x: top.x, y: top.y - 28 }
  ctx.beginPath()
  ctx.moveTo(top.x, top.y)
  ctx.lineTo(knob.x, knob.y)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(knob.x, knob.y, 7, 0, Math.PI * 2)
  ctx.fillStyle = BRAND
  ctx.fill()
}

function sourceBox(element: HTMLCanvasElement) {
  const scale = Math.min(element.width / mediaWidth.value, element.height / mediaHeight.value)
  const w = mediaWidth.value * scale
  const h = mediaHeight.value * scale
  return { x: (element.width - w) / 2, y: (element.height - h) / 2, w, h }
}

function imageCorners() {
  const composition = store.composition
  const cx = composition.x + composition.width / 2
  const cy = composition.y + composition.height / 2
  const hw = composition.width / 2
  const hh = composition.height / 2
  const rad = (composition.rotation * Math.PI) / 180
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([lx, ly]) => ({
    x: cx + lx * Math.cos(rad) - ly * Math.sin(rad),
    y: cy + lx * Math.sin(rad) + ly * Math.cos(rad),
  }))
}

function forward(nx: number, ny: number, element: HTMLCanvasElement) {
  const cx = element.width / 2
  const cy = element.height / 2
  return {
    x: (nx * element.width - cx) * zoom.value + cx + panX.value * element.width,
    y: (ny * element.height - cy) * zoom.value + cy + panY.value * element.height,
  }
}

function normFromEvent(event: PointerEvent): { x: number; y: number } | null {
  const element = overlayCanvas.value
  if (!element) return null
  const rect = element.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * element.width
  const y = ((event.clientY - rect.top) / rect.height) * element.height
  const cx = element.width / 2
  const cy = element.height / 2
  const px = (x - cx - panX.value * element.width) / zoom.value + cx
  const py = (y - cy - panY.value * element.height) / zoom.value + cy
  return { x: px / element.width, y: py / element.height }
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0 && event.pointerType === 'mouse') return
  store.setPreviewInteracting(true)
  shell.value?.focus()
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  if (pointers.size === 2) {
    pinch = { dist: pointerDistance(), zoom: zoom.value }
    gesture = null
    return
  }
  const element = overlayCanvas.value
  if (!element || !shell.value) return
  try {
    shell.value.setPointerCapture(event.pointerId)
  } catch {
    // A pointer that cannot be captured still delivers move and up through the shell.
  }
  if (store.cropEditing) {
    startCrop(event)
    return
  }
  const point = normFromEvent(event)
  if (!point) return
  const handle = hitHandle(event)
  if (handle === 'rotate') {
    const centerX = store.composition.x + store.composition.width / 2
    const centerY = store.composition.y + store.composition.height / 2
    gesture = {
      kind: 'rotate',
      startX: point.x,
      startY: point.y,
      originX: store.composition.x,
      originY: store.composition.y,
      originW: store.composition.width,
      originH: store.composition.height,
      originRot: store.composition.rotation,
      startAngle: Math.atan2(point.y - centerY, point.x - centerX),
    }
    selected.value = true
    return
  }
  if (handle === 'scale') {
    gesture = {
      kind: 'scale',
      startX: point.x,
      startY: point.y,
      originX: store.composition.x,
      originY: store.composition.y,
      originW: store.composition.width,
      originH: store.composition.height,
      originRot: store.composition.rotation,
      startAngle: 0,
    }
    selected.value = true
    return
  }
  if (imageContains(store.composition, point.x, point.y)) {
    selected.value = true
    gesture = {
      kind: 'move',
      startX: point.x,
      startY: point.y,
      originX: store.composition.x,
      originY: store.composition.y,
      originW: store.composition.width,
      originH: store.composition.height,
      originRot: store.composition.rotation,
      startAngle: 0,
    }
  }
}

function onPointerMove(event: PointerEvent) {
  if (!pointers.has(event.pointerId)) return
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  if (pinch && pointers.size >= 2) {
    const dist = pointerDistance()
    if (pinch.dist > 0) zoom.value = clamp(pinch.zoom * (dist / pinch.dist), 0.25, 4)
    draw()
    return
  }
  if (cropGesture) {
    moveCrop(event)
    return
  }
  if (!gesture) return
  const point = normFromEvent(event)
  if (!point) return
  const composition = { ...store.composition }
  if (gesture.kind === 'move') {
    composition.x = gesture.originX + (point.x - gesture.startX)
    composition.y = gesture.originY + (point.y - gesture.startY)
  } else if (gesture.kind === 'scale') {
    const centerX = gesture.originX + gesture.originW / 2
    const centerY = gesture.originY + gesture.originH / 2
    const start = Math.hypot(gesture.startX - centerX, gesture.startY - centerY) || 0.001
    const next = Math.hypot(point.x - centerX, point.y - centerY)
    const factor = clamp(next / start, 0.05, 8)
    composition.width = gesture.originW * factor
    composition.height = gesture.originH * factor
    composition.x = centerX - composition.width / 2
    composition.y = centerY - composition.height / 2
  } else {
    const centerX = gesture.originX + gesture.originW / 2
    const centerY = gesture.originY + gesture.originH / 2
    const angle = Math.atan2(point.y - centerY, point.x - centerX)
    let rotation = gesture.originRot + ((angle - gesture.startAngle) * 180) / Math.PI
    if (event.shiftKey) rotation = Math.round(rotation / 15) * 15
    composition.rotation = clamp(rotation, -180, 180)
  }
  store.replaceComposition(composition)
  draw()
}

function onPointerUp(event: PointerEvent) {
  pointers.delete(event.pointerId)
  if (pointers.size < 2) pinch = null
  if (gesture || cropGesture) store.commitComposition()
  gesture = null
  cropGesture = null
  if (pointers.size === 0) store.setPreviewInteracting(false)
}

function hitHandle(event: PointerEvent): 'scale' | 'rotate' | null {
  const element = overlayCanvas.value
  if (!element || !selected.value) return null
  const rect = element.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * element.width
  const y = ((event.clientY - rect.top) / rect.height) * element.height
  const corners = imageCorners().map((point) => forward(point.x, point.y, element))
  if (corners.some((point) => Math.hypot(point.x - x, point.y - y) < 16)) return 'scale'
  const top = forward(store.composition.x + store.composition.width / 2, store.composition.y, element)
  if (Math.hypot(top.x - x, top.y - 28 - y) < 16) return 'rotate'
  return null
}

function startCrop(event: PointerEvent) {
  const element = overlayCanvas.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * element.width
  const y = ((event.clientY - rect.top) / rect.height) * element.height
  const box = sourceBox(element)
  const crop = store.composition.crop
  const left = box.x + crop.x * box.w
  const top = box.y + crop.y * box.h
  const right = left + crop.w * box.w
  const bottom = top + crop.h * box.h
  const near = (px: number, py: number) => Math.hypot(px - x, py - y) < 18
  let handle = ''
  if (near(left, top)) handle = 'nw'
  else if (near(right, top)) handle = 'ne'
  else if (near(right, bottom)) handle = 'se'
  else if (near(left, bottom)) handle = 'sw'
  cropGesture = {
    kind: handle ? 'resize' : 'move',
    handle,
    start: { ...crop },
    pointer: { x, y },
  }
}

function moveCrop(event: PointerEvent) {
  const element = overlayCanvas.value
  if (!element || !cropGesture) return
  const rect = element.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * element.width
  const y = ((event.clientY - rect.top) / rect.height) * element.height
  const box = sourceBox(element)
  const dx = (x - cropGesture.pointer.x) / box.w
  const dy = (y - cropGesture.pointer.y) / box.h
  const start = cropGesture.start
  let next = { ...start }
  if (cropGesture.kind === 'move') {
    next.x = clamp(start.x + dx, 0, 1 - start.w)
    next.y = clamp(start.y + dy, 0, 1 - start.h)
  } else {
    if (cropGesture.handle.includes('e')) next.w = clamp(start.w + dx, 0.05, 1 - start.x)
    if (cropGesture.handle.includes('s')) next.h = clamp(start.h + dy, 0.05, 1 - start.y)
    if (cropGesture.handle.includes('w')) {
      next.x = clamp(start.x + dx, 0, start.x + start.w - 0.05)
      next.w = start.w + (start.x - next.x)
    }
    if (cropGesture.handle.includes('n')) {
      next.y = clamp(start.y + dy, 0, start.y + start.h - 0.05)
      next.h = start.h + (start.y - next.y)
    }
    next = lockCrop(next)
  }
  store.replaceComposition({ ...store.composition, crop: next })
  draw()
}

function lockCrop(crop: { x: number; y: number; w: number; h: number }) {
  const ratio = store.cropRatio(mediaWidth.value, mediaHeight.value)
  if (!ratio) return crop
  const pixelRatio = ratio * (mediaHeight.value / Math.max(1, mediaWidth.value))
  let w = crop.w
  let h = w / pixelRatio
  if (h > 1) {
    h = 1
    w = h * pixelRatio
  }
  if (w > 1) {
    w = 1
    h = w / pixelRatio
  }
  return {
    x: clamp(crop.x, 0, 1 - w),
    y: clamp(crop.y, 0, 1 - h),
    w,
    h,
  }
}

function pointerDistance(): number {
  const points = [...pointers.values()]
  if (points.length < 2) return 0
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
}

function onWheel(event: WheelEvent) {
  event.preventDefault()
  const next = zoom.value * (event.deltaY > 0 ? 0.9 : 1.1)
  zoom.value = clamp(next, 0.25, 4)
  draw()
}

function nudge(event: KeyboardEvent) {
  if (document.activeElement !== shell.value) return
  if (!event.key.startsWith('Arrow')) return
  event.preventDefault()
  const step = (event.shiftKey ? 10 : 1) / store.outputWidth
  const composition = { ...store.composition }
  if (event.key === 'ArrowLeft') composition.x -= step
  if (event.key === 'ArrowRight') composition.x += step
  if (event.key === 'ArrowUp') composition.y -= step
  if (event.key === 'ArrowDown') composition.y += step
  store.replaceComposition(composition)
  store.commitComposition()
  draw()
}

function resetView() {
  zoom.value = 1
  panX.value = 0
  panY.value = 0
  draw()
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

watch(
  () => store.objectUrl,
  (url) => loadMedia(url),
  { immediate: true },
)
watch(
  () =>
    [
      store.composition,
      store.compareAdjustments,
      store.cropEditing,
      store.outputWidth,
      store.outputHeight,
      store.frameImage,
      store.doc,
      store.assetEpoch,
    ] as const,
  () => draw(),
  { deep: true },
)
watch(desktopPreview, () => {
  resize()
})
watch([zoom, panX, panY], () => {
  draw()
})

let observer: ResizeObserver | null = null
onMounted(() => {
  desktopPreviewMq = window.matchMedia('(min-width: 1024px)')
  syncDesktopPreview()
  desktopPreviewMq.addEventListener('change', syncDesktopPreview)
  void remountPreviewRenderer()
  observer = new ResizeObserver(() => resize())
  if (shell.value) observer.observe(shell.value)
  shell.value?.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('keydown', nudge)
})
onBeforeUnmount(() => {
  desktopPreviewMq?.removeEventListener('change', syncDesktopPreview)
  desktopPreviewMq = null
  scheduler.cancel()
  renderer?.dispose()
  renderer = null
  observer?.disconnect()
  shell.value?.removeEventListener('wheel', onWheel)
  window.removeEventListener('keydown', nudge)
})
</script>

<template>
  <div class="flex min-h-0 w-full flex-1 flex-col">
    <div class="mb-3 flex max-w-full flex-wrap items-center gap-1.5 sm:gap-2">
      <span class="text-xs text-zinc-500">{{ viewLabel }}</span>
      <button class="btn btn-ghost cursor-pointer px-2 py-1" type="button" :aria-label="t(S('canvas.zoomOut'))" :title="t(S('canvas.zoomOut'))" @click="zoom = clamp(zoom - 0.1, 0.25, 4); draw()">
        <ZoomOut :size="16" />
      </button>
      <input v-model.number="zoom" class="w-24 min-w-24 flex-1 cursor-pointer sm:w-28 sm:flex-none" type="range" min="0.25" max="4" step="0.05" :aria-label="t(S('canvas.viewZoom'))" @input="draw" />
      <button class="btn btn-ghost cursor-pointer px-2 py-1" type="button" :aria-label="t(S('canvas.zoomIn'))" :title="t(S('canvas.zoomIn'))" @click="zoom = clamp(zoom + 0.1, 0.25, 4); draw()">
        <ZoomIn :size="16" />
      </button>
      <button class="btn btn-ghost cursor-pointer px-2 py-1" type="button" :aria-label="t(S('canvas.fitView'))" :title="t(S('canvas.fitView'))" @click="resetView">
        <Scan :size="16" />
      </button>
      <button class="btn btn-ghost cursor-pointer px-2 py-1" type="button" :aria-label="t(S('canvas.resetZoom'))" :title="t(S('canvas.resetZoom'))" @click="resetView">
        <RotateCcw :size="16" />
      </button>
      <button class="btn btn-ghost cursor-pointer px-2 py-1" type="button" :aria-label="t(S('canvas.fitImage'))" :title="t(S('canvas.fitImage'))" @click="store.fitContain(); selected = true">
        <Shrink :size="16" />
      </button>
      <button class="btn btn-ghost cursor-pointer px-2 py-1" type="button" :aria-label="t(S('canvas.fillCanvas'))" :title="t(S('canvas.fillCanvas'))" @click="store.fitCover(); selected = true">
        <Expand :size="16" />
      </button>
      <button class="btn btn-ghost cursor-pointer px-2 py-1" type="button" :aria-label="t(S('canvas.centerHorizontal'))" :title="t(S('canvas.centerHorizontal'))" @click="store.centerHorizontal()">
        <AlignHorizontalJustifyCenter :size="16" />
      </button>
      <button class="btn btn-ghost cursor-pointer px-2 py-1" type="button" :aria-label="t(S('canvas.centerVertical'))" :title="t(S('canvas.centerVertical'))" @click="store.centerVertical()">
        <AlignVerticalJustifyCenter :size="16" />
      </button>
      <button class="btn btn-ghost cursor-pointer px-2 py-1" type="button" :aria-label="t(S('canvas.reset'))" :title="t(S('canvas.reset'))" @click="store.resetTransform()">
        <RefreshCw :size="16" />
      </button>
      <button
        class="btn cursor-pointer px-2 py-1"
        :class="store.cropEditing ? 'btn-primary' : 'btn-ghost'"
        type="button"
        :aria-label="store.cropEditing ? t(S('canvas.doneCropping')) : t(S('canvas.cropToggle'))"
        :title="store.cropEditing ? t(S('canvas.doneCropping')) : t(S('canvas.cropToggle'))"
        @click="store.cropEditing = !store.cropEditing"
      >
        <Check v-if="store.cropEditing" :size="16" />
        <Crop v-else :size="16" />
      </button>
      <button class="btn btn-ghost cursor-pointer px-2 py-1" type="button" :aria-label="t(S('canvas.undo'))" :title="t(S('canvas.undo'))" @click="store.undo()">
        <Undo2 :size="16" />
      </button>
      <button class="btn btn-ghost cursor-pointer px-2 py-1" type="button" :aria-label="t(S('canvas.redo'))" :title="t(S('canvas.redo'))" @click="store.redo()">
        <Redo2 :size="16" />
      </button>
    </div>
    <div
      v-if="store.cropEditing"
      class="mb-2 flex flex-wrap items-center gap-2"
    >
      <button
        v-for="item in cropAspects"
        :key="item[0]"
        class="btn cursor-pointer text-xs"
        :class="store.composition.cropAspect === item[0] ? 'btn-primary' : 'btn-ghost'"
        type="button"
        @click="store.setCropAspect(item[0], mediaWidth, mediaHeight)"
      >
        {{ item[1] }}
      </button>
      <template v-if="store.composition.cropAspect === 'custom'">
        <input v-model.number="store.composition.customAspectW" class="field w-16" type="number" min="1" max="100" @change="store.setCropAspect('custom', mediaWidth, mediaHeight)" />
        <input v-model.number="store.composition.customAspectH" class="field w-16" type="number" min="1" max="100" @change="store.setCropAspect('custom', mediaWidth, mediaHeight)" />
      </template>
      <button class="btn btn-ghost cursor-pointer text-xs" type="button" @click="store.resetCrop()">{{ t(S('canvas.cropAspects.reset')) }}</button>
    </div>
    <div
      ref="shell"
      class="preview-well relative flex w-full max-w-full min-w-0 items-center justify-center overflow-hidden rounded-lg border border-line max-lg:aspect-video max-lg:max-h-[min(52vh,56vw)] max-lg:shrink-0 max-lg:min-h-[160px] lg:min-h-[180px] lg:min-h-0 lg:flex-1"
      style="touch-action: none"
      tabindex="0"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <div
        ref="badgeShell"
        class="absolute top-1/2 left-1/2 max-h-full max-w-full -translate-x-1/2 -translate-y-1/2"
        :style="{ width: `${displaySize.width}px`, height: `${displaySize.height}px` }"
      >
        <canvas
          :key="previewCanvasKey"
          ref="previewCanvas"
          class="absolute inset-0 block h-full w-full"
        />
        <canvas ref="overlayCanvas" class="absolute inset-0 block h-full w-full touch-none" />
        <ThumbnailBadge
          v-for="id in badgeIds"
          :key="id"
          :badge="store.doc[id]"
          :frame-width="badgeFrameWidth"
          :export-width="store.doc.export.width"
          :export-height="store.doc.export.height"
          :class="dragging === id ? 'cursor-grabbing' : ''"
          @pointerdown="onBadgePointerDown(id, $event)"
          @pointermove="onBadgePointerMove"
          @pointerup="onBadgePointerUp"
          @pointercancel="onBadgePointerUp"
        />
      </div>
      <p v-if="!store.objectUrl" class="pointer-events-none absolute inset-0 grid place-items-center text-sm text-zinc-500">{{ t('thumbnail.uploadHint') }}</p>
    </div>
    <p class="mt-2 text-xs text-zinc-500">
      {{ t(S('canvas.help')) }}
    </p>
  </div>
</template>
