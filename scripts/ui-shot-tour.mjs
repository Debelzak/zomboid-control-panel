#!/usr/bin/env node
// ui-shot-tour.mjs — the standard way to look at what you just built.
//
// THE RULE THIS TOOL EXISTS TO SERVE (operator's own words): "when you build
// a new menu, take a screenshot and use impeccable to make the ui better."
// If you just shipped or changed a page, tab, or section: BUILD YOUR SCREEN,
// SHOOT IT, LOOK AT IT, FIX WHAT LOOKS WRONG, SHOOT IT AGAIN, THEN REPORT.
// That loop is the point -- everything below is just the plumbing for it.
// A rule that costs five minutes and a full-app build gets skipped because
// "this change is too small to bother." A rule that costs one command and
// ~30 seconds does not. That's why single-view mode below is the primary
// use of this script, not the full sweep -- reach for it mid-task, on the
// one screen you just built, not just as an end-of-night audit.
//
// USAGE
//   npm run ui:shot-tour                      # full sweep, every known view
//   npm run ui:shot-tour -- <name>             # ONE view -- the fast, primary path
//   npm run ui:shot-tour -- --list             # print every valid <name>
//
//   <name> is `page` or `page:tab`, matching this app's own routing/tabs --
//   e.g. `players` for the roster, `players:vitals` for the Vitals tab. Get
//   the name wrong (or leave it off with --list) and this prints the full
//   list instead of guessing -- see VIEWS below for the source of truth.
//
//   node scripts/ui-shot-tour.mjs [<name>] [--root <repoPath>] [--out <dir>] [--port <n>] [--keep-server]
//
//   --root   Repo to build/serve (must contain client/ and server/index.js).
//            Defaults to this script's own repo. Point this at a detached
//            git worktree to tour a specific commit without touching a
//            dirty working tree (`git worktree add --detach <path> <sha>`)
//            -- useful for an end-of-night full sweep when someone else's
//            change is mid-edit in the shared tree; not needed for the
//            normal single-view case of shooting your own clean checkout.
//   --out    Output directory for PNGs + manifest. Defaults to
//            <this repo>/.ui-tour/output (gitignored) -- NOT Screenshots/,
//            which is the tracked, hand-curated README gallery.
//   --port   Port for the throwaway server. Default 34917.
//   --keep-server   Don't kill the throwaway server on exit (debugging).
//
// WHAT THIS DOES (both modes)
//   1. Builds the client (`vite build`) against whatever repo root it's
//      pointed at (default: this script's own repo). Never `vite dev` --
//      a dev server's HMR would reload other in-flight edits mid-capture.
//   2. Spawns the REAL server (server/index.js) as a throwaway process: a
//      fresh temp data dir, a non-default port, and PANEL_NO_SUPERVISOR=1 --
//      it never touches this machine's real data/db.json or panel.lock. Its
//      demo server profile's RCON target is loopback port 1 (always closed)
//      on purpose -- see the comment in bootstrapAccount() for why that
//      specific port matters and what picking a "normal-looking" port
//      almost cost during this tool's own first run.
//   3. Creates a one-off admin account (via the real /api/auth/setup route,
//      using a per-run SETUP_TOKEN) and one demo server profile, so every
//      page renders its real authenticated content instead of a
//      login/setup screen.
//   4. Drives a real Chromium (Playwright) through the requested view(s) at
//      a desktop width and a narrow mobile width, in both themes -- one PNG
//      per view/viewport/theme combination.
//   5. Writes manifest.json + MANIFEST.md describing exactly what each file
//      shows, and tears the server + browser down.
//
// REQUIREMENTS
//   - `playwright` as a devDependency here (already added) with its
//     Chromium browser downloaded: `npx playwright install chromium`.
//   - Node with global fetch (Node 18+).
//   - Nothing else. No real Project Zomboid server, no real panel-bridge
//     mod connection, no auth setup ahead of time.
//
// A SETTLE CONDITION AND A RATE LIMITER COLLIDE (visual-sweep-2026-08-30,
// step 3) -- both are individually correct, and whoever next makes this
// tour dwell even longer per view needs to know why that can silently
// re-break the sweep. server/index.js:807 applies a real, production-
// necessary rate limit -- 300 req/min per IP, in scope for THAT file, not
// this one -- to every /api/ route, auth included. Once waitForSettle
// (below) started actually waiting for pages to finish loading instead of
// a blind fixed sleep, the run started spending more real time per view,
// which meant more of this tool's own polling/background-refresh requests
// landed inside any given rolling 60s window than before. Nothing about
// the settle condition or the limiter is wrong on its own; the combination
// crossed 300/min by the time a full sweep reached the settings tabs, worse
// on the mobile pass (runs second, inherits the first pass's window
// history). Fixed here, NOT in server/index.js -- that limiter is a
// production safety feature and out of scope to weaken for this tool's
// convenience. See paceForRateLimit below: it reads the RateLimit-Remaining
// / RateLimit-Reset headers express-rate-limit already sends
// (standardHeaders: true, draft-6) on every /api/ response and pauses for
// exactly as long as the server itself says is left, rather than a fixed
// guessed delay -- correct regardless of how many requests some future
// page or interact() step happens to fire.
//
// WHAT THIS DOES NOT COVER (be honest about the gap, don't fabricate)
//   - Modal/dialog content (e.g. Scheduler's "Add Task" dialog, confirm
//     dialogs) and multi-step wizards (ServerSetup's install steps beyond
//     its landing view) are not opened. Static top-level views and the
//     tabs/sections listed in VIEWS below are covered; deep interactive
//     flows are not.
//   - Real map tile imagery on World Map: /api/map/resolve is mocked (so
//     the coordinate system and player dossier/markers work), but actual
//     tile PNGs are not faked -- there's no real tile cache, so the canvas
//     will look empty/gray under the markers. That's an honest gap, not a
//     broken feature.
//   - PanelBridge-only live data (zombie count, weather, game time, player
//     vitals, vehicle list) has no live game server to source it from, so
//     those specific endpoints are mocked with realistic canned fixtures
//     (lifted from this repo's own component tests, e.g.
//     Dashboard.zombieWorldStats.test.tsx) purely so the new UI actually
//     renders populated instead of an empty "not connected" state. Every
//     other endpoint is answered by the real server -- most pages show
//     real (if data-less) server responses, not mocks.
//   - `server-finder` is a known crash risk, not a mocked one: loading it
//     makes a real outbound Steam master-server DNS lookup + UDP query
//     (server/routes/serverFinder.js), which has thrown a synchronous,
//     uncaught exception in this environment and killed the whole
//     throwaway server process. That's a real gap in that route's own
//     error handling, unrelated to this tool and out of scope to fix here
//     -- see the comment on its VIEWS entry below. It's kept LAST in the
//     sweep so a crash there costs only that one view.

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = path.resolve(__dirname, '..')

