import { describe, expect, it, vi, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createBackup } from "../utils/configBackup.js";

// 2026-08-27: sibling of the startupScriptBackup.test.js collision fix.
// createBackup() is the shared backup-before-overwrite safety net for
// server.ini, SandboxVars.lua, spawnpoints.lua, and spawnregions.lua edits
// (server/routes/serverFiles.js, server/routes/mods.js) -- the actual
// protection an operator relies on when hand-editing config while the
// server runs. It named each backup with a millisecond-resolution
// timestamp and nothing else; two backups of the same file detected close
// together could compute an identical filename, and the second
// fs.promises.copyFile would silently overwrite the first with no error.
// This file pins that the collision can no longer happen, and that fixing
// it didn't break the "keep only the 10 newest backups" pruning.
describe("createBackup() -- backup filename collisions", () => {
  let root;

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("two backups of the same file in the same millisecond get distinct names, and neither overwrites the other", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "zcp-configbackup-"));
    const iniPath = path.join(root, "servertest.ini");
    fs.writeFileSync(iniPath, "version 1", "utf8");

    const toISOString = vi
      .spyOn(Date.prototype, "toISOString")
      .mockReturnValue("2026-08-27T00-00-00-000Z");
    try {
      const first = await createBackup(root, "servertest.ini");
      expect(first.backedUp).toBe(true);

      fs.writeFileSync(iniPath, "version 2", "utf8");
      const second = await createBackup(root, "servertest.ini");
      expect(second.backedUp).toBe(true);

      expect(second.name).not.toBe(first.name);

      const backupDir = path.join(root, "backups");
      const backups = fs
        .readdirSync(backupDir)
        .filter((f) => f.startsWith("servertest.ini.") && f.endsWith(".bak"));
      expect(backups).toHaveLength(2);

      // The FIRST version's content must still be recoverable from the
      // first backup -- if the second write had silently overwritten it,
      // this would read back "version 1" a second time (or "version 2"
      // twice), not each version once.
      const contents = backups
        .map((f) => fs.readFileSync(path.join(backupDir, f), "utf8"))
        .sort();
      expect(contents).toEqual(["version 1", "version 2"]);
    } finally {
      toISOString.mockRestore();
    }
  });

  it("a third collision in the same millisecond still gets its own distinct name", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "zcp-configbackup-"));
    const iniPath = path.join(root, "servertest.ini");
    fs.writeFileSync(iniPath, "version 1", "utf8");

    const toISOString = vi
      .spyOn(Date.prototype, "toISOString")
      .mockReturnValue("2026-08-27T00-00-00-000Z");
    try {
      await createBackup(root, "servertest.ini");
      fs.writeFileSync(iniPath, "version 2", "utf8");
      await createBackup(root, "servertest.ini");
      fs.writeFileSync(iniPath, "version 3", "utf8");
      const third = await createBackup(root, "servertest.ini");
      expect(third.backedUp).toBe(true);

      const backupDir = path.join(root, "backups");
      const backups = fs
        .readdirSync(backupDir)
        .filter((f) => f.startsWith("servertest.ini.") && f.endsWith(".bak"));
      expect(backups).toHaveLength(3);
      expect(new Set(backups).size).toBe(3);
    } finally {
      toISOString.mockRestore();
    }
  });

  it("pruning still keeps only the 10 newest when some names carry a collision suffix", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "zcp-configbackup-"));
    const iniPath = path.join(root, "servertest.ini");
    const backupDir = path.join(root, "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(iniPath, "current", "utf8");

    // Seed 9 pre-existing backups, oldest first, one of them already
    // carrying a collision suffix -- pruning must still treat it as one
    // file among the rest, not double-count it or crash on the shape.
    for (let i = 0; i < 9; i++) {
      const ts = `2026-08-2${i}T00-00-00-000Z`;
      fs.writeFileSync(
        path.join(backupDir, `servertest.ini.${ts}.bak`),
        `seed ${i}`,
        "utf8",
      );
    }
    fs.writeFileSync(
      path.join(backupDir, "servertest.ini.2026-08-29T00-00-00-000Z-2.bak"),
      "seed collision",
      "utf8",
    );

    // 10 pre-existing + this one new backup = 11 -> pruning should drop to 10.
    const result = await createBackup(root, "servertest.ini");
    expect(result.backedUp).toBe(true);

    const remaining = fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith("servertest.ini.") && f.endsWith(".bak"));
    expect(remaining).toHaveLength(10);
    // The brand-new backup must never be the one pruned away.
    expect(remaining).toContain(result.name);
  });
});
