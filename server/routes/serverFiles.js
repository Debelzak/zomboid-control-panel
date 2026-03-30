import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createLogger } from '../utils/logger.js';
const log = createLogger('API:Files');
import { getActiveServer, getAllSettings } from '../database/init.js';
import { sanitizeError } from '../utils/sanitize.js';

const router = express.Router();

// Block all file operations for remote servers (no local filesystem access)
router.use(async (req, res, next) => {
  try {
    const activeServer = await getActiveServer();
    if (activeServer?.isRemote) {
      return res.status(400).json({ error: 'Server file editing is not available for remote servers. The server filesystem is not accessible from this panel.' });
    }
    next();
  } catch (err) {
    next(err);
  }
});

// Helper function to escape regex special characters
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Escape strings for safe interpolation into Lua source code
function escapeLuaString(str) {
  return String(str).replace(/[\\"'\n\r\t\0\[\]]/g, (c) => {
    const escapes = { '\\': '\\\\', '"': '\\"', "'": "\\'", '\n': '\\n', '\r': '\\r', '\t': '\\t', '\0': '\\0', '[': '\\[', ']': '\\]' };
    return escapes[c] || c;
  });
}

// Get the server config directory path
async function getServerConfigPath() {
  const activeServer = await getActiveServer();
  
  // First, use explicitly configured serverConfigPath if available
  if (activeServer?.serverConfigPath) {
    return activeServer.serverConfigPath;
  }
  
  // Fallback to zomboidDataPath + Server
  if (activeServer?.zomboidDataPath) {
    return path.join(activeServer.zomboidDataPath, 'Server');
  }
  
  // Fallback to legacy settings
  const settings = await getAllSettings();
  if (settings.serverConfigPath) {
    return settings.serverConfigPath;
  }
  if (settings.zomboidDataPath) {
    return path.join(settings.zomboidDataPath, 'Server');
  }
  
  // Default path: ~/Zomboid/Server
  return path.join(os.homedir(), 'Zomboid', 'Server');
}

// Get server name from active server
async function getServerName() {
  const activeServer = await getActiveServer();
  if (activeServer?.serverName) {
    return activeServer.serverName;
  }
  
  const settings = await getAllSettings();
  return settings.serverName || 'servertest';
}

// Backup directory
async function getBackupPath() {
  return path.join(await getServerConfigPath(), 'backups');
}

// Create backup before saving
async function createBackup(filename) {
  const configPath = await getServerConfigPath();
  const backupDir = await getBackupPath();
  const filePath = path.join(configPath, filename);
  
  try {
    // Check file existence asynchronously
    try {
      await fs.promises.access(filePath);
    } catch {
      return null;
    }
    
    // Ensure backup directory exists
    await fs.promises.mkdir(backupDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `${filename}.${timestamp}.bak`;
    const backupPath = path.join(backupDir, backupName);
    
    // Async copy
    await fs.promises.copyFile(filePath, backupPath);
    log.info(`Created backup: ${backupName}`);
    
    // Cleanup old backups asynchronously
    const files = await fs.promises.readdir(backupDir);
    const backups = files
      .filter(f => f.startsWith(filename + '.') && f.endsWith('.bak'))
      .sort()
      .reverse();
    
    if (backups.length > 10) {
      const filesToDelete = backups.slice(10);
      await Promise.all(filesToDelete.map(old => 
        fs.promises.unlink(path.join(backupDir, old)).catch(e => 
          log.warn(`Failed to delete old backup ${old}: ${e.message}`)
        )
      ));
    }
    
    return backupName;
  } catch (error) {
    log.error(`Backup creation failed: ${error.message}`);
    return null;
  }
}

// Parse INI file to object
function parseIni(content) {
  const result = {};
  const lines = content.split(/\r?\n/);
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
      continue;
    }
    
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();
      result[key] = value;
    }
  }
  
  return result;
}

// Convert object back to INI format
function toIni(obj, originalContent = '') {
  // Preserve comments and order from original
  if (originalContent) {
    const lines = originalContent.split(/\r?\n/);
    const result = [];
    const written = new Set();
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
        result.push(line);
        continue;
      }
      
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex).trim();
        if (key in obj) {
          // Strip newlines from values to prevent INI injection
          const safeValue = String(obj[key]).replace(/[\r\n]/g, '');
          result.push(`${key}=${safeValue}`);
          written.add(key);
        } else {
          result.push(line);
        }
      } else {
        result.push(line);
      }
    }
    
    // Add any new keys
    for (const [key, value] of Object.entries(obj)) {
      if (!written.has(key)) {
        // Validate key is a safe INI identifier
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
          log.warn(`Invalid INI key skipped: ${key}`);
          continue;
        }
        const safeValue = String(value).replace(/[\r\n]/g, '');
        result.push(`${key}=${safeValue}`);
      }
    }
    
    return result.join('\n');
  }
  
  // Generate from scratch
  return Object.entries(obj)
    .filter(([key]) => {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
        log.warn(`Invalid INI key skipped: ${key}`);
        return false;
      }
      return true;
    })
    .map(([key, value]) => {
      const safeValue = String(value).replace(/[\r\n]/g, '');
      return `${key}=${safeValue}`;
    })
    .join('\n');
}