function parseArgs(argv) {
  const out = { root: DEFAULT_ROOT, out: null, port: 34917, keepServer: false, view: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--root') out.root = path.resolve(argv[++i])
    else if (a === '--out') out.out = path.resolve(argv[++i])
    else if (a === '--port') out.port = Number(argv[++i])
    else if (a === '--keep-server') out.keepServer = true
    else if (a === '--list' || a === '--help' || a === '-h') out.list = true
    else if (!a.startsWith('--')) out.view = a
  }
  if (!out.out) out.out = path.join(DEFAULT_ROOT, '.ui-tour', 'output')
  return out
}

const args = parseArgs(process.argv.slice(2))
const BASE_URL = `http://127.0.0.1:${args.port}`
const SETUP_TOKEN = `ui-tour-${Math.random().toString(16).slice(2)}`
const ADMIN_USER = 'tourop'
const ADMIN_PASS = 'UiTourPassw0rd!7'

function run(cmd, cmdArgs, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { cwd, stdio: 'inherit', shell: true })
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${cmdArgs.join(' ')} exited ${code}`))))
  })
}

async function waitForHealth(url, timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`)
      if (res.ok) return true
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`Server at ${url} did not become healthy within ${timeoutMs}ms`)
}

// ---------------------------------------------------------------------------
// Rate-limit pacing -- see the header comment above ("A SETTLE CONDITION AND
// A RATE LIMITER COLLIDE") for why this exists. Reads the RateLimit-Remaining
// / RateLimit-Reset headers express-rate-limit puts on every /api/ response
// (server/index.js:807, standardHeaders: true -> draft-6) instead of
// tracking or guessing a request count ourselves -- the server already knows
// the exact true answer, so asking it beats reconstructing an estimate that
// would need updating every time a page's own request count changes.
// ---------------------------------------------------------------------------
let rateLimitRemaining = null
let rateLimitResetSeconds = null

// A view's own page.goto + interact() can fire a burst of several requests
// before this script gets to check again, so pacing on "remaining === 0"
// would still let that burst tip the server over into a real 429 mid-view.
// Stopping with headroom to spare keeps the whole burst inside the limit.
const RATE_LIMIT_SAFE_FLOOR = 20

function trackRateLimitHeaders(response) {
  try {
    if (!response.url().includes('/api/')) return
    const headers = response.headers()
    if (headers['ratelimit-remaining'] !== undefined) rateLimitRemaining = Number(headers['ratelimit-remaining'])
    if (headers['ratelimit-reset'] !== undefined) rateLimitResetSeconds = Number(headers['ratelimit-reset'])
  } catch { /* response headers unavailable (e.g. request aborted) -- next response updates us */ }
}

async function paceForRateLimit() {
  if (rateLimitRemaining === null || rateLimitRemaining > RATE_LIMIT_SAFE_FLOOR) return
  const waitSeconds = Number.isFinite(rateLimitResetSeconds) && rateLimitResetSeconds > 0 ? rateLimitResetSeconds : 60
  const waitMs = waitSeconds * 1000 + 500 // past the server's own reported reset instant, not right up against it
  console.log(`[ui-shot-tour] pacing: only ${rateLimitRemaining} requests left in the server's rate-limit window (server/index.js's 300/min cap) -- waiting ${Math.ceil(waitMs / 1000)}s for it to reset`)
  await new Promise((r) => setTimeout(r, waitMs))
  rateLimitRemaining = null // unknown again until the next response tells us
}

async function buildClient(root) {
  const clientDir = path.join(root, 'client')
  if (!existsSync(path.join(root, 'node_modules'))) {
    console.log('[ui-shot-tour] installing root deps...')
    await run('npm', ['install', '--no-audit', '--no-fund'], root)
  }
  if (!existsSync(path.join(clientDir, 'node_modules'))) {
    console.log('[ui-shot-tour] installing client deps...')
    await run('npm', ['install', '--no-audit', '--no-fund'], clientDir)
  }
  console.log('[ui-shot-tour] building client...')
  await run('npm', ['run', 'build'], clientDir)
}

function spawnServer(root, dataRoot, port) {
  const configPath = path.join(dataRoot, 'paths.config.json')
  writeFileSync(configPath, JSON.stringify({
    dataDir: path.join(dataRoot, 'data'),
    logsDir: path.join(dataRoot, 'logs'),
  }, null, 2))

  const child = spawn('node', ['server/index.js'], {
    cwd: root,
    env: {
      ...process.env,
      PANEL_PATHS_CONFIG_PATH: configPath,
      PORT: String(port),
      SETUP_TOKEN,
      PANEL_NO_SUPERVISOR: '1',
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`))
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`))
  return child
}

async function bootstrapAccount(dataRoot) {
  const setupRes = await fetch(`${BASE_URL}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ setupToken: SETUP_TOKEN, username: ADMIN_USER, password: ADMIN_PASS, panelPort: 34917 }),
  })
  if (!setupRes.ok) throw new Error(`Admin setup failed: ${setupRes.status} ${await setupRes.text()}`)
  const { accessToken } = await setupRes.json()

  // rconHost/rconPort MUST NOT be able to reach anything real. 27015 is
  // Project Zomboid's actual default RCON port, and on a machine that also
  // runs a real panel instance, something can genuinely be listening there
  // -- this profile's first boot will open a real TCP connection and run a
  // real (if wrong-password, fail-closed) RCON auth handshake against
  // whatever answers. Port 1 is a privileged, essentially-never-open port on
  // loopback, so this fails fast with ECONNREFUSED instead of reaching a
  // live service. installPath/zomboidDataPath point inside this run's own
  // temp dataRoot for the same reason -- never a path that could resolve to
  // something real on the host.
  const serverRes = await fetch(`${BASE_URL}/api/servers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      name: 'Ashenwood', serverName: 'Ashenwood',
      installPath: path.join(dataRoot, 'pz-install'),
      zomboidDataPath: path.join(dataRoot, 'zomboid'),
      rconHost: '127.0.0.1', rconPort: 1,
      rconPassword: 'tourdemo', serverPort: 16261, minMemory: 2048, maxMemory: 4096, isActive: true,
    }),
  })
  if (!serverRes.ok) throw new Error(`Demo server creation failed: ${serverRes.status} ${await serverRes.text()}`)
}

