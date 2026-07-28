// Dependency-aware load-order sorting for the Mods > Load Order tab.
//
// Project Zomboid loads mods in the order they appear in `Mods=`. A mod that
// declares `require=` in its mod.info expects those mods to be loaded first.
// Alphabetical sorting would be actively harmful here, so this module only
// moves a mod when a declared dependency forces it, and otherwise preserves
// the order the user already arranged.

export interface AutoSortResult {
  /** The proposed load order. Same members as the input, only reordered. */
  order: string[]
  /** The minimal set of mods that had to be repositioned, 1-based before/after. */
  moved: Array<{ modId: string; from: number; to: number }>
  /** Dependency edges that were applied (dependency loads before dependent). */
  appliedEdges: number
  /** Mods involved in a dependency cycle. Their relative order is preserved. */
  cycles: string[]
  /** Declared requirements that are not present in the load order at all. */
  missing: Array<{ modId: string; requires: string }>
}

/**
 * Stable topological sort.
 *
 * Uses Kahn's algorithm, but always picks the ready node with the smallest
 * original index. That keeps the result as close to the user's existing order
 * as the dependency graph allows, so applying auto-sort twice is a no-op and
 * unrelated mods never shuffle around.
 */
export function computeAutoSortedOrder(
  modIds: string[],
  requiresByModId: Map<string, string[]>,
): AutoSortResult {
  // Deduplicate while keeping the first occurrence, so a malformed INI with a
  // repeated mod ID can't desynchronise the index bookkeeping below.
  const order: string[] = []
  const indexOf = new Map<string, number>()
  for (const modId of modIds) {
    if (indexOf.has(modId)) continue
    indexOf.set(modId, order.length)
    order.push(modId)
  }

  const dependents = new Map<string, string[]>()
  const remainingDeps = new Map<string, number>()
  const missing: AutoSortResult['missing'] = []
  let appliedEdges = 0

  for (const modId of order) {
    remainingDeps.set(modId, 0)
  }

  for (const modId of order) {
    const seen = new Set<string>()
    for (const requirement of requiresByModId.get(modId) || []) {
      // Self-requirement and duplicates carry no ordering information.
      if (!requirement || requirement === modId || seen.has(requirement)) continue
      seen.add(requirement)

      if (!indexOf.has(requirement)) {
        // The dependency isn't enabled. Reporting it is useful, but it can't
        // constrain an order that doesn't contain it.
        missing.push({ modId, requires: requirement })
        continue
      }

      const list = dependents.get(requirement)
      if (list) list.push(modId)
      else dependents.set(requirement, [modId])
      remainingDeps.set(modId, (remainingDeps.get(modId) || 0) + 1)
      appliedEdges++
    }
  }

  // Ready set kept sorted by original index for deterministic, minimal movement.
  const ready = order.filter((modId) => (remainingDeps.get(modId) || 0) === 0)
  const byIndex = (a: string, b: string) => (indexOf.get(a) || 0) - (indexOf.get(b) || 0)
  ready.sort(byIndex)

  const sorted: string[] = []
  while (ready.length > 0) {
    const modId = ready.shift() as string
    sorted.push(modId)

    let unlocked = false
    for (const dependent of dependents.get(modId) || []) {
      const left = (remainingDeps.get(dependent) || 0) - 1
      remainingDeps.set(dependent, left)
      if (left === 0) {
        ready.push(dependent)
        unlocked = true
      }
    }
    if (unlocked) ready.sort(byIndex)
  }

  // Anything left is part of a dependency cycle. PZ still has to load it, so
  // append it in the user's existing order rather than dropping or guessing.
  const cycles = order.filter((modId) => !sorted.includes(modId))
  const finalOrder = cycles.length > 0 ? [...sorted, ...cycles] : sorted

  // Report only the mods that genuinely had to move. Everything that keeps its
  // relative position just drifts by an index or two when a mod above it moves,
  // and listing all of that noise would make the preview unreviewable.
  const originalIndices = finalOrder.map((modId) => indexOf.get(modId) as number)
  const stayed = longestIncreasingSubsequence(originalIndices)
  const moved: AutoSortResult['moved'] = []
  finalOrder.forEach((modId, index) => {
    if (stayed.has(index)) return
    moved.push({ modId, from: (indexOf.get(modId) as number) + 1, to: index + 1 })
  })

  return { order: finalOrder, moved, appliedEdges, cycles, missing }
}

/**
 * Indices of a longest increasing subsequence. Those entries can be considered
 * "in place"; the rest is the minimal set of items that had to be repositioned.
 */
function longestIncreasingSubsequence(values: number[]): Set<number> {
  const tails: number[] = [] // index in `values` of the smallest tail per length
  const previous = new Array<number>(values.length).fill(-1)

  for (let i = 0; i < values.length; i++) {
    let low = 0
    let high = tails.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (values[tails[mid]] < values[i]) low = mid + 1
      else high = mid
    }
    if (low > 0) previous[i] = tails[low - 1]
    tails[low] = i
  }

  const result = new Set<number>()
  let cursor = tails.length > 0 ? tails[tails.length - 1] : -1
  while (cursor !== -1) {
    result.add(cursor)
    cursor = previous[cursor]
  }
  return result
}

/**
 * Build the modId -> required modIds lookup from the INI workshop map that the
 * panel already loads for the Mods page.
 */
export function buildRequiresMap(
  workshopModMap: Record<string, Array<{ id: string; require?: string[] }>> | undefined,
): Map<string, string[]> {
  const requires = new Map<string, string[]>()
  for (const entries of Object.values(workshopModMap || {})) {
    for (const entry of entries) {
      if (!entry?.id || !entry.require?.length) continue
      const existing = requires.get(entry.id)
      if (existing) requires.set(entry.id, [...existing, ...entry.require])
      else requires.set(entry.id, [...entry.require])
    }
  }
  return requires
}
