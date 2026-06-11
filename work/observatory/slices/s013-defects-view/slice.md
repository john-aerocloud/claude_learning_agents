---
slice: s013-defects-view
chunk: CHK-8
status: defined
created: 2026-06-10
value: HIGH
cost: M   # ~8h estimated across 4 UCs; heavy reuse of existing components
vc_ratio: HIGH/M
---

# s013 — Defects view

## Job served

**J-QUALITY — Observe the quality picture without grepping files.**
When the operator wants to understand quality and delivery trust — what broke,
how severe it was, how quickly it was fixed, and whether anything is still open
— they want to see all defects with status + severity at a glance and drill into
any one for the full record (the four fields, root cause, resolution, and MTTR
timeline), much like navigating the work-item tree, so they can assess pipeline
health without opening `work/observatory/defects/*.md` or grepping the ledger.

_Functional:_ every defect record is visible with its status (CONFIRMED/CLOSED)
and severity; each is drillable to its four fields + root cause + resolution +
MTTR (time from failure row to recovery row in the ledger); MTTR always has a
time unit; every figure links to the markdown record + ledger rows that produced
it.

_Emotional:_ "I can see our quality track record and current open defects in the
same surface I use to watch the pipeline — I don't need to go hunting in files."

_Social:_ quality is visible alongside throughput, not hidden in a separate log.

### Classification: SECONDARY (J-QUALITY supports but does not define the core
observe job; CHK-8 is value-add after the CORE J1/J2 jobs are served by
CHK-1–CHK-4). Next-work selection: scheduled after CORE chunks advance.

---

## Thin scope (what this slice delivers)

1. **Defects read endpoint** (`GET /api/projects/:id/defects`): parse
   `work/<project>/defects/DEFECT-*.md` files; for each record extract
   {id, status, severity, expected, actual, intent, importance, classification,
   root_cause, resolution_text, fix_sha}; join the DORA ledger
   (`process/dora/ledger.csv`) `failure` rows (where `ref=DEFECT-NNN`) and the
   first matching `recovery` row to compute `reported_ts`, `recovered_ts`, and
   `mttr_s` (seconds from failure to recovery; null if still open). Returns a
   JSON array sorted by id. Reuses the existing tolerant ledger parser
   (`ledgerAggregator`) — no new CSV parser.

2. **Defects list panel**: a new top-level "Defects" section in the SPA sidebar
   alongside the work-item tree. Renders one row per defect: id, status badge
   (CONFIRMED/CLOSED, non-colour-redundant — text + icon/shape), severity badge
   (HIGH/MED/LOW, non-colour-redundant), and MTTR when available ("2 h 30 min"
   or "open"). Groups: CONFIRMED defects first (these are the open ones), then
   CLOSED, each sub-sorted by id. Reuses the existing list/tree row patterns
   from the work-item tree.

3. **Defect drill-down in the existing drawer**: clicking a defect row opens the
   existing `DetailPane` floating drawer (delivered by DEFECT-006 / UC-S005-3)
   with the four fields + root cause + resolution rendered as styled markdown
   (reusing `MarkdownRenderer`), and a MTTR timeline card showing reported_ts,
   recovered_ts, and duration in human-readable form with time units. Fix sha
   is shown as a link-or-code snippet. Absent recovery (open defect) shows
   "Not yet resolved".

4. **SSE live refresh**: the defects list and drawer re-fetch on SSE file-change
   events (reusing `subscribeEvents`/`VsmContainer` SSE seam). A new defect
   file or a ledger recovery row appearing → list updates within the configured
   SSE window without manual reload.

---

## Where it lives in the UI

**A new top-level "Defects" tab/section** in the main navigation alongside the
Value-Stream Map and Work-Item Tree — NOT a sub-section of the tree. Rationale:
defect records are not in `items.csv` (they are markdown + ledger rows, not DEF-
items), so they cannot live as tree nodes without data contract work that is
explicitly out of scope for this slice. The ui-designer will confirm the exact
structure (tab, sidebar section, or panel) and ensure it does not displace the
value-stream map as the primary view.

---

## Explicitly NOT in scope

- Writing, creating, or editing defect records — read-only, all writes via
  Claude's accept gate per the hard constraint in §2 of the requirements doc.
- Adding `DEF-` rows to `items.csv` — defects are markdown + ledger records,
  not registry items; harmonising the data contract is a separate future decision.
- Defect search or filter UI (follow-on once the baseline view exists).
- MTTR trend charts or aggregate statistics (follow-on; this slice shows
  per-defect MTTR, not a panel of aggregate quality metrics).
