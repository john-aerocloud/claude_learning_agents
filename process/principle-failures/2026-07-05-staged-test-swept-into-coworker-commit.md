# Principle failure — engineer's staged file swept into a co-worker's commit (shared index)

**Date:** 2026-07-05
**Agent:** engineer (OagEventSource, SLC-014 UC-SF2)
**Principle:** Parallelism §"isolate your commit with an explicit pathspec — never
`git add` then a bare commit (a shared index sweeps a co-worker's pre-staged files
into your commit; logged 3×)."

## What happened
Building UC-SF2 I created one new test file
(`src/fids-app/tests/active-filter.scheduled.test.ts`). I `git add`-ed it, then my
FIRST `git commit` failed because I put the `-m <message>` AFTER the `--` pathspec
separator, so git parsed the message text as a pathspec and aborted — leaving my file
STAGED in the shared working-tree index. Before I re-ran the commit with the correct
arg order, a concurrent process (the tester, committing UC-BF4 e2e spec work in the
SAME working tree) ran its own `git add`/bare commit. That bare commit swept my
already-staged test file into commit `389d86f` ("tester: add UC-BF4 spec …"). My file
landed on trunk with correct CONTENT (verified byte-identical) but under the WRONG
commit + message + author, commingled with unrelated e2e work.

## Why it is a failure
Two failures compounded:
1. I intended an explicit-pathspec commit but a malformed first attempt (`-- <path>`
   before `-m`) left the file staged in a SHARED index — the exact precondition the
   rule warns about. The window between "staged" and "committed" is where a co-worker's
   bare commit sweeps your file.
2. The working tree is shared between the engineer and the tester with no worktree
   isolation, so a staged-but-uncommitted file is exposed to any other agent's bare
   commit. This is now the 4th logged instance of the shared-index sweep.

## Cost
Low — content is correct and green on trunk (suite 420 passed). No rework of code.
The damage is attribution/traceability: UC-SF2's test is invisible in the git log
(hidden inside a tester commit), which misleads later readers and breaks the
"one green use-case = one commit with intent" mapping.

## Fix / prevention
- NEVER leave a file staged in a shared index across a fallible command. Construct the
  commit as a SINGLE atomic act: `git commit -m "<msg>" -- <path>` (message BEFORE the
  `--`), which stages-and-commits only the pathspec with no persistent staged window —
  or write to a blob and commit the blob. Do not `git add` then commit as two steps in
  a shared tree.
- Structural fix (orchestrator/flow-manager): dispatch concurrent engineers/testers in
  separate git WORKTREES so there is no shared index at all. The parallelism rule already
  notes "if the orchestrator dispatched you in a worktree, that isolation is already
  handled" — the recurring sweep (now 4×) is evidence the shared-tree dispatch path
  should be retired for concurrent agents.
