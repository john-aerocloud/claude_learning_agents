---
slice: s013-defects-view
chunk: CHK-8
produced-by: product
date: 2026-06-10
---

# Use cases — s013 Defects view

All UCs serve **J-QUALITY — Observe the quality picture without grepping files**
(SECONDARY, CHK-8).
Ordered thinnest-first (dependency-safe build order).

---

## UC-S013-1 — Defects read endpoint (foundational)

**One-line JTBD:** When the SPA requests defect data, the server must parse all
DEFECT-*.md records + join the ledger for MTTR so the defects list and drawer have
a single reliable data source.

**Actor:** SPA (calls on behalf of the operator)

**Trigger:** `GET /api/projects/:id/defects`

**Observable outcome:** Server responds with a JSON array; each element has:
`{id, status, severity, expected, actual, intent, importance, classification,
root_cause, resolution_text, fix_sha, reported_ts, recovered_ts, mttr_s}`.
- `id` = "DEFECT-001" etc. (filename-derived)
- `status` = "CONFIRMED" or "CLOSED" (parsed from the `**Status:**` line)
- `severity` = "HIGH", "MED", "MED-HIGH", or "LOW"
- Four fields parsed from the `## Four fields` section
- `reported_ts` = timestamp from the first matching `failure` ledger row where
  `ref` contains the defect id
- `recovered_ts` = timestamp from the first matching `recovery` ledger row
  (null if none exists — CONFIRMED/open)
- `mttr_s` = `recovered_ts - reported_ts` in seconds (null if open)
- Array sorted by id ascending (DEFECT-001 first)
- Missing or unparseable file fields degrade gracefully (null values, no 5xx)
- Unknown defect id returns empty array `[]`

**Data sources:**
- `work/<project>/defects/DEFECT-*.md` — glob, read raw text, parse structure
- `process/dora/ledger.csv` — READ-ONLY reuse of `server/lib/ledgerAggregator.js`;
  filter `event=failure` + `event=recovery` rows where `ref` matches the defect id

**Seams / paths owned:**
- `server/routes/defects.js` (new route)
- `server/lib/ledgerAggregator.js` — READ-ONLY reuse; flag if not yet a shared
  module (extraction is an enabler, not a new UC)

**Value:** HIGH (all other UCs in this slice depend on this endpoint)
**Cost estimate:** 2 h

**Dependencies:** none — independently buildable

**Done condition:** `GET /api/projects/observatory/defects` returns a JSON array
with exactly 10 elements (one per live DEFECT-*.md file); DEFECT-001 has
`status="CLOSED"`, `severity="HIGH"`, `reported_ts="2026-06-10T06:17:47Z"`,
`recovered_ts` non-null, `mttr_s` ~830; a non-existent id returns `[]`; no 5xx
on a well-formed request.

---

## UC-S013-2 — Defects list panel

**One-line JTBD:** When the operator opens the Defects section, they want to see
all defects with status + severity + MTTR at a glance so they can assess quality
without navigating files.

**Actor:** Pipeline operator

**Trigger:** Operator navigates to the "Defects" section/tab in the SPA

**Observable outcome:**
- A list renders one row per defect: id, status badge (CONFIRMED/CLOSED, text +
  icon/shape — non-colour-redundant per the legibility checklist), severity badge
  (HIGH/MED-HIGH/MED/LOW — text, not colour-only), MTTR figure with a time unit
  (e.g. "13 min", "1 h 21 min") or "open" for CONFIRMED
- CONFIRMED defects are grouped first (these are unresolved); CLOSED below; each
  group sub-sorted by id ascending
- 10 rows visible for the live 10-defect dataset
- No crash if `mttr_s` is null (open defect)
- The value-stream map column is geometrically unchanged (no reflow — same
  no-reflow invariant as DEFECT-006)
- MTTR figures are non-zero and carry a human unit (legibility checklist)

**Data source:** `GET /api/projects/:id/defects` (UC-S013-1)

**Seams / paths owned:**
- `src/app/components/DefectsList.jsx` (new)
- `src/app/hooks/useDefects.js` (new)
- Reuses existing row/badge CSS patterns from `WorkItemTree`; no new design tokens

**Value:** HIGH
**Cost estimate:** 2 h

**Dependencies:** UC-S013-1 (endpoint must exist)

**Acceptance cases:**
- AC-S013-2-1: row count = 10 against live data
- AC-S013-2-2: DEFECT-001 row shows status=CLOSED and severity=HIGH
- AC-S013-2-3: MTTR for DEFECT-001 renders "13 min" or equivalent time-unit form,
  not a raw integer
