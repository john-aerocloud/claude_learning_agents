---
slice: s015
slug: chat-scope-done
chunk: C7 (CLOSES — this acceptance is the C7 done-condition)
gate: GATE-2-S015 (passed) + GATE-3-S015 (§9a auto-accept)
co-authored: product + solution-architect
---

# Acceptance — s015: C7 done-condition validation

This slice has NO new build. All acceptance cases are tester-owned prod-validation
assertions over the already-deployed s014 chat relay. C7 (in-game chat) is CLOSED
when every case below passes.

Four case classes:

- **F-cases (customer-observable):** the conditions a real player experiences that
  prove the chat feature is correctly scoped: messages stay private to your game;
  they arrive fast; chat is gone when the game ends; existing flows are unaffected.
- **S-SCOPE-1 (cross-game isolation — the security S-case):** lifted verbatim from
  delta 012 §7. The §12b three-connection model: C1/C2 in G1, C3 in G2. C3 observes
  zero chat-message frames. This is T-CHAT-2 (waived to s015 at s014).
- **T-P95-1 (formal p95 latency proof):** lifted verbatim from delta 012 §7. >=5
  sends, p95 <=1000ms, prod timing. Formalises the informal s014 UC3 single-sample
  (199ms).
- **T-GAMEOVER-1 (chat absent on game-over):** lifted verbatim from delta 012 §7.
  Guard on s014's already-built render gate (`result === undefined`). If absent in
  prod this is a DEFECT against s014, not s015 scope creep.
- **S-regression:** existing game/move/join/disconnect/leaderboard/s014-chat flows
  produce identical outcomes.

Every case is tagged to UC1 (the single use case for this slice). Coverage map at
the end.

---

## F-cases — customer-observable

### F1 — Your chat stays private to your game [UC1]

When you and your opponent exchange chat messages in an active game, those messages
are visible ONLY to the two players in that game. A player in any other game — on
the same backend, at the same time — never sees your messages. This is the primary
scope guarantee: in-game chat is scoped to the game, not broadcast to all players.

Observed in: AC1.1, AC1.2 (S-SCOPE-1 cases).

### F2 — Messages arrive fast (under 1 second, formally) [UC1]

Across >=5 sends during a real game, the p95 time from "send pressed" to "message
visible on opponent's screen" is at most 1000ms. The s014 mechanism was observed at
199ms (single sample); s015 makes the p95 claim formal and committed.

Observed in: AC1.3 (T-P95-1).

### F3 — Chat is gone once the game is over [UC1]

After the game concludes (a player wins or a draw), the chat input and Send button
disappear from both players' screens. There is no chat input on the result screen,
the waiting screen, or the mode selector. A player cannot send chat outside of an
active game.

Observed in: AC1.4 (T-GAMEOVER-1).

### F4 — Existing flows unaffected [UC1]

All game creation, move submission, game-over delivery, opponent-disconnect, and
leaderboard flows work exactly as before s014. Chat is purely additive.

Observed in: AC1.5 (S-regression).

---

## S-SCOPE-1 — Cross-game isolation (T-CHAT-2 waived from s014)

**Source:** delta 012 §7, architect-supplied condition. This is a SECURITY S-case:
the relay MUST NOT leak chat frames across game boundaries. The isolation holds
by-construction in the s014 handler (delta 012 §2) — s015 commits the prod guard
that proves it from the outside.

### S-SCOPE-1 main case [UC1]

