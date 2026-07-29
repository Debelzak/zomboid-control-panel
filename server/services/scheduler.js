import cron from "node-cron";
import { createLogger } from "../utils/logger.js";
const log = createLogger("Scheduler");
import panelBridge from "./panelBridge.js";
import {
  getScheduledTasks,
  updateTaskLastRun,
  logServerEvent,
  logScheduleExecution,
  getSetting,
  setSetting,
} from "../database/init.js";

// Built-in PanelBridge actions exposed to the scheduler via the
// `bridge:<action>` command syntax. Optional JSON args follow the action,
// e.g. `bridge:triggerBlizzard {"duration":2}`. Only the actions listed
// here can be invoked from a scheduled task — keeps the surface small
// and intentional rather than letting arbitrary handlers run on a cron.
const SCHEDULABLE_BRIDGE_ACTIONS = new Set([
  "triggerBlizzard",
  "triggerTropicalStorm",
  "triggerStorm",
  "stopWeather",
  "startRain",
  "stopRain",
  "setSnow",
  "triggerLightning",
  "triggerGunshot",
  "triggerAlarmSound",
  "restoreUtilities",
  "shutOffUtilities",
  "saveWorld",
  "sendToServerChat",
  "sendToAdminChat",
]);

export class Scheduler {
  constructor(rconService, serverManager) {
    this.rconService = rconService;
    this.serverManager = serverManager;
    this.backupService = null;
    this.discordBot = null;
    this.jobs = new Map();
    this.jobLabels = new Map(); // task id -> human label, for reporting next run
    this.autoRestartJob = null;
    this.backupJob = null;
    this.modUpdateRestartPending = false;
    this.restartInProgress = false;
    this.runningTasks = new Set(); // Track tasks currently executing to prevent duplicates
  }

  setBackupService(backupService) {
    this.backupService = backupService;
  }

  setDiscordBot(discordBot) {
    this.discordBot = discordBot;
  }

  async init() {
    // Load saved scheduled tasks
    await this.loadScheduledTasks();

    // Setup auto-restart if enabled
    this.setupAutoRestart();

    // Setup backup schedule if enabled
    await this.setupBackupSchedule();

    log.info("Scheduler initialized");
  }

  async loadScheduledTasks() {
    try {
      const tasks = await getScheduledTasks();

      if (!tasks || !Array.isArray(tasks)) {
        log.info("No scheduled tasks found");
        return;
      }

      for (const task of tasks) {
        if (task.enabled) {
          const scheduled = this.scheduleTask(task);
          if (!scheduled) {
            log.warn(
              `Failed to schedule task ${task.id} (${task.name}) - see previous errors`,
            );
          }
        }
      }

      log.info(`Loaded ${tasks.length} scheduled tasks`);
    } catch (error) {
      log.error(`Failed to load scheduled tasks: ${error.message}`);
    }
  }

  scheduleTask(task) {
    if (!cron.validate(task.cron_expression)) {
      log.error(
        `Invalid cron expression for task ${task.id} (${task.name}): ${task.cron_expression}`,
      );
      return false;
    }

    // Cancel existing job if any
    if (this.jobs.has(task.id)) {
      this.jobs.get(task.id).stop();
    }

    const job = cron.schedule(task.cron_expression, async () => {
      // Prevent duplicate execution of same task
      if (this.runningTasks.has(task.id)) {
        log.debug(
          `Skipping duplicate execution of task ${task.name} (already running)`,
        );
        return;
      }

      this.runningTasks.add(task.id);
      log.info(`Executing scheduled task: ${task.name}`);
      const startTime = Date.now();
      try {
        await this.executeTask(task);
        const duration = Date.now() - startTime;
        await updateTaskLastRun(task.id);
        await logScheduleExecution(
          task.id,
          task.name,
          task.command,
          true,
          "Completed successfully",
          duration,
        );
        await logServerEvent("scheduled_task", `Executed: ${task.name}`);
      } catch (error) {
        const duration = Date.now() - startTime;
        log.error(`Scheduled task failed ${task.name}: ${error.message}`);
        await logScheduleExecution(
          task.id,
          task.name,
          task.command,
          false,
          error.message,
          duration,
        );
        await logServerEvent(
          "scheduled_task_error",
          `${task.name}: ${error.message}`,
        );
      } finally {
        this.runningTasks.delete(task.id);
      }
    });

    this.jobs.set(task.id, job);
    this.jobLabels.set(task.id, task.name || task.command || "task");
    log.info(`Scheduled task: ${task.name} (${task.cron_expression})`);
    return true;
  }

