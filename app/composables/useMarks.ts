import { ref, shallowRef } from 'vue'
import type { Changes, Investigation, Mark, MarksStore, Polygon } from '~/utils/marksDb'
import { planImport, type ImportPlan } from '~/utils/geojson'
import { counterClockwise, ringProblem, sameRing, type LngLat } from '~/utils/polygon'

/** One undoable step. An import is a single 'add' of many marks and polygons. */
type Action =
  | { type: 'add' | 'remove'; marks: Mark[]; polygons: Polygon[] }
  | { type: 'update'; before: Polygon; after: Polygon }

const byCreation = (a: { createdAt: number }, b: { createdAt: number }) => a.createdAt - b.createdAt

/** Replaces items with the same ids (so restoring never duplicates) and keeps creation order. */
function upsert<T extends { id: string; createdAt: number }>(list: T[], items: T[]): T[] {
  const ids = new Set(items.map((i) => i.id))
  return [...list.filter((i) => !ids.has(i.id)), ...items].sort(byCreation)
}

/** Strictly increasing so order survives reloads even for items made within the same millisecond. */
const nextCreatedAt = (list: { createdAt: number }[]) => Math.max(Date.now(), (list.at(-1)?.createdAt ?? 0) + 1)

/**
 * Marks and exclusion polygons with undo/redo. Every change is written to the store immediately;
 * writes are chained so they reach IndexedDB in the order they were made.
 */
export function useMarks(store: MarksStore) {
  const marks = shallowRef<Mark[]>([])
  const polygons = shallowRef<Polygon[]>([])
  const saveError = ref<string | null>(null)
  const undoStack: Action[] = []
  const redoStack: Action[] = []

  let writes: Promise<void> = Promise.resolve()
  function persist(changes: Changes) {
    writes = writes.then(() => store.write(changes)).catch((err) => {
      console.error('MapMarks: failed to save', err)
      saveError.value = String(err)
    })
  }

  async function load() {
    const [storedMarks, storedPolygons] = await Promise.all([store.getAll(), store.getAllPolygons()])
    // Keep anything added while loading.
    marks.value = [...storedMarks, ...marks.value]
    polygons.value = [...storedPolygons, ...polygons.value]
  }

  function apply(action: Action, reverse: boolean) {
    if (action.type === 'update') {
      const polygon = reverse ? action.before : action.after
      polygons.value = upsert(polygons.value, [polygon])
      persist({ putPolygons: [polygon] })
      return
    }
    const adding = (action.type === 'add') !== reverse
    if (adding) {
      marks.value = upsert(marks.value, action.marks)
      polygons.value = upsert(polygons.value, action.polygons)
      persist({ putMarks: action.marks, putPolygons: action.polygons })
    } else {
      const markIds = new Set(action.marks.map((m) => m.id))
      const polygonIds = new Set(action.polygons.map((p) => p.id))
      marks.value = marks.value.filter((m) => !markIds.has(m.id))
      polygons.value = polygons.value.filter((p) => !polygonIds.has(p.id))
      persist({ removeMarks: [...markIds], removePolygons: [...polygonIds] })
    }
  }

  function record(action: Action) {
    apply(action, false)
    undoStack.push(action)
    redoStack.length = 0
  }

  function add(lng: number, lat: number): Mark {
    const mark: Mark = { id: crypto.randomUUID(), lng, lat, createdAt: nextCreatedAt(marks.value) }
    record({ type: 'add', marks: [mark], polygons: [] })
    return mark
  }

  function remove(id: string) {
    const mark = marks.value.find((m) => m.id === id)
    if (mark) record({ type: 'remove', marks: [mark], polygons: [] })
  }

  /** Saves a finished polygon. Callers validate first; an invalid ring here is a bug and is refused. */
  function addPolygon(ring: LngLat[]): Polygon {
    const problem = ringProblem(ring)
    if (problem) throw new Error(`Invalid polygon: ${problem}`)
    const polygon: Polygon = { id: crypto.randomUUID(), ring: counterClockwise(ring), createdAt: nextCreatedAt(polygons.value) }
    record({ type: 'add', marks: [], polygons: [polygon] })
    return polygon
  }

  /** Commits an edited outline as one undoable step; only that polygon changes. */
  function updatePolygon(id: string, ring: LngLat[]) {
    const before = polygons.value.find((p) => p.id === id)
    if (!before) return
    const problem = ringProblem(ring)
    if (problem) throw new Error(`Invalid polygon: ${problem}`)
    const after: Polygon = { ...before, ring: counterClockwise(ring) }
    if (sameRing(before.ring, after.ring)) return
    record({ type: 'update', before, after })
  }

  function removePolygon(id: string) {
    const polygon = polygons.value.find((p) => p.id === id)
    if (polygon) record({ type: 'remove', marks: [], polygons: [polygon] })
  }

  /**
   * Merges validated data into the investigation as one undoable step. New items are written in a
   * single transaction before any state changes, so a failed write rejects and leaves everything as it was.
   */
  async function importData(incoming: Investigation): Promise<ImportPlan> {
    const plan = planImport({ marks: marks.value, polygons: polygons.value }, incoming)
    const { added } = plan
    if (added.marks.length + added.polygons.length === 0) return plan
    const write = writes.then(() => store.write({ putMarks: added.marks, putPolygons: added.polygons }))
    writes = write.catch(() => {}) // the caller reports this failure; later writes still run
    await write
    marks.value = upsert(marks.value, added.marks)
    polygons.value = upsert(polygons.value, added.polygons)
    undoStack.push({ type: 'add', marks: added.marks, polygons: added.polygons })
    redoStack.length = 0
    return plan
  }

  /** Everything stored, read back from the store once pending writes have finished. */
  async function allStored(): Promise<Investigation> {
    await writes
    const [storedMarks, storedPolygons] = await Promise.all([store.getAll(), store.getAllPolygons()])
    return { marks: storedMarks, polygons: storedPolygons }
  }

  function undo() {
    const action = undoStack.pop()
    if (!action) return
    apply(action, true)
    redoStack.push(action)
  }

  function redo() {
    const action = redoStack.pop()
    if (!action) return
    apply(action, false)
    undoStack.push(action)
  }

  /** Resolves once all pending writes have finished. */
  const flush = () => writes

  return {
    marks, polygons, saveError, load, add, remove, addPolygon, updatePolygon, removePolygon,
    importData, allStored, undo, redo, flush,
  }
}
