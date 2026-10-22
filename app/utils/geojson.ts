import type { Investigation, Mark, Polygon } from '~/utils/marksDb'
import { counterClockwise, ringProblem, sameRing, type LngLat } from '~/utils/polygon'

/**
 * MapMarks GeoJSON format:
 *
 * { "type": "FeatureCollection", "mapmarks": { "version": 2 },
 *   "features": [
 *     { "type": "Feature", "id": "<uuid>",
 *       "geometry": { "type": "Point", "coordinates": [lng, lat] },
 *       "properties": { "type": "red-x", "createdAt": <epoch ms> } },
 *     { "type": "Feature", "id": "<uuid>",
 *       "geometry": { "type": "Polygon", "coordinates": [[[lng, lat], ..., <first point again>]] },
 *       "properties": { "type": "exclusion-area", "createdAt": <epoch ms> } } ] }
 *
 * Version 1 is the same format with Red X points only; version 2 adds exclusion areas.
 * `mapmarks` is a GeoJSON foreign member (RFC 7946 §6.1), so the file opens in any GeoJSON tool.
 */
export const FORMAT_VERSION = 2
const SUPPORTED_VERSIONS = [1, 2]

export class ImportError extends Error {}

type Item = { kind: 'mark'; value: Mark } | { kind: 'polygon'; value: Polygon }

export function investigationToGeoJSON({ marks, polygons }: Investigation): string {
  const items: Item[] = [
    ...marks.map((value) => ({ kind: 'mark' as const, value })),
    ...polygons.map((value) => ({ kind: 'polygon' as const, value })),
  ].sort((a, b) => a.value.createdAt - b.value.createdAt || a.value.id.localeCompare(b.value.id))

  const collection = {
    type: 'FeatureCollection',
    mapmarks: { version: FORMAT_VERSION },
    features: items.map((item) =>
      item.kind === 'mark'
        ? {
            type: 'Feature',
            id: item.value.id,
            geometry: { type: 'Point', coordinates: [item.value.lng, item.value.lat] },
            properties: { type: 'red-x', createdAt: item.value.createdAt },
          }
        : {
            type: 'Feature',
            id: item.value.id,
            geometry: { type: 'Polygon', coordinates: [[...item.value.ring, item.value.ring[0]]] },
            properties: { type: 'exclusion-area', createdAt: item.value.createdAt },
          },
    ),
  }
  return JSON.stringify(collection, null, 2) + '\n'
}

