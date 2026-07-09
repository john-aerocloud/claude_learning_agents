---
description: Hold a retrospective — recompute DORA, review principle-failures, and produce a new process version targeting a DORA metric.
argument-hint: <project-name> [slice-id] [--question "..."]
allowed-tools: Read, Write, Edit, Bash, Task
---

_Project resolution: the project argument may be omitted. If the first argument is not an existing directory under `work/`, use the project named in `work/ACTIVE` and treat the given arguments as shifted. The machine-local `work/ACTIVE` pointer is per-instance (never another machine's); if it is missing, `none`, or stale, stop and suggest `/project-switch <name>`._

_Question resolution: if a `--question "..."` argument is present, use that as the retro focus question. If omitted, use the default: **"What was the largest contributor to gross lead time, and what strategies can be attempted to reduce this whilst protecting DORA metrics?"**_

Act as the **orchestrator**. Own this; gather input but make the process call.

1. Run `make wi-project PROJECT=$1` to recompute the derived views, then read
   `work/$1/views/stats.md` for the current DORA + flow figures — lead time
   (registered→done), CFR, MTTR (defect reported→resolved), and each part's
   **contribution to gross lead time**. Metrics come from the item event
   timestamps; the DORA ledger is FROZEN (read-only archive). Identify the
   constraint (Theory of Constraints) and record it. **Include cross-instance
   reconcile latency** (process §0a Rule 4): report the wall-clock from an
   `instance/<project>` commit to it landing on `main`, and treat that latency as a
   gross-lead-time component to drive DOWN — a rising reconcile latency means the
   instances are batching integration (banned). If it is the constraint or trending
   up, that IS the retro focus.
1a. **WALK the full Theory-of-Constraints loop (process §5b) — do not stop at
   identify.** Against `views/stats.md` §B `by_owner`/`by_stage`:
   - **IDENTIFY** the constraint (top GLT-share owner) — already recorded in step 1.
   - **EXPLOIT** — name the constraint's WASTE and REWORK to remove FIRST: its
     `failure_rate`/rework-rate at its stage, re-reads, redundant dispatches, avoidable
     waits. This is the first lever, before any capacity add.
   - **SUBORDINATE** — decide which UPSTREAM queue `wip_limit` (§F2) to CAP so
     non-constraint stages stop piling inventory on the constraint.
   - **ELEVATE** — only if exploit+subordinate are exhausted: raise `N` (§F6) or move
     the constraint agent to a stronger model tier (§7a), each a scored experiment with
     a revert condition.
   Record an explicit **root-cause WHY-CHAIN of ≥3 levels** for the constraint's
   DOMINANT GLT contribution in the retro artifact (why is this owner the top share →
   why → why …), so the change-set attacks the root cause, not the symptom.
   **A RECURRING root cause opens a `principle-failures/` entry even when nothing
   "failed"** — a chronic wait/constraint that recurs across retros is a system failure
   to smooth it, and is logged as such.
2. Collect each agent's "what worked / what hurt" for the project and slice.
3. Review `/process/principle-failures/` and the per-change DORA note (process §23 —
   in the retro record, derived from `views/stats.md`, not a hand-written file).
   Look for PATTERNS — do not revise a principle on a single data point.
4. **Answer the retro focus question** using the DORA data, principle-failures,
   and per-project evidence. Be specific: name the step, duration, and the
   mechanism that drove it. Propose 1–3 concrete strategies, each stating which
   DORA metric it protects or improves and what the anticipated effect is.
4a. **Token-efficiency review, balanced against DORA** (process §24 + §26): estimate
   this cycle's token consumption and where it went (dominant agents/stages/ops,
   fan-out width, whole-file reads vs targeted, re-reads of in-context material,
   model-tier mix, the share already absorbed by scripts). Record the estimate
   beside the DORA baseline so it trends cycle-over-cycle. Name the SINGLE
   highest-leverage reduction and route it like any change — but score it on
   **DORA-value-per-token, never tokens in isolation**: reject a cut that would
   slow lead time, raise CFR, or lose quality; accept a token INCREASE that buys a
   real DORA gain. Register the chosen optimisation (step 7) with both its token
   target and the DORA metric it must not harm. [EXP-055]
5. Snapshot the active process as the git tag `process-v<NN>` (snapshots are now
   git tags, NOT files in `/process/process-history/`), and fill the
   anticipated-vs-observed score for the PREVIOUS change. Revert or rework any prior
   change that was not a net win across throughput (lead time), quality (CFR),
   frequency, and recovery (MTTR).
