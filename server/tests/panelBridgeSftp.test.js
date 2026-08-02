import { describe, expect, it } from 'vitest';
import { validateSftpBridgeConfig } from '../services/panelBridgeSftp.js';

const valid = {
  host: 'pz.example.net',
  port: 22,
  username: 'panelbridge',
  password: 'not-a-real-secret',
  bridgePath: '/home/pz/Zomboid/Lua/panelbridge/TestServer',
  pollIntervalSeconds: 3,
};

describe('PanelBridge SFTP configuration', () => {
  it('accepts a constrained bridge configuration', () => {
    expect(validateSftpBridgeConfig(valid)).toMatchObject({
      host: 'pz.example.net',
      port: 22,
      pollIntervalSeconds: 3,
    });
  });

  it.each([1, 11])('rejects poll interval %s outside 2-10 seconds', (pollIntervalSeconds) => {
    expect(() => validateSftpBridgeConfig({ ...valid, pollIntervalSeconds })).toThrow('between 2 and 10 seconds');
  });

  it('rejects remote path traversal', () => {
    expect(() => validateSftpBridgeConfig({ ...valid, bridgePath: '/home/pz/../etc' })).toThrow('without traversal');
  });
});