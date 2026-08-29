---
name: work-items
description: The event-sourced work-item substrate (v82). The single source of truth for every work item — requirements, chunks, slices, use-cases, defects, open-items. State is fold(events) through a per-type state graph; queues, the dependency tree, the board and ALL delivery metrics (the 4 DORA metrics, contribution-to-gross-lead-time by owner, quality by stage, recovery/MTTR by class) are DERIVED on read, never stored-and-hand-synced. Load this before registering an item, changing item state, pulling work, or reading metrics. Read process/machinery/CONTRACT.md + state-graphs.json first.
---

# Work items — the state substrate (v82)

**One principle:** each fact is stored once, in the item. Every other view — queues,
board, stats, tree — is COMPUTED from the items on read. There is no separate queue
file, no `state:` field, no metrics ledger to keep in sync. Contract:
`process/machinery/CONTRACT.md`. Type graphs: `process/machinery/state-graphs.json`.
Read both before using this skill.

## The model
- **Item = SSOT.** One file per item: `work/<project>/items/active/<ID>.md`. On
  completion it moves verbatim to `work/<project>/items/done/<ID>.md`.
- **state = fold(events).** An item has no stored state. Its current state is the
  fold of its append-only `events:` list through its type's graph. A half-written
  state cannot be represented, so the classic drift class is gone by construction.

## Item file schema (CONTRACT.md §1)
YAML-ish frontmatter (machine-authoritative) + markdown body (human definition).
Frontmatter fields:
- `id` — e.g. `UC-C1`, `SLC-032`, `DEF-041`, `REQ-…`.
- `type` — selects the state graph: `use-case | defect | open-item | slice | chunk | requirement`.
- `title`, `job` (JTBD id), `value`, `cost` — economics used by the pull.
- `personas:` — OPTIONAL list of persona ids (e.g. `[P1,P3]`) naming WHICH users the item serves. Personas + JTBD are REFERENCE docs under `work/<p>/product/` (`personas.md`, `jtbd-map.md`), not work items; use-cases point at them. Set by product from the `/requirement` discovery dossier.
- `parents:` — UPWARD hierarchical container(s). REQUIRED (except `requirement`).
- `deps:` — peer prerequisites; the DAG edges the pull uses to form the independent set. May be empty.
- `created_ts` — UTC registration time.
- `events:` — **append-only** list of `{ts, event, agent, [ref], [observe], [note]}`. NEVER add a `state:` field.
  `observe:` is the machine-checkable liveness predicate of an `awaiting_observation` park
  (state-graph v9) — REQUIRED on `not_yet_observed`; see "Shipped but UNPROVEN" below.
- `derived:` — the DERIVED block (state, queue, children, ancestors). **Do not hand-edit** — it is re-rendered by `wi-project`.

Edges are stored one-directional (each item names its `parents`/`deps`). `children`
and the full subtree are DERIVED (who names me) so an edge can never disagree with itself.
The markdown body carries the JTBD/value/acceptance definition, frozen at registration;
material changes are `amended` events, never silent edits.

## Type graphs & state ownership (state-graphs.json)
Each `type` is either a **flow** machine (use-case, defect, open-item — real event
streams) or an **aggregate** (slice, chunk, requirement — state bubbles up from
children via the graph `bubble` rule; they carry only registered/amended events for audit).
Every state maps to:
- a **queue** via `queue_map[state]` (`intake | ready | rework | waiting | wip`, or
  `null` for terminal/aggregate) — this is how queues are generated, derived.
- an **owner** via `state_owners[state]` — an agent name (that agent is actively
  working it → their throughput/quality), `queue` (pure wait latency, a time thief),
  or `external` (blocked on a human/third party). This is the basis for attributing
  GROSS LEAD TIME to each part of the process.

Wanting a transition that is not in the graph is **not** something an agent may just
do: propose an amendment to `state-graphs.json` WITH A REASON — a process experiment
(`EXP-NNN`) routed through the retro/version-bump gate. Edit that file only via that gate.

## The four commands (and when each runs)
All via the cross-platform launcher (never bare `python3` — see below); the root
Makefile wraps each.

