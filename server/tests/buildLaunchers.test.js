import { describe, expect, it } from "vitest";
import fs from "fs";
import { generateStartBat, generateStartSh } from "../../build.js";

describe("standalone launchers", () => {
  it("does not promise a fixed URL from the Linux launcher", () => {
    const launcher = generateStartSh();

    expect(launcher).not.toContain("localhost:3001");
    expect(launcher).toContain("./ZomboidControlPanel");
  });

  it("supervises only the Linux panel process and forwards shutdown signals", () => {
    const launcher = generateStartSh();

    expect(launcher).toContain("PANEL_SUPERVISOR_V=2");
    expect(launcher).toContain("setsid ./ZomboidControlPanel");
    expect(launcher).toContain("trap 'stop_panel TERM' TERM");
    expect(launcher).toContain('kill -TERM -- "-$PANEL_PID"');
    expect(launcher).toContain('if [ "$STOPPING" = "1" ]');
    expect(launcher).toContain('if [ "$EXIT_CODE" = "75" ]');
  });

  it("configures systemd to stop only the supervisor main process", () => {
    const unit = fs.readFileSync("zomboid-panel.service", "utf8");
    const server = fs.readFileSync("server/index.js", "utf8");

    expect(unit).toContain("ExecStart=/opt/zomboid-panel/start.sh");
    expect(unit).toContain("KillMode=process");
    expect(server).toContain("process.exit(linuxSupervisor ? 75");
  });

  it("ships an explicit service installer that backs up existing units", () => {
    const installer = fs.readFileSync("install-linux-service.sh", "utf8");

    expect(installer).toContain('if [ "$(id -u)" -ne 0 ]');
    expect(installer).toContain('cp -p "$UNIT_TARGET" "$BACKUP"');
    expect(installer).toContain("systemctl daemon-reload");
    expect(installer).not.toMatch(/\bsudo\s+(systemctl|cp|install|chmod)/);
  });

  it("does not promise a fixed URL from the Windows supervisor", () => {
    expect(generateStartBat()).not.toContain("localhost:3001");
  });
});
