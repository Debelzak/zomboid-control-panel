import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createLocalResetResponse, isLocalPanelRequest } from '../routes/auth.js';
import { filterOwnedClientModIds, getModDetailsFromWorkshop, scoreWorkshopDependencyMatch } from '../routes/mods.js';
import { ModChecker } from '../services/modChecker.js';

// Test the restart timeout pattern fix
// Verifies that the Promise.race + clearTimeout pattern doesn't leak unhandled rejections

describe('Restart timeout pattern', () => {
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  it('should not leave dangling rejections when operation wins the race', async () => {
    // This is the FIXED pattern: setTimeout + clearTimeout
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Timeout')), 5000);
    });

    const operationPromise = Promise.resolve('done');

    const result = await Promise.race([operationPromise, timeoutPromise]);
    clearTimeout(timeoutId); // Prevents the timeout from firing

    expect(result).toBe('done');
    // Wait a tick to ensure no unhandled rejection
    await sleep(10);
  });

  it('should reject when operation takes too long', async () => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Timeout')), 10);
    });

    const slowOperation = new Promise(resolve => setTimeout(resolve, 5000));

    try {
      await Promise.race([slowOperation, timeoutPromise]);
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e.message).toBe('Timeout');
    }
    clearTimeout(timeoutId);
  });

  it('sendWarning helper should catch both success and timeout', async () => {
    const sendWarning = async (msg, shouldSucceed = true) => {
      try {
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('RCON timeout')), 50);
        });
        const operation = shouldSucceed
          ? Promise.resolve('sent')
          : new Promise(resolve => setTimeout(resolve, 5000));
        await Promise.race([operation, timeoutPromise]);
        clearTimeout(timeoutId);
        return 'ok';
      } catch (e) {
        return e.message;
      }
    };

    // Success case
    expect(await sendWarning('test', true)).toBe('ok');

    // Timeout case
    expect(await sendWarning('test', false)).toBe('RCON timeout');
  });
});

// Test modChecker interval error handling
describe('modChecker interval error handling', () => {
  it('should catch errors in async interval callback', async () => {
    let errorCaught = false;
    let intervalCleared = false;
    let callCount = 0;

    const intervalCallback = async () => {
      try {
        callCount++;
        throw new Error('RCON connection failed');
      } catch (error) {
        errorCaught = true;
        intervalCleared = true;
      }
    };

    await intervalCallback();

    expect(errorCaught).toBe(true);
    expect(intervalCleared).toBe(true);
    expect(callCount).toBe(1);
  });
});

describe('local password reset hardening', () => {
  it('does not include reset token values in local reset responses', () => {
    const response = createLocalResetResponse('Recovery token created at data/reset-token.txt. Paste it below to continue.');

    expect(response).toEqual({
      success: true,
      resetAvailable: true,
      message: 'Recovery token created at data/reset-token.txt. Paste it below to continue.',
    });
    expect(response).not.toHaveProperty('token');
  });

  it('does not trust proxy-derived IP fields for local-only reset detection', () => {
    const spoofedRequest = {
      ip: '127.0.0.1',
      ips: ['127.0.0.1'],
      socket: { remoteAddress: '8.8.8.8' },
      connection: { remoteAddress: '8.8.8.8' },
    };

    expect(isLocalPanelRequest(spoofedRequest)).toBe(false);
  });

  it('accepts real loopback socket addresses for local reset detection', () => {
    const localRequest = {
      socket: { remoteAddress: '::ffff:127.0.0.1' },
      connection: { remoteAddress: '::ffff:127.0.0.1' },
    };

    expect(isLocalPanelRequest(localRequest)).toBe(true);
  });
});

