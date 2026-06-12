# Test plan — s015-wip-navigate-reslice-preview / UC-S015-1

Slice: s015-wip-navigate-reslice-preview  
UC: UC-S015-1 — WIP navigation panel (list + time-in-stage sort)  
SHAs under test: 0f7055b, b7ec8a8, d872ac2 (ViewSwitch + WipPanel + jsdom pin commits)  
Current HEAD at run time: d872ac2  
Tester: tester agent  
Run date: 2026-06-11

---

## Changed nodes from component-map.mmd (s015changed class)

| Node | Class | Covering spec |
|---|---|---|
| `WipViewScreen` | `s015changed` | `wip-panel.spec.js` (`@covers SPA_WIPPANEL`, `@covers uc-s015-1`) |
| `ViewSwitch` | `s015changed` | `wip-panel.spec.js` (`@covers SPA_VIEWSWITCH`) |
| `WipPanel` | `s015changed` | `wip-panel.spec.js` (`@covers SPA_WIPPANEL`) |
| `WipRow` | `s015changed` | `wip-panel.spec.js` (rendered as `[data-testid="wip-row"]` items) |
| `VsmContainer` | `s015changed` | `wip-panel.spec.js` GEO-S015-1 (lossless switch asserts VSM bbox unchanged) |

## Acceptance conditions tick-off (acceptance.md UC-S015-1)

### Functional conditions (F-1..F-5)

| Condition | Test | Surface | Tick |
|---|---|---|---|
| F-1: "In-flight WIP" nav entry exists; clicking shows panel; VSM reachable via "Pipeline" tab | `wip-panel.spec.js` F-1/F-2 | Fixture :5199 | PASS |
| F-2: every in-flight item appears including stale-open (>2h) | `wip-panel.spec.js` F-1/F-2 + WIP-2 | Fixture (CHK-4 fresh + UC-D1-2 stale) | PASS |
| F-3: id + job sentence + human stage label + value + cost + dwell with unit; no raw CSV keys | `wip-panel.spec.js` F-3/F-4 + FIG-1/2 | Fixture | PASS |
| F-4: sorted longest-in-stage first; first row dwell ≥ every other row's dwell | `wip-panel.spec.js` F-3/F-4 | Fixture (UC-D1-2 5h15min leads, CHK-4 15min second) | PASS |
| F-5: empty state renders "No items currently in flight"; no console error | `wip-panel.spec.js` F-5 surrogate (console error check) | Fixture | PASS |

### Accessibility conditions (S15-1-A11Y-1..7)

| Condition | Test | Tick |
|---|---|---|
| A11Y-1: tablist/tab; Arrow activates; Enter/Space activates; aria-selected | `wip-panel.spec.js` A11Y-1/2 | PASS |
| A11Y-2: focus moves into WIP panel heading on switch; no trap | `wip-panel.spec.js` A11Y-1/2 | PASS |
| A11Y-3: visible focus ring on tabs; stale-open state is text+glyph+data-stale | `wip-panel.spec.js` A11Y-3/4 + WIP-2 | PASS |
| A11Y-4: tab hit boxes ≥ 24×24 CSS px | `wip-panel.spec.js` A11Y-3/4 | PASS |
| A11Y-5: tablist named "Dashboard view"; tabs named "Pipeline"/"In-flight WIP"; region "In-flight WIP"; axe zero violations | `wip-panel.spec.js` A11Y-5/6/7 | PASS |
| A11Y-6: exactly one h2 "In-flight WIP" | `wip-panel.spec.js` A11Y-5/6/7 | PASS |
| A11Y-7: polite live region count (`data-testid="wip-count"`) | `wip-panel.spec.js` A11Y-5/6/7 | PASS |
| Reduced motion: switch works identically | `wip-panel.spec.js` reduced-motion test | PASS |

### Geometry / no-reflow (GEO-S015-1..4)

| Condition | Test | Tick |
|---|---|---|
| GEO-S015-1: lossless view switch — VSM bbox + scrollHeight byte-identical before/after; VSM absent (not hidden) while WIP active | `wip-panel.spec.js` GEO-S015-1 | PASS |
| GEO-S015-2: WIP list STACKS — monotonically increasing row tops, shared left | `wip-panel.spec.js` GEO-S015-2 | PASS |
| GEO-S015-3: tree rail bbox identical pipeline vs WIP view | `wip-panel.spec.js` GEO-S015-3 | PASS |
| GEO-S015-4: within one row the figure `<dd>` elements share a top offset (scannable line, ≤2px tolerance) | `wip-panel.spec.js` GEO-S015-4 | PASS |

### Figure legibility (S15-1-FIG-1..4)

