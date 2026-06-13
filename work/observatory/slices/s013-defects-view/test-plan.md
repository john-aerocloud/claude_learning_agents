---
slice: s013-defects-view
chunk: CHK-8
uc: UC-S013-1, UC-S013-2, UC-S013-3, UC-S013-4
produced-by: tester
date: 2026-06-13
sha-under-test: 2336a4e (UC-S013-4 final UC)
---

# Test plan — UC-S013-1 + UC-S013-2 + UC-S013-3

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

---

## UC-S013-3 — Defect drill-down + MTTR card (sha c7edf5a)

### Scope

Validates DefectDrillContainer / DefectDetail / MttrCard against:
- Fixture server (OBSERVATORY_E2E_PORT=5203, demo project): all geometry, a11y, open-path, markdown rendering
- Live server (REUSE_SERVER=1, observatory project, :5173): real DEFECT-001 data, DEFECT-011 ledger-only, DEFECT-014 live open, DEFECT-015 zero-MTTR

Mid-session context: DEFECT-014 is CONFIRMED/open (the HMR note said it may land — it did).
DEFECT-015 landed closed same-session with mttr_s=0 (instantaneous repair edge case).
Total live records at validation time: 15 (was 12 at prior UC-S013-2 validation).

### Change map (UC-S013-3 s013changed nodes)

| Node | Change | Covering spec |
|------|--------|---------------|
| DefectDrillContainer | new: floating drawer shell (DEFECT-006 idiom) | `e2e/defect-drill.spec.js @covers SPA_DEFECTDRILL uc-s013-3` |
| DefectDetail | new: labelled record body + markdown rendering | `e2e/defect-drill.spec.js @covers SPA_DEFECTDRILL` |
| MttrCard | new: reported→recovered timeline + MTTR figure | `e2e/defect-drill.spec.js @covers SPA_DEFECTDRILL` |
| DefectRow (activation) | extended: drill slot wired (click + Enter/Space) | `e2e/defect-drill.spec.js @covers SPA_DEFECTDRILL` |

No uncovered changed nodes.

### Impacted specs (UC-S013-3)

| Spec file | Suite | Covers |
|-----------|-------|--------|
| `e2e/defect-drill.spec.js` | 10 fixture browser tests (OBSERVATORY_E2E_PORT=5203, demo project) | SPA_DEFECTDRILL, SPA_MARKDOWNLIB, S13-3-A11Y-1..4+6, GEO-S013-3-1..4, S13-3-FIG-1..7, open-path |
| `e2e/s013-defect-drill-real-data.spec.js` | 7 real-data browser tests (REUSE_SERVER=1, live :5173) | EXP-033, AC-S013-3-2/3/4/5/7/8/9, live open path DEFECT-014, zero-MTTR DEFECT-015 |

### Test plan tick-off — UC-S013-3 (sha c7edf5a)

| AC | Description | Status |
|----|-------------|--------|
| AC-S013-3-1 | Click DEFECT-001 row: drawer opens with data-defect-id continuity | PASS (fixture + real-data) |
| AC-S013-3-2 | Four fields rendered as HTML (no raw **) | PASS (fixture + real-data) |
| AC-S013-3-3 | "Opening the Observatory UI" text in Expected field | PASS (real-data) |
| AC-S013-3-4 | Fix shas "3d8c21c" and "82a622c" as code refs | PASS (real-data) |
| AC-S013-3-5 | MttrCard "13 min" + human timestamps + reported→recovered | PASS (fixture + real-data) |
| AC-S013-3-6 | CONFIRMED defect: MttrCard shows "Not yet resolved" | PASS (fixture DEFECT-003 + live DEFECT-014) |
| AC-S013-3-7 | Null fields render "—"; no crash (DEFECT-011) | PASS (real-data) |
| AC-S013-3-8 | GEO: scrollHeight + panel bbox byte-identical open vs closed | PASS (real-data) |
| AC-S013-3-9 | Close returns focus to the row | PASS (real-data) |
| S13-3-A11Y-1 | Enter opens drawer (keyboard-only) | PASS (fixture) |
| S13-3-A11Y-2 | Focus moves to defect-drill-heading on open | PASS (fixture) |
| S13-3-A11Y-3 | Esc returns focus to originating row; no focus trap | PASS (fixture) |
| S13-3-A11Y-4 | axe zero violations on open drawer | PASS (fixture) |
| S13-3-A11Y-5 | Non-colour-redundant MTTR state ("Not yet resolved" text) | PASS (fixture open path + live DEFECT-014) |
| S13-3-A11Y-6 | Close button ≥ 24×24px; row trigger ≥ 24px tall | PASS (fixture) |
| GEO-S013-3-1 | Drawer is pure overlay: panel + rail + scrollHeight byte-identical | PASS (fixture + real-data) |
| GEO-S013-3-2 | Drawer on-screen, no horizontal scroll | PASS (fixture) |
| GEO-S013-3-3 | Record sections STACK (monotonic tops, shared left) | PASS (fixture) |
| GEO-S013-3-4 | MttrCard timeline: reported top < recovered top (order = meaning) | PASS (fixture) |
| S13-3-FIG-1 | MTTR "13 min" with unit; data-mttr-seconds=815 | PASS (fixture + real-data) |
| S13-3-FIG-2 | Open path: "Not yet resolved"; elapsed "open for …"; not labelled MTTR | PASS (fixture DEFECT-003 + live DEFECT-014) |
| S13-3-FIG-3 | Human timestamps in reported/recovered cells | PASS (fixture + real-data) |
| S13-3-FIG-4 | Fix shas as code refs; null → "—" | PASS (fixture + real-data) |
| S13-3-FIG-5 | Null fields render "—" (DEFECT-011 severity, DEFECT-002 all fields) | PASS (fixture + real-data) |
| S13-3-FIG-6 | Markdown rendered as HTML (no literal **); actual shows real `<strong>` | PASS (fixture + real-data) |
| S13-3-FIG-7 | data-source non-empty on defect-detail + mttr-card | PASS (fixture + real-data) |
| EXP-033 BONUS | Live DEFECT-014 (open): "Not yet resolved", elapsed not labelled MTTR, no crash | PASS (real-data — new live record) |
| EXP-033 BONUS | Live DEFECT-015 (mttr_s=0): no crash, no bare "0", null fields "—" | PASS (real-data — edge case) |
| Open/closed invariant | All 15 live records: open ones never labelled MTTR; closed ones unit-bearing | PASS — 14 CLOSED + 1 CONFIRMED; DEFECT-014 correctly open |

