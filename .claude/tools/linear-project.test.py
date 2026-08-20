#!/usr/bin/env python3
"""Offline unit tests for the PURE renderer in linear-project.py.

No network, no secret, no Linear API. Runs via the same interpreter the
`board-project` Makefile target resolves:
    make test-board-project
or directly:
    <python> .claude/tools/linear-project.test.py

The load-bearing test is the AC-join fix: a multi-line acceptance criterion
must render as its COMPLETE text, with no continuation line dropped.
"""

import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("linear_project", HERE / "linear-project.py")
lp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lp)

FAILS = []


def check(name, cond):
    if cond:
        print(f"  ok  - {name}")
    else:
        print(f"  FAIL- {name}")
        FAILS.append(name)


# Fixture item with hard-wrapped, multi-line acceptance criteria (the exact
# shape of the defect being fixed — AC-1 spans 4 physical lines).
FIXTURE = """---
id: UC-FIX-001
type: use-case
title: Fixture use-case with multi-line acceptance criteria
job: J1
personas: [P3, P4]
parents: [SLC-FIX-001]
deps: []
derived:
  state: done
  children: []
  ancestors: [SLC-FIX-001]
---

## Definition — a fixture value statement that reads as one line

**Why (persona/job):** J1 (core) enabling — the fixture why paragraph
wraps across two physical lines and should collapse to one sentence.

## Acceptance criteria (UC-FIX-001)
- **AC-1:** Given a real issue key, when the real adapter's teardown
  method is called, then it makes the correctly-shaped HTTP call (method +
  URL) to delete/cancel that specific issue — asserted by contract test
  (mocked HTTP), no live call required for this UC.
- **AC-2:** Given a 4xx or 5xx response to the teardown call, when the
  adapter handles it, then it applies the SAME failure taxonomy — reusing
  existing machinery, not a new failure model.
- **AC-3:** Single-line criterion stays intact.
"""


def test_parse_acceptance_joins_wrapped_lines():
    fm, body = lp.split_item(FIXTURE)
    acs = lp.parse_acceptance(body)
    check("three criteria parsed", len(acs) == 3)
    # AC-1 must be COMPLETE — ends with its real final clause, not the first line.
    check(
        "AC-1 ends with its true final clause (fix)",
        acs[0].endswith("no live call required for this UC."),
    )
    check(
        "AC-1 does NOT stop at the first physical line",
        acs[0] != "**AC-1:** Given a real issue key, when the real adapter's teardown",
    )
    # No continuation fragment is dropped.
    for frag in ["method is called", "correctly-shaped HTTP call", "delete/cancel"]:
        check(f"AC-1 contains continuation fragment: {frag!r}", frag in acs[0])
    # Wrap newlines + indentation collapse to single spaces (no double spaces).
    check("AC-1 has no newline", "\n" not in acs[0])
    check("AC-1 has no doubled whitespace", "  " not in acs[0])
    check(
        "AC-2 complete",
        acs[1].endswith("not a new failure model.") and "SAME failure taxonomy" in acs[1],
    )
    check("AC-3 single-line intact", acs[2] == "**AC-3:** Single-line criterion stays intact.")


def test_frontmatter_and_helpers():
    fm, body = lp.split_item(FIXTURE)
    d = lp.parse_frontmatter(fm)
    check("id parsed", d["id"] == "UC-FIX-001")
    check("type parsed", d["type"] == "use-case")
    check("job parsed", d["job"] == "J1")
    check("personas list parsed", d["personas"] == ["P3", "P4"])
    check("parents list parsed", d["parents"] == ["SLC-FIX-001"])
    check("derived.state parsed", d["state"] == "done")
    check(
        "definition one-liner",
        lp.parse_definition_oneliner(body) == "a fixture value statement that reads as one line",
    )
    why = lp.parse_why(body)
    check("why collapsed to one line", why is not None and "\n" not in why and why.startswith("J1 (core)"))


def test_reference_resolution():
    jtbd = "## J1 — Get notified of a real device failure  [core]\nbody\n## J15 — trust something else  [core]\n"
    check("job resolves to full heading", lp.resolve_job("J1", jtbd) == "J1 — Get notified of a real device failure")
    check("J1 does not greedily match J15", "J15" not in lp.resolve_job("J1", jtbd))
    personas = "### P3 — ROC Build Engineer  [class: build-eng]\nx\n### P4 — Platform/Cloud Engineer  [class: platform-eng]\n"
    check("P3 resolves", lp.resolve_persona("P3", personas) == "P3 — ROC Build Engineer")
    check("P4 resolves", lp.resolve_persona("P4", personas) == "P4 — Platform/Cloud Engineer")


def test_render_description_sections():
    fm, body = lp.split_item(FIXTURE)
    item = {
        "id": "UC-FIX-001",
        "title": "Fixture use-case with multi-line acceptance criteria",
        "value_oneliner": "a fixture value statement that reads as one line",
        "acceptance": lp.parse_acceptance(body),
        "contribution": "advances the fixture slice",
    }
    desc = lp.render_description(
        item,
        jobs=["J1 — Get notified of a real device failure"],
        personas=["P3 — ROC Build Engineer", "P4 — Platform/Cloud Engineer"],
        plan=[("Slice", "SLC-FIX-001", "The fixture slice title")],
    )
    for section in ["## What this delivers", "## Jobs to be done", "## Personas served",
                    "## Acceptance criteria", "## Part of the plan"]:
        check(f"description has section {section!r}", section in desc)
    check("full AC text present in rendered description",
          "no live call required for this UC." in desc)
    check("plan line rendered", "SLC-FIX-001 · The fixture slice title" in desc)


