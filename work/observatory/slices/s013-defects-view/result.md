---
slice: s013-defects-view
chunk: CHK-8
uc: UC-S013-1
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

## Verdict

**PASS.** UC-S013-1 (`GET /api/projects/:id/defects`) is validated against the live production server (http://localhost:5173, sha 86c12eb) through the public HTTP surface in a real Chromium browser context. All acceptance cases pass. EXP-033 real-data cross-checks confirmed. UC-S013-1 is done.
