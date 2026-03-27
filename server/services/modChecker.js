import { createLogger } from '../utils/logger.js';
const log = createLogger('Mods');
import { getTrackedMods, updateModTimestamp, logServerEvent, getSetting, setSetting, addTrackedMod, getActiveServer } from '../database/init.js';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { sanitizeError } from '../utils/sanitize.js';

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
      // OR sometimes just 'mods/ModName'
      // We need to find valid mod folders
      const modsDir = path.join(contentDir, 'mods');
      if (fs.existsSync(modsDir)) {
         const modFolders = fs.readdirSync(modsDir);
         // Just take the first valid mod found in the package
         for (const folder of modFolders) {
            const modInfoPath = path.join(modsDir, folder, 'mod.info');
            if (fs.existsSync(modInfoPath)) {
               const content = fs.readFileSync(modInfoPath, 'utf-8');
               const nameMatch = content.match(/name=(.+)/);
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
      const content = fs.readFileSync(this.workshopAcfPath, 'utf-8');
      const parsed = this.parseAcfFile(content);
      
      const workshopIds = Object.keys(parsed.installedMods);
      
      if (workshopIds.length === 0) {
        log.debug('No mods found in workshop ACF');
        return;
      }
      
      // Add all mods to tracking
      let synced = 0;
      for (const id of workshopIds) {
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

    this.intervalId = setInterval(() => this.checkForUpdates(), this.checkInterval);
    log.info(`Mod checker started - checking every ${Math.round(this.checkInterval / 1000)}s`);
    
    // Run initial check
    this.checkForUpdates();
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
    // Persist to database
    await setSetting('modAutoRestartEnabled', this.autoRestartEnabled);
  }

  // Configure restart options
  async setRestartOptions(options) {
    if (options.warningMinutes !== undefined) {
      this.restartWarningMinutes = Math.max(0, Math.min(30, options.warningMinutes));
      await setSetting('modRestartWarningMinutes', this.restartWarningMinutes);
    }
    if (options.delayIfPlayersOnline !== undefined) {
      this.delayIfPlayersOnline = !!options.delayIfPlayersOnline;
      await setSetting('modDelayIfPlayersOnline', this.delayIfPlayersOnline);
    }
    if (options.maxDelayMinutes !== undefined) {
      this.maxDelayMinutes = Math.max(5, Math.min(120, options.maxDelayMinutes));
      await setSetting('modMaxDelayMinutes', this.maxDelayMinutes);
    }
    if (options.checkInterval !== undefined) {
      this.checkInterval = Math.max(60000, options.checkInterval);
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
      log.debug('Restart already pending, ignoring handleModUpdate');
      return;
    }

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
    await this.triggerModRestart(updatedMods);
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
          this.pendingRestart = false;
          await this.triggerModRestart(updatedMods);
          return;
        }
        
        // Check player count
        const playerCount = await this.getOnlinePlayerCount();
        
        if (playerCount === 0) {
          log.info('No players online, triggering restart');
          clearInterval(this.playerCheckInterval);
          this.playerCheckInterval = null;
          this.pendingRestart = false;
          await this.triggerModRestart(updatedMods);
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
    }, 30000); // Check every 30 seconds
  }

  // Trigger the actual restart
  async triggerModRestart(updatedMods) {
    log.info(`Triggering restart for ${updatedMods.length} updated mod(s)`);
    
    const modNames = updatedMods.map(m => m.name).join(', ');
    
    if (this.io) {
      this.io.emit('mods:restart_starting', { 
        mods: updatedMods,
        warningMinutes: this.restartWarningMinutes
      });
    }
    
    try {
      // Send warning message
      await this.scheduler.rconService?.serverMessage(
        `🔧 Mod updates detected: ${modNames.substring(0, 100)}${modNames.length > 100 ? '...' : ''}. Server will restart in ${this.restartWarningMinutes} minute(s).`
      );
      
      // Perform restart with configured warning time
      await this.scheduler.performRestart(this.restartWarningMinutes);
      
      await logServerEvent('mod_update_restart', `Restarted for mod updates: ${modNames}`);
      
      if (this.io) {
        this.io.emit('mods:restart_complete', { mods: updatedMods });
      }
    } catch (error) {
      log.error(`Restart failed: ${error.message}`);
      if (this.io) {
        this.io.emit('mods:restart_failed', { error: sanitizeError(error.message) });
      }
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
    for (let i = 0; i < workshopIds.length; i += BATCH) {
      const batch = workshopIds.slice(i, i + BATCH);
      let timeout;
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
          continue;
        }

        const data = await res.json();
        const items = data?.response?.publishedfiledetails || [];
        for (const item of items) {
          if (item.result === 1 && item.publishedfileid) {
            result.set(item.publishedfileid, {
              time_updated: item.time_updated || 0,
              title: item.title || null
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
      const content = fs.readFileSync(this.workshopAcfPath, 'utf-8');
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

      // Query Steam Web API for latest timestamps
      const workshopIds = [...localTimestamps.keys()];
      const steamData = await this.fetchSteamTimestamps(workshopIds);

      // Cache steam data for getStatus() / getWorkshopInfo()
      if (steamData.size > 0) {
        this.lastSteamTimestamps = steamData;
      }

      if (steamData.size === 0) {
        // API failed entirely — fall back to ACF-only comparison
        log.warn('Steam API returned no data, falling back to ACF-only check');
        for (const [workshopId, details] of Object.entries(parsed.modDetails)) {
          const { timeupdated, latest_timeupdated } = details;
          if (latest_timeupdated > timeupdated) {
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
      this.modsNeedingUpdate = updatedMods;

      if (updatedMods.length > 0) {
        log.info(`${updatedMods.length} mod(s) have updates available`);
        await logServerEvent('mod_update_detected', JSON.stringify(updatedMods.map(m => m.name)));
        
        if (this.io) {
          this.io.emit('mods:updates_available', { 
            count: updatedMods.length,
            mods: updatedMods 
          });
        }
        
        // Only trigger callback if NOT already pending a restart
        if (this.onUpdateCallback && !this.pendingRestart) {
          try {
            await this.onUpdateCallback(updatedMods);
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
      const content = fs.readFileSync(this.workshopAcfPath, 'utf-8');
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
    const modsWithUpdates = Object.entries(workshopInfo).filter(([, info]) => info.needsUpdate).length;
    
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
    log.info('Pending restart cancelled');
    
    if (this.io) {
      this.io.emit('mods:restart_cancelled', {});
    }
  }
}
