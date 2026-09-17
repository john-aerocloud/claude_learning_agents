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

**AMENDING AN AGGREGATE [DEF-ROC-238].** A flow event on an aggregate is refused and
stays refused — it has no fold, so the event would be meaningless. `amended` is the one
event it carries, and it is not a transition: it changes nothing and exists so a
definition change leaves a trace. Change the **authored economics** in the SAME act:

```
make wi-append PROJECT=P ID=REQ-… EVENT=amended AGENT=<role> \
     SET='value=5' SET2='defer_until=' NOTE_FILE=/tmp/why.txt
```

`SET=`/`SET2=`/`SET3=` take `FIELD=VALUE` for `value`, `cost`, `job`, `defer_until`
(an empty value CLEARS the field). **Never hand-edit those fields.** The amendment
stamps the resulting economics on the event it writes, and invariant **I10** compares
the file against that stamp: a change that reached the file any other way is reported as
a FORGERY, naming the item. An aggregate that has never been amended carries no stamp
and is reported as **NOT ESTABLISHED** — never a pass — and establishes itself at its
next amendment. While any invariant is unestablished the summary line reports the store
**`NOT CLEAN`** and does not name that invariant among the ones that hold; the exit code
is unchanged, so it withholds a claim rather than blocking the pull (§17i). (`wi-mint` stamps every aggregate it creates, so anything registered
through the machinery is checkable from birth.) A flow item's economics are NOT yet
covered by I10; that is the recorded residual, not a permission to hand-edit. I10 is a
consistency check, **not a signature**: an edit that rewrites the `econ:` stamp on the
last event as well as the frontmatter agrees with itself and passes — see
`CONTRACT.md` for what the stamp is and is not worth.

**AMENDING A RESOLVED / CANCELLED / WONTFIX ITEM [DEF-ROC-261].** `amended` is legal
from **every terminal state of every flow type**, for the same reason it is legal on an
aggregate: it was never a transition. A terminal state correctly admits no *flow* event
— the work is done and nothing may restart it silently — but it does not follow that the
**record** is sealed, and it was: `resolved` offered no legal event at all, while
`SKILL.md` requires material changes to be `amended` events and never silent edits. That
left only leave-it-wrong or break-the-contract, and two established corrections to
`DEF-ROC-248` sat unrecordable.

**It is not a route back into flow, and that is structural rather than promised.** No
edge is added to `state-graphs.json`: the amendment is recognised by one predicate in
the writer (`is_audit_self_edge`), and every derivation reads the graph — `fold_state`
and `walk_states` both SKIP an event no transition carries. So the state cannot move,
the queue stays null, the file stays in `items/done/`, and the DORA derivation is
unchanged: measured across an amendment landing days after the terminal event, the whole
`dora` block is byte-identical and the only figure that moves anywhere in the projection
is the raw count of events. `--set` is unchanged — it still rides an AGGREGATE's
amendment only.
Every state maps to:
- a **queue** via `queue_map[state]` (`intake | ready | rework | waiting | wip`, or
  `null` for terminal/aggregate) — this is how queues are generated, derived.
- an **owner** via `state_owners[state]` — an agent name (that agent is actively
  working it → their throughput/quality), `queue` (pure wait latency, a time thief),
  or `external` (blocked on a human/third party). This is the basis for attributing
  GROSS LEAD TIME to each part of the process.

**A DECISION IS FREE; ONLY STARTING WORK COSTS A SLOT** [§F9i, state-graph v13,
OI-ROC-029]. No flow type may move from its INITIAL state straight into a `wip` state:
every type has a post-decision, pre-work state mapping to `ready`/`intake`. So for a
defect, `triaged` records the §F9b decision and lands in `scheduled` (queue `ready`,
owner `queue`) — it takes no slot — and **`pulled` is the dispatch that costs the slot**,
the same event `use-case` and `open-item` use and the one that carries `OWNER=`. Fire
`pulled` when you brief an agent, not before; `confirmed` is also a start, since it moves
to `fixing`. This is enforced by `process-lint` **C6**, not by remembering it: recording a
decision used to cost a slot, which put §F9b and the WIP cap in direct opposition and
blocked the loop at wip 11/8 with ZERO agents running.

