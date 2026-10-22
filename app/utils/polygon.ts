export type LngLat = [number, number]

/** Polygons are small exclusion areas; this keeps the O(n²) crossing check instant. */
export const MAX_VERTICES = 1000

/** Shoelace area in degrees²; positive means counterclockwise. `ring` is open (first vertex not repeated). */
export function signedArea(ring: LngLat[]): number {
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]!
    const [x2, y2] = ring[(i + 1) % ring.length]!
    sum += x1 * y2 - x2 * y1
  }
  return sum / 2
}

/** GeoJSON's right-hand rule: exterior rings run counterclockwise. */
export function counterClockwise(ring: LngLat[]): LngLat[] {
  return signedArea(ring) < 0 ? [...ring].reverse() : ring
}

const orient = (a: LngLat, b: LngLat, c: LngLat) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
const between = (a: number, b: number, v: number) => Math.min(a, b) <= v && v <= Math.max(a, b)
/** `p` lies on segment ab (given it is collinear with it). */
const onSegment = (a: LngLat, b: LngLat, p: LngLat) => between(a[0], b[0], p[0]) && between(a[1], b[1], p[1])
const same = (a: LngLat, b: LngLat) => a[0] === b[0] && a[1] === b[1]

/** Segments ab and cd touch or cross anywhere, including at endpoints and collinear overlaps. */
function segmentsIntersect(a: LngLat, b: LngLat, c: LngLat, d: LngLat): boolean {
  const o1 = orient(a, b, c)
  const o2 = orient(a, b, d)
  const o3 = orient(c, d, a)
  const o4 = orient(c, d, b)
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true
  return (o1 === 0 && onSegment(a, b, c)) || (o2 === 0 && onSegment(a, b, d))
    || (o3 === 0 && onSegment(c, d, a)) || (o4 === 0 && onSegment(c, d, b))
}

/**
 * Why `ring` (open: first vertex not repeated) is not a simple polygon, or null if it is.
 * Invalid shapes are reported, never repaired.
 */
export function ringProblem(ring: LngLat[]): string | null {
  const n = ring.length
  if (n < 3) return 'a polygon needs at least 3 points'
  if (n > MAX_VERTICES) return `a polygon can have at most ${MAX_VERTICES} points`
  for (const [lng, lat] of ring) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      return 'a point is outside the valid longitude/latitude range'
    }
  }
  for (let i = 0; i < n; i++) {
    if (same(ring[i]!, ring[(i + 1) % n]!)) return 'it repeats the same point twice in a row'
  }
  // Non-neighbouring edges must not touch at all. Neighbours share a vertex; one folding back onto the other
  // always makes a following edge touch a non-neighbour (or, in a triangle, leaves zero area).
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      if (segmentsIntersect(ring[i]!, ring[i + 1]!, ring[j]!, ring[(j + 1) % n]!)) return 'its edges cross'
    }
  }
  // Checked after crossings: a symmetric bow tie also has zero net area.
  if (signedArea(ring) === 0) return 'its area is zero'
  return null
}

/** Drops consecutive duplicate points and a final point equal to the first, as left by double-clicks. */
export function withoutRepeats(points: LngLat[]): LngLat[] {
  const out = points.filter((p, i) => i === 0 || !same(p, points[i - 1]!))
  while (out.length > 1 && same(out[0]!, out.at(-1)!)) out.pop()
  return out
}

export const sameRing = (a: LngLat[], b: LngLat[]) => a.length === b.length && a.every((p, i) => same(p, b[i]!))
