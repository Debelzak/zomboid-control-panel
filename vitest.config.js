import { defineConfig } from "vitest/config";

// Modernization DISC-001. This file sets `globalSetup` AND NOTHING ELSE, deliberately.
//
// Before this existed, `npm run test:server` was a bare `vitest run server/tests` on stock
// defaults. Introducing a root config where none existed can silently change how tests are
// DISCOVERED - include globs, environment, pools - which would be a worse regression than the
// defect being fixed. So every other option is left at its default, and the acceptance check for
// this change is not "the stray files stopped appearing" but "the suite still reports 535 tests".
//
// See docs/modernization/DECISIONS.md, DISC-001.
export default defineConfig({
  test: {
    globalSetup: ["./server/tests/vitest.globalSetup.mjs"],
  },
});
