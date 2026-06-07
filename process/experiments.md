# Experiment registry (process v32 §25a)

Every routed change is an experiment. One row per change. The orchestrator
scores rows at every retro (§26). Statuses: `active` | `validated` |
`validated-by-null-hypothesis` | `under-question` | `retirement-trial` |
`retired` | `reworked→EXP-NNN`.

**Horizon** counts SCORING OPPORTUNITIES (slices/iterations where the change
could have shown its effect), not calendar retros. "No opportunity" extends.

**Grandfather rule:** agent-def content routed before v31 is not bulk-imported
(ceremony without evidence). When a pre-existing section visibly drives — or
visibly fails to drive — an outcome at a retro, add it then, with that evidence
as its first scoring row. The inventory grows by observation, not by audit.

| id | routed | artifact(s) | change | target metric | anticipated effect | horizon | status | scoring notes |
|----|--------|-------------|--------|---------------|--------------------|---------|--------|---------------|
| EXP-001 | v27 (2026-06-06) | §17 + engineer.md/tester.md | real-browser-not-node probe rule + browser-transport spec | MTTR, tester | 0 browser-only root causes reaching prod | 2 | active (1/2 MET) | s005-h2: 0 browser-only causes in 3 defects (H2-001/2/3 all platform/schedule class); AC7.3 browser spec caught H2-003's user symptom — mechanism exercised and useful |
| EXP-002 | v28 (2026-06-06) | principles/02 + engineer.md | local standability: build-phase browser tests vs committed stand-up | tester, lead | browser behaviour developed not discovered; OI-28 builds it at s006 | 2 after OI-28 lands | active (blocked on OI-28) | not buildable until the stand-up exists |
| EXP-003 | v29 (2026-06-07) | §19 + cicd.md | trunk-CD prereq corollary (prereq before first push) | CFR | 0 enforcement-before-prereq pushes | 2 | reworked→EXP-005 | PARTIAL at v31: DEFECT-H2-001 (mint-before-secret, ~35min outage) was exactly this class — text existed, route construction didn't read it |
| EXP-004 | v30 (2026-06-07) | §5a + 4 agent defs | failure semantics 5xx/4xx ownership + backoff | CFR/MTTR attribution | defects classified + routed without debate | 2 | active (1/2 MET) | tester classified DEFECT-H2-003 correctly, unprompted, same day |
| EXP-005 | v31 (2026-06-07) | §12a + engineer/tester/architect/product defs | shared change-impact model (mermaid deps, updated-in-commit, read-before-build/test, @covers) | tester (constraint), CFR, MTTR | tester median < 900s; no defect in a changed-but-untested area; 0 §19-class misses | 2 | active | no opportunity yet; OI-31 retrofit at s006 is the enabler; IMP-007 is the tooling |
| EXP-006 | v21→v31 (scored 2026-06-07) | §40 + engineer/cicd defs | use-case flags (two-phase rollout lifecycle) | CFR on parallel/shared-seam work | no enforcement-before-credentials class breakage; no stash choreography | — | **validated** | H2_ENFORCE ran the full lifecycle on a real seam; prevented prod breakage by design (v30 retirement note) |
| EXP-007 | v25/§30→v27 (scored repeatedly) | §17 walking-skeleton probe + engineer.md | skeleton probe on new platform mechanisms | CFR, MTTR | platform wiring failures surface pre-tester | — | **validated** | T6 probe caught DEFECT-H2-002 (identitySource AND) before tester hand-off; WAF probe precedent at h1 |
| EXP-008 | v32 (2026-06-07) | §25a + §26 + this file + retro command | changes-as-experiments lifecycle (scoring, retirement, null-hypothesis) | ALL (meta) — guards simplicity of agent defs | every routed change scored within horizon; ≥1 under-question item resolved (rewritten/retired) within 3 retros; agent-def line count stops monotonic growth | 3 retros | active | self-referential: this row is scored by whether the registry is actually maintained and acted on |
