---
slice: s015
slug: chat-scope-done
chunk: C7 (CLOSES)
process-ref: §37 + §12b (cross-game isolation is an inherently multi-instance property — three browser contexts)
co-authored: product + solution-architect
gate: GATE-2-S015 (passed) + GATE-3-S015 (§9a auto-accept)
---

# Use cases — s015: C7 done-condition validation (cross-game isolation + p95 + game-over)

## §12b Multi-instance model

s015 has NO new build. It is a validation-only closing slice: three guards over the
already-deployed s014 chat relay. The critical guard — cross-game isolation (S-SCOPE-1)
— is an INHERENTLY multi-instance property. It cannot be validated with a single
browser or a single game; it requires **three browser contexts across two games**
to prove that frames from game G1 never reach game G2's connection.

### Parties

- **C1 (G1 host):** browser A, connected WS, player in game G1.
- **C2 (G1 guest):** browser B, connected WS, player in game G1. C1 and C2 form the
  complete game G1.
- **C3 (G2 player):** browser C, connected WS, player in a SEPARATE game G2. C3 is
  NOT bound to G1's `Games` item. C3 is the isolation witness.
- **Tester:** orchestrates the three browsers (Playwright multi-context), observes
  C3's WS frame log.

This is the §12b three-connection model. The isolation is by-construction in the s014
relay (delta 012 §2), but must be proven from the outside with the real prod
`@connections` relay to close C7.

---

## Parallel / serial call

This slice is **TESTER-OWNED** throughout. No build dependency, no engineer work
unless the tester finds game-over chat still visible in prod (which would be a DEFECT
against s014 — register/defect flow, not s015 scope creep).

```
Single set — all validation, no build:
  UC1 — C7 done-condition validation (S-SCOPE-1, T-P95-1, T-GAMEOVER-1, S-regression)
```

One use case. No dependency edges within s015. No parallel set — the three guards
(cross-game isolation, p95, game-over) are asserted in a single prod validation
run; none depends on the others' results.

---

## UC1 — C7 done-condition validation: cross-game isolation (prod) + formal p95 (prod) + game-over chat absent (guard)

**ID:** UC1
**Actor:** Tester (prod validation spec, post-s014-deploy).
**Trigger:** s014 is deployed to prod; the three guards have not yet been committed
as formal acceptance evidence for C7's done condition.

### Trigger -> observable outcome

The tester exercises the deployed s014 system across three guards, in prod, using
real WS connections against the real `@connections` Management API:

**Guard 1 — S-SCOPE-1: Cross-game isolation (§12b three-connection model)**