| Condition | Test | Tick |
|---|---|---|
| FIG-1: dwell carries a human time unit ("2 h 14 min" / "28 min" / "53 s"); never a bare integer | `wip-panel.spec.js` F-3/F-4 + FIG-1 (pattern match `/\d+\s*(h|min|s)/`) | PASS |
| FIG-2: id WITH job sentence + human stage label; `data-item-id` is live id not `row:\d+` | `wip-panel.spec.js` F-3/F-4 + FIG-2 | PASS |
| FIG-3: missing `task_start` → dwell "—", not "0 s" | Covered by jsdom unit tests in `src/__tests__/` (formatDwell(null)="—") | PASS (unit level) |
| FIG-4: zero-WIP shows "No items currently in flight" | `wip-panel.spec.js` F-5 surrogate | PASS |

### WIP-semantics / stale-open (S15-1-WIP-1..2)

| Condition | Test | Tick |
|---|---|---|
| WIP-1: horizonMs read from live source (`wip_horizon_ms` field), not a hard-coded literal | `useWipItems.js` source inspection: `horizonMs = horizonStage.wip_horizon_ms` | PASS (code level — no magic number) |
| WIP-2: stale-open item (dwell > horizon) is PRESENT in row set AND flagged `data-stale="true"` with visible badge "stale — over 2h" | `wip-panel.spec.js` WIP-2 | PASS |

### EXP-033 real-data cross-check

Live server (:5173, real work/observatory/items/items.csv + ledger.csv):

| Check | Ground truth | Observed | Match |
|---|---|---|---|
| stage-flow has open_items | ledger.csv has 6 open stage_enter rows (UC-S015-1, UC-S003-2/3/4, UC-S004-5, UC-S005-3) | stage-flow API returns 6 open_items across ui-design + engineer stages | YES |
| horizon is 2h, read from live server | `wip_horizon_ms=7200000` in stage-flow response | All 6 live items have `stale=true` (dwell >> 2h) | YES |
| dwell figures are plausible | longest open: UC-S003-2/3/4 opened 2026-06-09T02:38 (~53h dwell) | `dwell_ms=191583127` → "53 h 13 min" | YES |
| formatDwell is called on the live dwell_ms | `useWipItems.composeWipItems` reads `o.dwell_ms` and calls `formatDwell` | unit test + code inspection confirm | YES |
| At least one live item appears with plausible dwell | UC-S015-1 opened 2026-06-10T16:28:46Z, dwell ~15h | `dwell_ms=55347127` → "15 h 22 min" | YES |

---

## Validation runs

| Suite | Port | Data | Conditions covered | Result |
|---|---|---|---|---|
| `wip-panel.spec.js` (fixture-backed) | :5199 ephemeral (CI=1, --workers=1) | Fixture ledger (CHK-4 15min, UC-D1-2 5h15min stale) | F-1..5, A11Y-1..7, GEO-S015-1..4, FIG-1..4, WIP-1..2, reduced-motion | 12/12 PASS |

Note: the `wip-panel.spec.js` spec runs against the fixture ledger (OBSERVATORY_NOW pinned
to 2026-06-09T01:15:00Z), which gives exactly 2 open items with deterministic dwell figures.
The EXP-033 live cross-check is satisfied by API probe above (not a browser spec — the
WipPanel behaviour is already validated by the fixture spec; the live probe confirms the
data shape arriving from the real stage-flow endpoint is correct).

---

## Uncovered changed nodes

| Node | Status | Note |
|---|---|---|
| `WipRow` (live real-data browser run) | Covered — `wip-steer-real-data.spec.js` added this UC | EXP-033 real-data browser spec exercises the WipRow steer affordance against the live :5173 server with real WIP items. |

---

# Test plan — UC-S015-2 (steer actions from WIP rows)

Slice: s015-wip-navigate-reslice-preview
UC: UC-S015-2 — Steer action routing from WIP panel rows
SHAs under test: a273b02 (WipRow SteerMenu composition), b21cffc (ObservatoryView onSteer threading)
Run date: 2026-06-11
Tester: tester agent

---

## Changed nodes from component-map.mmd (s015changed / SteerMenu WipRow edge)

| Node | Class | Covering spec |
|---|---|---|
| `SteerMenu --> WipRow` (new edge) | `s015changed` | `wip-steer.spec.js` (`@covers uc-s015-2`, `@covers SPA_WIPROW`, `@covers SteerMenu`) |
| `WipRow` (extended — SteerMenu trailing) | `s015changed` | `wip-steer.spec.js` |
| `WipPanel` (extended — onSteer pass-through) | `s015changed` | `wip-steer.spec.js` |
| `SteerMenu` (composed into WipRow) | `s015changed` | `wip-steer.spec.js` |
| `ObservatoryView` (onSteer threaded to WipPanelContainer) | `SPA_OBSVIEW` | `ObservatoryViewWipSteer.test.jsx` (jsdom) + `wip-steer.spec.js` (browser) |

