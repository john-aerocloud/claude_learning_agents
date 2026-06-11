# 2026-06-11 — file-level pathspec commit swept a co-worker's hunks in a SHARED FILE

**Slice/UCs:** observatory s015 UC-S015-1 (WIP nav panel) ⨯ s014 UC-S014-2 (steer panel)
**Agents involved:** two engineers sharing one working tree
**Commit:** `1111636` (UC-S014-2) contains the UC-S015-1 `ObservatoryView.jsx`
view-switch wiring authored by the s015 engineer.

## What happened
Both UCs legitimately needed edits to `ObservatoryView.jsx` (s014: one-line
`onSteer` pass-throughs + steer drawer mount; s015: the structural tablist/
tabpanel wrapper). The hunks never overlapped a line, both sets were green, and
the s015 engineer deliberately sequenced its commit of the shared file AFTER
s014's. But pathspec isolation is **file-level**: when the s014 engineer
committed `-- …/ObservatoryView.jsx`, the commit took the whole working-tree
content — including the s015 hunks — into a commit whose message names only
UC-S014-2.

## Impact
None functionally (trunk green; both feature sets complete and tested; the s015
engineer's specs landed in `d872ac2`). Attribution/bisection blurred: a future
`git log -S ViewSwitch` finds the wiring inside a steer-panel commit.

## Existing rule that ALMOST covers it
"Never `git add` then bare-commit in a shared tree — use `git commit -- <paths>`"
(logged 3×) prevents sweeping OTHER FILES. It does not address two engineers'
hunks coexisting **inside one shared file**.

## Proposed rule refinement
When two in-flight UCs both have uncommitted hunks in ONE shared file, the
committing engineer must either (a) confirm the co-worker's hunks in that file
are complete+green and NAME the swept UC in the commit message, or (b) wait for
the seam owner's commit (§19 sequencing), or (c) the pair re-serialises via the
flow-manager. Silent same-file sweeps hide the other UC's landing.