- AC-S013-2-4: status badge contains text label (not colour alone); passes
  no-colour simulation check
- AC-S013-2-5: value-stream map column scrollHeight unchanged when panel is open
  (GEO invariant)
- AC-S013-2-6: if a CONFIRMED (open) defect exists in live data, it appears in
  the top group with MTTR="open" and is visually distinct from CLOSED rows

**Done condition:** All acceptance cases above pass; real-data row count = 10;
DEFECT-001 MTTR matches ledger hand-check.

---

## UC-S013-3 — Defect drill-down in the existing drawer

**One-line JTBD:** When the operator clicks a defect row, they want the full
record — four fields, root cause, resolution, and MTTR timeline — in the existing
floating drawer so they can understand the defect without opening a file.

**Actor:** Pipeline operator

**Trigger:** Click on any defect row in the Defects list

**Observable outcome:**
- The existing `DetailPane` floating drawer opens (reuses DEFECT-006 delivery;
  map geometry unchanged)
- Drawer renders:
  - **Four fields section**: Expected, Actual, Intent, Importance as styled HTML
    paragraphs (via `MarkdownRenderer` — reuse, not new code)
  - **Root cause** paragraph rendered as HTML
  - **Resolution** paragraph rendered as HTML; fix sha shown (plain text or code
    element)
  - **MTTR timeline card** (`MttrCard`): reported_ts in ISO/human form, recovered_ts
    or "Not yet resolved", duration in human-readable form with time unit
    ("13 min 50 sec", "1 h 21 min") — never a raw integer
  - CONFIRMED (open) defect: MTTR card shows reported_ts + "Not yet resolved",
    no crash
- Absent or null field → graceful placeholder, no console error
- "Back" / close action closes the drawer; defects list remains visible

**Data source:** defect object already fetched by `useDefects.js` (no extra
endpoint call needed — all fields are in the UC-S013-1 response)

**Seams / paths owned:**
- `src/app/components/MttrCard.jsx` (new, thin — composed in DetailPane)
- `src/app/components/DefectDetail.jsx` (new, thin — layout wrapper composed in
  DetailPane when a defect is the selected item)
- Reuses `DetailPane.jsx`, `MarkdownRenderer.jsx` — no changes to those files'
  structure; new components composed into them
- Architect to confirm at gate whether `DetailPane.jsx` needs a minor interface
  extension for defect-type content vs slice-type content, or if it is fully
  generic already

**Value:** HIGH (the drill is the primary interrogation affordance)
**Cost estimate:** 2.5 h

**Dependencies:** UC-S013-1 (data), UC-S013-2 (list must render for a row to be
clickable)

**Acceptance cases:**
- AC-S013-3-1: clicking DEFECT-001 row opens DetailPane; drawer contains an `<h2>`
  or `<p>` with "Expected" or equivalent section heading (rendered HTML, not raw `##`)
- AC-S013-3-2: fix sha from DEFECT-001 resolution ("3d8c21c, 82a622c") appears
  in the drawer
- AC-S013-3-3: MttrCard shows reported_ts + recovered_ts + duration "13 min" or
  equivalent with time unit for DEFECT-001
- AC-S013-3-4: if a CONFIRMED defect exists, MTTR card shows "Not yet resolved"
  (no crash, no raw null)
- AC-S013-3-5: null/empty resolution renders as placeholder text, no JS exception
- AC-S013-3-6: map column scrollHeight unchanged with drawer open (GEO invariant,
  as per DEFECT-006 fix)

**Done condition:** All acceptance cases above pass against live DEFECT-001 data;
result.md must name the defect id, expected MTTR, actual rendered MTTR, and match: yes/no.

---

## UC-S013-4 — SSE live refresh for defects

**One-line JTBD:** When a new defect file appears or a ledger recovery row is
added, the defects list updates automatically so the operator always sees current
quality state.

**Actor:** Pipeline operator (passive — the UI updates without action)

**Trigger:** SSE file-change event fires (reusing existing `subscribeEvents` seam)

**Observable outcome:**
- Defects list re-fetches `GET /api/projects/:id/defects` on SSE event
- Adding a temp `DEFECT-011-test.md` file causes list row count to increment
  within the SSE window (≤ N seconds, same N as all other views); removing it
  causes count to decrement
- No manual reload required
- Existing drill selection (if open) is not forcibly closed on refresh; it
  re-fetches the selected defect's data

