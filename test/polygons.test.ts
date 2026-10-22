import { describe, expect, it } from 'vitest'
import { openDB } from 'idb'
import { useMarks } from '~/composables/useMarks'
import { usePolygonDraft } from '~/composables/usePolygonDraft'
import { createMarksDb } from '~/utils/marksDb'
import { eraseTargetAt, polygonContains, vertexAtPoint } from '~/utils/hitTest'
import { counterClockwise, ringProblem, signedArea, withoutRepeats, type LngLat } from '~/utils/polygon'

let dbCount = 0
const freshName = () => `poly-test-${++dbCount}`
// A block of Torquay houses, drawn clockwise as a user might.
const BLOCK: LngLat[] = [[-3.5312, 50.4649], [-3.5251, 50.4655], [-3.5255, 50.4612], [-3.5309, 50.4610]]

describe('ringProblem', () => {
  it('accepts simple polygons', () => {
    expect(ringProblem(BLOCK)).toBeNull()
    expect(ringProblem([[0, 0], [1, 0], [0, 1]])).toBeNull()
    // Concave but simple.
    expect(ringProblem([[0, 0], [4, 0], [4, 4], [2, 1], [0, 4]])).toBeNull()
  })

  it('rejects degenerate and self-intersecting rings', () => {
    expect(ringProblem([[0, 0], [1, 1]])).toMatch(/at least 3 points/)
    expect(ringProblem([[0, 0], [1, 1], [2, 2]])).toMatch(/area is zero/)
    expect(ringProblem([[0, 0], [2, 2], [2, 0], [0, 2]])).toMatch(/edges cross/)
    expect(ringProblem([[0, 0], [2, 0], [2, 2], [1, 0], [0, 2]])).toMatch(/edges cross/) // touches another edge
    expect(ringProblem([[0, 0], [2, 0], [1, 0], [1, 1]])).toMatch(/edges cross/) // folds back
    expect(ringProblem([[0, 0], [2, 0], [1, 0]])).toMatch(/area is zero/) // flat fold-back triangle
    expect(ringProblem([[0, 0], [1, 0], [1, 0], [1, 1]])).toMatch(/repeats/)
    expect(ringProblem([[0, 0], [1, 0], [Number.NaN, 1]])).toMatch(/range/)
    expect(ringProblem([[0, 0], [1, 0], [1, 91]])).toMatch(/range/)
  })

  it('normalises orientation to counterclockwise without moving points', () => {
    expect(signedArea(BLOCK)).toBeLessThan(0)
    const ccw = counterClockwise(BLOCK)
    expect(signedArea(ccw)).toBeGreaterThan(0)
    expect([...ccw].sort()).toEqual([...BLOCK].sort())
    expect(counterClockwise(ccw)).toBe(ccw)
  })

  it('drops double-click repeats and a closing point', () => {
    expect(withoutRepeats([[0, 0], [1, 0], [1, 0], [1, 1], [1, 1], [0, 0]])).toEqual([[0, 0], [1, 0], [1, 1]])
  })
})

describe('usePolygonDraft', () => {
  it('completes a polygon from at least three points', () => {
    const draft = usePolygonDraft()
    draft.add(BLOCK[0]!)
    draft.add(BLOCK[1]!)
    expect(draft.finish()).toEqual({ error: 'a polygon needs at least 3 points' })
    expect(draft.points.value).toHaveLength(2) // kept so drawing can continue
    draft.add(BLOCK[2]!)
    draft.add(BLOCK[2]!) // the extra point from a double-click
    expect(draft.finish()).toEqual({ ring: BLOCK.slice(0, 3) })
    expect(draft.active.value).toBe(false)
  })

  it('cancels and removes the last point', () => {
    const draft = usePolygonDraft()
    BLOCK.forEach((p) => draft.add(p))
    draft.removeLast()
    expect(draft.points.value).toEqual(BLOCK.slice(0, 3))
    draft.cancel()
    expect(draft.points.value).toEqual([])
    expect(draft.finish()).toEqual({ error: 'a polygon needs at least 3 points' })
  })

  it('refuses to finish a crossing outline and keeps the draft for fixing', () => {
    const draft = usePolygonDraft()
    for (const p of [[0, 0], [2, 2], [2, 0], [0, 2]] as LngLat[]) draft.add(p)
    expect(draft.finish()).toEqual({ error: 'its edges cross' })
    draft.removeLast()
    expect('ring' in draft.finish()).toBe(true)
  })
})

