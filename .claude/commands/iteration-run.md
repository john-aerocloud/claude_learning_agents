---
description: Run one XP implementation iteration for a slice (capabilities -> thin route -> TDD build -> deploy -> validate-in-prod), then the retro runs automatically (documenter in parallel).
argument-hint: <project-name> <slice-id>
allowed-tools: Read, Write, Edit, Bash, Task
---

_Project resolution: the project argument may be omitted. If the first argument is not an existing directory under `work/`, use the project named in `work/ACTIVE` and treat the given arguments as shifted (e.g. a lone `<slice-id>` for `/iteration-run`). If `work/ACTIVE` is `none` or stale, stop and suggest `/project-list`._

Act as the **orchestrator** for project **$1**, slice **$2**. Follow the XP loop.
Bracket every dispatch with ledger rows; emit deploy/failure/recovery events.

1. **Capabilities.** Dispatch `cicd` to ensure the environments, pipeline and
   rollback assets the slice needs exist (nothing ahead of need).
2. **Thin route.** Dispatch `engineer` to lay a clean route through the
   acceptance cases that advances the solution most per step -> `route.md`.
3. **Build (TDD, possibly parallel).** Dispatch `engineer`(s) to implement strict
   red->green->refactor on trunk, keeping WIP sequentially independent. Repeat
   until acceptance cases pass. Security notes become policy tests.
   -> GATE 4: go/no-go to deploy. Log it.
4. **Continuous deploy.** Merge to main triggers the pipeline to production.
5. **Validate in prod.** Dispatch `tester` to exercise the public surface
   (browser/API). Pass -> write `result.md`. Fail -> hand defect back to
   `engineer` (MTTR clock runs) and loop step 3.
6. **Document (parallel, non-blocking).** Dispatch `documenter` **in the
   background** to update `docs/usage.md` — what the project does now, how to
   run it, how to use it. Grounded in `result.md` and `acceptance.md`; no
   forward-planning or internals. Nothing in the process depends on its output
   (process v14 §29) — do NOT wait for it before step 7.
7. **Retro (automatic, same session).** The moment the slice is marked
   `delivered`, run `/retro $1 $2` without waiting for human instruction
   (process v14 §28). The retro is a mandatory part of every slice delivery,
   not an optional follow-up; the human can interrupt it, but their absence
   must not delay it.

Report: what shipped, deploy result, in-prod validation, and the current
constraint from the refreshed baseline.
