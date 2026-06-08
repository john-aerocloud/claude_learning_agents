# UI design — s009 arcade-scoreboard (STRUCTURE)

Applies: **YES** — two new user-facing surfaces (name-entry field, shared
leaderboard display). ui-designer STRUCTURE pass, iter 14. First UI slice on this
project → the project design system was established this slice
(`work/oxo-online/design/`).

## Surfaces touched

The live entry surface is **`GameRoot` at `/`**, `idle` phase — the mode-selector
landing (Two player / vs Computer / Play Online / Join a game + local board).
This is the real "title / mode-selector screen". `TitleScreen.tsx` at `/title`
is a vestigial slice-001 placeholder OFF the live path — it is NOT used. Both new
surfaces land in the `idle` view:

1. **NameField** — labelled "Your name" input, ABOVE the mode buttons.
2. **Leaderboard panel** — read-only shared standings table, BELOW the mode
   buttons / local board, fetched on mount.

Not touched: the board, JoinScreen internals, online phases beyond passing the
name into the existing create (`POST /api/games`) and WS `join` calls (wire
change = engineer's; the field itself is the only new control on those paths).

## Navigation / IA delta

- **Name-entry** is captured at the `idle` landing, before create/join, because
  the server must associate the name at create/join time (slice "Where the name
  is entered"). It is pre-filled (session name, else "AAA") so it is a value the
  player may edit, never a gate.
- **Leaderboard** lives in the `idle` view — where the player lands and returns
  between games — directly serving the motivation-through-standing job. It is
  read-only, shared across browsers, refreshed on each mount/return to idle.
- No new routes, no new phases, no modal. The IA stays a single shallow page.

Justification vs alternatives: placing either surface on `/title` would ship dead
UI (off the live path). Placing the leaderboard behind a click/expand would cost
a navigation step against a job whose whole point is at-a-glance standing — so it
is shown at 0 clicks.

## Component decomposition (component -> states -> stable selector)

### NameField (NEW)
- Props: `value: string`, `onChange(next: string)`, `disabled?: boolean`.
  (Default "AAA", 10-char cap, trim, sessionStorage persistence = engineer's
  state/port logic, NOT this component.)
- Markup: `<label for="name-input">Your name</label>` +
  `<input id="name-input" data-testid="name-input" maxlength={10}
  autocomplete="off">`.
- States: default / `:focus-visible` (focus ring) / filled / pre-filled-AAA /
  disabled (while create/join in flight).
- Selector: `getByRole('textbox', { name: 'Your name' })`; also `name-input`.

### Leaderboard (NEW)
- Props: `rows: LeaderboardRowData[]`, `status: 'loading' | 'error' | 'ready'`.
- Markup: a real `<table data-testid="leaderboard">` with
  `<caption>` or `aria-label="Leaderboard"`, a `<thead>` of `<th scope="col">`
  Rank / Name / W / D / L, and a `<tbody>` of LeaderboardRow. A `role="status"`
  `aria-live="polite"` region announces load/refresh.
- States: **loading** ("Loading standings…" in the live region; spinner after
  ~500ms) / **empty** ("No scores yet — be the first.") / **error**
  (`role="alert"` "Couldn't load the leaderboard.") / **populated**.
- Selector: `data-testid="leaderboard"` (also reachable as
  `getByRole('table', { name: 'Leaderboard' })`).
- Names render as PLAIN TEXT only (React `{name}` interpolation — no
  `dangerouslySetInnerHTML`, no HTML parsing). This is the display half of the
  stored-XSS defence the architect handles on the data side.

### LeaderboardRow (NEW)
- Props: `rank, name, wins, draws, losses`.
- Markup: `<tr data-testid="leaderboard-row">` with the name in a
  `<th scope="row" data-testid="leaderboard-name">` (or first `<td>` carrying
  that testid) and `<td>`s carrying `leaderboard-wins` / `leaderboard-draws` /
  `leaderboard-losses`. Numerals use `tabular-nums`.
- States: default / rank-1 highlight (accent border + heavier weight — NOT colour
  alone).
- Selectors: row `leaderboard-row`; cells `leaderboard-name`, `leaderboard-wins`,
  `leaderboard-draws`, `leaderboard-losses`.

## Stable selectors the engineer MUST expose

| Element | Primary selector | data-testid |
|---------|------------------|-------------|
| Name input | `getByRole('textbox',{name:'Your name'})` | `name-input` |
| Leaderboard table | `getByRole('table',{name:'Leaderboard'})` | `leaderboard` |
| A standings row | — | `leaderboard-row` |
| Name cell | — | `leaderboard-name` |
| Wins cell | — | `leaderboard-wins` |
| Draws cell | — | `leaderboard-draws` |
| Losses cell | — | `leaderboard-losses` |
| Load/refresh status region | `getByRole('status')` | (live region; no testid needed) |
| Leaderboard error | `getByRole('alert')` | (within leaderboard panel) |

`leaderboard-score` was suggested in the brief; superseded by the three explicit
per-result testids (`-wins`/`-draws`/`-losses`) so each tally is independently
assertable (SM-1, SM-2 need the specific column). If a single combined string is
also wanted, expose it additionally as `leaderboard-score` — but the three
column testids are the contract.

## Click-path budget (per use case, with justification)

Start: app loaded at `/`, idle view, name field pre-filled.
- **Play with a name set (host):** 1 click ("Play Online"); 0 mandatory for the
  name (pre-filled). Typing a name = optional keystrokes.
- **Play with a name set (guest):** 1 click ("Join a game") + the pre-existing
  code entry + Join; name adds nothing.
- **See the leaderboard:** 0 clicks (rendered on load in the idle view).

BINDING (arcade): name-entry MUST NOT add a mandatory click/keystroke or gate to
starting a game. "AAA" default means the field is ignorable. Gating "Play
Online"/"Join a game" on a non-empty name is a click-path-over-budget failure.

## Accessibility conditions (WCAG 2.2 AA) -> fold into acceptance.md (GATE 3)

Authored as testable conditions for the tester (axe + Playwright). Product
assembles these into `acceptance.md` alongside the architect's T/S conditions.

- **A11Y-1 (Name label, 1.3.1/4.1.2):** the name input has a programmatic
  accessible name "Your name" via an associated `<label for="name-input">`.
  `getByRole('textbox',{name:'Your name'})` resolves; axe `label` rule passes.
- **A11Y-2 (Keyboard operable, 2.1.1):** the name field and every leaderboard
  interactive element are reachable and operable by keyboard; no keyboard trap.
- **A11Y-3 (Focus order, 2.4.3):** logical focus order in the idle view — name
  field is in the tab order before the mode buttons (it sits above them); the
  leaderboard, being read-only, introduces no focus stops out of order.
- **A11Y-4 (Visible focus, 2.4.7):** the name field shows a visible
  `:focus-visible` indicator with contrast >= 3:1 against its background
  (`--focus-ring`, 2px solid + 2px offset).
- **A11Y-5 (Contrast, 1.4.3):** leaderboard text (names, headers, tallies) and
  the name field text meet >= 4.5:1 (>= 3:1 for the rank-1 UI highlight) against
  their backgrounds in both light and dark schemes. axe `color-contrast` passes.
- **A11Y-6 (Target size, 2.5.8):** the name input target is >= 24x24 CSS px.
- **A11Y-7 (Table semantics, 1.3.1):** the leaderboard is a real `<table>` (or
  `role=table`) with column headers (`<th scope="col">` Rank/Name/W/D/L) so a
  screen reader announces each cell with its column. axe table rules pass.
- **A11Y-8 (No colour-only meaning, 1.4.1):** W/D/L meaning is conveyed by visible
  column headers, not colour; the rank-1 highlight is not colour-only (also
  weight/border).
- **A11Y-9 (Live region for async, 4.1.3):** leaderboard load/refresh and error
  states are exposed via a `role=status`/`role=alert` live region so they are
  announced, not silent.
- **A11Y-10 (Reduced motion, 2.3.3):** the name-field focus transition and any
  leaderboard fade honour `prefers-reduced-motion: reduce` (no motion when set);
  no content flashes more than 3x/s.
- **A11Y-11 (Name rendered as text, display-side XSS / 1.3.1):** player names on
  the board render as plain text (React text interpolation), never as parsed
  HTML — verified by a row whose name contains markup characters rendering them
  literally. (Data-side sanitisation is the architect's; this is the DISPLAY
  guarantee.)
- **A11Y-12 (One h1 / heading order, 1.3.1):** the leaderboard panel heading is a
  correctly-ordered `<h2>` (the page h1 is the existing title); axe
  `heading-order` passes.

## NOT designed yet (deferred)

- In-game name display to the opponent (slice §"NOT in scope").
- Name-change mid-session, name claiming/auth — no UI (slice scope).
- Pagination / full board, avatars, graphs — top-N flat list only.
- Latency done-condition proof UI — that is s010's Playwright smoke, not a
  surface.
- Migration of existing components (mode buttons, title) to design tokens / focus
  styling — recorded in `design-system.md` backlog; out of s009 scope.
