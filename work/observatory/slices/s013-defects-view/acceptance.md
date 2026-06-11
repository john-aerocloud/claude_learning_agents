---
slice: s013-defects-view
chunk: CHK-8
produced-by: product
date: 2026-06-10
real-data-requirement: EXP-033
---

# Acceptance — s013 Defects view

## Real-data requirement (EXP-033)

**This slice is NOT done if tests pass only against fixtures.** The tester MUST
validate every acceptance case below against the LIVE dataset:
- `work/observatory/defects/DEFECT-001.md` through `DEFECT-010.md` (10 files)
- `process/dora/ledger.csv` (for MTTR hand-verification)

Result.md must contain an explicit verification table (see §AC-REAL below).

---

## Acceptance cases by UC

### UC-S013-1 — Defects read endpoint

| ID | Case | Expected | Verified against |
|----|------|----------|-----------------|
| AC-S013-1-1 | `GET /api/projects/observatory/defects` returns a JSON array | HTTP 200; `Content-Type: application/json`; body is an array | Live server |
| AC-S013-1-2 | Array contains exactly 10 elements | `response.length === 10` | Live 10-file dataset |
| AC-S013-1-3 | DEFECT-001 has correct status and severity | `{id:"DEFECT-001", status:"CLOSED", severity:"HIGH"}` | Live DEFECT-001.md |
| AC-S013-1-4 | DEFECT-001 reported_ts matches ledger failure row | `reported_ts === "2026-06-10T06:17:47Z"` (ledger row 817) | Live ledger.csv |
| AC-S013-1-5 | DEFECT-001 recovered_ts matches ledger recovery row | `recovered_ts === "2026-06-10T06:31:22Z"` (ledger row 821) | Live ledger.csv |
| AC-S013-1-6 | DEFECT-001 mttr_s ≈ 815 (06:17:47 → 06:31:22 = 815 s) | `mttr_s >= 810 && mttr_s <= 820` | Computed from live ledger |
| AC-S013-1-7 | A CONFIRMED (open) defect (if any) has `recovered_ts: null` and `mttr_s: null` | Null values, not 0 or undefined | Live data |
| AC-S013-1-8 | Request for non-existent defect id returns empty array | `GET /defects?id=DEFECT-999` → `[]` | API call |
| AC-S013-1-9 | Server does not crash on malformed/partial DEFECT file | Inject a minimal stub file; response still 200 with other 10 items | Controlled test |

### UC-S013-2 — Defects list panel

| ID | Case | Expected | Verified against |
|----|------|----------|-----------------|
| AC-S013-2-1 | List renders exactly 10 rows | DOM row count = 10 | Live 10-defect dataset |
| AC-S013-2-2 | DEFECT-001 row: status=CLOSED, severity=HIGH visible | Row contains "CLOSED" text AND "HIGH" text (not colour-only) | DOM assertion |
| AC-S013-2-3 | DEFECT-001 MTTR renders with a time unit | Row contains "min" or "sec" or "h" — not a bare integer | DOM assertion |
| AC-S013-2-4 | MTTR for DEFECT-001 is approximately "13 min" | Rendered string parses to 810–820 s | DOM + arithmetic |
| AC-S013-2-5 | Status badges are non-colour-redundant | Badge contains text label "CONFIRMED" or "CLOSED"; passes simulated no-colour check | DOM + visual |
| AC-S013-2-6 | CONFIRMED defects appear before CLOSED in the list | If any CONFIRMED defect exists in live data, its row index < first CLOSED row index | DOM ordering |
| AC-S013-2-7 | Value-stream map column geometry unchanged when Defects panel is open | `scrollHeight` + column width identical with panel open vs closed (GEO invariant) | DOM measurement |
| AC-S013-2-8 | MTTR="open" rendered for CONFIRMED defect | If a CONFIRMED defect exists: MTTR cell shows "open" or "Not yet resolved" | DOM assertion |

### UC-S013-3 — Defect drill-down + MTTR card

| ID | Case | Expected | Verified against |
|----|------|----------|-----------------|
| AC-S013-3-1 | Click DEFECT-001 row: DetailPane opens | `data-testid="detail-pane"` present in DOM; visible | DOM |
| AC-S013-3-2 | Four fields rendered as HTML, not raw markdown | Pane contains `<p>` or `<h2>` elements; no raw `##` visible in text nodes | DOM |
| AC-S013-3-3 | "Expected" field content for DEFECT-001 appears in drawer | Text contains "Opening the Observatory UI" or equivalent from the live file | DOM + live file |
| AC-S013-3-4 | Fix sha appears in the drawer | Text contains "3d8c21c" or "82a622c" (from DEFECT-001 resolution) | DOM + live file |
| AC-S013-3-5 | MttrCard shows reported_ts + recovered_ts + duration with unit for DEFECT-001 | Card contains "06:17" or equivalent time text AND "13 min" or equivalent duration | DOM |
| AC-S013-3-6 | CONFIRMED (open) defect: MttrCard shows "Not yet resolved" | MTTR card renders gracefully; no null/undefined visible; no console error | DOM + console |
| AC-S013-3-7 | Null/missing resolution field: graceful placeholder, no JS error | Field renders "—" or "not recorded" or equivalent; no thrown exception | DOM + console |
| AC-S013-3-8 | Map column scrollHeight unchanged with drawer open | GEO invariant — same as AC-S013-2-7 | DOM measurement |
| AC-S013-3-9 | Closing drawer returns focus to defects list | Defects list visible; drawer gone from DOM or hidden | DOM |

### UC-S013-4 — SSE live refresh

| ID | Case | Expected | Verified against |
|----|------|----------|-----------------|
| AC-S013-4-1 | Add temp DEFECT-011-test.md → list count increments | Row count goes 10 → 11 within SSE window without reload | Live file + DOM |
| AC-S013-4-2 | Remove temp file → list count returns to 10 | Row count 11 → 10 without reload | Live file + DOM |
| AC-S013-4-3 | Drawer stays open when SSE fires during a drill | DetailPane remains visible; content updates; no crash | DOM |

---

## Real-data verification table (EXP-033) — tester must complete

The tester must fill this table in result.md. The slice does not pass unless every
row shows match=yes.

| Defect ID | Expected status | Actual status | Expected severity | Actual severity | Expected MTTR (s) | Actual MTTR (s/display) | Match |
|-----------|----------------|--------------|------------------|-----------------|--------------------|------------------------|-------|
| DEFECT-001 | CLOSED | _(tester fills)_ | HIGH | _(tester fills)_ | ~815 s (~13 min) | _(tester fills)_ | _(yes/no)_ |
| DEFECT-007 | CLOSED | _(tester fills)_ | MED | _(tester fills)_ | _(compute from ledger rows 923→932)_ | _(tester fills)_ | _(yes/no)_ |
| _(first CONFIRMED, if any)_ | CONFIRMED | _(tester fills)_ | _(from file)_ | _(tester fills)_ | null / open | _(tester fills)_ | _(yes/no)_ |

Tester must also state:
- Total rows rendered: \_\_\_ (expected: 10)
- DEFECT-001 four-fields rendered as HTML: yes/no
- GEO invariant (map column scrollHeight unchanged): yes/no
- SSE refresh test (AC-S013-4-1): pass/fail

---

## Out-of-scope guard

The following must NOT be present in the delivered slice (they are explicitly out
of scope and would constitute scope creep):
- Any write affordance in the UI (create/edit/delete defect)
- DEF- entries added to items.csv
- MTTR trend charts or aggregate quality metrics panels
- Cross-project defect aggregation
- Source-events reveal pattern on MTTR figures (follow-on slice)
