# Principle failure — route.md commit swept pre-staged concurrent-agent changes

**Date:** 2026-06-06
**Agent:** engineer
**Slice:** s005-h1-waf (iteration 7)
**Principle:** Trunk-based — keep each change sequentially independent and small;
WIP isolation across parallel agents (§37/§40). A commit's intent should match
its content.

## What happened

The task was to author and commit `route.md` ONLY, while cicd ran concurrently
on `workflows/` and `capabilities`. At task start the working tree already had
several files **staged in the index** (modified `.github/workflows/infra-oxo-online.yml`,
`work/oxo-online/capabilities.md`, `.claude/settings.json`, `STACK_ORDER.md`,
`open-items.md`, `ledger.csv`) — cicd's in-flight work plus prior-slice edits.

I ran `git add work/.../route.md` (one path) then `git commit` WITHOUT
`--only`/pathspec. `git commit` commits the ENTIRE staged index, so the commit
captured all 7 already-staged files, not just route.md. cicd's concurrent
changes were absorbed into the route-authoring commit.

## Impact

Low/none functionally: all swept content was legitimate, already-staged work; the
tree ended clean, nothing was lost. The harm is process-level: the commit's
content does not match its stated intent, and another agent's WIP boundary was
crossed by my commit rather than landed by cicd itself.

## Root cause

`git commit` defaults to the full index. When the index already contains another
agent's staged changes, a bare `git commit` is NOT scoped to my path even if I
only `git add`ed my file.

## Corrective action

When committing a single owned file in a repo where other agents may have staged
WIP, commit by explicit pathspec: `git commit <path> -m ...` (commits ONLY that
path's staged+unstaged changes, leaving the rest of the index intact), or verify
`git diff --cached --name-only` is exactly the intended set BEFORE committing.

## Roll-forward decision

Not rewriting `main` history to split the commit — the content is all valid and a
force-push on a shared trunk with concurrent agents is riskier than the coupling.
Recorded and rolling forward.
