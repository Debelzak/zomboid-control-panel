import express from 'express';
import path from 'path';
import fs from 'fs';
import { promises as fsp } from 'fs';
import os from 'os';
import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';
const log = createLogger('API:Mods');
import { getTrackedMods, addTrackedMod, removeTrackedMod, clearModUpdates, getSetting, getActiveServer, getModPresets, createModPreset, updateModPreset, deleteModPreset, addIgnoredMod, getIgnoredMods, removeIgnoredMod, clearAllIgnoredMods, isModIgnored, getIgnoredModPairs, addIgnoredModPair, removeIgnoredModPair } from '../database/init.js';
import { sanitizeError, sanitizeIniValue, sanitizeIniList } from '../utils/sanitize.js';
import {
  getCollectionContents,
  addItemToCollection,
  removeItemFromCollection,
  computeDiff as computeCollectionDiff,
  syncSingleChange as autoSyncCollection,
} from '../services/workshopCollectionSync.js';

const router = express.Router();

// ─── INI write mutex ────────────────────────────────────────────────────────
// Serialises write operations to the same INI file so concurrent requests
// cannot interleave their writes (prevents lost-update race conditions).
const iniLocks = new Map();          // iniPath → Promise chain
function withIniLock(iniPath, fn) {
  const prev = iniLocks.get(iniPath) || Promise.resolve();
  const next = prev.then(fn, fn);    // run fn regardless of previous result
  iniLocks.set(iniPath, next);
  return next;
}

// Strip UTF-8 BOM (byte-order mark) that some text editors prepend to files.
// If present, the BOM breaks regex patterns anchored with ^ on the first line.
function stripBom(str) {
  return str.charCodeAt(0) === 0xFEFF ? str.slice(1) : str;
}

// Read a text file as UTF-8 with BOM stripping and CRLF normalisation
function readTextFile(filePath) {
  return stripBom(fs.readFileSync(filePath, 'utf-8')).replace(/\r\n/g, '\n');
}

// Security: INI sanitization imported from shared util
// sanitizeIniValue strips \r\n;= to prevent injection
// sanitizeIniList joins sanitized values with semicolons

function getSanitizedIniPath(serverConfigPath, serverName) {
  if (!serverConfigPath || typeof serverName !== 'string') {
    return null;
  }

  const sanitizedServerName = path.basename(serverName);
  if (!sanitizedServerName || sanitizedServerName !== serverName || serverName.includes('..')) {
    return null;
  }

  return path.join(serverConfigPath, `${sanitizedServerName}.ini`);
}

// Helper functions for multi-server support
async function getServerConfigPath() {
  const activeServer = await getActiveServer();
  
  // First, use explicitly configured serverConfigPath if available
  if (activeServer?.serverConfigPath) {
    return activeServer.serverConfigPath;
  }
  
  // Fallback to zomboidDataPath + Server (like serverFiles.js does)
  if (activeServer?.zomboidDataPath) {
    return path.join(activeServer.zomboidDataPath, 'Server');
  }
  
  // Fallback to legacy settings
  const legacyPath = await getSetting('serverConfigPath');
  if (legacyPath) return legacyPath;
  
  const legacyZomboidPath = await getSetting('zomboidDataPath');
  if (legacyZomboidPath) {
    return path.join(legacyZomboidPath, 'Server');
  }
  
  return null;
}

async function getServerName() {
  const activeServer = await getActiveServer();
  if (activeServer?.serverName) {
    return activeServer.serverName;
  }
  const legacyName = await getSetting('serverName');
  return legacyName || 'servertest';
}

async function getServerPath() {
  const activeServer = await getActiveServer();
  if (activeServer?.installPath) {
    return activeServer.installPath;
  }
  const legacyPath = await getSetting('serverPath');
  return legacyPath || null;
}

// Helper to get modChecker with null check
function getModChecker(req, res) {
  const modChecker = req.app.get('modChecker');
  if (!modChecker) {
    res.status(500).json({ error: 'Mod checker not initialized' });
    return null;
  }
  return modChecker;
}

