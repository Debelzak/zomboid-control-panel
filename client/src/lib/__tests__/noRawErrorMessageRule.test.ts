import { describe } from 'vitest'
import { RuleTester } from 'eslint'
// @ts-expect-error -- plain JS rule module, no type declarations
import rule from '../../../../eslint-rules/no-raw-error-message.js'

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
})

// eslint-rules/no-raw-error-message.js: the structural half of the
// 2026-08-26 errorMessage.ts coverage audit -- forbids writing a NEW
// `x instanceof Error ? x.message : fallback` toast/error-state site,
// scoped narrowly to the two shapes every real site in the audit actually
// used (a toast() call, a set*() state setter) so it doesn't also flag
// errorMessage.ts's own internal use of the same shape or client-errors.ts's
// diagnostic-payload use, neither of which displays the raw text to a user.
describe('local/no-raw-error-message', () => {
  ruleTester.run('no-raw-error-message', rule, {
    valid: [
      // The fix this rule exists to push people toward.
      "toast({ description: getUserErrorMessage(error, 'fallback') })",
      "setDetectError(getUserErrorMessage(error, 'fallback'))",

      // The documented escape hatch -- a CallExpression, not the ternary
      // shape, so it never matches regardless of context.
      "toast({ description: rawErrorMessageIntentional(error, 'fallback') })",

      // Different identifiers on each side -- not the same-error idiom,
      // just code that happens to share some tokens.
      "toast({ description: a instanceof Error ? b.message : 'fallback' })",

      // Not `.message` at all.
      "toast({ description: error instanceof Error ? error.code : 'fallback' })",

      // errorMessage.ts's own getRecoveryUrl(): builds the string to
      // pattern-match against, never assigns it to a toast/state call.
      "function f(error) { const message = error instanceof Error ? error.message : String(error || ''); if (/rcon/i.test(message)) return '/servers'; }",

      // client-errors.ts's diagnostic payload: sent to the server for
      // logging, not shown to the user -- not a toast()/set*() argument.
      "fetch('/api/debug/client-errors', { body: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) })",

      // A call whose name doesn't match the toast()/set*() shapes this
      // rule targets.
      "logSomething(error instanceof Error ? error.message : 'fallback')",

      // Assigned to a plain variable, not passed directly -- the
      // documented two-step limitation.
      "const msg = error instanceof Error ? error.message : 'fallback'; toast({ description: msg })",

      // Shape 2 (`x?.message || fallback`), legitimate uses: reading a
      // normal API response/progress field, not a caught error -- real
      // sites found for both (Backups.tsx's backupProgress, Debug.tsx's
      // result/data). Excluded by the identifier not matching
      // ERROR_LIKE_IDENTIFIER_RE, not by sink scoping.
      "toast({ description: backupProgress?.message || fallbackText })",
      "setStatus(result?.message || fallbackText)",
    ],
    invalid: [
      {
        code: "toast({ title: t('toasts.error'), description: error instanceof Error ? error.message : t('toasts.fallback'), variant: 'destructive' })",
        errors: [{ messageId: 'rawMessage' }],
      },
      {
        code: "setDetectError(error instanceof Error ? error.message : t('toasts.detectionFailed'))",
        errors: [{ messageId: 'rawMessage' }],
      },
      {
        code: "setBridgeError(err instanceof Error ? err.message : t('errors.couldNotStartSftpBridge'))",
        errors: [{ messageId: 'rawMessage' }],
      },
      {
        // Optional chaining on the member access side, same identifier.
        code: "toast({ description: error instanceof Error ? error?.message : 'fallback' })",
        errors: [{ messageId: 'rawMessage' }],
      },
      {
        // Shape 2, direct toast() argument -- the exact WorkshopCollectionPanel.tsx shape.
        code: "toast({ variant: 'destructive', title: t('title'), description: err?.message || t('fallback') })",
        errors: [{ messageId: 'rawMessage' }],
      },
      {
        // Shape 2, direct set*() argument, no optional chaining -- the
        // Settings.tsx apiErr.message shape.
        code: "setDiffError(apiErr.message || t('failedToReadCollection'))",
        errors: [{ messageId: 'rawMessage' }],
      },
      {
        // Shape 2 nested inside a functional state update -- the
        // setCollectionStatus/setDepSearchData shape Kevin found on
        // Mods.tsx, one Property/ObjectExpression level deep.
        code: "setCollectionStatus((s) => ({ ...s, loading: false, error: err?.message || 'Network error' }))",
        errors: [{ messageId: 'rawMessage' }],
      },
      {
        // Same functional-update shape, nested TWO levels deep under a
        // computed property key -- the ConflictsPanel.tsx setDepSearchData
        // shape, the deepest real site found.
        code: "setDepSearchData(prev => ({ ...prev, [key]: { loading: false, results: [], error: err?.message || t('searchFailed'), searchUrl: null } }))",
        errors: [{ messageId: 'rawMessage' }],
      },
    ],
  })
})
