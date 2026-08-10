import fs from "fs";
import http from "http";
import { createLogger } from "../utils/logger.js";

const log = createLogger("DockerClient");
const MANAGED_LABEL = "zomboid-panel.managed";
const REQUEST_TIMEOUT_MS = 5000;

export function isManagedContainer(container) {
  return container?.Labels?.[MANAGED_LABEL] === "true";
}

export class DockerClient {
  constructor({ socketPath = "/var/run/docker.sock", enabled = process.env.PANEL_DOCKER_CONTROL_ENABLED === "true" } = {}) {
    this.socketPath = socketPath;
    this.enabled = enabled;
  }

  get available() {
    return this.enabled && fs.existsSync(this.socketPath);
  }

  async listManagedContainers() {
    if (!this.available) return [];
    try {
      const containers = await this._requestJson("GET", "/containers/json?all=true");
      return Array.isArray(containers) ? containers.filter(isManagedContainer) : [];
    } catch (error) {
      log.debug(`Docker discovery failed: ${error.message}`);
      return [];
    }
  }

  _requestJson(method, requestPath) {
    return new Promise((resolve, reject) => {
      const request = http.request(
        { socketPath: this.socketPath, method, path: requestPath, timeout: REQUEST_TIMEOUT_MS },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => {
            if (response.statusCode >= 400) {
              reject(new Error(`Docker API returned ${response.statusCode}`));
              return;
            }
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
            } catch {
              reject(new Error("Docker API returned invalid JSON"));
            }
          });
        },
      );
      request.on("timeout", () => request.destroy(new Error("Docker API timed out")));
      request.on("error", reject);
      request.end();
    });
  }
}
