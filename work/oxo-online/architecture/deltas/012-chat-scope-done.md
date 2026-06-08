# Delta 012 — s015 chat scope-done: cross-game isolation guard + p95 proof + game-over UI-state (C7 CLOSES)

Slice: `work/oxo-online/slices/s015-chat-scope-done/slice.md` (GATE-2-S015, iteration 18).
Chunk: C7 (in-game chat — last forecast chunk). s014 opened it; **s015 closes it.**
Path: **ARCH-LITE / §9a auto-accept.** This slice GUARDS existing behaviour; it
does NOT add a feature, surface, route, principal, store, IAM grant, or data flow.

## 0. One-line delta

NO new infrastructure, NO new route, NO new data flow. s015 commits three
guards over the EXISTING s014 chat relay: (1) a PROD test that a third WS
connection in a DIFFERENT game receives ZERO `chat-message` frames (T-CHAT-2
waived to s015 at s014 — the cross-game scope-isolation S-case); (2) a formal
p95 latency proof (<=1000ms over >=5 sends); (3) confirmation that chat
input is absent on the game-over screen. The cross-game isolation is an
EXISTING property of the s014 relay (delta 011) — s015 PINS it, it does not
change it.

## 1. Why this is arch-lite (assert-the-negatives)

- **No new route.** WS API stays at SIX routes
  (`$connect`/`$disconnect`/`register`/`join`/`move`/`chat`); still no `$default`.
- **No new function / principal / store / API / stage / region.** Same `oxo-ws-fn`,
  same `@connections`, same `Games` read, eu-west-2.
- **No new IAM grant.** The s007 grant set verbatim (the s014 baseline).
- **No new data flow.** Every edge s015 exercises already exists (delta 011).
  This is a guard ON existing flows, not a new flow.
- **No new platform mechanism** (§ New-mechanism flag: **NO**). The relay and
  `connectionId`-identity were proven by real-client probes at s005-h2/s006 and
  exercised end-to-end at s014 (UC3 prod PASS, cross-instance latency 199ms).
  No walking-skeleton probe required.
- **No new deployable surface** (§ principles/01). `oxo-ws-fn` build identity is
  the EXISTING `buildSha` in its structured CloudWatch log lines — unchanged
  carrier. s015 adds tests, not a surface; nothing new to version-stamp.

## 2. The cross-game isolation is an EXISTING property — by-construction argument

The s014 chat handler (delta 011 §1) CANNOT fan out beyond the two connections
of the sender's OWN game. By construction:

