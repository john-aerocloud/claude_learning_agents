# Acceptance — s014 Steer prompt handoff

Co-authored: product (functional ACs in use-cases.md), ui-designer (UI/a11y/
geometry/figure conditions below). Each condition is mechanically assertable
(axe rule, Playwright, or Vitest). Tester enforces.

---

## UC-S014-1 — Steer-action menu on pipeline items

### Functional (from use-cases.md AC-1..AC-4)
- F-1: `data-testid="steer-btn"` present on ≥1 live WIP chip AND ≥1 work-item tree
  row when the app runs against real data (SM-S5-1).
- F-2: clicking the trigger opens a picker with exactly four labelled options —
  exact text "Raise defect", "Re-prioritise", "Request re-slice / split",
  "Custom steer" (AC-2).
- F-3: selecting any action dismisses the picker and passes item id + action type
  onward without a page reload (AC-3).
- F-4: the affordance appears on item-bearing elements only, not on stage labels /
  headers / `+N more` chips / region headings (AC-4).

### Accessibility (WCAG 2.2 AA) — ui-designer
- **S14-1-A11Y-1** keyboard reachable & operable: steer trigger on a WIP chip and on
  a tree row reachable by keyboard alone; menu opens on Enter AND Space. (2.1.1)
- **S14-1-A11Y-2** focus order & no trap: on open focus → first menuitem;
  ArrowUp/Down cycle; Esc closes and returns focus to trigger; no trap. (2.4.3/2.1.2)
- **S14-1-A11Y-3** visible non-colour-redundant focus + state: `:focus-visible` ring
  (`--focus-ring`, ≥3:1) on trigger and menuitems; `aria-expanded` toggles; no
  state conveyed by colour alone. (1.4.11/1.4.1) — assert non-empty computed
  outline/box-shadow on focus + aria-expanded flip.
- **S14-1-A11Y-4** target size ≥ 24×24 CSS px for trigger and each menuitem (2.5.8)
  — assert getBoundingClientRect ≥ 24.
- **S14-1-A11Y-5** name/role/state: trigger `role=button` + `aria-haspopup="menu"` +
  `aria-expanded` + accessible name containing item id; popover `role="menu"` named
  "Steer actions"; four `role="menuitem"` named by exact visible text. axe
  aria-* rules zero violations on the open menu. (4.1.2)
- **S14-1-A11Y-6** reduced motion: open/close `--dur-fast`, 0ms under
  `prefers-reduced-motion: reduce`; no flashing >3×/s. (2.3.3) — assert menu present
  same frame as trigger press under emulated reduced-motion.
- **S14-1-A11Y-7** exactly one steer trigger per item-bearing element; none on
  non-item elements (supports 1.3.1; == F-4 scope).

### Geometry / no-reflow invariant (EXP-016) — ui-designer
- **GEO-S014-1** host WIP chip `<li>` + its sibling chips have byte-identical
  bounding boxes (x/y/w/h) menu-open vs menu-closed; repeat for a tree row. The
  `value-stream-map` and `work-item-tree` region bboxes also unchanged.
- **GEO-S014-2** `documentElement.scrollHeight` (and tree-rail + `<main>`
  scrollHeight) identical menu-open vs menu-closed — the menu adds zero flow height.
- **GEO-S014-3** popover computed `position` is `fixed` (or portalled outside the
  chip/row subtree); its presence shifts no sibling (subsumed by GEO-S014-1).
- **GEO-S014-4** open popover bounding box within viewport (no negative left/top,
  right ≤ innerWidth) — never causes horizontal scroll.

### Figure / reference legibility — ui-designer
- **STEER-FIG-1** trigger accessible name uses the item's human reference (id, e.g.
  `CHK-5`), NEVER a machine-internal token alone (no `row:\d+`, no bare positional
  index as the user-visible name).
- **STEER-FIG-2** the four menuitem visible labels are human phrases, never the
  `data-action` enum value (visible text ≠ `data-action`). (== F-2 reinforced.)

**Done condition (UC-S014-1):** F-1..F-4 + all S14-1-A11Y-*, GEO-S014-*, STEER-FIG-*
pass against the live running app (real items.csv), not fixtures alone (EXP-033).

---

## UC-S014-2 — Steer panel (context display + intent note)

### Functional (from use-cases.md AC-1..AC-5)
- F-1: panel opens with the correct item id and job text for a real item (AC-1).
- F-2: all context labels are human-meaningful ("State: planned", "Value: HIGH",
  "Cost: M"); no raw CSV key names visible (no `vc_ratio`, `done_ts`, …) (AC-2).
- F-3: the intent textarea accepts free text; typing causes no reload and no file
  write (AC-3).
- F-4: "Generate prompt" is disabled/hidden until ≥1 character is in the intent
  note (AC-4).
- F-5: Cancel/× closes the panel without generating a prompt; no filesystem write
  (AC-5).

