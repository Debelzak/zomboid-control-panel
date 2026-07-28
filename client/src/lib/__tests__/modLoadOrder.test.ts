import { describe, it, expect } from 'vitest'
import { buildRequiresMap, computeAutoSortedOrder } from '../modLoadOrder'

const requires = (entries: Record<string, string[]>) => new Map(Object.entries(entries))

describe('computeAutoSortedOrder', () => {
  it('leaves an order untouched when no dependencies are declared', () => {
    const result = computeAutoSortedOrder(['B', 'A', 'C'], new Map())

    expect(result.order).toEqual(['B', 'A', 'C'])
    expect(result.moved).toEqual([])
    expect(result.appliedEdges).toBe(0)
  })

  it('moves a required library ahead of the mod that requires it', () => {
    const result = computeAutoSortedOrder(
      ['Overhaul', 'BaseLibrary'],
      requires({ Overhaul: ['BaseLibrary'] }),
    )

    expect(result.order).toEqual(['BaseLibrary', 'Overhaul'])
    expect(result.appliedEdges).toBe(1)
    // With only two mods either one can be called "the one that moved"; the
    // report describes the library being pulled above the mod requiring it.
    expect(result.moved).toEqual([{ modId: 'BaseLibrary', from: 2, to: 1 }])
  })

  it('only moves the dependent mod and keeps every other mod in relative order', () => {
    const result = computeAutoSortedOrder(
      ['Zed', 'Overhaul', 'Alpha', 'BaseLibrary'],
      requires({ Overhaul: ['BaseLibrary'] }),
    )

    // Zed / Alpha / BaseLibrary keep their relative order; only Overhaul is
    // pushed past the library it requires.
    expect(result.order).toEqual(['Zed', 'Alpha', 'BaseLibrary', 'Overhaul'])
    expect(result.moved).toEqual([{ modId: 'Overhaul', from: 2, to: 4 }])
  })

  it('does not report mods that merely drift when a mod above them moves', () => {
    // Only Overhaul is constrained. A, B and C shift down by one index each,
    // but none of them actually changed position relative to the others.
    const result = computeAutoSortedOrder(
      ['Overhaul', 'A', 'B', 'C', 'BaseLibrary'],
      requires({ Overhaul: ['BaseLibrary'] }),
    )

    expect(result.order).toEqual(['A', 'B', 'C', 'BaseLibrary', 'Overhaul'])
    expect(result.moved).toEqual([{ modId: 'Overhaul', from: 1, to: 5 }])
  })

  it('is idempotent', () => {
    const deps = requires({ Overhaul: ['BaseLibrary'], Patch: ['Overhaul'] })
    const first = computeAutoSortedOrder(['Patch', 'Overhaul', 'BaseLibrary'], deps)
    const second = computeAutoSortedOrder(first.order, deps)

    expect(second.order).toEqual(first.order)
    expect(second.moved).toEqual([])
  })

  it('reports requirements that are not in the load order', () => {
    const result = computeAutoSortedOrder(['Overhaul'], requires({ Overhaul: ['NotEnabled'] }))

    expect(result.order).toEqual(['Overhaul'])
    expect(result.missing).toEqual([{ modId: 'Overhaul', requires: 'NotEnabled' }])
  })

  it('keeps cyclic mods instead of dropping them', () => {
    const result = computeAutoSortedOrder(
      ['A', 'B', 'C'],
      requires({ A: ['B'], B: ['A'] }),
    )

    expect(result.order.slice().sort()).toEqual(['A', 'B', 'C'])
    expect(result.cycles).toEqual(['A', 'B'])
  })

  it('ignores self-requirements and duplicate entries', () => {
    const result = computeAutoSortedOrder(
      ['A', 'B'],
      requires({ A: ['A'], B: ['A', 'A'] }),
    )

    expect(result.order).toEqual(['A', 'B'])
    expect(result.appliedEdges).toBe(1)
  })
})

describe('buildRequiresMap', () => {
  it('collects requirements from the workshop mod map', () => {
    const map = buildRequiresMap({
      '111': [{ id: 'Overhaul', require: ['BaseLibrary'] }, { id: 'NoDeps' }],
      '222': [{ id: 'BaseLibrary' }],
    })

    expect(map.get('Overhaul')).toEqual(['BaseLibrary'])
    expect(map.has('NoDeps')).toBe(false)
    expect(map.has('BaseLibrary')).toBe(false)
  })

  it('merges requirements when a mod ID appears under several workshop items', () => {
    const map = buildRequiresMap({
      '111': [{ id: 'Overhaul', require: ['A'] }],
      '222': [{ id: 'Overhaul', require: ['B'] }],
    })

    expect(map.get('Overhaul')).toEqual(['A', 'B'])
  })

  it('handles a missing workshop map', () => {
    expect(buildRequiresMap(undefined).size).toBe(0)
  })
})
