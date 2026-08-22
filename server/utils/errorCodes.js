/**
 * Single source of truth for every machine-readable `code` the server
 * attaches to a response. A `code: "..."` value used anywhere in
 * server/routes or server/services MUST be a member of this object --
 * never a bare string literal at the call site, and never a locale key
 * built by concatenation/template at the point of use. That second pattern
 * is banned by name, not by guess: a sibling codebase (Zomboid_dev_panel
 * V2, apps/web/src/errorCodeMessageResolver.ts) shipped it as one of two
 * competing code->locale-key conventions, and the template-built one
 * "defeated three separate analyses" and rendered a raw i18next key on a
 * real screen because nothing had a static string to grep for. A key built
 * at runtime is invisible to every tool -- including the enforcement test
 * below -- that looks for a literal.
 *
 * See server/tests/errorCodeRegistry.test.js -- it AST-scans server/routes,
 * server/services, server/index.js and server/middleware for every
 * `code: "<literal>"` object-literal property and asserts each one is a
 * value here, and (once the file exists) that every key here has a
 * matching entry in client/src/locales/en/errors.json.
 *
 * CONSTANT NAME vs WIRE VALUE -- these are deliberately NOT always the
 * same string:
 *   - The 10 codes added most recently (auth.js, serverFiles.js,
 *     configMutationGuard.js) use the constant name as the wire value
 *     unchanged: ErrorCode.AUTH_REQUIRED === "AUTH_REQUIRED".
 *   - The 8 older codes (chunks.js, index.js, dockerUpdateProxy.js,
 *     panelUpdateChecker.js) ship a lower_snake_case wire value that
 *     client code already compares against with `===` today
 *     (client/src/pages/ChunkCleaner.tsx checks `err.code ===
 *     "server_running"`; client/src/pages/Settings.tsx checks
 *     `"apply_in_progress"`). Renaming those wire values would be a
 *     coordinated client+server change for zero user-visible benefit, and
 *     was explicitly ruled out (2026-08-22 i18n survey/ruling) rather than
 *     done silently. Their constant names are UPPER_SNAKE_CASE with a
 *     `_LEGACY` suffix, invented purely so every code -- old or new -- has
 *     an UPPER_SNAKE_CASE locale key to hang a translation on, even though
 *     the wire value itself stays frozen and lower_snake_case forever. Do
 *     not "clean up" a legacy wire value without going back to whoever
 *     owns the client comparison it would break.
 *
 * The constant name IS the locale key: client/src/locales/en/errors.json
 * and fr/errors.json key their entries by constant name
 * (`"AUTH_REQUIRED": "..."`, `"SERVER_RUNNING_LEGACY": "..."`), never by
 * wire value -- so a locale key is always derivable from the constant name
 * alone, independent of what the wire value happens to be.
 */

export const ErrorCode = Object.freeze({
  // --- current convention: constant name === wire value ---

  /** server/routes/auth.js -- POST /api/auth/setup, missing/invalid setup token. */
  SETUP_TOKEN_REQUIRED: "SETUP_TOKEN_REQUIRED",
  /** server/routes/auth.js -- POST /api/auth/refresh, no refresh token cookie/body. */
  NO_REFRESH_TOKEN: "NO_REFRESH_TOKEN",
  /** server/routes/auth.js -- POST /api/auth/refresh, refresh token present but invalid/expired. */
  INVALID_REFRESH_TOKEN: "INVALID_REFRESH_TOKEN",
  /** server/routes/serverFiles.js -- ServerNotConfiguredError, thrown by the
   * router-level gate when no server is configured at all. */
  SERVER_NOT_CONFIGURED: "SERVER_NOT_CONFIGURED",
  /** server/routes/serverFiles.js -- a route that needs the remote-config
   * (SFTP) transport, but it isn't configured. */
  REMOTE_CONFIG_NOT_CONFIGURED: "REMOTE_CONFIG_NOT_CONFIGURED",
  /** server/services/auth.js -- requireAuth middleware, first-run setup not done yet. */
  SETUP_REQUIRED: "SETUP_REQUIRED",
  /** server/services/auth.js -- requireAuth middleware, no/malformed Authorization header. */
  AUTH_REQUIRED: "AUTH_REQUIRED",
  /** server/services/auth.js -- requireAuth middleware, token present but invalid/expired. */
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  /** server/services/configMutationGuard.js -- couldn't determine whether the
   * server process is running (no serverManager, or the check itself threw). */
  SERVER_STATE_UNKNOWN: "SERVER_STATE_UNKNOWN",
  /** server/services/configMutationGuard.js -- server is confirmed running;
   * local config mutation refused until it's stopped. */
  SERVER_RUNNING: "SERVER_RUNNING",

  // --- legacy: wire value frozen (client compares it with === today),
  //     constant name invented only so a locale key exists ---

  /** server/routes/chunks.js, server/index.js (Docker-update apply path) --
   * wire value "server_running", already compared exactly by
   * client/src/pages/ChunkCleaner.tsx. Do not rename the value. */
  SERVER_RUNNING_LEGACY: "server_running",
  /** server/services/dockerUpdateProxy.js -- Docker update controller not configured. */
  DOCKER_UPDATER_NOT_CONFIGURED_LEGACY: "docker_updater_not_configured",
  /** server/services/dockerUpdateProxy.js, server/services/panelUpdateChecker.js,
   * server/index.js -- wire value "apply_in_progress", already compared
   * exactly by client/src/pages/Settings.tsx. Do not rename the value. */
  APPLY_IN_PROGRESS_LEGACY: "apply_in_progress",
  /** server/services/panelUpdateChecker.js -- downloadUpdate() called while
   * a download is already running. */
  ALREADY_DOWNLOADING_LEGACY: "already_downloading",
  /** server/services/panelUpdateChecker.js -- downloadUpdate() called with
   * nothing new to download. */
  NO_UPDATE_LEGACY: "no_update",
  /** server/index.js -- Docker-update apply path, caller didn't pass
   * `confirm: true`. */
  CONFIRMATION_REQUIRED_LEGACY: "confirmation_required",
  /** server/index.js -- Docker-update apply path, world save failed before
   * shutdown. */
  SAVE_FAILED_LEGACY: "save_failed",
  /** server/index.js -- Docker-update apply path, server wouldn't shut down. */
  STOP_FAILED_LEGACY: "stop_failed",
});

/**
 * NOT in this registry, deliberately: `ETIMEDOUT` (server/services/
 * panelUpdateChecker.js, `timeoutError.code = "ETIMEDOUT"`). It's Node's
 * own conventional code for an internal GitHub-API timeout, read back by
 * isRetryableGitHubError() for retry logic -- it is never attached to a
 * client response and was never meant to be user-facing text. Bare
 * `err.code = "<literal>"` assignments like this one (as opposed to a
 * `code: "<literal>"` object-literal property) are NOT scanned by
 * errorCodeRegistry.test.js at all -- see that file's own header comment
 * for why, and for the one known case (`apply_in_progress` in
 * spawnWindowsApplyHelper()) where that same assignment shape IS user-
 * facing and is covered here anyway, just not by the automated scan.
 */
