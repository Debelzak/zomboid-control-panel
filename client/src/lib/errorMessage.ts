import { ApiError } from './api'
import i18n, { getCurrentLanguage } from '@/i18n'

// server/utils/errorCodes.js: 8 pre-i18n error codes ship a frozen
// lower_snake_case wire value that client code already compares with ===
// elsewhere (see that file's own comments for why it can't be renamed),
// while their errors.json locale key is the UPPER_SNAKE_CASE constant
// name invented only so a translation could exist. Mirrored here as a
// static, literal table — never synthesized — so a translated wire value
// stays grep-able the same way the server-side registry requires.
const LEGACY_WIRE_CODE_TO_LOCALE_KEY: Readonly<Record<string, string>> = {
  server_running: 'SERVER_RUNNING_LEGACY',
  docker_updater_not_configured: 'DOCKER_UPDATER_NOT_CONFIGURED_LEGACY',
  apply_in_progress: 'APPLY_IN_PROGRESS_LEGACY',
  already_downloading: 'ALREADY_DOWNLOADING_LEGACY',
  no_update: 'NO_UPDATE_LEGACY',
  confirmation_required: 'CONFIRMATION_REQUIRED_LEGACY',
  save_failed: 'SAVE_FAILED_LEGACY',
  stop_failed: 'STOP_FAILED_LEGACY',
}

function extractErrorCode(error: unknown): string | undefined {
  if (error instanceof ApiError && typeof error.code === 'string' && error.code) {
    return error.code
  }
  if (error && typeof error === 'object' && 'code' in error) {
    const candidate = (error as { code?: unknown }).code
    if (typeof candidate === 'string' && candidate) return candidate
  }
  return undefined
}

const UNRESOLVED_PLACEHOLDER_RE = /\{\{\s*\w+\s*\}\}/

// Only trust the registered translation when it needs no interpolation
// data we don't have. The server sends one fully-interpolated English
// `error` string today, not separate structured params (a role name, a
// capability, a save-failure reason, ...) — a handful of errors.json
// entries carry a {{placeholder}} for that data anyway, written ahead of
// the server ever sending it. Translating one of those without a value
// would put the literal text "{{name}}" in front of a user, which is
// worse than the English passthrough it would replace — so those specific
// codes are deliberately left on today's behavior until the server sends
// params to fill them.
function getRegisteredTranslation(code: string): string | null {
  const key = LEGACY_WIRE_CODE_TO_LOCALE_KEY[code] ?? code
  if (!i18n.exists(key, { ns: 'errors' })) return null

  const template = i18n.getResource(getCurrentLanguage(), 'errors', key)
  if (typeof template !== 'string' || UNRESOLVED_PLACEHOLDER_RE.test(template)) return null

  return i18n.t(key, { ns: 'errors' })
}

export function getUserErrorMessage(error: unknown, fallback: string): string {
  const code = extractErrorCode(error)
  const translated = code ? getRegisteredTranslation(code) : null
  if (translated) return translated

  if (error instanceof ApiError) {
    const message = error.message?.trim()
    if (message && message.toLowerCase() !== 'unknown error') {
      return message
    }
    return fallback
  }

  if (error instanceof Error) {
    const message = error.message?.trim()
    if (message && message.toLowerCase() !== 'unknown error') {
      return message
    }
    return fallback
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const candidate = (error as { message?: unknown }).message
    if (typeof candidate === 'string' && candidate.trim() && candidate.toLowerCase() !== 'unknown error') {
      return candidate.trim()
    }
  }

  return fallback
}

export function getRecoveryUrl(error: unknown): string | null {
  const payload = error instanceof ApiError && error.data && typeof error.data === 'object'
    ? error.data as { fixUrl?: unknown }
    : null
  if (typeof payload?.fixUrl === 'string' && payload.fixUrl.startsWith('/')) {
    return payload.fixUrl
  }

  const message = error instanceof Error ? error.message : String(error || '')
  if (/rcon|connection refused|authentication failed/i.test(message)) return '/settings?tab=connection'
  if (/panelbridge|bridge not running|bridge not configured/i.test(message)) return '/settings?tab=bridge'
  if (/no active server|no server configured/i.test(message)) return '/servers'
  return null
}
