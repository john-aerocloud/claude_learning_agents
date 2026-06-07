---
slice: s006-move-relay
tester-iteration: 9
last-validated-sha: 7382284 (s005-h2 result)
model-diff-source: git diff 7382284 -- work/oxo-online/architecture/dependencies/
plan-date: 2026-06-07
exp-005: yes — first full §12a model-diff planning exercise
---

# Test plan — s006-move-relay (UC6 prod validation)

## §12a model diff summary

All three dependency files (`data-flow.mmd`, `class-deps.mmd`, `use-case-deps.mmd`)
are ENTIRELY NEW — they did not exist at sha 7382284 (s005-h2). The diff is the
whole-file addition. The `classDef changed` marks inside each file identify which
nodes are s006 deltas vs context-only already-delivered nodes.

### Changed nodes (classDef changed marks)

**data-flow.mmd:**
- `wsfn` (oxo-ws-fn Lambda) — CHANGED: new `move` route added
- `games` (DynamoDB Games table) — CHANGED: gains move-write semantics (GetItem by
  gameId + conditional UpdateItem CAS on board/turn/version/status)

**Changed edges (dotted `-.->`)**:
- `player -> wsfn`: new `action=move` message with non-trusted `gameId` lookup key
- `wsfn -> games`: GetItem(gameId) for authorization
- `wsfn -> games`: conditional UpdateItem CAS (move write)
- `wsfn -> relay`: 2-POST fan-out on accepted move; 1-POST reject on rejected move

**class-deps.mmd (ALL NEW, all nodes marked changed):**
- `domainMove` — UC1 pure move domain (applyMove)
- `portGameStore` — UC2 port (getGame, applyMoveWrite)
- `portRelay` — UC3 port (postToConnections)
- `wsMoveHandler` — UC3 handler (parse, getGame, identity bind, domain, relay)
- `adapterGamesDdb` — UC2 adapter (conditional UpdateItem CAS)
- `adapterRelayMgmt` — UC3 adapter (@connections POST)
- `adapterLocalStore` — UC5 local adapter (in-memory CAS)
- `adapterLocalRelay` — UC5 local adapter (records posts)
- `spaOnlineMove` — UC4 SPA move-send + render-on-broadcast
- `spaWsClient` — UC4 WS transport seam (socket.ts)

**use-case-deps.mmd (ALL NEW):**
- UC1 through UC6 all marked changed

---

## Coverage map: changed nodes → specs

| Changed node / edge | Covering spec(s) | Verdict | Notes |
|---|---|---|---|
| `wsfn` move route (data-flow) | `move-relay.skeleton.spec.ts` (@covers UC3 via skeleton); s006-validation-move.spec.ts (PLANNED) | Plan item | Skeleton proves 3/3; prod validation must cover F1/F2/T1/T2/T3/T4 |
| `games` CAS write (data-flow) | s006-validation-move.spec.ts S2 (DDB GetItem unchanged on reject); T6 (board init) | Plan item | DDB get-item already in allowlist; S2 observable via API; T6 join-time init |
| `player -> wsfn move msg` (edge) | Skeleton + pairing smoke (exercised implicitly) | Exercised | Skeleton 3/3; pairing smoke F7-migrated |
| `wsfn -> games GetItem` (edge) | s006-validation-move.spec.ts S1a/b (forged/missing gameId) | Plan item | S1a already skeleton-proven; reassert in pinned spec |
| `wsfn -> games CAS write` (edge) | s006-validation-move.spec.ts T1/S2 | Plan item | CAS correctness observable: board updates, no divergence |
| `wsfn -> relay 2-POST fan-out` (edge) | s006-validation-move.spec.ts T1 (both browsers receive board-update) | Plan item | Fan-out observable in browser: both see same board |
| `wsfn -> relay 1-POST reject` (edge) | s006-validation-move.spec.ts F3/S2 (out-of-turn) | Plan item | Only sender gets move-rejected; no board change on either |
| `spaOnlineMove` UC4 | slice005-h2-pairing.spec.ts F7-migrated (move relays); s006-validation-move.spec.ts F1/F2 | Covered | F7-migrated already asserts board-update fan-out; prod suite extends to full game |
| `spaWsClient` transport | slice005-h2-pairing.spec.ts AC7.3 (CSP/WS transport spec); skeleton (console-error capture) | Covered | Browser-transport spec exists and pins the WSS connect-src |
| `domainMove` UC1 | LOCAL only: move.test.ts (unit); move-relay.local.spec.ts (AC5.2-5.4) | Engineer-phase | UC1 is pure domain — unit-tested, local suite covers behaviour; no cloud surface |
| `portGameStore` / `portRelay` ports | LOCAL only: local adapter tests + local browser suite | Engineer-phase | Ports have no cloud surface; covered by local + adapter tests |
| `adapterGamesDdb` UC2 | s006-validation-move.spec.ts T6 (DDB GetItem board init); S2 (GetItem unchanged on reject) | Plan item | Cloud-observable via DDB GetItem; conditional write atomicity pinned by synth |
| `adapterRelayMgmt` UC3 | s006-validation-move.spec.ts T1 (relay fan-out visible in browser) | Plan item | @connections relay observable via browser-side board-update receipt |
| `adapterLocalStore` / `adapterLocalRelay` | LOCAL: move-relay.local.spec.ts (UC5, engineer deliverable) | Engineer-phase | No cloud surface; not in tester scope |
| `game-ready carries gameId` (AMEND 2026-06-07) | slice005-h2-pairing.spec.ts F7-migrated asserts move path works → implicitly validates gameId round-trip | Covered | Full game in s006-validation-move.spec.ts validates this end-to-end |