def test_labels_and_status():
    check("job label", "job:J1" in lp.compose_labels({"job": "J1", "type": "use-case", "acceptance": [1]}))
    check("needs-acceptance when no ACs",
          "needs-acceptance" in lp.compose_labels({"type": "use-case", "acceptance": []}))
    check("defect label", "defect" in lp.compose_labels({"type": "defect", "acceptance": []}))
    check("blocked label", "blocked" in lp.compose_labels({"type": "use-case", "state": "blocked", "acceptance": [1]}))
    # status fallback: team without 'Ready' falls back to Todo then Backlog
    states = [{"id": "s-todo", "name": "Todo", "type": "unstarted"},
              {"id": "s-back", "name": "Backlog", "type": "backlog"}]
    names = lp.desired_status_names("use-case", "ready")
    check("ready -> [Ready,Todo,Backlog]", names == ["Ready", "Todo", "Backlog"])
    check("resolve_state_id falls back to Todo", lp.resolve_state_id(states, names) == "s-todo")
    # Canceled US-spelling fallback
    cstates = [{"id": "c1", "name": "Canceled", "type": "canceled"}]
    check("wontfix resolves to Canceled",
          lp.resolve_state_id(cstates, lp.desired_status_names("defect", "wontfix")) == "c1")


# --------------------------------------------------------------------------- #
# OI-LINEAR-CANCELLED-STATE-UNMAPPED — the STATE_STATUS drift gate.
#
# Root cause of the defect: STATE_STATUS was HAND-maintained against
# process/machinery/state-graphs.json and drifted from it (the graph gained
# `cancelled` at v5 and `awaiting_observation` at v9; neither reached the table),
# and `desired_status_names` degraded an unmapped state to ["Backlog"] SILENTLY —
# so a terminal cancelled item rendered as unstarted work with no signal anywhere.
# These tests derive the expected coverage FROM the graph, so the table can never
# again drift without the build going red, and pin the loud failure.
# --------------------------------------------------------------------------- #
# The team's REAL workflow states (probed live from the Linear workspace,
# 2026-08-03) — the only names a candidate list can actually resolve against.
REAL_TEAM_STATES = [
    {"id": "s-backlog", "name": "Backlog", "type": "backlog"},
    {"id": "s-cancel", "name": "Canceled", "type": "canceled"},
    {"id": "s-done", "name": "Done", "type": "completed"},
    {"id": "s-dup", "name": "Duplicate", "type": "duplicate"},
    {"id": "s-blocked", "name": "Blocked", "type": "started"},
    {"id": "s-prog", "name": "In Progress", "type": "started"},
    {"id": "s-review", "name": "In Review", "type": "started"},
    {"id": "s-ready", "name": "Ready", "type": "unstarted"},
    {"id": "s-todo", "name": "Todo", "type": "unstarted"},
]

FLOW_TYPES = ["use-case", "defect", "open-item"]
AGG_TYPES = ["slice", "chunk", "requirement"]


def test_state_status_covers_every_graph_state():
    """AC-OI-LINEAR-CANCELLED-STATE-UNMAPPED.4 — completeness, derived from the
    graph rather than hand-listed: every state an item of a type can HOLD has a
    STATE_STATUS entry. This is the check whose absence let v5 -> now go unnoticed."""
    graphs = lp.load_state_graphs()
    gaps = lp.audit_state_status(graphs)
    forward = [g for g in gaps if g[0] == "unmapped"]
    check(f"no state the graph defines is unmapped (gaps: {forward})", not forward)
    # and the gate must actually be capable of SEEING a gap (a gate that cannot
    # fail is not a gate) — remove a mapping and it must report exactly that one.
    saved = lp.STATE_STATUS["use-case"].pop("cancelled", None)
    try:
        seeded = lp.audit_state_status(graphs)
        check(
            "gate DETECTS a seeded missing mapping",
            any(g[0] == "unmapped" and g[1] == "use-case" and g[2] == "cancelled"
                for g in seeded),
        )
    finally:
        if saved is not None:
            lp.STATE_STATUS["use-case"]["cancelled"] = saved


def test_state_status_has_no_state_the_graph_does_not_define():
    """AC-OI-LINEAR-CANCELLED-STATE-UNMAPPED.4 (inverse sweep) — a table key that
    names no real graph state is stale editorial debt and must not accumulate."""
    graphs = lp.load_state_graphs()
    extras = [g for g in lp.audit_state_status(graphs) if g[0] == "unknown-state"]
    check(f"no stale table key absent from the graph (extras: {extras})", not extras)


def test_graph_states_are_derived_not_hand_listed():
    """AC-OI-LINEAR-CANCELLED-STATE-UNMAPPED.4 — the expected set comes from the
    graph file: flow types from their transition table, aggregates from the
    bubble's range (initial + terminal + working + the external-wait states,
    which are themselves read from `state_owners`, not typed in here)."""
    graphs = lp.load_state_graphs()
    uc = lp.graph_states(graphs, "use-case")
    for s in ["registered", "ready", "building", "deploying", "dev-validating",
              "prod-deploying", "prod-validating", "validating", "reworking",
              "blocked", "awaiting_observation", "done", "cancelled"]:
        check(f"use-case graph state derived: {s}", s in uc)
    check("use-case has no invented state", "wontfix" not in uc)
    dfx = lp.graph_states(graphs, "defect")
    for s in ["reported", "reproducing", "fixing", "validating", "blocked",
              "awaiting_observation", "resolved", "wontfix", "cancelled"]:
        check(f"defect graph state derived: {s}", s in dfx)
    oi = lp.graph_states(graphs, "open-item")
    check("open-item states derived",
          oi == {"open", "scheduled", "done", "wontfix", "cancelled"})
    agg = lp.graph_states(graphs, "slice")
    for s in ["planned", "in_progress", "done", "cancelled", "blocked",
              "awaiting_observation"]:
        check(f"aggregate bubble state derived: {s}", s in agg)
    check("aggregate range excludes flow-only states", "building" not in agg)


