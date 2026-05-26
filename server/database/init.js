import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { getDataPaths } from '../utils/paths.js';
import { createLogger } from '../utils/logger.js';
const log = createLogger('DB');

// ============================================
// Database Configuration
// ============================================

const RETENTION = {
  command_history: 500,
  player_logs: 1000,
  server_events: 500,
  schedule_history: 500,
  performance_history: 5760,   // 24h at 15-sec intervals
  player_sessions: 50,         // per player
  bridge_logs: 500,
};

const WRITE_DEBOUNCE_MS = 500;          // Coalesce rapid writes
const BACKUP_INTERVAL_MS = 6 * 3600000; // Auto-backup every 6 hours
const MAX_BACKUPS = 5;

// ============================================
// Paths
// ============================================

const paths = getDataPaths();
const dataDir = paths.dataDir;
const dbPath = paths.dbPath;
const backupDir = path.join(dataDir, 'backups');

// Ensure directories exist with restrictive perms (POSIX). Mode is ignored on Windows.
// 0o700 — these dirs hold db.json (RCON password + JWT secret) and rotating backups.
for (const dir of [dataDir, backupDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch (_) { /* best-effort: Windows / network shares */ }
}

// ============================================
// Default Schema
// ============================================

const defaultData = {
  command_history: [],
  scheduled_tasks: [],
  schedule_history: [],
  player_logs: [],
  server_events: [],
  tracked_mods: [],
  ignored_mods: [],
  ignored_mod_pairs: [],
  servers: [],
  player_notes: [],
  player_stats: [],
  mod_presets: [],
  steamid_bans: [],
  performance_history: [],
  bridge_logs: [],
  discord_webhooks: [],
  users: [],
  settings: {},
  _schemaVersion: 1
};

// ============================================
// Schema Migrations
// ============================================

const CURRENT_SCHEMA_VERSION = 1;

/**
 * Run any pending schema migrations.
 * Add new migrations as sequential `if (version < N)` blocks.
 * Each migration must be idempotent — safe to re-run if the write after
 * bumping the version failed.
 */
function runMigrations(data) {
  const version = data._schemaVersion || 0;
  if (version >= CURRENT_SCHEMA_VERSION) return data;

  log.info(`Running DB migrations: v${version} → v${CURRENT_SCHEMA_VERSION}`);

  // Migration 1: stamp initial schema version (no data changes needed)
  // Future migrations:
  // if (version < 2) { /* rename fields, restructure collections, etc. */ }

  data._schemaVersion = CURRENT_SCHEMA_VERSION;
  log.info(`DB migrated to schema v${CURRENT_SCHEMA_VERSION}`);
  return data;
}

// ============================================
// Write Queue (debounced, crash-safe)
// ============================================

let db = null;
let _writeTimer = null;
let _writePromise = null;
let _dirty = false;
let _writeRetries = 0;
const MAX_WRITE_RETRIES = 5;
// Exponential backoff between failed flushes: 1s, 2s, 4s, 8s, 16s (capped).
const WRITE_BACKOFF_BASE_MS = 1000;
const WRITE_BACKOFF_MAX_MS = 16_000;
// Circuit breaker: once tripped, refuse to schedule further writes for a cooldown.
let _writeCircuitOpenUntil = 0;
const CIRCUIT_OPEN_MS = 60_000;
let _backupTimer = null;
let _shutdownRegistered = false;

/**
 * Mark the database as dirty and schedule a debounced write.
 * Multiple rapid mutations coalesce into a single disk write.
 */
function scheduleWrite() {
  _dirty = true;

  // Circuit breaker: if recent writes have been failing hard, defer.
  if (Date.now() < _writeCircuitOpenUntil) return;

  // If there's already a pending timer, let it handle the write
  if (_writeTimer) return;

  // Apply exponential backoff if we're currently retrying after failures.
  const delay = _writeRetries > 0
    ? Math.min(WRITE_BACKOFF_BASE_MS * Math.pow(2, _writeRetries - 1), WRITE_BACKOFF_MAX_MS)
    : WRITE_DEBOUNCE_MS;

  _writeTimer = setTimeout(async () => {
    _writeTimer = null;
    await flushWrites();
  }, delay);
}

/**
 * Immediately flush all pending writes to disk.
 * Safe to call multiple times — deduplicates concurrent flushes.
 */
export async function flushWrites() {
  if (!_dirty || !db) return;
  _dirty = false;

  // If a write is already in progress, chain after it
  if (_writePromise) {
    try { await _writePromise; } catch { /* swallow */ }
  }

  _writePromise = (async () => {
    try {
      // Atomic write: write to temp file first, then rename
      // This prevents corruption on NFS/SMB mounts or if process is killed mid-write
      // mode 0o600 — db.json contains plaintext RCON password & JWT secret.
      // We chmod the tmp file BEFORE rename because writeFileSync's `mode` option
      // is ignored when the file already exists (e.g. orphaned tmp from prior crash).
      const tmpPath = dbPath + '.tmp';
      const data = JSON.stringify(db.data, null, 2);
      fs.writeFileSync(tmpPath, data, { encoding: 'utf-8', mode: 0o600 });
      try { fs.chmodSync(tmpPath, 0o600); } catch (_) { /* best-effort: Windows */ }
      fs.renameSync(tmpPath, dbPath);
      _writeRetries = 0; // Reset on success
      log.debug(`DB flushed (${Math.round(data.length / 1024)}KB)`);
    } catch (err) {
      _writeRetries++;
      if (_writeRetries >= MAX_WRITE_RETRIES) {
        log.error(`DB write failed ${_writeRetries} times, opening circuit breaker for ${CIRCUIT_OPEN_MS / 1000}s: ${err.message}`);
        // Open the circuit — stop scheduling writes for a cooldown so we don't pin the event loop.
        _writeCircuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
        _writeRetries = 0;
        _dirty = true; // Keep dirty; next scheduleWrite after cooldown will retry.
      } else {
        log.error(`Write error (attempt ${_writeRetries}/${MAX_WRITE_RETRIES}): ${err.message}`);
        _dirty = true; // Re-mark dirty so next scheduleWrite retries (with backoff)
        // Proactively schedule a retry so we don't depend on external scheduleWrite calls.
        if (!_writeTimer) {
          const delay = Math.min(WRITE_BACKOFF_BASE_MS * Math.pow(2, _writeRetries - 1), WRITE_BACKOFF_MAX_MS);
          _writeTimer = setTimeout(async () => {
            _writeTimer = null;
            await flushWrites();
          }, delay);
        }
      }
    }
  })();

  await _writePromise;
  _writePromise = null;
}

// ============================================
// Backup System
// ============================================

function createBackup(label = '') {
  try {
    if (!fs.existsSync(dbPath)) return null;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const suffix = label ? `-${label}` : '';
    const backupFile = path.join(backupDir, `db-${timestamp}${suffix}.json`);

    fs.copyFileSync(dbPath, backupFile);
    // Backups contain the same secrets as db.json — tighten perms.
    try { fs.chmodSync(backupFile, 0o600); } catch (_) { /* best-effort: Windows */ }
    pruneBackups();
    return backupFile;
  } catch (err) {
    log.error(`Backup failed: ${err.message}`);
    return null;
  }
}

function pruneBackups() {
  try {
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('db-') && f.endsWith('.json'))
      .sort()
      .reverse();

    for (const file of files.slice(MAX_BACKUPS)) {
      fs.unlinkSync(path.join(backupDir, file));
    }
  } catch (err) {
    log.debug(`Backup pruning error: ${err.message}`);
  }
}

