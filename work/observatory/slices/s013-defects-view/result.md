---
slice: s013-defects-view
chunk: CHK-8
uc: UC-S013-1, UC-S013-2
produced-by: tester
date: 2026-06-11
sha-under-test: 86c12eb
verdict: PASS
---

# Validation result — UC-S013-1

## Identity check

Server confirmed running at http://localhost:5173 (PID 42725). The live API
responded on the same commit (86c12eb) that introduced
`server/routes/defects.js` + `server/lib/defectsAggregator.js`.

## Surface exercised

- **Backend API (public surface):** `GET /api/projects/observatory/defects` and
  `GET /api/projects/observatory/defects?id=DEFECT-NNN` — exercised via
  committed Playwright spec (`e2e/s013-defects-api-real-data.spec.js`) running
  in a real Chromium browser context against the live :5173 server (REUSE_SERVER=1).
  The browser-level fetch validates that the CSP/transport layer does not block
  the endpoint.
- **Unit/integration layer:** `server/__tests__/defects-api.test.js` (17 tests
  including 3 EXP-033 real-data pins via supertest + REAL_ROOT).
- **Full regression suite:** 538 vitest unit/integration tests, 42 files, 0 failures.

## EXP-033 real-data verification table

| Defect ID | Expected status | Actual status | Expected severity | Actual severity | Expected MTTR (s) | Actual MTTR (s) | Match |
|-----------|----------------|--------------|------------------|-----------------|--------------------|-----------------|-------|
| DEFECT-001 | CLOSED | CLOSED | HIGH | HIGH | ~815 s (~13 min) | 815 s | yes |
| DEFECT-011 | CLOSED (ledger-only) | CLOSED | n/a (no md file) | null | 667 s | 667 s | yes |
| DEFECT-012 (first CONFIRMED) | CONFIRMED | CONFIRMED | n/a | null | null / open | null | yes |

**Ground-truth arithmetic:**
- DEFECT-001: failure 2026-06-10T06:17:47Z → recovery 2026-06-10T06:31:22Z = 815 s. Matches acceptance.md AC-S013-1-6 range [810,820].
- DEFECT-011: failure 2026-06-10T16:16:50Z → recovery 2026-06-10T16:27:57Z = 667 s. Exact match.
- DEFECT-012: failure 2026-06-11T06:59:46Z, no recovery row in ledger. Correctly open.

## Live console output (evidence)

```
[AC-S013-1-1] status=200, content-type=application/json, array=yes
[AC-S013-1-2] count=12, ids=DEFECT-001, DEFECT-002, DEFECT-003, DEFECT-004, DEFECT-005, DEFECT-006, DEFECT-007, DEFECT-008, DEFECT-009, DEFECT-010, DEFECT-011, DEFECT-012
[AC-S013-1-3..6] DEFECT-001: status=CLOSED, severity=HIGH, reported_ts=2026-06-10T06:17:47Z, recovered_ts=2026-06-10T06:31:22Z, mttr_s=815, mttr_units=s
[EXP-033-DEFECT-001] title="UI shows 0 for everything while work is happening", fix_sha="3d8c21c, 82a622c"
[EXP-033-DEFECT-011] status=CLOSED, mttr_s=667, title="WIP recency horizon 30min hides genuinely-running long tasks: product REPLENISH-CHK6 open 15:42Z still running at 16:12+ showed Decompose WIP=0 while engineer showed 1; human-reported via screenshot; 4th WIP-predicate defect (002/009/010 lineage)"
[AC-S013-1-7] DEFECT-012: status=CONFIRMED, reported_ts=2026-06-11T06:59:46Z, recovered_ts=null, mttr_s=null
[AC-S013-1-8] DEFECT-999: status=200, body=[]
[ERROR-SURFACE] nonexistent-project-xyz: status=200, count=0
[SCOPING] first=DEFECT-001, last=DEFECT-012, sorted=yes
```

9 passed, 0 failed (Playwright, Chromium, live :5173).

## Acceptance case results

