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


def run():
    for fn in [
        test_parse_acceptance_joins_wrapped_lines,
        test_frontmatter_and_helpers,
        test_reference_resolution,
        test_render_description_sections,
        test_labels_and_status,
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