**Data source:** Existing SSE channel (`/api/projects/:id/events` or equivalent,
delivered UC-S001-5); wired into `useDefects.js`

**Seams / paths owned:**
- SSE re-fetch wiring in `src/app/hooks/useDefects.js` — extends the existing
  `subscribeEvents` pattern; no new channel, no new server code

**Value:** MEDIUM (freshness; the list is useful without this but staleness is
a trust issue per DEFECT-003)
**Cost estimate:** 0.5 h (wire pattern already established; minimal new code)

**Dependencies:** UC-S013-2 (list must exist to wire SSE into); UC-S013-1
(endpoint must be callable on re-fetch)

**Acceptance cases:**
- AC-S013-4-1: adding a temp defect file → list row count increments without
  manual reload (within N seconds)
- AC-S013-4-2: removing the temp file → list shrinks back
- AC-S013-4-3: if drawer is open on a defect when SSE fires, drawer does not
  close / crash; it re-renders with current data

**Done condition:** AC-S013-4-1 and AC-S013-4-2 pass against the live repo.

---

## Dependency edges

```
UC-S013-1  ──► UC-S013-2 ──► UC-S013-3
                         ──► UC-S013-4
```

Ordered build sequence:
1. UC-S013-1 (defects endpoint) — foundational, no dependencies
2. UC-S013-2 (list render) — needs UC-S013-1
3. UC-S013-3 (drill drawer) — needs UC-S013-1 + UC-S013-2
4. UC-S013-4 (SSE refresh) — needs UC-S013-2 (wire into the list hook); parallelisable
   with UC-S013-3 if engineer claims distinct seams (useDefects.js vs MttrCard.jsx)

UC-S013-3 and UC-S013-4 can be built in parallel once UC-S013-2 ships (different
seams: UC-S013-3 owns MttrCard/DefectDetail.jsx; UC-S013-4 owns SSE wiring in
useDefects.js hook only). Architect confirms at gate.

---

## Seam co-declarations (for flow-manager path registry)

| UC | Seam(s) owned | Reuse (read-only) |
|----|--------------|-------------------|
| UC-S013-1 | `server/routes/defects.js` | `server/lib/ledgerAggregator.js` |
| UC-S013-2 | `src/app/components/DefectsList.jsx`, `src/app/hooks/useDefects.js` | `WorkItemTree` CSS classes |
| UC-S013-3 | `src/app/components/MttrCard.jsx`, `src/app/components/DefectDetail.jsx` | `DetailPane.jsx`, `MarkdownRenderer.jsx` |
| UC-S013-4 | SSE wiring in `useDefects.js` | `subscribeEvents` pattern |

`DetailPane.jsx` is a READ-ONLY seam for UC-S013-3 unless it needs an interface
extension (architect to confirm). If it does need touching, UC-S013-3 and any
concurrent DetailPane use must be serialised for that file.

---

## Reuse inventory (explicit)

The following existing deliveries are reused with no or minimal modification:

| Component / module | Delivered by | Reuse |
|--------------------|-------------|-------|
| `server/lib/ledgerAggregator.js` | UC-S004-1 | Parse ledger; filter failure/recovery rows |
| `DetailPane.jsx` floating drawer | DEFECT-006 | Open on click; GEO no-reflow guarantee |
| `MarkdownRenderer.jsx` | UC-S005-4 | Render four fields + root cause + resolution as HTML |
| `subscribeEvents` / SSE seam | UC-S001-5, UC-S004-6 | Live refresh on file change |
| `WorkItemTree` row/badge CSS patterns | UC-S005-2 | Status/severity badges |

New code = 1 server route + 2 SPA components + 1 hook + 1 thin card component.
No new design tokens; no new CSS framework; no new third-party libraries.

---

## Value / cost summary

| UC | Job served | Value | Cost (h) | Dependencies |
|----|-----------|-------|----------|--------------|
| UC-S013-1 | Defects read endpoint | HIGH | 2.0 | none |
| UC-S013-2 | Defects list panel | HIGH | 2.0 | UC-S013-1 |
| UC-S013-3 | Defect drill-down + MTTR card | HIGH | 2.5 | UC-S013-1, UC-S013-2 |
| UC-S013-4 | SSE live refresh | MEDIUM | 0.5 | UC-S013-2 |
| **Total** | | | **7.0 h** | |

_Estimate is within the M band in slice.md. The low cost is a direct consequence
of heavy reuse: the drawer, markdown renderer, SSE seam, and ledger parser are all
already delivered._
