---
slice: s003
slug: dora-panel
process-ref: §8 NFRs (fidelity + traceability) + §9 CHK-3 acceptance
---

# Acceptance — s003: DORA panel + stage cards + time-thief view

## CHK-3 done-condition checklist

The following are the §9 CHK-3 acceptance criteria, cross-referenced to the UCs
that satisfy them.

| # | §9 acceptance criterion | UC | Test type |
|---|------------------------|----|-----------|
| C1 | Four DORA metrics + windows from `baseline.md` visible | UC2 | Vitest (unit) + Playwright (e2e) |
| C2 | Per-agent modal/median/mean task times from `baseline.md` visible | UC3 | Vitest (unit) + Playwright (e2e) |
| C3 | Time-thief ranking from `flow.md` visible | UC4 | Vitest (unit) + Playwright (e2e) |
| C4 | Each figure links to its source file | UC5 | Vitest DOM scan + Playwright DOM scan |
| C5 | Constraint (ToC) highlighted | UC3 | Vitest (unit) + Playwright (e2e) |

---

## §8 NFR acceptance (fidelity + traceability)

These are the non-functional requirements that CHK-3 must satisfy per §8.

### Fidelity (numbers must match the computed artifacts)

- **F1:** The value rendered for gross lead time MUST equal the value in
  `process/dora/baseline.md` `## Four key metrics` table `Gross lead time` row.
  Verified by: AC1.1 (unit parse fixture) + AC2.5 (Playwright read-compare).
- **F2:** All nine agent task-time values (modal/median/mean) MUST equal the
  values in `baseline.md` `## Per-agent task completion` table.
  Verified by: AC1.5, AC1.6, AC3.2 (unit parse fixture).
- **F3:** All time-thief rows MUST equal the rows in `flow.md` `## Time thieves`
  table. Verified by: AC1.9, AC4.1, AC4.2 (unit parse fixture).
- **F4:** No metric, time value, or thief value is rounded, reformatted, or
  invented by the UI — raw strings are preserved. Verified by the string-equality
  assertions in AC1.1–1.9, AC2.1, AC3.2, AC4.1–4.2.

### Traceability (every figure links to its source file + row)

- **T1:** Every rendered DORA metric value has `data-source` containing the
  source file path and section anchor.
  Verified by: AC2.3, AC5.1, AC5.2.
- **T2:** Every rendered stage-card time value has `data-source`.
  Verified by: AC3.5, AC5.1.
- **T3:** Every rendered time-thief row has `data-source`.
  Verified by: AC4.3, AC5.3.
- **T4:** Zero rendered figures lack a `data-source` attribute — verified by DOM
  traversal with count-of-missing = 0 assertion.
  Verified by: AC5.1 (Vitest), AC5.4 (Playwright).

---

## Resilience acceptance (§8 NFR + SM7)

- **R1:** When `process/dora/baseline.md` is absent → DORA panel shows empty-state;
  stage cards show empty-state; no crash; no 500. Verified by: AC1.7, AC2.2, AC3.6.
- **R2:** When `work/<project>/dora/flow.md` is absent → time-thief view shows
  empty-state; no crash. Verified by: AC1.10, AC4.4.
- **R3:** When `baseline.md` has no parseable metric table (partial content, e.g.
  only the constraint line is present) → metrics null; no crash. Verified by: AC1.8.

---

## Live-refresh acceptance (SM6)

- **L1:** After `baseline.md` changes on disk, the DORA panel and stage cards
  re-render within 2000ms without manual reload. Verified by: AC6.4.
- **L2:** After `flow.md` changes on disk, the time-thief view re-renders within
  2000ms. Verified by: AC6.4 (extended to flow.md path).
- **L3:** Unrelated file changes do not trigger a baseline or flow re-fetch.
  Verified by: AC6.3.

---

## Read-only acceptance (§2 + SM8)

- **W1:** The SPA makes zero POST/PUT/PATCH/DELETE requests during all
  CHK-3 interactions. Verified by: Playwright network-tab assertion in
  `dora-panel.spec.ts` (network intercept with method filter).

---

## Accessibility acceptance (§8 NFR — inherited + extended from s002)

