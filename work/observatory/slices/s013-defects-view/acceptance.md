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

## UC-S013-2 — UI-designer conditions (STRUCTURE pass; mirrored from ui-design.md)

Added by the ui-designer before build. These are mechanically assertable (axe /
Playwright bounding-box / computed-style / DOM text) and become the tester's UI
test plan for UC-S013-2. They SUPPLEMENT the product acceptance cases above and
supersede the stale "10 records" count with the live ground truth: the endpoint
returns **12** records (DEFECT-001..012); DEFECT-012 is CONFIRMED/open; DEFECT-011
is ledger-only with `severity=null`.

### Accessibility (WCAG 2.2 AA)

| ID | Case | Expected |
|----|------|----------|
| S13-2-A11Y-1 | Keyboard three-tab switch | ViewSwitch is `tablist`/`tab`; Arrow/Home/End cycle ALL THREE tabs; Enter/Space activates "Defects"; `aria-selected` reflects active view across all three |
| S13-2-A11Y-2 | Focus order & landmark | switching to Defects exposes/focuses `region` named "Defects" with visible `<h2>`; order tab → heading → group heading → first row; no trap |
| S13-2-A11Y-3 | Non-colour-redundant state | `:focus-visible` ring `--focus-ring` ≥3:1; open row has visible "OPEN" text node + `data-open="true"` (not colour-only); CLOSED row has "CLOSED" text |
| S13-2-A11Y-4 | Target size | each tab hit box ≥ 24×24 CSS px (`getBoundingClientRect`) |
| S13-2-A11Y-5 | Name/role/state | tablist "Dashboard view"; tab "Defects"; region "Defects"; rows `listitem` with accessible name carrying id+title+status+severity+MTTR; axe `aria-*` zero violations |
| S13-2-A11Y-6 | Ordered headings | exactly one `<h2>` "Defects" under page `<h1>`; group headings `<h3>`; no skipped levels |
| S13-2-A11Y-7 | Live region | count line inside `aria-live="polite"` `role="status"` container (SSE-update slot) |

### Visual-structural / no-reflow (EXP-016 / s002-line guard)

| ID | Case | Expected |
|----|------|----------|
| GEO-S013-2-1 | Lossless view switch (SM-DEF-7) | VSM region bbox + `documentElement.scrollHeight` byte-identical before→Defects→back; with Defects active `value-stream-map` is ABSENT (unmounted, not hidden-reflowing) |
| GEO-S013-2-2 | Rows STACK, not a line | within a group, ≥2 `defect-row`s have monotonically increasing tops AND shared left offset |
| GEO-S013-2-3 | Tree rail persists | `work-item-tree` region bbox identical Pipeline vs Defects active |
| GEO-S013-2-4 | Open group leads (order=geometry) | open-group heading top offset < closed-group heading top; DEFECT-012 row top < every CLOSED row top |
| GEO-S013-2-5 | Within-row figures align | `<dd>`s in one `defect-row` share a row band (shared top offset, small tolerance) at desktop width |

### Figure legibility (checklist)

| ID | Case | Expected |
|----|------|----------|
| S13-2-FIG-1 | MTTR carries a unit | resolved-defect MTTR matches `/\d+\s*(h|min|s)/`, not a bare integer; not raw seconds in the headline |
| S13-2-FIG-2 | Open ≠ zero | DEFECT-012 (CONFIRMED, `mttr_s=null`) MTTR cell text = "open" — never "0"/"0 s"/blank/"null"/"—" |
| S13-2-FIG-3 | Human-meaningful references | each row shows `DEFECT-NNN` id WITH a multi-word title sentence; no `row:\d+` token anywhere in the row |
| S13-2-FIG-4 | Severity unknown ≠ defaulted | DEFECT-011 (`severity=null`) severity badge text = "—" — never blank, never defaulted LOW/MED |
| S13-2-FIG-5 | Status in operator's language | visible badge text "OPEN"/"CLOSED"; `data-status` "CONFIRMED"/"CLOSED" respectively |
| S13-2-FIG-6 | Count line labelled | count text contains "defect" + "open" + the two integers (e.g. "12 defects, 1 open") — never bare "12 / 1" |

---

## UC-S013-3 — UI-designer conditions (STRUCTURE pass; mirrored from ui-design.md)

Added by the ui-designer before build. Mechanically assertable (axe / Playwright
bounding-box / computed-style / DOM text); these become the tester's UI test plan
for UC-S013-3 and SUPPLEMENT the product acceptance cases above (AC-S013-3-1..9).

**Live-data reality (supersedes the stale acceptance sketch).** UC-S013-1 is
delivered; the endpoint returns every drill field for **12** records, all of which
are **currently CLOSED** (DEFECT-012 closed 2026-06-11T07:43:41Z). The resolved
path is asserted against LIVE DEFECT-001 (`mttr_s=815`, fix_sha "3d8c21c, 82a622c").
The OPEN path (recovered_ts/mttr_s null) is real behaviour the data can re-enter at
any time but has no live instance now, so the open conditions (S13-3-FIG-2,
S13-3-A11Y-5 open branch, AC-S013-3-6) are exercised against a **fixture open
record** on the fixture server — not live. No server change is needed for UC-S013-3.

### Drawer reuse (build constraint)

`DetailPane.jsx` is a READ-ONLY reuse slot (it is `item`-coupled and shared with
UC-S005-3). The drill is built as a NEW `DefectDrillContainer.jsx` reproducing the
DEFECT-006 drawer idiom (`position:fixed`, portalled, existing drawer tokens) +
`DefectDetail.jsx` + `MttrCard.jsx`. The engineer must NOT edit `DetailPane.jsx`.

### Accessibility (WCAG 2.2 AA)

