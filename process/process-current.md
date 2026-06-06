---
process_version: 25
effective_from: 2026-06-06
supersedes: v24
status: active
---

# Current Process — v25

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
| 003 | oxo-online | ~66 min | ~32 min | ~28 min | Human gate waits + smoke regression |
| 004 | oxo-online | ~11h 52min | ~75 min | ~9h 20min | Defect-fix-revalidate cycle crossing overnight boundary |
| 005 | oxo-online | ~4h | ~2h 10min agent (build 30% parallel-saved) | ~2h 40min | DEFECT-005-001: 6 stacked causes, 2 fix rounds, all in-session |

Script output (v25): `lead=3618s freq=5/day cfr=27% mttr=3054s`.

**Constraint classes observed:**
- **Session boundary** (ox; oxo s004 revalidation): pipeline idles overnight; fix = session continuity, and don't leave a recovery validation pending at end of session.
- **Pipeline iteration loop** (oxo s001, s004 first-backend): fix-commit-push-wait cycles on pipeline novelty; fix = CICD pre-flight (§19, extended v14).
- **Fragile smoke selectors** (oxo s002+s003): fixed at source by §23; zero recurrence in s004 ✓.
- **Cross-stack contract gap** (oxo s004): each stack synth-green individually, but the path contract between them (CF `/api/*` ↔ API route key) was never asserted; fix = §30 — no recurrence in s005 ✓.
- **Platform-runtime semantics gap** (oxo s005): synth/unit/node-level checks cannot see browser-only platform behaviour (close-code delivery, CSP, config wiring, event ordering); fix = §30 walking-skeleton probe (v25).
- **Permission prompts** (recurring through s003): fixed by §25–26 + v23 self-service; near-zero in s004–s005 ✓.

## 3. Wait time taxonomy

| Pattern | Example | Duration | Fix |
|---------|---------|---------|-----|
| **Requirement-phase dormancy** | ox arch dispatched 00:03, ran 11:49 | 11h 46min | Session continuity (§4) |
| **Agent session overnight** | ox tester; oxo s004 re-validation | 7–10h | Session continuity (§4); §28 same-session closure |
| **Pipeline iteration loop** | oxo s001: 8 fixes; s004: 3 fixes | 22min–3h 22min | CICD pre-flight + fail-fast (§19–20) |
| **Human gate wait** | oxo s001: gate 2 → gate 2B | 1h 55min | Auto-approve + batch gates (§8) |
| **Prod-found defect cycle** | s004: DEFECT-004-001 found in step 16, fixed, redeployed, revalidated | ~1h agent + overnight gap | Cross-stack contract test (§30) — find it at synth, not in prod |
| **End-of-iteration human prompt** | "run /retro?" wait after delivery | minutes–hours | Auto-retro (§28) |
| **Smoke regression / fragile selector** | oxo s002/s003 | ~5 min | §22 + §23 (confirmed working s004) |
| **Permission prompts** | compound cmds, novel variants | 15–60s each | §25–26 (confirmed working s004) |

## 4. Session continuity (v7 — primary wait-reduction lever for local-only)

Guidelines in force for session boundary waits:

**a. Start a session, finish a deliverable.**

**b. Requirement workflow + first slice in one session.**

**c. Don't dispatch the tester near end of session.**

**d. Retro runs in the same session as delivery — now automatic, see §28.**

**e. (new v14) Never leave a defect recovery pending validation at a session
boundary.** s004's MTTR pair inflated to ~9h because the fix deployed in-session
but re-validation ran after an overnight gap. If a roll-forward fix deploys,
re-validate immediately in the same session.

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
- **Retro** → `/retro` — fires automatically at delivery (§28)

## 8. Gate design

**a. Auto-approve where the outcome is clear:**
- Go/no-go to deploy: orchestrator auto-approves when all tests pass AND lint
  clean AND build succeeds AND no deviations blocking deploy — **application-only
  diffs only**. Infra-bearing diffs (new stacks, IAM changes, new attack surface)
  remain a human gate (as exercised at GATE-4-S004).
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
| documenter | dispatched **in parallel, in the background**, at delivery (§29) |

