# Experiment archive (terse index)

One line per experiment that reached a terminal state (`integrated` / `retired` /
`reworked→`) and was pruned from `experiments.md` (v45 §25a). The behaviour now
lives in the owning agent file; the full row is in git. Append-only, terse —
this is the index of what we've learned and folded in, not a working registry.

- EXP-001 — real-browser-not-node probe + browser-transport spec; 0 browser-only causes reaching prod — integrated 7db8d99 (engineer.md/tester.md)
- EXP-002 — local standability: build-phase browser tests against a stood-up system — integrated 7db8d99 (engineer.md, principles/02)
- EXP-003 — trunk-CD prereq-before-first-push corollary — reworked→EXP-005 (folded into the change-impact model)
- EXP-004 — failure semantics 5xx/4xx ownership + backoff taxonomy — integrated 7db8d99 (engineer/tester/product/solution-architect)
- EXP-005 — shared change-impact model (mermaid deps, read-before-build/test, @covers) — integrated 7db8d99 (engineer/tester/solution-architect/product)
- EXP-006 — use-case flags = two-phase rollout lifecycle (flags not branches) — integrated 7db8d99 (engineer.md/cicd.md)
- EXP-007 — walking-skeleton probe on new platform mechanisms — integrated 7db8d99 (engineer.md, make ws-skeleton)
- EXP-009 — budget-aware validation on rate-limited surfaces (serialise connection-consuming specs) — integrated at s007 retro (tester.md)
- EXP-010 — deployable-UC done = deployed + prod probe green; deploy order by concurrency group — integrated at s007 retro (engineer.md §11a)
- EXP-032 — edit files with Edit/Write, record ledger with dora.py record, never shell redirection — validated 2/2 (s001–s004 run + the v44/v45 retros: 0 file-edit prompts) — integrated v45 (process §15 + orchestrator.md, plain practice)
- EXP-012 — gate-4 go/no-go at route completion, before the deploy-bearing wave — validated 4/4 (s008/s005-h3/s009/s014, 0 ungated infra deploys) — integrated v48 (process §9a, plain practice)
- EXP-014 — canonical kebab node-id === @covers tag, no fuzzy-match — validated on arrival (IMP-007 caught real drift) — integrated v48 (process §12a.5)
- EXP-015 — multi-party modelling: state machine per party + sync-point table — validated 2/2 (s009, s014 chat) — integrated v48 (§12b + product/engineer/tester defs)
- EXP-017 — defect lifecycle intake→reproduce→prioritise→fix-as-spec→gap-closing retro — validated 3/3 — integrated v48 (/defect + §6, plain practice)
- EXP-020 — push→PULL flow control (continuous loop, costed queues, JIT replenish) — validated 2/2 — integrated v48 (§F2/§F3 are the durable home; citations stripped)
- EXP-030 — continuous background loop + parallel replenishment + enqueue-to-empty wake — validated 2/2 — integrated v48 (§F9; refined by EXP-031 rework)
- EXP-034 — proactive replenishment: product decomposes ahead in the same parallel batch as the build wave — validated 2/2 — integrated v48 (§F3 + orchestrator/flow-manager defs)
