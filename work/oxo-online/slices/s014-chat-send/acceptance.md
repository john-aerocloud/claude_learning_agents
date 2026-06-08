---
slice: s014
slug: chat-send
gate: GATE-2-S014 (approved) + GATE-3-S014 (§9a auto-accept)
co-authored: product + solution-architect + ui-designer
---

# Acceptance — s014: in-game chat (message send + relay)

Four case classes:

- **F-cases (customer-observable):** the conditions a real player in two real
  browsers experiences. The headline: type a message during an active game and
  see it appear on the opponent's screen within ~1 second — a social act the
  product could not enable before.
- **T-CHAT cases (technical / observable):** lifted verbatim-or-tightened from
  delta 011 T-CHAT-1..9. Encode the route surface, identity/no-cross-game
  injection, XSS render-as-text pin, server bound, no-new-IAM, in-memory/
  no-persist, GoneException best-effort, bounded fan-out, and CSP-unchanged.
- **WCAG cases (accessibility):** lifted from ui-design.md WCAG-S014-1..10 +
  LAYOUT-S014-1. Cover the chat input labelling, landmark region, live region,
  target size, keyboard send, focus management, sender distinction, XSS display
  pin, contrast, reduced motion, and geometry guard.
- **S-regression:** existing game/move/leaderboard/disconnect flows unaffected.

Every case is tagged to its use case(s). The coverage map at the end shows
distribution across UCs.

---

## F-cases — customer-observable

### F1 — Opponent sees the message within ~1 second [UC1, UC2, UC3]

Player A types a message and sends it during an active game. The message appears
in Player B's chat panel within approximately 1 second of send. This is the
primary customer-visible measure: a social exchange during a game was impossible
before s014. (The formal p95 latency proof is s015; s014 proves the mechanism.)

Observed in: AC3.1, AC3.2, AC3.3.

### F2 — Sender sees their own message [UC1, UC2, UC3]

The sender's own message appears in their own chat list (via the echo path),
labelled "You: [text]", without any page action. Both players update via the
same `chat-message` frame render path.

Observed in: AC3.2.

### F3 — Injection string renders as literal text (no XSS) [UC1, UC2, UC3]

A message containing `<img src=x onerror=alert(1)>` (or any injection string)
renders as the literal string in both the sender's and recipient's browsers. No
script execution, no image load, no resource fetch. This is the primary defence
(React text interpolation) confirmed both in component test and in prod.

Observed in: AC2.10 (component), AC3.4 (prod).

### F4 — Disconnected opponent does not crash the sender [UC1, UC3]

When the opponent's WS connection has closed (tab closed, network drop) and the
sender sends a chat message, the sender's game screen continues functioning
normally: the board is still interactive, the WS connection stays open, no error
overlay appears, no crash. The GoneException is caught server-side and discarded.

Observed in: AC3.5.

### F5 — Chat only on the active-game screen [UC2, UC3]

The chat input field and Send button are present ONLY when the game is active
(`onlinePhase === 'playing-online'` and `result === undefined`). They are absent
on the waiting screen, result screen, and mode selector. A player cannot send
chat from any other screen.

Observed in: AC2.2, AC3.6.

### F6 — Existing flows unaffected [UC3]

All existing game creation, move submission, game-over delivery, opponent-
disconnect, and leaderboard flows produce identical outcomes to their pre-s014
behaviour. Chat is purely additive; the board, move path, and disconnect path
are not disturbed.

Observed in: AC3.7 (regression).

---

## T-CHAT cases — technical / observable

T-CHAT cases are lifted verbatim-or-tightened from delta 011 T-CHAT-1..9. Each
carries its original T-CHAT id.

### T-CHAT-1 — Route surface [UC1]

Exactly SIX WS route keys are synthesised in the CDK stack:
`$connect`, `$disconnect`, `register`, `join`, `move`, `chat`. No `$default`
route. Asserted by synth test.

Observed in: AC1.1.

### T-CHAT-2 — connectionId identity / no cross-game injection [UC1]

A `chat` frame whose REAL `connectionId` (the platform-set, unspoofable identity)
matches NEITHER `hostConnectionId` NOR `guestConnectionId` on the `Games` item
named by `gameId` (forged `gameId`, spectator connection, stale or non-existent
connection) → **reject silently: zero relay POSTs, zero writes**. The sender role
(`host`/`guest`) is derived server-side from the connectionId↔stored-binding
match, NEVER from any body field. A player cannot craft a `chat` frame that
delivers a message to a player in a different game.

Observed in: AC1.3, AC1.4, AC1.6.

### T-CHAT-3 — XSS render-as-text (the display-side pin) [UC1, UC2, UC3]

A `chat-message` whose `text` is `<img src=x onerror=alert(1)>` (or
`<script>…</script>`) renders as the LITERAL string in the recipient's browser:
`textContent` of the rendered `chat-message-text` element equals the raw string;
no `<img>` node in the DOM; no script exec; no resource load.

