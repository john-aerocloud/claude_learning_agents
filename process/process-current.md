---
process_version: 11
effective_from: 2026-06-05
supersedes: v10
status: active
---

# Current Process — v11

The process all agents follow right now. Updated only by the Orchestrator at a
retro, which snapshots the prior version into `process-history/` first.

## 1. Operating principles (beliefs)

See `principles/` for the full statements. In force: XP, always-TDD, value
slicing, trunk-based development, continuous deployment, roll-forward-with-
reversible-rollback, defect-as-spec, jobs-to-be-done. Treat these as defaults,
not laws — deviations are allowed but must be logged in `principle-failures/`.

## 2. Gross lead time — correct definition

**Gross lead time = wall-clock time from idea accepted → running in prod.**
Includes everything: agent processing, gate waits, session idle, overnight,
and pipeline iteration loops.

| Slice | Project | Wall-clock | Agent work | Largest wait | Wait driver |
|-------|---------|-----------|-----------|-------------|-------------|
| 001 | ox | 31 min | ~29 min | ~2 min | None |
| 002 | ox | 8h 21min | ~57 min | ~7h 24min | Tester overnight |
| 003 | ox | 39 min | ~37 min | ~2 min | None |
| 001 | oxo-online | 7h 25min | ~50 min | ~3h 22min | Pipeline iteration loop |
| 002 | oxo-online | ~42 min | ~36 min | ~5 min | Smoke test regression |

Script output (v11): `lead=2211s freq=2/day cfr=20% mttr=222s`.

**Three distinct constraint classes observed:**
- **Session boundary** (ox): pipeline idles overnight; fix = session continuity.
- **Pipeline iteration loop** (oxo-online s001): multiple fix-commit-push-wait cycles on new pipeline; fix = CICD pre-flight + fail-fast.
- **Smoke test regression** (oxo-online s002): surface changed but smoke tests not updated; fix = §22 done condition for surface changes.

## 3. Wait time taxonomy

| Pattern | Example | Duration | Fix |
|---------|---------|---------|-----|
| **Requirement-phase dormancy** | ox arch dispatched 00:03, ran 11:49 | 11h 46min | Session continuity (§4) |
| **Agent session overnight** | ox tester dispatched 16:55, result 00:30 | 7h 35min | Session continuity (§4) |
| **Inter-session gap** | ox s002 retro → s003 start | 6h 46min | Session continuity (§4) |
| **Pipeline iteration loop** | oxo s001: 8 pipeline fixes after engineer done | 3h 22min | CICD pre-flight + fail-fast (§19–20) |
| **Human gate wait** | oxo s001: gate 2 → gate 2B | 1h 55min | Auto-approve + batch gates (§8) |
| **Smoke test regression** | oxo s002: root route changed, smoke assertions stale | ~5 min | Surface-change done condition (§22) |

## 4. Session continuity (v7 — primary wait-reduction lever for local-only)

**Anticipated DORA effect (v7):** gross lead time < 60 min in-session.
**Observed (oxo-online s002):** ~42 min — target met for a pure-frontend slice
in-session with no pipeline loops.
**Diagnosis:** session continuity + CICD pre-flight + auto-gates = fast delivery
when the slice is frontend-only. The combination is working.

Guidelines remain in force for session boundary waits:

**a. Start a session, finish a deliverable.**

**b. Requirement workflow + first slice in one session.**

**c. Don't dispatch the tester near end of session.**

**d. Retro runs in the same session as delivery.**

## 5. Time-to-first-deploy

Track **kickoff → slice-001 deploy** as a distinct metric.

| Project | Time-to-first-deploy | Driver |
|---------|---------------------|--------|
| ox | 13h 7min | Req-phase dormancy (11h 46min) |
| oxo-online | 7h 25min | Pipeline iteration loop (3h 22min) |

Target (v9): < 90 min for local-only. < 3h for cloud/hosted first deploy.

## 6. Delivery gap

Track **deploy(N) → engineer task_start(N+1)**.

Target: < 15 min in-session. Record in `dora/per-project.md`.

## 7. Loops

- **New requirement** → `/requirement-new`
- **Per iteration** → `/iteration-run`
- **Retro** → `/retro`

## 8. Gate design

**a. Auto-approve where the outcome is clear:**
- Go/no-go to deploy: orchestrator auto-approves when all tests pass AND lint
  clean AND build succeeds AND no deviations blocking deploy.
