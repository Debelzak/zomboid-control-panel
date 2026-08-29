import { describe, expect, it, vi } from "vitest";

import {
  LinuxServiceLifecycle,
  buildLifecycleTemplate,
  getLinuxLifecycleCapabilities,
  getLifecycleServiceName,
  isManagedLifecycleProvider,
} from "../services/linuxServiceLifecycle.js";

const server = {
  id: "alpha-1",
  name: "Alpha Server",
  serverName: "servertest",
  installPath: "/opt/pz server",
};

describe("Linux managed-service lifecycle", () => {
  it("derives a stable service name from the immutable server id", () => {
    expect(getLifecycleServiceName(server)).toBe(
      "zomboid-panel-server-alpha-1",
    );
    expect(() => getLifecycleServiceName({ id: "../unsafe" })).toThrow(
      /invalid server id/i,
    );
  });

  it("recognizes only systemd and OpenRC as managed providers", () => {
    expect(isManagedLifecycleProvider("direct")).toBe(false);
    expect(isManagedLifecycleProvider("systemd")).toBe(true);
    expect(isManagedLifecycleProvider("openrc")).toBe(true);
    expect(isManagedLifecycleProvider("docker")).toBe(false);
  });

  it("advertises managed providers only for non-container Linux hosts", () => {
    expect(
      getLinuxLifecycleCapabilities({ platform: "linux", containerized: false }),
    ).toEqual({
      supported: true,
      platform: "linux",
      containerized: false,
      providers: ["direct", "systemd", "openrc"],
    });
    expect(
      getLinuxLifecycleCapabilities({ platform: "win32", containerized: false }),
    ).toMatchObject({ supported: false, providers: ["direct"] });
    expect(
      getLinuxLifecycleCapabilities({ platform: "linux", containerized: true }),
    ).toMatchObject({ supported: false, providers: ["direct"] });
  });

  it("renders a systemd unit with an ownership marker and safely quoted paths", () => {
    const template = buildLifecycleTemplate(server, "systemd", {
      serviceUser: "pzuser",
      homeDirectory: "/home/pzuser",
      fileExists: (candidate) => candidate.endsWith("start-server_servertest.sh"),
    });

    expect(template.filename).toBe("zomboid-panel-server-alpha-1.service");
    expect(template.content).toContain(
      "X-Zomboid-Panel-Server-ID: alpha-1",
    );
    expect(template.content).not.toContain('User=pzuser');
    // WorkingDirectory= is a plain Key=Value assignment directive, not one
    // of the Exec*= family -- systemd takes the rest of the line literally,
    // with no word-splitting and no quote handling at all (verified against
    // real systemd-analyze/systemctl show; see
    // linuxServiceLifecycleRealSystemd.test.js). Wrapping it in quotes, as
    // the value used to be, makes those quote characters part of the path
    // and every generated unit fails to load. Unquoted is correct.
    expect(template.content).toContain('WorkingDirectory=/opt/pz server');
    expect(template.content).not.toMatch(/^WorkingDirectory="/m);
    expect(template.content).toContain(
      'ExecStart=/bin/bash "/opt/pz server/start-server_servertest.sh"',
    );
    expect(template.content).toContain("KillMode=control-group");
    expect(template.content).toContain("WantedBy=default.target");
    expect(template.installPath).toBe(
      "/home/pzuser/.config/systemd/user/zomboid-panel-server-alpha-1.service",
    );
  });

  it("renders an OpenRC service that is supervised outside the panel", () => {
    const template = buildLifecycleTemplate(server, "openrc", {
      serviceUser: "pzuser",
      homeDirectory: "/home/pzuser",
      fileExists: () => false,
    });

    expect(template.filename).toBe("zomboid-panel-server-alpha-1");
    expect(template.content).toContain("#!/sbin/openrc-run");
    // directory=/command_args= (openrc's own declarative supervisor=
    // integration) re-evaluate their values a second time after sourcing --
    // real OpenRC word-splits an unescaped space in that second pass no
    // matter how the value was quoted for the first, which is why a space in
    // installPath used to break the supervised command entirely. This
    // template instead defines start()/stop() itself and invokes
    // supervise-daemon directly with the launcher path and working directory
    // as ordinary, single-pass-quoted argv entries -- see
    // linuxServiceLifecycleRealOpenrc.test.js for the real rc-service proof.
    expect(template.content).not.toContain("supervisor=supervise-daemon");
    expect(template.content).not.toMatch(/^command_args=/m);
    expect(template.content).not.toMatch(/^directory=/m);
    expect(template.content).toContain(
      'pidfile="${XDG_RUNTIME_DIR}/${RC_SVCNAME}.pid"',
    );
    expect(template.content).toContain(
      "X-Zomboid-Panel-Server-ID: alpha-1",
    );
    expect(template.content).toContain(
      "--chdir '/opt/pz server' \\",
    );
    expect(template.content).toContain(
      "-- /bin/bash '/opt/pz server/start-server.sh'",
    );
    expect(template.installPath).toBe(
      "/home/pzuser/.config/rc/init.d/zomboid-panel-server-alpha-1",
    );
  });

  it("does not corrupt an OpenRC description containing a literal '$'", () => {
    // name=/description= were never part of openrc-run.sh's declarative
    // command line, so they were never subject to its second-pass
    // re-evaluation -- but the old quoteShell() escaped "$" anyway (needed
    // only for directory=/command_args=), which introduced a spurious
    // literal backslash into the displayed service name. Verified live on
    // real OpenRC: "rc-service ... start" echoed "Starting ... \$CoolServer"
    // instead of "$CoolServer".
    const dollarServer = { ...server, name: "Alpha $CoolServer" };
    const template = buildLifecycleTemplate(dollarServer, "openrc", {
      fileExists: () => false,
    });
    expect(template.content).toContain(
      "name='Project Zomboid server Alpha $CoolServer'",
    );
    expect(template.content).not.toContain("\\$CoolServer");
  });

  it("routes systemd actions through execFile without a shell", async () => {
    const execFile = vi.fn(async (command, args) => {
      if (args.includes("show")) {
        return {
          code: 0,
          stdout:
            "LoadState=loaded\nActiveState=inactive\nEnvironment=ZOMBOID_PANEL_SERVER_ID=alpha-1\n",
          stderr: "",
        };
      }
      return { code: 0, stdout: "", stderr: "" };
    });
    const lifecycle = new LinuxServiceLifecycle(server, "systemd", {
      execFile,
      platform: "linux",
      containerized: false,
      waitForState: false,
    });

    const result = await lifecycle.run("start");

    expect(result.success).toBe(true);
    expect(execFile).toHaveBeenCalledWith("systemctl", [
      "--user",
      "start",
      "zomboid-panel-server-alpha-1.service",
    ]);
  });

  it("refuses to control a registered service owned by another profile", async () => {
    const lifecycle = new LinuxServiceLifecycle(server, "systemd", {
      platform: "linux",
      containerized: false,
      execFile: vi.fn(async () => ({
        code: 0,
        stdout:
          "LoadState=loaded\nActiveState=inactive\nEnvironment=ZOMBOID_PANEL_SERVER_ID=other\n",
        stderr: "",
      })),
    });

    const result = await lifecycle.preflightActivation();

    expect(result.ready).toBe(false);
    expect(result.conflict).toBe(true);
    expect(result.error).toMatch(/another server profile/i);
  });

  it("never enables managed host services inside a container", async () => {
    const lifecycle = new LinuxServiceLifecycle(server, "systemd", {
      platform: "linux",
      containerized: true,
      execFile: vi.fn(),
    });

    await expect(lifecycle.preflightActivation()).rejects.toThrow(
      /container installations/i,
    );
  });

  it("requires the installed service to be stopped before activation", async () => {
    const lifecycle = new LinuxServiceLifecycle(server, "systemd", {
      platform: "linux",
      containerized: false,
      execFile: vi.fn(async () => ({
        code: 0,
        stdout:
          "LoadState=loaded\nActiveState=active\nEnvironment=ZOMBOID_PANEL_SERVER_ID=alpha-1\n",
        stderr: "",
      })),
    });

    const result = await lifecycle.preflightActivation();

    expect(result.ready).toBe(false);
    expect(result.running).toBe(true);
    expect(result.error).toMatch(/already running/i);
  });
});
