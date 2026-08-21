import { describe, expect, it } from 'vitest'
import { INI_SCHEMA, SANDBOX_SCHEMA } from '../serverConfigSchema'

describe('server configuration schema ownership', () => {
  it('does not expose one Build 42 setting in both files', () => {
    const iniKeys = new Set(INI_SCHEMA.map(setting => setting.key))
    const sharedKeys = SANDBOX_SCHEMA
      .map(setting => setting.key)
      .filter(key => iniKeys.has(key))

    expect(sharedKeys).toEqual([])
  })

  it('keeps MinutesPerPage in SandboxVars with the Build 42 default', () => {
    expect(INI_SCHEMA.some(setting => setting.key === 'MinutesPerPage')).toBe(false)
    expect(SANDBOX_SCHEMA.find(setting => setting.key === 'MinutesPerPage')).toMatchObject({
      default: 2,
      section: 'settings',
    })
  })
})