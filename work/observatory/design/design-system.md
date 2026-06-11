---
project: observatory
owner: ui-designer
seeded: s002-pipeline-map
status: living — additive per slice; do not speculate ahead of need
---

# Observatory design system — tokens

Single source of truth for tokens. Express as CSS custom properties on `:root`
in the SPA (`src/app/styles/tokens.css`). No component library adopted (none
named in requirements) → token-based custom components.

> **Seed scope:** this is the minimal set the pipeline map (s002) needs. Extend
> additively for CHK-3/CHK-4. The state-encoding tokens below are deliberately
> **redundant** (every state carries icon + text + colour) per requirements §8
> ("state is never colour-only") and the project a11y NFR.

## Colour — base

| Token | Value | Use | Contrast pairing |
|---|---|---|---|
| `--c-bg` | `#0f1115` | App background | text on it ≥ AAA |
| `--c-surface` | `#1a1d24` | Queue box surface | — |
| `--c-surface-raised` | `#222630` | Hover/focus surface | — |
| `--c-border` | `#3a404c` | Box borders, arrows (default) | — |
| `--c-text` | `#e8eaed` | Primary text on bg/surface | ≥ 13:1 on `--c-bg` |
| `--c-text-dim` | `#a6adbb` | Secondary/label text | ≥ 6:1 on `--c-surface` |
| `--c-focus` | `#5aa9ff` | Focus ring (keyboard) | ≥ 3:1 vs surface (non-text UI) |

## Colour — queue state (REDUNDANT encoding: colour is one of three cues)

State is conveyed by **icon + text + colour together**. Colour alone is never
the signal. Each colour is chosen to survive deuteranopia/protanopia (the three
state hues differ in lightness + shape + label, not only hue).

| State | Token | Value | Icon (shape cue) | Text label (the authoritative cue) |
|---|---|---|---|---|
| `ok` | `--c-state-ok` | `#3aa66f` | none (clean) | (no badge) |
| `starving` | `--c-state-starving` | `#4ea3e0` | `▽` (down-triangle, "below floor") | `"starving"` |
| `over-wip` | `--c-state-over` | `#e0a23a` | `△` (up-triangle, "above cap") | `"over-WIP"` |
| `constraint` | `--c-constraint` | `#d96c8f` | `◆` (diamond, distinct shape) | `"constraint"` |

- `starving` (blue, ▽) and `over-wip` (amber, △) are opposite-direction
  triangles → distinguishable in pure greyscale by shape and by text.
- `constraint` (◆ diamond, magenta) is a **different visual channel** (a corner
  ribbon/badge, not a fill) so it can co-occur with starving/over-WIP on the
  same box without ambiguity.

| Token | Value | Use |
|---|---|---|
| `--c-state-starving-bd` | `#4ea3e0` | starving box border (≥ 3:1 vs `--c-surface`) |
| `--c-state-over-bd` | `#e0a23a` | over-WIP box border (≥ 3:1 vs `--c-surface`) |
| `--c-constraint-bd` | `#d96c8f` | constraint marker (≥ 3:1 vs `--c-surface`) |

## Type scale

| Token | Value | Use |
|---|---|---|
| `--fs-count` | `2rem / 700` | Queue count (the big number) |
| `--fs-label` | `0.95rem / 600` | Queue name |
| `--fs-meta` | `0.8rem / 500` | Buffer meta ("1 / floor 3"), state badge text |
| `--ff-base` | system-ui, sans-serif | All text |

## Spacing scale (4px base)

| Token | Value |
|---|---|
| `--sp-1` | `4px` |
| `--sp-2` | `8px` |
| `--sp-3` | `12px` |
| `--sp-4` | `16px` |
| `--sp-6` | `24px` |
| `--sp-8` | `32px` |

## Radii / elevation / motion

| Token | Value | Use |
|---|---|---|
| `--radius-box` | `10px` | Queue box corners |
| `--radius-badge` | `6px` | State badges |
| `--elev-box` | `0 1px 2px rgba(0,0,0,.4)` | Queue box |
| `--focus-ring` | `0 0 0 3px var(--c-focus)` | Keyboard focus (≥ 3:1, ≥ 2px) |
| `--dur-fast` | `120ms` | Count/state transition (respect reduced-motion) |

**Reduced motion:** under `@media (prefers-reduced-motion: reduce)`, transitions
collapse to `0ms`; live-update (UC6) changes value instantly with no animation.

## Target size (WCAG 2.2 — 2.5.8 Target Size minimum)

Any focusable/interactive element ≥ `24×24px`. Queue boxes (the only focusable
elements in s002) far exceed this; this token pins the floor for future controls.

| Token | Value |
|---|---|
| `--target-min` | `24px` |

## CHK-3 (s003) additive tokens — DORA panel / stage cards / time-thief

