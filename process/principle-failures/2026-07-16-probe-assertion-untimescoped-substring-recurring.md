# Principle failure (RECURRING, 3rd hit): live prod-probe assertions substring-match a bare `OperationQualifier` without scoping by `TimeType`, so a new EST twin false-fails an ACT assertion

**Date:** 2026-07-16
**Project:** AdixOut
**Agent:** tester (authors + hits the probes)
**Principle:** "Plan from the change map, then validate" / validation-as-code
(tester role) — an assertion must encode the CONTRACT it means, not an incidental
substring; a recurring root cause is a system failure to smooth it (§5b).
**Prior entries (same shape):** UC-ADIX-011 validation fixed one stale probe
assertion (commit `5663967`); UC-ADIX-012 validation fixed
`probe-resync-arrival-timing` check R4 (commit `f3505be`); earlier arrival-timing
probes carried the same latent shape.

## What happened (recurrence, now 3x)
AIDX models an `OperationTime` as a `(OperationQualifier, TimeType)` TUPLE — the
same qualifier appears as multiple TWINS distinguished only by `TimeType`
(`ELDT` = `OperationQualifier="TDN"` with `TimeType="EST"`, its actual twin
`OperationQualifier="TDN"` with `TimeType="ACT"`; `EIBT` = `OperationQualifier="ONB"`
`TimeType="EST"` vs `"ACT"`). Live prod-probe assertions were authored to check a
milestone by substring-matching the qualifier ALONE — e.g. an ACT assertion of the
shape `includes('OperationQualifier="ONB"')` / `includes('OperationQualifier="TDN"')`
with no `TimeType` scope.

During REQ-003 (the AIDX predictive/take-off milestone work) the EST twins
(ELDT = `TDN`/`EST`, EIBT = `ONB`/`EST`) were newly SHIPPED into the same emitted
message. The moment the EST twin appeared, a bare-qualifier assertion meant for the
ACT twin matched the wrong (or now-ambiguous) element and FALSE-FAILED — the probe
went red though the product was correct. It reads exactly like rework/CFR, but it is
a TEST ARTIFACT, not a product defect.

## Fallback taken (each occurrence)
- UC-ADIX-011: rewrote the one stale assertion to scope by the `(qualifier, timeType)`
  tuple (commit `5663967`), re-ran green.
- UC-ADIX-012: fixed `probe-resync-arrival-timing`'s R4 check the same way — scope the
  arrival-timing assertion to its specific twin (commit `f3505be`), re-ran green.
- Each cost the tester a re-run + probe-fix cycle that surfaces in the metrics looking
  like a validation rejection, but no product code was wrong.

## Root cause
Probe/acceptance authoring never encoded that an `OperationTime` is IDENTIFIED by the
`(OperationQualifier, TimeType)` tuple, not the qualifier alone. A bare-qualifier
substring assertion is correct only while exactly one twin of that qualifier exists;
it is a latent false-fail that fires the instant a second twin (the EST predictive
milestone) ships alongside the actual one — which is precisely what conformance-
completeness work does.

## Remedy (this retro)
Folded into `tester.md` as a STANDING practice (plain agent practice, no experiment
row): any probe or acceptance assertion checking an AIDX/event `OperationTime` — or
any element keyed by a code + qualifier — matches the FULL identifying tuple (for
`OperationTime`, `(OperationQualifier, TimeType)`), never a bare-qualifier substring;
and an omission assertion asserts the SPECIFIC twin is absent, not the qualifier. This
is a deterministic authoring rule, so it routes as practice, not as a falsifiable
experiment.