1. `chat` frame carries `gameId` as a **NON-TRUSTED lookup key** only.
2. Handler does `GetItem(Games, gameId)` and reads `hostConnectionId` /
   `guestConnectionId` **from that ONE item** (the sender's own game, selected
   by the lookup key; if the key is forged/foreign, the resolved item is one the
   sender's `connectionId` is not bound to → step 3 rejects).
3. Sender authorization = match `event.requestContext.connectionId` (platform-set,
   unspoofable) against those two stored ids. Match NEITHER → **reject, zero
   relay, zero echo, zero write.**
4. On a match, the relay targets are EXACTLY those two stored connectionIds
   (opponent + echo to sender). **There is no broadcast path, no `Scan` over
   Connections, no enumeration of other games' connections, no `$default`
   handler.** The fan-out is a fixed 2-POST derived solely from the resolved
   `Games` item.

Therefore a connection C3 bound to a DIFFERENT game G2 is NEVER a relay target
of a chat sent in game G1: C3's `connectionId` is not on G1's `Games` item, and
the handler reads connectionIds only from the sender-game item it resolved.
**Isolation holds by construction** — it is the same authorization invariant
GATE-3-S006 approved for the move path, applied to the chat relay. s015 does
not modify this; it commits the prod GUARD that proves the invariant from the
outside (C3 observes zero frames).

## 3. Game-over UI-state — already satisfied by s014 (no code change)

s014 `ui-design.md` pins the chat input to render ONLY while the online game is
active: `ChatInput` renders only when `result === undefined` (the
`onlinePhase === 'playing-online'` branch). Once a `game-over` frame sets
`result`, the input is **absent** by the same render condition. s015 therefore
needs NO UI code change for this guard — it adds a test that pins the
already-built state (chat input absent/disabled once a result exists). If the
tester finds the input present post-game-over in prod, that is a DEFECT against
s014's stated design, not s015 scope creep. **Disposition: already satisfied;
s015 adds a guard test only.**

## 4. data-flow.mmd change: **NO**

No new edge, node, or gate. The s015 guards exercise edges that already exist
(and whose s014 marks are already CLEARED / delivered-stable in the file). Per
v39/OI-42 there is nothing to mark and nothing to REMOVE — a guard on a
delivered flow introduces no diagram delta. `data-flow.mmd` is unchanged this
slice.

## 5. Local stand-up gap (principles/02)

- **Stands locally:** the cross-game isolation logic (handler relay-target
  derivation) and the game-over render gate both stand locally — the engineer
  can run a THREE-connection local scenario (two browsers in G1 + one in G2 on
  the local WS adapter) and assert C3 receives zero `chat-message` frames, and
  can render the online board with `result` set and assert no `ChatInput`.
- **Cloud-only (control that covers it):**
  - The **p95 <=1000ms latency proof** is a real-network property of the
    deployed `@connections` relay — covered by **prod validation** (the
    committed prod p95 test over >=5 sends; local timing is not representative).
  - The **cross-game isolation in PROD** (T-CHAT-2 waived here) — covered by the
    committed **prod three-connection guard** (local proves logic; prod proves
    the deployed boundary on real `@connections`).

## 6. Retry/backoff posture

No new external call. The chat relay's posture is unchanged from delta 011 §7:
best-effort, **no retry**, `GoneException`(410) swallowed. s015 adds no call and
no new posture.

## 7. Acceptance conditions (T/S — architect-supplied half)

Co-authored with Product into `slices/s015-chat-scope-done/acceptance.md`.

- **S-SCOPE-1 (cross-game isolation — the security S-case, T-CHAT-2 from s014):**
  With game G1 having two connected players (C1 host, C2 guest) and a SEPARATE
  game G2 having connection C3 (a player of G2, NOT of G1), when C1 and/or C2
  send chat messages in G1, **C3 receives ZERO `chat-message` frames** for the
  duration. Asserted in PROD over the real `@connections` relay: C3's WS frame
  log contains no `chat-message` originating from G1. (Strengthened form also
  holds for a forged/foreign/non-existent `gameId` and a spectator/stale
  connection — match NEITHER bound id → reject, zero relay.)
- **T-P95-1 (formal p95 latency proof):** over >=5 chat sends between two
  connected players of the same active game, the p95 send→opponent-render
  latency is **<=1000ms**. Measured end-to-end in PROD (s014 mechanism PASS at
  199ms single-sample; s015 makes the p95 assertion formal and committed).
- **T-GAMEOVER-1 (chat absent on game-over):** once a `game-over` frame sets the
  online game `result`, the chat input and Send button are **absent/disabled**
  (already-built s014 render gate: `ChatInput` renders only when
  `result === undefined`). No chat input on the result screen, waiting screen,
  or mode selector.
- **S-regression:** all existing game/move/join/disconnect/leaderboard/s014-chat
  flows produce identical outcomes (C7 done-condition: both-screens update,
  isolation, p95, game-over gating).

## 8. Security conclusion (gated review) — VERBATIM

**Is there new attack surface / data flow / trust boundary? NO — s015 adds NO
route, function, principal, store, API, stage, region, persistence, IAM grant,
or data flow; it commits three GUARDS over the already-built, already-accepted
s014 chat relay: (1) a prod test of cross-game scope isolation, which is an
EXISTING property of the relay by construction — the handler derives its EXACTLY
two relay targets (opponent + echo-to-sender) solely from the host/guest
connectionIds stored on the ONE `Games` item resolved by the sender's
non-trusted `gameId` lookup key, after matching the platform-set, unspoofable
`event.requestContext.connectionId` against those two ids, with no broadcast, no
`Scan` over Connections, no `$default`, and no enumeration of any other game's
connections, so a connection bound to a different game can NEVER be a relay
target and observes zero chat-message frames (the same authorization invariant
GATE-3-S006 approved for the move path); (2) a formal p95 <=1000ms latency proof
over the unchanged `@connections` relay; and (3) a guard that the chat input is
absent on the game-over screen, which is already satisfied by the s014 render
gate (`result === undefined`) with no code change required; the XSS, CSP, IAM,
and connectionId-identity edges are all UNCHANGED from the s014 design accepted
under §9a at GATE-2-S014; therefore s015 introduces NO new attack surface and
the architect ACCEPTS the design for build under §9a auto-accept and does NOT
flag it for human eyes — this is a behaviour-pinning closing slice, not a new
surface.**

### §9a disposition
**AUTO-ACCEPT (no human flag).** Rationale: no new surface/flow/trust
boundary/grant; the cross-game isolation being pinned is an EXISTING
by-construction property of the s014 relay; the p95 proof and game-over gate are
guards on already-built behaviour. Flag basis for human eyes would be a NEW or
differently-controlled surface — none present.

### Carried open risks (accepted, named — unchanged from s014)
- OR-S014-a (unmoderated free-text abuse, LOW), OR-S014-b (best-effort no-retry
  relay), inherited OR-H2-b / OR-S006-a / OR-S006-b. s015 adds NO new open risk.