| AC | Case | Result | Evidence |
|----|------|--------|----------|
| AC-S013-1-1 | 200 + application/json + array | PASS | Console log above |
| AC-S013-1-2 | 12 records (ground-truth; acceptance.md says 10 — data drift, judged against ground truth) | PASS | ids logged: DEFECT-001..012 |
| AC-S013-1-3 | DEFECT-001: status=CLOSED, severity=HIGH | PASS | Console log above |
| AC-S013-1-4 | DEFECT-001: reported_ts = 2026-06-10T06:17:47Z | PASS | Console log above |
| AC-S013-1-5 | DEFECT-001: recovered_ts = 2026-06-10T06:31:22Z | PASS | Console log above |
| AC-S013-1-6 | DEFECT-001: mttr_s = 815 (range [810,820]) | PASS | Console log above |
| AC-S013-1-7 | DEFECT-012 (open): recovered_ts=null, mttr_s=null | PASS | Console log above |
| AC-S013-1-8 | ?id=DEFECT-999 → [] | PASS | Console log above |
| AC-S013-1-9 | Malformed stub → graceful degradation | PASS | Unit test |
| EXP-033 cross-check | DEFECT-011: 667 s MTTR, ledger-only, human title | PASS | Console log above |
| Human-meaningfulness | Titles are sentences; mttr_units="s" field present; no raw row refs | PASS | DEFECT-001 title logged; mttr_units=s confirmed |
| Error surface: unknown ?id | DEFECT-999 → 200 + [] | PASS | Console log above |
| Error surface: unknown project | nonexistent-project-xyz → 200 + [] | PASS | Console log above |
| Scoping: no cross-project bleed | observatory defects not returned for other project id | PASS | count=0 for nonexistent-project-xyz |
| Sort order | DEFECT-001 first, ascending to DEFECT-012 | PASS | first=DEFECT-001, last=DEFECT-012 |

## Additional observations

- **DEFECT-011 is ledger-only** (no `DEFECT-011.md` file exists in `work/observatory/defects/`). The endpoint correctly sources its title from the failure row note and computes its MTTR from the ledger pair. This validates the "union of md files + ledger" contract.
- **DEFECT-012 status** derives from the md file (`confirmed → fix scheduled`); the aggregator normalises this to `CONFIRMED`. The fix is in flight (UC-S013-1 delivered; DEFECT-012 fix is disjoint). No cross-contamination.
- **Record count = 12**, not 10 as stated in acceptance.md. This is the known data drift documented in the task brief (DEFECT-011 and DEFECT-012 were added after acceptance.md was written). The endpoint correctly reports all live records; the acceptance case is adjusted to ground truth.
- **mttr_units="s"** is present on every record, satisfying the human-meaningfulness requirement.

## Summary

- Total rows rendered: 12 (expected: 10 per stale acceptance.md; ground truth = 12 — data drift acknowledged)
- DEFECT-001 four-fields rendered as structured JSON (expected/actual/intent/importance all non-null): yes
- GEO invariant: n/a for UC-S013-1 (backend endpoint only; no UI)
- SSE refresh test: n/a for UC-S013-1

## Verdict (UC-S013-1)

