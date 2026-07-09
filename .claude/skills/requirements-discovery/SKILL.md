---
name: requirements-discovery
description: The requirement-elaboration method (v83). Load before running /requirement or acting as the discovery agent. Holds the heavy interrogation apparatus — the four mandatory operator classes, the persona card, the 5-whys root-need drill, the per-persona failure-mode capture, the JTBD map, and the requirement dossier + human sign-off protocol — so the command and the discovery agent stay slim and the orchestration context stays small. Personas and jobs are REFERENCE artifacts (not work items): use-cases reference them by id (personas:, job:).
---

# Requirements discovery — elaborate before you register (v83)

**One principle:** a requirement is not registerable until we know **who** it serves,
**what job** each of those people is really trying to get done (the root need, not the
surface request), and **what failure looks like for each of them**. Discovery produces
three human-agreeable reference artifacts and stops at a sign-off; only then does
`/requirement` frame value/cost and register the item.

Personas and jobs are **reference artifacts, not work items** — they have no state
graph, no queue, no events. Work items (use-cases) reference them by id: a use-case
carries `personas: [P1,P3]` and `job: J2`. This keeps the machinery contract untouched
(`process/machinery/CONTRACT.md`) while making the who/why traceable both ways.

## Artifacts produced (all under `work/<project>/product/`)
1. `personas.md` — the persona catalog (every actor who touches the system).
2. `jtbd-map.md` — per persona, the jobs, each drilled to its root need.
3. `requirements/<REQ-ID>-dossier.md` — the per-requirement elaboration the human signs off.

`personas.md` and `jtbd-map.md` are **project-cumulative** (they grow across
requirements and are amended, never rewritten per requirement). The dossier is
**per requirement**.

---

## Step 1 — Persona catalog (who touches the system)

A "user" is anyone who interacts with the system, NOT only the paying consumer.
**Four operator classes are MANDATORY** — always prompt for each; a class may be
marked `N/A` only WITH an explicit reason recorded in the dossier, never silently
skipped:

| Class | Who | Typical jobs |
|-------|-----|--------------|
| **Consumer** | End users who consume the product's value; map onto the value JTBD | do the thing the product exists for |
| **Build engineer** | Engineers who build/extend the product | ship change safely, understand the code, test |
| **Platform engineer** | Deploy the product to prod; diagnose infra-vs-code failures | deploy, observe, distinguish infra failure from product failure, roll back |
| **Support** | First line responding to failures; detect/resolve without escalating to 2nd/3rd line | triage, reproduce, resolve or escalate with evidence |

There will usually be MORE than one persona per class (e.g. two distinct consumer
segments). Enumerate every distinct one.

### Persona card (one per persona, in `personas.md`)
```
### P<n> — <name/role>  [class: consumer | build-eng | platform-eng | support]
- **Who:** one line — who they are, their context.
- **Needs:** what they need from the system (bulleted, concrete).
- **Frequency:** how often they use it (per-minute / hourly / daily / weekly / rare / on-incident).
- **Jobs:** J<ids> they perform (link to jtbd-map.md).
- **What failure looks like FOR THEM:** the concrete bad outcome they experience when the
  system fails them (not a generic "error"). e.g. "support gets paged at 3am and cannot
  tell if it's our bug or the upstream feed."
- **Detection & response expectation:** how they expect to notice the failure and what
  they need to respond (signal, log, dashboard, runbook, rollback).
```

The **failure-mode + detection/response** line is mandatory for every persona — it is
what turns platform-engineer and support needs into real use-cases instead of leaving
only the consumer happy-path. Failure modes are the seed of the observability, alerting,
runbook and rollback use-cases the slice later decomposes.

---

## Step 2 — Jobs to be done, drilled to the root need (`jtbd-map.md`)

Capture each job as a **job story**, then interrogate it. The purpose of a drill is to
hang a picture, not to make a hole — never stop at the surface request.

### Job entry
```
## J<n> — <short job name>   [core | secondary]
- **Story:** When [situation], <persona(s) P<ids>> want to [motivation], so they can [outcome].
- **Personas served:** P<ids>.
- **5 Whys (root-need drill):**
  1. Why? …
  2. Why? …
  3. Why? …
  4. Why? …
  5. Why? ->  **Root need:** <the underlying outcome; stop early only if the root is genuinely reached>
- **Success measure:** what we would observe about people doing this job to know it succeeded.
- **Failure for the persona:** what not-getting-this-job-done costs them (ties to the persona card).
```

Rules for the drill:
- Ask **why** until the answer stops being about the product and starts being about the
  person's real-world outcome. Record every rung — the intermediate rungs are where
  hidden jobs (often support/platform jobs) surface.
- If a "why" reveals a NEW persona or a NEW job, add it — discovery loops until the
  who/why graph is closed.
- Tag each job **core** (the reason the product exists) or **secondary** (supporting).
  This classification is inherited by `project.md`/`chunk-plan.md` and drives §10
  next-work ranking (product owns the final classification; discovery proposes it).

---

## Step 3 — Requirement dossier + human sign-off (`requirements/<REQ-ID>-dossier.md`)

The dossier is the single human-agreeable document for THIS requirement. It is the thing
the human reads and approves; it is NOT registered until signed off.

```
# <REQ-ID> — <requirement title>

## Requirement (as stated)
<the raw ask, verbatim>

## Personas in scope
<table: P-id | class | why in scope | what failure looks like for them>
(state explicitly which of the four mandatory classes are N/A and WHY)

## Jobs to be done
<table: J-id | persona(s) | core/secondary | root need (from 5-whys) | success measure>

## Job -> persona map
<which jobs each persona does; and inversely which personas each job serves>

## Out of scope / assumptions
<explicit exclusions and assumptions surfaced during interrogation>

## Open questions for the human
<anything discovery could not resolve — resolved via AskUserQuestion before sign-off>

## Sign-off
- Agreed by: <human> on <date>
- Value/cost (product, at registration): value=<> cost=<>
```

### Interaction protocol (interactive, loop to agreement)
- Discovery is **interactive**: use `AskUserQuestion` to resolve every open question,
  missing persona class, ambiguous job, or unclear root need. Do NOT guess a vague item —
  send it back to the human.
- Loop: draft -> ask the open questions -> update the dossier -> re-present -> repeat until
  the human signs off. The **sign-off line is the gate**; `/requirement` will not register
  an unsigned dossier.
- Keep the loop economic. Batch questions (one AskUserQuestion round can carry several).
  Later slicing revises detail, so do not over-specify — capture enough for agreement and
  for use-cases to map `personas:`/`job:` correctly.

---

## Hand-off to registration and to slicing
When the dossier is signed off, discovery returns to `/requirement` (orchestrator):
personas.md + jtbd-map.md are written/amended, the dossier id, the core/secondary job
classification, and product's value/cost. `/requirement` then registers the requirement
item (event-sourced, `registered`). At `/slice-next`, **product** decomposes into
use-cases and MUST set each use-case's `personas:` and `job:` from these artifacts — a
use-case with no persona mapping is a discovery gap, not Ready.

## Command form
All Bash from project root; allowlist-shaped forms only (`make wi-append`,
`make wi-project`, `sh .claude/skills/work-items/scripts/work-items …`,
`git -C work/<project> …`). Never `cd … && …`. See `process/process-current.md` §33.
