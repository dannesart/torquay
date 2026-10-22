<script setup lang="ts">
import type { Mode } from '~/components/MapView.vue'
import { useMarks } from '~/composables/useMarks'
import { createMarksDb } from '~/utils/marksDb'
import { initialMapStyle, type MapStyleId } from '~/utils/mapStyles'
import { exportFilename, ImportError, marksToGeoJSON, parseMarksGeoJSON } from '~/utils/geojson'
import type { Status } from '~/components/MapToolbar.vue'

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
const { marks, saveError, load, add, remove, importMarks, allStored, undo, redo } = useMarks(createMarksDb())
let loading: Promise<void> = Promise.resolve()

const status = ref<Status | null>(null)
let statusTimer: ReturnType<typeof setTimeout> | undefined
function showStatus(text: string, kind: Status['kind'] = 'info') {
  clearTimeout(statusTimer)
  status.value = { text, kind }
  // Plain confirmations fade; warnings and errors stay until dismissed.
  if (kind === 'info') statusTimer = setTimeout(() => (status.value = null), 5000)
}

async function onExport() {
  try {
    const all = await allStored()
    const url = URL.createObjectURL(new Blob([marksToGeoJSON(all)], { type: 'application/geo+json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = exportFilename()
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    showStatus(`Exported ${all.length} marks`)
  } catch (err) {
    console.error('MapMarks: export failed', err)
    showStatus(`Export failed: ${err}`, 'error')
  }
}

async function onImport(file: File) {
  let incoming
  try {
    await loading // duplicates and conflicts can only be detected against the loaded marks
    incoming = parseMarksGeoJSON(await file.text())
  } catch (err) {
    const reason = err instanceof ImportError ? err.message : String(err)
    showStatus(`Import rejected: ${reason} Nothing was changed.`, 'error')
    return
  }
  try {
    const { added, skipped, conflicts } = await importMarks(incoming)
    const parts = [`Imported ${added.length} new marks`]
    if (skipped.length) parts.push(`${skipped.length} already present`)
    if (conflicts.length) {
      parts.push(`${conflicts.length} conflicting (kept existing)`)
      console.warn('MapMarks: marks not imported because the same id has different data', conflicts)
    }
    showStatus(parts.join(' · '), conflicts.length ? 'warn' : 'info')
  } catch (err) {
    console.error('MapMarks: import failed', err)
    showStatus(`Import failed while saving: ${err}. Nothing was changed.`, 'error')
  }
}

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
  loading = load().catch((err) => {
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
    :status="status"
    @export="onExport"
    @import="onImport"
    @dismiss-status="status = null"
  />
</template>
