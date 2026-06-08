# Design system — oxo-online

Library: **none** (token-based custom components).
Theming: tokens are CSS custom properties on `:root` in `src/app/src/index.css`;
components reference `var(--token)`, never raw values. Light/dark pairings are
resolved with CSS `light-dark(<light>, <dark>)` against the page's
`color-scheme: light dark`, so a single token carries both scheme values.

> POLISH (s009, ui-designer, iter 14): the tokens specified below were declared
> in `:root` and the new s009 surfaces (name field, leaderboard panel, copy
> controls) were converged onto them — they had shipped functionally with raw
> hex (`#1a73e8`, `#b00020`) and off-4px-scale spacing (`0.35/0.4/0.6/0.85/0.9rem`,
> `1.25rem`). No behaviour/markup/selector changed. Existing pre-s009 components
> remain on the migration backlog (below).

> First established at s009 (ui-designer, iter 14). Seeded from values already
> present in the SPA (`index.css`, `TitleScreen.tsx`, `GameRoot.tsx`). This is a
> SEED, not a retrofit: existing components are not rewritten to tokens in this
> slice — new s009 surfaces (name field, leaderboard) MUST use tokens, and
> existing off-token values are recorded below as the migration backlog so future
> polish passes can converge them. Keep additive.

The app is an arcade tic-tac-toe game. A light retro/arcade idiom is on-theme
(uppercase monospace initials, tabular standings) but the existing visual
language is a clean system-font centered single-column layout — do NOT introduce
a parallel aesthetic. Add arcade flavour only where it is free (uppercasing the
name field, tabular-nums on scores).

## Colour (semantic -> value, contrast vs paired bg)

The SPA uses `color-scheme: light dark` and currently leans on the UA default
text/background (no explicit `--text`/`--surface` set). To make contrast
testable, s009 introduces explicit semantic tokens. Until existing components
migrate, these are authoritative for NEW surfaces.

| Token | Light value | Dark value | Paired bg | Min ratio | Notes |
|-------|-------------|------------|-----------|-----------|-------|
| `--surface` | `#ffffff` | `#1a1a1a` | — | — | page background |
| `--surface-muted` | `#f4f4f5` | `#262626` | — | — | leaderboard row zebra / panel fill |
| `--text` | `#18181b` | `#f4f4f5` | surface | 4.5:1 body | primary text; verified >= 4.5:1 both schemes |
| `--text-muted` | `#52525b` | `#a1a1aa` | surface | 4.5:1 | tagline, secondary; verified >= 4.5:1 |
| `--border` | `rgba(128,128,128,0.3)` | same | surface | 3:1 (UI) | hairlines, table rules (existing `.leaderboard` border) |
| `--accent` | `#2563eb` | `#60a5fa` | surface | 3:1 (UI) / 4.5:1 if text | primary action / rank-1 highlight |
| `--danger` | `#b91c1c` | `#f87171` | surface | 4.5:1 | error/alert text (`.join-error`, `.online-error`) |
| `--focus-ring` | `#2563eb` | `#60a5fa` | surface | >= 3:1 | `:focus-visible` outline; 2px solid + 2px offset |

Win/Draw/Loss tallies do NOT get colour-only meaning — each column carries a
visible header (W / D / L) so meaning never relies on colour (1.4.1).

## Type scale (step -> size / line-height / weight)

Observed steps (rem): the SPA uses `3rem` (h1), `1.1rem` (buttons), `1rem`
(body). Formalised to a small stepped scale:

| Step | Size | Line-height | Weight | Use |
|------|------|-------------|--------|-----|
| `--text-xs` | 0.75rem / 12px | 1.4 | 500 | table column headers (W/D/L), rank |
| `--text-sm` | 0.875rem / 14px | 1.4 | 400 | secondary / muted |
| `--text-md` | 1rem / 16px | 1.5 | 400 | body, leaderboard cells, input text |
| `--text-lg` | 1.1rem / ~18px | 1.4 | 500 | buttons (existing `.play-options`/`.mode`) |
| `--text-xl` | 1.5rem / 24px | 1.3 | 600 | section headings (h2 — Leaderboard) |
| `--text-2xl` | 3rem / 48px | 1.1 | 700 | h1 title (existing) |

Font family (existing, keep): `system-ui, -apple-system, "Segoe UI", Roboto,
sans-serif`. Score numerals use `font-variant-numeric: tabular-nums` so columns
align (arcade idiom, free). The name field uses `text-transform: uppercase` +
`letter-spacing: 0.05em` (matches the h1 letter-spacing already in use).

## Spacing scale (base + multiples)

Base unit **4px (0.25rem)**. Existing values (`0.25/0.75/1/1.5/2 rem`) all fall
on it. Allowed steps: `4 / 8 / 12 / 16 / 24 / 32 / 48` px
(`0.25 / 0.5 / 0.75 / 1 / 1.5 / 2 / 3 rem`). No off-scale spacing on new surfaces.

## Radii / Elevation / Motion

- **Radii:** `--radius-sm: 0.5rem` (existing button radius). Inputs and the
  leaderboard panel reuse it. One radius only.
- **Elevation:** flat. Separation by `--border` hairlines (existing
  `.leaderboard` top border), not shadow. No new elevation token in this slice.
  (The rank-1 accent rule is `box-shadow: inset 3px 0 0 var(--accent)` — an
  accent *rule*, not elevation; chosen over `border-left` because a `<tr>`
  border under `border-collapse: collapse` + zebra striping renders
  inconsistently and would shift column alignment.)
- **Motion:** `--motion-fast: 120ms ease` for the name-field focus transition and
  the leaderboard fade-in on load. MUST be wrapped in
  `@media (prefers-reduced-motion: reduce) { transition: none; }` (2.3.3 path).
  No flashing, no looping animation (no content flashes > 3x/s).

## Migration backlog (existing off-token values — NOT fixed this slice)

- `index.css` uses raw `rem` literals and UA default text colour. Converging
  `.title-screen`, `.play-options`, `.leaderboard` placeholder to tokens is a
  future polish item, not s009 scope.
- No explicit focus-visible styling exists on the existing `.mode` buttons —
  flagged for a future a11y polish pass (out of s009 scope; s009 owns focus only
  on its NEW name field + leaderboard, see ui-design + acceptance conditions).
