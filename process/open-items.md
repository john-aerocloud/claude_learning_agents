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
- **OI: lean per-item board projection + a deterministic description render-script**
  (token cost + reliability). Evidence sharpened 2026-07-12: the `linear` agent used
  ~100–170k tokens per call AND, when asked to bulk-enrich 14 tickets with the §2a
  5-section descriptions, it BALKED (couldn't hold 14×5 in one run) — because composing
  rich descriptions by LLM per call is the wrong shape. **Fix (improvement-slice):** a
  committed, tested script (e.g. `.claude/skills/work-items/scripts/render-ticket.py <ID>`)
  that DETERMINISTICALLY renders the §2a Markdown description from the item file +
  `personas.md`/`jtbd-map.md` + the parent chain — no LLM composition. The `linear`/`jira`
  agent then just calls the script and does the one API upsert (cheap, reliable,
  idempotent), and a full-sweep BACKFILL of all existing tickets becomes a trivial loop.
  Backfills the 11 done tickets (ROC-2..11) that the manual enrichment can't economically
  reach. Scored on DORA-value-per-token (board freshness/detail unharmed). Needs
  building+testing → an improvement-slice, not an inline change.
- **OI-BUNDLE-DRIFT (AdixOut, 2026-07-12):** committed pre-built handler bundles
  (`work/AdixOut/infra/assets/*/handler.mjs`) can go STALE relative to source — the
  engineer changed domain source (90d0afd) without rebuilding the committed bundle, and
  cicd's deploy-time `bundle-all` regenerated it and had to commit a reconcile
  (`bca4dac`). No defect resulted (the deploy rebuilds from source, so the DEPLOYED code
  was correct), but it is recurring reconcile-commit noise and briefly makes a "clean
  tree" contain a stale artifact. Deferred from the v86 retro (not the constraint, not a
  defect — constraint gate). Fix when picked up: either (a) the engineer rebuilds the
  bundle (`make bundle-all`) as part of any handler-source change and commits it in the
  green commit (route to engineer.md), or (b) a post-`bundle-all` freshness assertion in
  the deploy path fails if regeneration dirties the tree (the committed bundle was
  stale) — turning drift into a caught error rather than a silent reconcile. Owner: cicd
  + engineer. The bundles are a DELIBERATE committed asset (architecture decision), so do
  NOT simply gitignore them without the architect.
- **OI-COVERS-NODEID (AdixOut, 2026-07-13) — RESOLVED 2026-07-14 via route (b).**
  `make impacted-tests` now resolves the correct nested-repo git root (EXP-104), but on
  AdixOut its 17 `@covers` tags (`domain-map`, `domain-serialize`, `domain-conformance`,
  `adapter-subscribe`, ...) used a semantic-domain vocabulary that matched NONE of the
  `.mmd` node ids (`MAP`, `G_CONF`, `C11`, `POLL`, ...) — a real, thoughtfully-applied
  tagging convention, just keyed to a different id space than the architecture diagram.
  **Fix shipped (route b, alias mechanism):** `impacted-tests.js` now parses
  `%% @alias <nodeId>=<tag>,<tag>` comment lines in `architecture/dependencies/*.mmd`
  (`parseAliasComments`) and, for a changed node, unions its directly-tagged specs with
  the specs of every aliased tag (`effectiveSpecsFor`); an adopted alias also suppresses
  the convention-mismatch WARNING for the tags it reconciles. Purely ADDITIVE — a `.mmd`
  with no `@alias` line behaves exactly as before, so no other project is affected.
  Route (b) was chosen over (a) retag because the `@covers` vocabulary is deliberately
  finer/more-semantic than the terse diagram ids, and the diagram is explicitly a
  "LIGHTWEIGHT, context-only; NOT a build spec" sketch — coupling thoughtful test tags
  to a non-authoritative sketch's ids (and flattening `domain-map`+`domain-serialize`
  into one `MAP`) would be backwards. AdixOut's `data-flow.mmd` now carries 11 `@alias`
  lines; `make impacted-tests SINCE=594fe8e PROJECT=AdixOut` reports MAP/G_CONF/G_KEY/
  G_THROTTLE as IMPACTED (was 4×UNCOVERED + warning), EXIT 0 clean. 7 new self-tests
  added (29 total green via `make test-tools`). Unblocks the EXP-104 measurement
  (impacted-tests usable on AdixOut with 0 false-UNCOVERED). Target met: CFR / tester
  lead time — a changed node with a genuinely-existing covering spec now shows IMPACTED.
- **OI-WI-DONEMOVE-UNTRACKED (shared machinery, 2026-07-15) — RESOLVED.** When an
  item became terminal, `work-items.py` `_maybe_relocate` did `os.replace(active→done)`
  with NO git operation, so the new `items/done/<ID>.md` was left UNTRACKED and a later
  *targeted* `git add <paths>` in the commit step silently missed it (recurred:
  UC-ADIX-009 `47e71f5`, UC-ADIX-010 `44659c2`, both needed a manual follow-up add).
  **Fix:** `_maybe_relocate` now best-effort stages the rename in the project repo
  (`git add -A -- <old> <new>`) via `_git_stage_relocation` — guarded to NEVER raise
  or affect the move (relocation already succeeded), a silent no-op outside a git repo
  (the machinery's temp-dir tests) and in the parent/integration tree (`work/*`
  gitignored). Staging, not committing — the caller still owns the commit. 1 new
  self-test (`test_relocation_to_done_is_staged_in_git_not_left_untracked`, 104 total
  green). The comma-truncation sibling defect was already fixed earlier (regression
  tests present); the nested-repo sibling was EXP-104. Target: git hygiene of the SSOT
  — a completed item is never left out of version control.

## OFS retro 2026-07-21 — minor coverage/tagging + process nits (non-blocking)
- **UC-C2 200-row overflow — no live-browser DOM proof.** The `DRILLDOWN_ROW_CAP=200` head-kept+"+N more" is proven exhaustively at the headless/pure-function tier (`drilldownView.test.ts`); the analogous UC-B1 queue-overflow is browser-proven, so judged proportionate not to block. Add a live e2e overflow assertion when CHK-C is next touched.
- **`@covers` tag gaps.** `idinput` (SEC-C1-1/3 gate) and, earlier-noted, some multi-line-tagged nodes lack a literal `@covers <node>` tag though the behaviour is covered — impacted-tests would falsely flag them uncovered. (The multi-line `@covers` PARSER bug itself was fixed this session in `.claude/tools/impacted-tests.js` + regression test; this is the residual tag-hygiene follow-up.)
- **Process-doc nit: `wi-append EVENT=registered` instruction is wrong for aggregates/use-cases.** The command/skill text tells the registering agent to `make wi-append ... EVENT=registered`, but the machinery rejects it (a use-case's initial state already IS `registered` with no modeled transition; a slice/chunk is an aggregate and `append` refuses aggregates). The working convention (used by every sibling item) is to hand-author the `registered` event into the new item file's frontmatter at creation. Reconcile the instruction text with actual tool behaviour so the next agent doesn't hit the rejected-append surprise. (Surfaced by product on SLC-C1/UC-C1/UC-C2 registration.)
