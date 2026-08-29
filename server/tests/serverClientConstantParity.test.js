import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { DEFAULT_INI_EXCLUSIONS } from "../utils/templateSchema.js";
import { USER_ROLES } from "../services/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

// hunt-wave14-2026-08-30: generalizes accessLevelsListParity.test.js's
// technique after that survey found two MORE server/client constant pairs
// that are hand-duplicated (a different array, by hand, in a different
// language, because server code isn't in the client bundle) with nothing
// enforcing agreement -- exactly the shape ACCESS_LEVELS had drifted into
// before that fix. Both pairs are confirmed IN SYNC as of this commit; this
// is pure guard installation, no behavior change.
//
// Same text-extraction technique as panelBridgeSendCommandLiteralsMatchValidActions.test.js
// and accessLevelsListParity.test.js: the client file is TS/TSX, not
// importable into this server-side vitest run without a build step, so its
// array literal is read as text and regex-extracted instead.
function extractArrayLiteral(relativePath, constName) {
  const content = fs.readFileSync(path.join(ROOT, relativePath), "utf-8");
  const re = new RegExp(`const ${constName}\\s*=\\s*\\[([^\\]]*)\\]`);
  const match = content.match(re);
  if (!match) return null;
  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^['"]|['"]$/g, ""));
}

describe("TEMPLATE_INI_EXCLUSIONS (client) vs DEFAULT_INI_EXCLUSIONS (server): parity", () => {
  // DEFAULT_INI_EXCLUSIONS's own comment (server/utils/templateSchema.js)
  // documents a real past incident in this exact domain (2026-08-24
  // conv-template-privesc): a template's own (attacker-controlled)
  // iniExclusions list was once trusted as authoritative at the apply-time
  // write site, letting an empty list disable the RCONPassword/port/
  // ServerName protection entirely. Fixed there by resolveIniExclusions()
  // always unioning in DEFAULT_INI_EXCLUSIONS unconditionally -- confirmed
  // (hunt-wave14) that the SAME unconditional union backs
  // validateTemplate()'s check on every saveTemplate()/importTemplate()
  // call, so a drifted CLIENT copy cannot itself leak a secret into a
  // saved/exported template: the server independently rejects (400,
  // SIM_TEMPLATE_VALIDATION_FAILED) any excluded key present in
  // template.serverIni, regardless of what the client stripped first. A
  // drift here is a confusing validation-error UX, not a secret leak --
  // still worth guarding so that error never happens, just not urgent.
  const CLIENT_PATH = "client/src/lib/templateBuilder.ts";

  it(`${CLIENT_PATH}'s TEMPLATE_INI_EXCLUSIONS matches server's DEFAULT_INI_EXCLUSIONS exactly`, () => {
    const clientList = extractArrayLiteral(CLIENT_PATH, "TEMPLATE_INI_EXCLUSIONS");
    expect(
      clientList,
      `could not find "const TEMPLATE_INI_EXCLUSIONS = [...]" in ${CLIENT_PATH} -- the extraction regex needs updating, not this test relaxing`,
    ).not.toBeNull();
    expect(
      clientList,
      "client and server ini-exclusion lists have drifted apart -- the client will build a template payload the server's validateTemplate() then rejects (serverIni must not contain excluded keys), a confusing UX regression even though it can't leak a secret",
    ).toEqual(DEFAULT_INI_EXCLUSIONS);
  });
});

describe("LEGACY_USER_ROLES (client) vs USER_ROLES (server): parity", () => {
  // client/src/pages/Users.tsx's own comment already explains why this
  // exists: POST /api/auth/users only accepts one of these three legacy
  // names (no roleId param at creation time). Nothing enforced the two
  // staying in sync before this.
  const CLIENT_PATH = "client/src/pages/Users.tsx";

  it(`${CLIENT_PATH}'s LEGACY_USER_ROLES matches server's USER_ROLES exactly`, () => {
    const clientList = extractArrayLiteral(CLIENT_PATH, "LEGACY_USER_ROLES");
    expect(
      clientList,
      `could not find "const LEGACY_USER_ROLES = [...]" in ${CLIENT_PATH} -- the extraction regex needs updating, not this test relaxing`,
    ).not.toBeNull();
    expect(
      clientList,
      "client and server legacy-role lists have drifted apart -- POST /api/auth/users would reject a role the client dropdown still offers, or the dropdown would be missing one the server accepts",
    ).toEqual(USER_ROLES);
  });
});
