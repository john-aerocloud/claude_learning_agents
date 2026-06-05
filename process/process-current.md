---
process_version: 9
effective_from: 2026-06-05
supersedes: v8
status: active
---

# Current Process — v9

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

From ox (3 slices) + oxo-online s001:

| Slice | Project | Wall-clock | Agent work | Largest wait | Wait driver |
|-------|---------|-----------|-----------|-------------|-------------|
| 001 | ox | 31 min | ~29 min | ~2 min | None |
| 002 | ox | 8h 21min | ~57 min | ~7h 24min | Tester overnight |
| 003 | ox | 39 min | ~37 min | ~2 min | None |
| 001 | oxo-online | 7h 25min | ~50 min | ~3h 22min | Pipeline iteration loop |

Script output: `lead=2340s freq=2/day cfr=0% mttr=n/a`.

**Two distinct constraint classes have now been observed:**
- **Session boundary** (ox): pipeline idles overnight; fix = session continuity.
- **Pipeline iteration loop** (oxo-online): CI/CD pipeline needs multiple
  fix-commit-push-wait cycles; fix = CICD pre-flight + fail-fast validation.

## 3. Wait time taxonomy

| Pattern | Example | Duration | Fix |
|---------|---------|---------|-----|
| **Requirement-phase dormancy** | ox arch dispatched 00:03, ran 11:49 | 11h 46min | Session continuity (§4) |
| **Agent session overnight** | ox tester dispatched 16:55, result 00:30 | 7h 35min | Session continuity (§4) |
| **Inter-session gap** | ox s002 retro → s003 start | 6h 46min | Session continuity (§4) |
| **Pipeline iteration loop** | oxo s001: 8 pipeline fixes after engineer done | 3h 22min | CICD pre-flight + fail-fast (§19–20) |
| **Human gate wait** | oxo s001: gate 2 → gate 2B | 1h 55min | Auto-approve + batch gates (§8) |

## 4. Session continuity (v7 — primary wait-reduction lever for local-only)

**Anticipated DORA effect (v7):** gross lead time < 60 min in-session.
**Observed (oxo-online s001):** 7h 25min in a single session — target missed.
**Diagnosis:** session continuity eliminates overnight waits (ox pattern) but
does not eliminate pipeline iteration loops (cloud pattern). Both levers are
needed; they address different wait classes.

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

Target (v9): < 90 min for local-only (session continuity). < 3h for
cloud/hosted first deploy (pipeline iteration loop is the irreducible minimum
until pre-flight is validated in practice).

## 6. Delivery gap

Track **deploy(N) → engineer task_start(N+1)**.

Target: < 15 min in-session. Record in `dora/per-project.md`.

## 7. Loops

- **New requirement** → `/requirement-new`
- **Per iteration** → `/iteration-run`
- **Retro** → `/retro`

## 8. Gate design

**a. Auto-approve where the outcome is clear:**
- Go/no-go to deploy: orchestrator auto-approves when — project is local-only
  AND all tests pass AND engineer reports no deviations.
- Arch + security for local-only projects with no new infra: architect
  self-certifies; orchestrator confirms; no human wait.

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

Confirmed working (ox): tester median 1200s.

## 12. Deploy event — definition by project type

| Project type | Deploy trigger | Logged by |
|---|---|---|
| Cloud/hosted | CI/CD pipeline live in production | cicd or engineer on pipeline success |
| Local CLI / library | Tester validation passes | orchestrator after tester task_end |

## 13. Deploy event logging

Orchestrator logs `deploy` event row immediately when tester passes.

## 14. Engineer duration_s

The engineer populates `duration_s` in its `task_end` ledger row with
wall-clock seconds. Confirmed working: oxo-online engineer task_end=360s.

## 15. per-project.md discipline

Orchestrator updates `work/<project>/dora/per-project.md` at the end of each
slice retro. Include: slice, change, expected DORA effect, actual, regression
flag, reflection, time-to-first-deploy (s001 only), delivery gap.

## 16. DORA baseline (v9 — oxo-online s001 added)

| Metric | ox final | oxo-online s001 | v9 target |
|--------|---------|----------------|-----------|
| Gross lead time (median) | 2340s (39 min) | 26,700s (7h 25min) | < 2400s local; < 10,800s cloud first-deploy |
| Time-to-first-deploy | 13h 7min | 7h 25min | < 90 min local; < 3h cloud |
| Deployment frequency | 2/active-day | — | ≥ 3/active-day |
| Change failure rate | 0% | 0% | maintain 0% |
| MTTR | n/a | n/a | n/a |

**Current constraint (cloud/hosted): pipeline iteration loop** — not session
boundaries. oxo-online s001 spent 3h 22min (45% of wall-clock) iterating on
the GitHub Actions pipeline after the engineer finished. 8 separate fix cycles
were needed. Attack via CICD pre-flight checklist (§19) and fail-fast
validation (§20).

## 17. Commit discipline

The engineer commits to trunk every time the full test suite goes green.

- **Commit when green, never when red.**
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

This separation prevents CDK IAM permission failures from blocking app deploys
and keeps the app role's blast radius minimal.

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

This surfaces missing secrets/variables in < 5 seconds rather than after the
step that actually needs them fails with a cryptic error 3 steps later.

**Anticipated DORA effect:** reduces pipeline iteration count by ~2-3 cycles per
first deploy. Gross lead time for cloud/hosted first deploy should improve from
~7h 25min toward < 4h on the next project.

## 21. Change-set queued for next iteration

- CICD pre-flight checklist (§19) — measure pipeline iteration count on next
  cloud/hosted slice; target ≤ 3 fix cycles
- Separate infra/app pipelines (§18) — already in place for oxo-online;
  confirm CICD agent uses this pattern from the start on the next project
- Fail-fast validation (§20) — add to oxo-online pipelines retroactively;
  measure whether missing-config errors surface faster
