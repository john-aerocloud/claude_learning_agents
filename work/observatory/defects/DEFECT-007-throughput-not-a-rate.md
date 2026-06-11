# DEFECT-007 — "throughput" shows a bare count, not a rate ("of what per what?")

**Reported:** 2026-06-10 · **Status:** CLOSED (fixed + verified) · **Severity:** MED (comprehensibility on the CORE view; 2nd report on throughput units)

## Resolution
Product re-ruled throughput = items per active-day (distinct UTC dates of contributing rows, matching dora.py/baseline). Engineer (sha 1e403a2/50bcd43): `/stage-flow` adds `active_days` + `throughput_per_active_day`; headline shows `6.5 items/day` (format rules for 1.0/<1/null); raw count demoted to hover ("13 items over 2 active days"). 467 unit + 44 browser green. Verified live :5173 (after controlled restart): engineer 6.5 items/day, active_days 2 == distinct ledger dates. Gap → ui-designer.md "figure legibility checklist" + EXP-033 (4th data point of the data-shown-but-not-human-meaningful class: 004 units / 005 row:N / 007 rate / 008 note).

## Four fields
- **Expected:** "Throughput" reads as a complete rate — answers "of WHAT per WHAT" — e.g. `items / day` (a flow rate, matching the meaning of the word "throughput").
- **Actual:** shows "Throughput: 13 items" — a bare cumulative COUNT with no per-time dimension. "Throughput of what per what?"
- **Intent:** read each stage's throughput and understand the flow RATE.
- **Importance:** "throughput" names a rate; showing a count under that label misleads. The operator has flagged it twice.

## Reproduction (confirmed, live :5173)
`StageNode` renders `StageMetric label="Throughput" value={throughputLabel(n)}` → "13 items" (DEFECT-004 AC-1: `throughputLabel` = count + "items"). `/stage-flow` has NO window/rate field. So the figure is a count mislabelled as throughput.

## Classification (§5a)
Our bug — product/UX semantics. The DEFECT-004 product ruling chose "count labelled 'items'" arguing "no reliable per-stage window denominator." That was wrong: the ledger timestamps give an active-days window — DORA deploy-frequency already uses exactly that ("7 /active-day").

## Root cause (latent)
A metric whose NAME denotes a rate ("throughput", "frequency") must carry a per-time unit; if it's only a count it must be RENAMed (e.g. "Completed", "Items through"). The earlier ruling mislabelled a count as throughput and wrongly claimed no denominator existed. (2nd data point on the "units must be dimensionally honest / match the metric name" theme — EXP-033.)

## Fix
Re-rule (product): throughput becomes a real RATE — **items per active-day** (active-days computed from the contributing rows' timestamp span, same basis as DORA deploy-frequency), labelled with the time unit (e.g. "6.5 items/day"); the raw count stays available (hover/source or a secondary). `/stage-flow` gains the window (active-days) so the rate is computable + traceable. Engineer implements; ui-designer polishes the label. Re-check live: every throughput reads as "<n> items/day", answering "of what per what". [sha + prod re-check on close]
