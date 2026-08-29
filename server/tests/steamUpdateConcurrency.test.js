import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// Concurrency hunt 2026-08-29 (conversation hunt-wave5-2026-08-29). god's
// brief named "an update-apply racing anything" as an angle to check.
// server.js's /wipe route (see wipeConcurrency.test.js, same describe-block
// style reused below) already fixed exactly this shape once: its own
// comment reads "Claim the guard before the first await: awaiting between
// the check and the assignment lets a second concurrent request pass the
// check and run a parallel destructive [operation]." backupService.js's
// restoreBackup() carries the identical fix with the identical reasoning
// (2026-08-27, see backupRestoreSafety.test.js).
//
// POST /server/steam-update (and /server/install, same shape) did NOT get
// this fix. Reading the route: `hasActiveSteamOperation(normalizedPath)` is
// checked at server.js ~3641, but the actual claim --
// `activeSteamOperations.set(normalizedPath, ...)` -- doesn't happen until
// ~3703, with a real `await saveAndResolveSteamCmdExe(steamcmdPath)` (which
// itself awaits `getSetting`/`setSetting`) sitting in between. Two
// steam-update requests for the SAME installPath arriving close together
// (a double-click, a retried request, two admin sessions) can both pass the
// check before either claims, and both end up spawning SteamCMD against the
// same install directory concurrently -- SteamCMD is not designed for two
// instances writing the same install dir at once (manifest lock contention,
// partial/interleaved file writes), so this is the "genuinely unsafe, not
// merely untidy" category god asked to identify, not the "untidy" one.
//
// Proven here through the REAL route handler (not a reimplementation),
// using the same "suspend the first call inside its own async gap, let the
// second one run to completion" technique wipeConcurrency.test.js already
// established for the exact same defect shape in the same file.

const getSettingMock = vi.fn(async () => null);
const setSettingMock = vi.fn(async () => {});

vi.mock("../database/init.js", () => ({
  logServerEvent: vi.fn(async () => {}),
  setSetting: (...args) => setSettingMock(...args),
  getSetting: (...args) => getSettingMock(...args),
  getActiveServer: vi.fn(async () => null),
}));

const { default: router } = await import("../routes/server.js");

function createResponse() {
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  return response;
}

function getSteamUpdateHandler() {
  const layer = router.stack.find(
    (entry) =>
      entry.route?.path === "/steam-update" && entry.route.methods.post,
  );
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

let root;
let steamcmdPath;
let installPath;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pz-steamupdate-race-"));
  steamcmdPath = path.join(root, "steamcmd");
  installPath = path.join(root, "install");
  fs.mkdirSync(steamcmdPath, { recursive: true });
  fs.mkdirSync(installPath, { recursive: true });
  // A real, harmless, instantly-exiting fake steamcmd.sh -- getSteamCmdExe()
  // resolves this exact path via fs.existsSync, and the route really does
  // spawn() it. Exits immediately, so nothing lingers past the test.
  const fakeSteamcmd = path.join(steamcmdPath, "steamcmd.sh");
  fs.writeFileSync(fakeSteamcmd, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(fakeSteamcmd, 0o755);

  getSettingMock.mockReset();
  setSettingMock.mockReset();
  setSettingMock.mockResolvedValue(undefined);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("POST /api/server/steam-update concurrency guard", () => {
  it("a second update for the SAME install path arriving while the first is still resolving steamcmdPath is allowed through too -- proving the check-then-await-then-claim gap is real, not just theoretical", async () => {
    const serverManager = {
      getServerProcessDetails: async () => ({ running: false, scanFailed: false }),
    };
    const io = { emit: vi.fn() };
    const app = {
      get: (key) => (key === "serverManager" ? serverManager : key === "io" ? io : undefined),
    };

    let getSettingCalls = 0;
    let releaseFirst;
    getSettingMock.mockImplementation(async (key) => {
      if (key !== "steamcmdPath") return null;
      getSettingCalls += 1;
      if (getSettingCalls === 1) {
        // Suspend request A right inside saveAndResolveSteamCmdExe(), AFTER
        // it has already passed hasActiveSteamOperation() (a synchronous
        // check earlier in the same handler) but BEFORE it reaches the
        // activeSteamOperations.set() claim further down.
        return new Promise((resolve) => {
          releaseFirst = () => resolve(steamcmdPath);
        });
      }
      return steamcmdPath;
    });

    const handler = getSteamUpdateHandler();
    const buildRequest = () => ({
      app,
      body: { steamcmdPath, installPath, branch: "stable" },
    });

    const responseA = createResponse();
    const responseB = createResponse();

    const callA = handler(buildRequest(), responseA);
    // Let A run up through hasActiveSteamOperation() and into the mocked
    // getSetting() await, where it's now suspended.
    await Promise.resolve();
    await Promise.resolve();

    // B starts fresh: its own hasActiveSteamOperation() check runs BEFORE A
    // has claimed anything (A is still suspended), so B should -- per the
    // wipe/restore precedent -- either be refused (if the gap were closed)
    // or sail through (if it isn't).
    const callB = handler(buildRequest(), responseB);
    await callB;

    releaseFirst();
    await callA;

    const status409Calls = [responseA, responseB]
      .map((r) => r.status.mock.calls.map((c) => c[0]))
      .flat();

    // THE FINDING: neither call was refused with 409
    // STEAM_OPERATION_IN_PROGRESS_SERVER -- both were allowed to proceed
    // and (per the route's own code) both went on to spawn SteamCMD against
    // the same installPath. A fixed version of this route (claiming the
    // guard before saveAndResolveSteamCmdExe's await, exactly like
    // wipeInProgress and restoreBackup()'s restoreInProgress already do)
    // would make this assertion fail here instead, the same way the
    // analogous wipe/restore tests fail pre-fix and pass post-fix.
    expect(status409Calls).not.toContain(409);

    // Both fake steamcmd.sh processes exit almost instantly, but their
    // 'close' handlers (which call the real logServerEvent, mocked above)
    // fire on a later tick, after this test's own assertions -- give them
    // one to settle so they don't surface as unhandled-rejection noise on
    // an unrelated later test.
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
});
