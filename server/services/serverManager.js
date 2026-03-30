import { spawn, exec, execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createLogger } from '../utils/logger.js';
const log = createLogger('Server');
import { logServerEvent, getSetting, getActiveServer } from '../database/init.js';

const isWindows = process.platform === 'win32';

// Build LD_LIBRARY_PATH from server directory, filtering to only existing paths
function buildLdLibraryPath(serverDir) {
  log.debug(`buildLdLibraryPath: scanning candidates for serverDir=${serverDir}`);
  const candidates = [
    path.join(serverDir, 'linux64'),
    path.join(serverDir, 'natives', 'linux64'),
    path.join(serverDir, 'natives'),
    serverDir,
    path.join(serverDir, 'jre64', 'lib', 'amd64'),
    path.join(serverDir, 'jre64', 'lib', 'x86_64'),   // CentOS uses x86_64 instead of amd64
    '/usr/lib64',                                       // CentOS system 64-bit libs
  ];
  const existing = candidates.filter(p => { try { return fs.existsSync(p); } catch { return false; } });
  const extra = process.env.LD_LIBRARY_PATH || '';
  const result = [...existing, extra].filter(Boolean).join(':');
  log.debug(`buildLdLibraryPath: ${existing.length}/${candidates.length} dirs exist → LD_LIBRARY_PATH=${result}`);
  return result;
}

// Allowed extensions for custom start commands
const ALLOWED_CMD_EXTENSIONS = isWindows
  ? ['.bat', '.cmd', '.exe']
  : ['.sh', ''];

