# Validation result — UC-S015-1 (s015-wip-navigate-reslice-preview)

**Verdict: PASS**

UC: UC-S015-1 — WIP navigation panel (list + time-in-stage sort)  
SHAs: 0f7055b (ViewSwitch + WipPanel components), b7ec8a8 (WipPanel final components), d872ac2 (jsdom pin)  
Live server: http://localhost:5173 (probe 200; active project: observatory)  
Run date: 2026-06-11

---

## Summary

All acceptance conditions for UC-S015-1 pass. Validated via:
1. The committed `wip-panel.spec.js` (12/12 pass) against the ephemeral fixture server
   (:5199), which exercises the full acceptance surface with deterministic fixture data.
2. A live API probe against the production :5173 server confirming real open_items with
   plausible dwell figures (EXP-033 cross-check).

---

## Evidence

### wip-panel.spec.js fixture run — 12/12 PASS

Run: `OBSERVATORY_E2E_PORT=5199 CI=1 npm --prefix work/observatory/src/app run test:browser -- e2e/wip-panel.spec.js --reporter=list --workers=1`

Fixture data:
- CHK-4: engineer `task_start` 01:00Z, no end → dwell = 15 min (fresh, `isStale=false`)
- UC-D1-2: tester `task_start` 2026-06-08T20:00Z (FIX-16), no end → dwell = 5 h 15 min
  (`OBSERVATORY_NOW=2026-06-09T01:15:00Z`) → OLDER than 2h horizon → `isStale=true`

Sorted longest-in-stage first: UC-D1-2 leads (5 h 15 min), CHK-4 second (15 min).

| Test | Result |
|---|---|
| F-1/F-2 — nav entry shows panel + stale item included; 1 click each way | PASS |
| WIP-2 — stale item present, flagged data-stale="true", badge "stale — over 2h", LEADS the list | PASS |
| F-3/F-4 + FIG-1/2 — job sentence + human stage label + value + cost + unit-bearing dwell; longest first | PASS |
| GEO-S015-1 — lossless switch: VSM bbox + scrollHeight byte-identical; VSM absent (count=0) while WIP active | PASS |
| GEO-S015-2 — WIP list STACKS: row B top > row A top; shared left offset | PASS |
| GEO-S015-3 — tree rail bbox identical pipeline vs WIP view | PASS |
| GEO-S015-4 — figure `<dd>`s share top offset within 2px (one scannable line) | PASS |
| A11Y-1/2 — roving tabindex; ArrowRight moves focus; Enter activates; focus lands on h2 | PASS |
| A11Y-3/4 — visible focus ring on tab (non-empty box-shadow); tab hit boxes ≥ 24×24 px | PASS |
| A11Y-5/6/7 — axe zero violations on WIP view; exactly one h2 "In-flight WIP"; polite live-region "2 items in flight" | PASS |
| reduced-motion — switch works identically under prefers-reduced-motion: reduce | PASS |
| F-5 surrogate — zero console errors during two full view-switch cycles | PASS |

### EXP-033 real-data cross-check (live :5173)

Live `GET /api/projects/observatory/stage-flow` response:
- `wip_horizon_ms = 7200000` (2h, read server-side from the same constant useWipItems reads)
- 6 open_items across ui-design and engineer stages, all stale (dwell >> 2h):

| item_id | stage | dwell_ms | Formatted | stale |
|---|---|---|---|---|
| UC-S015-1 | ui-design | 55,347,127 | "15 h 22 min" | true |
| UC-S003-2 | engineer | 191,583,127 | "53 h 13 min" | true |
| UC-S003-3 | engineer | 191,583,127 | "53 h 13 min" | true |
| UC-S003-4 | engineer | 191,583,127 | "53 h 13 min" | true |
| UC-S004-5 | engineer | 64,721,127 | "17 h 58 min" | true |
| UC-S005-3 | engineer | 73,172,127 | "20 h 19 min" | true |

EXP-033 verdict: at least one item (UC-S015-1) appears with a plausible dwell figure
(15h 22min since the ui-designer `stage_enter` row at 2026-06-10T16:28:46Z). The live
`formatDwell` function (from `useWipItems.js`) would render this correctly as "15 h 22 min".

