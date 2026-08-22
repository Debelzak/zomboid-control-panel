import { beforeEach, describe, expect, it, vi } from "vitest";

// The vulnerability this file exists to catch, live-found while testing
// something unrelated: authService.middleware() used to exempt the WHOLE
// /api/auth/* prefix from authentication (a blanket startsWith check), so
// req.user was never set for ANY route under it — including ones gated by
// requireRole/requirePermission, whose own "no req.user -> let it through"
// branch (meant for the auth-disabled case) then admitted every request
// regardless of whether a token was even present. Live-confirmed:
// unauthenticated POST /api/auth/users with role:"admin" created a real
// admin account on a fully set-up install. This file proves the fix in
// both directions — the actually-public paths still work with no token,
// and everything else now genuinely requires one.
const settings = new Map();
const db = { data: { users: [{ id: "u1", username: "admin", role: "admin" }] } };

vi.mock("../database/init.js", () => ({
  getSetting: async (key) => settings.get(key) ?? null,
  setSetting: async (key, value) => {
    settings.set(key, value);
  },
  getDb: async () => db,
  commitNow: async () => {},
}));

const { default: authService } = await import("../services/auth.js");

describe("authService.middleware() — /api/auth/* is no longer a blanket exemption", () => {
  let middleware;

  beforeEach(async () => {
    settings.clear();
    db.data.users = [{ id: "u1", username: "admin", role: "admin" }]; // needsSetup() must be false
    await authService.init();
    middleware = authService.middleware();
  });

  async function run(path, { auth = null } = {}) {
    const req = { path, headers: auth ? { authorization: auth } : {} };
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    const next = vi.fn();
    await middleware(req, res, next);
    return { req, res, next };
  }

  const PUBLIC_PATHS = [
    "/api/auth/status",
    "/api/auth/setup",
    "/api/auth/login",
    "/api/auth/refresh",
    "/api/auth/logout",
    "/api/auth/reset-status",
    "/api/auth/reset-token/local",
    "/api/auth/reset-password",
    "/api/auth/recovery-status",
    "/api/auth/recover-with-code",
  ];

  it.each(PUBLIC_PATHS)("still lets %s through with NO token — these are meant to be public", async (path) => {
    const { next, res } = await run(path);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("still lets /api/auth/oidc/* through with no token — Dwight's pre-session flow", async () => {
    const { next } = await run("/api/auth/oidc/login");
    expect(next).toHaveBeenCalledTimes(1);
  });

  const FORMERLY_VULNERABLE_PATHS = [
    "/api/auth/users",
    "/api/auth/me",
    "/api/auth/change-password",
    "/api/auth/recovery-codes",
  ];

  it.each(FORMERLY_VULNERABLE_PATHS)(
    "THE FIX: %s now REFUSES an unauthenticated request instead of silently letting it through",
    async (path) => {
      const { next, res } = await run(path);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    },
  );

  it("the exact live-reproduced case: /api/auth/users with no Authorization header is refused, not admitted", async () => {
    const { next, res } = await run("/api/auth/users");
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "AUTH_REQUIRED" }),
    );
  });

  it("a formerly-vulnerable path DOES work with a valid token — the fix isn't a new blanket refusal either", async () => {
    authService.jwtSecret = "test-secret-for-this-file";
    const jwt = (await import("jsonwebtoken")).default;
    const token = jwt.sign({ userId: "u1", tokenGen: 0 }, authService.jwtSecret);

    const { req, next, res } = await run("/api/auth/users", {
      auth: `Bearer ${token}`,
    });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    // req.user is set as a side effect for downstream requireRole/
    // requirePermission to read — this is the actual thing that was
    // broken (never set at all under the old blanket exemption).
    expect(req.user).toMatchObject({ username: "admin", role: "admin" });
  });
});
