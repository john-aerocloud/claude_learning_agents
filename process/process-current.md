---
process_version: 8
effective_from: 2026-06-05
supersedes: v7
status: active
---

# Current Process — v8

The process all agents follow right now. Updated only by the Orchestrator at a
retro, which snapshots the prior version into `process-history/` first.

## 1. Operating principles (beliefs)

See `principles/` for the full statements. In force: XP, always-TDD, value
slicing, trunk-based development, continuous deployment, roll-forward-with-
reversible-rollback, defect-as-spec, jobs-to-be-done. Treat these as defaults,
not laws — deviations are allowed but must be logged in `principle-failures/`.

## 2. Gross lead time — correct definition

**Gross lead time = wall-clock time from idea accepted → running in prod.**
Includes everything: agent processing, gate waits, session idle, overnight.

From ox (3 slices, final data):

| Slice | Wall-clock | Agent work | Wait | Wait driver |
|-------|-----------|-----------|------|-------------|
| 001 | 31 min | ~29 min | ~2 min | None — in session |
| 002 | 8h 21min | ~57 min | ~7h 24min | Tester session ran overnight |
| 003 | 39 min | ~37 min | ~2 min | None — in session + auto go/no-go |
| **median** | **39 min** | | | |
| **mean** | **~3h 10min** | | | |

Script output: `lead=2340s freq=2/day cfr=0% mttr=n/a`.

**The median flatters performance.** Mean is ~5× higher due to one overnight
session. Target: all slices in the 31–39 min range (agent work + minimal wait).

## 3. Wait time taxonomy (from ox data)

Four distinct wait patterns were observed, in order of total duration:

| Pattern | Example | Duration | Fix |
|---------|---------|---------|-----|
| **Requirement-phase dormancy** | Architect dispatched 00:03, ran 11:49 | 11h 46min | Session continuity (§9) |
| **Agent session overnight** | Tester dispatched 16:55, result 00:30 | 7h 35min | Session continuity (§9) |
| **Inter-session gap** | Slice-002 retro 00:40, slice-003 start 07:26 | 6h 46min | Session continuity (§9) |
| **Post-delivery retro gap** | Slice-001 deploy 13:07, retro start 16:07 | 3h | Immediate retro (already mandatory) |

Agent work time is 9–15% of total wall-clock. The remaining 85–91% is wait.
Wait is entirely caused by session boundaries, not process design.

## 4. Session continuity (v7 — primary wait-reduction lever)

**The single most effective way to reduce gross lead time is to complete a
work unit before closing the session.**

Guidelines:

**a. Start a session, finish a deliverable.**
Begin a session with a clear stopping point: "I will finish slice N" or "I will
complete the requirement workflow." Do not start an agent dispatch (architect,
engineer, tester) and then close the laptop. The dispatched agent's wall-clock
will include all the time until the session resumes.

**b. Requirement workflow + first slice in one session.**
When starting a new project, the requirement workflow (vision → arch → chunks)
and slice 1's product definition + architect delta should complete in a single
session. This prevents the 11h+ requirement-phase dormancy seen in ox. The
session ends with the engineer dispatched, not with the architect pending.

**c. Don't dispatch the tester near end of session.**
If you are about to close the laptop, do not dispatch the tester. Instead,
leave the work at a clean stopping point (engineer complete, build green) and
resume the session to run the tester when you return. A tester dispatched and
then abandoned produces 7+ hour wall-clock times for 20–35 minutes of actual
work.

**d. Retro runs in the same session as delivery.**
The mandatory retro must run immediately after the documenter — in the same
session, while context is warm. A 3h gap adds unnecessary wall-clock lead time
to the next slice (which cannot start until the retro is done).

**Anticipated DORA effect:** gross lead time on slices completed within a
single session should be < 60 min (matching ox s001 and s003). Mean gross lead
time should converge toward the median (2340s) rather than being pulled up by
overnight outliers. Observable on the next project's first retro.

## 5. Time-to-first-deploy (v7 — new project health metric)

Track **kickoff → slice-001 deploy** as a distinct metric alongside per-slice
gross lead time. This captures the full ramp cost of starting a project.

For ox: kickoff → slice-001 deploy = 13h 7min (dominated by 11h 46min
requirement-phase dormancy).

Target (v7): < 90 min when requirement workflow and first slice complete
in one uninterrupted session. Record this metric in `dora/per-project.md`
for every project.

## 6. Delivery gap (v7 — new inter-slice metric)

Track **deploy(N) → engineer task_start(N+1)** as the inter-slice transition
time. This captures how long the pipeline sits idle between slices.

For ox:
- s001 deploy → s002 engineer: ~3h 28min (retro gap + session break)
- s002 deploy → s003 engineer: ~7h (overnight)
- s003 deploy → end: project complete

Target: delivery gap < 15 min when human is in session (retro + slice
planning run immediately after delivery). Record in `dora/per-project.md`.

## 7. Loops

- **New requirement** → `/requirement-new`: JTBD vision → target architecture →
  Chunks → capabilities → slice-001 product + architect in same session.
- **Per iteration** → `/iteration-run`: next slice → arch delta → acceptance
  tests → thin route → TDD build → test in prod → **document** → **retro**
  (both mandatory; run immediately in same session as delivery).