1. **`make wi-append PROJECT=P ID=<ID> EVENT=<name> AGENT=<role> [REF=…] [NOTE=…] [OWNER=<role>[,<role>]]`**
   — the SOLE state writer, and the ONLY way to change item state (replaces
   `dora record` for item state). <!-- doc-lint:allow --> The append is **edge-checked**: it folds current
   state, looks up the graph, and appends with a UTC timestamp ONLY IF the event is
   a legal transition from the current state AND the agent holds firing rights on
   THIS item. An illegal transition is REJECTED (non-zero exit) with the current
   state, the events that ARE legal here, and the instruction to open an amendment
   experiment. Re-renders `derived:` on success. To register a NEW item, create its
   file with the frontmatter above and the initial `registered`/`reported`/`open`
   event, then append subsequent events with this command. No hand-editing of
   `derived:`; no separate queue file.
   - **FIRING RIGHTS COME FROM THE ITEM, not from a per-transition allowlist
     [state-graph v11, OI-ROC-006].** Three rules, declared in `firing_rights` in
     `state-graphs.json`: (1) `orchestrator`/`flow-manager` may fire anything legal
     from the current state, on every item; (2) a validation VERDICT
     (`validated`/`rejected`/`dev_validated`/`not_yet_observed`) is the tester's on
     every item — **an owner is refused**, so the engineer that built it may not
     validate it; (3) everything else belongs to the item's **declared owner**.
     **So: the role that did the work records its own work, as itself.** If you are
     refused, do NOT append under another role's name and disclose it in the note —
     that is the substitution this replaced, it corrupts token-cost `by_owner` and
     the plumbing/delivery split, and it is COUNTED (`stats.firing_rights`). Say so
     instead, and ask the flow role to declare the owner.
   - **`OWNER=` is the dispatch decision, and only a flow role may fire it.** When
     you dispatch an item to a role outside the type default — a UI defect to
     `ui-designer`, a docs defect to `documenter`, an architecture-only fix to
     `solution-architect` — declare it in the SAME act as the entry transition
     (`OWNER=ui-designer` on the `triaged`/`pulled`), so that role can record its own
     work. A declaration **REPLACES** the default (it narrows), and a non-flow agent
     that passes `OWNER=` is REFUSED — otherwise an agent would grant itself, in one
     command, the right it is exercising in that same command.
   - **CALLER HAZARD — SINGLE-QUOTE the `NOTE=` value (2026-07-22).** A `$`-sequence in
     a DOUBLE-quoted note is shell-expanded before the launcher ever sees it and is
     silently mangled — e.g. `NOTE="…SST $transform no-op…"` reached the item as
     `…SST ransform no-op…` (`$transform` → the empty var `$transform` → `ransform`),
     corrupting the audit evidence. Always single-quote: `make wi-append …
     NOTE='…SST $transform no-op…'`. This is a shell-quoting hazard on the CALLER side,
     NOT a machinery bug. principle-failure
     `2026-07-22-wi-append-note-dollar-expansion-mangled-evidence.md`.
     - **This extends to BACKTICKS / `$(…)` and commas (2026-07-23).** In a
       DOUBLE-quoted note a backtick or `$(…)` is command-SUBSTITUTED by the shell —
       the enclosed text is run as a command and its output (or an error) replaces it,
       mangling or even EXECUTING part of the note before the launcher sees it; and a
       comma can TRUNCATE the note. So single-quote `NOTE='…'` AND avoid backticks,
       `$(…)` command-substitution, and commas in the note TEXT itself. Caller hazard,
       not a machinery bug. principle-failure
       `2026-07-23-wi-append-note-backtick-command-substitution-mangled-evidence.md`.

2. **`make wi-project PROJECT=P`** — recompute ALL views from the item set (pure
   functions). Run **after each loop pass** (and after any batch of appends). Writes:
   - `views/queues.md` + `.json` — membership of intake/ready/rework/waiting + WIP, via `queue_map[state]`.
   - `views/state.md` — every item's current folded state.
   - `views/tree.md` — the dependency tree (parents/children/deps).
   - `views/stats.md` + `.json` — all delivery metrics (below).
   - re-renders each active item's `derived:` block.