AND a code-policy pin: the ChatPanel, ChatMessageList, ChatMessage, and
ChatInput components contain NO `dangerouslySetInnerHTML` / `innerHTML` / raw-HTML
sink on chat text (grep/lint assertion). This is THE control; the server
normalisation at the relay boundary is defence-in-depth.

Observed in: AC2.10 (component + code-policy scan), AC3.4 (prod validation).

### T-CHAT-4 — Server bound (depth + abuse cap) [UC1]

The handler: trims leading/trailing whitespace; rejects text that is empty-
after-trim (zero POSTs); caps length at 200 chars (longer text is truncated or
rejected — engineer's choice, pinned); strips/encodes `<>&"'` and control
characters before relay. These controls are server-side; the primary XSS defence
is the React render-as-text pin (T-CHAT-3).

Observed in: AC1.5.

### T-CHAT-5 — No new IAM grant [UC1]

`oxo-ws-fn`'s IAM execution-role policy is the s007 grant set verbatim. The
`chat` route adds ZERO new permissions: `GetItem` on `Games` (s006) and
`execute-api:ManageConnections` on this WS API ARN only (s005) already cover
the full chat handler access pattern. No new action, no `*`, no new table grant.
Asserted by synth/policy test.

Observed in: AC1.2.

### T-CHAT-6 — In-memory / no-persist [UC1]

The `chat` handler performs ZERO DynamoDB writes. No `Games` write, no
`Leaderboard` write, no new table, no Stream. Chat messages live only in React
component state on both clients. When either player's WS connection closes or
the page is reloaded, the chat history is gone. Verified by asserting no write
call on any `chat` code path and by confirming no CDK schema change to any table.

Observed in: AC1.9.

### T-CHAT-7 — GoneException best-effort [UC1, UC3]

A relay POST to a gone opponent returns `GoneException` (HTTP 410) → caught,
dropped, **no retry**; the handler continues to the echo attempt. An echo POST
that also returns `GoneException` → also caught and dropped. Function returns
success in all cases. No error frame is sent to the sender. The sender's WS
connection stays open. (The full two-browser e2e proof with 1s p95 latency is
s015.)

Observed in: AC1.7, AC1.8 (unit), AC3.5 (prod validation).

### T-CHAT-8 — Bounded fan-out [UC1]

An accepted `chat` (connectionId matches a player) = **exactly 2
`PostToConnection` calls** (1 relay to opponent + 1 echo to sender).
A rejected `chat` (no connectionId match) = **0 `PostToConnection` calls**.
NEVER a broadcast to all connections in the game or globally.

Observed in: AC1.6, AC1.3 (0-call rejection arm).

### T-CHAT-9 — CSP unchanged [UC2, UC3]

No new Content-Security-Policy directive, no new `connect-src` origin, no new
trusted sink is introduced by s014. Chat text is DOM text content, not
script/style/connect. The existing CSP that covers the s009 leaderboard name
render covers chat render identically.

Observed in: AC3.10.

---

## WCAG cases — accessibility (WCAG 2.2 AA)

WCAG cases are lifted from ui-design.md WCAG-S014-1..10 + LAYOUT-S014-1.
Testable by axe + Playwright/component test.

### WCAG-S014-1 — Labelled controls (1.3.1 / 4.1.2) [UC2]

The chat text field has a programmatically associated accessible name "Chat
message" (`getByRole('textbox', {name:'Chat message'})` resolves). The Send
control has accessible name "Send" (`getByRole('button', {name:'Send'})` resolves).
axe: no `label` or `button-name` violations on the chat region.

Observed in: AC2.3, AC2.4.

### WCAG-S014-2 — Region landmark + heading (1.3.1) [UC2]

The chat panel is `role="region"` with accessible name "Game chat", distinct from
the board region (which retains its own `aria-label="online game board"`,
unchanged). `getByRole('region', {name:'Game chat'})` resolves.

Observed in: AC2.1.

### WCAG-S014-3 — Live region for incoming messages (4.1.3) [UC2]

The message list has `role="log"` and `aria-live="polite"`. When a new
`chat-message` frame appends a message, the new ChatMessage node is added INSIDE
the live-region element (not by replacing it) so assistive tech announces the
new message without moving focus.

Observed in: AC2.8, AC2.9.

### WCAG-S014-4 — Target size (2.5.8) [UC2]

The Send button bounding box is ≥24×24 CSS px. The chat text field meets the
same minimum.

Observed in: AC2.12.

### WCAG-S014-5 — Keyboard send (2.1.1) [UC2]

Pressing Enter in the focused chat input submits the message (input clears,
`onSend` fired). The Send button is reachable by Tab and activates with Enter
or Space. No keyboard trap — Tab leaves the chat input to the Send button and
onward.

Observed in: AC2.5, AC2.6.

### WCAG-S014-6 — Focus not lost on send (2.4.3 / 3.2.x) [UC2]

After submitting (Enter or Send click), keyboard focus remains in the chat input
(now cleared). Focus is NOT moved to the board, the Send button, or the document
body. The chat input is NOT autofocused on mount. An incoming message does NOT
move focus.

Observed in: AC2.5, AC2.6.

### WCAG-S014-7 — Sender distinction not colour-only (1.4.1) [UC2]

Each message row shows a TEXT sender label in `data-testid="chat-message-sender"`:
"You" for the viewer's own messages; "Opponent" otherwise. Self/other is
distinguishable with colour disabled. No colour swatch only.

Observed in: AC2.11.

### WCAG-S014-8 — Display-side XSS: render as TEXT (complements T-CHAT-3) [UC2]

A message whose text is `<img src=x onerror=alert(1)>` renders as the literal
string; `chat-message-text` `textContent` equals the raw string; no `<img>`
element is created in the DOM; no script or handler fires. Built via React text
interpolation `{msg.text}`; `dangerouslySetInnerHTML` is prohibited on the chat
components.

Observed in: AC2.10.

### WCAG-S014-9 — Contrast (1.4.3 — both schemes) [UC2]

Message text uses `--text` token (≥4.5:1 vs `--surface`, verified s009). Sender
label uses `--text` or `--text-muted` (both ≥4.5:1). Send button meets ≥3:1 UI
minimum (≥4.5:1 if the label is text-on-accent). axe `color-contrast`: zero
violations in both light and dark `color-scheme` states.

Observed in: AC2.13.

### WCAG-S014-10 — Reduced motion (2.3.3) [UC2]

If any appear/fade transition is added to chat messages, it uses `--motion-fast`
AND is wrapped in `@media (prefers-reduced-motion: reduce) { transition: none; }`.
No content flashes >3×/s. Default is no animation; this condition gates any
transition that is added.

Observed in: AC2.14.

### LAYOUT-S014-1 — Chat list stacks vertically below the board [UC2, UC3]

ChatMessageList lays messages out as a vertical stack: each ChatMessage's
bounding-box `top` is ≥ the previous message's `bottom` (no horizontal wrap).
AND the ChatPanel's bounding-box `top` is ≥ the board container's `bottom`
(chat is beneath, not overlapping, the 3×3 grid). The board's 3×3 grid geometry
is NOT re-asserted here (owned by its existing test) and NOT disturbed.

Observed in: AC2.15, AC3.9.

---

## S-regression

### S-REG — Existing flows unaffected [UC3]

All acceptance cases from s006 (move), s007 (disconnect), s008 (deep-link), and
s009 (leaderboard) produce identical outcomes after s014 lands. Chat is purely
additive. Specifically: `move` relay, `game-over` WS timing, `$disconnect`
abandon + survivor notification, `GET /api/leaderboard`, and the copy-code /
copy-link controls are unaffected.

Observed in: AC3.7.

---

## Coverage map (cases → use cases)

| UC | F-cases | T-CHAT cases | WCAG cases | S-regression |
|----|---------|------------|------------|--------------|
| UC1 (chat handler — Lambda) | F4 | T-CHAT-1, T-CHAT-2, T-CHAT-3 (pin arm), T-CHAT-4, T-CHAT-5, T-CHAT-6, T-CHAT-7, T-CHAT-8 | — | — |
| UC2 (chat UI — SPA) | F3, F5 | T-CHAT-3 (display arm), T-CHAT-9 | WCAG-S014-1..10, LAYOUT-S014-1 | — |
| UC3 (validation — tester) | F1, F2, F3, F4, F5, F6 | T-CHAT-3 (prod arm), T-CHAT-7 (prod arm), T-CHAT-9 | WCAG-S014-1..10 (prod sweep), LAYOUT-S014-1 | S-REG |

**Case counts:**
- **F-cases: 6** (F1–F6)
- **T-CHAT cases: 9** (T-CHAT-1..9, lifted from delta 011)
- **WCAG cases: 11** (WCAG-S014-1..10 + LAYOUT-S014-1, lifted from ui-design.md)
- **S-regression: 1** (S-REG)
- **Total named acceptance conditions: 27**

Individual AC-ids in use-cases.md (the engineer and tester turn these into test
specs): 10 in UC1, 16 in UC2, 10 in UC3 = **36 AC-ids total**.

---

## Open risks carried forward

- **OR-S014-a — Unmoderated free-text abuse (profanity/spam):** inherent to the
  product-chosen unauthenticated model; blast radius bounded to the two players
  of one game; moderation out of scope. Acknowledged LOW per slice.md.
- **OR-S014-b — Best-effort, no-retry relay/echo:** a dropped chat message is not
  re-pushed (consistent with s006/s007 relay posture); chat is non-authoritative
  in-memory state, so a miss is harmless. Recovery = re-send.
- **OR-S014-c — 1s latency p95 formal proof is s015:** this slice proves the
  mechanism works; s015 closes C7 with the Playwright p95 assertion, cross-game
  injection scope test, and message-vanish-on-disconnect validation.
- Inherited: OR-H2-b (guest code-as-credential), OR-S006-a, OR-S006-b (as
  re-worded at s007), OR-S009-a, OR-S009-b, OR-S009-c, OR-S009-d.