// ---------------------------------------------------------------------------
// Fixtures for the handful of PanelBridge-only endpoints that need a live
// game server to answer for real. Shapes lifted directly from this repo's
// own component tests so they match what the UI actually expects:
//   Dashboard.zombieWorldStats.test.tsx, Events.liveWeatherReadback.test.tsx,
//   Events.timeSpeedReadback.test.tsx, Events.vehicleSirenControl.test.tsx,
//   Players.vitalsTab.test.tsx, WorldMap.dossierPlayerStats.test.tsx
// ---------------------------------------------------------------------------

const VEHICLE = { id: 7, scriptName: 'Base.PickUpVan', x: 100, y: 200, batteryCharge: 0.8, alarmed: false, sirening: false, trunkLocked: true }

const FIXTURES = {
  bridgeStatus: {
    configured: true, isRunning: true, modConnected: true,
    modStatus: { alive: true, version: '1.7.40', serverName: 'Ashenwood', playerCount: 1 },
  },
  zombieCount: { success: true, data: { zombieCount: 142, note: 'Count is for currently loaded cells only' } },
  worldStats: { success: true, data: { serverName: 'Ashenwood', map: 'Muldraugh, KY', zombiesInCell: 142 } },
  weather: {
    success: true,
    data: {
      temperature: 20, humidity: 0.5, windSpeed: 37, windAngle: 214,
      fogIntensity: 0, cloudIntensity: 0.4, precipitationIntensity: 0,
      isRaining: true, isSnowing: false, isThunderStorming: true,
      dayLight: 1, nightStrength: 0, desaturation: 0, viewDistance: 1, ambient: 1,
    },
  },
  gameTime: { success: true, data: { year: 1, month: 7, day: 9, hour: 12, minute: 30, dayOfWeek: 3, worldAgeHours: 120, moonPhase: 0.5, nightsSurvived: 5, multiplier: 10 } },
  serverInfo: { success: true, data: { players: [{ name: 'Kate', x: 10123, y: 9876, hunger: 0.62, thirst: 0.18, fatigue: 0.4 }] } },
  bridgePlayers: {
    success: true,
    data: {
      players: [{ username: 'Kate', displayName: 'Kate', x: 10123, y: 9876, z: 0, accessLevel: 'admin', isAlive: true, hunger: 0.62, thirst: 0.18, fatigue: 0.4, health: 85, isInfected: false }],
    },
  },
  playerDetails: {
    success: true,
    data: {
      x: 10123, y: 9876, z: 0, accessLevel: 'admin', isAsleep: false, isSneaking: false, isRunning: false,
      stats: { hunger: 0.62, thirst: 0.18, fatigue: 0.4, stress: 5, boredom: 0.3, unhappiness: 0.05, pain: 0, endurance: 0.8 },
      health: { overallBodyHealth: 85, isInfected: true, isBleeding: false, temperature: 37, wetness: 0.2 },
    },
  },
  players: { players: [{ name: 'Kate', online: true }] },
  mapResolve: { root: '/tiles', b42Dir: 'b42', b41Path: '/tiles/b41', tileSize: 1024, width: 1157312, height: 509520, maxLevel: 21, renderedMaxLevel: 10 },
  mapVehicles: { vehicles: [{ id: 7, x: 100, y: 200 }] },
}

function json(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) }
}

async function installFixtureRoutes(context) {
  await context.route('**/api/panel-bridge/status', (route) => route.fulfill(json(FIXTURES.bridgeStatus)))
  await context.route('**/api/panel-bridge/zombies/count', (route) => route.fulfill(json(FIXTURES.zombieCount)))
  await context.route('**/api/panel-bridge/world/stats', (route) => route.fulfill(json(FIXTURES.worldStats)))
  await context.route('**/api/panel-bridge/weather', (route) => route.fulfill(json(FIXTURES.weather)))
  await context.route('**/api/panel-bridge/time', (route) => route.fulfill(json(FIXTURES.gameTime)))
  await context.route('**/api/panel-bridge/server-info', (route) => route.fulfill(json(FIXTURES.serverInfo)))
  await context.route('**/api/panel-bridge/players', (route) => route.fulfill(json(FIXTURES.bridgePlayers)))
  await context.route('**/api/panel-bridge/players/*', (route) => route.fulfill(json(FIXTURES.playerDetails)))
  await context.route('**/api/players', (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    return route.fulfill(json(FIXTURES.players))
  })
  await context.route('**/api/map/resolve', (route) => route.fulfill(json(FIXTURES.mapResolve)))
  await context.route('**/api/map/vehicles', (route) => route.fulfill(json(FIXTURES.mapVehicles)))
  await context.route('**/api/panel-bridge/command', async (route) => {
    const req = route.request()
    let action = null
    try { action = JSON.parse(req.postData() || '{}').action } catch { /* ignore */ }
    if (action === 'getVehiclesDetailed') {
      return route.fulfill(json({ success: true, data: { vehicles: [VEHICLE] } }))
    }
    return route.fulfill(json({ success: true, data: { verified: 'confirmed' } }))
  })
}

// ---------------------------------------------------------------------------
// Views to capture. Each has a unique `name` (used in the filename), a
// `path`, and an optional `interact(page)` run once the route has loaded
// (used for in-page tabs/sections that aren't separate routes).
// ---------------------------------------------------------------------------

// View names are addressable as `page` or `page:tab`, matching this app's
// own routing/tab vocabulary rather than an invented scheme -- e.g.
// `players:vitals` for the Vitals tab on the player dossier. Run
// `npm run ui:shot-tour -- <name>` for one view, or with no name for the
// full sweep (see parseArgs/printViewList below).

const SETTINGS_TABS = ['updates', 'https', 'access', 'security', 'users', 'roles', 'sso', 'connection', 'bridge', 'mods', 'backups', 'about']

const DEBUG_TABS = [
  { value: 'worldmap', label: 'World Map' },
  { value: 'bridge', label: 'PanelBridge' },
  { value: 'performance', label: 'Performance' },
  { value: 'activity', label: 'Activity' },
  { value: 'logs', label: 'Logs' },
  { value: 'crashes', label: 'Crashes' },
  { value: 'health', label: 'Health' },
  { value: 'system', label: 'Environment' },
]

