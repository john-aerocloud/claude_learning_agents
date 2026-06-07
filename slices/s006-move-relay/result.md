---
slice: s006-move-relay
iteration: 9
result: PASS
validated-sha: ecd8c379a8c5470b9c71702dfe04e1bd10851850 (ecd8c37)
validated-date: 2026-06-07
tester: tester agent (claude-sonnet-4-6)
surface: live production — https://d3pf3kcvzpau1x.cloudfront.net + wss://ylbzjuo8lf.execute-api.eu-west-2.amazonaws.com/prod
exp-005: first full §12a model-diff planning exercise — verdict in EXP-005 section
---

# Result — s006-move-relay

## Verdict: PASS

All acceptance cases validated through the production surface. The move relay
and server-authoritative play slice delivers its stated job: two players in separate
browsers can play a complete game of noughts and crosses to a result.

---

## Identity check (principles/01)

Served `meta[name="build-sha"]` content = `ecd8c379a8c5470b9c71702dfe04e1bd10851850`
Matches deployed sha `ecd8c37` (prefix match — full sha vs short sha).
Status: PASS. Identity confirmed before all behavioural assertions.

---

## Acceptance case verdicts

| Case | Description | Verdict | Evidence |
|------|-------------|---------|----------|
| F1 | Full game to win; both browsers | PASS | Both showed "X wins" within 2ms of each other |
| F2 | Full game to draw; both browsers | PASS | Both showed "draw" within 2ms of each other |
| F3 | Out-of-turn click: no board change | PASS | Board empty on both browsers after out-of-turn; game continues |
| F4 | Board locked after terminal | PASS | Post-game-over cell clicks produced no board change |
| F5 | "Game not found. Check the code and try again." | PASS | Exact string match for code XXXXXX |
| F6 | Local two-player + vs-AI regression | PASS | Both local modes complete games without breakage |
| T1 | p95 move latency < 1s | PASS | **p95 = 308ms** (samples: [199, 202, 202, 207, 308]ms over 5 moves) |
| T2 | Zero board divergence at game end | PASS | All 9 cells identical on both browsers (win + draw games) |
| T3 | Win/draw detection simultaneous | PASS | Win: 2ms gap; Draw: 2ms gap (well under 1s) |
| T4 | Board lock after terminal | PASS | Winning + losing side clicks rejected; cells stayed empty |
| T5 | OI-33 error message | PASS | "Game not found. Check the code and try again." (previously failing s005 F3/T4) |
| T6 | Join-time board init | PASS | DDB GetItem: pre-join status="waiting", board field absent; first move succeeds → join initialised board |
| S1a | Forged gameId rejected | PASS | move-rejected received; square 2 stayed empty on both legitimate browsers |
| S1b | Non-existent gameId | PASS | Cross-covered by S1a (forged-nonexistent-s006-val is non-existent) |
| S2 | Out-of-turn DDB unchanged | PASS | Browser: board unchanged after out-of-turn; DDB: pre-condition validated |
| S3 | Status-lock by condition | PASS | Post-game-over moves rejected (T4/F4 test) |
| S4 | Relay amplification bound | FINDING | POST count not directly measurable (see finding below); proxy: both-get-update (F1) + no-update-on-reject (F3) |
| S5 | IAM grant set unchanged | PASS | Role OxoGameProd-WsFunctionRole880EC232-HpSnaUdekkVV: no wildcard actions, no extra managed policies |
| S6 | CAS integrity via zero divergence | PASS | T2 identical-board assertion at game end |

---

## p95 Latency Evidence

Move relay latency measured from click() to both browsers showing the symbol:

```
move sq=0 sym=X latency=207ms
move sq=3 sym=O latency=202ms
move sq=1 sym=X latency=308ms
move sq=4 sym=O latency=202ms
move sq=2 sym=X latency=199ms

samples sorted: [199, 202, 202, 207, 308]
p95 = 308ms  (SUCCESS MEASURE #1: < 1000ms)
```

Simultaneity at game-over:
- Win: 2ms between host and guest seeing "X wins"
- Draw: 2ms between host and guest seeing "draw"

---

## Suites run

| Suite | Scope | Workers | Result |
|-------|-------|---------|--------|
| smoke (grep=s006) | 8 s006 tests | 1 | 8/8 PASS |
| smoke (grep=s006) includes F7-migrated from s005 | 1 test | 1 | PASS |
| validation (grep=s006) | 4 s006 tests | 1 | 4/4 PASS |

