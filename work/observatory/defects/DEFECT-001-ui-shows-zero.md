# DEFECT-001 — UI shows 0 for everything while work is happening

**Reported:** 2026-06-10 · **Status:** CLOSED (fixed + prod-re-checked) · **Severity:** HIGH (blocks the CORE observe job)

## Resolution
Built + mounted the value-stream map as the PRIMARY view (`main.jsx` → ValueStreamMap reading `/stage-flow`). Commits `3d8c21c`, `82a622c`. Live prod re-check in a real browser: Build/TDD tp 8 with ● 4 in-flight, Decompose tp 11 ● 1 in-flight, Validate/Deploy/Done all real, 0 console errors — symptom GONE. 142 unit + 13 browser green. Gap → EXP-033 (validate the DEPLOYED DEFAULT view against live non-zero data) — this is its confirming data point.

## Four fields
- **Expected:** Opening the Observatory UI (:5173) shows real, non-zero pipeline state that reflects the work happening now, and updates live as agents build.
- **Actual:** The UI shows **0 for everything**, even while the dev loop is actively building.
- **Intent:** Watch the pipeline live — see work flowing through stages (the core J1/J2 observe-and-navigate job).
- **Importance:** This is the product's entire reason to exist. The operator cannot observe anything → core job fully blocked.

## Reproduction (confirmed)
- `main.jsx` mounts `<MapContainer/>` → the CHK-2 **PipelineMap**, which renders the four **queue depths** from `queues/*.csv`.
- The queue CSVs (`ready/intake/deploy/rework`) are **empty/header-only**: in the pull system, work is pulled and built immediately, so it is **in-flight**, not sitting in a queue. Queue-depth view ⇒ 0,0,0,0.
- The real-data view — the **value-stream map** reading `GET /api/projects/:id/stage-flow` (which DOES return live data: build/engineer throughput=7, WIP incl. in-flight items) — is **not built/mounted** (UC-S004-2 render died at an infra timeout; only the `getStageFlow` client helper committed, `6ba83c2`).
- Therefore the deployed UI structurally cannot show the work.

## Classification (§5a)
Our bug — product/UI design + incomplete slice. Not caller data, not dependency.

## Root cause (latent)
Two layers: (1) the deployed primary view measures the wrong thing (queue depth, which is ~0 in a fast pull system) instead of in-flight WIP + per-stage throughput; (2) the real-data value-stream view that fixes it was sliced but not shipped. This is the third surfacing of "in-flight work is invisible / fixtures hid the empty real view" (see DEFECT context + EXP-033).

## Priority decision
**Fix NOW (interrupt).** Production-blocking, core-job, user actively watching. Pre-empts all other queued work per §38/§F5. The fix IS the in-flight UC-S004-2 (complete it + mount it as the deployed primary view).

## Fix
Complete UC-S004-2: build the ValueStreamMap (reads `getStageFlow` → real per-stage throughput/dwell/WIP/rework), mount it as the PRIMARY view in `main.jsx` replacing the empty-queue PipelineMap. Pin a test asserting the deployed view shows non-zero live data. Verify in prod (real numbers on screen). [sha + prod re-check recorded on close]
