---
date: 2026-07-11
project: AdixOut
iteration: 0
principle: solution-architecture gate (per-slice architecture + security review before build)
dora_metric_harmed: change_failure_rate
---

## Expected
The slice's architecture — including load-bearing tech choices like the IaC
framework — is reviewed at a solution-architecture GATE (architect writes the
per-slice delta, checks it against existing org/sibling conventions, runs the
security review) BEFORE any build/deploy. The build then implements a gated
design.

## Actual
On AdixOut the architecture was produced as a **lightweight whole-shape pass**,
not a proper per-slice gate. Its delta defaulted the IaC framework to **AWS CDK
v2** (an AWS-Well-Architected default) WITHOUT checking the org convention — the
sibling OagEventSource repo uses **SST v3 (Ion)**. That CDK choice flowed
unchallenged into cicd's scaffold, the engineer's green build, AND a live sandbox
deploy (stack `AdixOutSandbox`) before the human caught it: "this should not be
using cdk it should be using sst" / "we seem to of skipped a solution
architecture gate." Rework: the whole infra layer must be redone in SST and the
CDK stack torn down — a change-failure that a gate would have prevented pre-build.

## Why the principle did not hold
Two compounding gaps: (1) the architecture step was run as an informal "whole-shape
sketch for context," so it never functioned as a GATE with a go/no-go on tech
choices; (2) when `/slice-next`'s product step hit a rate limit, the orchestrator
authored the slice/use-cases directly from the existing delta and did NOT run the
architect's per-slice pass + security review — so the delta's defaults (CDK) were
never validated against the codebase's own conventions. "AWS Well-Architected
default" is only a default; it must be reconciled with what the org/siblings
actually use before it is load-bearing (same ground-truth-over-belief discipline
as the OAG-portal and real-fixture cases).

## Guidance for next time
When X = "a slice is about to be built," Y = the solution-architecture gate MUST
have run for that slice: architect delta + **a tech-choice check against existing
org/sibling repos** (IaC framework, language, deploy model — grep siblings, don't
default) + security review, with an explicit go. Do NOT let a "whole-shape sketch"
substitute for the gate, and do NOT skip the architect's per-slice pass when a
different agent (product) is rate-limited — reorder, don't drop. A tech default
that never met the org's actual convention is decision-debt that surfaces as
expensive rework after deploy.
