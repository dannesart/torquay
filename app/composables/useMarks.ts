import { ref, shallowRef } from 'vue'
import type { Mark, MarksStore } from '~/utils/marksDb'

type Action = { type: 'add' | 'remove'; mark: Mark }

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
    const { mark } = action
    if (adding) {
      // Filtering by id first means restoring a mark can never duplicate it.
      marks.value = [...marks.value.filter((m) => m.id !== mark.id), mark].sort((a, b) => a.createdAt - b.createdAt)
      persist(() => store.put(mark))
    } else {
      marks.value = marks.value.filter((m) => m.id !== mark.id)
      persist(() => store.remove(mark.id))
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
    record({ type: 'add', mark })
    return mark
  }

  function remove(id: string) {
    const mark = marks.value.find((m) => m.id === id)
    if (mark) record({ type: 'remove', mark })
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

  return { marks, saveError, load, add, remove, undo, redo, flush }
}
