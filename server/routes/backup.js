import express from 'express';
import path from 'path';
import fs from 'fs';
import { createLogger } from '../utils/logger.js';
import { sanitizeError } from '../utils/sanitize.js';
import { getActiveServer } from '../database/init.js';
const log = createLogger('API:Backup');

const router = express.Router();

// Get backup status and settings
router.get('/status', async (req, res) => {
  try {
    const backupService = req.app.get('backupService');
    const status = await backupService.getStatus();
    res.json(status);
  } catch (error) {
    log.error(`Failed to get backup status: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Get info about what backups contain
router.get('/info', async (req, res) => {
  try {
    const backupService = req.app.get('backupService');
    const info = backupService.getBackupContentsInfo();
    res.json(info);
  } catch (error) {
    log.error(`Failed to get backup info: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Get list of backups
router.get('/list', async (req, res) => {
  try {
    const backupService = req.app.get('backupService');
    const backups = await backupService.listBackups();
    res.json({ backups });
  } catch (error) {
    log.error(`Failed to list backups: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Update backup settings
router.post('/settings', async (req, res) => {
  try {
    const backupService = req.app.get('backupService');
    const scheduler = req.app.get('scheduler');
    
    // Whitelist allowed backup settings to prevent prototype pollution
    const allowed = {};
    if (req.body.enabled !== undefined) allowed.enabled = !!req.body.enabled;
    if (req.body.schedule !== undefined) allowed.schedule = String(req.body.schedule);
    if (req.body.maxBackups !== undefined) {
      const parsed = parseInt(req.body.maxBackups, 10);
      allowed.maxBackups = isNaN(parsed) ? 5 : Math.min(Math.max(parsed, 1), 100);
    }
    if (req.body.includeDb !== undefined) allowed.includeDb = !!req.body.includeDb;
    
    const settings = await backupService.updateSettings(allowed);
    
    // Update scheduler with new backup settings
    if (scheduler && scheduler.setupBackupSchedule) {
      await scheduler.setupBackupSchedule();
    }
    
    res.json({ success: true, settings });
  } catch (error) {
    log.error(`Failed to update backup settings: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Create a manual backup
router.post('/create', async (req, res) => {
  try {
    log.info('POST /create — creating manual backup');
    const activeServer = await getActiveServer();
    if (activeServer?.isRemote) {
      return res.status(400).json({ error: 'Backups are not available for remote servers. The server filesystem is not accessible from this panel.' });
    }

    const backupService = req.app.get('backupService');
    const io = req.app.get('io');
    
    // Pass io for progress updates
    const result = await backupService.createBackup({ ...req.body, io });
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    log.error(`Failed to create backup: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Delete a backup
router.delete('/:name', async (req, res) => {
  try {
    log.info(`DELETE /${req.params.name}`);
    const backupService = req.app.get('backupService');
    const result = await backupService.deleteBackup(req.params.name);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    log.error(`Failed to delete backup: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Download a backup
router.get('/download/:name', async (req, res) => {
  try {
    const backupService = req.app.get('backupService');
    const backupsPath = await backupService.getBackupsPath();
    
    if (!backupsPath) {
      return res.status(404).json({ error: 'Backups folder not found' });
    }
    
    // Sanitize filename to prevent path traversal
    const safeName = path.basename(req.params.name);
    if (!safeName.endsWith('.zip')) {
      return res.status(400).json({ error: 'Invalid backup file' });
    }
    
    const backupPath = path.join(backupsPath, safeName);
    
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ error: 'Backup not found' });
    }
    
    res.download(backupPath, safeName);
  } catch (error) {
    log.error(`Failed to download backup: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Restore a backup
router.post('/restore/:name', async (req, res) => {
  try {
    const activeServer = await getActiveServer();
    if (activeServer?.isRemote) {
      return res.status(400).json({ error: 'Backup restore is not available for remote servers. The server filesystem is not accessible from this panel.' });
    }

    const backupService = req.app.get('backupService');
    const serverManager = req.app.get('serverManager');
    
    // Sanitize filename to prevent path traversal
    const safeName = path.basename(req.params.name);
    if (!safeName.endsWith('.zip')) {
      return res.status(400).json({ error: 'Invalid backup file' });
    }
    
    // Check if server is running
    const isRunning = await serverManager.checkServerRunning();
    if (isRunning) {
      return res.status(400).json({ 
        success: false, 
        error: 'Server must be stopped before restoring a backup. Please stop the server first.' 
      });
    }
    
    const result = await backupService.restoreBackup(safeName, req.body);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    log.error(`Failed to restore backup: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Delete backups older than X days
router.post('/delete-older-than', async (req, res) => {
  try {
    const { days } = req.body;
    
    if (typeof days !== 'number' || days < 1) {
      return res.status(400).json({ error: 'Invalid days parameter. Must be a number >= 1' });
    }
    
    const backupService = req.app.get('backupService');
    const result = await backupService.deleteBackupsOlderThan(days);
    
    res.json(result);
  } catch (error) {
    log.error(`Failed to delete old backups: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

export default router;
