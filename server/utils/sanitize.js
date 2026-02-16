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
    .replace(UNC_PATH_RE, '[path]');
}
