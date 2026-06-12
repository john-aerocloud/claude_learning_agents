# 2026-06-12 — Peer commits swept UC-S018-1 in-flight files (5th sweep-class occurrence, reverse direction)

**Agent(s) at fault:** orchestrator/flow-manager (commit 990a307) and retro
author (commit 273e7fb) — NOT the engineer whose files were swept.

**What happened:** while the engineer was mid-build on UC-S018-1 (declared
seams: `work/observatory/queues/ready.csv` for the atomic pull,
`work/observatory/src/app/e2e/intake-wizard.spec.js` among the build files),
two peer commits landed that included those files:

- `990a307` (DEFECT-015 close) carried the engineer's ready.csv dequeue edit
  (the UC-S018-1 row removal).
- `273e7fb` (RETRO-S015) carried the engineer's brand-new
  `e2e/intake-wizard.spec.js` AND a third engineer's
  `e2e/metric-source-single-panel.spec.js` (DEF-014, also mid-flight).

**Impact:** none on content — the swept bytes were the engineer's final
versions, the full suite stayed green, and the UC-S018-1 build commit
(`6659ac8`) silently shrank from 15 to 13 files. Impact is on ATTRIBUTION and
process telemetry: deploy/commit provenance for the dequeue edit and the
browser spec now points at unrelated peer commits, and a retro commit carried
two engineers' in-flight test files it never ran.

**Pattern:** 4 prior occurrences were "my commit swept THEIR pre-staged/peer
files" (latest log: 2026-06-12, directory-pathspec variant, 8c03b6b). This is
the same root cause from the other side: a peer used a broad add/commit while
sharing the working tree, instead of explicit FILE pathspecs limited to files
they authored.

**Rule already on the books (re-affirm):** in a shared tree, every agent
commits with an explicit FILE pathspec of files it authored — no `git add -A`,
no directory pathspecs, no "commit everything that looks related to my
defect/retro". Retro/defect-close commits are NOT exempt: they touch
`/process` + their own slice artifacts only.

**Suggested sharpening (for flow-manager/retro defs):** before committing,
run `git status --short` and cross-check against the in-flight UCs' declared
seam/path claims; any unclaimed-but-modified path that another agent declared
is a hard stop, not a sweep.
