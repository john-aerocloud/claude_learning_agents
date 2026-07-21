# Fake-contract recurrence: core pipeline validated against a secondary representation, not the real captured message (DEF-ROC-003)

**Date:** 2026-07-21 · **Project:** ROC · **Class:** fake-contract / core-slice-false-done (recurring)

## What happened

ROC's entire ingestion pipeline (SLC-ROC-001…005: Service Bus → forwarder →
Event Hubs → consumer → Jira) was built and validated against a **top-level
PascalCase** message shape derived from `PPSM-TEST-DeviceData.csv` — a **DB/CSV
column capture**, a *secondary projection* of the data. The **real** PPSM bus
sends a **MassTransit `AOS.Contracts:DeviceDataEvent` envelope** with the device
payload nested lowercase under `body.message.*`. `normalise()` read only the
PascalCase top level, so every real message returned `null` → malformed → **no
alert**. The pipeline was "deployed green" in AAS test, but the smoke check only
verified Service Bus *connectivity*, never message *processing* — so a core-J1
false-done survived all the way to a live deployment. Caught only when the
REQ-ROC-002 replay injector was fixtured against the **real** captured `.xlsx`
(a Service Bus peek export) under the engineer's real-source-fixture discipline.

## Recurring root cause (now 2 incidents this session)

Both this-session defects are the same class — *validation that doesn't exercise
the real thing*:
- **DEF-ROC-002** — fast test runner (vitest/esbuild) skipped type-checking → a
  type-broken build shipped green. Fixed by the v89 **tsc gate** (which then
  scored POSITIVE — it caught a real error in the DEF-ROC-003 fix that vitest
  passed).
- **DEF-ROC-003** — core contract assumed from a **secondary representation**
  (CSV capture) instead of the real on-the-wire message → pipeline never worked
  on real data.

Common root: a slice was declared done/deployed against a **convenient stand-in**
(a fast transpile-only test; a sibling CSV) rather than the real artifact.

## Fix (routed)

- **Solution-architect agent** (`.claude/agents/solution-architect.md`): when a
  slice CONSUMES an external contract we don't own, the delta must pin a **REAL
  captured sample of the exact wire shape** (not a DB/CSV/export projection, not
  synthetic), obtained at design time, and make "a real captured message
  parses/classifies end-to-end" the slice's fitness function. The wire shape is
  part of the architecture delta, established from reality before build.
- The engineer's real-source-fixture discipline (v61) already WORKS — it is what
  surfaced DEF-ROC-003 — so no engineer change; the gap was upstream (architecture
  assumed the shape). No new experiment row (this is a defect-preventing fix).

## Targets / recurrence check

Targets **CFR / MTTR** (fewer escaped core-contract defects). Next retro: confirm
no core ingestion slice is validated against a secondary/synthetic contract when a
real captured sample is obtainable. Related: [[2026-07-17-tsc-typecheck-not-in-fast-loop-false-green]].