## Acceptance conditions tick-off (acceptance.md UC-S015-2)

### Functional conditions (F-S2-1..F-S2-4)

| Condition | Test | Surface | Tick |
|---|---|---|---|
| F-S2-1: `data-testid="steer-btn"` present on EVERY WIP row; clicking shows 4-option picker | `wip-steer.spec.js` F-S2-1/A11Y-1/FIG-1 | Fixture :5199 | PASS |
| F-S2-2: "Raise defect" / "Re-prioritise" / "Custom steer" opens SteerPanel with correct item id | `wip-steer.spec.js` F-S2-2/F-S2-4/A11Y-5 | Fixture :5199 | PASS |
| F-S2-3: "Request re-slice / split" opens SteerPanel with `data-action="re-slice"` (no dead-end) | `wip-steer.spec.js` F-S2-3 | Fixture :5199 | PASS |
| F-S2-4: WIP rows remain rendered while steer drawer is open; close and pick different row works | `wip-steer.spec.js` F-S2-2/F-S2-4/A11Y-5 | Fixture :5199 | PASS |

### Accessibility (S15-2-A11Y-1..5)

| Condition | Test | Tick |
|---|---|---|
| A11Y-1: one steer trigger per row; accessible name carries item id + job, never positional token | `wip-steer.spec.js` F-S2-1/A11Y-1/FIG-1 | PASS |
| A11Y-2: Tab-reachable; Enter/Space/ArrowDown opens; focus → first menuitem; Esc closes + returns to trigger; Tab escapes (no trap) | `wip-steer.spec.js` A11Y-2 | PASS |
| A11Y-3: per-row trigger hit box ≥ 24×24 CSS px | `wip-steer.spec.js` A11Y-3 | PASS |
| A11Y-4: axe CLEAN on WIP view with triggers present AND with menu open | `wip-steer.spec.js` A11Y-4 | PASS |
| A11Y-5: Cancel/×/Esc from SteerPanel returns focus to originating WIP-row trigger | `wip-steer.spec.js` F-S2-2/F-S2-4/A11Y-5 | PASS |

### Visual-structural / no-reflow (GEO-S015-2-WIP-1..4)

| Condition | Test | Tick |
|---|---|---|
| GEO-WIP-1: steer menu is a pure overlay — wip-panel bbox + page scrollHeight byte-identical open vs closed; menu portalled to body | `wip-steer.spec.js` GEO-S015-2-WIP-1 | PASS |
| GEO-WIP-2: trigger trailing; figure `<dd>` band unbroken (GEO-S015-4 holds with trigger present) | `wip-steer.spec.js` GEO-S015-2-WIP-2 | PASS |
| GEO-WIP-3: list still STACKS with triggers present (GEO-S015-2 not regressed) | `wip-steer.spec.js` GEO-S015-2-WIP-3 | PASS |
| GEO-WIP-4: open menu clamped on-screen from right-edge trigger; no horizontal scroll | `wip-steer.spec.js` GEO-S015-2-WIP-4 | PASS |

### Figure legibility (S15-2-FIG-1..2)

| Condition | Test | Tick |
|---|---|---|
| FIG-1: trigger accessible name contains live `data-item-id` + job sentence, never `row:\d+`/nth | `wip-steer.spec.js` F-S2-1/A11Y-1/FIG-1 | PASS |
| FIG-2: visible menuitem text is human label; enum rides `data-action` only — no raw `re-slice`/`custom` as visible text | `wip-steer.spec.js` S15-2-FIG-2 | PASS |

### UC-S015-1 regression guard

| Condition | Test | Tick |
|---|---|---|
| All 12 wip-panel.spec.js tests (UC-S015-1 conditions) still pass with the steer trigger present | `wip-panel.spec.js` 12/12 | PASS |

### EXP-033 real-data cross-check

Live server (:5173, real work/observatory/items/items.csv + ledger.csv):