- Mobile / responsive layout optimisation.
- Cross-project defect aggregation (single active project, as per all existing
  views).
- Rendering the source ledger rows for each defect figure (the `source_events`
  reveal pattern from DEFECT-005/008 can be applied in a follow-on slice once
  the baseline renders correctly).

---

## Missing capability

**Defect markdown parser**: `work/<project>/defects/DEFECT-*.md` files are not
yet parsed by any server route. This is the one new server capability. It reuses
the existing file-system read conventions (same `fs` + glob pattern as
slice-artifact routes) and the `marked` / `MarkdownRenderer` client component
already delivered. No new CSV parser; no new SSE channel.

---

## Success measures (basis for acceptance)

| # | Measure | How observed |
|---|---------|--------------|
| SM-DEF-1 | All 10 defect records (DEFECT-001..010) appear in the list with correct status and severity | List count = 10; spot-check DEFECT-001 shows status=CLOSED, severity=HIGH; DEFECT-009 shows status=CLOSED |
| SM-DEF-2 | CONFIRMED (open) defects are visually distinct from CLOSED ones without relying on colour alone | Status badge uses text+icon/shape; passes visual-only test (no-colour simulation) |
| SM-DEF-3 | MTTR figures carry a time unit ("2 h 30 min", not "8830") and trace to the ledger failure→recovery span | DEFECT-001 MTTR: ledger row 817 (failure 06:17:47Z) → row 821 (recovery 06:31:22Z) = ~830 s; rendered as "13 min" or equivalent |
| SM-DEF-4 | Drilling into DEFECT-001 shows the four fields + root cause + resolution rendered as styled HTML, not raw markdown | data-testid="detail-pane" contains at least one `<h2>` and rendered paragraph; no raw `##` visible |
| SM-DEF-5 | Drilling into a CONFIRMED (open) defect shows "Not yet resolved" in the MTTR card, not a crash | Select an open defect (if any exists in live data); MTTR card renders gracefully |
| SM-DEF-6 | List updates without manual reload when a new DEFECT-*.md file is added | SSE test: add a temp file, list row count increments; remove file, list shrinks |
| SM-DEF-7 | The value-stream map remains the primary view; defects section does not displace it | Map still renders fully when Defects panel is open; no geometry change to the map column |

**Real-data done-condition (EXP-033 policy):** the slice is NOT done if acceptance
passes only against fixtures. The tester MUST validate against the LIVE 10 defect
records in `work/observatory/defects/` and the live `process/dora/ledger.csv`,
confirming: list shows exactly 10 records; DEFECT-001 status=CLOSED and severity=HIGH;
MTTR for DEFECT-001 matches the ledger failure (row 817, 06:17:47Z) → recovery (row
821, 06:31:22Z) span hand-checked (expected ~830 s / ~13 min); at least one defect
detail pane renders its four fields as styled HTML. Result.md must contain an explicit
verification table naming the defect id, expected status, actual status, expected MTTR,
actual MTTR, and match: yes/no for at least DEFECT-001 and one other.

---

## Architecture notes for solution-architect / cicd

**Seam co-declarations (for flow-manager path registry):**
- UC-S013-1 owns: `server/routes/defects.js` (new route); READ-ONLY reuse of
  `server/lib/ledgerAggregator.js` and `fs` glob pattern from existing artifact routes
- UC-S013-2 owns: `src/app/components/DefectsList.jsx` (new);
  `src/app/hooks/useDefects.js` (new); reuses existing list/row CSS classes
- UC-S013-3 owns: `src/app/components/MttrCard.jsx` (new, composed in DetailPane);
  reuses existing `DetailPane.jsx`, `MarkdownRenderer.jsx`
- UC-S013-4 owns: SSE re-fetch wiring in `useDefects.js` hook (extends existing
  `subscribeEvents` pattern; no new channel)

**Ledger join note for architect:** defect MTTR is computed server-side by joining
`failure` rows (`ref=DEFECT-NNN`) with the first subsequent `recovery` row on the same
`ref`. This is a simple O(n) pass over the ledger — the existing `ledgerAggregator`
read path covers it. Confirm at gate whether this belongs in `ledgerAggregator.js`
or a thin `defectsMttr.js` helper.

**Markdown parse note:** each `DEFECT-*.md` file has a consistent structure (Four
fields, Resolution, Classification, Root cause headings). The server parses the raw
file text and returns it as a string; the client renders it via `MarkdownRenderer`
(already delivered). No server-side HTML generation needed.
