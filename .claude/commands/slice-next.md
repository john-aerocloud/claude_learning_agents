---
description: Establish the next smallest value slice for a project (guided). Produces slice.md + acceptance tests, ready for an iteration.
argument-hint: <project-name>
allowed-tools: Read, Write, Edit, Bash, Task
---

> **v40 (pull mode):** this is now product's **just-in-time replenishment routine**
> (§F3), invoked by `/loop-run` when `depth(Ready) < ready.min_items`. There is no
> human gate here; the only human gate is intake (§F5). Product values+costs each
> use-case and hands them to the flow-manager to enqueue.

_Project resolution: the project argument may be omitted. If the first argument is not an existing directory under `work/`, use the project named in `work/ACTIVE` and treat the given arguments as shifted (e.g. a lone `<slice-id>` for `/retro`). The machine-local `work/ACTIVE` pointer is per-instance (never another machine's); if it is missing, `none`, or stale, stop and suggest `/project-switch <name>`._

Act as the **orchestrator** for project **$1**.

1. Dispatch `product` to propose the NEXT SMALLEST slice (Killick-style) from the
   current chunk, tied to a job, with success measures. Writes
   `work/$1/slices/<nnn>-<slug>/slice.md`. (No human gate here — the only human
   gate is intake (§F5); product values+costs and hands off to the
   flow-manager. Log the slice to `decision-log.md`.)
2. Dispatch `solution-architect` to write the architecture delta
   (`architecture/deltas/<nnn>-<slug>.md`), update `architecture/current.md`, and
   run the security review for the delta. (No human gate; log it.)
3. Dispatch `product` + `solution-architect` to co-author:
   - `work/$1/slices/<nnn>-<slug>/use-cases.md` (process §37): separately buildable,
     separately testable use cases with dependency edges — the parallelism plan
     for the build.
   - `work/$1/slices/<nnn>-<slug>/acceptance.md` (product: customer-observable; arch:
     technical/security-policy conditions). Every case is tagged with its
     use case.

4. **UI structure (UI-bearing slices only).** Dispatch `ui-designer` in STRUCTURE
   mode to define navigation/IA, the click-path budget, and component
   decomposition for the slice, and to co-author the WCAG 2.2 AA **acceptance
   conditions** into `acceptance.md` (the UI analog of the architect's security
   notes). Writes `work/$1/slices/<nnn>-<slug>/ui-design.md` and the stable selectors the
   engineer must expose. Skips itself (one-line return) if no use case has a
   user-facing surface. Fold its output into the step-2 architecture output — do
   not add a gate.

This planning may run in PARALLEL with a prior slice's build if the two are
sequentially independent — confirm independence before overlapping; otherwise
serialise. The resulting use-cases are registered as event-sourced items and become
Ready-queue-eligible via the flow-manager (queue membership is derived); this
routine is invoked as `/loop-run`'s just-in-time replenishment. End by offering
`/loop-run $1`.
