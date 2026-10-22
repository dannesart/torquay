import { describe, expect, it } from 'vitest'
import { markAtPoint } from '~/utils/hitTest'

const marks = [
  { id: 'a', x: 100, y: 100 },
  { id: 'b', x: 116, y: 100 }, // close neighbor: targets would overlap without nearest-wins
  { id: 'c', x: 300, y: 300 },
]

describe('markAtPoint', () => {
  it('hits a mark when clicking its center or within the target radius', () => {
    expect(markAtPoint(marks, { x: 300, y: 300 }, 10)).toBe('c')
    expect(markAtPoint(marks, { x: 307, y: 307 }, 10)).toBe('c') // ~9.9 px away
  })

  it('returns nothing for empty map space, including just outside the target', () => {
    expect(markAtPoint(marks, { x: 200, y: 200 }, 10)).toBeUndefined()
    expect(markAtPoint(marks, { x: 311, y: 300 }, 10)).toBeUndefined()
    expect(markAtPoint([], { x: 0, y: 0 }, 10)).toBeUndefined()
  })

  it('picks the nearest mark where neighboring targets meet', () => {
    expect(markAtPoint(marks, { x: 107, y: 100 }, 10)).toBe('a')
    expect(markAtPoint(marks, { x: 109, y: 100 }, 10)).toBe('b')
  })
})