## 11. Tester scope

The tester validates **customer-observable outcomes** through the public
surface. It does NOT re-implement exhaustive correctness checks in the suite.

Tester median 1059s (partly historical). In-session validation runs are
213–2760s; s004's full backend validation (steps 14–16 incl. CLI policy
checks) took 2760s — acceptable for a first-backend slice. Target for
frontend-only slices remains < 300s.

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

## 16. DORA baseline (v14)

| Metric | s002 | s003 | s004 | v14 target |
|--------|------|------|------|------------|
| Gross lead time (median, all slices) | ~2,520s | ~3,960s | ~42,700s wall (75 min agent) | < 3600s wall in-session |
| Deployment frequency | 2/active-day | 3/active-day | 3/active-day | ≥ 3/active-day |
| Change failure rate | 20% | 33% | 33% (1 prod failure / 3 deploys; CI failures reclassified §31) | 0% |
| MTTR | 222s | 257s | ~9h (inflated by overnight re-validation gap; fix-to-redeploy was ~18 min) | < 600s, validated same-session |

**Computed baseline (2026-06-06):** `lead=2979s freq=3/day cfr=33% mttr=292s`

**Named constraint:** CFR. Three consecutive slices each shipped exactly one
production-reaching failure (s002 stale smoke, s003 fragile selector, s004
cross-stack contract). The first two classes are fixed at source (§22–23,
zero recurrence in s004). s004's class is new: **contracts that span stack
boundaries are not pinned by per-stack tests**. Attack via §30.

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

## 19. CICD pipeline pre-flight checklist (v9, extended v14)

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
- [ ] **(v14, s004)** Any build artifact CDK `fromAsset()` needs at synth time
      (e.g. Lambda `dist/`) is gitignored — the workflow must build it before
      synth, and the source path must be in the workflow's path trigger
- [ ] **(v14, s004)** Stacks linked by `CfnOutput` exports deploy **sequentially**
      (separate workflow steps), never as one `cdk deploy A B` batch — CDK batch
      deploys concurrently and the export does not exist on first deploy

**Runner environment:**
- [ ] Each job that runs tests/tools installs its own dependencies — but
      **(v14, s004)** beware `npm ci` with a lock file generated on a different
      platform (macOS/arm64 lock may exclude linux-x64 optional native deps);
      use `npm install` for that job or regenerate the lock on linux
