import { describe, expect, it } from 'vitest'
import type { StyleSpecification } from 'maplibre-gl'
import { imageryErrorMessage, initialMapStyle, sharpenImagery, styleFor } from '~/utils/mapStyles'

describe('initialMapStyle', () => {
  it('defaults to Hybrid with a key and Street without', () => {
    expect(initialMapStyle(null, true)).toBe('hybrid')
    expect(initialMapStyle(null, false)).toBe('street')
  })

  it('uses the saved preference when it is still usable', () => {
    expect(initialMapStyle('satellite', true)).toBe('satellite')
    expect(initialMapStyle('street', true)).toBe('street')
    expect(initialMapStyle('street', false)).toBe('street')
  })

  it('ignores imagery preferences without a key and unknown values', () => {
    expect(initialMapStyle('hybrid', false)).toBe('street')
    expect(initialMapStyle('bogus', true)).toBe('hybrid')
  })
})

describe('styleFor', () => {
  it('uses the official MapTiler satellite and hybrid styles', () => {
    expect(styleFor('satellite', 'k&y')).toBe('https://api.maptiler.com/maps/satellite-v4/style.json?key=k%26y')
    expect(styleFor('hybrid', 'key')).toBe('https://api.maptiler.com/maps/hybrid-v4/style.json?key=key')
  })

  it('builds the street map inline from OpenStreetMap tiles', () => {
    const style = styleFor('street', '')
    expect(typeof style).toBe('object')
    expect(JSON.stringify(style)).toContain('tile.openstreetmap.org')
  })
})

describe('sharpenImagery', () => {
  const imagery: StyleSpecification = {
    version: 8,
    sources: {
      satellite: { type: 'raster', url: 'https://api.maptiler.com/tiles/satellite-v2/tiles.json?key=k' },
      maptiler_planet: { type: 'vector', url: 'https://api.maptiler.com/tiles/v4/tiles.json?key=k' },
    },
    layers: [],
  }

  it('fetches imagery one zoom deeper on high-DPI screens', () => {
    const sharp = sharpenImagery(imagery, 2)
    expect(sharp.sources.satellite).toEqual({ ...imagery.sources.satellite, tileSize: 256 })
    expect(sharp.sources.maptiler_planet).toBe(imagery.sources.maptiler_planet)
    expect(imagery.sources.satellite).not.toHaveProperty('tileSize') // input untouched
  })

  it('leaves standard screens and the street map unchanged', () => {
    expect(sharpenImagery(imagery, 1)).toBe(imagery)
    const street = styleFor('street', '') as StyleSpecification
    expect(sharpenImagery(street, 2)).toBe(street)
  })
})

describe('imageryErrorMessage', () => {
  it('explains the likely cause', () => {
    expect(imageryErrorMessage(403)).toMatch(/rejected the API key/)
    expect(imageryErrorMessage(429)).toMatch(/quota/)
    expect(imageryErrorMessage(500)).toMatch(/HTTP 500/)
    expect(imageryErrorMessage(undefined)).toMatch(/Could not reach/)
  })
})
