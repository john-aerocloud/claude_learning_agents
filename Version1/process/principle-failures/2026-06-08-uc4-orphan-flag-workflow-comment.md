# §40 Principle Failure: Factored-out flags lingered in workflow comment

**Date:** 2026-06-08
**Slice:** s006 (factored out), discovered s014
**Agent:** cicd
**Ref:** UC4-ORPHAN

## What happened

Four feature flags were factored out of the SPA code across s006 and s009:

- s006: move-relay flag (server-authoritative relay switch)
- s009: name-entry, leaderboard, and two-copy-controls flags

The SPA code correctly removed all four. The deploy workflow's config.js writer
step was also correctly updated to write only `wsUrl`. However, an inline shell
comment within the `run:` block of the config-injection step named all four
factored-out flags as documentation of the removal history.

The ws-contract test 5 asserts `workflow.not.toContain('uc4Enabled')` using a
full-file string search. The comment containing `uc4Enabled` caused test 5 to
fail on every clean tree since s006 — a standing 145/146 failure independent of
any in-flight work.

## §40 lifecycle requirement

§40 requires: factor out of code AND config. The config was correct (flag not
written), but the comment in the config writer step re-introduced the flag name
into the workflow file, triggering the contract test's negative assertion.

## Fix

Rewrote the comment to describe the factoring-out without naming individual
flags. The comment now reads:

> s006 removed the move-relay flag; s009 removed the remaining three
> name/leaderboard/two-copy flags. All are now unconditional SPA behaviour;
> no flag entry belongs here.

## Lesson

Contract tests that assert flag-name absence via full-file string search will
catch flag names in comments as well as in live code/config. When factoring out
a flag: remove or reword any comment that names it in the file the contract test
scans. The §40 lifecycle must include comment cleanup in the files under test.
