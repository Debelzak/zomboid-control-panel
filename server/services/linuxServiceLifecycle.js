import { execFile as nodeExecFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import { isContainerized } from "../utils/dockerDetect.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("LinuxServiceLifecycle");

export const LIFECYCLE_PROVIDERS = Object.freeze([
  "direct",
  "systemd",
  "openrc",
]);

export function isManagedLifecycleProvider(provider) {
  return provider === "systemd" || provider === "openrc";
}

export function getLinuxLifecycleCapabilities(options = {}) {
  const platform = options.platform || process.platform;
  const containerized = options.containerized ?? isContainerized();
  return {
    supported: platform === "linux" && !containerized,
    platform,
    containerized,
    providers: platform === "linux" && !containerized
      ? [...LIFECYCLE_PROVIDERS]
      : ["direct"],
  };
}

export function getLifecycleServiceName(server) {
  const id = String(server?.id ?? "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error("Invalid server id for a managed lifecycle service");
  }
  return `zomboid-panel-server-${id.toLowerCase()}`;
}

function assertPlainValue(value, label) {
  const text = String(value ?? "").trim();
  if (!text || /[\0\r\n]/.test(text)) {
    throw new Error(`${label} must be a non-empty single-line value`);
  }
  return text;
}

// For Exec*= and Environment= only -- these are the directives systemd
// parses with its own C-style/shell-like argv tokenizer (systemd.syntax(7)
// "QUOTING"), so wrapping in double quotes and C-escaping backslash/quote is
// correct there. Verified against real systemd (systemd-analyze verify +
// systemctl show) that "$" needs NO escaping for either directive: Environment=
// documents "the '$' character has no special meaning", and an unescaped "$"
// in a quoted ExecStart= argument round-trips completely literally (no $VAR
// or $(...) expansion happens there at all). "\$" is not a recognized escape
// per systemd.syntax(7)'s escape table -- feeding it in produced a real,
// reproduced-on-real-systemd bug: systemd logs "Ignoring unknown escape
// sequences" and the literal backslash survives into the argument, so a
// server name/path containing "$" silently got a spurious "\" inserted next
// to it. Do not add a "$" escape back here.
function quoteSystemdArg(value) {
  return `"${String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/%/g, "%%")}"`;
}

// For plain Key=Value assignment directives (WorkingDirectory=, Description=,
// and similar) -- these are NOT parsed with the Exec*=/Environment= tokenizer
// at all. Verified against real systemd: the entire rest of the line becomes
// the literal value with no word-splitting and no quote handling whatsoever
// -- a space, a literal '$', and a literal '"' all round-tripped byte-for-byte
// with zero escaping. Wrapping the value in quotes here (the original bug)
// makes those two literal quote characters PART OF the value instead of
// delimiting it, which is why every generated unit failed to load ("path is
// not absolute") for every server, not just ones with unusual names. The one
// thing that IS special on every unit-file line, quoted directive or not, is
// specifier expansion (e.g. "%h" -> the unit's home directory) -- confirmed
// live: a server named "... %h ..." got "%h" silently expanded into the
// literal home-directory path inside Description=. Escape a literal "%" to
// "%%" and return the value UNQUOTED; do not wrap it.
function plainSystemdValue(value) {
  return String(value).replace(/%/g, "%%");
}

// OpenRC's own openrc-run.sh re-evaluates directory=/command_args= a second
// time after sourcing the init script (confirmed live, on real OpenRC via
// Alpine: a value containing "$(touch /tmp/x)" inside a value that was
// otherwise correctly single-quoted for the FIRST, ordinary shell-sourcing
// pass still executed the command substitution and created the file -- real
// code execution, not just corruption). Standard POSIX single-quoting alone,
// which is all this used to do, only protects against the first pass; it is
// not enough here. Backslash-escaping "\", "$", and "`" before the
// single-quote wrap survives the second pass too (verified live: a value
// with an escaped "\$" round-trips to the literal, correct path with the
// dollar sign intact instead of being cut off, and the injection payload
// above no longer executes). Order matters: escape literal backslashes
// first so a value that already contains one isn't double-unescaped by the
// dollar/backtick passes.
function quoteShell(value) {
  const escaped = String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");
  return `'${escaped.replace(/'/g, `'\\''`)}'`;
}

function resolveLaunchTarget(server, fileExists = fs.existsSync) {
  if (server?.startCommand) {
    throw new Error(
      "Managed lifecycle services do not accept a custom start command. Configure a .sh launcher path instead.",
    );
  }

  const configuredPath = assertPlainValue(
    server?.serverPath || server?.installPath,
    "Server install path",
  );
  if (/\.sh$/i.test(configuredPath)) {
    return {
      workingDirectory: path.dirname(configuredPath),
      launcherPath: configuredPath,
    };
  }
  if (/\.(bat|cmd|exe)$/i.test(configuredPath)) {
    throw new Error("Managed Linux services require a .sh launcher");
  }

  const serverName = assertPlainValue(server?.serverName, "Server name");
  const generated = path.join(
    configuredPath,
    `start-server_${serverName}.sh`,
  );
  return {
    workingDirectory: configuredPath,
    launcherPath: fileExists(generated)
      ? generated
      : path.join(configuredPath, "start-server.sh"),
  };
}

export function buildLifecycleTemplate(server, provider, options = {}) {
  if (!isManagedLifecycleProvider(provider)) {
    throw new Error(`Unsupported managed lifecycle provider: ${provider}`);
  }
  const serviceName = getLifecycleServiceName(server);
  const serverId = String(server.id);
  const serviceUser = assertPlainValue(
    options.serviceUser || os.userInfo().username,
    "Service user",
  );
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(serviceUser)) {
    throw new Error("Service user contains unsupported characters");
  }
  const launch = resolveLaunchTarget(server, options.fileExists);
  const description = `Project Zomboid server ${String(
    server.name || server.serverName,
  ).replace(/[\r\n]/g, " ")}`;

  if (provider === "systemd") {
    const content = [
      `# X-Zomboid-Panel-Server-ID: ${serverId}`,
      "[Unit]",
      `Description=${plainSystemdValue(description)}`,
      "After=network-online.target",
      "Wants=network-online.target",
      "",
      "[Service]",
      "Type=simple",
      `WorkingDirectory=${plainSystemdValue(launch.workingDirectory)}`,
      `Environment=${quoteSystemdArg(`ZOMBOID_PANEL_SERVER_ID=${serverId}`)}`,
      `ExecStart=/bin/bash ${quoteSystemdArg(launch.launcherPath)}`,
      "Restart=on-failure",
      "RestartSec=5",
      "TimeoutStopSec=180",
      "KillMode=control-group",
      "",
      "[Install]",
      "WantedBy=default.target",
      "",
    ].join("\n");
    return {
      provider,
      serviceName,
      filename: `${serviceName}.service`,
      installPath: path.join(
        options.homeDirectory || os.homedir(),
        ".config",
        "systemd",
        "user",
        `${serviceName}.service`,
      ),
      content,
      commands: [
        "install -d -m 0755 ~/.config/systemd/user",
        `install -m 0644 <downloaded-file> ~/.config/systemd/user/${serviceName}.service`,
        "systemctl --user daemon-reload",
        `systemctl --user enable ${serviceName}.service`,
        `sudo loginctl enable-linger ${serviceUser}`,
      ],
    };
  }

  const content = [
    "#!/sbin/openrc-run",
    `# X-Zomboid-Panel-Server-ID: ${serverId}`,
    `name=${quoteShell(description)}`,
    `description=${quoteShell(description)}`,
    'command="/bin/bash"',
    `command_args=${quoteShell(launch.launcherPath)}`,
    `directory=${quoteShell(launch.workingDirectory)}`,
    `export ZOMBOID_PANEL_SERVER_ID=${quoteShell(serverId)}`,
    "supervisor=supervise-daemon",
    "command_background=false",
    'pidfile="$' + '{XDG_RUNTIME_DIR}/$' + '{RC_SVCNAME}.pid"',
    "respawn_delay=5",
    "respawn_max=0",
    "",
    "depend() {",
    "  need net",
    "  after firewall",
    "}",
    "",
  ].join("\n");
  return {
    provider,
    serviceName,
    filename: serviceName,
    installPath: path.join(
      options.homeDirectory || os.homedir(),
      ".config",
      "rc",
      "init.d",
      serviceName,
    ),
    content,
    commands: [
      "install -d -m 0755 ~/.config/rc/init.d",
      `install -m 0755 <downloaded-file> ~/.config/rc/init.d/${serviceName}`,
      `rc-update --user add ${serviceName} default`,
    ],
  };
}

function defaultExecFile(command, args) {
  return new Promise((resolve) => {
    const uid = typeof process.getuid === "function" ? process.getuid() : null;
    const env = { ...process.env };
    if (!env.XDG_RUNTIME_DIR && Number.isInteger(uid)) {
      env.XDG_RUNTIME_DIR = `/run/user/${uid}`;
    }
    nodeExecFile(command, args, { timeout: 15000, env }, (error, stdout, stderr) => {
      resolve({
        code: Number.isInteger(error?.code) ? error.code : error ? 1 : 0,
        stdout: String(stdout || ""),
        stderr: String(stderr || error?.message || ""),
      });
    });
  });
}

function parseSystemdShow(stdout) {
  const values = {};
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator > 0) values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

export class LinuxServiceLifecycle {
  constructor(server, provider, options = {}) {
    if (!isManagedLifecycleProvider(provider)) {
      throw new Error(`Unsupported managed lifecycle provider: ${provider}`);
    }
    this.server = server;
    this.provider = provider;
    this.serviceName = getLifecycleServiceName(server);
    this.execFile = options.execFile || defaultExecFile;
    this.fileExists = options.fileExists || fs.existsSync;
    this.readFile = options.readFile || ((file) => fs.readFileSync(file, "utf8"));
    this.platform = options.platform || process.platform;
    this.containerized = options.containerized ?? isContainerized();
    this.waitForState = options.waitForState !== false;
    this.sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  assertSupported() {
    if (this.platform !== "linux") {
      throw new Error(`${this.provider} lifecycle is supported only on Linux`);
    }
    if (this.containerized) {
      throw new Error(
        "Container installations must keep the direct lifecycle provider and their existing image-based process model",
      );
    }
  }

  async inspect() {
    this.assertSupported();
    const marker = `ZOMBOID_PANEL_SERVER_ID=${this.server.id}`;
    if (this.provider === "systemd") {
      const unit = `${this.serviceName}.service`;
      const result = await this.execFile("systemctl", [
        "--user",
        "show",
        unit,
        "--property=LoadState",
        "--property=ActiveState",
        "--property=Environment",
      ]);
      const values = parseSystemdShow(result.stdout);
      const registered = values.LoadState && values.LoadState !== "not-found";
      const running = ["active", "activating", "reloading"].includes(
        values.ActiveState,
      );
      return {
        registered: Boolean(registered),
        running,
        activeState: values.ActiveState || "unknown",
        markerMatches: Boolean(
          registered && String(values.Environment || "").includes(marker),
        ),
        error:
          !registered && result.stderr
            ? result.stderr.trim().slice(0, 300)
            : null,
      };
    }

    const initPath = path.join(
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
      "rc",
      "init.d",
      this.serviceName,
    );
    const registered = this.fileExists(initPath);
    let markerMatches = false;
    if (registered) {
      try {
        markerMatches = this.readFile(initPath).includes(
          `X-Zomboid-Panel-Server-ID: ${this.server.id}`,
        );
      } catch (error) {
        return {
          registered: true,
          running: false,
          activeState: "unknown",
          markerMatches: false,
          error: `Could not read ${initPath}: ${error.message}`,
        };
      }
    }
    const status = registered
      ? await this.execFile("rc-service", ["--user", this.serviceName, "status"])
      : { code: 3, stdout: "", stderr: "" };
    return {
      registered,
      running: registered && status.code === 0,
      activeState: !registered
        ? "not-found"
        : status.code === 0
          ? "active"
          : "inactive",
      markerMatches,
      error: status.code !== 0 && status.code !== 3
        ? status.stderr.trim().slice(0, 300)
        : null,
    };
  }

  async preflightActivation() {
    const status = await this.inspect();
    if (!status.registered) {
      return {
        ready: false,
        ...status,
        error: `Install ${this.serviceName} before activating this provider`,
      };
    }
    if (!status.markerMatches) {
      return {
        ready: false,
        conflict: true,
        ...status,
        error:
          "The registered service belongs to another server profile or lacks the panel ownership marker",
      };
    }
    if (status.running) {
      return {
        ready: false,
        ...status,
        error:
          "The managed service is already running. Stop it before activation; the panel will not silently adopt it.",
      };
    }
    return { ready: true, conflict: false, ...status };
  }

  async status() {
    const status = await this.inspect();
    if (!status.registered) {
      return {
        running: false,
        scanFailed: true,
        error: `Managed service ${this.serviceName} is not installed`,
      };
    }
    if (!status.markerMatches) {
      return {
        running: false,
        scanFailed: true,
        error: `Managed service ${this.serviceName} failed ownership validation`,
      };
    }
    return {
      running: status.running,
      scanFailed: status.activeState === "unknown",
      activeState: status.activeState,
      error: status.error,
    };
  }

  async run(action) {
    if (!["start", "stop", "restart"].includes(action)) {
      throw new Error(`Unsupported lifecycle action: ${action}`);
    }
    const current = await this.inspect();
    if (!current.registered || !current.markerMatches) {
      return {
        success: false,
        confirmed: false,
        error: !current.registered
          ? `Managed service ${this.serviceName} is not installed`
          : `Managed service ${this.serviceName} failed ownership validation`,
      };
    }
    if (action === "start" && current.running) {
      return { success: true, confirmed: true, message: "Server is already running" };
    }
    if (action === "stop" && !current.running) {
      return { success: true, confirmed: true, message: "Server is already stopped" };
    }

    const args = this.provider === "systemd"
      ? ["--user", action, `${this.serviceName}.service`]
      : ["--user", this.serviceName, action];
    const command = this.provider === "systemd" ? "systemctl" : "rc-service";
    const result = await this.execFile(command, args);
    if (result.code !== 0) {
      return {
        success: false,
        confirmed: false,
        error: (result.stderr || result.stdout || `${command} exited ${result.code}`)
          .trim()
          .slice(0, 500),
      };
    }

    if (this.waitForState) {
      const expectedRunning = action !== "stop";
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const status = await this.status();
        if (!status.scanFailed && status.running === expectedRunning) {
          return {
            success: true,
            confirmed: true,
            message: `Server ${action} completed through ${this.provider}`,
          };
        }
        await this.sleep(250);
      }
      return {
        success: false,
        confirmed: false,
        error: `${this.provider} accepted ${action}, but the resulting service state could not be confirmed`,
      };
    }

    log.info(`${this.provider} ${action} accepted for ${this.serviceName}`);
    return {
      success: true,
      confirmed: true,
      message: `Server ${action} accepted by ${this.provider}`,
    };
  }
}

export function createLinuxServiceLifecycle(server, provider, options) {
  return new LinuxServiceLifecycle(server, provider, options);
}
