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

type Point = { x: number; y: number }

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** `point` is inside the screen-space polygon, or within `edgeTolerance` px of its outline. */
export function polygonContains(ring: Point[], point: Point, edgeTolerance = 0): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!
    const b = ring[j]!
    if (distanceToSegment(point, a, b) <= edgeTolerance) return true
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export type EraseTarget = { kind: 'mark' | 'polygon'; id: string }

/**
 * What erasing at `point` removes. A mark under the pointer always wins. Close to a mark but outside its
 * target nothing is erased, so a slightly missed mark never deletes the area beneath it. Otherwise the
 * topmost polygon (last in `polygons`) containing the point, or within `edgeTolerance` px of its outline.
 */
export function eraseTargetAt(
  marks: ScreenMark[],
  polygons: { id: string; ring: Point[] }[],
  point: Point,
  { markRadius, safetyRadius, edgeTolerance }: { markRadius: number; safetyRadius: number; edgeTolerance: number },
): EraseTarget | undefined {
  const mark = markAtPoint(marks, point, markRadius)
  if (mark) return { kind: 'mark', id: mark }
  if (markAtPoint(marks, point, safetyRadius)) return undefined
  const polygon = polygons.findLast((p) => polygonContains(p.ring, point, edgeTolerance))
  return polygon && { kind: 'polygon', id: polygon.id }
}

/** Index of the vertex within `radius` px of `point` (nearest wins), if any. */
export function vertexAtPoint(ring: Point[], point: Point, radius: number): number | undefined {
  let best: { index: number; dist: number } | undefined
  ring.forEach((v, index) => {
    const dist = Math.hypot(v.x - point.x, v.y - point.y)
    if (dist <= radius && (!best || dist < best.dist)) best = { index, dist }
  })
  return best?.index
}
