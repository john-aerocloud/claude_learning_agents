---
name: delivery-principles
description: On-demand reference for the team's default ways of working — XP, always-TDD, value slicing (Neil Killick style), trunk-based development, continuous deployment, roll-forward-with-reversible-rollback, defect-as-spec, and Jobs-to-Be-Done. Use when an agent needs the detail behind a principle, or to check whether a planned action is consistent with the defaults before deviating (deviations must be logged in /process/principle-failures/).
---

# Delivery principles (reference)

The authoritative statements live in `/process/principles/`. This skill is the
working reference and the deviation procedure. These are BELIEFS, not laws —
deviate when a problem demands it, but log it.

## The defaults
- **XP** — short loops, simple design, continuous refactor, customer (Product)
  on hand, collaborate across agents.
- **Always TDD** — no production code without a failing test first; red -> green
  -> refactor; acceptance tests define "done", unit tests drive design.
- **Slice value (Killick)** — ship the smallest increment that lets a real user
  do something valuable they could not before, tied to a Job to Be Done. If a
  slice only enables future work, it is too big/early. Value defines the slice,
  never infrastructure.
- **Trunk-based** — keep WIP sequentially independent so it lands on main
  continuously; no long-lived branches.
- **Continuous deployment** — push-to-main runs a pipeline that validates and
  deploys to prod; the pipeline gates, not a person (bar the defined checkpoints).
- **Roll forward, rollback reversible** — fix forward by default; keep rollback
  assets runnable; irreversible changes (DB migrations) must be immutable AND
  reversible.
- **Defect = normal work** — define expected, capture current, write tests that
  pin correct behaviour, make them pass.
- **Jobs to Be Done** — everything traces to customer value and a better user
  experience. No JTBD link -> question the work.

## Green build ≠ running service — validate the RUNNING service in prod (graduated v68)
A green local suite, a green CI run, or a successful deploy report **does not mean
the service is doing its job in production.** A change is DONE only when the
RUNNING service is observed doing the thing — never on CI-green / deploy-green
alone. This is a *proven, graduated* rule (the false-green family — backend and
contract slices repeatedly shipped "green" while the live service was stale,
crashed, or emitting the wrong shape):

- **Backend / contract / event slices** are validated by **observing the live
  service**: the consumer/process is actually UP (not crash-looping on a new
  task-def), and the field/behaviour the slice added is **observed on a real live
  event / live response** — not inferred from unit tests or a deploy log. Closing
  on CI-green for a contract change is the false-green escape.
- **The deployed ARTIFACT is the thing that runs, not the source.** A header /
  version-marker decoupled from the served bundle, or a committed bundle that
  predates the source, lets a green gate pass while a STALE artifact serves.
  Assert a *rendered/served* marker that can only be present if the fresh artifact
  is live (a served bundle marker, a body field on a live event), never a
  side-channel header.
- **A deployed component must still DO ITS PRIMARY JOB after deploy.** "Deployed"
  + "units pass" does not prove the projector advances the feed head, the consumer
  appends events, or the API returns real data. Assert the function within N
  minutes of deploy.

Evidence (the family this graduated from): a FIDS header read green while the
served bundle was stale; committed `infra/assets/*.mjs` bundles deployed without
the slice's field because they predated the source; a consumer crash-looped on an
unpackaged `airports.json` so a CI-green enrichment + serviceType change were
NEVER live; a CC chunk closed on CI-green and was never validated against the
running consumer. Per-role mechanics (the gates that assert these) live in
`tester.md` / `cicd.md`; this skill states the principle.

## Validate the FITNESS FUNCTION, not a proxy (graduated v68 — proven family)
A test/gate must assert the thing the user actually depends on, evaluated against
an oracle that is INDEPENDENT of the code under test. The proven sub-rules (each
graduated from a scored experiment + a prod defect):

- **The oracle is ground truth, never the code's own output.** Unit fixtures for a
  data shape the code does NOT own (API response / event body / third-party
  schema) are CAPTURED FROM THE REAL SOURCE (committed sample), never hand-authored
  to match the code's assumption — otherwise test and code agree with each other,
  not reality, and the suite is green while the surface is broken. An externally
  published contract is validated against a schema DERIVED FROM THE FROZEN SPEC,
  not from the implementation. A load-bearing assumption about an external source's
  semantics (keys, stability, ordering) is validated against the captured corpus
  before being encoded. (from EXP-065/066/073: FIDS empty board behind 152 green
  tests; envelope drift latent across 322 tests; dedupe-by-statusKey contradicted
  by the in-repo corpus.)
- **The gate asserts the user-visible OUTCOME, not its precursor.** A UI surface is
  not validated until the RENDERED result is observed showing real content AND the
  key domain field shows the RIGHT values (not merely non-empty rows); missing
  browser tooling is a blocker to wire, never a reason to defer. An
  observability surface is validated by a span/trace actually ARRIVING at the
  backend (read-back), not "the collector started". A processing component is
  validated by it still DOING ITS PRIMARY JOB after deploy (feed head advances,
  events append, API returns data), not "deployed + units pass". A read surface is
  validated against a stated p95 LATENCY budget + round-trip count, not just
  correctness. (from EXP-064/068/072/074: collector "ready" while emitting zero
  spans; projector deployed-green but crash-on-invoke = 24h outage; 805ms serial
  read; all-rows-"Scheduled" board passing a non-empty check.)
- **The spec asserts the INVARIANT, not an incidental.** An e2e/integration/
  contract spec asserts the acceptance invariant; where the surface depends on
  live data it branches on the data state (assert the sanctioned empty-state) or
  derives the expected value from per-entity ground truth — never from incidental
  global ordering / row-or-request counts / presence-when-absence-is-valid. A spec
  that false-fails on an incidental burns an adjudication cycle and inflates CFR
  with a phantom defect. (from EXP-081.)

Per-role mechanics live in `tester.md` / `engineer.md` / `solution-architect.md`;
this skill states the proven methodology so the active `/process` need not carry
the per-experiment rows.

## Environments (introduce only on need)
prod-only by default -> add a TEST env when there is a customer to protect -> add
PER-USER FEATURE FLAGS when releasing to some-but-not-all users -> add more envs
only for performance/UAT/research. Adding an environment early costs lead time.

## Deviation procedure (mandatory)
If you act against a principle:
1. Proceed only if the slice genuinely requires it.
2. Write `/process/principle-failures/YYYY-MM-DD-<project>-<slug>.md` using the
   template there: expected, actual (with DORA evidence), why the principle did
   not hold, narrowed guidance for next time.
3. Do NOT rewrite the global principle yourself — that happens only at `/retro`,
   and only on a PATTERN across several failures.
