# Patterns — oxo-online

> Seeded at s009 (iter 14, ui-designer). Documents the LIVE navigation model as
> shipped, plus the s009 additions. Extend additively.

## Navigation / IA model (entry points, hierarchy, back/cancel)

The live entry surface is **`GameRoot` at route `/`** — NOT the `/title`
placeholder (`TitleScreen.tsx` is a vestigial slice-001 shell kept behind
`/title`; it is off the live path). GameRoot renders, in its `idle` phase, the
**mode-selector** (Two player / vs Computer / Play Online / Join a game) and the
local game board. This single-page `idle` view IS the "title / mode-selector
screen" the slice refers to.

Phases (single component, no router nav between them):
`idle` → (Play Online) → `creating` → `waiting` → `playing-online` → result
       → (Join a game) → `joining` (JoinScreen) → `playing-online` → result.
Back path: every online phase returns to `idle` (mode buttons / back-to-menu).

**s009 additions to the `idle` view** (the mode-selector landing):
- **NameField** sits ABOVE the mode buttons (entered before create/join — the
  name must reach the server at create/join time, see slice "Where the name is
  entered"). Pre-filled with the session name or the "AAA" default, so it is
  never a gate.
- **Leaderboard panel** sits BELOW the mode buttons / local board, in the
  `idle` view, fetched on mount. Placement mirrors the existing `TitleScreen`
  scaffold (which already reserved a `.leaderboard` section) so the idiom is
  consistent. It is read-only and shared across all browsers.

Why the `idle` view and not `/title`: `/title` is not on the live path; placing
new surfaces there would ship dead UI. The leaderboard also belongs where the
player lands and returns between games (motivation-through-standing job).

## Click-path budgets (core job -> max steps)

Start state: app loaded at `/` (idle view), name field pre-filled.

| Job | Budget | Path |
|-----|--------|------|
| Play with a name set (host) | **1 click** (0 mandatory for the name) | NameField is pre-filled (AAA or session) → click "Play Online". Typing a name is OPTIONAL keystrokes, never a required step or gate. |
| Play with a name set (guest) | **1 click + code entry** | NameField pre-filled → click "Join a game" → enter code → Join. (Code entry is the pre-existing join cost, unchanged.) |
| See the leaderboard | **0 clicks** | Rendered in the idle view on load; no navigation, no expand. |

Binding rule (arcade): name-entry adds NO mandatory click/keystroke to starting
a game. The default "AAA" means a player can ignore the field entirely. A design
that gates "Play Online" behind a non-empty name is a click-path-over-budget
principle failure.

## Standard states (empty / loading / error / responsive)

- **Loading** (async fetch): a `role=status` `aria-live=polite` region announces
  "Loading standings…"; spinner only after ~500ms (matches existing
  `SPINNER_DELAY_MS` pattern). For the leaderboard a brief skeleton is acceptable.
- **Empty**: explicit copy, never a blank panel — "No scores yet — be the first."
- **Error**: `role=alert` text — "Couldn't load the leaderboard." Non-blocking;
  the game remains fully playable (the board is the primary surface).
- **Responsive**: single centered column, `max-width: 32rem` (existing
  `.title-screen` constraint). The leaderboard table stays within that width;
  columns are Rank / Name / W / D / L — name flexes, tallies are fixed narrow
  tabular-nums columns. No horizontal scroll at 320px width.