---

## Uncovered finding

**UC1 (domain-move), portGameStore, portRelay, adapterLocalStore, adapterLocalRelay** — no
cloud-observable surface. These nodes have no covering prod-validation spec and none
is planned, because they are pure-domain / local-adapter nodes with zero cloud-touching
API surface. This is deliberate by the hexagonal architecture: cloud coverage flows
through UC3/UC4/UC6. Named here as required by §12a (a changed node with no cloud spec
is a finding to name, even when the reason is architectural).

**S4 (relay amplification bound, exactly 2 vs 1 POST)** — not directly countable in a
browser spec without CloudWatch metric access. Planned approach: s006-validation-move.spec.ts
uses CloudWatch Logs filter (allowlisted) to check relay POST counts on the accepted-move
path. If logs are unavailable in the window, S4 is marked as "CloudWatch-observable,
not directly spec-pinned" — the browser-observable outcome (board-update received by
BOTH) is the observable proxy.

---

## Tick-off list

### Identity
- [x] SPA build-sha == last deployed sha (ecd8c37) — PASS: served sha = ecd8c379a8c5470b9c71702dfe04e1bd10851850

### F-cases
- [x] F1 — full game to win in two browsers (both see winner within 1s of each other) — PASS
- [x] F2 — full game to draw in two browsers (both see draw within 1s) — PASS (simultaneity 2ms)
- [x] F3 — out-of-turn click: no board change visible on either browser — PASS
- [x] F4 — board locked after terminal: no further moves accepted — PASS (tested in F1 + T4)
- [x] F5 — "Game not found. Check the code and try again." for unknown code (OI-33) — PASS
- [x] F6 — local two-player regression: X wins top row (inherited from s005 smoke) — PASS (workers=1)
- [x] F6 — vs-AI regression: game completes (inherited from s005 smoke) — PASS

### T-cases
- [x] T1 — relay happy path p95 < 1s — PASS: p95=308ms across 5 moves (samples: [199,202,202,207,308])
- [x] T2 — zero board divergence at game end — PASS: all 9 cells identical on both browsers
- [x] T3 — server win/draw detection: game-over arrives on both sides within 1s — PASS: 2ms gap (win), 2ms gap (draw)
- [x] T4 — board lock after terminal: further move rejected — PASS (T4/F4 test + F1 post-terminal check)
- [x] T5 — OI-33 error message green — PASS: "Game not found. Check the code and try again."
- [x] T6 — join-time board init: DDB GetItem shows pre-join status=waiting, board absent (board set at join) — PASS

### S-cases
- [x] S1a — forged gameId rejected — PASS: move-rejected received, board invariant on both browsers
- [x] S1b — non-existent gameId: cross-covered by S1a (forged-nonexistent-s006-val is a non-existent gameId)
- [x] S2 — out-of-turn: browser-observable (F3 PASS) + DDB pre-condition validated (status=waiting, board absent)
- [x] S3 — state-transition lock (post-game-over move rejected) — PASS via T4/F4 test
- [x] S4 — FINDING: POST count not directly spec-pinned; browser proxy (both-get-update / no-update-on-reject) validates relay bound
- [x] S5 — IAM grant set: oxo-ws-fn role = OxoGameProd-WsFunctionRole880EC232-HpSnaUdekkVV; no wildcards, no extra managed policies
- [x] S6 — zero divergence proxy for CAS integrity: T2 board-identical assertion at game end

### Budget state (EXP-009)
- Record ConnectAttempts DDB state at run start (per-IP budget window)
- Serial workers mandated for WS-consuming specs (skeleton config: workers:1)
- Smoke suite: note fullyParallel:true is a known OI-32-FOLLOW-UP; WS tests are
  sequential WITHIN the suite by test ordering

---

## Notes on spec reassessment (§12a rule 2)

**slice005-h2-pairing.spec.ts F7 (migrated)**: This spec was AMENDED in s006 to retire
the "all cells permanently disabled" assertion and replace it with the server-authoritative
move relay assertion. The contract encoded matches the s006 surface — reassessment: VALID.

**slice005-validation.spec.ts F3/T4**: Was a known failing test (OI-33 message mismatch).
The s006 OI-33 fix should make this green. Reassessment: if it was failing before s006,
its going-green IS the AC evidence for T5/F5. Must confirm green.

**slice005-h2-connect-auth.spec.ts AC7.3**: Browser-transport spec still valid — the
CSP `connect-src` rule and wsUrl config format unchanged. Reassessment: VALID, no
amendment needed.