- Arch + security for local-only projects with no new infra: architect
  self-certifies; orchestrator confirms; no human wait.
- **Security review auto-accepted (all project types):** when the
  solution-architect's delta file contains an explicit conclusion stating
  "no new attack surface, no new data flow, no new trust boundary", the
  orchestrator confirms the conclusion is present and auto-accepts — no human
  gate. Gate 3 still requires human approval if the review surfaces any new
  control, open risk, or deferred recommendation.

**b. Parallel N+1 planning.**

**c. Batch gate decisions.**

## 9. Project classification (solution-architect guidance)

- **Cloud/hosted**: full AWS Well-Architected, IAM, `aws-architecture` skill.
- **Local-only** (CLI, library, script): skip cloud scaffolding.

## 10. Agent roster

| Agent | When dispatched |
|-------|----------------|
| product | vision + slice definition (and parallel N+1 per §8b) |
| solution-architect | architecture delta + security review (and parallel N+1) |
| cicd | capabilities (environments, pipeline, rollback) |
| engineer | TDD build on trunk |
| tester | in-prod / public-surface validation |
| documenter | `docs/usage.md` after every validated slice |

## 11. Tester scope

The tester validates **customer-observable outcomes** through the public
surface. It does NOT re-implement exhaustive correctness checks in the suite.

Tester median s002: 213s. Historical ox: 1200s (session-boundary driven).
With session continuity in place, tester median target: < 300s.

## 12. Deploy event — definition by project type

| Project type | Deploy trigger | Logged by |
|---|---|---|
| Cloud/hosted | CI/CD pipeline live in production | cicd or engineer on pipeline success |
| Local CLI / library | Tester validation passes | orchestrator after tester task_end |

## 13. Deploy event logging

Orchestrator logs `deploy` event row immediately when tester passes.

## 14. Engineer duration_s

The engineer populates `duration_s` in its `task_end` ledger row with
wall-clock seconds.

## 15. per-project.md discipline

Orchestrator updates `work/<project>/dora/per-project.md` at the end of each
slice retro. Include: slice, change, expected DORA effect, actual, regression
flag, reflection, time-to-first-deploy (s001 only), delivery gap.

## 16. DORA baseline (v11 — oxo-online s002 added)

| Metric | ox final | oxo-online s001 | oxo-online s002 | v11 target |
|--------|---------|----------------|-----------------|------------|
| Gross lead time (median) | 2340s (39 min) | 26,700s (7h 25min) | ~2,520s (42 min) | < 2400s in-session |
| Deployment frequency | 2/active-day | — | 2/active-day | ≥ 3/active-day |
| Change failure rate | 0% | 0% | 20% | restore to 0% |
| MTTR | n/a | n/a | 222s (3.7 min) | < 300s |

**Computed baseline (2026-06-05):** `lead=2211s freq=2/day cfr=20% mttr=222s`

**Current constraint:** `tester` (median 1200s, driven by historical ox overnight
data). In-session tester runs are fast (~213s). The constraint to attack via
process change is the **CFR regression** — restore to 0% via §22.

## 17. Commit discipline

The engineer commits to trunk every time the full test suite **and lint** go
green. (Lint must pass inside the done-condition, not discovered post-commit.)

- **Commit when green and lint clean, never when red.**
- **Message states intent, not mechanics.**
- **One logical change per commit.**

## 18. Cloud/hosted pipeline structure (v9 — new default)

For every cloud/hosted project, the CICD agent produces **two separate
pipelines** from the start:

| Pipeline | File | Trigger | Role | Does |
|----------|------|---------|------|------|
| App deploy | `deploy-<project>.yml` | `src/app/**` | minimal OIDC role | Build → S3 sync → CDN invalidation |
| Infra deploy | `infra-<project>.yml` | `src/infra/**` | CDK-capable OIDC role | CDK diff (PR) + CDK deploy (main) |

**Two OIDC roles are always created:**
- App role: S3 + CloudFront only (no IAM, no CloudFormation)
- Infra role: can assume CDK bootstrap roles; requires `cdk bootstrap --trust <account>`

## 19. CICD pipeline pre-flight checklist (v9 — new)

Before writing or pushing a cloud/hosted pipeline for the first time, the CICD
agent works through this checklist. Each item represents a failure mode observed
in practice:

**GitHub Actions + AWS OIDC:**
- [ ] OIDC trust policy uses `StringLike` for `sub` (not `StringEquals`) to
      tolerate ref format variations across trigger types
