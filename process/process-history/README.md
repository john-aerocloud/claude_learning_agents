# Process history

Superseded process versions are **annotated git tags** `process-v<NN>`, not files.
At each retro the Orchestrator tags the prior version before overwriting
`process-current.md`; the tag's annotation carries the version's DORA window, the
change made going into the next version, and the anticipated-vs-observed note
(filled at the *following* retro — the point of the record: it tells us whether our
process-improvement reasoning is any good).

To read a past version: `git show process-v<NN>` (the tag) or
`git show process-v<NN>:process/process-current.md` (the file as it stood).

This directory intentionally holds only this note — **git is the archive**. Do not
create `vNN-YYYY-MM-DD.md` per-version files here; that mechanism was retired at the
v82 cutover.
