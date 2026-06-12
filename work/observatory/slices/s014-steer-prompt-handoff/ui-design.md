# UI design — s014 Steer prompt handoff

Applies: **yes** — user-facing interactive surface (a steer-action affordance +
popover menu attached to two existing live surfaces).
Mode: STRUCTURE (before-build). **UC-S014-1** (SteerMenu) designed + delivered
(see §UC-S014-1). **UC-S014-2** (SteerPanel + useSteerContext) designed below
(§UC-S014-2). UC-S014-3 (promptBuilder) / UC-S014-4 (copy/SSE) get their own
STRUCTURE rows when pulled.

Library: none (token-based custom, per `design/components.md`). New component
themed entirely through `src/app/src/styles/tokens.css`; no new token system.

---

## Surfaces touched (screens/routes)

Single-page dashboard `/` — no new route. UC-S014-1 adds ONE new component
(`SteerMenu.jsx`) composed read-only into two existing surfaces:

| Surface | Host component | Attach point (exact, verified in source) |
|---|---|---|
| VSM WIP chip | `StageNode.jsx` → `<li class="queue-item" data-testid="queued-item-<stage>-<item_id>">` | trigger appended as last child of the chip `<li>`; chip already carries `item_id` |
| Work-item tree row | `TreeNode.jsx` → `<div class="tree-node__row">` inside `<li role="treeitem" data-item-id>` | trigger appended after `vc-badge`, inside `tree-node__row`; row already carries `data-item-id` + accessible `aria-label` |

`VsmContainer.jsx` and `WorkItemTree.jsx` receive a read-only `onSteer(itemId, actionType)`
prop slot that they thread down to `StageNode`/`TreeNode` → `SteerMenu`. **No logic
change** to the host components: they pass a callback and render `<SteerMenu>`; they
do not own menu state. The callback is a no-op stub in this UC (it will open
SteerPanel in UC-S014-2) — UC-S014-1's done-condition is the menu opening with four
labelled actions, not the panel.

---

## Navigation / IA delta

The steer affordance is an **item-scoped, on-demand secondary action** — it must
not compete with the at-a-glance read path (J1/J2 stay 0-click) and must not alter
the established drill model (tree row click = drill to DetailPane, UC-S005-3). So:

- **Trigger = an explicit per-item button** (`⋯` "Steer" icon-button), NOT a
  right-click-only context menu (right-click is undiscoverable and not
  keyboard-reachable) and NOT a row-click hijack (row click already means "drill",
  reassigning it would break UC-S005-3). The button is the discoverable,
  keyboard-operable affordance; a right-click context-menu MAY be added later as a
  redundant accelerator but is out of scope here.
- **Menu = a popover overlay** anchored to the trigger, rendered in its own
  stacking context ABOVE both surfaces (reuse the DEFECT-006 overlay discipline:
  `position: fixed`/portal, NOT in document flow). This is what guarantees the
  no-reflow invariant below — the menu floats over the chip/row, it does not push
  list siblings or grow the page.
- **Placement on the chip:** trailing edge of the chip, after the wait-time text —
  the chip's primary content (id + wait) stays first-read; the steer button is the
  trailing action, matching the row pattern below.
- **Placement on the tree row:** trailing edge of `tree-node__row`, after the
  value/cost badge — consistent trailing-action position across both surfaces so
  the operator learns ONE affordance location.
- **Dismiss/back path:** Esc closes the menu and returns focus to the trigger;
  click-outside closes; selecting an action closes and (in later UCs) opens the
  panel. No nav-stack growth.
- **Scope guard:** the affordance appears on item-bearing elements ONLY (WIP chips,
  tree rows) — never on stage labels, lane headings, the `+N more` chip, or the
  region `<h2>`s (AC-4 / STEER-SCOPE-1 below).

`design/patterns.md` gains a CHK-5 click-path row (mirrored in §"Click-path budget").

---

## Component decomposition (component → states → stable selector)

### SteerMenu (new — `src/app/src/components/SteerMenu.jsx`)
The whole affordance: a **trigger button** + an **anchored popover** listing the
four steer-action types. One component, two parts.

**Props:** `{ itemId: string; itemLabel: string; onSteer?: (itemId, actionType) => void }`
where `itemLabel` is the HUMAN-MEANINGFUL item description (job sentence / human
name), supplied by the host — NEVER a raw CSV row index or `row:N` token (figure-
legibility §3, see STEER-FIG-1).

**Parts & states:**

| Part | States | Notes |
|---|---|---|
| Trigger (`<button>`) | default · hover · focus-visible · active · expanded(menu open) | icon `⋯` (aria-hidden) + accessible name; `aria-haspopup="menu"`; `aria-expanded` reflects open state |
| Popover (`role="menu"`) | closed(absent) · open · (no loading/empty/error — the four actions are static) | overlay; four `role="menuitem"` children; focus moves to first item on open |
| MenuItem ×4 (`role="menuitem"`) | default · hover · focus-visible · active | visible text label = authoritative; selecting fires `onSteer(itemId, actionType)` and closes |

**The four action types (exact visible labels — AC-2, no raw enum values):**
1. `Raise defect`        (actionType `raise-defect`)
2. `Re-prioritise`       (actionType `re-prioritise`)
3. `Request re-slice / split` (actionType `re-slice`)
4. `Custom steer`        (actionType `custom`)

**Stable selectors (a11y contract == test hook — handed to engineer):**
- Trigger: `getByRole('button', { name: /steer/i })` primary;
  `data-testid="steer-btn"` present on every trigger (SM-S5-1 hook).
  Accessible name MUST include the item reference, e.g.
  `aria-label="Steer CHK-5"` (item id) — so a screen reader announces WHICH item,
  and so multiple triggers on one screen are distinguishable by `name`, not `nth()`.
- Popover: `getByRole('menu', { name: /steer actions/i })`;
  `data-testid="steer-menu"`. The button's `aria-controls` points at the menu id.
- Each item: `getByRole('menuitem', { name: 'Raise defect' })` etc. (exact text);
  `data-testid="steer-action-<actionType>"` and `data-action="<actionType>"`.

### Reuse, not invent
No existing component fits a popover menu (DetailPane is a drawer; MetricSource is a
single tooltip). `SteerMenu` is a genuinely new primitive — recorded as a new row in
`design/components.md`. Trigger button reuses the `--target-min` (24px) hit-area
token, `--focus-ring`, `--radius-badge`; popover reuses `--c-surface-raised`,
`--c-border`, `--elev-box`/`--drawer-elev`, `--dur-fast` (0ms under reduced-motion).
No off-token values.

---

## Click-path budget (per use case, with justification)

