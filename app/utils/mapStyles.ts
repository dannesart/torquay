import type { StyleSpecification } from 'maplibre-gl'

export type MapStyleId = 'street' | 'satellite' | 'hybrid'

export const MAP_STYLES: { id: MapStyleId; label: string; imagery: boolean }[] = [
  { id: 'street', label: 'Street', imagery: false },
  { id: 'satellite', label: 'Satellite', imagery: true },
  { id: 'hybrid', label: 'Hybrid', imagery: true },
]

// Official MapTiler map ids (https://www.maptiler.com/maps/satellite/).
const MAPTILER_IDS: Record<Exclude<MapStyleId, 'street'>, string> = {
  satellite: 'satellite-v4',
  hybrid: 'hybrid-v4',
}

/**
 * Zoom level above which MapTiler serves upscaled imagery in Torquay (512 px tiles,
 * roughly 0.75 m/pixel). Measured in Oct 2026 by rendering z16 vs z17 tiles at 2x pixel density:
 * z17 tiles added no detail.
 */
export const NATIVE_IMAGERY_ZOOM = 16

const STREET_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}

export const isImagery = (id: MapStyleId) => id !== 'street'

export function styleFor(id: MapStyleId, maptilerKey: string): StyleSpecification | string {
  if (id === 'street') return STREET_STYLE
  return `https://api.maptiler.com/maps/${MAPTILER_IDS[id]}/style.json?key=${encodeURIComponent(maptilerKey)}`
}

/**
 * MapTiler imagery tiles are 512 px. On high-DPI screens, declaring them as 256 px makes MapLibre
 * fetch one zoom level deeper, so each image pixel covers about one device pixel instead of two.
 */
export function sharpenImagery(style: StyleSpecification, devicePixelRatio: number): StyleSpecification {
  const source = style.sources.satellite
  if (devicePixelRatio < 1.5 || source?.type !== 'raster') return style
  return { ...style, sources: { ...style.sources, satellite: { ...source, tileSize: 256 } } }
}

/** Saved preference if still usable, otherwise Hybrid with a key and Street without. */
export function initialMapStyle(stored: string | null, hasKey: boolean): MapStyleId {
  const known = MAP_STYLES.find((s) => s.id === stored)
  if (known && (hasKey || !known.imagery)) return known.id
  return hasKey ? 'hybrid' : 'street'
}

export function imageryErrorMessage(status: number | undefined): string {
  if (status === 401 || status === 403) {
    return 'MapTiler rejected the API key. Check NUXT_PUBLIC_MAPTILER_KEY and the key’s allowed origins.'
  }
  if (status === 429) return 'MapTiler usage quota exceeded for this key.'
  if (status) return `MapTiler returned an error (HTTP ${status}).`
  return 'Could not reach MapTiler (offline or blocked).'
}
