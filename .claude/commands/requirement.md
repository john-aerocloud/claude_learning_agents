---
description: Requirement intake gate (v83) — the single upstream human gate for NEW requirements. A free-text ask is ELABORATED (personas, jobs-to-be-done drilled to root need, per-persona failure modes) into a human-agreed dossier, then JTBD-framed, valued/costed, and written to the event-sourced work-item registry. Replaces /intake for requirements; defects enter via /defect.
argument-hint: "<requirement, free text>" [project-name]
allowed-tools: Read, Write, Edit, Bash, Task
---

_Project resolution: the project argument may be omitted. If the first argument is not an existing directory under `work/`, use the project named in the machine-local `work/ACTIVE` pointer (per-instance — never another machine's). If it is missing, `none`, or stale, stop and suggest `/project-switch <name>`._

Act as the **orchestrator**. This is the ONE upstream human gate (§F5) for new
requirements — it supersedes `/intake`. You own the flow; **discovery** elaborates who/why;
**product** frames value; **flow-manager** registers. State is event-sourced
(`process/machinery/CONTRACT.md`): the item file is the sole source of truth and queue
membership is DERIVED — there is no manual enqueue and no ledger row. Defects do NOT enter
here — they go through `/defect` (which owns capture/reproduce/prioritise/register and the
gap-closing retro).

1. **Elaborate (discovery).** Dispatch `discovery` (which loads the
   `requirements-discovery` skill) to turn the raw ask into an AGREED dossier:
   - **Personas** — enumerate every user who touches the system. The four operator
     classes are MANDATORY (consumer, build-eng, platform-eng, support); each is `N/A`
     only with a recorded reason. Per persona capture needs, usage frequency, and
     **what failure looks like for them** + detection/response expectation.
   - **Jobs to be done** — per persona, each job as a job story, drilled to its ROOT
     need via 5-whys (the drill hangs a picture, it doesn't just make a hole). Success
     measure per job; proposed core/secondary tag.
   - **Dossier + human agreement** — discovery loops with the human (`AskUserQuestion`)
     until the dossier's **sign-off** line is filled. Artifacts land under
     `work/<project>/product/`: `personas.md`, `jtbd-map.md`,
     `requirements/<REQ-ID>-dossier.md`. **A vague item is sent back for clarification,
     not guessed.**
   → **HUMAN GATE: the human signs off the dossier** (who is served, why, what failure
   looks like for each). Log to `decision-log.md`. Do not proceed without sign-off.
2. **Frame the job + value & cost (product).** Dispatch `product`: express the
   requirement as jobs — reusing the signed-off JTBD map — confirm the core/secondary
   classification, and estimate `value` and `cost` (time) for the item.
3. **Register (event-sourced write path).** Dispatch `flow-manager`: create the item
   file `work/<project>/items/active/<ID>.md` (frontmatter: `id`, `type: requirement`,
   `title`, `job`, `value`, `cost`, `parents`, `deps`; body carries the JTBD/acceptance
   definition AND a link to the dossier + personas/jobs it covers), then append the birth
   event — `make wi-append PROJECT=<p> ID=<ID> EVENT=registered AGENT=flow-manager`. That
   is the whole registration: **queue membership is DERIVED** (`queue_map[state]`,
   rendered by `make wi-project`) — do NOT hand-enqueue and do NOT write any ledger row.
   A requirement folds into the Intake queue (decomposed later by just-in-time
   replenishment at `/slice-next`, §F3). Run `make wi-project PROJECT=<p>` to regenerate
   the views, then mirror the new item with the `linear`/`jira` projection agent.
4. **First-chunk capabilities.** Dispatch `cicd` to define what the first chunk needs to
   operate — nothing ahead of need.

**Traceability contract:** because the dossier fixes personas + jobs, every use-case
product later creates at `/slice-next` MUST set `personas: [P…]` and `job: J…` from these
artifacts — a use-case with no persona/job mapping is a discovery gap and is not Ready.

End by reporting the registered item id, its value/cost, the personas/jobs it covers, and
its derived queue (from `views/queues.md`), and offer to run `/loop-run $1`.
