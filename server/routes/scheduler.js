import express from 'express';
import cron from 'node-cron';
import { createLogger } from '../utils/logger.js';
const log = createLogger('API:Scheduler');
import { sanitizeError } from '../utils/sanitize.js';
import { 
  getScheduledTasks, 
  createScheduledTask, 
  updateScheduledTask, 
  deleteScheduledTask,
  getScheduleHistory,
  clearScheduleHistory,
  getActiveServer
} from '../database/init.js';

const router = express.Router();

/**
 * Check if a cron expression runs more frequently than every 5 minutes.
 * Parses the minute and hour fields to detect sub-5-minute intervals.
 */
function isCronTooFrequent(expr) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return false;
  const [minute, hour] = parts;

  // Every minute: * or */1 through */4 (also catches range-step forms like 0-59/2)
  if (minute === '*') return true;
  if (/^\*\/([1-4])$/.test(minute)) return true;

  // Range with step: e.g. "1-59/2" or "0-30/1" — bypasses the */N check.
  // Reject any range step <5, regardless of the range bounds.
  const rangeStep = minute.match(/^\d+-\d+\/(\d+)$/);
  if (rangeStep) {
    const step = parseInt(rangeStep[1], 10);
    if (Number.isFinite(step) && step >= 1 && step < 5) return true;
  }

  // Comma-separated minutes — reject if any two consecutive runs are <5 min apart.
  // Previously only checked total count (>12), which let lists like "0,1,2" slip through.
  if (hour === '*' && minute.includes(',')) {
    const values = minute
      .split(',')
      .map(v => parseInt(v.trim(), 10))
      .filter(n => Number.isFinite(n) && n >= 0 && n <= 59)
      .sort((a, b) => a - b);
    for (let i = 1; i < values.length; i++) {
      if (values[i] - values[i - 1] < 5) return true;
    }
    // Also reject the wrap-around gap (last entry of hour N to first of hour N+1).
    if (values.length >= 2) {
      const wrap = (60 - values[values.length - 1]) + values[0];
      if (wrap < 5) return true;
    }
  }

  return false;
}

