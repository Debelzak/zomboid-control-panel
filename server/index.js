import express from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { exec, spawn } from 'child_process';
import cookieParser from 'cookie-parser';

import { logger, onLog, createLogger, logSection, logBlank, logBanner, logReady } from './utils/logger.js';
const log = createLogger('Panel');
import { initDatabase, getActiveServer, getAllSettings, getSetting } from './database/init.js';
import { RconService } from './services/rcon.js';
import { ServerManager } from './services/serverManager.js';
import { ModChecker } from './services/modChecker.js';
import { Scheduler } from './services/scheduler.js';
import { DiscordBot } from './services/discordBot.js';
import { BackupService } from './services/backupService.js';
import { UpdateChecker } from './services/updateChecker.js';
import { PanelUpdateChecker } from './services/panelUpdateChecker.js';
import { LogTailer } from './services/logTailer.js';
import authService from './services/auth.js';
import authRoutes from './routes/auth.js';
import { loadOrCreateCerts } from './utils/certs.js';
import { sanitizeError } from './utils/sanitize.js';

// Global error handlers to prevent app crashes
process.on('uncaughtException', (error) => {
  log.error('Uncaught Exception:', error);
  // Don't exit - keep the app running
});

process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit - keep the app running
});

// Graceful shutdown handling
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  log.info(`Received ${signal}, shutting down gracefully...`);
  
  try {
    // Stop player polling
    stopPlayerPolling();
    
    // Stop scheduler jobs
    if (scheduler) {
      scheduler.stopAllJobs?.();
    }
    
    // Stop mod checker
    if (modChecker) {
      modChecker.stop();
    }
    
    // Stop log tailer
    if (logTailer) {
      logTailer.stopWatching();
    }
    
    // Stop update checker
    if (updateChecker) {
      updateChecker.stop();
    }

    // Stop panel update checker
    if (panelUpdateChecker) {
      panelUpdateChecker.stop();
    }
    
    // Stop PanelBridge
    if (panelBridge?.isRunning) {
      panelBridge.stop();
    }
    
    // Stop RCON auto-reconnect and disconnect
    if (rconService) {
      rconService.stopAutoReconnect();
      if (rconService.connected) {
        await rconService.disconnect();
      }
    }
    
    // Close HTTP server
    httpServer.close(() => {
      log.info('HTTP server closed');
      process.exit(0);
    });
    
    // Force exit after 10 seconds if graceful shutdown hangs
    setTimeout(() => {
      log.warn('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10000);
  } catch (error) {
    log.error('Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Routes
import serverRoutes from './routes/server.js';
import serversRoutes from './routes/servers.js';
import serverFilesRoutes from './routes/serverFiles.js';
import playerRoutes from './routes/players.js';
import rconRoutes from './routes/rcon.js';
import configRoutes from './routes/config.js';
import schedulerRoutes from './routes/scheduler.js';
import modsRoutes from './routes/mods.js';
import chunksRoutes from './routes/chunks.js';
import discordRoutes from './routes/discord.js';
import debugRoutes, { addLogToBuffer } from './routes/debug.js';
import serverFinderRoutes from './routes/serverFinder.js';
import panelBridgeRoutes from './routes/panelBridge.js';
import backupRoutes from './routes/backup.js';
import panelBridge from './services/panelBridge.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);

// HTTPS server — created during startup if certs are available
let httpsServer = null;

// CORS — restrict to known development and production origins
// Must be declared before Socket.IO or Express CORS middleware reference it
const defaultAllowedOrigins = ['http://localhost:5173', 'http://localhost:3001'];
const allowedOrigins = new Set(defaultAllowedOrigins);
const MAX_CORS_BLOCK_EVENTS = 50;
const MAX_CORS_CUSTOM_ORIGINS = 100;
const MAX_CORS_ORIGIN_LENGTH = 256;
const corsState = {
  allowAll: false,
  allowPrivateNetworks: true,
  debug: false,
  customOrigins: new Set(),
  blocked: [],
  lastLoadedAt: null
};

function normalizeOrigin(origin) {
  if (typeof origin !== 'string') return null;
  const trimmed = origin.trim();
  if (trimmed.length > MAX_CORS_ORIGIN_LENGTH) return null;
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch (_) {
    return null;
  }
}

function parseOriginList(rawOrigins) {
  if (typeof rawOrigins !== 'string') return [];
  const parsed = rawOrigins
    .split(/[\n,;]+/)
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);
  return [...new Set(parsed)].slice(0, MAX_CORS_CUSTOM_ORIGINS);
}

function isPrivateNetworkHost(host) {
  if (!host) return false;
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.startsWith('192.168.') ||
    host.startsWith('10.') ||
    host.startsWith('100.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

function recordCorsBlock(origin, source) {
  if (!corsState.debug) return;
  const normalizedOrigin = typeof origin === 'string' ? origin.trim() : '';
  const safeOrigin = normalizedOrigin
    ? normalizedOrigin.slice(0, MAX_CORS_ORIGIN_LENGTH)
    : 'null';
  const entry = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    origin: safeOrigin,
    source,
    blockedAt: new Date().toISOString()
  };
  corsState.blocked.unshift(entry);
  if (corsState.blocked.length > MAX_CORS_BLOCK_EVENTS) {
    corsState.blocked = corsState.blocked.slice(0, MAX_CORS_BLOCK_EVENTS);
  }
}

// Allow dynamic HTTPS origins (will be populated at startup if HTTPS is enabled)
function addAllowedOrigin(origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return;
  allowedOrigins.add(normalized);
}

function rebuildAllowedOriginsFromSettings(settings = {}) {
  allowedOrigins.clear();
  for (const origin of defaultAllowedOrigins) {
    addAllowedOrigin(origin);
  }

  const customOrigins = parseOriginList(settings.corsAllowedOrigins || '');
  corsState.customOrigins = new Set(customOrigins);
  for (const origin of customOrigins) {
    addAllowedOrigin(origin);
  }

  const httpsEnabled = settings.httpsEnabled === true;
  const httpsPort = parseInt(settings.httpsPort, 10);
  if (httpsEnabled) {
    addAllowedOrigin(`https://localhost:${Number.isNaN(httpsPort) ? 3443 : httpsPort}`);
  }
}

function getCorsDebugSnapshot() {
  return {
    allowAll: corsState.allowAll,
    allowPrivateNetworks: corsState.allowPrivateNetworks,
    debug: corsState.debug,
    customOrigins: [...corsState.customOrigins],
    effectiveAllowedOrigins: [...allowedOrigins].sort(),
    blocked: corsState.blocked,
    blockedCount: corsState.blocked.length,
    lastLoadedAt: corsState.lastLoadedAt
  };
}

function clearCorsBlockedOrigins() {
  corsState.blocked = [];
}

async function refreshCorsConfig() {
  const settings = await getAllSettings();
  corsState.allowAll = settings?.corsAllowAll === true;
  corsState.allowPrivateNetworks = settings?.corsAllowPrivateNetworks !== false;
  corsState.debug = settings?.corsDebug === true;
  rebuildAllowedOriginsFromSettings(settings || {});
  corsState.lastLoadedAt = new Date().toISOString();

  log.info(
    `CORS config loaded: allowAll=${corsState.allowAll}, privateNetworks=${corsState.allowPrivateNetworks}, customOrigins=${corsState.customOrigins.size}, debug=${corsState.debug}`
  );

  return getCorsDebugSnapshot();
}

// CORS origin checker — shared between Express and Socket.IO
// Allows localhost + any private/LAN IP (192.168.x, 10.x, 100.x Tailscale, 172.16-31.x)
function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (corsState.allowAll) return true;

  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (allowedOrigins.has(normalized)) return true;

  try {
    const url = new URL(normalized);
    if (corsState.allowPrivateNetworks && isPrivateNetworkHost(url.hostname)) {
      addAllowedOrigin(normalized);
      return true;
    }
  } catch (_) {}

  return false;
}

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
      } else {
        recordCorsBlock(origin, 'socket');
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Security middleware
// Disable HSTS and upgrade-insecure-requests — panel is typically accessed over
// plain HTTP on a LAN. Sending these headers forces browsers to require HTTPS
// and blocks all assets on non-HTTPS setups.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null,
    }
  },
  hsts: false,
  crossOriginEmbedderPolicy: false // Allow loading resources
}));

