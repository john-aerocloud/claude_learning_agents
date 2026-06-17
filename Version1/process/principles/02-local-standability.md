# Engineering principle — local standability

**Every system is designed so that MOST of it can be stood up locally, and
the engineer's browser tests run against that local stand-up during the
build.** Human-directed, 2026-06-06.

## The principle

- **Local stand-up is an engineering deliverable**, not a convenience: a
  committed, parameterised entry point (`make run-local` class) that starts
  the real frontend (dev server) against local substitutes for the cloud
  adapters (local DynamoDB/emulator, a local WS server, stub HTTP endpoints —
  whatever the ports require). Hexagonal architecture (§41 / engineer def) is
  what makes this cheap: the domain doesn't know, and each adapter has a
  local substitute behind the same port.
- **Engineers build real-browser (Playwright) tests in the BUILD phase**, red
  → green against the local stand-up — browser-delivered behaviour is
  developed with a browser, not unit-tested with jsdom and then thrown over
  the wall. The tester's production specs then re-exercise the same flows
  live; the engineer's browser suite is the upstream quality gate that keeps
  false-green node/jsdom results from ever reaching the tester (the
  constraint).
- **The local/prod gap is explicit.** What cannot stand locally (CDN
  behaviour + CSP headers, IAM enforcement, platform runtime semantics,
  real latency) is ENUMERATED in the architecture delta, and each enumerated
  gap maps to the control that covers it: walking-skeleton probe, synth
  contract test, code↔policy pin, or prod validation. "It worked locally" is
  only meaningful when the gap list says what that claim excludes.

## Why

The s005 defect chain showed both halves: browser-only causes (CSP, config
wiring, event ordering) that jsdom/node checks could not see — engineer
browser tests against a local stand-up would have caught the wiring and
ordering classes at build time for pennies — while the genuinely cloud-only
causes (CSP at the CDN, IAM) are exactly the enumerated-gap items the
walking-skeleton probe covers. Local standability moves discovery from the
tester (the constraint, in prod, serially) to the engineer (parallel, at
build, seconds per iteration).

## Owners

solution-architect (design for standability; enumerate the gap per delta),
engineer (the stand-up + browser suite are part of the build deliverable),
cicd (the local entry point is project tooling; CI may run the browser suite
against the stand-up), tester (prod specs re-exercise, not re-discover).