The `useWipItems.composeWipItems` function reads `o.dwell_ms` and `o.stale` directly from
the stage-flow response, which is confirmed correct by the API probe. The WipPanel would
show all 6 items sorted by dwell descending with stale badges.

### WIP-1 (S15-1-WIP-1) source check

`useWipItems.js` line 67-68:
```
const horizonStage = stages.find((s) => s && Number.isFinite(s.wip_horizon_ms));
const horizonMs = horizonStage ? horizonStage.wip_horizon_ms : null;
```

No hard-coded literal. `horizonMs` is derived entirely from the server response.
The `isStale` computation at line 96: `dwellMs !== null && horizonMs !== null && dwellMs > horizonMs`.
Both are from the server — S15-1-WIP-1 satisfied.

---

# Validation result — UC-S015-2 (s015-wip-navigate-reslice-preview)

**Verdict: PASS**

UC: UC-S015-2 — Steer action routing from WIP panel rows
SHAs: a273b02 (WipRow SteerMenu trailing composition), b21cffc (ObservatoryView onSteer threading)
Live server: http://localhost:5173 (active project: observatory; 9 live WIP rows)
Run date: 2026-06-11

---

## Summary

All acceptance conditions for UC-S015-2 pass. Validated via:
1. The committed `wip-steer.spec.js` (11/11 pass) against the ephemeral fixture server (:5199) — exercises all acceptance conditions with deterministic fixture data (UC-D1-2 stale leads, CHK-4 fresh second).
2. The committed `wip-panel.spec.js` (12/12 pass) as the UC-S015-1 regression guard — confirms no prior conditions were regressed by the steer trigger composition.
3. The new committed `wip-steer-real-data.spec.js` (8/8 pass) against the production :5173 server — EXP-033 real-data cross-check with 9 live WIP rows.

---

## Evidence

### wip-steer.spec.js fixture run — 11/11 PASS

Run: `OBSERVATORY_E2E_PORT=5199 CI=1 npm --prefix work/observatory/src/app run test:browser -- e2e/wip-steer.spec.js --reporter=list --workers=1`

Fixture data: UC-D1-2 (stale, 5h15min, leads), CHK-4 (fresh, 15min, second row).

| Test | Result |
|---|---|
| F-S2-1 / A11Y-1 / FIG-1 — EXACTLY one trigger per row; name = "Steer \<id\> — \<job\>"; never positional | PASS |
| S15-2-FIG-2 — four human labels visible; enum only in data-action | PASS |
| S15-2-A11Y-2 — Tab-reachable; Enter opens → first menuitem; Esc returns focus to trigger; Tab escapes | PASS |
| S15-2-A11Y-3 — trigger hit box ≥ 24×24 CSS px for both rows | PASS |
| S15-2-A11Y-4 — axe CLEAN with triggers present AND with menu open (0 violations each) | PASS |
| F-S2-2 / F-S2-4 / A11Y-5 — action opens SteerPanel pre-loaded (CHK-4); WIP list stays mounted (count=2); Cancel returns focus to CHK-4 trigger; then steer a different row (UC-D1-2 Custom steer) | PASS |
| F-S2-3 — "Request re-slice / split" on UC-D1-2 → SteerPanel `data-action="re-slice"` → `steer-ctx-action` = "Request re-slice / split" (no dead-end; UC-S014-3 prompt builder live) | PASS |
| GEO-WIP-1 — panel bbox + panelScroll + pageScroll byte-identical open vs closed; `steer-menu.parentElement === body`, `insidePanel=false`, `position=fixed` | PASS |
| GEO-WIP-2 — trigger trailing (btn.x > max dd.x); figure band unbroken (dd tops within 2px) for both rows | PASS |
| GEO-WIP-3 — list STACKS: row B top > row A top; |B.x − A.x| ≤ 1 | PASS |
| GEO-WIP-4 — open menu clamped on-screen: box fully within 1440×900 viewport; no horizontal scroll | PASS |

### wip-panel.spec.js regression guard — 12/12 PASS

All UC-S015-1 conditions (F-1..5, A11Y-1..7, GEO-S015-1..4, FIG-1..4, WIP-1..2, reduced-motion) pass unchanged. No regression introduced by the steer trigger composition.

