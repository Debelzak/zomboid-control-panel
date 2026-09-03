# FND-001: <Title>

- State: planned | ready | active | review | accepted | blocked | rejected
- Owner:
- Worktree:
- Branch:
- Dependencies:
- Reviewer:

## Contract Preserved

Exact V1 behavior/API/UI contract that must not change.

## New Capability

One bounded capability introduced by this package.

## Owned Paths

- `exact/path/**`

## Explicit Non-Goals

- 

## Hypothesis and Cheapest Falsifier

- Hypothesis:
- Focused test:

## Implementation Steps

1. 

## Required Fault Tests

- 

## Acceptance Gates

- [x] Focused tests — falsifier run, not disproven (`SUMMARY.md`)
- [ ] Domain tests — n/a, FND-001 owns no runtime domain (`SUMMARY.md`)
- [x] V1 parity evidence — `git status --porcelain` clean of tracked entries (`SUMMARY.md`, `VERIFICATION.md`)
- [x] Full required gate — passed (`SUMMARY.md`)
- [x] Independent verification — `VERIFICATION.md` round 2, 2026-08-22: **PASS**
- [ ] Rollback rehearsal — deliberately not performed; running it would delete the evidence under review (`ROLLBACK.md`)

> **Reconciled 2026-09-03 (kevin):** this checklist was left entirely unchecked despite every
> outcome already being on record elsewhere in this package. Boxes above now match what
> `SUMMARY.md`/`VERIFICATION.md` actually say; the two still unchecked are correctly unchecked
> (n/a and deliberately-skipped, not incomplete work).

## Evidence

- `docs/modernization/evidence/FND-001/...`

## Rollback

Exact flags, files, commands, and verification.

## Risks / Decisions

- Risk IDs:
- ADR IDs:
