import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// readMostRecentApplyLog()'s legacy os.tmpdir() fallback used fs.statSync
// (follows symlinks) with no check at all -- a lower-privileged local user
// on a shared, non-PrivateTmp Linux host could plant a symlink named
// zomboid-panel-update-<n>.log pointing at any file the panel process can
// read, and any logged-in panel user could pull its content back through
// GET /api/panel/update-apply-log (CodeQL js/insecure-temporary-file #289).

const getSetting = vi.fn();
const setSetting = vi.fn();
vi.mock("../database/init.js", () => ({ getSetting, setSetting }));

// logger.js reads getDataPaths().logsDir at MODULE LOAD time (mkdirSync), so
// the mocked directory must already exist before panelUpdateChecker.js (and
// its logger.js import) is ever imported below -- not just by beforeEach.
// This runs after `fs`/`os`/`path` are bound (ESM imports resolve before any
// module body code) but before the dynamic import below triggers the mock
// factory, so it's ready in time despite `vi.mock` itself being hoisted.
const emptyLogsDir = {
  dir: fs.mkdtempSync(path.join(os.tmpdir(), "panel-update-logsdir-")),
};
vi.mock("../utils/paths.js", () => ({
  getDataPaths: () => ({ logsDir: emptyLogsDir.dir, dataDir: emptyLogsDir.dir }),
}));

const { PanelUpdateChecker } = await import("../services/panelUpdateChecker.js");

describe("readMostRecentApplyLog(): legacy tmpdir fallback rejects symlinks", () => {
  let tmpDir;

  beforeEach(() => {
    getSetting.mockReset();
    setSetting.mockReset();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "panel-update-applylog-"));
    vi.spyOn(os, "tmpdir").mockReturnValue(tmpDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns a real matching log file's contents normally", () => {
    fs.writeFileSync(
      path.join(tmpDir, "zomboid-panel-update-123.log"),
      "apply ok",
    );
    const checker = new PanelUpdateChecker();
    expect(checker.readMostRecentApplyLog()).toBe("apply ok");
  });

  it.skipIf(process.platform === "win32")(
    "skips a symlinked entry instead of following it to an arbitrary file",
    () => {
      const secret = path.join(tmpDir, "..", "not-a-log-secret.txt");
      fs.writeFileSync(secret, "SECRET CONTENT");
      fs.symlinkSync(
        secret,
        path.join(tmpDir, "zomboid-panel-update-999.log"),
      );

      const checker = new PanelUpdateChecker();
      expect(checker.readMostRecentApplyLog()).toBeNull();

      fs.rmSync(secret, { force: true });
    },
  );

  it("returns null when no matching file exists", () => {
    const checker = new PanelUpdateChecker();
    expect(checker.readMostRecentApplyLog()).toBeNull();
  });
});
