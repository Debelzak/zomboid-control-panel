---
plan_version: "2.0"
baseline_sha: "8642dc467938a47ca8aac76fc44fc1875446c88b"
current_sha: "bb54acc82794d60214bef5613d4c68bc9eda37a9"
active_work_package: "none - Foundation review gate"
state: "accepted"
owner: "coordinator"
updated_at: "2026-08-27T06:43:10-04:00"
---

# Modernization Status

## Checkpoint

- **Local-only checkpoint commit:** `e966fe94c7d6aca60986c7704a80e576bc1fa9f3` on `main` — still an
  ancestor of current HEAD (verified 2026-08-27 via `git merge-base --is-ancestor`).
- **Authorized by:** the user, explicitly, on 2026-08-22 (CANNOT VERIFY independently — this
  records a conversation, not a repo state — but nothing found contradicts it).
- **Contents:** 55 files, 4484 insertions (re-confirmed 2026-08-27 via `git show --stat
  e966fe9` — unchanged, this is fixed history). Verified at the time to contain no `data/db.json`,
  no `data/backups/`, no `logs/`, no `node_modules`, and no `client/dist`.
- **No V1 source file is modified by this commit.** CANNOT RE-VERIFY as written: the claim compares
  against the `v1-source` remote, which is no longer configured locally (see Blockers) — there is
  currently nothing to diff against.
- **STALE, corrected 2026-08-27:** this section previously claimed "`git remote -v` shows only
  `v1-source`... there is no `origin`." That is no longer true and may never have been true at the
  same time as the rest of this section — see **Blockers** for the current, verified remote state.

Worktree creation is now unblocked (RISK-005 cleared): the handoff files are tracked, so
`create-worktree.ps1` will find them.

## Operator Grant (2026-08-22)

The user widened the working latitude inside this fork: **running the panel, running a PZ server,
and creating a real database in `D:\Projects\Zomboid_Control_Panel_Modernized` are all permitted.**

Unchanged and still binding: `D:\Zomboid_dev_panel\GitHub` and `D:\Projects\Zomboid_dev_panel V2`
are strictly read-only; no push, tag, publish, or remote; no deployment to the existing Tower V1
container (a *new* container is the eventual target, and only with explicit approval).

Note the interaction with DISC-001: the operator being content to have a database in this fork does
**not** dissolve the defect. `bootstrap-plan.ps1` still throws, so the sequence still cannot run
twice — and the operator separately chose the isolation remediation.

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

**This section was wrong by about 4.8x on the server test count** (published `535 passed / 535
across 51 files`; actual, measured below, is 2554 tests collected across 239 files) and had not
been updated since 2026-08-22, five days and roughly 300 commits before this correction. The old
`8f4ec5f2` figures were genuinely accurate *for that commit* (verified 2026-08-27: `8f4ec5f2` really
does contain exactly 51 server test files) — they were simply never refreshed as the suite grew.

- **Git SHA measured:** `bb54acc82794d60214bef5613d4c68bc9eda37a9` (current HEAD)
- **Date measured:** 2026-08-27
- **Server tests:** 2549 passed / 2554 collected across 239 files (3 failing, 2 skipped), exit 1.
  Command: `npm run test:server`. **The 3 failures are not a regression at HEAD** — at measurement
  time `server/routes/chunks.js` and `server/tests/chunksDeletionLogic.test.js` were both
  uncommitted and mid-edit by another agent, whose working diff contains a literal
  `const regionIsB42 = false; // TEMP break-verify`. Re-run after that work lands for a true
  pass/fail split; the file/test *counts* are accurate regardless of who is mid-edit.
- **Client tests:** 2427 passed / 2427 across 106 files, exit 0. Command: `npm run test:client`.
- **Server lint:** `npm run lint:server` exit 0.
- **Client lint:** `npm run lint` (run inside `client/`) exit 0 — 0 errors, 65 warnings; this
  script does not gate on warnings (unlike the ad-hoc `--max-warnings=0` invocation, which does
  fail: use the script as configured, not that flag, to match what CI/the team actually treats as
  green).
