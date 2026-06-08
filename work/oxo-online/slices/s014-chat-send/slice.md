---
slice: s014
slug: chat-send
status: in-planning
decision-log-ref: SEL-S014
chunk: C7
created: 2026-06-08
process-ref: §12b (multi-party) + EXP-015 (2nd scoring opportunity)
---

# s014 — in-game chat: message send + relay

## Job served

**[SECONDARY] Connection through banter** — supporting job.

When I am playing a game with a friend or stranger online, I want to exchange
short text messages during the match, so that the game feels like a shared
social experience rather than two people silently clicking squares at each other.

This is explicitly a secondary job. The core jobs (play a complete game against a
real human remotely, play vs AI solo) are already delivered in C2–C4. C7 adds
social texture on top of a working product. A player can get full value from
oxo-online without chat; chat is the difference between "functional" and
"fun to play with a friend."

---

## Killick test

Could a user do something valuable they could not do before?

YES. Before s014, two players in an active online game have no way to
communicate within the product at all — they are two people silently clicking.
After s014, either player can type a short message and it appears on the
opponent's screen within ~1 second, mid-game, for the first time. Even a
single exchange ("good luck!" / "gg") is a social act the product could not
enable before.

---

## Multi-party model (§12b — EXP-015 second scoring opportunity)

### Parties

- **Player A (host):** connected via WS, sitting at the game board screen,
  game is `active`.
- **Player B (guest):** connected via WS, sitting at the same game board
  screen in a separate browser instance.
- **Server (`oxo-ws-fn` Lambda):** receives the `chat` frame from the sender;
  identifies the sender by `connectionId`; looks up the opponent's
  `connectionId` from the `Games` record (existing `hostConnectionId` /
  `guestConnectionId` fields — the same lookup key established by s006); posts
  the message to the opponent via API Gateway Management API; also echoes it
  back to the sender so both screens update consistently.

### Sync-point table

| Sync point | Type | Parties | Mechanism | Notes |
|------------|------|---------|-----------|-------|
| SP-C1: Send chat message | IN-BAND (WS frame) | Sender → server | Sender types text, clicks Send; SPA dispatches `{action:'chat', gameId, text}` via the open WS connection. `gameId` is a non-trusted lookup hint (same pattern as s006 move frames — sender identity established server-side by `connectionId`, not by client-claimed `gameId`). | Server validates sender is a player of this game via `connectionId` match against `Games.hostConnectionId` / `guestConnectionId`. |
| SP-C2: Relay to opponent | IN-BAND (WS post) | Server → opponent's connection | `oxo-ws-fn` posts `{action:'chat-message', sender:'host'\|'guest', text}` to the opponent's `connectionId` via `@connections`. One Management API call. Same mechanism as s006 move relay. | Sender's role (`host`/`guest`) is derived server-side from the `connectionId` match — NOT from any client claim. |
| SP-C3: Echo to sender | IN-BAND (WS post) | Server → sender's connection | The same `chat-message` frame is also posted back to the sender's `connectionId`. Sender sees their own message appear in the list via the same rendering path as the opponent. | Keeps both screens consistent via one code path. |
| SP-C4: Display on both screens | IN-BAND (SPA state) | WS receipt → React state | Both SPAs receive the `chat-message` frame and append `{sender, text}` to a local in-memory message list. React re-renders the chat panel. | In-memory only — list is local component state, never written to DynamoDB, vanishes when the WS connection closes. |

### Disconnected-opponent case

If the opponent's WS connection has closed (game `active` but opponent gone, as
in the s007 `$disconnect` path), the Management API `PostToConnection` call will
return a `GoneException` (HTTP 410). The handler must catch this and drop the
message silently — best-effort delivery. The sender's screen still shows their
own message (echoed before the relay attempt) and does not crash. No retry. No
error displayed to the sender for this case. This is consistent with the s007
design: a player who has disconnected has already triggered the abandon path; a
chat message to a gone connection is harmlessly discarded.

Note: if the server has not yet received the `$disconnect` event (a brief race
window), the relay attempt will also return `GoneException` and is handled
identically. No state change required.

---

## Thin scope

### UI

- A text input (`data-testid="chat-input"`) and a Send button
  (`data-testid="chat-send-btn"`) appear on the active-game screen (the game
  board view, rendered when game status is `active`).