export function exportFilename(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `mapmarks-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.geojson`
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isPosition = (v: unknown): v is LngLat => Array.isArray(v) && v.length === 2 && v.every(isFiniteNumber)
const sameMark = (a: Mark, b: Mark) => a.lng === b.lng && a.lat === b.lat && a.createdAt === b.createdAt
const samePolygon = (a: Polygon, b: Polygon) => a.createdAt === b.createdAt && sameRing(a.ring, b.ring)
const sameItem = (a: Item, b: Item) =>
  a.kind === b.kind && (a.kind === 'mark' ? sameMark(a.value, b.value as Mark) : samePolygon(a.value, b.value as Polygon))

function parseFeature(f: unknown, version: number): Item {
  if (!isObject(f) || f.type !== 'Feature') throw new ImportError('not a GeoJSON Feature')
  const { id, geometry, properties } = f
  if (typeof id !== 'string' || id.trim() === '' || id.length > 200) throw new ImportError('missing or invalid id')
  if (!isObject(properties)) throw new ImportError('missing properties')
  const { type, createdAt } = properties
  if (!isFiniteNumber(createdAt) || createdAt <= 0) throw new ImportError('missing or invalid createdAt')
  if (!isObject(geometry)) throw new ImportError('missing geometry')

  if (type === 'red-x') {
    if (geometry.type !== 'Point') throw new ImportError('a Red X must be a Point')
    if (!isPosition(geometry.coordinates)) throw new ImportError('coordinates must be [longitude, latitude]')
    const [lng, lat] = geometry.coordinates
    if (lng < -180 || lng > 180) throw new ImportError(`longitude ${lng} is out of range`)
    if (lat < -90 || lat > 90) throw new ImportError(`latitude ${lat} is out of range`)
    return { kind: 'mark', value: { id, lng, lat, createdAt } }
  }

  if (type === 'exclusion-area' && version >= 2) {
    if (geometry.type !== 'Polygon') throw new ImportError('an exclusion area must be a Polygon')
    const rings = geometry.coordinates
    if (!Array.isArray(rings) || rings.length === 0) throw new ImportError('polygon has no coordinates')
    if (rings.length > 1) throw new ImportError('polygons with holes are not supported')
    const ring = rings[0]
    if (!Array.isArray(ring) || !ring.every(isPosition)) throw new ImportError('polygon points must be [longitude, latitude]')
    if (ring.length < 4) throw new ImportError('polygon ring needs at least 4 positions (3 points plus the closing point)')
    const first = ring[0]!
    const last = ring.at(-1)!
    if (first[0] !== last[0] || first[1] !== last[1]) throw new ImportError('polygon ring is not closed')
    const open = ring.slice(0, -1) as LngLat[]
    const problem = ringProblem(open)
    if (problem) throw new ImportError(`invalid polygon: ${problem}`)
    return { kind: 'polygon', value: { id, ring: counterClockwise(open), createdAt } }
  }

  throw new ImportError(`unsupported feature type "${type}"${version < 2 ? ` in format version ${version}` : ''}`)
}

/** Parses and fully validates a MapMarks export. Throws ImportError with a user-facing reason. */
export function parseInvestigationGeoJSON(text: string): Investigation {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new ImportError('The file is not valid JSON.')
  }
  if (!isObject(data) || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    throw new ImportError('The file is not a GeoJSON FeatureCollection.')
  }
  const meta = data.mapmarks
  if (!isObject(meta) || !isFiniteNumber(meta.version)) {
    throw new ImportError('The file is not a MapMarks export (missing "mapmarks" version).')
  }
  const version = meta.version
  if (!SUPPORTED_VERSIONS.includes(version)) {
    throw new ImportError(`Unsupported MapMarks format version ${version}; this app reads versions ${SUPPORTED_VERSIONS.join(' and ')}.`)
  }

  const byId = new Map<string, Item>()
  data.features.forEach((f: unknown, i: number) => {
    let item: Item
    try {
      item = parseFeature(f, version)
    } catch (err) {
      throw err instanceof ImportError ? new ImportError(`Feature ${i + 1}: ${err.message}.`) : err
    }
    const seen = byId.get(item.value.id)
    if (seen && !sameItem(seen, item)) {
      throw new ImportError(`Feature ${i + 1}: id "${item.value.id}" appears twice with different data.`)
    }
    byId.set(item.value.id, item)
  })

  const items = [...byId.values()]
  return {
    marks: items.flatMap((it) => (it.kind === 'mark' ? [it.value] : [])),
    polygons: items.flatMap((it) => (it.kind === 'polygon' ? [it.value] : [])),
  }
}

export interface ImportPlan {
  added: Investigation
  /** Already present with identical data. */
  skipped: Investigation
  /** Same id as an existing mark or area but different data; the existing one is kept. */
  conflicts: Investigation
}

export function planImport(existing: Investigation, incoming: Investigation): ImportPlan {
  const current = new Map<string, Item>([
    ...existing.marks.map((value): [string, Item] => [value.id, { kind: 'mark', value }]),
    ...existing.polygons.map((value): [string, Item] => [value.id, { kind: 'polygon', value }]),
  ])
  const empty = (): Investigation => ({ marks: [], polygons: [] })
  const plan: ImportPlan = { added: empty(), skipped: empty(), conflicts: empty() }
  const sort = (item: Item, into: Investigation) => {
    if (item.kind === 'mark') into.marks.push(item.value)
    else into.polygons.push(item.value)
  }
  for (const item of [
    ...incoming.marks.map((value): Item => ({ kind: 'mark', value })),
    ...incoming.polygons.map((value): Item => ({ kind: 'polygon', value })),
  ]) {
    const match = current.get(item.value.id)
    if (!match) sort(item, plan.added)
    else if (sameItem(match, item)) sort(item, plan.skipped)
    else sort(item, plan.conflicts)
  }
  return plan
}