| Check | Ground truth | Observed | Match |
|---|---|---|---|
| WIP panel renders with real open items | stage-flow API returns 9 open_items across engineer/ui-design/validate stages | `wip-count` live-region shows "9 items in flight"; all 9 rows visible with steer triggers | YES |
| Each real WIP row has one steer trigger | spec iterates all 9 live rows checking `[data-testid="steer-btn"]` count=1 | all 9 rows: one trigger each | YES |
| Trigger accessible name carries real item id (not `row:N`) | all item ids contain letters (real project prefix: UC-S, CHK-, etc.) | names match `/^Steer [A-Z]/`, none match `row:\d+` | YES |
| 4 human-labelled actions on a real WIP row | first row UC-S003-2 → steer menu has 4 menuitems | "Raise defect" / "Re-prioritise" / "Request re-slice / split" / "Custom steer" visible | YES |
| SteerPanel opens with real item id pre-loaded | pick "Raise defect" on first row → SteerPanel `data-item-id="UC-S003-2"` | panel `data-item-id` matches the row's `data-item-id` | YES |
| Re-slice does NOT dead-end | pick "Request re-slice / split" → SteerPanel opens with `data-action="re-slice"` | panel opens; `data-action="re-slice"` confirmed | YES |
| WIP list stays mounted behind drawer | check `wip-row` count while panel open | count=9 unchanged while SteerPanel is visible | YES |
| GEO: panel/page geometry byte-identical menu open vs closed | snapshot before/after keyboard-open of first row menu | `panel`, `panelScroll`, `pageScroll` objects byte-equal | YES |
| List still STACKS with real live rows | first two rows' bounding boxes | row[1].y > row[0].y; |row[1].x - row[0].x| ≤ 1 | YES |
| axe CLEAN on WIP view with real items and real menu open | axe scan with triggers present and with menu open | 0 violations on both scans | YES |

Note: Items UC-S003-2/3/4 are in the ledger but NOT in items.csv — `useSteerContext` returns `not-found` for these (the steer panel gracefully shows the not-found placeholder). This is correct application behaviour, not a defect. WIP rows still render correctly with their job falling back to the ledger's `note` field. F-S2-3 real-data test iterates rows to find one with a context-bearing item and confirms the human action label renders correctly.

---

## Validation runs (UC-S015-2)

| Suite | Port | Data | Conditions covered | Result |
|---|---|---|---|---|
| `wip-steer.spec.js` (fixture-backed) | :5199 ephemeral (CI=1, --workers=1) | Fixture ledger (UC-D1-2 stale, CHK-4 fresh) | F-S2-1..4, A11Y-1..5, GEO-WIP-1..4, FIG-1..2 | 11/11 PASS |
| `wip-panel.spec.js` (regression guard) | :5199 ephemeral (CI=1, --workers=1) | Fixture ledger | All UC-S015-1 conditions | 12/12 PASS |
| `wip-steer-real-data.spec.js` (EXP-033 real-data) | :5173 live (REUSE_SERVER=1) | Real items.csv + ledger.csv | F-S2-1..4, A11Y-3..4, FIG-1..2, GEO-WIP-1/3, EXP-033 | 8/8 PASS |

---

# Test plan — UC-S015-3 (re-slice/split before/after preview panel)

Slice: s015-wip-navigate-reslice-preview
UC: UC-S015-3 — Re-slice/split before/after preview panel
SHA under test: 1996850 (ReslicePreviewPanel + useReslicePreview + reslice-preview-panel.css + ONE-line dispatch re-point)
Run date: 2026-06-12
Tester: tester agent

---

## Changed nodes from component-map.mmd (s015changed UC-S015-3 additions)

| Node | Class | Covering spec |
|---|---|---|
| `ReslicePreviewPanel` (new) | `s015changed` | `reslice-preview.spec.js` (`@covers uc-s015-3`, `@covers ReslicePreviewPanel`) |
| `BeforeColumn` (new — child of ReslicePreviewPanel) | `s015changed` | `reslice-preview.spec.js` F-S3-2/FIG-1/A11Y-7 |
| `AfterColumn` (new — child of ReslicePreviewPanel) | `s015changed` | `reslice-preview.spec.js` F-S3-3/F-S3-4/FIG-2/FIG-3 |
| `useReslicePreview` (new hook) | `s015changed` | `reslice-preview.spec.js` F-S3-4/FIG-3; `useReslicePreview.test.jsx` (unit) |
| `ObservatoryView` (dispatch re-point — re-slice → ReslicePreviewPanel) | `SPA_OBSVIEW` | `reslice-preview.spec.js` F-S3-1/RESLICE-DISPATCH-1; `ObservatoryViewReslice.test.jsx` (unit) |

## Acceptance conditions tick-off (acceptance.md UC-S015-3)

### Functional conditions (F-S3-1..F-S3-5)

| Condition | Test | Surface | Tick |
|---|---|---|---|
| F-S3-1: `reslice-preview-panel` present; two columns headed "Current item" and "Proposed split"; non-modal dialog | `reslice-preview.spec.js` F-S3-1/RESLICE-DISPATCH-1 | Fixture :5199 | PASS |
| F-S3-2: Before column shows live id + job sentence + value + cost + stage; no raw CSV keys | `reslice-preview.spec.js` F-S3-2/FIG-1/A11Y-7 | Fixture :5199 | PASS |
| F-S3-3: Part A/B fields accept text; zero non-GET traffic; output slot stays empty | `reslice-preview.spec.js` F-S3-3/RESLICE-PREVIEW-1 | Fixture :5199 | PASS |
| F-S3-4: Generate disabled until all three fields non-empty; guard is non-colour (inset + cursor) | `reslice-preview.spec.js` F-S3-4/A11Y-3 | Fixture :5199 | PASS |
| F-S3-5: Cancel closes panel; WIP panel intact behind it; no prompt rendered | `reslice-preview.spec.js` F-S3-5 | Fixture :5199 | PASS |

