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
  /** server/routes/auth.js -- loginLimiter, POST /api/auth/login rate-limited (5/min per IP). */
  RATE_LIMIT_LOGIN: "RATE_LIMIT_LOGIN",
  /** server/routes/auth.js -- GET /api/auth/status, needsSetup()/isAuthEnabled() threw. */
  AUTH_STATUS_CHECK_FAILED: "AUTH_STATUS_CHECK_FAILED",
  /** server/routes/auth.js -- setupLimiter, POST /api/auth/setup rate-limited (5/15min per IP). */
  RATE_LIMIT_SETUP: "RATE_LIMIT_SETUP",
  /** server/routes/auth.js -- POST /api/auth/setup, setup already completed (needsSetup() false). */
  SETUP_ALREADY_COMPLETED: "SETUP_ALREADY_COMPLETED",
  /** server/routes/auth.js (3 sites: /setup, /login, POST /users) -- username
   * and/or password missing. Identical wording, identical meaning across all
   * three -- shared code rather than three copies, same reasoning as
   * WIPE_TARGETS_REQUIRED elsewhere in this file. */
  AUTH_USERNAME_PASSWORD_REQUIRED: "AUTH_USERNAME_PASSWORD_REQUIRED",
  /** server/routes/auth.js -- POST /api/auth/setup, panelPort not an integer
   * in [1024, 65535]. */
  SETUP_PANEL_PORT_INVALID: "SETUP_PANEL_PORT_INVALID",
  /** server/routes/auth.js -- POST /api/auth/refresh, refreshAccessToken()
   * threw (not the "no token"/"invalid token" cases above, which return
   * early with their own codes -- this is the catch-all for an unexpected
   * failure, e.g. a DB error). */
  TOKEN_REFRESH_FAILED: "TOKEN_REFRESH_FAILED",
  /** server/routes/auth.js (4 sites: GET /me, POST /change-password, GET+POST
   * /recovery-codes) -- getAuthenticatedUser() returned null. Own code from
   * AUTH_REQUIRED (requireAuth middleware's "Authentication required") --
   * different wording ("Not authenticated"), different call sites (route
   * body checks, not middleware), kept separate rather than merged. */
  NOT_AUTHENTICATED: "NOT_AUTHENTICATED",
  /** server/routes/auth.js -- GET /api/auth/me, getAuthenticatedUser() threw. */
  AUTHENTICATION_ERROR: "AUTHENTICATION_ERROR",
  /** server/routes/auth.js -- POST /api/auth/change-password, currentPassword
   * and/or newPassword missing. */
  CHANGE_PASSWORD_FIELDS_REQUIRED: "CHANGE_PASSWORD_FIELDS_REQUIRED",
  /** server/routes/auth.js (2 sites: POST /users, PATCH /users/:id/role) --
   * `role` not one of USER_ROLES. Identical wording/meaning both sites,
   * shared code -- same reasoning as AUTH_USERNAME_PASSWORD_REQUIRED above. */
  AUTH_INVALID_ROLE: "AUTH_INVALID_ROLE",
  /** server/routes/auth.js -- resetLimiter, POST /api/auth/recover-with-code
   * and /reset-password rate-limited (3/15min per IP). */
  RATE_LIMIT_RESET: "RATE_LIMIT_RESET",
  /** server/routes/auth.js -- localResetTokenLimiter, POST
   * /api/auth/reset-token/local rate-limited (5/15min per IP). */
  RATE_LIMIT_LOCAL_RECOVERY: "RATE_LIMIT_LOCAL_RECOVERY",
  /** server/routes/auth.js -- POST /api/auth/recover-with-code, recovery
   * code and/or newPassword missing. */
  RECOVERY_CODE_FIELDS_REQUIRED: "RECOVERY_CODE_FIELDS_REQUIRED",
  /** server/routes/auth.js -- POST /api/auth/reset-token/local, request did
   * not originate from the panel host itself. */
  LOCAL_RESET_NOT_LOCAL: "LOCAL_RESET_NOT_LOCAL",
  /** server/routes/auth.js -- POST /api/auth/reset-token/local, writing the
   * token file itself failed. */
  LOCAL_RESET_TOKEN_CREATE_FAILED: "LOCAL_RESET_TOKEN_CREATE_FAILED",
  /** server/routes/auth.js -- POST /api/auth/reset-password, token and/or
   * newPassword missing. */
  RESET_PASSWORD_FIELDS_REQUIRED: "RESET_PASSWORD_FIELDS_REQUIRED",
  /** server/routes/auth.js -- POST /api/auth/reset-password, newPassword
   * exceeds 128 characters. */
  RESET_PASSWORD_TOO_LONG: "RESET_PASSWORD_TOO_LONG",
  /** server/routes/auth.js -- POST /api/auth/reset-password, no
   * reset-token.txt exists on disk. */
  RESET_TOKEN_NOT_FOUND: "RESET_TOKEN_NOT_FOUND",
  /** server/routes/auth.js -- POST /api/auth/reset-password,
   * reset-token.txt exceeds the 1KB size cap. */
  RESET_TOKEN_TOO_LARGE: "RESET_TOKEN_TOO_LARGE",
  /** server/routes/auth.js -- POST /api/auth/reset-password,
   * reset-token.txt is older than 24h. */
  RESET_TOKEN_EXPIRED: "RESET_TOKEN_EXPIRED",
  /** server/routes/auth.js -- POST /api/auth/reset-password,
   * reset-token.txt content is under 8 characters. */
  RESET_TOKEN_TOO_SHORT: "RESET_TOKEN_TOO_SHORT",
  /** server/routes/auth.js -- POST /api/auth/reset-password, submitted token
   * does not match the stored token (timing-safe compare failed). */
  RESET_TOKEN_INVALID: "RESET_TOKEN_INVALID",
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

  /** server/routes/server.js -- POST /api/server/start, active server is remote. */
  SERVER_START_REMOTE_REFUSED: "SERVER_START_REMOTE_REFUSED",
  /** server/routes/server.js -- POST /api/server/force-stop, active server is
   * remote. Own wording/code, not reused across start/force-stop/restart --
   * same reasoning as SERVER_RUNNING_RCON_UNAVAILABLE above: which action was
   * refused is itself useful information to keep. */
  SERVER_FORCE_STOP_REMOTE_REFUSED: "SERVER_FORCE_STOP_REMOTE_REFUSED",
  /** server/routes/server.js -- POST /api/server/restart, active server is remote. */
  SERVER_RESTART_REMOTE_REFUSED: "SERVER_RESTART_REMOTE_REFUSED",
  /** server/routes/server.js -- POST /api/server/stop, RCON isn't connected
   * so the graceful (save-then-quit) shutdown can't happen. */
  SERVER_STOP_RCON_NOT_CONNECTED: "SERVER_STOP_RCON_NOT_CONNECTED",
  /** server/routes/server.js -- POST /api/server/stop, the pre-quit world
   * save itself failed; server was left running. */
  SERVER_STOP_SAVE_FAILED: "SERVER_STOP_SAVE_FAILED",
  /** server/routes/server.js -- POST /api/server/stop, world saved but the
   * managed container failed to stop. */
  SERVER_STOP_CONTAINER_STOP_FAILED: "SERVER_STOP_CONTAINER_STOP_FAILED",
  /** server/routes/server.js -- POST /api/server/message, no message body. */
  SERVER_MESSAGE_REQUIRED: "SERVER_MESSAGE_REQUIRED",
  /** server/routes/server.js -- POST /api/server/message, message isn't a
   * string or exceeds 1000 characters. */
  SERVER_MESSAGE_TOO_LONG: "SERVER_MESSAGE_TOO_LONG",
  /** server/routes/server.js (3 sites: lightning, thunder, horde) -- optional
   * `username` isn't a string or exceeds 64 characters. */
  EVENTS_INVALID_USERNAME: "EVENTS_INVALID_USERNAME",
  /** server/routes/server.js (3 sites: /branches, /install, /steam-update) --
   * steamcmdPath fails isValidPath(). */
  STEAMCMD_PATH_INVALID: "STEAMCMD_PATH_INVALID",
  /** server/routes/server.js (3 sites: /install, /quick-setup, /steam-update) --
   * installPath fails isValidPath(). */
  INSTALL_PATH_INVALID: "INSTALL_PATH_INVALID",
  /** server/routes/server.js -- POST /api/server/install, missing
   * steamcmdPath/installPath/serverName. Own code from the /quick-setup and
   * /steam-update variants below, which require different field sets. */
  INSTALL_MISSING_FIELDS: "INSTALL_MISSING_FIELDS",
  /** server/routes/server.js (2 sites: /install, /quick-setup) -- serverName
   * fails isValidServerName() (letters/numbers/underscore/hyphen/space, max
   * 64 chars). Distinct from WIPE_INVALID_SERVER_NAME below, which is a
   * bare no-path-separators check on the already-configured server name. */
  SERVER_NAME_FORMAT_INVALID: "SERVER_NAME_FORMAT_INVALID",
  /** server/routes/server.js (2 sites: /install, /quick-setup) -- optional
   * zomboidDataPath fails isValidPath(). */
  ZOMBOID_DATA_PATH_INVALID: "ZOMBOID_DATA_PATH_INVALID",
  /** server/routes/server.js -- formatWritablePathError(), 4 call sites
   * across /install and /quick-setup (installPath, then the Zomboid data
   * folder). The underlying message has two English-only variants (bare-metal
   * vs Docker-detected) composed by formatWritablePathError() itself; the
   * locale text below covers the common non-container wording only -- the
   * Docker-specific addendum stays English-only in the `error` fallback
   * text, a known partial-translation gap, not a bug. */
  WRITABLE_PATH_ERROR: "WRITABLE_PATH_ERROR",
  /** server/routes/server.js (2 sites: /install, /steam-update) -- steamcmd
   * executable missing on Windows (no auto-download there). */
  STEAMCMD_NOT_FOUND_AT_PATH: "STEAMCMD_NOT_FOUND_AT_PATH",
  /** server/routes/server.js (2 sites: /install, /steam-update) -- Linux
   * auto-download of steamcmd (ensureSteamCmdLinux) itself failed. */
  STEAMCMD_AUTO_DOWNLOAD_FAILED: "STEAMCMD_AUTO_DOWNLOAD_FAILED",
  /** server/routes/server.js -- POST /api/server/install, another Steam
   * operation already running for this install path. Own code from the
   * /steam-update variant below -- "for this path" vs "for this server" are
   * different wordings kept separate, not merged. */
  STEAM_OPERATION_IN_PROGRESS_PATH: "STEAM_OPERATION_IN_PROGRESS_PATH",
  /** server/routes/server.js -- POST /api/server/quick-setup, missing
   * installPath/serverName. */
  QUICK_SETUP_MISSING_FIELDS: "QUICK_SETUP_MISSING_FIELDS",
  /** server/routes/server.js -- POST /api/server/quick-setup, none of the
   * expected PZ server marker files/folders found at installPath. */
  QUICK_SETUP_SERVER_FILES_NOT_FOUND: "QUICK_SETUP_SERVER_FILES_NOT_FOUND",
  /** server/routes/server.js -- POST /api/server/configure-rcon, no
   * rconPassword in the body. Own code from rcon.js's RCON_* codes -- this
   * is the server-config route, not the live rcon.js connection routes. */
  CONFIGURE_RCON_PASSWORD_REQUIRED: "CONFIGURE_RCON_PASSWORD_REQUIRED",
  /** server/routes/server.js (2 sites: /configure-rcon, /configure-network) --
   * no serverConfigPath resolved (install never run). */
  SERVER_CONFIG_PATH_NOT_SET: "SERVER_CONFIG_PATH_NOT_SET",
  /** server/routes/server.js (2 sites: /configure-rcon, /configure-network) --
   * serverConfigPath resolved but the .ini file doesn't exist yet. */
  SERVER_CONFIG_FILE_NOT_FOUND: "SERVER_CONFIG_FILE_NOT_FOUND",
  /** server/routes/server.js -- POST /api/server/reloadlua, no filename. */
  RELOAD_LUA_FILENAME_REQUIRED: "RELOAD_LUA_FILENAME_REQUIRED",
  /** server/routes/server.js -- POST /api/server/reloadlua, filename fails
   * the .lua path-traversal-safe format check. */
  RELOAD_LUA_INVALID_FILENAME: "RELOAD_LUA_INVALID_FILENAME",
  /** server/routes/server.js -- POST /api/server/log, missing type or level. */
  LOG_TYPE_LEVEL_REQUIRED: "LOG_TYPE_LEVEL_REQUIRED",
  /** server/routes/server.js -- POST /api/server/log, `type` not in the
   * known PZ log-type list. */
  LOG_INVALID_TYPE: "LOG_INVALID_TYPE",
  /** server/routes/server.js -- POST /api/server/log, `level` not in the
   * known PZ log-level list. */
  LOG_INVALID_LEVEL: "LOG_INVALID_LEVEL",
  /** server/routes/server.js -- POST /api/server/stats, no mode. */
  STATS_MODE_REQUIRED: "STATS_MODE_REQUIRED",
  /** server/routes/server.js -- POST /api/server/stats, `mode` not one of
   * none/file/console/all. */
  STATS_INVALID_MODE: "STATS_INVALID_MODE",
  /** server/routes/server.js -- POST /api/server/steam-update, missing
   * steamcmdPath/installPath. */
  STEAM_UPDATE_MISSING_FIELDS: "STEAM_UPDATE_MISSING_FIELDS",
  /** server/routes/server.js -- POST /api/server/steam-update, the target
   * server process is currently running. */
  STEAM_UPDATE_SERVER_RUNNING: "STEAM_UPDATE_SERVER_RUNNING",
  /** server/routes/server.js -- POST /api/server/steam-update, another Steam
   * operation already running for this server. See STEAM_OPERATION_IN_
   * PROGRESS_PATH above for why this stays a separate code. */
  STEAM_OPERATION_IN_PROGRESS_SERVER: "STEAM_OPERATION_IN_PROGRESS_SERVER",
  /** server/routes/server.js -- POST /api/server/steamcmd/download,
   * installPath fails isValidPath(). Own wording ("installation path") from
   * INSTALL_PATH_INVALID/STEAMCMD_PATH_INVALID above -- different route,
   * different phrasing. */
  STEAMCMD_DOWNLOAD_INVALID_PATH: "STEAMCMD_DOWNLOAD_INVALID_PATH",
  /** server/routes/server.js (4 sites: /delete-files x2, /list-directory,
   * /wipe) -- a path argument fails isValidPath() or a post-normalize `..`
   * check. All four sites emit the bare, already-generic "Invalid path"
   * with no route-specific detail to lose, so they share one code. */
  INVALID_PATH: "INVALID_PATH",
  /** server/routes/server.js (2 sites: /delete-files, /list-directory) --
   * fs.existsSync() false for the given path. */
  PATH_NOT_FOUND: "PATH_NOT_FOUND",
  /** server/routes/server.js -- POST /api/server/delete-files, path exists
   * but none of the known PZ server marker files are present -- refusing to
   * delete a folder that might not be a PZ install. */
  DELETE_FILES_NOT_PZ_INSTALL: "DELETE_FILES_NOT_PZ_INSTALL",
  /** server/routes/server.js -- POST /api/server/list-directory, path exists
   * but isn't a directory. */
  PATH_NOT_A_DIRECTORY: "PATH_NOT_A_DIRECTORY",
  /** server/routes/server.js -- POST /api/server/list-directory,
   * fs.readdirSync() threw (permissions). Message embeds an OS error code
   * and a platform-specific English guidance sentence composed at the call
   * site -- the locale text below covers the fixed frame around them;
   * {{guidance}} itself stays English, same known gap as WRITABLE_PATH_ERROR
   * above. */
  DIRECTORY_READ_FAILED: "DIRECTORY_READ_FAILED",
  /** server/routes/server.js -- POST /api/server/browse-folder, `description`
   * fails its alphanumeric/punctuation format check. */
  BROWSE_FOLDER_INVALID_DESCRIPTION: "BROWSE_FOLDER_INVALID_DESCRIPTION",
  /** server/routes/server.js -- POST /api/server/browse-folder (Linux), no
   * GUI file-picker (zenity/kdialog) available. */
  BROWSE_FOLDER_NO_DIALOG_AVAILABLE: "BROWSE_FOLDER_NO_DIALOG_AVAILABLE",
  /** server/routes/server.js -- POST /api/server/browse-folder (Windows),
   * the PowerShell folder-browser process itself errored. */
  BROWSE_FOLDER_OPEN_FAILED: "BROWSE_FOLDER_OPEN_FAILED",
  /** server/routes/server.js (3 sites: /console-log, /console-log/stream,
   * /console-log/clear) -- no zomboidDataPath resolved anywhere (active
   * server, settings, or serverPath fallback). */
  SERVER_DATA_PATH_NOT_CONFIGURED: "SERVER_DATA_PATH_NOT_CONFIGURED",
  /** server/routes/server.js (3 sites: /update-check, /update-check/status,
   * /update-check/interval) -- app.get("updateChecker") not registered. */
  UPDATE_CHECKER_NOT_AVAILABLE: "UPDATE_CHECKER_NOT_AVAILABLE",
  /** server/routes/server.js -- GET /api/server/update-check?force=true,
   * checkForUpdates() resolved falsy. */
  UPDATE_CHECK_NO_RESULT: "UPDATE_CHECK_NO_RESULT",
  /** server/routes/server.js -- POST /api/server/update-check/interval,
   * `minutes` missing or not a number. */
  UPDATE_CHECK_INTERVAL_INVALID: "UPDATE_CHECK_INTERVAL_INVALID",
  /** server/routes/server.js (2 sites: /wipe/preview, /wipe) -- `targets`
   * missing/empty/not an array. Identical wording both sites, shared code. */
  WIPE_TARGETS_REQUIRED: "WIPE_TARGETS_REQUIRED",
  /** server/routes/server.js -- POST /api/server/wipe/preview, `targets`
   * contains an unrecognized value. Own code from WIPE_INVALID_TARGETS below
   * -- the preview route's message additionally lists the allowed values,
   * the execute route's does not; different wording, kept separate rather
   * than flattened to one. */
  WIPE_PREVIEW_INVALID_TARGETS: "WIPE_PREVIEW_INVALID_TARGETS",
  /** server/routes/server.js -- POST /api/server/wipe, `targets` contains an
   * unrecognized value. See WIPE_PREVIEW_INVALID_TARGETS above for why this
   * is a separate code rather than reused. */
  WIPE_INVALID_TARGETS: "WIPE_INVALID_TARGETS",
  /** server/routes/server.js (2 sites: /wipe/preview, /wipe) -- serverManager
   * has no savePath configured. */
  WIPE_ZOMBOID_DATA_PATH_NOT_CONFIGURED: "WIPE_ZOMBOID_DATA_PATH_NOT_CONFIGURED",
  /** server/routes/server.js (2 sites: /wipe/preview, /wipe) -- the
   * configured server name contains a path separator. Distinct from
   * SERVER_NAME_FORMAT_INVALID above (that one validates a *submitted* name
   * against the full format rule at install time; this one is a bare
   * traversal guard on the *already-configured* name). */
  WIPE_INVALID_SERVER_NAME: "WIPE_INVALID_SERVER_NAME",
  /** server/routes/server.js (2 sites: /wipe/preview, /wipe) -- the resolved
   * Saves/Multiplayer/<serverName> directory doesn't exist. */
  WIPE_SAVE_DIRECTORY_NOT_FOUND: "WIPE_SAVE_DIRECTORY_NOT_FOUND",
  /** server/routes/server.js -- POST /api/server/wipe, another wipe is
   * already running (module-level guard). */
  WIPE_IN_PROGRESS: "WIPE_IN_PROGRESS",
  /** server/routes/server.js -- POST /api/server/wipe, the server process is
   * currently running (wipe requires it stopped). */
  WIPE_SERVER_RUNNING: "WIPE_SERVER_RUNNING",
  /** server/routes/server.js -- POST /api/server/wipe, caller didn't pass
   * `confirm: true`. */
  WIPE_CONFIRM_REQUIRED: "WIPE_CONFIRM_REQUIRED",

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
