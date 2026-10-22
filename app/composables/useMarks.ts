import { ref, shallowRef } from 'vue'
import type { Mark, MarksStore } from '~/utils/marksDb'
import { planImport, type ImportPlan } from '~/utils/geojson'

/** One undoable step. An import is a single 'add' of many marks. */
type Action = { type: 'add' | 'remove'; marks: Mark[] }

const byCreation = (a: Mark, b: Mark) => a.createdAt - b.createdAt

/**
 * Mark state with undo/redo. Every change is written to the store immediately;
 * writes are chained so they reach IndexedDB in the order they were made.
 */
export function useMarks(store: MarksStore) {
  const marks = shallowRef<Mark[]>([])
  const saveError = ref<string | null>(null)
  const undoStack: Action[] = []
  const redoStack: Action[] = []

  let writes: Promise<void> = Promise.resolve()
  function persist(write: () => Promise<void>) {
    writes = writes.then(write).catch((err) => {
      console.error('MapMarks: failed to save', err)
      saveError.value = String(err)
    })
  }

  async function load() {
    const stored = await store.getAll()
    // Keep anything added while loading.
    marks.value = [...stored, ...marks.value]
  }

  function apply(action: Action, reverse: boolean) {
    const adding = (action.type === 'add') !== reverse
    const ids = new Set(action.marks.map((m) => m.id))
    // Filtering by id first means restoring marks can never duplicate them.
    const others = marks.value.filter((m) => !ids.has(m.id))
    if (adding) {
      marks.value = [...others, ...action.marks].sort(byCreation)
      persist(() => store.putMany(action.marks))
    } else {
      marks.value = others
      persist(() => store.removeMany([...ids]))
    }
  }

  function record(action: Action) {
    apply(action, false)
    undoStack.push(action)
    redoStack.length = 0
  }

  function add(lng: number, lat: number): Mark {
    // Strictly increasing so order survives reloads even for marks made within the same millisecond.
    const last = marks.value.at(-1)?.createdAt ?? 0
    const mark: Mark = { id: crypto.randomUUID(), lng, lat, createdAt: Math.max(Date.now(), last + 1) }
    record({ type: 'add', marks: [mark] })
    return mark
  }

  function remove(id: string) {
    const mark = marks.value.find((m) => m.id === id)
    if (mark) record({ type: 'remove', marks: [mark] })
  }

  /**
   * Merges validated marks into the investigation as one undoable step. New marks are written in a
   * single transaction before any state changes, so a failed write rejects and leaves everything as it was.
   */
  async function importMarks(incoming: Mark[]): Promise<ImportPlan> {
    const plan = planImport(marks.value, incoming)
    if (plan.added.length === 0) return plan
    const write = writes.then(() => store.putMany(plan.added))
    writes = write.catch(() => {}) // the caller reports this failure; later writes still run
    await write
    const ids = new Set(plan.added.map((m) => m.id))
    marks.value = [...marks.value.filter((m) => !ids.has(m.id)), ...plan.added].sort(byCreation)
    undoStack.push({ type: 'add', marks: plan.added })
    redoStack.length = 0
    return plan
  }

  /** Every stored mark, read back from the store once pending writes have finished. */
  async function allStored(): Promise<Mark[]> {
    await writes
    return store.getAll()
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

  return { marks, saveError, load, add, remove, importMarks, allStored, undo, redo, flush }
}
