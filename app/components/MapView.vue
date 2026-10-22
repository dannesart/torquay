<script setup lang="ts">
import { Map, setWorkerUrl, type GeoJSONSource, type LayerSpecification } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type { Mark, Polygon } from '~/utils/marksDb'
import { eraseTargetAt, polygonContains, vertexAtPoint, type EraseTarget } from '~/utils/hitTest'
import { imageryErrorMessage, isImagery, NATIVE_IMAGERY_ZOOM, sharpenImagery, styleFor, type MapStyleId } from '~/utils/mapStyles'
import { ringProblem, type LngLat } from '~/utils/polygon'
import { usePolygonDraft } from '~/composables/usePolygonDraft'
import type { Feature, FeatureCollection } from 'geojson'

export type Mode = 'navigate' | 'red-x' | 'eraser' | 'polygon'

const props = defineProps<{ marks: Mark[]; polygons: Polygon[]; mode: Mode; mapStyle: MapStyleId; maptilerKey: string }>()
const emit = defineEmits<{
  add: [lng: number, lat: number]
  remove: [id: string]
  addPolygon: [ring: LngLat[]]
  updatePolygon: [id: string, ring: LngLat[]]
  removePolygon: [id: string]
  imageryError: [message: string | null]
  notice: [message: string]
}>()

setWorkerUrl(workerUrl)

const TORQUAY: [number, number] = [-3.5253, 50.4619]
// The visible cross fits in a ~15 px square around its center; the round click target is slightly larger.
const HIT_RADIUS = 10
// Erasing closer than this to a mark (but outside its target) removes nothing, so areas beneath are safe.
const SAFETY_RADIUS = 20
const HANDLE_RADIUS = 8 // px: grabbing an edit handle, or closing a draft on its first point
const EDGE_TOLERANCE = 4 // px around a polygon outline that still counts as clicking it
const RED = '#e00000'
const SELECTED = '#ffb800'

/** Eraser cursor: a ring the size of the hit target, filled red while over something it would erase. */
function ringCursor(fill: string, stroke: string) {
  const d = HIT_RADIUS * 2 + 4
  const c = d / 2
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}">`
    + `<circle cx="${c}" cy="${c}" r="${HIT_RADIUS}" fill="${fill}" stroke="#fff" stroke-width="3"/>`
    + `<circle cx="${c}" cy="${c}" r="${HIT_RADIUS}" fill="none" stroke="${stroke}" stroke-width="1.5"/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${c} ${c}, crosshair`
}
const ERASER_CURSOR = ringCursor('none', '#000')
const ERASER_CURSOR_HOT = ringCursor('rgba(224,0,0,0.35)', '#e00000')

const container = ref<HTMLDivElement>()
const zoom = ref(14)
const usingImagery = computed(() => isImagery(props.mapStyle))
let map: Map | undefined
let imageryErrorShown = false

const draft = usePolygonDraft()
const pointer = shallowRef<LngLat | null>(null) // follows the mouse for the draft preview
const selectedId = ref<string | null>(null)
const eraseHover = shallowRef<EraseTarget | undefined>()
/** A vertex being dragged: a working copy of the ring, committed only on release. */
const editing = shallowRef<{ id: string; index: number; ring: LngLat[]; start: { x: number; y: number }; moved: boolean } | null>(null)

function applyStyle() {
  if (!map) return
  imageryErrorShown = false
  emit('imageryError', null)
  // Restore the camera explicitly: a fetched style may carry its own center/zoom.
  const camera = { center: map.getCenter(), zoom: map.getZoom() }
  map.once('style.load', () => map!.jumpTo(camera))
  map.setStyle(styleFor(props.mapStyle, props.maptilerKey), {
    transformStyle: (_, next) => sharpenImagery(next, map!.getPixelRatio()),
  })
}

/**
 * A compact red X (10 px arms) with a white halo and dark outline, so it stays visible on light roofs,
 * dark trees and street maps without covering a house. Drawn centered on the mark's coordinates.
 */
function createCrossImage(size = 18, ratio = 2): ImageData {
  const px = size * ratio
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = px
  const ctx = canvas.getContext('2d')!
  const pad = 4 * ratio
  ctx.lineCap = 'round'
  for (const [width, color] of [[5, 'rgba(0,0,0,0.5)'], [3.5, '#fff'], [2, '#e00000']] as const) {
    ctx.lineWidth = width * ratio
    ctx.strokeStyle = color
    ctx.beginPath()
    ctx.moveTo(pad, pad)
    ctx.lineTo(px - pad, px - pad)
    ctx.moveTo(px - pad, pad)
    ctx.lineTo(pad, px - pad)
    ctx.stroke()
  }
  return ctx.getImageData(0, 0, px, px)
}

