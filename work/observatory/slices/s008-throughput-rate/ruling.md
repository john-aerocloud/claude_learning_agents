---
defect: DEFECT-007
ruling-by: product
date: 2026-06-10
status: RULING — binding on engineer + ui-designer
supersedes: DEFECT-004 §1 (throughput as count — overturned)
applies-to: s004-value-stream-map (StageNode/StageMetric), /stage-flow endpoint
---

# DEFECT-007 — Product ruling: throughput is a RATE

## Economic decision

The DEFECT-004 ruling argued "no reliable per-stage denominator exists."
That was wrong. The ledger timestamps give exactly the denominator DORA
deploy-frequency already uses: distinct active-days. The operator has flagged
the label twice. Continuing to call a count "throughput" misleads. The fix is
cheap (one new computed field in the aggregator, one label change in the UI)
and the benefit — a dimensionally honest label that answers "of what per what"
— is immediate and permanent. This is not an optional polish: "throughput"
names a rate by definition; showing a count under that word is a semantic defect.

---

## 1. Throughput rate — exact definition

**Throughput for a stage = items that entered the stage (tpIn events) per
active-day, over the span of those same contributing rows.**

### Numerator
The count of tpIn events for the stage — the existing `throughput` integer.
This is unchanged: `aggregateStageFlow` already computes it correctly.

### Denominator — active-days
`active_days` = the number of DISTINCT CALENDAR DATES (UTC date, `YYYY-MM-DD`)
of the timestamps of the contributing rows for that stage (the rows already
collected in `sourceByRef`). This is exactly the convention `dora.py` uses for
deploy-frequency (line 86: `days = {parse_ts(r["timestamp"]).date() for r in
rows ...}`) and for queue throughput (line 173: `days = {t.date() for t in
deqs}`). The two computations are on the same basis — the map is coherent with
baseline.md.

If `active_days = 0` (no contributing rows at all) → `throughput_per_active_day
= null` (not 0, not a division-by-zero artefact; the UI shows "—").

### Formula
```
throughput_per_active_day = throughput / active_days   (float, 2 dp)
                          = null                        (when active_days = 0)
```

---

## 2. API — /stage-flow field additions

The engineer adds TWO new fields to every stage entry in the `/stage-flow`
response. The existing `throughput` field (the raw integer count) is KEPT but
renamed for clarity:

```ts
type StageFlow = {
  // EXISTING — rename for semantic clarity (count, not rate):
  throughput: number;               // raw count of tpIn events (unchanged semantics)

  // NEW — rate fields:
  throughput_per_active_day: number | null;  // throughput / active_days; null when active_days=0
  active_days: number;                       // distinct UTC calendar dates of contributing rows
                                             // (0 when stage has no events)

  // all other existing fields unchanged (dwell_median_s, dwell_pairs, wip, rework,
  // wip_items, source_rows, source_events, source_total, queue_depth, queue_items, etc.)
};
```

The field `throughput` remains: it is the raw count used in the source/hover
panel ("13 items total"). Do NOT remove it. The headline display switches to
`throughput_per_active_day`.

---

## 3. UI label and format rules

### Headline display (StageMetric "Throughput")
The `StageMetric` component's `value` prop for throughput must render the RATE,
not the count:

| Condition | Rendered value |
|-----------|---------------|
| `throughput_per_active_day = null` (0 active days) | `—` |
| `throughput_per_active_day = 0` (events exist but 0 rate, impossible by definition — guard only) | `0 items/day` |
| `throughput_per_active_day >= 1` (round to 1 dp if not whole; whole if `.0`) | `6 items/day` or `6.5 items/day` |
| `throughput_per_active_day < 1` (e.g. 0.3) | `0.3 items/day` (never drop the decimal; never show `<1 items/day`) |
| Singular `= 1.0` exactly | `1 item/day` (singular "item", not "items") |

Format rule summary: `N items/day` where N is the rate formatted to the minimum
decimal places needed (drop trailing `.0`; keep one decimal if non-integer). The
unit `/day` is always shown — it is what makes this a rate.

