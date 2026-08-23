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

// The key-set/empty-string checks below say nothing about what's INSIDE a
// value that does exist — a translation can drop a {{placeholder}}, invent
// one English doesn't supply, or have a real <b> tag escaped to &lt;b&gt;
// by a translation step, and both checks above stay green. That gap was
// live in shipped French (2026-08-23): a mods.json _one key introduced
// {{plural}} that English's _one form never supplies, so nothing filled it
// and an operator saw the literal text "{{plural}}" on screen.
//
// A placeholder repeated MORE times in the translation than in English is
// deliberately NOT flagged — French and Spanish grammatical agreement
// legitimately reuses one supplied value across a noun and its adjective
// (e.g. fr mods.json's "{{count}} conflit{{plural}} ignoré{{plural}}",
// one {{plural}} value marking both words). Only a placeholder's PRESENCE
// is compared, never its count — see PLACEHOLDER_NAME_RE's sibling in
// client/src/lib/paramTranslation.ts, which resolves the same way.
const PLACEHOLDER_NAME_RE = /\{\{\s*(\w+)\s*\}\}/g

function placeholderNames(value: unknown): Set<string> {
  if (typeof value !== 'string') return new Set()
  return new Set([...value.matchAll(PLACEHOLDER_NAME_RE)].map((m) => m[1]))
}

// Catches react-i18next <Trans> component tags (<1>...</1>, <b>...</b>,
// <code>...</code>) being escaped into literal &lt;b&gt; text by a
// translation pass, or a translator dropping/duplicating one. Open and
// close tokens are kept distinct ("<1>" vs "</1>") so a swapped or
// unbalanced pair fails too, not just a missing tag name. Order does NOT
// need to match (a French sentence can reorder the tagged clause), so both
// sides are sorted before comparing — only the multiset matters.
const TAG_TOKEN_RE = /<\/?[\w]+>/g

function tagTokens(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return [...value.matchAll(TAG_TOKEN_RE)].map((m) => m[0]).sort()
}

// A narrow, individually-reviewed exception list — NOT a blanket "_one keys
// may omit {{count}}" rule, which would hide a future _one key that drops
// {{count}} by accident instead of by design. Each entry here was checked
// against its English source and its own language's _other sibling before
// being added (2026-08-23 French placeholder-parity sweep): the count is
// always 1 on the `_one` branch, and the language's own grammar already
// marks singular without restating the numeral, so the omission is the
// deliberately better translation, not a gap. `key` is `lang/namespace:path`.
//
//   fr/backups.json mainCard.allSelectedLabel_one
//     en: "All {{count}} selected · click to clear"
//     fr: "La sauvegarde sélectionnée · cliquer pour désélectionner"
//     (fr's own _other: "Les {{count}} sauvegardes sélectionnées · ..." —
//     English reuses one string for both forms; French correctly does not.)
//   fr/chunkCleaner.json deleteDialog.title_one
//     en: "Delete {{count}} selected chunk?"
//     fr: "Supprimer le chunk sélectionné ?"
//     (fr's own _other: "Supprimer les {{count}} chunks sélectionnés ?" —
//     same reasoning.)
//
// Add a new entry here only after checking it against the _other sibling
// the same way — an omission that ISN'T a genuine singular/plural split is
// exactly the class of bug this whole check exists to catch.
const ALLOWED_PLACEHOLDER_OMISSIONS = new Set<string>([
  'fr/backups.json:mainCard.allSelectedLabel_one',
  'fr/chunkCleaner.json:deleteDialog.title_one',
])

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

      // Only keys present on both sides are checked here — a missing/extra
      // key is already the first test's failure to report, and comparing a
      // placeholder/tag set against `undefined` would just be noise on top
      // of a failure that test already names.
      const sharedKeys = collectKeyPaths(sourceObj).filter((key) => collectKeyPaths(targetObj).includes(key))

      const omittedPlaceholders = sharedKeys.flatMap((key) => {
        if (ALLOWED_PLACEHOLDER_OMISSIONS.has(`${lang}/${ns}.json:${key}`)) return []
        const sourceNames = placeholderNames(getAtPath(sourceObj, key))
        const targetNames = placeholderNames(getAtPath(targetObj, key))
        return [...sourceNames].filter((name) => !targetNames.has(name)).map((name) => `${key}: {{${name}}}`)
      })
      const introducedPlaceholders = sharedKeys.flatMap((key) => {
        const sourceNames = placeholderNames(getAtPath(sourceObj, key))
        const targetNames = placeholderNames(getAtPath(targetObj, key))
        return [...targetNames].filter((name) => !sourceNames.has(name)).map((name) => `${key}: {{${name}}}`)
      })
      const tagMismatches = sharedKeys.flatMap((key) => {
        const sourceTags = tagTokens(getAtPath(sourceObj, key))
        const targetTags = tagTokens(getAtPath(targetObj, key))
        if (JSON.stringify(sourceTags) === JSON.stringify(targetTags)) return []
        return [`${key}: ${SOURCE_LANGUAGE}=${JSON.stringify(sourceTags)} vs ${lang}=${JSON.stringify(targetTags)}`]
      })

      it(`${lang}/${ns}.json supplies every {{placeholder}} that ${SOURCE_LANGUAGE}/${ns}.json uses for the same key`, () => {
        expect(
          omittedPlaceholders,
          `${lang}/${ns}.json drops a placeholder ${SOURCE_LANGUAGE} supplies for that key — nothing will fill it at render time`,
        ).toEqual([])
      })

      it(`${lang}/${ns}.json does not introduce a {{placeholder}} that ${SOURCE_LANGUAGE}/${ns}.json does not supply for the same key`, () => {
        expect(
          introducedPlaceholders,
          `${lang}/${ns}.json uses a placeholder ${SOURCE_LANGUAGE} never supplies for that key — it will render as the literal "{{name}}" text`,
        ).toEqual([])
      })

      it(`${lang}/${ns}.json has the same multiset of HTML/Trans tags as ${SOURCE_LANGUAGE}/${ns}.json for the same key`, () => {
        expect(
          tagMismatches,
          `${lang}/${ns}.json has a tag mismatch vs ${SOURCE_LANGUAGE}/${ns}.json (missing/extra/escaped <tag>)`,
        ).toEqual([])
      })
    }
  }
})
