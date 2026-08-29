import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// 2026-08-29 hunt (god): backup-and-restore, suspect 6 (restore pre-flight)
// -- "restoring from a corrupt backup over a working world is the only way
// this subsystem can make things worse than doing nothing."
//
// Empirically confirmed (scratch probe against the real `unzipper` package
// used here, both stored and compressed entries) that its streaming
// Parse() -- the API restoreBackup() extracts with -- reads each entry's
// recorded CRC32 as bookkeeping and NEVER recomputes it against the bytes
// it actually writes to disk. A single flipped byte anywhere in a
// compressed entry's data silently produced content of a DIFFERENT LENGTH
// than the original, with zero error raised anywhere in the pipeline --
// not a rare, hand-crafted case, a random single-byte flip reproduced it
// on the first try. Bit rot on backup storage, a bad copy, or a truncated
// download all look identical to a healthy backup right up until a restore
// silently swaps corrupted bytes in over a working world.
//
// This pins the fix: _verifyExtractedIntegrity() recomputes every extracted
// file's CRC32 against what the archive's own central directory (read via
// unzip.Open.file(), independent of the streaming Parse() used to extract)
// recorded for that entry, BEFORE the swap. A mismatch refuses the restore
// and leaves the live save untouched -- staging is still disposable at that
// point, so refusing costs nothing.

const logServerEvent = vi.fn(async () => {});

vi.mock("../database/init.js", () => ({
  getActiveServer: vi.fn(async () => null),
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => {}),
  logServerEvent,
}));

vi.mock("../routes/chunks.js", () => ({
  invalidateMapFolderScan: vi.fn(),
}));

const { BackupService } = await import("../services/backupService.js");

const SERVER_NAME = "servertest";
let root;
let savesPath;
let backupsPath;

function createService() {
  const service = new BackupService();
  service.getSavesPath = async () => savesPath;
  service.getBackupsPath = async () => backupsPath;
  service.setServerManager({
    getServerProcessDetails: async () => ({ running: false, scanFailed: false }),
  });
  return service;
}

// Flips one byte somewhere in the back half of the file -- past the local
// file headers for a small fixture, inside a compressed data region --
// simulating real-world bit rot on backup storage rather than a
// hand-crafted attack on the format.
function corruptOneByte(filePath) {
  const buf = fs.readFileSync(filePath);
  const at = Math.floor(buf.length * 0.6);
  buf[at] = buf[at] ^ 0xff;
  fs.writeFileSync(filePath, buf);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pz-backup-integrity-"));
  savesPath = path.join(root, "Saves", "Multiplayer", SERVER_NAME);
  backupsPath = path.join(root, "backups");
  fs.mkdirSync(backupsPath, { recursive: true });
  fs.mkdirSync(savesPath, { recursive: true });
  // Big enough and repetitive enough that archiver's default compression
  // actually compresses it (matches real save data, which is not random
  // noise), so corrupting it exercises the DEFLATE path, not a stored one.
  fs.writeFileSync(
    path.join(savesPath, "map_meta.bin"),
    Buffer.from("LIVE ORIGINAL MAP DATA ".repeat(400)),
  );
  fs.writeFileSync(path.join(savesPath, "worldstats.txt"), "LIVE ORIGINAL STATS");
  logServerEvent.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("restoreBackup() verifies extracted file integrity before swapping in the live save", () => {
  it("refuses a backup with a single corrupted byte instead of silently restoring wrong content", async () => {
    const service = createService();

    const createResult = await service.createBackup({ createPreRestoreBackup: false });
    expect(createResult.success).toBe(true);
    const zipPath = path.join(backupsPath, createResult.backup.name);

    corruptOneByte(zipPath);

    const beforeRestore = fs.readFileSync(path.join(savesPath, "map_meta.bin"));

    const restoreResult = await service.restoreBackup(createResult.backup.name, {
      createPreRestoreBackup: false,
    });

    // The predicted pre-fix symptom: this reads success:true, and
    // map_meta.bin's content on disk no longer matches what was actually
    // backed up (silently corrupted, not merely "restore failed").
    expect(restoreResult.success).toBe(false);
    expect(restoreResult.message).toMatch(/integrity verification/i);

    // The live save must be completely untouched -- not partially swapped,
    // not deleted, not replaced with the corrupt version.
    expect(fs.existsSync(savesPath)).toBe(true);
    const afterRestore = fs.readFileSync(path.join(savesPath, "map_meta.bin"));
    expect(Buffer.compare(afterRestore, beforeRestore)).toBe(0);
  });

  it("restores normally when every file's checksum matches (no false positives)", async () => {
    const service = createService();

    const createResult = await service.createBackup({ createPreRestoreBackup: false });
    expect(createResult.success).toBe(true);

    // Simulate real data loss so the restored content can only have come
    // from the (uncorrupted) archive.
    fs.rmSync(savesPath, { recursive: true, force: true });

    const restoreResult = await service.restoreBackup(createResult.backup.name, {
      createPreRestoreBackup: false,
    });

    expect(restoreResult.success).toBe(true);
    expect(fs.readFileSync(path.join(savesPath, "map_meta.bin")).toString()).toBe(
      "LIVE ORIGINAL MAP DATA ".repeat(400),
    );
  });
});
