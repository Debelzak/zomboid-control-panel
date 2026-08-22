import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ErrorCode } from "../utils/errorCodes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.join(__dirname, "..");

// Every `code: "<literal>"` object-literal property across server/routes,
// server/services, server/middleware and server/index.js -- this is the
// "attached to a response" shape (an object property, always alongside an
// `error`/`message`/`success` sibling in every real case checked
// 2026-08-22). Deliberately regex-based, not a full AST parse: the pattern
// is narrow and well-defined enough not to need one, and it avoids taking
// a permanent, self-enforcing test dependent on @babel/parser or glob --
// neither is a declared dependency of this project (both happen to be
// present transitively today, pulled in by other tooling, which is not
// something a test meant to keep working indefinitely should rely on).
//
// WHAT THIS DOES NOT SCAN, ON PURPOSE: bare `X.code = "<literal>"`
// assignment expressions (no colon) are invisible to this regex by
// construction. That's deliberate, not an oversight -- that shape covers
// both genuinely internal, never-user-facing codes (ETIMEDOUT, an
// internal GitHub-API timeout marker read back by isRetryableGitHubError())
// and at least one real user-facing one (`apply_in_progress` in
// spawnWindowsApplyHelper()) with no structural way to tell them apart
// short of reading intent -- see server/utils/errorCodes.js's own trailing
// comment for the full accounting of that gap. A code introduced that way
// will NOT be caught here if it's missing from the registry.
const CODE_LITERAL_RE = /\bcode:\s*(["'])([^"']+)\1/g;

function listJsFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => path.join(dir, f));
}

const SCANNED_FILES = [
  ...listJsFiles(path.join(SERVER_DIR, "routes")),
  ...listJsFiles(path.join(SERVER_DIR, "services")),
  ...listJsFiles(path.join(SERVER_DIR, "middleware")),
  path.join(SERVER_DIR, "index.js"),
];

function findCodeLiterals() {
  const found = [];
  for (const file of SCANNED_FILES) {
    const source = fs.readFileSync(file, "utf8");
    const relFile = path.relative(SERVER_DIR, file).replace(/\\/g, "/");
    let match;
    CODE_LITERAL_RE.lastIndex = 0;
    while ((match = CODE_LITERAL_RE.exec(source))) {
      const line = source.slice(0, match.index).split("\n").length;
      found.push({ file: relFile, line, value: match[2] });
    }
  }
  return found;
}

// This is a STRUCTURE check, one level deeper than the fr/en locale parity
// test (client/src/locales/__tests__/localeParity.test.ts), not a MEANING
// check: it proves every code literal the server actually emits is a
// registered ErrorCode member, and (once client/src/locales/en/errors.json
// exists) that every registered member has an English locale entry.
// A green run here proves a key EXISTS for every code -- it says nothing
// about whether the English or French TEXT at that key is the right text
// for that code. That last mile is the same one the locales README already
// names for the fr/en parity test (the shipped nav.items.serverSetup
// incident): a human has to read the rendered string, this test cannot.
//
// A CONSTRAINT THIS EXACT-MATCH CHECK IMPOSES ON errors.json: it compares
// each ErrorCode CONSTANT NAME to a locale key with `===`, so i18next's
// `_one`/`_other` plural-suffixed key convention (e.g. splitting
// ROLE_HAS_MEMBERS into ROLE_HAS_MEMBERS_one / ROLE_HAS_MEMBERS_other)
// fails this test -- the bare constant-name key it looks for is missing,
// even though a real, working pair of plural keys exists. Angela hit this
// for ROLE_HAS_MEMBERS and correctly kept the source text's manual
// "user(s)" style instead, documenting it as a constraint rather than
// fighting the test. This is intentional, not a gap to fix: exact-match is
// what makes this check catch a missing/misspelled key at all, and a
// looser match (prefix, or ignoring _one/_other suffixes) would let a
// genuinely missing bare key hide behind an unrelated plural pair. If a
// future code needs real plural forms, it needs a second, explicit
// mechanism -- not a loosening of this one.
describe("server error codes: registry membership (structure, not meaning)", () => {
  it("every `code:` literal used in server/routes, server/services, server/middleware and server/index.js is a registered ErrorCode value", () => {
    const registryValues = new Set(Object.values(ErrorCode));
    const literals = findCodeLiterals();
    const unregistered = literals.filter((l) => !registryValues.has(l.value));

    expect(
      unregistered,
      unregistered.length
        ? `Found ${unregistered.length} code literal(s) not in server/utils/errorCodes.js -- ` +
            "add each one to the ErrorCode registry (with a comment saying where " +
            "it's used) instead of leaving it a bare string literal:\n" +
            unregistered
              .map((l) => `  ${l.file}:${l.line} -> "${l.value}"`)
              .join("\n")
        : "",
    ).toEqual([]);
  });

  it("sanity check: the scan actually finds the codes known to exist today (guards against the regex silently matching nothing)", () => {
    const literals = findCodeLiterals();
    expect(literals.length).toBeGreaterThan(20);
    expect(literals.map((l) => l.value)).toContain("SETUP_TOKEN_REQUIRED");
    expect(literals.map((l) => l.value)).toContain("server_running");
  });

  const localeEnPath = path.join(
    SERVER_DIR,
    "..",
    "client",
    "src",
    "locales",
    "en",
    "errors.json",
  );

  if (fs.existsSync(localeEnPath)) {
    it("every registered ErrorCode has a matching key in client/src/locales/en/errors.json", () => {
      const localeKeys = new Set(
        Object.keys(JSON.parse(fs.readFileSync(localeEnPath, "utf8"))),
      );
      const missing = Object.keys(ErrorCode).filter(
        (name) => !localeKeys.has(name),
      );

      expect(
        missing,
        missing.length
          ? `client/src/locales/en/errors.json is missing an entry for: ${missing.join(", ")}. ` +
              "The locale key is the ErrorCode CONSTANT NAME, not its wire value " +
              "(see server/utils/errorCodes.js for why those two differ for the " +
              "legacy codes)."
          : "",
      ).toEqual([]);
    });
  } else {
    it.skip(
      "every registered ErrorCode has a matching key in client/src/locales/en/errors.json -- " +
        "SKIPPED: client/src/locales/en/errors.json does not exist yet. This test starts " +
        "enforcing automatically the moment that file is created; no change needed here.",
      () => {},
    );
  }
});