const PLAYER_DOSSIER_TABS = [
  { label: 'Moderation', slug: 'moderation' },
  { label: 'Vitals', slug: 'vitals' },
  { label: 'Spawn', slug: 'spawn' },
  { label: 'Powers', slug: 'powers' },
  { label: 'Notes & Log', slug: 'notes' },
]

async function clickTabByRole(page, name) {
  // Short timeout: a wrong/stale label should fail this one view in a few
  // seconds, not burn the default 30s per occurrence -- especially in
  // single-view mode, where that 30s is most of the "fast path" budget.
  const tab = page.getByRole('tab', { name, exact: false })
  await tab.first().click({ timeout: 5000 })
  await page.waitForTimeout(200)
}

async function selectFirstPlayer(page) {
  await page.getByText('Kate', { exact: true }).first().click().catch(() => {})
  await page.waitForTimeout(300)
}

const VIEWS = [
  { name: 'dashboard', path: '/' },
  { name: 'players', path: '/players' },
  ...PLAYER_DOSSIER_TABS.map(({ label, slug }) => ({
    name: `players:${slug}`,
    path: '/players',
    interact: async (page) => {
      await selectFirstPlayer(page)
      await clickTabByRole(page, label)
    },
  })),
  // killplayer-ui-2026-08-30: a targeted, named exception to the "modal/
  // dialog content... not opened" gap documented above -- the typed-confirm
  // dialog on Kill IS the new UI surface for that card, and there is no way
  // to eyeball a typed-input's REST/WRONG/MATCHING states other than opening
  // it. Kept as its own addressable view (not folded into `players:powers`)
  // so the base Powers-tab shot stays a plain, fast, no-side-effect capture.
  {
    name: 'players:powers-kill-confirm',
    path: '/players',
    dialogExpected: true, // see waitForSettle/dismissOpenDialogs -- this is the
    // one view in the whole sweep whose entire point is an open dialog at
    // capture time, so the generic leaked-overlay defense must not close it
    // before the shot (it still gets swept up afterward like every other
    // view's dialog would, so it can't leak forward into whatever runs next).
    interact: async (page) => {
      await selectFirstPlayer(page)
      await clickTabByRole(page, 'Powers')
      await page.getByRole('button', { name: 'Kill' }).click({ timeout: 5000 }).catch(() => {})
      await page.waitForTimeout(300)
    },
  },
  { name: 'console', path: '/console' },
  { name: 'chat', path: '/chat' },
  { name: 'events', path: '/events' },
  {
    name: 'events:climate-trim',
    path: '/events',
    interact: async (page) => {
      // role=button, not getByText -- see the events:vehicles comment below
      // for why a plain text match on this sidebar is unreliable here.
      await page.getByRole('button', { name: 'Climate trim' }).click().catch(() => {})
      await page.waitForTimeout(400)
    },
  },
  {
    name: 'events:time-speed',
    path: '/events',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Time speed' }).click().catch(() => {})
      await page.waitForTimeout(400)
    },
  },
  {
    name: 'events:severe',
    path: '/events',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Severe weather' }).click().catch(() => {})
      await page.waitForTimeout(400)
    },
  },
  {
    name: 'events:horde',
    path: '/events',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Spawn horde' }).click().catch(() => {})
      await page.waitForTimeout(400)
    },
  },
  {
    name: 'events:vehicles',
    path: '/events',
    interact: async (page) => {
      // A plain getByText('Bridge tools') is ambiguous and picks the WRONG
      // match: the page's own header description literally reads "Weather,
      // time, sounds, player actions, and bridge tools" and sorts first in
      // DOM order, so .first() silently clicks inert paragraph text and the
      // nav selection never changes -- no error, just the wrong (default)
      // panel in the screenshot. The real nav item is a <button>, so scope
      // to role=button to skip the false match entirely.
      await page.getByRole('button', { name: 'Bridge tools' }).click().catch(() => {})
      await page.waitForTimeout(300)
      // This is a Radix Select (a button with role="combobox" plus a
      // separate popover listbox), not a native <select> -- selectOption()
      // only works on a real <select> element and just hangs here waiting
      // for one that doesn't exist. Drive it the way a real user would:
      // open the trigger, then click the option by its rendered label.
      const trigger = page.getByRole('combobox', { name: 'Select operation' })
      if (await trigger.count()) {
        await trigger.click().catch(() => {})
        await page.getByRole('option', { name: 'List Vehicles', exact: false }).click().catch(() => {})
        await page.waitForTimeout(200)
        await page.getByRole('button', { name: 'Run Operation' }).click().catch(() => {})
        await page.waitForTimeout(500)
      }
    },
  },
  { name: 'world-map', path: '/world-map' },
  {
    name: 'world-map:dossier',
    path: '/world-map',
    interact: async (page) => {
      await page.waitForTimeout(500)
      const panButton = page.getByRole('button', { name: /pan to kate/i })
      if (await panButton.count()) {
        await panButton.first().click().catch(() => {})
        await page.waitForTimeout(400)
      }
    },
  },
  { name: 'server-config', path: '/server-config' },
  { name: 'mods', path: '/mods' },
  { name: 'templates', path: '/templates' },
  { name: 'scheduler', path: '/scheduler' },
  { name: 'backups', path: '/backups' },
  { name: 'chunks', path: '/chunks' },
  { name: 'servers', path: '/servers' },
  // remote-bridge-discoverability-2026-08-30: the Add Remote Server dialog's
  // RCON-only banner used to claim weather/events worked over plain RCON --
  // they don't, PanelBridge needs the SFTP bridge configured first. Kept
  // addressable so the corrected copy (and any future wording pass on it)
  // stays easy to eyeball without adding a real remote server end to end.
  {
    name: 'servers:add-remote',
    path: '/servers',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Add Remote Server' }).first().click()
      await page.waitForTimeout(300)
    },
  },
  // Confirms "Configure SFTP Bridge" (Servers.tsx ~1957, gated on
  // server.isRemote) actually renders on a freshly-added remote server's own
  // card -- the affordance the corrected banner above now points to. Fake
  // RCON details are fine here: Add Server only requires
  // name/rconHost/rconPassword to be present, not a successful Test
  // Connection, and this throwaway server has no real RCON target anyway.
  {
    name: 'servers:remote-card',
    path: '/servers',
    interact: async (page) => {
      await page.getByRole('button', { name: 'Add Remote Server' }).first().click()
      const dialog = page.getByRole('dialog')
      await dialog.getByPlaceholder('My Remote PZ Server').fill('Tour Remote Server')
      await dialog.getByPlaceholder('192.168.1.100 or myserver.com').fill('192.168.1.50')
      await dialog.getByPlaceholder("Enter the RCON password set in the server's INI file").fill('tourdemo')
      await dialog.getByRole('button', { name: 'Add Server', exact: true }).click()
      await page.waitForTimeout(3000)
    },
  },
  { name: 'server-setup', path: '/server-setup' },
  { name: 'discord', path: '/discord' },
  { name: 'settings', path: '/settings' },
  ...SETTINGS_TABS.map((tab) => ({ name: `settings:${tab}`, path: `/settings?tab=${tab}` })),
  { name: 'debug', path: '/debug' },
  ...DEBUG_TABS.map(({ value, label }) => ({
    name: `debug:${value}`,
    path: '/debug',
    interact: async (page) => { await clickTabByRole(page, label) },
  })),
  // EXCLUDED from the default full sweep -- see `unstable` below.
  { name: 'server-finder', path: '/server-finder', unstable: true },
]

