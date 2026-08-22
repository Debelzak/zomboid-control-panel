import { describe, expect, it } from "vitest";

// server.js is the headline gap: 44 routes, only 2 had a requireRole call.
// /start, /stop, /restart, /install, /configure-rcon etc. were reachable by
// any logged-in account, including moderator -- worse than debug.js, because
// this can stop the server everybody is playing on or reconfigure RCON.
// Same standard as the rest of the sweep: every group asserts BOTH
// directions, so a test file that only proves "moderator refused" would
// pass just as well if the whole file had been locked to admin.

function createResponse() {
  const response = { status: () => response, json: () => response };
  let statusCode = 200;
  response.status = (code) => {
    statusCode = code;
    return response;
  };
  response.getStatusCode = () => statusCode;
  return response;
}

function getGate(router, routePath, method) {
  const layer = router.stack.find(
    (entry) => entry.route?.path === routePath && entry.route.methods[method],
  );
  if (!layer) throw new Error(`No ${method.toUpperCase()} ${routePath} route registered`);
  // requireRole is always the first handler on the routes that have one.
  return layer.route.stack[0].handle;
}

async function runGate(router, routePath, method, role) {
  const res = createResponse();
  let calledNext = false;
  await getGate(router, routePath, method)(
    { user: { role } },
    res,
    () => {
      calledNext = true;
    },
  );
  return { res, calledNext };
}

describe("server.js: server.control (start/stop/restart/save the running process) -- admin+technician", () => {
  const ROUTES = [
    ["/start", "post"],
    ["/stop", "post"],
    ["/force-stop", "post"],
    ["/restart", "post"],
    ["/save", "post"],
  ];

  it.each(ROUTES)("refuses a moderator on %s %s", async (routePath, method) => {
    const { default: router } = await import("../routes/server.js");
    const { res } = await runGate(router, routePath, method, "moderator");
    expect(res.getStatusCode()).toBe(403);
  });

  it.each(ROUTES)("does not refuse a technician on %s %s", async (routePath, method) => {
    const { default: router } = await import("../routes/server.js");
    const { calledNext } = await runGate(router, routePath, method, "technician");
    expect(calledNext).toBe(true);
  });
});

describe("server.js: server.install (SteamCMD install/update, filesystem browse for setup) -- admin+technician", () => {
  const ROUTES = [
    ["/install", "post"],
    ["/quick-setup", "post"],
    ["/steam-update", "post"],
    ["/steamcmd/download", "post"],
    ["/steamcmd/check", "get"],
    ["/branches", "get"],
    ["/list-directory", "post"],
    ["/browse-folder", "post"],
  ];

  it.each(ROUTES)("refuses a moderator on %s %s", async (routePath, method) => {
    const { default: router } = await import("../routes/server.js");
    const { res } = await runGate(router, routePath, method, "moderator");
    expect(res.getStatusCode()).toBe(403);
  });

  it.each(ROUTES)("does not refuse a technician on %s %s", async (routePath, method) => {
    const { default: router } = await import("../routes/server.js");
    const { calledNext } = await runGate(router, routePath, method, "technician");
    expect(calledNext).toBe(true);
  });
});

describe("server.js: server.configure (RCON/network .ini edits, diagnostic settings) -- admin+technician", () => {
  const ROUTES = [
    ["/configure-rcon", "post"],
    ["/configure-network", "post"],
    ["/reloadlua", "post"],
    ["/log", "post"],
    ["/stats", "post"],
    ["/console-log/clear", "post"],
    ["/update-check/interval", "post"],
  ];

  it.each(ROUTES)("refuses a moderator on %s %s", async (routePath, method) => {
    const { default: router } = await import("../routes/server.js");
    const { res } = await runGate(router, routePath, method, "moderator");
    expect(res.getStatusCode()).toBe(403);
  });

  it.each(ROUTES)("does not refuse a technician on %s %s", async (routePath, method) => {
    const { default: router } = await import("../routes/server.js");
    const { calledNext } = await runGate(router, routePath, method, "technician");
    expect(calledNext).toBe(true);
  });
});

describe("server.js: server.wipe (destroys the live world for everyone) -- admin only", () => {
  const ROUTES = [
    ["/wipe/preview", "post"],
    ["/wipe", "post"],
    ["/delete-files", "post"],
  ];

  it.each(ROUTES)("refuses a technician on %s %s", async (routePath, method) => {
    const { default: router } = await import("../routes/server.js");
    const { res } = await runGate(router, routePath, method, "technician");
    expect(res.getStatusCode()).toBe(403);
  });

  it.each(ROUTES)("does not refuse an admin on %s %s", async (routePath, method) => {
    const { default: router } = await import("../routes/server.js");
    const { calledNext } = await runGate(router, routePath, method, "admin");
    expect(calledNext).toBe(true);
  });
});

describe("server.js: read-only status/info and in-game/GM authority stay open to every role", () => {
  const OPEN_GET = [
    ["/status", "get"],
    ["/network-interfaces", "get"],
    ["/steamcmd/detect", "get"],
    ["/console-log", "get"],
    ["/console-log/error-count", "get"],
    ["/console-log/stream", "get"],
    ["/update-check", "get"],
    ["/update-check/status", "get"],
  ];
  const OPEN_POST = [
    ["/message", "post"],
    ["/weather/start-rain", "post"],
    ["/weather/stop-rain", "post"],
    ["/weather/start-storm", "post"],
    ["/weather/stop", "post"],
    ["/events/chopper", "post"],
    ["/events/gunshot", "post"],
    ["/events/lightning", "post"],
    ["/events/thunder", "post"],
    ["/events/horde", "post"],
    ["/alarm", "post"],
    ["/removezombies", "post"],
    ["/releasesafehouse", "post"],
  ];

  it.each([...OPEN_GET, ...OPEN_POST])(
    "%s %s has no requireRole gate ahead of its handler",
    async (routePath, method) => {
      const { default: router } = await import("../routes/server.js");
      const layer = router.stack.find(
        (entry) => entry.route?.path === routePath && entry.route.methods[method],
      );
      expect(layer.route.stack.length).toBe(1);
    },
  );
});
