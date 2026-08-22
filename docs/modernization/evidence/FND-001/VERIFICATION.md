# Independent Verification: FND-001

- Verifier: Kevin (independent hive agent, kevin-mt4dpz5y)
- Verification date: 2026-08-22
- Candidate branch/worktree: `main` working tree at `D:\Projects\Zomboid_Control_Panel_Modernized` (no worktree; coordinator's own tree, no local checkpoint commit exists)
- Candidate SHA/diff hash: baseline `8642dc467938a47ca8aac76fc44fc1875446c88b` (`v1.1.55`); no candidate commit exists (uncommitted, as expected pre-checkpoint)
- Independence statement: I did not implement this work package. I did not read SUMMARY.md's conclusions before re-executing the checks; where I read SUMMARY.md/RESULTS.json it was to extract claims to test, and every claim below was re-derived from the repository or a re-run command, not accepted on the coordinator's word.

## Contract Review

- Preserved V1 behavior: no tracked file under `server/`, `client/`, `data/`, or elsewhere was created, modified, or deleted. Confirmed directly (see command table).
- New behavior: documentation/evidence/tooling only, under the declared owned paths. No functional/source code was added.
- Diff scope matches ownership: yes, for **tracked** paths (`check-owned-paths.ps1` PASS, `changed=55`, all untracked, all under `docs/modernization/` or `scripts/modernization/`). **However**, the contract's own precondition that `data/db.json` stays absent is **violated** — see Findings. That precondition is not a "diff scope" item (the file is gitignored, not tracked) but it is an explicit, named requirement in both `AGENTS.md` ("Never copy, overwrite, delete, or deploy a runtime `data/db.json`") and this package's own preflight script.

## Re-executed Commands

| Command | Exit | Result/evidence |
| --- | ---: | --- |
| `git rev-parse HEAD` | 0 | `8642dc467938a47ca8aac76fc44fc1875446c88b` — matches claimed baseline exactly |
| `git describe --exact-match --tags HEAD` | 0 | `v1.1.55` — matches claimed tag exactly |
| `git remote -v` | 0 | Only `v1-source` (fetch+push to `D:\Zomboid_dev_panel\GitHub`); no `origin` |
| `git status --porcelain` | 0 | 4 untracked top-level entries (`AGENTS.md`, `V2_MODERNIZATION_PLAN.md`, `docs/`, `scripts/modernization/`); zero tracked modifications; none under `server/`, `client/`, or the tracked part of `data/` |
| `ls data/` (targeted, not recursive) | n/a | **`data/db.json` and `data/backups/*.json` exist**, gitignored, `db.json` birth time `2026-08-22 09:00:08 -0400` — inside the FND-001 work window and before I ran anything |
| `git check-ignore -v data/db.json data/backups/` | 0 | Confirmed matched by `.gitignore:9` / `.gitignore:10` — gitignored, not tracked, but still a precondition violation per contract |
| `pwsh ... bootstrap-plan.ps1` (re-run by me, direct exit code, not piped) | **1** | `PASS git-worktree / PASS status-current-sha / PASS mode=resume / PASS remotes=v1-source-only / INFO git-status-entries=4` then **`Exception ... throw 'data/db.json must not exist in the modernization fork baseline.'`** — the package's own gate now fails |
| `pwsh ... validate-handoff.ps1` (direct exit code) | 0 | `PASS required-files=37 / PASS json-schemas-parse / PASS headings=25 / PASS work-packages=30 / PASS critical-dag-edges / PASS durable-data-path-rule / PASS git-diff-check / RESULT=PASS` |
| `node validate-evidence.mjs --results RESULTS.json --perf PERF.json` | 0 | `PASS results=... / PASS perf=...` |
| `pwsh ... check-owned-paths.ps1 -Id FND-001 -AllowedPath docs/modernization/,scripts/modernization/` | 0 | `PASS work-package=FND-001 changed=55` |
| `npm run test:server` (my run 1) | 0 | 535/535 passed, 51/51 files, Duration 5.26s (import 32.12s). No timeout failure. **Side effect observed:** `data/backups/` gained new `*-startup.json` snapshots and `data/db.json` mtime advanced — confirms the test run itself (not just the perf-measurement server start) touches `data/db.json` |
| `npm run test:server` (my run 2) | 0 | 535/535 passed, 51/51 files, Duration 5.18s (import 31.94s). No timeout failure |
| Recount: `git ls-files server/routes/ \| grep -c '\.js$'` | 0 | 21 — matches claimed route-file count |
| Recount: router mounts `app.use("/api/...", xRoutes)` in `server/index.js` (lines 1083-1108) | 0 | 21 — matches claimed router-mount count |
| Recount: `grep -rhoE "^router\.(get\|post\|put\|delete\|patch)\(" server/routes/*.js \| wc -l` | 0 | 404 — matches claimed route-handler count |
| Recount: distinct `.emit('...')` event names across `server/` | 0 | 51 — matches claimed socket-event count |
| Recount: keys in `defaultData` in `server/database/init.js` (lines 57-77), excluding `_schemaVersion` | 0 | 19 (18 array collections + `settings`) — matches claimed collection count |
| `grep -rniE "password\|secret\|token\|cookie\|...` over `docs/modernization/evidence/FND-001/` and program ledgers | 0 | No secret material found; only prose statements *about* redaction (e.g. "no token... appeared") |

## Failure-Path Review

- [x] malformed input — n/a, FND-001 owns no runtime domain; no code path to test
- [x] unavailable dependency/connector — n/a, same reason
- [x] timeout/interruption — the RISK-001 cold/warm claim is the closest analog. I ran the suite twice myself; both runs passed 535/535 with no timeout. My environment was already warm (node_modules and Vitest transform caches populated by the coordinator's own earlier `npm ci` and test runs in this same session), so this is **not a fresh-checkout cold run** and my result neither confirms nor refutes RISK-001 — it is inconclusive on my machine. A truly cold reproduction would require a fresh clone or cleared Vitest/OS caches, which I did not attempt (out of scope for a read-only spot check and would itself risk mutating state).
- [x] duplicate/concurrent request — n/a
- [ ] rollback/fallback — not exercised (rehearsal correctly not performed per `ROLLBACK.md`, since running it would delete evidence under review; I did not exercise it either, for the same reason)
- [x] secret redaction — checked, none found (see command table)

## Findings

Ordered by severity.

1. **[HIGH — blocking] `data/db.json` exists and was created during FND-001's own work window, violating an explicit, named precondition, and the package's own preflight gate now fails because of it.**
   `data/db.json` (`docs/modernization/evidence/FND-001/` is not the location — the file itself is at repo root `data/db.json`) has birth time `2026-08-22 09:00:08 -0400`, inside the FND-001 session window (`RESULTS.json` records `started_at`/`finished_at` as `12:56:00Z`–`13:05:00Z`, i.e. `08:56`–`09:05` local) and **before I ran any command**. `data/backups/` contained five `*-startup.json` snapshots from the same window. This directly contradicts:
   - `AGENTS.md` line 26: "Never copy, overwrite, delete, or deploy a runtime `data/db.json`."
   - The verification task's own instruction: "NEVER create or touch `data/db.json`. Its absence is an asserted precondition — verify it stays absent."
   - `scripts/modernization/bootstrap-plan.ps1` line 72, which I re-ran directly (not piped) and got **exit code 1** with `throw 'data/db.json must not exist in the modernization fork baseline.'` — this is not my interpretation, it is the project's own gate script failing right now.

   **Root cause, independently reproduced (not merely inferred):** `server/database/init.js` creates `dataDir`/`backupDir` and writes a default `db.json` as a **module-load-time side effect** (lines 38-44 resolve `paths.dataDir`/`paths.dbPath` and `mkdir` them immediately; the JSONFile adapter/init logic writes a default file shortly after when none exists). The FND-001 clean-room sequence only redirects this path via a temporary `paths.config.json` around the **performance-measurement** server start — it does **not** wrap `npm run test:server`, `npm run lint:server`, or any other gate command. I confirmed this by running `npm run test:server` myself, twice, with no `paths.config.json` present: both runs (re-)created `data/backups/*-startup.json` snapshots and advanced `data/db.json`'s mtime. This means **the FND-001 gate sequence, exactly as written in `V2_MODERNIZATION_PLAN.md`, cannot currently satisfy its own "db.json stays absent" precondition** — it isn't a one-off mistake by the coordinator, it's a reproducible property of running the mandated commands against this codebase's default data-path resolution.

   This was not disclosed anywhere: not in `SUMMARY.md`'s Security/Secrets section, not in `RESULTS.json`'s `known_risks`, and not in any of the five entries in `RISK_REGISTER.md` (RISK-001 through RISK-005), even though RISK-001 through RISK-005 cover other, less central issues in detail. The central claim under most scrutiny ("no production change... `data/db.json` stays absent") is the one claim that does not hold at verification time.

   Per the task's explicit standing instruction — "If my evidence and the repository disagree, THE REPOSITORY WINS AND I WANT TO KNOW" — the repository disagrees.

2. **[LOW — informational] `RESULTS.json`'s `known_risks` array is incomplete relative to `RISK_REGISTER.md` and `SUMMARY.md`.**
   `RISK_REGISTER.md` and `SUMMARY.md` both list RISK-001 through RISK-005 (RISK-005: worktrees blocked pending checkpoint). `RESULTS.json` (`docs/modernization/evidence/FND-001/RESULTS.json`, `known_risks` array, lines 149-154) lists only RISK-001 through RISK-004 — RISK-005 is missing from the machine-readable evidence file. `validate-evidence.mjs` does not check risk-list completeness against the register, so this passed schema validation without being caught. Does not affect the verdict on its own; noted for the coordinator to fix when this package returns.

3. **[INFORMATIONAL] RISK-001 cold/warm cold-start claim is unconfirmed by me, not refuted.**
   Two re-runs of `npm run test:server` in this already-warm environment both passed 535/535 with no timeout. This is expected — my environment was not a fresh checkout, so it cannot exercise the same "cold" condition the coordinator described (import cost 86.13s vs. my 32.12s/31.94s). I neither confirm nor refute RISK-001; a conclusive answer needs a genuinely fresh clone or cache-cleared run, which I did not perform to stay read-only and avoid further mutating repository/cache state mid-verification.

## Verdict

FAIL

Reason: The central, most heavily emphasized claim of this package — "no production change; `data/db.json` stays absent" — does not hold. `data/db.json` exists in the working tree, was created during the coordinator's own FND-001 session (before my verification began), and the package's own preflight script (`bootstrap-plan.ps1`), re-run by me directly with its exit code captured (not piped), fails right now with exit code 1 specifically because of this file. I further reproduced the root cause myself: running the plan's own mandated `npm run test:server` gate, with no `paths.config.json` override in place, recreates/touches `data/db.json` and `data/backups/*-startup.json` as a side effect of importing `server/database/init.js`. This is not disclosed in `SUMMARY.md`, `RESULTS.json`'s `known_risks`, or any of the five entries in `RISK_REGISTER.md`.

Every other claim I independently re-checked held up exactly as stated: baseline SHA/tag/remote identity, zero tracked source modifications, `validate-handoff.ps1` (exit 0), `validate-evidence.mjs` (exit 0), `check-owned-paths.ps1` (exit 0, changed=55), all five recounted figures (21 route files, 21 router mounts, 404 route handlers, 51 socket events, 19 `defaultData` collections), and the absence of secret material in the evidence directory. This package is close to correct and the fix is narrow (either wrap every FND-001 gate command in the same `paths.config.json`/temp-root isolation already used for the perf step, or explicitly accept and disclose that `data/db.json` cannot stay absent under the current test harness and downgrade the precondition). But as written and as currently reproducible in the repository, the precondition is violated, the package's own gate fails, and per this task's standing instruction the repository's disagreement with the evidence controls the verdict.