5a. **Score the experiment registry** (`/process/experiments.md`, process §25a):
   FIRST audit every live row against the **validity bar** (EXP-063): a row that
   describes a piece of work / a feature, names no target DORA metric, or has a
   measurement that cannot come back negative is NOT a valid experiment — delete
   it (keep the behaviour as plain agent practice if it is sound and load-bearing;
   undo it if it is speculative). Then score: scoring is **adopt-or-delete** — a
   row whose metric MOVED is adopted (fold into the owning agent, prune the row);
   a row whose metric did NOT move is rewritten, retirement-trialled, or deleted.
   Every `active` row that had a scoring opportunity gets a scoring note;
   horizon-reached rows with no measurable improvement move to
   `under-question` and MUST be resolved (rewrite as a new experiment, or
   start a `retirement-trial` — physically remove the text, run **4–5 scoring
   opportunities** (1–2 is an anecdote, not a sample), reinstate on an
   attributable metric drop / retire permanently only after no drop across
   the full window; max one trial RUNNING per artifact at a time — a
   confounding guard, not a sample size). Agent-def simplicity is a goal:
   text that cannot demonstrate value does not stay.
   **Newly-validated rows trigger INTEGRATION (§25a v34):** rewrite the owning
   agent file(s) so the validated behaviour is woven into the agent's core
   instructions as plain operating practice — experiment scaffolding (vNN/EXP
   citations, trial caveats) removed, file shorter or equal, behaviour intact.
   Note the integration commit on the registry row; the next retro spot-checks
   the mechanism still fires (EXP-011 scores this policy itself).
6. **Route each change to its narrowest owner** (process §36):
   - one agent's behaviour → edit that agent's file in `.claude/agents/`
   - cross-agent rules → `/process/process-current.md` (version+1)
   - repeated manual action → a parameterised committed tool (Makefile
     target / script / skill) — never inline hand-assembly
   - needs building/testing → an improvement slice in
     `/process/improvement-slices/` (§32), queued with product work
   Identify frictions proactively (prompts, inline assembly, throwaway checks,
   missing records); ask the human only where the call is genuinely theirs.
   **GATE the change-set on the constraint (process §5b).** Every routed change must
   target the CURRENT constraint (its exploit/subordinate/elevate move per step 1a). A
   routed change that does NOT target the constraint must justify itself as EITHER a
   subordinate/exploit move that serves it OR a genuine safety fix (a defect-preventing
   or data-safety change) — otherwise DEFER it to `open-items.md`. Do not spend the
   cycle's change budget away from the binding constraint.
   If the process file has visibly accreted (many same-day versions,
   agent-specific detail creeping into global sections), run
   `/refactor-process` as part of this step.
7. **Before the version bump, run `make doc-lint`** (process §27) and fix any
   flagged drift. Then write the new `/process/process-current.md` (version+1) for
   whatever routed to the global process. Each change — wherever it routed — must
   target a
   named DORA metric and state its ANTICIPATED effect so the next retro can
   score it. The answer to the focus question drives the change-set.
   **Register every routed change** (including agent-file edits and tools) as
   a row in `/process/experiments.md` — but ONLY if it meets the **validity bar**
   (process §25a, EXP-063): a falsifiable HYPOTHESIS with all four — (1) Problem
   (evidenced friction), (2) Solution (the concrete change tested), (3) a NAMED
   target DORA metric (lead time / deploy freq / CFR / MTTR; a meta/proxy metric
   only if explicitly justified as a DORA proxy), and (4) a Measurement (observable
   signal + scoring horizon) phrased so the result CAN come back NEGATIVE. **Do NOT
   create a work-item-shaped row** — a row that describes a feature/capability/work
   to be done, names no DORA metric, or has a did-we-do-the-work "measurement" that
   cannot fail ("the documenter produces consumer docs", "the architect states
   fitness functions") is NOT an experiment: route the behaviour straight into its
   owning agent file as plain practice instead, with no registry row.

8. **CLOSE — drain the retro-debt counter.** Run `make retro-mark PROJECT=$1`.
   This writes the last-retro marker that `make retro-debt` reads, so the §F8 gate
   returns `ok` again and the loop may resume pulls. (This is the v82 replacement
   for the old "record a `retro` ledger row" reset — there is no DORA CSV write.)
   Re-run `make retro-debt PROJECT=$1` to confirm the debt is drained (exit 0).
8a. **FOLD BACK to main (§0a) — the retro is not closed until process learning is
   reintegrated.** Every change this retro routed to the process/agent-system layer
   (`/process`, `.claude/`, `CLAUDE.md`, Makefile, scripts) is committed on this
   project's `instance/$1` branch. Reintegrate it into `main` **immediately, never
   batched** (§0a Rule 4 — reconcile latency is a gross-lead-time cost, measured in
   step 1): from the integration tree (the worktree on `main`) run
   `make project-foldback PROJECT=$1`. If you are in the project's own worktree (on
   `instance/$1`) you CANNOT merge into main from here — the helper refuses — so
   STATE PLAINLY in your report that fold-back is owed and name the exact command, so
   the integration session runs it without delay. Project output never rides the merge
   (`work/*` is gitignored); only the process layer moves.

Report: the focus question and answer, the new process version, each change
WITH where it was routed (agent file / process / tool / improvement slice),
the metric each targets, the anticipated effect, and the constraint to attack next.