### Secondary / source line (MetricSource tooltip or hover panel)
The count and window remain available in the source/hover reveal:

```
13 items over 2 active days  (6.5 items/day)
```

or when `active_days = 0`:

```
0 items (no active days in window)
```

The accessible name of the stage node MUST include the rate, not the count:

```
<label> stage, throughput 6.5 items/day, dwell ..., ...
```

Updated pattern for accessible name (supersedes DEFECT-004-AC-7 for the
throughput token):

```
/<label> stage, throughput [\d.]+ items?\/day, dwell .+/
```

---

## 4. Audit of other per-stage figures

Reviewing the DEFECT-004 §2 unit table against dimensional honesty:

| Figure | Field | Current label | Unit honest? | Verdict |
|--------|-------|---------------|--------------|---------|
| Throughput | `throughput` | "N items" | NO — rate word, count label | FIXED by this ruling |
| Dwell | `dwell_median_s` | humanised: "12m", "3h", "—" | YES — time unit always shown | OK |
| WIP | `wip` | "N in-flight" | YES — count with qualifier | OK |
| Queue depth | `queue_depth` | "N queued" | YES — count with qualifier | OK |
| Rework | `rework` | "N rework" | YES — count (rework is a count, not a rate; "rework" is the noun) | OK |
| Queue wait (per item) | `wait_s` | humanised: "4h", "45m" | YES — time unit always shown | OK |

No other figure has a rate/count mismatch. Dwell is already dimensionally
honest. Rework is correctly a count (it names events, not a frequency; if we
ever want rework RATE, it needs its own field — not in scope here). The only
broken figure was throughput.

---

## 5. Acceptance conditions

**D7-AC-1 — Throughput headline is a rate with unit**
Every `[data-metric="throughput"]` element's visible text matches
`/[\d.]+ items?\/day|—/`. No text matching `/^\d+ items?$/ ` (bare count with
no `/day`) may appear as the headline throughput value.

**D7-AC-2 — Rate value is computable and correct**
For a fixture stage with N tpIn events spread across D distinct calendar dates,
`throughput_per_active_day = N / D` (float, within 0.01 tolerance). Verified
via: `GET /api/projects/<fixture>/stage-flow` response JSON.

**D7-AC-3 — active_days field present and correct**
`/stage-flow` response includes `active_days: number` on every stage. For a
stage with 0 events: `active_days = 0`. For a stage with events on 2 distinct
dates: `active_days = 2`. `throughput_per_active_day = null` when
`active_days = 0`.

**D7-AC-4 — Raw count still accessible in source panel**
Hovering / expanding the throughput metric reveals text matching
`/\d+ items? over \d+ active days?/` (e.g. "13 items over 2 active days").
The count is not lost — it is the numerator of the rate shown there.

**D7-AC-5 — Singular/plural correct**
Rate exactly 1.0 → "1 item/day". Rate != 1.0 → "N items/day".
Rate null → "—".

**D7-AC-6 — Accessible name carries rate (supersedes D4-AC-7 for throughput)**
Stage node accessible name matches:
`/<label> stage, throughput [\d.]+ items?\/day/`
(or `throughput —` when `active_days = 0`).

**D7-AC-7 — Basis coherence with baseline.md**
The active-day denominator for the engineer stage must equal the number of
distinct UTC calendar dates of `task_start` rows for `agent=engineer` in the
live `process/dora/ledger.csv`. The tester hand-checks: count distinct dates in
`grep 'engineer,task_start' ledger.csv`; value must equal `active_days` in the
`/stage-flow` engineer stage response.

---

## 6. Explicitly NOT ruled here

- Visual formatting beyond the text rules above (pill shape, colour, size) —
  ui-designer territory.
- Whether to add a stage-level throughput RATE to `baseline.md` / `flow.md` as
  well (that is a dora.py concern — a separate improvement, not in scope).
- Rework rate (rework events / items, or / active-day) — rework is currently a
  bare count and is correctly named as such. If a rework-rate metric is wanted,
  it is a new field, not a rename.
- Per-stage throughput trend over time (sparklines, time-windowed slices) —
  future enhancement, not part of this fix.
