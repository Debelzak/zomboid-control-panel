import { describe, expect, it } from 'vitest'

import enLogin from '../en/login.json'
import enSetup from '../en/setup.json'
import enShell from '../en/shell.json'
import frLogin from '../fr/login.json'
import frSetup from '../fr/setup.json'
import frShell from '../fr/shell.json'

// Modeled on V2's locales/localeKeys.ts + locale-parity test (read-only
// reference, not shared code): English is the source of truth, and every
// other shipped locale must resolve every key English has. Without this, a
// French file that's missing a key doesn't fail loudly — it silently falls
// back to i18next's raw dotted key (e.g. "shell:footer.signOut") rendered
// straight onto the screen for a real user, which is exactly the class of
// "wrong state presented confidently" bug this floor has spent all day
// finding elsewhere.
const NAMESPACES = [
  { name: 'login', en: enLogin, fr: frLogin },
  { name: 'setup', en: enSetup, fr: frSetup },
  { name: 'shell', en: enShell, fr: frShell },
] as const

function collectKeyPaths(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix]
  return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
    collectKeyPaths(value, prefix ? `${prefix}.${key}` : key),
  )
}

describe('locale parity (en is the source of truth)', () => {
  for (const { name, en, fr } of NAMESPACES) {
    it(`fr/${name}.json has exactly the same keys as en/${name}.json`, () => {
      const enKeys = collectKeyPaths(en).sort()
      const frKeys = collectKeyPaths(fr).sort()

      const missingFromFr = enKeys.filter((k) => !frKeys.includes(k))
      const extraInFr = frKeys.filter((k) => !enKeys.includes(k))

      expect(missingFromFr, `fr/${name}.json is missing keys present in English`).toEqual([])
      expect(extraInFr, `fr/${name}.json has keys not present in English (stale/typo?)`).toEqual([])
    })
  }

  for (const { name, fr } of NAMESPACES) {
    it(`fr/${name}.json has no empty string values`, () => {
      const emptyKeys = collectKeyPaths(fr).filter((path) => {
        const value = path.split('.').reduce<unknown>((acc, segment) => {
          if (acc === null || typeof acc !== 'object') return undefined
          return (acc as Record<string, unknown>)[segment]
        }, fr)
        return value === ''
      })
      expect(emptyKeys, `fr/${name}.json has keys with an empty string value`).toEqual([])
    })
  }
})