  /**
   * Soonest upcoming run across user tasks, auto-restart and scheduled backup.
   * "3 tasks" is not actionable; "restart in 2h 14m" is, so the dashboard asks
   * for a time rather than a count.
   * @returns {{ label: string, at: string } | null}
   */
  getNextRun() {
    const candidates = [];
    const push = (job, label) => {
      if (!job || typeof job.getNextRun !== "function") return;
      try {
        const at = job.getNextRun();
        if (at instanceof Date && Number.isFinite(at.getTime())) {
          candidates.push({ label, at });
        }
      } catch {
        /* a job with no computable next run simply does not compete */
      }
    };

    for (const [id, job] of this.jobs) {
      push(job, this.jobLabels.get(id) || "task");
    }
    push(this.autoRestartJob, "auto restart");
    push(this.backupJob, "backup");

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.at - b.at);
    return {
      label: candidates[0].label,
      at: candidates[0].at.toISOString(),
    };
  }

  async executeTask(task) {
    const commandLower = task.command.toLowerCase();

    // Handle special commands - skip logging for automated scheduled tasks
    if (commandLower === "restart") {
      const result = await this.performRestart();
      // If restart was skipped (already in progress), throw to mark task as failed
      if (!result.success && result.message === "Restart already in progress") {
        throw new Error("Restart skipped - already in progress");
      }
    } else if (commandLower === "save") {
      await this.rconService.save({ skipLog: true });
    } else if (commandLower.startsWith("servermsg ")) {
      // Preserve original casing for the message text
      const message = task.command.substring(10);
      await this.rconService.serverMessage(message, { skipLog: true });
    } else if (commandLower.startsWith("bridge:")) {
      // PanelBridge action: `bridge:<action>` optionally followed by a JSON
      // args object. Validates against the SCHEDULABLE_BRIDGE_ACTIONS allow
      // list so we don't accidentally let admins schedule god-mode toggles.
      await this.executeBridgeAction(task.command);
    } else {
      // Execute as raw RCON command - skip logging for scheduled tasks
      await this.rconService.execute(task.command, { skipLog: true });
    }
  }

  async executeBridgeAction(rawCommand) {
    // Strip the `bridge:` prefix, then split off optional JSON args.
    const body = rawCommand.slice("bridge:".length).trim();
    if (!body) throw new Error("bridge: action missing");

    // First whitespace separates the action name from its args blob.
    const firstSpace = body.indexOf(" ");
    const action = (
      firstSpace === -1 ? body : body.slice(0, firstSpace)
    ).trim();
    const argsRaw = firstSpace === -1 ? "" : body.slice(firstSpace + 1).trim();

    if (!SCHEDULABLE_BRIDGE_ACTIONS.has(action)) {
      throw new Error(
        `bridge action '${action}' is not allowed in scheduled tasks`,
      );
    }

    let args = {};
    if (argsRaw) {
      try {
        args = JSON.parse(argsRaw);
        if (typeof args !== "object" || args === null || Array.isArray(args)) {
          throw new Error("args must be a JSON object");
        }
      } catch (err) {
        throw new Error(`invalid bridge args JSON: ${err.message}`);
      }
    }

    const result = await panelBridge.sendCommand(action, args);
    if (result && result.success === false) {
      throw new Error(result.error || `bridge action ${action} failed`);
    }
    return result;
  }

  cancelTask(taskId) {
    if (this.jobs.has(taskId)) {
      this.jobs.get(taskId).stop();
      this.jobs.delete(taskId);
      this.jobLabels.delete(taskId);
      log.info(`Cancelled scheduled task: ${taskId}`);
      return true;
    }
    return false;
  }

  /**
   * Cancel an in-progress restart countdown
   */
  cancelRestart() {
    if (this.restartInProgress) {
      this.restartCancelled = true;
      log.info("Restart cancellation requested");
      return { success: true, message: "Restart cancellation requested" };
    }
    return { success: false, message: "No restart in progress" };
  }

  /**
   * Stop all scheduled jobs - used for graceful shutdown
   */
  stopAllJobs() {
    // Stop all task jobs
    for (const [taskId, job] of this.jobs) {
      job.stop();
      log.debug(`Stopped scheduled task: ${taskId}`);
    }
    this.jobs.clear();
    this.jobLabels.clear();

    // Stop auto-restart job
    if (this.autoRestartJob) {
      this.autoRestartJob.stop();
      this.autoRestartJob = null;
    }

    // Stop backup job
    if (this.backupJob) {
      this.backupJob.stop();
      this.backupJob = null;
    }

    log.info("All scheduled jobs stopped");
  }

  async setupBackupSchedule() {
    // Stop existing backup job if any
    if (this.backupJob) {
      this.backupJob.stop();
      this.backupJob = null;
    }

    if (!this.backupService) {
      log.debug("Backup service not available");
      return;
    }

    try {
      const settings = await this.backupService.getSettings();

      if (!settings.enabled) {
        log.info("Scheduled backups are disabled");
        return;
      }

      if (!cron.validate(settings.schedule)) {
        log.error(
          `Invalid backup schedule cron expression: ${settings.schedule}`,
        );
        return;
      }

      this.backupJob = cron.schedule(settings.schedule, async () => {
        log.info("Executing scheduled backup");
        const startTime = Date.now();
        try {
          const result = await this.backupService.createBackup({
            includeDb: settings.includeDb,
          });
          const duration = Date.now() - startTime;
          if (result.success) {
            await logScheduleExecution(
              null,
              "Scheduled Backup",
              "backup",
              true,
              `Created: ${result.backup.name}`,
              duration,
            );
            log.info(`Scheduled backup completed: ${result.backup.name}`);
          } else {
            await logScheduleExecution(
              null,
              "Scheduled Backup",
              "backup",
              false,
              result.message,
              duration,
            );
            log.error(`Scheduled backup failed: ${result.message}`);
          }
        } catch (error) {
          const duration = Date.now() - startTime;
          await logScheduleExecution(
            null,
            "Scheduled Backup",
            "backup",
            false,
            error.message,
            duration,
          );
          log.error(`Scheduled backup error: ${error.message}`);
        }
      });

      log.info(`Backup schedule configured: ${settings.schedule}`);
    } catch (error) {
      log.error(`Failed to setup backup schedule: ${error.message}`);
    }
  }

  setupAutoRestart() {
    const enabled = process.env.AUTO_RESTART_ENABLED === "true";
    const cronExpression = process.env.AUTO_RESTART_CRON || "0 */6 * * *";
    const warningMinutes =
      parseInt(process.env.RESTART_WARNING_MINUTES, 10) || 5;

    if (!enabled) {
      log.info("Auto-restart is disabled");
      return;
    }

    if (!cron.validate(cronExpression)) {
      log.error(`Invalid auto-restart cron expression: ${cronExpression}`);
      return;
    }

    // Stop existing auto-restart job if any to prevent leaks
    if (this.autoRestartJob) {
      this.autoRestartJob.stop();
      this.autoRestartJob = null;
    }

    // Schedule the actual restart
    this.autoRestartJob = cron.schedule(cronExpression, async () => {
      log.info("Executing scheduled auto-restart");
      try {
        await this.performRestart();
      } catch (err) {
        // performRestart re-throws on failure. node-cron does not consume the
        // returned promise, so without this catch the rejection is unhandled
        // and takes the whole panel process down. Errors are already logged
        // + schedule-execution-logged inside performRestart's catch block.
        log.error(`Auto-restart cron tick failed: ${err.message}`);
      }
    });

    log.info(`Auto-restart scheduled: ${cronExpression}`);
  }

  /**
   * Broadcast a restart message to all players. PZ's `servermsg` RCON command
   * is the canonical broadcast for both B41 and B42 and is what shows up in
   * every player's chat. We also fire it through PanelBridge's sendToServerChat
   * when the mod is connected so the message appears via the in-game chat
   * pipeline too (belt-and-braces — version-agnostic on the Lua side). Both
   * paths are best-effort and never throw.
   */
  async _broadcastRestartMessage(text) {
    // RCON `servermsg` — primary path, works on B41 + B42 without the mod.
    try {
      const r = await this.rconService.serverMessage(text, { skipLog: true });
      if (!r?.success) {
        log.warn(
          `Restart broadcast (RCON) failed: ${r?.error || r?.response || "unknown"}`,
        );
      }
    } catch (err) {
      log.warn(`Restart broadcast (RCON) threw: ${err.message}`);
    }

    // PanelBridge in-game chat — secondary visibility boost. Only fire if
    // the mod is currently connected; fire-and-forget so we don't add latency
    // to the countdown cadence. isAlert=true triggers PZ's server alert
    // notification (red banner / alert sound) on both B41 and B42.
    try {
      if (
        panelBridge &&
        typeof panelBridge.isModConnected === "function" &&
        panelBridge.isModConnected()
      ) {
        panelBridge
          .sendCommand("sendToServerChat", { message: text, isAlert: true })
          .catch((err) => {
            log.debug(`Restart broadcast (bridge) failed: ${err.message}`);
          });
      }
    } catch (err) {
      log.debug(`Restart broadcast (bridge) threw: ${err.message}`);
    }
  }

  async performRestart(warningMinutesParam = null) {
    // Prevent concurrent restarts
    if (this.restartInProgress) {
      log.info("Restart already in progress, ignoring duplicate request");
      return { success: false, message: "Restart already in progress" };
    }

    this.restartInProgress = true;
    this.restartCancelled = false; // Allow cancellation
    const warningMinutes =
      warningMinutesParam ??
      (parseInt(process.env.RESTART_WARNING_MINUTES, 10) || 5);
    const restartStartTime = Date.now();

    try {
      // Check if server is actually running - use multiple methods
      let wasRunning = await this.serverManager.checkServerRunning();
      log.info(`Auto-restart: Process check returned: ${wasRunning}`);

      // If process check says not running, also try RCON as a fallback
      // RCON connection success is a reliable indicator the server is running
      if (!wasRunning && this.rconService.connected) {
        log.info(
          "Auto-restart: Process check failed but RCON is connected - server IS running",
        );
        wasRunning = true;
      }

      // Also try a quick RCON command if we think server might be running
      if (!wasRunning) {
        try {
          const testResult = await this.rconService.execute("players", {
            skipLog: true,
          });
          if (testResult.success) {
            log.info(
              "Auto-restart: RCON command succeeded - server IS running",
            );
            wasRunning = true;
          }
        } catch (e) {
          // RCON failed, server probably not running
          log.debug(`Auto-restart: RCON test failed: ${e.message}`);
        }
      }

      if (!wasRunning) {
        // Server wasn't running - just start it
        log.info(
          "Auto-restart triggered but server was not running - starting server",
        );
        await this.serverManager.startServer();

        // Wait a bit and verify it started
        await this.sleep(10000);
        const isNowRunning = await this.serverManager.checkServerRunning();

        const restartDuration = Date.now() - restartStartTime;
        if (isNowRunning) {
          await logScheduleExecution(
            null,
            "Auto Restart",
            "restart",
            true,
            "Server was offline - started successfully",
            restartDuration,
          );
          logServerEvent(
            "auto_restart",
            "Server was offline - started successfully",
          );
          log.info("Server started successfully (was not running)");
        } else {
          await logScheduleExecution(
            null,
            "Auto Restart",
            "restart",
            false,
            "Server was offline - failed to start",
            restartDuration,
          );
          logServerEvent(
            "auto_restart_error",
            "Server was offline - failed to start",
          );
          log.error("Failed to start server");
        }
        return { success: isNowRunning, wasRunning: false };
      }

      // Server is running - perform full restart with warnings
      // First, verify RCON is connected and working
      if (!this.rconService.connected) {
        log.info("Auto-restart: RCON not connected, attempting to connect...");
        try {
          await this.rconService.connect();
        } catch (e) {
          log.error(`Auto-restart: Failed to connect RCON: ${e.message}`);
        }
      }

      // Test RCON with a simple command before proceeding
      const testResult = await this.rconService.execute("players", {
        skipLog: true,
      });
      if (!testResult.success) {
        const restartDuration = Date.now() - restartStartTime;
        const errorMsg = `RCON not available: ${testResult.error || "connection failed"}`;
        log.error(`Auto-restart failed: ${errorMsg}`);
        await logScheduleExecution(
          null,
          "Auto Restart",
          "restart",
          false,
          errorMsg,
          restartDuration,
        );
        logServerEvent("auto_restart_error", errorMsg);
        return { success: false, message: errorMsg };
      }

      log.info("Auto-restart: RCON verified, sending warnings...");

      // Notify Discord at the start of the restart sequence
      if (this.discordBot) {
        this.discordBot
          .sendEventNotification("scheduledRestart", {
            minutes: warningMinutes,
          })
          .catch((err) =>
            log.debug(
              `Discord scheduledRestart notification failed: ${err.message}`,
            ),
          );
      }

      if (warningMinutes > 0) {
        // Per-minute countdown. Plain ASCII so PZ's servermsg delivers it
        // verbatim (no emoji stripping). Bracketed prefix is the standard
        // PZ convention for server broadcasts and is visible in-chat on
        // both B41 and B42.
        for (let i = warningMinutes; i > 0; i--) {
          if (this.restartCancelled) {
            log.info("Auto-restart: Cancelled during countdown");
            await this._broadcastRestartMessage("[SERVER] Restart CANCELLED.");
            return { success: false, message: "Restart cancelled" };
          }
          const minuteWord = i === 1 ? "MINUTE" : "MINUTES";
          await this._broadcastRestartMessage(
            `[SERVER] *** RESTART IN ${i} ${minuteWord} ***`,
          );

          if (i > 1) {
            await this.sleep(60000); // Wait 1 minute
          }
        }

        // Final 60 seconds: 30s warning, 10s warning, then 5..1 each second.
        // Sleep happens BEFORE each tick, so timing after the last per-minute
        // warning is: +30s -> "30 SECONDS", +20s -> "10 SECONDS",
        // +5s -> "5", +1s -> "4", +1s -> "3", +1s -> "2", +1s -> "1",
        // +1s -> "RESTARTING NOW".
        const finalTicks = [
          { wait: 30000, msg: "[SERVER] *** RESTART IN 30 SECONDS ***" },
          { wait: 20000, msg: "[SERVER] *** RESTART IN 10 SECONDS ***" },
          { wait: 5000, msg: "[SERVER] 5..." },
          { wait: 1000, msg: "[SERVER] 4..." },
          { wait: 1000, msg: "[SERVER] 3..." },
          { wait: 1000, msg: "[SERVER] 2..." },
          { wait: 1000, msg: "[SERVER] 1..." },
        ];
        for (const tick of finalTicks) {
          await this.sleep(tick.wait);
          if (this.restartCancelled) {
            log.info("Auto-restart: Cancelled during final countdown");
            await this._broadcastRestartMessage("[SERVER] Restart CANCELLED.");
            return { success: false, message: "Restart cancelled" };
          }
          await this._broadcastRestartMessage(tick.msg);
        }

        // One last second, then go.
        await this.sleep(1000);
        await this._broadcastRestartMessage(
          "[SERVER] *** RESTARTING NOW - please reconnect in a few minutes ***",
        );
        await this.sleep(2000);
      } else {
        // Immediate restart - just a brief message
        await this._broadcastRestartMessage("[SERVER] *** RESTARTING NOW ***");
        await this.sleep(2000);
      }

      // Save world - skip logging for automated save
      log.info("Auto-restart: Saving world...");
      const saveResult = await this.rconService.save({ skipLog: true });
      if (!saveResult.success) {
        log.warn(
          `Auto-restart: Save command may have failed: ${saveResult.error}`,
        );
      }
      await this.sleep(3000);

      // Quit server - skip logging for automated quit
      log.info("Auto-restart: Sending quit command...");
      await this.rconService.quit({ skipLog: true });
      await this.sleep(10000);

      // Wait for server to stop
      let attempts = 0;
      while ((await this.serverManager.checkServerRunning()) && attempts < 60) {
        await this.sleep(1000);
        attempts++;
      }

      // Force stop if needed
      if (await this.serverManager.checkServerRunning()) {
        await this.serverManager.stopServer(false);
        await this.sleep(5000);
      }

      // Extra delay after stop — give OS time to fully reap the process
      // (zombie processes on Linux, WMI cache on Windows)
      await this.sleep(3000);

      // Set flag to prevent RCON auto-reconnect from interfering during startup
      // Use setServerStarting which has a 5-minute failsafe timeout
      if (this.rconService.setServerStarting) {
        this.rconService.setServerStarting(true);
      } else {
        this.rconService.serverStarting = true;
      }

      // Start server — skip the running check since we just confirmed the server stopped
      log.info("Auto-restart: Starting server...");
      await this.serverManager.startServer({ skipRunningCheck: true });

      // Wait for server process to be running (up to 60 seconds)
      let serverStarted = false;
      for (let i = 0; i < 60; i++) {
        await this.sleep(1000);
        if (await this.serverManager.checkServerRunning()) {
          serverStarted = true;
          log.info("Auto-restart: Server process detected as running");
          break;
        }
      }

      if (!serverStarted) {
        if (this.rconService.setServerStarting) {
          this.rconService.setServerStarting(false);
        } else {
          this.rconService.serverStarting = false;
        }
        const restartDuration = Date.now() - restartStartTime;
        await logScheduleExecution(
          null,
          "Auto Restart",
          "restart",
          false,
          "Server stopped but failed to start",
          restartDuration,
        );
        logServerEvent(
          "auto_restart_error",
          "Server stopped but failed to start",
        );
        log.error("Auto-restart: Server stopped but failed to start");
        return { success: false, wasRunning: true };
      }

      // Wait for RCON to be ready (PZ server takes 60-180s to fully initialize)
      // Keep serverStarting=true the whole time to block auto-reconnect
      log.info("Auto-restart: Waiting for RCON to be ready...");
      const rconDelays = [60000, 45000, 45000, 45000, 45000]; // 60s + 4x45s = 240s total (4 minutes)
      let rconConnected = false;

      for (let i = 0; i < rconDelays.length; i++) {
        const delaySeconds = rconDelays[i] / 1000;
        log.info(
          `Auto-restart: RCON waiting ${delaySeconds}s before attempt ${i + 1}/${rconDelays.length}...`,
        );
        await this.sleep(rconDelays[i]);

        // If RCON connected during the wait (via auto-reconnect), we're done
        if (this.rconService.connected) {
          rconConnected = true;
          log.info("Auto-restart: RCON connected during wait period");
          break;
        }

        // Reset connection state before each attempt to clear any stalled state
        if (this.rconService.forceResetConnectionState) {
          this.rconService.forceResetConnectionState();
        }

        // Attempt connection with a 15s timeout to prevent hanging
        try {
          log.info(
            `Auto-restart: RCON attempting connection ${i + 1}/${rconDelays.length}...`,
          );
          const connectPromise = this.rconService.connect();
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Connection attempt timed out after 15s")),
              15000,
            ),
          );

          const connectResult = await Promise.race([
            connectPromise,
            timeoutPromise,
          ]);

          if (this.rconService.connected) {
            rconConnected = true;
            log.info("Auto-restart: RCON connected after server startup");
            break;
          } else {
            log.info(
              `Auto-restart: RCON attempt ${i + 1} - not connected (result: ${connectResult})`,
            );
          }
        } catch (e) {
          log.info(`Auto-restart: RCON attempt ${i + 1} failed: ${e.message}`);
          // Reset state on failure/timeout so next attempt starts fresh
          if (this.rconService.forceResetConnectionState) {
            this.rconService.forceResetConnectionState();
          }
        }
        // Don't toggle serverStarting - keep it true to block auto-reconnect
      }

      // Log completion status
      if (rconConnected) {
        log.info("Auto-restart: RCON startup sequence completed - connected");
      } else {
        log.warn(
          "Auto-restart: RCON startup sequence completed - NOT connected (auto-reconnect will keep trying every 30s)",
        );
      }

      // Clear the flag when done
      if (this.rconService.setServerStarting) {
        this.rconService.setServerStarting(false);
      } else {
        this.rconService.serverStarting = false;
      }

      const restartDuration = Date.now() - restartStartTime;

      if (serverStarted) {
        const rconStatus = rconConnected
          ? " (RCON connected)"
          : " (RCON not yet connected)";
        await logScheduleExecution(
          null,
          "Auto Restart",
          "restart",
          true,
          "Server restarted successfully" + rconStatus,
          restartDuration,
        );
        logServerEvent(
          "auto_restart",
          "Server restarted successfully" + rconStatus,
        );
        log.info(
          `Auto-restart completed successfully (took ${Math.round(restartDuration / 1000)}s)${rconStatus}`,
        );
      } else {
        await logScheduleExecution(
          null,
          "Auto Restart",
          "restart",
          false,
          "Server stopped but failed to start",
          restartDuration,
        );
        logServerEvent(
          "auto_restart_error",
          "Server stopped but failed to start",
        );
        log.error("Auto-restart: Server stopped but failed to start");
      }

      return { success: serverStarted, wasRunning: true };
    } catch (error) {
      const restartDuration = Date.now() - restartStartTime;
      log.error(`Auto-restart failed: ${error.message}`);
      await logScheduleExecution(
        null,
        "Auto Restart",
        "restart",
        false,
        error.message,
        restartDuration,
      );
      logServerEvent("auto_restart_error", error.message);
      // Clear serverStarting flag on error so auto-reconnect can resume
      if (this.rconService.setServerStarting) {
        this.rconService.setServerStarting(false);
      } else {
        this.rconService.serverStarting = false;
      }
      throw error;
    } finally {
      this.restartInProgress = false;
    }
  }

  async triggerModUpdateRestart() {
    if (this.modUpdateRestartPending) {
      log.info("Mod update restart already pending");
      return;
    }

    this.modUpdateRestartPending = true;
    log.info("Mod update detected - scheduling restart");

    try {
      await this.rconService.serverMessage(
        "🔧 Mod updates detected! Server will restart in 5 minutes.",
      );
      await this.performRestart(5); // Explicitly pass 5 minutes to match the message
      this.modUpdateRestartPending = false;
    } catch (error) {
      this.modUpdateRestartPending = false;
      throw error;
    }
  }

  getStatus() {
    const tasks = [];
    for (const [id, job] of this.jobs) {
      tasks.push({ id, running: true });
    }

    return {
      activeTasks: tasks.length,
      autoRestartEnabled: !!this.autoRestartJob,
      backupScheduleEnabled: !!this.backupJob,
      modUpdateRestartPending: this.modUpdateRestartPending,
      nextRun: this.getNextRun(),
    };
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  shutdown() {
    // Use stopAllJobs to ensure all jobs are properly stopped
    this.stopAllJobs();

    // Also stop backup job if running
    if (this.backupJob) {
      this.backupJob.stop();
      this.backupJob = null;
    }

    log.info("Scheduler shutdown complete");
  }
}
