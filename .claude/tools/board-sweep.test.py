#!/usr/bin/env python3
"""Offline tests for board-sweep.py — the BATCH WRAPPER above the single-item
Linear projection (DEFECT-OAG-099).

    make test-board-sweep
    <python> .claude/tools/board-sweep.test.py

Every case names the acceptance criterion it validates (process §17d LIMB 1).

PROVENANCE (§17d / the wire-contract rule). Two different wires are in play and
they are NOT the same class of fact:

  * The WORK-ITEM file format is OURS (process/machinery/CONTRACT.md). Authoring
    fixture item files is legitimate — the format is not an external contract.
  * The LINEAR GraphQL API is NOT ours. Every fixture here that stands in for a
    Linear response or error is SYNTHETIC and CONFIRMS NOTHING about the real
    wire. The error strings the classifier keys on are declared `unverified` in
    board-sweep.py's PROVENANCE table, and `test_unrecognised_board_error_...`
    pins the only property that survives being wrong about them: an error we do
    not recognise is never counted as a landed write.

LIMB 2 (no authored preconditions): no fixture here mutates a real capture, and
no claim about the live API is made from a stub. The single claim about the
single-item tool's REQUEST COST is measured by counting real calls through the
real `lp.upsert` code path with only the transport replaced
(`test_measured_request_cost_per_item`), not asserted from a comment.
"""

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


lp = _load("linear_project", "linear-project.py")
bs = _load("board_sweep", "board-sweep.py")

FAILS = []


def check(name, cond, detail=""):
    if cond:
        print(f"  ok  - {name}")
    else:
        print(f"  FAIL- {name}" + (f"  [{detail}]" if detail else ""))
        FAILS.append(name)


# --------------------------------------------------------------------------- #
# Fixture corpus — item files in OUR format (see PROVENANCE above)
# --------------------------------------------------------------------------- #
ITEM_TMPL = """---
id: {iid}
type: {itype}
title: {title}
{job}parents: []
deps: []
events:
{events}
derived:
  state: {state}
  children: []
  ancestors: []
---

## Definition — {title}

**Why (persona/job):** fixture.

## Acceptance criteria ({iid})
- **AC-1:** a fixture criterion.
"""


def write_item(root, project, iid, itype, state, *, sub="active",
               title=None, ts="2026-08-01T00:00:00Z", job=None):
    d = root / "work" / project / "items" / sub
    d.mkdir(parents=True, exist_ok=True)
    events = f"  - {{ts: {ts}, event: registered, agent: flow-manager}}"
    (d / f"{iid}.md").write_text(
        ITEM_TMPL.format(iid=iid, itype=itype, state=state, events=events,
                         job=(f"job: {job}\n" if job else ""),
                         title=title or f"fixture {iid}"),
        encoding="utf-8")
    return d / f"{iid}.md"


def write_secrets(root, project, id_to_issue=None):
    d = root / "work" / project / "secrets"
    d.mkdir(parents=True, exist_ok=True)
    p = d / "linear.json"
    p.write_text(json.dumps({
        "api_key": "lin_api_FAKE_NEVER_REAL",
        "team_id": "team-uuid-fixture",
        "id_to_issue": id_to_issue or {},
    }, indent=2) + "\n", encoding="utf-8")
    return p


class FakeBoard:
    """A synthetic stand-in for the Linear side. Confirms nothing about the real
    API (see PROVENANCE); it exists to exercise OUR control flow."""

    def __init__(self, objects=None, states=None):
        # issue_id -> BoardObject-ish dict
        self.objects = objects or {}
        self.states = states or ["Backlog", "Todo", "In Progress", "In Review",
                                 "Blocked", "Done", "Cancelled", "Ready"]
        self.writes = []

    def lookup(self, issue_id):
        return self.objects.get(issue_id)


def facts_of(root, project):
    return bs.read_item_facts(project, root=root)


# --------------------------------------------------------------------------- #
# AC-099.1 — explicit id list and/or priority order
# --------------------------------------------------------------------------- #
def test_AC_099_1_explicit_order_is_honoured_verbatim():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        for iid in ("UC-A", "UC-B", "UC-C"):
            write_item(root, "P", iid, "use-case", "ready")
        facts = facts_of(root, "P")
        plan = bs.plan_sweep(facts, explicit=["UC-C", "UC-A", "UC-B"],
                             board_lookup=lambda i: None,
                             resolver=lambda names: names[0])
        check("AC-099.1: explicit order is used verbatim",
              plan.to_write == ["UC-C", "UC-A", "UC-B"], plan.to_write)


