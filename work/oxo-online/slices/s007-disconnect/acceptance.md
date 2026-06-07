---
slice: s007
slug: disconnect
gate: GATE-2-S007 (approved)
co-authored: product + solution-architect
---

# Acceptance — s007: disconnect & timeout handling

Three case classes:
- **F-cases (product / customer-observable)** — owned by Product. These are the
  conditions a real user in a real browser experiences. The slice closes the last
  known broken experience in the online play path: the board no longer freezes
  forever when one player disconnects.
- **T-cases (technical / observable)** — owned by Solution Architect, lifted
  verbatim-or-tightened from delta 007 T1–T7. Encode the disconnect handler
  mechanism, the conditional-abandon contract, and the idle-timeout posture.
- **S-cases (security policy)** — owned by Solution Architect, lifted
  verbatim-or-tightened from delta 007 S1–S6. Encode the cross-game force-abandon
  guard, the conditional-write lock, the amplification bound, and the IAM/WAF pins.

Every case is tagged to its use case(s). The coverage map at the end shows
T/S distribution across UCs.

---

## F-cases — product / customer-observable

### F1 — Survivor sees "opponent disconnected" and reaches mode selector without reload [UC1, UC3, UC4]

When the opposing player closes their tab (or loses network) during an active
online game, the surviving player sees the message "Your opponent disconnected."
within 10 seconds and is returned to the mode selector screen without a browser
reload. The surviving player can immediately start a new game by clicking "Online"
— no stuck board, no manual reload required.

Observed in: AC4.1 (two-browser Playwright smoke), AC4.5 (new-game flow).

### F2 — Surviving player can start a new game immediately after disconnect [UC3, UC4]

After the opponent-disconnected transition, the mode selector is rendered and
functional. Clicking "Online" initiates a fresh game creation flow. No prior
game state (board, gameId, WS connection) leaks into the new session.

Observed in: AC3.4, AC4.5.

### F3 — Finished games are unaffected by a late tab-close [UC1, UC4]

If a player closes their tab after the game has already ended (after seeing the
win or draw result screen), the Games record is NOT overwritten to `abandoned`.
The status remains `won` or `drawn`. The survivor does not receive a spurious
"opponent disconnected" message after the game is over.

Observed in: AC4.4.

### F4 — Local two-player and vs-AI modes unaffected [UC3, UC4]

A player using local two-player mode or playing against the AI can complete a
full game without any regression. The disconnect handling code path is not
reached in these modes.

Observed in: AC3.5, AC3.6, AC4.7.

---

## T-cases — technical / observable

T-cases are lifted verbatim-or-tightened from delta 007 T1–T7. Each carries
its original T-id.

### T1 — Abandon on active disconnect [UC1, UC4]

