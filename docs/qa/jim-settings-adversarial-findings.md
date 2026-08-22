# Jim's Adversarial Findings — Settings' Deeper Tabs

Assigned by god after the dead-else sweep: adversarial input on Settings tabs nobody had reached
(Kevin covered Scheduler/Chat/Players; the destructive-confirmation dialogs were my own earlier
pass). Traced end to end through actual source, not guessed from shape. Same priority order as
Kevin's brief: (1) input reaching something live, (2) accepted input that silently misbehaves,
(3) whether refusals are honest, (4) non-ASCII/long input.

---

## FINDING 1 (High): saving an HTTPS cert/key path or port with no validation crashes the ENTIRE panel process on the next restart — WHERE: `server/routes/config.js`'s `PUT /app-settings` (no validation for `httpsCertPath`/`httpsKeyPath`/`httpsPort`) + `server/utils/certs.js:211-223` (`loadOrCreateCerts`, unguarded `fs.readFileSync`) + `server/index.js:2695-2732` (HTTPS boot sequence, no local try/catch) + `server/index.js:138-145` (global `uncaughtException`/`unhandledRejection` → `fatalExit` → `process.exit(1)`)

**WHAT HAPPENS:** Settings → HTTPS tab lets an operator type a certificate path, a key path, and a
port, enable HTTPS, and click Save. None of the three fields are validated in any way before being
persisted — `PUT /app-settings` checks several other settings for shape (`lanIpAddress` must be a
valid IPv4, `corsAllowedOrigins` goes through `validateCorsAllowedOrigins`, several booleans are
type-checked) but `httpsCertPath`, `httpsKeyPath` and `httpsPort` are in `VALID_SETTINGS_KEYS` with
**zero** per-key validation — any string, including an empty one, a directory path, or garbage,
saves successfully with a 200 and a success toast.

HTTPS is only wired up once, at panel boot (`server/index.js:2689-2732`), which is why nothing goes
wrong immediately — the operator sees a normal save and moves on. The failure surfaces on the
**next restart**, arbitrarily later:

```js
const certs = loadOrCreateCerts(customKeyPath, customCertPath);   // server/index.js:2696
```
```js
// server/utils/certs.js:211-223
if (customKeyPath && customCertPath) {
  if (fs.existsSync(customKeyPath) && fs.existsSync(customCertPath)) {
    return { key: fs.readFileSync(customKeyPath), cert: fs.readFileSync(customCertPath) };
  } else {
    log.warn('...falling back to self-signed');   // the ONLY guarded failure mode
  }
}
```
The "file doesn't exist" case is genuinely handled — it falls back to a self-signed cert, exactly
as the fallback comment implies. But `fs.existsSync` returns true for a **directory** too, and
`fs.readFileSync` on a directory throws `EISDIR`. That throw isn't caught anywhere local to this
function, isn't caught by the caller at `index.js:2696` (no try/catch around the HTTPS block), and
isn't caught by `start()`'s own outer try (`index.js:2283`) catching it would just mean a graceful
per-startup failure — but `index.js:138-145` installs a **global** `uncaughtException`/
`unhandledRejection` handler that calls `fatalExit()` → `process.exit(1)` for anything that isn't
`EPIPE`. Whichever layer actually catches it, the outcome is identical: the whole Node process
exits. Not "HTTPS fails, HTTP still works" (which is what the self-signed-fallback code clearly
intends) — the panel is completely down, RCON control included, until someone with filesystem
access finds and reverts the setting.

**Second, independent trigger — the port, not just the path:** `httpsPort` gets the exact same
zero-validation treatment. `httpsServer.listen(httpsPort, callback)` (`index.js:2724`) has **no**
`.on('error', ...)` handler attached — contrast with `httpServer`'s own `.listen()` a few dozen
lines later, which does have one (EADDRINUSE handling, explicit `process.exit(1)` with a helpful
message telling the operator how to find the offending process). A `httpsPort` that collides with
the already-bound main port, or that isn't a valid port number at all (a non-numeric string sails
through — `(await getSetting("httpsPort")) || 3443` only guards against a *falsy* stored value, not
an invalid one), throws asynchronously on the unguarded socket, which is once again an uncaught
exception → the same global handler → the same full-process exit. The client's `type="number"`
input with `min="1024" max="65535"` is the only thing standing between an operator's keystroke and
this path, and it's trivially bypassed by anyone hitting `PUT /app-settings` directly (nothing
requires going through the rendered `<Input>`).