def test_cancelled_resolves_to_a_real_terminal_status():
    """AC-OI-LINEAR-CANCELLED-STATE-UNMAPPED.1 + .2 — THE defect. A cancelled item
    of every type that has the terminal must render as the workspace's real
    cancelled status, never Backlog."""
    for itype in FLOW_TYPES + AGG_TYPES:
        names = lp.desired_status_names(itype, "cancelled")
        check(f"{itype}/cancelled is not Backlog", names != ["Backlog"])
        check(
            f"{itype}/cancelled resolves to the real 'Canceled' state",
            lp.resolve_state_id(REAL_TEAM_STATES, names) == "s-cancel",
        )


def test_awaiting_observation_resolves_to_a_parked_status():
    """AC-OI-LINEAR-CANCELLED-STATE-UNMAPPED.4 — the second live gap the audit
    found (state-graph v9). An item shipped-but-unproven is an EXTERNAL wait, so
    it must read as parked, never as unstarted Backlog (UC-ML1/UC-XC5 were both
    projecting as Backlog while deployed and verified)."""
    for itype in ["use-case", "defect"] + AGG_TYPES:
        names = lp.desired_status_names(itype, "awaiting_observation")
        check(f"{itype}/awaiting_observation is not Backlog", names != ["Backlog"])
        check(
            f"{itype}/awaiting_observation resolves to the real 'Blocked' state",
            lp.resolve_state_id(REAL_TEAM_STATES, names) == "s-blocked",
        )
    check(
        "awaiting_observation carries a distinguishing label (parked != blocked)",
        "awaiting-observation" in lp.compose_labels(
            {"type": "use-case", "state": "awaiting_observation", "acceptance": [1]}
        ),
    )


def test_unmapped_state_is_loud_not_silently_backlog():
    """AC-OI-LINEAR-CANCELLED-STATE-UNMAPPED.5 — the ACTUAL fix. An unmapped state
    must be impossible to pass quietly: it raises, naming the state and type. The
    silent ["Backlog"] fallback is what let this defect survive from v5 to now."""
    try:
        got = lp.desired_status_names("use-case", "no-such-state")
        check(f"unmapped state RAISES (got {got!r} instead)", False)
    except lp.UnmappedStateError as e:
        msg = str(e)
        check("unmapped state raises UnmappedStateError", True)
        check("error names the offending state", "no-such-state" in msg)
        check("error names the item type", "use-case" in msg)
        check("error names the table to fix", "STATE_STATUS" in msg)
        check("error names the source of truth", "state-graphs.json" in msg)
    # An unknown item TYPE was the same class of silent fallback (it degraded to
    # the use-case table), and so was a missing derived.state.
    for bad_type in ["not-a-type", ""]:
        try:
            lp.desired_status_names(bad_type, "done")
            check(f"unknown type {bad_type!r} RAISES", False)
        except lp.UnmappedStateError:
            check(f"unknown type {bad_type!r} raises", True)
    try:
        lp.desired_status_names("use-case", None)
        check("absent derived.state RAISES", False)
    except lp.UnmappedStateError:
        check("absent derived.state raises", True)
    # It must be catchable by main()'s existing handler -> exit 1, not a traceback.
    check("UnmappedStateError is a LinearError", issubclass(lp.UnmappedStateError, lp.LinearError))


def test_every_real_item_state_is_projectable():
    """AC-OI-LINEAR-CANCELLED-STATE-UNMAPPED.4 — the audit against REALITY, not
    just against the graph: every (type, state) pair actually present in this
    project's item files must resolve to a status without raising. This is the
    sweep that would have caught the live UC-HF042 and UC-ML1 misrenders."""
    pairs = lp.project_state_pairs("OagEventSource")
    check("real item pairs were found (audit is not vacuous)", len(pairs) > 0)
    unresolvable = []
    for itype, state in sorted(pairs):
        try:
            lp.desired_status_names(itype, state)
        except lp.UnmappedStateError as e:
            unresolvable.append(f"{itype}/{state}: {e}")
    check(f"every real (type,state) projects (bad: {unresolvable})", not unresolvable)



# --------------------------------------------------------------------------- #
# OI-ACCEPTANCE-PARSER-SCORES-ZERO-SILENTLY — a ZERO MUST BE LOUD.
#
# `parse_acceptance()` returned a COUNT, and `0` meant two irreconcilable things:
# "this item genuinely has no acceptance" (a real process state — §12a keeps such
# an item out of a build) and "I could not read this item's acceptance". Every
# downstream consumer — the board's `needs-acceptance` label (a WORK INSTRUCTION
# telling a human to author acceptance), the §17d traceability gate, an agent
# asking "is this buildable?" — saw the two as identical. Measured on the real
# corpus, 468 items, before the fix: FOUR items carried an `## Acceptance`
# heading and parsed to ZERO, and TWELVE more parsed a strict SUBSET of the AC
# ids written in their own acceptance section, worst case `DEFECT-OAG-053`
# (4 of 20 — its fifteen REGISTERED criteria sit in a table under a level-3
# sub-heading, and a level-3 heading TERMINATED the section) and `DEFECT-OAG-110`
# (8 of 22 — a SECOND `## Acceptance` section the parser never reached).
#
# The fixtures below are REAL TEXT taken verbatim from those items, per AC-AP.5.
# The fix is structural, not a fifth format: sections are level-aware, ALL
# acceptance sections are read, a criterion is any AC-id declaration (list,
# table row, or prose line), and the parse CHECKS ITSELF against the ids present
# in the text it read — so it can no longer drop one silently.
# --------------------------------------------------------------------------- #

