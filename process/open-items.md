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

## AdixOut v106 focused-retro 2026-07-24 — machinery consideration (do NOT build now)
- **OI-WI-BLOCKED-UNBLOCK-TRANSITION (shared machinery, 2026-07-24).** When a defect is
  BLOCKED-then-unblocked by a SIBLING defect's fix and needs NO new code of its own, the
  item is stuck in `fixing` and the tester cannot append `validated` — the state graph
  requires an engineer `fixed` before a tester `validated`. On DEF-AIDX-006 (a stale probe
  unblocked by the sibling handler being correct) the orchestrator handled it by appending
  `fixed`(engineer, note "no new code — sibling fix unblocked it") then `validated`(tester)
  with correct attribution. That is a fine one-off. Possible future machinery: an explicit
  `unblocked`→`validating` transition so a no-new-code sibling-unblock does not need a
  cosmetic `fixed` event. Minor — record only; do NOT build a graph change now (constraint
  gate; the manual bridge is cheap and correctly attributed).

## OFS retro 2026-07-21 — minor coverage/tagging + process nits (non-blocking)
- **UC-C2 200-row overflow — no live-browser DOM proof.** The `DRILLDOWN_ROW_CAP=200` head-kept+"+N more" is proven exhaustively at the headless/pure-function tier (`drilldownView.test.ts`); the analogous UC-B1 queue-overflow is browser-proven, so judged proportionate not to block. Add a live e2e overflow assertion when CHK-C is next touched.
- **`@covers` tag gaps.** `idinput` (SEC-C1-1/3 gate) and, earlier-noted, some multi-line-tagged nodes lack a literal `@covers <node>` tag though the behaviour is covered — impacted-tests would falsely flag them uncovered. (The multi-line `@covers` PARSER bug itself was fixed this session in `.claude/tools/impacted-tests.js` + regression test; this is the residual tag-hygiene follow-up.)
- **Process-doc nit: `wi-append EVENT=registered` instruction is wrong for aggregates/use-cases.** The command/skill text tells the registering agent to `make wi-append ... EVENT=registered`, but the machinery rejects it (a use-case's initial state already IS `registered` with no modeled transition; a slice/chunk is an aggregate and `append` refuses aggregates). The working convention (used by every sibling item) is to hand-author the `registered` event into the new item file's frontmatter at creation. Reconcile the instruction text with actual tool behaviour so the next agent doesn't hit the rejected-append surprise. (Surfaced by product on SLC-C1/UC-C1/UC-C2 registration.)

## OFS gap-closing retro 2026-07-28 (DEF-004) — secondary findings
- **Comma-in-event-note truncation RECURRED (machinery).** Product's REQ-OFS-6 `wi-append` note with an unquoted comma was silently truncated on `wi-project` re-serialization — the same class as the 938db37 comma-fix, which the memory `wi-machinery-defects` marks FIXED. Either the fix doesn't cover the hand-authored-frontmatter path, or a new path regressed. Re-examine the wi-* re-serializer against unquoted commas in `note:`; until then agents use semicolons in notes (worked around). Owner: wi machinery (parent repo).
- **e2e/ specs not in the `tsc -b` build graph (DEF-006-class, cicd/engineer).** The Playwright `e2e/` directory type-checks clean only under a scratch config; no committed `tsconfig` includes it in the build graph, so a type error in an e2e spec wouldn't fail the build. Add a committed `tsconfig.e2e.json` wired into `tsc -b`. Surfaced by the DEF-004 tester.

## OFS retro 2026-07-28 (v115, routine batch REQ-OFS-5+REQ-OFS-6) — recurring tooling frictions
- **impacted-tests SINCE-window under-reports (cicd/machinery).** When a slice's architecture gate front-loads all `:::changed` marks in one commit at slice-registration, a UC's own last-validated-ref SINCE window excludes that commit → "no changed nodes"/thin set; testers re-derived manually on UC-H2/H3/I2/J1/J2. Interim fix folded into tester.md (use the slice's pre-registration baseline SINCE). Machinery follow-up: make `impacted-tests` auto-resolve/warn when the SINCE window predates the slice's arch-gate commit (or default SINCE to the slice baseline). Owner: cicd (tool owner).
- **@covers tag gaps recur (engineer/tester).** Nodes behaviourally covered but missing the literal `@covers <node>` tag (idinput, ratectrl, analyst, UCG1, UCH4/H5, UCI1, UCJ1) — each a re-derivation cycle. Interim: tester.md now says add the tag at spec authoring. Consider a lint/self-test that flags a changed node whose only covering spec lacks the tag.

<!-- ===== OAG instance entries re-added at the v89→v116 fold-forward (2026-07-29) ===== -->
## OI — OAG deploy-role dead PutEvents grant + scratch .mmd render-fails
`infra/policies/sst-deploy*.json` still grants `events:PutEvents` on the deleted `oag-event-bus` (pin `deploy-role-putevents-grant-uceb5.test.ts`) — harmless dead config; drop grant + retire pin. AND `architecture/{hydration-consumer-component,hydration-seq-coldstart,hydration-seq-recovery,dependencies/class-deps}.mmd` fail `make render-diagrams` on old edge-label syntax (4 total, pre-existing/scratch). Low priority, docs/dead-config only.

## OI — remove orphaned instance board-projection tool (superseded by main's .claude/tools/linear-project.py)
The v89→v116 fold-forward adopted main's canonical board-projection tool (`.claude/tools/linear-project.py`, `make board-project ... ID=`). This instance's parallel implementation under `.claude/skills/board-projection/` (board_project.py + tests) + `IMP-018` are now redundant/orphaned (no Makefile target points at them). Cleanup: delete the skills/board-projection scripts + mark IMP-018 superseded. No behaviour depends on them post-merge.

## OI — OAG 2026-07-29 retro change-set (apply as v117 on this reconciled base)
Re-apply the still-valid, main-lacks deltas as v117: (1) pipeline-only environment deploys [check main first]; (2) multi-audience Definition of Done [check main first]; (3) state-graph `deploying/registered → blocked` edges (state-graphs.json). Renumber any experiment rows to the next free EXP (main runs to EXP-118 → start 119). tester render computed-style gate + engineer bundle-drift guard + cicd deploy-role-whole-namespace guard: ADD ONLY if main's evolved agent files (post-merge) lack them (main EXP-118 painted-faithfulness / EXP-114 painted-pixel may already cover the render gate). See principle-failures/reconcile-latency-instance-vskew.md.

## retro-debt classifier: dev-tooling defect-resolve should batch as routine, not trip the immediate incident gate (2026-07-29, ROC v119 — DEFERRED)
`make retro-debt` scores ANY `defect-resolve` event as an IMMEDIATE incident (§F8), but the
incident intent is a PROD defect / deploy-failure. DEF-ROC-010 was a DEV-caught test-tooling
defect (zero prod exposure) yet tripped an immediate retro. Refinement: the event fold should
distinguish prod-exposed defect-resolves (immediate) from dev-only tooling/test defect-resolves
(routine-batch) — needs a clean prod-exposure signal derivable from the item's events (e.g. the
defect ever reached a prod-* state, or a `severity`/`prod_exposed` marker on the `reported`
event). Low urgency: over-tripping only costs one cheap focused retro. Owner: work-items machinery
(retro-debt classifier).

## OI — no `amended` (annotation) edge for in-flight use-case/slice items (2026-07-30, OAG v117)
The `use-case` state graph has NO self-edge / annotation event, so a **definition correction
discovered by the per-slice architecture gate on an already-pulled item cannot be recorded as an
event**. Live case: the SLC-047/SLC-048 gate corrected UC-OC1's scope (the read seam already
served the whole config object) and outright **falsified** UC-XE1's premise (the "stale pilot"
was delivering 51–61k events/day to a real consumer; the item's Definition pointed the engineer
at a file whose edit would have torn down a LIVE consumer). Both corrections had to be carried as
Definition-prose edits by the engineers, citing the deltas — so the *fact that the definition
changed*, and why, is invisible to `fold(events)` and to every derived view and metric. The
`requirement` type has `amended`; flow items do not. Fix: add an annotation transition
(`amended`, from any non-terminal state to itself, agents `[solution-architect, product,
flow-manager, orchestrator]`) to the flow-item graphs in `state-graphs.json`. Owner: work-items
machinery. Worth doing: a gate that falsifies a premise is the highest-value event in the loop and
is currently unrecordable.

