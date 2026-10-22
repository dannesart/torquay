import { describe, expect, it } from 'vitest'
import { exportFilename, ImportError, investigationToGeoJSON, parseInvestigationGeoJSON, planImport } from '~/utils/geojson'
import type { Mark, Polygon } from '~/utils/marksDb'

const a: Mark = { id: '0b6f3f9e-a', lng: -3.527139185476303, lat: 50.46412290637751, createdAt: 1761170000000 }
const b: Mark = { id: '0b6f3f9e-b', lng: -3.5253, lat: 50.4619, createdAt: 1761170000002 }
// Counterclockwise, as the app stores them.
const area: Polygon = {
  id: 'area-1',
  ring: [[-3.531234567890123, 50.461], [-3.5251, 50.4612], [-3.5255, 50.4655], [-3.5302, 50.4649]],
  createdAt: 1761170000001,
}

/** A one-feature file with the given feature overrides. */
function fileWith(feature: Record<string, unknown>, version = 2) {
  return JSON.stringify({
    type: 'FeatureCollection',
    mapmarks: { version },
    features: [{ type: 'Feature', id: 'x', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { type: 'red-x', createdAt: 1 }, ...feature }],
  })
}
const polygonFile = (ring: unknown[], extra: Record<string, unknown> = {}) =>
  fileWith({ geometry: { type: 'Polygon', coordinates: [ring] }, properties: { type: 'exclusion-area', createdAt: 1 }, ...extra })

describe('investigationToGeoJSON', () => {
  it('writes Points and closed Polygons with id, type, createdAt and the format version', () => {
    const data = JSON.parse(investigationToGeoJSON({ marks: [b, a], polygons: [area] }))
    expect(data.type).toBe('FeatureCollection')
    expect(data.mapmarks).toEqual({ version: 2 })
    expect(data.features).toEqual([
      { type: 'Feature', id: a.id, geometry: { type: 'Point', coordinates: [a.lng, a.lat] }, properties: { type: 'red-x', createdAt: a.createdAt } },
      {
        type: 'Feature',
        id: area.id,
        geometry: { type: 'Polygon', coordinates: [[...area.ring, area.ring[0]]] },
        properties: { type: 'exclusion-area', createdAt: area.createdAt },
      },
      { type: 'Feature', id: b.id, geometry: { type: 'Point', coordinates: [b.lng, b.lat] }, properties: { type: 'red-x', createdAt: b.createdAt } },
    ])
  })

  it('is deterministic regardless of input order', () => {
    expect(investigationToGeoJSON({ marks: [a, b], polygons: [area] })).toBe(investigationToGeoJSON({ marks: [b, a], polygons: [area] }))
  })

  it('names the file after the local date', () => {
    expect(exportFilename(new Date(2026, 9, 3))).toBe('mapmarks-2026-10-03.geojson')
  })
})