- **Typecheck:** `npx tsc -b` (run inside `client/`) exit 0.
- **Build:** `npm run build` exit 0, but now emits a bundle-size advisory: `api-*.js` is ~2.75 MB
  (~824 KB gzip), over the 500 kB warning threshold. This is the first recorded figure for RISK-004
  (previously logged as "unmeasured") — see Open Risks.
- **git diff --check:** exit 0.
- **Re-run all of the above:** `npm run test:server` · `npm run test:client` · `npm run lint:server`
  · (in `client/`) `npm run lint` · `npx tsc -b` · (from repo root) `npm run build` ·
  `git diff --check`.
- **Evidence links:** `evidence/FND-001/RESULTS.json`, `evidence/FND-007/SUMMARY.md` — both describe
  the suite as it stood on 2026-08-22 (51 server test files), not the current one.

## Reserved Paths

| Work package | Owner | Paths | State |
| --- | --- | --- | --- |
| _none_ | — | All FND-001 and FND-005 reservations released on acceptance | — |

The verifier holds `VERIFICATION.md` exclusively. The coordinator implemented FND-001 and must not
author its sign-off.

## Blockers

**BLOCKER — local-only-fork remote invariant is violated in both directions, corrected 2026-08-27.**
`bootstrap-plan.ps1` (`scripts/modernization/bootstrap-plan.ps1:51-53`) requires exactly the
read-only remote `v1-source` to exist and `origin` to be absent. Verified 2026-08-27 via
`git remote -v` and by actually running the script: **`v1-source` is not configured at all**, and
**`origin` is configured** (fetch + push, `https://github.com/fpsacha/zomboid-control-panel.git`).
The script throws on the *first* check it runs — `Required remote 'v1-source' is missing.` — so
even removing `origin` alone would not clear this; `v1-source` would also need to be re-added.
Removing/adding remotes requires explicit user approval; no remote action has been taken here.

**CANNOT VERIFY, flagging rather than guessing:** the repo's actual history since 2026-08-22 (this
document's own commit log shows releases through at least `Release v1.2.4`, on `main`, and this
session's own hive record notes an operator-authorized push to `origin/main`) reads as inconsistent
with a still-binding "local-only fork, never push, no `origin`" invariant. Either that invariant has
been superseded by later operator direction not recorded anywhere in `docs/modernization/`, or the
repo has been in a state this document would call a blocker for at least several days without
anyone treating it as one. This is an architecture/intent question, not a counting one — routing
rather than ruling on it.

There are no package dependency blockers after FND-001 and FND-005 acceptance. FND-002, FND-003,
and DB-001 remain `ready` per `WORK_PACKAGES.md` (last touched 2026-08-22) but have not been picked
up; nothing found in this repo shows the Foundation review gate being exercised since.

## New This Session

**2026-08-27 audit (operator-directed, full document):** the published test counts were wrong by
~4.8x on the server figure alone. Re-measured every gate command fresh against current HEAD (see
Last Green Full Gate) and checked every other factual claim in this document against the live repo
rather than trusting inherited text. Corrected: `current_sha` (the previous value, itself only 2
days old, was already 306 commits behind HEAD per `bootstrap-plan.ps1`'s own staleness check), the
Checkpoint section's remote claim (verified false — see Blockers for the real state), the Blockers
section (rewritten around the actual failing check, not an assumed one), RISK-004 (bundle size was
"unmeasured" — now has a first real figure), and the two commands under Next Exact Action, which
were silently corrupted (missing the literal characters `\b` and `\v`, so they read
`.\scripts\modernizationootstrap-plan.ps1` / `...alidate-handoff.ps1` and would not run) — a live,
previously-unnoticed instance of exactly the defect `RISK-011` already documents. Full claim-by-claim
verdict list (TRUE / STALE / CANNOT VERIFY) delivered to the coordinator alongside this edit;
not duplicated here to keep this section short-lived per its own "keep only latest" convention below.

**2026-08-25 (uncommitted at the time, now folded into this update):** `current_sha` had been
refreshed to `5d1082cf...` (`Release v1.2.4`); `Zomboid_Control_Panel_Modernized.code-workspace` was
added locally — it is now **gitignored** (`.gitignore:39`, confirmed 2026-08-27), not merely
untracked, so it will not reappear as a pending file; FND-006 and FND-007 were noted as having
independent `PASS` verification evidence while remaining in `review`, with acceptance not assumed.

FND-007's static `discordBot.js` import fix addresses RISK-001 (confirmed 2026-08-27: the static
`import { DiscordBot } from "../services/discordBot.js"` now sits at `bugfixes.test.js:10`, ahead of
every dynamic `import()` call site, so those resolve from the module cache instead of paying the
cold-transform cost). RISK-007 is resolved by FND-006 (confirmed 2026-08-27 directly against
`check-owned-paths.ps1`: it now splits on commas and throws on an allow-list that yields nothing
usable). DISC-002b is correctly withdrawn. RISK-011 remains open for Windows-generated CRLF /
escape-sequence corruption in Markdown edits — see this section's own opening paragraph for a fresh
example of exactly that risk materializing.