## OI — dispatched-agent mid-build death is an unmeasured time thief; resume protocol undocumented (2026-07-30, OAG v117)
Both concurrently-dispatched engineers on the UC-OC1 / UC-XE1 pull died mid-build from harness
causes, not code: one on `API Error: Connection closed mid-response`, one on `Agent stalled: no
progress for 600s (stream watchdog did not recover)`. Each left **partial uncommitted work** in
the shared working tree (one had 1 commit in, 4 of its own TDD-red specs still failing). Two gaps:
(1) **No documented resume protocol** — the recovery that worked was *verify tree state first*
(run the full suite to establish exactly what is green/red and who owns each failure), *then*
resume the agent from its transcript with that state handed to it, rather than restarting the
build from scratch and re-incurring the whole token cost. This should be written into the
orchestrator/loop definition. (2) **The cost is invisible**: an agent death mid-`building` produces
no event, so the wasted wall-clock and tokens are silently folded into the item's `building` time
and attributed to `engineer` — the same misattribution class as the UC-OB1 `deploying`/cicd bug
this cycle also fixed. Consider an `agent_failed` annotation event (depends on the `amended`
self-edge OI above) so harness-induced rework is measurable and can be told apart from engineer
rework in `by_owner`/quality stats. Owner: orchestrator definition + work-items machinery.

