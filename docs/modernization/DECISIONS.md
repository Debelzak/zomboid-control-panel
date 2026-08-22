# Modernization Decisions

ADR IDs are `ADR-<WP-ID>-<NN>`. This file reserves and indexes them; full records live at the
listed path.

| ID | Title | Status | Work package | Date | Path |
| --- | --- | --- | --- | --- | --- |
| _none_ | — | — | — | — | — |

FND-001 produced **no ADR**. It recorded state rather than deciding architecture. The first
decision records belong to `DB-001` (`ADR-DB-001`, data model) and `AUT-001` (`ADR-AUTH-001`,
identity).

---

## Plan Discrepancies

The plan states: *"If an agent discovers that the plan is wrong, it must record the discrepancy in
a decision record and stop at the current work-package boundary. It must not silently reinterpret
the architecture."* This section is that record. These are **not** ADRs — they are defects found
in the program's own tooling, raised for the user's decision.

### DISC-001 — the mandatory baseline gate violates the mandatory preflight

**Severity: high. Blocks nobody today; will confuse everybody tomorrow.**

`scripts/modernization/bootstrap-plan.ps1` asserts `runtime-db-absent` and throws
`data/db.json must not exist in the modernization fork baseline.` (line 72) when the file is
present. The plan reinforces this as a product invariant: *"Never copy, overwrite, delete, or
deploy a runtime `data/db.json`."*

**But the plan's own required baseline gate creates that file.**

**Root cause, located by the independent verifier and confirmed by the coordinator:**
`server/database/init.js` resolves `getDataPaths()` at line 37 and then, at **lines 43-50, runs a
bare top-level `for` loop calling `fs.mkdirSync`** for `dataDir` and `backupDir`. This is a
**module-load-time side effect**: merely *importing* the module creates `data/` and
`data/backups/`, before any function is called, whenever no `paths.config.json` override is
present. The FND-001 clean-room sequence wraps only the perf-measurement server start in that
override — it does not wrap `npm run test:server`.

The coordinator's initial reading ("the test suite boots the database") named the *trigger*; the
verifier's names the *cause*, and the difference matters, because any future command that imports
this module inherits the behavior — not only the test suite.

**This raises the stakes rather than lowering them.** The comment at `init.js:42` states these
directories hold `db.json` containing an *RCON password and JWT secret*. The guard is protecting a
genuinely sensitive file, which is why it must not be weakened.

Observed during FND-001:

| Artifact | Created |
| --- | --- |
| `data/db.json` | 2026-08-22T13:00:08Z |
| `data/backups/db-2026-08-22T12-59-20-264Z-startup.json` | during cold `test:server` |
| `data/backups/db-2026-08-22T12-59-22-508Z-startup.json` | during cold `test:server` |
| `data/backups/db-2026-08-22T12-59-51-830Z-startup.json` | during isolated `bugfixes.test.js` |
| `data/backups/db-2026-08-22T13-00-07-193Z-startup.json` | during warm `test:server` |
| `data/backups/db-2026-08-22T13-00-08-563Z-startup.json` | during warm `test:server` |
| `logs/combined.log`, `logs/error.log` | during `test:server` |

Five startup backups for five server boots across three test invocations. All six JSON files share
SHA-256 prefix `8532BB2E3FFA75E8` — every one is the identical empty default database, so no data
accumulated and nothing of value was at risk.

**Consequence: the documented FND-001 clean-room sequence cannot be run twice.** Its final step
re-runs `bootstrap-plan.ps1`, which now throws on an artifact the sequence itself produced. This
was hit for real during FND-001 and is reproducible.

**Ruled out as the cause:** the performance procedure. Its temporary `paths.config.json` correctly
redirected data and log roots to `%TEMP%`, and no artifact carries a 13:02 timestamp. The perf step
is clean; the test gate is not.

**Not a secret-exposure finding.** `data/db.json` contained only empty collections and
`_schemaVersion: 1`. A scan of `logs/combined.log` for `password|token|secret|cookie|authorization|bearer`
returned 12 hits, **all of them the word alone in event notices** ("Password reset for user: admin",
"cannot complete an interactive password prompt") with no values. V1's logging redacts correctly —
a positive result worth recording, since it is a precondition the later auth packages depend on.

**Handling in FND-001:** the generated files were removed and `bootstrap-plan.ps1` returned to
`RESULT=PASS` / `runtime-db-absent`. Removal was safe and is not a data-loss event: the files were
untracked, gitignored (`.gitignore:9` and `:29`), machine-generated minutes earlier, byte-identical
empty seeds, and this fork has never held a real database.

**Options for the user — this is a decision, not a cleanup:**

1. ~~**Teach the preflight the difference**~~ between a *runtime* `data/db.json` and a
   *test-generated* empty one. **Withdrawn.** `init.js:42` records that this file holds an RCON
   password and JWT secret, so the guard protects real secret material. Making it lenient weakens
   the one check standing between a test run and a user's live database, in exchange for saving two
   lines of cleanup.
2. **Isolate the test suite's data root** so it never writes into the repository, mirroring what the
   perf step already does correctly with `paths.config.json`. Cleanest, but edits test
   infrastructure, which FND-001's contract forbids and which therefore needs its own package.
3. **Document a mandatory cleanup step** after the gate. Zero code change, but relies on every
   future agent remembering — and the failure mode is a confusing throw, not a silent one.
4. **Accept and leave as-is**, with the behavior recorded here so nobody loses time to it.

**Recommendation: option 2, as a small package before FND-002.** The perf step already proves the
override mechanism works, so the pattern is established rather than invented. Because the cause is
a module-load-time side effect, the isolation must wrap *any* command that imports
`server/database/init.js`, not the test script alone.

**Status: open, awaiting user decision.** No option has been implemented; only the generated
artifacts were removed. Cross-referenced as RISK-006.

**Discovery record.** Found independently twice: by the coordinator when a post-ledger re-run of
`bootstrap-plan.ps1` threw, and by the independent verifier before reading the coordinator's
evidence. The verifier's `VERIFICATION.md` returned **FAIL** on this finding, which is the correct
verdict — FND-001 cannot be accepted while its own precondition fails. The verifier also traced
the cause to the exact lines. Two independent discoveries of the same defect, from different
starting points, is the reason this is recorded as a plan defect rather than a local mishap.