- Submitting (click Send or press Enter) dispatches `{action:'chat', gameId,
  text}` via the open WS connection, then clears the input field.
- Below the board (or in a side panel — UI placement is architect/engineer
  decision), a message list renders received `chat-message` frames as plain text
  items: `[sender label]: [text]`. Sender label is "You" for the player's own
  messages (identified by sender role matching the player's own role) and
  "Opponent" otherwise.
- The input and Send button are present whenever the game is `active`. They are
  NOT present on the waiting screen, result screen, or mode selector.
- Messages accumulate in the list for the lifetime of the WS connection. No
  scroll-to-bottom requirement in this slice (nice-to-have, not a success
  measure).

### Protocol: `chat` frame (client → server)

```json
{ "action": "chat", "gameId": "<gameId>", "text": "<user text>" }
```

`gameId` is the non-trusted lookup hint (same as s006 move frames — server
authenticates via `connectionId`). `text` is the user-supplied string.

### Server handler (`oxo-ws-fn`, `chat` route)

1. Look up the game by `gameId` from the frame.
2. Verify `connectionId` matches `hostConnectionId` or `guestConnectionId` on
   the `Games` record (sender is a player of this game). Reject silently if not.
3. Derive `senderRole` from the match (`host` or `guest`).
4. Validate `text`: strip leading/trailing whitespace; enforce max length
   (≤200 chars after trim; discard if empty after trim). Strip or HTML-encode
   `<>&"'` and control characters server-side (defence-in-depth; the primary
   XSS control is React text rendering on the client, but server normalisation
   prevents raw injection reaching any future persistence surface).
5. Construct relay frame: `{action:'chat-message', sender:senderRole, text:<normalised>}`.
6. Post relay frame to the OPPONENT's `connectionId` via Management API. On
   `GoneException`: catch, drop, continue (best-effort).
7. Post the same relay frame back to the SENDER's `connectionId` (echo). On
   `GoneException`: catch, drop, continue.
8. No `Games` DynamoDB write. No `Leaderboard` write. No new DynamoDB table.
   No new IAM grants beyond the existing `execute-api:ManageConnections` on
   `oxo-ws-fn` (already granted for s006 move relay).
9. No response frame to the sender (the echo in step 7 IS the confirmation).

### In-memory: no persistence

Messages live in React component state only. They are NOT written to DynamoDB
or any other store. When either player's WS connection closes or the page is
reloaded, the chat history is gone. This is explicit design, not a gap.

---

## What is explicitly NOT in scope

- **Persistence / history:** messages are never written to DynamoDB; they do
  not survive a WS close or page reload; there is no chat history endpoint.
- **The 1-second latency proof and done-condition verification (s015):**
  Playwright smoke covering the full C7 done-condition (both-screens update,
  1s p95, chat scoped to game session, messages vanish post-disconnect) is
  the s015 scope. s014 proves the mechanism works; s015 closes C7.
- **Chat outside an active game:** no chat on the waiting screen, result screen,
  or mode selector. Chat input appears only when game status is `active`.
- **Chat after game-over:** input is absent / disabled after a `game-over`
  frame is received. The input renders only while game is active.
- **Typing indicators:** no "opponent is typing…" signal.
- **Read receipts:** no delivered/read acknowledgement.
- **Emoji pickers or rich-text:** plain text input only.
- **Message timestamps:** not displayed in this slice.
- **Scroll-to-bottom:** desirable but not a success measure for s014.
- **Profanity/abuse moderation:** acknowledged as an inherent risk of
  unauthenticated user-supplied text (see Security flags below). Out of scope
  for this project at hobby scale; noted for future consideration.
- **Cross-game message injection guard test (s015):** the mechanism prevents
  cross-game injection (server-side `connectionId` binding) but the explicit
  scope-enforcement Playwright test is s015.

---

## Security and abuse flags for the architect

### XSS surface (HIGH — action required before shipping)

Chat text is user-controlled, sent via unauthenticated WS, and rendered in the
OPPONENT's browser. This is a **stored/reflected XSS surface** in the same class
as the s009 player name (which was mitigated in that slice).

**Required control:** render every `chat-message.text` via React text
interpolation (`{msg.text}`) — NEVER `dangerouslySetInnerHTML` or `innerHTML`.
React's default escaping means `<script>alert(1)</script>` renders as literal
text. This is the primary defence and must be pinned in the acceptance cases
(same pattern as AC3.3 in s009 use-cases.md).

**Server-side normalisation:** the handler strips `<>&"'` and control
characters before relaying (see handler step 4 above). This is defence-in-depth
for any future path that might persist or re-serve the text, not a substitute
for client-side React escaping.

**Length bound:** max 200 chars after trim. This bounds the DOM cost of a
message-flood attack and limits the blast radius of any injection attempt.

**Architect decision requested:** confirm the 200-char limit and the
server-side strip pattern; confirm that `dangerouslySetInnerHTML` prohibition
is added to the code-policy pin list alongside the leaderboard name pin
established in s009.

### Profanity / abuse (LOW — acknowledge, no action this slice)

Unmoderated, unauthenticated text between players is inherently open to abuse.
At hobby scale (no public discovery, invite-only games via shared code) the
blast radius is bounded: messages are visible only to the two players of a
specific game. No moderation is in scope for this project. Acknowledged.

### Cross-game message injection (MITIGATED by design)

A sender can only relay a message to the opponent of THEIR current game. The
server derives both the game lookup (`gameId` frame field → `Games` record)
and the sender identity (`connectionId` match against `Games.hostConnectionId`
/ `guestConnectionId`) independently. A player cannot craft a `chat` frame
that delivers a message to a player in a different game because their
`connectionId` will not match any `connectionId` on that game's `Games` record.
No new attack surface beyond what already exists for move frames (s006
security model unchanged). Architect to confirm no new IAM grant is required
(existing `execute-api:ManageConnections` covers both move and chat relay).

---

## Success measures

1. **Message appears on opponent's screen within ~1 second:** A message typed
   and sent by Player A appears in Player B's chat list within approximately
   1 second of send (measured manually or by Playwright timing; the formal
   p95 assertion is s015).

2. **Sender sees their own message:** The sender's own message appears in their
   chat list (via the echo path) without a page action — it renders as "You:
   [text]" or equivalent.

3. **Message renders as text (no XSS):** A message containing
   `<img src=x onerror=alert(1)>` renders as the literal string in the
   recipient's browser — no script execution, no image load. Verified by
   test-rendering the component with this string and asserting `textContent`
   equals the raw string.

4. **Disconnected opponent does not crash the sender:** When the opponent's
   connection is gone and the sender sends a chat message, the sender's screen
   continues functioning normally (no error state, no crash, no WS disconnect
   of the sender). The `GoneException` is caught and discarded server-side.

5. **Existing flows unaffected:** All existing game/move/leaderboard/disconnect
   flows produce identical outcomes to their pre-s014 acceptance cases
   (regression green).

6. **Chat input scoped to active game:** The chat input and send button are
   absent on the waiting screen, result screen, and mode selector. They are
   present on the game board screen when game status is `active`.

---

## Open items for the architect (s014 planning)

- OI-CHAT-1: Confirm `execute-api:ManageConnections` already covers the chat
  relay `PostToConnection` calls (no new IAM grant expected — same policy as
  s006 move relay). Document in arch delta.
- OI-CHAT-2: Confirm 200-char text limit and server-side strip pattern
  (`<>&"'` + control chars). Confirm `dangerouslySetInnerHTML` prohibition
  added to code-policy pin list.
- OI-CHAT-3: Architect decision on UI placement of the chat panel (below
  board, side panel, or other) — product does not constrain; engineer/designer
  to decide.
- OI-CHAT-4: Confirm best-effort drop (no error to sender) is the right UX
  for a message to a gone connection, given that the s007 `opponent-disconnected`
  message already handles the primary disconnect notification.

---

## Notes

- This slice opens C7. The chunk done-condition requires both s014 (mechanism)
  and s015 (scope enforcement + 1s latency p95 proof). C7 is the project's
  last forecast chunk. s015 will be the closing slice.
- The WS relay mechanism is identical to s006 move relay: existing
  `oxo-ws-fn`, existing `@connections` Management API, existing
  `connectionId`-as-identity pattern. No new platform mechanism. The only
  new infrastructure is a `chat` action route in the WS API (a new route
  in the existing WebSocket API — same as `move` is a route alongside
  `join`).
- §12b multi-party modelling is applied (EXP-015 second scoring opportunity):
  both player instances are modelled, the send→relay→display path is traced
  end-to-end across both browsers, and the disconnected-opponent edge case
  is modelled explicitly rather than assumed away.