## OI — `blocked`/`unblocked` agent-list asymmetry on flow items (2026-07-30, OAG v117)
Both `use-case` and `defect` graphs grant `blocked` to `["flow-manager", "orchestrator"]` but
`unblocked` to `["flow-manager"]` ONLY (`state-graphs.json`). In practice this is backwards: the
orchestrator is typically the role that OBSERVES the external condition clear — on UC-XC4 the
orchestrator verified from CloudWatch (fan-out rule `FailedInvocations` 100pct -> 0, DLQ arrivals
stopped) that AdixOut had applied their prod bus policy, i.e. it held the evidence that the block
had lifted, yet it could not itself append `unblocked` and had to hand the fact to flow-manager to
transcribe. It CAN record the block starting but not the block ending, though both are the same
class of external-condition observation. Two ways to close this, either is fine, but the asymmetry
should be resolved deliberately rather than left as an accident of the v6 state-graph write-up:
(a) widen `unblocked` to `agents: ["flow-manager", "orchestrator"]` to match `blocked`'s agent
list exactly (symmetry-by-construction); or (b) keep `unblocked` flow-manager-only DELIBERATELY
and say why in this file (e.g. "clearing a block is a flow decision — re-admitting an item to Ready
is queue policy, not evidence-recording, so the flow-manager is the accountable last hand even when
another agent supplies the evidence" — plausible, but currently unstated, so an agent hitting the
rejected-append has no way to tell "not yet built" from "deliberately restricted"). Owner: work-items
machinery (state-graphs.json is edited only via the retro/version-bump gate, §current file header).
Do NOT change `state-graphs.json` outside that gate.