app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      recordCorsBlock(origin, 'http');
      log.warn(`CORS blocked request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

// Body parser with explicit size limit
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Compress all HTTP responses (gzip/deflate)
app.use(compression({ threshold: 1024 }));

// Rate limiting — applied before auth to protect against unauthenticated floods
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 300, // 300 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', apiLimiter);

// Auth middleware — protects all /api/ routes except /api/auth/*
app.use(authService.middleware());

// Stricter rate limit for destructive/sensitive operations
const strictLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10, // 10 per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded for this operation.' }
});
app.use('/api/server/install', strictLimiter);
app.use('/api/server/delete-files', strictLimiter);
app.use('/api/server/steam-update', strictLimiter);
app.use('/api/server/steamcmd/download', strictLimiter);
app.use('/api/server/start', strictLimiter);
app.use('/api/server/stop', strictLimiter);
app.use('/api/server/force-stop', strictLimiter);
app.use('/api/server/restart', strictLimiter);
app.use('/api/backup/restore', strictLimiter);
app.use('/api/backup/delete-older-than', strictLimiter);
app.delete('/api/backup/:name', strictLimiter);
app.use('/api/chunks/delete-chunks', strictLimiter);
app.use('/api/chunks/delete-region', strictLimiter);
app.use('/api/server-files/raw', strictLimiter);
app.use('/api/server-files/restore', strictLimiter);
app.use('/api/server-files/save-and-reload', strictLimiter);
app.use('/api/panel-bridge/install-mod', strictLimiter);
app.use('/api/panel/update-check', strictLimiter);
app.use('/api/panel/update-download', strictLimiter);
app.use('/api/panel/restart', strictLimiter);

// Mid-tier rate limit for RCON commands (higher than strict, lower than general)
const rconLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60, // 60 commands per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many RCON commands, please slow down.' }
});
app.use('/api/rcon/execute', rconLimiter);

// Mid-tier rate limit for direct PanelBridge command endpoint
const panelBridgeCommandLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60, // 60 commands per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many PanelBridge commands, please slow down.' }
});
app.use('/api/panel-bridge/command', panelBridgeCommandLimiter);

// Initialize services
const rconService = new RconService();
const serverManager = new ServerManager();
const modChecker = new ModChecker();
const logTailer = new LogTailer();
const scheduler = new Scheduler(rconService, serverManager);
const discordBot = new DiscordBot(rconService, serverManager, scheduler, logTailer);
const backupService = new BackupService();

// Connect services for cross-communication
rconService.setServerManager(serverManager);
scheduler.setBackupService(backupService);

 // Give scheduler and backupService a reference to discordBot so they can
 // fire event notifications (scheduledRestart, backupComplete) without
 // needing req.app access.
 scheduler.setDiscordBot(discordBot);
 backupService.setDiscordBot(discordBot);

// Start RCON auto-reconnect for automatic recovery
rconService.startAutoReconnect();

/**
 * Find the PanelBridge path for the active server
 * PZ Lua mod writes to: {serverRuntimePath}/Lua/panelbridge/{serverName}/
 * For dedicated servers, this is usually a Server_files* folder (set via -cachedir)
 */
async function findPanelBridgePath() {
  const activeServer = await getActiveServer();
  if (!activeServer) {
    return { error: 'No active server configured' };
  }
  
  const serverName = activeServer.serverName || activeServer.name;
  if (!serverName) {
    return { error: 'Server name not configured' };
  }
  
  // Check if db.json has a saved bridgePath that exists and has files
  const settings = await getAllSettings();
  if (settings?.panelBridge?.bridgePath) {
    const savedPath = settings.panelBridge.bridgePath;
    const statusFile = path.join(savedPath, 'status.json');
    if (fs.existsSync(statusFile)) {
      return { path: savedPath, source: 'db.json (saved)', serverName };
    }
  }
  
  // Build list of possible paths - PZ Lua mod writes to Lua/panelbridge/
  const possiblePaths = [];
  
  // Helper to safely read directory contents
  const safeReadDir = (dirPath) => {
    try {
      return fs.existsSync(dirPath) ? fs.readdirSync(dirPath) : [];
    } catch (e) {
      return [];
    }
  };
  
  // PRIORITY 1: zomboidDataPath is where -cachedir points - this is where the mod WRITES status.json
  // This should be checked first since it's explicitly configured for the server
  if (activeServer.zomboidDataPath) {
    possiblePaths.push({ p: path.join(activeServer.zomboidDataPath, 'Lua', 'panelbridge', serverName), source: 'zomboidDataPath/Lua (cachedir)', priority: 1 });
  }
  
  // PRIORITY 2: Look for Server_files* folders at parent level (dedicated server runtime data)
  // This is where -cachedir typically points for dedicated servers with separate data folders
  if (activeServer.installPath) {
    const parentDir = path.dirname(activeServer.installPath);
    const parentContents = safeReadDir(parentDir);
    for (const item of parentContents) {
      if (item.startsWith('Server_files') || item.match(/Server.*files/i)) {
        possiblePaths.push({ p: path.join(parentDir, item, 'Lua', 'panelbridge', serverName), source: `${item}/Lua`, priority: 2 });
      }
    }
  }
  
  // PRIORITY 3: Lua folder directly in install path (fallback)
  if (activeServer.installPath) {
    possiblePaths.push({ p: path.join(activeServer.installPath, 'Lua', 'panelbridge', serverName), source: 'installPath/Lua', priority: 3 });
  }
  
  // Find first path with existing status.json (bridge is active)
  for (const { p, source } of possiblePaths) {
    const statusFile = path.join(p, 'status.json');
    if (fs.existsSync(statusFile)) {
      return { path: p, source, serverName };
    }
  }
  
  // Check for .init file (bridge initialized but not yet active)
  for (const { p, source } of possiblePaths) {
    const initFile = path.join(p, '.init');
    if (fs.existsSync(initFile)) {
      return { path: p, source: `${source} (.init)`, serverName };
    }
  }
  
  // Check if any of the paths exist (even if empty - mod may have started writing)
  for (const { p, source } of possiblePaths) {
    if (fs.existsSync(p)) {
      return { path: p, source: `${source} (exists)`, serverName };
    }
  }
  
  // No existing bridge found - return the best expected path but DON'T create it
  // The directory will be created by the PZ mod when it runs
  if (possiblePaths.length > 0) {
    possiblePaths.sort((a, b) => a.priority - b.priority);
    const bestPath = possiblePaths[0];
    return { path: bestPath.p, source: `${bestPath.source} (expected)`, serverName, notCreated: true };
  }
  
  return { error: 'No valid bridge path could be determined', searchedPaths: possiblePaths.map(x => x.p), serverName };
}

/**
 * Start PanelBridge if a valid bridge path is found
 * This is called both at startup and when RCON connects
 */
async function tryStartPanelBridge(trigger = 'unknown') {
  if (panelBridge.isRunning) {
    log.debug(`Already running (trigger: ${trigger})`);
    return true;
  }
  
  const result = await findPanelBridgePath();
  
  if (result.error) {
    log.debug(`${result.error} (trigger: ${trigger})`);
    return false;
  }
  
  try {
    panelBridge.configure(result.path, true);
    panelBridge.start();
    log.info(`Started from ${result.source} (trigger: ${trigger})`);
    return true;
  } catch (error) {
    log.warn(`Failed to start - ${error.message}`);
    return false;
  }
}

// Auto-start PanelBridge when RCON connects (secondary trigger)
rconService.on('connected', async () => {
  log.info('RCON connected - checking PanelBridge...');
  await tryStartPanelBridge('rcon-connected');
});

rconService.on('disconnected', () => {
  // Optionally stop the bridge when RCON disconnects (server stopped)
  // Uncomment if you want bridge to stop when server stops:
  // if (panelBridge.isRunning) {
  //   panelBridge.stop();
  //   log.info('[PanelBridge] Stopped due to RCON disconnect');
  // }
});

// Emit PanelBridge status changes to connected clients via Socket.IO
panelBridge.on('started', () => {
  io.emit('panelBridge:status', { isRunning: true, bridgePath: panelBridge.bridgePath });
});

panelBridge.on('stopped', () => {
  io.emit('panelBridge:status', { isRunning: false, bridgePath: panelBridge.bridgePath });
});

panelBridge.on('modStatus', (status) => {
  io.emit('panelBridge:modStatus', status);
});

panelBridge.on('configured', ({ path }) => {
  io.emit('panelBridge:configured', { bridgePath: path });
});

// Make services available to routes
app.set('rconService', rconService);
app.set('serverManager', serverManager);
app.set('modChecker', modChecker);
app.set('scheduler', scheduler);
app.set('discordBot', discordBot);
app.set('backupService', backupService);
app.set('io', io);
app.set('refreshCorsConfig', refreshCorsConfig);
app.set('getCorsDebugSnapshot', getCorsDebugSnapshot);
app.set('clearCorsBlockedOrigins', clearCorsBlockedOrigins);

// Initialize update checker (needs io for socket events)
const updateChecker = new UpdateChecker(io);
app.set('updateChecker', updateChecker);

// Initialize panel self-update checker
const panelUpdateChecker = new PanelUpdateChecker(io);
app.set('panelUpdateChecker', panelUpdateChecker);

// Auth routes (must be before other API routes)
app.use('/api/auth', authRoutes);

// API Routes
app.use('/api/server', serverRoutes);
app.use('/api/servers', serversRoutes);
app.use('/api/server-files', serverFilesRoutes);
app.use('/api/players', playerRoutes);
app.use('/api/rcon', rconRoutes);
app.use('/api/config', configRoutes);
app.use('/api/scheduler', schedulerRoutes);
app.use('/api/mods', modsRoutes);
app.use('/api/chunks', chunksRoutes);
app.use('/api/discord', discordRoutes);
app.use('/api/debug', debugRoutes);
app.use('/api/server-finder', serverFinderRoutes);
app.use('/api/panel-bridge', panelBridgeRoutes);
app.use('/api/backup', backupRoutes);

// Health check + panel version
// In exe builds, PANEL_VERSION is injected by esbuild at compile time.
// In dev mode, fall back to reading package.json.
let _pkgVersion;
try {
  _pkgVersion = typeof PANEL_VERSION !== 'undefined' ? PANEL_VERSION : JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8')).version;
} catch { _pkgVersion = '0.0.0'; }
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: _pkgVersion, timestamp: new Date().toISOString() });
});



// Panel info - returns the panel's own address for remote access
app.get('/api/panel-info', async (req, res) => {
  const savedPort = await getSetting('panelPort');
  const PORT = process.env.PORT || savedPort || 3001;
  const localIp = serverManager.getLocalIp();
  res.json({ 
    localIp,
    port: parseInt(PORT, 10),
    url: `http://${localIp}:${PORT}`
  });
});

