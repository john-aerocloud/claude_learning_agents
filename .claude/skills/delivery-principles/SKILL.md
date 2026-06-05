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
