import { describe, expect, it } from "vitest";
import path from "path";
import { loadPanelBridge } from "./helpers/panelBridgeLua.js";

const LUA_PATH = path.resolve(
  "pz-mod/PanelBridge/media/lua/server/PanelBridge.lua",
);

const FILE_STUBS = `
FILES = {}
function getServerName() return "TestServer" end
function getFileReader(path)
  local value = FILES[path]
  if value == nil then return nil end
  local reader = { value = value, done = false }
  function reader:readLine()
    if self.done then return nil end
    self.done = true
    return self.value
  end
  function reader:close() end
  return reader
end
function getFileWriter(path)
  local writer = { path = path, value = "" }
  function writer:write(value) self.value = self.value .. value end
  function writer:close() FILES[self.path] = self.value end
  return writer
end
`;

// bug-hunt-2026-08-26 / commit 036a538: these two cases used to assert the
// bug's own behavior as the spec. processQueuedCommands incremented its
// `processed` budget counter unconditionally (moved outside the
// decode-success branch entirely for the malformed case), so 205 queued
// entries that were all skips -- never a real attempted command -- burned
// the 200-per-tick budget and left 5 genuine entries stranded for the next
// tick. processSingleCommand's return value now gates the increment (false
// on all 4 skip paths: malformed/no-id/duplicate/expired; true only when a
// command was actually attempted), so a run of skips no longer counts
// against the budget at all -- the loop keeps advancing until it runs out
// of queued files, not until it runs out of budget. All 205 seed files here
// are skips, so the cursor should reach the true end of the queue (205),
// not stall at the tick budget (200).
describe("PanelBridge command budget", () => {
  it("does not count duplicate entries toward the per-tick queue budget", () => {
    const bridge = loadPanelBridge(LUA_PATH, FILE_STUBS);
    bridge.run(`
      for i = 1, 205 do
        local seq = string.format("%010d", i)
        FILES["panelbridge/TestServer/inbox/cmd-" .. seq .. ".json"] =
          '{"seq":' .. tostring(i) .. ',"id":"duplicate","action":"unknown"}'
      end
      PanelBridgeModule.processCommands()
    `);

    const queueState = bridge.getGlobal("PanelBridgeModule").queueState;
    expect(queueState.lastCommandSeq).toBe(205);
  });

  it("does not count malformed entries toward the per-tick queue budget", () => {
    const bridge = loadPanelBridge(LUA_PATH, FILE_STUBS);
    bridge.run(`
      for i = 1, 205 do
        local seq = string.format("%010d", i)
        FILES["panelbridge/TestServer/inbox/cmd-" .. seq .. ".json"] = "not-json"
      end
      PanelBridgeModule.processCommands()
    `);

    const queueState = bridge.getGlobal("PanelBridgeModule").queueState;
    expect(queueState.lastCommandSeq).toBe(205);
  });
});