// Parse SandboxVars.lua
function parseSandboxVars(content) {
  const result = {
    VERSION: 4,
    settings: {},
    ZombieLore: {},
    ZombieConfig: {},
    MultiplierConfig: {},
    Map: {},
    Basement: {}
  };
  
  // Known nested blocks to skip when parsing top-level settings
  const nestedBlocks = ['ZombieLore', 'ZombieConfig', 'MultiplierConfig', 'Map', 'Basement'];
  
  try {
    // Extract VERSION
    const versionMatch = content.match(/VERSION\s*=\s*(\d+)/);
    if (versionMatch) {
      result.VERSION = parseInt(versionMatch[1], 10);
    }
    
    // Strip nested block regions from content so the top-level regex
    // doesn't accidentally capture keys that belong inside ZombieLore,
    // ZombieConfig, MultiplierConfig, Map, or Basement.
    let topLevelContent = content;
    for (const blockName of nestedBlocks) {
      const blockPattern = new RegExp(
        escapeRegExp(blockName) + '\\s*=\\s*\\{[\\s\\S]*?\\n\\s*\\}', 'm'
      );
      topLevelContent = topLevelContent.replace(blockPattern, '');
    }
    
    // Parse simple key=value pairs (top-level settings only)
    const simplePattern = /^\s*(\w+)\s*=\s*([^,{}\n]+),?\s*(?:--.*)?$/gm;
    let match;
    while ((match = simplePattern.exec(topLevelContent)) !== null) {
      const key = match[1];
      let value = match[2].trim();
      
      // Skip nested objects and VERSION
      if (nestedBlocks.includes(key) || key === 'VERSION') continue;
      
      // Parse value type
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (!isNaN(parseFloat(value))) value = parseFloat(value);
      else value = value.replace(/^["']|["']$/g, '');
      
      result.settings[key] = value;
    }
    
    // Helper function to parse a nested block
    function parseNestedBlock(blockName) {
      // Match nested blocks - handle both simple and complex nested structures
      const blockPattern = new RegExp(`${blockName}\\s*=\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, 'm');
      const blockMatch = content.match(blockPattern);
      
      if (blockMatch) {
        const blockContent = blockMatch[1];
        // Strip Lua comment lines to avoid parsing comment text as keys
        // (e.g. "-- 1 = Sprinters" or "-- Default = Random")
        const strippedContent = blockContent.replace(/^\s*--.*$/gm, '');
        const valuePattern = /(\w+)\s*=\s*([^,\n]+)/g;
        let valueMatch;
        while ((valueMatch = valuePattern.exec(strippedContent)) !== null) {
          let value = valueMatch[2].trim();
          // Remove trailing comma if present
          value = value.replace(/,\s*$/, '');
          
          if (value === 'true') value = true;
          else if (value === 'false') value = false;
          else if (!isNaN(parseFloat(value))) value = parseFloat(value);
          else value = value.replace(/^["']|["']$/g, '');
          
          result[blockName][valueMatch[1]] = value;
        }
      }
    }
    
    // Parse all nested blocks
    nestedBlocks.forEach(parseNestedBlock);
    
  } catch (error) {
    log.error('Failed to parse SandboxVars:', error);
  }
  
  return result;
}

// Format a number for Lua, preserving the original file's decimal format
function formatLuaNumber(newValue, originalValueStr) {
  const trimmed = originalValueStr ? originalValueStr.trim().replace(/,\s*$/, '') : '';
  // If the original value had a decimal point and the new value is a whole number, add .0
  if (Number.isInteger(newValue) && trimmed.includes('.')) {
    return newValue.toFixed(1);
  }
  return newValue.toString();
}

// Modify a single value in the SandboxVars file content in-place
// Preserves all comments and file structure
function modifySandboxValue(originalContent, key, newValue, nestedBlock = null) {
  let content = originalContent;
  
  // Validate key is a valid identifier (alphanumeric and underscore only)
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
    log.warn(`Invalid sandbox key skipped: ${key}`);
    return content;
  }
  
  // Format the value for Lua (base format, may be refined by context)
  function formatValue(originalValueStr) {
    if (typeof newValue === 'boolean') {
      return newValue.toString();
    } else if (typeof newValue === 'number') {
      return formatLuaNumber(newValue, originalValueStr);
    } else {
      return `"${escapeLuaString(String(newValue))}"`;
    }
  }
  
  // Escape key for use in regex (even though we validate, this is defense in depth)
  const escapedKey = escapeRegExp(key);
  
  if (nestedBlock) {
    // For nested blocks (ZombieLore, ZombieConfig, etc.)
    // Only match actual assignment lines (not comment lines starting with --)
    const escapedBlock = escapeRegExp(nestedBlock);
    const blockStartPattern = new RegExp(`${escapedBlock}\\s*=\\s*\\{`);
    const blockStartMatch = content.match(blockStartPattern);
    if (blockStartMatch) {
      const blockStart = blockStartMatch.index;
      const blockEnd = content.indexOf('}', blockStart + blockStartMatch[0].length);
      if (blockEnd !== -1) {
        const before = content.substring(0, blockStart);
        const blockSection = content.substring(blockStart, blockEnd + 1);
        const after = content.substring(blockEnd + 1);
        // Replace only on non-comment lines within the block
        const updatedBlock = blockSection.replace(
          new RegExp(`(^(?!\\s*--)[^\\n]*?)(${escapedKey})(\\s*=\\s*)([^,\\n}]+)(,?)`, 'm'),
          (_, prefix, k, eq, oldVal, comma) => `${prefix}${k}${eq}${formatValue(oldVal)}${comma}`
        );
        content = before + updatedBlock + after;
      }
    }
  } else {
    // For top-level settings, only replace occurrences OUTSIDE nested blocks
    // to avoid accidentally modifying keys that share a name with a nested key.
    const knownBlocks = ['ZombieLore', 'ZombieConfig', 'MultiplierConfig', 'Map', 'Basement'];
    const blockRanges = [];
    for (const bn of knownBlocks) {
      const bp = new RegExp(escapeRegExp(bn) + '\\s*=\\s*\\{');
      const bm = content.match(bp);
      if (bm) {
        const start = bm.index;
        const end = content.indexOf('}', start + bm[0].length);
        if (end !== -1) blockRanges.push({ start, end: end + 1 });
      }
    }

    const pattern = new RegExp(`(^\\s*)(${escapedKey})(\\s*=\\s*)([^,\\n}]+)(,?)(\\s*(?:--.*)?$)`, 'gm');
    content = content.replace(pattern, (fullMatch, indent, k, eq, oldVal, comma, comment, offset) => {
      // Skip matches inside nested blocks
      for (const range of blockRanges) {
        if (offset >= range.start && offset < range.end) return fullMatch;
      }
      return `${indent}${k}${eq}${formatValue(oldVal)}${comma}${comment}`;
    });
  }
  
  return content;
}

// Apply multiple sandbox changes to file content in-place
function applySandboxChanges(originalContent, changes) {
  let content = originalContent;
  
  // Apply settings changes
  if (changes.settings) {
    for (const [key, value] of Object.entries(changes.settings)) {
      content = modifySandboxValue(content, key, value, null);
    }
  }
  
  // Apply ZombieLore changes
  if (changes.ZombieLore) {
    for (const [key, value] of Object.entries(changes.ZombieLore)) {
      content = modifySandboxValue(content, key, value, 'ZombieLore');
    }
  }
  
  // Apply ZombieConfig changes
  if (changes.ZombieConfig) {
    for (const [key, value] of Object.entries(changes.ZombieConfig)) {
      content = modifySandboxValue(content, key, value, 'ZombieConfig');
    }
  }
  
  // Apply MultiplierConfig changes
  if (changes.MultiplierConfig) {
    for (const [key, value] of Object.entries(changes.MultiplierConfig)) {
      content = modifySandboxValue(content, key, value, 'MultiplierConfig');
    }
  }
  
  // Apply Map changes
  if (changes.Map) {
    for (const [key, value] of Object.entries(changes.Map)) {
      content = modifySandboxValue(content, key, value, 'Map');
    }
  }
  
  // Apply Basement changes
  if (changes.Basement) {
    for (const [key, value] of Object.entries(changes.Basement)) {
      content = modifySandboxValue(content, key, value, 'Basement');
    }
  }
  
  return content;
}

// Legacy function - converts to Lua from scratch (only use for new files)
function toSandboxVars(data) {
  const lines = ['SandboxVars = {'];
  lines.push(`    VERSION = ${data.VERSION || 4},`);
  
  // Add simple settings
  for (const [key, value] of Object.entries(data.settings || {})) {
    if (typeof value === 'boolean') {
      lines.push(`    ${key} = ${value},`);
    } else if (typeof value === 'number') {
      lines.push(`    ${key} = ${value},`);
    } else {
      lines.push(`    ${key} = "${value}",`);
    }
  }
  
  // Add ZombieLore
  if (data.ZombieLore && Object.keys(data.ZombieLore).length > 0) {
    lines.push('    ZombieLore = {');
    for (const [key, value] of Object.entries(data.ZombieLore)) {
      if (typeof value === 'boolean') {
        lines.push(`        ${key} = ${value},`);
      } else {
        lines.push(`        ${key} = ${value},`);
      }
    }
    lines.push('    },');
  }
  
  // Add ZombieConfig
  if (data.ZombieConfig && Object.keys(data.ZombieConfig).length > 0) {
    lines.push('    ZombieConfig = {');
    for (const [key, value] of Object.entries(data.ZombieConfig)) {
      if (typeof value === 'boolean') {
        lines.push(`        ${key} = ${value},`);
      } else {
        lines.push(`        ${key} = ${value},`);
      }
    }
    lines.push('    },');
  }
  
  lines.push('}');
  return lines.join('\n');
}

// Parse spawn points lua - handles profession-based structure
function parseSpawnPoints(content) {
  const professions = {};
  
  try {
    // First, find profession blocks like: unemployed = { ... }
    // The format is: professionName = { { worldX = ..., ... }, { worldX = ..., ... } }
    const professionPattern = /(\w+)\s*=\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
    let profMatch;
    
    while ((profMatch = professionPattern.exec(content)) !== null) {
      const profName = profMatch[1];
      const profContent = profMatch[2];
      
      // Skip 'return' as it's not a profession
      if (profName === 'return') continue;
      
      const points = [];
      // Match spawn point entries - posZ is optional
      const pointPattern = /\{\s*worldX\s*=\s*(\d+)\s*,\s*worldY\s*=\s*(\d+)\s*,\s*posX\s*=\s*([\d.]+)\s*,\s*posY\s*=\s*([\d.]+)(?:\s*,\s*posZ\s*=\s*(\d+))?\s*\}/g;
      let pointMatch;
      
      while ((pointMatch = pointPattern.exec(profContent)) !== null) {
        points.push({
          worldX: parseInt(pointMatch[1], 10),
          worldY: parseInt(pointMatch[2], 10),
          posX: parseFloat(pointMatch[3]),
          posY: parseFloat(pointMatch[4]),
          posZ: pointMatch[5] ? parseInt(pointMatch[5], 10) : 0
        });
      }
      
      if (points.length > 0) {
        professions[profName] = points;
      }
    }
  } catch (error) {
    log.error('Failed to parse spawn points:', error);
  }
  
  return professions;
}

// Convert spawn points to Lua - handles profession-based structure
function toSpawnPoints(professions, serverName) {
  const lines = [`function SpawnPoints()`];
  lines.push(`\treturn {`);
  
  for (const [profName, points] of Object.entries(professions)) {
    // Validate profession name is a safe Lua identifier
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(profName)) {
      log.warn(`Invalid profession name skipped in spawnpoints: ${profName}`);
      continue;
    }
    lines.push(`\t\t${profName} = {`);
    for (const p of points) {
      // Validate coordinates are finite numbers to prevent Lua injection
      const wx = Number.isFinite(Number(p.worldX)) ? Number(p.worldX) : 0;
      const wy = Number.isFinite(Number(p.worldY)) ? Number(p.worldY) : 0;
      const px = Number.isFinite(Number(p.posX)) ? Number(p.posX) : 0;
      const py = Number.isFinite(Number(p.posY)) ? Number(p.posY) : 0;
      const pz = Number.isFinite(Number(p.posZ)) ? Number(p.posZ) : 0;
      if (pz && pz !== 0) {
        lines.push(`\t\t\t{ worldX = ${wx}, worldY = ${wy}, posX = ${px}, posY = ${py}, posZ = ${pz} }`);
      } else {
        lines.push(`\t\t\t{ worldX = ${wx}, worldY = ${wy}, posX = ${px}, posY = ${py} }`);
      }
    }
    lines.push(`\t\t}`);
  }
  
  lines.push(`\t}`);
  lines.push(`end`);
  return lines.join('\n');
}

// Parse spawn regions lua
function parseSpawnRegions(content) {
  const regions = [];
  
  try {
    // Match patterns like { name = "Muldraugh, KY", file = "path" } or { name = "...", serverfile = "..." }
    // Handle both 'file' and 'serverfile' keys
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      // Skip comments
      if (line.trim().startsWith('--')) continue;
      
      // Try to match file or serverfile
      const nameMatch = line.match(/name\s*=\s*"([^"]+)"/);
      const fileMatch = line.match(/(?:server)?file\s*=\s*"([^"]+)"/);
      
      if (nameMatch && fileMatch) {
        regions.push({
          name: nameMatch[1],
          file: fileMatch[1],
          isServerFile: line.includes('serverfile')
        });
      }
    }
  } catch (error) {
    log.error('Failed to parse spawn regions:', error);
  }
  
  return regions;
}

// Convert spawn regions to Lua
function toSpawnRegions(regions, serverName) {
  const lines = [`function SpawnRegions()`];
  lines.push(`        return {`);
  
  for (const r of regions) {
    const safeName = escapeLuaString(r.name);
    const safeFile = escapeLuaString(r.file);
    if (r.isServerFile) {
      lines.push(`                { name = "${safeName}", serverfile = "${safeFile}" },`);
    } else {
      lines.push(`                { name = "${safeName}", file = "${safeFile}" },`);
    }
  }
  
  lines.push(`        }`);
  lines.push(`end`);
  return lines.join('\n');
}

// ===== ROUTES =====

// Get server file paths info
router.get('/paths', async (req, res) => {
  try {
    log.info('GET /paths');
    const configPath = await getServerConfigPath();
    const serverName = await getServerName();
    
    const files = {
      ini: path.join(configPath, `${serverName}.ini`),
      sandbox: path.join(configPath, `${serverName}_SandboxVars.lua`),
      spawnpoints: path.join(configPath, `${serverName}_spawnpoints.lua`),
      spawnregions: path.join(configPath, `${serverName}_spawnregions.lua`)
    };
    
    const exists = {
      ini: fs.existsSync(files.ini),
      sandbox: fs.existsSync(files.sandbox),
      spawnpoints: fs.existsSync(files.spawnpoints),
      spawnregions: fs.existsSync(files.spawnregions)
    };
    
    res.json({ configPath, serverName, files, exists });
  } catch (error) {
    log.error('Failed to get paths:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Get INI file (parsed)
router.get('/ini', async (req, res) => {
  try {
    const configPath = await getServerConfigPath();
    const serverName = await getServerName();
    const filePath = path.join(configPath, `${serverName}.ini`);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'INI file not found', path: filePath });
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseIni(content);
    
    res.json({ settings: parsed, path: filePath });
  } catch (error) {
    log.error('Failed to read INI:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Save INI file
router.put('/ini', async (req, res) => {
  try {
    const configPath = await getServerConfigPath();
    const serverName = await getServerName();
    log.info(`PUT /ini: serverName=${serverName}, keys=${Object.keys(req.body.settings || {}).length}`);
    const filePath = path.join(configPath, `${serverName}.ini`);
    const { settings } = req.body;
    
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Settings object required' });
    }
    
    // Guard against prototype pollution
    if (Object.prototype.hasOwnProperty.call(settings, '__proto__') ||
        Object.prototype.hasOwnProperty.call(settings, 'constructor') ||
        Object.prototype.hasOwnProperty.call(settings, 'prototype')) {
      return res.status(400).json({ error: 'Invalid settings' });
    }
    
    // Read original to preserve comments/structure
    let originalContent = '';
    if (fs.existsSync(filePath)) {
      originalContent = fs.readFileSync(filePath, 'utf-8');
      await createBackup(`${serverName}.ini`);
    }
    
    const newContent = toIni(settings, originalContent);
    fs.writeFileSync(filePath, newContent, 'utf-8');
    
    log.info('Saved INI file');
    res.json({ success: true, message: 'Settings saved' });
  } catch (error) {
    log.error('Failed to save INI:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Get SandboxVars (parsed)
router.get('/sandbox', async (req, res) => {
  try {
    const configPath = await getServerConfigPath();
    const serverName = await getServerName();
    const filePath = path.join(configPath, `${serverName}_SandboxVars.lua`);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'SandboxVars file not found', path: filePath });
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseSandboxVars(content);
    
    res.json({ sandbox: parsed, path: filePath });
  } catch (error) {
    log.error('Failed to read SandboxVars:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Save SandboxVars
router.put('/sandbox', async (req, res) => {
  try {
    log.info('PUT /sandbox');
    const configPath = await getServerConfigPath();
    const serverName = await getServerName();
    const filePath = path.join(configPath, `${serverName}_SandboxVars.lua`);
    const { sandbox } = req.body;
    
    if (!sandbox || typeof sandbox !== 'object') {
      return res.status(400).json({ error: 'Sandbox object required' });
    }
    
    // Guard against prototype pollution
    if (Object.prototype.hasOwnProperty.call(sandbox, '__proto__') ||
        Object.prototype.hasOwnProperty.call(sandbox, 'constructor') ||
        Object.prototype.hasOwnProperty.call(sandbox, 'prototype')) {
      return res.status(400).json({ error: 'Invalid sandbox data' });
    }
    
    // Guard nested sections against prototype pollution
    for (const section of Object.values(sandbox)) {
      if (section && typeof section === 'object') {
        if (Object.prototype.hasOwnProperty.call(section, '__proto__') ||
            Object.prototype.hasOwnProperty.call(section, 'constructor') ||
            Object.prototype.hasOwnProperty.call(section, 'prototype')) {
          return res.status(400).json({ error: 'Invalid sandbox data' });
        }
      }
    }
    
    // Size limit: reject payloads > 1MB
    const payloadSize = JSON.stringify(sandbox).length;
    if (payloadSize > 1024 * 1024) {
      return res.status(400).json({ error: 'Sandbox data too large (max 1MB)' });
    }
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'SandboxVars file not found. Start the server once to generate it.' });
    }
    
    // Modify in-place to preserve comments and structure
    await createBackup(`${serverName}_SandboxVars.lua`);
    const originalContent = fs.readFileSync(filePath, 'utf-8');
    const newContent = applySandboxChanges(originalContent, sandbox);
    
    fs.writeFileSync(filePath, newContent, 'utf-8');
    
    log.info('Saved SandboxVars file');
    res.json({ success: true, message: 'Sandbox settings saved' });
  } catch (error) {
    log.error('Failed to save SandboxVars:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Get spawn points
router.get('/spawnpoints', async (req, res) => {
  try {
    const configPath = await getServerConfigPath();
    const serverName = await getServerName();
    const filePath = path.join(configPath, `${serverName}_spawnpoints.lua`);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Spawn points file not found', path: filePath });
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const points = parseSpawnPoints(content);
    
    res.json({ spawnpoints: points, path: filePath });
  } catch (error) {
    log.error('Failed to read spawn points:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Save spawn points
router.put('/spawnpoints', async (req, res) => {
  try {
    log.info('PUT /spawnpoints');
    const configPath = await getServerConfigPath();
    const serverName = await getServerName();
    const filePath = path.join(configPath, `${serverName}_spawnpoints.lua`);
    const { spawnpoints } = req.body;
    
    if (!spawnpoints || typeof spawnpoints !== 'object') {
      return res.status(400).json({ error: 'Spawn points object required (keyed by profession)' });
    }
    
    if (fs.existsSync(filePath)) {
      await createBackup(`${serverName}_spawnpoints.lua`);
    }
    
    const newContent = toSpawnPoints(spawnpoints, serverName);
    fs.writeFileSync(filePath, newContent, 'utf-8');
    
    log.info('Saved spawn points file');
    res.json({ success: true, message: 'Spawn points saved' });
  } catch (error) {
    log.error('Failed to save spawn points:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Get spawn regions
router.get('/spawnregions', async (req, res) => {
  try {
    const configPath = await getServerConfigPath();
    const serverName = await getServerName();
    const filePath = path.join(configPath, `${serverName}_spawnregions.lua`);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Spawn regions file not found', path: filePath });
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const regions = parseSpawnRegions(content);
    
    res.json({ spawnregions: regions, path: filePath });
  } catch (error) {
    log.error('Failed to read spawn regions:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Save spawn regions
router.put('/spawnregions', async (req, res) => {
  try {
    const configPath = await getServerConfigPath();
    const serverName = await getServerName();
    const filePath = path.join(configPath, `${serverName}_spawnregions.lua`);
    const { spawnregions } = req.body;
    
    if (!Array.isArray(spawnregions)) {
      return res.status(400).json({ error: 'Spawn regions array required' });
    }
    
    if (fs.existsSync(filePath)) {
      await createBackup(`${serverName}_spawnregions.lua`);
    }
    
    const newContent = toSpawnRegions(spawnregions, serverName);
    fs.writeFileSync(filePath, newContent, 'utf-8');
    
    log.info('Saved spawn regions file');
    res.json({ success: true, message: 'Spawn regions saved' });
  } catch (error) {
    log.error('Failed to save spawn regions:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Get raw file content
router.get('/raw/:type', async (req, res) => {
  log.info(`GET /raw/${req.params.type}`);
  try {
    const configPath = await getServerConfigPath();
    const serverName = await getServerName();
    const type = req.params.type;
    
    const fileMap = {
      ini: `${serverName}.ini`,
      sandbox: `${serverName}_SandboxVars.lua`,
      spawnpoints: `${serverName}_spawnpoints.lua`,
      spawnregions: `${serverName}_spawnregions.lua`
    };
    
    if (!fileMap[type]) {
      return res.status(400).json({ error: 'Invalid file type' });
    }
    
    const filePath = path.join(configPath, fileMap[type]);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found', path: filePath });
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ content, path: filePath, filename: fileMap[type] });
  } catch (error) {
    log.error('Failed to read raw file:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Save raw file content
router.put('/raw/:type', async (req, res) => {
  try {
    const configPath = await getServerConfigPath();
    const serverName = await getServerName();
    const type = req.params.type;
    const { content } = req.body;
    log.info(`PUT /raw/${type}: contentLength=${content?.length || 0}`);
    
    const fileMap = {
      ini: `${serverName}.ini`,
      sandbox: `${serverName}_SandboxVars.lua`,
      spawnpoints: `${serverName}_spawnpoints.lua`,
      spawnregions: `${serverName}_spawnregions.lua`
    };
    
    if (!fileMap[type]) {
      return res.status(400).json({ error: 'Invalid file type' });
    }
    
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'Content string required' });
    }
    
    if (content.length > 512 * 1024) {
      return res.status(400).json({ error: 'Content too large (max 512KB)' });
    }
    
    const filePath = path.join(configPath, fileMap[type]);
    
    if (fs.existsSync(filePath)) {
      await createBackup(fileMap[type]);
    }
    
    fs.writeFileSync(filePath, content, 'utf-8');
    
    log.info(`Saved raw file: ${fileMap[type]}`);
    res.json({ success: true, message: 'File saved' });
  } catch (error) {
    log.error('Failed to save raw file:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// List backups
router.get('/backups', async (req, res) => {
  try {
    const backupDir = await getBackupPath();
    
    if (!fs.existsSync(backupDir)) {
      return res.json({ backups: [] });
    }
    
    const fileList = await fs.promises.readdir(backupDir);
    const files = (await Promise.all(fileList
      .filter(f => f.endsWith('.bak'))
      .map(async filename => {
        try {
          const stats = await fs.promises.stat(path.join(backupDir, filename));
          return {
            filename,
            size: stats.size,
            created: stats.birthtime
          };
        } catch (e) { return null; }
      })))
      .filter(f => f !== null)
      .sort((a, b) => {
        // Handle invalid dates gracefully
        const dateA = new Date(a.created);
        const dateB = new Date(b.created);
        if (isNaN(dateA.getTime())) return 1;
        if (isNaN(dateB.getTime())) return -1;
        return dateB - dateA;
      });
    
    res.json({ backups: files, path: backupDir });
  } catch (error) {
    log.error('Failed to list backups:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Restore from backup
router.post('/restore/:filename', async (req, res) => {
  try {
    const backupDir = await getBackupPath();
    const configPath = await getServerConfigPath();
    
    // Sanitize filename to prevent path traversal
    const filename = path.basename(req.params.filename);
    log.info(`POST /restore: filename=${filename}`);
    
    if (!filename.endsWith('.bak')) {
      return res.status(400).json({ error: 'Invalid backup file extension' });
    }
    
    const backupPath = path.join(backupDir, filename);
    
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ error: 'Backup not found' });
    }
    
    // Extract original filename from backup name (e.g., "servertest.ini.2024-01-01T12-00-00.bak")
    const parts = filename.split('.');
    if (parts.length < 3) {
      return res.status(400).json({ error: 'Invalid backup filename' });
    }
    
    // Get original filename (everything before the timestamp)
    const bakIndex = filename.lastIndexOf('.bak');
    const timestampStart = filename.lastIndexOf('.', bakIndex - 1);
    const originalName = filename.substring(0, timestampStart);
    
    const targetPath = path.join(configPath, originalName);
    
    // Create backup of current before restoring
    if (fs.existsSync(targetPath)) {
      await createBackup(originalName);
    }
    
    await fs.promises.copyFile(backupPath, targetPath);
    
    log.info(`Restored from backup: ${filename} -> ${originalName}`);
    res.json({ success: true, message: `Restored ${originalName} from backup` });
  } catch (error) {
    log.error('Failed to restore backup:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Save and reload (calls RCON reloadoptions)
router.post('/save-and-reload', async (req, res) => {
  try {
    log.info('POST /save-and-reload');
    const rconService = req.app.get('rconService');
    
    if (!rconService || !rconService.isConnected()) {
      return res.status(400).json({ error: 'RCON not connected. Changes saved but not reloaded.' });
    }
    
    const result = await rconService.reloadOptions();
    res.json({ success: true, message: 'Options reloaded', result });
  } catch (error) {
    log.error('Failed to reload options:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// ===== CONFIG TEMPLATES =====

// Get templates directory
async function getTemplatesPath() {
  const configPath = await getServerConfigPath();
  return path.join(configPath, 'templates');
}

// Ensure templates directory exists
async function ensureTemplatesDir() {
  const templatesPath = await getTemplatesPath();
  if (!fs.existsSync(templatesPath)) {
    fs.mkdirSync(templatesPath, { recursive: true });
  }
  return templatesPath;
}

// GET /templates - List all saved templates
router.get('/templates', async (req, res) => {
  try {
    const templatesPath = await ensureTemplatesDir();
    
    const files = fs.readdirSync(templatesPath)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const filePath = path.join(templatesPath, f);
          const stats = fs.statSync(filePath);
          const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          return {
            id: f.replace('.json', ''),
            name: content.name || f.replace('.json', ''),
            description: content.description || '',
            type: content.type || 'both', // 'ini', 'sandbox', or 'both'
            created: content.created || stats.birthtime.toISOString(),
            modified: stats.mtime.toISOString(),
            hasIni: !!content.ini,
            hasSandbox: !!content.sandbox
          };
        } catch {
          return null; // Skip files deleted or unreadable between readdir and read
        }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));
    
    res.json({ templates: files });
  } catch (error) {
    log.error('Failed to list templates:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// GET /templates/:id - Get a specific template
router.get('/templates/:id', async (req, res) => {
  try {
    // Sanitize template ID to prevent path traversal
    const safeId = path.basename(req.params.id).replace(/[^a-z0-9_-]/gi, '');
    if (!safeId || safeId !== req.params.id) {
      return res.status(400).json({ error: 'Invalid template ID' });
    }
    
    const templatesPath = await getTemplatesPath();
    const templateFile = path.join(templatesPath, `${safeId}.json`);
    
    if (!fs.existsSync(templateFile)) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    const content = JSON.parse(fs.readFileSync(templateFile, 'utf-8'));
    res.json(content);
  } catch (error) {
    log.error('Failed to get template:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// POST /templates - Save current config as a template
router.post('/templates', async (req, res) => {
  log.info('POST /templates (create)');
  try {
    const { name, description, includeIni = true, includeSandbox = true } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Template name is required' });
    }
    
    const templatesPath = await ensureTemplatesDir();
    const configPath = await getServerConfigPath();
    const serverName = await getServerName();
    
    // Generate safe filename from name with uniqueness check
    const baseId = name.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 50);
    let safeId = baseId;
    let counter = 1;
    while (fs.existsSync(path.join(templatesPath, `${safeId}.json`))) {
      safeId = `${baseId}_${counter++}`;
      if (counter > 100) {
        return res.status(400).json({ error: 'Too many templates with similar names' });
      }
    }
    const templateFile = path.join(templatesPath, `${safeId}.json`);
    
    const template = {
      name,
      description: description || '',
      type: includeIni && includeSandbox ? 'both' : (includeIni ? 'ini' : 'sandbox'),
      created: new Date().toISOString(),
      serverName
    };
    
    // Read current INI settings
    if (includeIni) {
      const iniPath = path.join(configPath, `${serverName}.ini`);
      if (fs.existsSync(iniPath)) {
        const iniContent = fs.readFileSync(iniPath, 'utf-8');
        template.ini = parseIni(iniContent);
        template.iniRaw = iniContent;
      }
    }
    
    // Read current Sandbox settings
    if (includeSandbox) {
      const sandboxPath = path.join(configPath, `${serverName}_SandboxVars.lua`);
      if (fs.existsSync(sandboxPath)) {
        template.sandboxRaw = fs.readFileSync(sandboxPath, 'utf-8');
      }
    }
    
    fs.writeFileSync(templateFile, JSON.stringify(template, null, 2));
    log.info(`Created template: ${name} (${safeId})`);
    
    res.json({ 
      success: true, 
      id: safeId, 
      name,
      message: `Template "${name}" saved successfully`
    });
  } catch (error) {
    log.error('Failed to save template:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// POST /templates/:id/apply - Apply a template to current config
router.post('/templates/:id/apply', async (req, res) => {
  log.info(`POST /templates/${req.params.id}/apply`);
  try {
    // Sanitize template ID to prevent path traversal
    const safeId = path.basename(req.params.id).replace(/[^a-z0-9_-]/gi, '');
    if (!safeId || safeId !== req.params.id) {
      return res.status(400).json({ error: 'Invalid template ID' });
    }
    
    const { applyIni = true, applySandbox = true } = req.body;
    
    const templatesPath = await getTemplatesPath();
    const templateFile = path.join(templatesPath, `${safeId}.json`);
    
    if (!fs.existsSync(templateFile)) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    const template = JSON.parse(fs.readFileSync(templateFile, 'utf-8'));
    const configPath = await getServerConfigPath();
    const serverName = await getServerName();
    
    const applied = [];
    
    // Apply INI settings
    if (applyIni && template.iniRaw) {
      const iniPath = path.join(configPath, `${serverName}.ini`);
      
      // Create backup first
      await createBackup(`${serverName}.ini`);
      
      // Write the template INI
      fs.writeFileSync(iniPath, template.iniRaw);
      applied.push('INI');
      log.info(`Applied INI from template: ${template.name}`);
    }
    
    // Apply Sandbox settings
    if (applySandbox && template.sandboxRaw) {
      const sandboxPath = path.join(configPath, `${serverName}_SandboxVars.lua`);
      
      // Create backup first
      await createBackup(`${serverName}_SandboxVars.lua`);
      
      // Write the template sandbox
      fs.writeFileSync(sandboxPath, template.sandboxRaw);
      applied.push('Sandbox');
      log.info(`Applied Sandbox from template: ${template.name}`);
    }
    
    if (applied.length === 0) {
      return res.status(400).json({ error: 'No settings to apply from this template' });
    }
    
    res.json({ 
      success: true, 
      applied,
      message: `Applied ${applied.join(' and ')} settings from "${template.name}"`
    });
  } catch (error) {
    log.error('Failed to apply template:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// PUT /templates/:id - Update template metadata
router.put('/templates/:id', async (req, res) => {
  try {
    // Sanitize template ID to prevent path traversal
    const safeId = path.basename(req.params.id).replace(/[^a-z0-9_-]/gi, '');
    if (!safeId || safeId !== req.params.id) {
      return res.status(400).json({ error: 'Invalid template ID' });
    }
    
    const { name, description } = req.body;
    
    const templatesPath = await getTemplatesPath();
    const templateFile = path.join(templatesPath, `${safeId}.json`);
    
    if (!fs.existsSync(templateFile)) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    const template = JSON.parse(fs.readFileSync(templateFile, 'utf-8'));
    
    if (name) template.name = name;
    if (description !== undefined) template.description = description;
    template.modified = new Date().toISOString();
    
    fs.writeFileSync(templateFile, JSON.stringify(template, null, 2));
    
    res.json({ success: true, message: 'Template updated' });
  } catch (error) {
    log.error('Failed to update template:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// DELETE /templates/:id - Delete a template
router.delete('/templates/:id', async (req, res) => {
  log.info(`DELETE /templates/${req.params.id}`);
  try {
    // Sanitize template ID to prevent path traversal
    const safeId = path.basename(req.params.id).replace(/[^a-z0-9_-]/gi, '');
    if (!safeId || safeId !== req.params.id) {
      return res.status(400).json({ error: 'Invalid template ID' });
    }
    
    const templatesPath = await getTemplatesPath();
    const templateFile = path.join(templatesPath, `${safeId}.json`);
    
    if (!fs.existsSync(templateFile)) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    fs.unlinkSync(templateFile);
    log.info(`Deleted template: ${req.params.id}`);
    
    res.json({ success: true, message: 'Template deleted' });
  } catch (error) {
    log.error('Failed to delete template:', error);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// ===== FILE BROWSER (for image path fields) =====

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp']);

// GET /browse-files - List directories and files at a given path
router.get('/browse-files', async (req, res) => {
  try {
    const browsePath = req.query.path ? String(req.query.path) : null;
    const filterExts = req.query.extensions ? String(req.query.extensions).split(',').map(e => e.toLowerCase().trim()) : null;
    
    let targetPath;
    if (browsePath) {
      targetPath = path.resolve(browsePath);
    } else {
      // Default to the server config directory
      const configPath = await getServerConfigPath();
      targetPath = configPath || '';
    }
    
    if (!targetPath) {
      return res.status(400).json({ error: 'No path provided and server config path not set' });
    }
    
    if (!fs.existsSync(targetPath)) {
      return res.status(400).json({ error: 'Path does not exist' });
    }
    
    const stat = await fs.promises.stat(targetPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }
    
    const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
    
    const directories = [];
    const files = [];
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Skip hidden/system directories
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          directories.push(entry.name);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        // If extension filter is provided, only show matching files
        if (filterExts) {
          if (filterExts.includes(ext)) {
            files.push({ name: entry.name, ext });
          }
        } else {
          // Default: show image files only
          if (IMAGE_EXTENSIONS.has(ext)) {
            files.push({ name: entry.name, ext });
          }
        }
      }
    }
    
    directories.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    
    res.json({
      currentPath: targetPath,
      parent: path.dirname(targetPath) !== targetPath ? path.dirname(targetPath) : null,
      directories,
      files
    });
  } catch (error) {
    log.error(`Failed to browse files: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// GET /image-preview - Serve an image file for preview (limited to image types, max 5MB)
router.get('/image-preview', async (req, res) => {
  try {
    const filePath = req.query.path ? String(req.query.path) : null;
    if (!filePath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    
    const resolved = path.resolve(filePath);
    
    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const ext = path.extname(resolved).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) {
      return res.status(400).json({ error: 'Not an image file' });
    }
    
    const stat = await fs.promises.stat(resolved);
    if (stat.size > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image file exceeds 5MB limit' });
    }
    
    const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.bmp': 'image/bmp', '.webp': 'image/webp' };
    const contentType = mimeMap[ext] || 'application/octet-stream';
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    fs.createReadStream(resolved).pipe(res);
  } catch (error) {
    log.error(`Failed to serve image preview: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

export default router;