## Independent Verification

Point-in-time verification records from 2026-08-22, when the server suite was 51 files / 535 tests
(see Last Green Full Gate for the current count — the "535/535" figures below are historical
verification evidence, correctly describing that day, not a current claim):

- **FND-001: PASS** after the FND-005 remediation was independently verified.
- **FND-005: PASS**; two consecutive server gates remained 535/535 and test data stayed isolated.
- **FND-006: PASS**; comma-bound allow-lists are accepted, empty input is rejected, and genuine
  unowned files remain failures. Re-confirmed directly against the script 2026-08-27 (still true).
- **FND-007: PASS**; the affected Discord test dropped from 1488 ms to 1 ms and the full suite
  remained 535/535 (that day). Re-confirmed 2026-08-27 that the static import fix is still in place.

## Next Exact Action

1. Get a decision on the remote-invariant question raised in Blockers: restore it (remove `origin`
   *and* re-add `v1-source`), or record that the local-only-fork invariant is intentionally waived
   now that the project pushes real releases to `origin/main`.
2. Complete coordinator review of FND-006 and FND-007 without changing their `review` state by
   assumption.
3. After the Foundation review gate, select one ready package: FND-002, FND-003, or DB-001. Do
   not start dependent work in the same turn as package acceptance.

```powershell
# Verify current state at any time. Safe to re-run; FND-005 made this repeatable.
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\modernization\bootstrap-plan.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\modernization\validate-handoff.ps1
```

## Recent Accepted Packages

Keep only the latest three here. Move older entries to `STATUS_ARCHIVE.md`.

| Package | SHA | Accepted at | Evidence |
| --- | --- | --- | --- |
| FND-001 | `e966fe9` (+ evidence uncommitted at accept time) | 2026-08-22 | `evidence/FND-001/` |
| FND-005 | `2ae02c4` | 2026-08-22 | `evidence/FND-005/` |

Both accepted by the coordinator **after** independent verification returned PASS, which is the
only order the plan permits. FND-001's first verification returned FAIL; it was fixed, re-verified,
and only then accepted.

## Accepted Decisions

None. FND-001 recorded state rather than deciding architecture; it produced no ADR. The first
decision records belong to `DB-001` (`ADR-DB-001`, data model) and `AUT-001` (`ADR-AUTH-001`,
identity).

## Open Risks

RISK-002 high (`db.example.json` stale against `defaultData`), RISK-003 high (perf baseline covers
one route), RISK-004 medium (bundle size — **first figure recorded 2026-08-27**: `npm run build`
emits a >500 kB advisory on `api-*.js`, ~2.75 MB / ~824 KB gzip; `RISK_REGISTER.md` still says
"no byte figure has been recorded" and needs the same update, out of scope for this document), and
RISK-011 medium (Windows-generated CRLF / escape-sequence corruption in Markdown edits — see New
This Session for a fresh, previously-unnoticed instance of exactly this in this file's own Next
Exact Action commands). See `RISK_REGISTER.md` for resolved and accepted risks.
