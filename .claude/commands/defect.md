---
description: Report a defect — capture expected/actual/intent/importance, reproduce-to-confirm, prioritise, fix defect-as-spec, then run a gap-closing retro that proposes an experiment.
argument-hint: "<expected> | <actual> | <what you were trying to do> | <why it mattered>"  (free text ok; the orchestrator will parse/ask)
allowed-tools: Read, Write, Edit, Bash, Task
---

_Project resolution: if no project is named, use `work/ACTIVE`. If stale, stop and suggest `/project-list`._

Act as the **orchestrator**. A defect is normal work (defect-as-spec); you OWN this flow end to end and make the process call. Do not skip the reproduce step and do not skip the retro.

## 1. Capture the defect record (structured) — PROMPT for anything missing
Four fields are REQUIRED before proceeding:
- **Expected** — the behaviour the user expected.
- **Actual** — what actually happened.
- **Intent** — what the user was trying to DO (the job/use case).
- **Importance** — why it mattered (impact: blocks core job / cosmetic / data-integrity / etc.).

If the argument is missing ANY field, or any field is too vague to act on or to
reproduce (e.g. "it's broken" — which screen? what did you click? what did you
see vs expect?), STOP and ASK the human (use AskUserQuestion) for the specifics
before doing anything else. Do not guess the missing pieces and do not start
reproducing on a half-specified report — an unreproducible-because-underspecified
defect wastes a cycle. Keep asking until you have enough to drive the exact path.
Then record all four to `work/<project>/defects/DEFECT-<id>.md`, assign
`DEFECT-<id>`, append an `open-items.md` row, and tag the use case(s) it touches.

## 2. Reproduce to CONFIRM (mandatory — no phantom fixes)
Before any fix, reproduce it yourself through the most public surface (browser for web, API for backend), against the deployed/live system the user saw. Drive the exact Intent path.
- **Confirmed** → capture the evidence (the observed Actual) in the record; proceed.
- **Cannot reproduce** → record as `unconfirmed` with what you tried; STOP and report to the human (it may be environment, stale cache, or user error — do not fix what you cannot see). Re-open only with more information.
- **Reproduced but DIFFERENT from reported** → record the real behaviour; that is the defect now (look at the target; report the discrepancy).
Classify per §5a ownership (our bug / caller data / dependency).

## 3. Prioritise against other work (§38)
Rank the confirmed defect against the open-items register + improvement-slices + any in-flight slice, using the §38 selection rule. Decide and LOG: fix NOW (interrupt), fix as the next pickup, or schedule with a named trigger. Production-impacting / core-job defects pre-empt; cosmetic ones queue. State the rationale in the record + decision-log.

## 4. Fix — defect-as-spec, at the chosen point
Dispatch `engineer` (with `solution-architect`/`product`/`ui-designer` first if the fix needs a design, security, scope, or UX ruling): write the EXPECTED behaviour as a failing test (the reproduction, pinned), make it pass, deploy, then **re-run the step-2 reproduction in prod and confirm the Actual is gone**. Emit **`defect_intake`→`defect_resolved`** ledger rows (NOT `failure`/`recovery` — a defect raised against the standing system is a defect intake, excluded from deploy-CFR but counted in MTTR and the defect-arrival rate; process §3 v51). Keep the `DEFECT-NNN` ref so the metric classifier attributes it correctly. MTTR runs from the confirmed report to the validated fix. The defect is not closed until the user-visible symptom is re-checked in prod and the pinning test is committed.

## 5. Gap-closing retro (mandatory once fixed)
Run a focused retro whose SOLE goal is: **what in the process let this defect through, and what experiment could close that gap?**
- Name the step/agent that should have caught it and WHY it didn't (the latent root cause, not just the code fix).
- Route the fix for that gap to its narrowest owner (§25/§36).
- Propose ONE experiment (register in `/process/experiments.md`) with target metric, anticipated effect, scoring horizon — AND its **applies-to** predicate (the kind of future work that will exercise it; §25a). A defect that reveals a gap with no proposed experiment is an incomplete retro.
- Score per the normal retro mechanics (§26); version-bump the process only if a cross-agent rule changed.

## Return
The defect record path, confirm/unconfirmed verdict + evidence, the priority decision + rationale, the fix (sha + prod re-check), and the gap-closing experiment (id + applies-to).