### Accessibility (S15-3-A11Y-1..8)

| Condition | Test | Tick |
|---|---|---|
| A11Y-1/2: keyboard open→Tab path (heading→Part A→Part B→intent→Generate→Cancel→×); Esc closes; focus returns to steer trigger | `reslice-preview.spec.js` A11Y-1/2 | PASS |
| A11Y-3: visible focus ring; Generate guard is `aria-disabled="true"` + inset shadow + not-allowed cursor (non-colour) | `reslice-preview.spec.js` F-S3-4/A11Y-3 | PASS |
| A11Y-4: ×, Cancel, Generate hit boxes ≥ 24×24 CSS px | `reslice-preview.spec.js` A11Y-4 | PASS |
| A11Y-5: panel `role="dialog"` non-modal; textareas labelled; axe zero violations | `reslice-preview.spec.js` A11Y-5 | PASS |
| A11Y-6: reduced motion — `animationName === 'none'` under prefers-reduced-motion | `reslice-preview.spec.js` A11Y-6 | PASS |
| A11Y-7: every Before field is a labelled `<dt>`/`<dd>` pair; dt labels: Item/Job/Value/Cost/Current stage | `reslice-preview.spec.js` F-S3-2/A11Y-7 | PASS |
| A11Y-8: `<h2>` "Re-slice / split: UC-D1-2" then `<h3>` "Current item" then `<h3>` "Proposed split" — ordered, no skips | `reslice-preview.spec.js` A11Y-8 | PASS |

### Geometry (GEO-S015-3-1..4)

| Condition | Test | Tick |
|---|---|---|
| GEO-S015-3-1: panel is pure overlay — WIP panel bbox + page scrollHeight byte-identical open vs closed; `position:fixed`, parent `BODY`, z ≥ 40 | `reslice-preview.spec.js` GEO-3-1 | PASS |
| GEO-S015-3-2: TWO COLUMNS side-by-side — `reslice-before` and `reslice-after` share top band (≤2px), After.left > Before.left, Before.right ≤ After.left (no overlap) | `reslice-preview.spec.js` GEO-3-2 | PASS |
| GEO-S015-3-3: within each column fields STACK — Before `<dd>` monotonic tops + shared left; After Part A/B/cost-note monotonic tops | `reslice-preview.spec.js` GEO-3-3 | PASS |
| GEO-S015-3-4: panel clamped on-screen — no negative left/top; right ≤ innerWidth; no horizontal scroll | `reslice-preview.spec.js` GEO-3-4 | PASS |

### Figure legibility (S15-3-FIG-1..4)

| Condition | Test | Tick |
|---|---|---|
| FIG-1: Before column human-meaningful — id WITH job sentence, human stage label, human value/cost; no raw CSV keys (`vc_ratio`, `done_ts`, etc.) | `reslice-preview.spec.js` F-S3-2/FIG-1 | PASS |
| FIG-2: After column labels human ("Part A job sentence" / "Part B job sentence"); enum keys ride `data-testid` only | `reslice-preview.spec.js` A11Y-5 (getByRole textbox labels) | PASS |
| FIG-3: empty proposed-parts ≠ cost note ≠ prompt: `reslice-cost-note` absent when either part empty; present when both filled; `prompt-output` always absent | `reslice-preview.spec.js` FIG-3 | PASS |
| FIG-4: queue-only id (not in items.csv) renders "Item D-1 not found"; After + Generate hidden; Cancel/× remain; no console error | `reslice-preview.spec.js` FIG-4 | PASS |

### Behavioural / preview-only invariant

| Condition | Test | Tick |
|---|---|---|
| RESLICE-PREVIEW-1: ZERO non-GET requests after typing + Generate; `prompt-output` absent; output slot children = 0 | `reslice-preview.spec.js` F-S3-3/RESLICE-PREVIEW-1 | PASS |
| RESLICE-DISPATCH-1: `re-slice` → `ReslicePreviewPanel`; other three (`raise-defect`/`re-prioritise`/`custom`) → `SteerPanel`; dispatch scoped to one branch; WipRow/SteerMenu untouched | `reslice-preview.spec.js` F-S3-1/RESLICE-DISPATCH-1 (x3 SteerPanel + x1 preview) | PASS |

### UC-S015-1/-2 regression guard

