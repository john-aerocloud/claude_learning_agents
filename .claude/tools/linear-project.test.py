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
