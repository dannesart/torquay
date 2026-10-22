<script setup lang="ts">
import { Map, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type { Mark } from '~/utils/marksDb'
import { markAtPoint } from '~/utils/hitTest'
import { imageryErrorMessage, isImagery, NATIVE_IMAGERY_ZOOM, sharpenImagery, styleFor, type MapStyleId } from '~/utils/mapStyles'
import type { FeatureCollection, Point } from 'geojson'

export type Mode = 'navigate' | 'red-x' | 'eraser'

const props = defineProps<{ marks: Mark[]; mode: Mode; mapStyle: MapStyleId; maptilerKey: string }>()
const emit = defineEmits<{ add: [lng: number, lat: number]; remove: [id: string]; imageryError: [message: string | null] }>()

setWorkerUrl(workerUrl)

const TORQUAY: [number, number] = [-3.5253, 50.4619]
// The visible cross fits in a ~15 px square around its center; the round click target is slightly larger.
const HIT_RADIUS = 10

/** Eraser cursor: a ring the size of the hit target, filled red while over a mark. */
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

function toGeoJSON(marks: Mark[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: marks.map((m) => ({
      type: 'Feature',
      properties: { id: m.id },
      geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
    })),
  }
}

/** Style changes drop custom images, sources and layers, so re-add them after every style load. */
function addMarksLayer() {
  if (!map!.hasImage('red-x')) map!.addImage('red-x', createCrossImage(), { pixelRatio: 2 })
  if (!map!.getSource('marks')) map!.addSource('marks', { type: 'geojson', data: toGeoJSON(props.marks) })
  if (!map!.getLayer('marks')) {
    map!.addLayer({
      id: 'marks',
      type: 'symbol',
      source: 'marks',
      layout: {
        'icon-image': 'red-x',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    })
  }
}

/** Hit test against each mark's projected center, the same point its cross is drawn at. */
function markAt(point: { x: number; y: number }): string | undefined {
  const onScreen = props.marks.map((m) => ({ id: m.id, ...map!.project([m.lng, m.lat]) }))
  return markAtPoint(onScreen, point, HIT_RADIUS)
}

const CURSORS: Record<Mode, string> = { 'navigate': '', 'red-x': 'crosshair', 'eraser': ERASER_CURSOR }

function applyMode() {
  if (!map) return
  map.getCanvas().style.cursor = CURSORS[props.mode]
  // Rapid clicks while marking or erasing should not zoom.
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

  map.on('style.load', addMarksLayer)
  map.on('zoom', () => (zoom.value = map!.getZoom()))

  // 'click' does not fire after a drag, so panning never places or erases marks.
  map.on('click', (e) => {
    if (props.mode === 'red-x') {
      emit('add', e.lngLat.lng, e.lngLat.lat)
    } else if (props.mode === 'eraser') {
      const id = markAt(e.point)
      if (id) emit('remove', id)
    }
  })

  map.on('mousemove', (e) => {
    if (props.mode !== 'eraser') return
    map!.getCanvas().style.cursor = markAt(e.point) ? ERASER_CURSOR_HOT : ERASER_CURSOR
  })

  map.on('contextmenu', (e) => {
    e.preventDefault()
    e.originalEvent.preventDefault()
    const id = markAt(e.point)
    if (id) emit('remove', id)
  })

  applyMode()
  applyStyle()
})

watch(
  () => props.marks,
  (marks) => {
    map?.getSource<GeoJSONSource>('marks')?.setData(toGeoJSON(marks))
    // A removed mark leaves the cursor over empty space; an undone one may appear under it.
    if (props.mode === 'eraser') applyMode()
  },
)
watch(() => props.mode, applyMode)
watch(() => props.mapStyle, applyStyle)

onBeforeUnmount(() => map?.remove())
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
