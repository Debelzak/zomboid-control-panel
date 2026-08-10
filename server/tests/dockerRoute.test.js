import { describe, expect, it, vi } from "vitest";

vi.mock("../services/auth.js", () => ({
  requireRole: () => (req, res, next) => {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    return next();
  },
}));

const { default: router } = await import("../routes/docker.js");

function createResponse() {
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  return response;
}

async function runRoute(routePath, method, request, response) {
  const layer = router.stack.find(
    (entry) => entry.route?.path === routePath && entry.route.methods[method],
  );
  const handlers = layer.route.stack.map((entry) => entry.handle);
  let index = -1;
  const next = async (error) => {
    index += 1;
    if (error) throw error;
    if (index < handlers.length) await handlers[index](request, response, next);
  };
  await next();
}

describe("GET /api/docker/status", () => {
  it("rejects non-admin callers", async () => {
    const response = createResponse();
    const listManagedContainers = vi.fn();

    await runRoute("/status", "get",
      { user: { role: "viewer" }, app: { get: () => ({ enabled: true, listManagedContainers }) } },
      response,
    );

    expect(response.status).toHaveBeenCalledWith(403);
    expect(listManagedContainers).not.toHaveBeenCalled();
  });

  it("reports only the managed containers supplied by the client", async () => {
    const response = createResponse();
    await runRoute("/status", "get",
      {
        user: { role: "admin" },
        app: {
          get: () => ({
            enabled: true,
            available: true,
            listManagedContainers: vi.fn(async () => [{
              Id: "managed-id",
              Names: ["/pz-managed"],
              Image: "custom/pz",
              State: "running",
              Status: "Up 2 minutes",
            }]),
          }),
        },
      },
      response,
    );

    expect(response.json).toHaveBeenCalledWith({
      enabled: true,
      available: true,
      containers: [{
        id: "managed-id",
        name: "pz-managed",
        image: "custom/pz",
        state: "running",
        status: "Up 2 minutes",
      }],
    });
  });
});

describe("POST /api/docker/containers/:id/:action", () => {
  it("rejects a non-admin caller before invoking Docker", async () => {
    const response = createResponse();
    const runManagedAction = vi.fn();

    await runRoute("/containers/:id/:action", "post", {
      user: { role: "viewer" },
      params: { id: "managed", action: "restart" },
      app: { get: () => ({ enabled: true, available: true, runManagedAction }) },
    }, response);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(runManagedAction).not.toHaveBeenCalled();
  });

  it("only runs an action through the managed-container client", async () => {
    const response = createResponse();
    const runManagedAction = vi.fn(async () => ({ success: true }));

    await runRoute("/containers/:id/:action", "post", {
      user: { role: "admin" },
      params: { id: "managed", action: "restart" },
      app: { get: () => ({ enabled: true, available: true, runManagedAction }) },
    }, response);

    expect(runManagedAction).toHaveBeenCalledWith("managed", "restart");
    expect(response.json).toHaveBeenCalledWith({ success: true });
  });
});