- **Retro** → `/retro`: recompute DORA, review principle-failures, answer the
  focus question, propose + apply a process change.

## 8. Gate design

Each human gate is a potential overnight wait. Minimise with:

**a. Auto-approve where the outcome is clear:**
- Go/no-go to deploy: orchestrator auto-approves when — project is local-only
  AND all tests pass AND engineer reports no deviations.
- Arch + security for local-only projects with no new infra and no new security
  surface: architect self-certifies; orchestrator confirms; no human wait.

**b. Parallel N+1 planning:**
As soon as slice N's gate 2B is approved, dispatch product + architect for
slice N+1 in parallel with the engineer building slice N. Human approves N+1's
gates when they return — work starts immediately.

**c. Batch gate decisions:**
When multiple gates are pending, surface them together in one prompt.

## 9. Project classification (solution-architect guidance)

- **Cloud/hosted**: full AWS Well-Architected, IAM, `aws-architecture` skill.
- **Local-only** (CLI, library, script): skip cloud scaffolding; apply Security,
  Reliability, Operational Excellence at source scope; record deviation once.

## 10. Agent roster

| Agent | When dispatched |
|-------|----------------|
| product | vision + slice definition (and parallel N+1 per §8b) |
| solution-architect | architecture delta + security review (and parallel N+1) |
| cicd | capabilities (environments, pipeline, rollback) |
| engineer | TDD build on trunk |
| tester | in-prod / public-surface validation |
| documenter | `docs/usage.md` after every validated slice |

## 11. Tester scope

The tester validates **customer-observable outcomes** through the public
surface. It does NOT re-implement exhaustive correctness checks in the suite.

- Run `pytest` (or equivalent) and confirm it passes.
- Exercise the public surface: happy path, key error cases, adversarial inputs.
- Validate success measures from `slice.md` as a user would experience them.

Confirmed working (ox): tester median back to 1200s after scope clarification.

## 12. Deploy event — definition by project type

| Project type | Deploy trigger | Logged by |
|---|---|---|
| Cloud/hosted (AWS, Azure) | CI/CD pipeline live in production | cicd or engineer on pipeline success |
| Local CLI / library | Tester validation passes (no infra deploy) | orchestrator after tester task_end |

For cloud/hosted: log deploy at pipeline completion, not tester-pass.

## 13. Deploy event logging

Orchestrator logs `deploy` event row immediately when tester passes.
Row format: `timestamp,project,iteration,slice,orchestrator,deploy,,success,ref,note`
Note: `agent` = "orchestrator", `event` = "deploy" — these are the correct columns.

## 14. Engineer duration_s

The engineer populates `duration_s` in its `task_end` ledger row with
wall-clock seconds (task_end.timestamp − task_start.timestamp). Without it
the DORA baseline has no build-step data. The engineer already brackets tasks;
it just needs to compute and fill the field.

**Anticipated DORA effect:** engineer appears in baseline with real data;
constraint model covers all 4 measured agent steps.

## 15. per-project.md discipline

The orchestrator updates `work/<project>/dora/per-project.md` at the end of
each slice retro. Include: slice, change, expected DORA effect, actual,
regression flag, reflection, time-to-first-deploy (s001 only), delivery gap.

## 16. DORA baseline (v7 starting point — ox final)

| Metric | ox final | v7 target (next project) |
|--------|---------|--------------------------|
| Gross lead time (median) | 2340s (39 min) | < 2400s — maintain in-session performance |
| Gross lead time (mean) | ~11,420s (3h 10min) | < 3600s — eliminate overnight outliers |
| Time-to-first-deploy | 13h 7min (req-phase dormancy) | < 90 min in-session |
| Delivery gap (median) | ~5h (dominated by overnight) | < 15 min in-session |
| Deployment frequency | 2/active-day | ≥ 3/active-day |
| Change failure rate | 0% | maintain 0% |
| MTTR | n/a | n/a |

**Current constraint: session continuity** — not gate count, not agent speed.
All fast slices (001, 003) completed within a single session. The slow slice
(002) had the tester session cross overnight.

## 17. Commit discipline

The engineer commits to trunk every time the full test suite transitions from
red to green. Rules:

- **Commit when green, never when red.** A commit represents a safe, tested
  state — not a work-in-progress checkpoint.
- **Message states intent, not mechanics.** The message answers "what does this
  advance?" — the slice, acceptance criterion, defect, or job being served.
  Code diffs already show what changed; the message must explain why.
- **One logical change per commit.** Each commit must be independently
  deployable. If two changes are entangled, extract the dependency first.

Example good messages:
- `Serve React shell from S3 via CloudFront — AC1 (HTTPS with valid cert)`
- `Block direct S3 access; only CloudFront OAC permitted — AC3`
- `Fix: AI plays to corner on first move (defect: was always centre)`

Example bad messages:
- `update files`
- `fix bug`
- `wip`

## 18. Change-set queued for next iteration

- Engineer duration_s (§14) — confirm engineer fills field on next project
- Session continuity (§4) — measure whether mean gross lead time improves
- Time-to-first-deploy (§5) — record for next project's first retro
- Delivery gap (§6) — record for each inter-slice transition