| Job | Budget | UC-S014-1 reality |
|---|---|---|
| "Open the steer menu with its 4 actions" from a WIP chip | **≤ 2 clicks / keys** | 1 — focus reaches the chip's steer button by Tab; **click/Enter on the button opens the menu**. 1 click total from the chip. From a cold page: Tab to button + Enter = ≤ 2 keystrokes. **MET.** |
| "Open the steer menu with its 4 actions" from a tree row | **≤ 2 clicks / keys** | the tree is a roving-tabindex WAI-ARIA tree; once a row is active, Tab moves into the row's steer button, Enter opens. ≤ 2 keys from an active row. Row-click drill is unchanged (separate target). **MET.** |
| "Choose an action type" (→ opens panel, UC-S014-2) | +1 click/key | menuitem click/Enter. Total to a chosen action ≤ 3 — within budget; panel is the next UC. |

Justification for every step: there is no 0-click option (a permanently-open menu
on every chip/row would flood the at-a-glance surface and break J1's 0-click read).
One deliberate trigger press is the minimum that keeps the menu out of the way until
wanted. We do NOT add a confirm/submenu step — the four actions are flat (no nesting),
so the picker is one level deep.

---

## Accessibility conditions (WCAG 2.2 AA) → mirrored into acceptance.md

Each is mechanically assertable (axe rule or Playwright/Vitest assertion). Tag
prefix `S14-1-A11Y-*`.

- **A11Y-1 (keyboard reachable & operable, 2.1.1):** the steer trigger on a WIP chip
  AND on a tree row is reachable by keyboard alone (Tab / tree roving-tabindex) and
  the menu opens on `Enter` AND `Space`. Assert: focus the trigger via keyboard,
  press Enter → `role="menu"` present and visible; repeat with Space.
- **A11Y-2 (focus order & no trap, 2.4.3 / 2.1.2):** on open, focus moves to the
  first `menuitem`; `ArrowDown`/`ArrowUp` cycle items; `Esc` closes and returns
  focus to the trigger. No trap: Tab/Shift-Tab + Esc all escape. Assert focus
  element identity at each step.
- **A11Y-3 (visible, non-colour-redundant focus + state, 1.4.11 / 1.4.1):** the
  focused trigger and focused menuitem show a `:focus-visible` ring (`--focus-ring`,
  ≥ 3:1 vs surface). The expanded state is conveyed by `aria-expanded="true"` AND a
  visible change that is NOT colour-only (the popover's presence is itself the
  non-colour cue). Assert computed `box-shadow`/outline is non-empty on focus;
  assert `aria-expanded` toggles. No state relies on colour alone.
- **A11Y-4 (target size, 2.5.8):** the trigger button's hit box is ≥ 24×24 CSS px
  (`--target-min`); each menuitem hit box ≥ 24px tall. Assert `getBoundingClientRect`
  width/height ≥ 24.
- **A11Y-5 (name / role / state, 4.1.2):** trigger has `role=button` +
  `aria-haspopup="menu"` + `aria-expanded` + accessible name containing the item id;
  popover `role="menu"` with accessible name "Steer actions"; four `role="menuitem"`
  each with its exact visible text as accessible name. Assert via roles+names; run
  axe `aria-required-attr` / `aria-roles` rules with zero violations on the open menu.
- **A11Y-6 (reduced motion, 2.3.3 pref):** the popover open/close transition is
  `--dur-fast`; under `prefers-reduced-motion: reduce` it is 0ms (instant), no
  flashing > 3×/s. Assert: with reduced-motion emulated, the menu is present in the
  same frame as the trigger press (no animated delay).
- **A11Y-7 (one affordance per item, scope — supports 1.3.1):** exactly one steer
  trigger per item-bearing element; none on non-item elements (see STEER-SCOPE-1).

---

## Geometry / no-reflow invariant (EXP-016) → testable, mirrored into acceptance.md

The most important structural condition for this UC. Opening the menu is an
**overlay**, never an in-flow insertion — a board-as-a-line-class regression would
be the menu pushing chip siblings down or growing the page.

- **GEO-S014-1 (underlying bbox unchanged):** capture
  `getBoundingClientRect()` of (a) the host WIP chip `<li>` and its sibling chips,
  and (b) the `value-stream-map` region, with the menu CLOSED. Open the menu.
  Re-capture. The host chip's and siblings' bounding boxes are **byte-identical**
  (x/y/width/height equal) menu-open vs menu-closed. Repeat for a tree row + the
  `work-item-tree` region. Assert equality.
- **GEO-S014-2 (page does not grow):** `document.documentElement.scrollHeight`
  (and the tree rail's + `<main>`'s `scrollHeight`) are **identical** with the menu
  open vs closed. The popover adds zero block height to the flow. Assert equality.
- **GEO-S014-3 (overlay, not in-flow):** the popover element's computed `position`
  is `fixed` (or it is portalled outside the chip/row subtree) and its
  `z-index` places it above the host surface — assert `getComputedStyle(menu).position`
  ∈ {fixed} and the menu node is NOT a flow-affecting child whose presence shifts
  siblings (covered by GEO-S014-1).
- **GEO-S014-4 (anchored, on-screen):** the open popover's bounding box lies within
  the viewport (no negative left/top, right ≤ innerWidth) so it never causes
  horizontal scroll — same anchoring discipline as the DetailPane drawer.

---

## Figure-legibility conditions (figure-legibility checklist) → mirrored into acceptance.md

UC-S014-1 surfaces no metric figures, but it DOES surface an item **reference** in
the trigger's accessible name and (later) carries `itemLabel` into the menu/panel.
Reference legibility is in scope now because the selector contract is set here.

- **STEER-FIG-1 (human-meaningful reference, §3):** the trigger's accessible name
  uses the item's human reference (its id `CHK-5` and, where the host has it, its
  job sentence), NEVER a machine-internal token alone (no `row:700`, no bare array
  index, no `queued-item-engineer-0`-style positional id as the user-visible name).
  Assert: `steer-btn` accessible name matches the live item id pattern and is not a
  `row:\d+` / pure-numeric string.
- **STEER-FIG-2 (action labels are words, not enum keys — = AC-2):** the four
  menuitem labels render as the human phrases ("Raise defect", "Re-prioritise",
  "Request re-slice / split", "Custom steer"), never the `data-action` enum value
  (`raise-defect`, `re-slice`, …). Assert visible text ≠ `data-action` value.

