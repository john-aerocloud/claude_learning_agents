# 2026-06-25 — deploy hit stale state-lock + Docker-down with no preflight; ci-watch read the WRONG repo

**Principle:** a deploy command asserts its prerequisites and environment health
BEFORE acting (no stale state lock, the build daemon is up, the credential is
valid, the target repo/account is the intended one) — and any CI/deploy status it
reports is bound to the VERIFIED target (the actual `origin` / account), never a
default or a stale binding. Both are the same class as v65/EXP-080
(verify-status-at-source): here the failure was in the deploy ENVIRONMENT and its
BINDING, not the build artifact.

**Pattern (3 data points, one session — SLC-023 §F5 deploy):**
1. **Stale SST state lock.** The prior `/loop-run` was killed mid-flight and left
   an SST state lock held. The first `deploy-fids` attempt blocked on the orphan
   lock — a prerequisite the target has no preflight for.
2. **Docker daemon down.** The first deploy attempt also failed because the
   bundling step needs the Docker daemon, which was not running. `deploy-fids`
   (`sso-login build-fids bundle-all` → `deploy-fids.sh`) checks the SSO token but
   NOT the Docker daemon — a health prerequisite absent from the preflight.
3. **ci-watch bound to the wrong repo.** `ci-watch` / `gh` misreported "no runs"
   because the lookup resolved to `john-aerocloud/claude_learning_agents`, not the
   real `origin` `AeroCloudSystems/Spike-FlightEventSource-OAG`. `ci-watch.sh`
   derives the repo from `origin` correctly, but an ambient `gh` repo default /
   wrong cwd binding overrode it — a status read against the wrong target reads as
   "nothing happened" exactly like the DEFECT-OAG-026 "no CI runs" false claim
   (EXP-080), now in the CI-binding rather than the artifact.

**Also this session (single-writer-per-tree, 1 data point — confirms §14):**
concurrent engineers on one shared working tree produced an **orphan unpushed
commit** (a commit stranded outside the pushed range); the single-writer-per-tree
dispatch held cleanly. Reinforces §14 parallel-engineer commit isolation
(worktree OR explicit pathspec); not yet a new pattern.

**Not a failure (calibration win — reinforces v66/EXP-081):** UC-FD1 AC-FD1.4
(`framenavigated count <= 1`) was a MISCALIBRATED SPEC, not a defect — the raw
framenavigated count is an incidental of hash-router navigation. The fix asserted
the TRUE invariant (a window sentinel survives = no real document reload). ~1h08m
MTTR, but the "recovery" was a spec recalibration, not a code defect. This is the
v66 specs-assert-the-invariant rule doing its job at adjudication time.

**Cost:** two failed deploy attempts before the §F5 deploy landed (lead-time hit
inside the deploy gate); plus the ci-watch wrong-repo read nearly let a deploy
status go unverified.

**Rule going forward (routed to cicd.md deploy preflight + EXP-082):** the
deploy target runs a fail-fast PREFLIGHT before any irreversible step —
(a) release/clear any stale state lock (SST), (b) assert the build daemon
(Docker) is up, (c) assert the credential is valid (already present), (d) assert
the CI/deploy binding resolves to the verified `origin`/account, not an ambient
default. A missing prerequisite is a clear actionable message, not a mid-deploy
crash. ci-watch passes the resolved `origin` repo explicitly (never relies on the
`gh` default).