Three browser contexts are opened:
- C1 and C2 join the SAME game G1 (G1 is active; both players connected).
- C3 joins a SEPARATE game G2 (different `gameId`; C3's `connectionId` is bound to
  G2's `Games` item only).

C1 and/or C2 send >=3 chat messages within G1. C3's WS frame log is observed for the
full duration. Expected: C3 receives ZERO `chat-message` frames, zero frames of any
type originating from G1's chat activity.

Strengthened forms also asserted (delta 012 §2): a forged/foreign `gameId` frame
(connectionId bound to G2's item but `gameId` pointing to G1) resolves to a `Games`
item the sender is not bound to → reject, zero relay, zero echo. C3 stays silent.

**Guard 2 — T-P95-1: Formal p95 latency proof (>=5 sends)**

Two connected players in an active game (may be G1 from Guard 1, or a fresh game).
>=5 chat messages sent in sequence. For each send, the wall-clock interval from
"send dispatched" to "opponent's `chat-message` frame visible in DOM" is measured.
p95 of those >=5 samples is <=1000ms.

Background: s014 UC3 prod validation recorded a single-sample latency of 199ms
(PASS). s015 makes the p95 assertion formal and committed, as required by C7's
done condition (delta 012 §7 / T-P95-1).

**Guard 3 — T-GAMEOVER-1: Chat input absent on game-over (already-built gate)**

Once a `game-over` frame is received by both browsers (a game in G1 is played to
completion), the chat input and Send button are NOT present in the DOM. The
`ChatInput` component's render gate (`result === undefined`) was built in s014; this
guard pins that it holds in the deployed prod artefact.

If the chat input IS present post-game-over, that is a DEFECT against s014's stated
design: register via the defect flow (project: oxo-online; priority: core-job risk)
and assign to the engineer before closing C7.

**Guard 4 — S-regression**

All existing game/move/join/disconnect/leaderboard/s014-chat flows produce identical
outcomes. Chat is purely additive; this guard confirms no regression was introduced
by s014's deploy.

### Done condition

All of the following pass in prod:
- AC1.1 (S-SCOPE-1 cross-game isolation — §12b three-connection, C3 receives zero frames).
- AC1.2 (S-SCOPE-1 strengthened — forged gameId → reject, C3 zero frames).
- AC1.3 (T-P95-1 — p95 <=1000ms over >=5 sends, prod timing).
- AC1.4 (T-GAMEOVER-1 — chat input absent on game-over in prod).
- AC1.5 (S-regression — all prior acceptance cases identical outcomes).

### Acceptance cases (UC1)

- **AC1.1** (S-SCOPE-1 — isolation main case): Playwright three-context test in
  prod — C1 host + C2 guest in game G1 (both WS connected); C3 as player in
  separate game G2 (WS connected, different `gameId`). C1 sends >=3 chat messages
  to C2 in G1. Assertion: C3's WS frame log for the full duration contains ZERO
  frames with `action === 'chat-message'`. C3's game G2 screen is unchanged.
- **AC1.2** (S-SCOPE-1 — strengthened forged-gameId case): C3 (bound to G2) sends
  a WS frame `{action:'chat', gameId:<G1's gameId>, text:'probe'}`. Assertion: the
  handler rejects — C3's `connectionId` does not match G1's host/guest ids → zero
  relay POSTs; C1 and C2 receive NO frame; the `oxo-ws-fn` log shows rejection
  (zero PostToConnection calls for that frame).
- **AC1.3** (T-P95-1 — formal p95): Two connected players in an active game.
  >=5 chat messages sent in sequence; for each, the interval from send dispatch to
  opponent's `chat-message` frame appearing in `data-testid="chat-messages"` is
  measured. Assertion: p95 of the >=5 samples is <=1000ms (measured in prod, real
  `@connections` relay, real network round-trip, eu-west-2).
- **AC1.4** (T-GAMEOVER-1): A game in prod is played to completion (a player wins
  or a draw occurs). The `game-over` WS frame is received by both browsers. Post
  game-over: `data-testid="chat-input"` and `data-testid="chat-send-btn"` are
  NOT present in the DOM on either browser's result screen. The chat panel (`data-
  testid="chat-panel"`) is also absent (render gate: `result === undefined`).
- **AC1.5** (S-regression): Existing flows — game creation, move submission,
  `game-over` delivery, `$disconnect` abandon + survivor notification, leaderboard
  read, copy-code + copy-link controls — produce identical outcomes to their
  pre-s014 acceptance cases. Specifically: s014's own AC3.1..AC3.10 (s014 UC3
  validation cases) continue to pass against the deployed artefact.

### Dependencies

- Requires s014 deployed to prod (all three guards exercise the live relay).
- No build dependency — no engineer work required unless T-GAMEOVER-1 reveals a
  defect (register/defect flow in that case; C7 remains open until defect is closed
  and guard re-asserted).

---

## .mmd change

NO change to `use-case-deps.mmd` required. s015 is a pure-validation slice with
no new build; it guards existing delivered behaviours already represented by the
s014 nodes (S14UC1, S14UC2, S14UC3). The s014 nodes are already in the graph; s015
adds no new behaviour nodes. Per §37, `classDef changed` marks are added for new
or CHANGED nodes — s015 introduces neither.

At delivery (C7 done-condition MET), the s014 `changed` marks are CLEARED to
`delivered` in the same commit (following the REMOVE-not-recolour convention). That
.mmd change belongs to the delivery commit, not the co-author step.

---

## Infra enabler notes (co-decided with solution-architect)

None. s015 has no new infrastructure, no new route, no new function, no new IAM
grant, no new data flow. The tester connects to the existing prod WS API endpoint
using Playwright multi-context. No CDK change, no deploy required.
