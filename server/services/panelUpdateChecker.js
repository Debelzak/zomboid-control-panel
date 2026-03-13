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

export class PanelUpdateChecker {
  constructor(io) {
    this.io = io;
    this.checkInterval = null;
    this.latestRelease = null;
    this.currentVersion = null;
    this.updateAvailable = false;
    this.isChecking = false;
    this.isDownloading = false;
    this.downloadProgress = 0;
  }

  /**
   * Start the panel update checker
   */
  async start(currentVersion) {
    this.currentVersion = currentVersion || '0.0.0';
    log.info(`Panel update checker started (current: v${this.currentVersion})`);

    // Initial check after 30 seconds
    setTimeout(() => this.checkForUpdate(), 30000);

    // Periodic checks
    this.checkInterval = setInterval(() => this.checkForUpdate(), CHECK_INTERVAL_MS);
  }

  /**
   * Stop the checker
   */
  stop() {
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

    try {
      const release = await this.fetchLatestRelease();
      if (!release) {
        this.isChecking = false;
        return this.getStatus();
      }

      this.latestRelease = {
        version: release.tag_name.replace(/^v/, ''),
        tag: release.tag_name,
        name: release.name,
        body: release.body,
        publishedAt: release.published_at,
        htmlUrl: release.html_url,
        assets: (release.assets || []).map(a => ({
          name: a.name,
          size: a.size,
          downloadUrl: a.browser_download_url
        }))
      };

      this.updateAvailable = this.isNewer(this.latestRelease.version, this.currentVersion);

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
        if (res.statusCode === 404) {
          resolve(null);
          return;
        }
        if (res.statusCode === 403) {
          reject(new Error('GitHub API rate limited'));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`GitHub API returned ${res.statusCode}`));
          return;
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Failed to parse GitHub response'));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error('GitHub API timeout'));
      });
    });
  }

  /**
   * Compare semver-ish versions. Returns true if latest > current.
   */
  isNewer(latest, current) {
    // Strip any non-numeric prefixes/suffixes for comparison
    const normalize = (v) => {
      const match = v.match(/(\d+)\.(\d+)\.(\d+)/);
      if (!match) return [0, 0, 0];
      return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
    };

    const [lMajor, lMinor, lPatch] = normalize(latest);
    const [cMajor, cMinor, cPatch] = normalize(current);

    if (lMajor !== cMajor) return lMajor > cMajor;
    if (lMinor !== cMinor) return lMinor > cMinor;
    return lPatch > cPatch;
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

    try {
      const exePath = process.execPath;
      const exeDir = path.dirname(exePath);
      const updatePath = path.join(exeDir, `${assetName}.update`);
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
        try { if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); } catch (_) {}
        fs.renameSync(exePath, oldPath);
        fs.renameSync(updatePath, exePath);
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
      log.error(`Update download failed: ${error.message}`);
      return { success: false, error: error.message };
    } finally {
      this.isDownloading = false;
    }
  }

  /**
   * Download a file with progress tracking
   */
  downloadFile(url, destPath, expectedSize) {
    return new Promise((resolve, reject) => {
      const MAX_REDIRECTS = 5;
      const follow = (downloadUrl, redirectCount = 0) => {
        if (redirectCount > MAX_REDIRECTS) {
          return reject(new Error(`Too many redirects (max ${MAX_REDIRECTS})`));
        }
        https.get(downloadUrl, { headers: { 'User-Agent': `ZomboidControlPanel/${this.currentVersion}` } }, (res) => {
          // Follow redirects (GitHub uses them for asset downloads)
          if (res.statusCode === 301 || res.statusCode === 302) {
            const location = res.headers.location;
            if (!location) return reject(new Error('Redirect without location'));
            if (!location.startsWith('https://')) return reject(new Error('Redirect to non-HTTPS URL rejected'));
            follow(location, redirectCount + 1);
            return;
          }

          if (res.statusCode !== 200) {
            return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
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

          res.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
          file.on('error', (err) => {
            fs.unlink(destPath, () => {});
            reject(err);
          });
        }).on('error', reject);
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
      downloadProgress: this.downloadProgress
    };
  }
}
