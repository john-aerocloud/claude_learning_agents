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

## New-component responsibilities (presentational contract)

- **NameField** — renders the labelled name input. Owns presentation only; the
  controlled value, trim, 10-char cap, "AAA" default, and `sessionStorage`
  persistence are the engineer's state/logic (port side), not the designer's.
- **Leaderboard** — renders the standings table from a `rows` prop and a status
  (`loading | error | ready`). Renders empty-state copy when `rows` is empty.
  Renders each name as plain text (no `dangerouslySetInnerHTML`, no HTML interp).
- **LeaderboardRow** — one standings row: rank, name, W, D, L. Pure presentation.

## States that MUST exist (the "unfinished" tells)

- NameField: visible `:focus-visible` ring; shows the pre-filled value (AAA or
  the session name) on mount.
- Leaderboard: **loading** (skeleton or "Loading standings…" in a live region),
  **empty** ("No scores yet — be the first."), **error** ("Couldn't load the
  leaderboard."), **populated**.