// server-finder makes a real outbound Steam master-server DNS lookup + UDP
// query (server/routes/serverFinder.js queryMasterServer()). Confirmed the
// hard way, TWICE, that this can throw a synchronous, uncaught exception
// from inside socket.send() (observed: "RangeError [ERR_SOCKET_BAD_PORT]")
// that Node treats as fatal and kills the WHOLE throwaway server process --
// not intermittently rare either: it survived one call in testing and
// crashed on the very next one a few seconds later, taking every
// remaining view in the sweep down with it (92 of 184 lost in one run).
// That looks like a real gap in serverFinder.js's own error handling (a
// synchronous throw from a dgram callback escapes both its Promise
// executor and its 'error' listener) -- independent of this tool, and out
// of scope to fix here. Rather than gamble the whole baseline on it,
// `unstable` views are skipped by the default (no-argument) full sweep;
// capture one deliberately with `npm run ui:shot-tour -- server-finder`
// (single-view mode also isolates the blast radius to that one run).
const VIEW_NAMES = VIEWS.map((v) => v.name)
const SWEEP_VIEWS = VIEWS.filter((v) => !v.unstable)

function printViewList() {
  console.log('Valid view names (use `page` for the top-level view, `page:tab` for a specific tab):\n')
  console.log(VIEW_NAMES.map((n) => `  ${n}`).join('\n'))
  console.log(`\nUsage:\n  npm run ui:shot-tour                 # capture every view above\n  npm run ui:shot-tour -- <name>       # capture just one, e.g. players:vitals`)
}

const VIEWPORTS = [
  { key: 'desktop', width: 1440, height: 900 },
  { key: 'mobile', width: 390, height: 844 },
]
const THEMES = ['survival', 'light']