With an `active` two-player game, closing one connection causes a `GetItem` on
the `Games` record to show `status = abandoned` within the smoke window
(success-measure #2). The conditional `UpdateItem` committed; the game is
permanently marked abandoned, not left `active`.

Observed in: AC1.1, AC4.2.

### T2 — Survivor notified < 10s [UC1, UC3, UC4]

The surviving connection receives exactly one `{ type: 'opponent-disconnected' }`
frame, and the SPA returns to the mode selector without reload, within 10s of
the other tab closing (success-measure #1 — two-browser Playwright).

Observed in: AC1.1, AC4.1.

### T3 — No stale connectionId [UC1, UC4]

After the `$disconnect` flow, a `GetItem`/`Query` shows the disconnecting
`connectionId` row is absent from `Connections`; the survivor's row is intact
(success-measure #3).

Observed in: AC1.1, AC4.3.

### T4 — Terminal not overwritten [UC1, UC4]

A `$disconnect` fired after `game-over` (tab closed on the result screen) does
NOT change `Games.status` — a `GetItem` shows it remains `won`/`drawn`, and
zero `opponent-disconnected` posts were sent (success-measure #4). The
conditional guard (`ConditionExpression: status = :active`) is the enforcement
mechanism, not application-level branching alone.

Observed in: AC1.2, AC1.8, AC4.4.

### T5 — Waiting-host thin handling [UC1, UC4]

A host that closes its tab while `waiting` (no guest) leaves `Games.status =
waiting` (NOT `abandoned`), sends zero posts, and its `Connections` row is
deleted. The `waiting` game is left to the 24h `Games` TTL.

Observed in: AC1.3, AC4.8.

### T6 — New-game after disconnect [UC3, UC4]

After the opponent-disconnected transition, the mode selector is functional —
clicking "Online" initiates a fresh create flow with no reload (success-measure
#5). No prior game state, WS session, or board leaks into the new flow.

Observed in: AC3.4, AC4.5.

### T7 — Idle-timeout path [UC1] *(documented; prod-validated; not a 10-min CI test)*

A connection left idle beyond the APIGW 10-minute idle close fires the same
`$disconnect` abandon+notify path — the platform fires the identical event.
Named on the data-flow node so the tester knows the survivor-notify latency
ceiling for a silent drop is bounded by the 10-min idle close, not by anything
we built. Not gated by a 10-minute test in CI.

Observed in: AC1.9 (structured log carrier confirms handler ran on any
`$disconnect` trigger, including idle close).

---

## S-cases — security policy

S-cases are lifted verbatim-or-tightened from delta 007 S1–S6. Each carries
its original S-id.

### S1 — No cross-game force-abandon: connectionId IS the identity [UC1]

A `$disconnect` can only abandon the game bound to the DISCONNECTING connection's
own `connectionId` (resolved via `GetItem(Connections,
event.requestContext.connectionId)`). There is no client-supplied `gameId` or
`connectionId` on the `$disconnect` event — the platform sets the `connectionId`
and the handler reads it from `requestContext`, never from a body. A client
cannot force-abandon another player's game (no spoof path). Proven by a test
that confirms the only game touched is the one whose `host`/`guestConnectionId`
equals the disconnecting connection.

Observed in: AC1.1 (only the bound game is touched), AC1.4 (no-row → no-op),
AC1.7 (simultaneous — only the first to commit acts).

### S2 — Abandon is conditional, not unconditional [UC1]

The abandon write carries `ConditionExpression: status = :active`. A test
mutates `status` to `won` out of band and shows a subsequent `$disconnect`
writes nothing (the won/drawn guard is the condition, not code alone — mirrors
s006 S3).

Observed in: AC1.2 (terminal branch — 0 UpdateItem), AC1.8 (synth/code-policy
pin — ConditionExpression asserted present).

### S3 — Notification amplification bound = 1 (OI-35 S4 log-derived pin) [UC1, UC4]

An active-game disconnect triggers exactly 1 `@connections` POST (to the
survivor only); a terminal/waiting disconnect or a survivor `GoneException`
triggers 0; never a broadcast. Asserted via the transport-port spy locally
(AC1.1, AC1.6) and the OI-35 Logs Insights count in cloud (AC4.6): exactly
1 `disconnect-notify posted:1` per active-game `$disconnect`, 0 otherwise.

Observed in: AC1.1, AC1.2, AC1.3, AC1.6, AC4.6.

### S4 — No retry storm on survivor GoneException [UC1]

A survivor post that returns 410 Gone is swallowed with zero re-posts —
asserted via the local GoneException stub: post-attempt count = 1, retries = 0.
The game is already `abandoned`; no re-post storm is possible.

Observed in: AC1.6.

### S5 — Exactly one IAM grant added, nothing else [UC2]

`oxo-ws-fn`'s IAM policy is the s006 grant set PLUS exactly `dynamodb:GetItem`
on the `Connections` table ARN only — no `Query`, no `Scan`, no second table,
no `*`, and no widening of `ManageConnections`/`UpdateItem`/`DeleteItem`. Both
the positive assertion (the one add) and the negative assertion (nothing else
changed) are in the synth/policy test. This test changes EXACTLY ONE assertion
from the s006 pin.

Observed in: AC2.1 (positive arm), AC2.2 (negative arm).

### S6 — IMP-008 preserves AC3.1 block for non-runner IPs [UC2, UC4]

The CloudFront rate rule's `NOT(IPSetReferenceStatement oxo-test-runner-ips)`
scope-down leaves the Block action and limit unchanged for any source IP NOT in
the set; `slice005-h1-waf-ac3.1.spec.ts` (or its equivalent) stays green for
a non-runner source. The IP set mutation is deploy-role/runner-script only and
entries are transient (added per-run, removed by `trap`, drained ≤24h by the
drain Lambda).

Observed in: AC2.4, AC2.6, AC4.9.

---

## Coverage map (T/S cases → use cases)

| UC | F-cases | T-cases | S-cases |
|----|---------|---------|---------|
| UC1 ($disconnect handler) | F3 | T1, T2, T3, T4, T5, T7 | S1, S2, S3, S4 |
| UC2 (infra: grant + IMP-008) | — | — | S5, S6 |
| UC3 (SPA survivor UX) | F1, F2, F4 | T2, T6 | — |
| UC4 (prod validation) | F1, F2, F3, F4 | T1, T2, T3, T4, T5, T6 | S3, S6 |

Counts: **4 F-cases, 7 T-cases, 6 S-cases** = **17 cases** in this file
(plus individual AC-ids in use-cases.md that the engineer and tester turn into
test specs: 9 in UC1, 6 in UC2, 6 in UC3, 9 in UC4 = **30 AC-ids total**).

---

## Open risks carried to prod validation

- **OR-S007-a — `Connections:GetItem` is a real (if minimal) grant widening:**
  the `$disconnect` path now reads `Connections`. Bounded to a single primary-key
  read of the disconnecting connection's own row (no `Query`/`Scan`, cannot
  enumerate other games' connection rows). Accepted as the minimum to resolve
  connectionId→gameId. If a connection→game GSI on `Games` is ever added for
  another reason, `$disconnect` could resolve via `Games` and this grant could
  be dropped.
- **OR-S007-b — survivor notify is best-effort, single attempt:** a survivor on
  a flaky link that misses the one `opponent-disconnected` post is not re-notified;
  their own `$disconnect`/2h TTL or a manual reload recovers them. Bounded,
  deliberate (no retry storm — S4). **This CLOSES OR-S006-b** (the s006 best-
  effort-relay risk whose stated recovery was "reconnect-replay in s007"): per
  the OI-10 ruling, relay-loss recovery is abandon + notify (this slice), NOT
  reconnect-replay.
- **OR-S006-b (re-worded, 2026-06-07, s007):** the `@connections` relay is
  best-effort (no per-post retry; a dropped board-update push is not re-pushed).
  The authoritative board in `Games` is always correct; only the push can be
  missed. Recovery is graceful disconnect — abandon + survivor-notify (s007),
  NOT reconnect-replay. Reconnect-replay is unscheduled (candidate for a
  C6-adjacent slice or never; per OI-10).
- **OR-H2-b (inherited):** guest code-as-credential pre-join — unchanged, closed
  by C6 identity work.
- **OR-S006-a (inherited):** version CAS reject vs retry — unrelated, unchanged.