def test_AC_099_1_terminal_lag_outranks_an_ordinary_mismatch():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        write_item(root, "P", "UC-ORD", "use-case", "building",
                   ts="2026-08-19T00:00:00Z")
        write_item(root, "P", "UC-DONE", "use-case", "done", sub="done",
                   ts="2026-08-01T00:00:00Z")
        facts = facts_of(root, "P")
        plan = bs.plan_sweep(facts, board_lookup=lambda i: None,
                             resolver=lambda names: names[0])
        check("AC-099.1: a TERMINAL item lagging the board is written first",
              plan.to_write[0] == "UC-DONE", plan.to_write)
        check("AC-099.1: recency does NOT outrank the terminal invariant",
              plan.to_write == ["UC-DONE", "UC-ORD"], plan.to_write)


def test_AC_099_1_parked_lag_ranks_between_terminal_and_ordinary():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        write_item(root, "P", "UC-ORD", "use-case", "building")
        write_item(root, "P", "UC-BLK", "use-case", "blocked")
        write_item(root, "P", "UC-AWO", "use-case", "awaiting_observation")
        write_item(root, "P", "UC-DONE", "use-case", "done", sub="done")
        facts = facts_of(root, "P")
        plan = bs.plan_sweep(facts, board_lookup=lambda i: None,
                             resolver=lambda names: names[0])
        classes = [bs.priority_class(facts[i]) for i in plan.to_write]
        check("AC-099.1: order is terminal, then parked, then ordinary",
              classes == sorted(classes) and plan.to_write[0] == "UC-DONE"
              and plan.to_write[-1] == "UC-ORD",
              f"{plan.to_write} -> {classes}")


def test_AC_099_1_within_a_class_most_recently_changed_first_then_id():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        write_item(root, "P", "UC-OLD", "use-case", "building",
                   ts="2026-01-01T00:00:00Z")
        write_item(root, "P", "UC-NEW", "use-case", "building",
                   ts="2026-08-19T12:00:00Z")
        write_item(root, "P", "UC-TIE-B", "use-case", "building",
                   ts="2026-08-19T12:00:00Z")
        facts = facts_of(root, "P")
        plan = bs.plan_sweep(facts, board_lookup=lambda i: None,
                             resolver=lambda names: names[0])
        check("AC-099.1: most-recently-changed first inside a class",
              plan.to_write[-1] == "UC-OLD", plan.to_write)
        check("AC-099.1: ties break deterministically by id",
              plan.to_write[:2] == ["UC-NEW", "UC-TIE-B"], plan.to_write)


def test_AC_099_1_an_id_with_no_item_file_is_reported_not_crashed():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        write_item(root, "P", "UC-A", "use-case", "ready")
        facts = facts_of(root, "P")
        plan = bs.plan_sweep(facts, explicit=["UC-A", "UC-GHOST"],
                             board_lookup=lambda i: None,
                             resolver=lambda names: names[0])
        check("AC-099.1: an unknown id is reported, not silently dropped",
              plan.unknown_ids == ["UC-GHOST"], plan.unknown_ids)
        check("AC-099.1: the rest of the list still plans",
              plan.to_write == ["UC-A"], plan.to_write)


# --------------------------------------------------------------------------- #
# AC-099.2 — skip items whose board status already matches
# --------------------------------------------------------------------------- #
def test_AC_099_2_a_matching_item_is_skipped_and_never_written():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        write_item(root, "P", "UC-DONE", "use-case", "done", sub="done")
        facts = facts_of(root, "P")
        board = FakeBoard({"iss-1": {"id": "iss-1", "identifier": "P-1",
                                     "status_name": "Done"}})
        plan = bs.plan_sweep(facts, board_lookup=lambda i: board.lookup("iss-1"),
                             resolver=lambda names: names[0])
        check("AC-099.2: board already Done -> skipped",
              plan.skipped == ["UC-DONE"] and plan.to_write == [],
              f"{plan.skipped} / {plan.to_write}")


def test_AC_099_2_an_item_with_no_board_object_is_never_skipped():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        write_item(root, "P", "UC-NEW", "use-case", "ready")
        facts = facts_of(root, "P")
        plan = bs.plan_sweep(facts, board_lookup=lambda i: None,
                             resolver=lambda names: names[0])
        check("AC-099.2: no board object -> always written",
              plan.to_write == ["UC-NEW"] and plan.skipped == [])


def test_AC_099_2_a_later_fallback_candidate_is_not_a_match():
    """`blocked` maps to [Blocked, Todo, Backlog]. A workspace that HAS Blocked
    but whose issue sits on Todo is LAGGING, not matching."""
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        write_item(root, "P", "UC-BLK", "use-case", "blocked")
        facts = facts_of(root, "P")
        board = FakeBoard({"iss-1": {"id": "iss-1", "identifier": "P-1",
                                     "status_name": "Todo"}})
        plan = bs.plan_sweep(
            facts, board_lookup=lambda i: board.lookup("iss-1"),
            resolver=lambda names: next(
                (n for n in names if n in board.states), None))
        check("AC-099.2: Todo when Blocked exists is a mismatch, so it is written",
              plan.to_write == ["UC-BLK"], f"{plan.to_write} / {plan.skipped}")


