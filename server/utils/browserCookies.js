/**
 * Browser cookie extractor (Windows)
 * ----------------------------------
 * Reads Steam session cookies (`sessionid`, `steamLoginSecure`) directly from
 * the local browser's cookie store. Saves the user from the DevTools dance.
 *
 * Supported on Windows only for v1:
 *   - Firefox  → cookies.sqlite (unencrypted)
 *   - Chrome   → Cookies SQLite + DPAPI-wrapped AES-GCM (legacy v10 scheme)
 *   - Edge     → identical scheme to Chrome
 *   - Brave    → identical scheme to Chrome
 *
 * Hard limits
 * -----------
 *   - Chrome v127+ "App-Bound Encryption" seals auth cookies to the Chrome
 *     process itself. If steamLoginSecure is bound that way, decryption will
 *     return an empty/garbage string and we surface a clean error.
 *   - Chrome/Edge/Brave keep an exclusive lock on Cookies while the browser
 *     is running. We copy the file to a temp path first to dodge most locks,
 *     but a busy browser can still fail us — error will say "close <browser>".
 *
 * No mutation: we never write to a browser's data directory.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';
import { createLogger } from './logger.js';

const log = createLogger('BrowserCookies');
const STEAM_HOSTS = ['steamcommunity.com', '.steamcommunity.com', 'store.steampowered.com', '.steampowered.com'];
// steamcommunity.com is where Workshop writes happen, so its login cookies
// take priority over store.steampowered.com when both are present.
const STEAM_HOST_PRIORITY = (host) => {
  if (!host) return 99;
  if (host === 'steamcommunity.com' || host === '.steamcommunity.com') return 0;
  if (host === 'store.steampowered.com' || host === '.steampowered.com') return 1;
  return 2;
};

let sqlPromise = null;
// In-memory cache: master key per browser id. The key never changes for a
// given Windows user account, so we can avoid re-spawning PowerShell every
// extraction within the panel's lifetime. Cleared on process exit.
const masterKeyCache = new Map();

function locateWasm() {
  const candidates = [];
  if (process.pkg) {
    const execDir = path.dirname(process.execPath);
    candidates.push(path.join(execDir, 'sql-wasm.wasm'));
    candidates.push(path.join(execDir, 'assets', 'sql-wasm.wasm'));
  }
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.resolve(here, '../../node_modules/sql.js/dist/sql-wasm.wasm'));
  } catch { /* ignore */ }
  candidates.push(path.resolve(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm'));
  candidates.push(path.resolve(process.cwd(), 'sql-wasm.wasm'));
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
  }
  return null;
}

async function getSQL() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: () => locateWasm() || 'sql-wasm.wasm',
    });
  }
  return sqlPromise;
}

function defaultProfileRoots() {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const roamingAppData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  return { home, localAppData, roamingAppData };
}

function chromiumProfileDir(userDataDir) {
  if (!fs.existsSync(userDataDir)) return null;
  const candidates = ['Default'];
  try {
    const entries = fs.readdirSync(userDataDir);
    const numbered = entries
      .filter((n) => /^Profile \d+$/.test(n))
      .sort((a, b) => parseInt(b.match(/\d+/)[0], 10) - parseInt(a.match(/\d+/)[0], 10));
    candidates.push(...numbered);
  } catch { /* ignore */ }
  for (const c of candidates) {
    const dir = path.join(userDataDir, c);
    const networkPath = path.join(dir, 'Network', 'Cookies');
    const legacyPath = path.join(dir, 'Cookies');
    if (fs.existsSync(networkPath)) return { profileDir: dir, cookiesPath: networkPath };
    if (fs.existsSync(legacyPath)) return { profileDir: dir, cookiesPath: legacyPath };
  }
  return null;
}

