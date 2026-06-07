---
slice: s007
slug: disconnect
status: in-planning
decision-log-ref: SEL-S007
chunk: C4
created: 2026-06-07
---

# s007 — disconnect & timeout handling

## Job served

**[CORE] Playing against a real human** — resilience dimension.

When my opponent vanishes mid-game (closes the tab, loses network), I want to
know promptly what has happened and be able to move on, so that I am not left
staring at an unresponsive board with no way to start a new game without a
manual reload.

This slice closes the last known broken experience in the online play path:
the board currently sits frozen forever when one player disconnects, offering
the surviving player no feedback and no exit.

---

## Killick test

Could a user do something valuable they could not do before?

YES. Before s007, if the opponent closes their browser during a game, the
surviving player sees nothing — the board just stops. The only way to start
another game is a manual page reload. After s007, the surviving player sees
an "opponent disconnected" message within 10 seconds and is returned to the
mode selector without reloading. They can immediately start a new game. That
is a real capability they did not have before.

The test in the other direction (without reconnect): if reconnect were also
in s007, it would add significant scope (re-issuing credentials, re-pairing
logic, state replay). Without it, the slice still passes the Killick test on
its own — the survivor regains agency. Reconnect is a separate, additive
improvement.

---

## Thin scope

**$disconnect Lambda — abandon and notify:**

1. When API Gateway fires the `$disconnect` event (player closes tab, network
   drop, or idle timeout), the `$disconnect` Lambda (currently a stub) is
   updated to:
   - Look up the disconnecting connectionId in the `Connections` table to find
     the associated `gameId`.
   - Read the `Games` record for that game.
   - If the game status is `active`: update status to `abandoned` in an atomic
     conditional write (condition: `status = active` to avoid a race with a
     simultaneous second disconnect).
   - Post an `opponent-disconnected` message to the SURVIVING connection's
     connectionId via the API Gateway Management API. Best-effort: if the
     surviving connection is already gone, the GoneException is swallowed and
     logged.
   - Delete the disconnecting player's row from the `Connections` table (no
     stale connectionId accumulation).

2. If the game status is already `won`, `drawn`, or `abandoned` at disconnect
   time: the Lambda takes no action (game was already over; just clean up the
   Connections row).

**SPA — opponent-disconnected message and mode-selector return:**

3. On receipt of `opponent-disconnected`, the SPA exits the game board screen
   and returns the surviving player to the mode selector (the screen shown at
   app load — "Local", "vs Computer", "Online"). A short visible message is
   shown before or on transition: "Your opponent disconnected." No page reload
   required.

**Stale-connection hygiene:**

4. The existing 2h TTL on the `Connections` table already handles
   crash-without-disconnect edge cases (e.g. Lambda cold drop with no API GW
   event). No new TTL infrastructure is needed. The `$disconnect` path above
   handles graceful disconnects eagerly, so the TTL is the backstop only.

5. The `Games` table 24h creation TTL is unchanged. Abandoned games will
   eventually expire. No UI notification of expiry (OI-9 remains deferred).

---

## OI-10 decision — Reconnect-after-reload: OUT of s007

**Decision: OUT. Reconnect-after-reload is NOT in scope for s007.**

**Reasoning:**

Killick test WITH reconnect in s007: a player who reloads mid-game re-attaches
to the same game and play resumes. That is genuinely valuable. But delivering
it requires: (a) the wsToken model from s005-h2 must be re-issuable — either
the host receives a new token at reload, or a different credential is used; (b)
the SPA must detect "I was in a game" (likely via sessionStorage state) and
trigger a rejoin rather than a fresh start; (c) the join/connect flow must
distinguish a reconnect from a fresh join and replay the current board state to
the returning player. This is a meaningful expansion of the authorisation and
join flows — territory that borders C6 (persistent player identity) because a
purely stateless reconnect needs some recoverable credential.

Killick test WITHOUT reconnect: the surviving player gets feedback and regains
agency. The disconnecting player lands on a fresh app state (the SPA has
reloaded — they see the mode selector). They can start a new game. They lose
the in-progress game, but they are not stuck.

The disconnect experience is broken TODAY and blocks the C4 done condition
("disconnection is handled gracefully"). Reconnect is an improvement on top
of a working disconnect path — not the same job. Adding reconnect here would
couple two distinct capability increments and push past the Killick minimum for
this slice.

