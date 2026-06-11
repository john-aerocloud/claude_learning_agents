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