function firefoxProfilePath() {
  const { roamingAppData } = defaultProfileRoots();
  const profilesIni = path.join(roamingAppData, 'Mozilla', 'Firefox', 'profiles.ini');
  if (!fs.existsSync(profilesIni)) return null;
  let ini;
  try { ini = fs.readFileSync(profilesIni, 'utf-8'); } catch { return null; }
  const blocks = ini.split(/\r?\n\s*\r?\n/);
  let chosen = null;
  for (const block of blocks) {
    if (!/^\[Profile/.test(block.trim())) continue;
    const pathMatch = block.match(/^Path=(.+)$/m);
    if (!pathMatch) continue;
    const isRel = /^IsRelative=1/m.test(block);
    const rel = pathMatch[1].trim();
    const full = isRel
      ? path.join(roamingAppData, 'Mozilla', 'Firefox', rel)
      : rel;
    if (/^Default=1/m.test(block)) { chosen = full; break; }
    if (!chosen && /\.default-release$/.test(rel)) chosen = full;
    if (!chosen) chosen = full;
  }
  if (!chosen) return null;
  const cookiesPath = path.join(chosen, 'cookies.sqlite');
  if (!fs.existsSync(cookiesPath)) return null;
  return { profileDir: chosen, cookiesPath };
}

const BROWSER_DEFS = [
  {
    id: 'firefox',
    label: 'Firefox',
    family: 'firefox',
    find() { return firefoxProfilePath(); },
  },
  {
    id: 'chrome',
    label: 'Chrome',
    family: 'chromium',
    find() {
      const { localAppData } = defaultProfileRoots();
      return chromiumProfileDir(path.join(localAppData, 'Google', 'Chrome', 'User Data'));
    },
    localStatePath() {
      const { localAppData } = defaultProfileRoots();
      return path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Local State');
    },
  },
  {
    id: 'edge',
    label: 'Edge',
    family: 'chromium',
    find() {
      const { localAppData } = defaultProfileRoots();
      return chromiumProfileDir(path.join(localAppData, 'Microsoft', 'Edge', 'User Data'));
    },
    localStatePath() {
      const { localAppData } = defaultProfileRoots();
      return path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Local State');
    },
  },
  {
    id: 'brave',
    label: 'Brave',
    family: 'chromium',
    find() {
      const { localAppData } = defaultProfileRoots();
      return chromiumProfileDir(path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data'));
    },
    localStatePath() {
      const { localAppData } = defaultProfileRoots();
      return path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data', 'Local State');
    },
  },
];

export function listAvailableBrowsers() {
  if (process.platform !== 'win32') {
    return { supported: false, platform: process.platform, browsers: [] };
  }
  const browsers = BROWSER_DEFS.map((def) => {
    let found = null;
    try { found = def.find(); } catch { found = null; }
    return {
      id: def.id,
      label: def.label,
      family: def.family,
      detected: !!found,
    };
  });
  return { supported: true, platform: 'win32', browsers };
}

function copyToTemp(srcPath) {
  const tmp = path.join(os.tmpdir(), `zcp-cookies-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  fs.copyFileSync(srcPath, tmp);
  return tmp;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * PowerShell fallback for files Chrome/Edge/Brave keep open with restrictive
 * share flags. `[IO.File]::Open` with `FileShare.ReadWrite | Delete` reads
 * past the SQLite WAL exclusive-mode lock without needing the browser to be
 * closed. Slower than fs.copyFileSync — only used when that fails.
 */
async function copyToTempViaPowerShell(srcPath) {
  const tmp = path.join(os.tmpdir(), `zcp-cookies-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  const script = `
    $ErrorActionPreference = 'Stop'
    $src = $env:ZCP_SRC
    $dst = $env:ZCP_DST
    $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
    $in = [System.IO.File]::Open($src, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
    try {
      $out = [System.IO.File]::Create($dst)
      try { $in.CopyTo($out) } finally { $out.Close() }
    } finally { $in.Close() }
  `;
  await new Promise((resolve, reject) => {
    const proc = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script,
    ], {
      env: { ...process.env, ZCP_SRC: srcPath, ZCP_DST: tmp },
      windowsHide: true,
    });
    let err = '';
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
      reject(new Error('PowerShell copy timed out'));
    }, 10000);
    proc.stderr.on('data', (b) => { err += b.toString('utf-8'); });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`PowerShell copy failed (exit ${code}): ${err.trim().slice(0, 200)}`));
      }
      resolve();
    });
  });
  return tmp;
}

/**
 * Best-effort copy that retries through Chrome's locking quirks.
 *   1. fs.copyFileSync — fastest, works for Firefox & idle Chromium.
 *   2. brief retry — Chrome occasionally drops the lock between writes.
 *   3. PowerShell shadow open with permissive share flags — works while
 *      Chrome is fully running.
 */
async function snapshotCookiesFile(srcPath) {
  // Attempt 1: native copyFileSync.
  try { return copyToTemp(srcPath); } catch (err) {
    if (err.code !== 'EBUSY' && err.code !== 'EPERM' && err.code !== 'UNKNOWN') {
      throw err;
    }
  }
  // Attempt 2: short backoff + retry. Cheap, sometimes enough.
  await sleep(250);
  try { return copyToTemp(srcPath); } catch (err) {
    if (err.code !== 'EBUSY' && err.code !== 'EPERM' && err.code !== 'UNKNOWN') {
      throw err;
    }
  }
  // Attempt 3: PowerShell with FileShare.ReadWrite | Delete.
  return copyToTempViaPowerShell(srcPath);
}