async function login(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await page.getByLabel(/username/i).fill(ADMIN_USER).catch(async () => {
    await page.locator('input[name="username"], input#username').first().fill(ADMIN_USER)
  })
  await page.getByLabel(/password/i).fill(ADMIN_PASS).catch(async () => {
    await page.locator('input[name="password"], input#password, input[type="password"]').first().fill(ADMIN_PASS)
  })
  await page.getByRole('button', { name: /sign in|log in|login/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(500)
}

// wired-no-ui-2026-08-30 mobile-shot follow-up: page.screenshot({fullPage:
// true}) only expands to the OUTER page's own document bounds -- it has no
// way to know a page's real scrolling happens inside a nested overflow:auto
// element instead. This app's shell (client/src/components/Layout.tsx) puts
// EVERY page's content inside a single `<main id="main-content"
// class="... overflow-auto ...">`, and that element -- not <body> or
// <html> -- is the actual scroll container on every route. The tell, if you
// hit this again on some other app: document.body.scrollHeight equals
// window.innerHeight (the document itself never scrolls) while some
// descendant's own scrollHeight is much larger than its clientHeight.
// Confirmed the hard way on events:climate-trim at 390x844: the selected
// panel's own heading was already in the DOM at getBoundingClientRect().
// top=1164 -- past the fold -- before touching anything; setting
// mainEl.scrollTop = mainEl.scrollHeight (what a real scroll gesture does)
// moved it to top=147, fully visible, with the real content ("fog") now in
// document.body.innerText. The panel was never missing -- fullPage just
// never scrolled the container that actually holds it, on EVERY view this
// tool has ever captured on mobile, not just Events.
//
// Fix: immediately before the screenshot, override #main-content's overflow
// and height with inline styles so its content flows naturally into the
// page instead of scrolling inside its own box -- the outer document then
// grows to include all of it, which is exactly what fullPage needs. Restore
// the original inline style right after so the live page (and the next
// interact() step, if any) is untouched. Harmless when the container
// doesn't overflow: same content, same layout, just no scrollbar for an
// instant. Applied to every capture (both viewports), not just mobile --
// desktop pages fit today, but there's no guarantee that stays true, and
// this costs nothing when there's nothing to expand.
//
// mobile-full-pass-2026-08-30 follow-up -- the fix above has a WIDTH side
// effect that produced a false-positive "renders at desktop width" on every
// settings:* view, including settings:about, which has no fixed-width
// content of its own. #main-content is `flex-1` inside Layout.tsx's flex
// shell; with its normal `overflow-auto`, any value other than 'visible' on
// overflow-x/overflow-y resets that axis's *automatic minimum size* to 0,
// which is what lets a flex item shrink below its content's intrinsic
// (min-content) width in the first place. Flipping the whole `overflow`
// shorthand to 'visible' resets BOTH axes' automatic minimum size back to
// content-based -- so if any view has a horizontally-scrolling descendant
// with its own (perfectly correct) `overflow-x-auto` -- Settings' tab strip,
// 13 buttons wide, ~1280px unwrapped -- #main-content's own automatic
// min-width becomes that descendant's full min-content width, and the flex
// layout genuinely grows the box to 1280px. That's not a paint artifact:
// scrollWidth/clientWidth on #main-content itself become 1280 the instant
// this runs, so fullPage faithfully (and wrongly) captures a 1280px-wide
// mobile screenshot for a page a real 390px-viewport user never sees wider
// than 390px.
//
// The obvious-looking fix -- set only `overflow-y: visible`, leave
// overflow-x untouched -- does NOT work; verified empirically, not assumed.
// Per the CSS Overflow spec, if overflow-x and overflow-y disagree and
// exactly one of them is 'visible', the 'visible' one is *computed as
// 'auto'* instead. So `overflow-y: visible` next to an unset overflow-x
// (still 'auto' from the Tailwind class) silently becomes `overflow-y:
// auto` -- no different from doing nothing -- and the original vertical
// truncation comes right back (confirmed: docScrollHeight stayed pinned to
// the viewport height instead of growing to the real content height).
//
// What actually works: capture #main-content's current (correct, clipped)
// width BEFORE touching overflow, then pin it back with an explicit inline
// `width` at the same time overflow flips to 'visible'. An explicit width
// overrides the flex algorithm's content-based sizing outright, so the box
// can no longer grow to fit a wide descendant's min-content -- while height
// is still `auto`/`max-height: none` with overflow fully 'visible', so
// vertical content still flows out into the document exactly as before.
// Verified on both known repro cases: events:climate-trim (390x844) still
// reveals its full height (844 -> 1861), and settings:mods no longer
// balloons in either dimension (stays 390 wide; height now correctly
// reflects true 390px-wide wrapping -- 3236, MORE accurate than the old
// buggy capture's 2546, which undercounted height too because reflowing
// text into a false 1280px-wide box also shortens it).
async function expandMainForCapture(page) {
  return page.evaluate(() => {
    const el = document.getElementById('main-content')
    if (!el) return null
    const prevStyle = el.getAttribute('style')
    const width = el.getBoundingClientRect().width
    el.style.setProperty('width', `${width}px`, 'important')
    el.style.setProperty('overflow', 'visible', 'important')
    el.style.setProperty('height', 'auto', 'important')
    el.style.setProperty('max-height', 'none', 'important')
    return prevStyle
  })
}

async function restoreMainAfterCapture(page, prevStyle) {
  await page.evaluate((saved) => {
    const el = document.getElementById('main-content')
    if (!el) return
    if (saved === null || saved === undefined) el.removeAttribute('style')
    else el.setAttribute('style', saved)
  }, prevStyle)
}

// visual-sweep-2026-08-30 follow-up: the tour used to capture after a fixed
// wait with no idea whether the page had actually finished loading. That
// missed a real failure mode -- a page that fires SEVERAL parallel mount
// fetches can be briefly interactive-looking between two of them (one
// spinner has already unmounted, the next hasn't mounted yet), so even a
// generous fixed sleep can land in that gap and capture something that
// LOOKS settled but isn't. Confirmed the hard way on this exact bug:
// Scheduler.tsx fires five API calls on mount and came out as a bare
// spinner in all four viewport/theme combos, which every reviewer
// (correctly) read as "identical across combos = not a timing race" --
// backwards. A fixed sleep against a fixed fetch produces the same wrong
// result every time; reproducibility distinguishes a race from a flake, not
// a bug from a too-short wait. god verified Scheduler.tsx:226 and
// Templates.tsx:48 both clear their loading flag from a `finally` (runs on
// success AND failure) and that a real failure path renders a distinct
// error alert -- absent from the shots -- before asking for this fix, so
// the pages themselves were never in question, only this script's timing.
//
// Three independent signals (a third, the page-enter CSS fade, was added
// after the first two shipped -- see its own inline comment below), chosen
// from what's ALREADY a real, load-bearing convention in this codebase
// rather than invented for this script:
//   - `[aria-busy="true"]` -- PageSkeleton (components/PageSkeleton.tsx)
//     puts this on its wrapping element for every one of its variants
//     (dashboard/list/form/console/map/default), and it's what a whole-page
//     initial-load skeleton looks like across this app.
//   - `.animate-spin` -- the Loader2/RefreshCw spinner icon used for every
//     in-flight async action this script's own grep could find (initial
//     loads, saves, refreshes, restores). Verified this actually matches
//     Scheduler's own spinner (`<Loader2 className="w-8 h-8 animate-spin
//     .../>`  at initialLoading) and Templates' (same pattern) before
//     relying on it.
// Deliberately NOT `.animate-pulse` alone -- Skeleton's own primitive uses
// it (components/ui/skeleton.tsx), but so does a live-connection status dot
// used as PERMANENT decor on Chat/Console/Events/WorldMap/Players/
// ServerConfig (a pulsing "connected" indicator that is never meant to
// stop). A bare `.animate-pulse` selector would never settle on any of
// those pages even once fully loaded. `aria-busy` already covers the one
// place Skeleton's animate-pulse actually signals "still loading" (the
// PageSkeleton wrapper), without inheriting its false positives.
//
// Requires the busy/spin signal to be ABSENT continuously for `quietMs`,
// not just absent at one poll -- a single instantaneous check is exactly
// what would fall into the gap between two parallel fetches described
// above. Polls rather than a single `waitForFunction` so the quiet window
// is actually re-verified, not just "was true once."
async function waitForSettle(page, { timeoutMs = 8000, quietMs = 500, pollMs = 150 } = {}) {
  const start = Date.now()
  let quietSince = null
  while (Date.now() - start < timeoutMs) {
    const busy = await page
      .evaluate(() => {
        if (document.querySelector('[aria-busy="true"], .animate-spin')) return true
        // A THIRD tour-only artifact, found while chasing down the dimming
        // reported in three lanes as a leaked dialog: `.page-transition`
        // (index.css) plays a 0.3s opacity 0->1 `pageEnter` fade on mount,
        // applied on nearly every page's own root div. Real users never
        // notice a 300ms fade; a screenshot taken mid-fade freezes it as a
        // permanently washed-out page. This reproduced specifically on the
        // FIRST authenticated view of a session (cold JIT/paint/font costs
        // push the fade's start later than a warm navigation's), which is
        // exactly the position-1-only pattern this repo's own settings
        // capture showed even after the leaked-dialog fix below found zero
        // stray dialogs -- ruling out AlertDialogOverlay's `bg-background/78`
        // scrim as the (only) explanation for that specific case. Waited
        // out via the Web Animations API rather than a fixed extra sleep,
        // for the same reason the busy/spin check above polls instead of
        // guessing a duration: an animation genuinely still running is a
        // fact, not an estimate.
        const transitioning = document.querySelector('.page-transition')
        if (transitioning?.getAnimations().some((a) => a.playState === 'running')) return true
        return false
      })
      .catch(() => false) // page mid-navigation/crashed -- treat as not-busy, let the outer timeout/catch handle it
    if (busy) {
      quietSince = null
    } else {
      if (quietSince === null) quietSince = Date.now()
      if (Date.now() - quietSince >= quietMs) return true
    }
    await page.waitForTimeout(pollMs)
  }
  return false
}

// visual-sweep-2026-08-30 defect 2: three agents independently reported a
// dimmed/washed-out capture in three unrelated lanes (players, events,
// discord), each reading it as a bug in their own page. god's diagnosis,
// proven by ORDER rather than guessed: within one page's run of sub-views
// (e.g. players -> moderation -> vitals -> spawn -> powers -> notes ->
// kill-confirm), the dimming starts at some position and never recovers --
// a real page bug follows the PAGE, this followed the ORDINAL POSITION.
// This script never pressed Escape or closed a dialog anywhere, and a
// Radix Dialog/AlertDialog's Overlay+Content are portaled onto
// document.body -- outside whatever DOM subtree a client-side tab switch
// replaces -- so once something opens one, it can silently outlive
// everything after it in the same browser tab, across routes, not just
// sub-views. Ruled out as a REAL (non-tour) bug before writing this fix,
// not assumed: grepped for the actual banner behind the one confirmed
// correlation (a disk-space warning showing up alongside the scrim in
// several lanes) -- SystemHealthBanner.tsx renders a plain non-portaled
// <div>, no overlay, no z-index, no backdrop, so it cannot be the source
// for a real user either. The correlation was two symptoms of the same
// stale session, not one causing the other.
//
// Every Dialog/AlertDialog Content in this codebase (ui/dialog.tsx,
// ui/alert-dialog.tsx) is Radix's own primitive with no onEscapeKeyDown
// override that blocks it, so Escape is a safe, generic dismissal that
// doesn't need to know which specific dialog might be open -- this fix
// doesn't need to find (and isn't trying to find) whichever page actually
// leaves one open; it makes the TOUR immune regardless of which page does.
async function detectOpenDialog(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[role="dialog"], [role="alertdialog"]')
    if (!el) return null
    const label =
      el.getAttribute('aria-label') ||
      el.querySelector('h1, h2, [id$="title" i]')?.textContent ||
      el.textContent?.slice(0, 60) ||
      '(unlabeled dialog)'
    return label.trim()
  })
}