# Verbatim shape of DEFECT-OAG-053: four narrative bullets, then the fifteen
# REGISTERED criteria in a markdown table under a LEVEL-3 sub-heading.
FIX_L3_TERMINATOR = """\
## Acceptance

1. Two concurrent writers at the same `expectedSeq` with **different envelope ids** => exactly one
   succeeds, the other raises `OptimisticConcurrencyError`, **observed against real DynamoDB**.
2. The characterisation pins UC-ML4 landed **go RED** when the guard is fixed.

### Registered acceptance criteria (the `AC-053.n` vocabulary the tests name, §17d)

Every criterion below traces to a delta-057 clause.

| AC | What it requires | delta-057 | Pinned by |
|---|---|---|---|
| AC-053.1 | N concurrent `append` at one `expectedSeq` => exactly 1 fulfilled | §6 M2 | `a.test.ts` |
| AC-053.2 | the same race through `ingest()` on ONE REAL captured OAG body | §6 M2 | same |
| AC-053.3 | positions UNIQUE and DENSE from 0..head on EVERY stream | §6 M2 | same |

## MEASURED IN PROD — the race is ACTIVE, not latent

Not acceptance. This section must not be swallowed.
"""

# Verbatim shape of DEFECT-OAG-110: TWO `## Acceptance` sections, the second
# registered a fortnight after the first.
FIX_TWO_SECTIONS = """\
## Acceptance

1. **`AC-110.1`** — the first condition.
2. **`AC-110.2`** — the second condition.

## Acceptance — the registered criteria, in full (registered 2026-08-18 by DEFECT-OAG-122)

The eight conditions above are the product-level ones.

- **`AC-110.A1`** — delta-071 §12, verbatim.
- **`AC-110.F1`** — delta-071 §6, the fitness limbs and their red lines.

## Related
"""

# Verbatim acceptance section of UC-GSA2 — PROSE, no ids, no list. Registered
# since 2026-08-04; the board stamped it `needs-acceptance` on OAG-216 while its
# own tester quoted this very clause when refusing to claim validated.
FIX_PROSE_ONLY = """\
## Acceptance (verbatim, delta-054 section 15)

A real captured diverted **push** body committed as a fixture emits `OagFlightDiverted`,
AND a real `Recovery` body emits the recovery signal, AND the first real emission is
observed end-to-end to a consumer rule invocation (walking-skeleton assertion).

## Sequencing / release gate

- **Trigger:** `oag.diversion.detected` (metric #6).
"""

# The first draft that started this item: ids in BACKTICKS inside a numbered list.
FIX_BACKTICKED_IDS = """\
## Acceptance

1. **`AC-AP.1`** — a **zero result is never silent**. An item whose body contains something that
   looks like acceptance but parses to 0 conditions raises loudly.
2. **`AC-AP.2`** — the two states are **separately representable** end to end.
"""

FIX_NO_ACCEPTANCE = """\
## Definition

_CHK-10-INTAKE_ (migrated from items.csv). dora_ref: `CHK-10-INTAKE;DONE-181c8bd(AC-C10.1-5-pass)`.
Definition text not auto-located; fill in from the slice docs.
"""

FIX_EMPTY_SECTION = """\
## Acceptance (to be authored on pull)

## Related

- nothing yet.
"""


def test_level3_subheading_does_not_terminate_acceptance():
    # validates: AC-AP.5, AC-AP.6
    """DEFECT-OAG-053, real: 15 registered criteria under a `###` sub-heading."""
    r = lp.acceptance_report(FIX_L3_TERMINATOR)
    ids = set()
    for c in r["criteria"]:
        ids |= set(lp._AC_ID.findall(c))
    check("a level-3 sub-heading does NOT terminate a level-2 acceptance section",
          {"AC-053.1", "AC-053.2", "AC-053.3"} <= ids)
    check("narrative bullets are still criteria (2 + 3 table rows = 5)", len(r["criteria"]) == 5)
    check("no residual id was dropped", r["residual_ids"] == [])
    check("status is parsed", r["status"] == "parsed")
    check("a LEVEL-2 heading still terminates the section",
          not any("must not be swallowed" in c for c in r["criteria"]))


def test_every_acceptance_section_is_read_not_only_the_first():
    # validates: AC-AP.6
    """DEFECT-OAG-110, real: a second `## Acceptance` section registered later."""
    r = lp.acceptance_report(FIX_TWO_SECTIONS)
    ids = set()
    for c in r["criteria"]:
        ids |= set(lp._AC_ID.findall(c))
    check("both acceptance sections reported", len(r["sections"]) == 2)
    check("first section's ids present", {"AC-110.1", "AC-110.2"} <= ids)
    check("SECOND section's ids present too", {"AC-110.A1", "AC-110.F1"} <= ids)
    check("four criteria across both sections", len(r["criteria"]) == 4)
    check("status parsed, nothing residual", r["status"] == "parsed" and not r["residual_ids"])


