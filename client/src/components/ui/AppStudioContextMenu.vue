<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  x: number
  y: number
}>()

const emit = defineEmits<{
  close: []
}>()

const menuRef = ref<HTMLElement | null>(null)
const position = ref({ left: props.x, top: props.y })

const style = computed(() => ({
  left: `${position.value.left}px`,
  top: `${position.value.top}px`,
}))

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
      <slot />
    </div>
  </Teleport>
</template>