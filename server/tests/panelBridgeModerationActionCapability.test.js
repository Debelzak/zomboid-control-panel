import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capability-gate cross-route-family sweep (Pam's structural finding,
// bug-hunt-2026-08-27): POST /command is the generic PanelBridge passthrough,
// gated bridge.command alone -- deliberately broad by the route's own
// comment, since it reaches every action including ~30 with no dedicated
// route at all. Four of those, moderationKickUser/BanUser/BanIP/BanSteamID,
// are different in kind: "discipline a player" is its own capability
// (players.moderate) everywhere else the app reaches it (players.js's own
// kick/ban/banid routes), specifically split from players.gm_tools because
// it carries a favouritism/griefing risk a GM tool doesn't. These four have
// no dedicated route of their own -- the only real caller is Events.tsx's
// "Moderation Automation" panel, via this exact endpoint -- so bridge.command
// was their ONLY gate. A custom role granted bridge.command for legitimate
// GM/world-event automation, but never granted players.moderate, got full
// kick/ban power as an undocumented side effect.

const getActiveServer = vi.fn(async () => null);
const logBridgeCommand = vi.fn(async () => {});

const ROLES = {
  admin: { capabilities: ["bridge.command", "players.moderate"] },
  // Holds bridge.command (passes the route's own gate) and NOTHING else --
  // the exact custom-role shape this fix exists to stop.
  bridge_command_only: { capabilities: ["bridge.command"] },
};
const getRoleByName = vi.fn(async (name) => ROLES[name] || null);

vi.mock("../database/init.js", () => ({
  getActiveServer,
  getServer: vi.fn(),
  getAllSettings: vi.fn(async () => ({})),
  setSetting: vi.fn(),
  getDb: vi.fn(),
  commitNow: vi.fn(),
  logBridgeCommand,
  getRoleByName,
}));

const { default: bridge } = await import("../services/panelBridge.js");
const { default: router } = await import("../routes/panelBridge.js");

function createResponse() {
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  return response;
}

function getHandler(routePath, method) {
  const layer = router.stack.find(
    (entry) => entry.route?.path === routePath && entry.route.methods[method],
  );
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function postCommand(action, args, role) {
  const res = createResponse();
  await getHandler("/command", "post")(
    { user: { role }, body: { action, args } },
    res,
    () => {},
  );
  return res;
}

describe("POST /panel-bridge/command -- moderation actions require players.moderate in addition to bridge.command", () => {
  let sendCommand;

  beforeEach(() => {
    bridge.isRunning = true;
    bridge.bridgePath = "/fake/bridge/path";
    sendCommand = vi.spyOn(bridge, "sendCommand").mockResolvedValue({ success: true });
    getRoleByName.mockClear();
    logBridgeCommand.mockClear();
  });

  afterEach(() => {
    sendCommand.mockRestore();
    bridge.isRunning = false;
    bridge.bridgePath = null;
  });

  it.each([
    "moderationKickUser",
    "moderationBanUser",
    "moderationBanIP",
    "moderationBanSteamID",
  ])("refuses %s for a caller who holds bridge.command but not players.moderate", async (action) => {
    const res = await postCommand(action, { username: "Griefer" }, "bridge_command_only");

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "PANELBRIDGE_ACTION_CAPABILITY_REQUIRED" }),
    );
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it.each([
    "moderationKickUser",
    "moderationBanUser",
    "moderationBanIP",
    "moderationBanSteamID",
  ])("allows %s for a caller who holds both bridge.command and players.moderate", async (action) => {
    const res = await postCommand(action, { username: "Griefer" }, "admin");

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(sendCommand).toHaveBeenCalledWith(action, { username: "Griefer" });
  });

  it("a non-moderation action (e.g. teleportPlayer) needs nothing beyond bridge.command itself", async () => {
    const res = await postCommand("teleportPlayer", { username: "Bob", x: 100, y: 100, z: 0 }, "bridge_command_only");

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(sendCommand).toHaveBeenCalledWith("teleportPlayer", { username: "Bob", x: 100, y: 100, z: 0 });
    // The router's own bridge.command gate already ran before this handler
    // (skipped here per this file's own harness, same as panelBridgeErrorParams.test.js) --
    // this assertion is about the INLINE check inside the handler only:
    // a non-mapped action must never trigger a second role lookup at all.
    expect(getRoleByName).not.toHaveBeenCalled();
  });
});
