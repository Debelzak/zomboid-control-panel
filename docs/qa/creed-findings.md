# Creed — adversarial findings log

Read-only bug hunt. Areas assigned: server/routes/{scheduler,discord,backup,serverFiles,servers,discovery,templates,serverFinder,panelBridge,rcon}.js
and their matching server/services/*.js, plus a cross-cutting audit of server/services/permissions.js's capability catalogue.
Findings appended as found, each verified before being listed unless marked UNVERIFIED. Coverage notes at the bottom.

---

## Finding 1 — dead "must be absolute path" check in servers.js /auto-scan and /detect

**WHERE:** `server/routes/servers.js:251-256` (`/auto-scan`) and `server/routes/servers.js:367-370` (`/detect`)

**WHAT HAPPENS:** Both routes do:
```js
const resolvedPath = path.resolve(scanPath);
if (!path.isAbsolute(resolvedPath)) {
  return res.status(400).json({ error: "Must be an absolute path" });
}
```
`path.resolve()` **always** returns an absolute path (it resolves against `process.cwd()` when given a relative input). So `path.isAbsolute(resolvedPath)` is structurally always `true` — the `!...` branch is unreachable dead code. This is the exact "check that cannot fail" shape (`isAbsolute(resolve(x))`) called out as pattern #2 tonight, and it recurs a third time at panelBridge.js:2670 (Finding 2 below).

**WHAT SHOULD HAPPEN:** Either the check should run on the *raw* input (`path.isAbsolute(scanPath)`) before resolving — the way `server/routes/panelBridge.js:228` and `:804` already do it correctly (confirmed by their own comments: "Must check isAbsolute() on the RAW input, not on... path.resolve() always returns...") — or the "must be absolute" requirement should be dropped if a relative path is actually fine to silently resolve against CWD.

**HOW I KNOW:** Read both call sites end to end; confirmed `path.resolve` semantics (Node docs: always returns absolute). Traced a concrete input: POST `/api/servers/auto-scan` with `scanPath: "some/relative/dir"` — `path.resolve("some/relative/dir")` resolves to `<cwd>/some/relative/dir`, which is absolute, so the guard passes and the scan proceeds against a path the caller never intended (server process CWD + their relative fragment) instead of being rejected with the "Must be an absolute path" error the code claims it enforces. Not executed against the live server (read-only hunt), but the logic is deterministic stdlib behavior, not environment-dependent.

**SEVERITY: Low.** This is a validation-message-is-a-lie bug (pattern #1 flavor: an error condition that can never fire), not a privilege escalation — both routes are already gated by `servers.discover` (admin/technician-tier, and the routes intentionally scan arbitrary absolute filesystem paths by design per the comment at servers.js:236 "reads arbitrary local server .ini files and returns their RCON passwords in plaintext... admin-only, same sensitivity tier as chunks delete"). There is no confinement boundary being bypassed — an admin who can already point this at any absolute path can now also point it at a CWD-relative one, which is no more powerful. Fix is one line per site; worth doing for correctness, not urgent for security.

---

## Finding 2 — same dead check in panelBridge.js /install-mod, but harmless due to a real check downstream

**WHERE:** `server/routes/panelBridge.js:2662-2672` (`POST /install-mod`)

**WHAT HAPPENS:** Same shape as Finding 1:
```js
const resolvedTarget = path.resolve(targetPath);
if (!path.isAbsolute(resolvedTarget)) {
  return res.status(400).json({ error: "Must be an absolute path" });
}
```
Dead code for the same reason.

**WHAT SHOULD HAPPEN:** Same fix as Finding 1 — check `path.isAbsolute(targetPath)` before resolving.

**HOW I KNOW:** Read the full route body (lines 2650-2730+). Unlike Finding 1, this route has a *second*, real containment check further down: after `fs.realpathSync()`-resolving the target (defeating symlink chains), it requires `realTarget.toLowerCase()` to end with `/media/lua/server` or `/media/lua/server/` (lines 2696-2707) before any write happens. That second check is not structurally always-true — it genuinely rejects most paths.

**SEVERITY: Cosmetic.** The dead `isAbsolute` check is real dead code (same bug class), but the actual traversal protection lives in the suffix check + realpath resolution just below it, which does work. No exploitable gap found here — noting it for completeness/consistency since it's the same bug pattern as Finding 1 and the fix is identical and trivial.

---

## Cross-cutting audit — permissions.js capability catalogue vs. route enforcement

**WHAT I CHECKED:** Every one of the 27 capability keys in `server/services/permissions.js`'s `CAPABILITIES` array, grepped against `server/routes/*.js` for an actual `requirePermission("<key>")` (or `'<key>'`) call site.

**RESULT: Clean.** All 27 capabilities are referenced by at least one route file. (My first pass grep, double-quote-only, showed `rcon.execute` and `automation.manage` at 0 route files — re-checked by hand: false alarm from my own grep, both files use single-quoted strings. `rcon.js` gates `/execute`, `/connect`, `/test`, `/disconnect` with `requirePermission('rcon.execute')`; `scheduler.js` gates its entire router with `router.use(requirePermission('automation.manage'))` at line 26.) No orphaned capability found — i.e., no "a permission you can grant, that saves, that displays as granted, and does nothing" at the route-gating level for these two files. This does not rule out a capability being checked on the wrong subset of routes within a gated file (that's a per-route question, being covered by the assigned sub-hunts of scheduler.js/discord.js/backup.js/etc. separately), only that the capability isn't *entirely* unenforced.

---

## Coverage so far

Directly read/verified myself: `server/services/permissions.js` (full), `server/routes/servers.js` (auto-scan/detect sections), `server/routes/panelBridge.js` (install-mod section + the two correct isAbsolute(raw-input) sites at :228/:804), `server/routes/scheduler.js` (full), `server/routes/rcon.js` (full), `server/routes/server.js` (isValidPath), `server/routes/config.js` (isValidConfigPath), `server/routes/mods.js` (path-traversal check section), `server/routes/chunks.js` (path-traversal check section) — the latter four to confirm they do NOT share the isAbsolute(resolve()) bug (they check `isAbsolute(normalize())`, which is a legitimate, reachable-false check).

Delegated for deep verification (in progress, will append their results): backup.js/backupService.js/backupRecords.js; scheduler.js+discord.js/discordBot.js internals (partial-failure reporting, unbounded growth, secrets); serverFiles.js/remoteConfigFiles.js/servers.js/serverManager.js (path traversal, command injection); discovery.js/mountDiscovery.js/serverFinder.js/templates.js/templateService.js; panelBridge.js (service files)/panelBridgeInstaller.js/panelBridgeSftp.js/rcon.js (service) (credential handling, connection leaks).

Not yet examined: server/services/scheduler.js, server/services/discordBot.js, server/services/backupService.js internals, server/services/remoteConfigFiles.js, server/services/serverManager.js, server/services/mountDiscovery.js, server/services/templateService.js, server/services/panelBridge.js, server/services/panelBridgeInstaller.js, server/services/panelBridgeSftp.js, server/services/rcon.js — these are covered by the delegated sub-hunts above; results pending.

---

## [MERGE NOTE] Two workers appear to be writing this same file concurrently

This file was overwritten (full `Write`, not append) between my read and my next edit, replacing an
earlier version of this doc that already contained two verified backup.js findings. Re-appending
those below rather than re-overwriting the file, to avoid losing either side's work. Flagged to god —
this looks like two "Creed"-named workers independently assigned the identical brief/scope and both
delegating to sub-agents against the same file path, which both duplicates work and risks silently
dropping findings on every overwrite. Recommend whichever of us god did NOT intend to keep stands down,
or we're given non-overlapping file lists.

---

## Finding 3 — cleanupOldBackups()/deleteBackupsOlderThan() delete uploaded backups despite a comment saying they won't

**WHERE:** `server/services/backupService.js:557-581` (`cleanupOldBackups`), also
`server/services/backupService.js:586-632` (`deleteBackupsOlderThan`), both driven by
`listBackups()` at `server/services/backupService.js:450-485`.

**WHAT HAPPENS:** `server/routes/backup.js:257-262` documents the upload feature's `uploaded-`
filename prefix with: *"external archives are visually separated from the panel's own scheduled
backups, and **never collide with them when the auto-prune logic looks for the oldest
panel-created backup to drop**."* That's not what the code does. `listBackups()` returns every
`*.zip` in the backups folder with no prefix filtering, sorted newest-first. `cleanupOldBackups()`
keeps the newest `maxBackups` (default 10, configurable 1-100) and deletes everything past that
cutoff — **including `uploaded-*.zip` files** — purely by recency, with no awareness of the
`uploaded-` prefix. `deleteBackupsOlderThan()` has the identical gap (age cutoff over the
unfiltered list).

**HOW I KNOW:** Read both functions end to end — neither contains any `startsWith("uploaded-")`
or equivalent check; `listBackups()` (the single source both draw from) filters only on
`f.endsWith(".zip")`. Concrete scenario: operator uploads a backup they specifically want kept
(e.g. before a risky mod install), `maxBackups` is at its default of 10, and the panel's own
6-hourly scheduled backups (`0 */6 * * *` default) produce 10 newer backups within 60 hours (2.5
days) — the very next scheduled backup after that pushes the uploaded one past the cutoff and
`cleanupOldBackups()` silently deletes it with only a `log.info` line, no user-facing warning.
Same outcome from `deleteBackupsOlderThan` if the uploaded backup is simply old enough.

**WHAT SHOULD HAPPEN:** Either the prune functions should exclude `uploaded-*` files (matching
what the comment already claims), or the comment should be corrected so operators don't rely on a
guarantee the code doesn't provide. The comment frames this as a deliberate design decision — this
reads as the accident-described-as-a-decision pattern: intent was written down, but the pruning
code doesn't implement it (or was written first and the comment added later without checking it).

**SEVERITY: High.** "Deleting a backup destroys the operator's safety net" — except here it's not
the operator doing the deleting, it's auto-prune silently doing it to the backup the operator
manually preserved, while a written comment tells them it can't happen.

---

## Finding 4 — GET /api/backup/download/:name has no backups.manage permission gate

**WHERE:** `server/routes/backup.js:159-185`.

**WHAT HAPPENS:** Every other mutating or content-revealing backup route requires
`requirePermission("backups.manage")` or `("backups.restore")`: `/:name/snapshot` (line 63),
`POST /settings` (76), `POST /create` (110), `DELETE /:name` (141), `POST /restore/:name` (192,
`backups.restore`), `POST /delete-older-than` (237), `POST /upload` (264). `GET /download/:name`
(159) has no `requirePermission(...)` at all — only the blanket `authService.middleware()` applied
to all of `/api/` in `server/index.js:639`, i.e. any authenticated user of any role can hit it.
Permissions here are capability-based per role (`server/services/permissions.js`), so a role can
legitimately be created that omits `backups.manage` — that role's users can still download the
full world-save archive, and if the operator ever created a backup with `includeDb` on, the
archive contains `db.json` (bcrypt password hashes and other settings — `server/database/init.js:
291-294` confirms JWT secret/RCON password/Discord+Steam credentials were moved to sibling files
specifically to keep them out of backups, but db.json itself "still holds bcrypt password hashes
and other settings that don't warrant world-readability").

**HOW I KNOW:** Read `server/routes/backup.js` top to bottom, diffed which routes carry
`requirePermission`; confirmed the mount point and global auth middleware in
`server/index.js:629-639`. Sharpest asymmetry: `/:name/snapshot` gates a much smaller disclosure
(just the JSON server-config snapshot) behind `backups.manage`, while `/download/:name` gates
nothing and hands out the entire archive.

**WHAT SHOULD HAPPEN:** `router.get("/download/:name", ...)` should require
`requirePermission("backups.manage")` like its siblings; nothing in the file suggests the gap is
intentional.

**SEVERITY: Medium-High.** Still requires a valid login, but it's a real break in the app's own
capability model: a role explicitly denied `backups.manage` can still exfiltrate full backup
contents, including bcrypt hashes when `includeDb` was ever used.

---

## Areas I checked clean (backup.js area)

- `server/services/backupRecords.js` — bounded (`MAX_RECORDS = 500`, sliced on every save), no
  unbounded-growth issue. Serialized mutation queue (`mutationChain`) looks race-safe for
  concurrent add/remove.
- `server/services/backupService.js` restore path (zip-slip protection, staging-then-rename swap,
  pre-restore backup, mutex via `restoreInProgress`/`backupInProgress`, rollback-on-swap-failure) —
  already heavily hardened per its own inline comments referencing a prior "backend audit" (B28).
  Traced the zip-slip check (`resolvedEntry.startsWith(resolvedParent)` with a trailing
  `path.sep` on the base) and it holds against both `../` traversal and embedded-drive-letter
  tricks on Windows path.join semantics. Did not find a bug in this path.