function getLatestBackup() {
  try {
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('db-') && f.endsWith('.json'))
      .sort()
      .reverse();
    return files.length > 0 ? path.join(backupDir, files[0]) : null;
  } catch {
    log.debug(`No backups found to list`);
    return null;
  }
}

function startBackupSchedule() {
  if (_backupTimer) clearInterval(_backupTimer);
  _backupTimer = setInterval(() => {
    createBackup('auto');
  }, BACKUP_INTERVAL_MS);
  if (_backupTimer.unref) _backupTimer.unref();
}

// ============================================
// Graceful Shutdown
// ============================================

function registerShutdownHandlers() {
  if (_shutdownRegistered) return;
  _shutdownRegistered = true;

  const shutdown = async (signal) => {
    log.info(`${signal} received — flushing writes...`);
    if (_writeTimer) { clearTimeout(_writeTimer); _writeTimer = null; }
    if (_backupTimer) { clearInterval(_backupTimer); _backupTimer = null; }
    await flushWrites();
    createBackup('shutdown');
  };

  // Only flush writes — do NOT call process.exit() here.
  // The main index.js gracefulShutdown handler manages the exit sequence.
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('beforeExit', () => shutdown('beforeExit'));
}

// ============================================
// Startup & Initialization
// ============================================

/**
 * Validate and repair the database structure.
 * Ensures all collections exist and have the correct type.
 */
function validateData(data) {
  const repaired = { ...defaultData };

  for (const [key, defaultValue] of Object.entries(defaultData)) {
    if (Array.isArray(defaultValue)) {
      repaired[key] = Array.isArray(data?.[key]) ? data[key] : defaultValue;
    } else if (typeof defaultValue === 'object' && defaultValue !== null) {
      repaired[key] = (typeof data?.[key] === 'object' && !Array.isArray(data?.[key]) && data?.[key] !== null)
        ? data[key]
        : defaultValue;
    } else {
      repaired[key] = data?.[key] ?? defaultValue;
    }
  }

  return repaired;
}

/**
 * Apply retention policies to trim oversized collections.
 */
function compactData(data) {
  const trimArray = (arr, max) => {
    if (Array.isArray(arr) && arr.length > max) return arr.slice(0, max);
    return arr;
  };
  const trimArrayEnd = (arr, max) => {
    if (Array.isArray(arr) && arr.length > max) return arr.slice(-max);
    return arr;
  };

  data.command_history = trimArray(data.command_history, RETENTION.command_history);
  data.player_logs = trimArray(data.player_logs, RETENTION.player_logs);
  data.server_events = trimArray(data.server_events, RETENTION.server_events);
  data.schedule_history = trimArray(data.schedule_history, RETENTION.schedule_history);
  data.bridge_logs = trimArray(data.bridge_logs || [], RETENTION.bridge_logs);
  data.performance_history = trimArrayEnd(data.performance_history, RETENTION.performance_history);

  if (Array.isArray(data.player_stats)) {
    for (const stat of data.player_stats) {
      if (Array.isArray(stat.sessions) && stat.sessions.length > RETENTION.player_sessions) {
        stat.sessions = stat.sessions.slice(0, RETENTION.player_sessions);
      }
    }
  }

  return data;
}

