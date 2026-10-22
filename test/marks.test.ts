import { describe, expect, it } from 'vitest'
import { useMarks } from '~/composables/useMarks'
import { createMarksDb } from '~/utils/marksDb'

let dbCount = 0
const freshDb = () => createMarksDb(`test-${++dbCount}`)

describe('marksDb', () => {
  it('stores coordinates exactly and returns marks in creation order', async () => {
    const db = freshDb()
    await db.put({ id: 'b', lng: -3.527139185476303, lat: 50.46412290637751, createdAt: 2 })
    await db.put({ id: 'a', lng: -3.5253, lat: 50.4619, createdAt: 1 })
    const all = await db.getAll()
    expect(all.map((m) => m.id)).toEqual(['a', 'b'])
    expect(all[1]).toEqual({ id: 'b', lng: -3.527139185476303, lat: 50.46412290637751, createdAt: 2 })
  })

  it('removes a single mark', async () => {
    const db = freshDb()
    await db.put({ id: 'a', lng: 0, lat: 0, createdAt: 1 })
    await db.put({ id: 'b', lng: 1, lat: 1, createdAt: 2 })
    await db.remove('a')
    expect((await db.getAll()).map((m) => m.id)).toEqual(['b'])
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
    await db.put({ id: 'old', lng: 0, lat: 0, createdAt: 1 })
    const s = useMarks(createMarksDb(name))
    const loading = s.load()
    s.add(5, 5)
    await loading
    expect(s.marks.value.map((m) => m.lng)).toEqual([0, 5])
  })
})