describe('parseInvestigationGeoJSON', () => {
  it('round-trips mixed files with bit-identical coordinates', () => {
    const marks = Array.from({ length: 150 }, (_, i) => ({
      id: `id-${i}`,
      lng: -3.53 + Math.random() * 0.05,
      lat: 50.45 + Math.random() * 0.05,
      createdAt: 1761170000000 + i,
    }))
    const data = { marks, polygons: [area] }
    expect(parseInvestigationGeoJSON(investigationToGeoJSON(data))).toEqual(data)
  })

  it('still reads version 1 backups (Red X only)', () => {
    const v1 = JSON.stringify({
      type: 'FeatureCollection',
      mapmarks: { version: 1 },
      features: [{ type: 'Feature', id: a.id, geometry: { type: 'Point', coordinates: [a.lng, a.lat] }, properties: { type: 'red-x', createdAt: a.createdAt } }],
    })
    expect(parseInvestigationGeoJSON(v1)).toEqual({ marks: [a], polygons: [] })
  })

  it('stores imported clockwise rings counterclockwise without changing any point', () => {
    const clockwise = [...area.ring].reverse()
    const parsed = parseInvestigationGeoJSON(polygonFile([...clockwise, clockwise[0]]))
    expect(parsed.polygons[0]!.ring).toEqual(area.ring)
  })

  it('collapses identical duplicate ids within a file', () => {
    const data = JSON.parse(investigationToGeoJSON({ marks: [a], polygons: [area] }))
    data.features.push(...data.features)
    expect(parseInvestigationGeoJSON(JSON.stringify(data))).toEqual({ marks: [a], polygons: [area] })
  })

  it('rejects a file using one id for two different features, including a mark and an area', () => {
    const twice = JSON.parse(investigationToGeoJSON({ marks: [a], polygons: [] }))
    twice.features.push({ ...twice.features[0], geometry: { type: 'Point', coordinates: [0, 0] } })
    expect(() => parseInvestigationGeoJSON(JSON.stringify(twice))).toThrowError(/appears twice with different data/)

    const mixed = JSON.parse(investigationToGeoJSON({ marks: [a], polygons: [{ ...area, id: a.id }] }))
    expect(() => parseInvestigationGeoJSON(JSON.stringify(mixed))).toThrowError(/appears twice with different data/)
  })

  it('rejects malformed and unsupported files with a clear reason', () => {
    const cases: [string, RegExp][] = [
      ['not json', /not valid JSON/],
      ['[]', /not a GeoJSON FeatureCollection/],
      [JSON.stringify({ type: 'FeatureCollection', features: [] }), /not a MapMarks export/],
      [fileWith({}, 3), /Unsupported MapMarks format version 3/],
      [fileWith({ type: 'Polygon' }), /Feature 1: not a GeoJSON Feature/],
      [fileWith({ id: '' }), /invalid id/],
      [fileWith({ id: 42 }), /invalid id/],
      [fileWith({ geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }), /a Red X must be a Point/],
      [fileWith({ geometry: { type: 'Point', coordinates: [0] } }), /\[longitude, latitude\]/],
      [fileWith({ geometry: { type: 'Point', coordinates: ['1', 2] } }), /\[longitude, latitude\]/],
      [fileWith({ geometry: { type: 'Point', coordinates: [181, 0] } }), /longitude 181 is out of range/],
      [fileWith({ geometry: { type: 'Point', coordinates: [0, -91] } }), /latitude -91 is out of range/],
      [fileWith({ properties: { type: 'circle', createdAt: 1 } }), /unsupported feature type "circle"/],
      [fileWith({ properties: { type: 'red-x' } }), /invalid createdAt/],
      // Areas did not exist in version 1.
      [polygonFile([[0, 0], [1, 0], [1, 1], [0, 0]]).replace('"version":2', '"version":1'), /unsupported feature type "exclusion-area" in format version 1/],
    ]
    for (const [text, reason] of cases) {
      expect(() => parseInvestigationGeoJSON(text), text).toThrowError(ImportError)
      expect(() => parseInvestigationGeoJSON(text), text).toThrowError(reason)
    }
  })

  it('rejects malformed, degenerate and self-intersecting polygons instead of repairing them', () => {
    const cases: [string, RegExp][] = [
      [polygonFile([[0, 0], [1, 0], [1, 1]]), /at least 4 positions/],
      [polygonFile([[0, 0], [1, 0], [1, 1], [0, 1]]), /not closed/],
      [fileWith({ geometry: { type: 'Polygon', coordinates: [] }, properties: { type: 'exclusion-area', createdAt: 1 } }), /no coordinates/],
      [fileWith({ geometry: { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 4], [0, 0]], [[1, 1], [2, 1], [2, 2], [1, 1]]] }, properties: { type: 'exclusion-area', createdAt: 1 } }), /holes are not supported/],
      [fileWith({ geometry: { type: 'Point', coordinates: [0, 0] }, properties: { type: 'exclusion-area', createdAt: 1 } }), /must be a Polygon/],
      [polygonFile([[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]), /edges cross/], // bow tie
      [polygonFile([[0, 0], [1, 1], [2, 2], [0, 0]]), /area is zero/], // collinear
      [polygonFile([[0, 0], [1, 0], [1, 0], [1, 1], [0, 0]]), /repeats the same point/],
      [polygonFile([[0, 0], [2, 0], [1, 0], [1, 1], [0, 0]]), /edges cross/], // folds back on itself
      [polygonFile([[0, 0], [190, 0], [1, 1], [0, 0]]), /outside the valid longitude\/latitude range/],
      [polygonFile([[0, 0], [1, 0], ['x', 1], [0, 0]]), /\[longitude, latitude\]/],
    ]
    for (const [text, reason] of cases) {
      expect(() => parseInvestigationGeoJSON(text), text).toThrowError(ImportError)
      expect(() => parseInvestigationGeoJSON(text), text).toThrowError(reason)
    }
  })

  it('rejects NaN/Infinity smuggled in as coordinates', () => {
    // JSON cannot encode NaN, but 1e999 parses to Infinity.
    expect(() => parseInvestigationGeoJSON(fileWith({}).replace('[0,0]', '[1e999,0]'))).toThrowError(/\[longitude, latitude\]/)
  })
})

describe('planImport', () => {
  it('adds new items, skips identical ones and reports conflicts without overwriting', () => {
    const moved = { ...b, lng: b.lng + 0.001 }
    const c: Mark = { id: 'c', lng: 1, lat: 1, createdAt: 5 }
    const reshaped: Polygon = { ...area, ring: [...area.ring.slice(0, 3), [-3.53, 50.465]] }
    const newArea: Polygon = { ...area, id: 'area-2' }
    const plan = planImport({ marks: [a, b], polygons: [area] }, { marks: [a, moved, c], polygons: [reshaped, newArea] })
    expect(plan.added).toEqual({ marks: [c], polygons: [newArea] })
    expect(plan.skipped).toEqual({ marks: [a], polygons: [] })
    expect(plan.conflicts).toEqual({ marks: [moved], polygons: [reshaped] })
  })

  it('treats an area reusing an existing mark id as a conflict', () => {
    const plan = planImport({ marks: [a], polygons: [] }, { marks: [], polygons: [{ ...area, id: a.id }] })
    expect(plan.conflicts.polygons).toHaveLength(1)
    expect(plan.added.polygons).toEqual([])
  })
})
