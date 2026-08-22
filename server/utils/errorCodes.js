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
  /** server/services/permissions.js -- requirePermission() refused: the
   * caller's role doesn't grant the capability, the role couldn't be
   * resolved at all, or the capability string itself isn't a registered
   * one. Deliberately one code for all three -- the middleware fails closed
   * the same way regardless of which one occurred, and the response never
   * says which (an unrecognized-capability detail belongs in the server
   * log, not in a message an unauthorized caller can read). */
  PERMISSION_DENIED: "PERMISSION_DENIED",
  /** server/routes/permissions.js -- GET/PUT/DELETE .../roles/:id, no role
   * with that id exists. */
  ROLE_NOT_FOUND: "ROLE_NOT_FOUND",
  /** server/routes/permissions.js -- POST/PUT .../roles, the requested name
   * already belongs to another role. */
  ROLE_NAME_TAKEN: "ROLE_NAME_TAKEN",
  /** server/routes/permissions.js -- POST/PUT .../roles, the capabilities
   * array contains a key that isn't in the catalogue. */
  INVALID_CAPABILITY: "INVALID_CAPABILITY",
  /** server/services/permissions.js -- lockout rule 1: this change would
   * leave zero users able to manage roles or manage users. Hard refusal,
   * no override. */
  ROLE_LOCKOUT_LAST_MANAGER: "ROLE_LOCKOUT_LAST_MANAGER",
  /** server/services/permissions.js -- lockout rule 2: the acting user is
   * about to remove their own ability to manage roles/users (other users
   * still hold it, so not a full lockout under ROLE_LOCKOUT_LAST_MANAGER --
   * but the acting user would lose their own way to undo this). Refused
   * unless the request explicitly sets confirmSelfCapabilityLoss: true. */
  ROLE_SELF_CAPABILITY_LOSS_CONFIRM: "ROLE_SELF_CAPABILITY_LOSS_CONFIRM",
  /** server/services/permissions.js -- lockout rule 3: DELETE on a role
   * that users still hold, with no reassignTo given -- refused rather than
   * orphaning them. */
  ROLE_HAS_MEMBERS: "ROLE_HAS_MEMBERS",
  /** server/services/auth.js -- DELETE /api/auth/users/:id, the caller
   * targeted their own account. Hard refusal, no override: unlike editing
   * your own role's capabilities (ROLE_SELF_CAPABILITY_LOSS_CONFIRM, which
   * still leaves you signed in with reduced access), deleting your own
   * account invalidates your session on the very next request -- you'd be
   * logged out mid-action with no account left to log back into. Another
   * admin can delete the account instead, which is a deliberate two-party
   * action rather than a one-click accident. */
  USER_SELF_DELETE_REFUSED: "USER_SELF_DELETE_REFUSED",
  /** server/index.js -- Docker-update apply path ONLY: server is running
   * and RCON isn't connected, so the panel can't stop it automatically
   * before applying the update. Split out from SERVER_RUNNING_LEGACY
   * (2026-08-22 ruling) rather than reusing it or interpolating a shared
   * message: chunks.js's refusal means "a running server holds save files
   * open and will overwrite your changes on shutdown" and this one means
   * "RCON is unavailable so the panel can't stop it for you" -- two
   * different, specific, useful reasons that a single shared string (or a
   * template-substituted one) would flatten into one generic "server is
   * running" message, throwing away whichever half didn't get picked.
   * A NEW call site, not yet wired -- server/index.js was dirty (Kevin's
   * CSP work, Dwight's route sweep) when this was added, so the actual
   * `code: "server_running"` -> `code: ErrorCode.SERVER_RUNNING_RCON_
   * UNAVAILABLE` swap at that one site is pending sequencing. */
  SERVER_RUNNING_RCON_UNAVAILABLE: "SERVER_RUNNING_RCON_UNAVAILABLE",

  /** server/routes/docker.js -- POST /api/docker/containers/:id/:action,
   * dockerClient exists but isn't enabled/available. */
  DOCKER_UNAVAILABLE: "DOCKER_UNAVAILABLE",
  /** server/routes/docker.js -- POST /api/docker/containers/:id/:action,
   * req.body.serverId doesn't match a known server profile. */
  SERVER_PROFILE_NOT_FOUND: "SERVER_PROFILE_NOT_FOUND",
  /** server/routes/docker.js -- the container id in the URL isn't the one
   * mapped to the resolved server profile. */
  CONTAINER_NOT_MAPPED: "CONTAINER_NOT_MAPPED",
  /** server/routes/docker.js -- the container exists but isn't one this
   * panel manages (inspectManagedContainer returned nothing). */
  CONTAINER_NOT_MANAGED: "CONTAINER_NOT_MANAGED",
  /** server/routes/docker.js -- stop/restart action on a running container:
   * couldn't establish an RCON connection to save the world first. */
  DOCKER_ACTION_RCON_CONNECT_FAILED: "DOCKER_ACTION_RCON_CONNECT_FAILED",
  /** server/routes/docker.js -- stop/restart action on a running container:
   * RCON connected but the pre-stop world save itself failed. */
  DOCKER_ACTION_SAVE_FAILED: "DOCKER_ACTION_SAVE_FAILED",

  /** server/routes/rcon.js -- POST /api/rcon/execute, no command in the body. */
  RCON_COMMAND_REQUIRED: "RCON_COMMAND_REQUIRED",
  /** server/routes/rcon.js -- POST /api/rcon/execute, command isn't a
   * string or exceeds the 2000-character cap. */
  RCON_COMMAND_INVALID: "RCON_COMMAND_INVALID",
  /** server/routes/rcon.js -- POST /api/rcon/connect, host fails the
   * alphanumeric/dot/hyphen format check. */
  RCON_INVALID_HOST: "RCON_INVALID_HOST",
  /** server/routes/rcon.js -- POST /api/rcon/connect, port isn't 1-65535. */
  RCON_INVALID_PORT: "RCON_INVALID_PORT",
  /** server/routes/rcon.js -- POST /api/rcon/connect, password isn't a
   * string or exceeds 256 characters. */
  RCON_INVALID_PASSWORD: "RCON_INVALID_PASSWORD",
  /** server/routes/rcon.js -- POST /api/rcon/connect, rconService.connect()
   * returned false (server not running or RCON not enabled there). */
  RCON_CONNECT_FAILED: "RCON_CONNECT_FAILED",

  /** server/routes/backup.js -- POST /api/backup/create, active server is
   * remote (SFTP-managed), so there's no local filesystem to back up. */
  BACKUP_REMOTE_NOT_AVAILABLE: "BACKUP_REMOTE_NOT_AVAILABLE",
  /** server/routes/backup.js -- GET /api/backup/download/:name,
   * getBackupsPath() returned nothing (no server configured yet). */
  BACKUPS_FOLDER_NOT_FOUND: "BACKUPS_FOLDER_NOT_FOUND",
  /** server/routes/backup.js (2 sites: download, restore) -- the :name
   * param doesn't end in .zip after path.basename() sanitization. */
  BACKUP_INVALID_FILE: "BACKUP_INVALID_FILE",
  /** server/routes/backup.js -- GET /api/backup/download/:name, no file at
   * the resolved path. */
  BACKUP_NOT_FOUND: "BACKUP_NOT_FOUND",
  /** server/routes/backup.js -- POST /api/backup/restore/:name, active
   * server is remote. Distinct wording/code from BACKUP_REMOTE_NOT_AVAILABLE
   * (create path) -- kept separate rather than merged, same reasoning as
   * SERVER_RUNNING_RCON_UNAVAILABLE above. */
  BACKUP_RESTORE_REMOTE_NOT_AVAILABLE: "BACKUP_RESTORE_REMOTE_NOT_AVAILABLE",
  /** server/routes/backup.js -- POST /api/backup/restore/:name, the target
   * server process is currently running. */
  BACKUP_RESTORE_SERVER_RUNNING: "BACKUP_RESTORE_SERVER_RUNNING",
  /** server/routes/backup.js -- POST /api/backup/delete-older-than, `days`
   * isn't a number >= 1. */
  BACKUP_INVALID_DAYS_PARAMETER: "BACKUP_INVALID_DAYS_PARAMETER",
  /** server/routes/backup.js -- POST /api/backup/upload, active server is
   * remote. Distinct from the create/restore remote-refusal codes above --
   * own wording, own call site. */
  BACKUP_UPLOAD_REMOTE_NOT_AVAILABLE: "BACKUP_UPLOAD_REMOTE_NOT_AVAILABLE",
  /** server/routes/backup.js -- POST /api/backup/upload, empty or missing
   * request body. */
  BACKUP_UPLOAD_NO_FILE: "BACKUP_UPLOAD_NO_FILE",
  /** server/routes/backup.js -- POST /api/backup/upload, body doesn't start
   * with the zip local-file-header signature. */
  BACKUP_UPLOAD_INVALID_ZIP_SIGNATURE: "BACKUP_UPLOAD_INVALID_ZIP_SIGNATURE",
  /** server/routes/backup.js -- POST /api/backup/upload, sanitized filename
   * doesn't end in .zip. Distinct check/site from BACKUP_UPLOAD_INVALID_ZIP_
   * SIGNATURE (that one reads file bytes; this one reads the filename). */
  BACKUP_UPLOAD_INVALID_EXTENSION: "BACKUP_UPLOAD_INVALID_EXTENSION",
  /** server/routes/backup.js -- POST /api/backup/upload, a backup with the
   * resolved target filename already exists on disk. */
  BACKUP_UPLOAD_NAME_CONFLICT: "BACKUP_UPLOAD_NAME_CONFLICT",
  /** server/routes/backup.js -- POST /api/backup/upload, getBackupsPath()
   * returned nothing. Distinct code/status(500) from BACKUPS_FOLDER_NOT_
   * FOUND (download path, status 404) -- different route, different wording. */
  BACKUPS_FOLDER_UNAVAILABLE: "BACKUPS_FOLDER_UNAVAILABLE",

  // --- legacy: wire value frozen (client compares it with === today),
  //     constant name invented only so a locale key exists ---

  /** server/routes/chunks.js (4 sites) -- wire value "server_running",
   * already compared exactly by client/src/pages/ChunkCleaner.tsx. Do not
   * rename the value. NOT used by server/index.js's Docker-update path any
   * more as of the 2026-08-22 split -- see SERVER_RUNNING_RCON_UNAVAILABLE
   * above for that one; it carries a different, more specific reason and
   * was deliberately given its own code rather than reusing this one. */
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
