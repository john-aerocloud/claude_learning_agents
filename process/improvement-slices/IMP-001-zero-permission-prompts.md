# IMP-001 — Zero permission prompts in a normal slice

**Status:** delivered 2026-06-06 (measure at next slice)
**Owner:** orchestrator (spec) / cicd (allowlist) / all agents (behaviour)

## Job

Human permission prompts are the largest *recurring* micro-wait in the pipeline
(15–60s each, plus human context-switch cost) and they serialise otherwise
autonomous agent work. Evidence: despite a committed allowlist, the first
backend slice surfaced (a) an entire unallowlisted CLI class (AWS), and
(b) 31 compound-prefixed commands (`cd … &&`, `source … &&`) from subagents
that bypass every allowlist pattern.

## DORA target

- **Gross lead time**: prompt-pauses per slice → 0 (each pause also risks an
  overnight gap if the human is absent).
- **Deployment frequency** (protects): no human-in-the-loop for operations the
  process already protects.

## Done condition (testable)

1. A normal slice (plan → build → deploy → validate → retro) completes with
   **zero permission prompts**.
2. Every agent definition carries the **"Command form — allowlist contract"**
   section: commands are emitted in allowlist-shaped forms (`npm --prefix`,
   `make -C`, `git -C`, root-relative paths; never `cd`/`source` compound
   prefixes). The allowlist is used as designed — never bypassed or
   intercepted.
3. Agents that hit a genuine allowlist gap name it in their return as a
   capability gap, so it is closed in the same slice (cicd capability step) —
   instead of improvising novel command shapes that prompt.
4. Any prompt that still occurs is triaged at the retro: new surface
   (→ allowlist), avoidable command form (→ principle-failure), or genuinely
   novel/destructive (prompt was correct).

## Protection (what replaces the prompt)

| Removed prompt | Protected by |
|---|---|
| `git add/commit/push` to trunk | §17: commit only when tests+lint green; gates precede deploys |
| AWS read-only CLI | read-only by definition; scoped patterns, no wildcards |
| `make -C … deploy-oidc` | exact target only; human gate-4 precedes it; IAM diff is CDK-reviewed |
| dora.py / committed scripts | exact-path allowlist; script is committed + reviewable |
| Compound commands | never emitted — agent definitions mandate allowlist-shaped forms |

## Implemented

- Allowlist extended: AWS read-only set, `npx cdk synth/diff`, `npx vitest run`,
  exact make target, `gh variable`, project prod-endpoint curl.
- "Command form — allowlist contract" section appended to all seven agent
  definitions (the source fix: subagents never carried the rules before).
- Process §33 (tools-over-permissions) added at v15.
- Explicitly rejected: hook-based interception of commands. The allowlist is
  not bypassed or policed around — it is used in forms that do not generate
  needless prompts (human decision, 2026-06-06).

## Score at next slice

Count permission prompts across the full slice. Target 0. Any prompt that does
occur is triaged: new surface (→ allowlist in capability step), convention
violation (→ principle-failure), or genuinely novel/destructive (prompt was
correct).