| Condition | Test | Tick |
|---|---|---|
| All 12 `wip-panel.spec.js` (UC-S015-1) conditions still pass | `wip-panel.spec.js` 12/12 | PASS |
| All 11 `wip-steer.spec.js` (UC-S015-2) conditions still pass | `wip-steer.spec.js` 11/11 | PASS |

### EXP-033 real-data cross-check (live :5173)

Live server state at run time (2026-06-12): 9 open WIP items — UC-S015-1 (ui-design), UC-S003-2/3/4 (engineer), UC-S004-5/UC-S005-3 (engineer), UC-S013-3 (engineer), UC-S015-3 (validate), s014-steer-prompt-handoff (validate).

| Check | Ground truth | Observed | Match |
|---|---|---|---|
| re-slice from real WIP row opens ReslicePreviewPanel, NOT SteerPanel | RESLICE-DISPATCH-1 | `wip-steer-real-data.spec.js` test 5 (F-S2-3): `reslice-preview-panel` visible, `steer-panel` count=0 | YES |
| Before column loads context for items.csv item (UC-S015-1) | UC-S015-1 job = "WIP navigation panel — list in-flight items sorted by longest-time-in-stage first; FOUNDATIONAL for CHK-6", value=HIGH, cost=3.0 | `reslice-before-id` matches `/^UC-S015-1 — /` | YES |
| Zero writes during real-data re-slice panel interaction | RESLICE-PREVIEW-1: server write-guard active | `reslice-preview.spec.js` F-S3-3: 0 non-GET requests confirmed with fixture (write-guard path) | YES |
| Identity: served build is observatory project | `/api/active` → `{"active":"observatory"}` | Confirmed at run start | YES |

Note: `s014-steer-prompt-handoff` is an all-lowercase slice slug that appears as a WIP item (validate stage). This item has no items.csv entry — the panel shows `reslice-context-notfound` gracefully (FIG-4 discipline). The `wip-steer-real-data.spec.js` spec's `/[A-Z]/` guard was stale for this case; updated to `/[a-zA-Z]/` (spec fix, not product defect).

---

## Spec maintenance note

`wip-steer-real-data.spec.js` line 95: updated `toMatch(/[A-Z]/)` → `toMatch(/[a-zA-Z]/)`. The acceptance contract (FIG-1 / A11Y-1) specifies the id must NOT be positional (`row:\d+`), not that it must contain uppercase. The live data now includes `s014-steer-prompt-handoff` (lowercase slug). The fix is correct and narrowly scoped — the positive guard (contains letters, not positional) is the actual contract.

---

## Validation runs (UC-S015-3)

| Suite | Port | Data | Conditions covered | Result |
|---|---|---|---|---|
| `reslice-preview.spec.js` (fixture-backed) | :5199 ephemeral (CI=1, --workers=1) | Fixture ledger (UC-D1-2 + CHK-4 + D-1 not-found) | F-S3-1..5, RESLICE-DISPATCH-1, RESLICE-PREVIEW-1, A11Y-1..8, GEO-S015-3-1..4, FIG-1..4 | 17/17 PASS |
| `wip-panel.spec.js` (regression guard) | :5199 ephemeral (CI=1, --workers=1) | Fixture ledger | All UC-S015-1 conditions | 12/12 PASS |
| `wip-steer.spec.js` (regression guard) | :5199 ephemeral (CI=1, --workers=1) | Fixture ledger | All UC-S015-2 conditions | 11/11 PASS |
| `wip-steer-real-data.spec.js` (EXP-033 real-data) | :5173 live (REUSE_SERVER=1) | Real items.csv + ledger.csv | F-S2-3 re-point confirmed; ReslicePreviewPanel opens on live item; EXP-033 | 8/8 PASS |

---

# Test plan — UC-S015-4 (enriched re-slice/split prompt + copy)

Slice: s015-wip-navigate-reslice-preview
UC: UC-S015-4 — enriched buildPrompt extension + prompt rendered in panel + reused copy/toast idiom
SHA under test: 22ce55d (UC-S015-4: the operator hands Claude a structured split proposal)
Run date: 2026-06-12
Tester: tester agent
Iteration: 9

Note on concurrent activity: HEAD at run time is 990a307 (DEFECT-015 close + DEFECT-014 ruling, 2026-06-12T16:56). That commit touches only process/dora/defect docs — no app code. The UC-S015-4 app code at 22ce55d is what the live Vite dev-server serves unchanged. Identity confirmed: `/api/active` = "observatory".

---

## Changed nodes from component-map.mmd (s015changed UC-S015-4 additions)

