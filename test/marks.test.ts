import { describe, expect, it } from 'vitest'
import { useMarks } from '~/composables/useMarks'
import { createMarksDb, type Mark, type MarksStore, type Polygon } from '~/utils/marksDb'
import { investigationToGeoJSON, parseInvestigationGeoJSON } from '~/utils/geojson'

let dbCount = 0
const freshDb = () => createMarksDb(`test-${++dbCount}`)
const area = (id: string, createdAt = 1): Polygon => ({ id, ring: [[0, 0], [1, 0], [1, 1]], createdAt })

describe('marksDb', () => {
  it('stores coordinates exactly and returns marks in creation order', async () => {
    const db = freshDb()
    await db.write({ putMarks: [{ id: 'b', lng: -3.527139185476303, lat: 50.46412290637751, createdAt: 2 }] })
    await db.write({ putMarks: [{ id: 'a', lng: -3.5253, lat: 50.4619, createdAt: 1 }] })
    const all = await db.getAll()
    expect(all.map((m) => m.id)).toEqual(['a', 'b'])
    expect(all[1]).toEqual({ id: 'b', lng: -3.527139185476303, lat: 50.46412290637751, createdAt: 2 })
  })

  it('removes a single mark', async () => {
    const db = freshDb()
    await db.write({ putMarks: [{ id: 'a', lng: 0, lat: 0, createdAt: 1 }, { id: 'b', lng: 1, lat: 1, createdAt: 2 }] })
    await db.write({ removeMarks: ['a'] })
    expect((await db.getAll()).map((m) => m.id)).toEqual(['b'])
  })

  it('writes nothing when any item in a batch is rejected, across both stores', async () => {
    const db = freshDb()
    await db.write({ putMarks: [{ id: 'existing', lng: 0, lat: 0, createdAt: 1 }] })
    // The last record has no id (the key path), which IndexedDB refuses synchronously.
    const bad = { lng: 2, lat: 2, createdAt: 3 } as unknown as Mark
    await expect(db.write({ putPolygons: [area('p')], putMarks: [{ id: 'new', lng: 1, lat: 1, createdAt: 2 }, bad] })).rejects.toThrow()
    expect((await db.getAll()).map((m) => m.id)).toEqual(['existing'])
    expect(await db.getAllPolygons()).toEqual([])
  })
})

describe('importData', () => {
  const imported = (n: number, offset = 0): Mark[] =>
    Array.from({ length: n }, (_, i) => ({ id: `imp-${offset + i}`, lng: -3.52 - i * 1e-4, lat: 50.46 + i * 1e-4, createdAt: 1000 + offset + i }))

  it('adds new marks, skips identical ones, keeps existing marks on conflict, and persists', async () => {
    const name = `test-${++dbCount}`
    const s = useMarks(createMarksDb(name))
    await s.load()
    const own = s.add(-3.53, 50.47)
    const file = parseInvestigationGeoJSON(investigationToGeoJSON({ marks: [own, { ...own, id: 'imp-x', lat: 50.48 }], polygons: [] }))
    const conflicting = { ...own, lng: 0 } // same id, moved

    const plan = await s.importData({ marks: [...file.marks, conflicting], polygons: [] })
    expect(plan.added.marks.map((m) => m.id)).toEqual(['imp-x'])
    expect(plan.skipped.marks).toEqual([own])
    expect(plan.conflicts.marks).toEqual([conflicting])
    expect(s.marks.value.find((m) => m.id === own.id)).toEqual(own) // not overwritten

    const reloaded = useMarks(createMarksDb(name))
    await reloaded.load()
    expect(reloaded.marks.value.map((m) => m.id).sort()).toEqual([own.id, 'imp-x'].sort())
    expect(reloaded.marks.value.find((m) => m.id === own.id)).toEqual(own)
  })

  it('undoes and redoes an import as one step without touching earlier marks or history', async () => {
    const db = freshDb()
    const s = useMarks(db)
    await s.load()
    const first = s.add(1, 1)
    const second = s.add(2, 2)
    await s.importData({ marks: imported(5), polygons: [area('imp-area', 2000)] })
    expect(s.marks.value).toHaveLength(7)
    expect(s.polygons.value).toHaveLength(1)

    s.undo()
    expect(s.marks.value).toEqual([first, second])
    expect(s.polygons.value).toEqual([])
    await s.flush()
    expect(await db.getAll()).toEqual([first, second])
    expect(await db.getAllPolygons()).toEqual([])

    s.redo()
    expect(s.marks.value).toHaveLength(7)
    await s.flush()
    expect(await db.getAll()).toHaveLength(7)
    expect(await db.getAllPolygons()).toEqual([area('imp-area', 2000)])

    s.undo() // the import
    s.undo() // then the earlier history is intact: removes `second`
    expect(s.marks.value).toEqual([first])
  })

  it('leaves state, storage and history untouched when the batch write fails', async () => {
    const real = freshDb()
    const failing: MarksStore = {
      ...real,
      write: async (changes) => ((changes.putMarks?.length ?? 0) > 1 ? Promise.reject(new Error('disk full')) : real.write(changes)),
    }
    const s = useMarks(failing)
    await s.load()
    const own = s.add(1, 1)

    await expect(s.importData({ marks: imported(3), polygons: [area('p')] })).rejects.toThrow('disk full')
    expect(s.marks.value).toEqual([own])
    expect(s.polygons.value).toEqual([])
    expect(await real.getAll()).toEqual([own])
    s.undo() // still undoes the last real action, not a phantom import
    expect(s.marks.value).toEqual([])
  })

  it('does not record an undo step when nothing is new', async () => {
    const s = useMarks(freshDb())
    await s.load()
    const own = s.add(1, 1)
    const plan = await s.importData({ marks: [own], polygons: [] })
    expect(plan.added).toEqual({ marks: [], polygons: [] })
    s.undo()
    expect(s.marks.value).toEqual([])
  })

  it('exports everything stored', async () => {
    const s = useMarks(freshDb())
    await s.load()
    s.add(1, 1)
    s.addPolygon([[-3.53, 50.46], [-3.52, 50.46], [-3.52, 50.47]])
    await s.importData({ marks: imported(3), polygons: [] })
    const exported = parseInvestigationGeoJSON(investigationToGeoJSON(await s.allStored()))
    expect(exported).toEqual({ marks: s.marks.value, polygons: s.polygons.value })
  })
})

