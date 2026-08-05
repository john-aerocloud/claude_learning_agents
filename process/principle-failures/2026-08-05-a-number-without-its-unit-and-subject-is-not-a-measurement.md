# 2026-08-05 — a number without its unit and its subject is not a measurement

**Project:** OagEventSource · **Retro:** incident-triggered (§F8, `DEFECT-OAG-054` prod-defect
resolve) · **Constraint:** `queue` 47.18% of GLT

## The failure, in one line

Fourteen separate numbers were reported, believed, and acted on **without stating what they
counted**. Every one read as authoritative. Four were mine.

## The instances

**Unit unstated — a count of X read as a count of Y**

| number | reported as | actually |
|---|---|---|
| 5,135 RSW arrivals/month | flights | **streams** — codeshares split one aircraft across up to **8** |
| `UC-NCI1` 37 stuck | flights | streams |
| `DEFECT-OAG-051` 85 | flights | streams |
| 98 damaged streams | — | streams (correct, but read as flights downstream) |
| ~250 lost RSW arrivals | flights | streams |

The owner caught this one: *"the RSW numbers are double counted."* They were right, and the
correction factor (**2.08**, histogram to 8, 16 unclusterable) had already been measured by
`UC-BPC1` and sat in a committed view. I quoted a stream count as a flight count **in the same
session in which the reproduction had just proven the two differ**.

**Subject unstated — a measurement whose referent was assumed broader than it was**

- **"43,744/43,744 — one `OagFlightCreated` per stream"** was cited for weeks as evidence the OCC
  race was not firing. It was **true, and about the wrong axis**: corruption lived entirely on the
  change path above position 0, where nothing looked. 98 streams were damaged the whole time. The
  genesis check was correct and *still is* — that is what made it dangerous.
- **"Adapter tier green — 136 tests against real DynamoDB Local"** was reported by several agents.
  `make ddb-local-up` bound `:8000`, which AdixOut's container also holds, so the claim could have
  been about **another project's database** — and **no report recorded the port**, making the good
  runs indistinguishable from the compromised ones after the fact (`DEFECT-OAG-059`).
- **"Two matching 98/98 scans prove the fix is holding."** Mine. At a measured 1 incident per
  ~26,800 events, agreement across ~6,700 new items was **93% likely even if the fix did nothing**.
  I asserted evidence from a sample too small to carry it.

**Controls that existed, were believed, and did not fire** (the same disease, one layer down —
each is a number-or-verdict whose subject was "the system" when it was really "nothing")

`render-diagrams` skipped in **8 of 8** runs while reported as a blocking gate (mine) · the
liveness limb `aerobus-route-liveness` wired into **no workflow**, while delta-056 claimed it
"would have flagged the defect within 15 minutes" · the board acceptance parser matching
`## Acceptance criteria` when every item writes `## Acceptance`, so a 10-AC defect projected as
**0** and a 13-AC use-case went to the board labelled `needs-acceptance` **while being set Done** ·
the WIP cap declared for `deploy` while the derived queue is `wip`, enforced nowhere · **14**
`logging.retention` declarations the Landing Zone Accelerator overwrites 32 seconds after every
deploy · `impacted-tests` scraping mermaid label prose (`a`, `an`, `the`, `each`) as graph nodes,
inflating its uncovered list to 70 · `make prod-validate-oag` reporting **"42 passed"** while the
prod Function URL returns 403 to its unsigned fetch and the specs soft-skip · a key-separation
check that would have reported *"separation confirmed"* while the same key sat in both secrets ·
the prefix-violation detector firing **four times** on AA2706 at ingest, logged `data-4xx`, events
appended anyway, unalarmed · `provenance.deliveryMode` a hardcoded `'replay'` across **2.73M**
events, which nearly produced a wrong root cause.

## Why it recurred despite §17d and §17e

§17d says a test validates a requirement. §17e says a red gate is a defect with an owner. **Neither
says anything about a number that is neither a test nor a gate.** A count in a report, a figure in
an item note, a population in a census — these are the most-cited artefacts in the system and the
least governed. So the rules were satisfied while the evidence base rotted.

The counter-example proves the point: the census's `complete: false` guard **refused to report a
partial `0/0`** — twice for one engineer, once for me — because it was built to state its own
subject ("this is not the store"). That is the only control today that behaved correctly under
stress, and it is the pattern.

## The rule (routed to §17f)

**A reported number must carry its unit and its subject, and a gate must be observed executing.**
Specifically: a population declares `streams` vs `physicalFlights`; an invariant declares the axis
it measures and does not stand in for axes it does not; an "against real X" claim names the X it
reached; and a sample-based claim states what the result would have been under the null. A bare
count is the defect.

## What did NOT go wrong, worth recording

The refusals held. The heal-forward engineer healed 2 of 8 and **refused the other 6** rather than
overwrite a completed flight's state — delta-059's "a filled gap is strictly worse than the gap"
applied to a milestone. It then declined to fire `fixed` on a 2-of-8 result. The wire-literal
engineer refused to promote a ledger entry on wire evidence without the read path, and the read
path turned out **not** to reach the field. The tester refused a synth plan as authority for
AC-054.3 and asserted deployed state instead. Every one of those was a correct refusal against an
instruction that would have accepted less.
