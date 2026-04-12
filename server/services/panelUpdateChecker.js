/**
 * Panel Update Checker
 * 
 * Checks for new panel releases on GitHub and provides a self-update mechanism.
 * - Periodically checks github.com/fpsacha/zomboid-control-panel/releases
 * - Compares installed version vs latest GitHub release
 * - Downloads and replaces the binary for one-click updates (exe mode only)
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
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

    const isWindows = process.platform === 'win32';
    const isPackaged = typeof process.pkg !== 'undefined';

    if (!isPackaged) {
      return { success: false, error: 'Self-update is only available for standalone exe/binary builds. In dev mode, pull the latest code with git.' };
    }

    // Find the right asset
    const assetName = isWindows ? 'ZomboidControlPanel.exe' : 'ZomboidControlPanel';
    const asset = this.latestRelease.assets.find(a =>
      a.name === assetName ||
      a.name.toLowerCase().includes(isWindows ? 'windows' : 'linux')
    );

    if (!asset) {
      return { success: false, error: `No ${isWindows ? 'Windows' : 'Linux'} binary found in release` };
    }

    this.isDownloading = true;
    this.downloadProgress = 0;
    this.lastError = null;

    try {
      const exePath = process.execPath;
      const exeDir = path.dirname(exePath);
      const updatePath = path.join(exeDir, `${assetName}.update.${Date.now()}.${process.pid}`);
      const backupPath = path.join(exeDir, `${assetName}.backup`);

      log.info(`Downloading update: ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)} MB)`);
      this.io?.emit('panel:downloadProgress', { progress: 0, status: 'downloading' });

      // Download the file
      await this.downloadFile(asset.downloadUrl, updatePath, asset.size);

      log.info('Download complete, preparing update...');
      this.io?.emit('panel:downloadProgress', { progress: 100, status: 'preparing' });

      // Backup current binary
      try {
        if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
        fs.copyFileSync(exePath, backupPath);
      } catch (e) {
        log.warn(`Could not create backup: ${e.message}`);
      }

      // On Windows, can't replace running exe directly — rename approach
      if (isWindows) {
        const oldPath = exePath + '.old';
        try { if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); } catch (cleanErr) {
          log.debug(`Failed to clean old exe: ${cleanErr.message}`);
        }
        fs.renameSync(exePath, oldPath);
        try {
          fs.renameSync(updatePath, exePath);
        } catch (replaceError) {
          // Best-effort rollback if replacement fails
          if (!fs.existsSync(exePath) && fs.existsSync(oldPath)) {
            try {
              fs.renameSync(oldPath, exePath);
            } catch (_) {
              // If rollback fails, bubble the original replacement error
            }
          }
          throw replaceError;
        }
      } else {
        // Linux: can replace running binary (new process will use new binary)
        fs.renameSync(updatePath, exePath);
        fs.chmodSync(exePath, 0o755);
      }

      log.info(`Update to v${this.latestRelease.version} ready. Restart to apply.`);
      this.io?.emit('panel:updateReady', { version: this.latestRelease.version });

      // Store pending version so we know after restart
      await setSetting('pendingPanelUpdate', this.latestRelease.version);

      return { success: true, message: `Update to v${this.latestRelease.version} downloaded. Restart the panel to apply.` };
    } catch (error) {
      this.lastError = error.message;
      log.error(`Update download failed: ${error.message}`);
      return { success: false, error: error.message };
    } finally {
      // Best-effort cleanup of temp update binaries
      try {
        const exeDir = path.dirname(process.execPath);
        const staleTempPrefix = `${isWindows ? 'ZomboidControlPanel.exe' : 'ZomboidControlPanel'}.update.`;
        const staleFiles = fs.readdirSync(exeDir).filter(name => name.startsWith(staleTempPrefix));
        for (const name of staleFiles) {
          try { fs.unlinkSync(path.join(exeDir, name)); } catch (delErr) {
            log.debug(`Failed to clean stale update file ${name}: ${delErr.message}`);
          }
        }
      } catch (cleanupErr) {
        log.debug(`Update cleanup failed: ${cleanupErr.message}`);
      }

      this.isDownloading = false;
    }
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
      lastError: this.lastError
    };
  }
}
