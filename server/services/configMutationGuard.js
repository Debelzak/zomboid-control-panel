import { getActiveServer } from "../database/init.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("ConfigMutationGuard");

// Refuses a local config write while the server is running. The routes this
// applies to are chosen by callers via serverFiles.js's LOCAL_CONFIG_MUTATIONS
// — see that Set's own comment for what's still gated, what isn't, and why:
// the original blanket justification (PZ rewrites config on shutdown and
// would discard a live edit) was measured 2026-08-23 and found false for a
// clean stop, which is why one route (PUT /sandbox-option) was removed from
// that Set. This function's own behavior is unchanged; only the route list
// feeding it changed.
export async function requireStoppedForLocalConfigMutation(req, res, next) {
  try {
    const activeServer = await getActiveServer();
    if (activeServer?.isRemote) return next();

    const serverManager = req.app?.get?.("serverManager");
    if (typeof serverManager?.checkServerRunning !== "function") {
      return res.status(503).json({
        code: "SERVER_STATE_UNKNOWN",
        error: "Cannot verify whether the server is stopped. Try again shortly.",
      });
    }

    if (await serverManager.checkServerRunning()) {
      return res.status(409).json({
        code: "SERVER_RUNNING",
        error: "Stop the server before editing configuration.",
      });
    }

    return next();
  } catch (error) {
    log.warn(
      `Could not verify server state before config mutation: ${error.message}`,
    );
    return res.status(503).json({
      code: "SERVER_STATE_UNKNOWN",
      error: "Cannot verify whether the server is stopped. Try again shortly.",
    });
  }
}