### wip-steer-real-data.spec.js EXP-033 real-data run — 8/8 PASS

Run: `OBSERVATORY_E2E_PORT=5173 REUSE_SERVER=1 npm --prefix work/observatory/src/app run test:browser -- e2e/wip-steer-real-data.spec.js --reporter=list --workers=1`

Live server :5173 state at run time:
- 9 open WIP items: UC-S003-2/3/4 (engineer, stale, 56h+), UC-S005-3/UC-S004-5 (engineer, stale), UC-S015-1 (ui-design, stale, 18h+), UC-S015-2/UC-S013-3/UC-S014-4 (validate/ui-design, fresh)
- `wip_horizon_ms = 7200000` (2h, live)
- 9 rows rendered in WIP panel, sorted longest-in-stage first

| Test | Result |
|---|---|
| EXP-033 — 9 real WIP rows visible; all triggers named "Steer \<realId\> — \<job\>"; none match `row:\d+` | PASS |
| F-S2-1 / A11Y-3 — every live row: 1 trigger; hit box ≥ 24×24 px for all 9 rows | PASS |
| S15-2-FIG-2 — first row's menu: 4 human labels; enum only in data-action | PASS |
| F-S2-2 — pick "Raise defect" on first row (UC-S003-2) → SteerPanel `data-item-id="UC-S003-2"`, `data-action="raise-defect"`; WIP list count=9 unchanged | PASS |
| F-S2-3 — pick "Request re-slice / split" on first row → SteerPanel `data-action="re-slice"`, no dead-end (UC-S003-2 is ledger-only so context is not-found — correct graceful degradation; panel opens with correct attributes) | PASS |
| S15-2-A11Y-4 — axe 0 violations with triggers present AND with first row's menu open | PASS |
| GEO-WIP-1 — panel bbox + scrollHeights byte-identical keyboard-open vs closed; menu portalled to body | PASS |
| GEO-WIP-3 — first two rows STACK: row[1].y > row[0].y; |x delta| ≤ 1 | PASS |

### Observations

1. Items UC-S003-2, UC-S003-3, UC-S003-4 appear in the ledger as open stage_enter rows but are NOT in `items.csv`. The WipPanel renders them correctly (job falls back to the open item's note field), but `useSteerContext` returns `not-found` for these items — the SteerPanel shows the not-found placeholder rather than the full context block. This is correct application behaviour: the panel degrades gracefully, the action still routes and `data-action` is correct, no dead-end. F-S2-3's real-data assertion covers this.

2. Identity on :5173 confirmed via API response (`/api/active` → `"observatory"`, stage-flow returns horizon 7200000ms matching the committed constant) and live Vite HMR dev server (no build sha in HTML — expected for dev-server topology).

---

### ViewSwitch: "In-flight WIP" tab replaces the VSM (F-1 / GEO-S015-1)

The GEO-S015-1 test confirms:
- VSM bbox before switch: `{x: ..., y: ..., w: ..., h: ...}`
- After `view-tab-wip` click: `getByTestId('value-stream-map').count()` = 0 (genuinely unmounted)
- After `view-tab-pipeline` click: VSM bbox = byte-identical to before
- Tree rail (data-testid="work-item-tree") bbox: identical pipeline vs WIP view (GEO-S015-3)

### Stale-open guard (S15-1-WIP-2 / DEFECT-011 regression)

The `wip-panel.spec.js` WIP-2 test:
- Fixture VSM shows `data-wip="0"` on `stage-validate` (recency: UC-D1-2 is old, excluded)
- WIP panel shows UC-D1-2 FIRST (5h15min dwell, stale), with `data-stale="true"`,
  badge containing "stale — over 2h", glyph `⏳` (aria-hidden)
- CHK-4 second (`data-stale="false"`, no badge)
- This confirms DEFECT-011 regression guard: stale items are never hidden from the WIP panel.

---

## Process notes

No new specs were required to be authored for UC-S015-1 — the committed `wip-panel.spec.js`
was already complete and covered all acceptance conditions. The EXP-033 live cross-check
was conducted via API probe rather than a browser spec (the WipPanel behaviour is fully
covered by the deterministic fixture spec; the live data probe confirms the correct data
shape is being served by the production endpoint).
