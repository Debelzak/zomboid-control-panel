import express from 'express';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../utils/logger.js';
const log = createLogger('API:Chunks');
import { getSetting, getActiveServer } from '../database/init.js';
import { sanitizeError } from '../utils/sanitize.js';

const router = express.Router();

// Block all chunk operations for remote servers (no local filesystem access)
router.use(async (req, res, next) => {
  try {
    const activeServer = await getActiveServer();
    if (activeServer?.isRemote) {
      return res.status(400).json({ error: 'Map cleanup is not available for remote servers. The server filesystem is not accessible from this panel.' });
    }
    next();
  } catch (err) {
    next(err);
  }
});

// Helper: Get zomboidDataPath from active server or legacy settings
async function getZomboidDataPath() {
  // First try active server (multi-server support)
  const activeServer = await getActiveServer();
  if (activeServer?.zomboidDataPath) {
    return activeServer.zomboidDataPath;
  }
  
  // Fallback to legacy settings
  const legacyPath = await getSetting('zomboidDataPath');
  return legacyPath || null;
}

function resolveSavesPath(zomboidDataPath) {
  let savesPath = path.join(zomboidDataPath, 'Saves', 'Multiplayer');

  if (!fs.existsSync(savesPath)) {
    const basename = path.basename(zomboidDataPath);
    const parentBase = path.basename(path.dirname(zomboidDataPath));
    if (basename === 'Multiplayer' && parentBase === 'Saves') {
      savesPath = zomboidDataPath;
    } else if (basename === 'Saves') {
      savesPath = path.join(zomboidDataPath, 'Multiplayer');
    }
  }

  return savesPath;
}

function resolveCustomOrDefaultDataPath(customPath) {
  if (!customPath) return null;
  const normalized = path.resolve(customPath);
  if (!fs.existsSync(normalized)) {
    const error = new Error('Custom path does not exist');
    error.statusCode = 400;
    throw error;
  }
  // Validate the path looks like a Zomboid data directory to prevent arbitrary filesystem access.
  // Must contain a Saves or Server subdirectory, or itself be inside a Zomboid-related path.
  const lower = normalized.toLowerCase().replace(/\\/g, '/');
  const hasSavesDir = fs.existsSync(path.join(normalized, 'Saves'));
  const isInsideSavesDir = lower.includes('/saves');
  const hasZomboidMarker = lower.includes('zomboid') || lower.includes('projectzomboid');
  if (!hasSavesDir && !isInsideSavesDir && !hasZomboidMarker) {
    const error = new Error('Path does not appear to be a Zomboid data directory');
    error.statusCode = 403;
    throw error;
  }
  return normalized;
}

// Get list of available saves
router.get('/saves', async (req, res) => {
  try {
    // Support custom path override from query parameter
    const customPath = req.query.customPath ? String(req.query.customPath) : null;
    
    let zomboidDataPath;
    if (customPath) {
      // Validate custom path exists and is a directory
      const normalized = resolveCustomOrDefaultDataPath(customPath);
      zomboidDataPath = normalized;
      log.info(`[ChunkCleaner] Using custom path: ${normalized}`);
    } else {
      zomboidDataPath = await getZomboidDataPath();
    }
    
    if (!zomboidDataPath) {
      return res.status(400).json({ error: 'Zomboid data path not set. Configure a server first.' });
    }
    
    // Try the standard path first, then check if the path IS a Saves/Multiplayer dir directly
    let savesPath = resolveSavesPath(zomboidDataPath);
    
    if (!fs.existsSync(savesPath)) {
      // Maybe the user pointed directly to Saves/Multiplayer
      const basename = path.basename(zomboidDataPath);
      const parentBase = path.basename(path.dirname(zomboidDataPath));
      if (basename === 'Multiplayer' && parentBase === 'Saves') {
        savesPath = zomboidDataPath;
        log.info(`[ChunkCleaner] Path points directly to Saves/Multiplayer`);
      } else if (basename === 'Saves') {
        savesPath = path.join(zomboidDataPath, 'Multiplayer');
        log.info(`[ChunkCleaner] Path points directly to Saves dir`);
      } else {
        log.warn(`[ChunkCleaner] Saves path not found: ${savesPath}`);
        log.info(`[ChunkCleaner] zomboidDataPath: ${zomboidDataPath}`);
        return res.json({ saves: [] });
      }
    }
    
    if (!fs.existsSync(savesPath)) {
      log.warn(`[ChunkCleaner] Resolved saves path does not exist: ${savesPath}`);
      return res.json({ saves: [] });
    }
    
    log.info(`[ChunkCleaner] Listing saves from: ${savesPath}`);
    
    const entries = await fs.promises.readdir(savesPath, { withFileTypes: true });
    const directories = entries.filter(d => d.isDirectory());
    
    log.info(`[ChunkCleaner] Found ${directories.length} save directories: ${directories.map(d => d.name).join(', ')}`);
    
    const saves = await Promise.all(directories
      .map(async d => {
        const savePath = path.join(savesPath, d.name);
        const stats = await fs.promises.stat(savePath);
        
        // Count chunk files (uses recursive count for B42's subdirectory structure)
        // Also check save root for B41 flat chunk files
        let chunkCount = 0;
        const mapPath = path.join(savePath, 'map');
        if (fs.existsSync(mapPath)) {
          chunkCount = await countFiles(mapPath);
        }
        if (chunkCount === 0) {
          // B41 fallback: count map_X_Y.bin files in save root
          const B41_CHUNK_REGEX = /^map_\d+_\d+\.bin$/i;
          try {
            const rootEntries = await fs.promises.readdir(savePath);
            chunkCount = rootEntries.filter(f => B41_CHUNK_REGEX.test(f)).length;
          } catch (e) {
            log.debug(`B41 chunk count fallback failed for ${savePath}: ${e.message}`);
          }
        }
        
        // Get save size
        const size = await getDirSize(savePath);
        
        return {
          name: d.name,
          modified: stats.mtime,
          chunkCount,
          size,
          sizeFormatted: formatBytes(size)
        };
      }));
    
    res.json({ saves });
  } catch (error) {
    log.error(`Failed to get saves: ${error.message}`);
    res.status(error.statusCode || 500).json({ error: sanitizeError(error.message) });
  }
});

