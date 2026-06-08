# UI design — s014 chat-send

Mode: **STRUCTURE** (before the build). Author: ui-designer, iter 16.
Applies: **YES** — two new user-facing surfaces on the active-game screen (a chat
input + Send control, and a message list). This is a UI-bearing slice.

Source of truth read: slice.md (thin scope §UI, success measures 1–6, XSS HIGH
flag), design-system.md / components.md / patterns.md (seeded s009), OnlineBoard.tsx,
GameRoot.tsx render site (`onlinePhase === 'playing-online'`).

---

## Surfaces touched (screens/routes)

ONE surface only: the **active online game screen** — `GameRoot`'s
`onlinePhase === 'playing-online'` branch, where `<OnlineBoard>` renders. The
chat region is added to THAT branch only.

Explicitly NOT touched (success measure 6 / scope): idle/mode-selector view,
waiting panel, JoinScreen, disconnected screen, error screen, local game board,
AI game. The board's 3×3 grid geometry (s002 fix) is NOT disturbed — chat is a
sibling region, never inside the board container.

`game-over` gating: chat input renders only while the game is genuinely active
(`result === undefined`). Once a `game-over` frame sets `result`, the input is
absent (scope: "Chat after game-over: input is absent / disabled"). See state
table below.

---

## Navigation / IA delta

**Placement decision: chat is a region BELOW the board, inside the
`playing-online` branch, as a sibling of `<OnlineBoard>`.**

```
section.online-game (playing-online branch)
├── OnlineBoard           (role label, 3×3 grid, turn/result status) — UNCHANGED
└── ChatPanel             (NEW — region "Game chat")
    ├── ChatMessageList    (the log of messages)
    └── ChatInput          (text field + Send) — present only while active
```