def test_AC_099_2_compare_full_catches_a_description_drift_status_alone_misses():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        write_item(root, "P", "UC-DONE", "use-case", "done", sub="done")
        facts = facts_of(root, "P")
        obj = {"id": "iss-1", "identifier": "P-1", "status_name": "Done",
               "title": "STALE TITLE", "description": "stale", "labels": []}
        kw = dict(board_lookup=lambda i: obj, resolver=lambda names: names[0])
        status_plan = bs.plan_sweep(facts, compare="status", **kw)
        full_plan = bs.plan_sweep(
            facts, compare="full",
            renderer=lambda iid: ("UC-DONE · fixture UC-DONE", "fresh", []), **kw)
        check("AC-099.2: compare=status skips a title/description drift",
              status_plan.skipped == ["UC-DONE"])
        check("AC-099.2: compare=full writes it",
              full_plan.to_write == ["UC-DONE"], full_plan.to_write)


def test_AC_099_2_skip_is_measured_and_non_vacuous_on_a_mixed_corpus():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        matching, lagging = [], []
        for n in range(20):
            iid = f"UC-M{n:02d}"
            write_item(root, "P", iid, "use-case", "done", sub="done")
            matching.append(iid)
        for n in range(3):
            iid = f"UC-L{n:02d}"
            write_item(root, "P", iid, "use-case", "done", sub="done")
            lagging.append(iid)
        facts = facts_of(root, "P")

        def lookup(iid):
            return {"id": f"iss-{iid}", "identifier": "P-x",
                    "status_name": "Done" if iid in matching else "Blocked"}

        plan = bs.plan_sweep(facts, board_lookup=lookup,
                             resolver=lambda names: names[0])
        check("AC-099.2: 20 already-correct items are skipped (measured)",
              len(plan.skipped) == 20, len(plan.skipped))
        check("AC-099.2: the 3 lagging items ARE written (non-vacuous)",
              sorted(plan.to_write) == sorted(lagging), plan.to_write)


# --------------------------------------------------------------------------- #
# AC-099.3 — rate-limit exhaustion reports precisely what did not land
# --------------------------------------------------------------------------- #
def _sweep_with(root, project, plan, write, **kw):
    return bs.run_sweep(plan, write, root=root, project=project, **kw)


def test_AC_099_3_rate_limit_reports_every_unwritten_id_in_priority_order():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        order = ["UC-1", "UC-2", "UC-3", "UC-4"]
        for iid in order:
            write_item(root, "P", iid, "use-case", "ready")
        plan = bs.Plan(to_write=list(order), skipped=[], unknown_ids=[],
                       unprojectable=[], unresolved_status=[])
        done = []

        def write(iid):
            if len(done) == 2:
                raise lp.LinearError("Linear HTTP 429 Too Many Requests")
            done.append(iid)

        res = _sweep_with(root, "P", plan, write, resume_path=root / "r.txt")
        check("AC-099.3: stops at the rate limit", res.landed == ["UC-1", "UC-2"])
        check("AC-099.3: names every id that did not land, in priority order",
              res.not_landed_ids == ["UC-3", "UC-4"], res.not_landed_ids)
        check("AC-099.3: the stop reason is the rate limit",
              res.stopped_reason == "rate-limit", res.stopped_reason)
        check("AC-099.3: exit code is the dedicated rate-limit code",
              res.exit_code == bs.EXIT_RATE_LIMITED, res.exit_code)


def test_AC_099_3_the_resume_file_lets_a_retry_resume_exactly_where_it_stopped():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        order = ["UC-1", "UC-2", "UC-3"]
        for iid in order:
            write_item(root, "P", iid, "use-case", "ready")
        resume = root / "resume.txt"
        plan = bs.Plan(to_write=list(order), skipped=[], unknown_ids=[],
                       unprojectable=[], unresolved_status=[])
        calls = []

        def write(iid):
            calls.append(iid)
            if iid == "UC-2":
                raise lp.LinearError("Linear HTTP 429 rate limited")

        _sweep_with(root, "P", plan, write, resume_path=resume)
        ids = bs.read_ids_file(resume)
        check("AC-099.3: resume file holds the shortfall in priority order",
              ids == ["UC-2", "UC-3"], ids)
        # the retry
        plan2 = bs.Plan(to_write=ids, skipped=[], unknown_ids=[],
                        unprojectable=[], unresolved_status=[])
        res2 = _sweep_with(root, "P", plan2, lambda i: None, resume_path=resume)
        check("AC-099.3: the retry lands the remainder and clears the shortfall",
              res2.not_landed_ids == [] and res2.exit_code == bs.EXIT_OK)
        check("AC-099.3: a cleared resume file no longer names anything",
              bs.read_ids_file(resume) == [], bs.read_ids_file(resume))


