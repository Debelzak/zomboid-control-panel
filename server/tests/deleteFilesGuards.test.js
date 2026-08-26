import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("../database/init.js", () => ({
  logServerEvent: vi.fn(),
  setSetting: vi.fn(),
  getSetting: vi.fn(),
  getActiveServer: vi.fn(),
}));

const { default: router } = await import("../routes/server.js");

function createResponse() {
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  return response;
}

function getDeleteFilesHandler() {
  const layer = router.stack.find(
    (entry) => entry.route?.path === "/delete-files" && entry.route.methods.post,
  );
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

// Same guard shape POST /wipe already has: refuse without confirm, refuse
// while the server is running, and fail closed (not open) when detection
// itself can't tell whether the server is running -- see d85fd42, where
// checkServerRunning() collapsing a failed scan into `false` let several
// callers treat "cannot tell" as "stopped".
describe("POST /api/server/delete-files safety guards", () => {
  let installDir;
  let serverManager;

  beforeEach(() => {
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), "pz-delete-files-"));
    // A PZ marker file, so the existing "is this really a PZ install"
    // check passes and the guards under test are the only thing left
    // that could refuse the request.
    fs.writeFileSync(path.join(installDir, "ProjectZomboid64.json"), "{}");
    serverManager = {
      loadConfig: async () => {},
      getServerProcessDetails: async () => ({ running: false, scanFailed: false }),
    };
  });

  afterEach(() => {
    fs.rmSync(installDir, { recursive: true, force: true });
  });

  const buildRequest = (body) => ({
    app: { get: () => serverManager },
    body: { path: installDir, ...body },
  });

  it("refuses without confirm: true", async () => {
    const handler = getDeleteFilesHandler();
    const response = createResponse();

    await handler(buildRequest({}), response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(
      // Same code /wipe uses for the same gap -- see errorCodes.js.
      expect.objectContaining({ code: "WIPE_CONFIRM_REQUIRED" }),
    );
    // Refusal must be real, not just the wrong status code with the delete
    // happening anyway.
    expect(fs.existsSync(installDir)).toBe(true);
  });

  it("refuses while the server is running", async () => {
    serverManager.getServerProcessDetails = async () => ({
      running: true,
      scanFailed: false,
    });
    const handler = getDeleteFilesHandler();
    const response = createResponse();

    await handler(buildRequest({ confirm: true }), response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(
      // Same code /wipe uses for the same gap -- see errorCodes.js.
      expect.objectContaining({ code: "WIPE_SERVER_RUNNING" }),
    );
    expect(fs.existsSync(installDir)).toBe(true);
  });

  it("refuses when it cannot be determined whether the server is running (fails closed)", async () => {
    serverManager.getServerProcessDetails = async () => ({
      running: false,
      scanFailed: true,
    });
    const handler = getDeleteFilesHandler();
    const response = createResponse();

    await handler(buildRequest({ confirm: true }), response);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "SERVER_STATE_UNKNOWN" }),
    );
    expect(fs.existsSync(installDir)).toBe(true);
  });

  it("still deletes on the happy path: stopped, confirmed, a real PZ install", async () => {
    const handler = getDeleteFilesHandler();
    const response = createResponse();

    await handler(buildRequest({ confirm: true }), response);

    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
    expect(fs.existsSync(installDir)).toBe(false);
  });

  // 2026-08-26 bug hunt round 2, Pam's finding 2: the entry check happens
  // once, but everything after it (path/marker validation) is synchronous --
  // getServerProcessDetails() itself is the only part of this route that
  // yields, so a server that starts DURING that scan (a second admin
  // session, a scheduler task, a supervisor auto-restart) would previously
  // sail through undetected. These simulate exactly that: the first check
  // (at route entry) sees a stopped server, but the server has started by
  // the time the SECOND check (immediately before the actual delete) runs.
  describe("re-checks immediately before the delete, not just at entry", () => {
    it("refuses when the server starts between the entry check and the delete", async () => {
      let calls = 0;
      serverManager.getServerProcessDetails = async () => {
        calls += 1;
        return calls === 1
          ? { running: false, scanFailed: false }
          : { running: true, scanFailed: false };
      };
      const handler = getDeleteFilesHandler();
      const response = createResponse();

      await handler(buildRequest({ confirm: true }), response);

      expect(calls).toBeGreaterThanOrEqual(2);
      expect(response.status).toHaveBeenCalledWith(400);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "WIPE_SERVER_RUNNING" }),
      );
      // The whole point: refusal must be real, the install must survive.
      expect(fs.existsSync(installDir)).toBe(true);
    });

    it("fails closed when the second scan itself can't tell, even though the first scan could", async () => {
      let calls = 0;
      serverManager.getServerProcessDetails = async () => {
        calls += 1;
        return calls === 1
          ? { running: false, scanFailed: false }
          : { running: false, scanFailed: true };
      };
      const handler = getDeleteFilesHandler();
      const response = createResponse();

      await handler(buildRequest({ confirm: true }), response);

      expect(calls).toBeGreaterThanOrEqual(2);
      expect(response.status).toHaveBeenCalledWith(503);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "SERVER_STATE_UNKNOWN" }),
      );
      expect(fs.existsSync(installDir)).toBe(true);
    });
  });
});
