import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";

// 2026-08-29, shutdown-race follow-up to the flushWrites() tmp-leak find:
// database/init.js's own shutdown() and index.js's gracefulShutdown() are
// two independent, unsynchronized listeners on the same SIGTERM/SIGINT.
// The old shutdown() did exactly ONE flushWrites() attempt -- on failure,
// flushWrites() only SCHEDULES a setTimeout backoff retry and returns
// (correct for a live process that will still be around when the timer
// fires). A process that is exiting is not still going to be around for
// that timer: index.js calls httpServer.close(() => process.exit(0)) on
// its own schedule, and with no lingering connections (the normal clean-
// stop case) that fires well before even the 1s minimum backoff elapses,
// abandoning the retry and silently dropping the operator's pending
// config change. flushForShutdown() replaces the one-shot attempt with a
// bounded, REAL retry loop that something about to exit can actually wait
// out.
//
// Real module (not mocked) -- getDataPaths() resolves to this file's own
// isolated temp root via vitest.perFileDataDir.setup.mjs, never the real
// repo data/ directory.
const { flushForShutdown, commitNow, getDb, getCircuitBreakerStatus } =
  await import("../database/init.js");

describe("flushForShutdown()", () => {
  beforeEach(async () => {
    await getDb();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    // _writeRetries/circuit-breaker state is module-level, not per-test --
    // a test that deliberately ends mid-retry (the "gives up" and
    // "never recovers" cases) must not leak that count into the next
    // test's own assertions. A real, unmocked success is the same reset
    // path a live process would take on its very next successful write.
    await commitNow();
  });

  it("succeeds on the first attempt when nothing is contending -- the normal shutdown case", async () => {
    const start = Date.now();
    // commitNow() marks dirty and flushes once already (real success);
    // flushForShutdown() is what a shutdown listener calls afterwards, and
    // with nothing pending it must return immediately -- true, and fast.
    await commitNow();
    const settled = await flushForShutdown();
    const elapsedMs = Date.now() - start;

    expect(settled).toBe(true);
    // No retries were needed, so this must be near-instant -- proves the
    // normal shutdown path isn't paying the retry-delay cost at all, let
    // alone hanging. Generous margin for CI jitter; the real cost of zero
    // retries is a single local disk write.
    expect(elapsedMs).toBeLessThan(500);
  });

  it("retries a transient rename failure and lands the write, well within the bound", async () => {
    let renameCalls = 0;
    const realRename = fs.renameSync.bind(fs);
    vi.spyOn(fs, "renameSync").mockImplementation((...args) => {
      renameCalls++;
      if (renameCalls === 1) {
        const err = new Error("EPERM: simulated transient rename failure");
        err.code = "EPERM";
        throw err;
      }
      return realRename(...args);
    });

    // Mark dirty without a real disk write racing commitNow()'s own flush.
    const { setSetting } = await import("../database/init.js");
    await setSetting("shutdownFlushProbe", "1");

    const start = Date.now();
    const settled = await flushForShutdown();
    const elapsedMs = Date.now() - start;

    expect(settled).toBe(true); // the retry landed it
    expect(renameCalls).toBe(2); // one failure, one real success
    expect(elapsedMs).toBeLessThan(2000); // bounded: attempts * fixed delay, not exponential backoff
  });

  it("THE RISKY HALF: gives up after a bounded number of attempts when the write can NEVER succeed -- proves this cannot hang shutdown forever", async () => {
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      const err = new Error("ENOSPC: simulated disk full, never recovers");
      err.code = "ENOSPC";
      throw err;
    });

    const { setSetting } = await import("../database/init.js");
    await setSetting("shutdownFlushProbe", "2");

    const start = Date.now();
    const settled = await flushForShutdown();
    const elapsedMs = Date.now() - start;

    expect(settled).toBe(false); // honestly reports it did NOT land
    // Bounded by attempt count * fixed delay, not by flushWrites()'s own
    // exponential backoff (which alone could run past a minute) and not
    // unbounded -- this is the assertion that turns "a fix that makes
    // shutdown wait for a flush that can never succeed" into "a panel that
    // will not stop" into a proven non-issue instead of an assumption.
    expect(elapsedMs).toBeLessThan(2000);
  });

  it("does not disturb flushWrites()'s own retry/circuit-breaker bookkeeping", async () => {
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      const err = new Error("EBUSY: simulated persistent rename failure");
      err.code = "EBUSY";
      throw err;
    });

    const { setSetting } = await import("../database/init.js");
    await setSetting("shutdownFlushProbe", "3");

    await flushForShutdown();

    const status = getCircuitBreakerStatus();
    expect(status.lastError).toMatch(/EBUSY/);
    // flushForShutdown() made 3 real attempts (all through flushWrites(),
    // which increments _writeRetries itself each time) -- same counter,
    // same source of truth the storage-health banner already reads.
    expect(status.failCount).toBe(3);
  });
});
