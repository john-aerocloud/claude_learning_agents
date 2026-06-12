---
slice: s013-defects-view
chunk: CHK-8
uc: UC-S013-1, UC-S013-2
produced-by: tester
date: 2026-06-11
sha-under-test: ae7aa28 (UC-S013-2 merge; HEAD b21cffc — Defects surface unchanged)
---

# Test plan — UC-S013-1 + UC-S013-2

## Scope

UC-S013-1 validated (sha 86c12eb, prior session — see result.md UC-S013-1 section).
UC-S013-2 (Defects list panel) is in scope for this pass (sha ae7aa28).
UC-S013-3, UC-S013-4 (drawer, SSE) not yet delivered — out of scope.

## Mid-session deploys

Two further builds landed after ae7aa28 via Vite HMR during this validation:
- UC-S015-2 (steer-on-WIP-rows, a273b02 + b21cffc) — WipRow SteerMenu composition; orthogonal to Defects.
- UC-S014-3 (prompt builder, e816d30) — SteerPanel generation; orthogonal to Defects.

Diff confirms DefectsPanel/DefectRow/useDefects/ViewSwitch/defects routes unchanged
between ae7aa28 and HEAD b21cffc. Identity condition satisfied for the Defects surface.

## Change map

Changed nodes per `work/observatory/architecture/dependencies/component-map.mmd`
(marked `s013changed`):

| Node | Change | Covering spec |
|------|--------|---------------|
| R_DEFECTS | new: HTTP adapter `server/routes/defects.js` | `server/__tests__/defects-api.test.js` (UC-S013-1 prior) |
| LIB_DEFECTS | new: domain aggregator `server/lib/defectsAggregator.js` | `server/__tests__/defects-api.test.js` (UC-S013-1 prior) |
| DefectsViewScreen | new: routed Defects view surface | `e2e/defects-panel.spec.js @covers SPA_DEFECTSPANEL uc-s013-2` |
| DefectsPanel | new: DefectsPanel.jsx grouped list | `e2e/defects-panel.spec.js @covers SPA_DEFECTSPANEL` |
| DefectRow | new: DefectRow.jsx per-defect row | `e2e/defects-panel.spec.js @covers SPA_DEFECTSPANEL` |
| ViewSwitch (extended) | extended: 2 tabs → 3 tabs (Defects added) | `e2e/defects-panel.spec.js @covers SPA_VIEWSWITCH` |

No uncovered changed nodes.

## Impacted specs

### UC-S013-1 (prior validation, sha 86c12eb)

| Spec file | Test suite | Covers |
|-----------|-----------|--------|
| `server/__tests__/defects-api.test.js` | 17 fixture unit tests | R_DEFECTS, LIB_DEFECTS |
| `e2e/s013-defects-api-real-data.spec.js` | 9 live-server browser-context tests | R_DEFECTS, LIB_DEFECTS |

### UC-S013-2 (this validation, sha ae7aa28)

| Spec file | Test suite | Covers |
|-----------|-----------|--------|
| `e2e/defects-panel.spec.js` | 9 fixture browser tests (ephemeral :5203, demo project) | SPA_VIEWSWITCH, SPA_DEFECTSPANEL, SPA_DEFECTSHOOK |
| `e2e/s013-defects-panel-real-data.spec.js` | 12 real-data browser tests (REUSE_SERVER=1, live :5173) | SPA_DEFECTSPANEL, EXP-033 cross-checks |

## Test plan tick-off — UC-S013-1 (prior, sha 86c12eb)

| AC | Description | Status |
|----|-------------|--------|
| AC-S013-1-1 | 200 + application/json + array | PASS |
| AC-S013-1-2 | Array length = 12 (ground-truth; acceptance.md says 10 — data drift) | PASS |
| AC-S013-1-3 | DEFECT-001: status=CLOSED, severity=HIGH | PASS |
| AC-S013-1-4 | DEFECT-001: reported_ts = 2026-06-10T06:17:47Z | PASS |
| AC-S013-1-5 | DEFECT-001: recovered_ts = 2026-06-10T06:31:22Z | PASS |
| AC-S013-1-6 | DEFECT-001: mttr_s in [810,820] = 815 | PASS |
| AC-S013-1-7 | DEFECT-012 (CONFIRMED/open): recovered_ts=null, mttr_s=null | PASS |
| AC-S013-1-8 | ?id=DEFECT-999 returns [] | PASS |
| AC-S013-1-9 | Malformed stub file degrades gracefully; no 5xx | PASS (unit test) |
| EXP-033 DEFECT-011 | Ledger-only record, 667 s MTTR, human title | PASS |
| EXP-033 DEFECT-001 | Human title, fix_sha present | PASS |
| ERROR-SURFACE | Unknown project id → 200 + [], no observatory defects leaked | PASS |
| SCOPING | Array sorted ascending DEFECT-001..DEFECT-012 | PASS |

