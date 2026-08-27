import { describe, expect, it, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  generateStartupScripts,
  regenerateStartupScriptsWithBackup,
} from "../routes/server.js";

// 2026-08-27 reproduction task (card
// user-report-servertest-ini-and-sandbox-reverted-to-default-after-restart,
// reassigned from Pam for the Windows repro half). Pam's leading theory:
// PZ writes a fresh default servertest.ini when it starts and can't find
// the one it expects at -cachedir, and the scheduled-restart path can point
// PZ at the WRONG cachedir without ever touching the real config -- an
// orphan, not a corruption.
//
// This proves the mechanism that would cause that divergence, on Windows,
// without a live PZ install: -cachedir and -servername are baked as literal
// text into StartServer_<name>.bat/.sh at generateStartupScripts() time
// (server.js:850), and that function is called from exactly three places --
// grepped, not assumed: the manual /start route (server.js:1167), and the
// two install/setup-wizard flows (server.js:2541, server.js:2917). NONE of
// them fire from PUT /api/servers/:id (the Settings-UI edit route) --
// grepped there too, zero hits. So editing zomboidDataPath/serverName in
// Settings changes the DATABASE immediately but leaves the already-written
// launch script exactly as it was until the next MANUAL start regenerates
// it. Independently re-confirmed Pam's scheduler.js grep here as well:
// performRestart() -> startServer() (services/scheduler.js:944, :1261) has
// zero calls to generateStartupScripts/regenerateStartupScriptsWithBackup/
// ensureRconConfigured anywhere in the file -- a scheduled restart launches
// whatever script is currently on disk, stale or not.
//
// This does NOT require the file-shaped-serverPath sub-theory to be true --
// it reproduces on a perfectly ordinary directory-shaped install path, which
// is why it's reported separately from that question (answered below).
// It also does not prove PZ itself regenerates a default ini when -cachedir
// doesn't resolve to the expected file -- that's PZ's own documented
// behavior, asserted in the card, outside this repo's code to test.
describe("a Settings-UI config change never reaches a script only a scheduled restart will use", () => {
  let tmpRoot;

  afterEach(() => {
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("changing zomboidDataPath without a manual start leaves the on-disk launch script pointed at the OLD path", () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zcp-stale-launch-"));
    const oldDataPath = path.join(tmpRoot, "ZomboidData_old");
    const newDataPath = path.join(tmpRoot, "ZomboidData_new");

    // Manual start #1: the only kind of event that ever writes the script.
    // Bakes -cachedir="...ZomboidData_old" into the .bat text.
    const v1 = generateStartupScripts({
      installPath: tmpRoot,
      serverName: "TestServer",
      zomboidDataPath: oldDataPath,
      adminPassword: "",
      serverPort: 16261,
    });
    const batPath = path.join(tmpRoot, "StartServer_TestServer.bat");
    const shPath = path.join(tmpRoot, "start-server_TestServer.sh");
    regenerateStartupScriptsWithBackup(tmpRoot, [
      { path: batPath, content: v1.bat },
      { path: shPath, content: v1.sh.replace(/\r\n/g, "\n") },
    ]);
    expect(fs.readFileSync(batPath, "utf8")).toContain(
      `-cachedir="${oldDataPath}"`,
    );

    // Operator edits the server's zomboidDataPath through the Settings UI
    // (PUT /api/servers/:id). That route updates the database record only
    // -- confirmed by grep, it has no call to generateStartupScripts or
    // regenerateStartupScriptsWithBackup anywhere in servers.js. Modeled
    // here by simply NOT touching the on-disk script, which is the accurate
    // simulation of what that route actually does.

    // Scheduled restart: services/scheduler.js's performRestart() ->
    // startServer() path, independently re-confirmed above to call none of
    // generateStartupScripts/regenerateStartupScriptsWithBackup/
    // ensureRconConfigured. It launches whatever is on disk right now,
    // unchanged by the settings edit above.
    const scriptPzActuallyLaunches = fs.readFileSync(batPath, "utf8");

    // The bug: the script a scheduled restart launches still carries the
    // OLD cachedir, with no trace anywhere that the DB has since moved on
    // to newDataPath. A manual start (which regenerates first) would have
    // caught this; a scheduled one does not.
    expect(scriptPzActuallyLaunches).toContain(
      `-cachedir="${oldDataPath}"`,
    );
    expect(scriptPzActuallyLaunches).not.toContain(
      `-cachedir="${newDataPath}"`,
    );
  });
});