// Get chunk data for a specific save
router.get('/chunks/:saveName', async (req, res) => {
  try {
    const { saveName } = req.params;
    const customPath = req.query.customPath ? String(req.query.customPath) : null;
    
    // Sanitize saveName to prevent path traversal
    const sanitizedSaveName = path.basename(saveName);
    if (!sanitizedSaveName || sanitizedSaveName !== saveName) {
      return res.status(400).json({ error: 'Invalid save name' });
    }
    
    let zomboidDataPath;
    if (customPath) {
      zomboidDataPath = resolveCustomOrDefaultDataPath(String(customPath));
    } else {
      zomboidDataPath = await getZomboidDataPath();
    }
    
    if (!zomboidDataPath) {
      return res.status(400).json({ error: 'Zomboid data path not set' });
    }
    
    // Resolve the saves path the same way as /saves
    let savesPath = resolveSavesPath(zomboidDataPath);
    
    const savePath = path.join(savesPath, sanitizedSaveName);
    const mapPath = path.join(savePath, 'map');
    
    log.info(`[ChunkCleaner] Loading chunks for "${sanitizedSaveName}" from: ${mapPath}`);
    
    if (!fs.existsSync(savePath)) {
      log.warn(`[ChunkCleaner] Save directory not found: ${savePath}`);
      return res.json({ chunks: [], bounds: null });
    }
    
    const chunks = [];
    const seenChunkCoords = new Set();
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let totalChunks = 0;
    
    const mapExists = fs.existsSync(mapPath);
    
    // B42 uses subdirectory structure: map/{X}/{Y}.bin
    // B41 may use flat files inside map/ OR flat files in the save root
    let mapContents = [];
    let xDirs = [];
    let flatBinFiles = [];
    
    if (mapExists) {
      mapContents = await fs.promises.readdir(mapPath, { withFileTypes: true });
      xDirs = mapContents.filter(d => d.isDirectory() && /^\d+$/.test(d.name));
      flatBinFiles = mapContents.filter(f => f.isFile() && f.name.endsWith('.bin'));
    }
    
    log.info(`[ChunkCleaner] map/ ${mapExists ? 'exists' : 'missing'}: ${mapContents.length} entries, ${xDirs.length} numeric dirs (B42), ${flatBinFiles.length} flat .bin files (B41)`);
    
    const rememberChunkCoord = (x, y) => {
      const key = `${x},${y}`;
      if (seenChunkCoords.has(key)) return false;
      seenChunkCoords.add(key);
      totalChunks++;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      return true;
    };
    
    if (xDirs.length > 0) {
      // B42 structure: map/{X}/{Y}.bin
      // Use sequential directory scans to avoid overwhelming the filesystem.
      let totalBinFiles = 0;
      let totalNonBinFiles = 0;
      let sampleNonBinFiles = [];
      let emptyDirs = 0;
      
      for (const xDir of xDirs) {
        const x = parseInt(xDir.name, 10);
        const xPath = path.join(mapPath, xDir.name);
        
        try {
          // Read Y files in this X directory
          const yEntries = await fs.promises.readdir(xPath, { withFileTypes: true });
          // Only process files (skip subdirectories inside chunk dirs)
          const yFiles = yEntries.filter(e => e.isFile()).map(e => e.name);
          
          if (yFiles.length === 0) {
            emptyDirs++;
            continue;
          }
          
          const binFiles = yFiles.filter(f => f.endsWith('.bin'));
          const nonBinFiles = yFiles.filter(f => !f.endsWith('.bin'));
          totalBinFiles += binFiles.length;
          totalNonBinFiles += nonBinFiles.length;
          if (nonBinFiles.length > 0 && sampleNonBinFiles.length < 5) {
            sampleNonBinFiles.push(...nonBinFiles.slice(0, 3).map(f => `${xDir.name}/${f}`));
          }

          const chunkEntries = [];
          for (const yFile of binFiles) {
            const yMatch = yFile.match(/^(\d+)\.bin$/);
            if (!yMatch) continue;

            const y = parseInt(yMatch[1], 10);
            if (!rememberChunkCoord(x, y)) continue;

            chunkEntries.push({ x, y, yFile });
          }

          const results = await Promise.all(chunkEntries.map(async ({ x, y, yFile }) => {
            const filePath = path.join(xPath, yFile);

            try {
              const stats = await fs.promises.stat(filePath);
              return {
                file: `${x}/${yFile}`,
                x,
                y,
                size: stats.size,
                modified: stats.mtime
              };
            } catch (e) {
              log.debug(`Stat failed for chunk ${x}/${yFile}: ${e.message}`);
              return null;
            }
          }));

          for (const chunk of results) {
            if (chunk) chunks.push(chunk);
          }

        } catch (err) {
          log.warn(`Error reading chunk directory ${xPath}: ${err.message}`);
        }
      }
      
      // Diagnostic: log what was found inside the B42 dirs
      log.info(`[ChunkCleaner] B42 scan: ${totalChunks} chunks loaded, ${totalBinFiles} .bin files, ${emptyDirs} empty dirs, ${totalNonBinFiles} non-.bin files${sampleNonBinFiles.length > 0 ? ' (samples: ' + sampleNonBinFiles.join(', ') + ')' : ''}`);
    } else {
      // Legacy flat file structure: map_X_Y.bin or X_Y.bin
      const files = mapContents.filter(f => f.isFile() && f.name.endsWith('.bin')).map(f => f.name);

      const chunkEntries = [];
      for (const file of files) {
        // Common formats: map_X_Y.bin, chunkdata_X_Y.bin, X_Y.bin
        const match = file.match(/(?:map_|chunkdata_|chunk_)?(\d+)_(\d+)(?:_\d+)?\.bin$/i);
        if (match) {
          const x = parseInt(match[1], 10);
          const y = parseInt(match[2], 10);
          if (!rememberChunkCoord(x, y)) continue;

          chunkEntries.push({ file, x, y });
        }
      }

      const legacyResults = await Promise.all(chunkEntries.map(async ({ file, x, y }) => {
        try {
          const stats = await fs.promises.stat(path.join(mapPath, file));
          return {
            file,
            x,
            y,
            size: stats.size,
            modified: stats.mtime
          };
        } catch (e) {
          log.debug(`Stat failed for legacy chunk ${file}: ${e.message}`);
          return null;
        }
      }));

      for (const res of legacyResults) {
        if (res) {
          chunks.push(res);
        }
      }
    }
    
    // B41 fallback: if map/ didn't yield any chunks, check save root for
    // flat chunk files like map_X_Y.bin (common B41 save layout).
    let isB42 = xDirs.length > 0;
    
    // Secondary B42 detection: if map/ is empty (no subdirs, no flat files),
    // check for B42-specific files in the save root. B42 saves have files like
    // WorldDictionary.bin, global_mod_data.bin, entity_data.bin that B41 doesn't.
    if (!isB42 && chunks.length === 0) {
      const b42Indicators = ['WorldDictionary.bin', 'global_mod_data.bin', 'entity_data.bin'];
      const hasB42Files = b42Indicators.some(f => fs.existsSync(path.join(savePath, f)));
      if (hasB42Files) {
        isB42 = true;
        log.info(`[ChunkCleaner] Detected B42 save via indicator files (map/ is empty)`);
      }
    }
    
    if (!isB42 && totalChunks === 0) {
      const B41_CHUNK_REGEX = /^map_(\d+)_(\d+)\.bin$/i;
      const rootEntries = await fs.promises.readdir(savePath, { withFileTypes: true });
      const rootBinFiles = rootEntries.filter(f => f.isFile() && B41_CHUNK_REGEX.test(f.name));
      
      if (rootBinFiles.length > 0) {
        log.info(`[ChunkCleaner] Found ${rootBinFiles.length} B41 chunk files in save root`);

        const chunkEntries = [];
        for (const entry of rootBinFiles) {
          const match = entry.name.match(B41_CHUNK_REGEX);
          if (!match) continue;

          const x = parseInt(match[1], 10);
          const y = parseInt(match[2], 10);
          if (!rememberChunkCoord(x, y)) continue;

          chunkEntries.push({ entry, x, y });
        }

        const rootResults = await Promise.all(chunkEntries.map(async ({ entry, x, y }) => {
          try {
            const stats = await fs.promises.stat(path.join(savePath, entry.name));
            return { file: entry.name, x, y, size: stats.size, modified: stats.mtime, source: 'saveroot' };
          } catch (e) {
            log.debug(`Stat failed for B41 root chunk ${entry.name}: ${e.message}`);
            return null;
          }
        }));

        for (const res of rootResults) {
          if (res) {
            chunks.push(res);
          }
        }
      }
    }
    
    // Also check chunkdata folder for additional chunk data.
    // In B41 saves, chunkdata coords match chunk coords directly.
    // In B42 saves, chunkdata uses CELL coordinates and is converted here to
    // native B42 chunk coordinates (× 32). Original cell coords are preserved
    // in cellX/cellY for deletion operations.
    {
      const chunkDataPath = path.join(savePath, 'chunkdata');
      if (fs.existsSync(chunkDataPath)) {
        const chunkDataFiles = await fs.promises.readdir(chunkDataPath);
        const validFiles = chunkDataFiles.filter(f => f.endsWith('.bin'));

        const chunkEntries = [];
        for (const file of validFiles) {
          const match = file.match(/(\d+)_(\d+)(?:_\d+)?\.bin$/i);
          if (match) {
            const rawX = parseInt(match[1], 10);
            const rawY = parseInt(match[2], 10);
            
            const displayX = isB42 ? rawX * 32 : rawX * 30;
            const displayY = isB42 ? rawY * 32 : rawY * 30;

            if (!rememberChunkCoord(displayX, displayY)) continue;

            chunkEntries.push({ file, rawX, rawY, displayX, displayY });
          }
        }

        const chunkDataResults = await Promise.all(chunkEntries.map(async ({ file, rawX, rawY, displayX, displayY }) => {
          try {
            const stats = await fs.promises.stat(path.join(chunkDataPath, file));
            return {
              file,
              x: displayX,
              y: displayY,
              size: stats.size,
              modified: stats.mtime,
              source: 'chunkdata',
              cellX: rawX,
              cellY: rawY
            };
          } catch (e) {
            log.debug(`Stat failed for chunkdata ${file}: ${e.message}`);
            return null;
          }
        }));

        for (const res of chunkDataResults) {
          if (res) {
            chunks.push(res);
          }
        }
      }
    }
    
    const bounds = chunks.length > 0 ? { minX, maxX, minY, maxY } : null;
    
    // Sort chunks by coordinate for consistent rendering order
    chunks.sort((a, b) => a.x - b.x || a.y - b.y);
    
    res.json({
      saveName,
      chunks,
      shownChunks: chunks.length,
      totalChunks,
      bounds,
      limitReached: false,
      maxChunks: null,
      isB42
    });
  } catch (error) {
    log.error(`Failed to get chunks: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Delete selected chunks
router.post('/delete-chunks', async (req, res) => {
  try {
    const { saveName, chunks, createBackup = true, customPath = null } = req.body;
    log.info(`POST /delete-chunks: saveName=${saveName}, chunkCount=${chunks?.length || 0}, createBackup=${createBackup}`);
    
    if (!saveName || !chunks || !Array.isArray(chunks) || chunks.length === 0) {
      return res.status(400).json({ error: 'Save name and chunks array required' });
    }
    
    // Sanitize saveName to prevent path traversal
    const sanitizedSaveName = path.basename(saveName);
    if (!sanitizedSaveName || sanitizedSaveName !== saveName) {
      return res.status(400).json({ error: 'Invalid save name' });
    }
    
    // Validate chunk files to prevent path traversal
    // B42 uses format: {X}/{Y}.bin (e.g., "1000/1208.bin")
    // Legacy uses format: map_X_Y.bin or X_Y.bin
    for (const chunk of chunks) {
      if (!chunk.file) {
        return res.status(400).json({ error: 'Invalid chunk file name' });
      }
      // Validate the path doesn't contain traversal attempts
      const normalized = path.normalize(chunk.file);
      if (normalized.includes('..') || path.isAbsolute(normalized)) {
        return res.status(400).json({ error: 'Invalid chunk file path' });
      }
      // Validate chunk coordinates are integers to prevent path traversal
      // chunk.x and chunk.y are used in template literals to build file paths
      // for chunkdata/isoregiondata/zpop deletion — non-integer values could
      // inject path separators and ".." sequences
      if (chunk.x !== undefined && chunk.x !== null) {
        const nx = Number(chunk.x);
        if (!Number.isFinite(nx) || !Number.isInteger(nx)) {
          return res.status(400).json({ error: 'Invalid chunk x coordinate — must be an integer' });
        }
        chunk.x = nx;
      }
      if (chunk.y !== undefined && chunk.y !== null) {
        const ny = Number(chunk.y);
        if (!Number.isFinite(ny) || !Number.isInteger(ny)) {
          return res.status(400).json({ error: 'Invalid chunk y coordinate — must be an integer' });
        }
        chunk.y = ny;
      }
    }
    
    // Compute cell coordinates for related file cleanup (chunkdata/zpop/isoregion use cell coords, not chunk coords)
    // B42: 1 cell = 32×32 chunks, B41: 1 cell = 30×30 chunks
    const isB42 = chunks.some(c => c.file && c.file.includes('/'));
    const cellDivisor = isB42 ? 32 : 30;
    for (const chunk of chunks) {
      if (chunk.source === 'chunkdata' && chunk.cellX === undefined) {
        // Parse cell coords from chunkdata filename: chunkdata_X_Y.bin
        const cdMatch = chunk.file.match(/(\d+)_(\d+)/);
        if (cdMatch) {
          chunk.cellX = parseInt(cdMatch[1], 10);
          chunk.cellY = parseInt(cdMatch[2], 10);
        }
      }
      // For map-source chunks, convert chunk coords → cell coords
      if (chunk.cellX === undefined) chunk.cellX = Math.floor(chunk.x / cellDivisor);
      if (chunk.cellY === undefined) chunk.cellY = Math.floor(chunk.y / cellDivisor);
    }
    
    const zomboidDataPath = customPath
      ? resolveCustomOrDefaultDataPath(String(customPath))
      : await getZomboidDataPath();
    if (!zomboidDataPath) {
      return res.status(400).json({ error: 'Zomboid data path not set' });
    }

    const savesPath = resolveSavesPath(zomboidDataPath);
    const savePath = path.join(savesPath, sanitizedSaveName);
    
    if (!fs.existsSync(savePath)) {
      return res.status(404).json({ error: 'Save not found' });
    }
    
    // Create backup if requested
    if (createBackup) {
      const backupPath = path.join(zomboidDataPath, 'backups', `${sanitizedSaveName}_chunks_${Date.now()}`);
      await fs.promises.mkdir(backupPath, { recursive: true });
      
      // Backup only the chunks we're about to delete
      // Do this in parallel but with error handling
      await Promise.all(chunks.map(async chunk => {
        try {
            // Determine source file location
            const mapFile = chunk.source === 'saveroot'
              ? path.join(savePath, chunk.file)
              : path.join(savePath, 'map', chunk.file);
            // Use try/catch for existence check + copy to avoid race conditions
            try {
                // Handle B42's subdirectory structure (e.g., "1000/1208.bin" -> "map_1000_1208.bin")
                const backupName = `map_${chunk.file.replace(/[/\\]/g, '_')}`;
                await fs.promises.copyFile(mapFile, path.join(backupPath, backupName), fs.constants.COPYFILE_EXCL);
            } catch (e) {
                // Ignore ENOENT (file not found), effectively "if exists"
                if (e.code !== 'ENOENT') throw e;
            }
            
            // Also backup from chunkdata if exists
            if (chunk.source === 'chunkdata') {
              const chunkDataFile = path.join(savePath, 'chunkdata', chunk.file);
              try {
                  const backupName = `chunkdata_${chunk.file.replace(/[/\\]/g, '_')}`;
                  await fs.promises.copyFile(chunkDataFile, path.join(backupPath, backupName), fs.constants.COPYFILE_EXCL);
              } catch (e) {
                  if (e.code !== 'ENOENT') throw e;
              }
            }
        } catch (e) {
            log.warn(`Failed to backup chunk ${chunk.file}: ${e.message}`);
        }
      }));
      
      log.info(`Created chunk backup at ${backupPath}`);
    }
    
    // Delete chunks
    let deleted = 0;
    let errors = [];
    
    // Process deletions in parallel
    const deleteResults = await Promise.all(chunks.map(async chunk => {
      let wasDeleted = false;
      const chunkErrors = [];
      
      try {
        // For chunkdata-source chunks, the primary file is in chunkdata/ not map/
        if (chunk.source === 'chunkdata') {
          // Primary: delete from chunkdata/
          const fileX = chunk.cellX !== undefined ? chunk.cellX : chunk.x;
          const fileY = chunk.cellY !== undefined ? chunk.cellY : chunk.y;
          const chunkDataFile = path.join(savePath, 'chunkdata', `chunkdata_${fileX}_${fileY}.bin`);
          try {
            await fs.promises.unlink(chunkDataFile);
            wasDeleted = true;
          } catch (e) {
            if (e.code !== 'ENOENT') chunkErrors.push(`chunkdata: ${e.message}`);
          }
          
          // Also clean up related isoregiondata/zpop
          const isoFile = path.join(savePath, 'isoregiondata', `datachunk_${fileX}_${fileY}.bin`);
          try { await fs.promises.unlink(isoFile); } catch (e) {
            if (e.code !== 'ENOENT') log.debug(`Failed to delete isoregiondata ${fileX}_${fileY}: ${e.message}`);
          }
          const zpopFile = path.join(savePath, 'zpop', `zpop_${fileX}_${fileY}.bin`);
          try { await fs.promises.unlink(zpopFile); } catch (e) {
            if (e.code !== 'ENOENT') log.debug(`Failed to delete zpop ${fileX}_${fileY}: ${e.message}`);
          }
        } else {
          // Delete from the correct location based on source
          let mapFile;
          if (chunk.source === 'saveroot') {
            // B41 flat file in save root directory
            mapFile = path.join(savePath, chunk.file);
          } else {
            // Default: map/ directory (both B42 subdirs and B41 flat files in map/)
            mapFile = path.join(savePath, 'map', chunk.file);
          }
          try {
              await fs.promises.unlink(mapFile);
              wasDeleted = true;
          } catch (e) {
              // Ignore if file doesn't exist
              if (e.code !== 'ENOENT') chunkErrors.push(e.message);
          }
          
          // Related data folders use flat file naming: prefix_X_Y.bin
          // Unlike map/ which uses B42's subdirectory structure (X/Y.bin)
          // For B42 chunkdata-only entries, use original cell coords (cellX/cellY)
          // since those map to the actual file names on disk.
          const fileX = chunk.cellX !== undefined ? chunk.cellX : chunk.x;
          const fileY = chunk.cellY !== undefined ? chunk.cellY : chunk.y;
          const chunkDataFile = path.join(savePath, 'chunkdata', `chunkdata_${fileX}_${fileY}.bin`);
          try { await fs.promises.unlink(chunkDataFile); wasDeleted = wasDeleted || true; } catch (e) {
            if (e.code !== 'ENOENT') log.debug(`Failed to delete chunkdata ${fileX}_${fileY}: ${e.message}`);
          }
          
          // isoregiondata uses datachunk_X_Y.bin format
          const isoFile = path.join(savePath, 'isoregiondata', `datachunk_${fileX}_${fileY}.bin`);
          try { await fs.promises.unlink(isoFile); } catch (e) {
            if (e.code !== 'ENOENT') log.debug(`Failed to delete isoregiondata ${fileX}_${fileY}: ${e.message}`);
          }
          
          // zpop uses zpop_X_Y.bin format
          const zpopFile = path.join(savePath, 'zpop', `zpop_${fileX}_${fileY}.bin`);
          try { await fs.promises.unlink(zpopFile); } catch (e) {
            if (e.code !== 'ENOENT') log.debug(`Failed to delete zpop ${fileX}_${fileY}: ${e.message}`);
          }
        }
        
        return { success: true, wasDeleted };
      } catch (err) {
        return { success: false, error: err.message, file: chunk.file };
      }
    }));

    for (const res of deleteResults) {
        if (res.success) {
            if (res.wasDeleted) deleted++;
        } else {
            errors.push(`${res.file}: ${res.error}`);
        }
    }
    
    // Clean up empty X directories after B42 chunk deletion
    const deletedXDirs = new Set();
    for (const chunk of chunks) {
      const parts = chunk.file.split('/');
      if (parts.length === 2) deletedXDirs.add(parts[0]);
    }
    for (const xDir of deletedXDirs) {
      try {
        const xPath = path.join(savePath, 'map', xDir);
        const remaining = await fs.promises.readdir(xPath);
        if (remaining.length === 0) await fs.promises.rmdir(xPath);
      } catch (e) { /* ignore */ }
    }
    
    log.info(`Deleted ${deleted} chunks from save ${sanitizedSaveName}`);
    
    res.json({
      success: true,
      deleted,
      errors: errors.length > 0 ? errors : undefined,
      backupCreated: createBackup
    });
  } catch (error) {
    log.error(`Failed to delete chunks: ${error.message}`);
    res.status(error.statusCode || 500).json({ error: sanitizeError(error.message) });
  }
});

// Delete chunks by region (x/y coordinate range)
router.post('/delete-region', async (req, res) => {
  try {
    const { saveName, minX, maxX, minY, maxY, createBackup = true, invert = false, customPath = null } = req.body;
    
    if (!saveName || minX === undefined || maxX === undefined || minY === undefined || maxY === undefined) {
      return res.status(400).json({ error: 'Save name and region bounds required' });
    }
    
    // Sanitize saveName to prevent path traversal
    const sanitizedSaveName = path.basename(saveName);
    if (!sanitizedSaveName || sanitizedSaveName !== saveName) {
      return res.status(400).json({ error: 'Invalid save name' });
    }
    
    // Validate bounds are numbers
    if (typeof minX !== 'number' || typeof maxX !== 'number' || 
        typeof minY !== 'number' || typeof maxY !== 'number') {
      return res.status(400).json({ error: 'Region bounds must be numbers' });
    }
    
    const zomboidDataPath = customPath
      ? resolveCustomOrDefaultDataPath(String(customPath))
      : await getZomboidDataPath();
    if (!zomboidDataPath) {
      return res.status(400).json({ error: 'Zomboid data path not set' });
    }

    const savesPath = resolveSavesPath(zomboidDataPath);
    const savePath = path.join(savesPath, sanitizedSaveName);
    const mapPath = path.join(savePath, 'map');
    
    if (!fs.existsSync(savePath)) {
      return res.status(404).json({ error: 'Save not found' });
    }
    
    const mapExists = fs.existsSync(mapPath);
    
    // Get all chunks - handle B42 directory structure, B41 flat files in map/, and B41 flat files in save root
    const chunksToDelete = [];
    let mapContents = [];
    let xDirs = [];
    
    if (mapExists) {
      mapContents = await fs.promises.readdir(mapPath, { withFileTypes: true });
      xDirs = mapContents.filter(d => d.isDirectory() && /^\d+$/.test(d.name));
    }
    
    if (xDirs.length > 0) {
      // B42 structure: map/{X}/{Y}.bin
      await Promise.all(xDirs.map(async xDir => {
        const x = parseInt(xDir.name, 10);
        // Quick AABB check: if entire X row is out of X bounds, skip it
        if (!invert && (x < minX || x > maxX)) return;
        
        const xPath = path.join(mapPath, xDir.name);
        
        try {
          const yFiles = await fs.promises.readdir(xPath);
          const binFiles = yFiles.filter(f => f.endsWith('.bin'));
          
          for (const yFile of binFiles) {
            const yMatch = yFile.match(/^(\d+)\.bin$/);
            if (yMatch) {
              const y = parseInt(yMatch[1], 10);
              
              const inRegion = x >= minX && x <= maxX && y >= minY && y <= maxY;
              const shouldDelete = invert ? !inRegion : inRegion;
              
              if (shouldDelete) {
                chunksToDelete.push({ file: `${x}/${yFile}`, x, y });
              }
            }
          }
        } catch (err) {
          log.warn(`Error reading chunk directory ${xPath}: ${err.message}`);
        }
      }));
    } else {
      // Legacy flat file structure in map/ directory
      const files = mapContents.filter(f => f.isFile() && f.name.endsWith('.bin')).map(f => f.name);
      
      for (const file of files) {
        const match = file.match(/(?:map_|chunkdata_|chunk_)?(\d+)_(\d+)(?:_\d+)?\.bin$/i);
        if (match) {
          const x = parseInt(match[1], 10);
          const y = parseInt(match[2], 10);
          
          const inRegion = x >= minX && x <= maxX && y >= minY && y <= maxY;
          const shouldDelete = invert ? !inRegion : inRegion;
          
          if (shouldDelete) {
            chunksToDelete.push({ file, x, y });
          }
        }
      }
      
      // B41 save-root fallback: check for map_X_Y.bin in save root
      if (chunksToDelete.length === 0) {
        const B41_CHUNK_REGEX = /^map_(\d+)_(\d+)\.bin$/i;
        const rootEntries = await fs.promises.readdir(savePath, { withFileTypes: true });
        const rootBinFiles = rootEntries.filter(f => f.isFile() && B41_CHUNK_REGEX.test(f.name));
        
        for (const entry of rootBinFiles) {
          const match = entry.name.match(B41_CHUNK_REGEX);
          if (match) {
            const x = parseInt(match[1], 10);
            const y = parseInt(match[2], 10);
            
            const inRegion = x >= minX && x <= maxX && y >= minY && y <= maxY;
            const shouldDelete = invert ? !inRegion : inRegion;
            
            if (shouldDelete) {
              chunksToDelete.push({ file: entry.name, x, y, source: 'saveroot' });
            }
          }
        }
      }
    }
    
    if (chunksToDelete.length === 0) {
      return res.json({ success: true, deleted: 0, message: 'No chunks in selected region' });
    }
    
    // Safety limit to prevent accidental mass deletion
    if (chunksToDelete.length > 100000) {
      return res.status(400).json({ 
        error: `Region too large (${chunksToDelete.length.toLocaleString()} chunks). Maximum is 100,000 at a time.` 
      });
    }
    
    // Create backup if requested
    if (createBackup) {
      const backupPath = path.join(zomboidDataPath, 'backups', `${sanitizedSaveName}_region_${Date.now()}`);
      await fs.promises.mkdir(backupPath, { recursive: true });
      
      // Parallel backup
      await Promise.all(chunksToDelete.map(async chunk => {
        const srcFile = chunk.source === 'saveroot'
          ? path.join(savePath, chunk.file)
          : path.join(mapPath, chunk.file);
        try {
             const backupName = `map_${chunk.file.replace(/[/\\]/g, '_')}`;
             await fs.promises.copyFile(srcFile, path.join(backupPath, backupName));
        } catch (e) {
            // Ignore missing files or errors
        }
      }));
      
      // Save region info
      await fs.promises.writeFile(
        path.join(backupPath, 'region_info.json'),
        JSON.stringify({ minX, maxX, minY, maxY, invert, chunksDeleted: chunksToDelete.length }, null, 2)
      );
      
      log.info(`Created region backup at ${backupPath}`);
    }
    
    // Delete chunks
    let deleted = 0;
    
    await Promise.all(chunksToDelete.map(async chunk => {
      try {
        const chunkFile = chunk.source === 'saveroot'
          ? path.join(savePath, chunk.file)
          : path.join(mapPath, chunk.file);
        await fs.promises.unlink(chunkFile);
        // Atomic increment? JS is single threaded event loop, so yes this is safe.
        // But `deleted` is a simple var captured in closure.
        // It's safe in Node.js main thread.
        deleted++;
        
        // Related data folders use CELL coordinates, not chunk coordinates
        // B42: 1 cell = 32×32 chunks, B41: 1 cell = 30×30 chunks
        const regionIsB42 = xDirs.length > 0;
        const regionCellDiv = regionIsB42 ? 32 : 30;
        const cellX = Math.floor(chunk.x / regionCellDiv);
        const cellY = Math.floor(chunk.y / regionCellDiv);
        const relatedFiles = [
          { folder: 'chunkdata', file: `chunkdata_${cellX}_${cellY}.bin` },
          { folder: 'isoregiondata', file: `datachunk_${cellX}_${cellY}.bin` },
          { folder: 'zpop', file: `zpop_${cellX}_${cellY}.bin` }
        ];
        
        await Promise.all(relatedFiles.map(async ({ folder, file }) => {
            try {
                const relatedPath = path.join(savePath, folder, file);
                await fs.promises.unlink(relatedPath);
            } catch(e) {
              if (e.code !== 'ENOENT') log.debug(`Failed to delete related ${folder}/${file}: ${e.message}`);
            }
        }));
      } catch (err) {
        log.warn(`Failed to delete chunk ${chunk.file}: ${err.message}`);
      }
    }));
    
    // Clean up empty X directories after B42 chunk deletion
    const deletedXDirs = new Set();
    for (const chunk of chunksToDelete) {
      const parts = chunk.file.split('/');
      if (parts.length === 2) deletedXDirs.add(parts[0]);
    }
    for (const xDir of deletedXDirs) {
      try {
        const xDirPath = path.join(mapPath, xDir);
        const remaining = await fs.promises.readdir(xDirPath);
        if (remaining.length === 0) await fs.promises.rmdir(xDirPath);
      } catch (e) {
        if (e.code !== 'ENOENT') log.debug(`Failed to clean up empty dir ${xDir}: ${e.message}`);
      }
    }
    
    log.info(`Deleted ${deleted} chunks in region [${minX},${minY}]-[${maxX},${maxY}] from ${sanitizedSaveName}`);
    
    res.json({
      success: true,
      deleted,
      region: { minX, maxX, minY, maxY },
      inverted: invert
    });
  } catch (error) {
    log.error(`Failed to delete region: ${error.message}`);
    res.status(error.statusCode || 500).json({ error: sanitizeError(error.message) });
  }
});

// Get save statistics
router.get('/stats/:saveName', async (req, res) => {
  try {
    const { saveName } = req.params;
    const customPath = req.query.customPath ? String(req.query.customPath) : null;
    
    // Sanitize saveName to prevent path traversal
    const sanitizedSaveName = path.basename(saveName);
    if (!sanitizedSaveName || sanitizedSaveName !== saveName) {
      return res.status(400).json({ error: 'Invalid save name' });
    }
    
    let zomboidDataPath;
    if (customPath) {
      zomboidDataPath = path.resolve(customPath);
    } else {
      zomboidDataPath = await getZomboidDataPath();
    }
    
    if (!zomboidDataPath) {
      return res.status(400).json({ error: 'Zomboid data path not set' });
    }
    
    // Resolve the saves path the same way as /saves
    let savesPath = resolveSavesPath(zomboidDataPath);
    
    const savePath = path.join(savesPath, sanitizedSaveName);
    
    if (!fs.existsSync(savePath)) {
      return res.status(404).json({ error: 'Save not found' });
    }
    
    const stats = {
      saveName,
      totalSize: await getDirSize(savePath), // Now awaited
      folders: {}
    };
    
    const folders = ['map', 'chunkdata', 'isoregiondata', 'zpop', 'metagrid', 'apop', 'radio'];
    
    for (const folder of folders) {
      const folderPath = path.join(savePath, folder);
      try {
        if (fs.existsSync(folderPath)) {
            const fileCount = await countFiles(folderPath);
            const size = await getDirSize(folderPath);
            stats.folders[folder] = {
            fileCount,
            size,
            sizeFormatted: formatBytes(size)
            };
        }
      } catch (e) {
        log.debug(`Failed to stat folder ${folder}: ${e.message}`);
      }
    }
    
    // B41 root chunk files: count map_X_Y.bin in save root when map/ has no chunks
    if (!stats.folders.map || stats.folders.map.fileCount === 0) {
      const B41_CHUNK_REGEX = /^map_\d+_\d+\.bin$/i;
      try {
        const rootEntries = await fs.promises.readdir(savePath, { withFileTypes: true });
        const rootChunks = rootEntries.filter(f => f.isFile() && B41_CHUNK_REGEX.test(f.name));
        if (rootChunks.length > 0) {
          let rootChunkSize = 0;
          for (const f of rootChunks) {
            try {
              const s = await fs.promises.stat(path.join(savePath, f.name));
              rootChunkSize += s.size;
            } catch (e) {
              log.debug(`Stat failed for root chunk ${f.name}: ${e.message}`);
            }
          }
          stats.folders['map (root)'] = {
            fileCount: rootChunks.length,
            size: rootChunkSize,
            sizeFormatted: formatBytes(rootChunkSize)
          };
        }
      } catch (e) {
        log.debug(`B41 root chunk scan failed: ${e.message}`);
      }
    }
    
    // Players count
    const playersDb = path.join(savePath, 'players.db');
    if (fs.existsSync(playersDb)) {
      try {
        const s = await fs.promises.stat(playersDb);
        stats.playersDbSize = s.size;
      } catch (e) {
        log.debug(`Stat failed for players.db: ${e.message}`);
      }
    }
    
    // Vehicles db
    const vehiclesDb = path.join(savePath, 'vehicles.db');
    if (fs.existsSync(vehiclesDb)) {
      try {
        const s = await fs.promises.stat(vehiclesDb);
        stats.vehiclesDbSize = s.size;
      } catch (e) {
        log.debug(`Stat failed for vehicles.db: ${e.message}`);
      }
    }
    
    stats.totalSizeFormatted = formatBytes(stats.totalSize);
    
    res.json(stats);
  } catch (error) {
    log.error(`Failed to get save stats: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Helper functions
async function getDirSize(dirPath) {
  let totalSize = 0;
  try {
    const files = await fs.promises.readdir(dirPath, { withFileTypes: true });
    
    for (const file of files) {
      const filePath = path.join(dirPath, file.name);
      if (file.isDirectory()) {
         totalSize += await getDirSize(filePath);
      } else {
         // Optimization: We could just ignore stat failures
         try {
           const stats = await fs.promises.stat(filePath);
           totalSize += stats.size;
         } catch (e) {
           // Stat failure for individual file in size calculation
         }
      }
    }
  } catch (err) {
    if (err.code !== 'EACCES' && err.code !== 'ENOENT') log.debug(`getDirSize error for ${dirPath}: ${err.message}`);
  }
  return totalSize;
}

// Count files recursively (handles B42's subdirectory structure)
async function countFiles(dirPath) {
  let count = 0;
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        count += await countFiles(path.join(dirPath, entry.name));
      } else {
        count++;
      }
    }
  } catch (err) {
    if (err.code !== 'EACCES' && err.code !== 'ENOENT') log.debug(`countFiles error for ${dirPath}: ${err.message}`);
  }
  return count;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Browse a path — list directories for manual navigation
router.get('/browse', async (req, res) => {
  try {
    const browsePath = req.query.path ? String(req.query.path) : null;
    
    if (!browsePath) {
      // Return the current zomboidDataPath as starting point
      const zomboidDataPath = await getZomboidDataPath();
      return res.json({
        currentPath: zomboidDataPath || '',
        directories: [],
        hasSaves: false
      });
    }
    
    const resolved = path.resolve(browsePath);
    
    if (!fs.existsSync(resolved)) {
      return res.status(400).json({ error: 'Path does not exist' });
    }
    
    const stat = await fs.promises.stat(resolved);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }
    
    const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
    const directories = entries
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort();
    
    // Check if this path has a Saves/Multiplayer structure
    const savesMultiplayer = path.join(resolved, 'Saves', 'Multiplayer');
    const hasSavesMultiplayer = fs.existsSync(savesMultiplayer);
    
    // Or if it IS a Saves/Multiplayer path
    const basename = path.basename(resolved);
    const parentBase = path.basename(path.dirname(resolved));
    const isSavesMultiplayer = basename === 'Multiplayer' && parentBase === 'Saves';
    
    // Check if any child dirs contain a map/ folder or B41 root chunk files (direct save dirs)
    const B41_ROOT_REGEX = /^map_\d+_\d+\.bin$/i;
    const hasMapFolders = directories.some(d => {
      const childPath = path.join(resolved, d);
      if (fs.existsSync(path.join(childPath, 'map'))) return true;
      // B41 fallback: check for map_X_Y.bin files in the child directory
      try {
        const childFiles = fs.readdirSync(childPath);
        return childFiles.some(f => B41_ROOT_REGEX.test(f));
      } catch (e) {
        log.debug(`B41 check failed for ${d}: ${e.message}`);
        return false;
      }
    });
    
    res.json({
      currentPath: resolved,
      directories,
      hasSaves: hasSavesMultiplayer || isSavesMultiplayer || hasMapFolders,
      parent: path.dirname(resolved) !== resolved ? path.dirname(resolved) : null
    });
  } catch (error) {
    log.error(`Failed to browse path: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

export default router;
