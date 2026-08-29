import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelUpdateChecker } from "../services/panelUpdateChecker.js";

const roots = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zcp-linux-managed-"));
  roots.push(root);
  const incoming = path.join(root, "incoming");
  const live = path.join(root, "live");
  fs.mkdirSync(incoming);
  fs.mkdirSync(live);
  for (const name of ["start.sh", "zomboid-panel.service", "install-linux-service.sh"]) {
    fs.writeFileSync(path.join(incoming, name), `new-${name}`);
    fs.writeFileSync(path.join(live, name), `old-${name}`);
  }
  return { incoming, live };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Linux managed updater files", () => {
  it("activates the launcher and service templates together", () => {
    const { incoming, live } = fixture();
    new PanelUpdateChecker().replaceManagedLinuxFiles(incoming, live);

    expect(fs.readFileSync(path.join(live, "start.sh"), "utf8")).toBe("new-start.sh");
    expect(fs.readFileSync(path.join(live, "zomboid-panel.service"), "utf8"))
      .toBe("new-zomboid-panel.service");
    expect(fs.existsSync(path.join(live, "start.sh.previous"))).toBe(false);
  });

  it("rolls back every previously swapped file when a later swap fails", () => {
    const { incoming, live } = fixture();
    const renameSync = fs.renameSync.bind(fs);
    vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      if (String(source).endsWith("zomboid-panel.service.new") && target === path.join(live, "zomboid-panel.service")) {
        const error = new Error("simulated swap failure");
        error.code = "EACCES";
        throw error;
      }
      return renameSync(source, target);
    });

    expect(() => new PanelUpdateChecker().replaceManagedLinuxFiles(incoming, live))
      .toThrow("simulated swap failure");
    expect(fs.readFileSync(path.join(live, "start.sh"), "utf8")).toBe("old-start.sh");
    expect(fs.readFileSync(path.join(live, "zomboid-panel.service"), "utf8"))
      .toBe("old-zomboid-panel.service");
  });
});
