/**
 * Sanitize error messages before sending to clients.
 * Strips filesystem paths and other sensitive info that could aid attackers.
 */

// Matches Windows absolute paths like C:\Users\foo\bar or D:\something
const WIN_PATH_RE = /[A-Z]:\\[^\s'")\]>}]+/gi;
// Matches Windows forward-slash paths like C:/Users/foo/bar (Node.js sometimes normalizes to this)
const WIN_FWD_PATH_RE = /[A-Z]:\/[^\s'")\]>}]+/gi;
// Matches UNC paths like \\server\share\path
const UNC_PATH_RE = /\\\\[^\s'")\]>}]+/gi;
// Matches Linux/macOS absolute paths like /home/user/something or /opt/pz/server
const UNIX_PATH_RE = /\/(?:home|opt|usr|var|tmp|srv|root|etc|mnt|media)\/[^\s'")\]>}]+/gi;

/**
 * Remove filesystem paths from an error message.
 * @param {string} message - Raw error message
 * @returns {string} Sanitized message safe for client consumption
 */
export function sanitizeError(message) {
  if (!message || typeof message !== 'string') return 'An unexpected error occurred';
  return message
    .replace(WIN_PATH_RE, '[path]')
    .replace(WIN_FWD_PATH_RE, '[path]')
    .replace(UNC_PATH_RE, '[path]')
    .replace(UNIX_PATH_RE, '[path]');
}

/**
 * Strip INI-sensitive characters from values to prevent injection.
 * Removes \r, \n (line injection), ; (comment / list delimiter), = (key separator).
 */
export function sanitizeIniValue(value) {
  if (value == null) return '';
  return String(value).replace(/[\r\n;=]/g, '');
}

/**
 * Sanitize an array of values for INI semicolon-delimited fields.
 */
export function sanitizeIniList(values) {
  return values.map(v => sanitizeIniValue(v)).filter(Boolean).join(';');
}

/**
 * Workshop IDs are 5-15 digit numeric strings (Steam fileId). PZ mod IDs
 * (the `id=` field inside mod.info) are letter-based identifiers and must
 * never be all-numeric. We use this to gate Mods= writes so workshop IDs
 * never get accidentally written into the Mods= line.
 */
export function looksLikeWorkshopId(value) {
  return typeof value === 'string' && /^\d{5,15}$/.test(value);
}

/**
 * Sanitize an array of mod IDs for the Mods= INI field. Drops any entry
 * that looks like a Steam Workshop file ID — those belong in
 * WorkshopItems=, never in Mods=, and writing them into Mods= results in
 * a polluted INI that PZ silently ignores.
 *
 * Returns the joined semicolon string. The dropped count is appended on
 * the returned function as a side channel via a wrapper if callers need
 * to log it; for simplicity we just filter here.
 */
export function sanitizeModIdList(values) {
  const out = [];
  for (const raw of values || []) {
    const v = sanitizeIniValue(raw);
    if (!v) continue;
    if (looksLikeWorkshopId(v)) continue; // workshop ID misplaced in Mods=
    out.push(v);
  }
  return out.join(';');
}
