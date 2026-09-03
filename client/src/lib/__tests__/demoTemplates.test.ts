import { describe, expect, it } from 'vitest'
import { getDemoMapPlayers, getDemoTemplates, isDemoMode } from '../demo'

describe('demo template API contract', () => {
  it('provides a template array with fields required by the Templates page', () => {
    const response = getDemoTemplates()

    expect(Array.isArray(response.templates)).toBe(true)
    expect(response.templates.length).toBeGreaterThan(0)
    expect(response.templates[0]).toEqual(expect.objectContaining({
      schemaVersion: 1,
      isBuiltin: true,
      meta: expect.objectContaining({
        id: expect.any(String),
        name: expect.any(String),
        tags: expect.any(Array),
      }),
      mods: expect.any(Array),
      difficulty: expect.any(Object),
    }))
  })

  it('does not enable demo mode in the regular test environment', () => {
    expect(isDemoMode()).toBe(false)
  })

  it('provides demo map players with the fields used by the player dossier', () => {
    expect(getDemoMapPlayers()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: expect.any(String),
        x: expect.any(Number),
        y: expect.any(Number),
        health: expect.any(Number),
        hunger: expect.any(Number),
        thirst: expect.any(Number),
        fatigue: expect.any(Number),
      }),
    ]))
  })
})