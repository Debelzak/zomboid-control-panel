import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadPanelBridge } from './helpers/panelBridgeLua.js';

// 2026-08-30, panelbridge-audit (Kevin's jar audit): zombie.characters.Stats
// has NO getHunger/getThirst/getFatigue/getBoredom/getUnhappyness/getPain --
// 36 declared methods, none of them these (concept-based constant-pool
// sweep, absent rather than renamed). handlers.getPlayerDetails wrapped its
// entire player table in ONE outer pcall: the first absent-method throw
// aborted the whole build, so the caller got NOTHING back -- not even
// position, username, and access level, all of which work fine.
// handlers.getAllPlayerDetails has the same underlying flaw per player,
// smaller blast radius only because it degrades one player's row to
// {username, error} rather than losing the whole response.
//
// THIS FIX IS DELIBERATELY NOT ABOUT WHICH STATS ARE REAL -- FakeStats below
// models the exact situation Kevin found (some getters absent, others
// presumably fine) without asserting which specific ones are real on a live
// B42 server. getStress/getEndurance are left defined here purely to prove
// that a WORKING sibling field survives an absent one; this test says
// nothing about whether those two specifically are real on B42.

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

// FakeStats deliberately has NO getHunger/getThirst/getFatigue/getBoredom/
// getUnhappyness/getPain defined at all -- calling one throws "attempt to
// call a nil value", exactly the real B42 failure shape Kevin found (not a
// method that returns nil, one that doesn't exist).
const STUBS = `
FakeStats = {}
function FakeStats:getStress() return 5 end
function FakeStats:getEndurance() return 0.8 end

FakeBodyDamage = {}
function FakeBodyDamage:getOverallBodyHealth() return 90 end
function FakeBodyDamage:IsInfected() return false end
function FakeBodyDamage:getIsBleeding() return false end
function FakeBodyDamage:getHealth() return 10 end
function FakeBodyDamage:getTemperature() return 37 end
function FakeBodyDamage:getWetness() return 0 end

FakePlayer = { id = 1 }
function FakePlayer:getUsername() return "Fielder" end
function FakePlayer:getDisplayName() return "Fielder" end
function FakePlayer:getX() return 100 end
function FakePlayer:getY() return 200 end
function FakePlayer:getZ() return 0 end
function FakePlayer:getAccessLevel() return "admin" end
function FakePlayer:isAlive() return true end
function FakePlayer:isAsleep() return false end
function FakePlayer:isSneaking() return false end
function FakePlayer:isRunning() return false end
function FakePlayer:getStats() return FakeStats end
function FakePlayer:getBodyDamage() return FakeBodyDamage end

getPlayerByUsername = function(name)
  if name == "Fielder" then return FakePlayer end
  return nil
end

FakeOnlinePlayers = { FakePlayer }
function FakeOnlinePlayers:size() return 1 end
function FakeOnlinePlayers:get(i) return self[i + 1] end
getOnlinePlayers = function() return FakeOnlinePlayers end
`;

describe('PanelBridge.lua getPlayerDetails/getAllPlayerDetails -- an absent stat getter must not take down fields that work', () => {
  it('getPlayerDetails: position/username/accessLevel survive, working stats survive, absent stats are OMITTED not zeroed', () => {
    const bridge = loadPanelBridge(LUA_PATH, STUBS);
    const result = bridge.callHandler('getPlayerDetails', { username: 'Fielder' });

    // Before the fix this whole call failed -- ok:false, data:null -- the
    // instant getHunger() threw, discarding everything below including
    // fields that had already resolved just fine.
    expect(result.ok).toBe(true);
    expect(result.data.username).toBe('Fielder');
    expect(result.data.x).toBe(100);
    expect(result.data.y).toBe(200);
    expect(result.data.accessLevel).toBe('admin');
    expect(result.data.isAlive).toBe(true);

    // Working stats fields survive alongside the absent ones.
    expect(result.data.stats.stress).toBe(5);
    expect(result.data.stats.endurance).toBe(0.8);

    // Absent stats are honestly MISSING, never a plausible-looking 0 -- a 0
    // for hunger is a lie a UI would render as "not hungry".
    expect(result.data.stats.hunger).toBeUndefined();
    expect(result.data.stats.thirst).toBeUndefined();
    expect(result.data.stats.fatigue).toBeUndefined();
    expect('hunger' in result.data.stats).toBe(false);

    // Health, an unrelated section, is fully intact -- confirms the failure
    // is scoped to the one throwing call, not even to "the whole stats
    // section onward".
    expect(result.data.health.overallBodyHealth).toBe(90);
  });

  it('getAllPlayerDetails: the online player keeps position/username, does not degrade to the {username, error} fallback', () => {
    const bridge = loadPanelBridge(LUA_PATH, STUBS);
    const result = bridge.callHandler('getAllPlayerDetails', {});

    expect(result.ok).toBe(true);
    expect(result.data.players.length).toBe(1);
    const row = result.data.players[0];

    // Before the fix this row was always {username, error} -- position and
    // accessLevel were discarded by the same absent-getHunger throw.
    expect(row.error).toBeUndefined();
    expect(row.username).toBe('Fielder');
    expect(row.x).toBe(100);
    expect(row.y).toBe(200);
    expect(row.accessLevel).toBe('admin');
    expect(row.health).toBe(90);

    // Absent stat honestly omitted, not zeroed.
    expect(row.hunger).toBeUndefined();
    expect('hunger' in row).toBe(false);
  });

  it('getPlayerDetails: a player with NO working stats object at all still returns everything else (pre-existing guard, unaffected)', () => {
    const bridge = loadPanelBridge(LUA_PATH, STUBS + `
function FakePlayer:getStats() return nil end
`);
    const result = bridge.callHandler('getPlayerDetails', { username: 'Fielder' });
    expect(result.ok).toBe(true);
    expect(result.data.username).toBe('Fielder');
    expect(result.data.stats).toEqual({});
  });
});
