---
plan_version: "2.0"
baseline_sha: "8642dc467938a47ca8aac76fc44fc1875446c88b"
current_sha: "8642dc467938a47ca8aac76fc44fc1875446c88b"
active_work_package: "FND-001"
state: "blocked"
owner: "coordinator"
updated_at: "2026-08-22T13:10:00.0000000Z"
---

# Modernization Status

## Current Package

- **Contract:** FND-001 establishes program ledgers, baseline runtime facts, the API/DB inventory
  starting point, a performance baseline, and the evidence structure. It must not modify
  production behavior — and did not.
- **Dependencies:** none. FND-001 is the dependency-graph root.
- **Owned paths:** `docs/modernization/{README,STATUS,STATUS_ARCHIVE,WORK_PACKAGES,DECISIONS,RISK_REGISTER,BASELINE,ROLLBACK}.md`,
  `docs/modernization/evidence/FND-001/**`, `scripts/modernization/**`
- **Cheapest falsifier:** `npm ci` in both trees, then
  `git diff --exit-code -- package-lock.json client/package-lock.json`. Exit 0 — lockfiles
  byte-identical, so the baseline is reproducible. Hypothesis not disproven.
- **Rollback:** delete the 18 authored files (`evidence/FND-001/` plus the 8 ledgers). No git
  operation; nothing was staged or committed. Success signal: `bootstrap-plan.ps1` flips from
  `mode=resume` back to `mode=baseline`. See `evidence/FND-001/ROLLBACK.md`.

## Last Green Full Gate

- **Git SHA:** `8642dc467938a47ca8aac76fc44fc1875446c88b` (working tree; no commit created)
- **Date:** 2026-08-22
- **Server tests:** 535 passed / 535, exit 0 — **on the second run.** The first, cold run was
  534/535 exit 1. Both are recorded; see RISK-001.
- **Client tests:** 90 passed / 90 across 14 files, exit 0
- **Typecheck/build/lint/diff:** `tsc -b` exit 0 no diagnostics; `npm run build` exit 0;
  `lint:server --max-warnings=0` exit 0; `git diff --check` exit 0
- **Evidence link:** `evidence/FND-001/RESULTS.json`, `evidence/FND-001/PERF.json`

## Reserved Paths

| Work package | Owner | Paths | State |
| --- | --- | --- | --- |
| FND-001 | coordinator | `docs/modernization/*.md` (8 ledgers), `docs/modernization/evidence/FND-001/**`, `scripts/modernization/**` | review |
| FND-001 | independent verifier | `docs/modernization/evidence/FND-001/VERIFICATION.md` **only** | in progress |

The verifier holds `VERIFICATION.md` exclusively. The coordinator implemented FND-001 and must not
author its sign-off.

## Blockers

**BLOCKER 1 — DISC-001 / RISK-006. Needs a user decision. This is what blocks acceptance.**

The plan's mandatory baseline gate breaks the plan's mandatory preflight.
`server/database/init.js:43-50` is a bare top-level `for` loop of `fs.mkdirSync`, so **importing**
the module creates `data/` and `data/backups/` and writes a default `data/db.json` whenever no
`paths.config.json` override is present. The FND-001 sequence wraps only the perf step in that
override. `bootstrap-plan.ps1` then throws, so **the documented sequence cannot be run twice.**

Found independently twice — coordinator and verifier. Independent verification returned **FAIL** on
this, correctly. Four options and a recommendation are in `DECISIONS.md`; option 1 was withdrawn
because `init.js:42` records that `db.json` holds an RCON password and JWT secret.

The generated artifacts have been removed and the preflight is green again, but **the defect is
not fixed** — the clean fix edits test infrastructure FND-001 does not own.

**BLOCKER 2 — RISK-005, expected, no decision needed yet.** Worktree creation is prohibited until
a user-authorized local checkpoint commit exists (`WORKTREE_LIFECYCLE.md`). FND-002, FND-003, and
DB-001 cannot start in parallel until then. This is the plan's own sequencing.

Awaiting: (1) user decision on DISC-001, (2) user authorization for the checkpoint commit.

## Independent Verification

Completed by a different agent, read-only, owning `VERIFICATION.md` exclusively.
**Verdict: FAIL**, on Blocker 1.

Independently re-confirmed: baseline SHA/tag/remote identity, zero tracked source changes,
`validate-handoff.ps1` / `validate-evidence.mjs` / `check-owned-paths.ps1` all exit 0, no secrets in
the evidence directory, and every inventory count recounted from source and matching exactly —
21 route files, 21 router mounts, 404 handlers, 51 socket events, 19 collections.

Could not reproduce RISK-001 (both of the verifier's `test:server` runs passed 535/535). Recorded
as informational, not refuted — the verifier's environment was not a cold checkout, which is the
condition under which it was observed.

Two coordinator errors found and both corrected: `RESULTS.json.known_risks` omitted RISK-005, and
`SUMMARY.md` did not disclose DISC-001 at all.

## Next Exact Action

**Stop and wait for the user on two questions. Do not start FND-002, FND-003, or DB-001.**

1. **DISC-001:** which remediation? Recommended option 2 — isolate the data root for any command
   that imports `server/database/init.js`, as a small package before FND-002.
2. **Checkpoint commit:** authorize a local-only commit? Required before any worktree exists.

Only after both are answered:

```powershell
# Never run without explicit user approval. Never push. There is no 'origin' by design.
git add AGENTS.md V2_MODERNIZATION_PLAN.md docs/ scripts/modernization/
git commit -m "modernization: handoff toolkit and FND-001 baseline"

# Then re-run both validators and record the checkpoint SHA here.
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\modernization\bootstrap-plan.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\modernization\validate-handoff.ps1
```

**Before any future gate run:** expect `data/db.json` and `data/backups/` to reappear and the
preflight to throw. See `README.md` for the two-line cleanup. Never delete a `data/db.json` holding
real records.

## Recent Accepted Packages

Keep only the latest three here. Move older entries to `STATUS_ARCHIVE.md`.

| Package | SHA | Accepted at | Evidence |
| --- | --- | --- | --- |
| _none yet_ | — | — | — |

FND-001 is in `review`, not `accepted`. Only the coordinator marks acceptance, and only after
independent verification.

## Accepted Decisions

None. FND-001 recorded state rather than deciding architecture; it produced no ADR. The first
decision records belong to `DB-001` (`ADR-DB-001`, data model) and `AUT-001` (`ADR-AUTH-001`,
identity).

## Open Risks

RISK-001 high (cold-run test failure — baseline green but not deterministic), RISK-002 high
(`db.example.json` stale against `defaultData`), RISK-003 high (perf baseline covers one route),
RISK-004 medium (bundle size unmeasured), RISK-005 medium (worktrees blocked pending checkpoint).
See `RISK_REGISTER.md`.
