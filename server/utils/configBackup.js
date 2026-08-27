/**
 * Shared helper for backing up a server config file (INI/Lua) before an edit
 * overwrites it. Originally lived only in server/routes/serverFiles.js;
 * extracted here so server/routes/mods.js's ini-rewriting routes can reuse
 * the exact same logic instead of reinventing it (mods.js fully replaced
 * Mods=/WorkshopItems=/Map= with no backup at all across 19 routes — see
 * writeIniWithBackup below).
 */
import fs from "fs";
import path from "path";
import { createLogger } from "./logger.js";
import { writeFileAtomic } from "./fileWriteQueue.js";

const log = createLogger("Utils:ConfigBackup");

// Backup directory for a given server config directory.
export async function getBackupPath(configPath) {
  return path.join(configPath, "backups");
}

// Create a backup of `filename` (a file directly inside `configPath`) before
// an edit overwrites it.
//
// Returns one of three shapes, DELIBERATELY not collapsed into a single
// null/truthy check: a caller that can't tell "nothing to back up" apart
// from "the backup failed" ends up treating both the same way, which is
// exactly how a response ended up asserting a backup existed when it
// didn't (see docs/qa/kevin-route-hunt.md Finding 2). Same defect shape as
// `if (!req.user) return next()` from earlier tonight -- one value quietly
// carrying two meanings, one benign and one dangerous.
//   { backedUp: true, name }               -- a real backup now exists on disk
//   { backedUp: false, reason: "no-source" } -- benign: the file being edited
//     doesn't exist yet (e.g. first-ever write), so there is nothing to
//     protect. Not a failure.
//   { backedUp: false, reason: "failed", error } -- dangerous: a backup was
//     attempted (the source file exists) and did not happen -- disk full,
//     backup dir unwritable, the copy itself failing. The safety net the
//     caller may be about to rely on is NOT there.
export async function createBackup(configPath, filename) {
  const backupDir = await getBackupPath(configPath);
  const filePath = path.join(configPath, filename);

  try {
    await fs.promises.access(filePath);
  } catch (e) {
    log.debug(`Config backup source not found: ${filePath} — ${e.message}`);
    return { backedUp: false, reason: "no-source" };
  }

  try {
    // Ensure backup directory exists
    await fs.promises.mkdir(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupName = `${filename}.${timestamp}.bak`;
    const backupPath = path.join(backupDir, backupName);

    // Async copy — this is the actual safety net. Anything that throws
    // past this point means the backup did not happen.
    await fs.promises.copyFile(filePath, backupPath);
    log.info(`Created backup: ${backupName}`);

    // Cleanup old backups is best-effort housekeeping, not part of the
    // safety net itself — the new backup above already exists on disk
    // regardless of whether pruning old ones succeeds, so a cleanup
    // failure must not flip this call's result to backedUp:false.
    try {
      const files = await fs.promises.readdir(backupDir);
      const backups = files
        .filter((f) => f.startsWith(filename + ".") && f.endsWith(".bak"))
        .sort()
        .reverse();

      if (backups.length > 10) {
        const filesToDelete = backups.slice(10);
        await Promise.all(
          filesToDelete.map((old) =>
            fs.promises
              .unlink(path.join(backupDir, old))
              .catch((e) =>
                log.warn(`Failed to delete old backup ${old}: ${e.message}`),
              ),
          ),
        );
      }
    } catch (cleanupError) {
      log.warn(
        `Backup cleanup failed (new backup ${backupName} is still safe): ${cleanupError.message}`,
      );
    }

    return { backedUp: true, name: backupName };
  } catch (error) {
    log.error(`Backup creation failed: ${error.message}`);
    return { backedUp: false, reason: "failed", error: error.message };
  }
}

// For an ordinary, intentional config edit (as opposed to /sandbox/repair's
// heuristic rewrite of an already-corrupted file): a backup that failed
// must never block the edit the operator asked for -- the file being
// edited is valid and the change is deliberate, so losing the previous
// version is an annoyance, not a disaster. But the response must say so
// rather than silently degrading. Returns a user-facing warning string, or
// null when there's nothing to warn about (backup succeeded, or there was
// no prior file to back up in the first place).
export function backupWarningFor(backup) {
  if (!backup || backup.backedUp || backup.reason === "no-source") return null;
  return `Could not back up the previous version before saving: ${backup.error}. Your change was saved, but there is no safety copy of what was there before.`;
}

// Back up the live ini at `iniPath`, then atomically write `content` in its
// place. This is the ONLY way anything in mods.js may write that ini —
// mods.js does not import writeFileAtomic directly (removed from its import
// list on purpose), so a future ini-rewriting route physically cannot skip
// the backup without first adding that import back, which is a visible,
// reviewable diff rather than a silent omission.
export async function writeIniWithBackup(iniPath, content) {
  const configPath = path.dirname(iniPath);
  const filename = path.basename(iniPath);
  const backup = await createBackup(configPath, filename);
  writeFileAtomic(iniPath, content, "utf-8");
  return backup;
}
