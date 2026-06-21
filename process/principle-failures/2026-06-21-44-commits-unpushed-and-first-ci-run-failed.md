# 2026-06-21 — 44 commits accumulated unpushed; first-ever CI run then failed twice

**Class:** continuous-deployment / integration discipline. §14 commit-discipline
(the blanket no-push), §19a/EXP-062 (pipeline proven, not assumed). Founding
evidence for EXP-069 (push-on-green) + EXP-070 (CI-watch / divergence-is-a-defect),
and a partial score against EXP-062.

## What happened
OagEventSource's local `main` was **44 commits ahead of `origin/main`** — every
requirement-closeout commit (SLC-009, DEFECT-OAG-005/006/008, the projection-backfill,
the SST-converted `infra.yml`) lived only on the machine. Nothing had been pushed
since before SLC-009. The project was treated as "core-delivered" while none of that
work had ever been through CI or deployed by the pipeline.

When finally pushed, `infra.yml` ran for the **first time ever** and failed twice:
1. `✕ aws: failed to get shared config profile, default` — the deploy step forced
   `AWS_PROFILE=default` and `sst.config.ts` did `profile: AWS_PROFILE ?? "sandbox"`,
   so Pulumi looked for a shared-config profile that does not exist on the runner
   instead of using the OIDC env credentials it had just been given.
2. `AccessDeniedException: ssm:GetParameter on /sst/bootstrap` — the
   `oag-sst-deploy-sandbox` role had the correct OIDC **trust** policy but **zero
   permissions** attached (created 2026-06-18, never granted).

## Why it's a deviation
1. **Integration is part of done.** The blanket "never push, local trunk only"
   (v59 §14 / EXP-049) — written for genuinely local-by-default, no-remote work
   repos — was applied to a repo that *has* a verified remote. The result was a giant
   invisible WIP buffer: all integration and deploy risk deferred into one big-bang
   event. 44 commits should never have been reachable.
2. **A pipeline is not "proven" until it has run green.** §19a/EXP-062 already said
   the converted pipeline must be proven via pre-flight + walking-skeleton probe
   *through* the pipeline. That proof was deferred to an open item (OI-007), so the
   pipeline's first real execution was a session later — exactly the deferral §19a
   forbids, applied to the proof rather than the conversion.
3. **A green-local / red-CI run is information, not noise.** Both failures were
   knowable: (1) a CI-only credential path the local suite never exercised; (2) a
   manual config (the role's permission grant) that was never automated. "There is
   no reason a CI run should fail when local passes" — when it does, either local
   coverage is missing or a manual step needs automating.

## Root cause
Two policies combined: the blanket no-push kept work local indefinitely, and the
deferred pipeline proof meant the first integration was also the first time the
pipeline (and the role, and the credential path) had ever been exercised. With no
push, there was no CI signal; with no CI signal, the latent failures stayed latent.

## Fix (routed → v60)
- **process §14 (revised, EXP-069):** push trunk to a *verified* remote as part of
  each use-case's done-condition; never batch. Unverified/no remote → do not push
  (the 2026-06-17 guard stays).
- **process §19b (new, EXP-070):** every push sets off a non-blocking CI watch
  (`make ci-watch`); a red run where local was green is a DEFECT closed by exactly
  one of {close the local coverage gap | runbook + automate the manual config}.
- **process §19a / EXP-062 (tightened):** "proven" = the pipeline EXECUTED GREEN in
  its introducing slice; never deferred to an open item.
- **engineer.md:** commit-when-green now continues to push-when-UC-done + watch + raise.
- **cicd.md:** migration "proven" = green in-slice run; the divergence dichotomy.
- **tools:** `work/OagEventSource/scripts/ci-watch.sh` + `make ci-watch` (the watch);
  `scripts/bootstrap-deploy-role.sh` (automates the category-2 manual config).

Targets deployment frequency + gross lead time (EXP-069), MTTR + CFR (EXP-070, EXP-062).
