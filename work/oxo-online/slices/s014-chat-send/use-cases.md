---
slice: s014
slug: chat-send
process-ref: §37 + §12b (multi-party chat sync — EXP-015 second scoring opportunity)
co-authored: product + solution-architect + ui-designer
---

# Use cases — s014: in-game chat (message send + relay)

## §12b Multi-party / multi-instance model

Chat is inherently two-party. Two players operate on SEPARATE browser instances
against a SHARED backend. Both instances must model send, relay, echo, AND
display — the correct decomposition traces every frame across both browsers and
names the disconnected-opponent edge case explicitly.

### Parties

- **Player A (sender's browser):** connected via WS, on the active-game screen,
  game status is `active`. Types a message and clicks Send (or presses Enter).
- **Player B (opponent's browser):** connected via WS, on the same game's active
  screen in a separate browser instance. Receives the relay frame and displays it.
- **Server (`oxo-ws-fn` Lambda — `chat` route):** receives the `chat` frame;
  derives sender identity from the platform-set `connectionId`; relays to the
  opponent; echoes to the sender. No DynamoDB write. No new IAM grant.

---

## §12b Sync-point table

| Sync point | Type | Parties | Mechanism | Notes |
|------------|------|---------|-----------|-------|
| SP-C1: Send chat message | IN-BAND (WS frame) | Sender → server | Sender types text, clicks Send or presses Enter; SPA dispatches `{action:'chat', gameId, text}` over the open WS connection. `gameId` is a NON-TRUSTED lookup hint (same pattern as s006 move frames). | Server derives sender identity via `connectionId` match against `Games.hostConnectionId` / `guestConnectionId` — NOT from any body field. A forged `gameId` resolves a game the sender is not bound to → reject, zero relay POSTs. |
| SP-C2: Relay to opponent | IN-BAND (WS post) | Server → opponent's connectionId | `oxo-ws-fn` posts `{action:'chat-message', sender:'host'|'guest', text:<normalised>}` to the OPPONENT's `connectionId` via `@connections` Management API. ONE PostToConnection call. | `senderRole` is derived server-side from the `connectionId` match, NEVER from any client claim. Same `execute-api:ManageConnections` grant as s006 move relay — no new IAM. |
| SP-C3: Echo to sender | IN-BAND (WS post) | Server → sender's connectionId | The SAME `chat-message` frame is also posted back to the SENDER's `connectionId`. ONE PostToConnection call. The echo IS the only send-confirmation; no separate response frame. | Keeps both screens consistent via one code path. Sender sees their message as "You: [text]" via the same render path as the opponent. |
| SP-C4: Display on both screens | IN-BAND (SPA state) | WS receipt → React state | Both SPAs receive the `chat-message` frame over their open WS connection and append `{sender, text}` to a local in-memory message list. React re-renders the ChatPanel. | In-memory only — list is local component state, never written to DynamoDB. Vanishes on WS close or page reload. |
| SP-C5: Disconnected-opponent case | IN-BAND (platform 410) | Server → gone connectionId | If the opponent's WS connection has closed, the `PostToConnection` relay call returns `GoneException` (HTTP 410). Handler catches, drops, logs — NO retry, NO error frame to sender. The echo (SP-C3) is attempted independently (GoneException on echo also caught and dropped). | Best-effort delivery. The sender's own echoed message was already shown (or also dropped if sender gone). Consistent with s007 design: a gone connection is handled by the abandon path; a chat to a gone connection is harmlessly discarded. |

**In-band sync (SP-C1 through SP-C4):** the WS API `@connections` Management API
is the convergence mechanism (same class as s006 move relay). No direct
browser-to-browser channel; all frames pass through the Lambda handler.

**GoneException (SP-C5):** real platform 410 is cloud-only behaviour. The local
adapter simulates it with a closed-socket error; cloud is the proof of record for
best-effort drop.

---

## Parallel / serial call

```
PARALLEL SET A — disjoint files, no cross-build dependency:
  UC1 — chat handler (Lambda, src/lambda/ws-fn/handler.ts + local adapter)
  UC2 — chat UI (SPA: ChatPanel / ChatMessageList / ChatMessage / ChatInput,
         GameRoot playing-online branch)

  File boundary: UC1 (Lambda handler + local WS adapter) has ZERO file overlap
  with UC2 (SPA React components + GameRoot render site). They can be built,
  reviewed, and unit-tested fully in parallel.

SET B — after UC1 (handler) + UC2 (SPA) both deployed to prod:
  UC3 — validation (two-browser smoke, XSS, GoneException, WCAG, regression)
```

UC1 (Lambda) is parallel to UC2 (SPA) — disjoint files. UC3 runs after both
are deployed. There are no false dependency edges within Set A.

---

## UC1 — Chat handler (`oxo-ws-fn`, `chat` route): identity, relay+echo, GoneException, server bound

**ID:** UC1
**Actors:** Player A or B (sender, WS connection); `oxo-ws-fn` Lambda.
**Trigger:** A WS frame `{action:'chat', gameId, text}` arrives on the `chat`
route of the existing WebSocket API.

### Trigger -> observable outcome

1. **Route exists:** `chat` is a new route on the EXISTING WS API. Route count
   5 → 6 (`$connect`/`$disconnect`/`register`/`join`/`move`/**`chat`**); still
   no `$default`.
2. **Identity check:** the handler reads `event.requestContext.connectionId` and
   matches it against `Games.hostConnectionId` / `Games.guestConnectionId` on the
   record fetched by `gameId`. If no match → **reject silently, zero POSTs, zero
   writes** (T-CHAT-2).
3. **Text normalisation (server bound):** trim; reject if empty-after-trim; cap
   at 200 chars (truncate or reject — engineer's choice, pinned); strip/encode
   `<>&"'` and control chars. (T-CHAT-4)
4. **Relay to opponent:** build `{action:'chat-message', sender:senderRole,
   text:<normalised>}`. POST to the opponent's `connectionId` via Management API.
   `GoneException` → catch, drop, log, continue (NO retry). (T-CHAT-7, T-CHAT-8)
5. **Echo to sender:** POST the same frame to the sender's `connectionId`.
   `GoneException` → catch, drop, log, continue. (T-CHAT-7, T-CHAT-8)
6. **No writes:** zero `Games` writes, zero `Leaderboard` writes, no new table,
   no new IAM grant. (T-CHAT-5, T-CHAT-6)
7. **Local adapter:** the local WS server MUST handle the `chat` route — relay to
   the other local connection + echo to sender. `GoneException` simulated by a
   closed-socket error. Without this, the local two-browser path cannot stand.

### Done condition

All of the following pass:
- Synth: exactly 6 WS route keys; no `$default` (T-CHAT-1).
- Synth/policy: `oxo-ws-fn` IAM policy unchanged from s007 baseline (T-CHAT-5).
- Unit: identity rejection — forged `gameId` → zero POSTs, zero writes (T-CHAT-2).
- Unit: server bound — trim, empty-reject, 200-char cap, strip `<>&"'`+control (T-CHAT-4).
- Unit: GoneException on relay → caught, no retry, echo still attempted (T-CHAT-7).
- Unit: valid `chat` → exactly 2 PostToConnection calls; rejected `chat` → 0 (T-CHAT-8).
- Unit: zero DynamoDB writes on any `chat` path (T-CHAT-6).
- Local adapter: two-browser send→relay→echo stands on `npm run local`.

### Acceptance cases (UC1)

- AC1.1: Synth test — WS API has exactly 6 route keys:
  `$connect`, `$disconnect`, `register`, `join`, `move`, `chat`; `$default`
  absent (T-CHAT-1).
- AC1.2: Synth/policy test — `oxo-ws-fn` execution role IAM policy is byte-
  identical to the s007 grant set: `GetItem` on Games ARN +
  `execute-api:ManageConnections` on this WS API ARN only; NO new action, NO `*`,
  NO new table grant (T-CHAT-5).
- AC1.3: Unit test — handler given a `chat` frame where `event.requestContext.
  connectionId` matches NEITHER `hostConnectionId` NOR `guestConnectionId` of the
  fetched `Games` item → zero `PostToConnection` calls, zero DynamoDB writes,
  function completes without error (T-CHAT-2).
- AC1.4: Unit test — handler given a `chat` frame with a `gameId` for a game that
  does not exist (miss on `GetItem`) → same rejection: zero POSTs, zero writes
  (T-CHAT-2, identity / non-existent game case).
- AC1.5: Unit test — text normaliser: `"  hello  "` → `"hello"`; `""` → reject;
  `"  "` → reject; a 250-char string → capped at 200; `"<img>&"` → stripped/
  encoded form with no `<`, `>`, `&`, `"`, `'` chars (T-CHAT-4).
- AC1.6: Unit test — valid `chat` frame from the host → exactly 2
  `PostToConnection` calls: one to `guestConnectionId` (relay) + one to
  `hostConnectionId` (echo); `senderRole` in the relay frame is `'host'`
  (derived server-side, not from any body field) (T-CHAT-2 positive arm,
  T-CHAT-8).
- AC1.7: Unit test — relay POST returns `GoneException` (410) for the opponent
  → exception caught, no retry, function continues to echo attempt; echo POST
  proceeds normally; function returns success (no crash, no error frame) (T-CHAT-7).
- AC1.8: Unit test — both relay AND echo return `GoneException` → both caught,
  no retry, function returns success (T-CHAT-7 both-gone case).
- AC1.9: Unit test — valid `chat` path: zero calls to `DynamoDB.PutItem`,
  `DynamoDB.UpdateItem`, `DynamoDB.DeleteItem` on any table (T-CHAT-6).
- AC1.10: Local adapter test — two browser connections on local WS; Player A
  sends a `chat` frame; Player B receives a `chat-message` frame; Player A also
  receives the echo `chat-message` frame; no crash.

### Dependencies

- No dependency on UC2 (SPA) at build time — handler and Lambda are entirely
  separate artefacts.
- `Games` `GetItem` grant already live (s006). `ManageConnections` grant already
  live (s005). No new infra required before UC1 handler build.

---

## UC2 — Chat UI: ChatPanel / ChatInput / ChatMessageList on active-game screen

**ID:** UC2
**Actors:** Player A and Player B (each in their own browser instance).
**Trigger (send path):** Player is on the active-game screen (`onlinePhase ===
'playing-online'`, game status `active`). Player clicks the chat text field
(or Tabs to it), types a message, and presses Enter or clicks the Send button.
**Trigger (receive path):** The SPA receives a `chat-message` WS frame and
appends it to the in-memory message list; ChatMessageList re-renders.

### Trigger -> observable outcome

**Send path:**
1. The chat text field (`data-testid="chat-input"`, `role="textbox"`,
   accessible name "Chat message") is visible on the active-game screen, below
   the board, inside `<section aria-label="Game chat">` (`data-testid="chat-panel"`).
2. Player types text. Input max 200 chars (mirrors server bound; enforced
   client-side via `maxlength=200`).
3. Player presses Enter (keyboard path) or clicks the Send button
   (`data-testid="chat-send-btn"`, accessible name "Send"). Either submits the
   message and clears the input field. Focus remains in the chat input after send.
4. SPA dispatches `{action:'chat', gameId, text}` over the open WS connection.
5. The input field is cleared. An empty/whitespace-only submit is a no-op
   (input stays, nothing dispatched).

**Receive path (both sender echo and opponent relay):**
1. A `chat-message` frame arrives from the WS; `{sender:'host'|'guest', text}`.
2. SPA appends `{sender, text}` to the in-memory message list (React state).
3. ChatMessageList (`data-testid="chat-messages"`, `role="log"`,
   `aria-live="polite"`) re-renders; the new ChatMessage node appears as a child
   of the live region — assistive tech announces it without moving focus.
4. Each ChatMessage row (`data-testid="chat-message"`) shows:
   - Sender label (`data-testid="chat-message-sender"`): `"You"` if the
     `sender` role matches the viewer's own role; `"Opponent"` otherwise.
   - Message text (`data-testid="chat-message-text"`): rendered via React
     `{msg.text}` interpolation ONLY — NO `dangerouslySetInnerHTML`/`innerHTML`
     (T-CHAT-3 / WCAG-S014-8 / code-policy pin).
5. Messages accumulate in-memory for the lifetime of the WS connection.

**Scope constraints:**
- ChatInput (input + Send button) renders ONLY while `result === undefined` (game
  active). It is ABSENT on the waiting screen, result screen, and mode selector.
- The chat region is BELOW the board — it does not disturb the 3×3 grid geometry.
- No autofocus on mount; no focus theft on message arrival.

### Done condition

All of the following pass:
- SPA component test: ChatPanel renders on the `playing-online` active branch;
  absent on waiting/result/mode-selector (T-CHAT-3 scope arm).
- SPA component test: XSS injection string renders as literal `textContent`;
  no `<img>` node, no script (T-CHAT-3 / WCAG-S014-8).
- SPA component test: code-policy scan — no `dangerouslySetInnerHTML` / `innerHTML`
  in ChatPanel / ChatMessageList / ChatMessage / ChatInput (T-CHAT-3 pin).
- SPA component test: Enter-to-send fires `onSend`, clears input, focus stays
  in input (WCAG-S014-5, WCAG-S014-6).
- SPA component test: empty / whitespace-only submit is a no-op (no dispatch,
  no clear).
- SPA component test: `role="log"` + `aria-live="polite"` on message list;
  new message appended as child of the live region (WCAG-S014-3).
- WCAG conditions WCAG-S014-1..10 + LAYOUT-S014-1 all pass.

### Acceptance cases (UC2)

- AC2.1: SPA component test — `getByRole('region', {name:'Game chat'})` resolves
  on the `playing-online` active-game screen; `data-testid="chat-panel"` present
  (WCAG-S014-2).
- AC2.2: SPA component test — ChatPanel is ABSENT when rendered with
  `onlinePhase !== 'playing-online'` OR `result !== undefined`; the chat input and
  send button do not appear on waiting/result/mode-selector views (slice scope
  success measure 6).
- AC2.3: SPA component test — `getByRole('textbox', {name:'Chat message'})` resolves;
  `data-testid="chat-input"` present; `maxlength=200` attribute set; associated
  `<label>` present (WCAG-S014-1).
- AC2.4: SPA component test — `getByRole('button', {name:'Send'})` resolves;
  `data-testid="chat-send-btn"` present (WCAG-S014-1).
- AC2.5: SPA component test — pressing Enter in the focused chat input calls
  `onSend` with the typed text; the input field is cleared after send; focus
  remains in the chat input (WCAG-S014-5, WCAG-S014-6).
- AC2.6: SPA component test — clicking the Send button also calls `onSend` with
  the typed text and clears the input; focus remains in the chat input
  (WCAG-S014-5, WCAG-S014-6).
- AC2.7: SPA component test — submitting an empty string or a whitespace-only
  string is a no-op: `onSend` is NOT called, input is not cleared
  (click-path / no-op guard).
- AC2.8: SPA component test — `getByRole('log', {name:'Messages'})` resolves;
  the element has `role="log"` and `aria-live="polite"` (WCAG-S014-3).
- AC2.9: SPA component test — after appending a `chat-message` frame
  `{sender:'host', text:'hi'}` to the list, a `data-testid="chat-message"` child
  appears INSIDE the live-region element; a second message appended appears as
  another child of the same element (not by replacing the region) (WCAG-S014-3).
- AC2.10: SPA component test — a `chat-message` whose text is
  `<img src=x onerror=alert(1)>` renders with `data-testid="chat-message-text"`
  having `textContent` equal to the raw string; no `<img>` element appears in the
  component's DOM subtree; no `dangerouslySetInnerHTML` usage in ChatPanel /
  ChatMessageList / ChatMessage / ChatInput (confirmed by code-policy scan)
  (T-CHAT-3 / WCAG-S014-8).
- AC2.11: SPA component test — a message with `sender:'host'` renders
  `data-testid="chat-message-sender"` with `textContent="You"` when the viewer is
  `selfRole='host'`; renders `textContent="Opponent"` when viewer is
  `selfRole='guest'` (WCAG-S014-7 sender-by-label-not-colour).
- AC2.12: SPA component test — the Send button bounding box is ≥24×24 CSS px;
  the chat text field target meets the same (WCAG-S014-4).
- AC2.13: SPA / axe component test — chat region in both light and dark
  `color-scheme` states: zero axe `color-contrast` violations; message text uses
  `--text` token; sender label uses `--text` or `--text-muted` (WCAG-S014-9).
- AC2.14: SPA component test — if any appear/fade transition is added to chat
  messages, it is wrapped in `@media (prefers-reduced-motion: reduce)
  { transition: none; }`; no animation flashes >3×/s (WCAG-S014-10).
- AC2.15: Geometry test — ChatPanel bounding-box `top` is ≥ the board
  container's `bottom` (chat region does not overlap the 3×3 grid); ChatMessage
  items stack vertically (each item's `top` ≥ previous item's `bottom`)
  (LAYOUT-S014-1).
- AC2.16: SPA component test — ChatMessageList renders empty-state copy "No
  messages yet — say hi." when the message list is empty; it does not render a
  blank void.

### Dependencies

- No dependency on UC1 (Lambda) at build time — SPA components are fully
  buildable and testable against a local WS adapter or stub.
- UC2 SPA changes are additive to the `playing-online` branch of GameRoot; they
  do not touch the board, move-send path, or disconnect handling (no file
  conflict with those paths).

---

## UC3 — Validation: two-browser send→see, XSS text, GoneException no-crash, WCAG, regression

**ID:** UC3
**Actor:** Tester (prod validation spec, post-deploy).
**Trigger:** UC1 (chat handler) and UC2 (chat UI) both deployed to prod.

### Trigger -> observable outcome

The tester exercises the deployed system across five areas:

1. **Two-browser chat smoke (SM-1/SM-2):** Player A types a message; Player B sees
   it within ~1s (the informal timing check; formal p95 is s015). Player B types a
   reply; Player A sees it. Both see their own messages.
2. **XSS text render (SM-3):** Player A sends `<img src=x onerror=alert(1)>` as a
   message; Player B's browser renders it as the literal string — no image load,
   no script execution (T-CHAT-3 in-prod arm).
3. **GoneException no-crash (SM-4):** with the opponent's WS closed (simulated by
   closing the tab), Player A sends a chat message; Player A's screen remains
   functional, WS stays open, no error displayed (T-CHAT-7 in-prod arm).
4. **WCAG sweep (S014-1..10 + LAYOUT-S014-1):** axe + Playwright on the chat
   region in both populated and empty states; all WCAG conditions pass.
5. **Regression:** existing game/move/join/disconnect/leaderboard flows produce
   identical outcomes to their pre-s014 acceptance cases (S-regression).

### Done condition

All acceptance cases below pass. All s014 success measures 1–6 satisfied.

### Acceptance cases (UC3)

- AC3.1: Two-browser Playwright smoke — Player A types "hello", sends; within ~1s
  Player B's `data-testid="chat-messages"` list contains a `chat-message` row with
  `chat-message-sender="Opponent"` and `chat-message-text="hello"` (SM-1 / success
  measure 1).
- AC3.2: Two-browser Playwright smoke — Player A's own message appears in Player
  A's `chat-messages` list with `chat-message-sender="You"` and
  `chat-message-text="hello"` (echo path / success measure 2).
- AC3.3: Two-browser smoke — Player B types "world", sends; Player A sees it
  within ~1s with `chat-message-sender="Opponent"` (bidirectional relay works).
- AC3.4: XSS text prod test — Player A sends `<img src=x onerror=alert(1)>`;
  Player B's `chat-message-text` element has `textContent` equal to the raw
  injection string; no `<img>` element appears in the DOM; no script/handler fires
  in Player B's browser (T-CHAT-3 in-prod / WCAG-S014-8 / success measure 3).
- AC3.5: GoneException no-crash — Player B's tab is closed (WS gone); Player A
  sends a chat message; Player A's game screen remains fully functional (board
  still interactive, WS still open, no error overlay shown); no crash in
  `oxo-ws-fn` logs (T-CHAT-7 in-prod / success measure 4).
- AC3.6: Scope guard — the chat input and send button are NOT present (not in DOM)
  on the waiting screen, result screen, and mode selector; they ARE present on the
  active-game screen when game status is `active` (success measure 6).
- AC3.7: Regression — game creation, move submission, `game-over` delivery,
  `$disconnect` abandon, leaderboard read all behave identically to their
  pre-s014 expected outcomes (S-regression / success measure 5).
- AC3.8: WCAG prod sweep — axe passes with zero violations on the chat region in
  both populated and empty states, in both light and dark schemes; all WCAG-S014-
  1..10 conditions verified (WCAG-S014-1 through WCAG-S014-10).
- AC3.9: LAYOUT-S014-1 prod check — ChatPanel `top` is below the board
  container's `bottom` in the rendered page; ChatMessage items are stacked
  vertically (no horizontal wrapping or overlap).
- AC3.10: CSP unchanged — no new CSP directive or `connect-src` origin introduced;
  existing `Content-Security-Policy` header on the SPA is unmodified (T-CHAT-9).

### Dependencies

- UC1 (handler) deployed to prod before UC3 validation runs.
- UC2 (SPA) deployed to prod before UC3 validation runs.

---

## Dependency summary

```
UC1 (chat handler — Lambda)    — no build dep on UC2 (SPA); disjoint files;
                                  reuses existing GetItem(Games) + ManageConnections grants
UC2 (chat UI — SPA)            — no build dep on UC1 (Lambda); buildable + testable
                                  against local WS stub
UC3 (validation — tester)      — requires UC1 + UC2 both deployed to prod
```

Parallel sets:
- **Set A (build in parallel):** UC1, UC2 — no cross-artefact file dependency.
  UC1 (Lambda handler + local adapter code) and UC2 (SPA React components) are
  fully disjoint artefacts. No integration seam within Set A.
- **Set B (after both deployed to prod):** UC3

No §30 walking-skeleton probe required: `chat` is another route on the existing
WS API → existing `oxo-ws-fn`; `PostToConnection` over `@connections` is the s006
mechanism, already proven. No first-use of any service/protocol/behaviour class.

---

## Infra enabler notes (co-decided with solution-architect)

1. **New WS route:** `chat` added to the EXISTING WebSocket API. CDK adds one
   `CfnRoute` + integration targeting the EXISTING `oxo-ws-fn`. No new Lambda,
   no new API, no new stage.
2. **No new IAM grant:** `GetItem` on Games (s006) and `execute-api:ManageConnections`
   on this WS API ARN (s005) already cover the chat handler's full access pattern.
   T-CHAT-5 asserts the policy is unchanged from s007 baseline.
3. **No new DynamoDB table / no persistence:** chat messages live in React
   component state only. No schema change to `Games` or `Leaderboard`.
4. **Local adapter gap:** the existing local WS server must add a `chat` route
   case (relay to the other local connection + echo to sender; simulate
   GoneException via closed-socket error). This is a local-adapter code task
   for the engineer — without it the two-browser local stand-up cannot exercise
   the chat path.
5. **Code-policy pin:** `dangerouslySetInnerHTML` / `innerHTML` / any raw-HTML
   sink on chat text is PROHIBITED — added to the code-policy pin list alongside
   the s009 leaderboard-name pin. Grep/lint assertion; also tested as AC2.10
   component code scan.
