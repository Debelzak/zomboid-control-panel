/**
 * Shared helpers for safely writing config files (INI/Lua/JSON) that PZ
 * itself also reads, where a half-written file or a lost concurrent update
 * would be a real (if rare) way to corrupt or clobber a server's config.
 *
 * The DB layer (database/init.js) already does the atomic temp-file+rename
 * trick for db.json; these two helpers bring the same protection to the
 * config-file editor routes, which previously did a direct
 * `fs.writeFileSync` straight onto the live file with no locking.
 */
import fs from "fs";
import path from "path";

const fileLocks = new Map(); // resolved path -> tail of the pending promise chain

/**
 * Serialize an async critical section per file path. Concurrent callers for
 * the SAME path run one after another, in call order; different paths run
 * concurrently and don't block each other. Prevents a lost-update race where
 * two overlapping PUTs to the same INI/Lua file both read the old content,
 * mutate independently, and the second write silently clobbers the first's
 * change.
 */
export function withFileLock(filePath, fn) {
  const key = path.resolve(filePath);
  const prior = fileLocks.get(key) || Promise.resolve();
  const run = prior.then(fn, fn);
  const tail = run.then(
    () => {},
    () => {},
  );
  fileLocks.set(key, tail);
  tail.finally(() => {
    if (fileLocks.get(key) === tail) fileLocks.delete(key);
  });
  return run;
}

/**
 * Atomically write a file: write to a unique temp file in the same
 * directory, then rename into place. A plain `writeFileSync` truncates the
 * live file first, so a crash/power-loss mid-write (or, on Windows, another
 * process holding the file open) can leave a corrupt half-written config.
 * Writing to a temp file and renaming means the live file is only ever
 * replaced by a COMPLETE new version — a crash before the rename leaves the
 * original file untouched.
 */
export function writeFileAtomic(filePath, data, options = "utf-8") {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`,
  );
  // `options` is passed straight through to fs.writeFileSync, so callers can
  // pass either an encoding string ('utf-8') or an options object
  // ({ encoding, mode }) exactly as they would to writeFileSync directly.
  fs.writeFileSync(tmpPath, data, options);
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* best effort */
    }
    throw err;
  }
}
