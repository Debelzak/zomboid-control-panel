import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createLogger } from '../utils/logger.js';
const log = createLogger('Server');
import { logServerEvent, getSetting, getActiveServer } from '../database/init.js';

const isWindows = process.platform === 'win32';

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
        exec('ps aux', { timeout: 8000 }, (err, stdout) => {
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
      }
    });
  }

  async startServer() {
    // Force reload config from database before starting (settings may have changed)
    this.configLoaded = false;
    await this.loadConfig();
    
    if (!this.serverPath) {
      throw new Error('Server path not configured');
    }

    const isRunning = await this.checkServerRunning();
    if (isRunning) {
      throw new Error('Server is already running');
    }

    const batPath = path.join(this.serverPath, this.serverBat);
    
    if (!fs.existsSync(batPath)) {
      throw new Error(`Server startup script not found: ${batPath}`);
    }

    // Start the server process
    log.info('Starting server process');
    
    if (isWindows) {
      this.serverProcess = spawn('cmd.exe', ['/c', this.serverBat], {
        cwd: this.serverPath,
        detached: true,
        stdio: 'ignore'
      });
    } else {
      // Ensure the script is executable
      try {
        fs.chmodSync(batPath, 0o755);
      } catch (e) {
        log.warn(`Could not chmod startup script: ${e.message}`);
      }
      this.serverProcess = spawn('bash', [this.serverBat], {
        cwd: this.serverPath,
        detached: true,
        stdio: 'ignore'
      });
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
        // Check both Java class name and native launcher (projectzomboid64)
        exec("ps aux | grep -iE '[z]ombie.network.GameServer|[p]rojectzomboid64|[p]rojectzomboid32' | awk '{print $2}'", (err, stdout) => {
          const pids = (stdout || '').trim().split('\n').filter(Boolean);
          
          if (pids.length === 0) {
            resolve({ success: true, message: 'Server was not running' });
            return;
          }
          
          // Kill each matching PID
          const killCmd = `kill -9 ${pids.join(' ')}`;
          exec(killCmd, (killErr) => {
            this.isRunning = false;
            this.serverProcess = null;
            this.startTime = null;
            
            logServerEvent('server_stop', 'Server force stopped').catch(e => log.warn(`Failed to log event: ${e.message}`));
            log.info('Server force stopped');
            
            resolve({ success: true, message: 'Server stopped' });
          });
        });
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

      // Start the server
      await this.startServer();

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