export async function getDb() {
  if (!db) {
    // Tighten permissions on existing files left behind by prior installs that
    // wrote with the default umask (typically 0o644 on Linux). Idempotent.
    if (fs.existsSync(dbPath)) {
      try { fs.chmodSync(dbPath, 0o600); } catch (_) { /* best-effort: Windows */ }
    }
    try {
      for (const f of fs.readdirSync(backupDir)) {
        if (f.startsWith('db-') && f.endsWith('.json')) {
          try { fs.chmodSync(path.join(backupDir, f), 0o600); } catch (_) { /* ignore */ }
        }
      }
    } catch (_) { /* backupDir may not be readable yet on first run */ }

    const adapter = new JSONFile(dbPath);
    db = new Low(adapter, defaultData);

    let loadedCleanly = false;
    try {
      await db.read();
      loadedCleanly = true;
    } catch (err) {
      log.error(`Failed to read database: ${err.message}`);

      // Attempt recovery from backup. Do NOT snapshot the corrupt file first —
      // that would poison the backup ring (pruneBackups keeps newest 5 and
      // could evict the last known-good backup) AND make getLatestBackup
      // return the corrupt copy.
      const backup = getLatestBackup();
      if (backup) {
        log.warn(`Attempting recovery from ${path.basename(backup)}...`);
        try {
          // Preserve the corrupt file for forensics, OUTSIDE the rotation ring
          // so pruneBackups never touches it.
          try {
            const corruptPath = path.join(backupDir, `corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
            fs.copyFileSync(dbPath, corruptPath);
            try { fs.chmodSync(corruptPath, 0o600); } catch (_) { /* best-effort */ }
          } catch (_) { /* best-effort */ }

          fs.copyFileSync(backup, dbPath);
          await db.read();
          log.info('Database recovery successful!');
        } catch (recoverErr) {
          log.error(`Recovery failed: ${recoverErr.message} — starting fresh`);
          db.data = { ...defaultData };
        }
      } else {
        log.warn('No backup found, starting with fresh database.');
        db.data = { ...defaultData };
      }
    }

    // Validate structure and compact
    db.data = validateData(db.data);
    db.data = runMigrations(db.data);
    db.data = compactData(db.data);

    // Use the atomic tmp+rename path instead of lowdb's non-atomic
    // adapter.write(). A crash during the startup write would otherwise
    // corrupt the file we just recovered/migrated.
    _dirty = true;
    await flushWrites();

    // Snapshot only AFTER the DB loaded and wrote successfully. This prevents
    // a corrupt file from being captured as a "good" backup at boot.
    if (loadedCleanly && fs.existsSync(dbPath)) {
      createBackup('startup');
    }

    // Start periodic backups and register shutdown handlers
    startBackupSchedule();
    registerShutdownHandlers();

    const stats = getDatabaseStatsSync();
    log.info(`Loaded — ${stats.totalRecords} records, ${stats.fileSizeKB}KB, ${stats.backupCount} backups`);
  }
  return db;
}

export async function initDatabase() {
  await getDb();
  return db;
}

// ============================================
// Database Health & Stats
// ============================================

function getDatabaseStatsSync() {
  const data = db?.data || defaultData;
  let fileSize = 0;
  try { fileSize = fs.statSync(dbPath).size; } catch (e) {
    log.debug(`DB file stat failed (may not exist yet): ${e.message}`);
  }

  let backupCount = 0;
  try {
    backupCount = fs.readdirSync(backupDir).filter(f => f.startsWith('db-') && f.endsWith('.json')).length;
  } catch (e) {
    log.debug(`Backup dir read failed: ${e.message}`);
  }

  return {
    fileSizeBytes: fileSize,
    fileSizeKB: Math.round(fileSize / 1024 * 10) / 10,
    backupCount,
    collections: {
      command_history: data.command_history?.length ?? 0,
      scheduled_tasks: data.scheduled_tasks?.length ?? 0,
      schedule_history: data.schedule_history?.length ?? 0,
      player_logs: data.player_logs?.length ?? 0,
      server_events: data.server_events?.length ?? 0,
      tracked_mods: data.tracked_mods?.length ?? 0,
      servers: data.servers?.length ?? 0,
      player_notes: data.player_notes?.length ?? 0,
      player_stats: data.player_stats?.length ?? 0,
      mod_presets: data.mod_presets?.length ?? 0,
      performance_history: data.performance_history?.length ?? 0,
      bridge_logs: data.bridge_logs?.length ?? 0,
      discord_webhooks: data.discord_webhooks?.length ?? 0
    },
    totalRecords: Object.values(data).reduce((sum, v) => sum + (Array.isArray(v) ? v.length : 0), 0),
    settingsCount: Object.keys(data.settings || {}).length
  };
}

export async function getDatabaseStats() {
  await getDb();
  return getDatabaseStatsSync();
}

export async function createDatabaseBackup() {
  const file = createBackup('manual');
  return file ? { success: true, file: path.basename(file) } : { success: false };
}

export async function compactDatabase() {
  const db = await getDb();
  const before = getDatabaseStatsSync();
  db.data = compactData(db.data);
  scheduleWrite();
  await flushWrites();
  const after = getDatabaseStatsSync();
  return {
    before: before.totalRecords,
    after: after.totalRecords,
    removed: before.totalRecords - after.totalRecords
  };
}

// ============================================
// ID Generation
// ============================================

function generateId() {
  return randomUUID();
}

function generateNumericId(collection) {
  if (!Array.isArray(collection) || collection.length === 0) return 1;
  return collection.reduce((max, item) => Math.max(max, typeof item.id === 'number' ? item.id : 0), 0) + 1;
}

// ============================================
// Command History
// ============================================

export async function logCommand(command, response, success = true) {
  const db = await getDb();
  const truncatedResponse = response && response.length > 4096
    ? response.substring(0, 4096) + '... [truncated]'
    : response;

  const entry = {
    id: generateId(),
    command,
    response: truncatedResponse,
    success: success ? 1 : 0,
    executed_at: new Date().toISOString()
  };

  db.data.command_history.unshift(entry);
  if (db.data.command_history.length > RETENTION.command_history) {
    db.data.command_history = db.data.command_history.slice(0, RETENTION.command_history);
  }
  scheduleWrite();
  return entry;
}

export async function getCommandHistory(limit = 100) {
  const db = await getDb();
  return db.data.command_history.slice(0, limit);
}

// ============================================
// Bridge Logs (PanelBridge command history)
// ============================================

export async function logBridgeCommand(action, args, result, success = true, durationMs = 0) {
  const db = await getDb();
  if (!db.data.bridge_logs) db.data.bridge_logs = [];

  const truncatedResult = (() => {
    try {
      const s = JSON.stringify(result);
      return s && s.length > 4096 ? JSON.parse(s.substring(0, 4096) + '..."}}') : result;
    } catch { return { truncated: true }; }
  })();

  const entry = {
    id: generateId(),
    action,
    args: args || {},
    result: truncatedResult,
    success: success ? 1 : 0,
    duration_ms: durationMs,
    executed_at: new Date().toISOString()
  };

  db.data.bridge_logs.unshift(entry);
  if (db.data.bridge_logs.length > RETENTION.bridge_logs) {
    db.data.bridge_logs = db.data.bridge_logs.slice(0, RETENTION.bridge_logs);
  }
  scheduleWrite();
  return entry;
}

export async function getBridgeLogs(limit = 100) {
  const db = await getDb();
  if (!db.data.bridge_logs) return [];
  return db.data.bridge_logs.slice(0, limit);
}

// ============================================
// Scheduled Tasks
// ============================================

export async function getScheduledTasks() {
  const db = await getDb();
  return db.data.scheduled_tasks || [];
}

export async function createScheduledTask(name, cronExpression, command) {
  const db = await getDb();
  if (!Array.isArray(db.data.scheduled_tasks)) db.data.scheduled_tasks = [];

  const task = {
    id: generateNumericId(db.data.scheduled_tasks),
    name,
    cron_expression: cronExpression,
    command,
    enabled: 1,
    last_run: null,
    created_at: new Date().toISOString()
  };

  db.data.scheduled_tasks.push(task);
  scheduleWrite();
  return task;
}

export async function updateScheduledTask(id, name, cronExpression, command, enabled) {
  const db = await getDb();
  const index = db.data.scheduled_tasks.findIndex(t => t.id === id);
  if (index === -1) return null;

  const task = db.data.scheduled_tasks[index];
  if (name !== undefined) task.name = name;
  if (cronExpression !== undefined) task.cron_expression = cronExpression;
  if (command !== undefined) task.command = command;
  if (enabled !== undefined) task.enabled = enabled ? 1 : 0;
  scheduleWrite();
  return task;
}

export async function deleteScheduledTask(id) {
  const db = await getDb();
  const index = db.data.scheduled_tasks.findIndex(t => t.id === id);
  if (index === -1) return false;

  db.data.scheduled_tasks.splice(index, 1);
  scheduleWrite();
  return true;
}

export async function updateTaskLastRun(id) {
  const db = await getDb();
  const task = db.data.scheduled_tasks.find(t => t.id === id);
  if (task) {
    task.last_run = new Date().toISOString();
    scheduleWrite();
  }
}

// ============================================
// Schedule History
// ============================================

export async function logScheduleExecution(taskId, taskName, command, success, message = null, duration = null) {
  const db = await getDb();
  if (!db.data.schedule_history) db.data.schedule_history = [];

  const entry = {
    id: generateId(),
    task_id: taskId,
    task_name: taskName,
    command,
    success: success ? 1 : 0,
    message,
    duration,
    executed_at: new Date().toISOString()
  };

  db.data.schedule_history.unshift(entry);
  if (db.data.schedule_history.length > RETENTION.schedule_history) {
    db.data.schedule_history = db.data.schedule_history.slice(0, RETENTION.schedule_history);
  }
  scheduleWrite();
  return entry;
}

export async function getScheduleHistory(limit = 100, taskId = null) {
  const db = await getDb();
  if (!db.data.schedule_history) return [];

  let history = db.data.schedule_history;
  if (taskId !== null) {
    history = history.filter(h => h.task_id === taskId);
  }
  return history.slice(0, limit);
}

export async function clearScheduleHistory() {
  const db = await getDb();
  db.data.schedule_history = [];
  scheduleWrite();
}

// ============================================
// Player Logs
// ============================================

export async function logPlayerAction(playerName, action, details = null) {
  const db = await getDb();
  const entry = {
    id: generateId(),
    player_name: playerName,
    action,
    details,
    logged_at: new Date().toISOString()
  };

  db.data.player_logs.unshift(entry);
  if (db.data.player_logs.length > RETENTION.player_logs) {
    db.data.player_logs = db.data.player_logs.slice(0, RETENTION.player_logs);
  }
  scheduleWrite();
  return entry;
}

export async function getPlayerLogs(playerName = null, limit = 100) {
  const db = await getDb();
  let logs = db.data.player_logs;
  if (playerName) {
    logs = logs.filter(l => l.player_name === playerName);
  }
  return logs.slice(0, limit);
}

// ============================================
// Server Events
// ============================================

export async function logServerEvent(eventType, message = null) {
  const db = await getDb();
  const entry = {
    id: generateId(),
    event_type: eventType,
    message,
    created_at: new Date().toISOString()
  };

  db.data.server_events.unshift(entry);
  if (db.data.server_events.length > RETENTION.server_events) {
    db.data.server_events = db.data.server_events.slice(0, RETENTION.server_events);
  }
  scheduleWrite();
  return entry;
}

// ============================================
// Tracked Mods (per-server scoped)
// ============================================

/** Get the active server's ID for scoping tracked mods */
async function getActiveServerId() {
  const db = await getDb();
  const active = db.data.servers.find(s => s.isActive) || db.data.servers[0];
  return active ? String(active.id) : null;
}

export async function getTrackedMods() {
  const db = await getDb();
  const serverId = await getActiveServerId();
  if (!serverId) return db.data.tracked_mods; // no servers yet → return all (legacy)
  return db.data.tracked_mods.filter(m => m.server_id === serverId);
}

export async function addTrackedMod(workshopId, name = null) {
  const db = await getDb();
  const serverId = await getActiveServerId();
  // Duplicate check scoped to active server
  const existing = db.data.tracked_mods.find(m =>
    m.workshop_id === workshopId && (m.server_id === serverId || !m.server_id)
  );
  if (existing) {
    existing.name = name || existing.name;
    if (!existing.server_id && serverId) existing.server_id = serverId; // migrate legacy
    scheduleWrite();
    return existing;
  }

  const mod = {
    id: generateId(),
    workshop_id: workshopId,
    name,
    server_id: serverId,
    last_updated: null,
    last_checked: null,
    update_available: 0,
    preview_url: null,
    created_at: new Date().toISOString()
  };
  db.data.tracked_mods.push(mod);
  scheduleWrite();
  return mod;
}

export async function setModPreviewUrl(workshopId, previewUrl) {
  const db = await getDb();
  const serverId = await getActiveServerId();
  const mod = db.data.tracked_mods.find(m =>
    m.workshop_id === workshopId && (m.server_id === serverId || !m.server_id)
  );
  if (mod && mod.preview_url !== previewUrl) {
    mod.preview_url = previewUrl || null;
    scheduleWrite();
  }
}

export async function updateModTimestamp(workshopId, lastUpdated) {
  const db = await getDb();
  const serverId = await getActiveServerId();
  const mod = db.data.tracked_mods.find(m =>
    m.workshop_id === workshopId && (m.server_id === serverId || !m.server_id)
  );
  if (mod) {
    mod.last_updated = lastUpdated;
    mod.last_checked = new Date().toISOString();
    if (!mod.server_id && serverId) mod.server_id = serverId; // migrate legacy
    scheduleWrite();
  }
}

export async function setModUpdateAvailable(workshopId, available) {
  const db = await getDb();
  const serverId = await getActiveServerId();
  const mod = db.data.tracked_mods.find(m =>
    m.workshop_id === workshopId && (m.server_id === serverId || !m.server_id)
  );
  if (mod) {
    mod.update_available = available ? 1 : 0;
    if (!mod.server_id && serverId) mod.server_id = serverId; // migrate legacy
    scheduleWrite();
  }
}

/**
 * Batch-mark mods as just-checked.
 * - Sets `last_checked = now()` for every workshop_id in `checkedIds`.
 * - Sets `update_available` from the `updatesById` map (workshopId -> 0|1).
 *   Mods present in `checkedIds` but not in `updatesById` are cleared (0).
 * - Mods not in `checkedIds` are left untouched (e.g. Steam API failures).
 */
export async function markModsChecked(checkedIds, updatesById = new Map()) {
  if (!checkedIds || checkedIds.size === 0) return;
  const db = await getDb();
  const serverId = await getActiveServerId();
  const now = new Date().toISOString();
  let touched = 0;
  for (const mod of db.data.tracked_mods) {
    if (mod.server_id !== serverId && mod.server_id) continue;
    if (!checkedIds.has(mod.workshop_id)) continue;
    mod.last_checked = now;
    mod.update_available = updatesById.get(mod.workshop_id) ? 1 : 0;
    if (!mod.server_id && serverId) mod.server_id = serverId; // migrate legacy
    touched++;
  }
  if (touched > 0) scheduleWrite();
}

export async function removeTrackedMod(workshopId) {
  const db = await getDb();
  const serverId = await getActiveServerId();
  const index = db.data.tracked_mods.findIndex(m =>
    m.workshop_id === workshopId && (m.server_id === serverId || !m.server_id)
  );
  if (index === -1) return false;

  db.data.tracked_mods.splice(index, 1);
  scheduleWrite();
  return true;
}

export async function clearModUpdates() {
  const db = await getDb();
  const serverId = await getActiveServerId();
  db.data.tracked_mods.forEach(m => {
    if (m.server_id === serverId || !m.server_id) {
      m.update_available = 0;
    }
  });
  scheduleWrite();
}

// ============================================
// Ignored Mods (prevent auto-re-tracking)
// ============================================

export async function getIgnoredMods() {
  const db = await getDb();
  if (!db.data.ignored_mods) db.data.ignored_mods = [];
  const serverId = await getActiveServerId();
  if (!serverId) return db.data.ignored_mods;
  return db.data.ignored_mods.filter(m => m.server_id === serverId || !m.server_id);
}

export async function addIgnoredMod(workshopId, name = null) {
  const db = await getDb();
  if (!db.data.ignored_mods) db.data.ignored_mods = [];
  const serverId = await getActiveServerId();
  const existing = db.data.ignored_mods.find(m =>
    m.workshop_id === workshopId && (m.server_id === serverId || !m.server_id)
  );
  if (existing) return existing;
  const entry = {
    workshop_id: workshopId,
    name,
    server_id: serverId,
    ignored_at: new Date().toISOString()
  };
  db.data.ignored_mods.push(entry);
  scheduleWrite();
  return entry;
}

export async function removeIgnoredMod(workshopId) {
  const db = await getDb();
  if (!db.data.ignored_mods) db.data.ignored_mods = [];
  const serverId = await getActiveServerId();
  const index = db.data.ignored_mods.findIndex(m =>
    m.workshop_id === workshopId && (m.server_id === serverId || !m.server_id)
  );
  if (index === -1) return false;
  db.data.ignored_mods.splice(index, 1);
  scheduleWrite();
  return true;
}

export async function clearAllIgnoredMods() {
  const db = await getDb();
  if (!db.data.ignored_mods) db.data.ignored_mods = [];
  const serverId = await getActiveServerId();
  const before = db.data.ignored_mods.length;
  db.data.ignored_mods = db.data.ignored_mods.filter(m =>
    m.server_id && m.server_id !== serverId
  );
  const removed = before - db.data.ignored_mods.length;
  if (removed > 0) scheduleWrite();
  return removed;
}

export async function isModIgnored(workshopId) {
  const db = await getDb();
  if (!db.data.ignored_mods) return false;
  const serverId = await getActiveServerId();
  return db.data.ignored_mods.some(m =>
    m.workshop_id === workshopId && (m.server_id === serverId || !m.server_id)
  );
}

// ============================================
// Ignored Mod Conflict Pairs (false-positive dismissals on the
// Advanced tab's variant detector — e.g. a shared library + dependant
// being mis-flagged as two variants of the same mod).
// ============================================

function _normalizePair(modIdA, modIdB) {
  const a = String(modIdA || '').trim();
  const b = String(modIdB || '').trim();
  if (!a || !b || a === b) return null;
  return a < b ? [a, b] : [b, a];
}

export async function getIgnoredModPairs() {
  const db = await getDb();
  if (!db.data.ignored_mod_pairs) db.data.ignored_mod_pairs = [];
  const serverId = await getActiveServerId();
  if (!serverId) return db.data.ignored_mod_pairs;
  return db.data.ignored_mod_pairs.filter(p => p.server_id === serverId || !p.server_id);
}

export async function addIgnoredModPair(modIdA, modIdB, reason = null) {
  const pair = _normalizePair(modIdA, modIdB);
  if (!pair) return null;
  const db = await getDb();
  if (!db.data.ignored_mod_pairs) db.data.ignored_mod_pairs = [];
  const serverId = await getActiveServerId();
  const existing = db.data.ignored_mod_pairs.find(p =>
    p.mod_a === pair[0] && p.mod_b === pair[1] && (p.server_id === serverId || !p.server_id)
  );
  if (existing) return existing;
  const entry = {
    mod_a: pair[0],
    mod_b: pair[1],
    reason: reason || null,
    server_id: serverId,
    ignored_at: new Date().toISOString()
  };
  db.data.ignored_mod_pairs.push(entry);
  scheduleWrite();
  return entry;
}

export async function removeIgnoredModPair(modIdA, modIdB) {
  const pair = _normalizePair(modIdA, modIdB);
  if (!pair) return false;
  const db = await getDb();
  if (!db.data.ignored_mod_pairs) db.data.ignored_mod_pairs = [];
  const serverId = await getActiveServerId();
  const before = db.data.ignored_mod_pairs.length;
  db.data.ignored_mod_pairs = db.data.ignored_mod_pairs.filter(p =>
    !(p.mod_a === pair[0] && p.mod_b === pair[1] && (p.server_id === serverId || !p.server_id))
  );
  const removed = before - db.data.ignored_mod_pairs.length;
  if (removed > 0) scheduleWrite();
  return removed > 0;
}

// ============================================
// Settings
// ============================================

export async function getSetting(key) {
  const db = await getDb();
  return db.data.settings[key] ?? null;
}

export async function setSetting(key, value) {
  const db = await getDb();
  db.data.settings[key] = value;
  scheduleWrite();
}

export async function getAllSettings() {
  const db = await getDb();
  return db.data.settings;
}

// ============================================
// Server Configurations (Multi-server)
// ============================================

function normalizeMemoryGb(value, fallback) {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed <= 0) return fallback;
  if (parsed > 2048) {
    return Math.max(1, Math.round(parsed / 1024));
  }
  return parsed;
}

function normalizeServerMemory(server) {
  if (!server) return server;
  return {
    ...server,
    minMemory: normalizeMemoryGb(server.minMemory, 4),
    maxMemory: normalizeMemoryGb(server.maxMemory, 8)
  };
}

export async function getServers() {
  const db = await getDb();
  return (db.data.servers || []).map(normalizeServerMemory);
}

export async function getServer(id) {
  const db = await getDb();
  return normalizeServerMemory(db.data.servers.find(s => String(s.id) === String(id)) || null);
}

export async function getActiveServer() {
  const db = await getDb();
  return normalizeServerMemory(db.data.servers.find(s => s.isActive) || db.data.servers[0] || null);
}

export async function createServer(serverConfig) {
  const db = await getDb();
  if (!db.data.servers) db.data.servers = [];

  const isFirst = db.data.servers.length === 0;

  const server = {
    id: generateId(),
    name: serverConfig.name || serverConfig.serverName,
    serverName: serverConfig.serverName,
    installPath: serverConfig.installPath || '',
    zomboidDataPath: serverConfig.zomboidDataPath || null,
    serverConfigPath: serverConfig.serverConfigPath || null,
    branch: serverConfig.branch || 'stable',
    rconHost: serverConfig.rconHost || '127.0.0.1',
    rconPort: serverConfig.rconPort || 27015,
    rconPassword: serverConfig.rconPassword || '',
    serverPort: serverConfig.serverPort || 16261,
    minMemory: normalizeMemoryGb(serverConfig.minMemory, 4),
    maxMemory: normalizeMemoryGb(serverConfig.maxMemory, 8),
    useNoSteam: serverConfig.useNoSteam || false,
    useDebug: serverConfig.useDebug || false,
    isRemote: serverConfig.isRemote || false,
    startCommand: serverConfig.startCommand || '',
    isActive: isFirst,
    createdAt: new Date().toISOString()
  };

  db.data.servers.push(server);

  if (isFirst) {
    syncServerToSettings(db, server);
  }

  scheduleWrite();
  return normalizeServerMemory(server);
}

export async function updateServer(id, updates) {
  const db = await getDb();
  const index = db.data.servers.findIndex(s => String(s.id) === String(id));
  if (index === -1) return null;

  db.data.servers[index] = {
    ...db.data.servers[index],
    ...updates,
    id,
    updatedAt: new Date().toISOString()
  };
  db.data.servers[index].minMemory = normalizeMemoryGb(db.data.servers[index].minMemory, 4);
  db.data.servers[index].maxMemory = normalizeMemoryGb(db.data.servers[index].maxMemory, 8);
  scheduleWrite();
  return normalizeServerMemory(db.data.servers[index]);
}

export async function deleteServer(id) {
  const db = await getDb();
  const index = db.data.servers.findIndex(s => String(s.id) === String(id));
  if (index === -1) return false;

  const wasActive = db.data.servers[index].isActive;
  const serverId = String(db.data.servers[index].id);
  db.data.servers.splice(index, 1);

  // Clean up tracked mods for the deleted server
  db.data.tracked_mods = db.data.tracked_mods.filter(m => m.server_id !== serverId);

  if (wasActive && db.data.servers.length > 0) {
    db.data.servers[0].isActive = true;
  }

  scheduleWrite();
  return true;
}

export async function setActiveServer(id) {
  const db = await getDb();
  const server = db.data.servers.find(s => String(s.id) === String(id));
  if (!server) return null;

  db.data.servers.forEach(s => {
    s.isActive = String(s.id) === String(id);
  });

  syncServerToSettings(db, server);
  scheduleWrite();
  return server;
}

/** Sync active server config to legacy flat settings */
function syncServerToSettings(db, server) {
  const normalizedServer = normalizeServerMemory(server);
  db.data.settings.serverPath = server.installPath;
  db.data.settings.serverName = server.serverName;
  db.data.settings.rconHost = server.rconHost;
  db.data.settings.rconPort = server.rconPort;
  db.data.settings.rconPassword = server.rconPassword;
  db.data.settings.serverPort = server.serverPort;
  db.data.settings.minMemory = normalizedServer.minMemory;
  db.data.settings.maxMemory = normalizedServer.maxMemory;
  db.data.settings.zomboidDataPath = server.zomboidDataPath;
  db.data.settings.serverConfigPath = server.serverConfigPath;
}

// ============================================
// Player Notes & Tags
// ============================================

export async function getPlayerNotes() {
  const db = await getDb();
  if (!db.data.player_notes) db.data.player_notes = [];
  return db.data.player_notes;
}

export async function getPlayerNote(playerName) {
  const db = await getDb();
  if (!db.data.player_notes) db.data.player_notes = [];
  return db.data.player_notes.find(p => p.player_name.toLowerCase() === playerName.toLowerCase()) || null;
}

export async function upsertPlayerNote(playerName, note, tags = []) {
  const db = await getDb();
  if (!db.data.player_notes) db.data.player_notes = [];

  const existingIndex = db.data.player_notes.findIndex(
    p => p.player_name.toLowerCase() === playerName.toLowerCase()
  );

  const entry = {
    player_name: playerName,
    note: note || '',
    tags: tags || [],
    updated_at: new Date().toISOString()
  };

  if (existingIndex !== -1) {
    db.data.player_notes[existingIndex] = {
      ...db.data.player_notes[existingIndex],
      ...entry
    };
  } else {
    entry.id = generateId();
    entry.created_at = new Date().toISOString();
    db.data.player_notes.push(entry);
  }

  scheduleWrite();
  return entry;
}

export async function deletePlayerNote(playerName) {
  const db = await getDb();
  if (!db.data.player_notes) return false;

  const index = db.data.player_notes.findIndex(
    p => p.player_name.toLowerCase() === playerName.toLowerCase()
  );
  if (index === -1) return false;

  db.data.player_notes.splice(index, 1);
  scheduleWrite();
  return true;
}

// ============================================
// Player Stats (playtime tracking)
// ============================================

export async function getPlayerStats() {
  const db = await getDb();
  if (!db.data.player_stats) db.data.player_stats = [];
  return db.data.player_stats;
}

export async function getPlayerStat(playerName) {
  const db = await getDb();
  if (!db.data.player_stats) db.data.player_stats = [];
  return db.data.player_stats.find(p => p.player_name.toLowerCase() === playerName.toLowerCase()) || null;
}

export async function recordPlayerSession(playerName, action) {
  const db = await getDb();
  if (!db.data.player_stats) db.data.player_stats = [];

  let playerStat = db.data.player_stats.find(
    p => p.player_name.toLowerCase() === playerName.toLowerCase()
  );

  const now = new Date().toISOString();

  if (!playerStat) {
    playerStat = {
      id: generateId(),
      player_name: playerName,
      total_playtime_seconds: 0,
      session_count: 0,
      first_seen: now,
      last_seen: now,
      last_session_start: null,
      sessions: []
    };
    db.data.player_stats.push(playerStat);
  }

  if (action === 'connect') {
    playerStat.last_session_start = now;
    playerStat.last_seen = now;
    playerStat.session_count++;
  } else if (action === 'disconnect' && playerStat.last_session_start) {
    const sessionStart = new Date(playerStat.last_session_start);
    const sessionEnd = new Date(now);
    const sessionDuration = Math.floor((sessionEnd - sessionStart) / 1000);

    playerStat.total_playtime_seconds += sessionDuration;
    playerStat.last_seen = now;

    if (!playerStat.sessions) playerStat.sessions = [];
    playerStat.sessions.unshift({
      start: playerStat.last_session_start,
      end: now,
      duration_seconds: sessionDuration
    });
    if (playerStat.sessions.length > RETENTION.player_sessions) {
      playerStat.sessions = playerStat.sessions.slice(0, RETENTION.player_sessions);
    }

    playerStat.last_session_start = null;
  }

  scheduleWrite();
  return playerStat;
}

// ============================================
// Performance History
// ============================================

export async function recordPerformanceSnapshot(snapshot) {
  const db = await getDb();
  if (!db.data.performance_history) db.data.performance_history = [];

  const entry = {
    timestamp: new Date().toISOString(),
    ...snapshot
  };

  db.data.performance_history.push(entry);
  if (db.data.performance_history.length > RETENTION.performance_history) {
    db.data.performance_history = db.data.performance_history.slice(-RETENTION.performance_history);
  }

  scheduleWrite();
  return entry;
}

export async function getPerformanceHistory(limit = 60) {
  const db = await getDb();
  if (!db.data.performance_history) return [];
  return db.data.performance_history.slice(-limit);
}

// ============================================
// Mod Presets
// ============================================

export async function getModPresets() {
  const db = await getDb();
  if (!db.data.mod_presets) db.data.mod_presets = [];
  return db.data.mod_presets;
}

export async function createModPreset(name, description, mods, workshopIds, maps) {
  const db = await getDb();
  if (!db.data.mod_presets) db.data.mod_presets = [];

  const preset = {
    id: generateId(),
    name,
    description: description || '',
    mods: mods || [],
    workshop_ids: workshopIds || [],
    maps: maps || [],
    created_at: new Date().toISOString()
  };

  db.data.mod_presets.push(preset);
  scheduleWrite();
  return preset;
}

export async function updateModPreset(id, updates) {
  const db = await getDb();
  if (!db.data.mod_presets) return null;

  const index = db.data.mod_presets.findIndex(p => p.id === id);
  if (index === -1) return null;

  db.data.mod_presets[index] = {
    ...db.data.mod_presets[index],
    ...updates,
    updated_at: new Date().toISOString()
  };
  scheduleWrite();
  return db.data.mod_presets[index];
}

export async function deleteModPreset(id) {
  const db = await getDb();
  if (!db.data.mod_presets) return false;

  const index = db.data.mod_presets.findIndex(p => p.id === id);
  if (index === -1) return false;

  db.data.mod_presets.splice(index, 1);
  scheduleWrite();
  return true;
}

// ============================================
// SteamID Ban Tracking
// ============================================

export async function getSteamIdBans() {
  const db = await getDb();
  if (!db.data.steamid_bans) db.data.steamid_bans = [];
  return db.data.steamid_bans;
}

export async function addSteamIdBan(steamId, reason = null) {
  const db = await getDb();
  if (!db.data.steamid_bans) db.data.steamid_bans = [];

  // Don't add duplicates
  if (db.data.steamid_bans.some(b => b.steamId === steamId)) return;

  db.data.steamid_bans.push({
    steamId,
    reason: reason || null,
    banned_at: new Date().toISOString()
  });
  scheduleWrite();
}

export async function removeSteamIdBan(steamId) {
  const db = await getDb();
  if (!db.data.steamid_bans) return false;

  const index = db.data.steamid_bans.findIndex(b => b.steamId === steamId);
  if (index === -1) return false;

  db.data.steamid_bans.splice(index, 1);
  scheduleWrite();
  return true;
}