async function dismissOpenDialogs(page, { maxAttempts = 3 } = {}) {
  for (let i = 0; i < maxAttempts; i++) {
    const open = await detectOpenDialog(page)
    if (!open) return null
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(200)
  }
  return detectOpenDialog(page) // still non-null after every attempt -- genuinely stuck
}

async function setTheme(page, theme) {
  await page.evaluate((t) => localStorage.setItem('pz-panel-theme', t), theme)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(300)
}

async function main() {
  if (args.list) {
    printViewList()
    return
  }

  let targetViews = SWEEP_VIEWS
  if (args.view) {
    const match = VIEWS.find((v) => v.name === args.view)
    if (!match) {
      console.error(`Unknown view "${args.view}".\n`)
      printViewList()
      process.exitCode = 1
      return
    }
    targetViews = [match]
  } else {
    const skipped = VIEWS.length - SWEEP_VIEWS.length
    if (skipped) console.log(`[ui-shot-tour] skipping ${skipped} unstable view(s) in the default sweep (see the VIEWS comment) -- capture by name explicitly if you need one`)
  }

  console.log(`[ui-shot-tour] root=${args.root} out=${args.out} port=${args.port} views=${args.view || `all (${VIEWS.length})`}`)
  mkdirSync(args.out, { recursive: true })

  await buildClient(args.root)

  const dataRoot = mkdtempSync(path.join(tmpdir(), 'ui-shot-tour-'))
  mkdirSync(path.join(dataRoot, 'data'), { recursive: true })
  mkdirSync(path.join(dataRoot, 'logs'), { recursive: true })

  const server = spawnServer(args.root, dataRoot, args.port)
  const manifest = []
  let browser = null

  try {
    await waitForHealth(BASE_URL)
    await bootstrapAccount(dataRoot)

    browser = await chromium.launch()
    const context = await browser.newContext({ viewport: VIEWPORTS[0] })
    await installFixtureRoutes(context)
    context.on('response', trackRateLimitHeaders)
    const page = await context.newPage()
    await login(page)

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      for (const theme of THEMES) {
        try {
          await paceForRateLimit()
          await setTheme(page, theme)
        } catch (err) {
          // Most likely the throwaway server itself died mid-run (a page
          // triggered a real, uncaught server-side crash -- confirmed once:
          // loading /server-finder crashes server/routes/serverFinder.js
          // with ERR_SOCKET_BAD_PORT in its dgram query, and Node's default
          // behavior for an uncaught exception is to exit the process).
          // Record it and move on rather than losing every remaining view
          // (and the manifest) to one uncaught rejection -- see the
          // top-level catch below for why the manifest write must survive
          // this either way.
          console.error(`[ui-shot-tour] setTheme failed for ${theme} (${viewport.key}) -- server may have died: ${err.message}`)
          for (const view of targetViews) {
            manifest.push({ file: null, view: view.name, path: view.path, viewport: viewport.key, theme, error: `setTheme failed, likely server crash: ${err.message}` })
          }
          continue
        }
        for (const view of targetViews) {
          try {
            // NOT waitUntil:'networkidle' -- this app holds a live
            // Socket.IO connection open from the moment it authenticates,
            // so "0 network connections for 500ms" never happens and every
            // goto would just eat its full timeout. Real fetches against
            // this throwaway server are still all localhost round-trips
            // (fast), but a heavy page firing many of them in parallel
            // (Dashboard: ~17) can still be mid-fetch after a short fixed
            // wait -- confirmed the hard way: an earlier run with a 400ms
            // wait captured Dashboard's "Establishing link…" loading state
            // instead of the real tile grid. 1200ms covers that
            // comfortably; the loading-text wait below is an extra,
            // bounded safety net for any page that takes longer.
            await paceForRateLimit()
            await page.goto(`${BASE_URL}${view.path}`, { waitUntil: 'domcontentloaded' })
            await page.waitForTimeout(1200)
            await page.waitForFunction(
              () => !document.body.innerText.includes('Establishing link'),
              { timeout: 4000 },
            ).catch(() => {})
            if (view.interact) await view.interact(page)
            // Real settle condition (see waitForSettle's own header) instead
            // of a bare fixed sleep -- `settled` records whether it actually
            // cleared or timed out still busy, so a capture that never
            // finished loading says so in the manifest instead of silently
            // passing as an ordinary success.
            const settled = await waitForSettle(page)
            // Leaked-overlay defense (see dismissOpenDialogs' own header):
            // any view NOT deliberately capturing an open dialog gets one
            // dismissed before the shot, and `strayOverlay` records the
            // dialog's own label when three Escape presses couldn't close
            // it -- a genuinely stuck dialog, not a false alarm from this
            // check misfiring on a view that wants one open.
            const strayOverlay = view.dialogExpected ? null : await dismissOpenDialogs(page)
            // `:` is a reserved path character on Windows (NTFS Alternate
            // Data Stream syntax, `base:stream`) -- a filename built
            // straight from an addressable name like `players:vitals` does
            // NOT error, it silently writes into a hidden stream on a file
            // literally named `players`, and every tab of the same page
            // collides into streams on that one file. Confirmed the hard
            // way: this tool's own first full-sweep run "captured" every
            // `page:tab` view with no error, but only the colon-free base
            // views existed as real, visible PNGs afterward. `-` is not
            // reserved on Windows or POSIX, so the addressable name (used
            // for the CLI and the manifest's `view` field) and the on-disk
            // filename now deliberately differ.
            const fileName = `${view.name.replace(/:/g, '-')}__${viewport.key}__${theme}.png`
            const filePath = path.join(args.out, fileName)
            const prevMainStyle = await expandMainForCapture(page)
            await page.screenshot({ path: filePath, fullPage: true })
            await restoreMainAfterCapture(page, prevMainStyle)
            // Unconditional cleanup, even for a `dialogExpected` view whose
            // own dialog was deliberately left open for the shot just taken
            // -- this is the half of the fix that actually stops a leak
            // reaching the NEXT view, as opposed to the check above, which
            // only asserts one didn't already leak in from the last one.
            await dismissOpenDialogs(page)
            manifest.push({ file: fileName, view: view.name, path: view.path, viewport: viewport.key, theme, width: viewport.width, height: viewport.height, settled, strayOverlay })
            const flags = [
              settled ? '' : ' -- NOT SETTLED (spinner/skeleton still present after timeout)',
              strayOverlay ? ` -- STRAY OVERLAY LEAKED IN ("${strayOverlay}")` : '',
            ].join('')
            console.log(`[ui-shot-tour] captured ${fileName}${flags}`)
          } catch (err) {
            console.error(`[ui-shot-tour] FAILED ${view.name} (${viewport.key}/${theme}): ${err.message}`)
            manifest.push({ file: null, view: view.name, path: view.path, viewport: viewport.key, theme, error: err.message })
          }
        }
      }
    }

  } catch (err) {
    // A fatal, unrecovered error (server bootstrap failed, browser crashed,
    // etc.) must still fall through to writing whatever the manifest
    // already has -- losing the manifest on top of losing the rest of the
    // run is strictly worse, and gives no record of what succeeded before
    // the failure.
    console.error('[ui-shot-tour] fatal during capture, writing partial manifest:', err.message)
    manifest.push({ file: null, view: '(fatal)', path: null, viewport: null, theme: null, error: err.message })
  } finally {
    await browser?.close().catch(() => {})
    if (!args.keepServer) {
      server.kill()
    } else {
      console.log(`[ui-shot-tour] --keep-server: leaving server up at ${BASE_URL} (pid ${server.pid})`)
    }
    rmSync(dataRoot, { recursive: true, force: true })
  }

  writeFileSync(path.join(args.out, 'manifest.json'), JSON.stringify(manifest, null, 2))
  const okCount = manifest.filter((m) => m.file).length
  const failCount = manifest.length - okCount
  // A captured file whose own settle condition timed out (still busy/
  // spinning when the timeout hit) is NOT a failure -- the screenshot
  // exists and might even be fine -- but it must not read as an ordinary
  // success either. visual-sweep-2026-08-30: a "204 captured / 0 failed"
  // summary that silently included several still-loading pages is what
  // sent two reviewers chasing bugs that were actually this script's own
  // too-short wait. `settled === false` (not just falsy/undefined) so an
  // older manifest entry or a non-capture entry never misreports here.
  const unsettled = manifest.filter((m) => m.file && m.settled === false)
  // visual-sweep-2026-08-30 defect 2: a stray dialog that Escape couldn't
  // close within dismissOpenDialogs' own retry budget -- distinct from the
  // ordinary case (leaked in, one Escape closed it, capture is clean) which
  // never reaches here at all.
  const strayOverlays = manifest.filter((m) => m.file && m.strayOverlay)
  const md = [
    '# UI shot tour manifest',
    '',
    `Captured ${okCount} views (${failCount} failed, ${unsettled.length} not settled, ${strayOverlays.length} with a stray overlay) from \`${args.root}\` against \`${BASE_URL}\`.`,
    ...(unsettled.length ? ['', '**Not settled means the capture may show a mid-load spinner or skeleton, not the real page -- verify before treating it as a finding.**'] : []),
    ...(strayOverlays.length ? ['', '**Stray overlay means a leaked dialog from an earlier view survived three Escape presses -- the capture may be dimmed by its backdrop with the dialog itself off-screen or unrendered. Verify before treating it as a finding.**'] : []),
    '',
    '| File | View | Route | Viewport | Theme | Settled | Stray overlay |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...manifest.filter((m) => m.file).map((m) => `| ${m.file} | ${m.view} | \`${m.path}\` | ${m.viewport} | ${m.theme} | ${m.settled === false ? '⚠️ NO' : 'yes'} | ${m.strayOverlay ? `⚠️ ${m.strayOverlay}` : '--'} |`),
    ...(failCount ? ['', '## Failed captures', '', ...manifest.filter((m) => !m.file).map((m) => `- **${m.view}** (${m.viewport}/${m.theme}, \`${m.path}\`): ${m.error}`)] : []),
    ...(unsettled.length ? ['', '## Captured but not settled', '', 'Spinner or skeleton (`[aria-busy="true"]` / `.animate-spin`) was still present when the timeout hit -- the file exists but may not show the real page.', '', ...unsettled.map((m) => `- **${m.view}** (${m.viewport}/${m.theme}): \`${m.file}\``)] : []),
    ...(strayOverlays.length ? ['', '## Captured with a stray overlay', '', 'A dialog leaked in from an earlier view and three Escape presses did not close it before the shot.', '', ...strayOverlays.map((m) => `- **${m.view}** (${m.viewport}/${m.theme}): \`${m.file}\` -- "${m.strayOverlay}"`)] : []),
  ].join('\n')
  writeFileSync(path.join(args.out, 'MANIFEST.md'), md)

  console.log(`[ui-shot-tour] done. ${okCount} captured, ${failCount} failed, ${unsettled.length} not settled, ${strayOverlays.length} with a stray overlay. Output: ${args.out}`)
  if (failCount) process.exitCode = 1
}

main().catch((err) => {
  console.error('[ui-shot-tour] fatal:', err)
  process.exitCode = 1
})