Justification (game-focus: chat is SECONDARY to the board — slice "secondary
job"):
1. **The board stays the primary, top, focal surface.** Chat below it preserves
   the existing single-centered-column IA (`max-width: 32rem`, patterns.md) and
   the visual hierarchy "play first, banter second". A side panel would force a
   two-column layout, breaking the established 320px-no-horizontal-scroll
   responsive pattern and competing with the board for attention. Below-board is
   the lower-cost, on-idiom choice and is the placement the slice's own UI note
   offers first ("Below the board").
2. **Chat is its own landmark region** (`<section aria-label="Game chat">`) so a
   screen-reader user can jump to it or skip past it to the board — it does not
   pollute the board's region.
3. **No navigation is added.** Chat is in-place on a screen the player is already
   on. No route, no modal, no expand/collapse, no tab. Entry = being in an active
   game; exit = game-over or leaving the game (existing back paths unchanged).
4. **No focus theft.** The chat input is NOT autofocused on mount and does NOT
   grab focus when a message arrives (see WCAG-S014-6). The board click target
   and keyboard move flow are untouched: a player can play the whole game without
   ever touching chat, and typing in chat never blocks or intercepts a move.

Component-map delta: three new component nodes (ChatPanel, ChatMessageList,
ChatMessage) used-by the `playing` surface; ChatInput used-by ChatPanel. Marked
`changed` until s014 delivery.

---

## Click-path budget (per use case, with justification)

Start state: player is in an active online game (`playing-online`, board visible).

| Job | Budget | Path |
|-----|--------|------|
| Send a chat message | **type + 1 action** | Click/Tab into chat input → type text → **press Enter** (1 keystroke) OR click Send (1 click). Either submits and clears the input. |
| Read incoming messages | **0 clicks** | Messages append to the list and render in place; no expand, no scroll required for the slice (scroll-to-bottom is explicitly out of scope). A screen-reader user is told via the live region (WCAG-S014-3). |

Justification / binding rules (arcade):
- **Enter-to-send is the primary path** and the stated target — it is the
  expected arcade/chat idiom and removes the pointer round-trip to the Send
  button. Send button is the equal-weight pointer alternative (and the a11y
  keyboard-name target). Both must work (WCAG-S014-5).
- The send action does NOT navigate, open a dialog, or change screen — it is a
  single in-place dispatch. One action is the floor; there is no cheaper send.
- Sending must NOT cost the player a move: chat lives in a separate input region,
  the board remains independently operable, and submitting chat returns focus to
  the (now-cleared) chat input — it never lands focus on the board or fires a
  move. A design that blocks the board while composing chat, or that requires
  leaving chat to make a move, is a click-path / focus-management failure.
- Empty/whitespace-only submit is a no-op (input stays, nothing sent) — it does
  not consume the budget or clear meaningful state.

---

## Component decomposition (component → states → stable selector)

All **custom** (no component library — design-system.md). Tokens from
design-system.md; messages and labels use existing semantic tokens, no new
colour token needed (see design-system extension below).

### ChatPanel (NEW)
- **Role:** the chat region container; composes ChatMessageList + ChatInput.
  Presentational only — owns layout (below board, within `max-width: 32rem`),
  the region landmark, and the panel heading. Receives `messages` and the
  `selfRole` (`'host' | 'guest'`) and `onSend(text)` from the engineer's state.
- **States:** `active` (game live: list + input both shown) / `game-over` (input
  absent — list may remain visible until unmount; the slice says input is absent
  after game-over). No loading state (chat is in-memory, synchronous append).
- **Selector:** `getByRole('region', { name: 'Game chat' })`;
  also `data-testid="chat-panel"`.
- **A11y:** `<section aria-labelledby>` a visually-present `<h2>Chat</h2>` (or
  `aria-label="Game chat"`); the panel is a distinct landmark from the board.

### ChatMessageList (NEW)
- **Role:** renders the in-memory message array as a vertical stack of
  ChatMessage items. Pure presentation from a `messages` prop.
- **States:** `empty` (no messages yet — renders empty-state copy, never a blank
  void) / `populated` (one or more messages, most-recent last, stacked vertically).
- **Selector:** `getByRole('log', { name: 'Messages' })`;
  also `data-testid="chat-messages"`.
- **A11y / LIVE REGION:** the list IS the live region — `role="log"` with
  `aria-live="polite"` and `aria-relevant="additions"` so a screen reader
  announces each NEW message (own echo + opponent) without moving focus. This is
  the mechanism for success measures 1 & 2 being perceivable non-visually.
- **Empty state copy:** "No messages yet — say hi." (consistent with the
  leaderboard empty-state idiom in patterns.md).

### ChatMessage (NEW)
- **Role:** one message row: a sender label + the message text. Pure presentation
  from `{ sender: 'host' | 'guest', text: string }` plus the viewer's `selfRole`
  to resolve the label.
- **States:** `self` (sender role === viewer's role → label "You") / `other`
  (label "Opponent"). (There is no separate "sent" vs "received" visual state —
  both arrive via the same `chat-message` echo/relay path; the only distinction
  is self/other, carried by the LABEL, never by colour alone.)
- **Selector:** each row `data-testid="chat-message"`; the label
  `data-testid="chat-message-sender"`; the text `data-testid="chat-message-text"`.
- **A11y:** sender distinction is the **label text** ("You" / "Opponent"), not a
  colour swatch (1.4.1 — see WCAG-S014-7). Text rendered via React `{msg.text}`
  interpolation ONLY — never `dangerouslySetInnerHTML` (WCAG-S014-8 / SM-3).

### ChatInput (NEW)
- **Role:** the labelled text field + Send button; on submit calls `onSend(text)`
  and clears itself. Presentational + local controlled-input value; the WS
  dispatch, trim, 200-char enforcement, and self-role resolution are the
  engineer's state/port logic (NOT the designer's — hexagonal boundary).
- **States:** `default` (empty) / `focus` (`:focus-visible` ring per
  `--focus-ring`) / `typing` (has value, Send enabled) / `empty/whitespace`
  (Send is a no-op; do not dispatch) / `disabled` is NOT used in this slice
  (input is simply absent post-game-over). No error state surfaced to the sender
  (best-effort delivery; gone-opponent drop is silent — slice §disconnected).
- **Selectors:**
  - text field: `getByRole('textbox', { name: 'Chat message' })`; also
    `data-testid="chat-input"`.
  - Send button: `getByRole('button', { name: 'Send' })`; also
    `data-testid="chat-send-btn"`.
- **A11y:** `<label for="chat-input">Chat message</label>` (visible or
  visually-hidden but programmatically associated — NOT placeholder-as-label,
  same rule as NameField); Send button has the accessible name "Send";
  `maxlength=200` mirrors the server bound; Enter submits (form submit or keydown
  handler); on submit focus STAYS in the input (WCAG-S014-6).

---

## Accessibility conditions (WCAG 2.2 AA) → mirror into acceptance.md

The architect's T/S conditions and these WCAG conditions are assembled by product
into `acceptance.md`. Each below is checkable (axe rule or Playwright/component
assertion).

- **WCAG-S014-1 (labelled control, 1.3.1/4.1.2):** the chat text field has a
  programmatically associated accessible name "Chat message"
  (`getByRole('textbox', { name: 'Chat message' })` resolves); the Send control
  has accessible name "Send" (`getByRole('button', { name: 'Send' })` resolves).
  axe: no `label`/`button-name` violations on the chat region.
- **WCAG-S014-2 (region landmark + heading, 1.3.1):** the chat panel is a
  `role="region"` with accessible name "Game chat", distinct from the board
  region; the board's own `aria-label="online game board"` is unchanged.
- **WCAG-S014-3 (live region for incoming messages, 4.1.3):** the message list is
  `role="log"` with `aria-live="polite"`; when a new `chat-message` frame appends
  a message, the new ChatMessage node is added INSIDE the live region (not by
  replacing the region) so assistive tech announces it. Assert: the message list
  element has `role="log"` and `aria-live="polite"`, and a message appended after
  initial render appears as a child of that same live-region element.
- **WCAG-S014-4 (target size, 2.5.8):** the Send button is ≥ 24×24 CSS px
  (bounding-box assertion); the text field meets the same.
- **WCAG-S014-5 (keyboard send, 2.1.1):** pressing **Enter** in the focused chat
  input submits the message (input clears, `onSend` fired with the typed text);
  the Send button is also reachable by Tab and activates with Enter/Space. No
  keyboard trap — Tab leaves the chat input to the Send button and onward.
- **WCAG-S014-6 (focus not lost on send, 2.4.3/3.2.x):** after submitting (Enter
  or Send click), keyboard focus remains in the chat input (now cleared) — focus
  is NOT moved to the board, the button, or document body. The chat input is NOT
  autofocused on mount, and an incoming message does NOT move focus.
- **WCAG-S014-7 (sender distinction not colour-only, 1.4.1):** each message shows
  a TEXT sender label ("You" for own messages, "Opponent" otherwise) in
  `data-testid="chat-message-sender"`; self/other is distinguishable with colour
  disabled. Assert the label textContent, not a class/colour.
- **WCAG-S014-8 (display-side XSS — render as TEXT, complements architect SM-3):**
  a message whose text is `<img src=x onerror=alert(1)>` renders as the literal
  string — `chat-message-text` `textContent` equals the raw input string, no
  `<img>` element is created in the DOM, no script/handler fires. Built via React
  text interpolation `{msg.text}`; `dangerouslySetInnerHTML` is prohibited on the
  chat components (code-policy pin, per slice OI-CHAT-2). This is the
  DISPLAY-side guarantee; the architect owns the data-side server normalisation.
- **WCAG-S014-9 (contrast, 1.4.3 — both schemes):** message text uses `--text`
  (≥ 4.5:1 vs `--surface`, verified s009) and the sender label uses `--text` or
  `--text-muted` (both verified ≥ 4.5:1) in light AND dark scheme. The Send button
  meets ≥ 3:1 UI / ≥ 4.5:1 if its label is text-on-accent. axe contrast: zero
  violations on the chat region in both `color-scheme` states.
- **WCAG-S014-10 (reduced motion, 2.3.3):** if a new message uses any
  appear/fade transition, it is `--motion-fast` AND wrapped in
  `@media (prefers-reduced-motion: reduce) { transition: none; }`. No flashing
  > 3×/s. (Default is no animation; this gates any that is added.)

### Visual-structural / layout-geometry condition (TESTABLE)

- **LAYOUT-S014-1 (chat list stacks vertically below the board):** the
  ChatMessageList lays messages out as a vertical stack (each ChatMessage's
  bounding-box `top` is greater-or-equal the previous message's `bottom`; messages
  do not sit side-by-side / collapse onto one line). AND the ChatPanel's
  bounding-box `top` is below the board container's `bottom` (chat is beneath, not
  overlapping, the 3×3 grid). Assert via computed style (`display:flex`
  `flex-direction:column` or `display:block` stacking) + bounding-box geometry —
  this is the "don't render as a line / don't overlap the board" guard analogous
  to the s002 board-geometry lesson. The board's own 3×3 grid geometry is NOT
  re-asserted here (owned by its existing test) and NOT disturbed.

