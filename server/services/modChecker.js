import { createLogger } from '../utils/logger.js';
const log = createLogger('Mods');
import { getTrackedMods, updateModTimestamp, logServerEvent, getSetting, setSetting, addTrackedMod, getActiveServer, isModIgnored, markModsChecked } from '../database/init.js';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { sanitizeError } from '../utils/sanitize.js';
import panelBridge from './panelBridge.js';

export class ModChecker extends EventEmitter {
  constructor() {
    super();
    this.checkInterval = parseInt(process.env.MOD_CHECK_INTERVAL, 10) || 300000; // 5 minutes default
    this.intervalId = null;
    this.lastCheck = null;
    this.modsNeedingUpdate = [];
    this.onUpdateCallback = null;
    this.autoRestartEnabled = false;  // Track auto-restart state
    this.scheduler = null;  // Will be set by init()
    this.serverManager = null;  // Will be set by init()
    this.io = null;  // Socket.io instance for emitting events
    this.workshopAcfPath = null;  // Path to appworkshop_108600.acf
    
    // Advanced options
    this.restartWarningMinutes = 5;  // Minutes to warn before restart
    this.delayIfPlayersOnline = false;  // Wait for players to leave before restart
    this.maxDelayMinutes = 30;  // Maximum wait time if delaying for players
    this.lastUpdateDetected = null;  // Timestamp of last update detection
    this.pendingRestart = false;  // Whether a restart is pending (waiting for players)
    this.playerCheckInterval = null;  // Interval for checking player count
    
    // Performance: Cache mod names to avoid repeated disk reads
    this.modNameCache = new Map(); // WorkshopID -> { name, timestamp }
    this.checkInProgress = false; // Prevent concurrent update checks
    this.lastSteamTimestamps = new Map(); // Cache Steam API results between checks
    
    // Startup grace period — skip auto-restart triggers for the first N seconds after start()
    this.startupGraceMs = 120000; // 2 minutes grace period after start()
    this.startedAt = null; // Set when start() is called
    
    // Update dedup — track which mod+timestamp combos have already triggered a restart
    // Prevents the same stale update from re-triggering every poll cycle
    this.processedUpdates = new Map(); // workshopId -> steamTimestamp that was already handled
  }

  // Initialize with scheduler and restore saved settings
  async init(scheduler, serverManager = null, io = null) {
    this.scheduler = scheduler;
    this.serverManager = serverManager;
    this.io = io;
    
    // Find the workshop ACF file path
    await this.findWorkshopAcfPath();
    
    // Restore all saved settings from database
    try {
      const savedAutoRestart = await getSetting('modAutoRestartEnabled');
      const savedWarningMinutes = await getSetting('modRestartWarningMinutes');
      const savedDelayIfPlayers = await getSetting('modDelayIfPlayersOnline');
      const savedMaxDelay = await getSetting('modMaxDelayMinutes');
      const savedCheckInterval = await getSetting('modCheckInterval');
      
      if (savedWarningMinutes !== null) this.restartWarningMinutes = savedWarningMinutes;
      if (savedDelayIfPlayers !== null) this.delayIfPlayersOnline = savedDelayIfPlayers;
      if (savedMaxDelay !== null) this.maxDelayMinutes = savedMaxDelay;
      if (savedCheckInterval !== null) this.checkInterval = Math.max(60000, savedCheckInterval);
      
      log.info(`Mod checker settings restored: autoRestart=${savedAutoRestart}, warning=${this.restartWarningMinutes}min, delayIfPlayers=${this.delayIfPlayersOnline}, maxDelay=${this.maxDelayMinutes}min, checkInterval=${this.checkInterval}ms`);
      
      if (savedAutoRestart === true) {
        this.autoRestartEnabled = true;
        if (this.scheduler) {
          this.onUpdateCallback = async (updatedMods) => {
            await this.handleModUpdate(updatedMods);
          };
          log.info('Auto-restart on mod update restored from settings');
        }
      }
    } catch (error) {
      log.warn(`Failed to restore mod checker settings: ${error.message}`);
    }
    
    // Auto-sync mods from workshop ACF file
    await this.autoSyncModsOnStartup();
  }

  // Find the workshop ACF file path from server config
  async findWorkshopAcfPath() {
    try {
      // Allow manual override from settings
      const manualPath = await getSetting('modWorkshopAcfPath');
      if (manualPath && fs.existsSync(manualPath)) {
          this.workshopAcfPath = manualPath;
          log.info(`Using configured workshop ACF: ${manualPath}`);
          return manualPath;
      }

      const activeServer = await getActiveServer();
      let installPath = activeServer?.installPath;
      
      if (!installPath) {
        installPath = await getSetting('serverPath');
      }
      
      if (!installPath) {
        log.debug('Server install path not configured');
        return null;
      }
      
      // Workshop ACF is at: {installPath}/steamapps/workshop/appworkshop_108600.acf
      const acfPath = path.join(installPath, 'steamapps', 'workshop', 'appworkshop_108600.acf');
      
      if (fs.existsSync(acfPath)) {
        this.workshopAcfPath = acfPath;
        log.info(`Found workshop ACF at ${acfPath}`);
        return acfPath;
      }

      // Check one level up (common if installPath points to a subfolder)
      const acfPathUp = path.join(installPath, '..', 'steamapps', 'workshop', 'appworkshop_108600.acf');
      if (fs.existsSync(acfPathUp)) {
          this.workshopAcfPath = acfPathUp;
          log.info(`Found workshop ACF at parent: ${acfPathUp}`);
          return acfPathUp;
      }
      
      log.debug(`Workshop ACF not found at ${acfPath}`);
      return null;
    } catch (error) {
      log.warn(`Failed to find workshop ACF: ${error.message}`);
      return null;
    }
  }