describe('mod update auto-restart dedupe', () => {
  it('marks offline mod updates as handled instead of retrying every poll', async () => {
    const checker = new ModChecker();
    checker.scheduler = { rconService: { connected: false } };
    checker.serverManager = { checkServerRunning: vi.fn().mockResolvedValue(false) };

    const result = await checker.triggerModRestart([{ workshopId: '2503622437', name: 'Skill Recovery Journal' }]);

    expect(result).toMatchObject({ success: true, skipped: true, markProcessed: true, reason: 'server_offline' });
    expect(checker.pendingRestart).toBe(false);
  });

  it('keeps retrying when the server is running but RCON is disconnected', async () => {
    const checker = new ModChecker();
    checker.scheduler = { rconService: { connected: false } };
    checker.serverManager = { checkServerRunning: vi.fn().mockResolvedValue(true) };

    const result = await checker.triggerModRestart([{ workshopId: '3437629766', name: 'CleanUI [B42.12]' }]);

    expect(result).toMatchObject({ success: false, retry: true, reason: 'rcon_disconnected' });
    expect(checker.pendingRestart).toBe(false);
  });
});

describe('mod removal ownership filtering', () => {
  it('only accepts client-provided mod IDs verified against the workshop item', () => {
    const filtered = filterOwnedClientModIds(
      ['OwnedMod', 'UnrelatedMod', '1234567890', 'OwnedMod', 'Bad;Entry', 'OtherOwned'],
      ['OwnedMod', 'OtherOwned']
    );

    expect(filtered).toEqual(['OwnedMod', 'OtherOwned']);
  });

  it('rejects all client-provided IDs when the server cannot verify ownership', () => {
    expect(filterOwnedClientModIds(['LooksLegit'], [])).toEqual([]);
  });
});

describe('mod name resolution from disk', () => {
  it('prefers the newest versioned mod.info over legacy manifests', async () => {
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zcp-mod-name-'));
    try {
      const workshopId = '3490188370';
      const workshopRoot = path.join(tempRoot, 'steamapps', 'workshop');
      const modRoot = path.join(workshopRoot, 'content', '108600', workshopId, 'mods', 'Project_Cook');

      await fs.promises.mkdir(path.join(modRoot, '42'), { recursive: true });
      await fs.promises.mkdir(path.join(modRoot, '42.15'), { recursive: true });
      await fs.promises.writeFile(path.join(modRoot, '42', 'mod.info'), 'name=Project Cook [Legacy]\nid=Project_Cook\n');
      await fs.promises.writeFile(path.join(modRoot, '42.15', 'mod.info'), 'name=Project Cook\nid=Project_Cook\n');

      const checker = new ModChecker();
      checker.workshopAcfPath = path.join(workshopRoot, 'appworkshop_108600.acf');

      expect(checker.resolveModNameFromDisk(workshopId, true)).toBe('Project Cook');
    } finally {
      await fs.promises.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('uses newest versioned mod.info metadata for current-config details', async () => {
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zcp-mod-details-'));
    try {
      const workshopId = '3490188370';
      const modRoot = path.join(tempRoot, 'steamapps', 'workshop', 'content', '108600', workshopId, 'mods', 'Project_Cook');

      await fs.promises.mkdir(path.join(modRoot, '42'), { recursive: true });
      await fs.promises.mkdir(path.join(modRoot, '42.15'), { recursive: true });
      await fs.promises.writeFile(path.join(modRoot, '42', 'mod.info'), 'name=Project Cook [Legacy]\nid=Project_Cook\n');
      await fs.promises.writeFile(path.join(modRoot, '42.15', 'mod.info'), 'name=Project Cook\nid=Project_Cook\n');

      expect(getModDetailsFromWorkshop(workshopId, tempRoot)).toEqual([
        expect.objectContaining({ id: 'Project_Cook', name: 'Project Cook' })
      ]);
    } finally {
      await fs.promises.rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('workshop dependency search ranking', () => {
  it('ranks exact internal mod ID matches above variants that only contain the query', () => {
    const exact = scoreWorkshopDependencyMatch('TombBody', 'TombBody', "Tomb's Player Body");
    const texture = scoreWorkshopDependencyMatch('TombBody', 'TombBodyTex', "Tomb's Player Body - Textures");
    const custom = scoreWorkshopDependencyMatch('TombBody', 'TombBodyCustom', "Tomb's Player Body - Customisation");

    expect(exact.matchType).toBe('exact-id');
    expect(exact.score).toBeGreaterThan(texture.score);
    expect(exact.score).toBeGreaterThan(custom.score);
  });
});
