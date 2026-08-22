import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

// Behavioral test for build.js's generated Start.bat crash-loop supervisor
// (build.js's generateStartBat()). This does NOT grep the template text --
// it generates the real file, points it at a controllable stub binary named
// like the real panel exe, and asserts on what the supervisor actually does:
// how many times it launches the stub, what its own exit code is, and what
// it wrote to logs\supervisor.log. A text-grep test would prove the string
// "MAX_RAPID_CRASHES" is present, not that the loop behaves -- this proves
// the behavior.
//
// Windows-only: this is a Windows batch supervisor, and this repo's CI runs
// on ubuntu-latest (no cmd.exe). It also needs a C# compiler to build the
// stub as a real .exe (a renamed .bat can't stand in for ZomboidControlPanel.exe --
// Windows dispatches by PE header, not extension). Both are skipped with an
// explicit, visible reason rather than silently vanishing from the run.
const isWindows = process.platform === "win32";
const CSC_PATH =
  "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";
const hasCsc = isWindows && fs.existsSync(CSC_PATH);
const skipReason = !isWindows
  ? `Windows-only supervisor test, running on ${process.platform}`
  : !hasCsc
    ? "legacy .NET Framework csc.exe not found -- cannot build the stub exe"
    : null;

const STUB_SOURCE = `
using System;
using System.IO;

// Controllable stand-in for ZomboidControlPanel.exe. Reads exit-codes.txt and
// sleep-ms.txt (one value per line, one per invocation; the last line
// repeats if invoked more times than there are lines) from its own
// directory, tracks its invocation count via a counter file, sleeps, then
// exits with the chosen code -- so a test can script a whole run history
// ("crash, crash, stay up, crash, clean exit") without touching the real
// panel binary.
class Stub {
  static int Main() {
    string dir = AppDomain.CurrentDomain.BaseDirectory;
    string counterPath = Path.Combine(dir, "invoke-count.txt");
    int invocation = 0;
    if (File.Exists(counterPath)) {
      int.TryParse(File.ReadAllText(counterPath).Trim(), out invocation);
    }
    File.WriteAllText(counterPath, (invocation + 1).ToString());

    int code = ReadIndexed(Path.Combine(dir, "exit-codes.txt"), invocation, 0);
    int sleepMs = ReadIndexed(Path.Combine(dir, "sleep-ms.txt"), invocation, 0);

    if (sleepMs > 0) System.Threading.Thread.Sleep(sleepMs);
    Console.WriteLine("stub invocation " + invocation + " exiting with code " + code);
    return code;
  }

  static int ReadIndexed(string path, int index, int fallback) {
    if (!File.Exists(path)) return fallback;
    var lines = File.ReadAllLines(path);
    if (lines.Length == 0) return fallback;
    int i = index < lines.Length ? index : lines.Length - 1;
    int val;
    return int.TryParse(lines[i].Trim(), out val) ? val : fallback;
  }
}
`;

let sharedDir;
let stubExePath;
let generateStartBat;

async function writeStartBatInto(dir) {
  fs.writeFileSync(path.join(dir, "Start.bat"), generateStartBat());
}

function setupStub(dir, exitCodes, sleepMsList) {
  fs.copyFileSync(stubExePath, path.join(dir, "ZomboidControlPanel.exe"));
  fs.writeFileSync(path.join(dir, "exit-codes.txt"), exitCodes.join("\n"));
  fs.writeFileSync(
    path.join(dir, "sleep-ms.txt"),
    (sleepMsList || [0]).join("\n"),
  );
}