  // Parse Steam's VDF/ACF format (robust stack-based parser)
  parseAcfFile(content) {
    const result = {
      installedMods: {},
      modDetails: {}
    };
    
    if (!content) return result;

    try {
      // VDF Parser — handles both "Key" { (same line) and "Key"\n{ (separate lines)
      const lines = content.split(/\r?\n/);
      const stack = [];
      let current = {};
      const root = current;
      let pendingKey = null; // Key waiting for opening brace on next line

      for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith('//')) continue;

        // Lone opening brace — use pending key from previous line
        if (line === '{') {
          const key = pendingKey || 'unknown';
          pendingKey = null;
          const newObj = {};
          current[key] = newObj;
          stack.push(current);
          current = newObj;
          continue;
        }

        // "Key" { on the same line
        if (line.endsWith('{')) {
          pendingKey = null;
          const keyMatch = line.match(/"([^"]+)"/);
          const key = keyMatch ? keyMatch[1] : 'unknown';
          const newObj = {};
          current[key] = newObj;
          stack.push(current);
          current = newObj;
          continue;
        }

        // Closing brace
        if (line === '}') {
          pendingKey = null;
          if (stack.length > 0) {
            current = stack.pop();
          }
          continue;
        }

        // Key-Value pair: "Key" "Value"
        const kvMatch = line.match(/"([^"]+)"\s+"([^"]*)"/);
        if (kvMatch) {
          pendingKey = null;
          current[kvMatch[1]] = kvMatch[2];
          continue;
        }

        // Standalone quoted key — opening brace expected on next line
        const keyOnly = line.match(/^"([^"]+)"$/);
        if (keyOnly) {
          pendingKey = keyOnly[1];
        }
      }

      // Navigate structure to find relevant sections
      // The root usually contains "AppState" or "AppWorkshop"
      const appState = root.AppState || root.AppWorkshop || root;

      if (appState) {
        // Extract WorkshopItemsInstalled
        if (appState.WorkshopItemsInstalled) {
          for (const [id, data] of Object.entries(appState.WorkshopItemsInstalled)) {
            // In some VDF formats, the ID is the key, in others it might be indexed
            if (typeof data === 'object') {
              result.installedMods[id] = {
                size: parseInt(data.size || 0),
                timeupdated: parseInt(data.timeupdated || 0)
              };
            }
          }
        }

        // Extract WorkshopItemDetails
        if (appState.WorkshopItemDetails) {
          for (const [id, data] of Object.entries(appState.WorkshopItemDetails)) {
            if (typeof data === 'object') {
              result.modDetails[id] = {
                timeupdated: parseInt(data.timeupdated || 0),
                latest_timeupdated: parseInt(data.latest_timeupdated || 0)
              };
            }
          }
        }
      }
    } catch (error) {
      log.error(`Failed to parse ACF file: ${error.message}`);
    }
    
    return result;
  }

  // Helper: Try to resolve mod name from disk
  resolveModNameFromDisk(workshopId, skipCache = false) {
    // Check cache first (with size limit)
    if (!skipCache && this.modNameCache.has(workshopId)) {
      return this.modNameCache.get(workshopId).name;
    }
    
    // Evict oldest entries if cache exceeds limit
    if (this.modNameCache.size > 500) {
      const firstKey = this.modNameCache.keys().next().value;
      this.modNameCache.delete(firstKey);
    }

    try {
      if (!this.workshopAcfPath) return null;
      
      // ACF path: .../steamapps/workshop/appworkshop_108600.acf
      // Content path: .../steamapps/workshop/content/108600/<ID>
      const workshopDir = path.dirname(this.workshopAcfPath);
      const contentDir = path.join(workshopDir, 'content', '108600', workshopId);
      
      if (!fs.existsSync(contentDir)) return null;
      
      // Inside workshop folder, there is usually 'mods/ModName/mod.info'
      // OR sometimes just 'mods/ModName'. B42 mods may also put mod.info
      // under a versioned subdirectory: 'mods/ModName/common/mod.info',
      // 'mods/ModName/42/mod.info', 'mods/ModName/42.0/mod.info', etc.
      // We probe the mod root and every direct subdirectory.
      const modsDir = path.join(contentDir, 'mods');
      if (fs.existsSync(modsDir)) {
         const modFolders = fs.readdirSync(modsDir);
         // Just take the first valid mod found in the package
         for (const folder of modFolders) {
            const modFolderPath = path.join(modsDir, folder);
            const candidatePaths = [path.join(modFolderPath, 'mod.info')];
            try {
              for (const sub of fs.readdirSync(modFolderPath, { withFileTypes: true })) {
                if (sub.isDirectory()) {
                  candidatePaths.push(path.join(modFolderPath, sub.name, 'mod.info'));
                }
              }
            } catch {
              // Not a directory or unreadable — fall through
            }
            const modInfoPath = candidatePaths.find(p => fs.existsSync(p));
            if (modInfoPath) {
               let content = fs.readFileSync(modInfoPath, 'utf-8');
               if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
               const nameMatch = content.match(/^\s*name\s*=\s*(.+)$/m);
               if (nameMatch && nameMatch[1]) {
                   const name = nameMatch[1].trim();
                   // Update cache
                   this.modNameCache.set(workshopId, { name, timestamp: Date.now() });
                   return name;
               }
            }
         }
         // Fallback: If no mod.info found but folder exists, use folder name
         if (modFolders.length > 0) {
           const name = modFolders[0];
           this.modNameCache.set(workshopId, { name, timestamp: Date.now() });
           return name;
         }
      }
      
      return null;
    } catch (e) {
      if (e.code === 'EACCES' || e.code === 'EPERM') {
        log.warn(`Permission denied resolving mod name for ${workshopId}: ${e.message}`);
      } else {
        log.debug(`Could not resolve mod name from disk for ${workshopId}: ${e.code || e.message}`);
      }
      return null;
    }
  }

  // Auto-sync mods from workshop ACF file on startup
  async autoSyncModsOnStartup() {
    try {
      if (!this.workshopAcfPath || !fs.existsSync(this.workshopAcfPath)) {
        log.debug('No workshop ACF file, skipping auto-sync');
        return;
      }
      
      const trackedMods = await getTrackedMods() || [];
      
      // Only auto-sync if no mods are tracked
      if (trackedMods.length > 0) {
        log.debug(`${trackedMods.length} mods already tracked, skipping auto-sync`);
        return;
      }
      
      // Read and parse the ACF file
      let content = fs.readFileSync(this.workshopAcfPath, 'utf-8');
      if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
      const parsed = this.parseAcfFile(content);
      
      const workshopIds = Object.keys(parsed.installedMods);
      
      if (workshopIds.length === 0) {
        log.debug('No mods found in workshop ACF');
        return;
      }
      
      // Add all mods to tracking
      let synced = 0;
      for (const id of workshopIds) {
        // Skip mods the user previously ignored
        if (await isModIgnored(id)) {
          log.debug(`Skipping ignored mod ${id} during auto-sync`);
          continue;
        }
        // Try to get name from disk
        const nameFromDisk = this.resolveModNameFromDisk(id);
        const name = nameFromDisk || `Workshop Mod ${id}`;
        
        await addTrackedMod(id, name);
        synced++;
      }
      
      if (synced > 0) {
        log.info(`Auto-synced ${synced} mods from workshop ACF`);
      }
    } catch (error) {
      log.error(`Failed to auto-sync mods: ${error.message}`);
    }
  }

  // Diagnostic helper used by /api/debug — true when polling is active.
  // Without this getter the debug page always reported "Mod update checker stopped"
  // because no field named isRunning existed on this class.
  get isRunning() {
    return !!this.intervalId;
  }

  start() {
    // Check if we have the workshop ACF file
    if (!this.workshopAcfPath) {
      log.warn('Workshop ACF file not configured - mod update checking disabled. Configure server install path first.');
      return false;
    }
    
    if (!fs.existsSync(this.workshopAcfPath)) {
      log.warn(`Workshop ACF file not found at ${this.workshopAcfPath}`);
      return false;
    }

    // Clear existing interval to prevent double-start leaks
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    this.startedAt = Date.now();
    this.intervalId = setInterval(() => this.checkForUpdates(), this.checkInterval);
    log.info(`Mod checker started - checking every ${Math.round(this.checkInterval / 1000)}s (grace period: ${this.startupGraceMs / 1000}s)`);
    
    // Run initial check after a short delay (30s) to let RCON connect first
    // The grace period still prevents auto-restart triggers during the first 2 minutes
    setTimeout(() => this.checkForUpdates(), 30000);
    return true;
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      log.info('Mod checker stopped');
    }
    if (this.playerCheckInterval) {
      clearInterval(this.playerCheckInterval);
      this.playerCheckInterval = null;
    }
  }

  async setUpdateCallback(callback) {
    this.onUpdateCallback = callback;
    this.autoRestartEnabled = !!callback;
    log.info(`Mod auto-restart ${this.autoRestartEnabled ? 'enabled' : 'disabled'}`);
    // Persist to database
    await setSetting('modAutoRestartEnabled', this.autoRestartEnabled);
  }

  // Configure restart options
  async setRestartOptions(options) {
    if (options.warningMinutes !== undefined) {
      const val = Number(options.warningMinutes);
      if (!isNaN(val)) {
        this.restartWarningMinutes = Math.max(0, Math.min(30, val));
        await setSetting('modRestartWarningMinutes', this.restartWarningMinutes);
      }
    }
    if (options.delayIfPlayersOnline !== undefined) {
      this.delayIfPlayersOnline = !!options.delayIfPlayersOnline;
      await setSetting('modDelayIfPlayersOnline', this.delayIfPlayersOnline);
    }
    if (options.maxDelayMinutes !== undefined) {
      const val = Number(options.maxDelayMinutes);
      if (!isNaN(val)) {
        this.maxDelayMinutes = Math.max(5, Math.min(120, val));
        await setSetting('modMaxDelayMinutes', this.maxDelayMinutes);
      }
    }
    if (options.checkInterval !== undefined) {
      const val = Number(options.checkInterval);
      if (isNaN(val)) return;
      this.checkInterval = Math.max(60000, val);
      await setSetting('modCheckInterval', this.checkInterval);
      // Restart with new interval
      if (this.intervalId) {
        this.stop();
        this.start();
      }
    }
    
    log.info(`Mod restart options updated: warning=${this.restartWarningMinutes}min, delayIfPlayers=${this.delayIfPlayersOnline}, maxDelay=${this.maxDelayMinutes}min`);
  }

  // Handle mod update detection
  async handleModUpdate(updatedMods) {
    // Guard against re-entry — don't start duplicate restarts
    if (this.pendingRestart) {
      log.info('Restart already pending, ignoring handleModUpdate');
      return;
    }

    log.info(`handleModUpdate called with ${updatedMods.length} mod(s): ${updatedMods.map(m => m.name).join(', ')}`);

    // Set flag immediately to prevent concurrent calls from slipping through
    this.pendingRestart = true;

    this.lastUpdateDetected = new Date();
    
    // Emit socket event
    if (this.io) {
      this.io.emit('mods:update_detected', { 
        mods: updatedMods,
        timestamp: this.lastUpdateDetected.toISOString(),
        autoRestart: this.autoRestartEnabled,
        warningMinutes: this.restartWarningMinutes
      });
    }
    this.emit('update_detected', updatedMods);
    
    if (!this.scheduler) {
      log.warn('Scheduler not available, cannot trigger restart');
      this.pendingRestart = false;
      return;
    }
    
    // Check if we should delay for players
    if (this.delayIfPlayersOnline && this.serverManager) {
      try {
        const playerCount = await this.getOnlinePlayerCount();
        
        if (playerCount > 0) {
          log.info(`${playerCount} players online, delaying restart (max ${this.maxDelayMinutes} min)`);
          await this.scheduler.rconService?.serverMessage(
            `🔧 Mod updates detected! Restart pending - waiting for players to leave (max ${this.maxDelayMinutes} min).`
          );
          
          if (this.io) {
            this.io.emit('mods:restart_pending', { 
              reason: 'waiting_for_players',
              playerCount,
              maxDelayMinutes: this.maxDelayMinutes
            });
          }
          
          // Start player count monitoring
          this.startPlayerMonitoring(updatedMods);
          return;
        }
      } catch (error) {
        log.warn(`Failed to check player count: ${error.message}`);
      }
    }
    
    // No delay, trigger restart immediately
    try {
      await this.triggerModRestart(updatedMods);
    } catch (e) {
      log.error(`handleModUpdate: triggerModRestart threw: ${e.message}`);
      this.pendingRestart = false;
    }
  }

  // Get online player count
  async getOnlinePlayerCount() {
    if (!this.scheduler?.rconService) return 0;
    
    try {
      const result = await this.scheduler.rconService.getPlayers();
      if (result.success && result.players) {
        return result.players.length;
      }
    } catch (error) {
      log.debug(`Failed to get player count: ${error.message}`);
    }
    return 0;
  }

  // Monitor player count and restart when empty
  startPlayerMonitoring(updatedMods) {
    if (this.playerCheckInterval) {
      clearInterval(this.playerCheckInterval);
    }
    
    this.pendingRestart = true;
    const startTime = Date.now();
    const maxWaitMs = this.maxDelayMinutes * 60 * 1000;
    
    this.playerCheckInterval = setInterval(async () => {
      try {
        const elapsed = Date.now() - startTime;
        
        // Check if max delay exceeded
        if (elapsed >= maxWaitMs) {
          log.info('Max delay exceeded, forcing restart');
          clearInterval(this.playerCheckInterval);
          this.playerCheckInterval = null;
          try {
            await this.triggerModRestart(updatedMods);
          } catch (e) {
            log.error(`Player monitor: triggerModRestart threw: ${e.message}`);
            this.pendingRestart = false;
          }
          return;
        }
        
        // Check player count
        const playerCount = await this.getOnlinePlayerCount();
        
        if (playerCount === 0) {
          log.info('No players online, triggering restart');
          clearInterval(this.playerCheckInterval);
          this.playerCheckInterval = null;
          try {
            await this.triggerModRestart(updatedMods);
          } catch (e) {
            log.error(`Player monitor: triggerModRestart threw: ${e.message}`);
            this.pendingRestart = false;
          }
        } else {
          const remainingMin = Math.round((maxWaitMs - elapsed) / 60000);
          log.debug(`${playerCount} players still online, ${remainingMin} min remaining`);
        }
      } catch (error) {
        log.error(`Player monitoring error: ${error.message}`);
        clearInterval(this.playerCheckInterval);
        this.playerCheckInterval = null;
        this.pendingRestart = false;
      }
    }, 120000); // Check every 2 minutes
  }

  // Trigger the actual restart
  async triggerModRestart(updatedMods) {
    log.info(`Triggering restart for ${updatedMods.length} updated mod(s)`);
    
    // RCON readiness gate — verify RCON is connected before attempting restart
    const rconService = this.scheduler?.rconService;
    if (!rconService || !rconService.connected) {
      log.warn('RCON not connected — cannot trigger mod restart safely. Will retry on next check cycle.');
      // Clear processed updates so they'll be re-detected on next cycle when RCON may be ready
      for (const m of updatedMods) {
        this.processedUpdates.delete(m.workshopId);
      }
      this.pendingRestart = false;
      return;
    }
    
    const modNames = updatedMods.map(m => String(m.name || 'Unknown').replace(/[\r\n]/g, '')).join(', ');
    
    if (this.io) {
      this.io.emit('mods:restart_starting', { 
        mods: updatedMods,
        warningMinutes: this.restartWarningMinutes
      });
    }
    
    try {
      // Send warning message — use both PanelBridge (rich, UTF-8 safe) and RCON
      // (always-on global broadcast). PZ's RCON does not handle non-ASCII so the
      // RCON path strips emoji/unicode automatically inside serverMessage().
      const trimmedNames = modNames.length > 100 ? `${modNames.substring(0, 100)}...` : modNames;
      const warningMessage = `🔧 Mod updates detected: ${trimmedNames}. Server will restart in ${this.restartWarningMinutes} minute(s).`;
      log.info(`Sending mod-restart warning: ${trimmedNames} — restart in ${this.restartWarningMinutes} min`);

      let rconBroadcastOk = false;
      try {
        const rconResult = await this.scheduler.rconService?.serverMessage(warningMessage);
        if (rconResult?.success && !rconResult.rejected) {
          rconBroadcastOk = true;
        } else if (rconResult?.rejected) {
          log.warn('RCON servermsg was rejected by PZ — will rely on PanelBridge fallback');
        }
      } catch (rconErr) {
        log.warn(`RCON serverMessage failed: ${rconErr?.message || rconErr}`);
      }

      // Always also try PanelBridge if available — it can render the full
      // unicode message in chat and acts as a fallback if RCON was rejected.
      try {
        if (panelBridge?.isRunning && panelBridge?.isModConnected?.()) {
          await panelBridge.sendCommand('sendToServerChat', { message: warningMessage, alert: true });
        } else if (!rconBroadcastOk) {
          log.warn('Mod restart warning: neither RCON broadcast nor PanelBridge succeeded — players may not see the warning');
        }
      } catch (bridgeErr) {
        log.warn(`PanelBridge sendToServerChat failed: ${bridgeErr?.message || bridgeErr}`);
      }

      // Perform restart with configured warning time
      log.info(`Calling scheduler.performRestart(${this.restartWarningMinutes})`);
      const result = await this.scheduler.performRestart(this.restartWarningMinutes);
      
      if (result && result.success === false) {
        log.warn(`Mod restart did not complete: ${result.message || 'unknown reason'}`);
        if (this.io) {
          this.io.emit('mods:restart_failed', { error: result.message || 'Restart did not complete' });
        }
        // Clear processed updates so we can retry on next cycle
        for (const m of updatedMods) {
          this.processedUpdates.delete(m.workshopId);
        }
        return;
      }
      
      log.info(`Mod restart completed successfully for: ${modNames.substring(0, 200)}`);
      await logServerEvent('mod_update_restart', `Restarted for mod updates: ${modNames}`);
      
      if (this.io) {
        this.io.emit('mods:restart_complete', { mods: updatedMods });
      }
    } catch (error) {
      log.error(`Restart failed: ${error.message}`);
      if (this.io) {
        this.io.emit('mods:restart_failed', { error: sanitizeError(error.message) });
      }
      // Clear processed updates so we can retry on next cycle
      for (const m of updatedMods) {
        this.processedUpdates.delete(m.workshopId);
      }
    } finally {
      // Always clear pendingRestart when triggerModRestart finishes
      this.pendingRestart = false;
    }
  }

  // Read the active server's INI WorkshopItems list as a Set of strings.
  // Returns null if the config can't be loaded so callers can choose to
  // fail open (don't filter) rather than fail closed (drop everything).
  async getConfiguredWorkshopIds() {
    if (!this.serverManager || typeof this.serverManager.getServerConfig !== 'function') {
      return null;
    }
    try {
      const config = await this.serverManager.getServerConfig();
      if (!config || !config.WorkshopItems) return null;
      const ids = String(config.WorkshopItems)
        .split(';')
        .map(s => s.trim())
        .filter(Boolean);
      return new Set(ids);
    } catch (err) {
      log.debug(`getConfiguredWorkshopIds failed: ${err.message}`);
      return null;
    }
  }

  // Check for mod updates using local workshop ACF file
  // This compares timeupdated vs latest_timeupdated in Steam's cache
  // Query Steam Web API for latest workshop item timestamps
  // Uses ISteamRemoteStorage/GetPublishedFileDetails (no API key required)
  async fetchSteamTimestamps(workshopIds) {
    const result = new Map(); // workshopId -> { time_updated, title }
    if (!workshopIds.length) return result;

    // Steam API accepts batches — process in chunks of 100
    const BATCH = 100;
    // Backoff between batches if Steam rate-limits us. Reset on success.
    let backoffMs = 0;
    const MAX_BACKOFF_MS = 60_000;
    for (let i = 0; i < workshopIds.length; i += BATCH) {
      const batch = workshopIds.slice(i, i + BATCH);
      let timeout;
      if (backoffMs > 0) {
        log.warn(`Steam API backoff: sleeping ${backoffMs}ms before next batch`);
        await new Promise(r => setTimeout(r, backoffMs));
      }
      try {
        const params = new URLSearchParams();
        params.set('itemcount', String(batch.length));
        batch.forEach((id, idx) => params.set(`publishedfileids[${idx}]`, id));

        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), 15000);

        const res = await fetch(
          'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
          { method: 'POST', body: params, signal: controller.signal }
        );
        clearTimeout(timeout);
        timeout = null;

        if (!res.ok) {
          log.warn(`Steam API returned ${res.status} for batch ${i / BATCH + 1}`);
          // Honor Retry-After on 429/503; otherwise exponential backoff up to MAX_BACKOFF_MS.
          if (res.status === 429 || res.status === 503) {
            const retryAfter = parseInt(res.headers.get('retry-after') || '', 10);
            if (Number.isFinite(retryAfter) && retryAfter > 0) {
              backoffMs = Math.min(retryAfter * 1000, MAX_BACKOFF_MS);
            } else {
              backoffMs = Math.min(Math.max(backoffMs * 2, 2000), MAX_BACKOFF_MS);
            }
          }
          continue;
        }

        // Successful response — reset backoff.
        backoffMs = 0;

        const data = await res.json();
        const items = data?.response?.publishedfiledetails || [];
        for (const item of items) {
          if (item.result === 1 && item.publishedfileid) {
            result.set(item.publishedfileid, {
              time_updated: item.time_updated || 0,
              title: item.title || null,
              file_type: item.file_type ?? 0,
              creator_app_id: item.creator_app_id || 0,
              preview_url: typeof item.preview_url === 'string' ? item.preview_url : null,
            });
          }
        }
      } catch (err) {
        if (timeout) clearTimeout(timeout);
        if (err.name === 'AbortError') {
          log.warn(`Steam API timeout for batch ${i / BATCH + 1}`);
        } else {
          log.warn(`Steam API error for batch ${i / BATCH + 1}: ${err.message}`);
        }
      }
    }

    if (result.size > 0 && result.size < workshopIds.length) {
      log.info(`Steam API returned data for ${result.size}/${workshopIds.length} mods (partial)`);
    }

    return result;
  }

  async checkForUpdates() {
    // Prevent concurrent checks (interval can fire while API call is in flight)
    if (this.checkInProgress) {
      log.debug('Update check already in progress, skipping');
      return { updated: false, mods: [], skipped: true };
    }
    this.checkInProgress = true;

    try {
      // Make sure we have the ACF path
      if (!this.workshopAcfPath) {
        await this.findWorkshopAcfPath();
      }
      
      if (!this.workshopAcfPath || !fs.existsSync(this.workshopAcfPath)) {
        log.warn('Workshop ACF file not found - cannot check for updates');
        return { updated: false, mods: [], error: 'Workshop ACF file not found' };
      }
      
      // Read and parse the ACF file for local timestamps
      let content = fs.readFileSync(this.workshopAcfPath, 'utf-8');
      if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
      const parsed = this.parseAcfFile(content);
      
      // Build local timestamp map from WorkshopItemsInstalled (most complete section)
      // Fall back to WorkshopItemDetails if a mod only exists there
      const localTimestamps = new Map(); // workshopId -> timeupdated (local)
      for (const [id, data] of Object.entries(parsed.installedMods)) {
        localTimestamps.set(id, data.timeupdated);
      }
      for (const [id, data] of Object.entries(parsed.modDetails)) {
        if (!localTimestamps.has(id)) {
          localTimestamps.set(id, data.timeupdated);
        }
      }

      const modCount = localTimestamps.size;
      if (modCount === 0) {
        log.debug('No workshop mods found in ACF file');
        return { updated: false, mods: [] };
      }

      log.debug(`Checking ${modCount} workshop mods for updates via Steam API...`);

      const updatedMods = [];
      const trackedMods = await getTrackedMods() || [];
      const trackedMap = new Map();
      for (const mod of trackedMods) {
        trackedMap.set(mod.workshop_id, mod);
      }

      // Query Steam Web API for latest timestamps.
      // Include tracked mods that aren't in the ACF (e.g. INI lists the ID
      // but the file isn't downloaded yet, or the ACF entry is missing).
      // Without this, those mods stay "Never checked" forever because the
      // checked-set below is built from this same query list.
      const queryIds = new Set(localTimestamps.keys());
      for (const mod of trackedMods) {
        if (mod.workshop_id && /^\d{1,15}$/.test(mod.workshop_id)) {
          queryIds.add(mod.workshop_id);
        }
      }
      const workshopIds = [...queryIds];
      const steamData = await this.fetchSteamTimestamps(workshopIds);

      // Cache steam data for getStatus() / getWorkshopInfo()
      if (steamData.size > 0) {
        this.lastSteamTimestamps = steamData;

        // Persist preview_url on tracked mods (lazy import to avoid cycles).
        try {
          const { setModPreviewUrl } = await import('../database/init.js');
          for (const mod of trackedMods) {
            const steam = steamData.get(mod.workshop_id);
            if (steam && steam.preview_url && mod.preview_url !== steam.preview_url) {
              await setModPreviewUrl(mod.workshop_id, steam.preview_url);
            }
          }
        } catch (err) {
          log.debug(`Failed to persist mod preview URLs: ${err.message}`);
        }
      }

      if (steamData.size === 0) {
        // API failed entirely — fall back to ACF-only comparison
        log.warn('Steam API returned no data, falling back to ACF-only check');
        for (const [workshopId, details] of Object.entries(parsed.modDetails)) {
          const { timeupdated, latest_timeupdated } = details;
          if (latest_timeupdated > timeupdated) {
            // Skip mods the user explicitly removed from tracking
            if (!trackedMap.has(workshopId) && await isModIgnored(workshopId)) {
              log.debug(`Skipping ignored mod ${workshopId} during ACF-only update check`);
              continue;
            }
            const trackedMod = trackedMap.get(workshopId);
            const nameFromDisk = this.resolveModNameFromDisk(workshopId);
            const modName = nameFromDisk || trackedMod?.name || `Workshop Mod ${workshopId}`;
            log.info(`Mod update available (ACF): ${modName} (${workshopId})`);
            updatedMods.push({
              workshopId, name: modName,
              localTimestamp: new Date(timeupdated * 1000),
              latestTimestamp: new Date(latest_timeupdated * 1000)
            });
          }
        }
      } else {
        // Compare local timestamps against Steam API timestamps
        for (const [workshopId, localTime] of localTimestamps) {
          const steam = steamData.get(workshopId);
          if (!steam) continue; // Not found on Steam (deleted/hidden)

          if (steam.time_updated > localTime) {
            const trackedMod = trackedMap.get(workshopId);

            // Skip mods the user explicitly removed from tracking
            if (!trackedMod && await isModIgnored(workshopId)) {
              log.debug(`Skipping ignored mod ${workshopId} during update check`);
              continue;
            }

            const nameFromDisk = this.resolveModNameFromDisk(workshopId);
            const modName = nameFromDisk || steam.title || trackedMod?.name || `Workshop Mod ${workshopId}`;

            // Update tracked mod name if we resolved a better one
            if (trackedMod && nameFromDisk && trackedMod.name !== nameFromDisk) {
              trackedMod.name = nameFromDisk;
              await addTrackedMod(workshopId, nameFromDisk);
            }

            log.info(`Mod update available: ${modName} (${workshopId}) - local: ${localTime}, steam: ${steam.time_updated}`);

            updatedMods.push({
              workshopId,
              name: modName,
              localTimestamp: new Date(localTime * 1000),
              latestTimestamp: new Date(steam.time_updated * 1000)
            });

            if (!trackedMod) {
              await addTrackedMod(workshopId, modName);
              trackedMap.set(workshopId, { workshop_id: workshopId, name: modName });
            }

            if (this.modNameCache.has(workshopId)) {
              this.modNameCache.delete(workshopId);
            }
          }
        }
      }

      this.lastCheck = new Date();

      // Drop "phantom" updates for tracked mods that are no longer listed in
      // the server's INI (WorkshopItems). They can't be applied — restarting
      // won't pull a mod the server isn't subscribed to — so flagging them
      // creates a permanent "Restart Pending" loop (see issue: removed-from-INI
      // mod gets stuck in update-restart cycle and never resolves).
      try {
        const iniWorkshopIds = await this.getConfiguredWorkshopIds();
        if (iniWorkshopIds && iniWorkshopIds.size > 0) {
          const before = updatedMods.length;
          const filtered = updatedMods.filter(m => iniWorkshopIds.has(String(m.workshopId)));
          const skipped = before - filtered.length;
          if (skipped > 0) {
            const skippedNames = updatedMods
              .filter(m => !iniWorkshopIds.has(String(m.workshopId)))
              .map(m => `${m.name} (${m.workshopId})`)
              .join(', ');
            log.info(`Skipping ${skipped} phantom update(s) for mods not in server INI: ${skippedNames}`);
          }
          updatedMods.length = 0;
          updatedMods.push(...filtered);
        } else {
          log.debug('Could not read server INI workshop IDs — not filtering phantom updates');
        }
      } catch (filterErr) {
        log.warn(`Failed to filter updates against INI config: ${filterErr.message}`);
      }

      this.modsNeedingUpdate = updatedMods;

      // Batch-mark every mod we successfully queried as "just checked".
      // Without this, individual rows in the UI keep showing "Never checked"
      // even after the global timestamp updates, making the button feel broken.
      try {
        const updatesById = new Map(updatedMods.map(m => [m.workshopId, 1]));
        let checkedIds;
        if (steamData.size > 0) {
          // Steam API succeeded — every queried id was definitively checked
          checkedIds = new Set(steamData.keys());
        } else {
          // ACF-only fallback — every locally-installed mod was compared.
          // Also mark tracked-but-not-in-ACF mods as checked so the row
          // doesn't stick on "Never checked" through ACF-only runs.
          checkedIds = new Set([...localTimestamps.keys(), ...trackedMap.keys()]);
        }
        await markModsChecked(checkedIds, updatesById);
      } catch (markErr) {
        log.warn(`Failed to mark mods as checked: ${markErr.message}`);
      }

      if (updatedMods.length > 0) {
        log.info(`${updatedMods.length} mod(s) have updates available`);
        await logServerEvent('mod_update_detected', JSON.stringify(updatedMods.map(m => m.name)));
        
        if (this.io) {
          this.io.emit('mods:updates_available', { 
            count: updatedMods.length,
            mods: updatedMods 
          });
        }
        
        // Filter out mods whose exact steam timestamp was already processed (dedup)
        const newUpdates = updatedMods.filter(m => {
          const steamTs = m.latestTimestamp?.getTime?.() || 0;
          const prevTs = this.processedUpdates.get(m.workshopId);
          if (prevTs && prevTs === steamTs) {
            log.debug(`Skipping already-processed update for ${m.name} (${m.workshopId}) — steam ts: ${steamTs}`);
            return false;
          }
          return true;
        });
        
        if (newUpdates.length === 0 && updatedMods.length > 0) {
          log.info(`All ${updatedMods.length} update(s) already processed — skipping callback`);
        }
        
        // Check startup grace period — don't trigger auto-restart too soon after startup
        const inGracePeriod = this.startedAt && (Date.now() - this.startedAt < this.startupGraceMs);
        if (inGracePeriod && newUpdates.length > 0) {
          const remaining = Math.round((this.startupGraceMs - (Date.now() - this.startedAt)) / 1000);
          log.info(`Startup grace period active (${remaining}s remaining) — skipping auto-restart for ${newUpdates.length} update(s)`);
          newUpdates.length = 0; // Clear — don't trigger callback during grace
        }
        
        // Only trigger callback if NOT already pending a restart AND there are genuinely new updates
        if (this.onUpdateCallback && !this.pendingRestart && newUpdates.length > 0) {
          try {
            log.info(`Triggering auto-restart callback for ${newUpdates.length} new update(s)`);
            await this.onUpdateCallback(newUpdates);
            // Mark these updates as processed ONLY if a restart actually proceeded
            // (handleModUpdate/triggerModRestart sets pendingRestart=true on success and
            // false on early aborts like "RCON not connected"). Marking processed when
            // the restart aborted would suppress retries on every subsequent poll.
            if (this.pendingRestart) {
              for (const m of newUpdates) {
                const steamTs = m.latestTimestamp?.getTime?.() || 0;
                if (steamTs) {
                  this.processedUpdates.set(m.workshopId, steamTs);
                }
              }
            } else {
              log.info('Restart did not proceed (likely aborted) — keeping updates eligible for retry on next cycle');
            }
          } catch (callbackError) {
            log.error(`Mod update callback failed: ${callbackError.message}`);
          }
        } else if (this.pendingRestart) {
          log.debug('Restart already pending, skipping callback');
        }
      } else {
        log.debug('No mod updates available');
      }

      return { updated: updatedMods.length > 0, mods: updatedMods };
    } catch (error) {
      log.error(`Mod update check failed: ${error.message}`);
      return { updated: false, mods: [], error: error.message };
    } finally {
      this.checkInProgress = false;
    }
  }

  // Get workshop info from ACF file, enriched with cached Steam API data
  async getWorkshopInfo() {
    if (!this.workshopAcfPath || !fs.existsSync(this.workshopAcfPath)) {
      return {};
    }
    
    try {
      let content = fs.readFileSync(this.workshopAcfPath, 'utf-8');
      if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
      const parsed = this.parseAcfFile(content);
      
      const result = {};
      for (const [workshopId, installed] of Object.entries(parsed.installedMods)) {
        const details = parsed.modDetails[workshopId] || {};
        const steamInfo = this.lastSteamTimestamps.get(workshopId);
        // Prefer Steam API timestamp, fall back to ACF latest_timeupdated
        const latestTime = steamInfo?.time_updated || details.latest_timeupdated || installed.timeupdated;
        result[workshopId] = {
          size: installed.size,
          timeupdated: installed.timeupdated,
          latest_timeupdated: latestTime,
          needsUpdate: latestTime > installed.timeupdated
        };
      }
      
      return result;
    } catch (error) {
      log.error(`Failed to read workshop ACF: ${error.message}`);
      return {};
    }
  }

  async addModToTrack(workshopId) {
    try {
      const { addTrackedMod } = await import('../database/init.js');
      
      // Try to resolve the real name from mod.info on disk
      const nameFromDisk = this.resolveModNameFromDisk(workshopId);
      const modName = nameFromDisk || `Workshop Mod ${workshopId}`;
      
      // Try to get mod info from local ACF file
      const allInfo = await this.getWorkshopInfo();
      const modInfo = allInfo[workshopId];
      
      if (modInfo) {
        await addTrackedMod(workshopId, modName);
        if (modInfo.timeupdated) {
          await updateModTimestamp(workshopId, new Date(modInfo.timeupdated * 1000).toISOString());
        }
        return { success: true, name: modName, needsUpdate: modInfo.needsUpdate };
      } else {
        // Mod not in ACF (not subscribed on this server) - still add to tracking
        await addTrackedMod(workshopId, modName);
        return { success: true, name: modName, note: 'Mod not found in Steam Workshop cache - may not be subscribed' };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getStatus() {
    const trackedMods = await getTrackedMods() || [];
    const workshopInfo = await this.getWorkshopInfo();
    // Only count updates for mods that are actually listed in the server INI.
    // Mods downloaded into the Workshop folder but absent from WorkshopItems=
    // can't be applied by a restart, so reporting them here triggers the
    // "flags out of sync" banner in the UI (see the phantom-update filter
    // applied in checkForUpdates).
    let iniWorkshopIds = null;
    try {
      iniWorkshopIds = await this.getConfiguredWorkshopIds();
    } catch { /* fall through — leave null to skip filter */ }
    const modsWithUpdates = Object.entries(workshopInfo).filter(([id, info]) => {
      if (!info.needsUpdate) return false;
      if (iniWorkshopIds && iniWorkshopIds.size > 0 && !iniWorkshopIds.has(String(id))) return false;
      return true;
    }).length;

    return {
      running: !!this.intervalId,
      lastCheck: this.lastCheck instanceof Date ? this.lastCheck.toISOString() : (this.lastCheck || null),
      lastUpdateDetected: this.lastUpdateDetected instanceof Date ? this.lastUpdateDetected.toISOString() : (this.lastUpdateDetected || null),
      checkInterval: this.checkInterval,
      modsNeedingUpdate: this.modsNeedingUpdate,
      workshopAcfConfigured: !!this.workshopAcfPath && fs.existsSync(this.workshopAcfPath),
      workshopAcfPath: this.workshopAcfPath,
      totalModsInWorkshop: Object.keys(workshopInfo).length,
      totalModsTracked: Array.isArray(trackedMods) ? trackedMods.length : 0,
      updatesAvailable: modsWithUpdates,
      autoRestartEnabled: this.autoRestartEnabled,
      // Restart options
      restartWarningMinutes: this.restartWarningMinutes,
      delayIfPlayersOnline: this.delayIfPlayersOnline,
      maxDelayMinutes: this.maxDelayMinutes,
      pendingRestart: this.pendingRestart
    };
  }

  async setCheckInterval(intervalMs) {
    this.checkInterval = Math.max(60000, intervalMs);
    await setSetting('modCheckInterval', this.checkInterval);
    if (this.intervalId) {
      this.stop();
      this.start();
    }
  }

  // Cancel pending restart (if waiting for players)
  cancelPendingRestart() {
    if (this.playerCheckInterval) {
      clearInterval(this.playerCheckInterval);
      this.playerCheckInterval = null;
    }
    this.pendingRestart = false;
    // Clear the dedup map so the same mod updates can re-trigger a restart
    // on the next check cycle. Without this, cancelling marks every pending
    // mod as "already processed" forever, so auto-restart silently stays
    // dormant until Steam republishes a newer version of each mod.
    this.processedUpdates.clear();
    // Also cancel any in-progress scheduler countdown
    this.scheduler?.cancelRestart();
    log.info('Pending restart cancelled');
    
    if (this.io) {
      this.io.emit('mods:restart_cancelled', {});
    }
  }
}