def test_AC_099_3_the_shortfall_report_is_loud():
    res = bs.Result(landed=["UC-1"], skipped=[], failures=[],
                    not_landed=[("UC-9", "rate-limit", "429"),
                                ("UC-8", "not-attempted", "")],
                    stopped_reason="rate-limit", unknown_ids=[],
                    unprojectable=[], unresolved_status=[], appeared_after=[],
                    vanished=[], budget=None)
    text = bs.format_report(res, project="P")
    check("AC-099.3: the report SHOUTS the rate limit",
          "RATE LIMIT" in text.upper(), text[:200])
    check("AC-099.3: the report names each unreconciled id",
          "UC-9" in text and "UC-8" in text)
    check("AC-099.3: the report states how many did not land",
          "2" in text.split("RATE LIMIT")[1][:200] if "RATE LIMIT" in text else False)


# --------------------------------------------------------------------------- #
# AC-099.4 — a state in state-graphs.json but not in linear-mapping FAILS LOUDLY
# AC-099.5 — the automatic check that every graph state has a mapping row
# --------------------------------------------------------------------------- #
def test_AC_099_4_an_unmapped_state_raises_rather_than_defaulting_to_backlog():
    raised = None
    try:
        lp.desired_status_names("use-case", "a_throwaway_state")
    except lp.UnmappedStateError as e:
        raised = str(e)
    check("AC-099.4: an unmapped state RAISES", raised is not None)
    check("AC-099.4: and it never yields Backlog",
          raised is not None and "REFUSED" in raised)


def test_AC_099_4_the_sweep_refuses_to_run_at_all_while_the_table_drifts():
    """The limb that stops the third occurrence: a drifted table is a
    PRECONDITION failure of the whole sweep, not a per-item surprise."""
    graphs = json.loads((HERE.parents[1] / "process" / "machinery"
                         / "state-graphs.json").read_text(encoding="utf-8"))
    graphs["types"]["use-case"]["transitions"].append(
        {"from": "ready", "event": "throwaway", "to": "a_throwaway_state",
         "agents": ["engineer"]})
    findings = bs.check_preconditions(graphs=graphs)
    check("AC-099.4: an injected throwaway state fails the sweep precondition",
          any("a_throwaway_state" in f for f in findings), findings)
    clean = bs.check_preconditions(
        graphs=json.loads((HERE.parents[1] / "process" / "machinery"
                           / "state-graphs.json").read_text(encoding="utf-8")))
    check("AC-099.5: the real committed graph passes the same check",
          clean == [], clean)


def test_AC_099_5_the_mapping_gate_is_a_standalone_command_a_workflow_can_run():
    """AC-099.5 wants an AUTOMATIC check, and §17e says a gate in no workflow is
    not a gate. So the drift check is also a project-free, credential-free,
    corpus-free command — which is what `loop-gate` delegates to before every
    pull. Drives the REAL CLI both ways."""
    real = subprocess.run(
        [sys.executable, str(HERE / "board-sweep.py"), "--audit-mapping"],
        capture_output=True, text=True)
    check("AC-099.5: the committed mapping passes the standalone gate",
          real.returncode == bs.EXIT_OK, real.stdout + real.stderr)
    check("AC-099.5: it needs no --project, no secret and no item corpus",
          "CLEAN" in real.stdout.upper(), real.stdout)

    with tempfile.TemporaryDirectory() as td:
        graphs = json.loads((HERE.parents[1] / "process" / "machinery"
                             / "state-graphs.json").read_text(encoding="utf-8"))
        graphs["types"]["use-case"]["transitions"].append(
            {"from": "ready", "event": "throwaway", "to": "a_throwaway_state",
             "agents": ["engineer"]})
        p = Path(td) / "state-graphs.json"
        p.write_text(json.dumps(graphs), encoding="utf-8")
        drifted = subprocess.run(
            [sys.executable, str(HERE / "board-sweep.py"), "--audit-mapping",
             "--graphs", str(p)], capture_output=True, text=True)
        check("AC-099.5: a state with no mapping row FAILS the gate",
              drifted.returncode == bs.EXIT_PRECONDITION, drifted.returncode)
        check("AC-099.5: and the gate names the state and the two files to edit",
              "a_throwaway_state" in (drifted.stdout + drifted.stderr)
              and "linear-mapping.md" in (drifted.stdout + drifted.stderr),
              drifted.stdout + drifted.stderr)


