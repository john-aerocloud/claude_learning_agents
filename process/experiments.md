# Experiment registry (process v32 §25a)

Every routed change is an experiment. One row per change. The orchestrator
scores rows at every retro (§26). Statuses: `active` | `validated` |
`validated-by-null-hypothesis` | `under-question` | `retirement-trial` |
`retired` | `reworked→EXP-NNN`.

**Horizon** counts SCORING OPPORTUNITIES (slices/iterations where the change
could have shown its effect), not calendar retros. "No opportunity" extends.
**Retirement-trials run 4–5 scoring opportunities** before "retired" may be
concluded (human-corrected at v32: 1–2 opportunities is an anecdote, not a
sample); an attributable metric drop reinstates early, a noisy early signal
voids and re-queues the trial.

**Grandfather rule:** agent-def content routed before v31 is not bulk-imported
(ceremony without evidence). When a pre-existing section visibly drives — or
visibly fails to drive — an outcome at a retro, add it then, with that evidence
as its first scoring row. The inventory grows by observation, not by audit.

| id | routed | artifact(s) | change | target metric | anticipated effect | horizon | status | scoring notes |
|----|--------|-------------|--------|---------------|--------------------|---------|--------|---------------|
| EXP-001 | v27 (2026-06-06) | §17 + engineer.md/tester.md | real-browser-not-node probe rule + browser-transport spec | MTTR, tester | 0 browser-only root causes reaching prod | 2 | **validated** (2/2) | s005-h2 part 1: 0 browser-only causes in 3 defects; part 2 (delivery): AC7.3 real-browser spec was the ONLY surface that exposed H2-003's user symptom (node probes saw allow/deny fine) — the rule earned its place |
| EXP-002 | v28 (2026-06-06) | principles/02 + engineer.md | local standability: build-phase browser tests vs committed stand-up | tester, lead | browser behaviour developed not discovered; OI-28 builds it at s006 | 2 after OI-28 lands | active (blocked on OI-28) | not buildable until the stand-up exists |
| EXP-003 | v29 (2026-06-07) | §19 + cicd.md | trunk-CD prereq corollary (prereq before first push) | CFR | 0 enforcement-before-prereq pushes | 2 | reworked→EXP-005 | PARTIAL at v31: DEFECT-H2-001 (mint-before-secret, ~35min outage) was exactly this class — text existed, route construction didn't read it |
| EXP-004 | v30 (2026-06-07) | §5a + 4 agent defs | failure semantics 5xx/4xx ownership + backoff | CFR/MTTR attribution | defects classified + routed without debate | 2 | **validated** (2/2) | tester classified H2-003 correctly unprompted; engineer's fix encoded the taxonomy in tests (reset-path 5xx category pins) — semantics used at both ends of the defect loop |
| EXP-005 | v31 (2026-06-07) | §12a + engineer/tester/architect/product defs | shared change-impact model (mermaid deps, updated-in-commit, read-before-build/test, @covers) | tester (constraint), CFR, MTTR | tester median < 900s; no defect in a changed-but-untested area; 0 §19-class misses | 2 | active (1/2 MET mid-slice) | s006 Wave B: engineer's §12a read-before-build STOPPED on a spec contradiction (connectionId→gameId path ungrated) BEFORE writing code — prevented a DEFECT-H2-001-class prod AccessDenied; resolved by architect ruling in ~4min (GATE-AMEND-S006-B). Mechanism demonstrably load-bearing; full scoring at s006 delivery |
| EXP-006 | v21→v31 (scored 2026-06-07) | §40 + engineer/cicd defs | use-case flags (two-phase rollout lifecycle) | CFR on parallel/shared-seam work | no enforcement-before-credentials class breakage; no stash choreography | — | **validated** | H2_ENFORCE ran the full lifecycle on a real seam; prevented prod breakage by design; factor-out completed at delivery with EMPTY template diff (45b0aa4) — clean lifecycle end |
| EXP-007 | v25/§30→v27 (scored repeatedly) | §17 walking-skeleton probe + engineer.md | skeleton probe on new platform mechanisms | CFR, MTTR | platform wiring failures surface pre-tester | — | **validated** | T6 probe caught DEFECT-H2-002 (identitySource AND) before tester hand-off; WAF probe precedent at h1; committed as repeatable make ws-skeleton (4/4 asserting) |
| EXP-008 | v32 (2026-06-07) | §25a + §26 + this file + retro command | changes-as-experiments lifecycle (scoring, retirement, null-hypothesis) | ALL (meta) — guards simplicity of agent defs | every routed change scored within horizon; ≥1 under-question item resolved (rewritten/retired) within 3 retros; agent-def line count stops monotonic growth | 3 retros | active | self-referential: this row is scored by whether the registry is actually maintained and acted on |
| EXP-009 | s005-h2 retro (2026-06-07) | tester.md | budget-aware validation: when the system under test rate-limits by source, connection-consuming specs run serialised/ordered so the SUITE does not exhaust the budget it is validating | tester (false-red re-runs), CFR honesty | 0 test-isolation false-reds on rate-limited surfaces | 2 | active | evidence: AC7.3 re-validation runs 1-2 failed from suite self-interference (7-worker smoke exhausted the 20/5min budget; WAF 429 from page floods) — 2 wasted runs + 1 five-minute wait |
| EXP-010 | v33 (2026-06-07) | §11a + engineer.md | use-case flow: deployable UC done = deployed + engineer probe green in prod; deploy order by concurrency group + §19 edges; builds overlap per §37 | lead time, deploy freq, MTTR attribution | defects surface at UC probes not slice validation; tester load shrinks (constraint protected); no deploy overwrites | 2 | active | formalises the organically-emerged ws-skeleton pattern; first scoring at s006 delivery |