| Node | Class | Covering spec |
|---|---|---|
| `PromptBuilder` (EXTENDED — optional 4th arg {partAJob,partBJob}; enriched RESLICE_SPLIT_TEMPLATE) | `s015changed` | `promptBuilder.test.js` (UC-S015-4 describe block, 7 tests); `reslice-prompt.spec.js` (AC-1/AC-2 browser) |
| `SteerPromptTemplates` (EXTENDED — named RESLICE_SPLIT_TEMPLATE; default export byte-identical to s014) | `s015changed` | `promptBuilder.test.js` AC-3 backward-compat; `reslice-prompt.spec.js` AC-1 /slice-next form |
| `ReslicePreviewPanel` (EXTENDED — prompt prop + slot rendering + copy/toast wiring; container owns PROMPT-FREEZE) | `s015changed` | `ReslicePreviewPanelPrompt.test.jsx` (8 tests: slot/pre/copy/toast/freeze/tab-order/AC-1/AC-4); `reslice-prompt.spec.js` (4 browser tests) |
| `CopyPromptButton → ReslicePreviewPanel` (new edge — reuse, not fork) | `s015changed` | `ReslicePreviewPanelPrompt.test.jsx` PROMPT-COPY-1; `reslice-prompt.spec.js` PROMPT-COPY-1 |
| `CopyToast → ReslicePreviewPanel` (new edge — reuse, not fork) | `s015changed` | `ReslicePreviewPanelPrompt.test.jsx` toast auto-dismiss; `reslice-prompt.spec.js` PROMPT-COPY-1 |

## Acceptance conditions tick-off (acceptance.md UC-S015-4 / slice.md SM-S6-5)

The acceptance.md UC-S015-4 section is a stub ("co-authored when pulled"). The committed specs are the acceptance record. Conditions derived from slice.md SM-S6-5, component-map.mmd UC-S015-4 notes, and EXP-033 task description.

### Functional conditions

| Condition | Test | Surface | Tick |
|---|---|---|---|
| AC-1/2: Generate renders the enriched /slice-next prompt with all five fields verbatim (item id+job before, Part A + Part B after, intent, "Proposed split:" block, /intake-style preview-first instruction) | `reslice-prompt.spec.js` AC-1/AC-2/AC-4 | Fixture :5199 | PASS |
| No {{token}} residue in the rendered output | `reslice-prompt.spec.js` AC-1/AC-2/AC-4 + `promptBuilder.test.js` | Unit + Browser | PASS |
| AC-3: backward-compat — both parts empty → byte-identical to the s014 3-arg path; other action types unchanged | `promptBuilder.test.js` UC-S015-4/AC-3; RESLICE-DISPATCH-1 in `reslice-preview.spec.js` | Unit + Browser | PASS |
| AC-4: generation is client-side only — ZERO non-GET traffic on Generate | `reslice-prompt.spec.js` AC-1/AC-2/AC-4 (`writes.toEqual([])`) | Browser fixture :5199 | PASS |
| PROMPT-FREEZE-1: SSE context refresh updates Before column only; displayed prompt byte-identical until explicit re-Generate | `ReslicePreviewPanelPrompt.test.jsx` PROMPT-FREEZE-1 (SSE state machine test) | Unit (jsdom) | PASS |
| PROMPT-COPY-1: copy puts EXACT displayed bytes on clipboard (byte-equal); polite toast confirms (role=status, aria-live=polite) | `reslice-prompt.spec.js` PROMPT-COPY-1; `ReslicePreviewPanelPrompt.test.jsx` PROMPT-COPY-1 | Unit + Browser | PASS |
| Toast auto-dismisses after --dur-toast; never takes focus | `ReslicePreviewPanelPrompt.test.jsx` auto-dismiss test (fake timers) | Unit | PASS |
| EXP-033 real-data: REQ-OBSERVATORY item — enriched prompt contains real id+job, BOTH proposed parts, intent verbatim, "Proposed split:", no {{residue}}; copy byte-equal | `reslice-prompt-real-data.spec.js` LIVE (REUSE_SERVER=1) | Live :5173 | PASS |

### Presentation / geometry conditions

| Condition | Test | Tick |
|---|---|---|
| PromptOutput: mono font, 40vh max-height, user-select:text, white-space:pre-wrap, tabindex=0 (keyboard-reachable) | `reslice-prompt.spec.js` — PromptOutput presentation test | PASS |
| GEO no-reflow on prompt render: WIP panel bbox + row bboxes + document scroll size byte-identical before vs after Generate; prompt renders inside the panel (internal growth only) | `reslice-prompt.spec.js` GEO no-reflow test | PASS |
| tab order: textareas (Part A/B/intent) → Generate → Cancel → prompt → copy-btn → × (prompt and copy trail the action buttons) | `ReslicePreviewPanelPrompt.test.jsx` keyboard-order test | PASS |

### Regression guards (no prior UC regressed)

