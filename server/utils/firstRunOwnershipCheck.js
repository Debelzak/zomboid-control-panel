/**
 * Root-first-run trap (2026-08-29): an operator who starts the panel once
 * with sudo/as root just to look at it -- before ever switching to the
 * dedicated service account -- leaves dataDir 0700 root:root. The dedicated
 * account's next run then hits EACCES the moment ANYTHING tries to read or
 * write inside dataDir: db.json, jwt.secret, the startup backup, the log
 * files. jwt.secret is not special; it's simply the first thing a naive
 * error message happened to name, which sent operators chowning one file
 * at a time and crash-looping through the rest, one restart per file.
 *
 * This module exists to turn that into ONE clear refusal instead. It does
 * NOT and MUST NOT attempt to fix anything itself -- an unprivileged
 * process cannot chown a root-owned file, and weakening the mode instead
 * (e.g. 0755 so "other" can read it) would trade this bug for a worse one.
 * See docs/install/linux.md for the prevention half.
 *
 * WHY checkDataPathOwnership() is invoked at the bottom of THIS file,
 * rather than being left as a plain export index.js calls from inside its
 * own startup function: ESM resolves and evaluates a module's entire
 * static import graph -- including every import's own top-level side
 * effects -- before that module's own top-level statements run. database/
 * init.js has an unguarded fs.mkdirSync in its own top-level code (create
 * data/backups/) that fires during THAT import, before index.js's body
 * (even its very first line) ever executes. The only way to interpose a
 * check ahead of it is for this module's import to be evaluated first, in
 * source order, in index.js -- so the check has to run as an import-time
 * side effect too. It mirrors the pattern paths.js/logger.js/database/
 * init.js already use for their own directory setup.
 */
import fs from "fs";
import { execSync } from "child_process";
import { getDataPaths } from "./paths.js";

function resolveAccountName(uid) {
  try {
    const name = execSync(`id -un ${uid}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return name || null;
  } catch {
    return null; // minimal container without `id`, or an unmapped uid -- fall back to numeric
  }
}

function resolveRunningGroup() {
  try {
    const name = execSync("id -gn", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return name || String(process.getgid());
  } catch {
    return String(process.getgid());
  }
}

function describeAccount(uid) {
  const name = resolveAccountName(uid);
  return name ? `${name} (uid ${uid})` : `uid ${uid}`;
}

/**
 * Pure formatter -- given already-resolved facts (no fs, no execSync), so
 * this half is unit-testable with real function calls and no permission
 * mocking. The impure half (which paths are actually blocked, and who
 * owns/runs as what) is only ever proven with a real second uid -- see
 * server/tests/linuxRootFirstRunOwnershipTrap.test.js's manual WSL
 * useradd+su reproduction referenced in its header, not a unit test.
 */
export function formatOwnershipDiagnostic({ paths, runningAs, owningAccounts, fixCommand }) {
  const list = paths.map((p) => `  - ${p}`).join("\n");
  return (
    `Refusing to start: the following path(s) exist but are not readable/writable ` +
    `by the account currently running the panel:\n${list}\n\n` +
    `Running as: ${runningAs}\n` +
    `Owned by:   ${owningAccounts}\n\n` +
    `This is almost always caused by starting the panel once with sudo, or as root, ` +
    `just to look at it -- that first run creates the data directory and everything ` +
    `in it (the database, its startup backup, the JWT signing key, the log files) ` +
    `all owned by root, and every one of them then becomes unreachable to the ` +
    `account that runs the panel afterward. Do not run the panel as root/sudo again, ` +
    `even just once to look at it -- see docs/install/linux.md.\n\n` +
    `Fix (run once, as root or with sudo):\n  ${fixCommand}\n\n` +
    `This does not loosen any file's permissions (0600/0700 stay exactly as they ` +
    `are) -- it only changes who owns them. Restart the panel as ${runningAs} again ` +
    `afterward.`
  );
}

/**
 * Checks each path in `candidatePaths` that currently exists for real
 * read+write+execute access by THIS process. Paths that don't exist yet are
 * skipped (nothing to be blocked by -- normal fresh-install case). If any
 * existing path fails the access check, prints ONE consolidated diagnostic
 * naming every offending path, both accounts involved, and the single fix
 * command, then exits (dedicated code 78 is already used for the
 * single-instance lock refusal; this uses 77).
 *
 * No-op (returns false) on Windows or any platform without process.getuid
 * -- POSIX ownership doesn't apply there.
 */
export function checkAndExitIfOwnershipBlocked(candidatePaths) {
  if (process.platform === "win32" || typeof process.getuid !== "function") {
    return false;
  }

  const offending = [];
  const ownerUidByPath = {};

  for (const p of candidatePaths) {
    let stat;
    try {
      stat = fs.statSync(p);
    } catch {
      continue; // doesn't exist yet -- nothing to be blocked by
    }
    try {
      fs.accessSync(p, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
    } catch {
      offending.push(p);
      ownerUidByPath[p] = stat.uid;
    }
  }

  if (offending.length === 0) return false;

  const myUid = process.getuid();
  const runningAs = describeAccount(myUid);
  const owningAccounts = [...new Set(offending.map((p) => ownerUidByPath[p]))]
    .map(describeAccount)
    .join(", ");
  const runningUser = resolveAccountName(myUid) || String(myUid);
  const runningGroup = resolveRunningGroup();
  const fixCommand = `chown -R ${runningUser}:${runningGroup} ${offending.map((p) => `"${p}"`).join(" ")}`;

  const message = formatOwnershipDiagnostic({
    paths: offending,
    runningAs,
    owningAccounts,
    fixCommand,
  });
  console.error(`\n${message}\n`);
  process.exit(77);
  return true; // unreachable outside tests that stub process.exit
}

/**
 * The startup preflight: dataDir and logsDir are the two roots everything
 * else in the eager first-run class (db.json, jwt.secret, the backups
 * folder, the log files) lives under -- catching a mismatch on either root
 * catches the whole class without needing to enumerate every file inside
 * (which usually can't even be stat'd from the blocked side anyway: a 0700
 * root-owned dataDir denies traversal into itself, so nothing under it is
 * individually inspectable until this is fixed).
 */
export function checkDataPathOwnership() {
  let dataDir, logsDir;
  try {
    ({ dataDir, logsDir } = getDataPaths());
  } catch {
    return; // paths.js will surface its own error shortly
  }
  checkAndExitIfOwnershipBlocked([dataDir, logsDir]);
}

// Import-time side effect -- see the module doc comment above for why this
// can't wait until index.js's own startup function runs.
checkDataPathOwnership();