3. **`make wi-validate PROJECT=P`** — the drift GATE. Run **before pulling**. Exits
   non-zero if any invariant is violated: (I1) every event in every item is a legal
   transition; (I2) no terminal item sits in a non-null queue; (I3) every
   `parents`/`deps` id resolves and `deps` has no cycles; (I4) exactly one file per
   id across active/+done/, and a `done` item lives in `done/`; (I6) an
   `awaiting_observation` flow item carries a valid observation predicate; (I7) a
   `blocked` flow item carries a valid reversal probe; **(I8) the item's own
   `derived:` block agrees with `fold(events)`** — it exists, declares a non-null
   state, that state is one its own type graph defines, it equals the computed
   state, and `derived.queue` equals `queue_map[state]`. **I5 is
   RESERVED** for IMP-011's still-owed CORE-job invariant and is not reused.

   **The remedy for an I8 violation is `make wi-project` — RE-RENDER the block, never
   correct it in place.** I8 exists because five use-case items were once registered
   with hand-authored blocks carrying the aggregate-only `state: planned` and
   `wi-validate` reported *clean* while every derived view read the wrong state; the
   gate that gets quoted as assurance was silent on the one thing a reader assumes it
   checks (`OI-WI-VALIDATE-IGNORES-DERIVED-STATE-LEGALITY`). I1 guards the event log,
   I8 guards the rendering, and neither sees the other's class.

4. **`make wi-migrate PROJECT=P`** — one-shot migration from the legacy
   `items.csv` + ledger into per-item files. Run once per project; not part of the loop.

## The two MECHANICAL gates (exit 2 = stop; never orchestrator discretion)
`wi-validate` above guards DRIFT. Two further targets guard the loop's OBLIGATIONS —
both in the same shape (read the item event-logs, print every violation with the ids
and the remedy, exit 0 = proceed / exit 2 = stop). A gate blocks only on **harm that
stopping actually relieves**; a real finding that stopping would only make worse is
reported as an **ADVISORY** that does not touch the exit code (see check 3 below).

- **`make retro-debt PROJECT=P [THRESHOLD=3]`** — the §F8 cadence gate. Exit 2 = RETRO
  DUE; `make retro-mark PROJECT=P` drains it at the retro's close. The boundaries live
  in that project's OWN append-only cadence log, `work/P/items/retro-log.md` (written
  only by `retro-mark` and by `parts-check`'s drain, and carrying the constraint as of
  that close). It lives in `items/` but not in `items/{active,done}/`, so no fold,
  queue or metric sees it.
  **THE TWO ARMS HAVE SEPARATE BOUNDARIES (DEF-ROC-130) — the boundary is NOT "the
  newest event in the log".** The log holds two event types that do not mean the same
  thing, so each arm counts since the newest event that drains THAT arm:
  * **routine** (slice / chunk / **requirement** closes + UC rework) — drained ONLY by
    a full `retro_closed`, so it batches to `THRESHOLD` across as many `parts-check`
    runs as it takes.
  * **incident** (defect resolves) — drained by `retro_closed` **or** by
    `parts-check`'s cheap `debt_drained`, which is licensed only while the constraint
    is provably unchanged (owner ruling 2026-08-07).
  Reading one shared boundary for both was DEF-ROC-130: `/loop-run` step 5a runs
  `parts-check` after every bubble, so each cheap incident drain erased the routine
  count and the batched routine retro was unreachable. Absent ⇒ the tool prints
  **UNKNOWN** and the paths it looked at — never a `1970-01-01` sentinel dressed as a
  fact — and counts all-time debt on that arm, i.e. it FAILS CLOSED **per arm**: a
  project whose log holds only cheap drains has never had a full retro and owes its
  whole close history. The tracked
  files under `process/dora/retro-marker/` are FROZEN: read as a fallback, never
  written (writing them dirtied the parent worktree and deferred every
  fold-forward — `OI-PARTS-CHECK-MARKER-DIRTIES-THE-TREE-AND-DEFERS-FOLD-FORWARD`).