def test_AC_099_4_an_unprojectable_item_is_reported_and_never_written():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        write_item(root, "P", "UC-WEIRD", "use-case", "a_throwaway_state")
        write_item(root, "P", "UC-OK", "use-case", "ready")
        facts = facts_of(root, "P")
        plan = bs.plan_sweep(facts, board_lookup=lambda i: None,
                             resolver=lambda names: names[0])
        check("AC-099.4: the unprojectable item is NOT written",
              "UC-WEIRD" not in plan.to_write, plan.to_write)
        check("AC-099.4: it is reported by id with the reason",
              [i for i, _ in plan.unprojectable] == ["UC-WEIRD"],
              plan.unprojectable)
        check("AC-099.4: the projectable item still goes",
              plan.to_write == ["UC-OK"], plan.to_write)


def test_AC_099_5_every_graph_state_has_a_mapping_row_in_both_directions():
    gaps = lp.audit_state_status()
    check("AC-099.5: STATE_STATUS and state-graphs.json agree exactly",
          gaps == [], gaps)
    doc = (HERE.parents[1] / "process" / "linear-mapping.md").read_text(
        encoding="utf-8")
    graphs = lp.load_state_graphs()
    missing_from_doc = []
    for itype in graphs.get("types", {}):
        for st in sorted(lp.graph_states(graphs, itype)):
            if st not in doc:
                missing_from_doc.append(f"{itype}/{st}")
    check("AC-099.5: every graph state is also documented in linear-mapping.md",
          missing_from_doc == [], missing_from_doc)


# --------------------------------------------------------------------------- #
# AC-099.7 — the §17g fault set
# --------------------------------------------------------------------------- #
def test_AC_099_7_fault_a_rate_limit_MID_item_is_reported_indeterminate():
    """A 429 raised AFTER a mutation has landed cannot be told from one raised
    before it. The only safe handling is to report the item as NOT ESTABLISHED
    and leave it first in the resume list — never as landed."""
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        for iid in ("UC-1", "UC-2"):
            write_item(root, "P", iid, "use-case", "ready")
        board_side_effects = []
        plan = bs.Plan(to_write=["UC-1", "UC-2"], skipped=[], unknown_ids=[],
                       unprojectable=[], unresolved_status=[])

        def write(iid):
            board_side_effects.append(f"{iid}:labels")   # partial write lands
            raise lp.LinearError("Linear HTTP 429 Too Many Requests")

        res = _sweep_with(root, "P", plan, write, resume_path=root / "r.txt")
        check("AC-099.7a: a mid-item rate limit is never counted as landed",
              res.landed == [], res.landed)
        outcome = dict((i, o) for i, o, _ in res.not_landed).get("UC-1")
        check("AC-099.7a: the interrupted item is reported INDETERMINATE",
              outcome == "indeterminate", res.not_landed)
        check("AC-099.7a: it is FIRST in the resume list",
              res.not_landed_ids[0] == "UC-1", res.not_landed_ids)
        check("AC-099.7a: the partial board write is NOT rolled back",
              board_side_effects == ["UC-1:labels"], board_side_effects)
        # the retry converges, because the projection is idempotent
        plan2 = bs.Plan(to_write=res.not_landed_ids, skipped=[], unknown_ids=[],
                        unprojectable=[], unresolved_status=[])
        res2 = _sweep_with(root, "P", plan2, lambda i: None,
                           resume_path=root / "r.txt")
        check("AC-099.7a: a resume run converges",
              res2.exit_code == bs.EXIT_OK and res2.landed == ["UC-1", "UC-2"],
              res2.landed)


def test_AC_099_7_fault_b_a_second_concurrent_sweep_refuses():
    with tempfile.TemporaryDirectory() as td:
        lock = Path(td) / "sweep.lock"
        held = bs.acquire_lock(lock, stale_seconds=1800)
        check("AC-099.7b: the first sweep takes the lock",
              held.action == "acquired", held)
        refused = None
        try:
            bs.acquire_lock(lock, stale_seconds=1800)
        except bs.SweepLocked as e:
            refused = str(e)
        check("AC-099.7b: a second concurrent sweep REFUSES (does not double-spend)",
              refused is not None and "already" in refused.lower(), refused)
        bs.release_lock(lock, held)
        after = bs.acquire_lock(lock, stale_seconds=1800)
        check("AC-099.7b: the lock is released for the next sweep",
              after.action == "acquired", after)
        bs.release_lock(lock, after)


def test_AC_099_7_fault_b_a_stale_lock_is_stolen_loudly():
    with tempfile.TemporaryDirectory() as td:
        lock = Path(td) / "sweep.lock"
        held = bs.acquire_lock(lock, stale_seconds=1800)
        os.utime(lock, (0, 0))  # pretend the holder died an hour ago
        stolen = bs.acquire_lock(lock, stale_seconds=1)
        check("AC-099.7b: a stale lock is broken so a crash cannot wedge the sweep",
              stolen.action == "stolen", stolen)
        check("AC-099.7b: the steal is reported, not silent",
              "stale" in (stolen.message or "").lower(), stolen.message)
        bs.release_lock(lock, stolen)
        del held