Three browser contexts in prod (§12b three-connection model):
- C1 = G1 host, C2 = G1 guest: both WS-connected, game G1 active.
- C3 = G2 player: WS-connected, separate game G2 (distinct `gameId`; C3's
  `connectionId` stored on G2's `Games` item only).

C1 sends >=3 chat messages to C2 within G1. C3's WS frame log is observed for the
full duration.

**Assertion:** C3 receives ZERO `chat-message` frames. C3's game G2 screen is
completely unaffected.

Mechanistic basis: the s014 handler resolves relay targets exclusively from the TWO
`connectionId` fields on the ONE `Games` item keyed by the sender's `gameId`. C3's
`connectionId` is not on G1's item; it therefore can never be a relay target for G1
chat. No broadcast path; no `Scan` over Connections; no `$default`.

Observed in: AC1.1.

### S-SCOPE-1 strengthened — forged gameId [UC1]

C3 (bound to G2) sends `{action:'chat', gameId:<G1's gameId>, text:'probe'}` over
its open WS connection. The handler resolves G1's `Games` item; C3's `connectionId`
matches NEITHER `hostConnectionId` NOR `guestConnectionId` on that item → reject,
zero relay POSTs.

**Assertion:** C1 and C2 receive NO frame. The `oxo-ws-fn` CloudWatch log shows
zero `PostToConnection` calls for that frame. C3's connection is not closed (the
rejection is silent — the handler returns normally).

Observed in: AC1.2.

---

## T-P95-1 — Formal p95 latency proof (>=5 sends, prod)

**Source:** delta 012 §7, architect-supplied condition. Formalises the s014 UC3
single-sample observation (199ms < 1000ms). This is NOT a local timing assertion
(local is not representative of the real `@connections` relay latency in
eu-west-2); it is a prod measurement over real network round-trips.

Two connected players in an active game. >=5 chat messages sent in sequence.
For each send: start timer at "SPA dispatches `{action:'chat', …}` over WS"; stop
timer when opponent's `data-testid="chat-messages"` list contains the new message
row (Playwright `waitForSelector` / `locator.waitFor`). Collect >=5 durations.

**Assertion:** p95 of the collected >=5 samples is <=1000ms (wall-clock, prod,
eu-west-2, `@connections` Management API round-trip included).

Observed in: AC1.3.

---

## T-GAMEOVER-1 — Chat input absent on game-over (already-built render gate)

**Source:** delta 012 §7, architect-supplied condition. s014 already satisfies this
by design: `ChatInput` renders only when `result === undefined`. s015 adds the guard
test that pins the already-built state in the deployed prod artefact.

A game in prod is played to completion (a player wins or a draw occurs). The
`game-over` WS frame is received and processed by both browsers (the online game
`result` field is set).

**Assertion:** post game-over, neither browser's DOM contains `data-testid=
"chat-input"` or `data-testid="chat-send-btn"`. The chat panel (`data-testid=
"chat-panel"`) is also absent from the DOM. This applies to: the result screen,
the waiting screen (if re-entered), and the mode selector.

**Defect clause:** if the chat input IS present post-game-over in the deployed prod
artefact, that is a DEFECT against s014's stated design. The tester registers it via
the register/defect flow (project: oxo-online; priority: core-job risk). C7 remains
open until the defect is closed and T-GAMEOVER-1 is re-asserted PASS.

Observed in: AC1.4.

---

## S-regression — All existing flows unaffected

**Source:** delta 012 §7, architect-supplied condition. C7 done-condition requires
that C7 closes without regressions in C1–C6.

All acceptance cases from s006 (move relay), s007 (disconnect), s008 (deep-link),
s009 (leaderboard/scoreboard), and s014 (chat send: AC3.1..AC3.10) produce
identical outcomes after s015 validation runs. Specifically:

- `move` relay and `game-over` WS timing: unaffected.
- `$disconnect` abandon + survivor notification: unaffected.
- `GET /api/leaderboard` + cross-browser tally: unaffected.
- Copy-code + copy-link controls: unaffected.
- s014 chat: bidirectional relay, echo, XSS text render, GoneException no-crash,
  CSP unchanged (all of s014 UC3 cases AC3.1..AC3.10): continue to pass.

Observed in: AC1.5.

---

## Acceptance cases — full list (UC1, all)

All cases are prod validation (tester-owned). No unit test, no synth test — s015
adds no code.

- **AC1.1** (S-SCOPE-1 main / F1): Playwright three-context test in prod. C1 + C2
  in active game G1 (both WS-connected). C3 in separate active game G2 (distinct
  `gameId`, WS-connected). C1 sends >=3 chat messages. Assertion: C3's WS frame
  log for the full send duration contains ZERO frames with `action === 'chat-message'`
  originating from G1's chat activity. C3's board and game state are unchanged.
  [S-SCOPE-1, F1]

- **AC1.2** (S-SCOPE-1 forged-gameId / F1): C3 (bound to G2) sends
  `{action:'chat', gameId:<G1's gameId>, text:'probe'}` over its live WS connection.
  Assertion: C1 and C2 receive NO frame. CloudWatch log for the `chat` invocation
  shows zero `PostToConnection` calls. C3's WS connection remains open (silent
  rejection). [S-SCOPE-1 strengthened]

