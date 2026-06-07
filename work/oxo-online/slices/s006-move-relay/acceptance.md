---
slice: s006
slug: move-relay
gate: GATE-2-S006 (approved)
co-authored: product + solution-architect
---

# Acceptance — s006: Move relay + server-authoritative play

Three case classes:
- **F-cases (product / customer-observable)** — owned by Product. These are the
  conditions a real user in a real browser experiences. The slice delivers its
  first-ever end-to-end core-job payoff: two people playing a complete game to a
  result.
- **T-cases (technical / observable)** — owned by Solution Architect, lifted
  verbatim-or-tightened from delta 006 T1–T6. Encode the relay mechanism,
  server-authoritative contract, and infrastructure checkable conditions.
- **S-cases (security policy)** — owned by Solution Architect, lifted
  verbatim-or-tightened from delta 006 S1–S6. Encode the trust rules, grant pins,
  and CAS integrity conditions.

Every case is tagged to its use case(s). The coverage map at the end shows
T/S distribution across UCs.

---

## F-cases — product / customer-observable

### F1 — Full online game to win, both browsers [UC6]
Two players in separate browsers can play a complete online game of noughts and
crosses to a win. Every move made by one player appears on the other player's
board without that player doing anything — the board updates automatically.
When the last winning move is played, both browsers show the winner ("X wins"
or "O wins") within 1 second of each other and neither player can make further
moves.

Observed in: AC6.1.

### F2 — Full online game to draw, both browsers [UC6]
Two players can play a game in which all nine squares are filled with no winning
line. Both browsers show a draw result within 1 second of each other. Neither
player can make further moves after the draw is declared.

Observed in: AC6.2.

### F3 — Out-of-turn click does nothing visible beyond a polite rejection [UC6]
If a player clicks a square when it is not their turn, the board does not change.
The other player's board does not change either. The clicking player may receive
a `move-rejected` signal (internal; no disruptive error screen), and the game
continues normally on both sides.

Observed in: AC6.3.

### F4 — Result shown to both players; board locked after result [UC6]
After a win or draw is declared, the result is visible to both players. No further
moves are accepted — clicking the board has no effect. The game is over.

Observed in: AC6.1, AC6.2, AC6.4.

### F5 — "Game not found" message when code is wrong (OI-33) [UC4, UC6]
When a player enters a game code that does not exist and tries to join, they see
the message "Game not found. Check the code and try again." — not a generic
error. This gives the player actionable guidance to check their code.

Observed in: AC4.5, AC6.8.

### F6 — Local two-player and vs-AI modes unaffected [UC4]
A player using local two-player mode or playing against the AI can complete a
full game without any regression. The online changes do not touch these modes.

Observed in: AC4.6, AC4.7.

---

## T-cases — technical / observable

T-cases are lifted verbatim-or-tightened from delta 006. Each carries its
original T-id.

### T1 — Relay happy path [UC3, UC6]
With an `active` game and both connections bound, a valid in-turn `move` from the
current player results in a `board-update` to **both** connections within 1s
(p95 over ≥10 moves), with identical `board` and the `currentTurn` flipped to
the other role.

Observed in: AC3.1, AC6.1, AC6.5.