---

## Stable selectors the engineer MUST expose (the contract)

Preference order per skill: `getByRole(role,{name})` > `aria-label` > `data-testid`.
The slice fixes two testids verbatim (`chat-input`, `chat-send-btn`) — honoured.

| Element | Role + name (primary) | data-testid (hook) |
|---------|----------------------|--------------------|
| Chat panel region | `region` name "Game chat" | `chat-panel` |
| Message list (live region) | `log` name "Messages" | `chat-messages` |
| A single message row | — | `chat-message` |
| Message sender label | — | `chat-message-sender` |
| Message text | — | `chat-message-text` |
| Chat text field | `textbox` name "Chat message" | `chat-input` |
| Send button | `button` name "Send" | `chat-send-btn` |

No derived `nth(N)` / count / text-exclusion selectors (process §22–§23). The
per-message rows are addressed by `data-testid="chat-message"` (a set) plus their
child sender/text testids.

---

## NOT designed yet (deferred)

- **Persistence / chat history UI** — none (in-memory only, slice scope).
- **Scroll-to-bottom / auto-scroll affordance** — explicitly out of s014 scope
  (nice-to-have); the live region announces regardless of scroll.
- **Typing indicators, read receipts, timestamps, emoji/rich-text** — out of
  scope (slice §NOT in scope). No components designed for them.
- **Chat on any non-active surface** — none; chat is confined to the
  `playing-online` active branch.
- **s015 done-condition surfaces** — the 1s p95 latency proof, the scope-vanish
  on disconnect Playwright, and the cross-game injection scope test are s015. This
  spec gives the structure those tests will select against (stable selectors +
  live-region + XSS-text conditions above).
- **POLISH pass** — token convergence / spacing / state-completeness tuning runs
  AFTER the engineer's functional build is green (separate ui-designer task).
