# Functional capabilities required for the next iteration

Owned by the CICD agent. Lists only what the *next* slice (Chunk 1 — playable
board) needs — nothing ahead of need.

- **Language / runtime:** Python 3 (>= 3.10), standard library only. No build
  step, no third-party runtime dependencies. CI pins the minimum version.
- **Environments:** prod-only. This is a local CLI; "prod" is the user's terminal.
  No test/staging infrastructure needed. A CI runner is the only non-user env.
- **Test approach:**
  - *Unit* (primary): pure modules — Board/Rules, Input Parser, Renderer — tested
    directly with `unittest` (stdlib) or `pytest` if the engineer prefers. Cover
    win/draw detection, coordinate validation (valid + each rejection reason),
    and 80-column render alignment.
  - *Acceptance*: drive `play_game()` with a scripted sequence of stdin lines and
    assert the announced result and re-prompt-on-invalid behaviour (per
    `architecture/deltas/001-initial.md` acceptance conditions).
  - *Security-policy*: assert the checkable statements in
    `architecture/security/cli-process.md` (e.g. no `subprocess`/`eval` imports in
    runtime path, no file writes, malformed/over-long input rejected).
- **How to run locally:** `python -m ox` (or `python ox.py`). One command, no
  install. Tests: `python -m unittest` (or `pytest`).
- **Continuous deployment:** CI runs lint + unit + acceptance + security-policy
  tests on push; green gates the merge. "Deploy" = merge to main (the runnable
  source is the artifact). Optionally tag a release.
- **Rollback approach:** revert the source commit / re-tag the prior release.
  Because there is no persistent state, infra, or migration, rollback is a pure
  source revert with no data considerations.
- **Rollback assets to maintain:** none beyond version-control history.
```
