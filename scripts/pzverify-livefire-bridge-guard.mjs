#!/usr/bin/env node
// Refuses to let a live-fire test run against a stale pz-verify bridge. Exits 0 only when the
// version this repo ships, the version the running server's boot log announced it loaded, and the
// version the running bridge is CURRENTLY reporting over its live status file all agree. Any other
// outcome -- including "could not tell" -- exits non-zero. Run this immediately before a live-fire
// session against pz-verify; treat any non-zero exit as "do not run the test", not as a warning.
//
// WHY THIS EXISTS: pz-verify's installed PanelBridge.lua has drifted from what the repo ships three
// separate times (2026-08-17, 2026-08-30, 2026-09-02), each caught only because an agent happened to
// do a manual version diff before testing. That is not a guard, it is a good track record of luck.
// Investigating the 2026-09-02 drift (see docs history / hive board) also found the REASON it keeps
// happening: pz-verify has zero entries in data/db.json, so it was never enrolled as a panel-managed
// server and panelBridgeInstaller.js's own checkBridgeInstalled/needsUpdate sync path -- which is real,
// and does work for servers the panel manages -- was never wired to this box at all. This script is
// the guard for the one target that mechanism cannot reach.
//
// TWO DESIGN CONSTRAINTS (both from real incidents on this floor):
//
//   1. Compare what the server ACTUALLY LOADED, not the file currently sitting on disk. PZ reads
//      Lua once, at JVM startup -- a correct file on disk and a stale already-running server are an
//      entirely normal, entirely misleading combination. So this checks the boot log's own
//      "[PanelBridge] Initializing vX.Y.Z" line (self-reported at the moment the file was read) AND
//      the live status file (self-reported by the still-running process, right now), not just the
//      header comment of whatever file happens to be on disk.
//
//   2. Fail CLOSED. If any signal is missing, unreadable, unparsable, or too stale to trust --
//      no pid file, no matching process, no boot log, no "Initializing" line in it, no status file,
//      status.alive false, or a status timestamp older than --max-status-age-ms -- this refuses
//      rather than passing. A guard that reports clean when it could not actually check is worse
//      than no guard (the exact bug this floor shipped and then fixed in the i18n staleness gate
//      this same week: see server/tests/roleDescriptionStalenessGate.test.js's shallow-clone check).
//
// Usage: node scripts/pzverify-livefire-bridge-guard.mjs [--root <pz-verify root>]
//                                                          [--max-status-age-ms <n>]
// Defaults match this box: root D:\pz-verify, max status age 120000 (2 minutes). Override with
// --root/PZVERIFY_ROOT and --max-status-age-ms/PZVERIFY_MAX_STATUS_AGE_MS if your checkout differs.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const REPO_LUA_PATH = path.join(REPO_ROOT, 'pz-mod/PanelBridge/media/lua/server/PanelBridge.lua');

function parseArgs(argv) {
  const args = { root: null, maxStatusAgeMs: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') args.root = argv[++i];
    else if (argv[i] === '--max-status-age-ms') args.maxStatusAgeMs = Number(argv[++i]);
  }
  return args;
}

const cli = parseArgs(process.argv.slice(2));
const PZVERIFY_ROOT = cli.root || process.env.PZVERIFY_ROOT || String.raw`D:\pz-verify`;
const MAX_STATUS_AGE_MS =
  cli.maxStatusAgeMs ||
  Number(process.env.PZVERIFY_MAX_STATUS_AGE_MS) ||
  120000;
const SERVER_NAME = 'pz-verify';

let refused = false;
function refuse(reason) {
  refused = true;
  console.error(`REFUSE: ${reason}`);
}

function fail(message) {
  console.error(`GUARD FAILED (would allow a stale live-fire run): ${message}`);
  process.exit(1);
}

// ---- 1. What does the repo ship? -----------------------------------------------------------------

if (!fs.existsSync(REPO_LUA_PATH)) {
  refuse(`repo Lua file not found at ${REPO_LUA_PATH} -- cannot determine the shipped version`);
}
let repoVersion = null;
if (!refused) {
  const repoLuaText = fs.readFileSync(REPO_LUA_PATH, 'utf8');
  const m = repoLuaText.match(/Version:\s*(\S+)/);
  if (!m) {
    refuse(`repo Lua file has no "Version:" header line -- cannot determine the shipped version`);
  } else {
    repoVersion = m[1];
  }
}

// ---- 2. Is a pz-verify server actually running right now? ----------------------------------------

let pid = null;
if (!refused) {
  const pidPath = path.join(PZVERIFY_ROOT, `${SERVER_NAME}.pid`);
  if (!fs.existsSync(pidPath)) {
    refuse(`no pid file at ${pidPath} -- pz-verify does not appear to be running`);
  } else {
    pid = fs.readFileSync(pidPath, 'utf8').trim();
    if (!/^\d+$/.test(pid)) {
      refuse(`pid file at ${pidPath} does not contain a plain PID ("${pid}")`);
      pid = null;
    }
  }
}

if (!refused) {
  let tasklistOut = '';
  try {
    tasklistOut = execFileSync(
      'tasklist',
      ['/FI', `PID eq ${pid}`, '/FI', 'IMAGENAME eq java.exe', '/FO', 'CSV', '/NH'],
      { encoding: 'utf8' }
    );
  } catch (err) {
    refuse(`tasklist check for PID ${pid} failed: ${err.message}`);
  }
  if (!refused && !tasklistOut.includes(`"${pid}"`)) {
    refuse(
      `pid file points at PID ${pid} but no java.exe process with that PID is running -- stale pidfile`
    );
  }
}

// ---- 3. What did the boot log say it loaded? ------------------------------------------------------

let bootLogVersion = null;
let bootLogPath = null;
if (!refused) {
  const logDir = path.join(PZVERIFY_ROOT, 'logs');
  if (!fs.existsSync(logDir)) {
    refuse(`log directory not found at ${logDir}`);
  } else {
    const candidates = fs
      .readdirSync(logDir)
      .filter((f) => /^pz-verify-.*\.out\.log$/.test(f))
      .map((f) => {
        const p = path.join(logDir, f);
        return { path: p, mtime: fs.statSync(p).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    if (candidates.length === 0) {
      refuse(`no pz-verify-*.out.log files found under ${logDir}`);
    } else {
      bootLogPath = candidates[0].path;
      const text = fs.readFileSync(bootLogPath, 'utf8');
      const matches = [...text.matchAll(/\[PanelBridge\]\s+Initializing\s+v(\S+)/g)];
      if (matches.length === 0) {
        refuse(`newest boot log (${bootLogPath}) has no "[PanelBridge] Initializing vX.Y.Z" line`);
      } else {
        bootLogVersion = matches[matches.length - 1][1];
      }
    }
  }
}

// ---- 4. What is the running bridge reporting RIGHT NOW? --------------------------------------------

let statusVersion = null;
if (!refused) {
  const statusPath = path.join(
    PZVERIFY_ROOT,
    'Zomboid',
    'Lua',
    'panelbridge',
    SERVER_NAME,
    'status.json.txt'
  );
  if (!fs.existsSync(statusPath)) {
    refuse(`no live status file at ${statusPath}`);
  } else {
    let status;
    try {
      status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    } catch (err) {
      refuse(`live status file at ${statusPath} is not valid JSON: ${err.message}`);
    }
    if (!refused) {
      if (status.alive !== true) {
        refuse(`live status file reports alive:${status.alive}`);
      }
      if (!status.version) {
        refuse(`live status file has no "version" field`);
      }
      const ageMs = Date.now() - Number(status.timestamp);
      if (!Number.isFinite(ageMs) || ageMs < 0) {
        refuse(`live status file has no usable timestamp`);
      } else if (ageMs > MAX_STATUS_AGE_MS) {
        refuse(
          `live status file is ${Math.round(ageMs / 1000)}s old (max ${Math.round(
            MAX_STATUS_AGE_MS / 1000
          )}s) -- treating as unable to confirm current state, not assuming it is still accurate`
        );
      }
      if (!refused) statusVersion = status.version;
    }
  }
}

if (refused) {
  fail('one or more signals could not be determined -- see REFUSE lines above.');
}

// ---- 5. Do they all agree? --------------------------------------------------------------------

if (repoVersion !== bootLogVersion || repoVersion !== statusVersion) {
  fail(
    [
      'version mismatch:',
      `  repo ships (pz-mod/PanelBridge):      ${repoVersion}`,
      `  boot log announced loading:           ${bootLogVersion}  (${bootLogPath})`,
      `  running bridge currently reports:     ${statusVersion}`,
      'The running pz-verify server is not the code this repo ships. Redeploy before testing.',
    ].join('\n')
  );
}

console.log(
  `PASS: pz-verify (pid ${pid}) is running v${repoVersion}, confirmed by boot log and live status. Safe to live-fire.`
);
process.exit(0);
