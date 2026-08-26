import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("../database/init.js", () => ({
  logServerEvent: vi.fn(),
  setSetting: vi.fn(),
  getSetting: vi.fn(),
  getActiveServer: vi.fn(),
}));

vi.mock("../routes/chunks.js", () => ({
  invalidateMapFolderScan: vi.fn(),
}));

const { default: router } = await import("../routes/server.js");

const SERVER_NAME = "servertest";

function createResponse() {
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  return response;
}

function getWipeHandler() {
  const layer = router.stack.find(
    (entry) => entry.route?.path === "/wipe" && entry.route.methods.post,
  );
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

let root;
let savePath;
let saveDir;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pz-wipe-backup-"));
  savePath = root;
  saveDir = path.join(savePath, "Saves", "Multiplayer", SERVER_NAME);
  fs.mkdirSync(path.join(saveDir, "map"), { recursive: true });
  fs.writeFileSync(path.join(saveDir, "map", "0_0.bin"), "chunk");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function buildServerManager() {
  return {
    loadConfig: async () => {},
    getServerProcessDetails: async () => ({ running: false, scanFailed: false }),
    savePath,
    serverName: SERVER_NAME,
  };
}

// Every test in this file exercises the pre-wipe backup step added alongside
// the notice-copy fix -- specifically that a failed or unavailable backup
// aborts the wipe (fail closed, same convention restoreBackup() already uses
// for its own mandatory pre-restore backup), that a successful backup lets
// the wipe proceed and is reported back, and that createBackup: false still
// skips it entirely (matching chunks.js's delete-chunks/delete-region toggle).
describe("POST /api/server/wipe backs up before deleting (default createBackup: true)", () => {
  it("aborts the wipe and deletes nothing when the backup fails", async () => {
    const serverManager = buildServerManager();
    const backupService = {
      createBackup: vi.fn(async () => ({ success: false, message: "disk full" })),
    };
    const app = {
      get: (key) => {
        if (key === "serverManager") return serverManager;
        if (key === "backupService") return backupService;
        return undefined;
      },
    };

    const handler = getWipeHandler();
    const response = createResponse();
    await handler(
      { app, body: { targets: ["map"], confirm: true } },
      response,
    );

    expect(backupService.createBackup).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "WIPE_BACKUP_FAILED" }),
    );
    // Nothing was deleted -- the map/ directory this test seeded is untouched.
    expect(fs.existsSync(path.join(saveDir, "map", "0_0.bin"))).toBe(true);
  });

  it("aborts the wipe and deletes nothing when no backup service is registered", async () => {
    const serverManager = buildServerManager();
    const app = {
      get: (key) => (key === "serverManager" ? serverManager : undefined),
    };

    const handler = getWipeHandler();
    const response = createResponse();
    await handler(
      { app, body: { targets: ["map"], confirm: true } },
      response,
    );

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "WIPE_BACKUP_FAILED" }),
    );
    expect(fs.existsSync(path.join(saveDir, "map", "0_0.bin"))).toBe(true);
  });

  it("backs up first, then deletes, and reports the backup in the response when it succeeds", async () => {
    const serverManager = buildServerManager();
    const backupService = {
      createBackup: vi.fn(async () => ({
        success: true,
        backup: { name: "servertest_2026.zip" },
      })),
    };
    const app = {
      get: (key) => {
        if (key === "serverManager") return serverManager;
        if (key === "backupService") return backupService;
        return undefined;
      },
    };

    const handler = getWipeHandler();
    const response = createResponse();
    await handler(
      { app, body: { targets: ["map"], confirm: true } },
      response,
    );

    expect(backupService.createBackup).toHaveBeenCalledTimes(1);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        backupCreated: true,
        backupName: "servertest_2026.zip",
      }),
    );
    // The wipe actually ran, after the backup call returned success.
    expect(fs.existsSync(path.join(saveDir, "map"))).toBe(false);
  });

  it("copies the accounts database alongside the save backup when 'accounts' is selected", async () => {
    const dbDir = path.join(savePath, "db");
    fs.mkdirSync(dbDir, { recursive: true });
    fs.writeFileSync(path.join(dbDir, `${SERVER_NAME}.db`), "whitelist");

    const backupsDir = path.join(root, "backups");
    fs.mkdirSync(backupsDir, { recursive: true });

    const serverManager = buildServerManager();
    const backupService = {
      createBackup: vi.fn(async () => ({
        success: true,
        backup: { name: "servertest_2026.zip" },
      })),
      getBackupsPath: vi.fn(async () => backupsDir),
    };
    const app = {
      get: (key) => {
        if (key === "serverManager") return serverManager;
        if (key === "backupService") return backupService;
        return undefined;
      },
    };

    const handler = getWipeHandler();
    const response = createResponse();
    await handler(
      { app, body: { targets: ["accounts"], confirm: true } },
      response,
    );

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, backupCreated: true }),
    );
    // The account db itself was deleted by the wipe...
    expect(fs.existsSync(path.join(dbDir, `${SERVER_NAME}.db`))).toBe(false);
    // ...but a copy was made first, under backupsPath, before deletion.
    const copied = fs
      .readdirSync(backupsDir)
      .filter((name) => name.includes("_accounts_"));
    expect(copied.length).toBe(1);
    expect(
      fs.existsSync(path.join(backupsDir, copied[0], `${SERVER_NAME}.db`)),
    ).toBe(true);
  });
});

describe("POST /api/server/wipe with createBackup: false", () => {
  it("skips the backup step entirely and deletes as before", async () => {
    const serverManager = buildServerManager();
    const backupService = {
      createBackup: vi.fn(async () => ({ success: true, backup: { name: "unused.zip" } })),
    };
    const app = {
      get: (key) => {
        if (key === "serverManager") return serverManager;
        if (key === "backupService") return backupService;
        return undefined;
      },
    };

    const handler = getWipeHandler();
    const response = createResponse();
    await handler(
      { app, body: { targets: ["map"], confirm: true, createBackup: false } },
      response,
    );

    expect(backupService.createBackup).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, backupCreated: false, backupName: null }),
    );
    expect(fs.existsSync(path.join(saveDir, "map"))).toBe(false);
  });
});
