import { extractTranslationParams, resolveRegisteredTranslation } from './paramTranslation'

// Shape returned by GET /api/debug/diagnostics (server/routes/debug.js,
// diagOk/diagFail/diagWarn/diagSkip/diagInfo). `label`/`message`/`hint` are
// always present as server-built English text — a registered translation,
// when one exists and its params check out, is used instead; the English
// fields are never removed from the response, so an older client (or a
// check id with no locale entry yet) keeps working unchanged.
export interface DiagnosticCheckLike {
  id: string
  status: string
  label: string
  message: string
  hint?: string | null
  params?: unknown
}

export interface TranslatedDiagnosticCheck {
  label: string
  message: string
  hint: string | undefined
}

// Diagnostic check ids are already dot-separated (`"server.process"`,
// `"mods.resolved"`) and become real, deliberate i18next nesting under
// debug.json's diagnostics.checks tree — `diagnostics.checks.<id>.<status>.
// <field>` — not a synthesized key. Each of label/message/hint resolves
// independently through the same params-or-fallback guard as
// errorMessage.ts (resolveRegisteredTranslation): missing/malformed params
// falls back to the server's own English text for that field, never a raw
// {{placeholder}}. `check` itself (with its original English hint) must
// still be used for any fix-action / hint-text matching logic — only the
// returned label/message/hint are for display.
export function translateDiagnosticCheck(check: DiagnosticCheckLike): TranslatedDiagnosticCheck {
  const params = extractTranslationParams(check.params)
  const base = `diagnostics.checks.${check.id}.${check.status}`

  const label = resolveRegisteredTranslation('debug', `${base}.label`, params) ?? check.label
  const message = resolveRegisteredTranslation('debug', `${base}.message`, params) ?? check.message
  const hint = check.hint
    ? (resolveRegisteredTranslation('debug', `${base}.hint`, params) ?? check.hint)
    : undefined

  return { label, message, hint }
}