- [ ] Node.js action versions are pinned to a version supporting the current
      runner Node.js (set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` until
      action maintainers catch up)
- [ ] **(v14, s004)** CI test steps invoke `vitest run` (or `--run`) explicitly
      — a bare `npm test` mapped to watch mode hangs the job

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

## 21. Architecture-lite path for pre-tagged no-backend slices (v11)

When the active chunk is **explicitly tagged in `architecture/current.md`** as
"no backend" or "client-only" (e.g., the C2-3 tag), the solution-architect
follows a lightweight review path instead of a full delta:

1. Confirm the no-backend tag still holds for this slice (no new data flows,
   no new principals, no new infrastructure).
2. Write a brief delta (target < 5 min): what React/UI changes, what does NOT
   change, one-line security conclusion.
3. Auto-accept applies immediately (§8a) — no new attack surface by definition.

**When this path does NOT apply:** any time the slice introduces a new service,
API call, data persistence, or trust relationship — revert to full delta.

## 22. Engineer done condition — surface changes (v11, broadened v12)

When a slice **changes or adds interactive controls to a screen that has
existing smoke tests**, the engineer's done condition includes:

> **Verify `tests/smoke/` selectors still isolate the correct elements.**
> If the slice adds, removes, or renames buttons/inputs/links on a screen
> the smoke suite navigates to, confirm smoke helpers find the right elements
> after the change — not just that count assertions pass.

Trigger examples:
- Root route rewired to a different component
- A prominent element removed or renamed at a smoke-tested URL
- New interactive controls added to a smoke-tested screen
- Mode selectors, toolbars, or navigation added alongside existing game controls

**Scored (s004):** Play Online button added to a smoke-tested screen; zero
smoke regressions. Rule confirmed working.

## 23. Stable smoke selector mandate (v12)

All smoke test helpers that select a **specific category of interactive element**
(board cells, specific buttons, form fields) **must use a stable semantic
identifier**, not a derived count or text-exclusion filter.

| ✓ Use | ✗ Do not use |
|-------|-------------|
| `page.locator('[aria-label^="cell "]')` | `getByRole('button').filter({ hasNotText: /play again/i })` |
| `page.locator('[data-testid="board-cell"]')` | `getByRole('button').nth(N)` |
| `page.getByRole('button', { name: /play again/i })` | `getByRole('button')` with count assertion |

**Applies at authoring time** — to the engineer writing smoke tests AND the
tester writing validation specs.

**Current stable selectors for oxo-online:** `[aria-label^="cell "]` (cells),
`[aria-label="play online"]`, `[data-testid="game-code"]`, `[data-testid="spinner"]`.

**Scored (s004):** CFR from fragile selectors = 0. Rule confirmed working.

## 25. Working-directory convention (v13 — confirmed working s004)

**All orchestrator and agent commands run from the project root
(`/Users/johnnicholas/Documents/Claude/Projects/Claufe_Code_agent_design/`).**

| Anti-pattern | Fix |
|---|---|
| `cd /path/to/app && npm run test:run` | `npm --prefix work/<project>/src/app run test:run` from project root |
| `cd /path && python3 .claude/skills/.../dora.py` | `python3 .claude/skills/dora-ledger/scripts/dora.py` — always project-root-relative |
| Novel `gh` variants prompting each time | Add to committed allowlist (§26) |

Use `make -C work/<project>/src/infra <target>` instead of `cd`-ing into infra.

**Scored (s004):** zero compound-command permission prompts. Confirmed working.

## 26. Committed project allowlist (v13 — confirmed working s004)

A project-level `.claude/settings.json` (committed, not `.local`) captures stable
allowlist patterns so all agents work without prompts across sessions. Run
`/fewer-permission-prompts` after any session that introduces new recurring
command patterns.

## 27. Change-set queued for next iteration

(Scored items from v14–v24 live in `process-history/v24-2026-06-06.md`.)

- **Walking-skeleton probe (§30 v25)** — applies to the next slice introducing
  a new platform mechanism (h1's WAF attach counts: probe = burst test against
  the deployed ACL before building on it). Target: CFR 0% on new-mechanism
  slices; MTTR < 900s on any defect (4 of 6 s005 causes were skeleton-
  detectable).
- **Code↔policy contract (§30 v25) + IMP-004 synth scan** — engineer pins per
  handler now; automated SDK-commands-vs-grants scan when IMP-004 is built.
  Target: CFR.
- **§40 UC flags — still unscored** — not exercised in s005 (file ownership
  sufficed; Set C single-engineer); two stash incidents prove the underlying
  need. Exercise on the next shared-seam parallel set or score moot. Related:
  IMP-005 per-agent ledger shards (the ledger is the one shared append-file
  causing rebase friction).
- **§8b pipelining — operationalised this slice** (h1 planned during s005
  validation, gate-2-ready before delivery). Keep measuring delivery gap;
  target < 15 min.
- **§41 + OI-17/18 hexagonal/supportability refactor** — scheduled into s006
  (same handlers). Early signal positive: R2's categorised logging was used in
  diagnosis the same day it shipped.
- **principles/01 version identity (OI-25)** — implement in the next slice that
  touches each surface; tester then gains identity-before-behaviour.

## 28. Auto-retro at delivery (v14 — human-directed)

**When a slice is marked `delivered` (validation passed, decision-log row
written), the orchestrator runs the retro immediately and automatically in the
same session — no human prompt, no wait.** The human can interrupt or redirect
the retro, but their absence must not delay it.

`/iteration-run` therefore ends at retro-complete, not at "prompt for retro".

**Targets:** gross lead time + delivery gap. **Anticipated effect:** removes the
end-of-iteration human-prompt wait (minutes to hours, and the class of overnight
gaps seen in ox/s004) from every slice; retro learnings land before the next
slice starts instead of after an idle gap.

## 29. Documenter runs in parallel (v14 — human-directed)

**Nothing in the process depends on documentation output.** At delivery, the
orchestrator dispatches the documenter **in the background, in parallel with the
retro** (and with N+1 planning where applicable). No gate, agent, or loop step
waits on it. The documenter commits its own changes; honesty rule unchanged —
document what shipped, not what was planned.

**Targets:** gross lead time. **Anticipated effect:** documenter wall-clock
(~2–5 min) drops out of the critical path entirely; first exercised at the
s004 retro (documenter ran concurrently, committed `968a28b`).

## 30. Cross-stack contract tests at synth time (v14 — new)

**When a request path crosses an infrastructure boundary owned by more than one
stack (CDN behaviour → API route → handler), a synth-time test must assert the
contract between the synthesised templates — not just each side in isolation.**

s004 evidence: `OxoOnlineProd` synthesised a CF behaviour for `/api/*` and
`OxoGameProd` synthesised route key `POST /games`; both suites were green, yet
the composed system 404'd in production (DEFECT-004-001). The defect was fully
detectable at synth time.

Rule for the engineer (route step in Phase B equivalent):
- Synthesise **both** templates in one test file.
- Assert path consistency end-to-end: the path pattern the CDN forwards
  (including any `OriginPath` stripping) must literally match a route key on the
  receiving API (e.g. CF forwards `/api/games` ⇒ a route `POST /api/games`
  exists; or CF strips `/api` ⇒ `POST /games` exists).
- Apply the same idea to any future boundary: WebSocket stage paths, custom
  origins, queue/topic names passed across stacks by string.

oxo-online now has a pinned regression: `game-stack.test.ts` asserts
`RouteKey: 'POST /api/games'` matching the CF `/api/*` behaviour. Slice 005
added the composed-template WS contract test (D1/T7) — that class did not
recur.

**Walking-skeleton probe (v25, from DEFECT-005-001).** Synth contracts cannot
see PLATFORM RUNTIME semantics. When a slice introduces a **new platform
integration mechanism** (first WebSocket, first CDN behaviour class, first
auth flow, first queue), the route MUST include an early step that drives ONE
real request through the full new path **with the real client technology**
(a browser for web — node-level probes bypass CSP, config wiring, and
event-ordering) against the deployed surface, BEFORE use cases are built on
top. Evidence: 4 of 6 stacked root causes in s005's defect (undeliverable
close codes, frame/close race, unreferenced config.js, CSP-blocked WSS) were
visible ONLY to a real browser in prod — each individually cheap at skeleton
time, jointly a 1h37m MTTR at slice end. The architect's delta names when the
mechanism is new; the engineer's route places the probe; the deploy schedule
allows the early thin deploy it implies.

**Code↔policy contract (v25, from DEFECT-005-001 R2).** Where IAM grants a
narrow action set, the writing code carries a test pinning it to granted
actions (least-privilege correctly broke drifted code in prod — S1 asserted
grants, nothing asserted needs). Engineer-owned per handler; a synth-time
automated scan is queued as IMP-004.

**Targets:** CFR → 0% (named constraint), lead time (the defect-discovery
cycle moves from slice-end to skeleton-time). **Anticipated effect:** new-
mechanism slices surface platform/browser/policy mismatches in the first probe
step, not in production validation.

## 31. CFR ledger convention (v14 — definitional)

DORA change failure rate counts **changes that fail in production / for users**.
Therefore:

- `failure` / `recovery` events: production-impacting only (failed smoke against
  prod, defect found in live validation, user-visible regression). These count
  toward CFR and MTTR.
- `pipeline_failure` / `pipeline_recovery` events: CI/CD runs that go red
  **before** the change reaches production. These do NOT count toward CFR/MTTR —
  they are pipeline-iteration waits (§3) and are attacked via §19–20.

Applied retroactively to s004's three CI failures (reclassified 2026-06-06).
The orchestrator must not use this to hide real failures: anything a user could
have observed is `failure`, full stop.

**Targets:** metric integrity (CFR reflects its DORA definition). **Anticipated
effect:** CFR reads 33% not 67% for the same history; trend remains honest.