describe('useMarks', () => {
  it('persists added marks so a reload restores them exactly', async () => {
    const name = `test-${++dbCount}`
    const session = useMarks(createMarksDb(name))
    await session.load()
    const coords = Array.from({ length: 20 }, (_, i) => [-3.53 + i * 0.000137, 50.46 + i * 0.000091] as const)
    for (const [lng, lat] of coords) session.add(lng, lat)
    await session.flush()

    const reloaded = useMarks(createMarksDb(name))
    await reloaded.load()
    expect(reloaded.marks.value.map((m) => [m.lng, m.lat])).toEqual(coords)
  })

  it('undoes and redoes the latest marks, including in storage', async () => {
    const db = freshDb()
    const s = useMarks(db)
    await s.load()
    const a = s.add(1, 1)
    const b = s.add(2, 2)

    s.undo()
    expect(s.marks.value.map((m) => m.id)).toEqual([a.id])
    await s.flush()
    expect((await db.getAll()).map((m) => m.id)).toEqual([a.id])

    s.redo()
    expect(s.marks.value.map((m) => m.id)).toEqual([a.id, b.id])
    await s.flush()
    expect((await db.getAll()).map((m) => m.id)).toEqual([a.id, b.id])
  })

  it('deletes an individual mark and can undo the deletion', async () => {
    const db = freshDb()
    const s = useMarks(db)
    await s.load()
    const a = s.add(1, 1)
    const b = s.add(2, 2)
    const c = s.add(3, 3)

    s.remove(b.id)
    expect(s.marks.value.map((m) => m.id)).toEqual([a.id, c.id])
    s.undo()
    expect(s.marks.value.map((m) => m.id)).toEqual([a.id, b.id, c.id])
    await s.flush()
    expect(await db.getAll()).toHaveLength(3)
  })

  it('persists a deletion so a reload does not restore the mark', async () => {
    const name = `test-${++dbCount}`
    const s = useMarks(createMarksDb(name))
    await s.load()
    const a = s.add(-3.5301, 50.4612)
    const b = s.add(-3.5302, 50.4613)
    s.remove(a.id)
    await s.flush()

    const reloaded = useMarks(createMarksDb(name))
    await reloaded.load()
    expect(reloaded.marks.value).toEqual([b])
  })

  it('undoing a deletion restores the same id and coordinates without duplicates', async () => {
    const name = `test-${++dbCount}`
    const s = useMarks(createMarksDb(name))
    await s.load()
    const a = s.add(-3.527139185476303, 50.46412290637751)
    s.add(-3.5302, 50.4613)
    s.remove(a.id)
    s.undo()
    s.undo() // undoes the second add, not the restore
    s.redo()
    await s.flush()

    expect(s.marks.value.filter((m) => m.id === a.id)).toEqual([a])
    const reloaded = useMarks(createMarksDb(name))
    await reloaded.load()
    expect(reloaded.marks.value).toHaveLength(2)
    expect(reloaded.marks.value[0]).toEqual(a)
  })

  it('redoing a deletion deletes the mark again, including in storage', async () => {
    const db = freshDb()
    const s = useMarks(db)
    await s.load()
    const a = s.add(1, 1)
    const b = s.add(2, 2)
    s.remove(a.id)
    s.undo()
    s.redo()
    expect(s.marks.value).toEqual([b])
    await s.flush()
    expect(await db.getAll()).toEqual([b])
  })

  it('removing an unknown id (e.g. an empty-space click) changes nothing', async () => {
    const db = freshDb()
    const s = useMarks(db)
    await s.load()
    const a = s.add(1, 1)
    s.remove('no-such-mark')
    s.undo() // must undo the add, proving the no-op was not recorded
    expect(s.marks.value).toEqual([])
    s.redo()
    expect(s.marks.value).toEqual([a])
  })

  it('clears the redo stack after a new mark', async () => {
    const s = useMarks(freshDb())
    await s.load()
    s.add(1, 1)
    s.undo()
    s.add(2, 2)
    s.redo()
    expect(s.marks.value.map((m) => m.lng)).toEqual([2])
  })

  it('ignores undo/redo with empty history', async () => {
    const s = useMarks(freshDb())
    await s.load()
    s.undo()
    s.redo()
    expect(s.marks.value).toEqual([])
  })

  it('keeps marks added before loading finished', async () => {
    const name = `test-${++dbCount}`
    const db = createMarksDb(name)
    await db.write({ putMarks: [{ id: 'old', lng: 0, lat: 0, createdAt: 1 }] })
    const s = useMarks(createMarksDb(name))
    const loading = s.load()
    s.add(5, 5)
    await loading
    expect(s.marks.value.map((m) => m.lng)).toEqual([0, 5])
  })
})