**HOW I KNOW (traced, not guessed):** read `loadOrCreateCerts` end to end — confirmed the
`fs.existsSync && fs.existsSync` guard has no try/catch around the two `fs.readFileSync` calls that
follow it, unlike the self-signed-generation branch a few lines below which explicitly wraps its
own `fs.writeFileSync` calls in try/catch specifically to return `null` gracefully instead of
throwing. Read `index.js`'s HTTPS block start-to-finish and confirmed no local try/catch wraps
`loadOrCreateCerts(...)` or `httpsServer.listen(...)`. Read `start()`'s outer try/catch (still just
logs and `process.exit(1)`, doesn't change the outcome) and the module-level
`uncaughtException`/`unhandledRejection` handlers (confirmed `fatalExit` unconditionally calls
`process.exit(1)` for anything except `EPIPE`). Read `config.js`'s entire `PUT /app-settings`
validation loop line by line and confirmed `httpsCertPath`/`httpsKeyPath`/`httpsPort` never appear
in any of the per-key `if (key === ...)` checks that exist for other settings in the same file, so
there is no server-side gate at all, independent of whatever the `<Input>` component's HTML
attributes suggest. Checked `docs/qa/` and `server/tests/` for any existing coverage of this path —
neither has anything.

**WHY THIS IS THE WORST KIND OF THIS BUG CLASS:** every other "accepted input that misbehaves"
finding tonight (mine or Kevin's) degrades a single feature or produces a wrong message. This one
takes the entire panel offline from a single Settings save, with no warning at save time, a delay
between cause and effect (fires on next restart, not immediately) that makes it hard to connect
back to the setting that caused it, and no self-healing (the panel doesn't come back up on its own
— an operator without shell/file access to revert `data/db.json`'s stored setting, or to disable
`httpsEnabled` some other way, is locked out of their own panel).

**WHAT SHOULD HAPPEN:** validate `httpsCertPath`/`httpsKeyPath` server-side at save time — confirm
each path, if non-empty, is an existing **regular file** (`fs.statSync(...).isFile()`, not just
`existsSync`) and is readable (a `fs.accessSync(path, fs.constants.R_OK)` try/catch), refusing the
save with a clear 400 otherwise so the operator finds out immediately instead of on next restart.
Validate `httpsPort` is an integer in the usable range and, ideally, not equal to the already-
configured main `panelPort`. Independently of validating on save (defense in depth, since a value
could still end up bad some other way — manual `db.json` edit, a future code path that writes
settings without going through this route): wrap the `loadOrCreateCerts(...)` call and the
`httpsServer.listen(...)` call (with its own `.on('error', ...)` handler, mirroring the main
server's) so a bad custom cert/key/port degrades to "HTTPS off, HTTP still serving, error logged"
rather than taking the whole process down. Both fixes are independently worth doing; the second one
is the one that actually closes the class, since save-time validation alone doesn't protect a value
that becomes bad after being saved (file deleted/moved later, permissions changed, etc).

**Severity: High.** Full, self-inflicted denial of service against the whole panel (not just
HTTPS), reachable by any account holding `panel.settings` (the same capability that already
guards this endpoint — so not a privilege escalation, but a fragility one keystroke away from a
role that's explicitly trusted with less scary settings elsewhere on the same page), silent at the
moment of the mistake, and with no in-panel recovery path once it fires.

---

## Chased and ruled out (recording so nobody re-spends time on these)

- **RCON `reconnectInterval` (Connection tab):** client caps 1-60 via the `<Input>`'s min/max, but
  like the HTTPS fields, nothing stops a direct `PUT /app-settings` call sending `0`, a negative
  number, or a huge one. Read where it's actually consumed (`autoReconnect` interval timer) — worst
  case is a reconnect loop that's too fast or effectively never fires, not a crash or an injection.
  Real gap, much lower stakes than Finding 1 — not writing it up as its own finding, noting it here
  instead of silently passing over it.
- **SFTP settings (Bridge tab: host/port/username/password/bridgePath/pollIntervalSeconds):**
  `POST /sftp/test` and `/sftp/configure` both wrap their work in try/catch returning a plain 400 on
  failure (`server/routes/panelBridge.js`) — a bad host/port/path fails the connection attempt
  gracefully at request time, not at panel-boot time, so there's no equivalent crash vector. Did not
  fuzz path-traversal on `bridgePath`/`logPath`/`configPath` to the same depth Finding 1 got; lower
  priority since the worst outcome I could find by reading is a failed SFTP connection, not process
  death or an unintended file read/write outside the panel's own control.
- **`corsAllowedOrigins` (General/Access area):** already gated through `validateCorsAllowedOrigins`
  with explicit length/count/format checks (5000 char total, 100 origins max, 256 chars each) — read
  it, no bypass found.

## Not reached

- **Access tab (users/roles), Security tab, Mods tab, Backups tab, Updates tab, About tab** — not
  adversarially tested this pass; time went into Finding 1 once it was clear it was real and how
  deep the "no local catch anywhere in the chain" problem went, rather than spreading thin across
  all ten tabs at shallow depth.
- **Live reproduction** — traced entirely from source (same boundary as Kevin's — no throwaway
  server stood up for this, task 2's court already ruled a live instance wasn't worth the collision
  risk for a smaller question than this one). If a live check is wanted: point `httpsCertPath` at
  any directory, enable HTTPS, save, restart the panel, watch it not come back.