function safeUnlink(p) { try { fs.unlinkSync(p); } catch { /* ignore */ } }

async function readChromiumCookies(cookiesPath) {
  let tmpPath;
  try { tmpPath = await snapshotCookiesFile(cookiesPath); }
  catch (err) {
    return { ok: false, error: `Could not read cookies file (${err.code || 'locked'}). Try closing the browser and retry, or use the browser extension.` };
  }
  try {
    const SQL = await getSQL();
    const buf = fs.readFileSync(tmpPath);
    const db = new SQL.Database(new Uint8Array(buf));
    const hostList = STEAM_HOSTS.map((h) => `'${h.replace(/'/g, "''")}'`).join(',');
    const res = db.exec(`SELECT host_key, name, value, encrypted_value FROM cookies WHERE host_key IN (${hostList})`);
    db.close();
    if (!res || !res[0]) return { ok: true, rows: [] };
    const cols = res[0].columns;
    const rows = res[0].values.map((row) => {
      const obj = {};
      cols.forEach((c, i) => { obj[c] = row[i]; });
      return obj;
    });
    return { ok: true, rows };
  } catch (err) {
    return { ok: false, error: `SQLite read failed: ${err.message}` };
  } finally {
    safeUnlink(tmpPath);
  }
}

async function readFirefoxCookies(cookiesPath) {
  let tmpPath;
  try { tmpPath = await snapshotCookiesFile(cookiesPath); }
  catch (err) {
    return { ok: false, error: `Could not read cookies file (${err.code || 'locked'}). Try closing Firefox and retry, or use the browser extension.` };
  }
  try {
    const SQL = await getSQL();
    const buf = fs.readFileSync(tmpPath);
    const db = new SQL.Database(new Uint8Array(buf));
    const hostList = STEAM_HOSTS.map((h) => `'${h.replace(/'/g, "''")}'`).join(',');
    const res = db.exec(`SELECT host, name, value FROM moz_cookies WHERE host IN (${hostList})`);
    db.close();
    if (!res || !res[0]) return { ok: true, rows: [] };
    const cols = res[0].columns;
    const rows = res[0].values.map((row) => {
      const obj = {};
      cols.forEach((c, i) => { obj[c] = row[i]; });
      return obj;
    });
    return { ok: true, rows };
  } catch (err) {
    return { ok: false, error: `SQLite read failed: ${err.message}` };
  } finally {
    safeUnlink(tmpPath);
  }
}

async function getChromiumMasterKey(localStatePath) {
  if (!fs.existsSync(localStatePath)) {
    throw new Error('Local State file not found');
  }
  let raw;
  try { raw = fs.readFileSync(localStatePath, 'utf-8'); }
  catch (err) { throw new Error(`Could not read Local State: ${err.code || err.message}`); }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (err) { throw new Error(`Local State is not valid JSON: ${err.message}`); }
  const encB64 = parsed?.os_crypt?.encrypted_key;
  if (!encB64) throw new Error('os_crypt.encrypted_key missing from Local State');

  const encBlob = Buffer.from(encB64, 'base64');
  if (encBlob.slice(0, 5).toString('ascii') !== 'DPAPI') {
    throw new Error('Unexpected key prefix (not a DPAPI blob)');
  }
  const dpapiBlob = encBlob.slice(5);

  const script = `
    $ErrorActionPreference = 'Stop'
    Add-Type -AssemblyName System.Security
    $b64 = [Console]::In.ReadToEnd().Trim()
    $bytes = [System.Convert]::FromBase64String($b64)
    $plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, 'CurrentUser')
    [Console]::Out.Write([System.Convert]::ToBase64String($plain))
  `;
  const stdout = await new Promise((resolve, reject) => {
    const proc = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-Command', script,
    ], { windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
      reject(new Error('PowerShell DPAPI unwrap timed out'));
    }, 10000);
    proc.stdout.on('data', (b) => { out += b.toString('utf-8'); });
    proc.stderr.on('data', (b) => { err += b.toString('utf-8'); });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`DPAPI unwrap failed (exit ${code}): ${err.trim().substring(0, 200)}`));
      resolve(out);
    });
    proc.stdin.write(dpapiBlob.toString('base64'));
    proc.stdin.end();
  });
  const key = Buffer.from(stdout.trim(), 'base64');
  if (key.length !== 32) throw new Error(`Decrypted key has unexpected length ${key.length} (expected 32)`);
  return key;
}