| ID | Case | Expected |
|----|------|----------|
| S13-3-A11Y-1 | Keyboard open from row | focus a `defect-row`, press Enter (and Space) → `defect-drill` opens (not pointer-only) |
| S13-3-A11Y-2 | Focus moves into the pane | on open `document.activeElement` is `defect-drill-heading`; order heading → fields → MttrCard → close |
| S13-3-A11Y-3 | Esc returns to the row | Esc (and ×) closes AND `document.activeElement` is the originating `defect-row`; no focus trap (non-modal) |
| S13-3-A11Y-4 | Name/role/state | drawer `region` named "Defect: <id>"; close button named; MttrCard a labelled group; rendered markdown gives `<h3>`s under the drawer `<h2>` (no skipped levels); axe `aria-*` + heading-order zero violations on the open drawer |
| S13-3-A11Y-5 | Non-colour-redundant MTTR state | resolved vs open conveyed by TEXT ("Not yet resolved" / the duration) + `data-mttr-state`, never colour/shape alone; open state has a visible "Not yet resolved" text node (fixture) |
| S13-3-A11Y-6 | Target size | row activation hit box ≥ 24×24 CSS px; close button ≥ 24×24 (`getBoundingClientRect`) |

### Visual-structural / no-reflow (DEFECT-006 idiom)

| ID | Case | Expected |
|----|------|----------|
| GEO-S013-3-1 | Drawer is a pure overlay (no reflow) | defects-panel bbox + tree-rail bbox + `documentElement.scrollHeight` byte-identical drawer-closed vs drawer-open (fixed, portalled, zero flow height — DEFECT-006 / GEO-S005-3b invariant) |
| GEO-S013-3-2 | Drawer on-screen, anchored | open drawer bbox within the viewport (no new horizontal scroll); its left edge sits right of the defects-panel content (no illegible overlap) |
| GEO-S013-3-3 | Record sections STACK | within `defect-detail`, field section headings have monotonically increasing tops + shared left offset (readable record, not an inline run) |
| GEO-S013-3-4 | MttrCard timeline order | resolved state: `mttr-reported` precedes `mttr-recovered` geometrically (order = meaning) |

### Figure legibility (checklist)

| ID | Case | Expected |
|----|------|----------|
| S13-3-FIG-1 | MTTR carries a unit | DEFECT-001 (`mttr_s=815`) MttrCard figure matches `/\d+\s*(h\|min\|s)/` ("13 min" / "13 min 35 s"); never bare "815"; `data-mttr-seconds` ≈ 815 |
| S13-3-FIG-2 | Open ≠ MTTR ≠ zero | OPEN fixture (`mttr_s/recovered_ts=null`): recovered slot = "Not yet resolved"; running figure is "open for …"/"—", NEVER "0"/"0 s"/"null", and NEVER labelled "MTTR"; no crash/console error |
| S13-3-FIG-3 | Timestamps human-readable | reported/recovered cells contain a recognisable date-time (date + UTC clock), not a raw epoch/opaque token; defect id+title is the drawer-heading context |
| S13-3-FIG-4 | Fix shas as code refs, with context | each `fix_sha` token a `<code data-testid="defect-fix-sha">` under "Fix"/"Resolution"; DEFECT-001 shows "3d8c21c" AND "82a622c"; `fix_sha=null` (DEFECT-009/011/012) → "—", never blank/fabricated |
| S13-3-FIG-5 | Absent fields render "—" | any null field (DEFECT-011 `severity=null`, an absent root_cause) renders "—"/"Not recorded", never blank/raw "null"/a thrown error |
| S13-3-FIG-6 | Markdown rendered, not raw | DEFECT-001 `actual` ("**0 for everything**") shows bold via real `<strong>`; visible text nodes contain no literal `**`/`##`; body has real HTML elements |
| S13-3-FIG-7 | Source ref to provenance | `defect-detail` and `mttr-card` carry non-empty human-meaningful `data-source` (`.md` file for the record; `ledger.csv#ref=<id>` for the MTTR span) + a visible "↗ source" caption (EXP-033/DEFECT-005 lineage) |

### Selector contracts (build hooks; tester selects on these)

| Element | Primary selector (a11y) | Test-id | Extra |
|---|---|---|---|
| Row activation | `getByRole('button', { name: /DEFECT-\d+.*<title>/ })` (or row + Enter) | `defect-row` (reused) | `data-defect-id` (continuity), `data-active`/`aria-expanded` |
| Defect drill drawer | `getByRole('region', { name: /defect: DEFECT-\d+/i })` | `defect-drill` | `data-defect-id` |
| Drawer heading | `<h2>` "<id> — <title>" | `defect-drill-heading` | `tabindex="-1"` |
| Drawer close | `getByRole('button', { name: /close defect/i })` | `defect-drill-close` | — |
| Record body | within drawer | `defect-detail` | `data-source`, fields `data-field` |
| Fix sha | `<code>` under "Fix" | `defect-fix-sha` | one per sha; "—" when null |
| MTTR card | `getByRole('group', { name: /MTTR/i })` | `mttr-card` | `data-source`, `data-mttr-state` |
| MTTR figure | within card | `mttr-figure` | `data-mttr-seconds` (raw cross-check) |
| Reported / recovered | within card | `mttr-reported` / `mttr-recovered` | — |

`data-defect-id` is the row→drawer continuity contract. No `nth()`,
no count-derived, no text-exclusion selectors.

---

## Out-of-scope guard

The following must NOT be present in the delivered slice (they are explicitly out
of scope and would constitute scope creep):
- Any write affordance in the UI (create/edit/delete defect)
- DEF- entries added to items.csv
- MTTR trend charts or aggregate quality metrics panels
- Cross-project defect aggregation
- Source-events reveal pattern on MTTR figures (follow-on slice)