- **A1:** The constraint highlighted stage card carries non-colour state encoding:
  visible text label + `data-constraint="true"` attribute.
  Verified by: AC3.3.
- **A2:** Empty-state messages for absent `baseline.md` / `flow.md` are rendered
  as accessible text (not empty/invisible containers). Assert `textContent` is
  non-empty. Verified by: AC2.2, AC3.6, AC4.4.
- **A3:** Keyboard navigation reaches the DORA panel, stage cards, and time-thief
  view sections (via heading structure or landmark regions).
  Verified by: Playwright tab-navigation test in `dora-panel.spec.ts`.

---

## Accessibility acceptance (CHK-3 — co-authored by ui-designer, ui-design.md §5)

WCAG 2.2 AA, assertion-ready. Never colour-only — assert text / aria / geometry.

- **G-A1:** DoraPanel, StageCardGrid, TimeThiefView each render `role="region"`
  with a unique `aria-label` AND a visible `<h2>`. (3 new regions + 3 headings.)
- **G-A2:** Each MetricCard value is announced with its label context (label text
  adjacent + accessible name includes the label) — no bare number.
- **G-A3:** The four MetricCards form a `role="list"` of 4 `role="listitem"`.
- **G-A4:** Stage-card modal/median/mean each carry a visible label; a no-data
  value ("—") renders as literal text `"—"`, not blank.
- **G-A5:** The constraint StageCard has `data-constraint="true"` AND a visible
  element with text "constraint" AND the `◆` glyph; all other cards
  `data-constraint="false"` with no "constraint" text. (Generalises AC3.3.)
- **G-A6:** Empty-state elements (baseline/flow absent) have non-empty `textContent`.
- **G-A7:** Each SourceLink caption contains visible text "source" (the `↗` is
  `aria-hidden`) — identifiable without colour.
- **G-A8:** Contrast — metric value/label ≥ 4.5:1 on `--c-surface`; window line
  (`--c-text-dim`) ≥ 6:1; source caption ≥ 4.5:1; constraint border ≥ 3:1.
  axe scan: zero contrast violations.
- **G-A9:** No new interactive controls (read-only); tab order unchanged from
  s002; tabbing does not land inside static figures. (Playwright.)
- **G-A10:** Under `prefers-reduced-motion: reduce`, UC6 live value swaps are
  instant (transition-duration collapses to 0).

## Visual-structural / geometry acceptance (CHK-3 — ui-design.md §5)

Shape carries meaning; presence tests are not enough. Assert via computed style /
bounding-box geometry (the "board-is-a-line" guard).

- **G-G1:** DoraPanel — at desktop width the 4 MetricCards do NOT all stack
  vertically; ≥ 2 cards share a top offset (≥ 1 row holds ≥ 2 cards).
- **G-G2:** StageCardGrid — with 9 cards, container computed `display: grid`;
  cards occupy > 1 distinct top offset AND > 1 distinct left offset (a real grid),
  NOT a 9-tall column and NOT a 9-wide line.
- **G-G3:** TimeThiefView — thief rows have monotonically increasing top offsets
  AND a shared left offset (vertical ranked list), NOT a horizontal row.
- **G-G4:** Each CHK-3 region's top offset > PipelineMap region's bottom (map not
  overlapped); order by top offset: DoraPanel < StageCardGrid < TimeThiefView.

## Acceptance case index (by UC)

| AC | UC | Description | Test type |
|----|----|-------------|-----------|
| AC1.1–1.10 | UC1 | Baseline + flow markdown parser correctness and resilience | Vitest unit |
| AC2.1–2.5 | UC2 | DoraPanel render: metrics present, empty-state, data-source | Vitest/jsdom + Playwright |
| AC3.1–3.7 | UC3 | StageCards render: agent times, constraint highlight, data-source | Vitest/jsdom + Playwright |
| AC4.1–4.6 | UC4 | TimeThiefView render: thief rows, data-source, empty-state | Vitest/jsdom + Playwright |
| AC5.1–5.4 | UC5 | Zero-missing data-source DOM traversal (unit + e2e) | Vitest/jsdom + Playwright |
| AC6.1–6.5 | UC6 | SSE live refresh: path-selective re-fetch + 2s timing | Vitest/jsdom + Playwright e2e |
