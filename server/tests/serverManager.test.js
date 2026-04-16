import { describe, expect, it } from 'vitest';
import { isWindowsDedicatedServerCommandLine } from '../services/serverManager.js';

describe('ServerManager Windows detection', () => {
  it('should recognize WinGSM-style ProjectZomboid server launches', () => {
    const commandLine = '"C:\\WinGSM\\servers\\1\\serverfiles\\ProjectZomboid64.exe" -cachedir="C:\\WinGSM\\servers\\1\\Zomboid" -servername WheelerZoidB42';

    expect(isWindowsDedicatedServerCommandLine(commandLine)).toBe(true);
  });

  it('should recognize Java dedicated server launches', () => {
    const commandLine = '"C:\\serverfiles\\jre64\\bin\\java.exe" -cp %PZ_CLASSPATH% zombie.network.GameServer -servername WheelerZoidB42';

    expect(isWindowsDedicatedServerCommandLine(commandLine)).toBe(true);
  });

  it('should ignore plain client launches without dedicated-server markers', () => {
    const commandLine = '"C:\\Games\\ProjectZomboid\\ProjectZomboid64.exe"';

    expect(isWindowsDedicatedServerCommandLine(commandLine)).toBe(false);
  });
});