// Async, not spawnSync -- spawnSync's own timeout only SIGTERMs the direct
// cmd.exe child. On Windows that child's own children (powershell.exe doing
// a timestamp lookup or Start-Sleep, or the panel .exe itself mid-launch)
// are NOT tied into a job object automatically, so killing cmd.exe orphans
// them: they keep running and keep the panel .exe file locked. Confirmed
// empirically while diagnosing this file's flake -- a spawnSync-timed-out
// run's own scenario directory couldn't even be deleted afterward
// (fs.rmSync raised EPERM on the panel .exe, still held open by a process
// spawnSync had already reported as killed). An orphan surviving one test
// also eats CPU/IO for every test that runs after it, compounding exactly
// the kind of load-dependent slowness this file is trying not to be
// sensitive to. taskkill /T kills the whole process tree, not just the one
// PID Node knows about.
function runSupervisor(dir, env, timeoutMs) {
  const childEnv = { ...process.env, ...env };
  // Strip any sandbox-imposed executable-search hardening from the child so
  // this test reflects a normal operator machine, not this CI/dev
  // environment's own shell settings. Windows env var names are
  // case-insensitive, but a plain object built from a `{...process.env}`
  // spread is case-SENSITIVE -- vitest's worker exposes this one in a
  // different case than a plain shell does, so match by name, not by exact
  // key, or the delete silently no-ops.
  for (const key of Object.keys(childEnv)) {
    if (key.toLowerCase() === "nodefaultcurrentdirectoryinexepath") {
      delete childEnv[key];
    }
  }
  return new Promise((resolve) => {
    const child = spawn("cmd.exe", ["/c", path.join(dir, "Start.bat")], {
      cwd: dir,
      env: childEnv,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    // Matches spawnSync's old `input: ""` -- no input, stdin closed
    // immediately so a stray "Press any key to continue" doesn't hang.
    child.stdin.end();

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
        });
      } catch {
        /* already gone */
      }
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        status: timedOut ? null : code,
        signal: timedOut ? "SIGTERM" : null,
        stdout,
        stderr,
      });
    });
  });
}

function countLaunches(stdout) {
  return ((stdout || "").match(/^Launching /gm) || []).length;
}

function readSupervisorLog(dir) {
  const p = path.join(dir, "logs", "supervisor.log");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

// Real elapsed seconds between the FIRST log line matching `pattern` and
// the next line after it -- used to prove a backoff wait actually happened
// (not just that the log line claiming it did exists). :stamp's timestamps
// are whole-second (`Get-Date -Format 'yyyy-MM-dd HH:mm:ss'`), not
// millisecond, so this is a coarse measurement -- good enough to tell "it
// waited approximately N seconds" from "it didn't wait at all", which is
// all this needs to prove.
function secondsBetweenLogLine(log, pattern) {
  const lines = log.split("\n").filter(Boolean);
  const idx = lines.findIndex((l) => pattern.test(l));
  if (idx === -1 || idx + 1 >= lines.length) return null;
  const stampOf = (line) => {
    const m = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/);
    return m ? new Date(m[1].replace(" ", "T")) : null;
  };
  const from = stampOf(lines[idx]);
  const to = stampOf(lines[idx + 1]);
  if (!from || !to) return null;
  return (to.getTime() - from.getTime()) / 1000;
}