// Panel restart endpoint — restarts the panel process (works with exe or node)
app.post('/api/panel/restart', (req, res) => {
  log.info('Panel restart requested via API');
  res.json({ success: true, message: 'Panel is restarting...' });
  
  // Short delay so the response can be sent before exit
  setTimeout(() => {
    if (typeof process.pkg !== 'undefined') {
      // Running as packaged exe — spawn self then exit
      spawn(process.execPath, [], { detached: true, stdio: 'ignore' }).unref();
    }
    process.exit(0);
  }, 1000);
});

// Panel self-update endpoints
app.get('/api/panel/update-check', async (req, res) => {
  try {
    const checker = req.app.get('panelUpdateChecker');
    if (!checker) return res.status(500).json({ error: 'Panel update checker not available' });
    const status = await checker.checkForUpdate();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

app.get('/api/panel/update-status', (req, res) => {
  const checker = req.app.get('panelUpdateChecker');
  if (!checker) return res.status(500).json({ error: 'Panel update checker not available' });
  res.json(checker.getStatus());
});

app.post('/api/panel/update-download', async (req, res) => {
  try {
    const checker = req.app.get('panelUpdateChecker');
    if (!checker) return res.status(500).json({ error: 'Panel update checker not available' });
    const result = await checker.downloadUpdate();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Serve static files in production
// Detect if running as packaged exe (pkg sets process.pkg)
const isPackaged = typeof process.pkg !== 'undefined';
let clientDistPath;

if (isPackaged) {
  // When packaged, client/dist is next to the exe
  clientDistPath = path.join(path.dirname(process.execPath), 'client', 'dist');
} else {
  // Development mode
  clientDistPath = path.join(__dirname, '../client/dist');
}

log.debug(`Serving client from: ${clientDistPath}`);
// Serve hashed assets with long cache, HTML with no-cache
app.use(express.static(clientDistPath, {
  maxAge: '7d',
  immutable: true,
  setHeaders(res, filePath) {
    // HTML must not be cached — it references hashed assets
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// Global API error handler — sanitize internal details from error responses
// Must be defined before the catch-all route but after all API routes
app.use('/api', (err, req, res, next) => {
  log.error(`Unhandled API error on ${req.method} ${req.path}: ${err.message}`);
  const status = err.status || 500;
  res.status(status).json({ error: sanitizeError(err.message) });
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    res.status(404).json({ error: 'API endpoint not found' });
  } else {
    res.sendFile(path.join(clientDistPath, 'index.html'), (err) => {
      if (err) {
        log.error(`Failed to serve index.html: ${err.message}`);
        res.status(500).send('Page not available');
      }
    });
  }
});

// Socket.IO authentication middleware
io.use(async (socket, next) => {
  try {
    // Skip auth if no users exist (setup needed) or auth is disabled
    const needsSetup = await authService.needsSetup();
    if (needsSetup) return next();
    
    const authEnabled = await authService.isAuthEnabled();
    if (!authEnabled) return next();

    // Check for token in handshake auth or query params
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    const payload = await authService.authenticateAccessToken(token);
    if (!payload) {
      return next(new Error('Invalid or expired token'));
    }

    socket.user = payload;
    next();
  } catch (error) {
    next(new Error('Authentication error'));
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  log.debug(`Client connected: ${socket.id}${socket.user ? ` (${socket.user.username})` : ''}`);
  
  socket.on('disconnect', () => {
    log.debug(`Client disconnected: ${socket.id}`);
  });
  
  // Subscribe to server status updates
  socket.on('subscribe:status', () => {
    socket.join('server-status');
  });
  
  // Subscribe to player updates
  socket.on('subscribe:players', () => {
    socket.join('players');
  });
  
  // Subscribe to logs
  socket.on('subscribe:logs', () => {
    socket.join('logs');
  });
});

// Stream logs to Socket.IO clients
onLog((logEntry) => {
  addLogToBuffer(logEntry.level, logEntry.message, logEntry.source);
  io.to('logs').emit('log:entry', logEntry);
});

// ============================================
// Server-side player polling for real-time updates
// ============================================
let lastPlayerList = [];
let playerPollingInterval = null;

function startPlayerPolling() {
  // Poll every 5 seconds for player changes
  if (playerPollingInterval) {
    clearInterval(playerPollingInterval);
  }
  
  playerPollingInterval = setInterval(async () => {
    try {
      // Only poll if RCON is connected
      if (!rconService.connected) {
        return;
      }
      
      const result = await rconService.getPlayers();
      if (result.success && result.players) {
        // Check if player list has changed
        const currentNames = result.players.map(p => p.name).sort().join(',');
        const lastNames = lastPlayerList.map(p => p.name).sort().join(',');
        
        if (currentNames !== lastNames) {
          // Detect joins and leaves before updating the baseline
          const currentSet = new Set(result.players.map(p => p.name));
          const lastSet = new Set(lastPlayerList.map(p => p.name));
          const joined = result.players.filter(p => !lastSet.has(p.name));
          const left = lastPlayerList.filter(p => !currentSet.has(p.name));

          lastPlayerList = result.players;
          // Broadcast to all clients in the 'players' room
          io.to('players').emit('players:update', result.players);
          log.debug(`Player list updated: ${result.players.length} players online`);

          // Notify Discord — only after we have an established baseline (skip on
          // the very first poll so we don't fire spurious join events for players
          // who were already online before the panel started).
          if (lastSet.size > 0) {
            for (const p of joined) {
              discordBot.sendEventNotification('playerJoin', { player: p.name }).catch(() => {});
            }
            for (const p of left) {
              discordBot.sendEventNotification('playerLeave', { player: p.name }).catch(() => {});
            }
          }
        }
      }
    } catch (error) {
      // Silently ignore polling errors to avoid log spam
      log.debug(`Player polling error: ${error.message}`);
    }
  }, 5000);
  
  log.info('Server-side player polling started (5s interval)');
}

function stopPlayerPolling() {
  if (playerPollingInterval) {
    clearInterval(playerPollingInterval);
    playerPollingInterval = null;
    log.info('Server-side player polling stopped');
  }
}

// Initialize and start server
async function start() {
  try {
    // ── Banner ──
    let panelVersion;
    try {
      panelVersion = typeof PANEL_VERSION !== 'undefined' ? PANEL_VERSION : JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8')).version;
    } catch { panelVersion = '0.0.0'; }
    logBanner(panelVersion);

    // ── Database ──
    logSection('Database');
    await initDatabase();
    await refreshCorsConfig();
    log.info('Database ready');

    // ── Authentication ──
    await authService.init();
    const needsSetup = await authService.needsSetup();
    if (needsSetup) {
      log.info('No users found — first-run setup required');
    } else {
      const authEnabled = await authService.isAuthEnabled();
      log.info(`Authentication: ${authEnabled ? 'enabled' : 'disabled'}`);
    }

    // ── Services ──
    logSection('Services');

    // Initialize log tailer
    await logTailer.init();
    
    // Broadcast live chat messages to Socket.IO clients
    logTailer.on('chatMessage', (data) => {
        io.emit('chat:message', {
            id: Date.now().toString(),
            type: 'general', // Default to general for now
            author: data.author,
            message: data.message,
            timestamp: data.timestamp
        });
    });
    
    // Initialize scheduler first (needed by modChecker for auto-restart)
    await scheduler.init();
    
    // Initialize mod checker with scheduler, serverManager, and socket.io
    await modChecker.init(scheduler, serverManager, io);
    
    // Start mod checker if workshop ACF file is found
    if (modChecker.workshopAcfPath) {
      modChecker.start();
    } else {
      log.info('Mod checker: Workshop ACF not found — configure server install path');
    }
    
    // Initialize Discord bot
    await discordBot.loadConfig();
    const discordAutoStart = await getSetting('discordAutoStart');
    if (discordBot.token && discordBot.guildId && discordAutoStart !== false) {
      await discordBot.start();
    } else if (discordBot.token && discordBot.guildId && discordAutoStart === false) {
      log.info('Discord bot configured but auto-start is disabled');
    }
    
    // ── Server Detection ──
    logSection('Server Detection');

    // Check if PZ server is already running and auto-configure services
    // Run this in the background so it doesn't block server startup
    (async () => {
      try {
        // Wait a moment for everything to initialize
        await new Promise(r => setTimeout(r, 1000));
        
        // STEP 1: Try to start PanelBridge first (file-based, independent of RCON)
        // This works even if RCON isn't connected yet
        const bridgeStarted = await tryStartPanelBridge('startup');
        if (bridgeStarted) {
          log.info('PanelBridge started on startup (found active bridge files)');
        }
        
        // STEP 2: Check if PZ server is running and connect RCON
        const timeoutMs = 15000;
        const isRunning = await Promise.race([
          serverManager.checkServerRunning(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Server check timeout')), timeoutMs))
        ]);
        
        if (isRunning) {
          log.info('PZ server detected running - connecting RCON...');
          
          // Try to connect RCON with retries
          let connected = false;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              await Promise.race([
                rconService.connect(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('RCON connection timeout')), timeoutMs))
              ]);
              
              if (rconService.connected) {
                connected = true;
                log.info(`RCON connected on attempt ${attempt}`);
                break;
              }
            } catch (e) {
              log.debug(`RCON connection attempt ${attempt} failed: ${e.message}`);
              if (attempt < 3) {
                await new Promise(r => setTimeout(r, 5000)); // Wait 5s before retry
              }
            }
          }
          
          if (!connected) {
            log.warn('RCON connection failed after 3 attempts - auto-reconnect will keep trying');
          }
        } else {
          log.info('PZ server not detected running on startup');
          
          // Check if auto-start is enabled
          const autoStartServer = await getSetting('autoStartServer');
          if (autoStartServer === true || autoStartServer === 'true') {
            log.info('Auto-start is enabled - starting PZ server...');
            
            // Set flag to prevent auto-reconnect from interfering
            rconService.setServerStarting(true);
            
            try {
              const startResult = await serverManager.startServer();
              if (startResult.success) {
                log.info('PZ server auto-started successfully');
                
                // Wait for server to fully start before connecting RCON
                // Monitor the TCP port instead of hard waiting
                log.info('PZ server auto-started - Monitoring RCON port...');
                
                await rconService.loadConfig(); // Ensure clean config
                const rconHost = rconService.config.host || '127.0.0.1';
                const rconPort = rconService.config.port || 27015;
                
                let connected = false;
                const maxPollAttempts = 60; // 5 minutes max
                
                for (let i = 0; i < maxPollAttempts; i++) {
                  // Check port readiness
                  const portOpen = await rconService.checkPortOpen(rconHost, rconPort);
                  
                  if (!portOpen) {
                    // Log every 30s
                    if (i % 6 === 0) {
                      log.debug(`Auto-start: Waiting for RCON port ${rconHost}:${rconPort}...`);
                    }
                    await new Promise(r => setTimeout(r, 5000));
                    continue;
                  }
                  
                  // Port is open, try to connect
                  log.info(`RCON port open! Attempting connection...`);
                  
                  try {
                    await Promise.race([
                      rconService.connect(),
                      new Promise((_, reject) => setTimeout(() => reject(new Error('RCON connection timeout')), 15000))
                    ]);
                    
                    if (rconService.connected) {
                      log.info('RCON connected successfully after auto-start');
                      connected = true;
                      break;
                    } else {
                        // Port open but auth/handshake failed
                        log.debug('RCON port open but connection failed, retrying in 5s...');
                        await new Promise(r => setTimeout(r, 5000));
                    }
                  } catch (e) {
                    log.debug(`Auto-start RCON connection failed: ${e.message}`);
                    await new Promise(r => setTimeout(r, 5000));
                  }
                }
              } else {
                log.error('Failed to auto-start PZ server:', startResult.error);
              }
            } catch (e) {
              log.error('Error during auto-start:', e.message);
            } finally {
              // Clear the flag so auto-reconnect can resume normally
              rconService.setServerStarting(false);
            }
          }
          
          // Even if server isn't running, Panel Bridge might have stale files
          // The bridge will detect the mod isn't responding via status timestamp
        }
      } catch (e) {
        log.debug(`Startup initialization: ${e.message}`);
      }
    })();
    
    // Start server-side player polling for real-time updates
    startPlayerPolling();
    
    // Start update checker for server updates
    updateChecker.start();

    // Start panel self-update checker
    panelUpdateChecker.start(_pkgVersion);
    
    // Read panel port from DB (saved via Settings UI), fallback to env or 3001
    const savedPort = await getSetting('panelPort');
    const PORT = process.env.PORT || savedPort || 3001;
    
    // ── HTTPS Setup ──
    const httpsEnabled = await getSetting('httpsEnabled');
    const httpsPort = await getSetting('httpsPort') || 3443;
    const customKeyPath = await getSetting('httpsKeyPath');
    const customCertPath = await getSetting('httpsCertPath');
    
    if (httpsEnabled) {
      const certs = loadOrCreateCerts(customKeyPath, customCertPath);
      if (certs) {
        httpsServer = createHttpsServer(certs, app);
        // Add HTTPS origin to allowed list dynamically
        addAllowedOrigin(`https://localhost:${httpsPort}`);
        // Attach Socket.IO to HTTPS server too
        const httpsIo = new Server(httpsServer, {
          cors: {
            origin: (origin, callback) => {
              if (isAllowedOrigin(origin)) {
                callback(null, true);
              } else {
                callback(new Error('Not allowed by CORS'));
              }
            },
            methods: ['GET', 'POST'],
            credentials: true
          }
        });
        // Apply the same Socket.IO auth middleware on HTTPS
        httpsIo.use(async (socket, next) => {
          try {
            const needsSetup = await authService.needsSetup();
            if (needsSetup) return next();
            const authEnabled = await authService.isAuthEnabled();
            if (!authEnabled) return next();
            const token = socket.handshake.auth?.token || socket.handshake.query?.token;
            if (!token) return next(new Error('Authentication required'));
            const payload = await authService.authenticateAccessToken(token);
            if (!payload) return next(new Error('Invalid or expired token'));
            socket.user = payload;
            next();
          } catch (error) {
            next(new Error('Authentication error'));
          }
        });
        
        httpsServer.listen(httpsPort, () => {
          log.info(`HTTPS server listening on port ${httpsPort}`);
        });
      } else {
        log.warn('HTTPS enabled but certificate generation failed — running HTTP only');
      }
    }
    
    httpServer.listen(PORT, () => {
      logSection('Ready');
      const urls = [
        { label: 'Web UI:', url: `http://localhost:${PORT}` },
        { label: 'API:   ', url: `http://localhost:${PORT}/api` },
      ];
      if (httpsServer) {
        urls.push({ label: 'HTTPS: ', url: `https://localhost:${httpsPort}` });
      }
      logReady(urls);
      
      // Auto-open browser when running as packaged exe
      if (typeof process.pkg !== 'undefined') {
        const protocol = httpsServer ? 'https' : 'http';
        const port = httpsServer ? httpsPort : PORT;
        const url = `${protocol}://localhost:${port}`;

        // Skip auto-open on headless Linux (no display server)
        if (process.platform !== 'win32' && process.platform !== 'darwin' &&
            !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
          log.info(`Panel running at ${url} (no display detected — skipping browser open)`);
        } else {
          const openCmd = process.platform === 'win32' 
            ? `start "" "${url}"` 
            : process.platform === 'darwin' 
              ? `open "${url}"` 
              : `xdg-open "${url}"`;
          exec(openCmd, (err) => {
            if (err) log.error('Failed to open browser:', err);
          });
        }
      }
    });
  } catch (error) {
    log.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();

export { io };