def test_AC_099_7_fault_c_a_human_deleted_issue_is_healed_and_reported():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        write_item(root, "P", "UC-1", "use-case", "ready")
        secrets = write_secrets(root, "P", {"UC-1": {"type": "issue",
                                                     "id": "iss-gone"}})
        plan = bs.Plan(to_write=["UC-1"], skipped=[], unknown_ids=[],
                       unprojectable=[], unresolved_status=[])
        attempts = []

        def write(iid):
            attempts.append(iid)
            if len(attempts) == 1:
                raise lp.LinearError(
                    "Linear GraphQL error: Entity not found: Issue - "
                    "Could not find referenced Issue.")

        res = _sweep_with(root, "P", plan, write, resume_path=root / "r.txt",
                          secrets_path=secrets, heal_stale_mappings=True)
        left = json.loads(secrets.read_text())["id_to_issue"]
        check("AC-099.7c: the stale mapping is dropped so the next write CREATES",
              "UC-1" not in left, left)
        check("AC-099.7c: the write is retried once and lands",
              res.landed == ["UC-1"] and len(attempts) == 2, attempts)
        check("AC-099.7c: the heal is reported, not silent",
              any("stale-mapping" in ev for ev in res.notes), res.notes)


def test_AC_099_7_fault_c_without_healing_it_is_a_reported_failure_not_a_land():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        write_item(root, "P", "UC-1", "use-case", "ready")
        secrets = write_secrets(root, "P", {"UC-1": {"type": "issue",
                                                     "id": "iss-gone"}})
        plan = bs.Plan(to_write=["UC-1"], skipped=[], unknown_ids=[],
                       unprojectable=[], unresolved_status=[])

        def write(iid):
            raise lp.LinearError("Linear GraphQL error: Entity not found: Issue")

        res = _sweep_with(root, "P", plan, write, resume_path=root / "r.txt",
                          secrets_path=secrets, heal_stale_mappings=False)
        check("AC-099.7c: an unhealed stale mapping is never counted as landed",
              res.landed == [], res.landed)
        check("AC-099.7c: it is reported as a failure by id",
              [i for i, _, _ in res.failures] == ["UC-1"], res.failures)
        check("AC-099.7c: and the run exits non-zero",
              res.exit_code != bs.EXIT_OK, res.exit_code)


def test_AC_099_7_fault_d_a_status_the_workspace_lacks_keeps_the_label():
    """linear-mapping §2: `blocked` -> Blocked, else Todo, else Backlog, and the
    `blocked` LABEL is what keeps it honest. A workspace with none of the three
    must still get the label — and the unresolved status must be LOUD."""
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        write_item(root, "P", "UC-BLK", "use-case", "blocked")
        facts = facts_of(root, "P")
        minimal_workspace = ["Started", "Finished"]   # no Blocked/Todo/Backlog
        plan = bs.plan_sweep(
            facts, board_lookup=lambda i: None,
            resolver=lambda names: next(
                (n for n in names if n in minimal_workspace), None))
        check("AC-099.7d: the item is still written (so its label lands)",
              plan.to_write == ["UC-BLK"], plan.to_write)
        check("AC-099.7d: the unresolvable status is reported by id",
              plan.unresolved_status == ["UC-BLK"], plan.unresolved_status)
        labels = lp.compose_labels({"state": "blocked", "type": "use-case",
                                    "acceptance": ["AC-1"],
                                    "acceptance_status": "ok"})
        check("AC-099.7d: the mapping's `blocked` label is still composed",
              "blocked" in labels, labels)
        res = bs.Result(landed=["UC-BLK"], skipped=[], failures=[],
                        not_landed=[], stopped_reason=None, unknown_ids=[],
                        unprojectable=[], unresolved_status=["UC-BLK"],
                        appeared_after=[], vanished=[], budget=None)
        check("AC-099.7d: a status that could not be set is LOUD in the report",
              "STATUS NOT SET" in bs.format_report(res, project="P").upper(),
              bs.format_report(res, project="P"))
        check("AC-099.7d: and the run does not read as fully clean",
              res.exit_code != bs.EXIT_OK, res.exit_code)


def test_AC_099_7_fault_e_an_item_added_after_the_snapshot_is_reported():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        write_item(root, "P", "UC-1", "use-case", "ready")
        snapshot = sorted(facts_of(root, "P"))
        plan = bs.Plan(to_write=["UC-1"], skipped=[], unknown_ids=[],
                       unprojectable=[], unresolved_status=[])

        def write(iid):
            # a concurrent agent registers a new item mid-sweep
            write_item(root, "P", "UC-LATE", "use-case", "registered")

        res = _sweep_with(root, "P", plan, write, resume_path=root / "r.txt",
                          snapshot_ids=snapshot)
        check("AC-099.7e: an item that appeared after the read is reported",
              res.appeared_after == ["UC-LATE"], res.appeared_after)
        check("AC-099.7e: so the run does not claim to be complete",
              res.exit_code != bs.EXIT_OK, res.exit_code)
        check("AC-099.7e: and it is queued in the resume file for the retry",
              "UC-LATE" in bs.read_ids_file(root / "r.txt"),
              bs.read_ids_file(root / "r.txt"))


