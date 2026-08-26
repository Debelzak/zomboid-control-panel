import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { EventEmitter } from "events";

// 2026-08-26 install-failure hunt findings #6 and #1. #6: the game files
// installing is the expensive, hard-to-redo part -- a failure in an
// auxiliary write AFTER that (the RCON .ini pre-create, the startup
// script) used to only log.warn() server-side while install:complete still
// said success:true with no trace of it anywhere the operator could see.
// Now collected into a `warnings` array on the same success:true payload
// instead of either a false flat failure or silence. #1: a watchdog-killed
// SteamCMD process reports code=null to Node's close handler, which used
// to render the literal word "null" in "Installation failed with exit code
// null" -- now its own distinct, accurate message.
//
// spawn() is mocked at module scope, matching unvalidatedPathFixes.test.js's
// established pattern -- server.js binds it as a live import at load time.
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, spawn: (...args) => spawnMock(...args) };
});

vi.mock("../database/init.js", () => ({
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => {}),
  logServerEvent: vi.fn(async () => {}),
  getActiveServer: vi.fn(async () => null),
}));

// Real writeFileAtomic by default (writes to real temp-directory paths
// below) -- each test overrides it only for the one call it wants to fail,
// by inspecting the target path, rather than mocking the whole filesystem.
// `realHolder` is populated from the mock factory's own importOriginal(),
// the only way to reach the real implementation once the module is mocked.
const { writeFileAtomicMock, realHolder } = vi.hoisted(() => ({
  writeFileAtomicMock: vi.fn(),
  realHolder: { fn: null },
}));
vi.mock("../utils/fileWriteQueue.js", async (importOriginal) => {
  const actual = await importOriginal();
  realHolder.fn = actual.writeFileAtomic;
  return {
    ...actual,
    writeFileAtomic: (...args) => writeFileAtomicMock(...args),
  };
});

function createResponse() {
  const response = { status: () => response, json: () => response };
  let statusCode = 200;
  let body = null;
  response.status = (code) => {
    statusCode = code;
    return response;
  };
  response.json = (payload) => {
    body = payload;
    return response;
  };
  response.getStatusCode = () => statusCode;
  response.getBody = () => body;
  return response;
}

