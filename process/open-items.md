# Process open items — carry-forward register

Project-agnostic system-learning obligations: unscored anticipated effects and
queued items that survive every refactor (scored history lives in
`process-history/`). This is the §22 carry-forward, held outside `process-current.md`
so the rulebook stays rules. The retro harvests and re-prioritises this list each
cycle; §10 (next-work selection) and §24 (improvement slices) read it.

_Moved out of process-current.md §22 at the v59 consolidation (2026-06-19)._

- **Walking-skeleton probe (§17)** — applies to the next slice introducing a new
  platform mechanism. Target: CFR 0% on new-mechanism slices; MTTR < 900s on any
  defect.
- **Browser skeleton probe + Playwright MCP — IMP-006 (v27)** — the §17 probe
  for a web surface must drive a REAL browser, not a node probe (node gives a
  false green on CSP/config/transport). Build the committed `tests/skeleton/`
  browser probe; human-gated decision on installing the Playwright MCP server
  for live exploratory discovery. Target: MTTR (browser-only causes surface at
  skeleton time, not after a tester hand-off) — directly attacks the tester
  constraint. Score on the next new-mechanism browser slice: 0 browser-only root
  causes reaching prod.
- **Code↔policy contract (§17) + IMP-004 synth scan** — engineer pins code to
  granted IAM actions per handler now; automated SDK-commands-vs-grants scan
  when IMP-004 is built. Target: CFR.
- **Use-case flags — SCORED MET at v31** (H2_ENFORCE ran the full §40 lifecycle
  on a real shared seam; two-phase rollout prevented enforcement-before-
  credentials breakage by design). (The former IMP-005 per-agent-ledger-shards
  follow-on is CLOSED — the DORA ledger is frozen and items are inherently
  per-file disjoint under v82.)
- **Shared change-impact model (§12c, v31)** — author the initial model for
  each live project (oxo-online retrofit = OI-31, scheduled with the OI-17
  hexagonal refactor at s006 — same archaeology, one pass). Score at the next
  two slice retros: tester median task time (target < 900s), CFR on slices
  where the model named the changed areas (target: no defect in an area the
  model showed as changed-but-untested), §19-class schedule violations (target
  0 — read-before-build).
- **IMP-007 impacted-tests tooling** — mechanical `@covers`-tag → changed-node
  lookup (`make impacted-tests SINCE=<sha>`). Target: tester; done condition in
  the IMP file.
- **N+1 pipelining (§F3a)** — operationalised: plan slice N+1 to gate-ready during
  slice N validation. Keep measuring delivery gap; target < 15 min.
- **Hexagonal / supportability refactor (OI-17/18)** — scheduled into the next
  slice on the same handlers. Early signal positive: categorised logging was
  used in diagnosis the same day it shipped.
- **principles/01 version identity (OI-25)** — implement on the next slice that
  touches each surface; tester then gains identity-before-behaviour for real.

## Re-baseline follow-ups (v59, 2026-06-19)
- **settings.json allowlist factoring** — ~160 global + ~60 local patterns,
  heavily project-specific (work/OagEventSource, oxo-online, observatory). Factor
  project-scoped patterns so the global allowlist stays a reviewable core. Not a
  failure source; low priority.

_(v82 slim: the three-writer coherence-retrofit item and the per-event
historical-ledger backfill item were removed — both were made moot by the F0
event-sourced cutover: state is fold(events) in one store, and the frozen DORA
CSV is no longer the metrics source.)_

## Retro carry-forward (v83, 2026-07-07)
- **Cross-instance reconcile latency is HIGH — reconcile `instance/viggo-fix` → `main`
  (§0a Rule 4).** At the v83 retro this instance was **67 commits ahead of `main`, 0
  behind** — a large unreconciled batch, exactly the integration-batching Rule 4 bans
  (rising reconcile latency = a gross-lead-time cost). Not fixed in-retro because a
  67-commit merge to `main` affects the other instance (Mac/OAG) and wants care/a quiet
  window (see the "pull with care" memory). ACTION: reconcile to `main` soon and then keep
  it continuous, not batched.
- **Attribute DAG-blocked `registered` wait to `external`, not `queue` (machinery /
  improvement slice).** The v83 stats show `registered` = 88.82% of GLT, but much of that
  is items correctly DAG-blocked on an unfinished parent — blocked/external wait, not
  fixable pull-latency. Folding it into `queue` overstates fixable waste and hides the real
  pull-latency signal. Refine `work-items.py` GLT decomposition so a registered item whose
  DAG-parents are unfinished attributes its wait to `external`. Targets: metric fidelity
  (so the retro attacks the true constraint). Related: EXP-104.
- **Stale `deploy` row in per-project `queues/policy.csv` (schema gap).** v82 collapsed
  building/deploying/etc. into one `wip` queue, but `policy.csv` still carries a `deploy`
  row (`wip_limit=1`) and no `wip` row, so the current `wip` bucket has no policy floor/cap.
  Update the policy schema + template to the v82 `queue_map`. Low blast-radius; flow-manager
  flagged it at the v83 pull cycle.
