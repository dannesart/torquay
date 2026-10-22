import type { Mark } from '~/utils/marksDb'

/**
 * MapMarks GeoJSON format, version 1:
 *
 * { "type": "FeatureCollection", "mapmarks": { "version": 1 },
 *   "features": [{ "type": "Feature", "id": "<uuid>",
 *                  "geometry": { "type": "Point", "coordinates": [lng, lat] },
 *                  "properties": { "type": "red-x", "createdAt": <epoch ms> } }] }
 *
 * `mapmarks` is a GeoJSON foreign member (RFC 7946 §6.1), so the file opens in any GeoJSON tool.
 */
export const FORMAT_VERSION = 1
const MARK_TYPES = ['red-x']

export class ImportError extends Error {}

export function marksToGeoJSON(marks: Mark[]): string {
  const sorted = [...marks].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  const collection = {
    type: 'FeatureCollection',
    mapmarks: { version: FORMAT_VERSION },
    features: sorted.map((m) => ({
      type: 'Feature',
      id: m.id,
      geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
      properties: { type: 'red-x', createdAt: m.createdAt },
    })),
  }
  return JSON.stringify(collection, null, 2) + '\n'
}

export function exportFilename(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `mapmarks-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.geojson`
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const sameMark = (a: Mark, b: Mark) => a.lng === b.lng && a.lat === b.lat && a.createdAt === b.createdAt

/** Parses and fully validates a MapMarks export. Throws ImportError with a user-facing reason. */
export function parseMarksGeoJSON(text: string): Mark[] {
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
  if (meta.version !== FORMAT_VERSION) {
    throw new ImportError(`Unsupported MapMarks format version ${meta.version}; this app reads version ${FORMAT_VERSION}.`)
  }

  const byId = new Map<string, Mark>()
  data.features.forEach((f: unknown, i: number) => {
    const fail = (reason: string): never => {
      throw new ImportError(`Feature ${i + 1}: ${reason}.`)
    }
    if (!isObject(f) || f.type !== 'Feature') fail('not a GeoJSON Feature')
    const feature = f as Record<string, unknown>
    const { id, geometry, properties } = feature
    if (typeof id !== 'string' || id.trim() === '' || id.length > 200) fail('missing or invalid id')
    if (!isObject(geometry) || geometry.type !== 'Point') fail('geometry is not a Point')
    const coords = (geometry as Record<string, unknown>).coordinates
    if (!Array.isArray(coords) || coords.length !== 2 || !coords.every(isFiniteNumber)) {
      fail('coordinates must be [longitude, latitude]')
    }
    const [lng, lat] = coords as [number, number]
    if (lng < -180 || lng > 180) fail(`longitude ${lng} is out of range`)
    if (lat < -90 || lat > 90) fail(`latitude ${lat} is out of range`)
    if (!isObject(properties)) fail('missing properties')
    const props = properties as Record<string, unknown>
    if (typeof props.type !== 'string' || !MARK_TYPES.includes(props.type)) fail(`unsupported mark type "${props.type}"`)
    if (!isFiniteNumber(props.createdAt) || props.createdAt <= 0) fail('missing or invalid createdAt')

    const mark: Mark = { id: id as string, lng, lat, createdAt: props.createdAt as number }
    const seen = byId.get(mark.id)
    if (seen && !sameMark(seen, mark)) fail(`id "${mark.id}" appears twice with different data`)
    byId.set(mark.id, mark)
  })
  return [...byId.values()]
}

export interface ImportPlan {
  added: Mark[]
  /** Already present with identical data. */
  skipped: Mark[]
  /** Same id as an existing mark but different data; the existing mark is kept. */
  conflicts: Mark[]
}

export function planImport(existing: Mark[], incoming: Mark[]): ImportPlan {
  const current = new Map(existing.map((m) => [m.id, m]))
  const plan: ImportPlan = { added: [], skipped: [], conflicts: [] }
  for (const mark of incoming) {
    const match = current.get(mark.id)
    if (!match) plan.added.push(mark)
    else if (sameMark(match, mark)) plan.skipped.push(mark)
    else plan.conflicts.push(mark)
  }
  return plan
}