## OI — verification-only UCs force agents to SPOOF build/deploy events (2026-07-30, OAG v117)
The `use-case` flow graph has exactly ONE route to `done`: `ready → building → deploying →
dev-validating → … → validated`. A UC whose entire scope is **validating something already built
and deployed** therefore cannot reach `done` honestly. Live case: UC-XC4 ("prod live-delivery smoke
— AdixOut receives a real event") needed no build and no deploy (the fan-out shipped under UC-XC3;
the only missing precondition was AdixOut's own bus policy). To close it, the **tester appended
`built_green` with `AGENT=engineer` and `deployed` with `AGENT=cicd`, both as declared no-ops** —
precisely the spoofing that process-current.md forbids ("engineers/testers must NOT spoof
`AGENT=cicd`"), and it cited UC-XC2/UC-XC3 as established precedent, so this is systemic, not a
one-off lapse. Consequences: `by_owner` attribution gains phantom engineer/cicd effort that nobody
spent, quality-by-stage gains fake `building`/`deploying` exits that can never fail, and the
prohibition is dead letter because following it makes the item uncloseable. Fix options: (a) add a
`validate_only` route (`ready → validating` via a `pulled_for_validation`-style event) for UCs that
assert existing behaviour; or (b) let a UC declare `no_build: true` in frontmatter and have the fold
skip the build/deploy segments. (a) is preferred — it keeps the fold total and makes the intent
explicit at pull time. Owner: work-items machinery. This is the second graph-expressiveness gap
found today (see the missing `amended` annotation edge) and both were discovered the same way: an
agent needed to record something true and the graph had no legal way to say it.

## OI — EventBridge invocation-attempt/latency metrics stop emitting on the prod fan-out rules (2026-07-30, OAG v117)
Found by the tester during the UC-XC4 prod validation. On prod-shared 928618308042, for
`oag-aerobus-fanout-adixout` the metrics `IngestionToInvocationSuccessLatency`,
`InvocationAttempts`, `SuccessfulInvocationAttempts`, `IngestionToInvocationStartLatency` and
`IngestionToInvocationCompleteLatency` **stopped publishing around 12:20 UTC** while
`Invocations`/`MatchedEvents`/`TriggeredRules` continued healthy; for `oag-aerobus-fanout-fids`
(passenger-facing, live in prod) they **never publish at all**. Delivery health was correct
throughout — this is an observability-emission gap, not a delivery failure, and it did NOT block
UC-XC4. But it means latency and attempt-level regressions on the two live prod consumer legs are
currently unobservable, so a slow-but-succeeding fan-out would look identical to a healthy one.
Relates to `OI-XE-CONSUMER-LIST-SOLE-SOURCE` (post-deploy live assertions on both hubs). Needs
registration as a work item; assess whether it is an AWS-side emission condition (e.g. metrics only
publish on certain target types) before treating it as our defect. Owner: cicd/solution-architect.

## OI — `external`-blocked items are never re-checked; a self-cleared block is only discovered by accident (2026-07-30 OAG post-v117)
UC-OA2 was blocked 2026-07-28T12:09 on "sso-admin owed" (DD-OAG-001: keystone OIDC app + dedicated
`oagMaintainer` permission set). The permission set half was actually created 2026-07-28T16:44 UTC —
roughly 4.5 hours after the block was recorded — but the item sat `blocked`/`external` for a further
two full days and was only unblocked because the human happened to paste the role ARNs in chat.
Nothing in the loop ever re-evaluates whether an `external` condition has cleared; once an item is
blocked it is inert until a human volunteers the news. This is the SAME shape as the AdixOut prod
bus-policy block on UC-XC4 (also discovered by accident — the orchestrator happened to re-run a
CloudWatch query) and as UC-OB1 (still blocked today on the `oag/alerts-key` secret, unchecked since
2026-07-30T12:13). Three independent occurrences on this project alone — systemic, not a one-off.

**Consequence for the metric that is supposed to surface this:** `external` currently reads as only
1.73% of measured GLT. That number is an artefact, not a health signal — it excludes exactly the
"already-cleared but not yet noticed" span (UC-OA2's ~2 days of it), because we only start counting
`external` from `blocked` to the human-reported `unblocked`, never from `blocked` to the TRUE clear
time. The real external-wait figure is materially higher; the visible one rewards the failure to
check.

**Concrete mechanism (not just an observation):** a `blocked` event should be able to carry a
machine-checkable **unblock predicate**, and the loop (`/loop-run` cycle, or a lightweight periodic
sweep flow-manager triggers) evaluates every in-flight predicate each cycle instead of waiting on a
human to report the news:
- UC-OA2 (this cycle): `aws iam get-role --role-name AWSReservedSSO_oagMaintainer_<hash> --profile
  <dev-datain|prod-datain>` exits 0 (role exists).
- UC-XC4 (already resolved, cited as the second data point): `FailedInvocations == 0` sustained on
  `oag-aerobus-fanout-adixout` for N consecutive periods (this is exactly the check the orchestrator
  ran manually — mechanising it removes the "happened to re-run a query" dependency).
- UC-OB1 (currently blocked, unresolved): `aws secretsmanager describe-secret --secret-id
  oag/alerts-key --profile dev-datain` exits 0 (secret exists).
Predicate shape: a small declarative `{check: <shell/aws-cli probe>, expect: <exit-0 | field==value>}`
recorded on the `blocked` event itself (so it travels with the item, reviewable in the file, no new
side-store); a cheap sweep (could ride on `make wi-project`, or a dedicated `make wi-sweep-blocked`)
runs every recorded predicate and, on a pass, appends `unblocked` itself with `agent: flow-manager
note: "auto-cleared by predicate <p>"` — turning a silent multi-day external wait into a
next-cycle unblock. Where a predicate can't be cheaply expressed (a genuinely human-only fact, e.g.
"AdixOut confirms receipt"), the item stays a pure human-reported block, unchanged from today — this
targets the SUBSET of external blocks that are actually machine-observable, which on the evidence
above (2 of 3 recent cases) is the majority. Target metric: honest `external` GLT share (expected to
RISE, correctly, as the hidden already-cleared waiting becomes visible) and, going forward, the
`blocked`→true-clear gap trending toward the loop-cycle interval instead of days. Owner: work-items
machinery + flow-manager (predicate evaluation is a flow-manager-owned sweep, not a new agent).

## OI — shared-file sweep collision, SECOND occurrence today (2026-07-30, OAG post-v117)
The UC-XC5 engineer staged isolated `Makefile` / `package.json` / `class-deps.mmd` blobs (its own
build-tooling changes), but the DEFECT-OAG-042 commit `42fbad1` landed in between and committed the
working-tree versions of those same files — so one engineer's build-tooling changes are attributed to
another engineer's commit. Nothing was lost and trunk is consistent (both engineers' actual source
changes are present), but the commit attribution is wrong, and this is the SECOND sweep incident today
(the first was caught pre-push; see the same-day open-items context above). Root cause: `Makefile`,
`package.json` and `class-deps.mmd` are co-owned files that concurrent engineers both touch as a
side-effect of unrelated work, so a commit-sweep by either one silently absorbs the other's staged-but-
uncommitted edits to the same file. Two concrete mitigations, either or both:
(a) **process fix** — serialise edits to shared files through the orchestrator (a shared-file edit is
proposed, sequenced and committed under the orchestrator's control rather than committed opportunistically
by whichever engineer's commit lands first);
(b) **structural fix** — split the co-owned file so each UC/engineer owns a distinct file: e.g. per-slice
`Makefile` targets live in included `.mk` files rather than one shared `Makefile`, and `class-deps.mmd`
per-domain fragments rather than one shared diagram.
**v123 disposition:** the immediate cause is non-adherence, not a missing rule — orchestrator.md has
mandated a `git worktree` per concurrent code-committer since v80/EXP-097 and the orchestrator
dispatched two concurrent committers into ONE tree anyway. v123 makes it a CHECKED dispatch
precondition (orchestrator.md) and logs the non-adherence
(`principle-failures/2026-07-30-orchestrator-asserted-authorised-and-pushed-without-establishing-the-governing-fact.md`).
The structural file-split (b) stays deferred pending a third occurrence — but note the count is now
2-in-one-day, so the third is likely and the refactor should not be re-deferred when it comes.

This is exactly the §F7 shared-file-seam class the flow-manager tracks (two UCs claiming the same source
file are seam-serialised, not co-schedulable) — recurring twice in one day on the SAME file class
(build-tooling) makes it a concrete candidate for the structural refactor (b), not just tighter process
discipline (a). Owner: cicd/engineer (file-split) + orchestrator (serialisation-of-shared-edits process
rule). Track occurrences; a third recurrence on the same file class should force the refactor rather than
another deferral.

## OI — fold-back of instance/OagEventSource v123 is OWED (integration tree dirty) (2026-07-30)
`make project-foldback PROJECT=OagEventSource` returned **exit 3 (DEFERRED)** at the v123 retro
close: the integration tree (`…/Claufe_Code_agent_design`, on `main`) has ONE uncommitted tracked
file — `.claude/settings.local.json`, a MACHINE-LOCAL config file. It was deliberately not touched
(discarding it would destroy the human's local permission grants, and no agent may change
permission settings). So v123 (commits `f4bb86d` + `f7cc4f9`, tag `process-v123`) sits on
`instance/OagEventSource` un-reconciled, which is live gross-lead-time cost under §0a Rule 4.
Two ways it clears, either is fine: (a) run `make project-foldback PROJECT=OagEventSource` once
the integration tree is clean; or (b) land AdixOut's already-authored **untrack
`.claude/settings.local.json`** fix (on `instance/AdixOut`, part of its v121 retro / EXP-113 fix) on
`main` — that removes the recurring cause, since a machine-local file being TRACKED means every
integration tree is permanently dirty and every fold-back is permanently deferred. (b) is the real
fix; note it is the second instance to be blocked by this.

## OI — the `defect` graph has no dev-first leg, so EXP-101 is inexpressible for a defect fix (2026-07-30, OAG v123)
`use-case` carries the locked dev→prod path (`dev-validating --dev_validated--> prod-deploying
--promoted--> prod-validating --validated--> done`), but `defect` goes `fixing --fixed--> validating
--validated--> resolved` with a SINGLE validation state. So a defect fix on a cloud/hosted project
cannot record "validated in dev, then promoted, then validated in prod" — the dev-first assurance
EXP-101 exists to enforce simply has no representation, and both DEFECT-OAG-041/042 fixes this cycle
were validated against prod data with no dev leg recordable. That is why EXP-101 scored "no
opportunity" despite two cloud fixes shipping. Note this is NOT obviously a bug: a defect fix is often
deliberately fixed-forward. But if dev-first is a real assurance it should apply to defect fixes on a
hosted project too, and today the graph silently exempts them. Decide deliberately: either mirror the
dev/prod split onto `defect`, or state here that defect fixes are exempt and why (so EXP-101's measure
can stop counting hosted defect cycles as opportunities). Owner: work-items machinery (state-graph
gate) + EXP-101's measure. Do NOT change `state-graphs.json` outside the retro/version-bump gate.

## OI — EXP-120's provenance gate needs its hardening limbs BUILT on OAG (2026-07-30, OAG v123)
EXP-120 was routed from two ledgers that already exist in the OAG project
(`work/OagEventSource/src/app/tests/defect-oag-04{1,2}-wire-*-provenance.test.ts`), but the seed has
three holes that the experiment's measure explicitly requires closing, and closing them is PROJECT
work that must be registered as a work item on the next OAG cycle (not process work): (1)
**completeness** — the declarations are hand-maintained inline `const` arrays linked to production
code by a free-text `comparedIn` string, so a literal added to production code with NO ledger entry
is undetected; the gate must fail on a MISSING declaration (needs derivation from source, or a lint
on comparisons against inbound-payload values). (2) **corpus soundness** — the 041 sweep indexes ALL
of `fixtures/` including derived/synthetic sets (`oag-version-coverage/`, `oag-doc-samples/`,
`oag-schedule-dlq/synthetic/`), so a literal can be "confirmed" by a fixture we authored ourselves;
the confirmable corpus must be provably-real and separated. (3) **refresh + gate wiring** — the
corpus is grown by a self-described THROWAWAY script (`spike/capture.mjs`, hand-run, needs a
gitignored secret) plus manual curation of a prod capture bucket, and there is no `make
wire-provenance` in the push gate; both are cicd deliverables per cicd.md v123. Also carry the two
known-unexploded holes to closure: `irregularOperationType='Recovery'` and `diversionType` (both in
ZERO captures) must be corpus-confirmed or converted to declared+probed holes. Owner: OAG
engineer + cicd, via a registered work item; EXP-120 scores it.

## OI — untracking `.claude/settings.local.json` DELETES it in every other worktree on fold-forward (2026-07-30, v123)
The v123 fix untracked `.claude/settings.local.json` so a machine-local file could stop deferring
every instance's fold-back. It works — but untracking is a **deletion** in git terms, so the next
`make project-update` in ANY other worktree removes that tree's copy from disk, silently losing its
local `env` + `permissions` grants. Observed immediately: the OagEventSource worktree lost its copy
on the very next fold-forward and had to be restored with
`git show <pre-merge-sha>:.claude/settings.local.json > .claude/settings.local.json`.
**AdixOut, ROC and OperationalFlowSimulator still hold theirs and WILL lose them on their next
fold-forward.** Mitigations, in order of preference: (1) have `.claude/scripts/worktree update`
back the file up before merging and restore it afterwards — it is the only place that knows a
fold-forward is happening, and this makes the whole class safe, not just this file; (2) failing that,
each instance restores from the pre-merge sha as above. Recovery is always possible because the file
is in history up to the untrack commit — but it is silent, which is the actual defect: an agent that
does not notice will run on with the project's default permissions and no `env`. Owner: worktree
tooling (`.claude/scripts/worktree`).

## OI — CRITICAL: agent-worktree auto-clean DESTROYED a completed engineer's work (2026-07-31)
**Real loss, same day the worktree-isolation approach was validated.** The DEFECT-OAG-045 engineer
finished, committed (`74dd4aa`, `1fea9a9`, `6bad51d`, `dc71a54`) and reported in full — then its
worktree was auto-cleaned and **every commit went with it**. Confirmed unrecoverable: no branch, no
directory, no object, nothing in the shared repo touching `hosted-build-guard`. Lost: the vite
`.env.local`-leaks-into-production-builds fix, the hosted-build guard, the fail-closed artifact
byte-scan, 17 tests, and a stale-doc correction — ~3h wall-clock and ~218k tokens.

**Mechanism (exact).** The harness auto-cleans an isolation worktree that is *unchanged*, judged
against the **PARENT** repo's tree. But the project repo lives at `work/<project>/`, which the parent
**gitignores** — and in an agent worktree it is absent, so each engineer *clones it inside the
worktree*. All real work therefore lands in a gitignored nested clone that is **invisible to the
changed-check**. The DEFECT-OAG-044 engineer survived only by accident: it happened to also make a
*parent-repo* commit (a principle-failure log), which marked its worktree changed. 045 made no parent
commit, so it was judged pristine and deleted.

**Root cause is the dispatch brief, i.e. mine.** I wrote "DO NOT PUSH" meaning *do not trigger the
deploy pipeline* (push to `origin/main` on GitHub IS the apply). But a `git clone --local` of the
shared project repo has **the local shared repo as its `origin`** — so pushing there is harmless,
local, and is the ONLY way the work escapes the disposable worktree. The instruction conflated two
different remotes and the engineer obeyed it literally and correctly.

**Fixes, in order:**
1. **Every worktree-isolated dispatch brief must say: push your project-repo commits to your clone's
   `origin` (the local shared repo) before you finish.** Separately and explicitly: never push to
   GitHub `origin/main`. Two remotes, two rules, never one sentence.
2. The orchestrator must **fetch each finished agent's clone into the shared repo** before the
   worktree can be reclaimed (`git fetch <worktree>/work/<project> 'refs/heads/*:refs/remotes/wt<id>/*'`) —
   done for 044 as `wt044/main`, too late for 045.
3. Better: **the worktree bootstrap should not clone the project repo at all** — bind-mount/symlink
   the shared one, or have the agent work on a branch of the shared repo. A disposable container for
   non-disposable work is the actual design error.
4. Until (1)-(3) land, treat worktree isolation as **unsafe for committing agents**.

**v124 retro disposition (2026-07-31).** Fixes (1) and (2) above are now COMMITTED RULES in
`.claude/agents/orchestrator.md` ("Brief the ESCAPE ROUTE…"): the remote is named in every push
instruction (bare "do not push" is banned), every brief carries a durable-ref requirement that the
return must QUOTE, nothing is reclaimed without it, and v80 isolation is redefined as an explicit
`git worktree add` on the PROJECT repo — never the Agent tool's auto-cleaned `isolation: "worktree"`
for a project whose repo is a nested gitignored clone. Fix (3) — the bootstrap should not clone the
project repo at all — is **still OWED and is the real fix** (a disposable container for
non-disposable work); until it lands, (4) stands: worktree isolation via the Agent tool is unsafe
for committing agents. Recorded alongside it: the isolation trial MEASURED WELL on its stated
benefit (2 concurrent engineers, zero cross-contamination, both suites green at start, zero
feature-code conflicts, ~9-15s setup via APFS copy-on-write, only append-only operational-file
conflicts) against FOUR contamination incidents in the shared tree the same day — fix the
substrate, do not abandon the isolation.

**Metering non-adherence (v124, orchestrator-owned).** Token coverage is **2.6%** and duration
coverage **0.2%** of 1,220 events, so §E plumbing-vs-delivery and §F agent-cycle-time are both
uncomputable — including DEFECT-OAG-043's own `validated` event, appended `tokens: 0` with no
`duration_ms` for a real ~40-minute tester dispatch. This is the orchestrator's own §E/§F rule
unmet by the orchestrator. It is the SUBORDINATE step under this cycle's constraint (the
push/deploy-cascade wait laundered as tester time) and cannot be fixed by machinery — only by
passing `TOKENS=`/`DURATION_MS=` from the dispatch return on the same `wi-append`.


## traceability: a job's acceptance criteria / fitness functions must be carried into the implementing use-case at `/slice-next` (2026-08-03, AdixOut REQ-006 — QUEUED)
The traceability contract (`/requirement` §"traceability") forces every use-case created at
`/slice-next` to tag `personas:` + `job:` — but NOT a job's ACCEPTANCE CRITERIA / fitness functions
into the use-case's `## Acceptance conditions`. A POSITIVE feature AC becomes an acceptance condition
naturally; a NEGATIVE/INVARIANT AC (a guard — "never emit X as a side effect") can silently drop
between the signed-off dossier and the build. Tighten (`/requirement` traceability rule + `/slice-next`):
a use-case implementing a job that carries an AC/fitness function MUST copy it into
`## Acceptance conditions` as a red-first condition, and any standing INVARIANT AC MUST be a PINNED
regression guard (synth-pin-class), not a one-shot test. Make it a checkable Ready property. Founding:
REQ-006's demoted-from-fake-job guard (AC-3) — nothing in the machinery would have carried it into the
slice; the dossier AC had to be hand-flagged build-binding. Sibling of the AC-vs-job discovery-method
lesson. Owner: traceability contract (`process-current.md`) + `/slice-next`.

## `/requirement` skill: "append EVENT=registered" step is stale for aggregate requirements (2026-08-03, AdixOut REQ-006 — QUEUED)
`/requirement` step 3 says `make wi-append ... EVENT=registered AGENT=flow-manager` as a requirement's
birth event, but the machinery treats a requirement as a pure AGGREGATE (state bubbles from children);
`wi-append` rejects a flow event on it. A requirement is registered simply by writing its valid item
file (state derives to `planned`). Fix: update `/requirement` (+ `requirement-new`) — registration =
write item file + `make wi-project` (+ board mirror); drop the `EVENT=registered` append for aggregate
types. Founding: REQ-006 registration hit the rejection. Owner: `.claude/commands/requirement.md`.

## EXP-119 (fresh-account first-deploy bootstrap-parity) registry row DEFERRED at the v129 reconcile (2026-08-05, AdixOut — QUEUED)
At the v122→v128 fold-forward reconcile, main's experiment registry was at the hard cap of 8 (all
OagEventSource's), so AdixOut's novel EXP-119 (fresh-account first-deploy bootstrap-parity — cicd.md
practice + IMP-026, founding principle-failure 2026-07-30-adixout-first-prod-deploy-fresh-account-bootstrap-gaps.md)
could not take a slot without retiring another instance's scored row (not a merge-time call). The
BEHAVIOUR is live as plain cicd.md practice; only the SCORED registry row is deferred. Next retro:
score/adopt-or-retire across the merged set and give bootstrap-parity a row (target: CFR on first-account
deploys) if a slot frees. Owner: next AdixOut retro (§25a registry prune).

## `prod-deploying` has no `blocked` exit for a single-environment project (2026-08-20, ROC v145 — DEFERRED, review 2026-09-17)
Retired from `process/experiments.md` at v145 as one of six `##` sections that never had a registry
row (full text + disposition in `experiments-archive.md`). The gap is real: an item that reaches
`prod-deploying` in a project with no prod environment has no legal exit and strands, accruing wip
time that reads as delivery. It is DEFERRED rather than built because it is off the current
constraint (`blocked`/`external`, 41–42% of GLT) and ROC has no prod environment to strand an item
in — measured `prod-deploying` dwell is 191 s across ONE item, i.e. the harm is latent, not live.
Bring it forward the moment any project gains a second environment, or an item strands. Fix shape:
a `blocked` exit from `prod-deploying` in `state-graphs.json` with the §17c.6 probe requirement, so
the park is re-checkable like any other. Owner: cicd + the work-item machinery.

## "dep satisfied" is undefined, so two flow-managers read it oppositely (2026-08-20, ROC v145 — DEFERRED, review 2026-09-17)
Retired from `process/experiments.md` at v145 (same six row-less sections; full text in
`experiments-archive.md`). Two readings are both defensible — a `deps:` edge is satisfied when the
dependency is `done`, or when the dependency's blocking OUTPUT exists — and the section recorded two
flow-managers acting on different ones, which changes what `ready` means and therefore what the pull
loop admits. DEFERRED because settling it needs evidence this retro does not hold: the rework rate on
items promoted under the looser reading, against Ready-floor breach frequency under the stricter one.
Both numbers are derivable from the item event stream and neither has been computed. Do NOT settle it
by preference. Owner: `flow-manager` + `process/machinery/CONTRACT.md`.

## `make test-tools` is RED in every project worktree — 8 tests keyed to an absent corpus (2026-08-20, ROC v145 — QUEUED)
`make-refs-tracked.test.js` binds 8 cases to the REAL `work/OagEventSource` tree (deliberately — a
verbatim corpus is what makes them strong). In any per-project worktree that path does not exist, so
they FAIL rather than report unavailable, and `make test-tools` exits non-zero everywhere except an
OAG tree. A gate that is red for reasons unrelated to your change is a gate nobody runs, which is
§17e decay by attrition — and it nearly cost this retro a real finding: the `.claude/tools` sweep
(AC-DEFECT-OAG-076.5) caught the v145 tool truncating its own stdout, plus a pre-existing offender in
`stack-claim.js`, only because the suite was run despite the noise. **This is the §17g
generalisation-sweep obligation from commit `1eafaa3` landing unswept**: that fast-follow fixed
exactly this class one commit earlier in `linear-project.test.py` (a `CorpusUnavailable` sentinel,
tests report SKIP with the reason, exit stays NON-ZERO so a partial run can never read as green) and
did not sweep the sibling suite. Mirror that decision here rather than inventing a second one; the
design question to settle is how node's runner reports "not exercised" without a partial run reading
green. Owner: engineer.