## Test plan tick-off — UC-S013-2 (this session, sha ae7aa28)

| AC | Description | Status |
|----|-------------|--------|
| AC-S013-2-1 (adapted) | 12 rows rendered (ground-truth; acceptance.md says 10) | PASS |
| AC-S013-2-2 | DEFECT-001: CLOSED badge + HIGH visible | PASS |
| AC-S013-2-3 | DEFECT-001 MTTR has a unit | PASS ("13 min") |
| AC-S013-2-4 | DEFECT-001 MTTR approx 13 min (815 s) | PASS |
| AC-S013-2-5 | Status badges non-colour-redundant (text label visible) | PASS |
| AC-S013-2-6 | CONFIRMED leads CLOSED (DEFECT-012 row y < DEFECT-001 row y) | PASS |
| AC-S013-2-7/GEO-S013-2-1 | VSM absent while Defects active; scrollHeight unchanged | PASS |
| AC-S013-2-8/S13-2-FIG-2 | CONFIRMED MTTR = "open" | PASS |
| S13-2-A11Y-1 | 3-tab keyboard navigation (Arrow cycles all 3 tabs) | PASS |
| S13-2-A11Y-2 | Defects h2 receives focus on switch | PASS |
| S13-2-A11Y-3 | Non-colour-redundant state (text "OPEN" + glyph "?" + data-open attr) | PASS |
| S13-2-A11Y-4 | Tab hit box >= 24x24 px | PASS |
| S13-2-A11Y-5 | axe zero violations on Defects view | PASS |
| S13-2-A11Y-6 | One h2 "Defects"; h3 group headings | PASS |
| S13-2-A11Y-7 | Count line aria-live="polite" | PASS |
| GEO-S013-2-1 (fixture) | Byte-identical VSM bbox after Defects round-trip | PASS (fixture, deterministic data) |
| GEO-S013-2-1 (live) | VSM absent (count=0) while Defects active; scrollHeight unchanged | PASS |
| GEO-S013-2-2 | Rows stack (monotonic tops, shared lefts) | PASS |
| GEO-S013-2-3 | Tree rail bbox unchanged Pipeline vs Defects | PASS |
| GEO-S013-2-4 | Open group leads geometrically (open heading y < closed heading y) | PASS |
| GEO-S013-2-5 | Within-row figures share top band (<=2px tolerance) | PASS |
| S13-2-FIG-1 | MTTR carries a unit ("13 min", not bare integer) | PASS |
| S13-2-FIG-2 | Open MTTR = "open", never "0"/blank/"null" | PASS |
| S13-2-FIG-3 | Human-meaningful references (id + title sentence, no row:N) | PASS |
| S13-2-FIG-4 | DEFECT-011 severity null -> "—" (not blank/defaulted) | PASS |
| S13-2-FIG-5 | Status badge text "OPEN"/"CLOSED" in operator language | PASS |
| S13-2-FIG-6 | Count line "12 defects, 1 open" (labelled, not bare numbers) | PASS |

## Suites run (UC-S013-2)

1. `OBSERVATORY_E2E_PORT=5203 npm --prefix work/observatory/src/app run test:browser -- e2e/defects-panel.spec.js` — 9/9 pass (fixture, demo project)
2. `REUSE_SERVER=1 npm --prefix work/observatory/src/app run test:browser -- e2e/s013-defects-panel-real-data.spec.js` — 12/12 pass (live :5173, observatory, 12 records)

## Note: GEO-S013-2-1 live-data caveat

The byte-identical VSM bbox assertion is validated by the fixture spec (deterministic OBSERVATORY_NOW pinned, no SSE updates). On the live server, the VSM height changes between baseline and re-capture due to SSE-delivered WIP data updates — asserting byte-identical bbox on live data would be a false negative, not a defect. The structural guards (VSM truly absent while Defects active, scrollHeight unchanged) pass on the live server. This is a validation scope note, not a finding.