function getRouteHandler(router, routePath, method) {
  const layer = router.stack.find(
    (entry) => entry.route?.path === routePath && entry.route.methods[method],
  );
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

// Resolves with the install:complete payload the route handler eventually
// emits, however many ticks that takes -- deterministic, no arbitrary waits.
function fakeIoCapturingComplete() {
  let resolveComplete;
  const completePromise = new Promise((resolve) => {
    resolveComplete = resolve;
  });
  const emitted = [];
  const io = {
    emit: vi.fn((event, payload) => {
      emitted.push({ event, payload });
      if (event === "install:complete") resolveComplete(payload);
    }),
  };
  return { io, completePromise, emitted };
}

describe("POST /api/server/install -- warnings array (finding #6) and watchdog message (finding #1)", () => {
  let tmpRoot;
  let installPath;
  let zomboidDataPath;
  let steamcmdPath;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zcp-install-test-"));
    installPath = path.join(tmpRoot, "server");
    zomboidDataPath = path.join(tmpRoot, "data");
    steamcmdPath = path.join(tmpRoot, "steamcmd");
    fs.mkdirSync(installPath, { recursive: true });
    fs.mkdirSync(zomboidDataPath, { recursive: true });
    fs.mkdirSync(steamcmdPath, { recursive: true });
    // getSteamCmdExe() does a real fs.existsSync check -- give it a real
    // file rather than mocking fs globally (ensureWritableDirectory below
    // needs real fs behavior against the real temp dirs above).
    const steamcmdExeName = process.platform === "win32" ? "steamcmd.exe" : "steamcmd.sh";
    fs.writeFileSync(path.join(steamcmdPath, steamcmdExeName), "");

    spawnMock.mockReset();
    writeFileAtomicMock.mockReset();
    writeFileAtomicMock.mockImplementation((...args) => realHolder.fn(...args));
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function baseBody(overrides = {}) {
    return {
      steamcmdPath,
      installPath,
      serverName: "TestServer",
      branch: "public",
      zomboidDataPath,
      adminPassword: "adminpw",
      rconPassword: "rconpassword123",
      rconPort: 27015,
      serverPort: 16261,
      minMemory: 2,
      maxMemory: 4,
      ...overrides,
    };
  }

  it("reports success with an EMPTY warnings array when nothing fails (baseline, proves the plumbing didn't change normal behavior)", async () => {
    const fakeProc = new EventEmitter();
    fakeProc.stdout = new EventEmitter();
    fakeProc.stderr = new EventEmitter();
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => fakeProc.emit("close", 0));
      return fakeProc;
    });

    const { default: router } = await import("../routes/server.js");
    const { io, completePromise } = fakeIoCapturingComplete();
    const res = createResponse();
    await getRouteHandler(router, "/install", "post")(
      { body: baseBody(), app: { get: (k) => (k === "io" ? io : undefined) } },
      res,
    );

    const payload = await completePromise;
    expect(payload.success).toBe(true);
    expect(payload.warnings).toEqual([]);
  });

  it("collects an INSTALL_RCON_INI_PRECREATE_FAILED warning instead of silently swallowing the failure, and still reports success:true", async () => {
    const fakeProc = new EventEmitter();
    fakeProc.stdout = new EventEmitter();
    fakeProc.stderr = new EventEmitter();
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => fakeProc.emit("close", 0));
      return fakeProc;
    });
    writeFileAtomicMock.mockImplementation((targetPath, ...rest) => {
      if (String(targetPath).endsWith(".ini")) {
        throw new Error("EACCES: permission denied");
      }
      return realHolder.fn(targetPath, ...rest);
    });

    const { default: router } = await import("../routes/server.js");
    const { io, completePromise } = fakeIoCapturingComplete();
    const res = createResponse();
    await getRouteHandler(router, "/install", "post")(
      { body: baseBody(), app: { get: (k) => (k === "io" ? io : undefined) } },
      res,
    );

    const payload = await completePromise;
    expect(payload.success).toBe(true);
    expect(payload.warnings).toHaveLength(1);
    expect(payload.warnings[0]).toMatchObject({
      progressCode: "INSTALL_RCON_INI_PRECREATE_FAILED",
      params: { reason: expect.stringContaining("permission denied") },
    });
  });

  it("collects an INSTALL_STARTUP_SCRIPT_FAILED warning instead of silently swallowing the failure, and still reports success:true", async () => {
    const fakeProc = new EventEmitter();
    fakeProc.stdout = new EventEmitter();
    fakeProc.stderr = new EventEmitter();
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => fakeProc.emit("close", 0));
      return fakeProc;
    });
    writeFileAtomicMock.mockImplementation((targetPath, ...rest) => {
      if (String(targetPath).endsWith(".bat") || String(targetPath).endsWith(".sh")) {
        throw new Error("ENOSPC: no space left on device");
      }
      return realHolder.fn(targetPath, ...rest);
    });

    const { default: router } = await import("../routes/server.js");
    const { io, completePromise } = fakeIoCapturingComplete();
    const res = createResponse();
    await getRouteHandler(router, "/install", "post")(
      { body: baseBody(), app: { get: (k) => (k === "io" ? io : undefined) } },
      res,
    );

    const payload = await completePromise;
    expect(payload.success).toBe(true);
    expect(payload.warnings).toHaveLength(1);
    expect(payload.warnings[0]).toMatchObject({
      progressCode: "INSTALL_STARTUP_SCRIPT_FAILED",
      params: { reason: expect.stringContaining("no space left") },
    });
  });

  it("a watchdog-killed process reports INSTALL_WATCHDOG_KILLED with a real minute count, never the literal word \"null\"", async () => {
    vi.useFakeTimers();
    const fakeProc = new EventEmitter();
    fakeProc.stdout = new EventEmitter();
    fakeProc.stderr = new EventEmitter();
    // Real child_process behavior: a signal-killed process reports
    // code=null to the close handler, not an exit code.
    fakeProc.kill = vi.fn(() => {
      queueMicrotask(() => fakeProc.emit("close", null));
    });
    spawnMock.mockImplementation(() => fakeProc); // never emits close on its own -- only the watchdog's kill() does

    const { default: router } = await import("../routes/server.js");
    const { io, completePromise } = fakeIoCapturingComplete();
    const res = createResponse();
    const handlerDone = getRouteHandler(router, "/install", "post")(
      { body: baseBody(), app: { get: (k) => (k === "io" ? io : undefined) } },
      res,
    );

    // Past the 10-minute idle threshold plus one 30s watchdog tick, with the
    // fake process never having produced any stdout/stderr in between.
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
    await handlerDone;

    const payload = await completePromise;
    expect(fakeProc.kill).toHaveBeenCalled();
    expect(payload.success).toBe(false);
    expect(payload.progressCode).toBe("INSTALL_WATCHDOG_KILLED");
    expect(payload.message).not.toContain("exit code null");
    expect(payload.params).toEqual({ minutes: 10 });
  });
});
