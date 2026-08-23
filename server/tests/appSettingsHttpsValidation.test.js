import { describe, expect, it, vi, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// Regression coverage for the HTTPS-crash finding: PUT /app-settings used
// to accept httpsCertPath/httpsKeyPath/httpsPort as any string/number with
// zero validation -- the only guard against a bad value lived at panel BOOT
// (server/index.js's setupHttpsServer, see httpsSetup.test.js), which meant
// a bad value could be saved successfully (200, success toast) and only
// fail on the next restart. This file exercises the save-time half of the
// fix: reject a bad value immediately, with a clear reason, before it's
// ever persisted.

const settingsStore = { panelPort: 3001 };

vi.mock("../database/init.js", () => ({
  getAllSettings: vi.fn(async () => ({ ...settingsStore })),
  getSetting: vi.fn(async (key) => settingsStore[key]),
  setSetting: vi.fn(async (key, value) => {
    settingsStore[key] = value;
  }),
}));

function createResponse() {
  const response = { status: () => response, json: () => response };
  let statusCode = 200;
  let body = null;
  response.status = (code) => {
    statusCode = code;
    return response;
  };
  response.json = (payload) => {
    body = payload;
    return response;
  };
  response.getStatusCode = () => statusCode;
  response.getBody = () => body;
  return response;
}

function getRouteHandler(router, routePath, method) {
  const layer = router.stack.find(
    (entry) => entry.route?.path === routePath && entry.route.methods[method],
  );
  // Last handler in the stack: requirePermission runs first, the real
  // logic last -- gate coverage lives in configRoutesRoleSweep.test.js,
  // this file exercises the validation logic directly.
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function putAppSettings(settings) {
  const { default: router } = await import("../routes/config.js");
  const res = createResponse();
  await getRouteHandler(router, "/app-settings", "put")(
    { body: { settings }, app: { get: () => undefined } },
    res,
  );
  return res;
}

let tempDir;

afterEach(() => {
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  tempDir = null;
  settingsStore.panelPort = 3001;
});

describe("PUT /app-settings -- httpsCertPath / httpsKeyPath validation", () => {
  it("rejects a directory as httpsCertPath instead of saving it", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zcp-appsettings-test-"));
    const res = await putAppSettings({ httpsCertPath: tempDir });
    expect(res.getStatusCode()).toBe(400);
    expect(res.getBody().error).toMatch(/must be a file, not a directory/);
  });

  it("rejects a path that doesn't exist", async () => {
    const res = await putAppSettings({
      httpsKeyPath: "C:\\nonexistent\\path\\key.pem",
    });
    expect(res.getStatusCode()).toBe(400);
    expect(res.getBody().error).toMatch(/does not point to a file that exists/);
  });

  it("accepts an empty string -- clearing the custom cert path back to auto-generated must still work", async () => {
    const res = await putAppSettings({ httpsCertPath: "" });
    expect(res.getStatusCode()).toBe(200);
    expect(res.getBody().success).toBe(true);
  });

  it("accepts a real, readable file", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zcp-appsettings-test-"));
    const certPath = path.join(tempDir, "panel.cert");
    fs.writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n");
    const res = await putAppSettings({ httpsCertPath: certPath });
    expect(res.getStatusCode()).toBe(200);
    expect(res.getBody().success).toBe(true);
  });
});

describe("PUT /app-settings -- httpsPort validation", () => {
  it("rejects a non-integer value", async () => {
    const res = await putAppSettings({ httpsPort: "not-a-number" });
    expect(res.getStatusCode()).toBe(400);
    expect(res.getBody().error).toMatch(/httpsPort must be a whole number/);
  });

  it("rejects an out-of-range value", async () => {
    const res = await putAppSettings({ httpsPort: 999999 });
    expect(res.getStatusCode()).toBe(400);
    expect(res.getBody().error).toMatch(/httpsPort must be a whole number/);
  });

  it("rejects zero and negative values", async () => {
    const zero = await putAppSettings({ httpsPort: 0 });
    expect(zero.getStatusCode()).toBe(400);
    const negative = await putAppSettings({ httpsPort: -443 });
    expect(negative.getStatusCode()).toBe(400);
  });

  it("rejects a port equal to the panel's own HTTP port", async () => {
    settingsStore.panelPort = 3001;
    const res = await putAppSettings({ httpsPort: 3001 });
    expect(res.getStatusCode()).toBe(400);
    expect(res.getBody().error).toMatch(/cannot be the same as the panel's HTTP port/);
  });

  it("accepts a valid, non-colliding port", async () => {
    settingsStore.panelPort = 3001;
    const res = await putAppSettings({ httpsPort: 3443 });
    expect(res.getStatusCode()).toBe(200);
    expect(res.getBody().success).toBe(true);
  });
});

describe("PUT /app-settings -- reconnectInterval validation (same missing-range-check shape, lower stakes)", () => {
  it("rejects an out-of-range value", async () => {
    const tooLow = await putAppSettings({ reconnectInterval: 0 });
    expect(tooLow.getStatusCode()).toBe(400);
    const tooHigh = await putAppSettings({ reconnectInterval: 61 });
    expect(tooHigh.getStatusCode()).toBe(400);
  });

  it("accepts a valid value", async () => {
    const res = await putAppSettings({ reconnectInterval: 15 });
    expect(res.getStatusCode()).toBe(200);
    expect(res.getBody().success).toBe(true);
  });
});