### T2 — Zero divergence [UC6]
At game end, the `board` rendered in browser A equals browser B square-for-square
(slice success-measure #4).

Observed in: AC6.1, AC6.2.

### T3 — Server win/draw detection [UC3, UC6]
A winning line produces a `game-over` `result:'X-wins'|'O-wins'` to both
connections; nine filled squares with no line produces `result:'draw'` to both;
both within 1s of each other (slice success-measure #3).

Observed in: AC3.2, AC6.1, AC6.2.

### T4 — Board lock after terminal [UC3, UC6]
After `game-over`, a further `move` from either connection is rejected
(`move-rejected`) and a `GetItem` on `Games` shows `status ∈ {won, drawn}` and
`board` unchanged.

Observed in: AC3.3 (pre-terminal rejection in unit test), AC6.4 (post-game-over
lock in prod).

### T5 — OI-33 error message [UC4, UC6]
Joining a non-existent code yields the readable "Game not found. Check the code
and try again." message in the browser UI. The prior generic "Something went
wrong. Please try again." text is gone. The previously failing s005 case F3/T4
(slice005-validation.spec.ts) goes green.

Observed in: AC4.5, AC6.8.

### T6 — Join-time board init [UC2, UC6]
After a successful `join`, a `GetItem` shows `board="---------"`,
`currentTurn="X"`, `version=0`, `moveCount=0` (set in the join conditional write,
not lazily on first move).

Observed in: AC2.5 (local adapter), AC6.1 / AC6.2 (prod — implicitly: the first
move succeeds against the initialised fields).

---

## S-cases — security policy

S-cases are lifted verbatim-or-tightened from delta 006. Each carries its
original S-id.

### S1 — Sender-is-a-player identity binding [UC3, UC6] (amended 2026-06-07)
The move frame is `{ action:'move', gameId, square }` where `gameId` is a
**non-trusted lookup key**. A `move` is accepted ONLY when, after
`GetItem(Games, gameId)`, `event.requestContext.connectionId` equals the
`hostConnectionId` or `guestConnectionId` of THAT item, AND that connection's
role equals `currentTurn`. The role is derived server-side from the
connectionId↔game binding, **never** from a client-supplied
`role`/`player`/`connectionId`/`gameId` field. Each of these yields
`move-rejected` with **no write**:
- **S1a forged/foreign gameId** — a `move` whose `gameId` names a game the
  sender's REAL connectionId is not bound to → matches neither slot → reject.
- **S1b non-existent gameId** — `GetItem` miss → reject.
- **S1c spectator/stale/wrong-game connection** on the sender's own game → reject.
`gameId` selects which record to authorize against; it cannot promote the sender
into a role its connectionId does not hold.

Observed in: AC3.4, AC6.6 (plus the explicit forged-gameId case S1a).

### S2 — Turn enforcement, DynamoDB unchanged on rejection [UC3, UC6]
An out-of-turn `move` yields `move-rejected` to the sender only and a `GetItem`
confirms `board` and `currentTurn` are byte-identical to pre-move state
(slice success-measure #2).

Observed in: AC3.3, AC6.3.

### S3 — State-transition lock by condition, not just code [UC2, UC3]
No accepted write occurs when `status ≠ 'active'`; this is enforced by the
`UpdateItem` `ConditionExpression` (`status = 'active'` AND `currentTurn =
senderRole` AND `version = expected`), proven by a test that mutates `status` to
`won` out of band and shows a subsequent `move` writes nothing.

Observed in: AC2.3 (local adapter terminal lock test), AC2.6 (synth/code-policy
pin — ConditionExpression asserted present), AC6.4 (prod — post-game-over
rejection confirmed).

### S4 — Relay amplification bound [UC3]
An accepted non-terminal move triggers **exactly 2** `@connections` POSTs
(terminal ≤ 4); a rejected move triggers **1** POST and **0** writes — asserted
via the transport-port spy locally and observable in cloud logs.

Observed in: AC3.1 (2 POSTs on non-terminal), AC3.2 (4 POSTs on terminal),
AC3.3 (1 POST on reject, 0 writes), AC3.7 (GoneException best-effort posture).

### S5 — No grant widening [UC3]
`oxo-ws-fn`'s IAM policy is byte-for-byte the s005 grant set — `move` added zero
permissions (no new action, no `*`). Verified by policy test on the synthesised
role.

Observed in: policy test (engineer deliverable per delta confirmation — no
dedicated AC in this file; the synth-contract suite carries it).

### S6 — Square-free + version CAS [UC2, UC3, UC6]
Two near-simultaneous moves on the same free square result in exactly one
accepted write (`version`+1) and one `move-rejected`; the board never holds two
writes for one click (no lost move / no double-fill).

Observed in: AC2.2 (stale-version rejection in local adapter), AC3.5 (version-
race path in handler unit test), AC6.1 / AC6.2 (prod: zero-divergence check
implicitly validates no double-fill occurred across the game).

---

## Coverage map (T/S cases → use cases)

| UC | F-cases | T-cases | S-cases |
|----|---------|---------|---------|
| UC1 (move domain core) | — | — | — (UC1 outcome feeds into T1/T3/S2/S6 via UC3) |
| UC2 (Games store adapter) | — | T6 | S3, S6 |
| UC3 (ws-fn move route) | — | T1, T3, T4 | S1, S2, S3, S4, S5, S6 |
| UC4 (SPA move/render/OI-33) | F5, F6 | T5 | — |
| UC5 (local stand-up) | — | — | — (UC5 is the BUILD-phase harness; its ACs are engineer tests, not tester cases) |
| UC6 (prod validation) | F1, F2, F3, F4, F5 | T1, T2, T3, T4, T5, T6 | S1, S2, S3, S6 |

Counts: **6 F-cases, 6 T-cases, 6 S-cases** = **18 acceptance cases** in this
file (plus 27 individual AC-ids in use-cases.md that the engineer and tester
turn into test specs).

---

## Open risks carried to prod validation

- **OR-S006-a — version re-read single retry vs strict reject:** a legitimate
  near-simultaneous move that loses the version CAS is rejected (player re-clicks)
  rather than auto-retried beyond one re-read, to protect the <1s p95. Bounded,
  deliberate.
- **OR-S006-b — relay is best-effort (no per-post retry / no GoneException
  cleanup):** a dropped `@connections` push is not re-pushed this slice; recovery
  is reconnect-replay in s007. Authoritative board is always correct in `Games`.
- **OR-H2-b (inherited):** guest code-as-credential pre-join — unchanged, closed
  by C6 identity work.
- **OI-10 (inherited):** no reconnect-after-reload — deferred to s007.
