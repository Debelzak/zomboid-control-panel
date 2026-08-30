/**
 * Shared pid-liveness primitive for orphan-temp-file sweeps.
 *
 * fileWriteQueue.js's writeFileAtomic sweep and backupService.js's
 * cleanupOrphanBackupTemps sweep both need to answer the same question --
 * "is the process that created this temp file still running?" -- before
 * deleting a file whose owner might still be mid-write. They used to carry
 * two byte-identical copies of this function (hunt-wave12, 2026-08-30);
 * this module is the one place that logic now lives.
 *
 * process.kill(pid, 0) is the standard way to probe for a running process
 * without signaling it: confirmed on this platform and on Linux to throw
 * ESRCH for a pid that is not running, and to not throw (or to throw EPERM,
 * for a pid this process doesn't own) for one that is. Any outcome other
 * than a confirmed ESRCH is treated as "still alive" -- an ambiguous signal
 * never authorises a delete, matching the boundary both sweeps depend on:
 * this must never delete a live write's temp even at the cost of
 * occasionally leaving a truly-dead one behind a little longer.
 *
 * Deliberately does NOT decide how a caller extracts a pid from a filename,
 * or what to do with names that don't embed one at all -- that stays with
 * each sweep, since the two patterns they scan do not uniformly embed a
 * pid (see backupService.js's CENTRAL_TEMP_PATTERN vs. its *.zip.tmp
 * pattern-only branch, which has no pid to check and must not be given one
 * just to fit this helper).
 */
export function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}