**PASS.** UC-S013-1 (`GET /api/projects/:id/defects`) is validated against the live production server (http://localhost:5173, sha 86c12eb) through the public HTTP surface in a real Chromium browser context. All acceptance cases pass. EXP-033 real-data cross-checks confirmed. UC-S013-1 is done.

---

# Validation result — UC-S013-2 (Defects list panel)

---
sha-under-test: ae7aa28 (HEAD b21cffc — Defects surface unchanged; two orthogonal slices UC-S015-2 + UC-S014-3 landed mid-session via HMR)
verdict: PASS
iteration: 9
---

## Identity check (UC-S013-2)

Live server confirmed running at http://localhost:5173. sha ae7aa28 introduced
DefectsPanel/DefectRow/useDefects/ViewSwitch extension. Subsequent HMR deploys
a273b02/e816d30/b21cffc (UC-S015-2 + UC-S014-3) are orthogonal — zero diff on
Defects surface files between ae7aa28 and HEAD b21cffc. Validated against
current HEAD behaviorally equivalent to ae7aa28 for the Defects surface.

## Open-count ground-truth reconciliation (EXP-033)

Ledger analysis: 14 observatory failure rows and 14 matching recovery rows.
All failure/recovery pairs are matched. DEFECT-012's "open" status does NOT
come from an unmatched ledger pair — it comes from the md file status field
("confirmed → fix scheduled") which normalises to CONFIRMED. A recovery row
exists in the ledger (07:43:41Z, ref=DEFECT-012 — staging buffer fix), but
the md file status wins in the aggregator. This is correct evolution: the
DEFECT-012.md file's status field was written before the fix was applied and
was not updated to CLOSED. Result: the live API reports 1 CONFIRMED (open)
defect — DEFECT-012 — and 11 CLOSED. The panel's "12 defects, 1 open" count
is correct given the current md file state.

INFRA-STALL-3X: ref="INFRA-STALL-3X" — not a DEFECT-NNN ref; the aggregator's
DEFECT_ID_RE does not match it; it does not appear in the defects list. Correct.

UC-S014-2-REWORK: ledger failure at 08:01:29Z, recovery at 10:24:29Z — matched
pair; no DEFECT-NNN ref; not a defect record. Correct.

## EXP-033 real-data verification table (UC-S013-2)

| Defect ID | Expected status | Actual status | Expected severity | Actual severity | Expected MTTR | Actual MTTR display | Match |
|-----------|----------------|--------------|------------------|-----------------|--------------------|------------------------|-------|
| DEFECT-001 | CLOSED | CLOSED | HIGH | HIGH | ~815 s / "13 min" | "13 min" | yes |
| DEFECT-007 | CLOSED | CLOSED | MED | MED | (ledger pair) | unit-bearing | yes |
| DEFECT-011 | CLOSED (ledger-only) | CLOSED | null | null (badge "—") | 667 s / "11 min" | "11 min" | yes |
| DEFECT-012 (CONFIRMED) | CONFIRMED | CONFIRMED | null | null | null / "open" | "open" | yes |

Additional reconciliation:
- Total rows rendered in live panel: **12** (expected: 10 per stale acceptance.md; ground truth = 12)
- DEFECT-012 leads the list (CONFIRMED group first): **yes**
- Open-count in count line: **1** (DEFECT-012 only, md file status = CONFIRMED)
- DEFECT-001 MTTR rendered: "13 min" (815 s)
- DEFECT-011 severity badge: "—" (null severity, ledger-only record)

## Surface exercised

- **Fixture browser spec (`e2e/defects-panel.spec.js`):** 9/9 pass on ephemeral
  server (OBSERVATORY_E2E_PORT=5203, fixture project "demo", deterministic data).
  Covers: GEO-S013-2-1 byte-identical VSM bbox, GEO-S013-2-2/3/4/5, A11Y-1/2/4/5/6/7,
  FIG-1/2/3/4/5, 1-click nav, count line.
- **Real-data browser spec (`e2e/s013-defects-panel-real-data.spec.js`):** 12/12 pass
  on live :5173 (REUSE_SERVER=1, observatory project, 12 defects). NEW spec committed
  this session. Covers: AC-S013-2 count/order, FIG-1/2/3/4/5/6, GEO-S013-2-1 (structural
  guards), GEO-S013-2-2/3/4, A11Y-1/2, axe zero violations.

## Acceptance case evidence (UC-S013-2)

| AC | Case | Result | Evidence |
|----|------|--------|----------|
| AC-S013-2-1 | 12 rows (ground-truth) | PASS | row count=12 (logged) |
| AC-S013-2-2 | DEFECT-001: CLOSED + HIGH visible | PASS | badge text "✓ CLOSED" (logged) |
| AC-S013-2-3 | MTTR has a unit | PASS | "13 min" matches /\d+\s*(h|min|s)/ |
| AC-S013-2-4 | MTTR ≈ 13 min | PASS | "13 min" (815 s = 13.58 min, rounded) |
| AC-S013-2-5 | Status badges non-colour-redundant | PASS | text "OPEN"/"CLOSED" + glyph "⚠"/"✓" in badge |
| AC-S013-2-6 | CONFIRMED leads CLOSED (geometry) | PASS | DEFECT-012 y=241 < DEFECT-001 y=323 |
| AC-S013-2-7/GEO-S013-2-1 | VSM absent while Defects active; scrollHeight unchanged | PASS | count=0 (logged); scrollHeight 1689=1689 |
| AC-S013-2-8/S13-2-FIG-2 | CONFIRMED MTTR = "open" | PASS | DEFECT-012 mttr="open" (logged) |
| S13-2-A11Y-1 | 3-tab keyboard (Arrow reaches Defects) | PASS | fixture + real-data |
| S13-2-A11Y-2 | Defects h2 focused after switch | PASS | fixture + real-data |
| S13-2-A11Y-3 | Non-colour-redundant (text+glyph+data-open) | PASS | fixture |
| S13-2-A11Y-4 | Tab hit box >= 24x24 px | PASS | fixture |
| S13-2-A11Y-5 | axe zero violations | PASS | real-data (logged "0 violations") |
| S13-2-A11Y-6 | One h2 "Defects"; h3 group headings | PASS | real-data |
| S13-2-A11Y-7 | Count line aria-live="polite" | PASS | real-data |
| GEO-S013-2-2 | Rows stack (monotonic tops, shared lefts) | PASS | fixture + real-data |
| GEO-S013-2-3 | Tree rail bbox unchanged | PASS | before={x:12,y:136,w:295,h:1540} = during (logged) |
| GEO-S013-2-4 | Open group geometrically leads | PASS | DEFECT-012 y=241 < DEFECT-001 y=323 (logged) |
| GEO-S013-2-5 | Within-row figures share top band (<=2px) | PASS | fixture |
| S13-2-FIG-1 | MTTR carries a unit | PASS | "13 min" (logged) |
| S13-2-FIG-2 | Open MTTR = "open" | PASS | DEFECT-012 mttr="open" (logged) |
| S13-2-FIG-3 | Human-meaningful references (no row:N) | PASS | title="Decomposed work is invisible between product completion and flow-manager triage" (logged) |
| S13-2-FIG-4 | DEFECT-011 severity null -> "—" | PASS | badge="—" (logged) |
| S13-2-FIG-5 | Status in operator language (OPEN/CLOSED) | PASS | DEFECT-012="⚠ OPEN", DEFECT-001="✓ CLOSED" (logged) |
| S13-2-FIG-6 | Count line "12 defects, 1 open" labelled | PASS | count line: "12 defects, 1 open" (logged) |

## Real-data validation run output (UC-S013-2)

```
[AC-S013-2-count] row count=12
[S13-2-FIG-6] count line: "12 defects, 1 open"
[S13-2-FIG-1] DEFECT-001 mttr="13 min"
[S13-2-FIG-2] DEFECT-012 mttr="open"
[S13-2-FIG-3] DEFECT-012 title="Decomposed work is invisible between product completion and flow-manager triage"
[S13-2-FIG-4] DEFECT-011 severity badge="—"
[S13-2-FIG-5] DEFECT-012 status badge="⚠ OPEN"
[S13-2-FIG-5] DEFECT-001 status badge="✓ CLOSED"
[A11Y-3] DEFECT-011 mttr="11 min"
[GEO-S013-2-1] scrollHeight before=1689 during=1689 after=1689
[GEO-S013-2-4] DEFECT-012 open row y=241.875; DEFECT-001 closed row y=323.875
[GEO-S013-2-3] before={x:12,y:136.875,width:295,height:1540} during={x:12,y:136.875,width:295,height:1540}
[S13-2-A11Y-1/2] keyboard nav + heading focus: PASS
[S13-2-A11Y-5/6/7] axe: 0 violations
12 passed, 0 failed (Playwright, Chromium, live :5173)
```

## Summary (UC-S013-2)

- Total rows rendered: **12** (expected: 10 per stale acceptance.md; ground truth = 12)
- DEFECT-001 MTTR rendered with unit: **yes ("13 min")**
- GEO invariant (VSM absent while Defects active): **yes** (count=0 confirmed)
- GEO invariant (scrollHeight unchanged): **yes** (1689=1689)
- GEO invariant (tree rail unchanged): **yes** (bbox byte-identical before/during)
- GEO invariant (open group geometrically leads): **yes** (y=241 < y=323)
- A11Y: axe zero violations on live Defects view: **yes**
- SSE refresh test: n/a (UC-S013-4, not yet delivered)

## New spec committed

`work/observatory/src/app/e2e/s013-defects-panel-real-data.spec.js` — 12 real-data
assertions against live :5173. Covers EXP-033 cross-checks, FIG-1..6, GEO structural
guards, A11Y keyboard + axe. Relevancy: pinned (re-verify after any DefectsPanel,
useDefects, or DEFECT-012.md status change).

## Verdict (UC-S013-2)

**PASS.** UC-S013-2 (Defects list panel) is validated against the live production
server (http://localhost:5173, sha ae7aa28, Defects surface) through committed
Playwright specs in a real Chromium browser context. All 25 acceptance conditions
(S13-2-A11Y-1..7, GEO-S013-2-1..5, S13-2-FIG-1..6, and core ACs) pass. EXP-033
open-count reconciled: 12 records, 1 open (DEFECT-012 — md file status=CONFIRMED).
The Defects tab is reachable in 1 click, the open defect leads the list, MTTR
renders with units, severity null shows "—", and axe reports zero violations.

---

# Validation result — UC-S013-3 (Defect drill-down + MTTR card)

---
sha-under-test: c7edf5a (spec commits 258fec2/fc50759)
verdict: PASS
iteration: 9
item-id: UC-S013-3
date: 2026-06-12
---

## Identity check (UC-S013-3)

Live server confirmed running at http://localhost:5173. SHA c7edf5a introduced
DefectDrillContainer / DefectDetail / MttrCard. Spec commits 258fec2 (real-data
panel spec rebase) and fc50759 (ReslicePreviewPanel repair, orthogonal) are
post-c7edf5a; the Defects drill surface is unchanged in both.

Mid-session deploys noted: DEFECT-014 (StageNode/MetricSource reshape) was
CONFIRMED/open at validation time; DEFECT-015 was CLOSED with mttr_s=0. Both
appeared mid-session, as the task brief anticipated. Their presence provided
BONUS live coverage of the open-path MttrCard and the zero-MTTR edge case.

## Live data state at validation time

| Record | Status | mttr_s | Notes |
|--------|--------|--------|-------|
| DEFECT-001..010 | CLOSED | 315–1686 s | normal closed rows |
| DEFECT-011 | CLOSED | 667 s | ledger-only, severity=null |
| DEFECT-012 | CLOSED | 2635 s | was CONFIRMED at UC-S013-2; md file status now updated |
| DEFECT-013 | CLOSED | 60 s | coherence detector defect |
| DEFECT-014 | **CONFIRMED** | null | LIVE OPEN — StageNode/MetricSource hover overlap |
| DEFECT-015 | CLOSED | **0 s** | atomic-repair edge case — same-second recovery |

Total: 15 records, 1 open (DEFECT-014). This supersedes the prior "12 records, 1 open" count.

## EXP-033 real-data verification table (UC-S013-3)

| Defect ID | Expected status | Actual status | Expected severity | Actual severity | Expected MTTR | Actual MTTR display | Match |
|-----------|----------------|--------------|------------------|-----------------|--------------------|------------------------|-------|
| DEFECT-001 | CLOSED | CLOSED | HIGH | HIGH | ~815 s / "13 min" | "13 min" | yes |
| DEFECT-011 | CLOSED (ledger-only) | CLOSED | null | null (severity "—") | 667 s | resolved; severity "—" | yes |
| DEFECT-014 (first CONFIRMED) | CONFIRMED | CONFIRMED | null | null | null / open path | "Not yet resolved" + "open for …" | yes |

Additional EXP-033 cross-checks:
- DEFECT-001 Expected field: contains "Opening the Observatory UI" — yes
- DEFECT-001 fix shas: "3d8c21c" and "82a622c" as `<code>` refs — yes
- DEFECT-001 MttrCard: data-mttr-seconds=815, "13 min", timestamps "2026-06-10 06:17:47 UTC" / "2026-06-10 06:31:22 UTC" — yes
- DEFECT-011 provenance: data-source="process/dora/ledger.csv#ref=DEFECT-011" — yes
- DEFECT-014 open path: data-mttr-state="open", "Not yet resolved" in recovered slot, elapsed-figure NOT labelled "MTTR" — yes
- DEFECT-015 (mttr_s=0): no crash, no bare "0" in MTTR figure, severity "—" — yes
- Open/closed label: no "open for…"/"Not yet resolved" ever appears labelled "MTTR" — yes (verified across all 15 records via test assertions and manual browse)

## Surface exercised

- **Fixture browser spec (`e2e/defect-drill.spec.js`):** 10/10 pass on ephemeral
  server (OBSERVATORY_E2E_PORT=5203, fixture project "demo", deterministic data).
  Covers: GEO-S013-3-1 pure-overlay no-reflow, GEO-S013-3-2 on-screen anchor,
  GEO-S013-3-3 record sections STACK, GEO-S013-3-4 MttrCard timeline order,
  S13-3-A11Y-1/2/3 keyboard (Enter open, heading focus, Esc return, non-modal),
  S13-3-A11Y-4/6 axe zero violations + target sizes ≥ 24px,
  S13-3-FIG-1 unit-bearing MTTR, S13-3-FIG-2 open path "Not yet resolved",
  S13-3-FIG-3 human timestamps, S13-3-FIG-4 fix shas as code refs,
  S13-3-FIG-5 null fields "—" (DEFECT-002 all-null), S13-3-FIG-6 markdown as HTML,
  S13-3-FIG-7 data-source provenance.

- **Real-data browser spec (`e2e/s013-defect-drill-real-data.spec.js`):** 7/7 pass
  on live :5173 (REUSE_SERVER=1, observatory project, 15 defects). Extended this
  session with 3 new tests (DEFECT-014 live open path, DEFECT-015 zero-MTTR, count
  line 15/1 open). Covers: AC-S013-3-2/3/4/5/7/8/9, EXP-033, live open path.

## Acceptance case evidence (UC-S013-3)

| AC | Case | Result | Evidence |
|----|------|--------|----------|
| AC-S013-3-1 | drawer opens; data-defect-id continuity | PASS | fixture test 1; real-data test 1 |
| AC-S013-3-2 | Four fields as HTML (no raw **) | PASS | actual contains `<strong>` "0 for everything"; no `**` in drawer text |
| AC-S013-3-3 | "Opening the Observatory UI" in Expected | PASS | real-data test 1; locator [data-field="expected"] contains text |
| AC-S013-3-4 | Fix shas "3d8c21c" + "82a622c" as code refs | PASS | two `<code data-testid="defect-fix-sha">` nodes; both texts verified |
| AC-S013-3-5 | MttrCard "13 min" + human timestamps | PASS | mttr-figure="13 min", data-mttr-seconds=815; mttr-reported="2026-06-10 06:17:47 UTC", mttr-recovered="2026-06-10 06:31:22 UTC" |
| AC-S013-3-6 | CONFIRMED: "Not yet resolved" | PASS | fixture DEFECT-003 + live DEFECT-014: mttr-recovered="Not yet resolved", data-mttr-state="open" |
| AC-S013-3-7 | Null fields "—"; no crash (DEFECT-011) | PASS | defect-detail-severity="—"; [data-field="expected"]="—"; defect-fix contains "—"; no console errors |
| AC-S013-3-8 | GEO: scrollHeight + panel bbox unchanged open vs closed | PASS | real-data: panelBefore==panelAfter, heightBefore==heightAfter |
| AC-S013-3-9 | Close returns focus to the row | PASS | real-data: defect-row-trigger focused after close |
| S13-3-A11Y-1 | Enter opens drawer | PASS | fixture: keyboard Enter on trigger → defect-drill visible |
| S13-3-A11Y-2 | Focus to heading on open | PASS | fixture: defect-drill-heading toBeFocused() |
| S13-3-A11Y-3 | Esc returns focus; no focus trap | PASS | fixture: trigger toBeFocused() after Esc; other row reachable from open drawer |
| S13-3-A11Y-4 | axe zero violations on open drawer | PASS | fixture: axe WCAG2A+AA+21AA+22AA scoped to defect-drill = 0 violations |
| S13-3-A11Y-5 | Non-colour-redundant MTTR state | PASS | "Not yet resolved" text node visible; data-mttr-state attr carries state |
| S13-3-A11Y-6 | Close button ≥ 24×24; row trigger ≥ 24px tall | PASS | close: 24×24 confirmed; trigger height ≥ 24px confirmed |
| GEO-S013-3-1 | Pure overlay: panel + rail + scrollHeight byte-identical | PASS | fixture: all three bbox/height values equal before/after open |
| GEO-S013-3-2 | Drawer on-screen, no horizontal scroll | PASS | fixture: box within viewport; hScroll=false |
| GEO-S013-3-3 | Record sections STACK | PASS | fixture: 7 section headings monotonic tops, shared left ±1px |
| GEO-S013-3-4 | MttrCard timeline order (reported y < recovered y) | PASS | fixture: reported.y < recovered.y confirmed |
| S13-3-FIG-1 | "13 min" with unit; data-mttr-seconds=815 | PASS | fixture + real-data |
| S13-3-FIG-2 | Open: "Not yet resolved"; "open for …"; NOT labelled MTTR | PASS | fixture DEFECT-003 + live DEFECT-014; label checked via evaluate() |
| S13-3-FIG-3 | Human timestamps in reported/recovered | PASS | fixture: "2026-06-09 00:30:00 UTC"/"2026-06-09 00:43:35 UTC"; real-data: "2026-06-10 06:17:47 UTC"/"2026-06-10 06:31:22 UTC" |
| S13-3-FIG-4 | Fix shas as code refs; null → "—" | PASS | fixture DEFECT-001 two shas; DEFECT-002 (null) → "—" in defect-fix |
| S13-3-FIG-5 | Null fields "—"; no blank/null/thrown error | PASS | fixture DEFECT-002 all-null; real-data DEFECT-011 severity "—" |
| S13-3-FIG-6 | Markdown as real HTML | PASS | actual `<strong>` present; no `**` literal in drawer text |
| S13-3-FIG-7 | data-source non-empty; visible source caption | PASS | defect-detail data-source="work/.../DEFECT-001-map-zero-figures.md"; mttr-card data-source="process/dora/ledger.csv#ref=DEFECT-001"; source caption visible |

## Additional findings (bonus coverage)

**DEFECT-014 live open path (EXP-033 bonus):** The task brief anticipated DEFECT-014
may land mid-session. It did. MttrCard correctly renders data-mttr-state="open",
mttr-recovered="Not yet resolved", mttr-figure="open for …" (elapsed since
2026-06-12T15:53:45Z), and the figure's dt label does NOT contain "MTTR". No
console errors. The S13-3-FIG-2 / AC-S013-3-6 open path is now confirmed against
BOTH a fixture record (demo DEFECT-003) AND a live open defect (DEFECT-014).

**DEFECT-015 zero-MTTR edge case:** mttr_s=0 (reported_ts = recovered_ts =
2026-06-12T15:55:30Z — instantaneous same-second repair). The UI rendered without
crash, severity shows "—" (null). The MTTR figure did NOT show bare "0". This
edge case is now a committed spec; re-verify if the humaniser is ever touched.

**DEFECT-012 status change:** At UC-S013-2 validation, DEFECT-012 was CONFIRMED
(the panel showed 1 open). At this session, the live API shows DEFECT-012 as CLOSED
(mttr_s=2635, recovered_ts=2026-06-11T07:43:41Z). This is a data change in the
source md file, not a regression — the prior validation noted the recovery row
existed in the ledger but the md file had not been updated. It has since been
updated. Current live count: 15 records, 1 open (DEFECT-014).

## Summary (UC-S013-3)

- Defect drill opens in 1 click or keyboard Enter: yes
- Heading carries id — title ("DEFECT-001 — UI shows 0 for everything while work is happening"): yes
- Four fields rendered as HTML (no raw **): yes
- DEFECT-001 Expected text "Opening the Observatory UI" visible: yes
- Fix shas "3d8c21c" + "82a622c" as `<code>` refs: yes
- MttrCard "13 min" (815 s) with human timestamps: yes
- Open path ("Not yet resolved", elapsed not labelled MTTR): yes — fixture DEFECT-003 + live DEFECT-014
- Null fields render "—" (DEFECT-011 severity, DEFECT-002 all fields): yes
- GEO invariant (pure overlay — scrollHeight unchanged): yes
- A11y: axe zero violations on open drawer: yes
- Keyboard: Enter opens, heading focused, Esc returns to row, no focus trap: yes
- All 15 live records: open ones correctly show "Not yet resolved"; MTTR label appears only on resolved spans: yes

## New specs committed (UC-S013-3 session)

`work/observatory/src/app/e2e/s013-defect-drill-real-data.spec.js` — extended with 3 new tests:
- `EXP-033/S13-3-FIG-2` — live DEFECT-014 open path
- `EXP-033/S13-3-FIG-1/5` — live DEFECT-015 zero-MTTR edge case
- `EXP-033/AC-S013-2-1` — live count line 15 records / 1 open

Relevancy: pinned (real-data ground truth; re-verify after any change to drill
components, lib/markdown.js, DEFECT-001.md, DEFECT-014/015.md, or the live ledger).

## Verdict (UC-S013-3)

**PASS.** UC-S013-3 (Defect drill-down + MTTR card) is validated against the live
production server (http://localhost:5173, sha c7edf5a) through committed Playwright
specs in a real Chromium browser context. All acceptance conditions pass:
AC-S013-3-1..9, S13-3-A11Y-1..6, GEO-S013-3-1..4, S13-3-FIG-1..7. The open-path
(S13-3-FIG-2/AC-S013-3-6) is confirmed against both a fixture record and the live
open DEFECT-014. EXP-033 real-data cross-checks complete. s013 is now 3/4 done;
only UC-S013-4 (SSE live refresh) remains.