// Get scheduler status
router.get('/status', async (req, res) => {
  try {
    const scheduler = req.app.get('scheduler');
    const status = scheduler.getStatus();
    res.json(status);
  } catch (error) {
    log.error(`Failed to get scheduler status: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Get all scheduled tasks
router.get('/tasks', async (req, res) => {
  try {
    const tasks = await getScheduledTasks();
    res.json({ tasks });
  } catch (error) {
    log.error(`Failed to get scheduled tasks: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Validate cron expression
router.post('/validate-cron', async (req, res) => {
  try {
    const { cronExpression } = req.body;
    if (!cronExpression) {
      return res.status(400).json({ valid: false, error: 'cronExpression is required' });
    }
    
    const isValid = cron.validate(cronExpression);
    if (!isValid) {
      return res.json({ valid: false, error: 'Invalid cron expression format' });
    }
    
    res.json({ valid: true });
  } catch (error) {
    res.status(500).json({ valid: false, error: sanitizeError(error.message) });
  }
});

// Create a new scheduled task
router.post('/tasks', async (req, res) => {
  try {
    const scheduler = req.app.get('scheduler');
    const { name, cronExpression, command } = req.body;
    log.info(`POST /tasks: name=${name}, cron=${cronExpression}, command=${(command || '').substring(0, 80)}`);
    
    if (!name || !cronExpression || !command) {
      return res.status(400).json({ error: 'Name, cronExpression, and command are required' });
    }
    
    // Validate input types and lengths
    if (typeof name !== 'string' || name.length > 100) {
      return res.status(400).json({ error: 'Invalid task name (max 100 chars)' });
    }
    if (typeof command !== 'string' || command.length > 2000) {
      return res.status(400).json({ error: 'Invalid command (max 2000 chars)' });
    }
    if (typeof cronExpression !== 'string' || cronExpression.length > 100) {
      return res.status(400).json({ error: 'Invalid cron expression format' });
    }
    
    // Validate cron expression before saving
    if (!cron.validate(cronExpression)) {
      return res.status(400).json({ error: 'Invalid cron expression. Use format: minute hour day month weekday (e.g., "0 */6 * * *" for every 6 hours)' });
    }
    
    // Security: Reject tasks that run more frequently than every 5 minutes to prevent DoS
    if (isCronTooFrequent(cronExpression)) {
      return res.status(400).json({ error: 'Tasks cannot run more frequently than every 5 minutes' });
    }
    
    const result = await createScheduledTask(name, cronExpression, command);
    const task = {
      id: result.id,
      name,
      cron_expression: cronExpression,
      command,
      enabled: 1
    };
    
    // Schedule the task — rollback DB entry if scheduling fails
    try {
      scheduler.scheduleTask(task);
    } catch (schedErr) {
      log.error(`Failed to schedule task, rolling back DB entry: ${schedErr.message}`);
      await deleteScheduledTask(result.id);
      return res.status(500).json({ error: 'Failed to schedule task: ' + sanitizeError(schedErr.message) });
    }
    
    res.json({ success: true, task });
  } catch (error) {
    log.error(`Failed to create scheduled task: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Update a scheduled task
router.put('/tasks/:id', async (req, res) => {
  try {
    const scheduler = req.app.get('scheduler');
    const { id } = req.params;
    const { name, cronExpression, command, enabled } = req.body;
    log.info(`PUT /tasks/${id}: name=${name}, cron=${cronExpression}, enabled=${enabled}`);
    
    const taskId = parseInt(id, 10);
    if (isNaN(taskId)) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }
    
    // Validate name and command length
    if (name !== undefined && (typeof name !== 'string' || name.length > 100)) {
      return res.status(400).json({ error: 'Invalid task name (max 100 characters)' });
    }
    if (command !== undefined && (typeof command !== 'string' || command.length > 2000)) {
      return res.status(400).json({ error: 'Invalid command (max 2000 characters)' });
    }
    
    // Validate cron expression before saving to prevent DB/scheduler inconsistency
    if (cronExpression && !cron.validate(cronExpression)) {
      return res.status(400).json({ error: 'Invalid cron expression. Use format: minute hour day month weekday (e.g., "0 */6 * * *" for every 6 hours)' });
    }
    
    // Security: Reject tasks that run more frequently than every 5 minutes to prevent DoS
    if (cronExpression && isCronTooFrequent(cronExpression)) {
      return res.status(400).json({ error: 'Tasks cannot run more frequently than every 5 minutes' });
    }
    
    await updateScheduledTask(taskId, name, cronExpression, command, enabled);
    
    // Reschedule or cancel the task — rollback DB entry if scheduling fails
    if (enabled) {
      try {
        scheduler.scheduleTask({
          id: taskId,
          name,
          cron_expression: cronExpression,
          command,
          enabled: 1
        });
      } catch (schedErr) {
        log.error(`Failed to reschedule task ${taskId}, reverting DB: ${schedErr.message}`);
        // Revert: re-save the old enabled state to avoid phantom active task in DB
        await updateScheduledTask(taskId, name, cronExpression, command, 0).catch(err => log.debug(`Failed to revert task ${taskId}: ${err.message}`));
        return res.status(500).json({ error: 'Failed to reschedule task: ' + sanitizeError(schedErr.message) });
      }
    } else {
      scheduler.cancelTask(taskId);
    }
    
    res.json({ success: true, message: 'Task updated' });
  } catch (error) {
    log.error(`Failed to update scheduled task: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Delete a scheduled task
router.delete('/tasks/:id', async (req, res) => {
  try {
    const scheduler = req.app.get('scheduler');
    const { id } = req.params;
    log.info(`DELETE /tasks/${id}`);
    
    const taskId = parseInt(id, 10);
    if (isNaN(taskId)) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }
    
    scheduler.cancelTask(taskId);
    await deleteScheduledTask(taskId);
    
    res.json({ success: true, message: 'Task deleted' });
  } catch (error) {
    log.error(`Failed to delete scheduled task: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Trigger immediate restart
router.post('/restart-now', async (req, res) => {
  try {
    const activeServer = await getActiveServer();
    if (activeServer?.isRemote) {
      return res.status(400).json({ error: 'Cannot restart a remote server. The process is not managed by this panel.' });
    }

    const scheduler = req.app.get('scheduler');
    const { warningMinutes } = req.body;
    
    // Parse and validate warningMinutes (0-60 range)
    let parsedWarningMinutes = parseInt(warningMinutes, 10);
    log.info(`POST /restart-now: warningMinutes=${warningMinutes}`);
    if (isNaN(parsedWarningMinutes) || parsedWarningMinutes < 0) {
      parsedWarningMinutes = 5; // Default
    } else if (parsedWarningMinutes > 60) {
      parsedWarningMinutes = 60; // Cap at 60 minutes
    }
    
    // Run restart in background, passing warningMinutes directly
    scheduler.performRestart(parsedWarningMinutes).catch(err => {
      log.error(`Restart failed: ${err.message}`);
    });
    
    res.json({ success: true, message: 'Restart initiated' });
  } catch (error) {
    log.error(`Failed to trigger restart: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Common cron presets for convenience
router.get('/cron-presets', (req, res) => {
  res.json({
    presets: [
      { name: 'Every hour', cron: '0 * * * *' },
      { name: 'Every 2 hours', cron: '0 */2 * * *' },
      { name: 'Every 4 hours', cron: '0 */4 * * *' },
      { name: 'Every 6 hours', cron: '0 */6 * * *' },
      { name: 'Every 12 hours', cron: '0 */12 * * *' },
      { name: 'Daily at midnight', cron: '0 0 * * *' },
      { name: 'Daily at 6 AM', cron: '0 6 * * *' },
      { name: 'Daily at noon', cron: '0 12 * * *' },
      { name: 'Daily at 6 PM', cron: '0 18 * * *' },
      { name: 'Every 30 minutes', cron: '*/30 * * * *' },
      { name: 'Every 15 minutes', cron: '*/15 * * * *' }
    ]
  });
});

// Get schedule execution history
router.get('/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 100;
    const taskId = req.query.taskId ? parseInt(req.query.taskId, 10) : null;
    const history = await getScheduleHistory(limit, taskId);
    res.json({ history });
  } catch (error) {
    log.error(`Failed to get schedule history: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Clear schedule execution history
router.delete('/history', async (req, res) => {
  try {
    await clearScheduleHistory();
    res.json({ success: true, message: 'History cleared' });
  } catch (error) {
    log.error(`Failed to clear schedule history: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

export default router;
