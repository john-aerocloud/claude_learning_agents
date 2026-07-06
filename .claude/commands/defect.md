---
description: Report a defect. Capture/reproduce/prioritise/register happen at the single human gate (`/intake`); this command adds the one thing intake does not — the mandatory gap-closing retro once the defect is fixed.
argument-hint: "<expected> | <actual> | <what you were trying to do> | <why it mattered>"
allowed-tools: Read, Write, Edit, Bash, Task
---

Act as the **orchestrator**. A defect is normal work (defect-as-spec).

1. **Intake half → `/intake --defect "$ARGUMENTS"`.** Capturing the four fields
   (expected/actual/intent/importance), reproducing-to-confirm, prioritising
   (defects pre-empt), and registering the item (`EVENT=reported`, queue membership
   derived) ALL happen there — the single human gate. The fix then flows through
   `/loop-run` like any pulled item: write the expected behaviour as a failing
   pinned test, make it pass, deploy, and re-run the reproduction in prod to confirm
   the symptom is gone. MTTR runs from the confirmed report to the validated fix.

2. **Gap-closing retro (MANDATORY once fixed — the unique value of this command).**
   Run a focused retro whose SOLE goal is: *what in the process let this defect
   through, and what experiment could close that gap?* Name the step/agent that
   should have caught it and WHY it didn't (the latent root cause, not just the code
   fix); route the fix for that gap to its narrowest owner (§25/§36); propose ONE
   experiment (register in `/process/experiments.md`) with a named target DORA
   metric, anticipated effect, scoring horizon, and its **applies-to** predicate
   (§25a). A defect that reveals a gap with no proposed experiment is an incomplete
   retro. Score per §26; version-bump the process only if a cross-agent rule changed.
