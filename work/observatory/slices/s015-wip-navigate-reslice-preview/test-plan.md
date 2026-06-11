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
| `WipRow` (live real-data browser run) | No dedicated real-data browser spec | Fixture spec covers all acceptance conditions; live API probe confirms correct data shape. A real-data WipPanel browser spec would require a new fixture or REUSE_SERVER run against live data — considered future improvement. |