function decryptChromiumValue(encrypted, key) {
  if (!encrypted || encrypted.length === 0) return { ok: false, reason: 'empty' };
  const prefix = encrypted.slice(0, 3).toString('ascii');
  if (prefix === 'v20') {
    return { ok: false, reason: 'app-bound (v20) — Chrome 127+ seals this cookie to the Chrome process; install the panel browser extension instead' };
  }
  if (prefix !== 'v10' && prefix !== 'v11') {
    return { ok: false, reason: `unsupported scheme "${prefix}"` };
  }
  try {
    const nonce = encrypted.slice(3, 15);
    const tagStart = encrypted.length - 16;
    const ciphertext = encrypted.slice(15, tagStart);
    const tag = encrypted.slice(tagStart);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return { ok: true, value: plain.toString('utf-8') };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

export async function extractSteamCookies(browserId) {
  if (process.platform !== 'win32') {
    return { ok: false, browser: browserId, error: 'Only supported on Windows for now — use the browser extension on Linux/Mac' };
  }
  const def = BROWSER_DEFS.find((b) => b.id === browserId);
  if (!def) return { ok: false, browser: browserId, error: 'Unknown browser id' };
  const profile = def.find();
  if (!profile) return { ok: false, browser: browserId, error: `${def.label} profile not found on this machine` };

  if (def.family === 'firefox') {
    const r = await readFirefoxCookies(profile.cookiesPath);
    if (!r.ok) return { ok: false, browser: browserId, error: r.error };
    return pickSteamCookies(browserId, r.rows.map((row) => ({ name: row.name, value: row.value, host: row.host })));
  }

  const r = await readChromiumCookies(profile.cookiesPath);
  if (!r.ok) return { ok: false, browser: browserId, error: r.error };

  let key = masterKeyCache.get(browserId);
  if (!key) {
    try {
      key = await getChromiumMasterKey(def.localStatePath());
      masterKeyCache.set(browserId, key);
    } catch (err) {
      log.warn(`${def.label} master key extraction failed: ${err.message}`);
      return { ok: false, browser: browserId, error: `Could not unwrap ${def.label}'s cookie key: ${err.message}` };
    }
  }

  const decoded = [];
  const notes = [];
  let appBoundCount = 0;
  for (const row of r.rows) {
    if (row.value && row.value.length > 0) {
      decoded.push({ name: row.name, value: String(row.value), host: row.host_key });
      continue;
    }
    const enc = row.encrypted_value;
    if (!enc || enc.length === 0) continue;
    const buf = Buffer.isBuffer(enc) ? enc : Buffer.from(enc);
    const dec = decryptChromiumValue(buf, key);
    if (dec.ok) {
      decoded.push({ name: row.name, value: dec.value, host: row.host_key });
    } else {
      if (dec.reason && dec.reason.startsWith('app-bound')) appBoundCount += 1;
      log.debug(`Skipped ${row.name}@${row.host_key}: ${dec.reason}`);
    }
  }
  if (appBoundCount > 0) {
    notes.push(`${appBoundCount} cookie(s) are sealed by Chrome 127+ App-Bound Encryption and cannot be extracted from outside Chrome. Install the panel's browser extension instead if steamLoginSecure is missing below.`);
  }
  return pickSteamCookies(browserId, decoded, notes);
}

function pickSteamCookies(browserId, cookies, notes = []) {
  const find = (name) => {
    // Sort matches by host priority (steamcommunity > store), then by value
    // length descending so we don't accidentally pick an empty/stale cookie
    // when a populated one is also present.
    const matches = cookies
      .filter((c) => c.name === name && c.value)
      .sort((a, b) => {
        const pa = STEAM_HOST_PRIORITY(a.host);
        const pb = STEAM_HOST_PRIORITY(b.host);
        if (pa !== pb) return pa - pb;
        return (b.value?.length || 0) - (a.value?.length || 0);
      });
    return matches.length > 0 ? matches[0].value : null;
  };
  const sessionid = find('sessionid');
  const steamLoginSecure = find('steamLoginSecure');
  const missing = [];
  if (!sessionid) missing.push('sessionid');
  if (!steamLoginSecure) missing.push('steamLoginSecure');
  return {
    ok: !!(sessionid && steamLoginSecure),
    browser: browserId,
    sessionid: sessionid || null,
    steamLoginSecure: steamLoginSecure || null,
    missing,
    notes,
    error: missing.length > 0
      ? `Missing ${missing.join(' + ')} — make sure you're logged into Steam in this browser`
      : null,
  };
}
