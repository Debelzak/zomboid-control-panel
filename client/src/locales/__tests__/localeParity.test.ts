import { describe, expect, it } from 'vitest'
import { LANGUAGES, SOURCE_LANGUAGE } from '../../i18n/languages'

// Modeled on V2's locales/localeKeys.ts + locale-parity test (read-only
// reference, not shared code): English is the source of truth, and every
// other shipped locale must resolve every key English has. Without this, a
// locale that's missing a key doesn't fail loudly — it silently falls back
// to i18next's raw dotted key (e.g. "shell:footer.signOut") rendered
// straight onto the screen for a real user, which is exactly the class of
// "wrong state presented confidently" bug this floor has spent all day
// finding elsewhere.
//
// Locales and namespaces are BOTH discovered here, not named — adding a
// third language folder (or a namespace file within an existing one) is
// picked up automatically, so a half-finished translation fails loudly on
// its first commit instead of silently shipping English gaps. See
// client/src/i18n/languages.ts (the one place languages are registered)
// and client/src/locales/README.md (how to add one).
const localeModules = import.meta.glob('../*/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, Record<string, unknown>>

const LOCALE_PATH_RE = /\.\.\/([^/]+)\/([^/]+)\.json$/

const byLanguageThenNamespace: Record<string, Record<string, Record<string, unknown>>> = {}
for (const [filePath, mod] of Object.entries(localeModules)) {
  const match = filePath.match(LOCALE_PATH_RE)
  if (!match) continue
  const [, code, namespace] = match
  byLanguageThenNamespace[code] ??= {}
  byLanguageThenNamespace[code][namespace] = mod
}

const namespaces = [
  ...new Set(Object.values(byLanguageThenNamespace).flatMap((r) => Object.keys(r))),
].sort()

const targetLanguages = LANGUAGES.map((l) => l.code).filter((code) => code !== SOURCE_LANGUAGE)

function collectKeyPaths(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix]
  return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
    collectKeyPaths(value, prefix ? `${prefix}.${key}` : key),
  )
}

function getAtPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (acc === null || typeof acc !== 'object') return undefined
    return (acc as Record<string, unknown>)[segment]
  }, obj)
}

describe(`locale parity (${SOURCE_LANGUAGE} is the source of truth)`, () => {
  it('every registered language has a locale folder with at least one namespace file', () => {
    for (const code of [SOURCE_LANGUAGE, ...targetLanguages]) {
      expect(byLanguageThenNamespace[code], `no locale files found for registered language "${code}"`).toBeDefined()
    }
  })

  for (const lang of targetLanguages) {
    for (const ns of namespaces) {
      const sourceObj = byLanguageThenNamespace[SOURCE_LANGUAGE]?.[ns] ?? {}
      const targetObj = byLanguageThenNamespace[lang]?.[ns] ?? {}

      it(`${lang}/${ns}.json has exactly the same keys as ${SOURCE_LANGUAGE}/${ns}.json`, () => {
        const sourceKeys = collectKeyPaths(sourceObj).sort()
        const targetKeys = collectKeyPaths(targetObj).sort()

        const missing = sourceKeys.filter((k) => !targetKeys.includes(k))
        const extra = targetKeys.filter((k) => !sourceKeys.includes(k))

        expect(missing, `${lang}/${ns}.json is missing keys present in ${SOURCE_LANGUAGE}`).toEqual([])
        expect(extra, `${lang}/${ns}.json has keys not present in ${SOURCE_LANGUAGE} (stale/typo?)`).toEqual([])
      })

      it(`${lang}/${ns}.json has no empty string values`, () => {
        const emptyKeys = collectKeyPaths(targetObj).filter((path) => getAtPath(targetObj, path) === '')
        expect(emptyKeys, `${lang}/${ns}.json has keys with an empty string value`).toEqual([])
      })
    }
  }
})