function freshScenarioDir(name) {
  const dir = path.join(sharedDir, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe.skipIf(!!skipReason)(
  "Start.bat supervisor crash-loop behavior",
  () => {
    beforeAll(async () => {
      ({ generateStartBat } = await import("../../build.js"));

      sharedDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "pz-supervisor-test-"),
      );
      const srcPath = path.join(sharedDir, "stub.cs");
      fs.writeFileSync(srcPath, STUB_SOURCE);
      stubExePath = path.join(sharedDir, "ZomboidControlPanel.exe");
      execFileSync(
        CSC_PATH,
        ["-nologo", "-optimize", "-out:" + stubExePath, srcPath],
        { stdio: "pipe" },
      );
    }, 30000);

    afterAll(() => {
      if (sharedDir) fs.rmSync(sharedDir, { recursive: true, force: true });
    });

    // Every timeout in this file was widened together, not just the one
    // scenario originally reported flaky. While diagnosing that one, three
    // DIFFERENT tests in this same file failed in the same way (an
    // undercounted launch total from a run that got killed by ITS OWN
    // still-too-tight timeout) across a validation batch of ~20 runs under
    // this floor's real concurrent load -- the tight-timeout vulnerability
    // was never specific to the stable-run scenario, just most exposed by
    // it (extra loop iterations, a mandatory real sleep). Every scenario
    // here spawns several real powershell.exe processes per loop iteration
    // (a binary-pick, a timestamp lookup, sometimes a backoff Start-Sleep),
    // and this floor runs many agents' processes concurrently, so
    // individual spawn latency is genuinely variable, not a fixed cost.
    it(
      "does not relaunch a clean exit (code 0)",
      async () => {
        const dir = freshScenarioDir("clean-exit");
        await writeStartBatInto(dir);
        setupStub(dir, [0], [0]);

        const result = await runSupervisor(dir, {}, 30000);

        expect(countLaunches(result.stdout)).toBe(1);
        expect(result.status).toBe(0);
        expect(readSupervisorLog(dir)).not.toMatch(/relaunch attempt/i);
      },
      45000,
    );

    it(
      "relaunches once after a crash, then stops cleanly once the panel recovers",
      async () => {
        const dir = freshScenarioDir("recover-after-crash");
        await writeStartBatInto(dir);
        setupStub(dir, [7, 0], [0, 0]);

        const result = await runSupervisor(
          dir,
          { PANEL_SUPERVISOR_BACKOFF_SECONDS: "0" },
          35000,
        );

        expect(countLaunches(result.stdout)).toBe(2);
        expect(result.status).toBe(0);
        const log = readSupervisorLog(dir);
        expect(log).toMatch(/relaunch attempt 1 of 5/);
        expect(log).not.toMatch(/Gave up/);
      },
      50000,
    );

    it(
      "a non-zero backoff actually waits, not just claims to in the log -- the branch every other test in this file sets to 0 and skips",
      async () => {
        // Every other scenario here uses PANEL_SUPERVISOR_BACKOFF_SECONDS=0
        // to stay fast, which means none of them could ever catch a
        // regression that broke the real Start-Sleep wait -- including the
        // build.js change that made BACKOFF=0 skip the powershell spawn
        // entirely: a bug in that change's `if !BACKOFF! GTR 0` condition
        // could just as easily skip a REAL backoff, and every existing
        // test would still go green. A real operator relies on this
        // branch, not the zero-second one.
        const dir = freshScenarioDir("real-backoff-wait");
        await writeStartBatInto(dir);
        setupStub(dir, [7, 0], [0, 0]);

        const result = await runSupervisor(dir, { PANEL_SUPERVISOR_BACKOFF_SECONDS: "3" }, 30000);

        expect(countLaunches(result.stdout)).toBe(2);
        expect(result.status).toBe(0);
        const log = readSupervisorLog(dir);
        expect(log).toMatch(/relaunch attempt 1 of 5, waiting 3s/);
        // The measured gap includes the 3s sleep plus the next iteration's
        // own binary-pick/timestamp overhead (a couple more real
        // powershell spawns), so it will usually run a bit over 3 -- the
        // floor at 2 (not 3) is only to absorb :stamp's whole-second
        // timestamp rounding at a worst-case boundary, the same margin
        // reasoning already used by the crash-counter-reset test above. If
        // the wait were skipped entirely, this would measure 0-1, not 2+.
        const gapSeconds = secondsBetweenLogLine(log, /relaunch attempt 1 of 5, waiting 3s/);
        expect(gapSeconds, "measured gap between the wait message and the next launch").not.toBeNull();
        expect(gapSeconds).toBeGreaterThanOrEqual(2);
      },
      35000,
    );

    it(
      "stops and surfaces the exit code once repeated crashes exceed the cap",
      async () => {
        const dir = freshScenarioDir("hits-cap");
        await writeStartBatInto(dir);
        setupStub(dir, [7], [0]);

        const result = await runSupervisor(
          dir,
          {
            PANEL_SUPERVISOR_BACKOFF_SECONDS: "0",
            PANEL_SUPERVISOR_MAX_CRASHES: "3",
          },
          35000,
        );

        // cap=3 allows 3 relaunches (4 total launches) before giving up on
        // the 4th crash.
        expect(countLaunches(result.stdout)).toBe(4);
        expect(result.status).toBe(7);
        const log = readSupervisorLog(dir);
        expect(log).toMatch(/relaunch attempt 1 of 3/);
        expect(log).toMatch(/relaunch attempt 2 of 3/);
        expect(log).toMatch(/relaunch attempt 3 of 3/);
        expect(log).toMatch(/Gave up after 4 rapid crashes/);
      },
      50000,
    );

    it(
      "still loops immediately on exit code 75 (update path), unaffected by the crash cap",
      async () => {
        const dir = freshScenarioDir("update-loop");
        await writeStartBatInto(dir);
        setupStub(dir, [75, 75, 0], [0, 0, 0]);

        const result = await runSupervisor(
          dir,
          { PANEL_SUPERVISOR_MAX_CRASHES: "1" },
          30000,
        );

        expect(countLaunches(result.stdout)).toBe(3);
        expect(result.status).toBe(0);
        const log = readSupervisorLog(dir);
        // Exit 75 is a requested update, never a "crash" -- it must never
        // produce a relaunch-attempt/backoff message or count against the cap.
        expect(log).not.toMatch(/relaunch attempt/);
        expect(log).not.toMatch(/Gave up/);
      },
      45000,
    );

    it(
      "resets the crash counter after a run that stays up long enough, so the cap never trips",
      async () => {
        const dir = freshScenarioDir("resets-after-stable-run");
        await writeStartBatInto(dir);
        // Crash, stay up ~2.5s, crash again, then exit cleanly. With
        // MAX_CRASHES=1 this would give up on the very first relaunch if the
        // counter did NOT reset after the stable run. The uptime check
        // compares whole-second epoch timestamps (floor'd, not rounded), so
        // the sleep needs enough margin over the 1s override below that a
        // worst-case truncation at both ends still lands >= 1s -- 2.5s of
        // real sleep guarantees that; something closer to 1.0-1.5s would be
        // a flaky test, not a bug in the supervisor.
        setupStub(dir, [7, 7, 0], [0, 2500, 0]);

        // Timeout, not the assertion, is what was flaky: diagnosed by
        // instrumenting Start.bat itself (not this test) to log at every
        // decision point, then running the real scenario several dozen
        // times back to back outside vitest. The crash-counter-reset logic
        // fired correctly, with an accurate uptime value, on every single
        // run that finished -- never once a wrong reset or a missed one.
        // What varied wildly was how long it took to get there: this
        // scenario needs ~8-10 real powershell.exe subprocess spawns (a
        // timestamp lookup and a binary pick each loop iteration, a
        // Start-Sleep for backoff after each crash), and under this
        // floor's actual concurrent load, measured total durations for
        // IDENTICAL code and inputs ranged from ~7.3s up past the old
        // 15000ms ceiling. 45000ms is 3x the worst completed run observed,
        // not a number picked by trial and error -- and this test was not
        // the only one in the file this actually affected; see the block
        // comment above the first `it(` in this describe for what a full
        // validation pass turned up.
        const result = await runSupervisor(
          dir,
          {
            PANEL_SUPERVISOR_BACKOFF_SECONDS: "0",
            PANEL_SUPERVISOR_MAX_CRASHES: "1",
            PANEL_SUPERVISOR_MIN_STABLE_SECONDS: "1",
          },
          45000,
        );

        expect(countLaunches(result.stdout)).toBe(3);
        expect(result.status).toBe(0);
        const log = readSupervisorLog(dir);
        expect(log).toMatch(/resetting crash counter/);
        expect(log).not.toMatch(/Gave up/);
      },
      60000,
    );
  },
);

if (skipReason) {
  it.skip(`Start.bat supervisor crash-loop behavior (skipped: ${skipReason})`, () => {});
}
