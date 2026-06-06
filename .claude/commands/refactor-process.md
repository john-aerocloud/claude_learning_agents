---
description: Refactor the process file — route agent-specific content into agent definitions, restructure around process stages, de-duplicate, keep it concise and easy to change.
allowed-tools: Read, Write, Edit, Bash, Task
---

Act as the **orchestrator**. The process file's value is inverse to its size:
it must stay concise, relevant, and easy to add to / remove from. Agent
definitions — not the global process — are the unit of agent behaviour.

1. **Read** `/process/process-current.md` end to end.

2. **Classify every section/rule** as one of:
   - **GENERAL** — rules of the game spanning multiple agents or stages
     (gates, commit discipline, metrics definitions, selection rules). Stays.
   - **AGENT-SPECIFIC** — concerns one agent or a small subset (how the tester
     validates, how cicd orders config, how the engineer structures code).
     Must move.
   - **TOOLING** — describes a mechanical procedure better held by a Makefile
     target, skill, or command doc. Must move to that artifact's own docs.
   - **SCORED / HISTORICAL** — anticipated-vs-observed already settled, or
     narrative of how a rule came to be. Belongs only in `process-history/`;
     keep at most the live rule, not its origin story.
   - **PROJECT-SPECIFIC** — names a project or its resources. RULE VIOLATION:
     generalise it or move the specifics to `/work/<project>/`.

3. **Route agent-specific content** (process §36): verify or add the rule in
   the owning `.claude/agents/<agent>.md` file(s) — written as behaviour the
   agent follows, not as process narrative — then REMOVE it from the process
   file. A one-line pointer may remain only when other agents genuinely need
   to know the rule exists.

4. **Restructure what remains** to map onto the process stages, not the order
   rules were invented: principles & metrics → next-work selection → slice
   planning (slice/use-cases/acceptance) → architecture & security → build →
   deploy → validate → document → retro & improvement. **De-duplicate** —
   one rule, one home, stated once.

5. **Preserve obligations.** Unscored ANTICIPATED effects and queued
   change-set items must survive the refactor (carry them into the change-set
   queue section); scoring debts are never silently dropped.

6. **Version it.** Snapshot the old file to
   `process-history/vNN-<date>.md` with a retirement note containing the full
   routing table (rule → new home). Bump `process_version`. The refactor
   changes WHERE rules live, never WHAT they require — flag (don't make) any
   substantive change you think is also needed.

7. **Verify**: nothing project-specific remains in `/process`; every removed
   rule exists verbatim-or-stronger in its new home; the file got shorter;
   `git diff --stat` confirms agent files absorbed what the process file shed.

8. **Commit** process file + history + agent files together; log a `process`
   row in the decision log of the active project and a ledger `gate` row
   (ref PROCESS-REFACTOR-vNN).

Report: the routing table (rule → destination), before/after line counts, the
new section map, and any substantive issues flagged for the next retro.

Run this at any retro where the process file has visibly accreted (many
same-day versions, agent-specific detail creeping in), or on demand.