def test_prose_only_acceptance_is_unenumerated_not_zero():
    # validates: AC-AP.1, AC-AP.2, AC-AP.6
    """UC-GSA2, real: acceptance IS written; it is simply not enumerable."""
    r = lp.acceptance_report(FIX_PROSE_ONLY)
    check("status distinguishes prose acceptance from absent acceptance",
          r["status"] == "unenumerated")
    check("it is NOT reported as 'none'", r["status"] != "none")
    check("the prose is carried so a consumer can show it", "OagFlightDiverted" in r["text"])
    check("a section WAS found", len(r["sections"]) == 1)
    check("the next level-2 section is not swallowed", "Trigger" not in r["text"])


def test_backticked_ids_in_a_numbered_list_parse():
    # validates: AC-AP.5, AC-AP.6
    r = lp.acceptance_report(FIX_BACKTICKED_IDS)
    check("backticked ids in a numbered list parse", len(r["criteria"]) == 2)
    check("status parsed", r["status"] == "parsed")
    check("backticked id is recognised as an id", "AC-AP.1" in " ".join(r["criteria"]))


def test_genuinely_no_acceptance_is_representable_as_none():
    # validates: AC-AP.2, AC-AP.6
    """UC-C10, real: a migrated stub. It mentions `AC-C10.1-5` in a dora_ref, which
    the old body-wide `AC-` heuristic mislabelled `acceptance-unparsed` — a claim
    that the PARSER is broken, on an item that simply has no acceptance."""
    r = lp.acceptance_report(FIX_NO_ACCEPTANCE)
    check("no acceptance section and no AC-led list => status none", r["status"] == "none")
    check("a dora_ref mention is NOT an orphan finding", r["orphan_ids"] == [])
    check("no criteria", r["criteria"] == [])


def test_empty_acceptance_section_is_distinct_from_unreadable():
    # validates: AC-AP.2
    r = lp.acceptance_report(FIX_EMPTY_SECTION)
    check("a heading with nothing under it => status empty", r["status"] == "empty")
    check("empty is not unreadable", r["status"] != "unreadable")


def test_a_dropped_id_is_reported_as_truncated_not_silently_lost():
    # validates: AC-AP.1
    """The self-check: the parse compares its own output against the ids present in
    the text it read. An id in the section that reached no criterion is a RESIDUAL,
    and the verdict is `truncated` — never a quiet undercount."""
    body = (
        "## Acceptance\n\n"
        "- **AC-Z.1** — the one criterion the parser can see.\n\n"
        "```\nAC-Z.2 lives inside a fenced block the parser deliberately ignores\n```\n"
    )
    r = lp.acceptance_report(body)
    check("one criterion parsed", len(r["criteria"]) == 1)
    check("the unreached id is reported", r["residual_ids"] == ["AC-Z.2"])
    check("status is truncated, not parsed", r["status"] == "truncated")


def test_ids_never_capture_a_trailing_sentence_period():
    # validates: AC-AP.1
    check("AC id excludes a trailing period",
          lp._AC_ID.findall("cited AC-061. Next sentence.") == ["AC-061"])
    check("AC id keeps internal dots", lp._AC_ID.findall("AC-110.A17 ok") == ["AC-110.A17"])


def test_label_distinguishes_unreadable_from_needs_acceptance():
    # validates: AC-AP.2
    """AC-AP.2 end to end: the BOARD must not tell a human to author acceptance for
    an item that has it. `needs-acceptance` is a work instruction."""
    unread = lp.compose_labels(
        {"type": "use-case", "acceptance": [], "acceptance_status": "truncated",
         "acceptance_residual": ["AC-053.5"], "_body": ""})
    check("truncated => acceptance-unparsed", "acceptance-unparsed" in unread)
    check("truncated => NOT needs-acceptance", "needs-acceptance" not in unread)
    prose = lp.compose_labels(
        {"type": "use-case", "acceptance": [], "acceptance_status": "unenumerated", "_body": ""})
    check("unenumerated => acceptance-unenumerated", "acceptance-unenumerated" in prose)
    check("unenumerated => NOT needs-acceptance", "needs-acceptance" not in prose)
    real = lp.compose_labels(
        {"type": "use-case", "acceptance": [], "acceptance_status": "none", "_body": ""})
    check("genuinely none => needs-acceptance", "needs-acceptance" in real)
    # A DEFECT with unreadable acceptance was invisible before: the old branch was
    # gated on `itype == "use-case"`, so DEFECT-OAG-047's ten conditions parsed to
    # zero and NOTHING was said. The parser-fault signal is type-independent.
    d = lp.compose_labels(
        {"type": "defect", "acceptance": [], "acceptance_status": "truncated",
         "acceptance_residual": ["AC-047.7"], "_body": ""})
    check("a DEFECT also raises acceptance-unparsed", "acceptance-unparsed" in d)
    check("a defect is NOT told to author acceptance", "needs-acceptance" not in d)


def test_render_shows_the_unreadable_banner_to_a_human():
    # validates: AC-AP.2
    md = lp.render_description(
        {"id": "X", "type": "use-case", "acceptance": [], "acceptance_status": "unenumerated",
         "acceptance_text": "prose acceptance here", "acceptance_residual": []},
        "", "", "")
    check("the board description says the acceptance could not be enumerated",
          "could not be enumerated" in md.lower() or "unenumerated" in md.lower())
    check("the prose acceptance text still reaches the human", "prose acceptance here" in md)


