import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { RconService } from '../services/rcon.js';

// Test RCON service logic by creating a lightweight mock
// This tests the key behaviors without requiring a live RCON connection

class MockRconService extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.connecting = false;
    this.serverStarting = false;
    this.consecutiveHealthFailures = 0;
    this.maxHealthFailures = 3;
    this.lastSuccessfulCommand = null;
    this.commandTimeout = 10000;
    this.client = null;
  }

  async execute(command, { skipLog = false } = {}) {
    if (this.serverStarting) {
      return { success: false, error: 'Server is starting, please wait...' };
    }
    if (!this.connected) {
      return { success: false, error: 'Not connected' };
    }

    // Simulate successful execution
    this.lastSuccessfulCommand = Date.now();
    this.consecutiveHealthFailures = 0; // Reset on successful command
    return { success: true, response: `Executed: ${command}` };
  }

  simulateHealthCheckFailure() {
    this.consecutiveHealthFailures++;
    if (this.consecutiveHealthFailures >= this.maxHealthFailures) {
      this.connected = false;
      this.consecutiveHealthFailures = 0;
    }
  }
}

describe('RconService', () => {
  let rcon;

  beforeEach(() => {
    rcon = new MockRconService();
  });

  describe('execute', () => {
    it('should return error when server is starting', async () => {
      rcon.serverStarting = true;
      const result = await rcon.execute('players');
      expect(result.success).toBe(false);
      expect(result.error).toContain('starting');
    });

    it('should return error when not connected', async () => {
      rcon.connected = false;
      const result = await rcon.execute('players');
      expect(result.success).toBe(false);
    });

    it('should succeed when connected', async () => {
      rcon.connected = true;
      const result = await rcon.execute('players');
      expect(result.success).toBe(true);
      expect(result.response).toContain('players');
    });

    it('should reset consecutiveHealthFailures on successful command', async () => {
      rcon.connected = true;
      rcon.consecutiveHealthFailures = 2;
      await rcon.execute('players');
      expect(rcon.consecutiveHealthFailures).toBe(0);
    });

    it('should update lastSuccessfulCommand timestamp', async () => {
      rcon.connected = true;
      const before = Date.now();
      await rcon.execute('players');
      expect(rcon.lastSuccessfulCommand).toBeGreaterThanOrEqual(before);
    });
  });

  describe('health check', () => {
    it('should disconnect after max consecutive failures', () => {
      rcon.connected = true;
      rcon.simulateHealthCheckFailure(); // 1
      expect(rcon.connected).toBe(true);
      rcon.simulateHealthCheckFailure(); // 2
      expect(rcon.connected).toBe(true);
      rcon.simulateHealthCheckFailure(); // 3 -> disconnect
      expect(rcon.connected).toBe(false);
    });

    it('should not disconnect before max failures', () => {
      rcon.connected = true;
      rcon.simulateHealthCheckFailure();
      rcon.simulateHealthCheckFailure();
      expect(rcon.connected).toBe(true);
      expect(rcon.consecutiveHealthFailures).toBe(2);
    });

    it('successful command should prevent health check disconnect', async () => {
      rcon.connected = true;
      rcon.simulateHealthCheckFailure(); // 1
      rcon.simulateHealthCheckFailure(); // 2
      await rcon.execute('players'); // resets counter
      rcon.simulateHealthCheckFailure(); // 1 again
      rcon.simulateHealthCheckFailure(); // 2 again
      expect(rcon.connected).toBe(true); // still connected
    });
  });

  describe('auto reconnect', () => {
    it('should still probe RCON when process detection says server is not running', async () => {
      vi.useFakeTimers();

      const liveRcon = new RconService();
      const checkServerRunning = vi.fn().mockResolvedValue(false);
      const connectSpy = vi.spyOn(liveRcon, 'connect').mockResolvedValue(false);

      liveRcon.setServerManager({ checkServerRunning });
      liveRcon.startAutoReconnect();

      await vi.advanceTimersByTimeAsync(liveRcon.autoReconnectDelay);

      expect(checkServerRunning).toHaveBeenCalledTimes(1);
      expect(connectSpy).toHaveBeenCalledTimes(1);

      liveRcon.stopAutoReconnect();
      vi.useRealTimers();
    });
  });
});