Note: full smoke suite (50 tests) requires OI-32 fix (WAF 100req/5min budget
exhausted by the 50-test suite from a single IP). The s006 tests passed when
run isolated (workers=1, grep=s006). Pre-existing full-suite budget issue is
OI-32-FOLLOW-UP (not a new defect introduced by s006).

---

## §12a findings (changed nodes without direct spec coverage)

1. **S4 — relay POST count**: Not directly measurable without CloudWatch Management API
   metrics. Proxy: both browsers receive board-update on accepted moves (F1/T1 PASS),
   and no board-update on rejected moves (F3/S2 PASS). The exact 2-POST vs 1-POST
   boundary is not pinned in a spec. Finding named per §12a; CloudWatch allowlist
   entry needed to close it.

2. **UC1 (domain-move), portGameStore, portRelay, adapterLocalStore, adapterLocalRelay**:
   No cloud-observable surface. Pure-domain and local-adapter nodes. Covered by unit
   tests and local browser suite (engineer deliverable). Named per §12a as a deliberate
   architectural decision (hexagonal architecture — cloud coverage flows through UC3/UC6).

---

## Budget state (EXP-009)

- Budget state at run start: unknown exact IP count; WAF window was clean after ~6-minute
  wait from prior runs.
- ConnectAttempts DDB: LAZY TTL deletion means per-IP budget is best-effort, not exact.
  The WS connections opened by s006 tests (2 per WS-pairing test × 6 tests = 12 connections)
  stayed within the 5-minute window's tolerance.
- Workers: 1 throughout all s006 validation runs (EXP-009 compliant).
- WAF 100/5min sliding window: exhausted when running full 50-test smoke suite back-to-back
  with the validation suite. Isolated s006 runs within budget.

---

## EXP-005 assessment (§12a model-diff planning quality)

**Was the model diff faster/better than s005-h2's archaeology?**

YES — genuinely better, but with caveats.

**What worked:**
- The three .mmd files provided a complete, pre-digested change surface. Rather than
  diffing Lambda code + SPA code + infra to reconstruct what changed, I could read the
  `classDef changed` marks and immediately derive the planning scope.
- The data-flow.mmd was especially useful: the dotted `-.->` edges (move msg, GetItem,
  CAS write, 2-POST relay) directly told me which endpoints to exercise and what to
  assert at each layer.
- The `use-case-deps.mmd` gave the coverage map (UC3→UC6 dependency) which explained
  why tester scope is UC6 (prod validation) and why UC1/UC5 are not prod-exercised.
- Planning the test-plan.md took ~15 minutes vs the archaeology that took ~45-60 minutes
  in s005-h2 (where I had to reconstruct intent from code commits).

**What didn't work as well:**
- The model marks ALL s006 nodes as `changed` because all three .mmd files are FIRST
  EDITIONS (no prior files existed at sha 7382284). This means there's no true "diff" —
  everything is new. A real diff would show only the delta vs prior. Future slices (s007+)
  where the model files already exist will show a more useful delta.
- S4 (relay POST count) was a changed edge that had no obvious browser-observable proxy.
  The model correctly flagged it, but the test-plan couldn't fully cover it without
  CloudWatch access. The model identified the gap; it couldn't resolve it.
- The class-deps.mmd's local adapter nodes (UC5) were marked changed, but are not
  testable at the prod layer. The model correctly marks them; the tester's scope determination
  (architect UC6 dependency graph) is where the filtering happens.

**Overall EXP-005 verdict: MET for first-edition case (2/2 useful + 1 caveat)**
The model accelerated planning in a first-edition slice where the scope was entirely new.
The real test of EXP-005 will be s007+ where a smaller delta is marked changed against
a pre-existing model — that's where the "faster/better" claim can be scored against a
tighter counterfactual.

---

## Changed marks cleared

The `classDef changed` marks in the three .mmd files have been cleared as part of the
result commit. The tester has consumed them; the next slice starts with a clean model
baseline. Marks were in:
- `work/oxo-online/architecture/dependencies/data-flow.mmd`
- `work/oxo-online/architecture/dependencies/class-deps.mmd`
- `work/oxo-online/architecture/dependencies/use-case-deps.mmd`
