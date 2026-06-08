# Component inventory — oxo-online

Library mapping: all components are **custom** (no component library adopted).
Selectors follow the existing SPA convention: `getByRole(role, {name})` first,
`data-testid` for non-semantic hooks. Existing testids in use: `play-online`-style
aria-labels, `game-code`, `copy-link`, `back-to-menu`, `opponent-disconnected`,
`join-connecting`, `host-connecting`, `spinner`.

> Seeded at s009 (iter 14). Existing components are catalogued from the live SPA
> for completeness; the two NEW rows (NameField, Leaderboard/LeaderboardRow) are
> this slice's additions.

| Component | States | Stable selector | Maps to | A11y notes |
|-----------|--------|-----------------|---------|------------|
| ModeSelector (existing) | default / pressed | role=group name "game mode"; buttons by aria-label/name | custom | `aria-pressed` on Two player / vs Computer; Play Online / Join a game are actions |
| JoinScreen (existing) | default / connecting / error | role=textbox name "Game code"; `data-testid=join-connecting` | custom | label `for=join-code`; `role=status` connecting; `role=alert` error |
| OnlineBoard / Board / Cell (existing) | default / locked / win / draw | board cells by role | custom | not in s009 scope |
| Status (existing) | playing / won / drawn | text region | custom | not in s009 scope |
| Waiting panel (existing) | waiting | `data-testid=game-code`, `copy-link` | custom | `role=status` connecting |
| **NameField** (NEW s009) | default / focus / filled / default-AAA / disabled (during create/join in flight) | `getByRole('textbox',{name:'Your name'})`; also `data-testid=name-input` | custom | `<label for=name-input>Your name</label>`; `maxlength=10`; uppercase via CSS only (value normalised in logic, engineer's port); `autocomplete=off`; placeholder NOT used as label |
| **Leaderboard** (NEW s009) | loading / empty / error / populated | `data-testid=leaderboard`; semantic `<table>` with `<caption>`/`aria-label` "Leaderboard" | custom | real `<table>` with `<th scope=col>` Rank/Name/W/D/L and `<th scope=row>` is optional; `role=status` live region for load/refresh; names rendered as TEXT only |
| **LeaderboardRow** (NEW s009) | default / rank-1 (accent) | `data-testid=leaderboard-row` (one per row); cells `leaderboard-name`, `leaderboard-wins`, `leaderboard-draws`, `leaderboard-losses` | custom | rank-1 highlight uses accent border/weight, NOT colour alone; numerals tabular-nums; name cell is the row's `<th scope=row>` or first `<td>` carrying `data-testid=leaderboard-name` |
| **ChatPanel** (NEW s014) | active / game-over (input absent) | `getByRole('region',{name:'Game chat'})`; also `data-testid=chat-panel` | custom | chat region landmark BELOW the board within the `playing-online` branch; distinct from the board region; never inside the board container (board 3×3 geometry untouched) |
| **ChatMessageList** (NEW s014) | empty / populated | `getByRole('log',{name:'Messages'})`; also `data-testid=chat-messages` | custom | IS the live region: `role=log` + `aria-live=polite` + `aria-relevant=additions` so incoming messages announce without moving focus; empty-state copy "No messages yet — say hi."; vertical stack (LAYOUT-S014-1) |
| **ChatMessage** (NEW s014) | self ("You") / other ("Opponent") | `data-testid=chat-message`; label `chat-message-sender`; text `chat-message-text` | custom | sender distinction is LABEL TEXT, not colour (1.4.1); text rendered via React `{msg.text}` ONLY — `dangerouslySetInnerHTML` PROHIBITED (display-side XSS guard, complements server normalisation) |
| **ChatInput** (NEW s014) | default / focus / typing / empty(no-op) | `getByRole('textbox',{name:'Chat message'})` = `data-testid=chat-input`; Send `getByRole('button',{name:'Send'})` = `data-testid=chat-send-btn` | custom | `<label for=chat-input>Chat message</label>` (not placeholder-as-label); Enter submits; on submit focus STAYS in input; NOT autofocused; `maxlength=200`; no error state surfaced (best-effort delivery) |

## New-component responsibilities (presentational contract)

- **NameField** — renders the labelled name input. Owns presentation only; the
  controlled value, trim, 10-char cap, "AAA" default, and `sessionStorage`
  persistence are the engineer's state/logic (port side), not the designer's.
- **Leaderboard** — renders the standings table from a `rows` prop and a status
  (`loading | error | ready`). Renders empty-state copy when `rows` is empty.
  Renders each name as plain text (no `dangerouslySetInnerHTML`, no HTML interp).
- **LeaderboardRow** — one standings row: rank, name, W, D, L. Pure presentation.

## New-component responsibilities (s014 chat — presentational contract)

- **ChatPanel** — renders the chat region (heading + list + input) below the
  board in the active-game branch. Presentation/layout only; receives `messages`,
  `selfRole`, `onSend` from the engineer's state.
- **ChatMessageList** — renders the `messages` array as a vertical stack; is the
  `role=log` live region; renders empty-state copy when there are no messages.
- **ChatMessage** — one row (sender label + text). Resolves "You"/"Opponent" from
  `sender` vs `selfRole`. Renders text via `{msg.text}` only.
- **ChatInput** — labelled field + Send; clears on submit; calls `onSend(text)`.
  Local controlled value only — WS dispatch, trim, 200-char enforcement, and
  self-role resolution are the engineer's port logic, NOT the designer's.

## States that MUST exist (the "unfinished" tells)

- NameField: visible `:focus-visible` ring; shows the pre-filled value (AAA or
  the session name) on mount.
- Leaderboard: **loading** (skeleton or "Loading standings…" in a live region),
  **empty** ("No scores yet — be the first."), **error** ("Couldn't load the
  leaderboard."), **populated**.
- ChatMessageList: **empty** ("No messages yet — say hi.") and **populated** —
  never a blank panel while the game is active.
- ChatInput: visible `:focus-visible` ring; empty/whitespace submit is a no-op
  (does not dispatch, does not clear meaningful state).