### Suites run (UC-S013-3)

1. `OBSERVATORY_E2E_PORT=5203 npm --prefix work/observatory/src/app run test:browser -- e2e/defect-drill.spec.js` — 10/10 pass (fixture, demo project, ephemeral :5203)
2. `REUSE_SERVER=1 npm --prefix work/observatory/src/app run test:browser -- e2e/s013-defect-drill-real-data.spec.js` — 7/7 pass (live :5173, observatory, 15 records)

---

## UC-S013-4 — SSE live refresh (sha 2336a4e)

### Scope

Validates the SSE live-refresh contract (EXP-036): defect md changes and
ledger recovery rows surface in the live list without manual reload; the open
drill never silently mutates; the ContextRefreshCue (second consumer, additive
testId/wording overrides, steer defaults byte-identical) announces divergence.

### Change map (UC-S013-4 s013changed nodes)

| Node | Change | Covering spec |
|------|--------|---------------|
| UseDefects | extended: debounced subscribeEvents SSE seam (defects/*.md + ledger.csv frames) | `e2e/defects-live.spec.js @covers SPA_DEFECTSHOOK uc-s013-4` |
| ContextRefreshCue | extended: additive testId/texts/labels props (second consumer — defect-drill-cue); steer defaults byte-identical | `src/components/__tests__/ContextRefreshCue.test.jsx` |
| DefectsPanel | extended: DefectsPanelContainer gains activation-snapshot freeze (EXP-036) | `e2e/defects-live.spec.js @covers SPA_DEFECTSPANEL` |
| DefectDrillContainer | extended: refreshState prop + ContextRefreshCue (defect-drill-cue) wired | `e2e/defects-live.spec.js @covers SPA_DEFECTDRILL` |
| SubscribeEvents | referenced: UseDefects --> SubscribeEvents edge added | `src/hooks/__tests__/useDefectsSse.test.jsx` |

Waivers (advisory uncovered nodes from the wide impacted-tests window — structural model nodes with no direct spec contract):
- ObservatoryDrawerLayer, ValueStreamScreen, WipViewScreen, SPA_CLIENT, SPA_VSMCTR: architectural model surface nodes; covered by their constituent component specs
- MetricSourcePanel, MetricSourceSection, StageMetric, InFlightBadge: DEFECT-014 nodes; validated in prior DEFECT-014 pass (ca3826b)
- IntentNote, JobSentenceLib: UC-S014-4 / UC-S018-1 nodes; validated in their own slice sessions
- SteerContextBlock: UC-S014-4 node; covered by steer-copy.spec.js and steer-panel.spec.js

### Impacted specs (UC-S013-4)

| Spec file | Suite | Covers |
|-----------|-------|--------|
| `e2e/defects-live.spec.js` | 2 live-mutation e2e (LIVE_PORT isolated server, repo-live-tmp) | UseDefects SSE, DefectsPanel freeze, DefectDrillContainer cue — AC-S013-4-1/2/3 |
| `src/hooks/__tests__/useDefectsSse.test.jsx` | 8 unit tests | UseDefects SSE re-fetch, debounce, relevant-frame filter, fail-soft |
| `src/components/__tests__/DefectsPanelSse.test.jsx` | 5 unit tests | DefectsPanelContainer list-level refresh + drill freeze discipline |
| `src/components/__tests__/ContextRefreshCue.test.jsx` | 2 new unit tests | Additive override contract; default fallback |

### ContextRefreshCue byte-identical spot-check

Steer consumer (UC-S014-4 existing pins):
- `testId` default = `'steer-context-live'` — UNCHANGED
- `texts.updated` default = `'Context updated — regenerate to refresh the prompt'` — UNCHANGED
- `labels.updated` default = `'Item context: updated — regenerate to refresh the prompt'` — UNCHANGED
- UC-S014-4 pin at steer-copy.spec.js:185 (`[data-testid="steer-context-live"]`) — still resolves

Defect drill consumer (UC-S013-4 additions):
- `testId` override = `'defect-drill-cue'`
- `texts.updated` override = `'Record updated — re-open to refresh'`
- `labels.updated` override = `'Defect record: updated — re-open to refresh'`

The override is ADDITIVE: when props not passed, defaults are byte-identical to the steer consumer's values. Confirmed by `ContextRefreshCue.test.jsx` "per-consumer overrides" suite + visual inspection of DefectDrillContainer.jsx line 90-95.

### Test plan tick-off — UC-S013-4

| AC | Description | Status |
|----|-------------|--------|
| AC-S013-4-1 | Add temp DEFECT-011-temp-sse-probe.md → list count increments (live, no reload) | PASS |
| AC-S013-4-2 | Remove temp file → list count returns to 3 (live, no reload) | PASS |
| AC-S013-4-3 | Drawer open during SSE: stays open, content FROZEN, defect-drill-cue flips to 'updated'; explicit re-open refreshes | PASS |
| EXP-036 discipline | ContextRefreshCue defaults byte-identical; UC-S014-4 pins hold | PASS |
| AC-S013-2-A11Y-7 | Count line aria-live="polite" announces SSE changes | PASS (unit test pins + live-region attr on live server) |
| Unit: SSE re-fetch on defects/*.md frame | useDefects re-fetches on a defects/*.md change frame (AC-S013-4-1 data path) | PASS (useDefectsSse.test.jsx) |
| Unit: SSE re-fetch on ledger.csv frame | useDefects re-fetches on ledger.csv frame (MTTR is a ledger join) | PASS (useDefectsSse.test.jsx) |
| Unit: SSE remove frame shrinks list | AC-S013-4-2 data path | PASS (useDefectsSse.test.jsx) |
| Unit: Irrelevant frames ignored | items.csv / slice.md / null — defects md + ledger only | PASS (useDefectsSse.test.jsx) |
| Unit: Debounce burst | burst of frames → ONE re-fetch (S13-2-A11Y-7 announce-once) | PASS (useDefectsSse.test.jsx) |
| Unit: Drill freeze | drawer stays open; content frozen; cue flips updated | PASS (DefectsPanelSse.test.jsx) |
| Unit: Explicit re-open refreshes | cue returns to live; content updated | PASS (DefectsPanelSse.test.jsx) |
| Unit: Drop-missing-id closes drill | graceful close when SSE drops the selected defect | PASS (DefectsPanelSse.test.jsx) |

### Data drift reconciliation (UC-S013-4 session)

Live data at validation time:
- Total records: **16** (DEFECT-001..016)
- CONFIRMED (open): **0** (DEFECT-014 is now CLOSED; DEFECT-016 is UNCONFIRMED — not CONFIRMED)
- DEFECT-012: CLOSED (recovered_ts=2026-06-11T07:43:41Z, mttr_s=2635)

Stale real-data spec pins updated this session:
1. `s013-defect-drill-real-data.spec.js`: DEFECT-014 open-path test made dynamic (derives from live endpoint; skips gracefully when all CLOSED; open path is fixture-pinned)
2. `s013-defect-drill-real-data.spec.js`: count line test made dynamic (derives total/open from live endpoint)
3. `s013-defects-api-real-data.spec.js`: AC-S013-1-7 made dynamic (derives open defect from live list; validates DEFECT-012 is now correctly CLOSED when no live open exists)
4. `s013-defects-panel-real-data.spec.js`: GEO-S013-2-1 secondary height guard removed (16 defect rows legitimately taller than Pipeline view; primary guard VSM count=0 is the contract; fixture spec covers byte-identical geometry)

### Suites run (UC-S013-4)

1. `OBSERVATORY_E2E_PORT=5203 CI=1 npm --prefix work/observatory/src/app run test:browser -- e2e/defects-live.spec.js --workers=1` — **2/2 pass** (LIVE_PORT isolated server, repo-live-tmp, real Chromium EventSource)
2. `npm --prefix work/observatory/src/app run test:ci` — **895/895 pass** (full vitest unit suite including UC-S013-4 unit tests)
3. `REUSE_SERVER=1 npm --prefix work/observatory/src/app run test:browser -- e2e/s013-defects-api-real-data.spec.js e2e/s013-defects-panel-real-data.spec.js e2e/s013-defect-drill-real-data.spec.js --workers=1` — **26 pass, 2 skip** (live :5173, observatory, 16 records, 0 open; skips are correct: no live CONFIRMED defect and the `!REUSE_SERVER` guard)
4. `OBSERVATORY_E2E_PORT=5203 CI=1 npm --prefix work/observatory/src/app run test:browser -- e2e/defects-panel.spec.js e2e/defect-drill.spec.js --workers=1` — **19/19 pass** (fixture specs, regression baseline)