**What the reloading player experiences without reconnect:** The SPA reloads to
the mode selector. The wsToken is gone from sessionStorage; the game is
effectively abandoned from their perspective. The Games record (now `abandoned`
because the $disconnect event fired on their WS close) will expire at the 24h
TTL. There is no "resume" option. This is a known limitation, consistent with
the current product capability.

**OR-S006-b re-wording needed:** OR-S006-b in the s006 route records "relay
loss recovery = reconnect-replay in s007." That framing implies full reconnect
ships in s007. It should be re-worded at s007 engineering route-planning to:
"relay loss recovery deferred — s007 scopes graceful disconnect only;
reconnect-replay is unscheduled (candidate for C6-adjacent slice or never)."
The recovery story for a relay GoneException in s007 is: `$disconnect` fires
(or the TTL reaps), the game is abandoned, the survivor is notified. That IS
the recovery, and it is covered by this slice.

**Which future slice owns reconnect:** Unscheduled. The forecast entry is
"s007+ or never" (per the original OI-10 register). If C6 (player identity)
ships a persistent session credential, reconnect becomes tractable and could be
added as a thin slice after s013. Without C6, reconnect requires a new
short-lived credential issuance flow that does not yet exist. Do not slot it
until C6 is committed.

---

## What is explicitly NOT in scope

- Reconnect-after-reload (see OI-10 decision above).
- Idle-timeout enforcement by the server (no server-side ping/pong keepalive
  added in this slice — API Gateway's 10-minute idle timeout is relied upon as
  the backstop for truly silent connections; the `$disconnect` event fires when
  APIGW closes the connection).
- Game abandonment UI for the host waiting screen (player A created a game,
  player B never joined — this is a separate UX path; the waiting host can
  reload today and the game expires at 24h TTL).
- Leaderboard write on abandonment (deferred to s009 / C5).
- Persistent game history or replay.
- Any change to the 24h Games TTL or introduction of a shorter idle TTL
  (current hygiene is adequate at hobby volume; revisit at C5 if volume grows).
- OI-9 (24h expiry UI notification) — remains deferred.
- s005-h3 (code uniqueness) — parallel but not this slice.

---

## Success measures

1. **Opponent-disconnected message within 10 seconds:** Closing one browser
   tab (while the other player's board is active) causes the surviving player's
   UI to display an "opponent disconnected" message and return to the mode
   selector within 10 seconds of the tab close. Measured in a two-browser
   Playwright smoke run.

2. **Games record updated to `abandoned` on disconnect:** After the
   `$disconnect` event, a DynamoDB `GetItem` on the `Games` record shows
   `status = abandoned`. Confirmed in the smoke/validation suite.

3. **No stale connectionIds after disconnect:** After the `$disconnect` flow
   completes, the disconnecting player's row is absent from the `Connections`
   table (confirmed via `aws dynamodb get-item` or query). The surviving
   player's row is intact until they disconnect or their TTL fires.

4. **Already-completed games are not double-updated:** If `$disconnect` fires
   after a `game-over` event (e.g. player closes tab immediately after seeing
   the result), the `Games` record status is NOT overwritten to `abandoned`
   (conditional write guard). Status remains `won` or `drawn`.

5. **Surviving player can start a new game without reload:** After the
   opponent-disconnected transition, the mode selector is rendered and
   functional — clicking "Online" successfully initiates a new game creation
   flow. No browser reload required.

---

## Engineering obligations attached (orchestrator-directed)

- **IMP-008 WAF runner-IP exclusion:** The capability step for this slice
  should add the CI runner IP set to a WAF IP-set allowlist (or adjust the
  WAF rate rule to exclude runner IPs), resolving OI-34. This is a CICD
  infrastructure change; it does not touch the $disconnect Lambda.

- **OI-35 S4 relay-count pin:** If cheap on this surface (the $disconnect
  Lambda also uses `@connections` POST for the survivor notification, same
  relay mechanism as s006 S4), add a CloudWatch ManageConnections call-count
  check to the smoke/validation suite to pin the relay-amplification bound
  (exactly 1 post per disconnect event, not N). Tester to assess feasibility
  at acceptance planning.