- **`make loop-gate PROJECT=P [STALE_HOURS=4] [THRESHOLD=3] [NO_OBSERVE=1]
  [OBSERVE_TIMEOUT=120] [NOW=…]`** — the §F8a **pull precondition** gate; run it before
  EVERY pull (`loop-run.md` step 0b). Six checks:
  1. **stalled-validation** — an item in `validating`/`dev-validating`/`prod-validating`
     dwelling past `STALE_HOURS` whose latest `fixed`/`built_green`/`deployed`/`promoted`
     event carries a `ref:`. The highest-value check: the work is DONE and only a
     dispatch is missing. (Founding case: 35.5h and 27.3h, both pushed AND deployed.)
     BLOCKING.
  2. **ready-below-floor** — `depth(ready) < ready.min_items` from `queues/policy.csv`.
     BLOCKING.
  3. **queue-over-cap** — a queue depth > its `wip_limit`. **TWO SEVERITIES (v126 addendum) —
     Little's Law governs WIP, not backlog depth:**
     - a **WIP-STAGE** queue over cap (`ready`, `wip`, `rework`, any future in-flight
       stage) is **BLOCKING** — concurrent work past the cap is real harm (aging,
       context-switching).
     - a **BACKLOG** queue over cap (`intake` — unstarted demand) is **ADVISORY**: it is
       reported prominently with its depth, overage and remedy, and it does **NOT**
       affect the exit code. Blocking on it INVERTS the constraint — the remedy for a
       deep backlog is to DELIVER FASTER, which is exactly the pull a block prevents,
       and the block creates pressure to close real findings just to shrink the number.
       (Founding case, this gate's first real run: a legitimate differential sweep
       produced ~15 verified-real sub-cost-4 findings, the flow-manager correctly
       refused to close any of them, and the loop halted for having done good
       discovery work.) An advisory-only run exits **0**, says `no BLOCKING
       precondition violated, the loop may pull; N advisory (non-blocking, still
       outstanding)`, and still prints the `!` line — "may pull" never means the
       advisory is satisfied.
     The classification is **DECLARED**, not a hardcoded name list: `policy.csv` is
     long-format, so it takes a `kind` **param row** — `intake,kind,backlog,…`,
     `ready,kind,wip,…` (the `_TEMPLATE` seed ships them; no column changed, so every
     existing reader and every older `policy.csv` stays valid). A queue with no `kind`
     row falls back to one named map in the machinery (`DEFAULT_QUEUE_KINDS`: only
     `intake` is a backlog) and an **undeclared queue defaults to `wip`, i.e.
     fail-CLOSED** — a future in-flight stage blocks until somebody classifies it.
  4. **retro-debt** — DELEGATED to the `retro-debt` computation, never reimplemented.
     BLOCKING.
  5. **awaiting-observation** [v9] — every item parked in `awaiting_observation`
     (shipped, green, UNPROVEN) is reported AND its liveness predicate **RE-EVALUATED**,
     exactly as `blocked` is re-checked each cycle. `OBSERVATION: observed` ⇒ **BLOCKING**
     (reality produced the record, so a tester dispatch is now actionable);
     `OBSERVATION: not-yet` ⇒ **ADVISORY**; a broken or absent predicate ⇒ **BLOCKING**
     (an unrunnable liveness predicate is not a predicate, §17c.2). `NO_OBSERVE=1` skips
     the evaluation and reports each parked item as NOT EVALUATED — a skipped run can
     never read as satisfied. Note check 1 deliberately does NOT fire on a parked item:
     it HAS been dispatched and the tester recorded a machine-checkable reason it could
     not conclude — check 5 carries it instead, and blocks the moment the predicate flips.
  6. **test-requirement-gate** [v127, §17d] — DELEGATED to the committed analyser
     `.claude/tools/test-requirement-gate.js` (`make test-requirement-gate PROJECT=P`),
     never reimplemented here. Two limbs over the project's test sources: every test case
     declares the `AC-<ID>.<n>` it validates, and no test AUTHORS its precondition by
     mutating a real capture. **Severity follows §F8a — a gate blocks only on harm that
     stopping relieves:** a count ABOVE the committed ratchet baseline is **BLOCKING** (a
     test that cannot validate a requirement has just landed; the fix is one file), the
     standing debt at the baseline is **ADVISORY** and reported every cycle so it stays
     visible and shrinking, and **NOT-CONFIGURED / UNRUNNABLE is `?` UNKNOWN** — never a
     silent pass, because a gate nobody could run is not a clean one. The verdict is read
     from the analyser's stdout sentinel (`TRG-VERDICT:`), not from its exit status.
     Config, allowlist and baseline: `.claude/config/test-requirement-gate/<P>.json`.

  Output prefixes: `-` blocking (exit 2), `!` advisory (exit unaffected), `?` UNKNOWN
  (exit unaffected — could not be established).

  **Push/deploy state is DERIVED from git, never from event-note PROSE.** The gate reads
  the structured `ref:` and runs `git merge-base --is-ancestor <ref> origin/<trunk>` in
  the project's OWN repo (`git -C work/P`, v50). Event notes are append-only and are not
  corrected when the world moves on — a note reading `"NOT pushed"` was ~35h stale while
  its commit had been on `origin/main` throughout. An unresolvable ref, or a long dwell
  with NO `ref:` at all, is reported `UNKNOWN` (a `?` advisory line that does NOT block),
  never assumed either way (§17c).