- [ ] No env vars use the `GITHUB_` prefix — it is reserved; GitHub silently
      drops them. Use `GH_` or a project prefix instead
- [ ] All required secrets and variables are documented; pipeline fails fast if
      any are absent (§20)
- [ ] `environment: production` gate is intentional — omit if no approval queue
      is wanted (it pauses the job indefinitely awaiting a reviewer)

**CDK:**
- [ ] `cdk.json` exists with `"app": "npx ts-node --prefer-ts-exts bin/app.ts"`
- [ ] `ts-node` is in `devDependencies`
- [ ] CDK bootstrap has been run with `--trust <account-id>` for the infra role
- [ ] `githubOrg` and `githubRepo` are passed as `-c` context flags on the
      command line, not as env vars (reserved prefix issue above)
- [ ] CDK infra deploy uses the infra role, not the app role

**Runner environment:**
- [ ] Each job that runs tests/tools installs its own dependencies (`npm ci`)
      — node_modules are not shared between jobs
- [ ] Node.js action versions are pinned to a version supporting the current
      runner Node.js (set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` until
      action maintainers catch up)

## 20. Pipeline fail-fast validation (v9 — new)

Every cloud/hosted pipeline includes a validation step as the **first step of
every job that uses secrets or variables**:

```yaml
- name: Validate required config
  run: |
    missing=""
    [ -z "${{ secrets.MY_SECRET }}" ] && missing="$missing MY_SECRET"
    [ -z "${{ vars.MY_VAR }}" ]   && missing="$missing MY_VAR"
    if [ -n "$missing" ]; then
      echo "Missing required config:$missing"
      exit 1
    fi
```

## 21. Architecture-lite path for pre-tagged no-backend slices (v11 — new)

When the active chunk is **explicitly tagged in `architecture/current.md`** as
"no backend" or "client-only" (e.g., the C2-3 tag), the solution-architect
follows a lightweight review path instead of a full delta:

1. Confirm the no-backend tag still holds for this slice (no new data flows,
   no new principals, no new infrastructure).
2. Write a brief delta (target < 5 min): what React/UI changes, what does NOT
   change, one-line security conclusion.
3. Auto-accept applies immediately (§8a) — no new attack surface by definition.

**Anticipated DORA effect:** reduces solution-architect time for frontend-only
slices from ~15 min (s002 observed) toward ~3–5 min. Gross lead time for a
pure-frontend slice should drop from ~42 min toward ~25–30 min.

**When this path does NOT apply:** any time the slice introduces a new service,
API call, data persistence, or trust relationship — revert to full delta.

## 22. Engineer done condition — surface changes (v11 — new)

When a slice changes the **principal visible element at a well-known URL**
(root `/`, a key deep-link, or a landmark UI element referenced in smoke tests),
the engineer's done condition includes one additional check:

> **Verify `tests/smoke/` assertions still match what the deployed surface now
> renders.** If smoke tests reference UI content that no longer appears at that
> URL, update them in the same commit sequence, before merge.

Trigger examples:
- Root route (`/`) is rewired to a different component (Phase C style)
- A prominent element (heading, CTA button) is removed or renamed at a URL the
  smoke suite navigates to

This is separate from unit tests. Smoke tests are infrastructure + surface
validators; they travel with the content changes that invalidate them.

**Why:** oxo-online s002 routed `/` from `TitleScreen` to `GameRoot`. Unit
tests were updated; smoke tests were not. Pipeline failure + MTTR 222s. CFR
rose from 0% to 20%. (See `principle-failures/2026-06-05-smoke-tests-not-updated-with-root-route.md`)

**Anticipated DORA effect:** restore CFR to 0% on the next slice that changes
a well-known surface. One missed smoke update cost one pipeline cycle (~5 min);
catching it pre-push costs ~1 min.

## 23. Change-set queued for next iteration

- Architecture-lite path (§21) — apply to next frontend-only slice; target
  solution-architect time ≤ 5 min; measure against s002 baseline of ~15 min
- Surface-change done condition (§22) — apply immediately; target CFR restored
  to 0% on next slice
- Lint-in-done-condition (§17 update) — engineer caught lint error post-commit
  in s002; enforce lint inside done gate, not discovered after commit
- Deployment frequency — currently 2/active-day; target ≥ 3; next slice is
  the first in-session opportunity to hit this
