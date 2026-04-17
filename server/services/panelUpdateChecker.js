/**
 * Panel Update Checker
 * 
 * Checks for new panel releases on GitHub and provides a self-update mechanism.
 * - Periodically checks github.com/fpsacha/zomboid-control-panel/releases
 * - Compares installed version vs latest GitHub release
 * - Downloads and replaces the binary for one-click updates (exe mode only)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { createLogger } from '../utils/logger.js';
import { getSetting, setSetting } from '../database/init.js';

const log = createLogger('PanelUpdater');

const GITHUB_OWNER = 'fpsacha';
const GITHUB_REPO = 'zomboid-control-panel';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // Check every 6 hours
const GITHUB_API_TIMEOUT_MS = 15000;
const DOWNLOAD_TIMEOUT_MS = 60000;
const MAX_GITHUB_RETRIES = 3;
const MAX_DOWNLOAD_REDIRECTS = 5;

export class PanelUpdateChecker {
  constructor(io) {
    this.io = io;
    this.checkInterval = null;
    this.initialTimeout = null;
    this.latestRelease = null;
    this.currentVersion = null;
    this.updateAvailable = false;
    this.isChecking = false;
    this.isDownloading = false;
    this.downloadProgress = 0;
    this.lastCheck = null;
    this.lastError = null;
  }

  /**
   * Start the panel update checker
   */
  async start(currentVersion) {
    this.currentVersion = currentVersion || '0.0.0';
    log.info(`Panel update checker started (current: v${this.currentVersion})`);

    // Confirm or report on any update that was pending from a previous run.
    // This runs once at startup so the client can see a success/failure banner.
    try {
      await this.reconcilePendingUpdate();
    } catch (err) {
      log.warn(`Could not reconcile pending panel update: ${err.message}`);
    }

    // Every apply writes a .ps1 helper and a .log to %TEMP%. Keep the last few
    // for post-mortem debugging and remove older ones so they don't accumulate
    // forever on long-running installs.
    try {
      this.cleanupOldHelperArtifacts();
    } catch (err) {
      log.debug(`Helper artifact cleanup failed: ${err.message}`);
    }

    // Initial check after 30 seconds
    this.initialTimeout = setTimeout(() => this.checkForUpdate(), 30000);

    // Periodic checks
    this.checkInterval = setInterval(() => this.checkForUpdate(), CHECK_INTERVAL_MS);
  }

  /**
   * Stop the checker
   */
  stop() {
    if (this.initialTimeout) {
      clearTimeout(this.initialTimeout);
      this.initialTimeout = null;
    }
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Check GitHub for the latest release
   */
  async checkForUpdate() {
    if (this.isChecking) return this.getStatus();
    this.isChecking = true;
    this.lastCheck = new Date().toISOString();

    try {
      const release = await this.fetchLatestRelease();
      if (!release) {
        this.lastError = null;
        this.isChecking = false;
        return this.getStatus();
      }

      const releaseVersion = this.extractVersion(release.tag_name);
      if (!releaseVersion) {
        throw new Error('Latest GitHub release is missing a valid version tag.');
      }

      this.latestRelease = {
        version: releaseVersion,
        tag: release.tag_name,
        name: typeof release.name === 'string' ? release.name : release.tag_name,
        body: typeof release.body === 'string' ? release.body : '',
        publishedAt: release.published_at || null,
        htmlUrl: release.html_url || null,
        assets: (release.assets || []).map(a => ({
          name: a.name,
          size: a.size,
          downloadUrl: a.browser_download_url
        }))
      };

      this.updateAvailable = this.isNewer(this.latestRelease.version, this.currentVersion);
      this.lastError = null;

      if (this.updateAvailable) {
        log.info(`Panel update available: v${this.currentVersion} → v${this.latestRelease.version}`);
        this.io?.emit('panel:updateAvailable', {
          currentVersion: this.currentVersion,
          latestVersion: this.latestRelease.version,
          releaseUrl: this.latestRelease.htmlUrl
        });
      } else {
        log.debug(`Panel is up to date (v${this.currentVersion})`);
      }
    } catch (error) {
      this.lastError = error.message;
      log.warn(`Panel update check failed: ${error.message}`);
    } finally {
      this.isChecking = false;
    }

    return this.getStatus();
  }

  /**
   * Fetch the latest release from GitHub API
   */
  fetchLatestRelease() {
    return this.requestGitHubReleaseWithRetry();
  }

  async requestGitHubReleaseWithRetry() {
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_GITHUB_RETRIES; attempt += 1) {
      try {
        return await this.fetchLatestReleaseOnce();
      } catch (error) {
        lastError = error;
        if (!this.isRetryableGitHubError(error) || attempt === MAX_GITHUB_RETRIES) {
          break;
        }

        const backoffMs = attempt * 1000;
        log.warn(`Panel update check attempt ${attempt} failed (${error.message}). Retrying in ${backoffMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }

    throw lastError || new Error('Unknown GitHub update check failure');
  }

  fetchLatestReleaseOnce() {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
        headers: {
          'User-Agent': `ZomboidControlPanel/${this.currentVersion}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      };

      const req = https.get(options, (res) => {
        const statusCode = res.statusCode || 0;

        if (statusCode === 404) {
          res.resume();
          resolve(null);
          return;
        }

        if (statusCode !== 200) {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk.toString();
            if (body.length > 4096) body = body.slice(0, 4096);
          });
          res.on('end', () => {
            const err = new Error(statusCode === 403 ? 'GitHub API rate limited' : `GitHub API returned ${statusCode}`);
            err.statusCode = statusCode;
            if (body.includes('rate limit')) {
              err.rateLimited = true;
            }
            reject(err);
          });
          return;
        }

        let data = '';
        res.on('data', (chunk) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (!parsed || typeof parsed !== 'object') {
              throw new Error('Invalid GitHub release payload');
            }
            resolve(parsed);
          } catch (_) {
            reject(new Error('Failed to parse GitHub response'));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(GITHUB_API_TIMEOUT_MS, () => {
        const timeoutError = new Error('GitHub API timeout');
        timeoutError.code = 'ETIMEDOUT';
        req.destroy(timeoutError);
      });
    });
  }

  isRetryableGitHubError(error) {
    const statusCode = error?.statusCode;
    const code = error?.code;
    if ([408, 429, 500, 502, 503, 504].includes(statusCode)) return true;
    if (code && ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND'].includes(code)) return true;
    return Boolean(error?.rateLimited);
  }

  extractVersion(tag) {
    if (typeof tag !== 'string') return null;
    const match = tag.match(/(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!match) return null;
    return match[4] ? `${match[1]}.${match[2]}.${match[3]}.${match[4]}` : `${match[1]}.${match[2]}.${match[3]}`;
  }

  /**
   * Compare semver-ish versions (supports 3 or 4 parts). Returns true if latest > current.
   */
  isNewer(latest, current) {
    const normalize = (v) => {
      const match = v.match(/(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/);
      if (!match) return [0, 0, 0, 0];
      return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3]), parseInt(match[4] || '0')];
    };

    const [lMajor, lMinor, lPatch, lHotfix] = normalize(latest);
    const [cMajor, cMinor, cPatch, cHotfix] = normalize(current);

    if (lMajor !== cMajor) return lMajor > cMajor;
    if (lMinor !== cMinor) return lMinor > cMinor;
    if (lPatch !== cPatch) return lPatch > cPatch;
    return lHotfix > cHotfix;
  }

  /**
   * Download the update binary and prepare for restart
   */
  async downloadUpdate() {
    if (this.isDownloading) {
      return { success: false, error: 'Download already in progress' };
    }
    if (!this.updateAvailable || !this.latestRelease) {
      return { success: false, error: 'No update available' };
    }

    // Preflight gates the download — we refuse to stage anything if we already
    // know the apply step will fail (no write permission, no disk space, etc).
    const pre = await this.preflight();
    if (!pre.ok) {
      return { success: false, error: pre.blockers[0] || 'Preflight check failed', preflight: pre };
    }

    const isWindows = process.platform === 'win32';
    const isPackaged = typeof process.pkg !== 'undefined';

    if (!isPackaged) {
      return { success: false, error: 'Self-update is only available for standalone exe/binary builds. In dev mode, pull the latest code with git.' };
    }

    // Find the right asset — MUST be the raw binary, not the archive.
    // Release assets include both ZomboidControlPanel.exe (the binary, ~40MB) and
    // ZomboidControlPanel-windows.zip (the full package, ~18MB). Using a loose
    // `.includes('windows')` match would grab the zip and corrupt the install.
    const assetName = isWindows ? 'ZomboidControlPanel.exe' : 'ZomboidControlPanel';
    const isArchive = (name) => /\.(zip|tar\.gz|tgz|7z|rar)$/i.test(name || '');

    let asset = this.latestRelease.assets.find(a => a.name === assetName);
    if (!asset) {
      // Conservative fallback: require the raw extension/shape and exclude archives.
      if (isWindows) {
        asset = this.latestRelease.assets.find(a => /\.exe$/i.test(a.name) && !isArchive(a.name));
      } else {
        asset = this.latestRelease.assets.find(a => !isArchive(a.name) && !/\.exe$/i.test(a.name) && a.name.toLowerCase().includes('linux'));
      }
    }

    if (!asset) {
      return { success: false, error: `No ${isWindows ? 'Windows' : 'Linux'} binary found in release (looked for ${assetName})` };
    }

    this.isDownloading = true;
    this.downloadProgress = 0;
    this.lastError = null;

    const exePath = process.execPath;
    const exeDir = path.dirname(exePath);
    // Staged binary sits next to the running exe. We do NOT rename the running
    // binary here — that fails on OneDrive-synced folders, with AV, or when any
    // other process holds a handle. On Windows the swap happens after shutdown
    // via an external helper (see applyStagedUpdateAndExit / /api/panel/restart).
    const stagedPath = path.join(exeDir, `${assetName}.new`);
    const tmpDownloadPath = path.join(exeDir, `${assetName}.new.partial.${process.pid}`);

    try {
      log.info(`Downloading update: ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)} MB)`);
      this.io?.emit('panel:downloadProgress', { progress: 0, status: 'downloading' });

      // Clear any prior staged file so we always download fresh
      try { if (fs.existsSync(tmpDownloadPath)) fs.unlinkSync(tmpDownloadPath); } catch (cleanErr) {
        log.debug(`Failed to clean partial file: ${cleanErr.message}`);
      }

      await this.downloadFile(asset.downloadUrl, tmpDownloadPath, asset.size);

      log.info('Download complete, staging update...');
      this.io?.emit('panel:downloadProgress', { progress: 100, status: 'preparing' });

      // Cryptographic integrity check against the published checksums.txt.
      // Size + magic bytes already ruled out HTML error pages and wrong-asset
      // confusion. SHA256 additionally rules out silent corruption in transit
      // and supply-chain tampering on the mirror edge. Older releases may not
      // ship checksums.txt — treat that as a warning, not a failure.
      try {
        const verified = await this.verifyChecksum(tmpDownloadPath, asset.name);
        if (verified === false) {
          throw new Error('SHA256 checksum mismatch — download corrupted or tampered with');
        }
        if (verified === null) {
          log.warn(`No checksums.txt in release v${this.latestRelease.version}; skipping SHA256 verification`);
        } else {
          log.info(`SHA256 verified against release checksums.txt`);
        }
      } catch (verifyErr) {
        // Any thrown error from verifyChecksum is a hard stop: either the
        // checksum mismatched or the verification logic failed fatally.
        try { fs.unlinkSync(tmpDownloadPath); } catch { /* best effort */ }
        throw verifyErr;
      }

      // Promote .partial → .new atomically. If a stale .new exists, drop it first.
      try { if (fs.existsSync(stagedPath)) fs.unlinkSync(stagedPath); } catch (cleanErr) {
        log.debug(`Failed to clean stale staged file: ${cleanErr.message}`);
      }
      fs.renameSync(tmpDownloadPath, stagedPath);

      if (!isWindows) {
        try { fs.chmodSync(stagedPath, 0o755); } catch (chmodErr) {
          log.warn(`Could not chmod staged binary: ${chmodErr.message}`);
        }
      }

      // NOTE: We intentionally do NOT set `pendingPanelUpdate` here. That
      // setting is the "we actually committed to apply this" marker used by
      // reconcilePendingUpdate() on next boot. Setting it at download time
      // would cause a false-positive "Update Failed to Apply" banner if the
      // user downloads but never clicks Restart and Apply. The restart
      // endpoint writes it right before exit instead.

      log.info(`Update to v${this.latestRelease.version} staged at ${stagedPath}. Restart to apply.`);
      this.io?.emit('panel:updateReady', { version: this.latestRelease.version });

      return { success: true, message: `Update to v${this.latestRelease.version} downloaded. Restart the panel to apply.` };
    } catch (error) {
      this.lastError = error.message;
      log.error(`Update download failed: ${error.message}`);
      // Clean up any partial on failure
      try { if (fs.existsSync(tmpDownloadPath)) fs.unlinkSync(tmpDownloadPath); } catch (delErr) {
        log.debug(`Failed to clean partial after error: ${delErr.message}`);
      }
      return { success: false, error: error.message };
    } finally {
      this.isDownloading = false;
    }
  }

  /**
   * Check if a downloaded-but-not-applied update is staged next to the exe.
   * Returns null if nothing is staged, or { stagedPath, exePath, version }.
   */
  getStagedUpdate() {
    if (typeof process.pkg === 'undefined') return null;
    const isWindows = process.platform === 'win32';
    const assetName = isWindows ? 'ZomboidControlPanel.exe' : 'ZomboidControlPanel';
    const exePath = process.execPath;
    const stagedPath = path.join(path.dirname(exePath), `${assetName}.new`);
    if (!fs.existsSync(stagedPath)) return null;
    try {
      const stats = fs.statSync(stagedPath);
      if (stats.size < 1024 * 1024) {
        // Sanity: any real build is many MB. Anything smaller is a failed download.
        log.warn(`Staged update at ${stagedPath} is suspiciously small (${stats.size} bytes); ignoring.`);
        return null;
      }
    } catch (err) {
      log.debug(`Could not stat staged update: ${err.message}`);
      return null;
    }
    return {
      stagedPath,
      exePath,
      version: this.latestRelease?.version || null
    };
  }

  /**
   * On Windows, a running exe cannot reliably be renamed in-place (OneDrive,
   * AV, and file-handle holders can block it). We write a helper PowerShell
   * script to TEMP that waits for this process to exit, swaps the files with
   * retries, then relaunches the panel. Caller should exit immediately after
   * spawning.
   *
   * On Linux the caller should just overwrite the running binary directly —
   * the running process keeps its inode, and the new binary takes effect on
   * the next spawn. This helper is Windows-only.
   */
  async spawnWindowsApplyHelper() {
    if (process.platform !== 'win32') {
      throw new Error('spawnWindowsApplyHelper is Windows-only');
    }
    const staged = this.getStagedUpdate();
    if (!staged) {
      throw new Error('No staged update found');
    }

    const { stagedPath, exePath } = staged;
    const oldPath = `${exePath}.old`;
    const ts = Date.now();
    const logPath = path.join(os.tmpdir(), `zomboid-panel-update-${ts}.log`);
    const ps1Path = path.join(os.tmpdir(), `zomboid-panel-apply-${ts}-${process.pid}.ps1`);

    const ps = [
      '$ErrorActionPreference = "Stop"',
      `$pidToWatch = ${process.pid}`,
      `$exePath = ${this.psQuote(exePath)}`,
      `$stagedPath = ${this.psQuote(stagedPath)}`,
      `$oldPath = ${this.psQuote(oldPath)}`,
      `$logPath = ${this.psQuote(logPath)}`,
      `$workDir = ${this.psQuote(path.dirname(exePath))}`,
      'function Log($m) { Add-Content -LiteralPath $logPath -Value ("[{0}] {1}" -f (Get-Date -Format o), $m) }',
      'Log "Apply helper started"',
      '# Wait for the panel process to exit (up to 30s)',
      'for ($i=0; $i -lt 60; $i++) {',
      '  try { Get-Process -Id $pidToWatch -ErrorAction Stop | Out-Null; Start-Sleep -Milliseconds 500 }',
      '  catch { break }',
      '}',
      'Log "Panel process exited"',
      '# Remove previous backup if present',
      'if (Test-Path -LiteralPath $oldPath) {',
      '  try { Remove-Item -LiteralPath $oldPath -Force } catch { Log ("Could not remove old backup: " + $_.Exception.Message) }',
      '}',
      '# Retry the rename in case AV/OneDrive is still holding the handle (10s max)',
      '$renamed = $false',
      'for ($i=0; $i -lt 20; $i++) {',
      '  try { Move-Item -LiteralPath $exePath -Destination $oldPath -Force; $renamed = $true; break }',
      '  catch { Log ("Rename attempt " + ($i+1) + " failed: " + $_.Exception.Message); Start-Sleep -Milliseconds 500 }',
      '}',
      'if (-not $renamed) { Log "Giving up — could not rename running exe. Staged .new file left in place for manual recovery."; exit 1 }',
      '# Put the new binary in place',
      '$placed = $false',
      'for ($i=0; $i -lt 20; $i++) {',
      '  try { Move-Item -LiteralPath $stagedPath -Destination $exePath -Force; $placed = $true; break }',
      '  catch { Log ("Place attempt " + ($i+1) + " failed: " + $_.Exception.Message); Start-Sleep -Milliseconds 500 }',
      '}',
      'if (-not $placed) {',
      '  Log "Place failed — rolling back to previous exe"',
      '  try { Move-Item -LiteralPath $oldPath -Destination $exePath -Force } catch { Log ("Rollback failed: " + $_.Exception.Message) }',
      '  exit 2',
      '}',
      'Log "Update applied; relaunching panel"',
      'try { Start-Process -FilePath $exePath -WorkingDirectory $workDir } catch { Log ("Relaunch failed: " + $_.Exception.Message) }',
      'Log "Apply helper done"'
    ].join('\r\n');

    fs.writeFileSync(ps1Path, ps, { encoding: 'utf8' });

    log.info(`Spawning update apply helper: ${ps1Path} (log: ${logPath})`);

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ps1Path],
      { detached: true, stdio: 'ignore', windowsHide: true }
    );
    child.unref();

    return { helperPath: ps1Path, logPath };
  }

  /**
   * Quote a string for PowerShell single-quoted literal safely.
   * Single-quoted PS strings only need `'` doubled to escape.
   */
  psQuote(value) {
    const s = String(value).replace(/'/g, "''");
    return `'${s}'`;
  }

  /**
   * Download a file with progress tracking
   */
  downloadFile(url, destPath, expectedSize) {
    return new Promise((resolve, reject) => {
      let settled = false;

      const fail = (error) => {
        if (settled) return;
        settled = true;
        fs.unlink(destPath, () => {});
        reject(error);
      };

      const succeed = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const isAllowedRedirectHost = (downloadUrl) => {
        try {
          const parsed = new URL(downloadUrl);
          const host = parsed.hostname.toLowerCase();
          return (
            host === 'github.com' ||
            host === 'api.github.com' ||
            host === 'objects.githubusercontent.com' ||
            host === 'github-releases.githubusercontent.com' ||
            host.endsWith('.githubusercontent.com')
          );
        } catch (e) {
          log.debug(`Invalid download URL: ${e.message}`);
          return false;
        }
      };

      const follow = (downloadUrl, redirectCount = 0) => {
        if (redirectCount > MAX_DOWNLOAD_REDIRECTS) {
          return fail(new Error(`Too many redirects (max ${MAX_DOWNLOAD_REDIRECTS})`));
        }

        if (!downloadUrl.startsWith('https://')) {
          return fail(new Error('Download URL must use HTTPS'));
        }

        if (!isAllowedRedirectHost(downloadUrl)) {
          return fail(new Error('Download host is not trusted'));
        }

        const req = https.get(downloadUrl, { headers: { 'User-Agent': `ZomboidControlPanel/${this.currentVersion}` } }, (res) => {
          // Follow redirects (GitHub uses them for asset downloads)
          if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
            const location = res.headers.location;
            if (!location) return fail(new Error('Redirect without location'));
            if (!location.startsWith('https://')) return fail(new Error('Redirect to non-HTTPS URL rejected'));
            res.resume();
            follow(location, redirectCount + 1);
            return;
          }

          if (res.statusCode !== 200) {
            res.resume();
            return fail(new Error(`Download failed: HTTP ${res.statusCode}`));
          }

          const totalBytes = parseInt(res.headers['content-length'] || expectedSize, 10);
          let receivedBytes = 0;
          const file = fs.createWriteStream(destPath);

          let lastEmittedProgress = -1;
          res.on('data', (chunk) => {
            receivedBytes += chunk.length;
            if (totalBytes > 0) {
              this.downloadProgress = Math.round((receivedBytes / totalBytes) * 100);
              // Throttle progress updates to every 5% increment
              const bucket = Math.floor(this.downloadProgress / 5) * 5;
              if (bucket > lastEmittedProgress) {
                lastEmittedProgress = bucket;
                this.io?.emit('panel:downloadProgress', {
                  progress: this.downloadProgress,
                  status: 'downloading',
                  received: receivedBytes,
                  total: totalBytes
                });
              }
            }
          });

          res.on('error', fail);
          res.pipe(file);
          file.on('finish', () => {
            file.close(() => {
              if (expectedSize > 0 && receivedBytes !== expectedSize) {
                return fail(new Error(`Downloaded file size mismatch (expected ${expectedSize}, got ${receivedBytes})`));
              }
              // Validate the file is a real binary, not HTML from a hijacked
              // redirect, a JSON error page, or a partially-written blob.
              const magicErr = this.validateBinaryMagic(destPath);
              if (magicErr) {
                return fail(new Error(`Downloaded file failed integrity check: ${magicErr}`));
              }
              succeed();
            });
          });
          file.on('error', (err) => {
            fail(err);
          });
        });

        req.on('error', fail);
        req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
          const timeoutError = new Error('Download timed out');
          timeoutError.code = 'ETIMEDOUT';
          req.destroy(timeoutError);
        });
      };

      follow(url);
    });
  }

  /**
   * Get current status
   */
  getStatus() {
    const staged = this.getStagedUpdate();
    return {
      currentVersion: this.currentVersion,
      updateAvailable: this.updateAvailable,
      latestVersion: this.latestRelease?.version || null,
      releaseUrl: this.latestRelease?.htmlUrl || null,
      releaseNotes: this.latestRelease?.body || null,
      publishedAt: this.latestRelease?.publishedAt || null,
      isChecking: this.isChecking,
      isDownloading: this.isDownloading,
      downloadProgress: this.downloadProgress,
      lastCheck: this.lastCheck,
      lastError: this.lastError,
      stagedUpdate: staged ? { version: staged.version, path: staged.stagedPath } : null,
      lastApplyResult: this.lastApplyResult || null
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Hardening: preflight, validation, post-apply confirmation, log surfacing
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Run preflight checks before download/apply. Returns:
   *   { ok, blockers: string[], warnings: string[], info: {...} }
   * Blockers prevent the update from proceeding; warnings are shown to the user.
   */
  async preflight() {
    const blockers = [];
    const warnings = [];
    const info = {};

    const isWindows = process.platform === 'win32';
    const isPackaged = typeof process.pkg !== 'undefined';
    info.isPackaged = isPackaged;
    info.platform = process.platform;

    if (!isPackaged) {
      blockers.push('Self-update is only available in packaged builds. In dev mode, pull the latest code with git.');
      return { ok: false, blockers, warnings, info };
    }

    if (!this.latestRelease) {
      warnings.push('No release info cached yet — click Check for Updates first.');
      return { ok: blockers.length === 0, blockers, warnings, info };
    }

    if (!this.updateAvailable) {
      info.alreadyCurrent = true;
    }

    const exePath = process.execPath;
    const exeDir = path.dirname(exePath);
    info.exePath = exePath;
    info.exeDir = exeDir;

    // Resolve the asset so we can size-check.
    const assetName = isWindows ? 'ZomboidControlPanel.exe' : 'ZomboidControlPanel';
    const isArchive = (name) => /\.(zip|tar\.gz|tgz|7z|rar)$/i.test(name || '');
    let asset = this.latestRelease.assets.find(a => a.name === assetName);
    if (!asset) {
      if (isWindows) {
        asset = this.latestRelease.assets.find(a => /\.exe$/i.test(a.name) && !isArchive(a.name));
      } else {
        asset = this.latestRelease.assets.find(a => !isArchive(a.name) && !/\.exe$/i.test(a.name) && a.name.toLowerCase().includes('linux'));
      }
    }
    if (!asset) {
      blockers.push(`No ${isWindows ? 'Windows' : 'Linux'} binary found in the latest release.`);
    } else {
      info.asset = { name: asset.name, size: asset.size };
    }

    // Write permission probe — try to create + remove a test file next to the exe.
    const probePath = path.join(exeDir, `.panel-write-probe.${process.pid}`);
    try {
      fs.writeFileSync(probePath, 'ok');
      fs.unlinkSync(probePath);
      info.writable = true;
    } catch (err) {
      info.writable = false;
      blockers.push(`Panel folder is not writable by this process: ${err.code || err.message}. Try running as Administrator, or move the panel out of a protected folder.`);
    }

    // Free disk space check — need ~2x asset size (staged + rename buffer).
    if (asset?.size) {
      try {
        const free = await this.getFreeDiskSpace(exeDir);
        info.freeBytes = free;
        const needed = asset.size * 2;
        if (free !== null && free < needed) {
          blockers.push(`Not enough free disk space. Need ~${(needed / 1024 / 1024).toFixed(0)} MB, have ${(free / 1024 / 1024).toFixed(0)} MB.`);
        }
      } catch (err) {
        log.debug(`Free-space check failed: ${err.message}`);
      }
    }

    // OneDrive/sync warning — this is the exact failure from the bug report.
    if (isWindows) {
      const lowered = exeDir.toLowerCase();
      const inOneDrive = lowered.includes('\\onedrive\\') || lowered.includes('\\onedrive -');
      const onDesktop = /\\desktop(\\|$)/.test(lowered);
      const inDocuments = /\\documents(\\|$)/.test(lowered);
      if (inOneDrive) {
        warnings.push('Panel lives inside a OneDrive-synced folder. Sync can briefly lock the exe while it is being replaced. Pause OneDrive before clicking Restart and Apply, or move the panel to a non-synced location (e.g. C:\\ZomboidPanel).');
        info.oneDrive = true;
      } else if (onDesktop || inDocuments) {
        warnings.push('Panel lives on the Desktop or in Documents. If you use OneDrive Backup/Known Folder Move, that folder is sync-backed and may lock the exe during apply. Consider moving the panel to a non-synced location.');
        info.syncSuspect = true;
      }

      const inProgramFiles = /^c:\\program files/i.test(exeDir);
      if (inProgramFiles) {
        warnings.push('Panel is installed under Program Files — Windows requires Administrator rights to replace files there. If apply fails, relaunch the panel as Administrator.');
        info.programFiles = true;
      }
    }

    // Existing staged file?
    const staged = this.getStagedUpdate();
    if (staged) {
      info.stagedUpdate = { version: staged.version, path: staged.stagedPath };
      warnings.push(`A previous update (v${staged.version || '?'}) is already staged and ready to apply on next restart.`);
    }

    // Lingering .old from a prior apply.
    try {
      const oldPath = exePath + '.old';
      if (fs.existsSync(oldPath)) {
        info.oldPath = oldPath;
        warnings.push('A previous backup (.old) is present next to the exe. It will be cleaned up on the next successful apply.');
      }
    } catch (err) {
      log.debug(`.old probe failed: ${err.message}`);
    }

    return { ok: blockers.length === 0, blockers, warnings, info };
  }

  /**
   * Best-effort free-disk-space probe. Returns bytes, or null on failure.
   * Uses a statfs API where available; falls back to null rather than throw.
   */
  async getFreeDiskSpace(dirPath) {
    try {
      if (typeof fs.promises.statfs === 'function') {
        const stat = await fs.promises.statfs(dirPath);
        return Number(stat.bavail) * Number(stat.bsize);
      }
    } catch (err) {
      log.debug(`statfs failed: ${err.message}`);
    }
    return null;
  }

  /**
   * Validate that a downloaded file is actually a binary for the current platform.
   * Returns null if valid, or an error message describing the mismatch.
   */
  validateBinaryMagic(filePath) {
    try {
      const fd = fs.openSync(filePath, 'r');
      const header = Buffer.alloc(4);
      const bytesRead = fs.readSync(fd, header, 0, 4, 0);
      fs.closeSync(fd);
      if (bytesRead < 2) return 'file is shorter than a file header';

      if (process.platform === 'win32') {
        // PE/EXE: starts with 'MZ' (0x4D 0x5A).
        if (header[0] !== 0x4D || header[1] !== 0x5A) {
          return `not a Windows executable (expected MZ header, got 0x${header[0].toString(16)}${header[1].toString(16)})`;
        }
      } else {
        // ELF: 0x7F 'E' 'L' 'F'.
        if (bytesRead < 4 || header[0] !== 0x7F || header[1] !== 0x45 || header[2] !== 0x4C || header[3] !== 0x46) {
          return 'not a Linux ELF executable';
        }
      }
      return null;
    } catch (err) {
      return `could not read downloaded file: ${err.message}`;
    }
  }

  /**
   * Compute the SHA256 digest of a file as a lowercase hex string.
   */
  sha256File(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('error', reject);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  /**
   * Fetch a small text asset (e.g. checksums.txt) to memory. Enforces the same
   * host allow-list and redirect cap as downloadFile, and caps the body at
   * 64KB so a compromised mirror can't pin memory.
   */
  fetchReleaseText(url, maxBytes = 64 * 1024) {
    return new Promise((resolve, reject) => {
      const allowedHost = (u) => {
        try {
          const host = new URL(u).hostname.toLowerCase();
          return host === 'github.com' || host === 'api.github.com'
            || host === 'objects.githubusercontent.com'
            || host === 'github-releases.githubusercontent.com'
            || host.endsWith('.githubusercontent.com');
        } catch { return false; }
      };

      const follow = (u, hops) => {
        if (hops > MAX_DOWNLOAD_REDIRECTS) return reject(new Error('Too many redirects'));
        if (!u.startsWith('https://')) return reject(new Error('Non-HTTPS URL rejected'));
        if (!allowedHost(u)) return reject(new Error('Untrusted host'));

        const req = https.get(u, { headers: { 'User-Agent': `ZomboidControlPanel/${this.currentVersion}` } }, (res) => {
          if ([301, 302, 307, 308].includes(res.statusCode)) {
            const loc = res.headers.location;
            res.resume();
            if (!loc) return reject(new Error('Redirect without location'));
            return follow(loc, hops + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          let size = 0;
          const chunks = [];
          res.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
              res.destroy(new Error(`Response exceeds ${maxBytes} bytes`));
              return;
            }
            chunks.push(chunk);
          });
          res.on('error', reject);
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        });
        req.on('error', reject);
        req.setTimeout(GITHUB_API_TIMEOUT_MS, () => req.destroy(new Error('Timed out')));
      };

      follow(url, 0);
    });
  }

  /**
   * Verify a downloaded file against checksums.txt from the release.
   * Returns:
   *   true  = checksum present and matched
   *   false = checksum present and did NOT match (throwable by caller)
   *   null  = checksum file not published in this release (skip w/ warning)
   *
   * Throws if checksums.txt IS published but cannot be fetched. Silently
   * skipping on fetch failure would let a network-level attacker disable
   * verification just by blocking one request.
   */
  async verifyChecksum(filePath, assetName) {
    if (!this.latestRelease?.assets) return null;
    const checksumAsset = this.latestRelease.assets.find(a => a.name === 'checksums.txt');
    if (!checksumAsset) return null;

    let text;
    try {
      text = await this.fetchReleaseText(checksumAsset.downloadUrl);
    } catch (err) {
      throw new Error(`Release publishes checksums.txt but it could not be fetched: ${err.message}`);
    }

    // Format: `<hex>  <filename>` per line. Tolerate extra whitespace and
    // comments. We only compare to the entry for our exact asset.
    const want = text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map(line => {
        const m = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+?)\s*$/);
        return m ? { hash: m[1].toLowerCase(), name: m[2] } : null;
      })
      .filter(Boolean)
      .find(entry => entry.name === assetName);

    if (!want) {
      log.warn(`checksums.txt present but has no entry for ${assetName}`);
      return null;
    }

    const got = (await this.sha256File(filePath)).toLowerCase();
    if (got !== want.hash) {
      log.error(`SHA256 mismatch for ${assetName}: expected ${want.hash}, got ${got}`);
      return false;
    }
    return true;
  }

  /**
   * Reconcile a pending update recorded before the last restart.
   * - If currentVersion matches the pending one → success (emit + clear).
   * - If staged file is still present → apply failed; capture helper log.
   * - Otherwise → apply may have silently failed or was never run.
   */
  async reconcilePendingUpdate() {
    const pending = await getSetting('pendingPanelUpdate');
    if (!pending) return;

    log.info(`Reconciling pending panel update: was v${pending}, now v${this.currentVersion}`);

    // Happy path: new version is running.
    if (this.isSameOrNewer(this.currentVersion, pending)) {
      this.lastApplyResult = {
        status: 'success',
        appliedVersion: pending,
        at: new Date().toISOString()
      };
      await setSetting('pendingPanelUpdate', null);
      log.info(`Panel update applied successfully → v${this.currentVersion}`);
      this.io?.emit('panel:updateApplied', this.lastApplyResult);
      return;
    }

    // Apply failed. Surface the helper log (Windows) so the UI can show it.
    const helperLog = this.readMostRecentApplyLog();
    this.lastApplyResult = {
      status: 'failed',
      pendingVersion: pending,
      currentVersion: this.currentVersion,
      at: new Date().toISOString(),
      stagedStillPresent: Boolean(this.getStagedUpdate()),
      helperLog
    };
    log.warn(`Panel update apply appears to have failed (pending v${pending}, running v${this.currentVersion})`);
    this.io?.emit('panel:updateApplyFailed', this.lastApplyResult);

    // Don't clear pendingPanelUpdate — keep it so the user can retry apply
    // (the .new file is likely still on disk).
  }

  /**
   * Read the most recent Windows apply-helper log from TEMP, if any.
   * Returns up to 8KB of log text or null.
   */
  readMostRecentApplyLog() {
    try {
      const dir = os.tmpdir();
      const names = fs.readdirSync(dir)
        .filter(n => /^zomboid-panel-update-\d+\.log$/.test(n))
        .map(n => {
          const fp = path.join(dir, n);
          try {
            const stat = fs.statSync(fp);
            return { fp, mtime: stat.mtimeMs, size: stat.size };
          } catch (err) {
            log.debug(`Could not stat ${fp}: ${err.message}`);
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => b.mtime - a.mtime);

      if (!names.length) return null;

      const { fp, size } = names[0];
      const MAX_BYTES = 8 * 1024;
      if (size <= MAX_BYTES) {
        return fs.readFileSync(fp, 'utf8');
      }
      const fd = fs.openSync(fp, 'r');
      try {
        const buf = Buffer.alloc(MAX_BYTES);
        fs.readSync(fd, buf, 0, MAX_BYTES, size - MAX_BYTES);
        return `... (truncated, tail only)\n${buf.toString('utf8')}`;
      } finally {
        fs.closeSync(fd);
      }
    } catch (err) {
      log.debug(`readMostRecentApplyLog failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Remove old apply-helper artifacts from %TEMP%, keeping the most recent
   * few for debugging. Each apply writes one .log and one .ps1; on Windows
   * these live forever unless Disk Cleanup runs.
   */
  cleanupOldHelperArtifacts(keep = 5) {
    const dir = os.tmpdir();
    const patterns = [
      /^zomboid-panel-update-\d+\.log$/,
      /^zomboid-panel-apply-\d+-\d+\.ps1$/
    ];
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch (err) {
      log.debug(`Could not read TEMP dir: ${err.message}`);
      return;
    }
    for (const pattern of patterns) {
      const matching = entries
        .filter(n => pattern.test(n))
        .map(n => {
          const fp = path.join(dir, n);
          try { return { fp, mtime: fs.statSync(fp).mtimeMs }; }
          catch { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => b.mtime - a.mtime);
      const toDelete = matching.slice(keep);
      for (const { fp } of toDelete) {
        try { fs.unlinkSync(fp); } catch (err) {
          log.debug(`Could not remove old helper artifact ${fp}: ${err.message}`);
        }
      }
      if (toDelete.length > 0) {
        log.debug(`Removed ${toDelete.length} old ${pattern.source} artifact(s) from TEMP`);
      }
    }
  }

  /**
   * true if version `a` is the same or newer than `b` (semver-ish, 3-4 parts).
   */
  isSameOrNewer(a, b) {
    if (a === b) return true;
    return this.isNewer(a, b);
  }
}
