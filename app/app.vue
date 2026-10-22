<script setup lang="ts">
import MapView, { type Mode } from '~/components/MapView.vue'
import { useMarks } from '~/composables/useMarks'
import { createMarksDb, type Investigation } from '~/utils/marksDb'
import { initialMapStyle, type MapStyleId } from '~/utils/mapStyles'
import { exportFilename, ImportError, investigationToGeoJSON, parseInvestigationGeoJSON } from '~/utils/geojson'
import type { Status } from '~/components/MapToolbar.vue'

const STYLE_PREF = 'mapmarks:map-style'

const maptilerKey = String(useRuntimeConfig().public.maptilerKey ?? '')
const mode = ref<Mode>('navigate')
const mapStyle = ref<MapStyleId>(initialMapStyle(readPref(), !!maptilerKey))
const imageryError = ref<string | null>(null)
const mapView = ref<InstanceType<typeof MapView>>()

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
const {
  marks, polygons, saveError, load, add, remove, addPolygon, updatePolygon, removePolygon,
  importData, allStored, undo, redo,
} = useMarks(createMarksDb('mapmarks', () => showStatus('Another MapMarks tab is open. Close it so saved data can load.', 'warn')))
let loading: Promise<void> = Promise.resolve()

const status = ref<Status | null>(null)
let statusTimer: ReturnType<typeof setTimeout> | undefined
function showStatus(text: string, kind: Status['kind'] = 'info') {
  clearTimeout(statusTimer)
  status.value = { text, kind }
  // Plain confirmations fade; warnings and errors stay until dismissed.
  if (kind === 'info') statusTimer = setTimeout(() => (status.value = null), 5000)
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const describe = ({ marks, polygons }: Investigation) =>
  [marks.length && plural(marks.length, 'mark'), polygons.length && plural(polygons.length, 'area')].filter(Boolean).join(' and ')
const total = ({ marks, polygons }: Investigation) => marks.length + polygons.length

async function onExport() {
  try {
    const all = await allStored()
    const url = URL.createObjectURL(new Blob([investigationToGeoJSON(all)], { type: 'application/geo+json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = exportFilename()
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    showStatus(`Exported ${describe(all) || '0 marks'}`)
  } catch (err) {
    console.error('MapMarks: export failed', err)
    showStatus(`Export failed: ${err}`, 'error')
  }
}

async function onImport(file: File) {
  let incoming
  try {
    await loading // duplicates and conflicts can only be detected against the loaded data
    incoming = parseInvestigationGeoJSON(await file.text())
  } catch (err) {
    const reason = err instanceof ImportError ? err.message : String(err)
    showStatus(`Import rejected: ${reason} Nothing was changed.`, 'error')
    return
  }
  try {
    const { added, skipped, conflicts } = await importData(incoming)
    const parts = [`Imported ${describe(added) || 'nothing new'}`]
    if (total(skipped)) parts.push(`${total(skipped)} already present`)
    if (total(conflicts)) {
      parts.push(`${total(conflicts)} conflicting (kept existing)`)
      console.warn('MapMarks: not imported because the same id has different data', conflicts)
    }
    showStatus(parts.join(' · '), total(conflicts) ? 'warn' : 'info')
  } catch (err) {
    console.error('MapMarks: import failed', err)
    showStatus(`Import failed while saving: ${err}. Nothing was changed.`, 'error')
  }
}

function onKeydown(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey || e.altKey)) {
    // Drawing and selection keys first (Esc cancels a draft before it leaves the mode).
    if (mapView.value?.handleKey(e)) {
      e.preventDefault()
      return
    }
    if (e.key === 'Escape') mode.value = 'navigate'
    return
  }
  if (e.altKey) return
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
    ref="mapView"
    :marks="marks"
    :polygons="polygons"
    :mode="mode"
    :map-style="mapStyle"
    :maptiler-key="maptilerKey"
    @add="add"
    @remove="remove"
    @add-polygon="addPolygon"
    @update-polygon="updatePolygon"
    @remove-polygon="removePolygon"
    @imagery-error="imageryError = $event"
    @notice="showStatus($event, 'warn')"
  />
  <MapToolbar
    v-model:mode="mode"
    v-model:map-style="mapStyle"
    :count="marks.length"
    :area-count="polygons.length"
    :save-error="saveError"
    :imagery-error="imageryError"
    :has-key="!!maptilerKey"
    :status="status"
    @export="onExport"
    @import="onImport"
    @dismiss-status="status = null"
  />
</template>
