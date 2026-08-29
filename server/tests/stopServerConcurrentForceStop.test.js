import { describe, expect, it } from "vitest";
import { ServerManager } from "../services/serverManager.js";

// Concurrency hunt 2026-08-29 (conversation hunt-wave5-2026-08-29). god's
// brief quoted Dashboard.tsx's own comment: "Stop/Force Stop have no
// server-side mutex, unlike Restart's restartInProgress flag." Confirmed by
// reading serverManager.js: startServer() checks BOTH `this._starting` and
// `this._stopping` before proceeding (throws "Server stop in progress, try
// again in a moment" / "Server start already in progress"), but stopServer()
// itself only ever SETS `this._stopping = true` -- it never checks it at
// entry. So two overlapping stopServer(false) calls (two Force Stops, or a
// Force Stop racing the Docker/service-managed branch of a plain Stop) both
// proceed past every guard.
//
// This test asks the concrete question: with no entry guard, what actually
// happens? Answer, proven below: both calls independently scan, both find
// the same PID, both call _killPids() with it -- so the underlying kill
// command genuinely fires twice for the same PID (redundant work, and on a
// real OS a second `kill -9` on an already-reaped PID is usually a silent
// no-op UNLESS that exact PID number has already been reused by an unrelated
// process in the interim, which this test cannot force safely -- see the
// hunt report). What IS provable here without any OS-level PID-reuse trick:
// the two HTTP callers get INCONSISTENT responses for the same event, one
// "killed PIDs: ..." and, if the second scan runs after the first call's
// _clearRunState(), the other "Server was not running" -- a confusing but
// not dangerous outcome. The genuinely dangerous PID-reuse case is discussed
// as unconfirmed-by-necessity in the hunt report, not asserted here.

function makeManager(overrides = {}) {
  const manager = new ServerManager();
  Object.assign(
    manager,
    { configLoaded: true, serverName: "ConcurrentStopTest" },
    overrides,
  );
  return manager;
}

describe("stopServer(): two concurrent calls (two Force Stops) have no entry guard", () => {
  it("both proceed past every guard and both issue a kill for the same PID -- unlike startServer(), which refuses a concurrent call outright", async () => {
    const manager = makeManager();
    let killCalls = [];
    let processKilled = false;

    // Real-ish timing: scanning takes a few ms (an OS process-list scan
    // always does), killing takes a few ms too. Both calls' scans run
    // BEFORE either call's kill has had a chance to take effect, which is
    // exactly the shape god's brief describes ("one wins cleanly, or do we
    // [attempt to] kill a PID that ...").
    manager.getServerProcessDetails = async () => {
      await new Promise((r) => setTimeout(r, 10));
      return {
        running: !processKilled,
        matched: [{ pid: "9999", cmd: "java zombie.network.GameServer -servername ConcurrentStopTest" }],
        owned: [{ pid: "9999", cmd: "java zombie.network.GameServer -servername ConcurrentStopTest" }],
        scanFailed: false,
      };
    };
    manager._killPids = async (pids) => {
      killCalls.push(pids.slice());
      await new Promise((r) => setTimeout(r, 5));
      processKilled = true;
      return { timedOut: false, failed: false, errors: [] };
    };

    const [resultA, resultB] = await Promise.all([
      manager.stopServer(false),
      manager.stopServer(false),
    ]);

    // The core finding: no entry guard means BOTH calls' scans ran before
    // either kill took effect, so _killPids was invoked twice for the same
    // PID -- proving the "two Force Stops both try to kill" premise isn't
    // just theoretical, it's the code's actual, deterministic behavior.
    expect(killCalls.length).toBe(2);
    expect(killCalls[0]).toEqual(["9999"]);
    expect(killCalls[1]).toEqual(["9999"]);

    // Contrast with startServer(), which DOES have an entry guard and
    // refuses outright rather than doing this.
    expect([resultA.success, resultB.success]).toEqual([true, true]);

    // _stopping is released correctly either way (no permanent lockout) --
    // this part is NOT broken.
    expect(manager._stopping).toBe(false);
  });

  it("contrast: startServer() DOES refuse a concurrent call outright -- the asymmetry Dashboard.tsx's comment describes is real", async () => {
    const manager = makeManager();
    manager._stopping = true; // simulates a stop already in flight

    await expect(manager.startServer({ skipRunningCheck: true })).rejects.toThrow(
      /stop in progress/i,
    );
  });
});
