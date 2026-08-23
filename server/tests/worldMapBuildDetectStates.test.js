import { describe, expect, it, vi } from "vitest";
import { mockGetRoleByName } from "./helpers/mockPermissionsDb.js";

// Regression/coverage for the third getB42ResolutionStatus() source state:
// 'client' (the browser resolved the B42 build and supplied it to the
// panel, because the panel host itself couldn't reach the map service).
// Today only 'dynamic' and 'fallback' ever occur at runtime -- the producer
// side (mapProxy.js) doesn't emit 'client' yet -- but the contract is fixed
// (god's dispatch, conv-mapbuild) and this proves the consumer side of
// worldmap.tiles.buildDetect handles all three distinctly, by stubbing the
// status rather than waiting for the producer to land.

vi.mock("../database/init.js", async () => {
  const actual = await vi.importActual("../database/init.js");
  return { ...actual, getRoleByName: mockGetRoleByName };
});

const getB42ResolutionStatus = vi.fn();
vi.mock("../routes/mapProxy.js", async () => {
  const actual = await vi.importActual("../routes/mapProxy.js");
  return { ...actual, getB42ResolutionStatus };
});

const { default: debugRouter } = await import("../routes/debug.js");

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

function getLayer(routePath, method) {
  return debugRouter.stack.find(
    (entry) => entry.route?.path === routePath && entry.route.methods[method],
  );
}

async function runRoute(routePath, method, req) {
  const res = createResponse();
  const layer = getLayer(routePath, method);
  if (!layer) throw new Error(`No ${method.toUpperCase()} ${routePath} route registered`);
  const handlers = layer.route.stack.map((s) => s.handle);
  let idx = -1;
  const next = async (err) => {
    idx++;
    if (err) throw err;
    if (idx < handlers.length) await handlers[idx](req, res, next);
  };
  await next();
  return res;
}

function adminReq(overrides = {}) {
  return {
    user: { role: "admin" },
    params: {},
    query: {},
    body: {},
    app: { get: () => undefined },
    ...overrides,
  };
}

function findCheck(body, id) {
  return body.checks?.find((c) => c.id === id);
}

describe("GET /debug/worldmap: worldmap.tiles.buildDetect reports all three getB42ResolutionStatus() sources distinctly", () => {
  it("source: 'dynamic' -> status ok", async () => {
    getB42ResolutionStatus.mockReturnValue({
      source: "dynamic",
      build: "42.20.0",
      reason: null,
    });

    const res = await runRoute("/worldmap", "get", adminReq());

    expect(res.getStatusCode()).toBe(200);
    const check = findCheck(res.getBody(), "worldmap.tiles.buildDetect");
    expect(check).toBeTruthy();
    expect(check.status).toBe("ok");
    expect(check.message).toContain("42.20.0");
    expect(check.params).toEqual({ build: "42.20.0" });
  });

  it("source: 'client' -> status info, and says the panel host itself can't reach the map service", async () => {
    getB42ResolutionStatus.mockReturnValue({
      source: "client",
      build: "42.20.0",
      reason: null,
    });

    const res = await runRoute("/worldmap", "get", adminReq());

    expect(res.getStatusCode()).toBe(200);
    const check = findCheck(res.getBody(), "worldmap.tiles.buildDetect");
    expect(check).toBeTruthy();
    expect(check.status).toBe("info");
    expect(check.message).toContain("42.20.0");
    expect(check.message.toLowerCase()).toContain("browser");
    expect(check.message.toLowerCase()).toContain("panel host itself could not reach");
    expect(check.params).toEqual({ build: "42.20.0" });
  });

  it("source: 'fallback' -> status warn, same as before the third state existed", async () => {
    getB42ResolutionStatus.mockReturnValue({
      source: "fallback",
      build: "42.19.0",
      reason: "build_list.json listed no B42+ candidates",
    });

    const res = await runRoute("/worldmap", "get", adminReq());

    expect(res.getStatusCode()).toBe(200);
    const check = findCheck(res.getBody(), "worldmap.tiles.buildDetect");
    expect(check).toBeTruthy();
    expect(check.status).toBe("warn");
    expect(check.message).toContain("42.19.0");
    expect(check.message).toContain("build_list.json listed no B42+ candidates");
    expect(check.params).toEqual({
      build: "42.19.0",
      reason: "build_list.json listed no B42+ candidates",
    });
  });

  it("an unrecognized source value fails closed to the warn branch, not the ok branch", async () => {
    // Defensive: any future source value outside the three the contract
    // defines must not be silently treated as healthy.
    getB42ResolutionStatus.mockReturnValue({
      source: "something-not-in-the-contract",
      build: "42.19.0",
      reason: null,
    });

    const res = await runRoute("/worldmap", "get", adminReq());

    const check = findCheck(res.getBody(), "worldmap.tiles.buildDetect");
    expect(check.status).toBe("warn");
  });
});