def test_AC_099_7_fault_e_an_item_deleted_mid_sweep_does_not_crash_the_run():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        p1 = write_item(root, "P", "UC-1", "use-case", "ready")
        write_item(root, "P", "UC-2", "use-case", "ready")
        snapshot = sorted(facts_of(root, "P"))
        plan = bs.Plan(to_write=["UC-1", "UC-2"], skipped=[], unknown_ids=[],
                       unprojectable=[], unresolved_status=[])
        p1.unlink()

        def write(iid):
            if iid == "UC-1":
                raise FileNotFoundError(f"item {iid} not found")

        res = _sweep_with(root, "P", plan, write, resume_path=root / "r.txt",
                          snapshot_ids=snapshot)
        check("AC-099.7e: a vanished item is reported, not fatal",
              res.vanished == ["UC-1"], res.vanished)
        check("AC-099.7e: the rest of the sweep still runs",
              res.landed == ["UC-2"], res.landed)


# --------------------------------------------------------------------------- #
# Budget — the question the brief refuses to assume the answer to
# --------------------------------------------------------------------------- #
def test_measured_request_cost_per_item_through_the_real_upsert_path():
    """Not a comment: drive lp.upsert with ONLY the transport replaced and COUNT
    the requests. This is the denominator of the budget question, and the first
    version of this test was WRONG — it asserted 3 for an item that carries no
    labels, and the measurement said 2. Both shapes are pinned below."""

    def measure(job):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            write_item(root, "P", "UC-1", "use-case", "done", sub="done", job=job)
            write_secrets(root, "P", {"UC-1": {"type": "issue", "id": "iss-1"}})
            calls = []

            def fake_graphql(api_key, query, variables=None):
                calls.append(query)
                flat = query.replace(" ", "")
                if "states{nodes" in flat:
                    return {"team": {"states": {"nodes": [
                        {"id": "s-done", "name": "Done", "type": "completed"}]}}}
                if "labels{nodes" in flat:
                    return {"team": {"labels": {"nodes": []}}}
                if "issueLabelCreate" in query:
                    return {"issueLabelCreate": {"success": True, "issueLabel": {
                        "id": "l-1", "name": "job:J1"}}}
                if "issueUpdate" in query:
                    return {"issueUpdate": {"success": True, "issue": {
                        "id": "iss-1", "identifier": "P-1"}}}
                raise AssertionError(f"unexpected query: {query[:60]}")

            old_root, old_gql = lp.ROOT, lp.graphql
            lp.ROOT, lp.graphql = root, fake_graphql
            try:
                rc = lp.upsert("P", "UC-1")
            finally:
                lp.ROOT, lp.graphql = old_root, old_gql
            meta = [q for q in calls
                    if "states{nodes" in q.replace(" ", "")
                    or "labels{nodes" in q.replace(" ", "")]
            return rc, calls, meta

    rc, calls, meta = measure(job=None)
    check("budget: an UNLABELLED item costs 2 requests (measured)",
          rc == 0 and len(calls) == 2, f"{len(calls)} calls")
    check("budget: 1 of those 2 is immutable team metadata",
          len(meta) == 1, meta)

    rc, calls, meta = measure(job="J1")
    check("budget: a LABELLED item (the normal case) costs 3 requests + a "
          "label create when the label is new (measured)",
          rc == 0 and len(calls) == 4, f"{len(calls)} calls: {[q[:28] for q in calls]}")
    check("budget: 2 of them are IMMUTABLE team metadata, re-read PER ITEM — "
          "the structural waste a wrapper cannot remove without changing the "
          "single-item tool",
          len(meta) == 2, meta)

    est = bs.estimate_budget(items_to_write=274, requests_per_write=3,
                             snapshot_requests=5)
    check("budget: the estimator states the full-reconcile cost out loud",
          est["total_requests"] == 274 * 3 + 5, est)
    steady = bs.estimate_budget(items_to_write=5, requests_per_write=3,
                                snapshot_requests=5)
    check("budget: the SKIP is what changes the order of magnitude, not the order",
          steady["total_requests"] == 20
          and est["total_requests"] / steady["total_requests"] > 40, (est, steady))


def test_budget_probe_is_honest_when_the_wire_returns_no_headers():
    got = bs.parse_budget_headers({})
    check("budget: no rate-limit headers -> NOT ESTABLISHED, never a claim",
          got["established"] is False, got)
    got2 = bs.parse_budget_headers({
        "X-RateLimit-Requests-Limit": "1500",
        "X-RateLimit-Requests-Remaining": "1200",
        "X-RateLimit-Requests-Reset": "1755700000",
    })
    check("budget: real headers are parsed into limit/remaining",
          got2["established"] and got2["limit"] == 1500
          and got2["remaining"] == 1200, got2)


