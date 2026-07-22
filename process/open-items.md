# Process open items — carry-forward register

Project-agnostic system-learning obligations: unscored anticipated effects and
queued items that survive every refactor (scored history lives in
`process-history/`). This is the §22 carry-forward, held outside `process-current.md`
so the rulebook stays rules. The retro harvests and re-prioritises this list each
cycle; §10 (next-work selection) and §24 (improvement slices) read it.

_Moved out of process-current.md §22 at the v59 consolidation (2026-06-19)._

- **Walking-skeleton probe (§17)** — applies to the next slice introducing a new
  platform mechanism. Target: CFR 0% on new-mechanism slices; MTTR < 900s on any
  defect.
- **Browser skeleton probe + Playwright MCP — IMP-006 (v27)** — the §17 probe
  for a web surface must drive a REAL browser, not a node probe (node gives a
  false green on CSP/config/transport). Build the committed `tests/skeleton/`
  browser probe; human-gated decision on installing the Playwright MCP server
  for live exploratory discovery. Target: MTTR (browser-only causes surface at
  skeleton time, not after a tester hand-off) — directly attacks the tester
  constraint. Score on the next new-mechanism browser slice: 0 browser-only root
  causes reaching prod.
- **Code↔policy contract (§17) + IMP-004 synth scan** — engineer pins code to
  granted IAM actions per handler now; automated SDK-commands-vs-grants scan
  when IMP-004 is built. Target: CFR.
- **Use-case flags — SCORED MET at v31** (H2_ENFORCE ran the full §40 lifecycle
  on a real shared seam; two-phase rollout prevented enforcement-before-
  credentials breakage by design). (The former IMP-005 per-agent-ledger-shards
  follow-on is CLOSED — the DORA ledger is frozen and items are inherently
  per-file disjoint under v82.)
- **Shared change-impact model (§12c, v31)** — author the initial model for
  each live project (oxo-online retrofit = OI-31, scheduled with the OI-17
  hexagonal refactor at s006 — same archaeology, one pass). Score at the next
  two slice retros: tester median task time (target < 900s), CFR on slices
  where the model named the changed areas (target: no defect in an area the
  model showed as changed-but-untested), §19-class schedule violations (target
  0 — read-before-build).
- **IMP-007 impacted-tests tooling** — mechanical `@covers`-tag → changed-node
  lookup (`make impacted-tests SINCE=<sha>`). Target: tester; done condition in
  the IMP file.
- **N+1 pipelining (§F3a)** — operationalised: plan slice N+1 to gate-ready during
  slice N validation. Keep measuring delivery gap; target < 15 min.
- **Hexagonal / supportability refactor (OI-17/18)** — scheduled into the next
  slice on the same handlers. Early signal positive: categorised logging was
  used in diagnosis the same day it shipped.
- **principles/01 version identity (OI-25)** — implement on the next slice that
  touches each surface; tester then gains identity-before-behaviour for real.

## Re-baseline follow-ups (v59, 2026-06-19)
- **settings.json allowlist factoring** — ~160 global + ~60 local patterns,
  heavily project-specific (work/OagEventSource, oxo-online, observatory). Factor
  project-scoped patterns so the global allowlist stays a reviewable core. Not a
  failure source; low priority.

_(v82 slim: the three-writer coherence-retrofit item and the per-event
historical-ledger backfill item were removed — both were made moot by the F0
event-sourced cutover: state is fold(events) in one store, and the frozen DORA
CSV is no longer the metrics source.)_

## Deferred at the ROC retro (2026-07-12) — real but NOT constraint-targeting (change budget went to EXP-104)
- **OI: agents must never run interactive/long-blocking commands** — the ROC cicd
  agent stalled the 600s watchdog on an interactive Vite scaffolder / a `gh auth refresh`
  device-flow prompt, costing ~10 min + a re-dispatch. Route (when picked up): a cicd.md +
  §33 rule — no interactive prompts in an agent (use `--yes`/non-interactive flags,
  pre-provisioned auth), and background genuinely long installs. Single data point so far;
  promote to an experiment if it recurs. Targets: lead time (avoid watchdog stalls).
- **OI: lean per-item board projection (token cost)** — the `linear` projection agent used
  ~100–140k tokens PER per-item push (updating 1–2 issue statuses), because it reloads broad
  context each call. Route: trim the linear agent to a truly minimal single-id upsert (read
  one item, one API call, no full-board re-read) — preserving the EXP-103 in-cycle freshness
  at a fraction of the tokens. Scored on DORA-value-per-token (board freshness must not
  regress). Deferred: token efficiency, not the current (queue-wait) constraint.

## OI — Linear/Jira sync tooling not rebuilt for v82 event-sourced items (OAG DEF-XA3 retro 2026-07-22)
`scripts/sync-linear.py` was RETIRED in the v82 cutover (f9cd5a1, "dead scripts")
but the `linear`/`jira` projection agents still DEPEND on it, and the old source
does not parse v82 per-item event-sourced files (dry-run against UC-XA4:
"not a known use-case or live defect"). Symptom this cycle: the DEF-XA3 board push
(OAG-150) only succeeded via a leftover `.pyc`; the UC-XA4 push then failed, and a
raw-curl fallback tried to INLINE the API key and was correctly blocked as
credential leakage. Net: per-item board pushes for use-case items flake, so board
state can silently lag the SSOT (the exact board/doc-lag failure §F9 step-4 exists
to prevent). Route: an improvement slice (§32) to rebuild a minimal v82-native
projection — read ONE item file, upsert ONE issue, key loaded from
`secrets/linear.local.json` at runtime (NEVER inlined), no whole-board re-read
(compose with the EXP-104 token-trim open-item above). DEFERRED: not the current
(queue-wait) constraint, and the SSOT remains correct meanwhile. Safety note: the
key-inlining fallback must never be used — a projection that cannot use the
key-from-secrets path STOPS and reports.

## OI — dead deploy-role PutEvents-on-oag-event-bus grant (OAG, after UC-XA11, 2026-07-22)
UC-XA11 removed `oag-event-bus`, but `infra/policies/sst-deploy*.json` still grants
`events:PutEvents` on the now-deleted bus (pinned by
`deploy-role-putevents-grant-uceb5.test.ts`). HARMLESS (grants nothing usable — the
resource is gone) but dead config. Follow-up cleanup: drop the grant + retire/adjust
its pin test. Deliberately NOT folded into UC-XA11 to keep that deletion minimal.
Low priority; not a delivery blocker.