## Shipped but UNPROVEN — `awaiting_observation` (state-graph v9)
A capability is not `done` until it has been OBSERVED working on data the system did not
author (§17c.1). When an item is built, deployed and re-verified green but the capability
has had **no opportunity to occur** (it ships inert behind a flag; its trigger is genuinely
rare), the **tester** parks it:

```
make wi-append PROJECT=P ID=<ID> EVENT=not_yet_observed AGENT=tester \
  OBSERVE=make:<probe-target> NOTE="<what is awaited + what WAS established>"
```

`OBSERVE=` is **REQUIRED — the append is REFUSED without it** (a reason in `NOTE` can never
come back negative, §17c Layer 2). It names a **committed, re-runnable target in
`work/P/Makefile`** that **exits 0** and prints `OBSERVATION: observed` once the record
exists, or `OBSERVATION: not-yet` while it does not. Anything else — no sentinel, both
sentinels, a non-zero exit, a missing target, a timeout — is a **BROKEN** predicate and
blocks the loop, so a probe that does not exist can never masquerade as "not observed yet".
Do NOT signal the verdict with an exit code: **`make` does not propagate a recipe's exit
status** (a recipe exiting 3 makes `make` itself exit 2).

The state is **non-terminal**, owner `external` (never the tester's effort), queue
`waiting`, and **an awaiting child can never let its parent aggregate read `done`** (the
parent reads `awaiting_observation`). Exit with `validated` (observation landed — put the
pointer in `NOTE`) or `rejected` (the observation FALSIFIED the capability). Correct a wrong
probe with `EVENT=amended … OBSERVE=make:<new-target>`; the predicate in force is the LAST
event carrying one. Not available on `open-item` (no deployable capability to observe).

  `make test-wi` runs the machinery's own unit tests (temp-dir fixtures; never real
  project data) through the same resolved interpreter.

## Reading metrics (from views/stats.md — the live metric source)
`stats.md`/`stats.json` are recomputed from event timestamps by `wi-project`; read
them instead of any ledger. They carry, overall and per item-type:
- **A. The four DORA metrics** — throughput / deployment frequency, lead time
  (registered→done), cycle time (pulled→done), change-failure rate, MTTR.
- **B. Gross-lead-time decomposition** — total time-in-flight, per-item median/p85,
  `by_state` (time thieves) and **`by_owner`** (each part of the process's
  contribution, via `state_owners`). This is the primary retro input: the largest
  `by_owner`/`by_state` contributor is the constraint.
- **C. Quality by stage** — build-fail / reject rates by owning stage, plus
  defect-arrival rate (all-time + trailing 30d).
- **D. Recovery (MTTR) by failure class** — median + mean recovery time split by
  class (build failure, validation reject, defect, deploy failure).

The old `process/dora/ledger/*.csv` is a FROZEN QueueApproach archive — do NOT
append to it; do NOT `dora record`. <!-- doc-lint:allow --> All live state and metrics come from here.
(See the `dora-ledger` skill, now a read-only archive stub.)

## Cross-platform invocation
Invoke via the launcher `sh .claude/skills/work-items/scripts/work-items <cmd>`
(the Makefile's `wi-*` targets do this). It resolves the real interpreter machine-
locally — real `python3` on macOS, `uv`-provided on Windows (where `python`/`python3`
are Microsoft Store stubs that fail silently). NEVER call bare `python3 …/work-items.py`.
`sh … work-items --python` prints the resolved interpreter (used by the Makefile's `PY`).