def test_AC_099_1_the_REAL_CLI_prints_the_priority_order_with_no_credential():
    """Non-vacuity: drive the committed entry point as a subprocess, not the
    functions underneath it. `--offline-plan` needs no network and no secret, so
    an operator can inspect the spend order before spending anything."""
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        write_item(root, "P", "UC-ORD", "use-case", "building",
                   ts="2026-08-19T00:00:00Z")
        write_item(root, "P", "UC-DONE-1", "use-case", "done", sub="done",
                   ts="2026-08-05T00:00:00Z")
        write_item(root, "P", "UC-DONE-2", "use-case", "done", sub="done",
                   ts="2026-08-12T00:00:00Z")
        write_item(root, "P", "UC-BLK", "use-case", "blocked",
                   ts="2026-08-18T00:00:00Z")
        out = subprocess.run(
            [sys.executable, str(HERE / "board-sweep.py"), "--project", "P",
             "--all", "--offline-plan", "--root", td],
            capture_output=True, text=True)
        lines = [ln for ln in out.stdout.splitlines() if ". UC-" in ln]
        order = [ln.split(". ")[1].split()[0] for ln in lines]
        check("AC-099.1: the CLI orders terminal lag first, newest first",
              order == ["UC-DONE-2", "UC-DONE-1", "UC-BLK", "UC-ORD"], order)
        check("AC-099.1: an offline plan is clean and costs nothing",
              out.returncode == bs.EXIT_OK, out.returncode)
        check("AC-099.1: the plan states the estimated request cost",
              "estimated cost" in out.stdout)

        bad = subprocess.run(
            [sys.executable, str(HERE / "board-sweep.py"), "--project", "P",
             "--offline-plan", "--ids", "UC-ORD,UC-GHOST", "--root", td],
            capture_output=True, text=True)
        check("AC-099.1: the CLI NAMES an id with no item file",
              "UC-GHOST" in bad.stdout, bad.stdout)
        check("AC-099.1: and does not exit clean while an id is unaccounted for",
              bad.returncode != bs.EXIT_OK, bad.returncode)

        drift = subprocess.run(
            [sys.executable, str(HERE / "board-sweep.py"), "--project", "NOPE",
             "--all", "--root", td], capture_output=True, text=True)
        check("AC-099.1: an empty corpus refuses BEFORE spending anything",
              drift.returncode == bs.EXIT_PRECONDITION, drift.returncode)


def test_unrecognised_board_error_is_never_treated_as_landed():
    check("classify: a 429 is a rate limit",
          bs.classify_error(lp.LinearError("Linear HTTP 429 Too Many Requests"))
          == "rate-limit")
    check("classify: a RATELIMITED GraphQL error is a rate limit",
          bs.classify_error(lp.LinearError(
              "Linear GraphQL error: RATELIMITED - too many requests"))
          == "rate-limit")
    check("classify: entity-not-found is a stale mapping",
          bs.classify_error(lp.LinearError(
              "Linear GraphQL error: Entity not found: Issue")) == "stale-mapping")
    check("classify: a missing item file is its own class",
          bs.classify_error(FileNotFoundError("item UC-X not found")) == "item-missing")
    check("classify: anything unrecognised is `other` — never silently fine",
          bs.classify_error(lp.LinearError("something nobody has seen")) == "other")
    check("provenance: every board-error literal is DECLARED",
          all(v in ("confirmed", "unverified") for v in bs.PROVENANCE.values())
          and len(bs.PROVENANCE) >= 3, bs.PROVENANCE)


def test_the_report_never_contains_a_credential():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        write_item(root, "P", "UC-1", "use-case", "ready")
        secrets = write_secrets(root, "P")
        res = bs.Result(landed=["UC-1"], skipped=[], failures=[], not_landed=[],
                        stopped_reason=None, unknown_ids=[], unprojectable=[],
                        unresolved_status=[], appeared_after=[], vanished=[],
                        budget={"established": True, "limit": 1500,
                                "remaining": 1400})
        text = bs.format_report(res, project="P")
        key = json.loads(secrets.read_text())["api_key"]
        check("secrets: the report never materialises the api key",
              key not in text and "lin_api" not in text)


TESTS = [v for k, v in sorted(globals().items()) if k.startswith("test_")]


def run():
    for fn in TESTS:
        print(f"* {fn.__name__}")
        fn()
    print()
    if FAILS:
        print(f"FAILED {len(FAILS)} check(s):")
        for f in FAILS:
            print(f"  - {f}")
        return 1
    print(f"PASSED — {len(TESTS)} tests, all checks green")
    return 0


if __name__ == "__main__":
    sys.exit(run())