Additive only; nothing above changed. The constraint encoding (`◆` + `"constraint"`
text + `--c-constraint`) and the redundant-state rule are REUSED unchanged for the
StageCard constraint highlight — no new constraint token is introduced.

| Token | Value | Use | Contrast / note |
|---|---|---|---|
| `--fs-metric` | `1.75rem` | DORA metric value (the big figure) | weight `--fw-metric` 700 |
| `--fw-metric` | `700` | metric value weight | — |
| `--fs-metric-window` | `0.8rem` | metric window line ("/ 20 slice(s)") | uses `--c-text-dim` ≥ 6:1 |
| `--sp-section` | `32px` | vertical gap between dashboard sections | = `--sp-8`; named for intent |
| `--card-min` | `200px` | StageCard min track width (auto-fill grid) | layout/geometry contract |
| `--gap-card` | `16px` | StageCardGrid gap | = `--sp-4` |
| `--c-source-link` | `#5aa9ff` | source-link text/affordance colour | = `--c-focus`; ≥ 4.5:1 text on `--c-surface` |
| `--fs-source` | `0.72rem` | source-link caption | colour-paired; never the SOLE cue (text "source" present) |

**Source-link colour rule:** the source link is conveyed by a visible text
affordance (a "source" caption or a `↗`-prefixed file label) PLUS the link colour
— colour is never the only cue, consistent with the §8 redundant-encoding rule.

## CHK-2 re-scope (s004) additive tokens — value-stream map

Additive only; nothing above changed. The in-flight (WIP>0) signal REUSES the §8
redundant-encoding rule (icon `●` + text "in-flight" + border + colour — colour is
one of four cues, never alone). The gate distinction is non-colour-redundant (text
"gate" + `◇` glyph + a diamond-edge node shape). The constraint encoding
(`◆` + "constraint" + `--c-constraint`) is REUSED unchanged for a constraint stage.

| Token | Value | Use | Contrast / note |
|---|---|---|---|
| `--c-wip` | `#7d5fff` | in-flight (WIP>0) accent — a distinct hue from ok/starving/over/constraint | ≥ 4.5:1 text on `--c-surface` |
| `--c-wip-bd` | `#7d5fff` | in-flight node + pill border | ≥ 3:1 vs `--c-surface` |
| `--node-min` | `200px` | StageNode min width (= `--card-min`; reused intent) | layout/geometry contract (GEO-2) |
| `--gap-node` | `16px` | inter-node + within-lane gap (= `--sp-4`) | — |
| `--gap-lane` | `24px` | inter-lane band gap (= `--sp-6`) | — |
| `--fs-stage-fig` | `1.5rem` | per-stage figure value (below `--fs-metric`) | weight reuses `--fw-metric` 700 |

**In-flight (WIP>0) rule:** the signal is icon `●` (aria-hidden, shape cue) + visible
text "N in-flight" (the authoritative cue) + the InFlightBadge pill silhouette
(shape) + `--c-wip` accent/border (colour). At `wip=0` none of these render — a plain
"WIP 0" figure only (no false positives). Pulse animation is gated behind
`prefers-reduced-motion: no-preference`; under reduce the three non-motion cues carry it.

**Gate rule:** intake & deploy nodes are gates — visible text "gate" + `◇` glyph +
a diamond-edge node border distinct from the work-node `--radius-box`. Three
non-colour cues; gate identity survives greyscale.

## CHK-4 (s005) additive tokens — work-item tree + drill detail pane

Additive only; nothing above changed. The tree-node state encoding REUSES the §8
redundant rule (icon/glyph + text label + colour band — colour is one of three
cues, never alone). The `/process` vs `/work` space distinction is
NON-colour-redundant (visible text "work"/"process" + icon + colour band) per
requirements §6/§8/§175.

| Token | Value | Use | Contrast / note |
|---|---|---|---|
| `--tree-indent` | `16px` | per-level indent step (= `--sp-4`) | **GEO-1 contract** — child left offset > parent by ≥ this |
| `--tree-node-min-h` | `28px` | node row min height | toggle/hit area ≥ `--target-min` (2.5.8) |
| `--rail-width` | `320px` | WorkItemTree left-rail width | layout contract |
| `--pane-min-width` | `420px` | DetailPane min width | **GEO-3** — pane never overlaps the tree rail |
| `--c-tree-state-done` | `#3aa66f` | "done" band (= `--c-state-ok` lightness) | text "done" is the authoritative cue; ≥ 3:1 edge vs `--c-surface` |
| `--c-tree-state-active` | `#7d5fff` | "in-progress" band (= `--c-wip` channel) | text "in-progress"; ≥ 3:1 edge |
| `--c-tree-state-backlog` | `#a6adbb` | "backlog" band (= `--c-text-dim`) | text "backlog"; ≥ 3:1 edge |
| `--c-tree-state-blocked` | `#d96c8f` | "blocked" band (= `--c-constraint` channel) | text "blocked"; ≥ 3:1 edge |
| `--c-tree-selected` | `#5aa9ff` | selected node accent (= `--c-focus`) | **GEO-4** selection continuity; ≥ 3:1 vs surface |
| `--c-space-work` | `#2f9e8f` | `/work` space band (teal) | paired with visible text "work" + icon `▤`; ≥ 3:1 edge vs `--c-surface` |
| `--c-space-process` | `#b07de0` | `/process` space band (violet) | paired with visible text "process" + icon `⚙`; ≥ 3:1 edge vs `--c-surface` |
| `--fs-tree` | `0.85rem` | tree node label | ≥ 4.5:1 text on surface |
| `--fs-tree-badge` | `0.72rem` | state / value-cost / space-tag badge text | colour-paired; never the SOLE cue |
| `--fs-history` | `0.8rem` | item-history row text | uses `--c-text` / `--c-text-dim` ≥ 4.5:1 |

