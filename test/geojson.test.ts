import { describe, expect, it } from 'vitest'
import { exportFilename, ImportError, marksToGeoJSON, parseMarksGeoJSON, planImport } from '~/utils/geojson'
import type { Mark } from '~/utils/marksDb'

const a: Mark = { id: '0b6f3f9e-a', lng: -3.527139185476303, lat: 50.46412290637751, createdAt: 1761170000000 }
const b: Mark = { id: '0b6f3f9e-b', lng: -3.5253, lat: 50.4619, createdAt: 1761170000001 }

/** A one-feature file with the given feature overrides. */
function fileWith(feature: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: 'FeatureCollection',
    mapmarks: { version: 1 },
    features: [{ type: 'Feature', id: 'x', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { type: 'red-x', createdAt: 1 }, ...feature }],
    ...extra,
  })
}

describe('marksToGeoJSON', () => {
  it('writes a valid FeatureCollection of Points with id, type, metadata and format version', () => {
    const data = JSON.parse(marksToGeoJSON([b, a]))
    expect(data.type).toBe('FeatureCollection')
    expect(data.mapmarks).toEqual({ version: 1 })
    expect(data.features).toEqual([
      { type: 'Feature', id: a.id, geometry: { type: 'Point', coordinates: [a.lng, a.lat] }, properties: { type: 'red-x', createdAt: a.createdAt } },
      { type: 'Feature', id: b.id, geometry: { type: 'Point', coordinates: [b.lng, b.lat] }, properties: { type: 'red-x', createdAt: b.createdAt } },
    ])
  })

  it('is deterministic regardless of input order', () => {
    expect(marksToGeoJSON([a, b])).toBe(marksToGeoJSON([b, a]))
  })

  it('names the file after the local date', () => {
    expect(exportFilename(new Date(2026, 9, 3))).toBe('mapmarks-2026-10-03.geojson')
  })
})

describe('parseMarksGeoJSON', () => {
  it('round-trips marks with bit-identical coordinates', () => {
    const many = Array.from({ length: 150 }, (_, i) => ({
      id: `id-${i}`,
      lng: -3.53 + Math.random() * 0.05,
      lat: 50.45 + Math.random() * 0.05,
      createdAt: 1761170000000 + i,
    }))
    expect(parseMarksGeoJSON(marksToGeoJSON(many))).toEqual(many)
  })

  it('collapses identical duplicate ids within a file', () => {
    const text = JSON.stringify({ ...JSON.parse(marksToGeoJSON([a])), features: JSON.parse(marksToGeoJSON([a, a])).features })
    expect(parseMarksGeoJSON(text)).toEqual([a])
  })

  it('rejects malformed and unsupported files with a clear reason', () => {
    const cases: [string, RegExp][] = [
      ['not json', /not valid JSON/],
      ['[]', /not a GeoJSON FeatureCollection/],
      [JSON.stringify({ type: 'FeatureCollection', features: [] }), /not a MapMarks export/],
      [fileWith({}, { mapmarks: { version: 2 } }), /Unsupported MapMarks format version 2/],
      [fileWith({ type: 'Polygon' }), /Feature 1: not a GeoJSON Feature/],
      [fileWith({ id: '' }), /invalid id/],
      [fileWith({ id: 42 }), /invalid id/],
      [fileWith({ geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }), /not a Point/],
      [fileWith({ geometry: { type: 'Point', coordinates: [0] } }), /\[longitude, latitude\]/],
      [fileWith({ geometry: { type: 'Point', coordinates: ['1', 2] } }), /\[longitude, latitude\]/],
      [fileWith({ geometry: { type: 'Point', coordinates: [181, 0] } }), /longitude 181 is out of range/],
      [fileWith({ geometry: { type: 'Point', coordinates: [0, -91] } }), /latitude -91 is out of range/],
      [fileWith({ properties: { type: 'circle', createdAt: 1 } }), /unsupported mark type "circle"/],
      [fileWith({ properties: { type: 'red-x' } }), /invalid createdAt/],
    ]
    for (const [text, reason] of cases) {
      expect(() => parseMarksGeoJSON(text), text).toThrowError(ImportError)
      expect(() => parseMarksGeoJSON(text), text).toThrowError(reason)
    }
  })

  it('rejects NaN/Infinity smuggled in as coordinates', () => {
    // JSON cannot encode NaN, but 1e999 parses to Infinity.
    expect(() => parseMarksGeoJSON(fileWith({ geometry: { type: 'Point', coordinates: [0, 0] } }).replace('[0,0]', '[1e999,0]'))).toThrowError(/\[longitude, latitude\]/)
  })

  it('rejects a file using one id for two different marks', () => {
    const twice = JSON.parse(marksToGeoJSON([a]))
    twice.features.push({ ...twice.features[0], geometry: { type: 'Point', coordinates: [0, 0] } })
    expect(() => parseMarksGeoJSON(JSON.stringify(twice))).toThrowError(/appears twice with different data/)
  })
})

describe('planImport', () => {
  it('adds new marks, skips identical ones and reports conflicts without overwriting', () => {
    const moved = { ...b, lng: b.lng + 0.001 }
    const c: Mark = { id: 'c', lng: 1, lat: 1, createdAt: 5 }
    const plan = planImport([a, b], [a, moved, c])
    expect(plan.added).toEqual([c])
    expect(plan.skipped).toEqual([a])
    expect(plan.conflicts).toEqual([moved])
  })
})
