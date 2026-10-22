import { openDB } from 'idb'

export interface Mark {
  id: string
  lng: number
  lat: number
  createdAt: number
}

export interface MarksStore {
  getAll(): Promise<Mark[]>
  put(mark: Mark): Promise<void>
  remove(id: string): Promise<void>
}

const STORE = 'marks'

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
    async put(mark) {
      await (await db).put(STORE, mark)
    },
    async remove(id) {
      await (await db).delete(STORE, id)
    },
  }
}
