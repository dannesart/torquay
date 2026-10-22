import { openDB, type IDBPDatabase, type IDBPObjectStore } from 'idb'

export interface Mark {
  id: string
  lng: number
  lat: number
  createdAt: number
}

export interface MarksStore {
  getAll(): Promise<Mark[]>
  /** Writes all marks in one transaction: either every mark is stored or none is. */
  putMany(marks: Mark[]): Promise<void>
  /** Deletes all ids in one transaction. */
  removeMany(ids: string[]): Promise<void>
}

const STORE = 'marks' as const
type Store = IDBPObjectStore<unknown, [typeof STORE], typeof STORE, 'readwrite'>

/**
 * Runs `op` for every item inside one readwrite transaction. Any failure, including a request that throws
 * synchronously (e.g. an invalid key), aborts the transaction so none of the changes are committed.
 */
async function inOneTransaction<T>(db: Promise<IDBPDatabase>, items: T[], op: (store: Store, item: T) => Promise<unknown>) {
  const tx = (await db).transaction(STORE, 'readwrite')
  const pending: Promise<unknown>[] = [tx.done]
  try {
    for (const item of items) pending.push(op(tx.store, item))
    await Promise.all(pending)
  } catch (err) {
    pending.forEach((p) => p.catch(() => {})) // they all reject once aborted; report only the cause
    try {
      tx.abort()
    } catch {
      // Already aborted by the failed request.
    }
    throw err
  }
}

export function createMarksDb(name = 'mapmarks'): MarksStore {
  const db = openDB(name, 1, {
    upgrade(db) {
      db.createObjectStore(STORE, { keyPath: 'id' })
    },
  })

  return {
    async getAll() {
      const marks: Mark[] = await (await db).getAll(STORE)
      return marks.sort((a, b) => a.createdAt - b.createdAt)
    },
    putMany: (marks) => inOneTransaction(db, marks, (store, mark) => store.put(mark)),
    removeMany: (ids) => inOneTransaction(db, ids, (store, id) => store.delete(id)),
  }
}
