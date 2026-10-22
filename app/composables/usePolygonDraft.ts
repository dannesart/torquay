import { computed, shallowRef } from 'vue'
import { ringProblem, withoutRepeats, type LngLat } from '~/utils/polygon'

/** The polygon being drawn. It lives only in memory and is never persisted until finished. */
export function usePolygonDraft() {
  const points = shallowRef<LngLat[]>([])
  const active = computed(() => points.value.length > 0)

  const add = (p: LngLat) => (points.value = [...points.value, p])
  const removeLast = () => (points.value = points.value.slice(0, -1))
  const cancel = () => (points.value = [])

  /** The finished ring, or why it cannot be finished yet (the draft is kept so it can be fixed). */
  function finish(): { ring: LngLat[] } | { error: string } {
    const ring = withoutRepeats(points.value)
    const problem = ringProblem(ring)
    if (problem) return { error: problem }
    points.value = []
    return { ring }
  }

  return { points, active, add, removeLast, cancel, finish }
}
