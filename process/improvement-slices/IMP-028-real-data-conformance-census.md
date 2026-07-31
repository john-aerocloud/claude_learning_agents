# IMP-028 — The real-data conformance census: every emittable type and every sequence branch exemplified from REAL data

**Status:** QUEUED (2026-07-31, OagEventSource v125 retro — human-requested retro on the TEST PROCESS).
**Owners:** engineer (builds the census + harvester), cicd (wires the lane + the refresh cadence),
tester (consumes it as the validation oracle), solution-architect (routing-key completeness).
**Founding evidence:** five capabilities read `done`/`validated` while never once working on real
data — `OagFlightCancelled` (0 of 10,519,584 events), `departure.scheduledTimeUtc` (78% null, never
read), `irregularOperationType='Recovery'` (0 captures), `OagFlightDiverted` (0 of 5,300,655), and
`deriveAirports()` structurally unable to route a diversion airport. Plus DEFECT-OAG-044 (a prod
smoke that INJECTED its own synthetic input) and the UC-HF041 dry-run below.

## Why this exists (the one-line case)

A **dry-run against real REST data** for TPA/RSW/SRQ over 28 days found the work-item's own stated
premise was FALSE in one pass: the lane would write **1,005** events, not the 361 cancellations
predicted; **644 (64%)** were collateral field-diffs nobody forecast; it would have **minted 274
historical flights into prod as if new**; and it would have **fabricated a retention-based residual**
from an un-measured horizon, quietly excusing 361 flights. Reasoning, review, TDD and a 1,525-test
green suite found none of it. **Running it against real data found all of it, immediately.** That is
the whole argument for moving real-data exercise from the END of the process into the MIDDLE of it.

## The three questions nobody was asking

Every test we own runs ONE direction: *code → expectation*, over inputs we authored. All five
failures are the two inverse directions, plus a third about the artifact:

| # | Direction | The question | Which failures it catches |
|---|-----------|--------------|---------------------------|
| **D1** | code → data (**liveness**) | For every output we can emit, has reality EVER produced it? | Cancelled (0/10.5M), Diverted (0/5.3M), Recovery (0 captures) |
| **D2** | data → code (**coverage**) | For every field reality SENDS, does our code read it — and does it populate a leaf? | `scheduledTimeUtc` (present in all 109 captures, read nowhere), `diversionAirport` (documented, read nowhere) |
| **D3** | gate → artifact (**identity**) | For every gate that passed, did it read the bytes we SHIPPED? | the stale-bundle hole; bundle-diff red on the app lane while `infra.yml` deployed that same sha to prod |

D1 and D2 are cheap population queries over data we already hold. Neither existed.

## Confirmed ground truth (measured 2026-07-31 — build against these, not against assumptions)

- **`make wire-provenance` DOES NOT EXIST** anywhere in the project. It lives only as an aspiration in
  `process/open-items.md` and `cicd.md`. There is no push gate on wire provenance at all.
- **Corpus = 132 `.json` under `<project>/fixtures/`**: `oag-raw-retry/` 82 (real), `oag-raw-changeind/`
  23 (real), `oag-version-coverage/` 11 (**derived** from one real body), `oag-master-data/` 7,
  `oag-schedule-dlq/` 6 (2 real + **4 synthetic**), `oag-raw/` 4 (real), `oag-doc-samples/` 2 (**vendor
  doc samples**), `oag-rest/` 2, `prod-capture/` 1 (**the only real prod event-store read**),
  `live-capture/` 1 (a dev config dump, not an OAG body).
- **The 041 literal ledger's sweep is provenance-blind**: an undiscriminated recursive walk of every
  `.json`, harvesting every string/number at every depth into a flat `Map<key, Set<value>>`. Its
  docstring's word "real" is false. **The fix already exists in its sibling** — the 042 field ledger
  filters `if (!dir.startsWith('oag-raw')) continue` — and was never back-ported. Phase 0 supersedes
  both with a marker the gate actually reads.
- **Markers exist and nothing gates on them**: 110 files carry `_capture`, 5 carry `_provenance`
  (explicitly derived), **17 carry neither** — including all 4 `oag-schedule-dlq/synthetic/*.json`.
  No test reads either marker as a gate. This is the product's own defect reproduced in its test
  substrate: real provenance data present, never read.
- **Completeness hole is live**: `CORPUS_CONFIRMED` is a hand-maintained inline array linked to
  production code by a free-text `comparedIn` string, so a new literal with no entry is invisible.
  `diversionType` has **no declaration at all** — neither confirmed nor declared-unverified.
- **One genuine committed prod oracle already exists and runs nowhere**: `make probe-ingest-scope` →
  `infra/scripts/probe-ingest-scope.sh` (git-tracked, read-only Query on `OagFeed-EventStore` +
  Logs Insights, exits non-zero on the scope leak). It is hand-run and in no workflow. **Phase 1 should
  extend this script's shape rather than start from scratch.**
