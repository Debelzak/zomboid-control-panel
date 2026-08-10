import express from "express";
import { requireRole } from "../services/auth.js";
import { sanitizeError } from "../utils/sanitize.js";

const router = express.Router();

router.get("/status", requireRole("admin"), async (req, res) => {
  try {
    const dockerClient = req.app.get("dockerClient");
    if (!dockerClient?.enabled) {
      return res.json({ enabled: false, available: false, containers: [] });
    }
    const containers = await dockerClient.listManagedContainers();
    return res.json({
      enabled: true,
      available: dockerClient.available,
      containers: containers.map((container) => ({
        id: container.Id,
        name: (container.Names?.[0] || "").replace(/^\//, ""),
        image: container.Image,
        state: container.State,
        status: container.Status,
      })),
    });
  } catch (error) {
    return res.status(500).json({ error: sanitizeError(error.message) });
  }
});

router.post("/containers/:id/:action", requireRole("admin"), async (req, res) => {
  try {
    const dockerClient = req.app.get("dockerClient");
    if (!dockerClient?.enabled || !dockerClient.available) {
      return res.status(503).json({ error: "Docker control is unavailable" });
    }
    const result = await dockerClient.runManagedAction(req.params.id, req.params.action);
    if (!result.success) return res.status(403).json(result);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: sanitizeError(error.message) });
  }
});

export default router;