def test_tree_sweep_classifies_every_real_item_and_is_non_vacuous():
    # validates: AC-AP.3, AC-AP.5
    """AC-AP.3 — the sweep is the deliverable. Runs over the REAL corpus."""
    rows = lp.sweep_acceptance("OagEventSource")
    check("the sweep sees the whole corpus (>400 items)", len(rows) > 400)
    counts = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    check(f"every class carries a measured size (not a verdict): {counts}",
          set(counts) <= {"parsed", "truncated", "unreadable", "unenumerated", "empty",
                          "none", "orphan"})
    check("the sweep is non-vacuous: it finds parsed items", counts.get("parsed", 0) > 100)
    # NON-VACUITY of the loud path, on real items: UC-GSA2 is prose-only and
    # DEFECT-OAG-053's registered table was invisible before the fix.
    by_id = {r["id"]: r for r in rows}
    if "UC-GSA2" in by_id:
        check("UC-GSA2 classifies as unenumerated (not none)",
              by_id["UC-GSA2"]["status"] == "unenumerated")
    if "DEFECT-OAG-053" in by_id:
        check("DEFECT-OAG-053's 15 registered criteria are now visible",
              len(by_id["DEFECT-OAG-053"]["criteria"]) >= 19)
    if "DEFECT-OAG-110" in by_id:
        check("DEFECT-OAG-110's second section is now visible",
              len(by_id["DEFECT-OAG-110"]["criteria"]) >= 10)



