---
date: 2026-07-12
project: AdixOut
iteration: 0
principle: version-identifiable deployment (principles/01 — build identity must be truthful)
dora_metric_harmed: change_failure_rate
---

## Expected
A deployed function's build-identity tag (`BuildSha`/`Version`) is truthful: if a
resource reports `BuildSha=X`, the CODE actually running is X. The runbook's first
diagnostic — "read the build identity, compare to expected" — relies on this.

## Actual
On the UC-ADIX-003 SST deploy, the tester found 3/200 fresh `AdixOut-Outbox`
messages carrying a >32-char `@TransactionIdentifier` (the pre-fix, un-bounded
form) **while tagged with the NEW build `gitSha=0328b44`**, all timestamped at the
exact deploy-cutover second (12:01:53–56). SST/Pulumi updated the Lambda's
configuration + tags BEFORE the code zip finished swapping, so a few
stream-triggered invocations ran STALE code under the NEW build's identity. Net:
(a) build identity lied for a few seconds (a resource said `0328b44` while running
pre-`0328b44` logic), and (b) 3 conformance-violating records became resident in
the production Outbox/sink — violating the slice's "zero conformance defects reach
the outbox" measure. This will recur on EVERY code change to a
stream/event-triggered function, not just this one.

## Why the principle did not hold
The deploy was treated as atomic when it is not: for a high-throughput
stream-triggered Lambda, config/tags and code are separate update operations with a
window between them, and the event source keeps invoking across that window. Nobody
had modelled "in-flight invocations during the code swap" — the build-identity tag
was assumed to imply the code, but the ordering makes that false transiently.

## Guidance for next time
When X = "deploying a code change to a stream/event-triggered Lambda," Y = make the
swap safe against in-flight invocations: either (i) DISABLE the event-source-mapping
→ deploy code → confirm → re-enable (drains the window), or (ii) ensure the
build-identity tag attaches only AFTER the code is confirmed live (never tag ahead
of code), or (iii) have the handler assert its own code version so a stale
invocation fails closed rather than emitting mis-identified output. Also: after any
deploy that could have produced bad records, SCAN for and purge them (they are real
data even if produced in a race). A build-identity tag must never be attachable
before the code it names is actually serving.