const closed = (ring: LngLat[]) => [...ring, ring[0]!]
const ringOf = (p: Polygon) => (editing.value?.id === p.id ? editing.value.ring : p.ring)
const selectedPolygon = () => props.polygons.find((p) => p.id === selectedId.value)

function marksData(): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: props.marks.map((m) => ({
      type: 'Feature',
      properties: { id: m.id },
      geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
    })),
  }
}

function polygonsData(): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: props.polygons.map((p) => ({
      type: 'Feature',
      properties: {
        id: p.id,
        selected: p.id === selectedId.value,
        hover: eraseHover.value?.kind === 'polygon' && eraseHover.value.id === p.id,
      },
      geometry: { type: 'Polygon', coordinates: [closed(ringOf(p))] },
    })),
  }
}

/** The draft being drawn (with a live segment to the pointer) and the selected polygon's edit handles. */
function overlayData(): FeatureCollection {
  const features: Feature[] = []
  const points = draft.points.value
  const preview = pointer.value ? [...points, pointer.value] : points
  if (preview.length >= 3) {
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [closed(preview)] } })
  }
  if (preview.length >= 2) {
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: preview } })
  }
  for (const p of points) {
    features.push({ type: 'Feature', properties: { kind: 'vertex' }, geometry: { type: 'Point', coordinates: p } })
  }
  const selected = selectedPolygon()
  if (selected) {
    for (const p of ringOf(selected)) {
      features.push({ type: 'Feature', properties: { kind: 'handle' }, geometry: { type: 'Point', coordinates: p } })
    }
  }
  return { type: 'FeatureCollection', features }
}

