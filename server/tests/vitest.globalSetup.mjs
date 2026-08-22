// Modernization DISC-001: keep the test suite out of the repository's data/ and logs/.
//
// WHY THIS EXISTS
// `server/database/init.js` runs a bare top-level `for` loop of `fs.mkdirSync` (lines 43-50), so
// merely IMPORTING it creates `data/` and `data/backups/` and writes a default `data/db.json`.
// `scripts/modernization/bootstrap-plan.ps1` then refuses to pass, because a runtime `data/db.json`
// must never exist in the modernization fork. The documented FND-001 command sequence therefore
// could not be run twice: its own mandatory gate broke its own mandatory preflight.
//
// WHY IT IS A FILE AND NOT AN ENVIRONMENT VARIABLE
// `server/utils/paths.js` `getDataPaths()` resolves the data root ONLY from `paths.config.json`
// at the project root, and memoizes the result in a module-level `currentPaths`. There is no env
// override, and the value is fixed at first import. So the override must already be on disk before
// any worker imports the module. `globalSetup` runs in the main process before workers spawn,
// which is exactly that window. A `setupFiles` hook would be too late.
//
// This mirrors what the plan's own performance-baseline step already does by hand.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const configPath = path.join(repoRoot, "paths.config.json");

let tempRoot = null;
let weWroteTheConfig = false;

export async function setup() {
  // NEVER clobber an existing override. A developer may be pointing the panel at a real data root,
  // and silently replacing that file would be far worse than the problem this fixes. If one is
  // already present we leave it strictly alone and say so, rather than failing the run.
  if (fs.existsSync(configPath)) {
    console.log(
      "[modernization] paths.config.json already exists - leaving it untouched. " +
        "Test data will follow that override, not a temporary root."
    );
    return;
  }

  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zcp-test-"));
  const config = {
    dataDir: path.join(tempRoot, "data"),
    logsDir: path.join(tempRoot, "logs"),
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
  weWroteTheConfig = true;
}

export async function teardown() {
  // Remove only what we created. If the config was already there on entry, it is not ours to delete.
  if (weWroteTheConfig) {
    fs.rmSync(configPath, { force: true });
  }
  if (tempRoot) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
}
