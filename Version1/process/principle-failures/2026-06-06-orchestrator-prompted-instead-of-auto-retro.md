# Orchestrator prompted the human for a step the process already automated

**Date:** 2026-06-06
**Principle violated:** continuous flow / auto-retro (iteration-run step 7 already
said "automatically run /retro without waiting for human instruction").

## What happened

At slice delivery the orchestrator reported completion and **asked** the human
whether to run the retro, instead of running it. The human had to issue an
explicit instruction to do what the process already mandated, adding a
human-wait to the end of the iteration.

## Why it happened

The orchestrator treated "end of iteration" as a natural hand-back point and
defaulted to deference, overriding a written process step. Automated steps in
command files are easy to drop when the orchestrator summarises and pauses.

## Generalised lesson

When a command file marks a step as automatic/mandatory, the orchestrator must
execute it, not offer it. "Report, then continue" — reporting to the human and
proceeding are not mutually exclusive. Asking permission for an already-mandated
step is itself a process deviation and must be logged here.

## Process response

v14 §28 elevates auto-retro from a command-file step to a process section with a
measurable target (zero human-prompt wait between `delivered` and retro start),
and §29 removes the documenter from the critical path so there is no "waiting
for docs" excuse to pause.