Wanting a transition that is not in the graph is **not** something an agent may just
do: propose an amendment to `state-graphs.json` WITH A REASON — a process experiment
(`EXP-NNN`) routed through the retro/version-bump gate. Edit that file only via that gate.

## The commands (and when each runs)
All via the cross-platform launcher (never bare `python3` — see below); the root
Makefile wraps each.

0. **`make wi-mint PROJECT=P TYPE=<type> TITLE="…" JOB=<J> VALUE=<v> COST=<c> LANE=<lane> AGENT=<role> DECIDE=schedule|defer [DEFER_UNTIL=YYYY-MM-DD] DECIDE_NOTE="…"|DECIDE_NOTE_FILE=… [PARENTS=…] [DEPS=…] [NOTE=…|NOTE_FILE=…] [BODY_FILE=…] [PREFIX=…] [ID=…]`**
   — the SOLE way to CREATE an item. It allocates the id and writes the file in one
   atomic act, prints the id as the LAST LINE of stdout
   (`ID=$(make wi-mint … | tail -1)`), and leaves an item that already passes
   `wi-validate`: genesis event, rendered `derived:` block, resolvable edges.
   **Never hand-write `items/active/<ID>.md`.**
   - **WHY (DEF-ROC-203, 2026-09-15).** Hand-minting is "read the highest id, write
     max+1" — a read-modify-write with a stale read. Two agents both minted
     `DEF-ROC-201` seventeen minutes apart and the second file landed on the first in
     the shared working tree, with no error and no detection; it was caught only
     because the losing agent happened to reopen its own file and found someone
     else's defect in it. Third subsystem with that one root, after the `EXP-142`
     experiment-id collision and the co-owned-append-target losses that produced
     `make commit-isolated` — and it scales the wrong way, because the more agents
     run in parallel the likelier it gets.
   - **HOW IT CANNOT COLLIDE.** The allocation IS the create: the set of item files
     is the set of allocated ids (no counter, no registry to drift — EXP-047), and an
     id is claimed with `O_CREAT|O_EXCL`, create-or-fail decided by the kernel. Two
     actors that compute the same candidate cannot both succeed; the loser takes the
     next number. Same discipline as `isolated-commit.js`'s ref compare-and-swap, and
     deliberately NOT the store lock — a lock is a cooperating convention a platform
     can lack and a caller can forget.
   - **AND IT REFUSES.** `ID=` naming an id that already exists in `active/` **or**
     `done/` is a loud non-zero refusal with **nothing written** — never a silent
     overwrite.
   - **`LANE=` is REQUIRED and has no default** (`parent-repo` | `project-repo`): a
     dispatch carrying worktree isolation fails CLOSED on an undeclared lane, and a
     wrong lane has destroyed delivered work (`DEFECT-OAG-076`).
   - **The genesis event is written HERE, not appended.** `registered`/`reported`/
     `open` names the type's INITIAL state, so it is not a transition and
     `wi-append` cannot fire it (there is no edge). That is why creation is a command
     of its own. Everything after it is an append.
   - `TITLE=` crosses make's expansion and a shell string exactly as `NOTE=` does, so
     a `$`, backtick, quote or backslash is REFUSED rather than corrupted — use
     `TITLE_FILE=`. `DECIDE_NOTE=`/`DECIDE_NOTE_FILE=` is the same prose, same rule.
   - **`DECIDE=` IS REQUIRED ON A FLOW TYPE AND HAS NO DEFAULT [OI-ROC-034, §F9k].**
     Registration and triage are ONE act, because the role that finds something is the
     only one that holds the context to decide it, and the decision taken later is the
     median **6439 s** that makes `reported` **35.23% of gross lead time** — the largest
     single contributor, and polling latency rather than deliberation. The rule (§F9b)
     already said this; what changed is WHERE it is asked. The gate that used to ask
     blocks the PULL, an hour later.
     - **`DECIDE=schedule DECIDE_NOTE="<why it is worth doing>"`** fires the type's
       decision event (`triaged`/`scheduled`/`made_ready`, derived from the graph) at the
       SAME timestamp as the genesis event, landing the item in its **ready buffer**.
       **It costs NO wip slot** — a decision that consumed one would put §F9b back into
       mechanical opposition with the wip cap, which is the failure §F9i/OI-ROC-029
       fixed. Needs the ordinary firing rights.
     - **`DECIDE=defer DEFER_UNTIL=YYYY-MM-DD DECIDE_NOTE="<what it is waiting for>"`**
       is the recorded alternative: a dated decision **at least 7 days out** (a nearer
       one decides nothing — §F9b.1's arithmetic, refused here rather than a week later).
       It appends no transition, so it needs **no firing rights and is available to every
       role**; the reason rides the genesis event, which — unlike a frontmatter scalar —
       carries a timestamp. **It is always the cheaper move, and that asymmetry is what
       stops this from suppressing discovery (§F8a).**
     - The vocabulary is **closed**, and the reason is screened: `TODO`, `TBD`, `n/a`,
       `-` and anything under 12 characters are REFUSED. A required field answered with a
       placeholder is worse than an absent one, because the gate then reads a lie as
       compliance.
     - An **aggregate** (requirement/chunk/slice) takes no decision and refuses one: it
       has no flow state and sits in no queue. Registering one is exactly as cheap as it
       was.

1. **`make wi-append PROJECT=P ID=<ID> EVENT=<name> AGENT=<role> [REF=…] [NOTE=…] [OWNER=<role>[,<role>]]`**
   — the SOLE state writer, and the ONLY way to change item state (replaces
   `dora record` for item state). <!-- doc-lint:allow --> The append is **edge-checked**: it folds current
   state, looks up the graph, and appends with a UTC timestamp ONLY IF the event is
   a legal transition from the current state AND the agent holds firing rights on
   THIS item. An illegal transition is REJECTED (non-zero exit) with the current
   state, the events that ARE legal here, and the instruction to open an amendment
   experiment. Re-renders `derived:` on success. To register a NEW item use
   `make wi-mint` above — never a hand-written file — and append every subsequent
   event with this command. No hand-editing of `derived:`; no separate queue file.
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
   - **DECLARING ON AN ITEM THAT ALREADY HAS HISTORY (DEF-ROC-217).** Because a
     declaration narrows, declaring it on an item a DIFFERENT role has already worked
     would make that role's past events illegal under I1 — so `append` REFUSES the
     declaration, naming the events it would invalidate. (The v11 `default_owners`
     closure protects the VERSION CHANGE from exactly this; it cannot protect a
     declaration made later.) The refusal is at the moment of the mistake rather than
     at the next `wi-validate`, which would otherwise name the HISTORICAL EVENT as the
     fault when the fault is the declaration. Two honest routes, both offered by the
     message: **widen** (`OWNER=cicd,engineer` — normal when an item is re-dispatched
     after an attempt by another role, and the honest record), or **do not declare**
     and record the dispatch in the note. Never make the history fit the declaration.
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
   `parents`/`deps` id resolves and `deps` has no cycles; (I4) a `done` flow item
   lives in `done/` and a live one in `active/`; (I6) an
   `awaiting_observation` flow item carries a valid observation predicate; (I7) a
   `blocked` flow item carries a valid reversal probe; **(I8) the item's own
   `derived:` block agrees with `fold(events)`** — it exists, declares a non-null
   state, that state is one its own type graph defines, it equals the computed
   state, and `derived.queue` equals `queue_map[state]`; **(I9) no event committed in
   git HEAD is absent from the working-tree item file** — append-only, checked
   against the only other durable record there is; **(I11) an id resolves to
   EXACTLY ONE item file, in the working tree AND in HEAD**. **I5 is
   RESERVED** for IMP-011's still-owed CORE-job invariant and is not reused.

   **An I11 violation means the item has no defined state.** State is
   `fold(events)` over ITS log, so two files claiming one id with divergent logs
   answer differently — and the machinery's halves do not even pick the same
   file: `find_item_path` returns `items/active/` first (every WRITER, plus
   `item-brief`), while `load_all_items` keeps the LAST walked (every DERIVED
   VIEW). I11 says WHICH copy is stale, by the only rule an append-only log
   warrants: a strict subset is behind. Where each copy holds events the other
   lacks it reports DIVERGED and names both sides rather than guessing; where
   they are identical it is still a violation, because agreement is not
   permission. **It reads HEAD as well as the working tree** because the founding
   instance (DEF-ROC-268: `DEF-ROC-231` and `DEF-ROC-248`, 2026-09-17) was wrong
   ONLY in HEAD — committing a resolved item is a RENAME, two paths, and only the
   `done/` half was declared to `commit-isolated`, so the working tree looked
   right and every working-tree invariant reported `clean` all session.

   **An I9 violation is a DROPPED EVENT, not drift — do NOT re-project.** Recover the
   events from HEAD (`git -C work/<p> show HEAD:<path>`) and only then re-render.
   I9 exists because the store silently lost DEF-ROC-161's `confirmed` event and this
   gate reported *clean* afterwards: its invariant was `derived == fold(events)`,
   which holds just as well over a log with an event missing from it (DEF-ROC-162).
   It compares by item ID, so `active/` → `done/` relocation is not a loss, and it
   cannot see an event destroyed before the next commit — that window is closed by
   the write path instead (below). It also runs as `loop-gate` check 15.

   **A concurrent `wi-append` during `wi-project` is now SAFE, and it was not.**
   `project` used to rewrite every item file from a snapshot taken at the start, so
   any append landing mid-run was silently destroyed. All three writers (`append`,
   `project`, `migrate`) now re-read each file immediately before writing, rebase
   their own new events onto what is on disk, hold one bounded OS file lock for the
   whole read-modify-write, and verify the written log against what they intended —
   restoring the pre-image and refusing to continue if it does not match. If a second
   `wi-*` command is already writing, yours WAITS and then exits non-zero saying so;
   it never proceeds unserialised. Contract: `process/machinery/CONTRACT.md` §2.

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
     A **BUFFER** queue (`ready`) is the third kind [OI-ROC-030]: its DEPTH is
     advisory, its AGE blocks. Nobody works a ready item (`state_owners` = `queue`),
     so the wip-harm has no referent, and the remedy for a full buffer is TO PULL —
     the act a block forbids. Its aging stays with check 1's `scheduled-not-pulled`
     limb (48h, measured), whose remedies already fit an item that IS scheduled;
     routing it to check 4 instead would tell an already-scheduled item to "schedule
     it" and give one item two remedies. **Deep-and-fresh pulls; deep-and-AGING stops.**
     The classification is **DECLARED**, not a hardcoded name list: `policy.csv` is
     long-format, so it takes a `kind` **param row** — `intake,kind,backlog,…`,
     `ready,kind,buffer,…` (the `_TEMPLATE` seed ships them; no column changed, so every
     existing reader and every older `policy.csv` stays valid). The vocabulary is
     exactly `backlog | buffer | wip` and **`process-lint` C7 fails the build on any
     other value** — `queue_kind()` falls back silently, so a typo would otherwise be
     invisible. A queue with no `kind` row falls back to one named map in the machinery
     (`DEFAULT_QUEUE_KINDS`: `intake` is a backlog, `ready` is a buffer — both are facts
     about what the queue IS, not tuning) and an **undeclared queue defaults to `wip`,
     i.e. fail-CLOSED** — a future in-flight stage blocks until somebody classifies it.
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