const highlighted = ['any', ['get', 'hover'], ['get', 'selected']]
const isHandle = ['==', ['get', 'kind'], 'handle']
// Bottom to top: areas, the draft, Red X marks above both, then vertex handles.
const LAYERS = [
  { id: 'polygons-fill', type: 'fill', source: 'polygons', paint: { 'fill-color': RED, 'fill-opacity': ['case', ['get', 'hover'], 0.4, ['get', 'selected'], 0.28, 0.18] } },
  { id: 'polygons-casing', type: 'line', source: 'polygons', paint: { 'line-color': '#fff', 'line-opacity': 0.85, 'line-width': ['case', highlighted, 6, 4] } },
  { id: 'polygons-line', type: 'line', source: 'polygons', paint: { 'line-color': ['case', ['get', 'selected'], SELECTED, RED], 'line-width': ['case', highlighted, 3, 2] } },
  { id: 'draft-fill', type: 'fill', source: 'overlay', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': RED, 'fill-opacity': 0.12 } },
  { id: 'draft-casing', type: 'line', source: 'overlay', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#fff', 'line-opacity': 0.85, 'line-width': 4 } },
  { id: 'draft-line', type: 'line', source: 'overlay', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': RED, 'line-width': 2, 'line-dasharray': [2, 1.5] } },
  { id: 'marks', type: 'symbol', source: 'marks', layout: { 'icon-image': 'red-x', 'icon-allow-overlap': true, 'icon-ignore-placement': true } },
  { id: 'vertices', type: 'circle', source: 'overlay', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': ['case', isHandle, 5, 4], 'circle-color': '#fff', 'circle-stroke-color': ['case', isHandle, SELECTED, RED], 'circle-stroke-width': 2 } },
] as LayerSpecification[]

/** Style changes drop custom images, sources and layers, so re-add them after every style load. */
function addLayers() {
  const m = map!
  if (!m.hasImage('red-x')) m.addImage('red-x', createCrossImage(), { pixelRatio: 2 })
  // tolerance 0: no simplification, so outlines stay exact at every zoom.
  if (!m.getSource('polygons')) m.addSource('polygons', { type: 'geojson', data: polygonsData(), tolerance: 0 })
  if (!m.getSource('overlay')) m.addSource('overlay', { type: 'geojson', data: overlayData(), tolerance: 0 })
  if (!m.getSource('marks')) m.addSource('marks', { type: 'geojson', data: marksData() })
  for (const layer of LAYERS) if (!m.getLayer(layer.id)) m.addLayer(layer)
}

const setData = (source: string, data: FeatureCollection) => map?.getSource<GeoJSONSource>(source)?.setData(data)
const renderPolygons = () => setData('polygons', polygonsData())
const renderOverlay = () => setData('overlay', overlayData())

const toScreen = ([lng, lat]: LngLat) => map!.project([lng, lat])
const screenMarks = () => props.marks.map((m) => ({ id: m.id, ...map!.project([m.lng, m.lat]) }))
const screenPolygons = () => props.polygons.map((p) => ({ id: p.id, ring: ringOf(p).map(toScreen) }))

/** Hit tests run on projected coordinates, the same positions everything is drawn at. */
function eraseTarget(point: { x: number; y: number }) {
  return eraseTargetAt(screenMarks(), screenPolygons(), point, {
    markRadius: HIT_RADIUS,
    safetyRadius: SAFETY_RADIUS,
    edgeTolerance: EDGE_TOLERANCE,
  })
}
const polygonAt = (point: { x: number; y: number }) =>
  screenPolygons().findLast((p) => polygonContains(p.ring, point, EDGE_TOLERANCE))?.id
function handleAt(point: { x: number; y: number }) {
  const selected = selectedPolygon()
  return selected && vertexAtPoint(ringOf(selected).map(toScreen), point, HANDLE_RADIUS)
}

function finishDraft() {
  if (!draft.active.value) return
  const result = draft.finish()
  if ('error' in result) emit('notice', `Can't finish the polygon: ${result.error}. Backspace removes the last point, Esc cancels.`)
  else emit('addPolygon', result.ring)
}

function onDraftClick(point: { x: number; y: number }, lngLat: LngLat) {
  const points = draft.points.value
  const near = (p: LngLat, radius: number) => {
    const s = toScreen(p)
    return Math.hypot(s.x - point.x, s.y - point.y) <= radius
  }
  if (points.length >= 3 && near(points[0]!, HANDLE_RADIUS)) return finishDraft()
  if (points.length && near(points.at(-1)!, 3)) return // second click of a double-click
  draft.add(lngLat)
}

function endEdit() {
  const edit = editing.value
  editing.value = null
  if (!edit?.moved) return // a click on a handle, not a drag
  const problem = ringProblem(edit.ring)
  if (problem) emit('notice', `Edit not applied: ${problem}.`)
  else emit('updatePolygon', edit.id, edit.ring)
}

/** Keys the map handles itself. Returns true when the key was used. */
function handleKey(e: KeyboardEvent): boolean {
  if (editing.value && e.key === 'Escape') {
    editing.value = null // revert the drag in progress
    return true
  }
  if (props.mode === 'polygon' && draft.active.value) {
    if (e.key === 'Escape') draft.cancel()
    else if (e.key === 'Enter') finishDraft()
    else if (e.key === 'Backspace') draft.removeLast()
    else return false
    return true
  }
  if (selectedId.value) {
    if (e.key === 'Escape') selectedId.value = null
    else if (e.key === 'Delete' || e.key === 'Backspace') emit('removePolygon', selectedId.value)
    else return false
    return true
  }
  return false
}
defineExpose({ handleKey })

const CURSORS: Record<Mode, string> = { 'navigate': '', 'red-x': 'crosshair', 'eraser': ERASER_CURSOR, 'polygon': 'crosshair' }
const setCursor = (cursor: string) => map && (map.getCanvas().style.cursor = cursor)

function applyMode() {
  if (!map) return
  if (props.mode !== 'polygon') {
    draft.cancel() // an unfinished polygon is never kept
    pointer.value = null
  }
  if (props.mode !== 'navigate') selectedId.value = null
  eraseHover.value = undefined
  setCursor(CURSORS[props.mode])
  // Rapid clicks while marking, erasing or drawing should not zoom.
  if (props.mode === 'navigate') map.doubleClickZoom.enable()
  else map.doubleClickZoom.disable()
}

onMounted(() => {
  map = new Map({
    container: container.value!,
    center: TORQUAY,
    zoom: zoom.value,
    maxZoom: 21,
    // Top-down satellite work: no rotation or tilt, which also frees the right mouse button.
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
  })
  map.touchZoomRotate.disableRotation()
  map.keyboard.disableRotation()

  map.on('error', (e) => {
    console.error('MapMarks: map error', e.error)
    if (usingImagery.value && !imageryErrorShown) {
      imageryErrorShown = true
      // Load errors carry the HTTP status, which the public types omit.
      emit('imageryError', imageryErrorMessage((e.error as { status?: number }).status))
    }
  })

  map.on('style.load', addLayers)
  map.on('zoom', () => (zoom.value = map!.getZoom()))

  // 'click' does not fire after a drag, so panning never places, erases or draws anything.
  map.on('click', (e) => {
    if (props.mode === 'red-x') {
      emit('add', e.lngLat.lng, e.lngLat.lat)
    } else if (props.mode === 'eraser') {
      const target = eraseTarget(e.point)
      if (target?.kind === 'mark') emit('remove', target.id)
      else if (target?.kind === 'polygon') emit('removePolygon', target.id)
    } else if (props.mode === 'polygon') {
      onDraftClick(e.point, [e.lngLat.lng, e.lngLat.lat])
    } else {
      selectedId.value = polygonAt(e.point) ?? null
    }
  })

  map.on('dblclick', (e) => {
    if (props.mode !== 'polygon') return
    e.preventDefault()
    finishDraft()
  })

  // Editing is explicit: only a press on a handle of the selected polygon drags a vertex.
  map.on('mousedown', (e) => {
    if (props.mode !== 'navigate' || editing.value) return
    const index = handleAt(e.point)
    if (index === undefined) return
    e.preventDefault() // stops the map from panning during this drag
    editing.value = { id: selectedId.value!, index, ring: [...ringOf(selectedPolygon()!)], start: e.point, moved: false }
    window.addEventListener('mouseup', endEdit, { once: true })
  })

  map.on('mousemove', (e) => {
    const edit = editing.value
    if (edit) {
      const ring = [...edit.ring]
      ring[edit.index] = [e.lngLat.lng, e.lngLat.lat]
      const moved = edit.moved || Math.hypot(e.point.x - edit.start.x, e.point.y - edit.start.y) > 3
      editing.value = { ...edit, ring, moved }
    } else if (props.mode === 'polygon') {
      pointer.value = [e.lngLat.lng, e.lngLat.lat]
    } else if (props.mode === 'eraser') {
      eraseHover.value = eraseTarget(e.point)
      setCursor(eraseHover.value ? ERASER_CURSOR_HOT : ERASER_CURSOR)
    } else if (props.mode === 'navigate') {
      setCursor(handleAt(e.point) !== undefined ? 'move' : polygonAt(e.point) ? 'pointer' : '')
    }
  })

  map.on('mouseout', () => {
    pointer.value = null
    eraseHover.value = undefined
  })

  map.on('contextmenu', (e) => {
    e.preventDefault()
    e.originalEvent.preventDefault()
    const target = eraseTarget(e.point)
    if (target?.kind === 'mark') emit('remove', target.id)
    else if (target?.kind === 'polygon') emit('removePolygon', target.id)
  })

  applyMode()
  applyStyle()
})

watch(
  () => props.marks,
  () => {
    setData('marks', marksData())
    // A removed mark leaves the cursor over empty space; an undone one may appear under it.
    if (props.mode === 'eraser') applyMode()
  },
)
watch(
  () => props.polygons,
  (polygons) => {
    if (selectedId.value && !polygons.some((p) => p.id === selectedId.value)) selectedId.value = null
    if (props.mode === 'eraser') applyMode()
    renderPolygons()
    renderOverlay()
  },
)
watch([selectedId, eraseHover, editing], () => {
  renderPolygons()
  renderOverlay()
})
watch([draft.points, pointer], renderOverlay)
watch(() => props.mode, applyMode)
watch(() => props.mapStyle, applyStyle)

onBeforeUnmount(() => {
  window.removeEventListener('mouseup', endEdit)
  map?.remove()
})
</script>

<template>
  <div class="map-wrap">
    <div ref="container" class="map" />
    <div v-if="usingImagery" class="imagery-info">
      <a href="https://www.maptiler.com" target="_blank" rel="noopener">
        <img src="https://api.maptiler.com/resources/logo.svg" alt="MapTiler logo">
      </a>
      <span v-if="zoom > NATIVE_IMAGERY_ZOOM" class="upscaled" title="Closer zoom enlarges the imagery; it adds no detail.">
        Beyond imagery resolution
      </span>
    </div>
  </div>
</template>

<style scoped>
.map-wrap,
.map {
  position: absolute;
  inset: 0;
}
.imagery-info {
  position: absolute;
  left: 10px;
  bottom: 10px;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}
.imagery-info img {
  height: 22px;
  display: block;
}
.upscaled {
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 11px;
}
</style>
