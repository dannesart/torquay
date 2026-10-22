<script setup lang="ts">
import type { Mode } from '~/components/MapView.vue'
import { useMarks } from '~/composables/useMarks'
import { createMarksDb } from '~/utils/marksDb'
import { initialMapStyle, type MapStyleId } from '~/utils/mapStyles'

const STYLE_PREF = 'mapmarks:map-style'

const maptilerKey = String(useRuntimeConfig().public.maptilerKey ?? '')
const mode = ref<Mode>('navigate')
const mapStyle = ref<MapStyleId>(initialMapStyle(readPref(), !!maptilerKey))
const imageryError = ref<string | null>(null)

function readPref() {
  try {
    return localStorage.getItem(STYLE_PREF)
  } catch {
    return null
  }
}
watch(mapStyle, (style) => {
  try {
    localStorage.setItem(STYLE_PREF, style)
  } catch {
    // Preference only; nothing to do if storage is unavailable.
  }
})
const { marks, saveError, load, add, remove, undo, redo } = useMarks(createMarksDb())

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    mode.value = 'navigate'
    return
  }
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return
  const key = e.key.toLowerCase()
  if (key === 'z') {
    e.preventDefault()
    if (e.shiftKey) redo()
    else undo()
  } else if (key === 'y') {
    e.preventDefault()
    redo()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  load().catch((err) => {
    console.error('MapMarks: failed to load marks', err)
    saveError.value = `Could not load saved marks: ${err}`
  })
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <MapView
    :marks="marks"
    :mode="mode"
    :map-style="mapStyle"
    :maptiler-key="maptilerKey"
    @add="add"
    @remove="remove"
    @imagery-error="imageryError = $event"
  />
  <MapToolbar
    v-model:mode="mode"
    v-model:map-style="mapStyle"
    :count="marks.length"
    :save-error="saveError"
    :imagery-error="imageryError"
    :has-key="!!maptilerKey"
  />
</template>