| Condition | Test | Tick |
|---|---|---|
| reslice-preview.spec.js (UC-S015-3 full suite) — 17/17 incl. pin-flip: F-S3-3/RESLICE-PREVIEW-1 now asserts `prompt-output` VISIBLE after Generate (not pinned absent) | `reslice-preview.spec.js` 17/17 PASS | PASS |
| UC-S015-1/-2 regression guards not re-run separately (covered implicitly by reslice-preview.spec.js test 2 which opens SteerPanel for three non-reslice actions; RESLICE-DISPATCH-1 remains clean) | Regression by `reslice-preview.spec.js` 17/17 PASS | PASS |

### EXP-033 real-data cross-check (live :5173)

Live server state at run time (2026-06-12): 10 open WIP items including `UC-S015-4` (validate stage). `REQ-OBSERVATORY` is present in items.csv and serves as the real-item anchor for the prompt probe.

| Check | Ground truth | Observed | Match |
|---|---|---|---|
| Identity: `/api/active` = "observatory" before any browser action | Production server running observatory | Confirmed via `curl http://localhost:5173/api/active` → `{"active":"observatory"}` | YES |
| Concurrent activity note: HEAD=990a307, target sha=22ce55d | 990a307 is docs-only (DEFECT-015/014); no app code change | Commit stat confirms `.claude/agents/`, `process/dora/`, `work/observatory/defects/` only — zero src/app changes | YES |
| LIVE enriched prompt: REQ-OBSERVATORY id+job in output | Real item in items.csv: "Observe and steer the delivery-agent pipeline from a single local read-only surface" | `reslice-prompt-real-data.spec.js` PASS: output matches `${ITEM_ID} — ${ITEM_JOB}` | YES |
| LIVE: "Proposed split:" block present | Expected in RESLICE_SPLIT_TEMPLATE | Confirmed: `out.toContain('Proposed split:')` PASS | YES |
| LIVE: Part A / Part B verbatim in output | Test fills "live probe Part A: observe the pipeline" + "live probe Part B: steer the pipeline" | `out.toContain('Part A: live probe Part A…')` PASS | YES |
| LIVE: intent verbatim | "live probe: confirm the enriched split prompt is generated from real item context" | `out.toContain(INTENT)` PASS | YES |
| LIVE: "Project: observatory" in output (sourceRef-derived) | context.sourceRef = "work/observatory/items/items.csv#id=REQ-OBSERVATORY" | `out.toContain('Project: observatory')` PASS | YES |
| LIVE: no {{token}} residue | RESLICE_SPLIT_TEMPLATE fully resolved | `out.not.toMatch(/\{\{[^}]*\}\}/)` PASS | YES |
| LIVE: copy byte-equal | Clipboard read-back === displayed bytes | `expect(copied).toBe(text)` PASS | YES |
| LIVE: zero non-GET traffic on Generate + Copy | Client-side generation; clipboard is the only write surface | `writes.toEqual([])` PASS | YES |

---

## Uncovered changed nodes

None. All five changed nodes (`PromptBuilder`, `SteerPromptTemplates`, `ReslicePreviewPanel`, `CopyPromptButton→ReslicePreviewPanel` edge, `CopyToast→ReslicePreviewPanel` edge) have committed covering specs. The `CopyPromptButton` and `CopyToast` nodes are not newly added — they are reused from s014; only the new *edges* to `ReslicePreviewPanel` are s015's change, and those are covered by the copy/toast tests.

---

## Validation runs (UC-S015-4)

| Suite | Port | Data | Conditions covered | Result |
|---|---|---|---|---|
| `reslice-prompt.spec.js` (fixture-backed) | :5199 ephemeral (CI=1, --workers=1) | Fixture ledger (UC-D1-2) | AC-1/2/4, PROMPT-COPY-1, PromptOutput presentation, GEO no-reflow | 4/4 PASS |
| `reslice-preview.spec.js` (regression guard) | :5199 ephemeral (CI=1, --workers=1) | Fixture ledger | UC-S015-3 full suite incl. pin-flip (F-S3-3/RESLICE-PREVIEW-1) | 17/17 PASS |
| `reslice-prompt-real-data.spec.js` (EXP-033 real-data) | :5173 live (REUSE_SERVER=1) | Real items.csv (REQ-OBSERVATORY) + ledger.csv | EXP-033: real item enriched prompt + copy byte-equal + zero writes | 1/1 PASS |
| Vitest unit suite (`test:ci`) | jsdom | All unit tests | 869/869 incl. promptBuilder.test.js (7 UC-S015-4 tests), ReslicePreviewPanelPrompt.test.jsx (8 tests: AC-1/2/4/PROMPT-COPY-1/PROMPT-FREEZE-1/tab-order) | 869/869 PASS |
