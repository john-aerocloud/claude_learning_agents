# IMP-012 — Delivery-system optimisation (throughput + process-overhead)

**Owner:** orchestrator (+ cicd for tooling, flow-manager for the edge model). Queued with product work (process §32).
**Decision anchor:** decision-log `DELIVERY-SYSTEM-OPTIMISATION-SCOPED` (2026-06-30, human).
**Why:** work was building but not *shipping* (ship dammed by the gated cutover + a blocked push), and build-concurrency was capped by (a) single git-tree commit contention, (b) hidden-edge collisions (O2↔O3 on the `normalise()` dispatch seam), and (c) hand-orchestration latency + unmeasured main-thread process-tax.

## Workstreams

### W1 — Shared-tree Workflow pipeline for the inner dev loop
Run the inner loop as a deterministic Workflow `pipeline()` over the flow-manager's **verified-independent** set: each UC flows build→(deploy)→validate without per-stage barriers, concurrent up to the cap. **Runs in the SHARED git tree** so §F7 in-tree collision detection still fires EARLY (worktrees would defer collisions to late merge-time — rejected for within-slice work). Dependent UCs run in ordered phases. Replaces batch-dispatch-and-wait hand-orchestration.

### W2 — Worktree isolation ONLY across disjoint subsystems
Use `isolation: "worktree"` solely where independence is provable at the **file** level across subsystems — e.g. `infra/sst.config.ts` vs `src/app/src/core` vs `src/fids-app`. NEVER for within-slice UCs that share core seams (`normaliser-core.ts`, `canonical-event-types.ts`). A worktree merge conflict = a missed edge → treat as a §F7 collision (re-serialise + record the edge).

### W3 — dependency-cruiser edge detection (computed change-impact model)
`dependency-cruiser` installed (src/app dev-dep). Add a depcruise config (entry points + TS resolution) + `make edge-graph` that emits the real import/call graph as JSON. The flow-manager (a) auto-derives/validates `architecture/dependencies/class-deps.mmd` from ground truth instead of the hand-maintained, drift-prone file, and (b) overlap-checks each UC's declared target files + transitive dependents BEFORE dispatch (would have surfaced `normaliser-core.ts` as the shared caller in O2↔O3). Limit: shows current coupling + transitive impact, not net-new edges a change introduces — converts most hidden edges to visible couplings to verify.

### W4 — Process-tax tracking (main-thread GLT + tokens)
The orchestrator records an `orchestration` ledger event per loop cycle with its estimated main-thread tokens + the cycle wall-clock. A `dora.py process-tax` compute derives, per window: GLT (wall-clock), work-time (Σ subagent durations), **process-overhead-time = GLT − work-time**, work-tokens vs orchestration-tokens, and **process-tax %**. Surfaced in `flow.md` time-thieves and **fed into the retro** (§24/§26) as an explicit optimisation target — scored on DORA-per-token, never tokens alone (reject a cut that slows lead time / raises CFR). W1 (the Workflow pipeline) is expected to be the dominant process-tax reduction; W4 measures whether it actually is.

## Experiments (register in experiments.md at the next retro)
- **EXP-089** — process-tax reduction: main-thread tokens + GLT per *shipped* UC trends down cycle-over-cycle WITHOUT harming DORA (lead/CFR/MTTR). Horizon: 3 cycles. Founding: this directive — main-thread overhead unmeasured.
- **EXP-090** — computed edge detection: hidden-edge **collision rate → 0** over the next backend waves (CFR/GLT), enabling a wider safe parallel fan-out. Horizon: 3 multi-UC waves. Founding: O2↔O3 collision (the hand-model missed the dispatch seam).

## Sequencing
W3 (edge detection) + W4 (process-tax compute) are small, immediate safety/measurement wins — build first. W1 (Workflow loop) is the larger engine change — build after W3/W4 so it dispatches on computed edges and its gain is measured. W2 is a per-dispatch option used as soon as a cross-subsystem fan-out arises (e.g. slice-030 EB alongside slice-031 core).
