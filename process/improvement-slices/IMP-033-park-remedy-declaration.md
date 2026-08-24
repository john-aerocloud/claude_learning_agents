# IMP-033 — a park must name the item that would END it, and the gate must see when we own it

**Opened:** 2026-08-24 (v150 retro, ROC)
**Owner:** work-item machinery (`.claude/skills/work-items/scripts/work-items.py`) — parent-repo lane
**Targets:** gross lead time (the `external` / `blocked` constraint — 35.40% of ROC's GLT)
**Registry row:** `EXP-ROC-004`

## The finding, measured on the deployed host, not on item prose

ROC's constraint has been `external` / `blocked` for **five consecutive retros**. This cycle:

| | share of GLT | median/item | n | backfill |
|---|---|---|---|---|
| owner `external` | **35.40%** | 620,907 s (7.19 d) | 15 | 0.00% |
| state `blocked` | 33.41% | 1,810,502 s (20.95 d) | 13 | 0.00% |
| state `awaiting_observation` | 1.98% | 523,862 s (6.06 d) | 2 | 0.00% |

EXP-143 (adopted v148) made every park re-check itself with a probe each cycle, and the probes
work: they cleared two false parks on their first run, one of them blocked 27.3 days. What they
answer is *"is this still blocked?"* — and for the two `awaiting_observation` items they answer
**yes, correctly, and will answer yes for ever**:

- `DEF-ROC-035` — parked 7.2 d on `make probe-dash0-wired`, which reads the deployed Function
  App's app settings for `OTEL_EXPORTER_OTLP_ENDPOINT`.
- `DEF-ROC-056` — parked 4.9 d on `make probe-appinsights-wired`, which reads the same app for
  `APPLICATIONINSIGHTS_CONNECTION_STRING`.

**Both settings are absent because nobody has wired a telemetry sink, and the item that wires
one is `DEF-ROC-041`, which ROC OWNS.** Its own Definition says so in as many words:
*"Ownership: ours … Not blocked externally: Dash0/Log-Analytics egress is already sanctioned
under ROC's data-residency contract, buildable via the normal dev-first CICD pipeline."*
`DEF-ROC-041` had sat in `reported` for **7.2 days**, undecided.

So 1.98% of gross lead time is booked to an owner called `external` while the whole of its cause
sits in our own intake queue. The probe is not wrong. It is answering a question whose answer
cannot change until we schedule something, and nothing connects the two facts.

**And the gate that exists made it worse, in this very cycle.** `loop-gate` check 4
(`aged-backlog-undecided`, EXP-131) blocked the pull on eight items aged past 7 d with no
recorded decision, and it was right to. The orchestrator cleared the block by recording six
dated defers — **and one of the six was `DEF-ROC-041`, deferred to 2026-08-26.** The gate
demanded *a* decision and cannot tell a sound defer from one that parks the remedy for the
project's own named constraint. The retro's IDENTIFY step caught it about twenty minutes later
and the defer was withdrawn; nothing mechanical would have.

## Why prose cannot be the remedy

§12d.3 already says, of an unbounded park: *"if the wait is unbounded, arm it, force the trigger,
or judge it statistically — never conclude it works."* That sentence is correct and it is
**advisory text on a `loop-gate` line**, which is the exact shape §17c Layer 2 was written
against: *"a remedy written as prose reproduces the defect it was written for."* The park lines
have printed a version of this advice every cycle for 7.2 and 4.9 days respectively.

## Specification

**A park declares who can end it, in structured frontmatter, and the gate reads it.**

- **AC-033.1** — `EVENT=blocked` and `EVENT=not_yet_observed` require **`REMEDY=<value>`**,
  stored as the frontmatter scalar `park_remedy:`. Two legal forms and no third:
  - `park_remedy: <ITEM-ID>` — the registered item whose delivery would end this park.
  - `park_remedy: none-inside-project` — an explicit assertion that no item we could schedule
    would end it. This is a claim, and it is the one the next retro re-reads.
- **AC-033.2** — `append` REFUSES the transition when `REMEDY=` is absent or unparseable, and
  refuses an `<ITEM-ID>` that does not exist in the project's item set. Fail closed, copying
  §17c.2's proven treatment verbatim.
- **AC-033.3** — `validate` gains an invariant catching a hand-edited or missing `park_remedy:`
  on any item currently in a `_PARKED_STATES` state, so the field cannot be edited away.
- **AC-033.4** — `loop-gate` BLOCKS when a parked item's `park_remedy:` names an item that is
  **in a BACKLOG-kind queue with no in-date `defer_until`**. Message names both ids, both
  dwell times, and the remedy: *schedule `<remedy>` or record why the park outlives it.* This
  is the limb that makes §12d.2 mechanical.
- **AC-033.5** — a `park_remedy:` naming an item that is itself parked is reported (a park
  chain), ADVISORY, not blocking — chains are legitimate and blocking on them would be the
  backlog-depth inversion again.
- **AC-033.6** — **MIGRATION, and the slice is not done without it.** The 15 items currently in
  `blocked` / `awaiting_observation` are back-filled with a `park_remedy:` each. A limb binding
  only FUTURE parks leaves the entire measured 35.40% exactly where it is — this is AC-031.6's
  lesson and v144's founding evidence (`DEF-ROC-004`, blocked 28.8 d after both its blockers had
  gone) applied to itself.
- **AC-033.7 — NON-VACUITY.** Re-run against the pre-fix state of this cycle: `DEF-ROC-035` and
  `DEF-ROC-056` with `park_remedy: DEF-ROC-041`, and `DEF-ROC-041` carrying
  `defer_until: 2026-08-26`, MUST make check 4 block. If that fixture passes, the limb is
  measuring nothing.
- **AC-033.8** — the counted `external` share is REPORTED split into *remedy-inside-project* and
  *remedy-outside-project*, and **never netted off**. Total dwell is conserved; attribution
  moves. Same guard as `IMP-031` AC-031.7, and for the same reason: a rule that lets a real
  external wait be re-labelled as ours, or ours as external, has become the thing it was written
  to prevent.

- **AC-033.9 — AGGREGATES INHERIT, they do not declare.** Measured with the new
  `make item-brief PROJECT=ROC QUEUE=waiting`: of the 15 items in `waiting`, **six are
  aggregates** (`CHK-ROC-001`, `CHK-ROC-009`, `CHK-ROC-011`, `REQ-ROC-005`, `SLC-ROC-002`,
  `SLC-ROC-022`) that read `blocked` only because a child does — the aggregate fold, not a park
  anyone entered. Requiring `park_remedy:` on those would demand a declaration about a state
  nobody appended, and `append` never fires for them. So the field binds the **9 LEAF parks**
  (`DEF-ROC-009`, `DEF-ROC-035`, `DEF-ROC-056`, `DEF-ROC-068`, `DEF-ROC-073`, `DEF-ROC-074`,
  `UC-ROC-022`, `UC-ROC-023`, `UC-ROC-083`), and an aggregate's reported remedy is the UNION of
  its parked children's. Getting this wrong in the other direction is the real risk: a limb that
  skipped leaves and bound aggregates would be unfireable and would read as clean.

## How this could be wrong

If most parks come back `none-inside-project`, the field is ceremony and the 35.40% really is
outside our control — then the honest move is to kill the limb and put the effort into buying
round the external dependencies instead. The measurement that decides it is AC-033.8's split,
which is why the split is a required output and not a nicety.
