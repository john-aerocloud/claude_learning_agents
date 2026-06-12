# UI design — s013 Defects view

Applies: **yes** — user-facing interactive surface (a navigable defects list panel
reachable from the app's primary navigation, drillable into the existing drawer).
Mode: STRUCTURE (before-build). **UC-S013-2** (defects LIST panel) is designed
below; **UC-S013-3** (defect drill-down + full record + MttrCard in the existing
DetailPane drawer) is designed in its own section ("UC-S013-3 — defect drill-down
+ MTTR card", added after the UC-S013-2 sections — do not regress those). UC-S013-4
(SSE refresh) gets its own STRUCTURE note when pulled; its hooks are foreshadowed
below but not designed.

Library: none (token-based custom, per `design/components.md`). New components
themed entirely through `src/app/src/styles/tokens.css`; no new token system, no
new tokens (reuses tree-state / space / badge / spacing tokens — see Reuse).

---

## Live-data reality check (supersedes the stale "10 defects" wording)

UC-S013-1 is **delivered and PASS** (result.md, sha 86c12eb). The live endpoint
returns **12 records**, not the 10 in the original slice.md / acceptance.md. The
list spec is written against ground truth:

| Record | Status | Severity | MTTR | Notes for the panel |
|---|---|---|---|---|
| DEFECT-001..010 | CLOSED | HIGH/MED/… | resolved (`mttr_s` set, `mttr_units="s"`) | normal closed rows |
| DEFECT-011 | CLOSED | **null** (ledger-only, no `.md` file) | 667 s | severity badge must render the unknown case "—", never blank/"LOW" |
| DEFECT-012 | **CONFIRMED** (open) | **null** | **null / open** | the OPEN row — must lead the list, MTTR shows "open", never "0" |

So the panel MUST handle: a CONFIRMED (open) row that leads; a record with a null
severity (ledger-only); and `mttr_s=null` rendered as "open", not zero. These are
exactly the figure-legibility cases the checklist guards (§4 empty≠zero).

---

## Surfaces touched (screens/routes)

Single-page dashboard `/` — no new browser route. UC-S013-2 adds ONE new
view-region (`DefectsPanel.jsx`) rendered in the main column, reached by a **third
tab on the EXISTING `ViewSwitch`** (delivered UC-S015-1).

| Surface | Host / attach point | Change |
|---|---|---|
| Primary navigation | `ViewSwitch.jsx` (delivered s015) in `ObservatoryView.jsx` main-column header | **extend** the tablist from two tabs to **three**: "Pipeline" \| "In-flight WIP" \| **"Defects"**. Read-only addition; no behaviour change to existing tabs/views. |
| Defects panel view | new `DefectsPanel.jsx` rendered in the **main column** when the Defects view is active | the panel REPLACES the VSM in the main column (routed view, same model as the WIP tab), it does NOT stack/overlay — the VSM is still reachable in 1 click via "Pipeline". |

**Reuse, not parallel nav (dispatch directive).** The slice.md draft said "a new
top-level Defects tab/section in the main navigation alongside the value-stream
map and work-item tree". The delivered IA already has the right primitive: the
`ViewSwitch` routed-view tablist. Adding a **third tab** to it is the correct,
non-duplicating realisation — inventing a parallel sidebar/nav for defects would
be a consistency failure (a second navigation model for one main column). The
tree rail stays orthogonal and unchanged; defects are NOT tree nodes (they are
not `items.csv` rows — slice.md §"Explicitly NOT in scope"), so the third tab,
not a tree branch, is correct.

**No-reflow decision (EXP-016): a ROUTED/SWITCHED VIEW, not an overlay** — identical
to the WIP tab. The Defects panel and the VSM never co-exist in the main column;
switching unmounts one and mounts the other, so there is structurally no "opening
defects reflows the map" failure mode. SM-DEF-7 / AC-S013-2-7 (map geometry
unchanged) is satisfied by construction AND asserted (GEO-S013-2-1 below).

The defect drill (UC-S013-3) opens the EXISTING `DetailPane` floating drawer
(DEFECT-006 idiom: `position:fixed`, portalled, no map reflow) — designed in the
UC-S013-3 pass, not here. UC-S013-2's done-condition is the list rendering,
grouped + sorted, with the nav entry; each row exposes a `data-defect-id` slot the
drill composes against.

---

## Navigation / IA delta

The `ViewSwitch` tablist gains a third entry; IA depth stays 1 (all views 1 click,
all tabs always visible, current marked with `aria-selected`):

```
[WorkItemTree rail]  |  ┌─ view switch: ( Pipeline | In-flight WIP | Defects ) ─┐
  region "Work items"|  │  Pipeline      → ValueStreamMap + DoRA + …            │
  (persists, unchanged)│  In-flight WIP  → WipPanel (s015)                      │
                     |  │  Defects        → DefectsPanel (THIS UC)               │
                     |  └──────────────────────────────────────────────────────┘
```

- **Default view on load = Pipeline** (unchanged — J1 stays 0-click; the Defects
  view is a destination the operator navigates TO, never the home view; SM-DEF-7).
- **Back/return:** click "Pipeline" (1 click). No modal/nav stack.
- **Grouping + sort are fixed, not controls:** CONFIRMED (open) defects group
  first, then CLOSED; within each group sorted by id ascending. Pre-grouping puts
  the items that need attention at the top — a step REMOVED, not a filter control
  added (click-reduction). No filter/search UI in v1 (slice.md NOT-in-scope).

`design/patterns.md` gains a CHK-8 nav row (third tab + click-path budget,
mirrored below). The `ViewSwitch` `aria-label` stays "Dashboard view".

---

## Component decomposition (component → states → stable selector)

### ViewSwitch (EXTEND — `src/app/src/components/ViewSwitch.jsx`, delivered s015)
Add a third tab. **Reuse, do not fork.** The component is already a generic
two-tab tablist; it becomes a generic N-tab tablist. The `active`/`onSelect`
contract is unchanged; `active` now ranges over `"pipeline" | "wip" | "defects"`.

| Part | States | Notes |
|---|---|---|
| Tab "Defects" | default · hover · focus-visible · selected(`aria-selected`) | text label authoritative; underline band + colour are redundant cues, never colour alone (reuses the s015 selected encoding) |

**Selectors (new tab only — existing two unchanged):**
- `getByRole('tab', { name: 'Defects' })`; `data-testid="view-tab-defects"`;
  `data-view="defects"`; `aria-selected`; `aria-controls="view-panel-defects"`.
- Roving tabindex must now cycle over THREE tabs (Arrow/Home/End) — assert below.

### DefectsPanel (new — `src/app/src/components/DefectsPanel.jsx`)
The view-region listing every defect, grouped CONFIRMED-first then CLOSED, each
group sorted by id ascending.

**Props:** `{ defects: DefectRow[]; status: "loading"|"ready"|"empty"; sourceRef: string }`
where `DefectRow = { id, title, status, severity, mttrText, isOpen }`
(shape produced by `useDefects.js`, see state-shape note below; grouping + sort
are in the hook so the panel stays presentational — same discipline as WipPanel).

**States:** default (N rows in two groups) · empty ("No defects recorded") ·
loading (region + heading immediate) · live (SSE re-fetch — UC-S013-4 prop slot).

**Selectors:**
- Panel: `getByRole('region', { name: 'Defects' })`; `data-testid="defects-panel"`
  (+ `data-source`). Visible `<h2>` "Defects" (takes focus on mount, mirrors
  WipPanel S15-1-A11Y-2). Reuse the WipPanel heading-focus pattern verbatim.
- Count line: `data-testid="defects-count"` `role="status"` `aria-live="polite"`
  (announces "N defects, M open" once on SSE refresh — not spammed; reuses
  LiveStatusDot pattern). Counts carry units/labels: "12 defects, 1 open"
  (FIG §1/§2 — never bare "12 / 1").
- Group headings: `data-testid="defects-group-open"` ("Open — needs attention")
  and `data-testid="defects-group-closed"` ("Closed"). The open group renders
  even when empty? No — when zero open, the open-group heading is ABSENT and a
  single CLOSED group shows (don't show an empty "Open (0)" — that reads as a
  broken state). Assert: open group present iff ≥1 CONFIRMED row.
- Row list per group: `role="list"`.

### DefectRow (new — child of DefectsPanel; one defect)
One scannable line of labelled figures: id · title (sentence) · status badge ·
severity badge · MTTR (unit-bearing or "open"). Mirrors WipRow's `<dl>` figure
layout for consistency.

**Props:** `{ defect: DefectRow }`

**States:** default (CLOSED) · **open** (CONFIRMED — leads, distinct cue) ·
hover · focus-visible (UC-S013-3 makes the row clickable; the focus state is
specified now so the build exposes it) · severity-unknown (null severity → "—").

**Selectors:**
- Row: `role="listitem"`; `data-testid="defect-row"`; **`data-defect-id="<id>"`**
  (the drill composition hook UC-S013-3 reads — a DEDICATED attr, NOT `data-item-id`,
  because defects are not items.csv rows and `data-item-id` is the tree/WIP unique
  contract; reusing it would collide in strict-mode selection — the same lesson the
  s014 SteerMenu learned with `data-steer-item-id`).
- `data-status="CONFIRMED|CLOSED"`; `data-open="true|false"`; `data-severity`
  (HIGH|MED|MED-HIGH|LOW|"" when null).
- Each figure is a labelled `<dt>`/`<dd>` pair so no figure is announced bare:
  `defect-id` / `defect-title` / `defect-status` / `defect-severity` / `defect-mttr`.
- Status badge `data-testid="defect-status-badge"`; severity badge
  `data-testid="defect-severity-badge"`.
- Accessible name (row `aria-label`) carries id + title + status + severity + MTTR
  (e.g. "DEFECT-012, <title sentence>, status open, severity unknown, MTTR open").

**Open (CONFIRMED) distinction — NON-COLOUR-REDUNDANT (§8, reuses the WipRow stale
idiom):** the open row leads the list (group order) AND is flagged by:
- visible text status badge **"OPEN"** (authoritative; CONFIRMED maps to the human
  word "open" in the badge — the operator's language; "CONFIRMED" is the enum and
  rides the accessible name / `data-status`),
- a glyph `<span aria-hidden="true">⚠</span>` (shape cue; reuses the defect glyph
  the tree already uses for DEF nodes),
- a left band using `--c-state-over` (the existing attention colour channel; colour
  is the THIRD cue, never alone),
- `data-open="true"` on the row.
CLOSED rows carry "CLOSED" text + a neutral/done channel (`--c-tree-state-done`
band, a ✓-style glyph) — distinguished by text+shape+colour, never colour alone.

**Severity badge — NON-COLOUR-REDUNDANT:** visible text "HIGH"/"MED-HIGH"/"MED"/"LOW"
(authoritative) + a severity-rank shape cue (e.g. a filled-bar count or the text
itself); null severity (ledger-only DEFECT-011) renders **"—"** (unknown), never
blank and never a defaulted "LOW". Assert text presence, not colour.

### Reuse, not invent
DefectsPanel/DefectRow are genuinely new (no existing flat grouped-list component:
WipPanel is single-group dwell-sorted; TimeThiefView is read-only ranked;
WorkItemTree is hierarchical). They are recorded as new rows in
`design/components.md`. They REUSE: the §8 redundant state-encoding rule, the
WipRow `<dl>`/`<dt>`/`<dd>` figure layout + `.wip-panel` heading-focus + count
live-region patterns, the WipRow stale-badge idiom (re-skinned as the open badge),
`--c-state-over` / `--c-tree-state-done` / `--c-text-dim`, the `--fs-tree`/
`--fs-tree-badge`/`--fs-history` type steps, `--sp-*` / `--radius-box` /
`--radius-badge` / `--focus-ring` / `--target-min`, the `data-source` SourceLink
convention, and the tree DEF glyph "⚠". **No new design tokens.**

---

## Click-path budget (per use case, with justification)

| Job | Budget | UC-S013-2 reality |
|---|---|---|
| "See the quality picture (all defects, status, severity, MTTR)" | **≤ 2 clicks** | from the at-a-glance pipeline (default): **1 click** on the "Defects" tab. From cold page: load → 1 click. **MET (1 ≤ 2).** |
| "Find the defects still open (need attention)" | **0 further clicks** | open defects group FIRST and lead the list — the top group IS the open set; no filter interaction. **MET.** |
| "Return to the pipeline" | **1 click** | "Pipeline" tab. **MET.** |
| "See one defect's full record" (UC-S013-3, foreshadow) | **1 further click** | click the row → DetailPane drawer. Budgeted now so UC-S013-3 honours it. |

Justification: reusing the existing tablist gives 1-click access without adding a
second nav model. Pre-grouping (open-first) removes a filter step entirely.
There is no 0-click option for reaching the defects view (it is a destination, not
the home — making it home regresses J1's 0-click at-a-glance read).

---

## Accessibility conditions (WCAG 2.2 AA) → mirrored into acceptance.md

Tag prefix `S13-2-A11Y-*`. Each is mechanically assertable (axe or Playwright).

- **S13-2-A11Y-1 (keyboard three-tab switch, 2.1.1/4.1.2):** the extended ViewSwitch
  remains a proper `tablist`/`tab`: Tab reaches it; Arrow/Home/End cycle over ALL
  THREE tabs; Enter/Space activates; the active tab carries `aria-selected="true"`,
  the other two `="false"`. Assert keyboard reach + activation of the Defects tab;
  assert `aria-selected` reflects the active view across all three.
- **S13-2-A11Y-2 (focus order & landmark, 2.4.3/1.3.1):** switching to Defects moves
  focus to / exposes the `region` named "Defects" with a visible `<h2>`; logical
  order tab → panel heading → first group heading → first row. No focus trap.
  Assert focus element identity after switch.
- **S13-2-A11Y-3 (visible non-colour-redundant state, 1.4.11/1.4.1):** tabs and rows
  show a `:focus-visible` ring (`--focus-ring`, ≥3:1 vs surface); the OPEN status,
  the severity, and CLOSED status are each conveyed by text(+shape), NEVER colour
  alone. Assert an open row has a non-empty visible "OPEN" text node AND
  `data-open="true"` (not just a colour); assert a CLOSED row has "CLOSED" text.
- **S13-2-A11Y-4 (target size, 2.5.8):** each tab's hit box ≥ 24×24 CSS px
  (`--target-min`); once the row is clickable (UC-S013-3) the row's interactive hit
  box ≥ 24 px tall. Assert `getBoundingClientRect` ≥ 24 on the tabs now.
- **S13-2-A11Y-5 (name/role/state, 4.1.2):** tablist named "Dashboard view"; the new
  tab named "Defects"; panel `region` named "Defects"; rows `role="listitem"` each
  with an accessible name carrying id + title + status + severity + MTTR (never
  bare). axe `aria-*` rules zero violations on the Defects view.
- **S13-2-A11Y-6 (ordered headings, 1.3.1):** the Defects view introduces exactly one
  `<h2>` ("Defects") under the page `<h1>`; group headings are `<h3>` (one level
  below); no skipped levels. Assert heading order.
- **S13-2-A11Y-7 (live region for SSE refresh, 4.1.3):** SSE-driven count changes
  (UC-S013-4) announce via the polite `role="status"` count line — not spammed.
  Assert the count update is inside an `aria-live="polite"` container (the slot is
  built now even though SSE wiring is UC-S013-4).

---

## Visual-structural / no-reflow conditions (EXP-016 / s002-line guard) → acceptance.md

The board-as-a-line-class guard for this surface: the defects list IS a vertical
grouped list, and switching to it must NOT reflow the VSM.

- **GEO-S013-2-1 (view-switch is lossless — the SM-DEF-7 guard):** capture the
  `value-stream-map` region `getBoundingClientRect()` AND
  `documentElement.scrollHeight` with the Pipeline view active. Switch to Defects,
  then back to Pipeline. Re-capture. The VSM bbox + page scrollHeight are
  **byte-identical** to the pre-switch values (lossless switch — EXP-016, identical
  to GEO-S015-1). With the Defects view active, `getByTestId('value-stream-map')`
  is ABSENT (genuinely unmounted, not hidden-but-present reflowing). This is the
  testable form of SM-DEF-7 / AC-S013-2-7.
- **GEO-S013-2-2 (defect rows STACK, are not a line):** within a group, each
  `defect-row` top offset is strictly greater than the previous AND all rows share
  a left offset (the s003 TimeThiefView / s005 ItemHistoryPanel / s015 WipRow
  stacked-list guard reused). Assert via bounding-box: monotonically increasing
  tops, shared lefts, for ≥ 2 rows. Catches a row that renders inline / as a strip.
- **GEO-S013-2-3 (the tree rail persists unchanged across the switch):** the
  `work-item-tree` region bbox is identical with Pipeline vs Defects active (the
  rail is orthogonal to the main-column view-switch). Assert equality.
- **GEO-S013-2-4 (open group leads — order is geometry here):** the open (CONFIRMED)
  group's heading + rows render ABOVE the closed group — assert the open-group
  heading top offset < the closed-group heading top offset, and the open
  DEFECT-012 row top offset < every CLOSED row top offset. Order carries meaning
  (attention-first); assert it geometrically, not just by DOM presence.
- **GEO-S013-2-5 (within-row figures align, not wrap-ragged):** within a single
  `defect-row` the labelled figure `<dd>`s (id/title/status/severity/mttr) share a
  consistent row band at desktop width — assert shared top offset (small tolerance)
  so the row reads as one scannable line of figures, not a ragged stack.

---

## Figure-legibility conditions (checklist) → mirrored into acceptance.md

The defects panel surfaces an **MTTR duration figure**, a **status**, a **severity**,
and **defect references** (id + title) per row — all in scope (SM-DEF-2/3).

- **S13-2-FIG-1 (MTTR carries a unit, §1/§2):** the MTTR figure renders with a human
  time unit — "13 min", "1 h 21 min", "11 min" — derived from `mttr_s`/`mttr_units`,
  NEVER a bare integer ("815") and never raw seconds in the headline. MTTR is a
  duration (a span), so it carries a duration unit (h/min/s), matching its
  dimension. Assert the MTTR text matches a unit-bearing pattern
  (`/\d+\s*(h|min|s)/`) for a resolved defect and is not a bare integer.
- **S13-2-FIG-2 (open ≠ zero, §4):** a CONFIRMED defect with `mttr_s=null`
  (DEFECT-012) renders the MTTR cell as **"open"** (the operator's word for "not
  yet resolved"), NOT "0", "0 s", blank, "null", or "—". Distinguish three cases
  explicitly: resolved → "13 min"; open → "open"; unknown-but-not-open → "—"
  (defensive). Assert DEFECT-012's MTTR cell text is "open".
- **S13-2-FIG-3 (human-meaningful references, §3):** each row shows the defect id
  WITH its human title sentence (from the `.md` title / ledger note), NEVER the id
  alone and never a raw ledger row ref (`row:817`). The title is rendered as a
  sentence (capitalised, not an opaque token). Assert: row visible text contains a
  multi-word title AND the `DEFECT-NNN` id; no `row:\d+` token anywhere in the row.
- **S13-2-FIG-4 (severity unknown ≠ defaulted, §4):** the ledger-only DEFECT-011
  (`severity=null`) renders the severity badge as **"—"** (unknown), NOT blank and
  NOT a defaulted "LOW"/"MED". Assert DEFECT-011's severity badge text is "—".
- **S13-2-FIG-5 (status labelled in the operator's language, §2/§3):** the status
  badge shows the human word — CONFIRMED→"OPEN", CLOSED→"CLOSED" — as visible text
  (authoritative), with the raw enum on `data-status`. Assert the visible badge
  text is "OPEN"/"CLOSED" and `data-status` is "CONFIRMED"/"CLOSED" respectively.
- **S13-2-FIG-6 (count line labelled, §1/§2):** the count line reads "N defects,
  M open" — both numbers carry a noun, never bare "12 / 1". Assert the count text
  contains "defect" and "open" and the two integers.

---

## State-shape note for `useDefects.js` (build contract)

`useDefects(projectId)` calls `GET /api/projects/:id/defects` (UC-S013-1,
delivered) and returns a PRESENTATIONAL view-model (grouping, sort, MTTR
humanisation, status→human-word mapping all in the hook, so the panel stays pure):

```
{
  status: "loading" | "ready" | "empty",
  sourceRef: "work/<project>/defects/ + process/dora/ledger.csv",
  openCount: number,
  defects: Array<{                  // GROUPED open-first, each group id-ascending
    id: string,                     // "DEFECT-012"
    title: string,                  // human sentence (md title or ledger note)
    status: "CONFIRMED" | "CLOSED", // raw enum (→ data-status)
    statusLabel: "OPEN" | "CLOSED", // operator's word (→ badge text)
    isOpen: boolean,                // status === "CONFIRMED"
    severity: "HIGH"|"MED-HIGH"|"MED"|"LOW"|null,
    severityText: string,           // severity || "—"  (null → "—", FIG-4)
    mttrText: string,               // "13 min" | "open" | "—"  (FIG-1/2)
  }>,
}
```

The hook maps `mttr_s`+`mttr_units` → `mttrText`: resolved → humanised duration;
`isOpen` → "open"; otherwise "—". SSE re-fetch (UC-S013-4) updates `defects` in
place without remounting (so the heading focus is not stolen — mirrors WipPanel).
The endpoint already supplies `mttr_units` and a per-record title (result.md
confirms both), so no server change is needed for any FIG condition.

---

## Stable selectors handed to the engineer (consolidated build contract)

| Element | Primary selector (a11y) | Test-id | Extra data-attrs |
|---|---|---|---|
| Defects tab | `getByRole('tab', { name: 'Defects' })` | `view-tab-defects` | `data-view="defects"`, `aria-selected`, `aria-controls` |
| Defects panel | `getByRole('region', { name: 'Defects' })` | `defects-panel` | `data-source` |
| Count line | within panel, `role="status"` | `defects-count` | `aria-live="polite"` |
| Open group | `<h3>` "Open — needs attention" | `defects-group-open` | — |
| Closed group | `<h3>` "Closed" | `defects-group-closed` | — |
| Defect row | `role="listitem"` within a group | `defect-row` | `data-defect-id`, `data-status`, `data-open`, `data-severity` |
| Status badge | within a row | `defect-status-badge` | text "OPEN"/"CLOSED" |
| Severity badge | within a row | `defect-severity-badge` | text or "—" |
| MTTR figure | `<dd>` labelled "MTTR" within a row | `defect-mttr` | unit-bearing or "open" |

No `nth()`, no count-derived, no text-exclusion selectors. Rows are disambiguated
by `data-defect-id` (the live id) — the dedicated contract UC-S013-3's drill
composes against (NOT `data-item-id`).

---

## UC-S013-3 — defect drill-down + MTTR card (STRUCTURE)

The drill: clicking/activating a `DefectRow` opens the defect's full record in the
**delivered `DetailPane` floating-drawer idiom** (DEFECT-006: `position:fixed`,
portalled, own stacking context, NO map reflow). Contents: the four fields
(expected/actual/intent/importance), classification, root cause, resolution +
fix sha(s), and an MTTR timeline card. Markdown-bearing fields render through the
existing `marked` path (the same transform `ArtifactView` uses).

### Live-data reality (supersedes the stale acceptance sketch)

UC-S013-1 is delivered; the endpoint already returns every drill field
(`expected, actual, intent, importance, classification, root_cause,
resolution_text, fix_sha, reported_ts, recovered_ts, mttr_s, mttr_units, title,
source`). **No server change is needed for UC-S013-3.** Ground truth, verified
against the live endpoint, drives the conditions:

| Field | Live shape | Drill consequence |
|---|---|---|
| `mttr_units` | always `"s"` | MttrCard receives raw `mttr_s` + humanises to "13 min" / "44 min" |
| `mttr_s` | int, or `null` when open | resolved → unit-bearing duration; open → "Not yet resolved" + elapsed-open, NOT an MTTR |
| `fix_sha` | single (`"e84162d"`), comma-joined (`"3d8c21c, 82a622c"`), or `null` (DEFECT-009/011/012) | each sha as a `<code>` ref; `null` → "—" |
| `severity` | `null` for DEFECT-011/012 | header severity renders "—" (unknown ≠ defaulted) |
| markdown fields | sentence/paragraph strings with inline md (`**bold**`, `→`) | rendered as HTML, never raw `**` |
| `recovered_ts` | ISO, or `null` when open | open path |

NOTE: **all 12 live records are currently CLOSED** (DEFECT-012 closed 07:43:41Z).
There is therefore no live open defect to exercise the open-state MttrCard. The
open path is REAL behaviour the data can re-enter at any time, so AC-S013-3-OPEN
is asserted against a **fixture open record** (a synthetic `mttr_s=null,
recovered_ts=null` defect) — the tester runs it against the fixture server, not
live (mirrors s013 fixture vs live split already in result.md). The live-data
done-condition is unchanged for the resolved path (DEFECT-001).

### Surfaces touched

| Surface | Host / attach point | Change |
|---|---|---|
| Defect drill drawer | the EXISTING `DetailPane` floating drawer (DEFECT-006), opened over the main column | **read-only reuse of the drawer SLOT** — `DetailPane.jsx` itself is NOT edited (its `item`-coupled identity/artifact/history body is slice-specific). The drill is realised by a new `DefectDrillContainer.jsx` that renders the SAME drawer shell tokens/positioning and composes `DefectDetail.jsx` + `MttrCard.jsx` as the body. See "Drawer reuse decision" below. |
| `DefectRow` | delivered UC-S013-2 row (carries `data-defect-id`, focus slot reserved) | **wire the reserved drill slot**: the row becomes activatable (click + keyboard) and fires `onSelectDefect(id)`; no structural change to the row's figure layout. |

### Drawer reuse decision (DEFECT-006 idiom, NOT the DetailPane component body)

The flow-manager's seam read names `DetailPane.jsx` a **read-only reuse slot** and
adds `DefectDrillContainer.jsx` + `MttrCard.jsx`. That is the correct seam, and
here is the design rationale so the engineer does not reach into `DetailPane`:

- `DetailPane.jsx` is **coupled to an `ItemRecord`** — it reads `item.type/state/
  value/cost/job`, fetches slice artifacts, mounts `ItemHistoryPanel` from the
  ledger. A defect is **not** an items.csv record (slice.md §NOT-in-scope) and has
  none of those fields. Threading a defect through `DetailPane` would mean
  branching its body on a "defect vs item" type flag — that is a behaviour change
  to a delivered seam shared with UC-S005-3, exactly what the read-only-slot rule
  forbids.
- Instead, `DefectDrillContainer.jsx` reproduces the **drawer IDIOM** (the same
  thing s014's `SteerPanel` did with the DEFECT-006 idiom rather than the
  `DetailPane` component): `position:fixed`, portalled to `document.body`, the
  same drawer tokens (`--drawer-inset`, `--drawer-width`, `--z-drawer`,
  `--drawer-elev`, `--dur-drawer`, 0ms under reduced-motion), NON-modal, no scrim,
  slide-in. **No new tokens** — all already defined for the DetailPane/SteerPanel
  drawers. This keeps the map geometry byte-identical (GEO below) by construction
  (a fixed, zero-flow-height, portalled overlay) without editing the shared
  `DetailPane` body.
- This is a deliberate IDIOM reuse, not a one-off component: the drawer shell
  (positioning, focus management, Esc, close button, heading-focus) is the same
  contract `DetailPane` and `SteerPanel` already implement; `DefectDrillContainer`
  is the third consumer of that pattern. Recorded as such in `components.md` (it
  REUSES the drawer idiom + the s003/s005 labelled `<dl>` figure pattern + the
  `marked` markdown transform; the only genuinely new leaf is `MttrCard`).

### Component decomposition (component → states → stable selector)

#### DefectRow (EXTEND — wire the reserved drill slot)
The delivered row already exposes `data-defect-id`, `role="listitem"`, and the
focus-visible state reserved in UC-S013-2. UC-S013-3 makes it ACTIVATABLE:

| Part | States | Notes |
|---|---|---|
| Row activation | default · hover · **focus-visible** (now reachable) · activated (drawer open) | the row becomes a single activatable control: click OR Enter/Space fires `onSelectDefect(defect.id)`. Either the row is a `<button>`-roled element wrapping the `<dl>`, OR an explicit in-row trigger — engineer's choice, but the WHOLE row's job is "open this defect", so the row itself is the affordance (1-click, matches the click-path budget). The selected/open row carries `aria-expanded`/`data-active` so the open state is exposed. |

- **Selector (drill hook — unchanged from UC-S013-2):** the row keeps
  `data-defect-id="<id>"`; the activation is `getByRole('button', { name: /<id>.*<title>/ })`
  OR (if the row stays a `listitem` with an inner trigger)
  `getByTestId('defect-row')` + Enter. The accessible name MUST carry the human
  defect reference ("DEFECT-001, UI shows 0 for everything…") — never the id alone
  (FIG §3). `data-defect-id` is the continuity contract from row → drawer.

#### DefectDrillContainer (new — `src/app/src/components/DefectDrillContainer.jsx`)
The drawer shell + open/close + focus management for the defect drill. Pure-ish:
reads the SELECTED defect object (already in `useDefects.js` state — no extra
fetch) and `onClose`; owns the managed-focus effect + Esc handler (the same DOM
concerns `DetailPane` owns).

- **Props:** `{ defect: DefectRecord | null; onClose: () => void }` where
  `DefectRecord` is the raw UC-S013-1 endpoint object (all 17 fields). `null` →
  drawer closed (renders `null`, zero flow height).
- **States:** closed (absent) · open · (no loading state — the data is already in
  hand from the list fetch; the drill is a pure projection of an in-memory record).
- **Selector:** `getByRole('region', { name: /defect: DEFECT-\d+/i })`;
  `data-testid="defect-drill"`; `data-defect-id="<id>"` (continuity from the row).
  Close button `getByRole('button', { name: /close defect/i })`,
  `data-testid="defect-drill-close"`. Heading `<h2>` = "DEFECT-001 — <title>"
  (`data-testid="defect-drill-heading"`, `tabindex="-1"`, takes focus on open).
- **A11y:** NON-modal (no `aria-modal`, no focus trap — the list stays operable,
  "whole and the part"); on open focus MOVES to the heading; Esc / × close and
  focus RETURNS to the originating `DefectRow` (the container passes the
  return-focus ref, same as DetailPane→tree-node). Keyboard order: heading → body
  (fields) → MttrCard → close.
- **Geometry:** `position:fixed`, portalled to `document.body`, drawer tokens; the
  defects panel + tree + page below are byte-identical open vs closed (GEO below).
- **Library:** custom (reuses the DEFECT-006 drawer idiom; no new tokens).

#### DefectDetail (new — `src/app/src/components/DefectDetail.jsx`)
The labelled body of the drawer: the four fields + classification + root cause +
resolution + fix shas, each as a labelled section, markdown rendered to HTML.

- **Props:** `{ defect: DefectRecord }` (pure render).
- **Section model — labelled, in a fixed reading order:**
  1. **Four fields** group (`<h3>` "Four fields") → Expected / Actual / Intent /
     Importance, each a labelled `<dt>`/markdown-`<dd>` pair.
  2. **Classification** (`<h3>`).
  3. **Root cause** (`<h3>`).
  4. **Resolution** (`<h3>`) → the `resolution_text` markdown + a fix-sha row.
- **Markdown rendering:** each markdown-bearing value (`expected, actual, intent,
  importance, classification, root_cause, resolution_text`) renders through the
  **existing `marked` transform** (the same `mdToHtml` path `ArtifactView` uses —
  inline `**bold**`/`→`/links become HTML, never raw `**`). The engineer either
  reuses `ArtifactView` in a per-field "inline md" mode OR factors the `mdToHtml`
  helper out of `ArtifactView.jsx` into a shared `lib/markdown.js` so both call it
  (a non-behavioural extraction, not a `DetailPane` edit). PREFER the extraction so
  there is ONE markdown transform in the codebase.
- **Fix sha rendering:** `fix_sha` is split on comma; each token renders as a
  `<code data-testid="defect-fix-sha">` ref (monospace, `--c-source-link`-style,
  copyable text). `null`/empty → "—" (absent ≠ a fake sha; FIG §4). Shown WITH the
  "Fix" label so a bare hash is never orphaned (FIG §3 — a sha is a machine token;
  it rides under "Fix: …" with the resolution sentence as its human context).
- **Absent / null field:** any null markdown field renders the literal placeholder
  "—" (or "Not recorded"), never blank, never a thrown error, never raw "null".
- **Source ref:** the body carries `data-source` pointing at the record's origin —
  the `.md` file for file-backed defects (`work/<project>/defects/<id>*.md`) and/or
  the ledger rows for the MTTR span (`process/dora/ledger.csv#ref=<id>`), reusing
  the SourceLink convention. A visible "↗ source" caption names the `.md` file
  (FIG: human-meaningful provenance — EXP-033/DEFECT-005 lineage; ledger-only
  records like DEFECT-011 with no `.md` show the ledger ref).
- **Selector:** `data-testid="defect-detail"` (+ `data-source`); each section
  heading `data-testid="defect-field-<expected|actual|intent|importance|
  classification|root-cause|resolution>"`; markdown body `<dd>`s carry
  `data-field="<name>"`.
- **A11y:** real semantic HTML (`<h3>` headings reachable under the drawer `<h2>`,
  ordered, no skipped levels); `<dl>` for the four labelled fields so each value is
  announced WITH its label; no raw markdown in text nodes.
- **Geometry:** the field sections STACK vertically (monotonic tops, shared left) —
  a readable record, not a ragged inline run.
- **Library:** custom (reuses the s003/s005 labelled `<dl>` figure pattern + the
  shared `marked`/`mdToHtml` transform).

#### MttrCard (new — `src/app/src/components/MttrCard.jsx`)
The reported→recovered timeline + the MTTR figure. The one genuinely new leaf.

- **Props:** `{ reportedTs: string|null; recoveredTs: string|null; mttrS:
  number|null; mttrUnits: string|null }` (raw endpoint fields; the card owns the
  humanisation so the figure is correct at the leaf).
- **States:**
  - **resolved** (`recoveredTs` + `mttrS` non-null) → reported → recovered timeline
    + the MTTR figure as a humanised duration ("13 min", "44 min", "21 min").
  - **open** (`recoveredTs`/`mttrS` null) → reported timestamp + **"Not yet
    resolved"** in the recovered slot + an **elapsed-open** figure ("open for 2 h
    14 min") that is CLEARLY LABELLED "open for" / "elapsed open" — explicitly NOT
    an MTTR (an MTTR is a closed span; elapsed-open is a running clock). The figure
    must not be presented under an "MTTR" label (would be a category error / a
    mislabelled metric — the DEFECT-007 "count called throughput" lesson).
  - **unknown** (defensive: `reportedTs` null) → "Reported time not recorded" + "—"
    for the figure; no crash.
- **Figure legibility (the standing FIG checklist — all four):**
  1. **Has a unit** — never a bare integer ("815" → "13 min"); the humaniser maps
     `mttr_s` (seconds) to the largest sensible unit pair (h/min/s).
  2. **Unit matches the dimension** — MTTR is a DURATION (a span), so it carries a
     duration unit; it is NAMED "MTTR" only for the resolved closed span. The
     open-state running figure is NAMED "open for" (elapsed), not "MTTR".
  3. **Human-meaningful references** — timestamps render in a human-readable form
     (e.g. "2026-06-10 06:17:47 UTC" or "Jun 10, 06:17 UTC"), not a raw epoch; the
     card heading carries the defect id+title context via the drawer.
  4. **Empty/unknown ≠ zero** — open → "Not yet resolved" (NOT "0 s"); missing
     reported_ts → "—" (NOT 0).
- **Timeline shape:** a small two-point timeline (reported ● → recovered ●) with
  the duration spanning between — the recovered point absent/dimmed in the open
  state. Reduced-motion: no animated draw.
- **Selector:** `getByRole('group', { name: /MTTR/i })` (or a labelled `<section>`);
  `data-testid="mttr-card"`; `data-mttr-state="resolved|open|unknown"`. Sub-parts:
  reported `data-testid="mttr-reported"`, recovered `data-testid="mttr-recovered"`,
  the figure `data-testid="mttr-figure"` (carries `data-mttr-seconds` raw for the
  test to cross-check the humanised text against `mttr_s`).
- **A11y:** the card is a labelled region/group ("MTTR — mean time to recovery");
  each timestamp + the duration is a labelled `<dt>`/`<dd>` so no figure is bare;
  the open-state "Not yet resolved" is visible text, not colour/shape only.
- **Source ref:** `data-source="process/dora/ledger.csv#ref=<id>"` (the failure→
  recovery rows the span was computed from — provenance for the figure, FIG §3).
- **Library:** custom (new leaf; reuses `--c-*`/`--sp-*`/`--radius-box`/
  `--fs-*`/`--focus-ring` tokens — no new tokens).

### Click-path budget (UC-S013-3)

| Job | Budget | Reality |
|---|---|---|
| "See one defect's full record" | **1 click** | from the defects list (already reached in 1 click), activate the row → drawer opens. **MET (1).** |
| "Return to the defects list" | **1 click / Esc** | × button, "close", or Esc; focus returns to the row. **MET.** |

The drill is the budgeted 1-further-click foreshadowed in UC-S013-2's table.

### Accessibility conditions (WCAG 2.2 AA) — UC-S013-3 → mirrored into acceptance.md

Tag prefix `S13-3-A11Y-*`. Each mechanically assertable.

- **S13-3-A11Y-1 (keyboard open from row, 2.1.1):** a `DefectRow` is activatable by
  keyboard — focus the row, press Enter (and Space), the defect drill drawer opens.
  Assert keyboard activation opens `defect-drill` (not pointer-only).
- **S13-3-A11Y-2 (focus moves into the pane, 2.4.3):** on open, focus moves to the
  drawer heading (`defect-drill-heading`, `tabindex="-1"`); logical order heading →
  fields → MttrCard → close. Assert `document.activeElement` is the heading after
  open.
- **S13-3-A11Y-3 (Esc returns to the row, 2.1.2/2.4.3):** Esc (and ×) closes the
  drawer AND returns focus to the originating `DefectRow`. Assert
  `document.activeElement` is the originating row after close. No focus trap
  (non-modal — the list stays operable while open).
- **S13-3-A11Y-4 (name/role/state, 4.1.2):** drawer is `region` named "Defect:
  <id>"; close button has an accessible name; MttrCard is a labelled group;
  rendered markdown produces real headings (`<h3>`) under the drawer `<h2>`, no
  skipped levels; axe `aria-*` + heading-order zero violations on the open drawer.
- **S13-3-A11Y-5 (non-colour-redundant MTTR state, 1.4.1):** resolved vs open is
  conveyed by TEXT ("Not yet resolved" / the duration) + `data-mttr-state`, never
  colour/shape alone. Assert the open state has a visible "Not yet resolved" text
  node.
- **S13-3-A11Y-6 (target size, 2.5.8):** the row activation hit box ≥ 24×24 CSS px;
  the close button ≥ 24×24. Assert `getBoundingClientRect`.

### Visual-structural / no-reflow conditions (DEFECT-006 idiom) — UC-S013-3 → acceptance.md

- **GEO-S013-3-1 (drawer is a pure overlay — no reflow, the DEFECT-006 guard):**
  capture the underlying surface bboxes + `documentElement.scrollHeight` with the
  drawer CLOSED; activate a row to OPEN the drawer; re-capture. The defects panel
  bbox, the tree-rail bbox, and the page `scrollHeight` are **byte-identical** open
  vs closed (the drawer is `position:fixed`, portalled, zero flow height — same
  invariant as GEO-S005-3b / GEO-S014-2). This is the testable form of the slice's
  "map geometry unchanged" requirement applied to the drill.
- **GEO-S013-3-2 (drawer on-screen, anchored):** the open drawer's bounding box is
  within the viewport (no horizontal scroll introduced); its left edge sits right
  of the defects-panel content (no illegible overlap of the list it was opened
  from).
- **GEO-S013-3-3 (record sections STACK):** within `defect-detail`, the field
  section headings have monotonically increasing top offsets and a shared left
  offset (a readable stacked record, not an inline ragged run) — the s002-line
  guard applied to the drill body.
- **GEO-S013-3-4 (MttrCard timeline order):** in the resolved state the reported
  point's left/top precedes the recovered point (a left→right or top→bottom
  timeline, order = meaning); assert `mttr-reported` precedes `mttr-recovered`
  geometrically.

### Figure-legibility conditions (checklist) — UC-S013-3 → mirrored into acceptance.md

- **S13-3-FIG-1 (MTTR carries a unit, §1/§2):** for a RESOLVED defect (DEFECT-001,
  `mttr_s=815`) the MttrCard figure renders a unit-bearing duration matching
  `/\d+\s*(h|min|s)/` ("13 min" / "13 min 35 s"), NEVER the bare integer "815" and
  never raw seconds in the headline. Assert the humanised text and cross-check
  `data-mttr-seconds` ≈ 815.
- **S13-3-FIG-2 (open ≠ MTTR ≠ zero, §2/§4):** an OPEN defect (`mttr_s=null,
  recovered_ts=null` — fixture record) shows the recovered slot as **"Not yet
  resolved"** and the running figure as an "open for …" elapsed value (or "—"),
  NEVER "0", "0 s", "null", or a value labelled "MTTR". Assert no "MTTR" label sits
  over the open running figure (dimension/name match — DEFECT-007 lesson). No crash
  / no console error in the open state.
- **S13-3-FIG-3 (timestamps human-readable, §1/§3):** `reported_ts`/`recovered_ts`
  render in a human-readable date-time form (date + UTC clock), not a raw epoch and
  not an opaque token. Assert the reported/recovered cells contain a recognisable
  date-time string (e.g. "06:17" + a date), with the defect id+title as context in
  the drawer heading (provenance, FIG §3).
- **S13-3-FIG-4 (fix shas as code refs, with context, §3):** each `fix_sha` token
  renders as a `<code>` ref under the "Fix"/"Resolution" label (the sentence is its
  human context — never an orphan hash). For DEFECT-001 both "3d8c21c" and
  "82a622c" appear as code refs. A defect with `fix_sha=null` (DEFECT-009/011/012)
  renders "—" in the fix slot — never blank, never a fabricated sha.
- **S13-3-FIG-5 (absent fields render "—", §4):** any null markdown field
  (severity, an absent root_cause, etc.) renders "—" (or "Not recorded"), never
  blank, never raw "null", never a thrown error. DEFECT-011 (`severity=null`)
  header severity = "—".
- **S13-3-FIG-6 (markdown rendered, not raw, §3):** the markdown-bearing fields
  render as HTML — DEFECT-001's `actual` ("**0 for everything**") shows bold text,
  NOT literal `**`; no raw `##`/`**`/`→`-escape artefacts in the visible text
  nodes. Assert the rendered body contains real HTML elements (`<p>`,`<strong>`)
  and no `**` literal.
- **S13-3-FIG-7 (source ref to provenance, EXP-033/DEFECT-005 lineage):** the drill
  body and the MttrCard each carry a human-meaningful `data-source` (the `.md` file
  for the record; `ledger.csv#ref=<id>` for the MTTR span) AND a visible "↗ source"
  caption names the file — so a figure is never an opaque value with no "why".
  Assert non-empty `data-source` on `defect-detail` and `mttr-card`.

### Selector contracts handed to the engineer (UC-S013-3 consolidated)

| Element | Primary selector (a11y) | Test-id | Extra data-attrs |
|---|---|---|---|
| Row activation | `getByRole('button', { name: /DEFECT-\d+.*<title>/ })` (or row + Enter) | `defect-row` (reused) | `data-defect-id` (continuity), `data-active`/`aria-expanded` |
| Defect drill drawer | `getByRole('region', { name: /defect: DEFECT-\d+/i })` | `defect-drill` | `data-defect-id` (continuity from row) |
| Drawer heading | `<h2>` "<id> — <title>" | `defect-drill-heading` | `tabindex="-1"` |
| Drawer close | `getByRole('button', { name: /close defect/i })` | `defect-drill-close` | — |
| Record body | within drawer | `defect-detail` | `data-source` |
| Field section | `<h3>` per field | `defect-field-<name>` | `<dd>` carries `data-field="<name>"` |
| Fix sha | `<code>` under "Fix" | `defect-fix-sha` | (one per sha; "—" when null) |
| MTTR card | `getByRole('group', { name: /MTTR/i })` | `mttr-card` | `data-source`, `data-mttr-state` |
| MTTR figure | within card | `mttr-figure` | `data-mttr-seconds` (raw, for cross-check) |
| Reported point | within card | `mttr-reported` | — |
| Recovered point | within card | `mttr-recovered` | — |

`data-defect-id` is the continuity contract from `DefectRow` → `DefectDrillContainer`.
No `nth()`, no count-derived, no text-exclusion selectors.

### Engineer needs (UC-S013-3 build contract)

1. **No server work** — every drill field is already in the UC-S013-1 response
   (`expected/actual/intent/importance/classification/root_cause/resolution_text/
   fix_sha/reported_ts/recovered_ts/mttr_s/mttr_units/title/source`). The drill is
   a pure projection of the in-memory record the list hook already holds — NO extra
   fetch, NO endpoint change.
2. **Do NOT edit `DetailPane.jsx`** — it is `item`-coupled and shared with UC-S005-3
   (read-only reuse slot per the flow-manager seam read). Build the drawer via the
   new `DefectDrillContainer.jsx` reproducing the DEFECT-006 drawer idiom
   (`position:fixed`, portalled, the existing drawer tokens). This keeps the
   GEO-S013-3-1 no-reflow invariant by construction.
3. **One markdown transform** — PREFER factoring `mdToHtml` out of
   `ArtifactView.jsx` into a shared `lib/markdown.js` (non-behavioural extraction)
   that both `ArtifactView` and `DefectDetail` import, so there is a single
   markdown path. If extraction is awkward in the time box, reuse `ArtifactView` in
   an inline-md mode — but never hand-roll a second markdown renderer.
4. **MttrCard owns the duration humanisation** (`mttr_s` + `mttr_units` →
   "13 min"); the open path (`null`) must read "Not yet resolved" + an elapsed-open
   running figure that is NOT labelled "MTTR". Note: **all 12 live defects are
   currently CLOSED**, so the open path's acceptance (S13-3-FIG-2 / AC-S013-3-OPEN)
   is exercised against a FIXTURE open record, not live data — supply that fixture.
5. **Wire the reserved `DefectRow` drill slot** delivered in UC-S013-2: make the
   row activatable (click + Enter/Space), fire `onSelectDefect(id)`, expose the
   open state (`data-active`/`aria-expanded`), and carry the return-focus ref so
   Esc/close returns focus to the row (S13-3-A11Y-3).
6. **Component-map**: add `DefectDrillContainer`, `DefectDetail`, `MttrCard` nodes
   and edges (`MttrCard --> DefectDrillContainer`, `DefectDetail -->
   DefectDrillContainer`, `DefectRow --> DefectDrillContainer` activation) in the
   SAME commit, marked `classDef changed`.
7. **TDD**: each FIG/GEO/A11Y condition above gets a failing component/axe/
   bounding-box spec first, then green. The markdown-rendered-not-raw (FIG-6) and
   open≠MTTR (FIG-2) cases are the highest-value reds.

---

## Component-map delta (change-impact model — co-owned .mmd)

Engineer/UI must update `architecture/dependencies/component-map.mmd` in the SAME
commit that lands DefectsPanel: add nodes `DefectsPanel`, `DefectRow`, and a
`DefectsViewScreen` slot; add edges `DefectRow --> DefectsPanel`,
`DefectsPanel --> DefectsViewScreen`, `ViewSwitch --> DefectsViewScreen`
(the ViewSwitch now fans out to THREE view screens). Mark the changed nodes/edges
`classDef changed` (a `s013changed` class) for the tester's UI test-plan. Marks
cleared at slice delivery after the tester consumes them.

**UC-S013-3 delta (same-commit rule):** add nodes `DefectDrillContainer`,
`DefectDetail`, `MttrCard`; add edges `DefectDetail --> DefectDrillContainer`,
`MttrCard --> DefectDrillContainer`, and `DefectRow --> DefectDrillContainer`
(the row activation opens the drill). `DefectDrillContainer` REUSES the DEFECT-006
drawer idiom (record as a note edge to the drawer-idiom node if one exists, else a
comment) and `DefectDetail` reuses the shared markdown transform (`lib/markdown.js`
if extracted). Mark all three new nodes + their edges `s013changed`.

---

## NOT designed yet (deferred)

- **SSE live refresh** (UC-S013-4) — wiring `subscribeEvents` into `useDefects.js`;
  the live-region count slot (S13-2-A11Y-7) is built now, but the SSE re-fetch
  behaviour + its acceptance (add/remove temp defect file) is UC-S013-4.
- Defect search / filter / sort controls — pre-grouped open-first only; no operator
  controls in v1 (click-reduction; slice.md NOT-in-scope).
- MTTR trend charts / aggregate quality metrics — slice.md NOT-in-scope.
- Source-events reveal on MTTR figures — follow-on (slice.md NOT-in-scope).
- Mobile / responsive layout — out of scope per slice.md.
- The write path — there is none by design; the panel is read-only.
