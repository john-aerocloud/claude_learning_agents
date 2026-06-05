# Process history

One file per superseded process version, written by the Orchestrator at retro
*before* it overwrites `process-current.md`.

Filename: `vNN-YYYY-MM-DD.md`

Template:

```markdown
---
process_version: NN
active_from: YYYY-MM-DD
active_to: YYYY-MM-DD
superseded_by: NN+1
---

## Process as it stood
(Copy of the process-current.md that was in force.)

## DORA while active
Lead time / deploy freq / change failure rate / MTTR for this version's window.

## Change made going into the next version
What was changed and why (link the principle-failures that motivated it).

## Improvement anticipated vs. observed
What we expected the change to do to DORA, and — filled in at the *following*
retro — what it actually did. This closes the learning loop.
```

The "anticipated vs. observed" field is the point of this directory: it tells us
whether our process-improvement reasoning is actually any good.
