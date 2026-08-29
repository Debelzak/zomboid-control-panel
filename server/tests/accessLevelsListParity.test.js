import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { ACCESS_LEVELS } from "../utils/commands.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

// hunt-wave13-2026-08-30: ACCESS_LEVELS used to be curated from "the
// official PZ Admin Commands wiki (Build 42.17.0)" -- a citation with its
// own expiry date, and it was wrong in both directions. 'overseer' is a
// declared getDefaultForOverseer() method in the real server jar's
// zombie/characters/Roles.class with NO backing setupRole() id literal
// anywhere in the class (same fingerprint as the already-known-dead
// getDefaultForNewUser()) -- server/routes/players.js:311 let it through
// its own validation, so the panel offered a dropdown choice that could
// only ever fail. 'priority' is the opposite defect: a real setupRole() id
// (getDefaultForPriorityUser(), in-game display "PriorityUser") that was
// missing from the array entirely, making it impossible to set from this
// panel at all even though the server genuinely accepts it. Full evidence
// in server/utils/commands.js's own ACCESS_LEVELS comment.
//
// This is a pin, not a re-derivation from the jar (unlike
// rconRejectionGroundTruth.test.js) -- there's no committed fixture here to
// diff against, just the array itself. A future jar re-verification that
// finds another drift should update BOTH this pin and the array together,
// with the same evidence-first standard the last one used, not just bump
// the number to make the test pass.
const EXPECTED_ACCESS_LEVELS = ["admin", "moderator", "gm", "observer", "priority", "user", "none"];

// client/src/pages/Players.tsx keeps its own hand-maintained copy of this
// same array (not imported -- server code isn't pulled into the client
// bundle) for its access-level <Select>. Nothing enforced the two staying
// in sync before this test; a silent drift here means the dropdown offers
// (or is missing) a choice the server-side check at players.js:311 disagrees
// with, which fails at submit time with no compile-time signal.
const PLAYERS_TSX_PATH = "client/src/pages/Players.tsx";

function extractPlayersTsxAccessLevels() {
  const content = fs.readFileSync(path.join(ROOT, PLAYERS_TSX_PATH), "utf-8");
  const match = content.match(/const ACCESS_LEVELS = \[([^\]]*)\]/);
  if (!match) return null;
  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^['"]|['"]$/g, ""));
}

describe("ACCESS_LEVELS: pin and cross-file parity (hunt-wave13 drift gate)", () => {
  it("server/utils/commands.js's ACCESS_LEVELS matches the pinned, jar-derived list exactly", () => {
    expect(ACCESS_LEVELS).toEqual(EXPECTED_ACCESS_LEVELS);
  });

  it("does not contain 'overseer' (confirmed absent from the default Roles table)", () => {
    expect(ACCESS_LEVELS).not.toContain("overseer");
  });

  it("contains 'priority' (a real setupRole() id previously missing from this array)", () => {
    expect(ACCESS_LEVELS).toContain("priority");
  });

  it(`${PLAYERS_TSX_PATH}'s hand-maintained ACCESS_LEVELS copy matches the server's exactly`, () => {
    const clientLevels = extractPlayersTsxAccessLevels();
    expect(
      clientLevels,
      `could not find "const ACCESS_LEVELS = [...]" in ${PLAYERS_TSX_PATH} -- the extraction regex needs updating, not this test relaxing`,
    ).not.toBeNull();
    expect(
      clientLevels,
      "client and server ACCESS_LEVELS have drifted apart -- the dropdown will offer (or omit) a choice the server-side check at players.js:311 disagrees with",
    ).toEqual(ACCESS_LEVELS);
  });
});