### Accessibility (WCAG 2.2 AA) — ui-designer
- **S14-2-A11Y-1** keyboard open→operate→close: selecting an action by keyboard
  opens the panel; Tab reaches textarea → Generate → Cancel → ×; Esc closes; all
  keyboard-operable. (2.1.1)
- **S14-2-A11Y-2** focus move + return, no trap: on open focus moves into the
  panel; on close (×/Cancel/Esc) focus returns to the SteerMenu trigger that
  opened it; non-modal → Tab can leave the panel (no trap). (2.4.3/2.1.2)
- **S14-2-A11Y-3** visible non-colour-redundant focus + disabled state:
  `:focus-visible` ring (`--focus-ring`, ≥3:1) on textarea + buttons; Generate
  disabled conveyed by `aria-disabled="true"` + non-colour inset, not colour
  alone. (1.4.11/1.4.1)
- **S14-2-A11Y-4** target size ≥ 24×24 CSS px for ×, Cancel, Generate (2.5.8).
- **S14-2-A11Y-5** name/role/state: panel `role="dialog"` NON-MODAL (no
  `aria-modal`) named "Steer: <itemId>"; textarea associated `<label>`; buttons
  named; axe aria-* zero violations on the open panel. (4.1.2)
- **S14-2-A11Y-6** reduced motion: drawer slide-in `--dur-drawer`, 0ms under
  `prefers-reduced-motion: reduce`. (2.3.3)
- **S14-2-A11Y-7** every context field is a programmatically labelled value pair
  (`<dt>`/`<dd>` or `aria-label`) so no value is announced bare. (1.3.1)

### Geometry / no-reflow invariant (EXP-016) — ui-designer
- **GEO-S014-2-1** `value-stream-map` AND `work-item-tree` region bboxes
  byte-identical panel-open vs panel-closed (the drawer floats over, pushes
  nothing).
- **GEO-S014-2-2** `documentElement.scrollHeight` (+ `<main>` + tree-rail
  scrollHeight) identical panel-open vs closed — zero added flow height.
- **GEO-S014-2-3** panel computed `position` is `fixed`, portalled to `body`,
  `z-index` = `--z-drawer` (≥ DetailPane layer).
- **GEO-S014-2-4** open panel bbox within the viewport (no negative left/top,
  right ≤ innerWidth); context-block fields STACK (each `steer-ctx-*` `<dd>` top
  offset increases, shared left) — a labelled list, not a collapsed line.

### Figure / reference legibility — ui-designer
- **S14-2-FIG-1** item id shown WITH its human job sentence ("CHK-5 — <job>");
  never the id alone / `row:N` / positional index; steering action is the human
  label, never the `data-action` enum. (§3)
- **S14-2-FIG-2** visible labels are human words ("State"/"Value"/"Cost"), values
  human forms ("planned"/"HIGH"/"M"); NO raw CSV keys (`vc_ratio`, `done_ts`,
  `started_ts`) appear in the panel. (== F-2.)
- **S14-2-FIG-3** a field with an absent source value renders "—" (unknown), never
  blank / "0" / "null" / "undefined". (§4)
- **S14-2-FIG-4** a stale/unknown item id renders the labelled "Item <id> not
  found" state, never a blank panel or a thrown error.

**Done condition (UC-S014-2):** F-1..F-5 + all S14-2-A11Y-*, GEO-S014-2-*,
S14-2-FIG-* pass against a live item from the running app (EXP-033). The done
condition is the panel + labelled context + guarded Generate — NOT the generated
prompt (UC-S014-3).

---

## UC-S014-3
Acceptance conditions co-authored at the UC-S014-3 STRUCTURE pass (delivered,
e816d30 — prompt-output presentation pinned; copy button + `copy-toast` pinned
ABSENT, flipped by UC-S014-4 below).

---

## UC-S014-4 — Copy to clipboard (toast confirm) + SSE context refresh

### Functional (from use-cases.md AC-1..AC-4)
- F-1: clicking "Copy prompt" when a prompt is displayed places the EXACT prompt
  string on the clipboard (verified via `navigator.clipboard.readText()`) (AC-1).
- F-2: the toast (`data-testid="copy-toast"`) is visible within 2 s of the click
  and dismisses/updates appropriately (AC-2).
- F-3: no file under `work/`/`process/` is modified during the steer interaction;
  the server write-guard returns 405 on POST/PUT/PATCH/DELETE (AC-3).
- F-4: updating items.csv while the panel is open refreshes the CONTEXT block to
  the new state within the SSE window; the prompt output does NOT auto-change
  (operator must click Generate again) (AC-4).

### Accessibility (WCAG 2.2 AA) — ui-designer
- **S14-4-A11Y-1** keyboard copy: Copy button reachable by keyboard (tab order
  after the prompt `<pre>`); activates on Enter AND Space, placing the prompt on
  the clipboard. (2.1.1)
- **S14-4-A11Y-2** success announced politely: copy toast is `role="status"`
  `aria-live="polite"` (announce-once, never `assertive`); "Copied to clipboard"
  text appears on copy. (4.1.3)
