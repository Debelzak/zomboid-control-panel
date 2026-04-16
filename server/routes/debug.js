import express from 'express';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import { createLogger } from '../utils/logger.js';
const log = createLogger('API:Debug');
import { getDataPaths, setDataPaths } from '../utils/paths.js';
import { getPerformanceHistory, recordPerformanceSnapshot, getDatabaseStats, createDatabaseBackup, compactDatabase, getCommandHistory, getBridgeLogs, getPlayerLogs, getDb, getActiveServer } from '../database/init.js';
import { sanitizeError } from '../utils/sanitize.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// In-memory log buffer for real-time streaming
const logBuffer = [];
const MAX_BUFFER_SIZE = 500;

// Hook into Winston to capture logs for streaming
export function addLogToBuffer(level, message, source = 'server') {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    source
  };
  
  logBuffer.push(entry);
  if (logBuffer.length > MAX_BUFFER_SIZE) {
    logBuffer.shift();
  }
  
  return entry;
}

// Get system RAM info for auto-configuration
router.get('/ram', async (req, res) => {
  try {
    const totalMemBytes = os.totalmem();
    const freeMemBytes = os.freemem();
    const totalMemGB = Math.floor(totalMemBytes / (1024 * 1024 * 1024));
    const freeMemGB = Math.floor(freeMemBytes / (1024 * 1024 * 1024));
    
    // Calculate recommended settings
    // Reserve ~4GB for OS/other apps, use 50-75% of remaining for server
    const availableForServer = Math.max(1, totalMemGB - 4);
    const recommendedMax = Math.min(Math.floor(availableForServer * 0.75), 16); // Cap at 16GB
    const recommendedMin = Math.max(1, Math.floor(recommendedMax * 0.5)); // Min is 50% of max
    
    res.json({
      totalGB: totalMemGB,
      freeGB: freeMemGB,
      recommendedMin,
      recommendedMax
    });
  } catch (error) {
    log.error(`Failed to get RAM info: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Get system information
router.get('/system', async (req, res) => {
  try {
    const paths = getDataPaths();
    
    // Redact full filesystem paths to relative/basename for security
    const redactPath = (p) => {
      if (!p) return 'Not configured';
      // Show only the last 2 path segments (e.g., "data/db.json")
      const segments = p.replace(/\\/g, '/').split('/').filter(Boolean);
      return segments.length > 2 ? '.../' + segments.slice(-2).join('/') : segments.join('/');
    };

    res.json({
      nodeVersion: process.version,
      platform: process.platform,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      dbPath: fs.existsSync(paths.dbPath) ? redactPath(paths.dbPath) : 'Not found',
      logsPath: fs.existsSync(paths.logsDir) ? redactPath(paths.logsDir) : 'Not found',
      dataDir: redactPath(paths.dataDir),
      pathsConfigurable: true,
      env: {
        NODE_ENV: process.env.NODE_ENV || 'development',
        PORT: process.env.PORT || 3001,
        LOG_LEVEL: process.env.LOG_LEVEL || 'info'
      }
    });
  } catch (error) {
    log.error(`Failed to get system info: ${error.message}`);
    res.status(500).json({ error: 'Failed to get system info' });
  }
});

// Get recent logs from buffer
router.get('/logs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 200;
    res.json({
      logs: logBuffer.slice(-limit),
      total: logBuffer.length
    });
  } catch (error) {
    log.error(`Failed to get logs: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

async function getAvailableLogFiles(logsDir) {
  const entries = await fs.promises.readdir(logsDir, { withFileTypes: true });

  const files = (await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.log'))
    .map(async (entry) => {
      try {
        const filePath = path.join(logsDir, entry.name);
        const stats = await fs.promises.stat(filePath);
        return {
          name: entry.name,
          size: stats.size,
          modified: stats.mtime.toISOString()
        };
      } catch (error) {
        log.debug(`Stat failed for log file ${entry.name}: ${error.message}`);
        return null;
      }
    })))
    .filter((file) => file !== null)
    .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

  return files;
}

const SUPPORT_LOG_FILE_RE = /\.(log|txt)$/i;
const CRASH_FILE_RE = /^(hs_err_pid.*|.*(?:crash|error|exception).*)\.(log|txt)$/i;

async function resolveSearchRoot(candidate) {
  if (!candidate) return null;

  const resolved = path.resolve(candidate);

  try {
    const stats = await fs.promises.stat(resolved);
    return stats.isDirectory() ? resolved : path.dirname(resolved);
  } catch {
    return path.extname(resolved) ? path.dirname(resolved) : resolved;
  }
}

async function collectBundleFilesFromDir(dir, matcher, archivePrefix, entries, seenFiles) {
  if (!dir) return;

  try {
    await fs.promises.access(dir);
  } catch {
    return;
  }

  const dirEntries = await fs.promises.readdir(dir, { withFileTypes: true });

  for (const entry of dirEntries) {
    if (!entry.isFile()) continue;
    if (!matcher(entry.name)) continue;

    const filePath = path.join(dir, entry.name);
    const dedupeKey = path.resolve(filePath).toLowerCase();
    if (seenFiles.has(dedupeKey)) continue;

    seenFiles.add(dedupeKey);
    entries.push({
      filePath,
      archivePath: `${archivePrefix}/${entry.name}`
    });
  }
}

async function getSupportBundleEntries() {
  const paths = getDataPaths();
  const activeServer = await getActiveServer().catch(() => null);

  const installRoot = await resolveSearchRoot(activeServer?.installPath || '');
  const zomboidDataRoot = await resolveSearchRoot(activeServer?.zomboidDataPath || '');

  const entries = [];
  const seenFiles = new Set();

  await collectBundleFilesFromDir(
    paths.logsDir,
    (name) => SUPPORT_LOG_FILE_RE.test(name) && !name.startsWith('.'),
    'admin-panel',
    entries,
    seenFiles
  );

  await collectBundleFilesFromDir(
    zomboidDataRoot,
    (name) => SUPPORT_LOG_FILE_RE.test(name),
    'zomboid-server/root',
    entries,
    seenFiles
  );

  await collectBundleFilesFromDir(
    zomboidDataRoot ? path.join(zomboidDataRoot, 'Logs') : null,
    (name) => SUPPORT_LOG_FILE_RE.test(name),
    'zomboid-server/Logs',
    entries,
    seenFiles
  );

  await collectBundleFilesFromDir(
    installRoot ? path.join(installRoot, 'logs') : null,
    (name) => SUPPORT_LOG_FILE_RE.test(name),
    'zomboid-install/logs',
    entries,
    seenFiles
  );

  await collectBundleFilesFromDir(
    installRoot,
    (name) => CRASH_FILE_RE.test(name),
    'crash-logs/install-root',
    entries,
    seenFiles
  );

  await collectBundleFilesFromDir(
    installRoot ? path.join(installRoot, 'logs') : null,
    (name) => CRASH_FILE_RE.test(name),
    'crash-logs/install-logs',
    entries,
    seenFiles
  );

  await collectBundleFilesFromDir(
    zomboidDataRoot,
    (name) => CRASH_FILE_RE.test(name),
    'crash-logs/server-root',
    entries,
    seenFiles
  );

  await collectBundleFilesFromDir(
    zomboidDataRoot ? path.join(zomboidDataRoot, 'Logs') : null,
    (name) => CRASH_FILE_RE.test(name),
    'crash-logs/server-logs',
    entries,
    seenFiles
  );

  return {
    entries,
    activeServer,
    sources: {
      panelLogsDir: paths.logsDir,
      installRoot,
      zomboidDataRoot
    }
  };
}

// List available log files
router.get('/logs/files', async (req, res) => {
  try {
    const paths = getDataPaths();
    const logsDir = paths.logsDir;
    
    try {
        await fs.promises.access(logsDir);
    } catch (e) {
        log.debug(`Logs directory not accessible (${logsDir}): ${e.message}`);
        return res.json({ files: [] });
    }

    const files = await getAvailableLogFiles(logsDir);
    
    res.json({ files });
  } catch (error) {
    log.error(`Failed to list log files: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Download combined log file
router.get('/logs/download', async (req, res) => {
  try {
    const paths = getDataPaths();
    const logsPath = path.join(paths.logsDir, 'combined.log');
    
    if (!fs.existsSync(logsPath)) {
      return res.status(404).json({ error: 'Log file not found' });
    }
    
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename=combined.log');
    
    const readStream = fs.createReadStream(logsPath);
    readStream.on('error', (err) => {
      log.error(`Log file read error: ${err.message}`);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to read log file' });
      else res.destroy();
    });
    readStream.pipe(res);
  } catch (error) {
    log.error(`Failed to download logs: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Download all log files as a zip archive
router.get('/logs/download-zip', async (req, res) => {
  try {
    log.info('GET /logs/download-zip');

    const { entries, activeServer, sources } = await getSupportBundleEntries();
    if (entries.length === 0) {
      return res.status(404).json({ error: 'No support logs found' });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archiveName = `pz-support-bundle-${timestamp}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${archiveName}"`);

    const archive = archiver('zip', {
      zlib: { level: 6 }
    });

    archive.on('warning', (error) => {
      log.warn(`Log zip warning: ${error.message}`);
    });

    archive.on('error', (error) => {
      log.error(`Failed to create log archive: ${error.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create log archive' });
      } else {
        res.destroy(error);
      }
    });

    archive.pipe(res);

    const manifest = [
      'Project Zomboid Control Panel Support Bundle',
      `Generated: ${new Date().toISOString()}`,
      `Active Server: ${activeServer?.name || activeServer?.serverName || 'Not configured'}`,
      `Panel Logs Dir: ${sources.panelLogsDir || 'n/a'}`,
      `Zomboid Data Dir: ${sources.zomboidDataRoot || 'n/a'}`,
      `Install Dir: ${sources.installRoot || 'n/a'}`,
      `Included Files: ${entries.length}`,
      '',
      'Contents:',
      '- admin-panel: panel combined/error logs',
      '- zomboid-server: server-console and runtime logs',
      '- zomboid-install: install-side connection/workshop/system logs',
      '- crash-logs: matching crash/error dump files'
    ].join('\n');

    archive.append(manifest, { name: 'support-bundle-info.txt' });

    for (const entry of entries) {
      archive.file(entry.filePath, { name: entry.archivePath });
    }

    archive.finalize();
  } catch (error) {
    log.error(`Failed to download log archive: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Download specific log file by name
router.get('/logs/download/:filename', async (req, res) => {
  try {
    const paths = getDataPaths();
    const filename = req.params.filename;
    log.info(`GET /logs/download/${filename}`);
    
    // Security: prevent path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    
    const logsPath = path.join(paths.logsDir, filename);
    
    if (!fs.existsSync(logsPath)) {
      return res.status(404).json({ error: 'Log file not found' });
    }
    
    res.setHeader('Content-Type', 'text/plain');
    const safeFilename = filename.replace(/["\r\n]/g, '');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    
    const readStream = fs.createReadStream(logsPath);
    readStream.on('error', (err) => {
      log.error(`Log file read error: ${err.message}`);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to read log file' });
      else res.destroy();
    });
    readStream.pipe(res);
  } catch (error) {
    log.error(`Failed to download log file: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Clear in-memory log buffer
router.post('/logs/clear', async (req, res) => {
  try {
    log.info('POST /logs/clear');
    logBuffer.length = 0;
    res.json({ success: true, message: 'Log buffer cleared' });
  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Update data paths (database and logs location)
router.post('/paths', async (req, res) => {
  try {
    const { dataDir, logsDir, moveFiles } = req.body;
    
    if (!dataDir && !logsDir) {
      return res.status(400).json({ error: 'At least one path must be provided' });
    }
    
    // Validate path format and length
    if (dataDir && (typeof dataDir !== 'string' || dataDir.length > 500)) {
      return res.status(400).json({ error: 'Invalid data directory path' });
    }
    if (logsDir && (typeof logsDir !== 'string' || logsDir.length > 500)) {
      return res.status(400).json({ error: 'Invalid logs directory path' });
    }
    
    const result = await setDataPaths({ dataDir, logsDir }, moveFiles !== false);
    
    if (result.success) {
      log.info(`Data paths updated - Data: ${result.paths.dataDir}, Logs: ${result.paths.logsDir}`);
      res.json({
        success: true,
        message: 'Paths updated successfully. Restart the application to apply changes.',
        paths: result.paths,
        filesMoved: result.filesMoved,
        requiresRestart: true
      });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    log.error(`Failed to update paths: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Health check with details
router.get('/health', async (req, res) => {
  try {
    const rconService = req.app.get('rconService');
    const serverManager = req.app.get('serverManager');
    const modChecker = req.app.get('modChecker');
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        rcon: {
          connected: rconService?.isConnected?.() || false,
          host: rconService?.host || 'not configured'
        },
        server: {
          running: await serverManager?.checkServerRunning?.() || false
        },
        modChecker: {
          running: modChecker?.isRunning || false,
          interval: modChecker?.checkInterval || 0
        }
      },
      memory: process.memoryUsage(),
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error', 
      error: sanitizeError(error.message),
      timestamp: new Date().toISOString()
    });
  }
});

// Get performance history for charts
router.get('/performance-history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 60;
    const history = await getPerformanceHistory(limit);
    res.json({ history });
  } catch (error) {
    log.error(`Failed to get performance history: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Record current performance snapshot (called periodically)
router.post('/performance-snapshot', async (req, res) => {
  try {
    const { memoryUsed, memoryTotal, cpuUsage, playerCount, serverRunning } = req.body;
    await recordPerformanceSnapshot({
      memoryUsed: memoryUsed || process.memoryUsage().heapUsed,
      memoryTotal: memoryTotal || process.memoryUsage().heapTotal,
      cpuUsage: cpuUsage || 0,
      playerCount: playerCount || 0,
      serverRunning: serverRunning ?? false
    });
    res.json({ success: true });
  } catch (error) {
    log.error(`Failed to record performance snapshot: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Database stats
router.get('/database', async (req, res) => {
  try {
    const stats = await getDatabaseStats();
    res.json(stats);
  } catch (error) {
    log.error(`Failed to get database stats: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Create manual database backup
router.post('/database/backup', async (req, res) => {
  try {
    log.info('POST /database/backup');
    const result = await createDatabaseBackup();
    res.json(result);
  } catch (error) {
    log.error(`Failed to create database backup: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Compact database (apply retention policies)
router.post('/database/compact', async (req, res) => {
  try {
    log.info('POST /database/compact');
    const result = await compactDatabase();
    res.json(result);
  } catch (error) {
    log.error(`Failed to compact database: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Get crash logs (hs_err files from Java crashes)
router.get('/crash-logs', async (req, res) => {
  try {
    const serverManager = req.app.get('serverManager');
    const serverPath = serverManager?.serverPath || '';
    
    // Look for crash logs in common locations
    const crashDirs = [
      serverPath,
      path.join(serverPath, 'logs'),
      process.cwd(),
      path.join(process.cwd(), 'logs')
    ].filter(Boolean);
    
    const crashLogs = [];
    const seenFiles = new Set(); // Prevent duplicates
    
    for (const dir of crashDirs) {
      try {
        // Check dir exists
        try { await fs.promises.access(dir); } catch (e) {
          log.debug(`Crash log dir not accessible (${dir}): ${e.message}`);
          continue;
        }

        const files = await fs.promises.readdir(dir);
        
        await Promise.all(files.map(async file => {
            // Skip if already seen
            if (seenFiles.has(file)) return;
            
            // Match Java crash dumps and common crash log patterns
            if (file.startsWith('hs_err_pid') || 
                (file.includes('crash') && file.endsWith('.log')) ||
                (file.includes('error') && file.endsWith('.log'))) {
                
                try {
                    const filePath = path.join(dir, file);
                    const stats = await fs.promises.stat(filePath);
                    if (!seenFiles.has(file)) { // Check again after await
                        seenFiles.add(file);
                        crashLogs.push({
                        name: file,
                        path: filePath,
                        size: stats.size,
                        modified: stats.mtime.toISOString()
                        });
                    }
                } catch(e) {
                  log.debug(`Stat failed for crash log ${file}: ${e.message}`);
                }
            }
        }));
      } catch (e) {
        log.debug(`Directory not accessible for crash logs: ${dir} — ${e.message}`);
      }
    }
    
    // Sort by modified date, newest first
    crashLogs.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    
    res.json({ crashLogs: crashLogs.slice(0, 20) });
  } catch (error) {
    log.error(`Failed to get crash logs: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Get crash log content
router.get('/crash-logs/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const serverManager = req.app.get('serverManager');
    const serverPath = serverManager?.serverPath || '';
    
    // Security: prevent path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    
    const searchDirs = [
      serverPath,
      path.join(serverPath, 'logs'),
      process.cwd(),
      path.join(process.cwd(), 'logs')
    ].filter(Boolean);
    
    for (const dir of searchDirs) {
      const filePath = path.join(dir, filename);
      try {
        await fs.promises.access(filePath);
        
        // Read only first 100KB using file handle to prevent OOM on large files
        const handle = await fs.promises.open(filePath, 'r');
        try {
            const stats = await handle.stat();
            const readSize = Math.min(stats.size, 100000);
            const buffer = Buffer.alloc(readSize);
            
            await handle.read(buffer, 0, readSize, 0);
            const content = buffer.toString('utf-8');
            
            return res.json({ 
                content,
                truncated: stats.size > 100000,
                size: stats.size
            });
        } finally {
            await handle.close();
        }
      } catch (e) {
          // File not found in this dir, try next
      }
    }
    
    res.status(404).json({ error: 'Crash log not found' });
  } catch (error) {
    log.error(`Failed to read crash log: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// POST /client-errors - Accept frontend error reports for server-side logging
// Production builds can't console.error, so this makes client crashes visible.
const CLIENT_ERROR_RATE = new Map(); // IP -> { count, resetAt }
const CLIENT_ERROR_MAX = 30; // max reports per minute per IP

router.post('/client-errors', (req, res) => {
  try {
    // Simple per-IP rate limit to prevent abuse
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const entry = CLIENT_ERROR_RATE.get(ip) || { count: 0, resetAt: now + 60000 };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 60000; }
    entry.count++;
    CLIENT_ERROR_RATE.set(ip, entry);
    if (entry.count > CLIENT_ERROR_MAX) {
      return res.status(429).json({ error: 'Too many error reports' });
    }

    const { message, error: errorDetail, url } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    log.warn(`[ClientError] ${message.slice(0, 500)}`, {
      error: typeof errorDetail === 'string' ? errorDetail.slice(0, 1000) : undefined,
      url: typeof url === 'string' ? url.slice(0, 200) : undefined,
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process error report' });
  }
});

// ============================================
// Unified Activity Log
// ============================================

// GET /api/debug/activity — Merge all log sources into a single chronological feed
router.get('/activity', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const source = req.query.source || 'all'; // 'all' | 'rcon' | 'bridge' | 'player' | 'server'

    const entries = [];

    // RCON command history
    if (source === 'all' || source === 'rcon') {
      const rconHistory = await getCommandHistory(limit);
      for (const cmd of rconHistory) {
        entries.push({
          id: cmd.id,
          source: 'rcon',
          action: cmd.command,
          detail: cmd.response || '',
          success: cmd.success === 1,
          timestamp: cmd.executed_at
        });
      }
    }

    // Bridge command history
    if (source === 'all' || source === 'bridge') {
      const bridgeHistory = await getBridgeLogs(limit);
      for (const cmd of bridgeHistory) {
        const detail = cmd.success === 1
          ? (cmd.result?.data ? JSON.stringify(cmd.result.data).substring(0, 300) : 'ok')
          : (cmd.result?.error || 'failed');
        entries.push({
          id: cmd.id,
          source: 'bridge',
          action: cmd.action,
          args: cmd.args,
          detail,
          success: cmd.success === 1,
          duration_ms: cmd.duration_ms,
          timestamp: cmd.executed_at
        });
      }
    }

    // Player action logs
    if (source === 'all' || source === 'player') {
      const playerLogs = await getPlayerLogs(null, limit);
      for (const log of playerLogs) {
        entries.push({
          id: log.id,
          source: 'player',
          action: log.action,
          detail: log.player_name + (log.details ? ` — ${log.details}` : ''),
          success: true,
          timestamp: log.logged_at
        });
      }
    }

    // Server events
    if (source === 'all' || source === 'server') {
      const db = await getDb();
      const serverEvents = (db.data.server_events || []).slice(0, limit);
      for (const evt of serverEvents) {
        entries.push({
          id: evt.id,
          source: 'server',
          action: evt.event_type,
          detail: evt.message || '',
          success: !/(crash|error|fail)/i.test(evt.event_type),
          timestamp: evt.created_at
        });
      }
    }

    // Sort by timestamp (newest first) and trim
    entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const trimmed = entries.slice(0, limit);

    res.json({ entries: trimmed, total: trimmed.length });
  } catch (error) {
    log.error(`Activity log failed: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

export default router;
export { logBuffer };