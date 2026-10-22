export interface ScreenMark {
  id: string
  x: number
  y: number
}

/**
 * The mark whose center is closest to `point`, if it lies within `radius` px.
 * Nearest wins, so the targets of neighboring marks never overlap.
 */
export function markAtPoint(marks: ScreenMark[], point: { x: number; y: number }, radius: number): string | undefined {
  let best: { id: string; dist: number } | undefined
  for (const m of marks) {
    const dist = Math.hypot(m.x - point.x, m.y - point.y)
    if (dist <= radius && (!best || dist < best.dist)) best = { id: m.id, dist }
  }
  return best?.id
}