- **The load-bearing prod measurement is a docstring**: `declared-prod-ingest-scope.test.ts` cites a
  1,160,377-row scan / 8,000-event sample, but imports no AWS SDK and makes no network call — it pins
  the declared constant, not prod reality, and the query that produced the number is not committed
  anywhere. Phase 1 must make this class of number reproducible.
- **Instance 5 is armed but UNEXPLODED**: `diverted.ts` states the design explicitly ("`metadata.airports`
  stays the ORIGINAL dep+arr; the diversion airport is payload-only"), and `sst.config.ts` offers
  `metadata.airports` as an EventBridge filter — but **no consumer registry entry sets `airports:`
  today**, so every deployed rule filters on `category` only. Blast radius is currently zero; the first
  airport-scoped consumer detonates it. Fix it before that consumer, not after.
- **Dead/unwired tiers to resolve alongside**: `make render-diagrams` red ~20 days (3 committed `.mmd`
  parse failures, runs in no workflow); `make test-fids-integration` times out in its own 300s
  `beforeAll` (a ~107k-event feed walk — an unbounded dependency on production masquerading as a
  fixture); `infra.yml` is the ONLY deploy lane, depends on `ci.yml` not at all, and never runs the
  full unit suite (2–3 named specs), so prod can deploy with the suite and bundle-diff both red.

## Phase 0 — corpus provenance (PREREQUISITE, must land first)

Today the corpus **indexes synthetic/derived fixtures as if they were real captures** (found by
EXP-120), so `corpus-confirmed` can be satisfied by something we wrote. Everything below is
worthless until "real" is unfakeable.

1. Every capture file carries a machine-checkable provenance header:
   `source: prod-store | dev-store | oag-rest | synthetic`, `captured_at`, the resolvable
   `stream_id` + `event_id` (or REST request URL + response timestamp), and a `sha256` of the RAW
   body exactly as received.
2. Only `source ∈ {prod-store, dev-store, oag-rest}` **with a resolvable id** may satisfy a
   `confirmed` provenance claim. A synthetic fixture can NEVER confirm anything.
3. Synthetic fixtures move to a **physically separate directory the provenance resolver cannot
   read**. Provenance is then a property of location + header, not of a naming convention someone
   must remember.
4. PII/volume: commit the raw body with a committed, deterministic **redaction transform** applied
   to the named PII leaves only (never a reshape) and record the transform's version in the header,
   so the capture stays structurally real. Where a body cannot be committed at all, the predicate is
   satisfied instead by a committed **live-probe target** that re-fetches it on demand.

## Phase 1 — the census (`make conformance-census`), a COMMITTED SNAPSHOT plus a DIFF gate

A single committed target that runs against the **real prod store** and the provenance-clean corpus:

- **Enumerates the 19 canonical types from `src/app/src/core/canonical-event-types.ts` itself** —
  never a hand-maintained list. Completeness by construction: a new type appears in the census the
  moment it is declared, so the "missing declaration" hole cannot open.
- **D1, per type:** occurrence count over a declared window, plus a **real exemplar pointer**
  (stream id, event id, position) for every type with count > 0.
- **D2 outbound, per canonical leaf:** the population **non-null %** across a real sample fed through
  the REAL read path (not a re-implementation). `departure.scheduledTimeUtc` at 22% would have been
  the first line of the first run.
- **D2 inbound, per real key:** every key present in ≥ X% of real inbound bodies must be READ by some
  code path or **declared ignored-with-reason**. This is the highest-yield single invariant in the
  document: it converts "reality contains data we do not use" from invisible into RED.
- **Output:** a committed census snapshot (`views/conformance-census.md` + `.json`). **The gate is
  the DIFF**, exactly like the bundle-diff gate. This is what makes it cheap — nobody has to invent
  thresholds up front. RED on: a new zero-count type, a new null leaf, a new unread inbound key, or a
  material regression in a population %. A deliberate change is a reviewed snapshot update.

## Phase 2 — the exemplar harvest: a real example per TYPE and per SEQUENCE

This is the human's ask, literally: *"for each event and the sequence of events we need to look in
the data and find the example that would generate this and then create tests from actual data."*

**Per type (19).** The census yields the exemplar pointer; the harvester fetches the **INBOUND body
that generated it** (not merely the outbound event), provenance-stamps it, commits it, and the test
for that type takes that real body as its input. A test whose input is real cannot be green by
agreeing with our own guess.

**Per sequence.** Harvest whole real **streams** — the ordered event list for one real flight key —
and replay them through the real fold, asserting the terminal aggregate. Single-field tests could
never have caught what actually broke us: `scheduledTimeUtc` was a two-feed coincidence and diversion
needs three airports in a key built from two. **Both are interaction failures.** Branch-complete real
streams to harvest:

| Seq | Branch | Notes |
|-----|--------|-------|
| S1 | Nominal OOOI: Created → ScheduledTimeSet → Gate/Terminal/Equipment → Delayed → OffBlock → TakenOff → Landed → OnBlock → BagBeltSet | the spine every board renders |
| S2 | Cancellation (post-Created, pre-OffBlock) | reference implementation — already fixed, use as the template |
| S3 | **Diversion (post-TakenOff)** — the THREE-airport case | origin + intended destination + diversion airport, asserted against the routing key |
| S4 | Recovery | rarest; expect a live probe |
| S5 | Schedule facet: Scheduled → ScheduleUpdated → ScheduleAmended → ScheduleRemoved, incl. the schedule→flight projection crossing | planning consumers |
| S6 | Heal-forward: a null-`scheduledTimeUtc` flight ACQUIRING an anchor (rows appear AND disappear) | the 042 population draining |

## Phase 3 — rare events: expected-rate × exposure, never a binary

"Zero occurrences" and "a quiet day" must stop being the same observation. Diversion is a fraction of
a percent; `Recovery` rarer.

- Each type declares an **expected base rate `p` with a SOURCED denominator** — per the v123
  governing-fact rule, the rate carries its provenance in the same breath (an OAG/industry figure or
  a measured historical rate, never a number someone felt).
- For observed 0 over exposure `N`, the census goes **RED when `P(0 | p, N) < α`** (α declared once,
  e.g. 0.01). At 5.3M events with `p ≥ 0.001`, diversion-at-zero was RED by an astronomical margin —
  it was always screaming, nobody was listening.
- Where no defensible rate exists, the type is **`not-yet-observed`: a first-class DECLARED state**,
  never a silent pass. It requires (a) a stated reason, (b) a committed **live probe** (a targeted
  OAG REST query or a capture window aimed at the branch), and (c) a tracked item whose **acceptance
  IS the observation**. This is the executable form of the v124 EXP-120 limb — "re-verify when a real
  diversion is first captured" sat in delta `029-slc028-…` since 2026-06-26 and never became work.

## Phase 4 — refresh, so the corpus ages honestly

`make corpus-refresh` on a **schedule** (CI cron, weekly) re-harvests exemplars and re-runs the
census, and FAILS on staleness (oldest capture older than N days, or a type whose last real
observation is older than its expected-rate window implies). Today's corpus is grown by a
self-described throwaway script plus manual curation — it silently ages, and a silently-ageing oracle
becomes a fixture again.

## Sequencing — by PASSENGER-VISIBLE CONSEQUENCE, not alphabet

1. **Cancelled** — done; convert into the reference template for the other 18.
2. **ScheduledTimeSet + the departures-board anchor** — 78% blast radius, still healing forward.
3. **Diverted + the three-airport routing key** — worst consequence in the set: an aircraft is
   arriving at an airport whose board structurally cannot show it.
4. **OOOI progression** (OffBlock/TakenOff/Landed/OnBlock) — drives every board's Status.
5. **Recovery** — expect `not-yet-observed` + probe.
6. **BagBeltSet, Gate/Terminal/Equipment changed.**
7. **Schedule facet** (Scheduled/Updated/Amended/Removed) — planning consumers, lowest passenger
   visibility.

## Slice or standing gate? BOTH, staged

- **Phase 0 + 1 + 3 + 4 = a standing GATE** (cicd wires it: source-enumeration limbs on push, the
  real-store census + refresh on schedule). Cheapest-catch-all version of this whole document is
  **Phase 0 + Phase 1's D1 and D2 over the prod store, emitted as a diffable snapshot** — that alone
  catches instances 1, 2, 3 and 4 on its first run, in one lane, with no thresholds to invent.
- **Phase 2 = a real registered ITEM with children** (19 types + 6 sequences). It is days of work and
  must be tracked as work, not left as prose in this file — which is precisely how delta-029's
  diversion doubt evaporated.
- **Instance 5 is NOT in scope here and must not be hidden inside it.** `deriveAirports()` returning
  two airports where a diversion needs three is a **specification** failure — nobody had ever stated
  the invariant, and no oracle invents a requirement. It routes to discovery/product ("who must see
  this flight?") and solution-architect (routing-key completeness). The census's contribution is
  narrower and still valuable: D2 would have forced `diversionAirport` to be declared, which forces
  the question to be asked.

## DORA target

CFR (a never-fired capability, an unread real field, or an un-routed party is caught by a standing
lane instead of surviving millions of events into `done`) + MTTR (the census NAMES the type/leaf; the
alternative was 5.3M-row archaeology after a human challenged a number).
