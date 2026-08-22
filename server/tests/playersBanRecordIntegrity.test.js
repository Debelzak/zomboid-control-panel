import { beforeEach, describe, expect, it, vi } from "vitest";

const logPlayerAction = vi.fn();
const addSteamIdBan = vi.fn();
const removeSteamIdBan = vi.fn();

vi.mock("../database/init.js", () => ({
  logPlayerAction,
  getPlayerLogs: vi.fn(),
  getPlayerNotes: vi.fn(),
  getPlayerNote: vi.fn(),
  upsertPlayerNote: vi.fn(),
  deletePlayerNote: vi.fn(),
  getPlayerStats: vi.fn(),
  getPlayerStat: vi.fn(),
  getSteamIdBans: vi.fn(),
  addSteamIdBan,
  removeSteamIdBan,
  getActiveServer: vi.fn(),
}));

vi.mock("../services/panelBridge.js", () => ({
  default: { isRunning: false, sendCommand: vi.fn() },
}));

const { default: router } = await import("../routes/players.js");

function createResponse() {
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  return response;
}

function getRouteHandler(method, routePath) {
  const layer = router.stack.find(
    (entry) => entry.route?.path === routePath && entry.route.methods[method],
  );
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createRequest(body, rconService) {
  return { body, app: { get: () => rconService } };
}

// Root cause (Angela): RconService.execute() resolves {success:false} rather
// than throwing when RCON is unreachable (server offline / mid-restart) — the
// exact moment an operator is most likely to be banning someone. Every route
// below used to write its persistent record (the SteamID ban list, or the
// player activity log) unconditionally, regardless of whether the RCON call
// that record describes actually happened. A ban list or activity log that
// disagrees with the real server state never self-corrects.
describe("players routes: persistent records only written on RCON success", () => {
  beforeEach(() => {
    logPlayerAction.mockReset();
    addSteamIdBan.mockReset();
    removeSteamIdBan.mockReset();
  });

  describe("POST /banid", () => {
    const steamId = "12345678901234567";

    it("adds the SteamID ban and logs the action when RCON succeeds", async () => {
      const rconService = {
        banSteamId: vi.fn(async () => ({ success: true, response: "ok" })),
      };
      const response = createResponse();

      await getRouteHandler("post", "/banid")(
        createRequest({ steamId, reason: "griefing" }, rconService),
        response,
      );

      expect(addSteamIdBan).toHaveBeenCalledWith(steamId, "griefing");
      expect(logPlayerAction).toHaveBeenCalledWith(steamId, "banid", "griefing");
      expect(response.json).toHaveBeenCalledWith({ success: true, response: "ok" });
    });

    it("does NOT add the SteamID ban or log the action when RCON reports failure (server offline)", async () => {
      const rconService = {
        banSteamId: vi.fn(async () => ({
          success: false,
          error: "Server is not running",
        })),
      };
      const response = createResponse();

      await getRouteHandler("post", "/banid")(
        createRequest({ steamId, reason: "griefing" }, rconService),
        response,
      );

      expect(addSteamIdBan).not.toHaveBeenCalled();
      expect(logPlayerAction).not.toHaveBeenCalled();
      // The response is untouched and already carries success:false through
      // to the caller -- proving the record is not written is meaningless if
      // the caller can't also see that nothing happened.
      expect(response.json).toHaveBeenCalledWith({
        success: false,
        error: "Server is not running",
      });
    });
  });

  describe("POST /unbanid", () => {
    const steamId = "12345678901234567";

    it("removes the SteamID ban and logs the action when RCON succeeds", async () => {
      const rconService = {
        unbanSteamId: vi.fn(async () => ({ success: true, response: "ok" })),
      };
      const response = createResponse();

      await getRouteHandler("post", "/unbanid")(
        createRequest({ steamId }, rconService),
        response,
      );

      expect(removeSteamIdBan).toHaveBeenCalledWith(steamId);
      expect(logPlayerAction).toHaveBeenCalledWith(steamId, "unbanid", null);
    });

    it("does NOT remove the SteamID ban when RCON reports failure -- the panel must not claim someone is unbanned when the server still enforces it", async () => {
      const rconService = {
        unbanSteamId: vi.fn(async () => ({
          success: false,
          error: "Server is not running",
        })),
      };
      const response = createResponse();

      await getRouteHandler("post", "/unbanid")(
        createRequest({ steamId }, rconService),
        response,
      );

      expect(removeSteamIdBan).not.toHaveBeenCalled();
      expect(logPlayerAction).not.toHaveBeenCalled();
    });
  });

  describe("POST /unban", () => {
    it("logs the action when RCON succeeds", async () => {
      const rconService = {
        unbanPlayer: vi.fn(async () => ({ success: true, response: "ok" })),
      };
      const response = createResponse();

      await getRouteHandler("post", "/unban")(
        createRequest({ username: "Bob" }, rconService),
        response,
      );

      expect(logPlayerAction).toHaveBeenCalledWith("Bob", "unban", null);
    });

    it("does not log the action when RCON reports failure", async () => {
      const rconService = {
        unbanPlayer: vi.fn(async () => ({ success: false, error: "Server is not running" })),
      };
      const response = createResponse();

      await getRouteHandler("post", "/unban")(
        createRequest({ username: "Bob" }, rconService),
        response,
      );

      expect(logPlayerAction).not.toHaveBeenCalled();
    });
  });

  describe("POST /voiceban", () => {
    it("logs the action when RCON succeeds", async () => {
      const rconService = {
        voiceBan: vi.fn(async () => ({ success: true, response: "ok" })),
      };
      const response = createResponse();

      await getRouteHandler("post", "/voiceban")(
        createRequest({ username: "Bob", enabled: true }, rconService),
        response,
      );

      expect(logPlayerAction).toHaveBeenCalledWith("Bob", "voiceban", "enabled");
    });

    it("does not log the action when RCON reports failure", async () => {
      const rconService = {
        voiceBan: vi.fn(async () => ({ success: false, error: "Server is not running" })),
      };
      const response = createResponse();

      await getRouteHandler("post", "/voiceban")(
        createRequest({ username: "Bob", enabled: true }, rconService),
        response,
      );

      expect(logPlayerAction).not.toHaveBeenCalled();
    });
  });

  // Already correct before this fix -- gated on result.success and returns
  // 400 rather than 200 on failure. Locked in here as a regression guard,
  // not touched, since Angela confirmed all five routes share the same
  // client-side wrapper and this one was the one that already got it right.
  describe("POST /adduser (already correct — regression guard only)", () => {
    it("logs the action when RCON succeeds", async () => {
      const rconService = {
        addUser: vi.fn(async () => ({ success: true, response: "ok" })),
      };
      const response = createResponse();

      await getRouteHandler("post", "/adduser")(
        createRequest({ username: "Bob" }, rconService),
        response,
      );

      expect(logPlayerAction).toHaveBeenCalledWith("Bob", "adduser", null);
    });

    it("does not log the action when RCON reports failure, and responds 400", async () => {
      const rconService = {
        addUser: vi.fn(async () => ({ success: false, error: "Server is not running" })),
      };
      const response = createResponse();

      await getRouteHandler("post", "/adduser")(
        createRequest({ username: "Bob" }, rconService),
        response,
      );

      expect(logPlayerAction).not.toHaveBeenCalled();
      expect(response.status).toHaveBeenCalledWith(400);
    });
  });
});