**Tree-node state rule (REUSES §8):** state = type glyph (shape) + visible text
label (`"done"`/`"in-progress"`/`"backlog"`/`"blocked"` — authoritative) +
`--c-tree-state-*` band (colour). The four bands differ in lightness as well as
hue; with the text label and glyph the state survives greyscale and
colour-blindness (mirrors the s002 redundant-state encoding).

**Space distinction rule (NON-colour-redundant, §6/§8/§175):** `/work` =
text "work" + `▤` (aria-hidden) + `--c-space-work`; `/process` = text "process" +
`⚙` (aria-hidden) + `--c-space-process`. Colour is one of three cues; distinct
`data-space` values yield distinct VISIBLE TEXT, so the partition is assertable
without relying on colour (AC-S005-2-5 / A11Y-6).

**Reduced motion:** tree expand/collapse and DetailPane open transitions collapse
to `0ms` under `prefers-reduced-motion: reduce`; SSE re-render swaps content
instantly (no scroll/focus loss) — extends the existing reduced-motion rule.

## DEFECT-006 additive — floating DetailPane drawer (overlay)

Additive only; nothing above changed. **Supersedes the s005 in-flow DetailPane
positioning** (`position:sticky` + `width:min(440px,42vw)` + `margin-left:auto`
INSIDE `.observatory-main-col`). That composition put the pane in document flow
in the SAME column as the wide value-stream map, so opening it grew the main
column by the pane's full height (+690px measured) and reflowed the page —
DEFECT-006. The pane is re-designed as a **right-anchored drawer that floats OVER
the map** in its own stacking context, so the map's layout is identical whether
the pane is open or closed.

| Token | Value | Use | Note |
|---|---|---|---|
| `--z-drawer` | `40` | DetailPane drawer stacking layer | above the map; well above the s004 `metric-source` tooltip (z 5) |
| `--drawer-width` | `min(440px, 38vw)` | right-drawer fixed width | fixed → never participates in / reflows the map's flow; ≥ `--pane-min-width` floor preserved by the 440px cap |
| `--drawer-inset` | `var(--sp-4)` | gap from viewport top/right/bottom | keeps the drawer off the screen edges; never causes horizontal scroll |
| `--drawer-elev` | `-8px 0 32px rgba(0,0,0,.5)` | left-cast shadow | lifts the drawer visibly off the map behind it (depth cue, not colour-only) |
| `--dur-drawer` | `160ms` | slide-in transition | `0ms` under `prefers-reduced-motion: reduce` (A11Y-S005-9) |

**Drawer rule (non-modal, no scrim):** the pane is `position: fixed`, anchored to
the right viewport edge (`top/right/bottom: var(--drawer-inset)`), `width:
var(--drawer-width)`, `z-index: var(--z-drawer)`. **No scrim/backdrop** — this is a
NON-MODAL drawer: the requirement is "the whole and the part" (the operator reads
the map AND the item detail together), so the map must stay readable beside/behind
the drawer; a dimming scrim would defeat that. The map keeps its full width and
in-flight content behind the drawer's right edge; the left ~62% of the map stays
fully visible and the tree rail is never covered (the drawer's left edge sits far
right of the rail). Because the pane is `fixed`, it is removed from `.observatory-main-col`'s
flow entirely → the column and the map do NOT grow when it opens (the DEFECT-006
fix; pinned by GEO-S005-3b: map bounding box identical open vs closed).

**Focus model (non-modal):** focus MOVES into the drawer heading on open (not a
focus TRAP — the tree and map stay operable, consistent with the s005 non-modal
intent); Esc, the `×` close, and "Back to map" all close and RETURN focus to the
originating tree node (a regression-safe improvement on the prior "return to map"
— returning to the node keeps the operator's place in the tree). `aria-modal` is
NOT set (non-modal); the labelled region semantics are unchanged.
