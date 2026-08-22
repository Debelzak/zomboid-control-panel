import { describe, expect, it, vi } from "vitest";

// GET /api/server/branches derived an executable path from
// req.query.steamcmdPath and spawned it directly -- the only path-taking
// route in server.js that skipped the isValidPath() check every sibling
// route applies. Once role-gated to admin+technician that was reachable
// authority to run an attacker-chosen binary as the panel process, not just
// a known one in a validated location (per god's ruling: identical role
// labels hiding different authority is how an escalation stays invisible).
// Same class of bug existed in panelBridge.js's /configure and /auto-detect,
// which fed an unvalidated path straight into bridge.configure()/autoDetect()
// -- no validation there either, and it flows into mkdirSync/writeFileSync
// once the bridge starts. This file exercises the fix, not just the role gate.

vi.mock("../database/init.js", () => ({
  getSetting: vi.fn(async (key) => (key === "steamcmdPath" ? null : null)),
  setSetting: vi.fn(async () => {}),
  logServerEvent: vi.fn(async () => {}),
  getActiveServer: vi.fn(async () => null),
}));

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
  // Last handler in the stack: requireRole runs first, the real logic last.
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe("GET /api/server/branches rejects an unvalidated steamcmdPath", () => {
  it("refuses a relative path with 400 instead of deriving an executable from it", async () => {
    const { default: router } = await import("../routes/server.js");
    const res = createResponse();
    await getRouteHandler(router, "/branches", "get")(
      { query: { steamcmdPath: "relative/not/absolute" }, app: { get: () => undefined } },
      res,
    );
    expect(res.getStatusCode()).toBe(400);
    expect(res.getBody()).toEqual({ error: "Invalid SteamCMD path" });
  });

  it("falls back normally for a valid absolute path that just doesn't exist", async () => {
    const { default: router } = await import("../routes/server.js");
    const res = createResponse();
    await getRouteHandler(router, "/branches", "get")(
      {
        query: { steamcmdPath: process.platform === "win32" ? "C:\\nonexistent-steamcmd" : "/nonexistent/steamcmd" },
        app: { get: () => undefined },
      },
      res,
    );
    expect(res.getStatusCode()).toBe(200);
    expect(res.getBody()).toEqual(
      expect.objectContaining({ source: "fallback" }),
    );
  });
});

describe("panelBridge.js /configure and /auto-detect reject an unvalidated path", () => {
  it("POST /configure refuses a relative zomboidSavePath", async () => {
    const { default: router } = await import("../routes/panelBridge.js");
    const res = createResponse();
    await getRouteHandler(router, "/configure", "post")(
      { body: { zomboidSavePath: "relative/save/path" } },
      res,
    );
    expect(res.getStatusCode()).toBe(400);
    expect(res.getBody()).toEqual({ error: "Invalid zomboidSavePath" });
  });

  it("POST /configure refuses a protected system directory", async () => {
    const { default: router } = await import("../routes/panelBridge.js");
    const res = createResponse();
    const systemPath = process.platform === "win32" ? "C:\\Windows\\evil" : "/etc/evil";
    await getRouteHandler(router, "/configure", "post")(
      { body: { zomboidSavePath: systemPath } },
      res,
    );
    expect(res.getStatusCode()).toBe(400);
  });

  it("POST /auto-detect refuses a relative zomboidUserFolder when provided", async () => {
    const { default: router } = await import("../routes/panelBridge.js");
    const res = createResponse();
    await getRouteHandler(router, "/auto-detect", "post")(
      { body: { serverName: "servertest", zomboidUserFolder: "relative/folder" } },
      res,
    );
    expect(res.getStatusCode()).toBe(400);
    expect(res.getBody()).toEqual({ error: "Invalid zomboidUserFolder path" });
  });

  it("POST /configure-direct refuses a relative bridgePath (the isAbsolute check was checking path.resolve()'s result, which is always absolute -- a no-op that never rejected anything)", async () => {
    const { default: router } = await import("../routes/panelBridge.js");
    const res = createResponse();
    await getRouteHandler(router, "/configure-direct", "post")(
      { body: { bridgePath: "relative/bridge/path" } },
      res,
    );
    expect(res.getStatusCode()).toBe(400);
    expect(res.getBody()).toEqual({ error: "Path must be absolute" });
  });

  it("POST /configure-direct still refuses a protected system directory (pre-existing check, now sharing the same blocklist)", async () => {
    const { default: router } = await import("../routes/panelBridge.js");
    const res = createResponse();
    const systemPath = process.platform === "win32" ? "C:\\Windows\\evil" : "/etc/evil";
    await getRouteHandler(router, "/configure-direct", "post")(
      { body: { bridgePath: systemPath } },
      res,
    );
    expect(res.getStatusCode()).toBe(400);
    expect(res.getBody()).toEqual({ error: "Path targets a protected system directory" });
  });
});

describe("config.js PUT /paths requires absolute paths (feeds server.js's /wipe destructively)", () => {
  it("refuses a relative savePath", async () => {
    const { default: router } = await import("../routes/config.js");
    const res = createResponse();
    const serverManager = { updatePaths: vi.fn() };
    await getRouteHandler(router, "/paths", "put")(
      { body: { savePath: "relative/save" }, app: { get: () => serverManager } },
      res,
    );
    expect(res.getStatusCode()).toBe(400);
    expect(res.getBody()).toEqual({ error: "Invalid save path" });
    expect(serverManager.updatePaths).not.toHaveBeenCalled();
  });

  it("accepts an absolute savePath with no traversal", async () => {
    const { default: router } = await import("../routes/config.js");
    const res = createResponse();
    const serverManager = { updatePaths: vi.fn() };
    const absolutePath = process.platform === "win32" ? "C:\\pz\\saves" : "/srv/pz/saves";
    await getRouteHandler(router, "/paths", "put")(
      { body: { savePath: absolutePath }, app: { get: () => serverManager } },
      res,
    );
    expect(res.getStatusCode()).toBe(200);
    expect(serverManager.updatePaths).toHaveBeenCalledWith(undefined, absolutePath);
  });
});