describe('polygons in useMarks', () => {
  it('creates, persists and reloads a polygon with identical coordinates', async () => {
    const name = freshName()
    const s = useMarks(createMarksDb(name))
    await s.load()
    const polygon = s.addPolygon(BLOCK)
    expect(polygon.ring).toEqual(counterClockwise(BLOCK))
    await s.flush()

    const reloaded = useMarks(createMarksDb(name))
    await reloaded.load()
    expect(reloaded.polygons.value).toEqual([polygon])
  })

  it('refuses invalid polygons and stores nothing', async () => {
    const db = createMarksDb(freshName())
    const s = useMarks(db)
    await s.load()
    expect(() => s.addPolygon([[0, 0], [2, 2], [2, 0], [0, 2]])).toThrow(/edges cross/)
    await s.flush()
    expect(s.polygons.value).toEqual([])
    expect(await db.getAllPolygons()).toEqual([])
  })

  it('edits one polygon as a single undoable step without touching others', async () => {
    const db = createMarksDb(freshName())
    const s = useMarks(db)
    await s.load()
    const mark = s.add(-3.528, 50.463)
    const target = s.addPolygon(BLOCK)
    const other = s.addPolygon([[-3.52, 50.47], [-3.51, 50.47], [-3.51, 50.48]])
    const moved = target.ring.map((p, i) => (i === 1 ? [p[0] + 0.0004, p[1] + 0.0002] : p) as LngLat)

    s.updatePolygon(target.id, moved)
    expect(s.polygons.value.find((p) => p.id === target.id)!.ring).toEqual(moved)
    expect(s.polygons.value.find((p) => p.id === other.id)).toEqual(other)
    expect(s.marks.value).toEqual([mark])

    s.undo()
    expect(s.polygons.value).toEqual([target, other])
    s.redo()
    await s.flush()
    expect((await db.getAllPolygons()).find((p) => p.id === target.id)!.ring).toEqual(moved)
    expect(await db.getAll()).toEqual([mark])
  })

  it('rejects an edit that would make the outline cross itself', async () => {
    const s = useMarks(createMarksDb(freshName()))
    await s.load()
    const target = s.addPolygon([[0, 0], [2, 0], [2, 2], [0, 2]])
    expect(() => s.updatePolygon(target.id, [[0, 0], [2, 0], [0, 2], [2, 2]])).toThrow(/edges cross/)
    expect(s.polygons.value).toEqual([target])
    s.undo() // undoes the creation, proving the failed edit was not recorded
    expect(s.polygons.value).toEqual([])
  })

  it('ignores an edit that changes nothing', async () => {
    const s = useMarks(createMarksDb(freshName()))
    await s.load()
    const target = s.addPolygon(BLOCK)
    s.updatePolygon(target.id, [...target.ring])
    s.undo()
    expect(s.polygons.value).toEqual([])
  })

  it('deletes a polygon and restores the same one with undo; redo deletes it again', async () => {
    const name = freshName()
    const s = useMarks(createMarksDb(name))
    await s.load()
    const keep = s.addPolygon(BLOCK)
    const target = s.addPolygon([[-3.52, 50.47], [-3.51, 50.47], [-3.51, 50.48]])

    s.removePolygon(target.id)
    expect(s.polygons.value).toEqual([keep])
    s.undo()
    expect(s.polygons.value).toEqual([keep, target])
    s.redo()
    await s.flush()

    const reloaded = useMarks(createMarksDb(name))
    await reloaded.load()
    expect(reloaded.polygons.value).toEqual([keep])
  })

  it('never creates or removes Red X marks inside an area', async () => {
    const s = useMarks(createMarksDb(freshName()))
    await s.load()
    const inside = s.add(-3.528, 50.463)
    const p = s.addPolygon(BLOCK)
    s.removePolygon(p.id)
    s.undo()
    expect(s.marks.value).toEqual([inside])
  })
})

describe('database upgrade', () => {
  it('keeps every existing version 1 mark when adding the polygon store', async () => {
    const name = freshName()
    const marks = Array.from({ length: 150 }, (_, i) => ({ id: `m-${i}`, lng: -3.53 + i * 1e-5, lat: 50.46 + i * 1e-5, createdAt: i + 1 }))
    // Recreate the 0.4 database exactly: version 1 with only the marks store.
    const v1 = await openDB(name, 1, { upgrade: (db) => db.createObjectStore('marks', { keyPath: 'id' }) })
    const tx = v1.transaction('marks', 'readwrite')
    await Promise.all([...marks.map((m) => tx.store.put(m)), tx.done])
    v1.close()

    const s = useMarks(createMarksDb(name))
    await s.load()
    expect(s.marks.value).toEqual(marks)
    expect(s.polygons.value).toEqual([])
    s.addPolygon(BLOCK)
    await s.flush()

    const reloaded = useMarks(createMarksDb(name))
    await reloaded.load()
    expect(reloaded.marks.value).toEqual(marks)
    expect(reloaded.polygons.value).toHaveLength(1)
  })
})

describe('polygon hit testing', () => {
  const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
  const options = { markRadius: 10, safetyRadius: 20, edgeTolerance: 4 }

  it('detects points inside, on the outline tolerance, and outside', () => {
    expect(polygonContains(square, { x: 50, y: 50 })).toBe(true)
    expect(polygonContains(square, { x: 103, y: 50 }, 4)).toBe(true)
    expect(polygonContains(square, { x: 106, y: 50 }, 4)).toBe(false)
    expect(polygonContains(square, { x: 150, y: 50 })).toBe(false)
  })

  it('finds the vertex handle under the pointer', () => {
    expect(vertexAtPoint(square, { x: 97, y: 4 }, 8)).toBe(1)
    expect(vertexAtPoint(square, { x: 50, y: 50 }, 8)).toBeUndefined()
  })

  it('erases a Red X before the area beneath it', () => {
    const marks = [{ id: 'm', x: 50, y: 50 }]
    expect(eraseTargetAt(marks, [{ id: 'p', ring: square }], { x: 52, y: 50 }, options)).toEqual({ kind: 'mark', id: 'm' })
  })

  it('erases nothing when a click narrowly misses a mark inside an area', () => {
    const marks = [{ id: 'm', x: 50, y: 50 }]
    expect(eraseTargetAt(marks, [{ id: 'p', ring: square }], { x: 64, y: 50 }, options)).toBeUndefined()
    expect(eraseTargetAt(marks, [{ id: 'p', ring: square }], { x: 80, y: 50 }, options)).toEqual({ kind: 'polygon', id: 'p' })
  })

  it('erases the topmost of overlapping areas', () => {
    const shifted = square.map((p) => ({ x: p.x + 50, y: p.y }))
    const target = eraseTargetAt([], [{ id: 'lower', ring: square }, { id: 'upper', ring: shifted }], { x: 75, y: 50 }, options)
    expect(target).toEqual({ kind: 'polygon', id: 'upper' })
  })
})
