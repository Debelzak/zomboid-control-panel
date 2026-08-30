import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadPanelBridge } from './helpers/panelBridgeLua.js';

// 2026-08-30, panelbridge-audit follow-up (full-file bug sweep): getDir()
// returns the real IsoDirections Java enum, not a string. Vanilla Lua --
// client AND server (server/Animal/ISScytheGrassCursor.lua,
// ISPickDungCursor.lua) -- always keys/compares it by IDENTITY
// (`dir == IsoDirections.N`), never via tostring(); nowhere in the whole
// vanilla tree does `tostring(someDirection)` appear. handlers.
// spawnHordeBehindPlayer's dirMap was string-keyed off `tostring(dir)`,
// which never matched any of "N"/"NE"/.../"NW" -- `facing` silently
// defaulted to N EVERY TIME regardless of the player's real facing, so
// "behind" (the negation) was always due south of the player. The feature
// never once spawned behind the player in any other direction.
//
// The pre-existing test file for this handler
// (panelBridgeSpawnHordeFabricatedCount.test.js) modeled `FakePlayer.dir`
// as the bare STRING "N" -- which happens to make `tostring(dir)` trivially
// return "N" and silently validate the exact broken lookup this bug relies
// on. That fake has been corrected alongside this file to return a real
// IsoDirections-shaped value instead.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LUA_PATH = path.join(
  __dirname,
  '..',
  '..',
  'pz-mod',
  'PanelBridge',
  'media',
  'lua',
  'server',
  'PanelBridge.lua',
);

// Distinct Lua tables per direction (matches the real engine returning a
// distinct Java enum reference per direction, which is what makes identity
// comparison/lookup meaningful in the first place -- a bare string stub
// would validate this exact bug instead of catching it).
const ISO_DIRECTIONS_STUB = `
local function mkDir(name)
    local d = {}
    function d:toString() return name end
    return d
end
IsoDirections = {
    N = mkDir("N"), NE = mkDir("NE"), E = mkDir("E"), SE = mkDir("SE"),
    S = mkDir("S"), SW = mkDir("SW"), W = mkDir("W"), NW = mkDir("NW"),
}
`;

function stubsForDir(dirExpr) {
  return ISO_DIRECTIONS_STUB + `
ZombRand = function(n) return 0 end

FakePlayer = { x = 100, y = 100, z = 0, username = "Test" }
function FakePlayer:getX() return self.x end
function FakePlayer:getY() return self.y end
function FakePlayer:getZ() return self.z end
function FakePlayer:getDir() return ${dirExpr} end
function FakePlayer:getUsername() return self.username end

-- handlers.spawnHordeBehindPlayer resolves the username via PanelBridge.lua's
-- own LOCAL getPlayerByUsername helper, which iterates getOnlinePlayers() --
-- a global getPlayerByUsername stub would be lexically shadowed and never
-- called, so it's getOnlinePlayers() that must be stubbed.
FakeOnlinePlayers = { FakePlayer }
function FakeOnlinePlayers:size() return 1 end
function FakeOnlinePlayers:get(i) return self[i + 1] end
getOnlinePlayers = function() return FakeOnlinePlayers end

FakeVZM = {}
function FakeVZM:createRealZombieNow(x, y, z) return { x = x, y = y, z = z } end
VirtualZombieManager = { instance = FakeVZM }
`;
}

describe('PanelBridge.lua handlers.spawnHordeBehindPlayer -- real facing direction, not a permanent silent default', () => {
  it('player facing SOUTH: horde spawns to the NORTH (cy decreases), not the old hardcoded south-of-player default', () => {
    const bridge = loadPanelBridge(LUA_PATH, stubsForDir('IsoDirections.S'));
    const result = bridge.callHandler('spawnHordeBehindPlayer', { username: 'Test', count: 3 });

    expect(result.ok).toBe(true);
    expect(result.data.playerDirection).toBe('S');
    expect(result.data.center).toEqual({ x: 100, y: 85 });
  });

  it('player facing WEST: horde spawns to the EAST (cx increases)', () => {
    const bridge = loadPanelBridge(LUA_PATH, stubsForDir('IsoDirections.W'));
    const result = bridge.callHandler('spawnHordeBehindPlayer', { username: 'Test', count: 3 });

    expect(result.ok).toBe(true);
    expect(result.data.playerDirection).toBe('W');
    expect(result.data.center).toEqual({ x: 115, y: 100 });
  });

  it('player facing NORTH: horde spawns to the SOUTH (the one direction the old bug always produced, now for the right reason)', () => {
    const bridge = loadPanelBridge(LUA_PATH, stubsForDir('IsoDirections.N'));
    const result = bridge.callHandler('spawnHordeBehindPlayer', { username: 'Test', count: 3 });

    expect(result.ok).toBe(true);
    expect(result.data.playerDirection).toBe('N');
    expect(result.data.center).toEqual({ x: 100, y: 115 });
  });

  it('getDir() unavailable: falls back to due-south (facing-north default), reports direction as "unknown" rather than a fabricated one', () => {
    const bridge = loadPanelBridge(LUA_PATH, stubsForDir('nil'));
    const result = bridge.callHandler('spawnHordeBehindPlayer', { username: 'Test', count: 3 });

    expect(result.ok).toBe(true);
    expect(result.data.playerDirection).toBe('unknown');
    expect(result.data.center).toEqual({ x: 100, y: 115 });
  });
});