# --------------------------------------------------------------------------- #
# §17e NON-VACUITY, driven through the REAL CLI (AC-AP.5).
#
# These do NOT call the audit function in-process. `make acceptance-audit` shells
# out to the script, so the claim under test is "the COMMAND exits non-zero", and
# stubbing that boundary would prove only that the mapping agrees with itself —
# the exact fault the 2026-08-02 ruling names. The corpus for each demonstration is
# a REAL item file COPIED VERBATIM out of work/OagEventSource/items/, never a
# hand-authored fixture: the precondition is HARVESTED, not written (§17d.2).
# --------------------------------------------------------------------------- #
def _run_cli(*argv):
    import subprocess
    r = subprocess.run([sys.executable, str(HERE / "linear-project.py")] + list(argv),
                       capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def _scratch_corpus(tmp, ids, declared="{}"):
    """A scratch repo root holding REAL item files, copied byte-for-byte."""
    import shutil
    d = tmp / "work" / "SCRATCH" / "items" / "active"
    d.mkdir(parents=True, exist_ok=True)
    for iid in ids:
        for sub in ("active", "done"):
            src = HERE.parents[1] / "work" / "OagEventSource" / "items" / sub / f"{iid}.md"
            if src.exists():
                shutil.copy2(src, d / f"{iid}.md")
                break
        else:
            raise AssertionError(f"real item {iid} not found — fixture must be harvested")
    reg = tmp / "declared.json"
    reg.write_text(declared)
    return tmp, reg


def test_audit_goes_RED_on_a_real_item_with_unenumerable_acceptance():
    # validates: AC-AP.5
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        root, reg = _scratch_corpus(Path(td), ["UC-GSA2"], declared='{"declared": {}}')
        code, out = _run_cli("--acceptance-audit", "--project", "SCRATCH",
                             "--root", str(root), "--declared", str(reg))
        check("RED: undeclared unenumerated acceptance exits non-zero", code != 0)
        check("RED: the failure NAMES the item", "UC-GSA2" in out)
        check("RED: it says the acceptance is PRESENT, not missing",
              "PRESENT but not fully readable" in out)
        check("RED: it says enumerating is product/architect work (§12a)",
              "12a" in out or "§12a" in out)


def test_audit_goes_RED_on_a_real_truncated_item_and_names_the_dropped_id():
    # validates: AC-AP.1, AC-AP.5
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        root, reg = _scratch_corpus(Path(td), ["DEFECT-OAG-062"], declared='{"declared": {}}')
        code, out = _run_cli("--acceptance-audit", "--project", "SCRATCH",
                             "--root", str(root), "--declared", str(reg))
        check("RED: a truncated real item exits non-zero", code != 0)
        check("RED: the dropped id is named, not just counted", "AC-062.6" in out)
        check("RED: status is reported as truncated", "truncated" in out)


def test_audit_goes_RED_on_a_declaration_with_no_authority():
    # validates: AC-AP.4  (§17h limb 1)
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        root, reg = _scratch_corpus(
            Path(td), ["UC-GSA2"],
            declared='{"declared": {"UC-GSA2": {"status": "unenumerated", "note": "x"}}}')
        code, out = _run_cli("--acceptance-audit", "--project", "SCRATCH",
                             "--root", str(root), "--declared", str(reg))
        check("RED: an exclusion with no authority fails", code != 0)
        check("RED: the message cites §17h's rule",
              "authority is a FINDING" in out or "NO `authority`" in out)


def test_audit_goes_RED_on_a_stale_declaration_so_it_can_only_shrink():
    # validates: AC-AP.4
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        # A real item whose acceptance parses cleanly, declared as a known finding.
        root, reg = _scratch_corpus(
            Path(td), ["DEFECT-OAG-053"],
            declared='{"declared": {"DEFECT-OAG-053": {"status": "truncated",'
                     ' "authority": "stale"}}}')
        code, out = _run_cli("--acceptance-audit", "--project", "SCRATCH",
                             "--root", str(root), "--declared", str(reg))
        check("RED: a declaration that outlived its finding fails", code != 0)
        check("RED: it says to delete the row", "NO LONGER one" in out)


def _synth_corpus(tmp, items, declared="{}"):
    """A scratch repo root holding SYNTHESISED item files.

    Deliberately NOT `_scratch_corpus`: that helper harvests real items out of
    `work/OagEventSource/`, which does not exist in a per-project worktree (`work/*`
    is gitignored, so a ROC worktree holds only ROC). A shared tool whose tests can
    only run in one worktree cannot be fixed from the worktree its bug is blocking —
    found while fixing DEF-ROC-077 from the ROC worktree. `items` is {id: body}.
    """
    d = tmp / "work" / "SCRATCH" / "items" / "active"
    d.mkdir(parents=True, exist_ok=True)
    for iid, body in items.items():
        (d / f"{iid}.md").write_text(
            "---\nid: %s\ntype: defect\ntitle: \"synthetic\"\n---\n\n%s" % (iid, body),
            encoding="utf-8")
    reg = tmp / "declared.json"
    reg.write_text(declared)
    return tmp, reg


#: An acceptance section the parser reads CLEANLY — so the item is NOT a finding.
_CLEAN_ACCEPTANCE = """## Acceptance

- **AC-1.1** — the thing happens.
- **AC-1.2** — the other thing happens.
"""


def test_audit_does_NOT_demand_deleting_ANOTHER_projects_declaration():
    # validates: AC-AP.4 (scoping limb) — DEF-ROC-077.
    # The registry is GLOBAL (`.claude/tools/acceptance-audit-declared.json`) but a
    # sweep is PER-PROJECT. Reading "not a finding in THIS project" as "no longer a
    # finding anywhere" made every OTHER project's row look stale, and the remedy it
    # printed — "delete the row" — would DESTROY a legitimate declaration belonging to
    # a project this run never looked at. Absence of evidence, not evidence of absence
    # (the DEF-ROC-046 class). It blocked ROC's loop-gate on 5 OAG rows.
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        root, reg = _synth_corpus(
            Path(td), {"DEF-SCRATCH-001": _CLEAN_ACCEPTANCE},
            declared='{"declared": {"DEFECT-OTHERPROJ-001": {"status": "truncated",'
                     ' "authority": "another project ruling"}}}')
        code, out = _run_cli("--acceptance-audit", "--project", "SCRATCH",
                             "--root", str(root), "--declared", str(reg))
        check("GREEN: an out-of-scope declaration does NOT fail the audit", code == 0)
        check("GREEN: it never tells you to delete another project's row",
              "DEFECT-OTHERPROJ-001 is declared as a known acceptance finding"
              not in out)
        check("but it is NOT silent — the out-of-scope row is named and counted "
              "(§17h: absence must be distinguishable from ignorance)",
              "DEFECT-OTHERPROJ-001" in out and "not evaluated" in out)


def test_audit_STILL_goes_RED_on_a_stale_declaration_for_an_IN_SCOPE_item():
    # validates: AC-AP.4 — the scoping fix must not blunt the ratchet. An item that IS
    # in this project's sweep and is no longer a finding must STILL fail, or the fix
    # has turned a working ratchet into a high-water mark.
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        root, reg = _synth_corpus(
            Path(td), {"DEF-SCRATCH-002": _CLEAN_ACCEPTANCE},
            declared='{"declared": {"DEF-SCRATCH-002": {"status": "truncated",'
                     ' "authority": "stale"}}}')
        code, out = _run_cli("--acceptance-audit", "--project", "SCRATCH",
                             "--root", str(root), "--declared", str(reg))
        check("RED: an IN-SCOPE stale declaration still fails (ratchet intact)",
              code != 0)
        check("RED: it still says to delete the row", "NO LONGER one" in out)


def test_audit_is_GREEN_on_the_real_corpus_with_the_committed_registry():
    # validates: AC-AP.3
    code, out = _run_cli("--acceptance-audit", "--project", "OagEventSource")
    check("the committed registry makes the real corpus PASS", code == 0)
    check("the sweep prints a measured size for EVERY class, incl. the healthy ones "
          "(§17h: no class is pre-judged benign)",
          all(s in out for s in ("parsed", "truncated", "unreadable", "unenumerated",
                                 "empty", "none", "orphan")))
    check("the total criteria count is reported", "criteria across the corpus" in out)


def test_fault_set_numbered_list_with_no_bold_ids():
    # validates: AC-AP.6
    # REAL shape, DEFECT-OAG-081: `1. AC-081.1 — …` with no emphasis at all. Matching
    # only `- **AC-x**` left every numbered item reading zero and LOOKED like a fix.
    body = """## Acceptance

1. AC-081.1 - the DR runbook's resource table names the real prod table, account and KMS
   alias, per environment, with no sandbox identifiers presented as prod.
2. AC-081.2 - `OAG_EVENT_STORE_TABLE` has no environment-specific default that can be
   silently wrong.
"""
    r = lp.acceptance_report(body)
    check("plain numbered list parses", len(r["criteria"]) == 2)
    check("status parsed with nothing residual",
          r["status"] == "parsed" and not r["residual_ids"])
    check("the wrapped continuation is joined", "presented as prod" in r["criteria"][0])


def test_fault_set_ids_in_prose_with_no_list_marker():
    # validates: AC-AP.6
    # SYNTHETIC, and marked as such: the real corpus contains ZERO instances of a
    # prose-declared criterion (measured over all 468 items), so reality has not
    # produced this fault yet. It is in the §17g fault set because it is the shape a
    # fifth format would arrive as, and the point of the fix is that it does not need
    # a fifth rule — a criterion is any line that DECLARES an id.
    body = """## Acceptance

AC-Q.1 - the first condition, written as a paragraph with no bullet at all,
wrapping onto a second line.

AC-Q.2 - the second condition, likewise.
"""
    r = lp.acceptance_report(body)
    check("prose-declared criteria parse without a fifth format rule",
          len(r["criteria"]) == 2)
    check("status parsed, no residual", r["status"] == "parsed" and not r["residual_ids"])
    check("continuation joined onto the prose criterion",
          "second line" in r["criteria"][0])



def test_extractor_populations_are_pinned_in_both_directions():
    # validates: AC-AP.6  (§17g generalisation sweep — the LEDGER is the deliverable)
    """The sweep question this item owes: "where ELSE does an extractor's failure look
    exactly like a legitimate empty answer?" Asked of every extractor in the file, the
    answer was worse than the reported defect — TWO more match NOTHING tree-wide.

    Both directions are pinned deliberately. A working extractor dropping to zero goes
    red (the reported defect, recurring). A pinned-ZERO extractor that STARTS matching
    ALSO goes red, so the ledger must be updated rather than quietly rotting — the
    `f694ea3` failure was precisely a ledger everyone believed and nobody re-measured.
    """
    pop = lp.extractor_population("OagEventSource")
    must_match = {"acceptance", "defect_fields", "job_resolved", "persona_resolved",
                  "block_note"}
    for key in must_match:
        check(f"{key} has a NON-ZERO tree-wide population "
              f"({pop[key]['hits']}/{pop[key]['total']})", pop[key]["hits"] > 0)
    # The two registered findings, pinned at their EXACT measured figure with a stated
    # reason, so the ledger must be updated when either moves in EITHER direction.
    #
    # `why` is pinned at 1, not 0, and the reason is worth keeping: the single hit is
    # THIS ITEM'S OWN LEDGER PROSE, which quotes the literal `**Why (persona/job):**`
    # while recording that no item uses it — so the extractor matched the sentence
    # documenting that it matches nothing. The pin caught that contamination the moment
    # the item was written, which is the pin working: a measurement can be polluted by
    # writing about the measurement, and that has to be visible rather than absorbed.
    # It also SHARPENS the finding — one self-referential mention in 469 items is
    # stronger evidence the format is unused than a bare zero would be.
    expected = {
        "definition_oneliner": (0, "no item writes a dash-suffixed `## Definition — …` "
                                   "heading; masked by compose()'s title fallback"),
        "why": (1, "the ONLY hit is this item's own ledger prose quoting the literal; "
                   "no item USES it as an authoring convention"),
    }
    for key, (n, reason) in expected.items():
        check(f"{key} population is EXACTLY {n} ({pop[key]['hits']}/{pop[key]['total']}) "
              f"— {reason}. If this went red the population MOVED and "
              f"EXTRACTOR_LEDGER must be updated in whichever direction",
              pop[key]["hits"] == n and pop[key]["total"] > 400)
    check("every ledger row is measured (no row declared without a number)",
          all(k in pop for k, _m, _v in lp.EXTRACTOR_LEDGER))
    check("no ledger row calls its own population benign (§17h limb 2)",
          not any(w in v.lower() for _k, _m, v in lp.EXTRACTOR_LEDGER
                  for w in ("benign", "degenerate", "expected", "out of scope")))



def run():
    for fn in [
        test_parse_acceptance_joins_wrapped_lines,
        test_frontmatter_and_helpers,
        test_reference_resolution,
        test_render_description_sections,
        test_labels_and_status,
        test_state_status_covers_every_graph_state,
        test_state_status_has_no_state_the_graph_does_not_define,
        test_graph_states_are_derived_not_hand_listed,
        test_cancelled_resolves_to_a_real_terminal_status,
        test_awaiting_observation_resolves_to_a_parked_status,
        test_unmapped_state_is_loud_not_silently_backlog,
        test_every_real_item_state_is_projectable,
        test_level3_subheading_does_not_terminate_acceptance,
        test_every_acceptance_section_is_read_not_only_the_first,
        test_prose_only_acceptance_is_unenumerated_not_zero,
        test_backticked_ids_in_a_numbered_list_parse,
        test_fault_set_numbered_list_with_no_bold_ids,
        test_fault_set_ids_in_prose_with_no_list_marker,
        test_genuinely_no_acceptance_is_representable_as_none,
        test_empty_acceptance_section_is_distinct_from_unreadable,
        test_a_dropped_id_is_reported_as_truncated_not_silently_lost,
        test_ids_never_capture_a_trailing_sentence_period,
        test_label_distinguishes_unreadable_from_needs_acceptance,
        test_render_shows_the_unreadable_banner_to_a_human,
        test_tree_sweep_classifies_every_real_item_and_is_non_vacuous,
        test_audit_goes_RED_on_a_real_item_with_unenumerable_acceptance,
        test_audit_goes_RED_on_a_real_truncated_item_and_names_the_dropped_id,
        test_audit_goes_RED_on_a_declaration_with_no_authority,
        test_audit_goes_RED_on_a_stale_declaration_so_it_can_only_shrink,
        test_audit_is_GREEN_on_the_real_corpus_with_the_committed_registry,
        test_extractor_populations_are_pinned_in_both_directions,
    ]:
        print(f"* {fn.__name__}")
        fn()
    if FAILS:
        print(f"\nFAILED ({len(FAILS)}): {FAILS}")
        return 1
    print("\nALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(run())