(Empty/unknown-≠-zero §4 and unit §1/§2 do not apply to this UC — no counts/rates
rendered. They re-enter scope at UC-S014-2's context block, designed then.)

---

## Stable selectors handed to the engineer (consolidated build contract)

| Element | Primary selector (a11y) | Test-id | Extra data-attrs |
|---|---|---|---|
| Steer trigger | `getByRole('button', { name: /steer <itemId>/i })` | `steer-btn` | `data-item-id` |
| Steer popover | `getByRole('menu', { name: /steer actions/i })` | `steer-menu` | `aria-controls`/`id` link from trigger |
| Action item | `getByRole('menuitem', { name: '<exact label>' })` | `steer-action-<actionType>` | `data-action="<actionType>"` |

No `nth()`, no count-derived, no text-exclusion selectors. Multiple triggers are
disambiguated by the item id in the accessible name.

---

## Component-map delta (change-impact model — co-owned .mmd)

Engineer/UI must update `architecture/dependencies/component-map.mmd` in the SAME
commit that lands SteerMenu: add node `SteerMenu`; add edges
`SteerMenu --> StageNode` and `SteerMenu --> TreeNode` (or `VsmContainer` /
`WorkItemTree` per the file's existing granularity), marked `classDef changed` for
the tester's UI test-plan. Marks cleared at slice delivery after the tester consumes.

---

## NOT designed yet (deferred) — UC-S014-1 scope boundary

- **SteerPanel** (UC-S014-2) — NOW DESIGNED below (§UC-S014-2).
- **promptBuilder output** (UC-S014-3) and **copy/toast + SSE refresh** (UC-S014-4)
  — separate STRUCTURE passes.
- Right-click context-menu accelerator (redundant to the button) — possible later;
  not in this UC.
- Mobile / responsive layout — out of scope per slice.md.
- The write path — there is none by design; the menu and panel are read-only, the
  only write is the clipboard (UC-S014-4).

---
---

# UC-S014-2 — Steer panel (context display + intent note)

STRUCTURE pass for UC-S014-2. Builds DIRECTLY on UC-S014-1 (above) — does NOT
regress any UC-S014-1 section. The SteerMenu's `onSteer(itemId, actionType)`
callback (a stub in UC-S014-1) now has a destination: it opens this panel.

## Surfaces touched (UC-S014-2)

Single-page dashboard `/` — no new route. Adds ONE new component
(`SteerPanel.jsx`) + ONE new hook (`useSteerContext.js`). The panel OPENS FROM the
SteerMenu (on both host surfaces — VSM WIP chips and tree rows) and floats OVER
the dashboard. No host-component layout change.

| Surface | Host | Attach |
|---|---|---|
| Steer panel | portalled to `document.body`, anchored to the right edge of the viewport | opened by `onSteer(itemId, actionType)` fired from any `SteerMenu`; receives the item id + chosen action type |

## Navigation / IA delta (UC-S014-2)

**IA decision: a right-anchored non-modal floating DRAWER, reusing the DEFECT-006
DetailPane discipline — NOT a centred modal.** Rationale:
- a modal with a scrim would black out the VSM/tree the operator is steering
  FROM, breaking the "whole and the part" principle the DetailPane established —
  the operator should still see the pipeline context behind the panel;
- a drawer reuses the exact overlay tokens already in the system (`--z-drawer`,
  `--drawer-width`, `--drawer-inset`, `--drawer-elev`, `--dur-drawer`) — no new
  token system, one consistent floating-surface idiom across DetailPane + SteerMenu
  popover + SteerPanel;
- the drawer is `position:fixed` so opening it adds **zero flow height** and
  reflows nothing (the same no-reflow guarantee as the DetailPane and the
  SteerMenu popover — GEO conditions below).
- **Coexistence with the DetailPane:** the steer flow can be triggered from a tree
  row whose DetailPane may also open on row-click. These are DISTINCT triggers
  (row-click → drill → DetailPane; steer-button → SteerMenu → SteerPanel). The
  SteerPanel sits at the SAME `--z-drawer` layer; only one steer panel is open at
  a time. If both could stack, the SteerPanel takes a `--z-drawer` + small offset
  so it is never occluded (engineer note; assert SteerPanel is visible/on-top when
  opened). Esc closes the topmost.

**Open/close & focus path:**
- opens on action-type selection from the SteerMenu (the menu closes, the panel
  opens — one continuous gesture);
- on open, focus MOVES to the panel heading (then the intent textarea is the first
  interactive stop) — same focus-move discipline as the DetailPane;
- close via × button, "Cancel", or Esc → panel unmounts, focus RETURNS to the
  steer trigger that opened it (the SteerMenu trigger element, captured on open —
  mirrors the DetailPane's originRef focus-return);
- non-modal: NO scrim, NO focus trap — the VSM/tree stay operable behind it.

## Component decomposition (UC-S014-2)

### SteerPanel (new — `src/app/src/components/SteerPanel.jsx`)
The context-display + intent-note drawer the SteerMenu opens.

**Props:** `{ itemId: string; actionType: SteerActionType; context: SteerContext | null;
status: "loading"|"ready"|"error"|"not-found"; onCancel(); onGenerate(intentNote); }`
where `SteerContext` is produced by `useSteerContext` (state-shape note below).

**Regions (top→bottom):** header (action-type label + ×) → **item context block**
→ intent-note textarea → action row ("Generate prompt" + "Cancel"). UC-S014-3's
prompt output renders in a fourth region appended below the action row (its own
seam — not designed here, just leave the slot).

**States:**
- `loading` — header + region render immediately; context block shows a labelled
  skeleton ("Loading item context…"), textarea disabled until ready.
- `ready` — full context block; textarea enabled; Generate disabled until ≥1 char.
- `not-found` — item id not in `/items` (stale id): context block shows "Item
  <id> not found" (labelled, not blank/crash); textarea + Generate hidden; only
  Cancel/× available. (Resilience — never crash on a stale id.)
- `error` — `/items` fetch failed: "Could not load item context — try again"
  (labelled), Cancel/× available. Fail soft.

**Selectors:**
- Panel: `getByRole('dialog', { name: /steer: <itemId>/i })` — `role="dialog"`
  WITHOUT `aria-modal` (non-modal drawer, no trap); `aria-labelledby` → the
  heading; `data-testid="steer-panel"`; `data-item-id`; `data-action`.
- Close (×): `getByRole('button', { name: /close steer panel/i })`;
  `data-testid="steer-panel-close"`.
- Cancel: `getByRole('button', { name: 'Cancel' })`; `data-testid="steer-cancel"`.
- Generate: `getByRole('button', { name: 'Generate prompt' })`;
  `data-testid="steer-generate"`; `aria-disabled` reflects the empty-intent guard.

### SteerContextBlock (child of SteerPanel — the item context display)
The human-meaningful item context — the figure-legibility surface of this UC.

**Props:** `{ context: SteerContext }`

**Contents (each a labelled `<dt>`/`<dd>` pair — never a bare value):**
| Field | Label (visible) | Source | Legibility rule |
|---|---|---|---|
| id | "Item" | items.csv `id` | shown WITH job: "CHK-5 — <job sentence>" (§3 human ref) |
| job | "Job" | items.csv `job` | the full human job sentence; never the row key |
| state | "State" | items.csv `state` | humanised label ("planned"/"in-progress"/"done") — not a raw enum if the enum differs from the label; no bare CSV column name |
| value | "Value" | items.csv `value` | "HIGH"/"MED"/"LOW" as shown elsewhere |
| cost | "Cost" | items.csv `cost` | "S"/"M"/"L" |
| action type | "Steering action" | from UC-S014-1 | the human label ("Request re-slice / split"), never the `data-action` enum |

**Selector:** `data-testid="steer-context"`; each field
`data-testid="steer-ctx-<field>"` (`id|job|state|value|cost|action`).
`data-source="work/<project>/items.csv#id=<id>"` on the block (SourceLink
convention reuse — traceability §8).

### IntentNote (child of SteerPanel — the free-text textarea)
**Props:** `{ value; onChange; disabled }`
**States:** empty (Generate disabled) · non-empty (Generate enabled) · disabled
(while loading / not-found / error).
**Selector:** `getByRole('textbox', { name: /intent/i })`;
`data-testid="intent-note"`; `<label for>` associated, placeholder
"Describe what you want to happen (e.g. split this UC into two…)".

### Reuse, not invent
SteerPanel reuses the DetailPane drawer idiom (NOT the DetailPane component —
DetailPane is the drill-artifact drawer with breadcrumb/history; SteerPanel is a
distinct steer-context drawer). It reuses ALL the DEFECT-006 drawer tokens
(`--z-drawer`/`--drawer-width`/`--drawer-inset`/`--drawer-elev`/`--dur-drawer`,
0ms reduced-motion), `--c-surface-raised`/`--c-border`, `--focus-ring`,
`--target-min`, `--radius-box`, the `<dt>`/`<dd>` labelled-figure pattern (s003/
s004), and the `data-source` SourceLink convention. SteerPanel + SteerContextBlock
+ IntentNote are new rows in `design/components.md`. No off-token values.

## Click-path budget (UC-S014-2)

| Job | Budget | UC-S014-2 reality |
|---|---|---|
| "From a chosen action type, see the item's context + add intent" | **+1 from UC-S014-1** | selecting the action in the SteerMenu opens this panel directly (the menu close + panel open is ONE gesture, not two clicks); the context block is visible on open (0 further clicks to read it); typing the intent is keystrokes, not clicks. Total chip→context-visible ≤ 3 clicks (Tab/Enter to trigger, Enter to open menu, Enter on action). **MET — within the UC-S014-1 ≤2 + 1 budget.** |
| "Abandon without a prompt" | **1 click / 1 key** | Cancel / × / Esc. **MET.** |

No confirm step is added; Generate is the deliberate forward action (guarded only
by the non-empty-intent rule, which is a disable, not an extra click).

## Accessibility conditions (WCAG 2.2 AA) — UC-S014-2 → mirrored into acceptance.md

Tag prefix `S14-2-A11Y-*`.

- **S14-2-A11Y-1 (keyboard open→operate→close, 2.1.1):** selecting an action by
  keyboard opens the panel; Tab reaches the intent textarea then Generate then
  Cancel then ×; Esc closes. All operable by keyboard alone. Assert focus path.
- **S14-2-A11Y-2 (focus move + return, no trap, 2.4.3/2.1.2):** on open focus
  moves into the panel (heading/textarea); on close (×/Cancel/Esc) focus RETURNS
  to the SteerMenu trigger that opened it. NON-MODAL → Tab/Shift-Tab can leave the
  panel into the page behind (no trap). Assert focus element identity at open and
  close.
- **S14-2-A11Y-3 (visible non-colour-redundant focus + disabled state, 1.4.11/
  1.4.1):** focus ring (`--focus-ring`, ≥3:1) on textarea + buttons; the Generate
  disabled state is conveyed by `aria-disabled="true"` AND a non-colour cue (the
  button is non-activatable + visually inset), not colour alone. Assert non-empty
  computed outline on focus; assert `aria-disabled` flips with intent emptiness.
- **S14-2-A11Y-4 (target size, 2.5.8):** ×, Cancel, Generate hit boxes ≥ 24×24 CSS
  px (`--target-min`). Assert getBoundingClientRect ≥ 24.
- **S14-2-A11Y-5 (name/role/state, 4.1.2):** panel `role="dialog"` (non-modal, NO
  `aria-modal`) named "Steer: <itemId>"; textarea has an associated `<label>`;
  buttons have accessible names. axe aria-* rules zero violations on the open
  panel.
- **S14-2-A11Y-6 (reduced motion, 2.3.3):** drawer slide-in `--dur-drawer`; 0ms
  under `prefers-reduced-motion: reduce`. Assert panel present same frame as the
  action selection under emulated reduced-motion.
- **S14-2-A11Y-7 (labelled context, programmatic, 1.3.1):** every context field is
  a programmatically associated label/value pair (`<dt>`/`<dd>` or `aria-label`)
  so no value is announced bare ("CHK-5", "HIGH", "M" all carry their label).
  Assert each `steer-ctx-*` value has an associated visible label.

## Geometry / no-reflow invariant (EXP-016) — UC-S014-2 → mirrored into acceptance.md

Same overlay discipline as the SteerMenu popover (GEO-S014-1..4) and the
DetailPane drawer (GEO-S005-3b). Opening the panel reflows NOTHING.

- **GEO-S014-2-1 (underlying surfaces unchanged):** capture
  `value-stream-map` AND `work-item-tree` region `getBoundingClientRect()` with
  the panel CLOSED; open the panel; re-capture — both bboxes byte-identical
  (the panel floats over, never pushes). Assert equality.
- **GEO-S014-2-2 (page does not grow):** `documentElement.scrollHeight` (and the
  `<main>` + tree-rail scrollHeight) identical panel-open vs closed — the drawer
  adds zero flow height. Assert equality.
- **GEO-S014-2-3 (overlay, not in-flow):** the panel's computed `position` is
  `fixed` and it is portalled to `document.body`; its `z-index` = `--z-drawer`
  (≥ the DetailPane layer) so it is above the host surfaces. Assert
  `getComputedStyle(panel).position === 'fixed'` and node parent is `body`.
- **GEO-S014-2-4 (anchored, on-screen, content STACKS):** the open panel's bbox
  lies within the viewport (no negative left/top, right ≤ innerWidth — no
  horizontal scroll); and the context block fields STACK vertically (each
  `steer-ctx-*` `<dd>` top offset increases; shared left) — the context reads as a
  labelled list, not a collapsed line (the stacked-list guard reused). Assert
  viewport containment + monotonic field tops.

## Figure-legibility conditions — UC-S014-2 → mirrored into acceptance.md

The context block is the figure surface (deferred from UC-S014-1). Tag
`S14-2-FIG-*`.

- **S14-2-FIG-1 (human-meaningful references, §3):** the item id is shown WITH its
  human job sentence ("CHK-5 — Compose a structured preview-first prompt…"), never
  the id alone as an opaque token and never a `row:N` / positional index. The
  steering-action is the human label, never the `data-action` enum. Assert the
  context block contains the job sentence text AND the human action label.
- **S14-2-FIG-2 (no raw CSV column names, == AC-2):** the visible labels are human
  words ("State", "Value", "Cost"), the values are the human forms ("planned",
  "HIGH", "M") — NO raw CSV keys (`vc_ratio`, `done_ts`, `started_ts`) appear in
  the panel. Assert the panel text contains none of the raw key strings.
- **S14-2-FIG-3 (empty/unknown ≠ zero/blank, §4):** a field whose source value is
  absent/empty renders "—" (unknown), NOT a blank cell and NOT "0" / "null" /
  "undefined". Assert a fixture item with a missing `value` renders "—" in the
  Value `<dd>`.
- **S14-2-FIG-4 (not-found ≠ crash):** a stale/unknown item id renders the labelled
  "Item <id> not found" state, never a blank panel or a thrown error. Assert the
  not-found state text is present and no console error.

(Unit conditions §1/§2 do not apply — UC-S014-2 surfaces no counts/rates/
durations, only categorical context. They re-enter scope only if a future UC adds
a metric to the panel.)

## State-shape note for `useSteerContext.js` — consumed by UC-S014-3

`useSteerContext(itemId)` fetches/caches item context from
`GET /api/projects/:id/items` (existing endpoint; READ-ONLY) and returns:

```
{
  status: "loading" | "ready" | "not-found" | "error",
  context: {
    id: string,            // "CHK-5"
    job: string,           // human job sentence (items.csv `job`)
    state: string,         // human state label
    value: string,         // "HIGH" | "MED" | "LOW"
    cost: string,          // "S" | "M" | "L"
    sourceRef: string,     // "work/<project>/items.csv#id=<id>"
  } | null,                // null while loading / not-found / error
}
```

**This is the contract UC-S014-3 (`promptBuilder.js`) consumes** to fill the
`{{item_id}}`/`{{item_job}}`/`{{item_state}}`/`{{item_value}}`/`{{item_cost}}`
template tokens, and that **UC-S015-3 (`ReslicePreviewPanel`) reuses verbatim** to
load the "Before" column item context (slice.md / UC-S015-3 deps note —
`useSteerContext` is the cross-slice seam). The fields map 1:1 onto the
re-slice.txt template tokens; UC-S014-3/UC-S015-4 add only `partAJob`/`partBJob`
on top of this shape. SSE refresh of this context is UC-S014-4 (the hook gains a
`subscribeEvents` re-fetch then — not designed here).

## Stable selectors handed to the engineer (UC-S014-2 build contract)

| Element | Primary selector (a11y) | Test-id | Extra |
|---|---|---|---|
| Steer panel | `getByRole('dialog', { name: /steer: <itemId>/i })` (non-modal) | `steer-panel` | `data-item-id`, `data-action` |
| Close × | `getByRole('button', { name: /close steer panel/i })` | `steer-panel-close` | — |
| Cancel | `getByRole('button', { name: 'Cancel' })` | `steer-cancel` | — |
| Generate | `getByRole('button', { name: 'Generate prompt' })` | `steer-generate` | `aria-disabled` |
| Context block | — | `steer-context` | `data-source` |
| Context field | `<dt>`/`<dd>` labelled pair | `steer-ctx-<field>` | — |
| Intent textarea | `getByRole('textbox', { name: /intent/i })` | `intent-note` | `<label for>` |

No `nth()`, no count-derived, no text-exclusion selectors.

## Component-map delta — UC-S014-2

Engineer/UI must update `architecture/dependencies/component-map.mmd` in the SAME
commit that lands SteerPanel: add nodes `SteerPanel`, `SteerContextBlock`,
`IntentNote`; add edge `SteerMenu --> SteerPanel` (the menu opens the panel) and
`SteerPanel --> useSteerContext`; marked `classDef changed` for the tester. Marks
cleared at slice delivery after the tester consumes them.

## NOT designed yet (deferred) — UC-S014-2 scope boundary

- **promptBuilder output region** (UC-S014-3) — the `<pre>`/styled output that
  renders below the SteerPanel action row; its own STRUCTURE pass (presentational
  output area + figure conditions if any). The slot is left in SteerPanel.
- **Copy button + toast + SSE context refresh** (UC-S014-4) — the copy mechanic,
  the `copy-toast`, and the `useSteerContext` SSE re-fetch wiring. Designed when
  UC-S014-4 is pulled.
- UC-S014-2's done-condition is the panel opening with the correct labelled
  context + an intent textarea + a guarded Generate button — NOT the generated
  prompt (that is UC-S014-3).

---
---

# UC-S014-4 — Copy to clipboard (toast confirm) + SSE context refresh while panel open

STRUCTURE pass for UC-S014-4 — the slice's LAST UC, closing the CHK-5 handoff
loop. ADDITIVE to UC-S014-1/-2 above and to the UC-S014-3 delivered prompt
output (commit e816d30). Regresses NO delivered section. This is presentational
+ a small live-refresh seam; no new route, no new top-level surface.

## Delivered reality this UC builds on (read before building)

- **UC-S014-3 (delivered, e816d30)** renders the prompt into the reserved
  `data-testid="prompt-output-slot"` as a read-only, SELECTABLE `<pre
  class="prompt-output" data-testid="prompt-output" aria-label="Generated
  prompt" tabindex="0">`. Presentation pinned in `steer-panel.css`: mono font
  (`--font-mono`), `white-space: pre-wrap`, `user-select: text`, `max-height:
  40vh` + `overflow-y: auto`, `--focus-ring` on `:focus-visible`. The
  UC-S014-3 specs pin the copy button + `copy-toast` ABSENT — **this UC flips
  those pins** (the copy affordance and toast now appear; their absent-assertions
  are replaced, not deleted-without-trace — see "Pin-flip ledger" below).
- **`buildPrompt(actionType, context, intentNote)`** (delivered) returns the
  exact prompt string; `SteerPanelContainer` holds it in `prompt` state and
  passes it down as the `prompt` prop. The clipboard payload MUST be the same
  string — byte-equal to `prompt` (the `<pre>`'s `textContent`).
- **`useSteerContext(itemId)`** (delivered) is the read-only item-context hook.
  Its docstring explicitly defers SSE refresh to THIS UC ("the hook gains a
  subscribeEvents re-fetch there"). The delivered SSE convention to mirror lives
  in **`useWipItems.js`**: import `subscribeEvents` from `api/client.js`, wrap a
  `refresh()` callback, debounce a burst of change frames into one re-fetch,
  and fail soft when there is no `EventSource` (jsdom → static data, no crash).
- **EXP-036 stale/live cue convention** is the **`LiveStatusDot`** component:
  meaning rides on (1) visible TEXT (authoritative), (2) an `aria-hidden ●`
  shape/colour dot, (3) `role="status" aria-live="polite"` so a change is
  announced ONCE, not spammed. The context-block refresh cue below REUSES this
  exact three-cue, announce-once discipline — it does not invent a new one.

## Ratify the UC-S014-3 prompt-output presentation into the design system

The delivered `.prompt-output` presentation is sound and now PROMOTED from a
build detail to a recorded design-system component (a `PromptOutput` row in
`design/components.md`), so any future prompt surface (e.g. UC-S015-4's enriched
re-slice prompt, which reuses this same slot) inherits it rather than re-deriving:

- **mono font** (`--font-mono`) — the prompt is a slash-command to be pasted
  verbatim; a monospaced face signals "code/command, copy exactly" and keeps
  `{{token}}`-derived alignment readable;
- **`max-height: 40vh` + `overflow-y: auto`** — a long prompt scrolls INSIDE the
  drawer rather than growing it past the viewport (the drawer is `max-height:
  calc(100vh - 2*--drawer-inset)`; the inner cap keeps the action row + context
  reachable above the fold);
- **`user-select: text` + `cursor: text`** — explicit so no ancestor rule makes
  the handoff text unselectable; manual select+copy remains a fallback to the
  one-click button this UC adds;
- **`white-space: pre-wrap` + `overflow-wrap: anywhere`** — line structure of the
  command preserved, long intent lines wrap instead of forcing horizontal scroll;
- **`tabindex="0"` + `aria-label="Generated prompt"` + `--focus-ring`** — the
  read-only region is itself keyboard-focusable and named, so a keyboard/AT user
  reaches and identifies the prompt.

No token change — `--font-mono`/`--radius-box`/`--c-surface`/`--c-border` already
exist. This is a ratification, not a redesign.

## Surfaces touched (UC-S014-4)

Single-page dashboard `/` — no new route. Adds, inside the EXISTING `SteerPanel`:
ONE copy button (in the prompt-output region) + ONE toast (a polite live region);
and extends `useSteerContext.js` with an SSE re-fetch + a stale/live cue on the
context block. No host-component layout change; the drawer geometry is unchanged.

| Surface | Host | Attach |
|---|---|---|
| Copy button | `SteerPanel.jsx` prompt-output region | rendered INSIDE `prompt-output-slot`, adjacent to the `<pre>`, only when a prompt is present |
| Copy toast | portalled to `document.body` (or fixed within the panel's stacking context), a polite live region | mounts on copy success, auto-dismisses |
| Context refresh cue | `SteerContextBlock` header, beside the "Item" pair | a small stale/live indicator reusing the `LiveStatusDot` idiom |
| SSE re-fetch | `useSteerContext.js` | `subscribeEvents` → debounced `refresh()`, mirroring `useWipItems.js` |

## Navigation / IA delta (UC-S014-4)

No nav change. The copy action is the terminal step of the EXISTING handoff
micro-flow (open menu → choose action → panel → Generate → **Copy**). The toast
is a transient confirmation, NOT a navigation target — it never takes focus, has
no dismiss control the user must hunt, and does not grow the nav stack. The SSE
refresh is invisible until the underlying item changes, at which point the
context block shows a "context updated" cue (below) — it is information, not a
navigation step. Esc/×/Cancel close paths are unchanged.

## Component decomposition (component → states → stable selector)

### CopyPromptButton (new — inside SteerPanel's prompt-output region)
The one-click clipboard affordance. Present ONLY when `prompt` is a non-empty
string (it has nothing to copy otherwise — same gating as the `<pre>`).

**Props:** `{ prompt: string; onCopied?(): void }` (pure; the actual
`navigator.clipboard.writeText` lives in the panel's copy handler — a render-layer
DOM concern, like the managed focus already in SteerPanel; no domain/port change).

| Part | States | Notes |
|---|---|---|
| Button | idle ("Copy prompt") · copied ("Copied ✓") · focus-visible · active · (no disabled — absent when no prompt) | label is authoritative; on success it flips to "Copied ✓" and fires the toast, then reverts to "Copy prompt" after `--dur-toast` (or stays "Copied ✓" until panel close — either is acceptable per AC-1, but it must NOT mislead a second click: a second click re-copies and re-shows the toast) |

**Copy payload contract (AC-1):** the string written to the clipboard is
**byte-equal to `prompt`** — i.e. equal to the `prompt-output` `<pre>`'s
`textContent`. The button copies the SAME bytes the operator sees; no
re-serialisation, no trimming, no HTML. Assert `clipboard.readText()` ===
the `<pre>` textContent === the `prompt` prop.

**Selector:** `getByRole('button', { name: /copy prompt/i })`;
`data-testid="copy-prompt-btn"`. The "Copied ✓" state keeps an accessible name
that still matches `/copy/i` so the selector is stable across both states (the
`✓` is `aria-hidden`; the accessible name is "Copy prompt" / "Copied").

### CopyToast (new — polite live region, portalled)
The confirmation that the copy succeeded.

**Props:** `{ message: string; visible: boolean }` (presentational; auto-dismiss
timer owned by the panel/container).

**States:** hidden (absent / `visible=false`) · shown ("Copied to clipboard").

**Selector:** `data-testid="copy-toast"`; `role="status"` `aria-live="polite"`;
visible text "Copied to clipboard". (`role="alert"`/`assertive` is WRONG here —
a successful copy is a confirmation, not an error/interruption; polite matches
the LiveStatusDot announce-once discipline and does not preempt the screen
reader. The button label flip "Copied ✓" is the redundant non-live cue.)

**Non-colour-redundant (1.4.1):** the toast conveys success by its TEXT
("Copied to clipboard") + the button's "Copied ✓" label flip — NEVER by a green
background alone. A check glyph is `aria-hidden` decoration on top.

**Auto-dismiss + reduced motion:** the toast appears within 2 s (AC-2; in
practice synchronously on the clipboard promise resolve) and auto-dismisses after
`--dur-toast` (a new token, see below). Fade transition is `--dur-fast` under
`prefers-reduced-motion: no-preference`; under `reduce` it appears and disappears
INSTANTLY (0ms), and there is no flashing > 3×/s. The toast NEVER steals focus
(it is a status region, not a dialog).

### ContextRefreshCue (new — reuses the LiveStatusDot idiom, inside SteerContextBlock)
The EXP-036 stale-vs-live cue on the context block: it tells the operator whether
the displayed context is currently live or has just been refreshed by an SSE
change, so they never act on stale context and know WHEN to regenerate.

**Props:** `{ state: "live" | "refreshing" | "updated" }` (derived in the
container from the hook's status + a "context changed since last generate" flag).

**States:**
- `live` — context matches the latest fetch; quiet steady indicator ("Live", `●`).
- `refreshing` — an SSE change frame is being re-fetched ("Refreshing…").
- `updated` — the re-fetch changed the displayed context AFTER a prompt was
  already generated: a non-colour-redundant cue "Context updated — regenerate to
  refresh the prompt" (text authoritative + `⟳` glyph aria-hidden +
  `--c-state-over` band, the same over/attention channel used elsewhere). This is
  the operative EXP-036 signal: the prompt on screen may now be stale relative to
  the item, and the operator is TOLD, never silently shown old-vs-new mismatch.

**Selector:** `data-testid="steer-context-live"`; `role="status"`
`aria-live="polite"`; accessible name carries the full state ("Item context:
live" / "Item context: updated — regenerate to refresh the prompt"). Reuses the
`LiveStatusDot` markup pattern (visible text + aria-hidden glyph + announce-once).

### Reuse, not invent
CopyPromptButton/CopyToast reuse `--c-surface`/`--c-surface-raised`/`--c-border`/
`--radius-box`/`--radius-badge`/`--focus-ring`/`--target-min`/`--dur-fast` and the
`--c-state-ok` channel for the success accent (redundant cue only). ContextRefreshCue
reuses the LiveStatusDot component idiom and the `--c-state-over` attention channel.
ONE new token only: `--dur-toast` (auto-dismiss visible duration; 0ms-honouring of
reduced motion is on the transition, not this timer). New rows in
`design/components.md`: `PromptOutput` (ratified), `CopyPromptButton`, `CopyToast`,
`ContextRefreshCue`. No off-token values.

## The DISPLAYED-PROMPT-DOES-NOT-AUTO-REGENERATE invariant (the core resilience rule)

The single most important behavioural condition of this UC, owned jointly with the
engineer: **an SSE context refresh updates the context block ONLY; it must NOT
re-run `buildPrompt` or mutate the displayed `prompt-output` text.** The prompt is
regenerated ONLY on an explicit Generate press. Rationale (EXP-036 + AC-4): the
operator reviews a specific prompt before handing it to Claude; silently swapping
the bytes under them — between review and copy — would hand Claude a prompt the
operator never read. So: context refreshes live (truthful), prompt stays frozen
(trustworthy), and the ContextRefreshCue `updated` state TELLS the operator the two
have diverged so THEY choose to regenerate. This is testable (PROMPT-FREEZE-1 below).

## Click-path budget (UC-S014-4)

| Job | Budget | UC-S014-4 reality |
|---|---|---|
| "Copy the reviewed prompt" | **1 click / 1 key** | one press of the Copy button (Tab-reachable; Enter/Space activate). Manual select+copy remains a fallback (UC-S014-3). **MET.** |
| "Know the copy succeeded" | **0 clicks** | the toast + button-label flip appear automatically; no acknowledge step. **MET.** |
| "Know the context went stale while I had the panel open" | **0 clicks** | the ContextRefreshCue updates automatically on the SSE frame; no refresh button to press. **MET.** |
| "Refresh the prompt to the new context" | **1 click** | press Generate again (deliberate — the freeze invariant requires the operator's intent). **MET (correctly deliberate, not auto).** |

No confirm/extra step added anywhere. Copy is the terminal one-press handoff.

## Accessibility conditions (WCAG 2.2 AA) — UC-S014-4 → mirrored into acceptance.md

Tag prefix `S14-4-A11Y-*`.

- **S14-4-A11Y-1 (keyboard copy, 2.1.1):** the Copy button is reachable by keyboard
  (in the panel tab order, after the prompt `<pre>`) and activates on Enter AND
  Space, placing the prompt on the clipboard. Assert keyboard activation copies.
- **S14-4-A11Y-2 (success announced politely, 4.1.3):** the copy toast is
  `role="status" aria-live="polite"` (announce-once, never `assertive`), so the
  "Copied to clipboard" confirmation is spoken without preempting. Assert the live
  region's role/aria-live and that its text appears on copy.
- **S14-4-A11Y-3 (non-colour-redundant success + state, 1.4.1):** copy success is
  conveyed by the toast TEXT + the button "Copied ✓" label flip — not colour
  alone. The ContextRefreshCue `updated` state is conveyed by text + glyph + band,
  not colour alone. Assert a visible non-colour cue exists in each.
- **S14-4-A11Y-4 (visible focus, 1.4.11):** the Copy button shows a `:focus-visible`
  ring (`--focus-ring`, ≥3:1). Assert non-empty computed outline/box-shadow on focus.
- **S14-4-A11Y-5 (target size, 2.5.8):** the Copy button hit box ≥ 24×24 CSS px
  (`--target-min`). Assert getBoundingClientRect ≥ 24.
- **S14-4-A11Y-6 (reduced motion, 2.3.3):** the toast fade is `--dur-fast` under
  no-preference and 0ms (instant appear/disappear) under
  `prefers-reduced-motion: reduce`; no flashing > 3×/s. Assert toast present in the
  same frame as copy under emulated reduce.
- **S14-4-A11Y-7 (toast never traps/steals focus, 2.4.3):** the toast does NOT
  move focus on appearance; focus stays on the Copy button (so a keyboard user can
  immediately re-copy or Tab onward). Assert document.activeElement is unchanged by
  the toast appearing.
- **S14-4-A11Y-8 (context refresh announced once, 4.1.3 / EXP-036):** the
  ContextRefreshCue is `role="status" aria-live="polite"` so a refresh is announced
  ONCE, not spammed per SSE frame (the debounce collapses a burst). Assert the cue's
  role/aria-live and that a single refresh produces one announcement.

## Geometry / no-reflow invariant (EXP-016) — UC-S014-4 → mirrored into acceptance.md

The toast and the copy/refresh affordances must not corrupt the drawer or the
underlying surfaces. Tag `GEO-S014-4-*`.

- **GEO-S014-4-1 (toast appearance reflows NOTHING):** capture the `steer-panel`
  region, the `prompt-output` `<pre>`, and the `value-stream-map` + `work-item-tree`
  region `getBoundingClientRect()` with the toast HIDDEN; trigger a copy so the
  toast SHOWS; re-capture. All four bboxes are **byte-identical** toast-shown vs
  toast-hidden (the toast is `position:fixed`/portalled — own stacking context,
  zero flow height). Also `documentElement.scrollHeight` identical. Assert equality.
  (This is the explicit "GEO no-reflow on toast appearance" condition.)
- **GEO-S014-4-2 (toast on-screen):** the visible toast's bounding box lies within
  the viewport (no negative left/top, right ≤ innerWidth, bottom ≤ innerHeight) — it
  never causes scroll. Assert viewport containment.
- **GEO-S014-4-3 (copy button trails the prompt, does not break the output region):**
  the Copy button sits within `prompt-output-slot` adjacent to the `<pre>` (its top
  ≥ the `<pre>`'s top OR it is a trailing sibling) and its presence does not change
  the `<pre>`'s bbox vs the no-button baseline beyond its own footprint. Assert the
  `<pre>` retains its `max-height: 40vh` scroll cap (computed maxHeight resolves to
  ≤ 40% of viewport height) with the button present.
- **GEO-S014-4-4 (context refresh does not reflow the context block):** an SSE
  refresh that changes a context value re-renders the `<dd>` text in place; the
  context block keeps its single-column STACK (each `steer-ctx-*` `<dd>` top offset
  still increases, shared left — the GEO-S014-2-4 guard re-asserted post-refresh).
  Assert the stacked-list geometry holds after a simulated refresh.

## Figure-legibility conditions — UC-S014-4 → mirrored into acceptance.md

The toast and the refresh cue both carry TEXT a human reads. Tag `S14-4-FIG-*`.

- **S14-4-FIG-1 (toast text is human-meaningful, §3):** the toast reads "Copied to
  clipboard" — a plain human confirmation — NEVER a status code, a byte count
  ("512 bytes copied"), or a machine token. It states WHAT happened in words.
  Assert the toast text matches a human-confirmation phrase, not a numeric/code form.
- **S14-4-FIG-2 (refresh cue is human-meaningful, §3 + EXP-036):** the
  ContextRefreshCue text is a human sentence ("Item context: live" / "Context
  updated — regenerate to refresh the prompt"), never a raw timestamp, frame id, or
  SSE event name. It tells the operator the MEANING (live vs diverged), not the
  mechanism. Assert the cue text is one of the human phrases, contains no raw
  `event:`/epoch token.
- **S14-4-FIG-3 (prompt copied = prompt shown, §3 reference integrity):** the copied
  bytes are exactly the displayed `<pre>` textContent (== PROMPT-COPY-1 below) — the
  operator copies precisely the human-meaningful prompt they reviewed, never a
  re-derived or differently-tokenised string. (Cross-listed with the copy contract.)

## Behavioural conditions co-owned with the engineer → mirrored into acceptance.md

These are not pure-UI but the UI design pins them because they are the trust
contract of the surface. Tag `PROMPT-*` / `S14-4-SSE-*`.

- **PROMPT-COPY-1 (byte-equal clipboard, == AC-1):** `navigator.clipboard.readText()`
  after a Copy click === the `prompt-output` `<pre>` `textContent` === the `prompt`
  prop / `buildPrompt(...)` return. Assert all three equal in a jsdom/browser test.
- **PROMPT-FREEZE-1 (displayed prompt does NOT auto-regenerate on SSE refresh, ==
  AC-4):** with a prompt displayed, simulate an SSE context-change frame; the
  context block updates to the new state, but the `prompt-output` text is UNCHANGED
  (byte-identical to before the frame). Only an explicit Generate press changes it.
  Assert: prompt text stable across the refresh; assert it DOES change after a
  subsequent Generate. This is the EXP-036 stale-trust guard for the prompt itself.
- **S14-4-SSE-1 (context refreshes within the SSE window, == AC-4 first half):**
  updating the source item while the panel is open causes `useSteerContext` to
  re-fetch (via `subscribeEvents`, debounced like `useWipItems`) and the context
  block to show the new value within the SSE window. Assert the `<dd>` reflects the
  new value after a simulated change frame.
- **S14-4-SSE-2 (fail-soft, no EventSource):** in jsdom (no `EventSource`) the hook
  falls back to static data and does not crash — exactly the `useWipItems`
  `unsubscribe = null` path. Assert no throw when `subscribeEvents` is unavailable.
- **NO-WRITE-1 (== AC-3):** no file under `work/`/`process/` is modified during the
  copy/refresh interaction; the clipboard is the ONLY write surface; the server
  write-guard still returns 405 on POST/PUT/PATCH/DELETE. (Engineer/tester verify;
  UI co-lists because "clipboard is the only write" is a design invariant.)

## Pin-flip ledger (UC-S014-3 absent-assertions this UC replaces)

UC-S014-3's specs pin the copy button + `copy-toast` ABSENT (the build correctly
had nothing to copy-confirm yet). This UC FLIPS exactly those pins — they are
REPLACED by the present-assertions above (PROMPT-COPY-1, S14-4-A11Y-1/2, the toast
present-state), NOT silently deleted. The engineer updates the UC-S014-3 absent
specs to the UC-S014-4 present specs in the same commit that lands the copy
affordance, citing this ledger, so the flip is traceable (no "a test used to assert
absence and now silently doesn't" gap).

## State-shape note — useSteerContext SSE extension (engineer build contract)

`useSteerContext(itemId, opts)` gains (mirroring `useWipItems`):
```
import { subscribeEvents } from '../api/client.js';
// inside the hook: a refresh() callback that re-runs the existing fetch;
// a debounced subscribeEvents(() => refresh()) effect; unsubscribe on cleanup;
// fail-soft when subscribeEvents returns no unsubscribe (jsdom → static).
```
The returned contract is UNCHANGED in shape (status/context six fields) — it
simply re-fetches live. It MAY add a derived flag the container uses to drive the
ContextRefreshCue `updated` state (e.g. the container compares the context that was
in effect at the last Generate against the current context). The displayed prompt
state stays in `SteerPanelContainer` and is NOT touched by the refresh (PROMPT-FREEZE-1).

## Stable selectors handed to the engineer (UC-S014-4 build contract)

| Element | Primary selector (a11y) | Test-id | Extra |
|---|---|---|---|
| Copy button | `getByRole('button', { name: /copy prompt/i })` | `copy-prompt-btn` | accessible name matches `/copy/i` in both idle + copied states |
| Copy toast | `getByTestId('copy-toast')` (status region) | `copy-toast` | `role="status"`, `aria-live="polite"` |
| Context refresh cue | `getByTestId('steer-context-live')` | `steer-context-live` | `role="status"`, `aria-live="polite"` |
| Prompt output (existing) | `getByRole('region'/textbox? )` → `getByTestId('prompt-output')` | `prompt-output` | unchanged from UC-S014-3; `aria-label="Generated prompt"` |

No `nth()`, no count-derived, no text-exclusion selectors.

## Component-map delta — UC-S014-4

Engineer/UI update `architecture/dependencies/component-map.mmd` in the SAME commit
that lands the copy/refresh: add nodes `CopyPromptButton`, `CopyToast`,
`ContextRefreshCue`; add edges `CopyPromptButton --> SteerPanel`,
`CopyToast --> SteerPanel`, `ContextRefreshCue --> SteerContextBlock`, and
`useSteerContext --> subscribeEvents` (the new SSE edge). Mark changed nodes/edges
`classDef changed` (extend the `s014changed` class) for the tester. Marks cleared at
slice delivery after the tester consumes them.

## NOT designed yet (deferred) — UC-S014-4 scope boundary

- UC-S014-4 is the LAST UC of s014; nothing in s014 is deferred past it.
- The enriched re-slice prompt (UC-S015-4) REUSES this `PromptOutput` + copy idiom
  in `ReslicePreviewPanel` — designed in the s015 UC-S015-3/-4 passes, not here.
- Mobile / responsive layout — out of scope per slice.md.
- The write path — there is none beyond the clipboard, by design (NO-WRITE-1).
