import { openDB } from 'idb'
import type { LngLat } from '~/utils/polygon'

export interface Mark {
  id: string
  lng: number
  lat: number
  createdAt: number
}

/** An excluded area. `ring` is open (first vertex not repeated) and counterclockwise. */
export interface Polygon {
  id: string
  ring: LngLat[]
  createdAt: number
}

export interface Investigation {
  marks: Mark[]
  polygons: Polygon[]
}

export interface Changes {
  putMarks?: Mark[]
  removeMarks?: string[]
  putPolygons?: Polygon[]
  removePolygons?: string[]
}

export interface MarksStore {
  getAll(): Promise<Mark[]>
  getAllPolygons(): Promise<Polygon[]>
  /** Applies all changes in one transaction: either every change is stored or none is. */
  write(changes: Changes): Promise<void>
}

const MARKS = 'marks'
const POLYGONS = 'polygons'
const byCreation = (a: { createdAt: number }, b: { createdAt: number }) => a.createdAt - b.createdAt

export function createMarksDb(name = 'mapmarks', onBlocked?: () => void): MarksStore {
  const db = openDB(name, 2, {
    // Additive only: existing stores and their records are never deleted or rewritten.
    upgrade(db, oldVersion) {
      if (oldVersion < 1) db.createObjectStore(MARKS, { keyPath: 'id' })
      if (oldVersion < 2) db.createObjectStore(POLYGONS, { keyPath: 'id' })
    },
    // Another tab still has the old version open; the upgrade waits until it closes.
    blocked: () => onBlocked?.(),
  })

  return {
    async getAll() {
      const marks: Mark[] = await (await db).getAll(MARKS)
      return marks.sort(byCreation)
    },
    async getAllPolygons() {
      const polygons: Polygon[] = await (await db).getAll(POLYGONS)
      return polygons.sort(byCreation)
    },
    async write(changes) {
      const tx = (await db).transaction([MARKS, POLYGONS], 'readwrite')
      const marks = tx.objectStore(MARKS)
      const polygons = tx.objectStore(POLYGONS)
      const pending: Promise<unknown>[] = [tx.done]
      try {
        // A request that throws synchronously (e.g. a missing key) must still abort the whole transaction.
        for (const m of changes.putMarks ?? []) pending.push(marks.put(m))
        for (const id of changes.removeMarks ?? []) pending.push(marks.delete(id))
        for (const p of changes.putPolygons ?? []) pending.push(polygons.put(p))
        for (const id of changes.removePolygons ?? []) pending.push(polygons.delete(id))
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
    },
  }
}