// Validate a custom start command string for safety
function validateStartCommand(cmd) {
  if (!cmd || typeof cmd !== 'string') return { valid: false, reason: 'Command is empty' };
  if (cmd.length > 1024) return { valid: false, reason: 'Command exceeds 1024 characters' };
  // Block obvious shell metacharacters that enable chaining/injection
  // Allow quotes, spaces, hyphens, equals, slashes, dots, colons (drive letters)
  if (/[&|;<>`${}()!\[\]\n\r]/.test(cmd)) {
    return { valid: false, reason: 'Command contains disallowed shell characters: & | ; < > ` $ { } ( ) ! [ ]' };
  }
  return { valid: true };
}

// Helper function to escape regex special characters
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Get the default startup script name for the current platform
function getDefaultStartupScript() {
  return isWindows ? 'StartServer64.bat' : 'start-server.sh';
}

export class ServerManager {
  constructor() {
    this.serverProcess = null;
    this.serverPath = process.env.PZ_SERVER_PATH || '';
    this.serverBat = process.env.PZ_SERVER_BAT || getDefaultStartupScript();
    this.savePath = process.env.PZ_SAVE_PATH || '';
    this.serverName = 'servertest';
    this.startCommand = '';
    this.isRunning = false;
    this.startTime = null;
    this.configLoaded = false;
    this.publicIp = null;
    this.gamePort = null;
    this.fetchingIp = false;
  }

  // Reload config (called when active server changes)
  async reloadConfig() {
    // Reset all config to defaults before reloading
    this.serverPath = process.env.PZ_SERVER_PATH || '';
    this.serverBat = process.env.PZ_SERVER_BAT || getDefaultStartupScript();
    this.savePath = process.env.PZ_SAVE_PATH || '';
    this.serverName = 'servertest';
    this.startCommand = '';
    this.configLoaded = false;
    await this.loadConfig();
  }

  // Load settings from active server or legacy database settings
  async loadConfig() {
    if (this.configLoaded) return;
    try {
      // First, try to load from active server (multi-server support)
      const activeServer = await getActiveServer();
      if (activeServer) {
        // Use serverPath if available, otherwise extract from installPath
        let serverDir = activeServer.serverPath || activeServer.installPath;
        
        // If path points to a file (e.g., .bat), extract the directory
        if (serverDir) {
          const serverDirLower = serverDir.toLowerCase();
          if (serverDirLower.endsWith('.bat') || serverDirLower.endsWith('.sh') || serverDirLower.endsWith('.exe')) {
            // Extract the batch file name before getting directory
            const batchFileName = path.basename(serverDir);
            serverDir = path.dirname(serverDir);
            // Use the specified batch file
            this.serverBat = batchFileName;
            log.debug(`Using batch file from installPath: ${batchFileName}`);
          }
        }
        
        if (serverDir) {
          this.serverPath = serverDir;
          log.debug(`Loaded serverPath: ${serverDir}`);
        }
        
        if (activeServer.serverName) {
          this.serverName = activeServer.serverName;
          // Only look for custom batch file if we didn't already get one from installPath
          if (!this.serverBat || this.serverBat === getDefaultStartupScript()) {
            if (isWindows) {
              const customBat = `StartServer_${activeServer.serverName}.bat`;
              const customBatPath = path.join(this.serverPath, customBat);
              if (fs.existsSync(customBatPath)) {
                this.serverBat = customBat;
              } else if (activeServer.useNoSteam) {
                this.serverBat = 'StartServer64_nosteam.bat';
              } else {
                this.serverBat = 'StartServer64.bat';
              }
            } else {
              const customSh = `start-server_${activeServer.serverName}.sh`;
              const customShPath = path.join(this.serverPath, customSh);
              if (fs.existsSync(customShPath)) {
                this.serverBat = customSh;
              } else if (activeServer.useNoSteam) {
                this.serverBat = 'start-server.sh';
              } else {
                this.serverBat = 'start-server.sh';
              }
            }
          }
        }
        if (activeServer.zomboidDataPath) {
          this.savePath = activeServer.zomboidDataPath;
        }
        if (activeServer.startCommand) {
          this.startCommand = activeServer.startCommand;
          log.debug(`Using custom start command: ${this.startCommand}`);
        }
        this.configLoaded = true;
        log.debug(`Loaded config from active server: ${activeServer.name}`);
        return;
      }
      
      // Fallback: load from legacy settings
      const dbServerPath = await getSetting('serverPath');
      const dbServerName = await getSetting('serverName');
      const dbZomboidPath = await getSetting('zomboidDataPath');
      
      if (dbServerPath) {
        this.serverPath = dbServerPath;
        log.debug(`Loaded serverPath from database: ${dbServerPath}`);
      }
      if (dbServerName) {
        this.serverName = dbServerName;
        // Use custom startup script if server was set up through the app
        if (isWindows) {
          this.serverBat = `StartServer_${dbServerName}.bat`;
        } else {
          this.serverBat = `start-server_${dbServerName}.sh`;
        }
      }
      if (dbZomboidPath) {
        this.savePath = dbZomboidPath;
      }
      this.configLoaded = true;
    } catch (error) {
      log.debug(`Could not load server config from database: ${error.message}`);
    }
  }

  async checkServerRunning() {
    return new Promise((resolve) => {
      // Check if ProjectZomboid DEDICATED SERVER is running
      // The dedicated server runs as java with zombie.network.GameServer class
      log.debug(`checkServerRunning: starting detection (platform=${process.platform})`);
      
      const timeout = setTimeout(() => {
        log.warn('checkServerRunning: Process detection timed out, assuming server is not running');
        resolve(false);
      }, 10000);
      
      if (isWindows) {
        // Windows: Use PowerShell Get-CimInstance to inspect command lines
        exec('powershell -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'java.exe\'\\" | Select-Object CommandLine | Format-List"', { timeout: 8000 }, (psError, psStdout) => {
          if (!psError && psStdout) {
            const isPZServer = psStdout.toLowerCase().includes('zombie.network.gameserver');
            if (isPZServer) {
              clearTimeout(timeout);
              this.isRunning = true;
              resolve(true);
              return;
            }
          }
          
          // Fallback: Check for standalone server builds (ProjectZomboid64.exe with -server flag)
          exec('powershell -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'ProjectZomboid64.exe\'\\" | Select-Object CommandLine | Format-List"', { timeout: 8000 }, (psError2, psStdout2) => {
            clearTimeout(timeout);
            if (psError2 || !psStdout2) {
              this.isRunning = false;
              resolve(false);
              return;
            }
            
            const cmdLine = psStdout2.toLowerCase();
            const isServer = cmdLine.includes('-server') || 
                            cmdLine.includes('zombie.network.gameserver') ||
                            cmdLine.includes('startserver');
            
            this.isRunning = isServer;
            resolve(isServer);
          });
        });
      } else {
        // Linux/macOS: Use ps + grep to find the PZ server process
        // Check both the Java class name (zombie.network.GameServer) and
        // the native launcher (ProjectZomboid64 / projectzomboid64)
        // Use pgrep first (more reliable), fall back to ps aux
        log.debug('checkServerRunning: trying pgrep -af first...');
        exec('pgrep -af "zombie.network.[Gg]ame[Ss]erver|[Pp]roject[Zz]omboid64|[Pp]roject[Zz]omboid32"', { timeout: 8000 }, (pgrepErr, pgrepOut) => {
          if (!pgrepErr && pgrepOut && pgrepOut.trim()) {
            log.debug(`checkServerRunning: pgrep found PZ server process: ${pgrepOut.trim().substring(0, 200)}`);
            clearTimeout(timeout);
            this.isRunning = true;
            resolve(true);
            return;
          }
          // Fallback: ps aux (works on all distros including CentOS minimal)
          log.debug('checkServerRunning: pgrep failed or empty, falling back to ps aux -ww');
          exec('ps aux -ww', { timeout: 8000 }, (err, stdout) => {
            clearTimeout(timeout);
            if (err || !stdout) {
              this.isRunning = false;
              resolve(false);
              return;
            }
            
            const lines = stdout.toLowerCase();
            const isPZServer = lines.includes('zombie.network.gameserver') ||
                              lines.includes('projectzomboid64') ||
                              lines.includes('projectzomboid32');
            this.isRunning = isPZServer;
            resolve(isPZServer);
          });
        });
      }
    });
  }

  async startServer({ skipRunningCheck = false } = {}) {
    // Prevent concurrent start attempts
    if (this._starting) {
      throw new Error('Server start already in progress');
    }
    this._starting = true;

    try {
      // Force reload config from database before starting (settings may have changed)
      this.configLoaded = false;
      await this.loadConfig();
      
      if (!this.startCommand && !this.serverPath) {
        throw new Error('Server path not configured');
      }

      if (!skipRunningCheck) {
        const isRunning = await this.checkServerRunning();
        if (isRunning) {
          throw new Error('Server is already running');
        }
      }

      // Start the server process
      log.info(`Starting server process (platform=${process.platform}, serverPath=${this.serverPath}, startCommand=${this.startCommand || 'none'}, serverBat=${this.serverBat})`);

      if (this.startCommand) {
        // Validate the custom command before executing
        const validation = validateStartCommand(this.startCommand);
        if (!validation.valid) {
          throw new Error(`Invalid start command: ${validation.reason}`);
        }

        // Custom start command — split into command and arguments
        const parts = this.startCommand.match(/(?:[^\s"]+|"[^"]*")+/g) || [this.startCommand];
        const cmd = parts[0].replace(/^"|"$/g, '');
        const args = parts.slice(1).map(a => a.replace(/^"|"$/g, ''));
        const cwd = this.serverPath || path.dirname(path.resolve(cmd));

        // Validate the command file extension is allowed
        const ext = path.extname(cmd).toLowerCase();
        if (!ALLOWED_CMD_EXTENSIONS.includes(ext)) {
          throw new Error(`Start command has disallowed extension '${ext}'. Allowed: ${ALLOWED_CMD_EXTENSIONS.join(', ')}`);
        }

        // Resolve to absolute path and verify it exists
        const resolvedCmd = path.isAbsolute(cmd) ? cmd : path.resolve(cwd, cmd);
        if (!fs.existsSync(resolvedCmd)) {
          throw new Error(`Start command not found: ${resolvedCmd}`);
        }

        log.info(`Using custom start command: ${resolvedCmd} ${args.join(' ')} (ext=${ext}, cwd=${cwd})`);

        if (isWindows && (ext === '.bat' || ext === '.cmd')) {
          this.serverProcess = spawn('cmd.exe', ['/c', resolvedCmd, ...args], {
            cwd,
            detached: true,
            stdio: 'ignore'
          });
        } else if (!isWindows && ext === '.sh') {
          try { fs.chmodSync(resolvedCmd, 0o750); } catch (e) { log.debug(`chmod on custom .sh failed: ${e.message}`); }
          const serverAbsPath = path.resolve(cwd);
          const ldPath = buildLdLibraryPath(serverAbsPath);
          log.debug(`Spawning custom .sh: bash ${resolvedCmd} ${args.join(' ')} (cwd=${cwd}, LD_LIBRARY_PATH=${ldPath})`);
          this.serverProcess = spawn('bash', [resolvedCmd, ...args], {
            cwd,
            detached: true,
            stdio: 'ignore',
            env: { ...process.env, LD_LIBRARY_PATH: ldPath }
          });
        } else {
          const spawnEnv = isWindows ? process.env : (() => {
            const serverAbsPath = path.resolve(cwd);
            return { ...process.env, LD_LIBRARY_PATH: buildLdLibraryPath(serverAbsPath) };
          })();
          this.serverProcess = spawn(resolvedCmd, args, {
            cwd,
            detached: true,
            stdio: 'ignore',
            env: spawnEnv
          });
        }
      } else {
      const batPath = path.join(this.serverPath, this.serverBat);
    
      if (!fs.existsSync(batPath)) {
        throw new Error(`Server startup script not found: ${batPath}`);
      }

      if (isWindows) {
        this.serverProcess = spawn('cmd.exe', ['/c', this.serverBat], {
          cwd: this.serverPath,
          detached: true,
          stdio: 'ignore'
        });
      } else {
        // Ensure the script is executable
        try {
          fs.chmodSync(batPath, 0o750);
        } catch (e) {
          log.warn(`Could not chmod startup script: ${e.message}`);
        }
        // On Linux, ensure LD_LIBRARY_PATH includes the server's native library dirs
        // so the JVM can find libsteam_api.so and its transitive dependencies.
        // Without this, services/non-login shells won't have the paths set.
        const serverAbsPath = path.resolve(this.serverPath);
        const ldPath = buildLdLibraryPath(serverAbsPath);
        log.debug(`Spawning default .sh: bash ${this.serverBat} (cwd=${this.serverPath}, LD_LIBRARY_PATH=${ldPath})`);

        this.serverProcess = spawn('bash', [this.serverBat], {
          cwd: this.serverPath,
          detached: true,
          stdio: 'ignore',
          env: { ...process.env, LD_LIBRARY_PATH: ldPath }
        });
      }
    }
    
    // Handle spawn errors (e.g., invalid path, permissions)
    this.serverProcess.on('error', (error) => {
      log.error(`Server process error: ${error.message}`);
      this.isRunning = false;
      this.serverProcess = null;
    });
    
    this.serverProcess.unref();
    this.isRunning = true;
    this.startTime = new Date();
    
    await logServerEvent('server_start', 'Server started via manager');
    log.info('Server start command executed');
    
    return { success: true, message: 'Server start command executed' };
    } finally {
      this._starting = false;
    }
  }

  async stopServer(graceful = true) {
    if (graceful) {
      // This should be done via RCON 'quit' command
      // This method is for force stopping
      log.info('Graceful stop requested - use RCON quit command');
      return { success: true, message: 'Use RCON quit command for graceful shutdown' };
    }

    return new Promise((resolve, reject) => {
      if (isWindows) {
        // Windows: Kill java.exe running PZ server, then ProjectZomboid64.exe
        exec('powershell -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'java.exe\'\\" | Where-Object { $_.CommandLine -like \'*zombie.network.gameserver*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"', (javaErr) => {
          exec('taskkill /IM ProjectZomboid64.exe /F', (pzError, stdout, stderr) => {
            const javaKilled = !javaErr;
            const pzKilled = !pzError;
            
            if (!javaKilled && !pzKilled) {
              if (pzError && pzError.message.includes('not found')) {
                resolve({ success: true, message: 'Server was not running' });
                return;
              }
              resolve({ success: true, message: 'Server may not have been running' });
              return;
            }
            
            this.isRunning = false;
            this.serverProcess = null;
            this.startTime = null;
            
            logServerEvent('server_stop', 'Server force stopped').catch(e => log.warn(`Failed to log event: ${e.message}`));
            log.info('Server force stopped');
            
            resolve({ success: true, message: 'Server stopped' });
          });
        });
      } else {
        // Linux: Find and kill the PZ server process
        // Use pgrep for reliable process matching (avoids false grep matches)
        log.debug('stopServer: looking for PZ server PIDs via pgrep...');
        exec("pgrep -f 'zombie.network.[Gg]ame[Ss]erver|[Pp]roject[Zz]omboid64|[Pp]roject[Zz]omboid32'", (pgrepErr, pgrepOut) => {
          let pids = (pgrepOut || '').trim().split('\n').filter(p => /^\d+$/.test(p));
          log.debug(`stopServer: pgrep returned ${pids.length} PIDs: [${pids.join(', ')}]`);
          
          // Fallback to ps+grep if pgrep not available
          if (pids.length === 0) {
            exec("ps aux -ww | grep -iE '[z]ombie.network.GameServer|[p]rojectzomboid64|[p]rojectzomboid32' | awk '{print $2}'", (err, stdout) => {
              pids = (stdout || '').trim().split('\n').filter(p => /^\d+$/.test(p));
              killPids(pids);
            });
            return;
          }
          
          killPids(pids);
        });
        
        const killPids = (pids) => {
          if (pids.length === 0) {
            resolve({ success: true, message: 'Server was not running' });
            return;
          }
          
          log.info(`Killing PZ server PIDs: ${pids.join(', ')}`);
          
          // Kill each matching PID using execFile to avoid shell injection
          execFile('kill', ['-9', ...pids], (killErr) => {
            if (killErr) {
              log.warn(`Kill returned error (may be normal if process already exited): ${killErr.message}`);
            }
            this.isRunning = false;
            this.serverProcess = null;
            this.startTime = null;
            
            logServerEvent('server_stop', `Server force stopped (killed PIDs: ${pids.join(', ')})`).catch(e => log.warn(`Failed to log event: ${e.message}`));
            log.info(`Server force stopped (killed ${pids.length} process(es): ${pids.join(', ')})`);
            
            resolve({ success: true, message: 'Server stopped' });
          });
        };
      }
    });
  }

  async restartServer(rconService, warningMinutes = 5) {
    try {
      // Helper to send message with timeout (don't let RCON failures block restart)
      const sendWarning = async (msg) => {
        try {
          let timeoutId;
          const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('RCON timeout')), 5000);
          });
          await Promise.race([
            rconService.serverMessage(msg),
            timeoutPromise
          ]);
          clearTimeout(timeoutId);
        } catch (e) {
          log.warn(`Failed to send restart warning: ${e.message}`);
        }
      };

      // Send warning messages
      const warnings = [5, 4, 3, 2, 1];
      for (const minutes of warnings) {
        if (minutes <= warningMinutes) {
          await sendWarning(`Server restarting in ${minutes} minute(s)!`);
          await this.sleep(60000); // Wait 1 minute between each warning
        }
      }

      // Final warning
      await sendWarning('Server restarting NOW!');
      await this.sleep(5000);

      // Save the world (with timeout)
      try {
        let saveTimeoutId;
        const saveTimeout = new Promise((_, reject) => {
          saveTimeoutId = setTimeout(() => reject(new Error('Save timeout')), 10000);
        });
        await Promise.race([rconService.save(), saveTimeout]);
        clearTimeout(saveTimeoutId);
      } catch (e) {
        log.warn(`Save before restart failed: ${e.message}`);
      }
      await this.sleep(3000);

      // Quit the server (with timeout)
      try {
        let quitTimeoutId;
        const quitTimeout = new Promise((_, reject) => {
          quitTimeoutId = setTimeout(() => reject(new Error('Quit timeout')), 10000);
        });
        await Promise.race([rconService.quit(), quitTimeout]);
        clearTimeout(quitTimeoutId);
      } catch (e) {
        log.warn(`RCON quit failed, will force stop: ${e.message}`);
      }
      await this.sleep(10000);

      // Wait for server to fully stop
      let attempts = 0;
      while (await this.checkServerRunning() && attempts < 30) {
        await this.sleep(1000);
        attempts++;
      }

      // Force stop if still running
      if (await this.checkServerRunning()) {
        await this.stopServer(false);
        await this.sleep(5000);
      }

      // Extra delay to let OS reap the process
      await this.sleep(3000);

      // Start the server — skip running check, we just confirmed it stopped
      await this.startServer({ skipRunningCheck: true });

      await logServerEvent('server_restart', 'Server restarted');
      return { success: true, message: 'Server restarted successfully' };
    } catch (error) {
      log.error(`Restart failed: ${error.message}`);
      throw error;
    }
  }

  async getServerStatus() {
    // Ensure config is loaded before returning status
    await this.loadConfig();
    
    // Lazy load port and IP
    if (!this.gamePort) {
      this.loadGamePort().catch(() => {});
    }
    if (!this.publicIp && !this.fetchingIp) {
      this.fetchPublicIp().catch(() => {});
    }

    const isRunning = await this.checkServerRunning();
    
    // Calculate uptime in seconds (not milliseconds)
    const uptimeMs = this.startTime ? Date.now() - this.startTime.getTime() : 0;
    const uptimeSeconds = Math.floor(uptimeMs / 1000);
    
    return {
      running: isRunning,
      startTime: this.startTime,
      uptime: uptimeSeconds,
      serverPath: this.serverPath,
      configured: !!this.serverPath,
      publicIp: this.publicIp,
      localIp: this.getLocalIp(),
      port: this.gamePort
    };
  }

  getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        // Skip internal (i.e. 127.0.0.1) and non-ipv4
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }

  async loadGamePort() {
    try {
      const config = await this.getServerConfig();
      if (config && config.DefaultPort) {
        this.gamePort = parseInt(config.DefaultPort);
      }
    } catch (e) {
      // ignore
    }
  }

  async fetchPublicIp() {
    if (this.fetchingIp) return;
    this.fetchingIp = true;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      
      const response = await fetch('https://api.ipify.org?format=json', { 
        signal: controller.signal 
      });
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        this.publicIp = data.ip;
      }
    } catch (e) {
      // silent fail
    } finally {
      this.fetchingIp = false;
    }
  }


  async getServerConfig() {
    await this.loadConfig();  // Ensure config is loaded
    
    if (!this.savePath) {
      return null;
    }

    // Try the actual server name first (proper path: savePath/Server/{serverName}.ini)
    const serverConfigDir = path.join(this.savePath, 'Server');
    const serverNameIniPath = path.join(serverConfigDir, `${this.serverName}.ini`);
    
    if (fs.existsSync(serverNameIniPath)) {
      log.debug(`Reading config from ${serverNameIniPath}`);
      return this.parseIniFile(serverNameIniPath);
    }
    
    // Fallback: try old path directly in savePath (for backwards compatibility)
    const configPath = path.join(this.savePath, `${this.serverName}.ini`);
    if (fs.existsSync(configPath)) {
      log.debug(`Reading config from fallback ${configPath}`);
      return this.parseIniFile(configPath);
    }
    
    // Legacy fallback: servertest.ini
    const legacyPath = path.join(this.savePath, 'servertest.ini');
    if (fs.existsSync(legacyPath)) {
      log.debug(`Reading config from legacy ${legacyPath}`);
      return this.parseIniFile(legacyPath);
    }
    
    // Try alternative path
    const altPath = path.join(this.savePath, 'serveroptions.ini');
    if (fs.existsSync(altPath)) {
      return this.parseIniFile(altPath);
    }
    
    log.warn(`No config file found. Tried: ${serverNameIniPath}, ${configPath}, ${legacyPath}`);
    return null;
  }

  parseIniFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const config = {};
      const lines = content.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith(';')) {
          const [key, ...valueParts] = trimmed.split('=');
          if (key && valueParts.length > 0) {
            config[key.trim()] = valueParts.join('=').trim();
          }
        }
      }

      return config;
    } catch (error) {
      log.error(`Failed to parse config file: ${error.message}`);
      return null;
    }
  }

  async saveServerConfig(config) {
    if (!this.savePath) {
      throw new Error('Save path not configured');
    }

    // Match getServerConfig logic: check Server/ subdirectory first, then fallback paths
    const serverIni = this.serverName ? `${this.serverName}.ini` : 'servertest.ini';
    const serverSubdirPath = path.join(this.savePath, 'Server', serverIni);
    let configPath;
    if (fs.existsSync(serverSubdirPath)) {
      configPath = serverSubdirPath;
    } else {
      configPath = path.join(this.savePath, serverIni);
      if (!fs.existsSync(configPath)) {
        configPath = path.join(this.savePath, 'servertest.ini');
      }
    }
    
    try {
      // Read existing file to preserve comments and structure
      let content = '';
      if (fs.existsSync(configPath)) {
        content = fs.readFileSync(configPath, 'utf-8');
      }

      // Update values
      for (const [key, value] of Object.entries(config)) {
        // Validate key is a valid identifier (alphanumeric and underscore only)
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
          log.warn(`Invalid config key skipped: ${key}`);
          continue;
        }
        const escapedKey = escapeRegExp(key);
        const regex = new RegExp(`^${escapedKey}=.*$`, 'm');
        // Strip newlines from values to prevent INI injection
        const safeValue = String(value).replace(/[\r\n]/g, '');
        if (content.match(regex)) {
          content = content.replace(regex, `${key}=${safeValue}`);
        } else {
          content += `\n${key}=${safeValue}`;
        }
      }

      fs.writeFileSync(configPath, content, 'utf-8');
      log.info('Server config saved');
      return { success: true };
    } catch (error) {
      log.error(`Failed to save config: ${error.message}`);
      throw error;
    }
  }

  async getModList() {
    if (!this.savePath) {
      return [];
    }

    try {
      const config = await this.getServerConfig();
      if (!config || !config.Mods) {
        return [];
      }

      const mods = config.Mods.split(';').filter(m => m.trim());
      const workshopIds = config.WorkshopItems ? 
        config.WorkshopItems.split(';').filter(m => m.trim()) : [];

      return mods.map((mod, index) => ({
        name: mod,
        workshopId: workshopIds[index] || null
      }));
    } catch (error) {
      log.error(`Failed to get mod list: ${error.message}`);
      return [];
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  updatePaths(serverPath, savePath) {
    this.serverPath = serverPath || this.serverPath;
    this.savePath = savePath || this.savePath;
  }
}