- **S14-4-A11Y-3** non-colour-redundant success + state: copy success = toast TEXT
  + button "Copied ✓" label flip (not colour alone); ContextRefreshCue `updated`
  state = text + glyph + band (not colour alone). (1.4.1)
- **S14-4-A11Y-4** visible focus: Copy button `:focus-visible` ring (`--focus-ring`,
  ≥3:1) — non-empty computed outline/box-shadow on focus. (1.4.11)
- **S14-4-A11Y-5** target size: Copy button hit box ≥ 24×24 CSS px (`--target-min`).
  (2.5.8)
- **S14-4-A11Y-6** reduced motion: toast fade `--dur-fast` under no-preference, 0ms
  (instant) under `prefers-reduced-motion: reduce`; no flashing >3×/s — toast
  present same frame as copy under emulated reduce. (2.3.3)
- **S14-4-A11Y-7** toast never traps/steals focus: focus stays on the Copy button
  when the toast appears (`document.activeElement` unchanged). (2.4.3)
- **S14-4-A11Y-8** context refresh announced once: ContextRefreshCue is
  `role="status"` `aria-live="polite"`; a single (debounced) refresh produces one
  announcement, not per-SSE-frame spam. (4.1.3 / EXP-036)

### Geometry / no-reflow invariant (EXP-016) — ui-designer
- **GEO-S014-4-1** toast appearance reflows NOTHING: `steer-panel`, `prompt-output`,
  `value-stream-map`, `work-item-tree` region bboxes + `documentElement.scrollHeight`
  byte-identical toast-shown vs toast-hidden (toast is `position:fixed`/portalled,
  zero flow height). (The explicit "GEO no-reflow on toast appearance" condition.)
- **GEO-S014-4-2** visible toast bbox within the viewport (no negative left/top,
  right ≤ innerWidth, bottom ≤ innerHeight) — never causes scroll.
- **GEO-S014-4-3** Copy button sits in `prompt-output-slot` adjacent to the `<pre>`;
  the `<pre>` retains its `max-height: 40vh` scroll cap (computed maxHeight ≤ 40vh)
  with the button present.
- **GEO-S014-4-4** an SSE refresh re-renders `<dd>` text in place; the context block
  keeps its single-column STACK (each `steer-ctx-*` `<dd>` top increases, shared
  left — GEO-S014-2-4 re-asserted post-refresh).

### Figure / reference legibility — ui-designer
- **S14-4-FIG-1** toast text is a human confirmation ("Copied to clipboard"), never
  a status code / byte count / machine token. (§3)
- **S14-4-FIG-2** ContextRefreshCue text is a human sentence ("Item context: live" /
  "Context updated — regenerate to refresh the prompt"), never a raw timestamp,
  frame id, or SSE event name. (§3 / EXP-036)
- **S14-4-FIG-3** copied bytes === displayed `<pre>` textContent (== PROMPT-COPY-1):
  the operator copies exactly the human-meaningful prompt reviewed. (§3)

### Behavioural / trust conditions (co-owned with engineer) — ui-designer pins
- **PROMPT-COPY-1** (== AC-1): `clipboard.readText()` after Copy === `prompt-output`
  `<pre>` `textContent` === the `prompt` prop / `buildPrompt(...)` return. Assert all
  three equal (jsdom/browser).
- **PROMPT-FREEZE-1** (== AC-4): with a prompt displayed, a simulated SSE
  context-change frame updates the context block but leaves the `prompt-output`
  text byte-identical; only an explicit Generate press changes it (assert prompt
  stable across refresh, then changes after Generate). EXP-036 stale-trust guard.
- **S14-4-SSE-1** (== AC-4 first half): a source-item change while the panel is open
  causes `useSteerContext` to re-fetch (debounced `subscribeEvents`, mirroring
  `useWipItems`) and the context block to show the new value within the SSE window.
- **S14-4-SSE-2** fail-soft: in jsdom (no `EventSource`) the hook falls back to
  static data and does not crash (the `useWipItems` `unsubscribe = null` path).
- **NO-WRITE-1** (== AC-3): the clipboard is the ONLY write surface; no `work/`/
  `process/` file modified; server write-guard returns 405 on writes.

**Pin-flip note:** UC-S014-3 pins the copy button + `copy-toast` ABSENT. UC-S014-4
REPLACES those absent-assertions with the present-assertions above (not a silent
delete) — the engineer updates the UC-S014-3 absent specs in the same commit,
citing the ui-design Pin-flip ledger.

**Done condition (UC-S014-4):** F-1..F-4 + all S14-4-A11Y-*, GEO-S014-4-*,
S14-4-FIG-*, PROMPT-COPY-1, PROMPT-FREEZE-1, S14-4-SSE-1/2, NO-WRITE-1 pass
against the live running app with real data (EXP-033). This is the slice's LAST
UC — its done condition closes CHK-5.