- **AC1.3** (T-P95-1 / F2): Two players in an active game in prod. >=5 chat messages
  sent in sequence; wall-clock interval from SPA dispatch to opponent's
  `data-testid="chat-messages"` list update measured for each. Assertion: p95 of
  the >=5 samples is <=1000ms. [T-P95-1, F2]

- **AC1.4** (T-GAMEOVER-1 / F3): A game in prod is played to completion; `game-over`
  frame received by both browsers. Assertion: `data-testid="chat-input"`,
  `data-testid="chat-send-btn"`, and `data-testid="chat-panel"` are all absent from
  the DOM on both browsers' result screens. [T-GAMEOVER-1, F3]

- **AC1.5** (S-regression / F4): All prior acceptance cases for s006, s007, s008,
  s009 (leaderboard SM-1, copy controls), and s014 (UC3 cases AC3.1..AC3.10) produce
  identical outcomes against the deployed artefact. No regression introduced by
  s014's deploy. [S-regression, F4]

---

## Coverage map (cases → conditions)

| Condition | F-case | AC-ids |
|-----------|--------|--------|
| S-SCOPE-1 (cross-game isolation, main) | F1 | AC1.1 |
| S-SCOPE-1 (forged-gameId strengthened) | F1 | AC1.2 |
| T-P95-1 (formal p95 <=1000ms, >=5 sends) | F2 | AC1.3 |
| T-GAMEOVER-1 (chat absent post-game-over) | F3 | AC1.4 |
| S-regression (all prior flows unaffected) | F4 | AC1.5 |

**Case counts:**
- **F-cases: 4** (F1–F4)
- **S/T architect-supplied: 4** (S-SCOPE-1 main, S-SCOPE-1 strengthened, T-P95-1,
  T-GAMEOVER-1)
- **S-regression: 1**
- **Total acceptance cases: 5** (AC1.1–AC1.5)

All cases belong to UC1. All are tester-owned prod-validation. No unit test, no
synth test, no build step.

---

## C7 done condition

C7 (in-game chat) is done when:

1. s014 is deployed to prod (UC1, UC2, UC3 all PASS — already delivered).
2. AC1.1 (S-SCOPE-1 main) PASS.
3. AC1.2 (S-SCOPE-1 forged-gameId) PASS.
4. AC1.3 (T-P95-1 p95 <=1000ms) PASS.
5. AC1.4 (T-GAMEOVER-1 chat absent) PASS — or a DEFECT is registered and closed
   before the condition is re-asserted.
6. AC1.5 (S-regression) PASS.

On all six satisfied: **C7 CLOSED. The C1–C7 roadmap is complete.**

---

## Open risks carried forward (unchanged from s014)

- OR-S014-a (unmoderated free-text abuse, LOW — inherent to unauthenticated model)
- OR-S014-b (best-effort no-retry relay — harmless miss, recovery = re-send)
- Inherited: OR-H2-b, OR-S006-a, OR-S006-b, OR-S009-a, OR-S009-b, OR-S009-c,
  OR-S009-d.

s015 adds NO new open risk.
