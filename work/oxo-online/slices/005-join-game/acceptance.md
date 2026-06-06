# Acceptance — Slice 005 join-by-code

Cases are tagged with their use case (UC1–UC5 from use-cases.md) and the
success measure from slice.md they verify (SM1–SM7). F-numbered cases are
customer-observable. T-numbered cases are technical/security-policy (section
below is left for the solution-architect to append).

---

## Functional (customer-observable)

**F1 — Both players see the game board with role labels within 3 seconds [UC3, SM1]**
Given Player A (host) is on the waiting screen and has successfully registered
their WebSocket connection,
And Player B is on the join screen and has entered a valid 6-character code for
that game,
When Player B submits the code,
Then within 3 seconds both Player A's screen and Player B's screen transition
from "waiting" / "connecting…" to a 3x3 game board,
And Player A's screen shows the label "You are X",
And Player B's screen shows the label "You are O",
And a status line reads "Game active — moves coming in the next update".

**F2 — DynamoDB Games record is active with both connection IDs populated [UC3, SM2]**
Given a successful join has just completed (F1 passing),
Then querying the `Games` table for that `gameId` (via `aws dynamodb get-item`)
returns an item where `status = "active"`, `hostConnectionId` is a non-null
non-empty string, and `guestConnectionId` is a non-null non-empty string.
No manual DynamoDB intervention was required to reach this state.

**F3 — Unknown code returns a readable error; join screen remains [UC2, SM3]**
Given Player B is on the join screen,
When they enter a 6-character code that does not correspond to any game in the
`Games` table and submit,
Then the WebSocket is closed (the SPA receives a close event),
And the join screen displays the message "Game not found. Check the code and
try again.",
And the code entered by Player B is retained in the input field (Player B does
not have to retype it),
And the join screen remains fully accessible (no page reload required),
And a subsequent `aws dynamodb scan` on the `Games` table confirms no new record
was created.

**F4 — Already-active game returns a readable error; no hijack possible [UC4, SM4]**
Given a game is already in `active` status (a previous Player B has already
joined and the game has been paired),
When a third player (or Player B trying again) enters that game's code and
submits on the join screen,
Then the WebSocket is closed,
And the join screen displays the message "This game is no longer available.",
And the `Games` record's `guestConnectionId` is unchanged — the original
Player B's connection ID is still stored,
And the `status` field is still `active`, not overwritten by the new attempt.

**F5 — Connections table contains both entries with approximately 2-hour TTL [UC3, SM5]**
Given a successful join has just completed (F1 passing),
Then the `Connections` table contains exactly two items for this game — one with
`role = "host"` and one with `role = "guest"` — each with a `ttl` attribute
whose value is between 1h 55m and 2h 5m from the time of the join (clock-skew
tolerance of 5 minutes),
Verifiable: `aws dynamodb scan --table-name <Connections>` filtered to the
relevant `gameId`.

**F6 — Host waiting screen shows connecting indicator while WebSocket establishes [UC1]**
Given Player A (host) has just been shown the waiting screen (code visible from
s004 flow),
When the SPA opens the WebSocket connection and sends the `register` message,
Then a "connecting…" or equivalent loading indicator is visible during the
establishment phase,
And the indicator resolves (disappears or changes to a "connected" state) once
the `register` acknowledgment is received or the connection is confirmed live,
And the game code remains visible throughout.

**F7 — Board squares are inert; clicking does nothing [UC5, SM1 partial]**
Given both players are on the game board screen after a successful join (F1
passing),
When either player clicks any square on the 3x3 board,
Then no move is registered, no board state changes, no WebSocket message is
sent, and no JavaScript error appears in the browser console,
And the status line continues to read "Game active — moves coming in the next
update".

**F8 — Existing local two-player and vs-AI modes are unaffected [UC5, SM6]**
Given slice s005 has been deployed to production,
When a player selects "Two Player (local)" from the mode selector and plays a
complete game (win, draw, or all squares filled),
Then the game plays to completion without error, the result is shown, and
"play again" returns to the mode selector.
And when a player selects "vs Computer" and plays a complete game,
Then the AI responds and the game plays to completion without regression.
No new breakage in either mode is attributable to the s005 changes.

**F9 — Server error on join shows a readable error without white-screening [UC2/UC3, SM3 partial]**
Given the backend (`oxo-ws-fn`) returns an internal error during a join attempt
(e.g. DynamoDB unavailable),
Then the WebSocket is closed with code 4500,
And the join screen displays a human-readable message (e.g. "Something went
wrong. Please try again."),
And the join screen remains accessible — no blank white screen or unhandled
error boundary shown,
And the entered code is retained.

**F10 — Pipeline deploys new WebSocket infrastructure cleanly [SM7]**
Given a push to the deploy branch with s005 changes,
Then the GitHub Actions pipeline succeeds end-to-end: CDK deploys `OxoGameProd`
(including new WebSocket API, Connections table, GSI, and `oxo-ws-fn`) then
`OxoOnlineProd` (SPA build with `wsUrl` config injected), followed by a
CloudFront invalidation,
And the workflow finishes green with no manual steps,
And the `wss://` URL is present and correct in the deployed SPA's runtime config.

---

## Technical / security-policy cases (solution-architect)

<!-- The architect appends T-numbered cases here. -->
<!-- Suggested anchors from architecture/deltas/005-join-game.md §Acceptance: -->
<!-- T1 — game-ready received by both connections within 3s (delta condition 1) -->
<!-- T2 — Games record shape after successful join (delta condition 2) -->
<!-- T3 — Connections entries with correct TTL (delta condition 3) -->
<!-- T4 — 4040 close + Games unchanged on unknown code (delta condition 4) -->
<!-- T5 — 4041 close + no-hijack conditional write (delta condition 5) -->
<!-- T6 — oxo-ws-fn IAM policy scope (delta condition 6) -->
<!-- T7 — synth-time contract test: WS route keys + WsApiEndpoint output + wsUrl config (delta §30 condition) -->
<!-- T8 — regression: existing create-game path and HTTP API unaffected (delta condition 8) -->