// Get mod checker status
router.get('/status', async (req, res) => {
  try {
    const modChecker = getModChecker(req, res);
    if (!modChecker) return;
    
    const status = await modChecker.getStatus();
    res.json(status);
  } catch (error) {
    log.error(`Failed to get mod checker status: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Get all tracked mods
router.get('/tracked', async (req, res) => {
  try {
    // ─── Auto-track from INI ────────────────────────────────────────────────
    // Tracking is no longer a user-managed concept: any workshop ID present
    // in the server's INI is automatically tracked so it gets polled for
    // Workshop updates (which trigger the auto-restart). This keeps the
    // mental model simple — "what's on the server is what gets tracked".
    // We skip mods the user has explicitly removed (ignore list) so this
    // doesn't fight the "Remove from server" action.
    try {
      const serverConfigPath = await getServerConfigPath();
      const serverName = await getServerName();
      if (serverConfigPath && serverName) {
        const sanitizedServerName = path.basename(serverName);
        if (sanitizedServerName === serverName && !serverName.includes('..')) {
          const iniPath = path.join(serverConfigPath, `${sanitizedServerName}.ini`);
          if (fs.existsSync(iniPath)) {
            const content = readTextFile(iniPath);
            const workshopMatch = content.match(/^WorkshopItems=(.*)$/m);
            const workshopIds = workshopMatch?.[1]?.split(';').filter(Boolean) || [];
            if (workshopIds.length > 0) {
              const trackedNow = await getTrackedMods();
              const trackedSet = new Set(trackedNow.map(m => m.workshop_id));
              const modChecker = req.app.get('modChecker');
              let added = 0;
              for (const wsId of workshopIds) {
                if (!/^\d{1,15}$/.test(wsId)) continue;
                if (trackedSet.has(wsId)) continue;
                if (await isModIgnored(wsId)) continue;
                const nameFromDisk = modChecker?.resolveModNameFromDisk(wsId);
                await addTrackedMod(wsId, nameFromDisk || `Workshop Mod ${wsId}`);
                added++;
              }
              if (added > 0) log.info(`Auto-tracked ${added} mods from INI`);
            }
          }
        }
      }
    } catch (e) {
      log.debug(`Auto-track from INI skipped: ${e.message}`);
    }

    const mods = await getTrackedMods();
    
    // Enrich mods that still have generic "Workshop Mod" names with real names from disk
    const modChecker = req.app.get('modChecker');
    if (modChecker) {
      let updated = 0;
      for (const mod of mods) {
        if (!mod.name || mod.name.startsWith('Workshop Mod ')) {
          const realName = modChecker.resolveModNameFromDisk(mod.workshop_id);
          if (realName) {
            mod.name = realName;
            // Persist the resolved name in the database
            await addTrackedMod(mod.workshop_id, realName);
            updated++;
          }
        }
      }
      if (updated > 0) {
        log.debug(`Resolved ${updated} mod names from disk`);
      }
    }
    
    res.json({ mods });
  } catch (error) {
    log.error(`Failed to get tracked mods: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Add a mod to track
router.post('/track', async (req, res) => {
  try {
    const modChecker = getModChecker(req, res);
    if (!modChecker) return;
    
    const { workshopId } = req.body;
    log.info(`POST /track: workshopId=${workshopId}`);
    
    if (!workshopId) {
      return res.status(400).json({ error: 'Workshop ID is required' });
    }
    
    const workshopIdStr = String(workshopId);
    if (!/^\d{1,15}$/.test(workshopIdStr)) {
      return res.status(400).json({ error: 'Invalid Workshop ID format' });
    }
    
    // Clear from ignore list if present (user explicitly wants to track this)
    await removeIgnoredMod(workshopIdStr);
    
    const result = await modChecker.addModToTrack(workshopIdStr);
    // Best-effort Workshop collection mirror — fire-and-forget so the user's
    // tracking action never blocks on Steam being slow or cookies being stale.
    autoSyncCollection('add', workshopIdStr).catch(() => {});
    res.json(result);
  } catch (error) {
    log.error(`Failed to add mod to track: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Remove a mod from tracking
router.delete('/track/:workshopId', async (req, res) => {
  try {
    const { workshopId } = req.params;
    
    // Validate workshopId is a numeric string
    if (!workshopId || !/^\d{1,15}$/.test(workshopId)) {
      return res.status(400).json({ error: 'Invalid workshop ID' });
    }
    
    // Get mod name before removing (for the ignore list)
    const trackedMods = await getTrackedMods();
    const mod = trackedMods.find(m => m.workshop_id === workshopId);
    
    await removeTrackedMod(workshopId);
    // Add to ignored list so auto-sync won't re-add it
    await addIgnoredMod(workshopId, mod?.name || null);
    // Mirror removal into the Workshop collection if auto-sync is on.
    autoSyncCollection('remove', workshopId).catch(() => {});
    res.json({ success: true, message: 'Mod removed from tracking and added to ignore list' });
  } catch (error) {
    log.error(`Failed to remove tracked mod: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// ============================================
// Ignored Mods Management
// ============================================

// Get all ignored mods for the active server
router.get('/ignored', async (req, res) => {
  try {
    const ignored = await getIgnoredMods();
    res.json(ignored);
  } catch (error) {
    log.error(`Failed to get ignored mods: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Un-ignore a mod (allow it to be tracked again)
router.delete('/ignored/:workshopId', async (req, res) => {
  try {
    const { workshopId } = req.params;
    if (!workshopId || !/^\d{1,15}$/.test(workshopId)) {
      return res.status(400).json({ error: 'Invalid workshop ID' });
    }
    const removed = await removeIgnoredMod(workshopId);
    if (!removed) {
      return res.status(404).json({ error: 'Mod not found in ignore list' });
    }
    res.json({ success: true, message: 'Mod removed from ignore list' });
  } catch (error) {
    log.error(`Failed to un-ignore mod: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Clear all ignored mods for the active server
router.delete('/ignored', async (req, res) => {
  try {
    const removed = await clearAllIgnoredMods();
    res.json({ success: true, message: `Cleared ${removed} ignored mod${removed !== 1 ? 's' : ''}`, removed });
  } catch (error) {
    log.error(`Failed to clear ignored mods: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// ============================================
// Ignored mod-conflict pairs (false positives on the variant detector)
// ============================================

const MOD_ID_RE = /^[A-Za-z0-9_.\-+ ()]{1,128}$/;

router.get('/ignored-pairs', async (req, res) => {
  try {
    const pairs = await getIgnoredModPairs();
    res.json(pairs);
  } catch (error) {
    log.error(`Failed to get ignored mod pairs: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

router.post('/ignored-pairs', async (req, res) => {
  try {
    const { modIdA, modIdB, reason } = req.body || {};
    if (typeof modIdA !== 'string' || typeof modIdB !== 'string' ||
        !MOD_ID_RE.test(modIdA) || !MOD_ID_RE.test(modIdB)) {
      return res.status(400).json({ error: 'modIdA and modIdB are required and must be valid mod IDs' });
    }
    if (modIdA === modIdB) {
      return res.status(400).json({ error: 'modIdA and modIdB must differ' });
    }
    const safeReason = typeof reason === 'string' ? reason.slice(0, 200) : null;
    const entry = await addIgnoredModPair(modIdA, modIdB, safeReason);
    if (!entry) return res.status(400).json({ error: 'Invalid pair' });
    res.json({ success: true, pair: entry });
  } catch (error) {
    log.error(`Failed to add ignored mod pair: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

router.delete('/ignored-pairs', async (req, res) => {
  try {
    const { modIdA, modIdB } = req.body || {};
    if (typeof modIdA !== 'string' || typeof modIdB !== 'string' ||
        !MOD_ID_RE.test(modIdA) || !MOD_ID_RE.test(modIdB)) {
      return res.status(400).json({ error: 'modIdA and modIdB are required' });
    }
    const removed = await removeIgnoredModPair(modIdA, modIdB);
    if (!removed) return res.status(404).json({ error: 'Pair not found in ignore list' });
    res.json({ success: true });
  } catch (error) {
    log.error(`Failed to remove ignored mod pair: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Manually check for mod updates
router.post('/check-updates', async (req, res) => {
  try {
    const modChecker = getModChecker(req, res);
    if (!modChecker) return;
    
    const result = await modChecker.checkForUpdates();
    res.json(result);
  } catch (error) {
    log.error(`Failed to check for updates: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Get mod list from server config
router.get('/server-mods', async (req, res) => {
  try {
    const serverManager = req.app.get('serverManager');
    const mods = await serverManager.getModList();
    res.json({ mods });
  } catch (error) {
    log.error(`Failed to get server mods: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Check mods via RCON
router.get('/check-rcon', async (req, res) => {
  try {
    const rconService = req.app.get('rconService');
    const result = await rconService.checkModsNeedUpdate();
    res.json(result);
  } catch (error) {
    log.error(`Failed to check mods via RCON: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Start mod checker
router.post('/start', async (req, res) => {
  try {
    const modChecker = getModChecker(req, res);
    if (!modChecker) return;
    
    modChecker.start();
    res.json({ success: true, message: 'Mod checker started' });
  } catch (error) {
    log.error(`Failed to start mod checker: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Stop mod checker
router.post('/stop', async (req, res) => {
  try {
    const modChecker = getModChecker(req, res);
    if (!modChecker) return;
    
    modChecker.stop();
    res.json({ success: true, message: 'Mod checker stopped' });
  } catch (error) {
    log.error(`Failed to stop mod checker: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Set check interval
router.put('/interval', async (req, res) => {
  try {
    const modChecker = getModChecker(req, res);
    if (!modChecker) return;
    
    const { intervalMs } = req.body;
    
    if (!intervalMs || intervalMs < 60000) {
      return res.status(400).json({ error: 'Interval must be at least 60000ms (1 minute)' });
    }
    
    modChecker.setCheckInterval(intervalMs);
    res.json({ success: true, message: `Check interval set to ${intervalMs}ms` });
  } catch (error) {
    log.error(`Failed to set check interval: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Enable auto-restart on mod update
router.post('/auto-restart', async (req, res) => {
  try {
    const modChecker = getModChecker(req, res);
    if (!modChecker) return;
    
    const { enabled } = req.body;
    
    if (enabled) {
      await modChecker.setUpdateCallback(async (updatedMods) => {
        await modChecker.handleModUpdate(updatedMods);
      });
    } else {
      await modChecker.setUpdateCallback(null);
    }
    
    res.json({ success: true, autoRestart: enabled });
  } catch (error) {
    log.error(`Failed to configure auto-restart: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Configure restart options
router.put('/restart-options', async (req, res) => {
  try {
    const modChecker = getModChecker(req, res);
    if (!modChecker) return;
    
    const { warningMinutes, delayIfPlayersOnline, maxDelayMinutes, checkInterval } = req.body;
    
    await modChecker.setRestartOptions({
      warningMinutes,
      delayIfPlayersOnline,
      maxDelayMinutes,
      checkInterval
    });
    
    const status = await modChecker.getStatus();
    res.json({ 
      success: true, 
      options: {
        warningMinutes: status.restartWarningMinutes,
        delayIfPlayersOnline: status.delayIfPlayersOnline,
        maxDelayMinutes: status.maxDelayMinutes,
        checkInterval: status.checkInterval
      }
    });
  } catch (error) {
    log.error(`Failed to set restart options: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Get workshop ACF status (Steam API key no longer needed - using local ACF file)
router.get('/workshop-status', async (req, res) => {
  try {
    const modChecker = getModChecker(req, res);
    if (!modChecker) return;
    
    const status = await modChecker.getStatus();
    
    res.json({ 
      success: true, 
      configured: status.workshopAcfConfigured,
      workshopAcfPath: status.workshopAcfPath,
      message: status.workshopAcfConfigured 
        ? 'Workshop ACF file found - mod updates can be detected automatically' 
        : 'Workshop ACF file not found - ensure server install path is correct'
    });
  } catch (error) {
    log.error(`Failed to get workshop status: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Cancel pending restart (if waiting for players)
router.post('/cancel-pending-restart', async (req, res) => {
  try {
    const modChecker = getModChecker(req, res);
    if (!modChecker) return;
    
    if (!modChecker.pendingRestart) {
      return res.json({ success: false, message: 'No pending restart to cancel' });
    }
    
    modChecker.cancelPendingRestart();
    res.json({ success: true, message: 'Pending restart cancelled' });
  } catch (error) {
    log.error(`Failed to cancel pending restart: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Sync mods from server config
router.post('/sync-from-server', async (req, res) => {
  try {
    // Use direct INI reading (more reliable than serverManager which has path issues)
    const serverConfigPath = await getServerConfigPath();
    const serverName = await getServerName();
    
    if (!serverConfigPath) {
      log.warn('sync-from-server: Server config path not set');
      return res.json({ 
        success: false, 
        message: 'Server config path not set. Please configure the server first.',
        synced: 0 
      });
    }
    
    // Sanitize serverName
    const sanitizedServerName = path.basename(serverName);
    if (!sanitizedServerName || sanitizedServerName !== serverName || serverName.includes('..')) {
      return res.status(400).json({ error: 'Invalid server name' });
    }
    
    const iniPath = path.join(serverConfigPath, `${sanitizedServerName}.ini`);
    log.info(`sync-from-server: Looking for config at ${iniPath}`);
    
    if (!fs.existsSync(iniPath)) {
      log.warn(`sync-from-server: Config file not found at ${iniPath}`);
      return res.json({ 
        success: false, 
        message: `Server config not found at ${iniPath}. Start the server once first.`,
        synced: 0 
      });
    }
    
    // Read and parse the INI file (normalize CRLF for cross-platform compatibility)
    const content = readTextFile(iniPath);
    const modsMatch = content.match(/^Mods=(.*)$/m);
    const workshopMatch = content.match(/^WorkshopItems=(.*)$/m);
    
    const modIds = modsMatch?.[1]?.split(';').filter(Boolean) || [];
    const workshopIds = workshopMatch?.[1]?.split(';').filter(Boolean) || [];
    
    log.info(`sync-from-server: Found ${modIds.length} mod IDs and ${workshopIds.length} workshop IDs`);
    
    if (workshopIds.length === 0) {
      return res.json({ 
        success: true, 
        message: 'No mods found in server configuration (WorkshopItems is empty)',
        synced: 0 
      });
    }
    
    // Query Steam API to identify non-mod items (collections, screenshots, etc.)
    // Real PZ mods have creator_app_id 108600; collections/screenshots use 766 (Steam tools)
    const PZ_APP_ID = 108600;
    const modChecker = req.app.get('modChecker');
    let steamInfo = new Map();
    const nonModTypes = new Set();
    if (modChecker) {
      try {
        steamInfo = await modChecker.fetchSteamTimestamps(workshopIds);
        for (const [id, info] of steamInfo) {
          if (info.creator_app_id && info.creator_app_id !== PZ_APP_ID) {
            nonModTypes.add(id);
            log.info(`sync-from-server: Filtering "${info.title || id}" (creator_app_id: ${info.creator_app_id}, not a PZ mod)`);
          }
        }
      } catch (e) {
        log.warn(`sync-from-server: Steam API lookup failed, proceeding without type filter: ${e.message}`);
      }
    }

    // Add each workshop ID to tracking
    let synced = 0;
    let skippedIgnored = 0;
    let skippedNonMod = 0;
    for (let i = 0; i < workshopIds.length; i++) {
      try {
        const workshopId = workshopIds[i];
        // Skip non-mod items (collections, screenshots, etc.)
        if (nonModTypes.has(workshopId)) {
          skippedNonMod++;
          continue;
        }
        // Skip mods the user explicitly ignored
        if (await isModIgnored(workshopId)) {
          skippedIgnored++;
          continue;
        }
        // Try to resolve real name from mod.info on disk, fall back to mod ID from INI
        const nameFromDisk = modChecker?.resolveModNameFromDisk(workshopId);
        // Use Steam API title if available, then disk name, then INI mod ID
        const steamTitle = steamInfo.get(workshopId)?.title;
        const modName = steamTitle || nameFromDisk || modIds[i] || `Workshop Mod ${workshopId}`;
        await addTrackedMod(workshopId, modName);
        synced++;
      } catch (e) {
        log.warn(`Failed to sync mod ${workshopIds[i]}: ${e.message}`);
      }
    }
    
    const parts = [];
    if (skippedIgnored > 0) parts.push(`${skippedIgnored} ignored`);
    if (skippedNonMod > 0) parts.push(`${skippedNonMod} non-mod items filtered`);
    const message = parts.length > 0
      ? `Synced ${synced} mods from server config (${parts.join(', ')})`
      : `Synced ${synced} mods from server config`;
    res.json({ 
      success: true, 
      message,
      synced,
      skippedIgnored,
      skippedNonMod,
      iniPath
    });
  } catch (error) {
    log.error(`Failed to sync mods from server: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Clear all update flags
router.post('/clear-updates', async (req, res) => {
  try {
    await clearModUpdates();
    res.json({ success: true, message: 'Update flags cleared' });
  } catch (error) {
    log.error(`Failed to clear mod updates: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// ============================================
// Workshop Collection Sync
// Mirrors the tracked-mod list into a user-owned Steam Workshop collection.
// Reads are public; writes need the user's session cookies (settings).
// ============================================

router.get('/collection/diff', async (req, res) => {
  try {
    const tracked = await getTrackedMods();
    const ids = tracked.map((m) => String(m.workshop_id));
    const diff = await computeCollectionDiff(ids);
    res.json({
      ...diff,
      collectionId: await getSetting('workshopCollectionId') || null,
      autoSync: !!(await getSetting('workshopCollectionAutoSync')),
      hasCredentials: !!((await getSetting('steamSessionId')) && (await getSetting('steamLoginSecure'))),
      trackedCount: ids.length,
    });
  } catch (error) {
    log.error(`Collection diff failed: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

router.post('/collection/sync', async (req, res) => {
  try {
    const collectionId = await getSetting('workshopCollectionId');
    if (!collectionId) {
      return res.status(400).json({ error: 'Collection ID not configured' });
    }
    const tracked = await getTrackedMods();
    const trackedIds = tracked.map((m) => String(m.workshop_id));
    const diff = await computeCollectionDiff(trackedIds);
    if (!diff.ok) {
      return res.status(502).json({ error: diff.error || 'Could not read collection' });
    }

    const added = [];
    const removed = [];
    const errors = [];
    let staleSession = false;

    // Sequential with a small delay keeps Steam happy when a fresh setup has
    // dozens of pending changes. Steam will silently throttle / 429 a tight
    // loop. The lists are usually small after the first run.
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const STALE_RE = /session expired|HTTP 302|HTTP 401|HTTP 403/i;

    for (const id of diff.toAdd) {
      const r = await addItemToCollection(collectionId, id);
      if (r.ok) added.push(id);
      else {
        errors.push({ action: 'add', id, error: r.error });
        if (r.error && STALE_RE.test(r.error)) { staleSession = true; break; }
      }
      await sleep(300);
    }
    if (!staleSession) {
      for (const id of diff.toRemove) {
        const r = await removeItemFromCollection(collectionId, id);
        if (r.ok) removed.push(id);
        else {
          errors.push({ action: 'remove', id, error: r.error });
          if (r.error && STALE_RE.test(r.error)) { staleSession = true; break; }
        }
        await sleep(300);
      }
    }

    res.json({
      success: errors.length === 0,
      collectionId,
      added,
      removed,
      errors,
      staleSession,
      message: errors.length === 0
        ? `Synced \u2014 added ${added.length}, removed ${removed.length}`
        : staleSession
          ? 'Steam session expired \u2014 paste fresh cookies and try again'
          : `Partial sync \u2014 ${errors.length} error${errors.length !== 1 ? 's' : ''}`,
    });
  } catch (error) {
    log.error(`Collection sync failed: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Validate that the configured cookies can edit the collection. Tries a
// no-mutation read of the collection first, then attempts a tiny add+remove
// dance on a known item to prove write access. We use the FIRST item already
// in the collection to avoid actually changing its contents.
router.post('/collection/test', async (req, res) => {
  try {
    const collectionId = await getSetting('workshopCollectionId');
    if (!collectionId) return res.status(400).json({ error: 'Collection ID not configured' });
    const sessionId = await getSetting('steamSessionId');
    const loginSecure = await getSetting('steamLoginSecure');
    if (!sessionId || !loginSecure) return res.status(400).json({ error: 'Steam session cookies not configured' });

    const contents = await getCollectionContents(collectionId);
    if (!contents.ok) return res.status(502).json({ error: contents.error || 'Could not read collection' });

    // Read-only test: confirms the collection ID is valid and reachable. We
    // deliberately do NOT exercise write access here — any write probe would
    // mutate the user's real collection. Write capability is verified the
    // first time a real sync runs, where a stale session surfaces clearly.
    res.json({
      success: true,
      collectionId,
      title: contents.title,
      itemCount: contents.items.length,
      writeVerified: false,
      message: contents.title
        ? `Collection "${contents.title}" found (${contents.items.length} items). Write access is verified on first sync.`
        : `Collection found (${contents.items.length} items). Write access is verified on first sync.`,
    });
  } catch (error) {
    log.error(`Collection test failed: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Get Steam Workshop collection details (extract all mods from a collection)
router.post('/import-collection', async (req, res) => {
  try {
    const { collectionUrl } = req.body;
    
    if (!collectionUrl) {
      return res.status(400).json({ error: 'Collection URL or ID is required' });
    }
    
    // Extract collection ID from URL or use directly
    let collectionId = collectionUrl;
    const urlMatch = collectionUrl.match(/id=(\d+)/);
    if (urlMatch) {
      collectionId = urlMatch[1];
    }
    
    // Validate it's a number
    if (!/^\d{1,15}$/.test(collectionId)) {
      return res.status(400).json({ error: 'Invalid collection ID' });
    }
    
    log.info(`Fetching collection details for ID: ${collectionId}`);
    
    // Use Steam API to get collection details
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    let collectionResponse;
    try {
      collectionResponse = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          'collectioncount': '1',
          'publishedfileids[0]': collectionId
        }),
        signal: controller.signal
      });
    } catch (error) {
      if (error.name === 'AbortError') {
        return res.status(504).json({ error: 'Steam collection lookup timed out. Please try again.' });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    
    if (!collectionResponse.ok) {
      throw new Error(`Steam API returned ${collectionResponse.status}`);
    }
    
    const collectionData = await collectionResponse.json();
    
    if (!collectionData.response?.collectiondetails?.[0]) {
      return res.status(404).json({ error: 'Collection not found' });
    }
    
    const collection = collectionData.response.collectiondetails[0];
    
    if (collection.result !== 1) {
      return res.status(404).json({ error: 'Collection not found or is private' });
    }
    
    const modIds = collection.children?.map(c => c.publishedfileid) || [];
    
    if (modIds.length === 0) {
      return res.json({ 
        success: true, 
        message: 'Collection is empty',
        mods: [] 
      });
    }
    
    // Now get details for each mod in the collection
    const modFormData = new URLSearchParams();
    modFormData.append('itemcount', modIds.length.toString());
    modIds.forEach((id, index) => {
      modFormData.append(`publishedfileids[${index}]`, id);
    });
    
    const modsAbort = new AbortController();
    const modsTimer = setTimeout(() => modsAbort.abort(), 15000);
    let modsResponse;
    try {
      modsResponse = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: modFormData,
        signal: modsAbort.signal
      });
    } finally { clearTimeout(modsTimer); }
    
    if (!modsResponse.ok) {
      throw new Error(`Steam API returned ${modsResponse.status}`);
    }
    
    const modsData = await modsResponse.json();
    
    const mods = (modsData.response?.publishedfiledetails || [])
      .filter(m => m.result === 1)
      .map(m => ({
        workshopId: m.publishedfileid,
        name: m.title,
        description: m.description?.substring(0, 200),
        tags: m.tags?.map(t => t.tag) || [],
        isMap: m.tags?.some(t => t.tag?.toLowerCase() === 'map' || t.tag?.toLowerCase() === 'maps') || false
      }));
    
    log.info(`Found ${mods.length} mods in collection ${collectionId}`);
    
    res.json({
      success: true,
      collectionId,
      totalMods: mods.length,
      mods
    });
  } catch (error) {
    log.error(`Failed to import collection: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Get mod info from Steam Workshop (for a single mod)
router.post('/get-mod-info', async (req, res) => {
  try {
    const { workshopId } = req.body;
    
    if (!workshopId) {
      return res.status(400).json({ error: 'Workshop ID is required' });
    }
    
    const workshopIdStr = String(workshopId);
    if (!/^\d{1,15}$/.test(workshopIdStr)) {
      return res.status(400).json({ error: 'Invalid Workshop ID format' });
    }
    
    const infoAbort = new AbortController();
    const infoTimer = setTimeout(() => infoAbort.abort(), 15000);
    let response;
    try {
      response = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          'itemcount': '1',
          'publishedfileids[0]': workshopId
        }),
        signal: infoAbort.signal
      });
    } finally { clearTimeout(infoTimer); }
    
    if (!response.ok) {
      throw new Error(`Steam API returned ${response.status}`);
    }
    
    const data = await response.json();
    const modInfo = data.response?.publishedfiledetails?.[0];
    
    if (!modInfo || modInfo.result !== 1) {
      return res.status(404).json({ error: 'Mod not found' });
    }
    
    res.json({
      workshopId: modInfo.publishedfileid,
      name: modInfo.title,
      description: modInfo.description?.substring(0, 500),
      tags: modInfo.tags?.map(t => t.tag) || [],
      isMap: modInfo.tags?.some(t => t.tag?.toLowerCase() === 'map' || t.tag?.toLowerCase() === 'maps') || false,
      timeUpdated: modInfo.time_updated,
      timeCreated: modInfo.time_created
    });
  } catch (error) {
    log.error(`Failed to get mod info: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Write mods to server .ini file
router.post('/write-to-ini', async (req, res) => {
  try {
    const { mods, mapFolders } = req.body;
    log.info(`POST /write-to-ini: ${mods?.length || 0} mods, ${mapFolders?.length || 0} map folders`);
    // mods: array of { workshopId, modId } where modId is the mod loading ID (from info.txt)
    // mapFolders: optional array of map folder names for map mods
    
    if (!mods || !Array.isArray(mods)) {
      return res.status(400).json({ error: 'Mods array is required' });
    }

    // Validate all workshopId values are numeric to prevent path traversal
    for (const m of mods) {
      if (m.workshopId && !/^\d{1,15}$/.test(String(m.workshopId))) {
        return res.status(400).json({ error: `Invalid Workshop ID: ${String(m.workshopId).substring(0, 20)}` });
      }
    }
    
    const serverConfigPath = await getServerConfigPath();
    const serverName = await getServerName();
    const serverPath = await getServerPath();
    
    if (!serverConfigPath) {
      return res.status(400).json({ error: 'Server config path not set. Please configure the server first.' });
    }
    
    // Sanitize serverName to prevent path traversal
    const sanitizedServerName = path.basename(serverName);
    if (!sanitizedServerName || sanitizedServerName !== serverName || serverName.includes('..')) {
      return res.status(400).json({ error: 'Invalid server name' });
    }
    
    const iniPath = path.join(serverConfigPath, `${sanitizedServerName}.ini`);
    
    if (!fs.existsSync(iniPath)) {
      return res.status(400).json({ 
        error: 'Server config file not found. Start the server once first to generate the config file.' 
      });
    }
    
    // Build the mod strings, auto-detecting mod IDs where possible
    // Mods= is semicolon-separated list of mod IDs (from mod's info.txt id= field)
    // WorkshopItems= is semicolon-separated list of Workshop IDs
    const resolvedMods = [];
    let autoDetectedCount = 0;
    
    for (const m of mods) {
      let modId = m.modId;
      const workshopIdStr = String(m.workshopId);
      
      // If modId looks like a workshop ID (all numeric), try to auto-detect the real mod ID
      if (modId && /^\d{1,15}$/.test(modId)) {
        // First try local files
        if (serverPath) {
          const detectedId = findModIdFromWorkshop(modId, serverPath);
          if (detectedId) {
            modId = detectedId;
            autoDetectedCount++;
            log.info(`Auto-detected mod ID from local files: ${detectedId} for workshop ${m.workshopId}`);
          }
        }
        // If still numeric, try fetching from Steam Workshop page
        if (/^\d{1,15}$/.test(modId)) {
          const steamModId = await fetchModIdFromWorkshop(workshopIdStr);
          if (steamModId) {
            modId = steamModId;
            autoDetectedCount++;
            log.info(`Auto-detected mod ID from Steam Workshop: ${steamModId} for workshop ${m.workshopId}`);
          }
        }
      }
      // Also try if no modId at all
      else if (!modId) {
        // First try local files
        if (serverPath) {
          const detectedId = findModIdFromWorkshop(workshopIdStr, serverPath);
          if (detectedId) {
            modId = detectedId;
            autoDetectedCount++;
            log.info(`Auto-detected mod ID from local files: ${detectedId} for workshop ${m.workshopId}`);
          }
        }
        // If still no modId, try fetching from Steam Workshop page
        if (!modId) {
          const steamModId = await fetchModIdFromWorkshop(workshopIdStr);
          if (steamModId) {
            modId = steamModId;
            autoDetectedCount++;
            log.info(`Auto-detected mod ID from Steam Workshop: ${steamModId} for workshop ${m.workshopId}`);
          }
        }
      }
      
      resolvedMods.push({
        workshopId: m.workshopId,
        modId: modId || null
      });
    }
    
    const modIdList = sanitizeIniList(resolvedMods.map(m => m.modId).filter(Boolean));
    const workshopIdList = sanitizeIniList(resolvedMods.map(m => m.workshopId).filter(Boolean));
    
    // Auto-detect map folders from downloaded workshop mods if not provided
    let detectedMapFolders = mapFolders || [];
    if (serverPath && (!mapFolders || mapFolders.length === 0)) {
      for (const m of mods) {
        const workshopIdStr = String(m.workshopId);
        const modMapFolders = findMapFoldersFromWorkshop(workshopIdStr, serverPath);
        for (const folder of modMapFolders) {
          if (!detectedMapFolders.includes(folder)) {
            detectedMapFolders.push(folder);
            log.info(`Auto-detected map folder: ${folder} from workshop ${workshopIdStr}`);
          }
        }
      }
    }
    
    // Build Map= string - mod maps must come BEFORE the main map
    // Format: "ModMap1;ModMap2;Muldraugh, KY"
    let mapList = 'Muldraugh, KY';
    if (detectedMapFolders && detectedMapFolders.length > 0) {
      mapList = `${sanitizeIniList(detectedMapFolders)};Muldraugh, KY`;
    }
    
    // Atomically read-modify-write the ini file inside the lock
    await withIniLock(iniPath, () => {
      let content = readTextFile(iniPath);
      
      // Update or add Mods= (mod IDs like NeatUI_Framework)
      if (content.includes('Mods=')) {
        content = content.replace(/^Mods=.*/m, `Mods=${modIdList}`);
      } else {
        content += `\nMods=${modIdList}`;
      }
      
      // Update or add WorkshopItems= (workshop IDs like 3508537032)
      if (content.includes('WorkshopItems=')) {
        content = content.replace(/^WorkshopItems=.*/m, `WorkshopItems=${workshopIdList}`);
      } else {
        content += `\nWorkshopItems=${workshopIdList}`;
      }
      
      // Update or add Map= (only if we have custom maps)
      if (detectedMapFolders && detectedMapFolders.length > 0) {
        if (content.includes('Map=')) {
          content = content.replace(/^Map=.*/m, `Map=${mapList}`);
        } else {
          content += `\nMap=${mapList}`;
        }
      }
      
      fs.writeFileSync(iniPath, content, 'utf-8');
    });
    
    log.info(`Wrote ${mods.length} mods to ${iniPath} (${autoDetectedCount} mod IDs auto-detected, ${detectedMapFolders.length} map folders)`);
    
    res.json({
      success: true,
      message: `Successfully configured ${mods.length} mods in server config.${autoDetectedCount > 0 ? ` (${autoDetectedCount} mod IDs auto-detected)` : ''}${detectedMapFolders.length > 0 ? ` Map folders: ${detectedMapFolders.join(', ')}` : ''}`,
      iniPath,
      modsConfigured: mods.length,
      autoDetectedModIds: autoDetectedCount,
      modIds: modIdList,
      workshopItems: workshopIdList,
      mapList,
      mapFolders: detectedMapFolders
    });
  } catch (error) {
    log.error(`Failed to write mods to ini: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Get current mod configuration from .ini file
router.get('/current-config', async (req, res) => {
  try {
    const serverConfigPath = await getServerConfigPath();
    const serverName = await getServerName();
    
    if (!serverConfigPath) {
      return res.json({ 
        configured: false,
        error: 'Server config path not set',
        modIds: [],
        workshopIds: [],
        totalMods: 0
      });
    }
    
    // Sanitize serverName to prevent path traversal
    const sanitizedServerName = path.basename(serverName);
    if (!sanitizedServerName || sanitizedServerName !== serverName || serverName.includes('..')) {
      return res.status(400).json({ error: 'Invalid server name' });
    }
    
    const iniPath = path.join(serverConfigPath, `${sanitizedServerName}.ini`);
    
    if (!fs.existsSync(iniPath)) {
      return res.json({ 
        configured: false,
        error: 'Server config file not found',
        modIds: [],
        workshopIds: [],
        totalMods: 0 
      });
    }
    
    const content = readTextFile(iniPath);
    
    // Extract mod-related settings
    const modsMatch = content.match(/^Mods=(.*)$/m);
    const workshopMatch = content.match(/^WorkshopItems=(.*)$/m);
    const mapMatch = content.match(/^Map=(.*)$/m);
    
    const modIds = modsMatch?.[1]?.split(';').filter(Boolean) || [];
    const workshopIds = workshopMatch?.[1]?.split(';').filter(Boolean) || [];
    const maps = mapMatch?.[1]?.split(';').filter(Boolean) || ['Muldraugh, KY'];
    
    // Build workshop → modId mapping from disk
    const serverPath = await getServerPath();
    const modIdSet = new Set(modIds);
    const workshopModMap = {}; // workshopId -> [{ id, name, enabled, require }]
    if (serverPath) {
      for (const wsId of workshopIds) {
        const details = getModDetailsFromWorkshop(wsId, serverPath);
        workshopModMap[wsId] = details.map(m => ({
          id: m.id,
          name: m.name || m.id,
          enabled: modIdSet.has(m.id),
          require: m.require?.length ? m.require : undefined
        }));
      }
    }

    res.json({
      configured: true,
      modIds,
      workshopIds,
      maps,
      totalMods: modIds.length,
      iniPath,
      workshopModMap
    });
  } catch (error) {
    log.error(`Failed to get current mod config: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Toggle a single mod ID on/off in the Mods= line
router.post('/toggle-mod-id', async (req, res) => {
  try {
    const { modId, enabled } = req.body;
    
    if (!modId || typeof modId !== 'string') {
      return res.status(400).json({ error: 'modId is required' });
    }
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled (boolean) is required' });
    }
    // Validate modId format — allow any printable characters except INI delimiters
    if (/[\r\n;=]/.test(modId) || modId.length > 200) {
      return res.status(400).json({ error: 'Invalid mod ID format' });
    }
    
    const serverConfigPath = await getServerConfigPath();
    const serverName = await getServerName();
    
    if (!serverConfigPath) {
      return res.status(400).json({ error: 'Server config path not set' });
    }
    
    const sanitizedServerName = path.basename(serverName);
    if (!sanitizedServerName || sanitizedServerName !== serverName || serverName.includes('..')) {
      return res.status(400).json({ error: 'Invalid server name' });
    }
    
    const iniPath = path.join(serverConfigPath, `${sanitizedServerName}.ini`);
    if (!fs.existsSync(iniPath)) {
      return res.status(400).json({ error: 'Server config file not found' });
    }
    
    const result = await withIniLock(iniPath, () => {
      let content = readTextFile(iniPath);
      const modsMatch = content.match(/^Mods=(.*)$/m);
      let currentModIds = modsMatch?.[1]?.split(';').filter(Boolean) || [];
      
      if (enabled) {
        if (!currentModIds.includes(modId)) {
          currentModIds.push(modId);
        }
      } else {
        currentModIds = currentModIds.filter(id => id !== modId);
      }
      
      const newModList = sanitizeIniList(currentModIds);
      if (content.includes('Mods=')) {
        content = content.replace(/^Mods=.*/m, `Mods=${newModList}`);
      } else {
        content += `\nMods=${newModList}`;
      }
      
      fs.writeFileSync(iniPath, content, 'utf-8');
      return { totalMods: currentModIds.length };
    });
    log.info(`Toggled mod ID "${modId}" ${enabled ? 'ON' : 'OFF'} in ${iniPath}`);
    
    res.json({
      success: true,
      modId,
      enabled,
      totalMods: result.totalMods
    });
  } catch (error) {
    log.error(`Failed to toggle mod ID: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Batch toggle multiple mod IDs on/off in a single INI write
router.post('/batch-toggle-mod-ids', async (req, res) => {
  try {
    const { changes } = req.body;
    
    if (!Array.isArray(changes) || changes.length === 0) {
      return res.status(400).json({ error: 'changes array is required' });
    }
    if (changes.length > 500) {
      return res.status(400).json({ error: 'Too many changes (max 500)' });
    }
    
    // Validate all entries
    for (const change of changes) {
      if (!change.modId || typeof change.modId !== 'string') {
        return res.status(400).json({ error: 'Each change must have a modId string' });
      }
      if (typeof change.enabled !== 'boolean') {
        return res.status(400).json({ error: 'Each change must have an enabled boolean' });
      }
      if (/[\r\n;=]/.test(change.modId) || change.modId.length > 200) {
        return res.status(400).json({ error: `Invalid mod ID format: ${change.modId.substring(0, 50)}` });
      }
    }
    
    const serverConfigPath = await getServerConfigPath();
    const serverName = await getServerName();
    
    if (!serverConfigPath) {
      return res.status(400).json({ error: 'Server config path not set' });
    }
    
    const sanitizedServerName = path.basename(serverName);
    if (!sanitizedServerName || sanitizedServerName !== serverName || serverName.includes('..')) {
      return res.status(400).json({ error: 'Invalid server name' });
    }
    
    const iniPath = path.join(serverConfigPath, `${sanitizedServerName}.ini`);
    if (!fs.existsSync(iniPath)) {
      return res.status(400).json({ error: 'Server config file not found' });
    }

    const result = await withIniLock(iniPath, () => {
      let content = readTextFile(iniPath);
      const modsMatch = content.match(/^Mods=(.*)$/m);
      let currentModIds = modsMatch?.[1]?.split(';').filter(Boolean) || [];
      
      // Apply all changes
      for (const { modId, enabled } of changes) {
        if (enabled) {
          if (!currentModIds.includes(modId)) {
            currentModIds.push(modId);
          }
        } else {
          currentModIds = currentModIds.filter(id => id !== modId);
        }
      }
      
      const newModList = sanitizeIniList(currentModIds);
      if (content.includes('Mods=')) {
        content = content.replace(/^Mods=.*/m, `Mods=${newModList}`);
      } else {
        content += `\nMods=${newModList}`;
      }
      
      fs.writeFileSync(iniPath, content, 'utf-8');
      return { totalMods: currentModIds.length };
    });
    log.info(`Batch toggled ${changes.length} mod IDs in ${iniPath}`);
    
    res.json({
      success: true,
      changesApplied: changes.length,
      totalMods: result.totalMods,
    });
  } catch (error) {
    log.error(`Failed to batch toggle mod IDs: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Add a single mod to server .ini file (appends to existing mods)
router.post('/add-to-ini', async (req, res) => {
  try {
    const { workshopId, modId } = req.body;
    // workshopId: the Steam Workshop ID
    // modId: optional - the mod loading ID (from info.txt). If not provided, workshopId is used as a placeholder
    
    if (!workshopId) {
      return res.status(400).json({ error: 'Workshop ID is required' });
    }
    
    // Validate workshopId is numeric
    if (!/^\d{1,15}$/.test(String(workshopId))) {
      return res.status(400).json({ error: 'Invalid Workshop ID' });
    }
    
    const serverConfigPath = await getServerConfigPath();
    const serverName = await getServerName();
    
    if (!serverConfigPath) {
      return res.status(400).json({ error: 'Server config path not set. Please configure the server first in Settings.' });
    }
    
    // Sanitize serverName to prevent path traversal
    const sanitizedServerName = path.basename(serverName);
    if (!sanitizedServerName || sanitizedServerName !== serverName || serverName.includes('..')) {
      return res.status(400).json({ error: 'Invalid server name' });
    }
    
    const iniPath = path.join(serverConfigPath, `${sanitizedServerName}.ini`);
    
    if (!fs.existsSync(iniPath)) {
      return res.status(400).json({ 
        error: 'Server config file not found. Start the server once first to generate the config file.' 
      });
    }
    
    // Do all async detection work BEFORE taking the lock
    let detectedModId = modId;
    let detectionSource = 'provided';
    const serverPath = await getServerPath();
    
    if (!detectedModId) {
      // First, try to find from already downloaded workshop folder
      if (serverPath) {
        detectedModId = findModIdFromWorkshop(String(workshopId), serverPath);
        if (detectedModId) {
          detectionSource = 'local-files';
          log.info(`Auto-detected mod ID from local files: ${detectedModId} for workshop ${workshopId}`);
        }
      }
      
      // If not found locally, try to fetch from Steam Workshop page description
      if (!detectedModId) {
        detectedModId = await fetchModIdFromWorkshop(String(workshopId));
        if (detectedModId) {
          detectionSource = 'steam-workshop';
          log.info(`Auto-detected mod ID from Steam Workshop: ${detectedModId} for workshop ${workshopId}`);
        }
      }
    }
    
    // Detect map folders (async-safe, doesn't touch INI)
    let addedMapFolders = [];
    let modMapFolders = [];
    if (serverPath) {
      modMapFolders = findMapFoldersFromWorkshop(String(workshopId), serverPath);
    }
    
    // Atomically read-modify-write inside the lock
    const result = await withIniLock(iniPath, () => {
      let content = readTextFile(iniPath);
      
      const workshopMatch = content.match(/^WorkshopItems=(.*)$/m);
      const currentWorkshopIds = workshopMatch?.[1]?.split(';').filter(Boolean) || [];
      const modsMatch = content.match(/^Mods=(.*)$/m);
      const currentModIds = modsMatch?.[1]?.split(';').filter(Boolean) || [];
      
      // Check if mod is already in the list
      if (currentWorkshopIds.includes(String(workshopId))) {
        return { alreadyExists: true };
      }
      
      // Add the new workshop ID
      currentWorkshopIds.push(String(workshopId));
      const newWorkshopList = sanitizeIniList(currentWorkshopIds);
      
      // Add the mod ID if we have one (provided or detected)
      if (detectedModId && !currentModIds.includes(detectedModId)) {
        currentModIds.push(detectedModId);
      }
      const newModList = sanitizeIniList(currentModIds);
      
      // Update WorkshopItems=
      if (content.includes('WorkshopItems=')) {
        content = content.replace(/^WorkshopItems=.*/m, `WorkshopItems=${newWorkshopList}`);
      } else {
        content += `\nWorkshopItems=${newWorkshopList}`;
      }
      
      // Update Mods= if we have a modId
      if (detectedModId) {
        if (content.includes('Mods=')) {
          content = content.replace(/^Mods=.*/m, `Mods=${newModList}`);
        } else {
          content += `\nMods=${newModList}`;
        }
      }
      
      // Add map folders if detected
      if (modMapFolders.length > 0) {
        const mapMatch = content.match(/^Map=(.*)$/m);
        let currentMaps = mapMatch?.[1]?.split(';').filter(Boolean) || ['Muldraugh, KY'];
        
        for (const folder of modMapFolders) {
          if (!currentMaps.includes(folder)) {
            currentMaps.unshift(folder);
            addedMapFolders.push(folder);
            log.info(`Added map folder: ${folder} for workshop ${workshopId}`);
          }
        }
        
        const newMapList = currentMaps.join(';');
        if (content.includes('Map=')) {
          content = content.replace(/^Map=.*/m, `Map=${newMapList}`);
        } else {
          content += `\nMap=${newMapList}`;
        }
      }
      
      fs.writeFileSync(iniPath, content, 'utf-8');
      return { alreadyExists: false, totalWorkshopItems: currentWorkshopIds.length };
    });
    
    if (result.alreadyExists) {
      return res.json({
        success: true,
        message: 'Mod is already configured in the server',
        alreadyExists: true
      });
    }
    
    log.info(`Added mod ${workshopId} to ${iniPath}${addedMapFolders.length > 0 ? ` with map folders: ${addedMapFolders.join(', ')}` : ''}`);
    
    res.json({
      success: true,
      message: detectedModId 
        ? `Mod added to server configuration${addedMapFolders.length > 0 ? ` with map folders: ${addedMapFolders.join(', ')}` : ''}` 
        : 'Workshop ID added (mod will be downloaded on server start)',
      workshopId,
      modId: detectedModId || null,
      autoDetected: !modId && !!detectedModId,
      detectionSource: detectedModId ? detectionSource : null,
      totalWorkshopItems: result.totalWorkshopItems,
      mapFoldersAdded: addedMapFolders,
      note: detectedModId ? undefined : 'Mod ID could not be auto-detected. You may need to add it manually or use "Sync Mod IDs" after the mod is downloaded.'
    });
  } catch (error) {
    log.error(`Failed to add mod to ini: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Helper function to fetch mod ID from Steam Workshop page description
async function fetchModIdFromWorkshop(workshopId) {
  try {
    // First, get the mod description from Steam API
    const fetchAbort = new AbortController();
    const fetchTimer = setTimeout(() => fetchAbort.abort(), 15000);
    let response;
    try {
      response = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          'itemcount': '1',
          'publishedfileids[0]': workshopId
        }),
        signal: fetchAbort.signal
      });
    } finally { clearTimeout(fetchTimer); }
    
    if (!response.ok) {
      log.warn(`Steam API returned ${response.status} for workshop ${workshopId}`);
      return null;
    }
    
    const data = await response.json();
    const modInfo = data.response?.publishedfiledetails?.[0];
    
    if (!modInfo || modInfo.result !== 1) {
      log.warn(`Mod not found for workshop ${workshopId}`);
      return null;
    }
    
    const description = modInfo.description || '';
    const title = modInfo.title || '';
    
    // Try various patterns to find the mod ID in the description
    // Pattern 1: "Mod ID: SomeName" or "ModID: SomeName"
    let match = description.match(/Mod\s*ID\s*[:=]\s*([^\s\n\r\[\]<>]+)/i);
    if (match) {
      log.info(`Found Mod ID from "Mod ID:" pattern: ${match[1]}`);
      return match[1].trim();
    }
    
    // Pattern 2: "id=SomeName" (common in description)
    match = description.match(/\bid\s*=\s*([^\s\n\r\[\]<>]+)/i);
    if (match) {
      log.info(`Found Mod ID from "id=" pattern: ${match[1]}`);
      return match[1].trim();
    }
    
    // Pattern 3: Workshop ID matches a pattern like "Mod: ModName"
    match = description.match(/\bMod\s*:\s*([A-Za-z0-9_-]+)/i);
    if (match && match[1].length > 3) {
      log.info(`Found Mod ID from "Mod:" pattern: ${match[1]}`);
      return match[1].trim();
    }
    
    // Pattern 4: Look for [code] blocks that might contain mod.info content
    // Use [\s\S] to match newlines
    match = description.match(/\[code\][\s\S]*?id\s*=\s*([^\s\n\r\[\]]+)[\s\S]*?\[\/code\]/i);
    if (match) {
      log.info(`Found Mod ID from [code] block: ${match[1]}`);
      return match[1].trim();
    }

    // Pattern 5: "Ids: ModId" (plural)
    match = description.match(/IDs\s*[:=]\s*([^\s\n\r\[\]<>]+)/i);
    if (match) {
       log.info(`Found Mod ID from "IDs:" pattern: ${match[1]}`);
       return match[1].trim();
    }

    // Pattern 6: If specific workshop ID is mentioned near "Mod ID"
    // Sometimes description has multiple mods, but we want the one for THIS item? 
    // Usually one workshop item = one mod, but obscure cases exist.

    // Pattern 7: Fallback - Title as Mod ID if looks like ID
    // Only use if the title is already a clean ID-like string (no spaces, special chars)
    const potentialId = title.replace(/[^a-zA-Z0-9_-]/g, '');
    if (potentialId === title && potentialId.length > 3 && potentialId.length < 30) {
        log.info(`Using title as Mod ID (exact match): ${potentialId}`);
        return potentialId;
    }
    
    log.warn(`Could not extract Mod ID from workshop ${workshopId} description. Title: "${title}"`);
    return null;
  } catch (error) {
    log.error(`Error fetching mod ID from workshop ${workshopId}: ${error.message}`);
    return null;
  }
}

// Helper to get workshop paths for a mod
function getWorkshopPaths(workshopId, serverPath) {
  const home = os.homedir();
  const paths = [
    // Server's steamapps folder
    path.join(serverPath, 'steamapps', 'workshop', 'content', '108600', workshopId),
    // Alternative location
    path.join(serverPath, '..', 'steamapps', 'workshop', 'content', '108600', workshopId),
    // User's Steam folder — platform-specific
    path.join(home, 'Steam', 'steamapps', 'workshop', 'content', '108600', workshopId),
  ];
  // Add Linux-specific Steam paths
  if (process.platform !== 'win32') {
    paths.push(
      path.join(home, '.local', 'share', 'Steam', 'steamapps', 'workshop', 'content', '108600', workshopId),
      path.join(home, '.steam', 'steam', 'steamapps', 'workshop', 'content', '108600', workshopId)
    );
  }
  return paths;
}

// Helper to check if a map folder contains actual map tile data (not just overlays/spawns)
// Valid map folders have .lotheader, objects.lua, or .lotpack/.bin cell data
function isValidMapFolder(mapFolderPath) {
  try {
    const files = fs.readdirSync(mapFolderPath);
    for (const file of files) {
      const lower = file.toLowerCase();
      if (lower.endsWith('.lotheader') || lower === 'objects.lua' || lower.endsWith('.lotpack')) {
        return true;
      }
      // Cell data files like chunkdata_*_*_*.bin or world_*_*.lotpack
      if (lower.startsWith('world_') || lower.startsWith('chunkdata_')) {
        return true;
      }
    }
    return false;
  } catch (e) {
    log.debug(`Error validating map folder ${mapFolderPath}: ${e.message}`);
    return false;
  }
}

// Helper function to find map folders from a workshop mod
// Map mods have a media/maps folder with their map folder inside
// Only returns folders that contain actual map tile data
function findMapFoldersFromWorkshop(workshopId, serverPath) {
  const mapFolders = [];
  const possiblePaths = getWorkshopPaths(workshopId, serverPath);
  
  // Helper: scan a media/maps directory for valid map subfolders
  function scanMapsDir(mapsPath) {
    if (!fs.existsSync(mapsPath)) return;
    const mapEntries = fs.readdirSync(mapsPath, { withFileTypes: true });
    for (const mapEntry of mapEntries) {
      if (mapEntry.isDirectory() && !mapFolders.includes(mapEntry.name) && isValidMapFolder(path.join(mapsPath, mapEntry.name))) {
        mapFolders.push(mapEntry.name);
        log.debug(`Found valid map folder: ${mapEntry.name} in workshop ${workshopId}`);
      }
    }
  }
  
  for (const workshopPath of possiblePaths) {
    if (!fs.existsSync(workshopPath)) continue;
    
    // Look for mods subfolder first (some mods have mods/ModName/media/maps structure)
    const modsFolder = path.join(workshopPath, 'mods');
    const searchPath = fs.existsSync(modsFolder) ? modsFolder : workshopPath;
    
    try {
      if (fs.existsSync(searchPath)) {
        const entries = fs.readdirSync(searchPath, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const entryPath = path.join(searchPath, entry.name);
          
          // Check standard path: <entry>/media/maps/
          scanMapsDir(path.join(entryPath, 'media', 'maps'));
          
          // B42 mods may have versioned subfolders: <entry>/42/media/maps/ or <entry>/common/media/maps/
          const subEntries = fs.readdirSync(entryPath, { withFileTypes: true });
          for (const sub of subEntries) {
            if (sub.isDirectory() && /^(42(\.\d+)?|41|common)$/i.test(sub.name)) {
              scanMapsDir(path.join(entryPath, sub.name, 'media', 'maps'));
            }
          }
        }
      }
      
      // Also check direct media/maps path (some mods don't have mods subfolder)
      scanMapsDir(path.join(workshopPath, 'media', 'maps'));
      
      if (mapFolders.length > 0) return mapFolders;
    } catch (e) {
      // Continue to next path
    }
  }
  
  return mapFolders;
}

// Helper function to find ALL mod IDs from workshop folder (returns array)
function findAllModIdsFromWorkshop(workshopId, serverPath) {
  const mods = getModDetailsFromWorkshop(workshopId, serverPath);
  return mods.map(m => m.id);
}

// Helper function to find mod ID from workshop folder
function findModIdFromWorkshop(workshopId, serverPath) {
  // Use shared helper to parse details
  const mods = getModDetailsFromWorkshop(workshopId, serverPath);
  // Return the first ID found (legacy behavior)
  return mods.length > 0 ? mods[0].id : null;
}

// Remove a single mod from server .ini file

// Helper to getting full details of mods inside a workshop item
function getModDetailsFromWorkshop(workshopId, serverPath) {
  const mods = [];
  const possiblePaths = getWorkshopPaths(workshopId, serverPath);
  
  for (const workshopPath of possiblePaths) {
    if (!fs.existsSync(workshopPath)) continue;
    
    const modsFolder = path.join(workshopPath, 'mods');
    const searchPath = fs.existsSync(modsFolder) ? modsFolder : workshopPath;
    
    try {
      const entries = fs.readdirSync(searchPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        const modDir = path.join(searchPath, entry.name);
        // B42 mods may have versioned subdirectories: mod.info can be at
        // {mod}/mod.info, {mod}/common/mod.info, {mod}/42/mod.info, or {mod}/42.0/mod.info
        const candidatePaths = [
          path.join(modDir, 'mod.info'),
          path.join(modDir, 'common', 'mod.info'),
        ];
        // Discover B42 versioned subdirectories dynamically (42, 42.0, 42.1, 42.13, etc.)
        try {
          for (const sub of fs.readdirSync(modDir, { withFileTypes: true })) {
            if (sub.isDirectory() && /^42(\.\d+)?$/.test(sub.name)) {
              candidatePaths.push(path.join(modDir, sub.name, 'mod.info'));
            }
          }
        } catch (e) {
          log.debug(`Failed to scan B42 versioned subdirs for ${modDir}: ${e.message}`);
        }

        
        const modInfoPath = candidatePaths.find(p => fs.existsSync(p));
        if (modInfoPath) {
          const content = readTextFile(modInfoPath);
          const info = {};
          
          // Parse mod.info
          content.split(/\r?\n/).forEach(line => {
            if (!line || line.startsWith('//')) return;
            const idx = line.indexOf('=');
            if (idx !== -1) {
              const key = line.substring(0, idx).trim();
              const val = line.substring(idx + 1).trim();
              info[key] = val;
            }
          });
          
          if (info.id) {
            mods.push({
              id: info.id,
              name: info.name || info.id,
              poster: info.poster,
              icon: info.icon,
              description: info.description || '',
              url: info.url,
              require: info.require ? info.require.split(/[,;]/).map(s => s.trim().replace(/^\\+/, '')).filter(Boolean) : []
            });
          }
        }
      }
      
      // If we found mods in this path, stop searching other paths
      if (mods.length > 0) return mods;
    } catch (e) {
      log.debug(`Error scanning path ${searchPath}: ${e.message}`);
    }
  }
  
  return mods;
}

// Return available Mod IDs inside a downloaded Workshop Item
router.post('/inspect-workshop-item', async (req, res) => {
  try {
    const { workshopId } = req.body;
    if (!workshopId) {
      return res.status(400).json({ error: 'Workshop ID is required' });
    }

    // Validate workshopId is numeric to prevent path traversal
    if (!/^\d{1,15}$/.test(String(workshopId))) {
      return res.status(400).json({ error: 'Invalid Workshop ID' });
    }

    const serverPath = await getServerPath();
    if (!serverPath) {
       return res.status(400).json({ error: 'Server path not configured' });
    }

    const mods = getModDetailsFromWorkshop(workshopId, serverPath);
    
    // Also try to find map folders
    const mapFolders = findMapFoldersFromWorkshop(workshopId, serverPath);

    res.json({
      workshopId,
      found: mods.length > 0 || mapFolders.length > 0,
      mods,
      mapFolders,
      count: mods.length
    });
  } catch (error) {
    log.error(`Failed to inspect workshop item: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Remove a single mod from server .ini file
router.post('/remove-from-ini', async (req, res) => {
  try {
    const { workshopId, modId, modIds: clientModIds } = req.body;
    
    if (!workshopId) {
      return res.status(400).json({ error: 'Workshop ID is required' });
    }

    // Validate workshopId is numeric to prevent path traversal
    if (!/^\d{1,15}$/.test(String(workshopId))) {
      return res.status(400).json({ error: 'Invalid Workshop ID' });
    }

    // Validate optional modIds array from client
    const knownModIds = Array.isArray(clientModIds)
      ? clientModIds.filter(id => typeof id === 'string' && id.length > 0 && id.length < 200).slice(0, 50)
      : [];
    
    const serverConfigPath = await getServerConfigPath();
    const serverPath = await getServerPath();
    const serverName = await getServerName();
    
    if (!serverConfigPath) {
      return res.status(400).json({ error: 'Server config path not set' });
    }
    
    // Sanitize serverName
    const sanitizedServerName = path.basename(serverName);
    if (!sanitizedServerName || sanitizedServerName !== serverName || serverName.includes('..')) {
      return res.status(400).json({ error: 'Invalid server name' });
    }
    
    const iniPath = path.join(serverConfigPath, `${sanitizedServerName}.ini`);
    
    if (!fs.existsSync(iniPath)) {
      return res.status(400).json({ error: 'Server config file not found' });
    }
    
    // Atomically read-modify-write inside the lock
    const lockResult = await withIniLock(iniPath, () => {
      let content = readTextFile(iniPath);
    
      // Get current workshop items
      const workshopMatch = content.match(/^WorkshopItems=(.*)$/m);
      let workshopIds = workshopMatch?.[1]?.split(';').filter(Boolean) || [];
    
      // Get current mod IDs
      const modsMatch = content.match(/^Mods=(.*)$/m);
      let modIds = modsMatch?.[1]?.split(';').filter(Boolean) || [];
    
      // Remove from workshop items
      workshopIds = workshopIds.filter(id => id !== String(workshopId));
    
      // Determine which mod IDs to remove (a workshop item can have multiple mods)
      let removedModIds = [];
    
      if (serverPath) {
        // Find ALL mod IDs for this workshop item
        const allModIds = findAllModIdsFromWorkshop(String(workshopId), serverPath);
        if (allModIds.length > 0) {
          for (const mid of allModIds) {
            if (modIds.includes(mid)) {
              modIds = modIds.filter(id => id !== mid);
              removedModIds.push(mid);
            }
          }
          log.info(`Found mod IDs for workshop ${workshopId}: ${allModIds.join(', ')}`);
        }
      }
    
      // Also remove explicitly provided modId if not already removed
      if (modId && !removedModIds.includes(modId) && modIds.includes(modId)) {
        modIds = modIds.filter(id => id !== modId);
        removedModIds.push(modId);
      }
    
      // Fallback: if no mods removed via filesystem, try single lookup
      if (removedModIds.length === 0 && !modId && serverPath) {
        const fallbackModId = findModIdFromWorkshop(String(workshopId), serverPath);
        if (fallbackModId && modIds.includes(fallbackModId)) {
          modIds = modIds.filter(id => id !== fallbackModId);
          removedModIds.push(fallbackModId);
        }
      }
    
      // Last resort: when filesystem lookup couldn't find mod IDs, use the
      // mod IDs the client already knows about (from the UI's config data)
      // to prevent WorkshopItems/Mods desync.
      if (removedModIds.length === 0 && knownModIds.length > 0) {
        for (const mid of knownModIds) {
          if (modIds.includes(mid) && !removedModIds.includes(mid)) {
            modIds = modIds.filter(id => id !== mid);
            removedModIds.push(mid);
          }
        }
        if (removedModIds.length > 0) {
          log.info(`Fallback: removed ${removedModIds.join(', ')} for workshop ${workshopId} via client-provided mod IDs`);
        }
      }
    
      // Check if this mod has map folders and remove them from Map=
      let removedMapFolders = [];
      if (serverPath) {
        const modMapFolders = findMapFoldersFromWorkshop(String(workshopId), serverPath);
        if (modMapFolders.length > 0) {
          const mapMatch = content.match(/^Map=(.*)$/m);
          let currentMaps = mapMatch?.[1]?.split(';').filter(Boolean) || [];
        
          for (const folder of modMapFolders) {
            if (currentMaps.includes(folder)) {
              currentMaps = currentMaps.filter(m => m !== folder);
              removedMapFolders.push(folder);
              log.info(`Removed map folder: ${folder} for workshop ${workshopId}`);
            }
          }
        
          if (currentMaps.length === 0) {
            currentMaps = ['Muldraugh, KY'];
          }
        
          const newMapList = currentMaps.join(';');
          if (content.includes('Map=')) {
            content = content.replace(/^Map=.*/m, `Map=${newMapList}`);
          } else {
            content += `\nMap=${newMapList}`;
          }
        }
      }
    
      // Update WorkshopItems=
      if (content.includes('WorkshopItems=')) {
        content = content.replace(/^WorkshopItems=.*/m, `WorkshopItems=${sanitizeIniList(workshopIds)}`);
      }
    
      // Update Mods=
      if (content.includes('Mods=')) {
        content = content.replace(/^Mods=.*/m, `Mods=${sanitizeIniList(modIds)}`);
      }
    
      fs.writeFileSync(iniPath, content, 'utf-8');
      return { removedModIds, removedMapFolders, remainingWorkshopItems: workshopIds.length, remainingMods: modIds.length };
    });
    
    log.info(`Removed workshop ID ${workshopId}${lockResult.removedModIds.length > 0 ? ` and mod IDs ${lockResult.removedModIds.join(', ')}` : ''}${lockResult.removedMapFolders.length > 0 ? ` and map folders: ${lockResult.removedMapFolders.join(', ')}` : ''} from ${iniPath}`);
    
    res.json({
      success: true,
      message: lockResult.removedModIds.length > 0
        ? `Mod removed from server configuration (WorkshopItems, Mods${lockResult.removedMapFolders.length > 0 ? ', and Map' : ''})` 
        : 'Workshop ID removed. Note: Could not find matching mod ID - you may need to manually remove it from Mods= in the .ini file.',
      workshopId,
      modIdsRemoved: lockResult.removedModIds,
      mapFoldersRemoved: lockResult.removedMapFolders,
      remainingWorkshopItems: lockResult.remainingWorkshopItems,
      remainingMods: lockResult.remainingMods
    });
  } catch (error) {
    log.error(`Failed to remove mod from ini: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Batch remove multiple mods from tracking AND server .ini in a single operation
// Avoids the N×2 individual API call problem for bulk removal
router.post('/batch-remove', async (req, res) => {
  try {
    const { workshopIds } = req.body;

    if (!Array.isArray(workshopIds) || workshopIds.length === 0) {
      return res.status(400).json({ error: 'workshopIds array is required' });
    }

    // Cap batch size to prevent abuse
    if (workshopIds.length > 500) {
      return res.status(400).json({ error: 'Maximum 500 mods per batch' });
    }

    // Validate all IDs upfront
    const validIds = [];
    for (const id of workshopIds) {
      const str = String(id);
      if (/^\d{1,15}$/.test(str)) validIds.push(str);
    }

    if (validIds.length === 0) {
      return res.status(400).json({ error: 'No valid workshop IDs provided' });
    }

    // Step 1: Get mod names before removal (for ignore list)
    const trackedMods = await getTrackedMods();
    const modNameMap = new Map();
    for (const mod of trackedMods) {
      modNameMap.set(mod.workshop_id, mod.name);
    }

    // Step 2: Remove all from database and add to ignore list
    const dbResults = { removed: 0, failed: 0 };
    for (const wsId of validIds) {
      try {
        await removeTrackedMod(wsId);
        await addIgnoredMod(wsId, modNameMap.get(wsId) || null);
        dbResults.removed++;
      } catch (e) {
        dbResults.failed++;
        log.debug(`DB removal failed for ${wsId}: ${e.message}`);
      }
    }

    // Step 2: Remove all from INI in a single locked write
    const serverConfigPath = await getServerConfigPath();
    const serverPath = await getServerPath();
    const serverName = await getServerName();

    let iniResult = { removed: 0, skipped: 0 };

    if (serverConfigPath && serverName) {
      const sanitizedServerName = path.basename(serverName);
      if (sanitizedServerName && sanitizedServerName === serverName && !serverName.includes('..')) {
        const iniPath = path.join(serverConfigPath, `${sanitizedServerName}.ini`);

        if (fs.existsSync(iniPath)) {
          iniResult = await withIniLock(iniPath, () => {
            let content = readTextFile(iniPath);
            const removeSet = new Set(validIds);

            // Parse current lists
            const workshopMatch = content.match(/^WorkshopItems=(.*)$/m);
            let iniWorkshopIds = workshopMatch?.[1]?.split(';').filter(Boolean) || [];

            const modsMatch = content.match(/^Mods=(.*)$/m);
            let iniModIds = modsMatch?.[1]?.split(';').filter(Boolean) || [];

            const mapMatch = content.match(/^Map=(.*)$/m);
            let iniMaps = mapMatch?.[1]?.split(';').filter(Boolean) || [];

            // Collect all mod IDs and map folders to remove
            const modIdsToRemove = new Set();
            const mapFoldersToRemove = new Set();

            for (const wsId of validIds) {
              if (serverPath) {
                const allModIds = findAllModIdsFromWorkshop(wsId, serverPath);
                for (const mid of allModIds) modIdsToRemove.add(mid);

                const mapFolders = findMapFoldersFromWorkshop(wsId, serverPath);
                for (const folder of mapFolders) mapFoldersToRemove.add(folder);
              }
            }

            // Filter lists
            const origWsCount = iniWorkshopIds.length;
            const origModCount = iniModIds.length;
            iniWorkshopIds = iniWorkshopIds.filter(id => !removeSet.has(id));
            iniModIds = iniModIds.filter(id => !modIdsToRemove.has(id));
            iniMaps = iniMaps.filter(m => !mapFoldersToRemove.has(m));

            if (iniMaps.length === 0) iniMaps = ['Muldraugh, KY'];

            // Write back
            if (content.includes('WorkshopItems=')) {
              content = content.replace(/^WorkshopItems=.*/m, `WorkshopItems=${sanitizeIniList(iniWorkshopIds)}`);
            }
            if (content.includes('Mods=')) {
              content = content.replace(/^Mods=.*/m, `Mods=${sanitizeIniList(iniModIds)}`);
            }
            if (content.includes('Map=')) {
              content = content.replace(/^Map=.*/m, `Map=${sanitizeIniList(iniMaps)}`);
            }

            fs.writeFileSync(iniPath, content, 'utf-8');

            const wsRemoved = origWsCount - iniWorkshopIds.length;
            const modRemoved = origModCount - iniModIds.length;
            log.info(`Batch INI removal: removed ${wsRemoved} workshop IDs, ${modRemoved} mod IDs, ${mapFoldersToRemove.size} map folders`);

            return { removed: wsRemoved, skipped: validIds.length - wsRemoved };
          });
        }
      }
    }

    // Best-effort: mirror these removes into the configured Steam Workshop
    // collection if auto-sync is enabled. Sequential with a small delay so
    // a 50-mod purge doesn't fire 50 simultaneous Steam requests.
    if (validIds.length > 0) {
      (async () => {
        for (const wsId of validIds) {
          try { await autoSyncCollection('remove', wsId); } catch { /* logged inside */ }
          await new Promise((r) => setTimeout(r, 250));
        }
      })().catch(() => {});
    }

    res.json({
      success: true,
      total: validIds.length,
      dbRemoved: dbResults.removed,
      dbFailed: dbResults.failed,
      iniRemoved: iniResult.removed,
      iniSkipped: iniResult.skipped,
    });
  } catch (error) {
    log.error(`Batch removal failed: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Repair Map= entries - validates each entry has actual map data on disk and removes invalid ones
router.post('/repair-map-entries', async (req, res) => {
  try {
    const serverConfigPath = await getServerConfigPath();
    const serverPath = await getServerPath();
    const serverName = await getServerName();

    if (!serverConfigPath || !serverPath) {
      return res.status(400).json({ error: 'Server path not configured.' });
    }

    const sanitizedServerName = path.basename(serverName);
    if (!sanitizedServerName || sanitizedServerName !== serverName || serverName.includes('..')) {
      return res.status(400).json({ error: 'Invalid server name' });
    }

    const iniPath = path.join(serverConfigPath, `${sanitizedServerName}.ini`);
    if (!fs.existsSync(iniPath)) {
      return res.status(400).json({ error: 'Server config file not found.' });
    }

    // Atomically read-modify-write inside the lock
    const lockResult = await withIniLock(iniPath, () => {
      let content = readTextFile(iniPath);
      const mapMatch = content.match(/^Map=(.*)$/m);
      const currentMaps = mapMatch?.[1]?.split(';').filter(Boolean) || [];

      const workshopMatch = content.match(/^WorkshopItems=(.*)$/m);
      const workshopIds = workshopMatch?.[1]?.split(';').filter(Boolean) || [];

      const validMapFolders = new Set();
      for (const wsId of workshopIds) {
        const folders = findMapFoldersFromWorkshop(wsId, serverPath);
        for (const f of folders) validMapFolders.add(f);
      }
      validMapFolders.add('Muldraugh, KY');

      const validEntries = [];
      const removedEntries = [];
      for (const entry of currentMaps) {
        if (validMapFolders.has(entry) || entry.includes('Muldraugh') || entry.includes('West Point') || entry.includes('Riverside') || entry.includes('Rosewood') || entry.includes('March Ridge') || entry.includes('Louisville')) {
          validEntries.push(entry);
        } else {
          removedEntries.push(entry);
        }
      }

      const addedEntries = [];
      for (const folder of validMapFolders) {
        if (folder === 'Muldraugh, KY') continue;
        if (!validEntries.includes(folder)) {
          const mulIdx = validEntries.findIndex(e => e.includes('Muldraugh'));
          if (mulIdx >= 0) {
            validEntries.splice(mulIdx, 0, folder);
          } else {
            validEntries.push(folder);
          }
          addedEntries.push(folder);
        }
      }

      if (!validEntries.some(e => e.includes('Muldraugh'))) {
        validEntries.push('Muldraugh, KY');
      }

      if (removedEntries.length > 0 || addedEntries.length > 0) {
        const newMapLine = validEntries.join(';');
        if (content.includes('Map=')) {
          content = content.replace(/^Map=.*/m, `Map=${newMapLine}`);
        }
        fs.writeFileSync(iniPath, content, 'utf-8');
        log.info(`Repaired Map= entries: removed ${removedEntries.length} invalid, added ${addedEntries.length} missing`);
        if (removedEntries.length > 0) log.info(`  Removed: ${removedEntries.join(', ')}`);
        if (addedEntries.length > 0) log.info(`  Added: ${addedEntries.join(', ')}`);
      }

      return { removedEntries, addedEntries, validEntries };
    });

    const parts = [];
    if (lockResult.removedEntries.length > 0) parts.push(`Removed ${lockResult.removedEntries.length} invalid: ${lockResult.removedEntries.join(', ')}`);
    if (lockResult.addedEntries.length > 0) parts.push(`Added ${lockResult.addedEntries.length} missing: ${lockResult.addedEntries.join(', ')}`);

    res.json({
      success: true,
      removed: lockResult.removedEntries,
      added: lockResult.addedEntries,
      remaining: lockResult.validEntries,
      message: parts.length > 0
        ? parts.join('. ')
        : 'All map entries are valid. No changes needed.'
    });
  } catch (error) {
    log.error(`Failed to repair map entries: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Deduplicate mod IDs in the Mods= line — removes exact duplicates, keeps one of each
router.post('/deduplicate-mod-ids', async (req, res) => {
  try {
    const serverConfigPath = await getServerConfigPath();
    const serverName = await getServerName();

    if (!serverConfigPath) {
      return res.status(400).json({ error: 'Server path not configured.' });
    }

    const sanitizedServerName = path.basename(serverName);
    if (!sanitizedServerName || sanitizedServerName !== serverName || serverName.includes('..')) {
      return res.status(400).json({ error: 'Invalid server name' });
    }

    const iniPath = path.join(serverConfigPath, `${sanitizedServerName}.ini`);
    if (!fs.existsSync(iniPath)) {
      return res.status(400).json({ error: 'Server config file not found.' });
    }

    // Atomically read-modify-write inside the lock
    const lockResult = await withIniLock(iniPath, () => {
      let content = readTextFile(iniPath);
      const modsMatch = content.match(/^Mods=(.*)$/m);
      const currentMods = modsMatch?.[1]?.split(';').filter(Boolean) || [];

      const seen = new Map();
      const deduped = [];
      const removed = [];
      for (const modId of currentMods) {
        const count = (seen.get(modId) || 0) + 1;
        seen.set(modId, count);
        if (count === 1) {
          deduped.push(modId);
        } else {
          removed.push(modId);
        }
      }

      if (removed.length === 0) {
        return { noChanges: true, deduped };
      }

      content = content.replace(/^Mods=.*/m, `Mods=${deduped.join(';')}`);
      fs.writeFileSync(iniPath, content, 'utf-8');
      return { noChanges: false, removed, deduped };
    });

    if (lockResult.noChanges) {
      return res.json({
        success: true,
        removed: [],
        remaining: lockResult.deduped.length,
        message: 'No duplicate mod IDs found. No changes needed.'
      });
    }

    const uniqueDupes = [...new Set(lockResult.removed)];
    log.info(`Deduplicated Mods= line: removed ${lockResult.removed.length} duplicate entries (${uniqueDupes.length} unique mod IDs: ${uniqueDupes.join(', ')})`);

    res.json({
      success: true,
      removed: uniqueDupes,
      removedCount: lockResult.removed.length,
      uniqueCount: uniqueDupes.length,
      remaining: lockResult.deduped.length,
      message: `Removed ${lockResult.removed.length} duplicate mod ID${lockResult.removed.length !== 1 ? 's' : ''}: ${uniqueDupes.join(', ')}`
    });
  } catch (error) {
    log.error(`Failed to deduplicate mod IDs: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// ─── Missing Dependencies: Add a resolved dependency to INI ─────────────────
router.post('/add-missing-dep', async (req, res) => {
  try {
    const { workshopId, modId } = req.body;
    if (!workshopId || !/^\d{1,15}$/.test(String(workshopId))) {
      return res.status(400).json({ error: 'Valid Workshop ID is required' });
    }
    // Sanitize modId — only allow safe characters
    const modIdStr = modId ? String(modId) : null;
    if (modIdStr && !/^[\w.\-]{1,200}$/.test(modIdStr)) {
      return res.status(400).json({ error: 'Invalid mod ID format' });
    }

    const serverConfigPath = await getServerConfigPath();
    const serverName = await getServerName();
    const serverPath = await getServerPath();
    if (!serverConfigPath) return res.status(400).json({ error: 'Server path not configured.' });

    const sanitizedServerName = path.basename(serverName);
    if (!sanitizedServerName || sanitizedServerName !== serverName || serverName.includes('..')) {
      return res.status(400).json({ error: 'Invalid server name' });
    }
    const iniPath = path.join(serverConfigPath, `${sanitizedServerName}.ini`);
    if (!fs.existsSync(iniPath)) {
      return res.status(400).json({ error: 'Server config file not found' });
    }

    // Do async detection work BEFORE taking the lock
    const wsIdStr = String(workshopId);
    let resolvedModId = modIdStr;
    if (!resolvedModId && serverPath) {
      resolvedModId = findModIdFromWorkshop(wsIdStr, serverPath);
    }
    if (!resolvedModId) {
      resolvedModId = await fetchModIdFromWorkshop(wsIdStr);
    }

    // Detect map folders (sync disk reads, no INI dependency)
    const mapFolders = serverPath ? findMapFoldersFromWorkshop(wsIdStr, serverPath) : [];

    // Atomically read-modify-write inside the lock
    const lockResult = await withIniLock(iniPath, () => {
      let content = readTextFile(iniPath);

      // Add to WorkshopItems if not present
      const wsMatch = content.match(/^WorkshopItems=(.*)$/m);
      const currentWs = wsMatch?.[1]?.split(';').filter(Boolean) || [];
      let wsAdded = false;
      if (!currentWs.includes(wsIdStr)) {
        currentWs.push(wsIdStr);
        if (content.includes('WorkshopItems=')) {
          content = content.replace(/^WorkshopItems=.*/m, `WorkshopItems=${currentWs.join(';')}`);
        } else {
          content += `\nWorkshopItems=${currentWs.join(';')}`;
        }
        wsAdded = true;
      }

      // Add to Mods if we have a mod ID and it's not present
      let modIdAdded = false;
      if (resolvedModId) {
        const modsMatch = content.match(/^Mods=(.*)$/m);
        const currentMods = modsMatch?.[1]?.split(';').filter(Boolean) || [];
        if (!currentMods.includes(resolvedModId)) {
          currentMods.push(resolvedModId);
          if (content.includes('Mods=')) {
            content = content.replace(/^Mods=.*/m, `Mods=${currentMods.join(';')}`);
          } else {
            content += `\nMods=${currentMods.join(';')}`;
          }
          modIdAdded = true;
        }
      }

      // Auto-detect map folders
      if (mapFolders.length > 0) {
        const mapMatch = content.match(/^Map=(.*)$/m);
        const currentMaps = mapMatch?.[1]?.split(';').filter(Boolean) || [];
        let mapsChanged = false;
        for (const f of mapFolders) {
          if (!currentMaps.includes(f)) { currentMaps.unshift(f); mapsChanged = true; }
        }
        if (mapsChanged) {
          if (content.includes('Map=')) content = content.replace(/^Map=.*/m, `Map=${currentMaps.join(';')}`);
          else content += `\nMap=${currentMaps.join(';')}`;
        }
      }

      fs.writeFileSync(iniPath, content, 'utf-8');
      return { wsAdded, modIdAdded };
    });

    log.info(`Added missing dep: workshop ${wsIdStr}, modId ${resolvedModId || '(unknown)'}`);

    res.json({
      success: true,
      workshopId: wsIdStr,
      modId: resolvedModId,
      wsAdded: lockResult.wsAdded,
      modIdAdded: lockResult.modIdAdded,
      mapFolders,
      message: `Added ${resolvedModId || wsIdStr} to server config.${mapFolders.length > 0 ? ` Map folders: ${mapFolders.join(', ')}` : ''}`
    });
  } catch (error) {
    log.error(`Failed to add missing dep: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// ─── Missing Dependencies: Batch add all resolved deps ──────────────────────
router.post('/add-all-resolved-deps', async (req, res) => {
  try {
    const { deps } = req.body;
    if (!deps || !Array.isArray(deps) || deps.length === 0) {
      return res.status(400).json({ error: 'No dependencies provided' });
    }
    if (deps.length > 200) {
      return res.status(400).json({ error: 'Too many dependencies in one request (max 200)' });
    }

    // Validate all workshop IDs
    for (const dep of deps) {
      if (!dep.workshopId || !/^\d{1,15}$/.test(String(dep.workshopId))) {
        return res.status(400).json({ error: `Invalid Workshop ID: ${String(dep.workshopId).substring(0, 20)}` });
      }
    }

    const serverConfigPath = await getServerConfigPath();
    const serverName = await getServerName();
    const serverPath = await getServerPath();
    if (!serverConfigPath) {
      return res.status(400).json({ error: 'Server config path not set' });
    }
    const sanitizedServerName = path.basename(serverName);
    if (!sanitizedServerName || sanitizedServerName !== serverName || serverName.includes('..')) {
      return res.status(400).json({ error: 'Invalid server name' });
    }
    const iniPath = path.join(serverConfigPath, `${sanitizedServerName}.ini`);
    if (!fs.existsSync(iniPath)) {
      return res.status(400).json({ error: 'Server config file not found' });
    }

    // Pre-resolve all mod IDs BEFORE taking the lock (async ops)
    const resolvedDeps = [];
    for (const dep of deps) {
      const wsId = String(dep.workshopId);
      let modId = dep.modId || null;
      if (!modId && serverPath) modId = findModIdFromWorkshop(wsId, serverPath);
      if (!modId) {
        try { modId = await fetchModIdFromWorkshop(wsId); } catch (e) { log.debug(`fetchModIdFromWorkshop failed for ${wsId}: ${e.message}`); }
      }
      const mapFolders = serverPath ? findMapFoldersFromWorkshop(wsId, serverPath) : [];
      resolvedDeps.push({ wsId, modId, mapFolders });
    }

    // Atomically read-modify-write inside the lock
    const lockResult = await withIniLock(iniPath, () => {
      let content = readTextFile(iniPath);
      const wsMatch = content.match(/^WorkshopItems=(.*)$/m);
      const currentWs = new Set(wsMatch?.[1]?.split(';').filter(Boolean) || []);
      const modsMatch = content.match(/^Mods=(.*)$/m);
      const currentMods = new Set(modsMatch?.[1]?.split(';').filter(Boolean) || []);
      const mapMatch = content.match(/^Map=(.*)$/m);
      const currentMaps = mapMatch?.[1]?.split(';').filter(Boolean) || [];

      let wsAdded = 0, modIdsAdded = 0;
      const allMapFolders = [];

      for (const { wsId, modId, mapFolders } of resolvedDeps) {
        if (!currentWs.has(wsId)) { currentWs.add(wsId); wsAdded++; }
        if (modId && !currentMods.has(modId)) { currentMods.add(modId); modIdsAdded++; }
        for (const f of mapFolders) {
          if (!currentMaps.includes(f)) { currentMaps.unshift(f); allMapFolders.push(f); }
        }
      }

      const wsLine = Array.from(currentWs).join(';');
      const modsLine = Array.from(currentMods).join(';');
      const mapLine = currentMaps.join(';');

      if (content.includes('WorkshopItems=')) content = content.replace(/^WorkshopItems=.*/m, `WorkshopItems=${wsLine}`);
      else content += `\nWorkshopItems=${wsLine}`;
      if (content.includes('Mods=')) content = content.replace(/^Mods=.*/m, `Mods=${modsLine}`);
      else content += `\nMods=${modsLine}`;
      if (allMapFolders.length > 0) {
        if (content.includes('Map=')) content = content.replace(/^Map=.*/m, `Map=${mapLine}`);
        else content += `\nMap=${mapLine}`;
      }

      fs.writeFileSync(iniPath, content, 'utf-8');
      return { wsAdded, modIdsAdded, allMapFolders };
    });

    log.info(`Batch added ${deps.length} missing deps: ${lockResult.wsAdded} ws IDs, ${lockResult.modIdsAdded} mod IDs`);

    res.json({
      success: true,
      total: deps.length,
      wsAdded: lockResult.wsAdded,
      modIdsAdded: lockResult.modIdsAdded,
      mapFolders: lockResult.allMapFolders,
      message: `Added ${deps.length} dependencies to server config.`
    });
  } catch (error) {
    log.error(`Failed to batch add deps: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// ─── Missing Dependencies: Search Steam Workshop for a mod by name ──────────
router.post('/search-workshop-mods', async (req, res) => {
  try {
    const { query, parentName, parentWorkshopId, parentModId } = req.body;
    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }

    const trimmed = query.trim();
    if (trimmed.length > 100) {
      log.debug(`Search query truncated from ${trimmed.length} to 100 chars`);
    }
    const searchTerm = trimmed.substring(0, 100);
    const parentNameClean = (typeof parentName === 'string' ? parentName.trim().substring(0, 100) : '');
    const parentWsClean = (typeof parentWorkshopId === 'string' && /^\d{1,15}$/.test(parentWorkshopId)) ? parentWorkshopId : '';
    const parentModClean = (typeof parentModId === 'string' && parentModId.length < 100) ? parentModId : '';
    const serverPath = await getServerPath();

    // ── Build a small list of search variants to try in order. Mod IDs in PZ
    // are typically PascalCase, snake_case, or all-lowercase like "truemusic".
    // Steam's text search treats the whole token as one word, so "truemusic"
    // misses the actual mod titled "True Music". We try the raw form first,
    // then a humanized version, then strip common suffixes (_b41, _b42, _fix,
    // _v2…), and finally fall back to the parent mod's name with the same
    // suffix-stripping. Duplicates and very short variants (<3 chars) get
    // dropped so we never spam Steam with noise.
    const buildSearchVariants = (raw, parent) => {
      const variants = [];
      const seen = new Set();
      const push = (v) => {
        if (!v) return;
        const s = v.trim().toLowerCase();
        if (s.length < 3 || seen.has(s)) return;
        seen.add(s); variants.push(v.trim());
      };
      const stripSuffixes = (s) => s.replace(/[_-]?(b4[12]fix|b4[12]_fix|b4[12]|fix(es)?|patch|patches|update|updates|v\d+(\.\d+)*|rev\d+|reupload|continued|continuation|port|ported|edition)$/gi, '').trim();
      const humanize = (s) => s
        .replace(/([a-z])([A-Z])/g, '$1 $2')          // camelCase → camel Case
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')    // ABCWord  → ABC Word
        .replace(/[_\-]+/g, ' ')                       // snake / kebab → spaces
        .replace(/\s+/g, ' ')
        .trim();
      push(raw);
      const humanized = humanize(raw);
      if (humanized.toLowerCase() !== raw.toLowerCase()) push(humanized);
      const stripped = stripSuffixes(raw);
      if (stripped.toLowerCase() !== raw.toLowerCase()) push(stripped);
      const humanizedStripped = humanize(stripped);
      if (humanizedStripped.toLowerCase() !== humanized.toLowerCase() && humanizedStripped.toLowerCase() !== stripped.toLowerCase()) push(humanizedStripped);
      if (parent) {
        push(parent);
        const parentStripped = stripSuffixes(parent);
        if (parentStripped.toLowerCase() !== parent.toLowerCase()) push(parentStripped);
      }
      return variants;
    };
    const searchVariants = buildSearchVariants(searchTerm, parentNameClean);

    // Phase 1: Search locally downloaded mods — match by mod ID (exact or partial) and mod name
    const localResults = [];
    const seenWorkshopIds = new Set();
    if (serverPath) {
      const workshopPaths = [
        path.join(serverPath, 'steamapps', 'workshop', 'content', '108600'),
        path.join(serverPath, '..', 'steamapps', 'workshop', 'content', '108600'),
      ];
      const searchLower = searchTerm.toLowerCase();
      for (const workshopBase of workshopPaths) {
        if (!fs.existsSync(workshopBase)) continue;
        try {
          for (const entry of fs.readdirSync(workshopBase, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            if (localResults.length >= 20) break;
            // Don't suggest the parent mod itself as a candidate for its own dependency
            if (parentWsClean && entry.name === parentWsClean) continue;
            try {
              const details = getModDetailsFromWorkshop(entry.name, serverPath);
              for (const mod of details) {
                if (parentModClean && mod.id === parentModClean) continue;
                const idMatch = mod.id.toLowerCase() === searchLower; // exact ID match (highest priority)
                const partialMatch = mod.id.toLowerCase().includes(searchLower) || mod.name.toLowerCase().includes(searchLower);
                if (idMatch || partialMatch) {
                  if (!seenWorkshopIds.has(`${entry.name}-${mod.id}`)) {
                    seenWorkshopIds.add(`${entry.name}-${mod.id}`);
                    localResults.push({
                      workshopId: entry.name,
                      modId: mod.id,
                      modName: mod.name,
                      source: 'local',
                      isDownloaded: true,
                      exactMatch: idMatch,
                    });
                  }
                }
              }
            } catch (e) { log.debug(`Error scanning mod entry during search: ${e.message}`); }
          }
        } catch (e) { log.debug(`Error reading workshop dir during search: ${e.message}`); }
        if (localResults.length >= 20) break;
      }
      // Sort: exact matches first, then alphabetical
      localResults.sort((a, b) => {
        if (a.exactMatch && !b.exactMatch) return -1;
        if (!a.exactMatch && b.exactMatch) return 1;
        return a.modName.localeCompare(b.modName);
      });
    }

    // Phase 2: Try Steam API lookup if the query looks like a workshop ID
    const steamResults = [];
    if (/^\d{5,15}$/.test(searchTerm)) {
      // Skip if already found locally
      const alreadyFoundLocally = localResults.some(r => r.workshopId === searchTerm);
      if (!alreadyFoundLocally) {
        try {
          const response = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ 'itemcount': '1', 'publishedfileids[0]': searchTerm }),
          });
          if (response.ok) {
            const data = await response.json();
            const info = data.response?.publishedfiledetails?.[0];
            if (info && info.result === 1) {
              steamResults.push({
                workshopId: info.publishedfileid,
                modName: info.title,
                description: info.description?.substring(0, 200),
                subscriberCount: info.subscriptions || 0,
                source: 'steam',
                isDownloaded: false,
              });
            }
          }
        } catch (e) { log.debug(`Steam collection lookup failed (non-fatal): ${e.message}`); }
      }
    }

    // Phase 3: Steam Workshop text search via IPublishedFileService/QueryFiles (requires API key).
    // Tries each query variant until enough candidates are found. We keep going
    // even when local matches exist for short queries, since a one-word mod ID
    // may have come from a sibling mod that happens to share the substring.
    let steamSearchEnabled = false;
    let steamSearchAttempted = false;
    if (!/^\d{5,15}$/.test(searchTerm)) {
      try {
        const steamApiKey = await getSetting('steamApiKey');
        if (steamApiKey && typeof steamApiKey === 'string' && steamApiKey.length > 10) {
          steamSearchEnabled = true;
          // Score candidates so the most likely match floats to the top: exact
          // ID/name match first, then prefix/contains, then sub count tiebreak.
          const lowerOriginal = searchTerm.toLowerCase();
          const scoreCandidate = (title) => {
            const t = (title || '').toLowerCase();
            if (!t) return 0;
            if (t === lowerOriginal) return 1000;
            if (t.replace(/[\s_-]/g, '') === lowerOriginal) return 900;
            if (t.startsWith(lowerOriginal)) return 700;
            if (t.includes(lowerOriginal)) return 500;
            // Token overlap fallback for humanized variants
            const queryTokens = lowerOriginal.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_-]+/).filter(x => x.length > 2);
            if (queryTokens.length === 0) return 0;
            const matched = queryTokens.filter(tok => t.includes(tok)).length;
            return Math.round((matched / queryTokens.length) * 400);
          };

          const seenSteamIds = new Set([
            ...localResults.map(r => r.workshopId),
            ...steamResults.map(r => r.workshopId),
          ]);
          if (parentWsClean) seenSteamIds.add(parentWsClean);
          const collected = []; // { workshopId, modName, description, subscriberCount, score, variant }
          const targetCount = 12;

          for (const variant of searchVariants) {
            if (collected.length >= targetCount) break;
            steamSearchAttempted = true;
            const params = new URLSearchParams({
              key: steamApiKey,
              'query_type': '12',             // k_PublishedFileQueryType_RankedByTextSearch
              'page': '1',
              'numperpage': '15',
              'appid': '108600',              // Project Zomboid
              'search_text': variant,
              'return_short_description': 'true',
              'return_metadata': 'true',
            });
            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 8000);
              const response = await fetch(`https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/?${params}`, {
                signal: controller.signal,
              });
              clearTimeout(timeout);
              if (!response.ok) continue;
              const data = await response.json();
              const files = data.response?.publishedfiledetails || [];
              for (const item of files) {
                if (!item.publishedfileid || item.result !== 1) continue;
                const wsId = String(item.publishedfileid);
                if (seenSteamIds.has(wsId)) continue;
                seenSteamIds.add(wsId);
                const title = item.title || `Workshop ${wsId}`;
                const desc = item.short_description?.substring(0, 200) || '';
                const score = scoreCandidate(title) + Math.min(50, Math.log10((item.subscriptions || 0) + 1) * 10);
                collected.push({
                  workshopId: wsId,
                  modName: title,
                  description: desc,
                  subscriberCount: item.subscriptions || 0,
                  score,
                  matchedVariant: variant,
                });
              }
            } catch (e) {
              log.debug?.(`Steam text search variant "${variant}" failed (non-fatal): ${e.message}`);
            }
          }

          // Sort by score and keep the strongest matches
          collected.sort((a, b) => b.score - a.score);
          for (const c of collected.slice(0, targetCount)) {
            steamResults.push({
              workshopId: c.workshopId,
              modName: c.modName,
              description: c.description,
              subscriberCount: c.subscriberCount,
              source: 'steam',
              isDownloaded: false,
              matchedVariant: c.matchedVariant,
              relevance: c.score,
            });
          }
        }
      } catch (e) {
        log.debug?.(`Steam text search failed (non-fatal): ${e.message}`);
      }
    }

    res.json({
      success: true,
      query: searchTerm,
      variantsTried: searchVariants,
      steamSearchEnabled,
      steamSearchAttempted,
      results: [...localResults, ...steamResults],
      searchUrl: `https://steamcommunity.com/workshop/browse/?appid=108600&searchtext=${encodeURIComponent(searchTerm)}`,
    });
  } catch (error) {
    log.error(`Workshop search failed: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// ─── Missing Dependencies: Auto-resolve all unresolved deps ─────────────────
router.post('/resolve-missing-deps', async (req, res) => {
  try {
    const { deps } = req.body;
    if (!deps || !Array.isArray(deps)) {
      return res.status(400).json({ error: 'Dependencies array is required' });
    }

    const serverPath = await getServerPath();
    const resolved = [];

    for (const dep of deps) {
      const missingDep = dep.missingDep;
      if (!missingDep || typeof missingDep !== 'string') continue;
      if (dep.resolvedWorkshopId) { resolved.push(dep); continue; }

      // Search locally
      let found = false;
      if (serverPath) {
        const workshopPaths = [
          path.join(serverPath, 'steamapps', 'workshop', 'content', '108600'),
          path.join(serverPath, '..', 'steamapps', 'workshop', 'content', '108600'),
        ];
        for (const workshopBase of workshopPaths) {
          if (found || !fs.existsSync(workshopBase)) continue;
          try {
            for (const entry of fs.readdirSync(workshopBase, { withFileTypes: true })) {
              if (!entry.isDirectory() || found) continue;
              try {
                const details = getModDetailsFromWorkshop(entry.name, serverPath);
                for (const mod of details) {
                  if (mod.id === missingDep) {
                    resolved.push({ ...dep, resolvedWorkshopId: entry.name, resolvedModName: mod.name });
                    found = true; break;
                  }
                }
              } catch (e) { log.debug(`Error reading mod details during dep resolution: ${e.message}`); }
            }
          } catch (e) { log.debug(`Error reading workshop path during dep scan: ${e.message}`); }
        }
      }
      if (!found) resolved.push(dep);
    }

    res.json({ success: true, deps: resolved, resolvedCount: resolved.filter(d => d.resolvedWorkshopId).length });
  } catch (error) {
    log.error(`Failed to resolve missing deps: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// ─── Sync mod IDs from Workshop → INI ─────────────────────────────────────
router.post('/sync-mod-ids', async (req, res) => {
  try {
    const serverConfigPath = await getServerConfigPath();
    const serverName = await getServerName();
    const serverPath = await getServerPath();
    if (!serverConfigPath) {
      return res.status(400).json({ error: 'Server config path not set' });
    }
    const sanitizedServerName = path.basename(serverName);
    if (!sanitizedServerName || sanitizedServerName !== serverName || serverName.includes('..')) {
      return res.status(400).json({ error: 'Invalid server name' });
    }
    const iniPath = path.join(serverConfigPath, `${sanitizedServerName}.ini`);
    if (!fs.existsSync(iniPath)) {
      return res.status(400).json({ error: 'Server config file not found' });
    }

    // First pass: read INI to get workshop IDs list (no lock needed for read-only)
    const preContent = readTextFile(iniPath);
    const preWorkshopMatch = preContent.match(/^WorkshopItems=(.*)$/m);
    const workshopIds = (preWorkshopMatch?.[1]?.split(';').filter(Boolean) || []).filter(id => /^\d{1,15}$/.test(id));
    
    // Pre-resolve all mod IDs BEFORE taking the lock (async operations)
    const resolvedMap = new Map(); // workshopId -> { availableModIds, fallbackId, error }
    for (const workshopId of workshopIds) {
      try {
        const availableModIds = findAllModIdsFromWorkshop(workshopId, serverPath);
        if (availableModIds.length > 0) {
          resolvedMap.set(workshopId, { availableModIds, fallbackId: null });
        } else {
          const fallbackId = await fetchModIdFromWorkshop(workshopId);
          resolvedMap.set(workshopId, { availableModIds: [], fallbackId });
        }
      } catch (err) {
        log.error(`Error processing workshop ID ${workshopId}: ${err.message}`);
        resolvedMap.set(workshopId, { availableModIds: [], fallbackId: null, error: true });
      }
    }
    
    // Atomically re-read, modify, and write inside the lock
    const lockResult = await withIniLock(iniPath, () => {
      let content = readTextFile(iniPath);
    
      const modsMatch = content.match(/^Mods=(.*)$/m);
      const currentModIds = modsMatch?.[1]?.split(';').filter(Boolean) || [];
      const finalModIds = [...currentModIds];
      
      const syncedMods = [];
      const missingMods = [];
    
      for (const workshopId of workshopIds) {
        const resolved = resolvedMap.get(workshopId);
        if (!resolved || resolved.error) {
          missingMods.push(workshopId);
          continue;
        }
        
        const { availableModIds, fallbackId } = resolved;
        
        if (availableModIds.length > 0) {
          const present = availableModIds.filter(id => currentModIds.includes(id));
          if (present.length > 0) {
            syncedMods.push({ workshopId, mods: present, status: 'verified_present' });
          } else {
            const defaultMod = availableModIds[0];
            if (!finalModIds.includes(defaultMod)) {
              finalModIds.push(defaultMod);
              syncedMods.push({ workshopId, mods: [defaultMod], status: 'added_default' });
              log.info(`Auto-added default mod ID '${defaultMod}' for workshop item ${workshopId}`);
            }
            if (availableModIds.length > 1) {
              syncedMods[syncedMods.length - 1].alternatives = availableModIds.slice(1);
            }
          }
        } else if (fallbackId) {
          if (!finalModIds.includes(fallbackId)) {
            finalModIds.push(fallbackId);
            syncedMods.push({ workshopId, mods: [fallbackId], status: 'added_from_steam_api' });
          } else {
            syncedMods.push({ workshopId, mods: [fallbackId], status: 'verified_present_api' });
          }
        } else {
          missingMods.push(workshopId);
        }
      }
    
      const newModList = sanitizeIniList(finalModIds);
      if (content.includes('Mods=')) {
        content = content.replace(/^Mods=.*/m, `Mods=${newModList}`);
      } else {
        content += `\nMods=${newModList}`;
      }
    
      fs.writeFileSync(iniPath, content, 'utf-8');
      return { syncedMods, missingMods, totalModIds: finalModIds.length };
    });
    
    const addedCount = lockResult.syncedMods.filter(m => m.status.startsWith('added')).length;
    
    log.info(`Synced mod IDs: ${addedCount} added, ${lockResult.missingMods.length} missing downloads`);
    
    res.json({
      success: true,
      message: `Synced configuration. Added ${addedCount} missing mod IDs. ${lockResult.missingMods.length} items need download.`,
      syncedMods: lockResult.syncedMods,
      missingMods: lockResult.missingMods,
      totalModIds: lockResult.totalModIds,
      note: lockResult.missingMods.length > 0 
        ? 'Start server to download missing workshop items.' 
        : undefined
    });
  } catch (error) {
    log.error(`Failed to sync mod IDs: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});


// Validate mod configuration (check for dependencies and consistency)
router.get('/validate-config', async (req, res) => {
  try {
    const serverConfigPath = await getServerConfigPath();
    const serverPath = await getServerPath();
    const serverName = await getServerName();
    
    if (!serverConfigPath) {
      return res.status(400).json({ error: 'Server config path not set' });
    }
    
    // Sanitize serverName
    const sanitizedServerName = path.basename(serverName);
    if (!sanitizedServerName || sanitizedServerName !== serverName || serverName.includes('..')) {
      return res.status(400).json({ error: 'Invalid server name' });
    }
    const iniPath = path.join(serverConfigPath, `${sanitizedServerName}.ini`);
    
    if (!fs.existsSync(iniPath)) {
      return res.status(400).json({ error: 'Server config file not found' });
    }
    
    const content = readTextFile(iniPath);
    const workshopMatch = content.match(/^WorkshopItems=(.*)$/m);
    const modsMatch = content.match(/^Mods=(.*)$/m);
    
    const workshopIds = workshopMatch ? workshopMatch[1].split(';').filter(Boolean) : [];
    const modIds = modsMatch ? modsMatch[1].split(';').filter(Boolean) : [];
    
    const warnings = [];
    const errors = [];
    
    // 1. Check for Orphaned Mod IDs (Mods in list but no corresponding Workshop Item)
    // This requires scanning all configured workshop items to see what mods they provide
    const availableModIds = new Set();
    const modIdToWorkshopId = new Map();
    const references = new Map(); // modId -> { require: [] }
    
    if (serverPath) {
        for (const wid of workshopIds) {
            const details = getModDetailsFromWorkshop(wid, serverPath);
            for (const mod of details) {
                availableModIds.add(mod.id);
                modIdToWorkshopId.set(mod.id, wid);
                if (mod.require) {
                    references.set(mod.id, mod.require);
                }
            }
        }
        
        // Check if enabled mods exist in enabled workshop items
        for (const mid of modIds) {
            if (!availableModIds.has(mid)) {
                // It might be a default game map/mod, or truly missing
                // PZ default mods don't come from workshop
                if (mid !== 'example') { // Filter out common testing strings
                   warnings.push({
                       type: 'missing_source',
                       modId: mid,
                       message: `Mod ID '${mid}' is enabled but not found in any configured Workshop Item.`
                   });
                }
            }
        }

        // 2. Check for Missing Dependencies
        for (const mid of modIds) {
            const requirements = references.get(mid);
            if (requirements) {
                for (const req of requirements) {
                    if (!modIds.includes(req)) {
                         // Check if it's a base game mod (unlikely to be missing but possible)
                         errors.push({
                             type: 'missing_dependency',
                             modId: mid,
                             dependency: req,
                             message: `Mod '${mid}' requires '${req}' but it is not enabled.`
                         });
                    }
                }
            }
        }
    } else {
        warnings.push({ type: 'config', message: 'Server path not configured - cannot validate files on disk.' });
    }
    
    res.json({
        valid: errors.length === 0,
        errors,
        warnings,
        stats: {
            workshopItems: workshopIds.length,
            enabledMods: modIds.length,
            availableMods: availableModIds.size
        }
    });

  } catch (error) {
    log.error(`Failed to validate config: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// ===== MOD PRESETS =====

// Get all mod presets
router.get('/presets', async (req, res) => {
  try {
    const presets = await getModPresets();
    res.json({ presets });
  } catch (error) {
    log.error(`Failed to get mod presets: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Create a mod preset (save current mods as a preset)
router.post('/presets', async (req, res) => {
  try {
    let { name, description } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Preset name is required' });
    }
    name = name.trim();
    if (!name || name.length > 100) {
      return res.status(400).json({ error: 'Preset name must be 1-100 characters' });
    }
    if (description && typeof description === 'string') {
      description = description.trim().slice(0, 500);
    } else {
      description = '';
    }
    
    // Read current mods from INI
    const serverConfigPath = await getServerConfigPath();
    const serverName = await getServerName();
    const iniPath = getSanitizedIniPath(serverConfigPath, serverName);

    if (!iniPath) {
      return res.status(400).json({ error: 'Invalid server name' });
    }
    
    if (!fs.existsSync(iniPath)) {
      return res.status(400).json({ error: 'Server INI not found' });
    }
    
    const content = readTextFile(iniPath);
    const workshopMatch = content.match(/^WorkshopItems=(.*)$/m);
    const modsMatch = content.match(/^Mods=(.*)$/m);
    
    const workshopIds = workshopMatch ? workshopMatch[1].split(';').filter(Boolean) : [];
    const modIds = modsMatch ? modsMatch[1].split(';').filter(Boolean) : [];
    
    const preset = await createModPreset(name, description, modIds, workshopIds);
    
    log.info(`Created mod preset "${name}" with ${workshopIds.length} workshop items and ${modIds.length} mod IDs`);
    res.json({ preset, message: `Preset "${name}" created successfully` });
  } catch (error) {
    log.error(`Failed to create mod preset: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Update a mod preset
router.put('/presets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'Invalid preset ID' });
    }
    
    const updates = {};
    if (req.body.name !== undefined) {
      if (typeof req.body.name !== 'string') return res.status(400).json({ error: 'name must be a string' });
      const trimmed = req.body.name.trim();
      if (!trimmed || trimmed.length > 100) return res.status(400).json({ error: 'name must be 1-100 characters' });
      updates.name = trimmed;
    }
    if (req.body.description !== undefined) {
      updates.description = typeof req.body.description === 'string' ? req.body.description.trim().slice(0, 500) : '';
    }
    if (req.body.workshopIds !== undefined) {
      if (!Array.isArray(req.body.workshopIds)) return res.status(400).json({ error: 'workshopIds must be an array' });
      updates.workshop_ids = req.body.workshopIds;
    }
    if (req.body.modIds !== undefined) {
      if (!Array.isArray(req.body.modIds)) return res.status(400).json({ error: 'modIds must be an array' });
      updates.mods = req.body.modIds;
    }
    
    const preset = await updateModPreset(id, updates);
    if (!preset) {
      return res.status(404).json({ error: 'Preset not found' });
    }
    
    log.info(`Updated mod preset: ${name || id}`);
    res.json({ preset, message: 'Preset updated successfully' });
  } catch (error) {
    log.error(`Failed to update mod preset: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Delete a mod preset
router.delete('/presets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'Invalid preset ID' });
    }
    
    const deleted = await deleteModPreset(id);
    
    if (!deleted) {
      return res.status(404).json({ error: 'Preset not found' });
    }
    
    log.info(`Deleted mod preset: ${id}`);
    res.json({ message: 'Preset deleted successfully' });
  } catch (error) {
    log.error(`Failed to delete mod preset: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Apply a mod preset (load mods from preset)
router.post('/presets/:id/apply', async (req, res) => {
  try {
    const { id } = req.params;
    const presets = await getModPresets();
    const preset = presets.find(p => String(p.id) === String(id));
    
    if (!preset) {
      return res.status(404).json({ error: 'Preset not found' });
    }
    
    const serverConfigPath = await getServerConfigPath();
    const serverName = await getServerName();
    const iniPath = getSanitizedIniPath(serverConfigPath, serverName);

    if (!iniPath) {
      return res.status(400).json({ error: 'Invalid server name' });
    }
    
    if (!fs.existsSync(iniPath)) {
      return res.status(400).json({ error: 'Server INI not found' });
    }
    
    await withIniLock(iniPath, () => {
      let content = readTextFile(iniPath);
    
      const workshopLine = `WorkshopItems=${sanitizeIniList(preset.workshop_ids || [])}`;
      if (content.includes('WorkshopItems=')) {
        content = content.replace(/^WorkshopItems=.*/m, workshopLine);
      } else {
        content += `\n${workshopLine}`;
      }
    
      const modsLine = `Mods=${sanitizeIniList(preset.mods || [])}`;
      if (content.includes('Mods=')) {
        content = content.replace(/^Mods=.*/m, modsLine);
      } else {
        content += `\n${modsLine}`;
      }
    
      fs.writeFileSync(iniPath, content, 'utf-8');
    });
    
    log.info(`Applied mod preset "${preset.name}": ${(preset.workshop_ids || []).length} workshop items, ${(preset.mods || []).length} mod IDs`);
    res.json({ 
      message: `Preset "${preset.name}" applied successfully`,
      workshopCount: (preset.workshop_ids || []).length,
      modCount: (preset.mods || []).length
    });
  } catch (error) {
    log.error(`Failed to apply mod preset: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Save mod load order
router.post('/save-order', async (req, res) => {
  try {
    const { modIds } = req.body;

    if (!Array.isArray(modIds)) {
      return res.status(400).json({ error: 'modIds must be an array' });
    }
    if (modIds.length > 2000) {
      return res.status(400).json({ error: 'Too many mod IDs (max 2000)' });
    }
    for (const id of modIds) {
      if (typeof id !== 'string' || id.length > 200) {
        return res.status(400).json({ error: 'Each mod ID must be a string (max 200 chars)' });
      }
    }

    const serverConfigPath = await getServerConfigPath();
    const serverName = await getServerName();
    const iniPath = getSanitizedIniPath(serverConfigPath, serverName);

    if (!iniPath) {
      return res.status(400).json({ error: 'Invalid server name' });
    }
    
    if (!fs.existsSync(iniPath)) {
      return res.status(400).json({ error: 'Server INI not found' });
    }
    
    await withIniLock(iniPath, () => {
      let content = readTextFile(iniPath);
    
      const modsLine = `Mods=${sanitizeIniList(modIds)}`;
      if (content.includes('Mods=')) {
        content = content.replace(/^Mods=.*/m, modsLine);
      } else {
        content += `\n${modsLine}`;
      }
    
      fs.writeFileSync(iniPath, content, 'utf-8');
    });
    
    log.info(`Saved mod load order: ${modIds.length} mods`);
    res.json({ 
      message: 'Mod load order saved successfully',
      modCount: modIds.length
    });
  } catch (error) {
    log.error(`Failed to save mod order: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

router.post('/discover-mod-ids', async (req, res) => {
  try {
    const { workshopId, workshopUrl } = req.body;
    
    // Parse workshop ID from URL if provided
    let wsId = workshopId;
    if (!wsId && workshopUrl) {
      const urlMatch = workshopUrl.match(/id=(\d+)/);
      if (urlMatch) {
        wsId = urlMatch[1];
      }
    }
    
    if (!wsId) {
      return res.status(400).json({ error: 'Workshop ID or URL is required' });
    }
    
    // Validate it's a number
    if (!/^\d{1,15}$/.test(String(wsId))) {
      return res.status(400).json({ error: 'Invalid Workshop ID' });
    }
    
    const serverPath = await getServerPath();
    const discoveredModIds = [];
    const sources = [];
    
    // 1. First try local files (most accurate if mod is already downloaded)
    if (serverPath) {
      const localModIds = findAllModIdsFromWorkshop(String(wsId), serverPath);
      for (const modId of localModIds) {
        if (!discoveredModIds.includes(modId)) {
          discoveredModIds.push(modId);
          sources.push({ modId, source: 'local-files' });
        }
      }
    }
    
    // 2. Try Steam Workshop API to get mod info (with timeout)
    let modInfo = null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const response = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          'itemcount': '1',
          'publishedfileids[0]': wsId
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      
      if (response.ok) {
        const data = await response.json();
        modInfo = data.response?.publishedfiledetails?.[0];
        
        // Handle Steam API error codes
        if (modInfo && modInfo.result !== 1) {
          log.warn(`Steam API returned error for workshop ${wsId}: result=${modInfo.result}`);
          modInfo = null;
        }
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        log.warn(`Steam API request timed out for workshop ${wsId}`);
      } else {
        log.warn(`Failed to fetch Steam API for workshop ${wsId}: ${e.message}`);
      }
    }
    
    // 3. Parse mod IDs from description (if not found locally)
    if (modInfo && modInfo.result === 1 && discoveredModIds.length === 0) {
      const description = modInfo.description || '';
      
      // Try various patterns to find mod IDs
      const patterns = [
        // Pattern: "Mod ID: SomeName" or "ModID: SomeName" (can appear multiple times)
        /Mod\s*ID\s*[:=]\s*([A-Za-z0-9_-]+)/gi,
        // Pattern: "id=SomeName" 
        /\bid\s*=\s*([A-Za-z0-9_-]+)/gi,
      ];
      
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(description)) !== null) {
          const modId = match[1].trim();
          // Skip numeric-only values (likely workshop IDs)
          if (!/^\d{1,15}$/.test(modId) && !discoveredModIds.includes(modId)) {
            discoveredModIds.push(modId);
            sources.push({ modId, source: 'steam-description' });
          }
        }
      }
    }
    
    // Deduplicate mod IDs (some mods list the same ID multiple times)
    const uniqueModIds = [...new Set(discoveredModIds)];
    
    // Get map folders if available
    let mapFolders = [];
    if (serverPath) {
      mapFolders = findMapFoldersFromWorkshop(String(wsId), serverPath);
    }
    
    // Check if mod has map tag from Steam API
    const isMap = modInfo?.tags?.some(t => 
      t.tag?.toLowerCase() === 'map' || t.tag?.toLowerCase() === 'maps'
    ) || mapFolders.length > 0;
    
    res.json({
      success: true,
      workshopId: wsId,
      name: modInfo?.title || `Workshop Mod ${wsId}`,
      description: modInfo?.description?.substring(0, 500) || null,
      modIds: uniqueModIds,
      hasMultipleModIds: uniqueModIds.length > 1,
      sources,
      isMap,
      mapFolders,
      isDownloaded: serverPath ? findAllModIdsFromWorkshop(String(wsId), serverPath).length > 0 : false,
      tags: modInfo?.tags?.map(t => t.tag) || []
    });
  } catch (error) {
    log.error(`Failed to discover mod IDs: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Add mod with specific mod IDs selected (for multi-ID mods)
router.post('/add-mod-advanced', async (req, res) => {
  try {
    const { workshopId, selectedModIds, includeAllModIds } = req.body;
    // workshopId: the Steam Workshop ID
    // selectedModIds: array of mod IDs to add (user-selected)
    // includeAllModIds: boolean - if true, add all discovered mod IDs
    
    if (!workshopId) {
      return res.status(400).json({ error: 'Workshop ID is required' });
    }
    
    if (!selectedModIds && !includeAllModIds) {
      return res.status(400).json({ error: 'Either selectedModIds or includeAllModIds is required' });
    }
    
    // Validate workshopId is numeric
    if (!/^\d{1,15}$/.test(String(workshopId))) {
      return res.status(400).json({ error: 'Invalid Workshop ID' });
    }
    
    const serverConfigPath = await getServerConfigPath();
    const serverName = await getServerName();
    const serverPath = await getServerPath();
    
    if (!serverConfigPath) {
      return res.status(400).json({ error: 'Server config path not set' });
    }

    const sanitizedServerName = path.basename(serverName);
    if (!sanitizedServerName || sanitizedServerName !== serverName || serverName.includes('..')) {
      return res.status(400).json({ error: 'Invalid server name' });
    }

    const iniPath = path.join(serverConfigPath, `${sanitizedServerName}.ini`);
    if (!fs.existsSync(iniPath)) {
      return res.status(400).json({ error: 'Server config file not found' });
    }

    // Validate mod ID format BEFORE taking the lock (prevent INI injection)
    let modIdsToAdd = selectedModIds || [];
    for (const modId of modIdsToAdd) {
      if (typeof modId !== 'string' || !modId.trim() || /[\r\n;=]/.test(modId) || modId.length > 200) {
        return res.status(400).json({ error: `Invalid mod ID format: ${String(modId).substring(0, 50)}` });
      }
    }
    
    if (includeAllModIds && serverPath) {
      const allModIds = findAllModIdsFromWorkshop(String(workshopId), serverPath);
      modIdsToAdd = [...new Set([...modIdsToAdd, ...allModIds])];
    }
    
    // Detect map folders outside the lock (sync disk reads)
    let modMapFolders = [];
    if (serverPath) {
      modMapFolders = findMapFoldersFromWorkshop(String(workshopId), serverPath);
    }
    
    // Atomically read-modify-write inside the lock
    let addedMapFolders = [];
    const lockResult = await withIniLock(iniPath, () => {
      let content = readTextFile(iniPath);
    
      const workshopMatch = content.match(/^WorkshopItems=(.*)$/m);
      const currentWorkshopIds = workshopMatch?.[1]?.split(';').filter(Boolean) || [];
      const modsMatch = content.match(/^Mods=(.*)$/m);
      const currentModIds = modsMatch?.[1]?.split(';').filter(Boolean) || [];
    
      const workshopAlreadyExists = currentWorkshopIds.includes(String(workshopId));
      if (!workshopAlreadyExists) {
        currentWorkshopIds.push(String(workshopId));
      }
    
      const addedModIds = [];
      for (const modId of modIdsToAdd) {
        if (!currentModIds.includes(modId)) {
          currentModIds.push(modId);
          addedModIds.push(modId);
        }
      }
    
      const newWorkshopList = sanitizeIniList(currentWorkshopIds);
      const newModList = sanitizeIniList(currentModIds);
    
      if (content.includes('WorkshopItems=')) {
        content = content.replace(/^WorkshopItems=.*/m, `WorkshopItems=${newWorkshopList}`);
      } else {
        content += `\nWorkshopItems=${newWorkshopList}`;
      }
    
      if (content.includes('Mods=')) {
        content = content.replace(/^Mods=.*/m, `Mods=${newModList}`);
      } else {
        content += `\nMods=${newModList}`;
      }
    
      if (modMapFolders.length > 0) {
        const mapMatch = content.match(/^Map=(.*)$/m);
        let currentMaps = mapMatch?.[1]?.split(';').filter(Boolean) || ['Muldraugh, KY'];
        
        for (const folder of modMapFolders) {
          if (!currentMaps.includes(folder)) {
            currentMaps.unshift(folder);
            addedMapFolders.push(folder);
          }
        }
        
        const newMapList = currentMaps.join(';');
        if (content.includes('Map=')) {
          content = content.replace(/^Map=.*/m, `Map=${newMapList}`);
        } else {
          content += `\nMap=${newMapList}`;
        }
      }
    
      fs.writeFileSync(iniPath, content, 'utf-8');
      return { addedModIds, totalModIdsInConfig: currentModIds.length, workshopAlreadyExisted: workshopAlreadyExists };
    });

    // Also add to tracking (and clear from ignore list if present)
    try {
      await removeIgnoredMod(String(workshopId));
      await addTrackedMod(String(workshopId), `Workshop Mod ${workshopId}`);
    } catch (e) {
      // Ignore if already tracked
    }

    // Best-effort: mirror this add into the configured Steam Workshop
    // collection if auto-sync is enabled. Never blocks the response.
    autoSyncCollection('add', String(workshopId)).catch(() => {});

    log.info(`Added mod ${workshopId} with ${lockResult.addedModIds.length} mod IDs: ${lockResult.addedModIds.join(', ')}`);

    res.json({
      success: true,
      workshopId,
      addedModIds: lockResult.addedModIds,
      totalModIdsInConfig: lockResult.totalModIdsInConfig,
      workshopAlreadyExisted: lockResult.workshopAlreadyExisted,
      mapFoldersAdded: addedMapFolders,
      message: lockResult.addedModIds.length > 0
        ? `Added ${lockResult.addedModIds.length} mod ID(s): ${lockResult.addedModIds.join(', ')}`
        : 'Workshop ID added (mod IDs were already configured)'
    });
  } catch (error) {
    log.error(`Failed to add mod advanced: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// ─── Mod Conflict Scanner ────────────────────────────────────────────────
// Scans all configured workshop mods for file-level conflicts (multiple mods
// overriding the same game file). Similar concept to LOOT for Skyrim.

// Prevent concurrent scans from hammering disk I/O
let conflictScanInFlight = false;
let conflictScanStartedAt = 0;
const SCAN_MUTEX_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// In-memory cache of last scan result (cleared on config changes or after TTL)
let lastScanResult = null;
let lastScanWorkshopSnapshot = null;
let lastScanModSnapshot = null;
let lastScanTimestamp = 0;
const SCAN_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function acquireScanLock() {
  // Auto-reset if stuck for more than 5 minutes (e.g. crash mid-scan)
  if (conflictScanInFlight && Date.now() - conflictScanStartedAt > SCAN_MUTEX_TIMEOUT_MS) {
    log.warn('Conflict scan mutex was stuck for >5 min — auto-resetting');
    conflictScanInFlight = false;
  }
  if (conflictScanInFlight) return false;
  conflictScanInFlight = true;
  conflictScanStartedAt = Date.now();
  return true;
}

function releaseScanLock() {
  conflictScanInFlight = false;
  conflictScanStartedAt = 0;
}

// Max file size to hash (50 MB) — larger files are treated as different
const HASH_MAX_BYTES = 50 * 1024 * 1024;

// Recursively collect all files under a directory, returning relative paths.
// Guarded with depth and file-count limits to prevent runaway traversal.
// Returns { files: string[], truncated: boolean }
function walkDir(dir, prefix = '', _depth = 0) {
  const MAX_DEPTH = 20;
  const MAX_FILES = 50_000;
  const results = [];
  let truncated = false;
  if (_depth > MAX_DEPTH) return { files: results, truncated };
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { log.debug(`walkDir: could not read ${dir}: ${e.message}`); return { files: results, truncated }; }
  for (const entry of entries) {
    if (results.length >= MAX_FILES) { truncated = true; break; }
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      // Skip version-control and metadata directories — never game content
      const lowerName = entry.name.toLowerCase();
      if (lowerName === '.git' || lowerName === '.svn' || lowerName === '.hg' || lowerName === '__pycache__' || lowerName === 'node_modules' || lowerName === '.vscode') continue;
      // Skip symlinked directories to stay within the expected tree
      const fullPath = path.join(dir, entry.name);
      try {
        const real = fs.realpathSync(fullPath);
        const realDir = fs.realpathSync(dir);
        if (!real.startsWith(realDir + path.sep) && real !== realDir) continue;
      } catch (e) { log.debug(`Symlink resolve failed for ${fullPath}: ${e.message}`); continue; }
      const sub = walkDir(fullPath, rel, _depth + 1);
      results.push(...sub.files);
      if (sub.truncated) truncated = true;
    } else {
      results.push(rel);
    }
  }
  return { files: results, truncated };
}

// Classify a file path into a conflict severity category
function classifyFile(relPath) {
  const lower = relPath.toLowerCase();
  const basename = lower.split('/').pop();

  // ─── Top-level media files (at media/ root) ───
  // sandbox-options.txt: PZ merges option blocks by name — always additive.
  if (basename === 'sandbox-options.txt') return 'sandbox-options';
  // fileGuidTable.xml: PZ mod editor metadata, never loaded at runtime.
  if (basename === 'fileguidtable.xml') return 'fileguidtable';

  // ─── Lua scripts ───
  if (lower.startsWith('lua/')) {
    if (lower.startsWith('lua/server/')) return 'lua-server';
    if (lower.startsWith('lua/client/')) return 'lua-client';
    if (lower.startsWith('lua/shared/translate/')) return 'translate';
    if (lower.startsWith('lua/shared/')) return 'lua-shared';
    return 'lua-other';
  }

  // ─── PZ script definitions ───
  if (lower.startsWith('scripts/')) return 'scripts';

  // ─── Clothing definitions ───
  // PZ merges all clothing.xml and clothingitems/*.xml files — each mod defines
  // its own clothing items by unique ID. Only overlapping IDs are real conflicts.
  if (lower.startsWith('clothing/')) return 'clothing';

  if (lower.startsWith('maps/')) return 'maps';
  if (lower.startsWith('texturepacks/') || lower.startsWith('textures/') || lower.endsWith('.pack')) return 'textures';
  if (lower.startsWith('ui/')) return 'ui-assets';
  if (lower.startsWith('sound/') || lower.startsWith('music/')) return 'audio';
  if (lower.startsWith('models/') || lower.startsWith('models_x/') || lower.endsWith('.fbx') || lower.endsWith('.x')) return 'models';
  if (lower.endsWith('.png') || lower.endsWith('.jpg')) return 'textures';
  if (lower.endsWith('.xml') || lower.endsWith('.txt')) return 'data';
  return 'other';
}

const SEVERITY_MAP = {
  'lua-server': 'high',
  'lua-shared': 'high',
  'lua-client': 'high',
  'lua-other': 'high',
  'lua-cross-file': 'high',
  'scripts': 'medium',
  'clothing': 'medium',
  'sandbox-options': 'low',
  'fileguidtable': 'low',
  'translate': 'low',
  'maps': 'medium',
  'textures': 'low',
  'ui-assets': 'low',
  'models': 'low',
  'audio': 'low',
  'data': 'medium',
  'other': 'low'
};

const CATEGORY_LABELS = {
  'lua-server': 'Server Lua Scripts',
  'lua-shared': 'Shared Lua Scripts',
  'lua-client': 'Client Lua Scripts',
  'lua-other': 'Lua Scripts',
  'lua-cross-file': 'Lua Symbol Clash (same workshop, different files)',
  'scripts': 'Item/Recipe/Vehicle Scripts',
  'clothing': 'Clothing Definitions',
  'sandbox-options': 'Sandbox Options',
  'fileguidtable': 'Mod Editor Metadata',
  'translate': 'Translation Files',
  'maps': 'Map Data',
  'textures': 'Texture Packs',
  'ui-assets': 'UI Assets',
  'models': '3D Models',
  'audio': 'Audio',
  'data': 'Data Files',
  'other': 'Other Files'
};

// ─── Translation file key extraction ────────────────────────────────────────
// PZ translation files are Lua tables with `KEY = "value"` entries.
// Multiple mods can each add their own keys to the same file name — only
// overlapping keys represent a real conflict.
function extractTranslationKeys(filePath) {
  try {
    const content = stripBom(fs.readFileSync(filePath, 'utf-8'));
    const keys = new Set();
    // Match lines like:   IGUI_perks_Lightfoot = "靈巧",
    // The value must look like a string ("..." or '...' or [[...]]).
    // This skips the wrapping table declaration `IGUI_EN = {` (false-positive
    // source: every translation file has one and the names sometimes match).
    const re = /^\s*([A-Za-z_]\w*)\s*=\s*(?:"|'|\[\[)/gm;
    let m;
    while ((m = re.exec(content)) !== null) keys.add(m[1]);
    return keys;
  } catch (e) { log.debug(`Error parsing translation file ${filePath}: ${e.message}`); return null; }
}

// Compare keys from multiple mod versions of the same translation file.
// Returns { disjoint: true } if no keys overlap (additive — not a real conflict),
// or { disjoint: false, overlapping: [...] } if keys collide.
function compareTranslationKeys(modEntries) {
  const keysByMod = [];
  for (const entry of modEntries) {
    const keys = extractTranslationKeys(entry.absPath);
    if (!keys || keys.size === 0) continue; // can't parse → skip this entry, check remaining
    keysByMod.push({ mod: entry, keys });
  }
  // Check every pair for overlapping keys
  const overlapping = new Set();
  for (let i = 0; i < keysByMod.length; i++) {
    for (let j = i + 1; j < keysByMod.length; j++) {
      if (keysByMod[i].mod.modId === keysByMod[j].mod.modId) continue;
      for (const k of keysByMod[i].keys) {
        if (keysByMod[j].keys.has(k)) overlapping.add(k);
      }
    }
  }
  return { disjoint: overlapping.size === 0, overlapping: [...overlapping] };
}

// ─── PZ script file parsing ─────────────────────────────────────────────────
// PZ script files (scripts/*.txt) contain blocks like:
//   module Base { item BaseballBat { ... } recipe CraftBat { ... } }
// PZ loads ALL .txt files from every mod's scripts/ folder and merges them.
// Two mods with the same filename but DIFFERENT module.type.name definitions
// are additive (not conflicting). Only overlapping definitions are real conflicts.
function extractScriptDefinitions(filePath) {
  try {
    const content = stripBom(fs.readFileSync(filePath, 'utf-8'));
    if (content.length > 2 * 1024 * 1024) return null; // skip huge files
    const defs = new Set();
    // Match: module ModuleName { ... }
    const moduleRe = /module\s+(\w+)\s*\{/g;
    let moduleMatch;
    while ((moduleMatch = moduleRe.exec(content)) !== null) {
      const moduleName = moduleMatch[1];
      const moduleStart = moduleMatch.index + moduleMatch[0].length;
      // Find the matching closing brace for this module block
      let depth = 1;
      let pos = moduleStart;
      while (pos < content.length && depth > 0) {
        if (content[pos] === '{') depth++;
        else if (content[pos] === '}') depth--;
        pos++;
      }
      const moduleBody = content.slice(moduleStart, pos - 1);
      // Extract top-level definitions. B41 + B42 keywords (B42 adds craftRecipe, entity,
      // xuiSkin, componentTemplate, bodyLocation, wallpaper, material, etc.).
      const defRe = /^\s*(item|recipe|craftrecipe|vehicle|fixing|model|sound|animation|mannequin|evolvedrecipe|uniquerecipe|multistagebuild|entity|xuiskin|componenttemplate|bodylocation|wallpaper|material|template|electrical|liquid|liquidvacuumdef|stash|profession|trait|bodypart)\s+(\S+)/gim;
      let defMatch;
      while ((defMatch = defRe.exec(moduleBody)) !== null) {
        defs.add(`${moduleName}.${defMatch[1].toLowerCase()}.${defMatch[2]}`);
      }
    }
    return defs;
  } catch (e) { log.debug(`Error parsing script file ${filePath}: ${e.message}`); return null; }
}

// Compare script definitions from multiple mod versions of the same file.
// Returns { disjoint: true } if no definitions overlap (additive),
// or { disjoint: false, overlapping: [...] } if definitions collide.
function compareScriptDefinitions(modEntries) {
  const defsByMod = [];
  for (const entry of modEntries) {
    const defs = extractScriptDefinitions(entry.absPath);
    if (!defs || defs.size === 0) continue;
    defsByMod.push({ mod: entry, defs });
  }
  if (defsByMod.length < 2) return { disjoint: false, overlapping: [] }; // can't parse → assume conflict
  const overlapping = new Set();
  for (let i = 0; i < defsByMod.length; i++) {
    for (let j = i + 1; j < defsByMod.length; j++) {
      if (defsByMod[i].mod.modId === defsByMod[j].mod.modId) continue;
      for (const d of defsByMod[i].defs) {
        if (defsByMod[j].defs.has(d)) overlapping.add(d);
      }
    }
  }
  return { disjoint: overlapping.size === 0, overlapping: [...overlapping] };
}

// ─── Clothing XML parsing ───────────────────────────────────────────────────
// PZ clothing files (clothing/clothing.xml, clothing/clothingitems/*.xml) are
// additive: PZ loads all such files from every mod and merges by item name.
// Two mods defining the same clothing item ID is a real conflict; different IDs
// are harmless. PZ uses `m_MaleModel`/`m_FemaleModel` as the unique identifier.
function extractClothingDefinitions(filePath) {
  try {
    const content = stripBom(fs.readFileSync(filePath, 'utf-8'));
    if (content.length > 2 * 1024 * 1024) return null;
    const defs = new Set();
    // Match XML tags like <m_MaleModel>ItemName</m_MaleModel> or <m_FemaleModel>ItemName</m_FemaleModel>
    const modelRe = /<m_(?:Male|Female)Model>\s*([^<]+)\s*<\/m_(?:Male|Female)Model>/gi;
    let m;
    while ((m = modelRe.exec(content)) !== null) {
      defs.add(m[1].trim().toLowerCase());
    }
    // Also match <m_Name> for clothingitems XML format
    const nameRe = /<m_Name>\s*([^<]+)\s*<\/m_Name>/gi;
    while ((m = nameRe.exec(content)) !== null) {
      defs.add(m[1].trim().toLowerCase());
    }
    return defs;
  } catch (e) { log.debug(`Error parsing clothing file ${filePath}: ${e.message}`); return null; }
}

function compareClothingDefinitions(modEntries) {
  const defsByMod = [];
  for (const entry of modEntries) {
    const defs = extractClothingDefinitions(entry.absPath);
    if (!defs || defs.size === 0) continue;
    defsByMod.push({ mod: entry, defs });
  }
  if (defsByMod.length < 2) return { disjoint: false, overlapping: [] };
  const overlapping = new Set();
  for (let i = 0; i < defsByMod.length; i++) {
    for (let j = i + 1; j < defsByMod.length; j++) {
      if (defsByMod[i].mod.modId === defsByMod[j].mod.modId) continue;
      for (const d of defsByMod[i].defs) {
        if (defsByMod[j].defs.has(d)) overlapping.add(d);
      }
    }
  }
  return { disjoint: overlapping.size === 0, overlapping: [...overlapping] };
}

// ─── Lua symbol extraction ──────────────────────────────────────────────────
// PZ does NOT merge Lua files: when two mods ship the same lua/.../foo.lua,
// the last-loaded one wins outright and the loser is discarded entirely.
// We extract the *names* both files define so the UI can show what would clash
// vs what would merely be shadowed:
//   fn:Foo.bar          — function declarations  (function Foo:bar / Foo.bar / function bar)
//   event:OnPlayerMove  — Events.X.Add subscriptions
//   class:ISFoo         — ISClass:derive("ISFoo") declarations
//   tbl:Foo             — top-level table assigns (Foo = {...})
function extractLuaSymbols(filePath) {
  try {
    const content = stripBom(fs.readFileSync(filePath, 'utf-8'));
    if (content.length > 2 * 1024 * 1024) return null;
    // Strip --[[ block comments ]] and -- line comments to avoid false positives
    const stripped = content
      .replace(/--\[\[[\s\S]*?\]\]/g, '')
      .replace(/--[^\n]*/g, '');
    const symbols = new Set();
    let m;
    // function Foo:bar(...)  |  function Foo.bar.baz(...)  |  function bar(...)
    const fnRe = /(?:^|\n)\s*(?:local\s+)?function\s+([A-Za-z_][\w.:]*)\s*\(/g;
    while ((m = fnRe.exec(stripped)) !== null) symbols.add(`fn:${m[1]}`);
    // X.Y = function(...)
    const assignFnRe = /(?:^|\n)\s*([A-Za-z_][\w.]*)\s*=\s*function\s*\(/g;
    while ((m = assignFnRe.exec(stripped)) !== null) symbols.add(`fn:${m[1]}`);
    // Events.OnPlayerMove.Add(...)  /  .Remove(...)
    const evRe = /\bEvents\.([A-Za-z_]\w*)\.(?:Add|Remove)\s*\(/g;
    while ((m = evRe.exec(stripped)) !== null) symbols.add(`event:${m[1]}`);
    // ISFoo = ISBar:derive("ISFoo")  — class declarations
    const classRe = /(?:^|\n)\s*([A-Z][\w]*)\s*=\s*[A-Z][\w]*\s*:\s*derive\s*\(/g;
    while ((m = classRe.exec(stripped)) !== null) symbols.add(`class:${m[1]}`);
    return symbols;
  } catch (e) { log.debug(`Error parsing Lua file ${filePath}: ${e.message}`); return null; }
}

// Compare Lua files at the same path across multiple mods.
// Returns { overlapping: [...], parsed: number } or null when nothing parsable.
function compareLuaSymbols(modEntries) {
  const symsByMod = [];
  for (const entry of modEntries) {
    const s = extractLuaSymbols(entry.absPath);
    if (!s || s.size === 0) continue;
    symsByMod.push({ mod: entry, symbols: s });
  }
  if (symsByMod.length < 2) return null;
  const overlapping = new Set();
  for (let i = 0; i < symsByMod.length; i++) {
    for (let j = i + 1; j < symsByMod.length; j++) {
      if (symsByMod[i].mod.modId === symsByMod[j].mod.modId) continue;
      for (const s of symsByMod[i].symbols) if (symsByMod[j].symbols.has(s)) overlapping.add(s);
    }
  }
  return { overlapping: [...overlapping], parsed: symsByMod.length };
}

// ─── Shared scan helpers ────────────────────────────────────────────────────
// Yield to event loop (allows SSE writes, incoming requests, etc.)
const yieldTick = () => new Promise(resolve => setImmediate(resolve));

// Hash a single file for content comparison (async to avoid blocking)
async function hashFile(filePath) {
  try {
    const stat = await fsp.stat(filePath);
    if (stat.size > HASH_MAX_BYTES) return 'too-large';
    const buf = await fsp.readFile(filePath);
    return crypto.createHash('md5').update(buf).digest('hex');
  } catch (e) { log.debug(`Error hashing file ${filePath}: ${e.message}`); return null; }
}

// Sync variant kept for the non-streaming diff endpoint (single-file, already fast)
function hashFileSync(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > HASH_MAX_BYTES) return 'too-large';
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(buf).digest('hex');
  } catch (e) { log.debug(`Error hashing file sync ${filePath}: ${e.message}`); return null; }
}

// Read INI and return { workshopIds, modIdsFromIni }
async function readIniModLists() {
  const serverConfigPath = await getServerConfigPath();
  const serverName = await getServerName();
  const iniPath = getSanitizedIniPath(serverConfigPath, serverName);
  let workshopIds = [];
  let modIdsFromIni = [];
  if (iniPath && fs.existsSync(iniPath)) {
    const iniContent = readTextFile(iniPath);
    const wsMatch = iniContent.match(/^WorkshopItems=(.*)$/m);
    const modsMatch = iniContent.match(/^Mods=(.*)$/m);
    if (wsMatch && wsMatch[1].trim()) {
      workshopIds = wsMatch[1].trim().split(';').map(s => s.trim()).filter(Boolean);
    }
    if (modsMatch && modsMatch[1].trim()) {
      modIdsFromIni = modsMatch[1].trim().split(';').map(s => s.trim()).filter(Boolean);
    }
  }
  return { workshopIds, modIdsFromIni };
}

// Build the file index and collect per-mod metadata.
// Calls `onModScanned(modId, modName, wsId, fileCount)` for each mod.
// If `activeModIds` is provided, only mod directories whose ID is in that set are scanned.
async function buildFileIndex(workshopIds, serverPath, onModScanned, activeModIds) {
  const fileIndex = {};
  const modInfoMap = {};
  let modsScanned = 0;
  let modsNotFound = 0;
  let modsSkippedInactive = 0;
  const warnings = [];
  const totalWorkshopIds = workshopIds.length;
  const activeSet = activeModIds ? new Set(activeModIds) : null;

  for (let wsIdx = 0; wsIdx < totalWorkshopIds; wsIdx++) {
    const wsId = workshopIds[wsIdx];
    if (!/^\d{1,15}$/.test(wsId)) {
      warnings.push(`Skipped invalid workshop ID: ${wsId.slice(0, 20)}`);
      continue;
    }
    const possiblePaths = getWorkshopPaths(wsId, serverPath);
    let workshopPath = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) { workshopPath = p; break; }
    }
    if (!workshopPath) {
      // Counted in modsNotFound; not pushed to warnings — would otherwise drown out real ones.
      modsNotFound++;
      continue;
    }
    const modDetails = getModDetailsFromWorkshop(wsId, serverPath);
    modInfoMap[wsId] = modDetails;
    const modsFolder = path.join(workshopPath, 'mods');
    const searchBase = fs.existsSync(modsFolder) ? modsFolder : workshopPath;
    let modEntries;
    try { modEntries = fs.readdirSync(searchBase, { withFileTypes: true }); } catch (e) { log.debug(`Could not read mod directory ${searchBase}: ${e.message}`); continue; }
    let modsFoundInThisWs = 0;
    for (const modDir of modEntries) {
      if (!modDir.isDirectory()) continue;
      const modDirPath = path.join(searchBase, modDir.name);
      // Collect all media paths — direct + B42 versioned subfolders (42/, 42.X/, common/)
      const mediaPaths = [];
      const directMedia = path.join(modDirPath, 'media');
      if (fs.existsSync(directMedia)) {
        mediaPaths.push(directMedia);
      } else {
        // B42 mods may have versioned subfolders instead of a direct media/ folder
        try {
          const subDirs = fs.readdirSync(modDirPath, { withFileTypes: true });
          for (const sub of subDirs) {
            if (!sub.isDirectory()) continue;
            // Match: 42, 42.0, 42.13, common (versioned B42 subfolder patterns)
            if (/^(42(\.\d+)?|common)$/i.test(sub.name)) {
              const subMedia = path.join(modDirPath, sub.name, 'media');
              if (fs.existsSync(subMedia)) mediaPaths.push(subMedia);
            }
          }
        } catch (e) { log.debug(`Could not scan B42 subfolders for ${modDirPath}: ${e.message}`); }
      }
      if (mediaPaths.length === 0) continue;
      const matchingMod = modDetails.find(m => m.id === modDir.name || m.name === modDir.name);
      const modId = matchingMod?.id || modDir.name;
      const modName = matchingMod?.name || modDir.name;
      // Skip mod directories that aren't in the active Mods= list
      if (activeSet && !activeSet.has(modId)) {
        modsSkippedInactive++;
        continue;
      }
      modsScanned++;
      modsFoundInThisWs++;
      let totalFileCount = 0;
      for (const mediaPath of mediaPaths) {
        const { files, truncated } = walkDir(mediaPath);
        if (truncated) {
          warnings.push(`${modName} (${wsId}): file scan hit the 50,000 file limit — some files were skipped`);
        }
        totalFileCount += files.length;
        for (const relFile of files) {
          const normalizedPath = relFile.replace(/\\/g, '/').toLowerCase();
          if (!fileIndex[normalizedPath]) {
            fileIndex[normalizedPath] = [];
          }
          fileIndex[normalizedPath].push({ workshopId: wsId, modId, modName, absPath: path.join(mediaPath, relFile) });
        }
      }
      if (onModScanned) onModScanned({ modId, modName, workshopId: wsId, fileCount: totalFileCount, modsScanned, totalWorkshopIds, wsIdx });
    }
    if (modsFoundInThisWs > 1) {
      log.debug(`Workshop ${wsId}: contains ${modsFoundInThisWs} mod dirs (${modInfoMap[wsId]?.map(m => m.id).join(', ') || 'unknown'})`);
    }
    // Yield after each workshop item so SSE writes and incoming requests aren't starved
    await yieldTick();
  }
  return { fileIndex, modInfoMap, modsScanned, modsNotFound, modsSkippedInactive, warnings };
}

// Detect conflicts from a file index. Calls `onConflictFound(conflict)` for each.
async function detectConflicts(fileIndex, onConflictFound) {
  const conflicts = [];
  let identicalSkipped = 0;
  let additiveSkipped = 0;
  let pzAdditiveSkipped = 0;  // PZ-specific additive files (sandbox, scripts, clothing, metadata)
  const pzAdditiveBreakdown = { sandbox: 0, scripts: 0, clothing: 0, fileguidtable: 0, translate: 0 };
  let processed = 0;
  for (const [filePath, mods] of Object.entries(fileIndex)) {
    if (mods.length < 2) continue;
    const uniqueModIds = [...new Set(mods.map(m => m.modId))];
    if (uniqueModIds.length < 2) continue;
    const hashes = await Promise.all(mods.map(async m => ({ ...m, hash: await hashFile(m.absPath) })));
    const validHashes = hashes.filter(h => h.hash != null);
    if (validHashes.length === 0) continue;
    const uniqueHashes = new Set(validHashes.map(h => h.hash));
    if (uniqueHashes.size <= 1 && !uniqueHashes.has('too-large')) { identicalSkipped++; continue; }
    const category = classifyFile(filePath);

    // ─── PZ additive files: these are NOT real conflicts ───

    // Translation files: mods add their own keys to shared filenames.
    // Only flag as a real conflict when keys actually overlap.
    if (category === 'translate') {
      const comparison = compareTranslationKeys(mods);
      if (comparison.disjoint) {
        additiveSkipped++;
        pzAdditiveBreakdown.translate++;
        continue;
      }
      // Has overlapping keys — surface as a low-severity conflict with the keys attached.
      const conflict = {
        file: filePath,
        category,
        categoryLabel: CATEGORY_LABELS[category] || category,
        severity: 'low',
        identical: false,
        overlap: { kind: 'translation-keys', items: comparison.overlapping.slice(0, 50), total: comparison.overlapping.length },
        mods: mods.map(m => ({ workshopId: m.workshopId, modId: m.modId, modName: m.modName }))
      };
      conflicts.push(conflict);
      if (onConflictFound) onConflictFound(conflict);
      if (++processed % 20 === 0) await yieldTick();
      continue;
    }

    // sandbox-options.txt: lives at media root. PZ merges by named option blocks.
    // 34+ mods on a typical server share this filename — never a real conflict.
    if (category === 'sandbox-options') {
      pzAdditiveSkipped++;
      pzAdditiveBreakdown.sandbox++;
      continue;
    }

    // fileGuidTable.xml: PZ mod editor metadata. Auto-generated, not loaded at runtime.
    // Every mod built with the editor has one — never a real conflict.
    if (category === 'fileguidtable') {
      pzAdditiveSkipped++;
      pzAdditiveBreakdown.fileguidtable++;
      continue;
    }

    // PZ script files: parse for overlapping module.type.name definitions.
    // PZ loads ALL .txt from every mod's scripts/ and merges them.
    let scriptOverlap = null;
    if (category === 'scripts') {
      const comparison = compareScriptDefinitions(mods);
      if (comparison.disjoint) {
        pzAdditiveSkipped++;
        pzAdditiveBreakdown.scripts++;
        continue;
      }
      scriptOverlap = comparison.overlapping;
      // Has overlapping defs — this IS a real conflict
    }

    // Clothing XMLs: PZ merges all clothing definitions from all mods.
    // Only flag if clothing item IDs actually overlap.
    let clothingOverlap = null;
    if (category === 'clothing') {
      const comparison = compareClothingDefinitions(mods);
      if (comparison.disjoint) {
        pzAdditiveSkipped++;
        pzAdditiveBreakdown.clothing++;
        continue;
      }
      clothingOverlap = comparison.overlapping;
      // Has overlapping clothing IDs — real conflict
    }

    // Lua: not merged — last-loaded wins. Parse symbol names so the UI can show
    // exactly which functions/events/classes clash vs which are silently shadowed.
    let luaOverlap = null;
    if (category === 'lua-server' || category === 'lua-shared' || category === 'lua-client' || category === 'lua-other') {
      luaOverlap = compareLuaSymbols(mods); // null when files unparsable / no symbols
    }

    const conflict = {
      file: filePath,
      category,
      categoryLabel: CATEGORY_LABELS[category] || category,
      severity: SEVERITY_MAP[category] || 'low',
      identical: false,
      mods: mods.map(m => ({ workshopId: m.workshopId, modId: m.modId, modName: m.modName }))
    };
    if (scriptOverlap && scriptOverlap.length > 0) {
      conflict.overlap = { kind: 'script-defs', items: scriptOverlap.slice(0, 50), total: scriptOverlap.length };
    } else if (clothingOverlap && clothingOverlap.length > 0) {
      conflict.overlap = { kind: 'clothing-items', items: clothingOverlap.slice(0, 50), total: clothingOverlap.length };
    } else if (luaOverlap) {
      if (luaOverlap.overlapping.length > 0) {
        conflict.overlap = { kind: 'lua-symbols', items: luaOverlap.overlapping.slice(0, 50), total: luaOverlap.overlapping.length };
      } else {
        // Lua files at the same path with no overlapping named symbols — one fully
        // shadows the other but they don't fight for the same names. Demote severity.
        conflict.severity = 'medium';
        conflict.overlap = { kind: 'lua-shadow', items: [], total: 0 };
      }
    }
    conflicts.push(conflict);
    if (onConflictFound) onConflictFound(conflict);
    // Yield every 20 files to keep event loop responsive
    if (++processed % 20 === 0) await yieldTick();
  }
  return { conflicts, identicalSkipped, additiveSkipped, pzAdditiveSkipped, pzAdditiveBreakdown };
}

// Detect Lua symbol clashes across DIFFERENT files between mod IDs that ship
// inside the SAME workshop item. The per-file scanner above only catches
// collisions when two mods place a file at the same relative path. Many
// "variant bundles" (e.g. TombBodyTexNUDE / TombBodyTexDOLL, Backpacks+
// "Lite" vs "Full") use unique filenames but redefine the same Lua names,
// which would silently overwrite each other at runtime. This pass surfaces
// those so the existing same-workshop "File conflict — pick one" UI fires.
//
// Skips pairs that already produced a same-path conflict in the per-file
// pass (avoids duplicate UI rows). Only Lua categories are considered.
async function detectSameWorkshopLuaSymbolConflicts(fileIndex, existingConflicts, onConflictFound) {
  // Build set of (modId|modId) pairs already covered by the per-file pass.
  const coveredPairs = new Set();
  for (const c of existingConflicts) {
    const ids = c.mods.map(m => m.modId).sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        coveredPairs.add(`${ids[i]}|${ids[j]}`);
      }
    }
  }

  // Group lua files by workshopId → modId.
  // { wsId: { modId: [{relPath, absPath, modName}] } }
  const wsModFiles = {};
  for (const [relPath, mods] of Object.entries(fileIndex)) {
    const cat = classifyFile(relPath);
    if (cat !== 'lua-server' && cat !== 'lua-shared' && cat !== 'lua-client' && cat !== 'lua-other') continue;
    for (const m of mods) {
      if (!wsModFiles[m.workshopId]) wsModFiles[m.workshopId] = {};
      if (!wsModFiles[m.workshopId][m.modId]) wsModFiles[m.workshopId][m.modId] = [];
      wsModFiles[m.workshopId][m.modId].push({ relPath, absPath: m.absPath, modName: m.modName });
    }
  }

  const conflicts = [];
  let scanned = 0;
  for (const [wsId, modFilesMap] of Object.entries(wsModFiles)) {
    const modIds = Object.keys(modFilesMap);
    if (modIds.length < 2) continue;

    // Build per-modId symbol union with first-seen file per symbol (for display).
    // modId → Map<symbol, { relPath, modName }>
    const symsByMod = {};
    for (const modId of modIds) {
      const symMap = new Map();
      for (const f of modFilesMap[modId]) {
        const syms = extractLuaSymbols(f.absPath);
        if (!syms || syms.size === 0) continue;
        for (const s of syms) {
          if (!symMap.has(s)) symMap.set(s, { relPath: f.relPath, modName: f.modName });
        }
      }
      symsByMod[modId] = symMap;
    }

    // Pairwise overlap detection.
    for (let i = 0; i < modIds.length; i++) {
      for (let j = i + 1; j < modIds.length; j++) {
        const idA = modIds[i], idB = modIds[j];
        const pairKey = [idA, idB].sort().join('|');
        if (coveredPairs.has(pairKey)) continue;
        const symsA = symsByMod[idA];
        const symsB = symsByMod[idB];
        if (!symsA || !symsB || symsA.size === 0 || symsB.size === 0) continue;

        const overlap = [];
        for (const s of symsA.keys()) {
          if (symsB.has(s)) overlap.push(s);
        }
        if (overlap.length === 0) continue;

        const firstSym = overlap[0];
        const fileA = symsA.get(firstSym);
        const fileB = symsB.get(firstSym);
        const conflict = {
          // Synthetic file label that shows BOTH source files so the UI
          // makes the situation legible. groupIntoPairs treats this as one
          // "file" entry for the pair.
          file: fileA.relPath === fileB.relPath
            ? fileA.relPath
            : `${fileA.relPath} ↔ ${fileB.relPath}`,
          category: 'lua-cross-file',
          categoryLabel: CATEGORY_LABELS['lua-cross-file'],
          severity: 'high',
          identical: false,
          crossFile: true,
          overlap: { kind: 'lua-symbols', items: overlap.slice(0, 50), total: overlap.length },
          mods: [
            { workshopId: wsId, modId: idA, modName: fileA.modName },
            { workshopId: wsId, modId: idB, modName: fileB.modName },
          ],
        };
        conflicts.push(conflict);
        if (onConflictFound) onConflictFound(conflict);
        if (++scanned % 20 === 0) await yieldTick();
      }
    }
  }
  return conflicts;
}

// Group flat conflict list into mod pairs
function groupIntoPairs(conflicts) {
  const pairConflicts = {};
  for (const conflict of conflicts) {
    const modIds = conflict.mods.map(m => m.modId).sort();
    for (let i = 0; i < modIds.length; i++) {
      for (let j = i + 1; j < modIds.length; j++) {
        const pairKey = `${modIds[i]}|${modIds[j]}`;
        if (!pairConflicts[pairKey]) {
          pairConflicts[pairKey] = {
            modA: conflict.mods.find(m => m.modId === modIds[i]),
            modB: conflict.mods.find(m => m.modId === modIds[j]),
            files: [], highCount: 0, mediumCount: 0, lowCount: 0,
            aWins: 0, bWins: 0, thirdPartyWins: 0, unknownWins: 0,
          };
        }
        pairConflicts[pairKey].files.push({
          file: conflict.file, category: conflict.category,
          categoryLabel: conflict.categoryLabel, severity: conflict.severity,
          winner: conflict.winner || null,
          overlap: conflict.overlap || null,
        });
        pairConflicts[pairKey][`${conflict.severity}Count`]++;
        // Per-file winner tally for the pair card
        if (conflict.winner == null) pairConflicts[pairKey].unknownWins++;
        else if (conflict.winner.modId === modIds[i]) pairConflicts[pairKey].aWins++;
        else if (conflict.winner.modId === modIds[j]) pairConflicts[pairKey].bWins++;
        else pairConflicts[pairKey].thirdPartyWins++;
      }
    }
  }
  return Object.values(pairConflicts).sort((a, b) =>
    (b.highCount - a.highCount) || (b.mediumCount - a.mediumCount) || (b.files.length - a.files.length)
  );
}

// Annotate each conflict with the winning mod, based on the `Mods=` load order.
// PZ loads mods left-to-right; later entries override earlier ones, so the highest
// index in modLoadOrder wins. Conflicts where neither mod is in the list (rare,
// e.g., the multi-mod-id workshop case) get `winner: null`.
function annotateWinners(conflicts, modLoadOrder) {
  const order = new Map(modLoadOrder.map((id, i) => [id, i]));
  for (const c of conflicts) {
    let bestIdx = -1;
    let winner = null;
    for (const m of c.mods) {
      const idx = order.get(m.modId);
      if (idx == null) continue;
      if (idx > bestIdx) { bestIdx = idx; winner = m; }
    }
    c.winner = winner ? { modId: winner.modId, modName: winner.modName, workshopId: winner.workshopId } : null;
  }
}

// Detect cases where multiple workshop items declare the same internal mod id.
// PZ loads only one of them (whichever is listed first / found first), the others
// are silently ignored. Highly common cause of "my mod isn't working" issues.
function findIdCollisions(modInfoMap, modIdsFromIni) {
  const activeSet = new Set(modIdsFromIni);
  const byModId = new Map();
  for (const [wsId, details] of Object.entries(modInfoMap)) {
    for (const mod of details) {
      if (!byModId.has(mod.id)) byModId.set(mod.id, []);
      byModId.get(mod.id).push({ workshopId: wsId, modName: mod.name, active: activeSet.has(mod.id) });
    }
  }
  const collisions = [];
  for (const [modId, sources] of byModId.entries()) {
    // Distinct workshop IDs declaring the same mod id
    const distinctWs = [...new Map(sources.map(s => [s.workshopId, s])).values()];
    if (distinctWs.length > 1) {
      collisions.push({ modId, active: distinctWs.some(s => s.active), sources: distinctWs });
    }
  }
  return collisions;
}

// Compute missing dependencies, then try to resolve each to a workshop ID by scanning all downloaded folders
function findMissingDeps(modInfoMap, modIdsFromIni, serverPath) {
  const activeModSet = new Set(modIdsFromIni);
  const dependencies = {};
  for (const [wsId, details] of Object.entries(modInfoMap)) {
    for (const mod of details) {
      // Only check deps for mods actually active in the Mods= INI line
      if (mod.require?.length > 0 && activeModSet.has(mod.id)) {
        dependencies[mod.id] = { modId: mod.id, modName: mod.name, workshopId: wsId, requires: mod.require };
      }
    }
  }
  // Vanilla PZ modules — always available, never in WorkshopItems. Both B41 and B42
  // module names included (some mods reference lowercase variants).
  const builtInMods = new Set([
    'Base', 'base', 'Farming', 'Radio', 'Camping', 'Trapping', 'Fishing', 'Foraging', 'Erosion',
    // B42 additions
    'Animal', 'NPCs', 'Seasons', 'FireFighting', 'FeedingTrough', 'RainBarrel',
    'Vehicles', 'Zombies', 'XpSystem', 'HealthSystem', 'Professions', 'Climate',
  ]);
  const allModIds = new Set(builtInMods);
  for (const id of modIdsFromIni) allModIds.add(id);
  const missingDeps = [];
  for (const [modId, depInfo] of Object.entries(dependencies)) {
    for (const req of depInfo.requires) {
      if (!allModIds.has(req)) {
        missingDeps.push({ modId, modName: depInfo.modName, workshopId: depInfo.workshopId, missingDep: req });
      }
    }
  }

  // Resolve missing deps to workshop IDs by scanning ALL downloaded workshop folders on disk
  if (serverPath && missingDeps.length > 0) {
    const missingIds = new Set(missingDeps.map(d => d.missingDep));
    const resolved = new Map(); // modId → { workshopId, modName }
    const workshopPaths = [
      path.join(serverPath, 'steamapps', 'workshop', 'content', '108600'),
      path.join(serverPath, '..', 'steamapps', 'workshop', 'content', '108600'),
    ];
    for (const workshopBase of workshopPaths) {
      if (!fs.existsSync(workshopBase)) continue;
      try {
        for (const entry of fs.readdirSync(workshopBase, { withFileTypes: true })) {
          if (!entry.isDirectory() || resolved.size === missingIds.size) continue;
          try {
            const details = getModDetailsFromWorkshop(entry.name, serverPath);
            for (const mod of details) {
              if (missingIds.has(mod.id) && !resolved.has(mod.id)) {
                resolved.set(mod.id, { workshopId: entry.name, modName: mod.name });
              }
            }
          } catch (e) { log.debug(`Workshop folder unreadable ${entry.name}: ${e.message}`); }
        }
      } catch (e) { log.debug(`Workshop path inaccessible: ${e.message}`); }
      if (resolved.size === missingIds.size) break;
    }
    // Annotate missing deps with resolved workshop IDs
    for (const dep of missingDeps) {
      const match = resolved.get(dep.missingDep);
      if (match) {
        dep.resolvedWorkshopId = match.workshopId;
        dep.resolvedModName = match.modName;
      }
    }
  }

  return missingDeps;
}

// ─── Steam API: fetch workshop item dependencies (children) ─────────────────
// Uses GetPublishedFileDetails to get the "Required Items" for each workshop item,
// then checks which required Workshop IDs are missing from the configured list.
// Returns { deps: [...], warnings: [...] }
async function findSteamDeps(workshopIds) {
  const steamApiKey = await getSetting('steamApiKey');
  if (!steamApiKey || typeof steamApiKey !== 'string' || steamApiKey.length < 10) return { deps: [], warnings: ['Steam API key not configured — dependency check skipped. Set it in Settings to enable.'] };

  const configuredWsIds = new Set(workshopIds.map(String));
  const allDeps = [];
  const steamWarnings = [];
  let steamApiFailed = false;

  // Batch in groups of 50 (Steam API limit)
  for (let i = 0; i < workshopIds.length; i += 50) {
    const batch = workshopIds.slice(i, i + 50);
    const params = new URLSearchParams({ key: steamApiKey, 'includechildren': 'true' });
    batch.forEach((id, idx) => params.append(`publishedfileids[${idx}]`, String(id)));
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const response = await fetch(`https://api.steampowered.com/IPublishedFileService/GetDetails/v1/?${params}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) { steamApiFailed = true; continue; }
      const data = await response.json();
      const details = data.response?.publishedfiledetails || [];
      for (const item of details) {
        if (!item.publishedfileid || !item.children?.length) continue;
        const parentWsId = String(item.publishedfileid);
        const parentName = item.title || `Workshop ${parentWsId}`;
        for (const child of item.children) {
          // file_type 0 = required item dependency
          if (child.file_type !== 0) continue;
          const childWsId = String(child.publishedfileid);
          if (!configuredWsIds.has(childWsId)) {
            allDeps.push({
              parentWorkshopId: parentWsId,
              parentName,
              childWorkshopId: childWsId,
              childName: null, // resolved in next batch
              source: 'steam',
            });
          }
        }
      }
    } catch (e) {
      steamApiFailed = true;
      log.debug?.(`Steam deps batch failed (non-fatal): ${e.message}`);
    }
  }

  if (steamApiFailed) {
    steamWarnings.push('Steam Workshop API was unreachable — dependency check may be incomplete');
  }

  // Resolve child names in a single batch call
  const childIds = [...new Set(allDeps.map(d => d.childWorkshopId))];
  if (childIds.length > 0) {
    for (let i = 0; i < childIds.length; i += 50) {
      const batch = childIds.slice(i, i + 50);
      const params = new URLSearchParams({ key: steamApiKey });
      batch.forEach((id, idx) => params.append(`publishedfileids[${idx}]`, id));
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(`https://api.steampowered.com/IPublishedFileService/GetDetails/v1/?${params}`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!response.ok) continue;
        const data = await response.json();
        const details = data.response?.publishedfiledetails || [];
        const nameMap = new Map();
        for (const item of details) {
          if (item.publishedfileid && item.title) {
            nameMap.set(String(item.publishedfileid), item.title);
          }
        }
        for (const dep of allDeps) {
          if (!dep.childName && nameMap.has(dep.childWorkshopId)) {
            dep.childName = nameMap.get(dep.childWorkshopId);
          }
        }
      } catch (e) { log.debug(`Steam deps batch name lookup failed (non-fatal): ${e.message}`); }
    }
  }

  // Fill in fallback names
  for (const dep of allDeps) {
    if (!dep.childName) dep.childName = `Workshop Item #${dep.childWorkshopId}`;
  }

  // Deduplicate (same child can be required by multiple parents)
  const seen = new Set();
  const deps = allDeps.filter(d => {
    const key = `${d.parentWorkshopId}-${d.childWorkshopId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { deps, warnings: steamWarnings };
}

// ─── Cached scan result endpoint ─────────────────────────────────────────────
// Returns the last scan result without re-running the scan.
router.get('/conflicts/cached', async (req, res) => {
  if (!lastScanResult || (Date.now() - lastScanTimestamp > SCAN_CACHE_TTL_MS)) {
    return res.json(null);
  }
  // Check if config has changed since last scan
  try {
    const { workshopIds, modIdsFromIni } = await readIniModLists();
    const currentWsSnapshot = workshopIds.slice().sort().join(',');
    const currentModSnapshot = modIdsFromIni.slice().sort().join(',');
    const stale = currentWsSnapshot !== lastScanWorkshopSnapshot || currentModSnapshot !== lastScanModSnapshot;
    res.json({
      ...lastScanResult,
      stale,
      _workshopIdsSnapshot: lastScanWorkshopSnapshot ? lastScanWorkshopSnapshot.split(',') : [],
      _modIdsSnapshot: lastScanModSnapshot ? lastScanModSnapshot.split(',') : []
    });
  } catch (e) {
    log.debug(`Error checking scan staleness (marking stale): ${e.message}`);
    res.json({ ...lastScanResult, stale: true });
  }
});

// ─── Batch scan endpoint (for non-SSE clients) ──────────────────────────────
router.get('/conflicts', async (req, res) => {
  if (!acquireScanLock()) {
    return res.status(429).json({ error: 'A conflict scan is already running. Please wait.' });
  }
  const scanStart = Date.now();
  try {
    const serverPath = await getServerPath();
    if (!serverPath) return res.status(400).json({ error: 'Server install path not set — configure it in Settings' });
    const { workshopIds, modIdsFromIni } = await readIniModLists();
    if (workshopIds.length === 0) {
      return res.json({ totalConflicts: 0, identicalSkipped: 0, additiveSkipped: 0, pzAdditiveSkipped: 0, pzAdditiveBreakdown: { sandbox: 0, scripts: 0, clothing: 0, fileguidtable: 0, translate: 0 }, pairs: [], totalPairs: 0, modsScanned: 0, missingDeps: [], modLoadOrder: modIdsFromIni, warnings: [], scanDurationMs: Date.now() - scanStart });
    }
    const { fileIndex, modInfoMap, modsScanned, modsNotFound, modsSkippedInactive, warnings } = await buildFileIndex(workshopIds, serverPath, null, modIdsFromIni);
    const { conflicts, identicalSkipped, additiveSkipped, pzAdditiveSkipped, pzAdditiveBreakdown } = await detectConflicts(fileIndex);
    // Second pass: catch variant-bundle clashes (NUDE/DOLL/Tex etc.) where
    // two mod IDs in the same workshop redefine the same Lua names from
    // different filenames. These slip past the per-file pass.
    const crossFileConflicts = await detectSameWorkshopLuaSymbolConflicts(fileIndex, conflicts);
    if (crossFileConflicts.length > 0) conflicts.push(...crossFileConflicts);
    annotateWinners(conflicts, modIdsFromIni);
    const idCollisions = findIdCollisions(modInfoMap, modIdsFromIni);
    const severityOrder = { high: 0, medium: 1, low: 2 };
    conflicts.sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3) || a.file.localeCompare(b.file));
    const pairs = groupIntoPairs(conflicts);
    const missingDeps = findMissingDeps(modInfoMap, modIdsFromIni, serverPath);
    let steamDeps = [];
    try {
      const steamResult = await findSteamDeps(workshopIds);
      steamDeps = steamResult.deps;
      warnings.push(...steamResult.warnings);
    } catch (e) { log.debug(`Steam deps lookup failed during batch scan (non-fatal): ${e.message}`); }
    const result = { totalConflicts: conflicts.length, identicalSkipped, additiveSkipped, pzAdditiveSkipped, pzAdditiveBreakdown, pairs, totalPairs: pairs.length, modsScanned, modsNotFound, modsSkippedInactive, totalWorkshopIds: workshopIds.length, missingDeps, steamDeps, idCollisions, modLoadOrder: modIdsFromIni, warnings, scanDurationMs: Date.now() - scanStart };
    lastScanWorkshopSnapshot = workshopIds.slice().sort().join(',');
    lastScanModSnapshot = modIdsFromIni?.slice().sort().join(',') || null;
    lastScanResult = result;
    lastScanTimestamp = Date.now();
    res.json(result);
  } catch (error) {
    log.error(`Failed to scan mod conflicts: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  } finally {
    releaseScanLock();
  }
});

// ─── SSE streaming scan endpoint ────────────────────────────────────────────
// Streams progress events as each mod is scanned and conflicts are found.
// Auth handled via ?token= query param (SSE can't set custom headers).
router.get('/conflicts/stream', async (req, res) => {
  if (!acquireScanLock()) {
    return res.status(429).json({ error: 'A conflict scan is already running. Please wait.' });
  }
  const scanStart = Date.now();

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',   // disable nginx buffering if proxied
  });
  res.flushHeaders();

  const send = (event, data) => {
    if (!res.writable || aborted) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (e) { log.debug(`SSE write failed (stream closed): ${e.message}`); }
  };

  // Detect client disconnect
  let aborted = false;
  req.on('close', () => { aborted = true; });

  try {
    const serverPath = await getServerPath();
    if (!serverPath) { send('error', { error: 'Server install path not set — configure it in Settings' }); res.end(); return; }
    const { workshopIds, modIdsFromIni } = await readIniModLists();

    send('init', { totalWorkshopIds: workshopIds.length, modLoadOrder: modIdsFromIni });

    if (workshopIds.length === 0) {
      send('complete', { totalConflicts: 0, identicalSkipped: 0, additiveSkipped: 0, pzAdditiveSkipped: 0, pzAdditiveBreakdown: { sandbox: 0, scripts: 0, clothing: 0, fileguidtable: 0, translate: 0 }, pairs: [], totalPairs: 0, modsScanned: 0, totalWorkshopIds: 0, missingDeps: [], modLoadOrder: modIdsFromIni, warnings: [], scanDurationMs: Date.now() - scanStart });
      res.end();
      return;
    }

    // Phase 1: scan mods — emit progress per mod
    const { fileIndex, modInfoMap, modsScanned, modsNotFound, modsSkippedInactive, warnings } = await buildFileIndex(
      workshopIds,
      serverPath,
      (info) => {
        if (aborted) return;
        send('mod-scanned', {
          modId: info.modId,
          modName: info.modName,
          workshopId: info.workshopId,
          fileCount: info.fileCount,
          modsScanned: info.modsScanned,
          totalWorkshopIds: info.totalWorkshopIds,
          progress: Math.round(((info.wsIdx + 1) / info.totalWorkshopIds) * 60), // 0-60%
        });
      },
      modIdsFromIni
    );

    if (aborted) { res.end(); return; }
    send('phase', { phase: 'hashing', progress: 60 });

    // Phase 2: detect conflicts (hashing happens here)
    let conflictCount = 0;
    const { conflicts, identicalSkipped, additiveSkipped, pzAdditiveSkipped, pzAdditiveBreakdown } = await detectConflicts(fileIndex, (conflict) => {
      if (aborted) return;
      conflictCount++;
      // Stream each conflict as it's found (every 3rd to avoid flooding, or always for high severity)
      if (conflict.severity === 'high' || conflictCount <= 5 || conflictCount % 3 === 0) {
        send('conflict-found', {
          file: conflict.file,
          severity: conflict.severity,
          categoryLabel: conflict.categoryLabel,
          mods: conflict.mods.map(m => m.modName),
          conflictsSoFar: conflictCount,
        });
      }
    });

    if (aborted) { res.end(); return; }
    send('phase', { phase: 'grouping', progress: 85 });

    // Second pass: catch variant-bundle clashes within the same workshop
    // where mod IDs redefine the same Lua names from different filenames.
    const crossFileConflicts = await detectSameWorkshopLuaSymbolConflicts(fileIndex, conflicts, (conflict) => {
      if (aborted) return;
      conflictCount++;
      send('conflict-found', {
        file: conflict.file,
        severity: conflict.severity,
        categoryLabel: conflict.categoryLabel,
        mods: conflict.mods.map(m => m.modName),
        conflictsSoFar: conflictCount,
      });
    });
    if (crossFileConflicts.length > 0) conflicts.push(...crossFileConflicts);

    // Phase 3: group & sort
    annotateWinners(conflicts, modIdsFromIni);
    const idCollisions = findIdCollisions(modInfoMap, modIdsFromIni);
    const severityOrder = { high: 0, medium: 1, low: 2 };
    conflicts.sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3) || a.file.localeCompare(b.file));
    const pairs = groupIntoPairs(conflicts);
    const missingDeps = findMissingDeps(modInfoMap, modIdsFromIni, serverPath);

    // Phase 4: Steam API dependency check (parallel-safe, non-blocking)
    let steamDeps = [];
    try {
      if (!aborted) {
        send('phase', { phase: 'dependencies', progress: 90 });
        const steamResult = await findSteamDeps(workshopIds);
        steamDeps = steamResult.deps;
        warnings.push(...steamResult.warnings);
      }
    } catch (e) { log.debug(`Steam deps lookup failed during SSE scan (non-fatal): ${e.message}`); }

    const result = {
      totalConflicts: conflicts.length,
      identicalSkipped,
      additiveSkipped,
      pzAdditiveSkipped,
      pzAdditiveBreakdown,
      pairs,
      totalPairs: pairs.length,
      modsScanned,
      modsNotFound,
      modsSkippedInactive,
      totalWorkshopIds: workshopIds.length,
      missingDeps,
      steamDeps,
      idCollisions,
      modLoadOrder: modIdsFromIni,
      warnings,
      scanDurationMs: Date.now() - scanStart,
    };
    lastScanResult = result;
    lastScanTimestamp = Date.now();
    lastScanWorkshopSnapshot = workshopIds.slice().sort().join(',');
    lastScanModSnapshot = modIdsFromIni.slice().sort().join(',');
    send('complete', result);
    res.end();
  } catch (error) {
    log.error(`Streaming conflict scan failed: ${error.message}`);
    if (!aborted) {
      send('error', { error: sanitizeError(error.message) });
      res.end();
    }
  } finally {
    releaseScanLock();
  }
});

// ─── File diff endpoint ─────────────────────────────────────────────────────
// Compare two mods' versions of the same file.
// GET /api/mods/conflicts/diff?file=<relPath>&modA=<modId>&modB=<modId>
const DIFF_MAX_BYTES = 512 * 1024; // 512 KB max for diffing

router.get('/conflicts/diff', async (req, res) => {
  try {
    const { file, modA, modB } = req.query;
    if (!file || !modA || !modB) {
      return res.status(400).json({ error: 'Could not load file comparison — missing file or mod information' });
    }

    // Sanitize mod IDs — only allow safe characters (alphanumeric, hyphens, underscores, dots, spaces)
    const modAStr = String(modA);
    const modBStr = String(modB);
    if (!/^[\w .\-]{1,200}$/.test(modAStr) || !/^[\w .\-]{1,200}$/.test(modBStr)) {
      return res.status(400).json({ error: 'Could not identify one of the mods — try rescanning' });
    }

    // Validate the file path doesn't try path traversal
    const normalizedFile = String(file).replace(/\\/g, '/');
    if (normalizedFile.includes('..') || path.isAbsolute(normalizedFile) || normalizedFile.length > 500) {
      return res.status(400).json({ error: 'The file path looks invalid — try rescanning conflicts' });
    }

    const serverPath = await getServerPath();
    if (!serverPath) return res.status(400).json({ error: 'Server install path not set — configure it in Settings' });
    const { workshopIds } = await readIniModLists();

    // Find the absolute paths for this file in both mods
    let pathA = null, pathB = null;
    for (const wsId of workshopIds) {
      if (!/^\d{1,15}$/.test(wsId)) continue;
      const possiblePaths = getWorkshopPaths(wsId, serverPath);
      let workshopPath = null;
      for (const p of possiblePaths) { if (fs.existsSync(p)) { workshopPath = p; break; } }
      if (!workshopPath) continue;

      const modDetails = getModDetailsFromWorkshop(wsId, serverPath);
      const modsFolder = path.join(workshopPath, 'mods');
      const searchBase = fs.existsSync(modsFolder) ? modsFolder : workshopPath;
      let modEntries;
      try { modEntries = fs.readdirSync(searchBase, { withFileTypes: true }); } catch (e) { log.debug(`Could not read mod directory ${searchBase}: ${e.message}`); continue; }

      for (const modDir of modEntries) {
        if (!modDir.isDirectory()) continue;
        const matchingMod = modDetails.find(m => m.id === modDir.name || m.name === modDir.name);
        const modId = matchingMod?.id || modDir.name;
        const modDirPath = path.join(searchBase, modDir.name);

        // Collect media paths: direct media/ + B42 versioned subfolders (42/, 42.X/, common/)
        const mediaCandidates = [path.join(modDirPath, 'media')];
        if (!fs.existsSync(mediaCandidates[0])) {
          mediaCandidates.length = 0;
          try {
            const subDirs = fs.readdirSync(modDirPath, { withFileTypes: true });
            for (const sub of subDirs) {
              if (sub.isDirectory() && /^(42(\.\d+)?|common)$/i.test(sub.name)) {
                mediaCandidates.push(path.join(modDirPath, sub.name, 'media'));
              }
            }
          } catch (e) { /* skip unreadable */ }
        }

        for (const mediaDir of mediaCandidates) {
          const candidate = path.join(mediaDir, normalizedFile);
          const resolved = path.resolve(candidate);
          const mediaBase = path.resolve(mediaDir);
          if (!resolved.startsWith(mediaBase + path.sep) && resolved !== mediaBase) continue;
          if (modId === String(modA) && fs.existsSync(candidate)) pathA = candidate;
          if (modId === String(modB) && fs.existsSync(candidate)) pathB = candidate;
        }
      }
      if (pathA && pathB) break;
    }

    if (!pathA || !pathB) {
      return res.status(404).json({ error: 'Could not find both mod files on disk — they may have been removed or updated since the last scan' });
    }

    // Determine if files are text or binary
    const ext = path.extname(normalizedFile).toLowerCase();
    const textExts = new Set(['.lua', '.txt', '.xml', '.json', '.cfg', '.ini', '.csv', '.md', '.properties', '.script']);
    const imageExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tga']);
    const isText = textExts.has(ext);
    const isImage = imageExts.has(ext);

    if (isImage) {
      // For images, return base64 thumbnails
      const statA = fs.statSync(pathA);
      const statB = fs.statSync(pathB);
      const maxImg = 2 * 1024 * 1024; // 2 MB cap
      return res.json({
        type: 'image',
        ext,
        modA: { size: statA.size, base64: statA.size <= maxImg ? fs.readFileSync(pathA).toString('base64') : null },
        modB: { size: statB.size, base64: statB.size <= maxImg ? fs.readFileSync(pathB).toString('base64') : null },
      });
    }

    if (!isText) {
      // Binary/unknown — just return file sizes and hashes
      const statA = fs.statSync(pathA);
      const statB = fs.statSync(pathB);
      return res.json({
        type: 'binary',
        ext,
        modA: { size: statA.size, hash: hashFileSync(pathA) },
        modB: { size: statB.size, hash: hashFileSync(pathB) },
      });
    }

    // Text diff — simple LCS-based unified diff
    const statA = fs.statSync(pathA);
    const statB = fs.statSync(pathB);
    if (statA.size > DIFF_MAX_BYTES || statB.size > DIFF_MAX_BYTES) {
      return res.json({
        type: 'text-too-large',
        ext,
        modA: { size: statA.size, hash: hashFileSync(pathA) },
        modB: { size: statB.size, hash: hashFileSync(pathB) },
      });
    }

    const contentA = fs.readFileSync(pathA, 'utf-8');
    const contentB = fs.readFileSync(pathB, 'utf-8');
    const linesA = contentA.split('\n');
    const linesB = contentB.split('\n');

    // Myers-like diff: compute edit script between linesA and linesB
    const hunks = computeUnifiedDiff(linesA, linesB, 3);

    res.json({
      type: 'text',
      ext,
      modA: { size: statA.size, lineCount: linesA.length },
      modB: { size: statB.size, lineCount: linesB.length },
      hunks,
      totalAdded: hunks.reduce((s, h) => s + h.lines.filter(l => l.type === 'add').length, 0),
      totalRemoved: hunks.reduce((s, h) => s + h.lines.filter(l => l.type === 'remove').length, 0),
    });
  } catch (error) {
    log.error(`Failed to diff files: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Compute unified diff hunks between two line arrays using LCS
function computeUnifiedDiff(linesA, linesB, contextLines = 3) {
  // Simple O(n*m) LCS for files up to ~10k lines; fast enough for mod files
  const n = linesA.length, m = linesB.length;

  // Guard: Uint16Array max value is 65535 — if either file exceeds that, fall back
  // Also guard against excessive memory: n*m cells
  if (n > 65535 || m > 65535 || n * m > 10_000_000) {
    // Too large for full LCS — return a simplified diff
    return [{
      startA: 1, startB: 1, countA: n, countB: m,
      lines: [
        ...linesA.slice(0, 50).map((l, i) => ({ type: 'remove', lineA: i + 1, text: l })),
        { type: 'context', text: `... (${n} lines in Mod A, ${m} lines in Mod B — file too large for inline diff)` },
        ...linesB.slice(0, 50).map((l, i) => ({ type: 'add', lineB: i + 1, text: l })),
      ]
    }];
  }

  // Build LCS table
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = linesA[i - 1] === linesB[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to get edit ops
  const ops = []; // { type: 'equal'|'remove'|'add', lineA?, lineB?, text }
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) {
      ops.push({ type: 'equal', lineA: i, lineB: j, text: linesA[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'add', lineB: j, text: linesB[j - 1] });
      j--;
    } else {
      ops.push({ type: 'remove', lineA: i, text: linesA[i - 1] });
      i--;
    }
  }
  ops.reverse();

  // Group into hunks with context
  const hunks = [];
  let currentHunk = null;
  let sinceLastChange = Infinity;

  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    const isChange = op.type !== 'equal';

    if (isChange) {
      if (!currentHunk || sinceLastChange > contextLines * 2) {
        // Start new hunk — include preceding context
        if (currentHunk) hunks.push(currentHunk);
        const ctxStart = Math.max(0, k - contextLines);
        currentHunk = {
          startA: ops[ctxStart]?.lineA || op.lineA || 1,
          startB: ops[ctxStart]?.lineB || op.lineB || 1,
          lines: [],
        };
        // Add context lines before this change
        for (let c = ctxStart; c < k; c++) {
          if (ops[c].type === 'equal') {
            currentHunk.lines.push({ type: 'context', lineA: ops[c].lineA, lineB: ops[c].lineB, text: ops[c].text });
          }
        }
      }
      currentHunk.lines.push(op);
      sinceLastChange = 0;
    } else {
      sinceLastChange++;
      if (currentHunk && sinceLastChange <= contextLines) {
        currentHunk.lines.push({ type: 'context', lineA: op.lineA, lineB: op.lineB, text: op.text });
      }
    }
  }
  if (currentHunk) hunks.push(currentHunk);

  // Add counts to each hunk
  for (const hunk of hunks) {
    hunk.countA = hunk.lines.filter(l => l.type !== 'add').length;
    hunk.countB = hunk.lines.filter(l => l.type !== 'remove').length;
  }

  return hunks;
}

// ─── Disk-only mods ─────────────────────────────────────────────────────────
// Returns workshop IDs that exist on disk (downloaded into the Steam workshop
// content folder) but are NOT in the server's INI WorkshopItems= list.
// These are "installed but disabled" mods — the user has the files, but the
// server isn't loading them. The UI shows these as greyed-out rows behind a
// "Show disabled" toggle, with a quick Enable action.
router.get('/disk-only', async (req, res) => {
  try {
    const modChecker = req.app.get('modChecker');
    if (!modChecker || !modChecker.workshopAcfPath) {
      return res.json({ mods: [], reason: 'workshop folder not configured' });
    }

    // Read INI to know what's currently enabled.
    const serverConfigPath = await getServerConfigPath();
    const serverName = await getServerName();
    const inIni = new Set();
    if (serverConfigPath && serverName) {
      const sanitized = path.basename(serverName);
      if (sanitized === serverName && !serverName.includes('..')) {
        const iniPath = path.join(serverConfigPath, `${sanitized}.ini`);
        if (fs.existsSync(iniPath)) {
          const content = readTextFile(iniPath);
          const m = content.match(/^WorkshopItems=(.*)$/m);
          for (const id of (m?.[1]?.split(';').filter(Boolean) || [])) inIni.add(id);
        }
      }
    }

    // Enumerate the steamapps/workshop/content/108600 folder for the active server.
    const workshopDir = path.dirname(modChecker.workshopAcfPath);
    const contentDir = path.join(workshopDir, 'content', '108600');
    if (!fs.existsSync(contentDir)) {
      return res.json({ mods: [], reason: 'no workshop content folder' });
    }

    let entries = [];
    try {
      entries = fs.readdirSync(contentDir, { withFileTypes: true });
    } catch (e) {
      log.warn(`disk-only: failed to read ${contentDir}: ${e.message}`);
      return res.json({ mods: [], reason: 'cannot read workshop folder' });
    }

    const mods = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const wsId = entry.name;
      if (!/^\d{1,15}$/.test(wsId)) continue;
      if (inIni.has(wsId)) continue; // already enabled in INI
      const name = modChecker.resolveModNameFromDisk(wsId) || `Workshop Mod ${wsId}`;
      mods.push({ workshop_id: wsId, name });
    }

    res.json({ mods });
  } catch (error) {
    log.error(`Failed to list disk-only mods: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Enable a disk-only mod: append its workshop ID to the INI WorkshopItems=
// list (and best-effort the corresponding mod IDs to Mods=) so the server
// loads it on next start. This is the inverse of the existing batch-remove.
router.post('/enable-disk-mod', async (req, res) => {
  try {
    const { workshopId } = req.body || {};
    const wsId = String(workshopId || '');
    if (!/^\d{1,15}$/.test(wsId)) {
      return res.status(400).json({ error: 'Invalid workshop ID' });
    }

    const serverConfigPath = await getServerConfigPath();
    const serverName = await getServerName();
    const serverPath = await getServerPath();
    if (!serverConfigPath || !serverName) {
      return res.status(400).json({ error: 'Server config path not set' });
    }
    const sanitized = path.basename(serverName);
    if (sanitized !== serverName || serverName.includes('..')) {
      return res.status(400).json({ error: 'Invalid server name' });
    }
    const iniPath = path.join(serverConfigPath, `${sanitized}.ini`);
    if (!fs.existsSync(iniPath)) {
      return res.status(404).json({ error: 'Server INI not found' });
    }

    // Resolve mod folder IDs (Mods= entries) from the workshop folder so the
    // server can actually load it. A workshop item can ship multiple mods.
    const modIdsToAdd = serverPath ? findAllModIdsFromWorkshop(wsId, serverPath) : [];

    await withIniLock(iniPath, () => {
      let content = readTextFile(iniPath);

      // WorkshopItems
      const wsMatch = content.match(/^WorkshopItems=(.*)$/m);
      const wsList = wsMatch?.[1]?.split(';').filter(Boolean) || [];
      if (!wsList.includes(wsId)) wsList.push(wsId);
      const wsLine = `WorkshopItems=${sanitizeIniList(wsList)}`;
      content = wsMatch ? content.replace(/^WorkshopItems=.*/m, wsLine) : (content.trimEnd() + `\n${wsLine}\n`);

      // Mods
      const modsMatch = content.match(/^Mods=(.*)$/m);
      const modsList = modsMatch?.[1]?.split(';').filter(Boolean) || [];
      for (const mid of modIdsToAdd) {
        if (!modsList.includes(mid)) modsList.push(mid);
      }
      const modsLine = `Mods=${sanitizeIniList(modsList)}`;
      content = modsMatch ? content.replace(/^Mods=.*/m, modsLine) : (content.trimEnd() + `\n${modsLine}\n`);

      fs.writeFileSync(iniPath, content, 'utf-8');
    });

    // Lift any prior ignore-list entry so auto-track picks it up.
    try { await removeIgnoredMod(wsId); } catch { /* best-effort */ }

    log.info(`Enabled disk-only mod ${wsId} (added ${modIdsToAdd.length} mod IDs)`);
    res.json({ success: true, workshopId: wsId, modIdsAdded: modIdsToAdd.length });
  } catch (error) {
    log.error(`Failed to enable disk-only mod: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

export default router;
