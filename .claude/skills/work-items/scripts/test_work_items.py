#!/usr/bin/env python3
"""Unit tests for the work-item machinery (work-items.py). Stdlib unittest only.

These tests use temp dirs + hand-crafted fixtures and NEVER touch the real
OagEventSource data. They monkeypatch the module's ROOT so items/views resolve
under a temp project.
"""
import io
import os
import sys
import json
import shutil
import tempfile
import unittest
import contextlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import importlib
wi = importlib.import_module("work-items".replace("-", "_")) if False else None

# import the hyphenated module file explicitly
import importlib.util
_spec = importlib.util.spec_from_file_location("work_items", os.path.join(HERE, "work-items.py"))
wi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(wi)

import argparse


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="wi-test-")
        self.project = "TestProj"
        # redirect the tool's ROOT into the temp tree
        self._orig_root = wi.ROOT
        wi.ROOT = self.tmp
        # graphs still load from the real machinery file (the contract under test)
        self.real_graphs = os.path.join(self._orig_root, "process", "machinery", "state-graphs.json")
        os.makedirs(os.path.join(self.tmp, "process", "machinery"), exist_ok=True)
        shutil.copy(self.real_graphs, os.path.join(self.tmp, "process", "machinery", "state-graphs.json"))
        wi.GRAPHS_PATH = os.path.join(self.tmp, "process", "machinery", "state-graphs.json")
        self.graphs = wi.Graphs.load(wi.GRAPHS_PATH)
        os.makedirs(self._items("active"), exist_ok=True)
        os.makedirs(self._items("done"), exist_ok=True)

    def tearDown(self):
        wi.ROOT = self._orig_root
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _items(self, sub):
        return os.path.join(self.tmp, "work", self.project, "items", sub)

    def write_item(self, sub, iid, itype, events, parents=None, deps=None,
                   title="t", body="\n## Definition\nstub\n"):
        item = wi.Item(os.path.join(self._items(sub), f"{iid}.md"),
                       {"id": iid, "type": itype, "title": title,
                        "job": "J0", "value": 1, "cost": 0.5,
                        "parents": parents or [], "deps": deps or [],
                        "created_ts": "2026-06-17T00:00:00Z", "events": events},
                       body)
        with open(item.path, "w", encoding="utf-8") as f:
            f.write(wi.render_item(item, {"state": None, "queue": None,
                                          "children": [], "ancestors": []}))
        return item.path


# --------------------------------------------------------------------------- #
# Fold / reducer
# --------------------------------------------------------------------------- #
class TestFold(Base):
    def test_use_case_fold_to_done(self):
        evs = [
            {"ts": "1", "event": "registered", "agent": "flow-manager"},
            {"ts": "2", "event": "made_ready", "agent": "flow-manager"},
            {"ts": "3", "event": "pulled", "agent": "orchestrator"},
            {"ts": "4", "event": "built_green", "agent": "engineer"},
            {"ts": "5", "event": "validated", "agent": "tester"},
        ]
        self.assertEqual(wi.fold_state(self.graphs, "use-case", evs), "done")

    def test_use_case_fold_partial(self):
        evs = [
            {"ts": "1", "event": "registered", "agent": "flow-manager"},
            {"ts": "2", "event": "made_ready", "agent": "flow-manager"},
            {"ts": "3", "event": "pulled", "agent": "orchestrator"},
        ]
        self.assertEqual(wi.fold_state(self.graphs, "use-case", evs), "building")

    def test_defect_fold_to_resolved(self):
        evs = [
            {"ts": "1", "event": "reported", "agent": "orchestrator"},
            {"ts": "2", "event": "triaged", "agent": "orchestrator"},
            {"ts": "3", "event": "confirmed", "agent": "engineer"},
            {"ts": "4", "event": "fixed", "agent": "engineer"},
            {"ts": "5", "event": "validated", "agent": "tester"},
        ]
        self.assertEqual(wi.fold_state(self.graphs, "defect", evs), "resolved")

    def test_defect_rework_loop(self):
        evs = [
            {"ts": "1", "event": "reported", "agent": "orchestrator"},
            {"ts": "2", "event": "triaged", "agent": "orchestrator"},
            {"ts": "3", "event": "confirmed", "agent": "engineer"},
            {"ts": "4", "event": "fixed", "agent": "engineer"},
            {"ts": "5", "event": "rejected", "agent": "tester"},  # back to fixing
        ]
        self.assertEqual(wi.fold_state(self.graphs, "defect", evs), "fixing")

    def test_initial_state_empty_events(self):
        self.assertEqual(wi.fold_state(self.graphs, "use-case", []), "registered")
        self.assertEqual(wi.fold_state(self.graphs, "defect", []), "reported")


# --------------------------------------------------------------------------- #
# append — legality
# --------------------------------------------------------------------------- #
class TestAppend(Base):
    def _run_append(self, iid, event, agent):
        ns = argparse.Namespace(project=self.project, id=iid, event=event,
                                agent=agent, ref=None, note=None, ts="2026-06-18T00:00:00Z")
        return wi.cmd_append(ns)

    def test_append_accepts_legal(self):
        self.write_item("active", "UC-X", "use-case",
                        [{"ts": "1", "event": "registered", "agent": "flow-manager"}])
        with contextlib.redirect_stdout(io.StringIO()):
            self._run_append("UC-X", "made_ready", "flow-manager")  # legal from registered
        item = wi.load_item(os.path.join(self._items("active"), "UC-X.md"))
        self.assertEqual(wi.fold_state(self.graphs, "use-case", item.events), "ready")
        self.assertEqual(len(item.events), 2)

    def test_append_rejects_illegal_transition(self):
        # built_green from `ready` is NOT legal (needs pulled -> building first)
        self.write_item("active", "UC-Y", "use-case",
                        [{"ts": "1", "event": "registered", "agent": "flow-manager"},
                         {"ts": "2", "event": "made_ready", "agent": "flow-manager"}])
        with self.assertRaises(SystemExit) as cm:
            with contextlib.redirect_stderr(io.StringIO()) as err:
                self._run_append("UC-Y", "built_green", "engineer")
        self.assertNotEqual(cm.exception.code, 0)
        self.assertIn("not a legal transition", err.getvalue())
        self.assertIn("amendment experiment", err.getvalue())

    def test_append_rejects_wrong_agent(self):
        # made_ready IS legal from registered, but only flow-manager may do it
        self.write_item("active", "UC-Z", "use-case",
                        [{"ts": "1", "event": "registered", "agent": "flow-manager"}])
        with self.assertRaises(SystemExit) as cm:
            with contextlib.redirect_stderr(io.StringIO()) as err:
                self._run_append("UC-Z", "made_ready", "engineer")
        self.assertNotEqual(cm.exception.code, 0)
        self.assertIn("not for agent", err.getvalue())

    def test_append_relocates_to_done(self):
        self.write_item("active", "UC-D", "use-case",
                        [{"ts": "1", "event": "registered", "agent": "flow-manager"},
                         {"ts": "2", "event": "made_ready", "agent": "flow-manager"},
                         {"ts": "3", "event": "pulled", "agent": "orchestrator"},
                         {"ts": "4", "event": "built_green", "agent": "engineer"}])
        with contextlib.redirect_stdout(io.StringIO()):
            self._run_append("UC-D", "validated", "tester")
        self.assertFalse(os.path.exists(os.path.join(self._items("active"), "UC-D.md")))
        self.assertTrue(os.path.exists(os.path.join(self._items("done"), "UC-D.md")))


# --------------------------------------------------------------------------- #
# queue_map projection
# --------------------------------------------------------------------------- #
class TestQueueMap(Base):
    def test_queue_map_projection(self):
        self.assertEqual(self.graphs.queue_for("registered"), "intake")
        self.assertEqual(self.graphs.queue_for("ready"), "ready")
        self.assertEqual(self.graphs.queue_for("building"), "wip")
        self.assertEqual(self.graphs.queue_for("reworking"), "rework")
        self.assertEqual(self.graphs.queue_for("blocked"), "waiting")
        self.assertIsNone(self.graphs.queue_for("done"))

    def test_project_writes_queue_membership(self):
        self.write_item("active", "UC-A", "use-case",
                        [{"ts": "1", "event": "registered", "agent": "flow-manager"}])
        self.write_item("active", "UC-B", "use-case",
                        [{"ts": "1", "event": "registered", "agent": "flow-manager"},
                         {"ts": "2", "event": "made_ready", "agent": "flow-manager"}])
        with contextlib.redirect_stdout(io.StringIO()):
            wi.cmd_project(argparse.Namespace(project=self.project))
        with open(os.path.join(self.tmp, "work", self.project, "views", "queues.json")) as f:
            q = json.load(f)
        self.assertIn("UC-A", q.get("intake", []))
        self.assertIn("UC-B", q.get("ready", []))


# --------------------------------------------------------------------------- #
# aggregate bubbling
# --------------------------------------------------------------------------- #
class TestBubble(Base):
    def _reg(self):
        return [{"ts": "1", "event": "registered", "agent": "flow-manager"}]

    def _done_uc(self):
        return [
            {"ts": "1", "event": "registered", "agent": "flow-manager"},
            {"ts": "2", "event": "made_ready", "agent": "flow-manager"},
            {"ts": "3", "event": "pulled", "agent": "orchestrator"},
            {"ts": "4", "event": "built_green", "agent": "engineer"},
            {"ts": "5", "event": "validated", "agent": "tester"},
        ]

    def test_slice_planned_when_no_child_progress(self):
        self.write_item("active", "SLC-1", "slice", self._reg())
        self.write_item("active", "UC-1", "use-case", self._reg(), parents=["SLC-1"])
        st = wi.compute_states(self.graphs, wi.load_all_items(self.project)[0])
        self.assertEqual(st["SLC-1"], "planned")

    def test_slice_in_progress_when_a_child_moved(self):
        self.write_item("active", "SLC-1", "slice", self._reg())
        self.write_item("active", "UC-1", "use-case",
                        self._reg() + [{"ts": "2", "event": "made_ready", "agent": "flow-manager"}],
                        parents=["SLC-1"])
        self.write_item("active", "UC-2", "use-case", self._reg(), parents=["SLC-1"])
        st = wi.compute_states(self.graphs, wi.load_all_items(self.project)[0])
        self.assertEqual(st["SLC-1"], "in_progress")

    def test_slice_done_when_all_children_done(self):
        self.write_item("done", "UC-1", "use-case", self._done_uc(), parents=["SLC-1"])
        self.write_item("done", "UC-2", "use-case", self._done_uc(), parents=["SLC-1"])
        self.write_item("active", "SLC-1", "slice", self._reg())
        st = wi.compute_states(self.graphs, wi.load_all_items(self.project)[0])
        self.assertEqual(st["SLC-1"], "done")

    def test_multilevel_bubble(self):
        # CHK -> SLC -> UC(done)  => CHK done
        self.write_item("done", "UC-1", "use-case", self._done_uc(), parents=["SLC-1"])
        self.write_item("active", "SLC-1", "slice", self._reg(), parents=["CHK-1"])
        self.write_item("active", "CHK-1", "chunk", self._reg())
        st = wi.compute_states(self.graphs, wi.load_all_items(self.project)[0])
        self.assertEqual(st["SLC-1"], "done")
        self.assertEqual(st["CHK-1"], "done")


# --------------------------------------------------------------------------- #
# invariants I1-I4
# --------------------------------------------------------------------------- #
class TestInvariants(Base):
    def _good_uc(self, iid, parents=None, deps=None, sub="done"):
        evs = [
            {"ts": "1", "event": "registered", "agent": "flow-manager"},
            {"ts": "2", "event": "made_ready", "agent": "flow-manager"},
            {"ts": "3", "event": "pulled", "agent": "orchestrator"},
            {"ts": "4", "event": "built_green", "agent": "engineer"},
            {"ts": "5", "event": "validated", "agent": "tester"},
        ] if sub == "done" else [
            {"ts": "1", "event": "registered", "agent": "flow-manager"},
        ]
        self.write_item(sub, iid, "use-case", evs, parents=parents, deps=deps)

    def test_clean_passes(self):
        self._good_uc("UC-1", sub="done")
        v = wi.validate_items(self.graphs, self.project)
        self.assertEqual(v, [], f"expected clean, got {v}")

    def test_I1_illegal_history(self):
        # built_green directly from registered — illegal
        self.write_item("active", "UC-BAD", "use-case",
                        [{"ts": "1", "event": "registered", "agent": "flow-manager"},
                         {"ts": "2", "event": "built_green", "agent": "engineer"}])
        v = wi.validate_items(self.graphs, self.project)
        self.assertTrue(any("(I1)" in x for x in v), v)

    def test_I1_wrong_agent_history(self):
        self.write_item("active", "UC-WA", "use-case",
                        [{"ts": "1", "event": "registered", "agent": "flow-manager"},
                         {"ts": "2", "event": "made_ready", "agent": "engineer"}])
        v = wi.validate_items(self.graphs, self.project)
        self.assertTrue(any("(I1)" in x and "not permitted" in x for x in v), v)

    def test_I2_terminal_in_active_is_flagged(self):
        # a DONE-state item physically placed in active/ => I4 (its queue is null
        # so I2 cannot trigger by construction; I4 catches the misplacement).
        self.write_item("active", "UC-MIS", "use-case",
                        [{"ts": "1", "event": "registered", "agent": "flow-manager"},
                         {"ts": "2", "event": "made_ready", "agent": "flow-manager"},
                         {"ts": "3", "event": "pulled", "agent": "orchestrator"},
                         {"ts": "4", "event": "built_green", "agent": "engineer"},
                         {"ts": "5", "event": "validated", "agent": "tester"}])
        v = wi.validate_items(self.graphs, self.project)
        self.assertTrue(any("(I4)" in x for x in v), v)

    def test_I3_dangling_parent(self):
        self._good_uc("UC-1", parents=["SLC-NOPE"], sub="done")
        v = wi.validate_items(self.graphs, self.project)
        self.assertTrue(any("(I3)" in x and "parent" in x for x in v), v)

    def test_I3_dangling_dep(self):
        self._good_uc("UC-1", deps=["UC-GHOST"], sub="done")
        v = wi.validate_items(self.graphs, self.project)
        self.assertTrue(any("(I3)" in x and "dep" in x for x in v), v)

    def test_I3_dep_cycle(self):
        self._good_uc("UC-1", deps=["UC-2"], sub="active")
        self._good_uc("UC-2", deps=["UC-1"], sub="active")
        v = wi.validate_items(self.graphs, self.project)
        self.assertTrue(any("(I3)" in x and "cycle" in x for x in v), v)

    def test_I4_duplicate_id(self):
        self._good_uc("UC-DUP", sub="active")
        self._good_uc("UC-DUP", sub="done")
        v = wi.validate_items(self.graphs, self.project)
        self.assertTrue(any("(I4)" in x for x in v), v)


# --------------------------------------------------------------------------- #
# migration
# --------------------------------------------------------------------------- #
class TestMigrate(Base):
    def _write_csv(self, rows):
        d = os.path.join(self.tmp, "work", self.project, "items")
        os.makedirs(d, exist_ok=True)
        header = "id,type,parent,children,job,value,cost,created_ts,dora_ref\n"
        with open(os.path.join(d, "items.csv"), "w", encoding="utf-8") as f:
            f.write(header)
            for r in rows:
                f.write(",".join(r) + "\n")

    def test_migrate_one_file_per_row_and_validates(self):
        rows = [
            ["REQ-1", "requirement", "", "CHK-1", "J0", "", "", "2026-06-17T00:00:00Z", "VISION"],
            ["CHK-1", "chunk", "REQ-1", "SLC-1", "J0", "", "", "2026-06-17T00:00:00Z", "CHK-DONE"],
            ["SLC-1", "slice", "CHK-1", "UC-1;UC-2", "J0", "8", "3", "2026-06-17T00:00:00Z", "SLC-DONE"],
            ["UC-1", "use-case", "SLC-1", "", "J0", "3", "0.5", "2026-06-17T00:00:00Z",
             "git:abc;DONE-pre-ledger"],
            ["UC-2", "use-case", "SLC-1", "", "J0", "4", "0.5", "2026-06-18T00:00:00Z",
             "SLC-1-BUILD"],  # not done -> ready
            ["DEF-1", "defect", "UC-1", "", "J0", "10", "1.5", "2026-06-19T00:00:00Z",
             "DEFECT-X-RESOLVED-abc;DONE"],
        ]
        self._write_csv(rows)
        with contextlib.redirect_stdout(io.StringIO()):
            wi.cmd_migrate(argparse.Namespace(project=self.project))

        # (a) exactly one file per row
        actives = [f for f in os.listdir(self._items("active")) if f.endswith(".md")]
        dones = [f for f in os.listdir(self._items("done")) if f.endswith(".md")]
        ids = {f[:-3] for f in actives + dones}
        self.assertEqual(ids, {"REQ-1", "CHK-1", "SLC-1", "UC-1", "UC-2", "DEF-1"})
        self.assertEqual(len(actives) + len(dones), 6)

        # (b) each folds to correct current state
        st = wi.compute_states(self.graphs, wi.load_all_items(self.project)[0])
        self.assertEqual(st["UC-1"], "done")
        self.assertEqual(st["UC-2"], "ready")
        self.assertEqual(st["DEF-1"], "resolved")
        self.assertEqual(st["SLC-1"], "in_progress")  # UC-1 done, UC-2 ready -> not all done
        self.assertEqual(st["CHK-1"], "in_progress")

        # (c) validate passes clean
        v = wi.validate_items(self.graphs, self.project)
        self.assertEqual(v, [], f"post-migrate validate not clean: {v}")

    def test_migrate_defect_superseded_crossref_still_resolves(self):
        # A defect whose dora_ref MENTIONS another item's "superseded" status but is
        # itself closed (ledger/DONE) must migrate to resolved, not wontfix.
        rows = [
            ["DEF-2", "defect", "", "", "J0", "10", "1.5", "2026-06-19T00:00:00Z",
             "DEFECT-Y;RESOLVED-abc;DONE;prod-validate-via-UC-SP5-superseded"],
        ]
        self._write_csv(rows)
        with contextlib.redirect_stdout(io.StringIO()):
            wi.cmd_migrate(argparse.Namespace(project=self.project))
        st = wi.compute_states(self.graphs, wi.load_all_items(self.project)[0])
        self.assertEqual(st["DEF-2"], "resolved")

    def test_migrate_childless_done_aggregate_bubbles_done(self):
        # A standalone deliverable slice with NO children but DONE in its dora_ref
        # must resolve to done (vacuous all-children-done + own closed marker),
        # not planned.
        rows = [
            ["SLC-DECOMM", "slice", "", "", "J0", "8", "2.5", "2026-07-05T00:00:00Z",
             "SLC-DECOMM-DONE-abc123"],
        ]
        self._write_csv(rows)
        with contextlib.redirect_stdout(io.StringIO()):
            wi.cmd_migrate(argparse.Namespace(project=self.project))
        st = wi.compute_states(self.graphs, wi.load_all_items(self.project)[0])
        self.assertEqual(st["SLC-DECOMM"], "done")
        v = wi.validate_items(self.graphs, self.project)
        self.assertEqual(v, [], v)

    def test_migrate_all_children_done_bubbles_slice_done(self):
        rows = [
            ["SLC-1", "slice", "", "UC-1;UC-2", "J0", "8", "3", "2026-06-17T00:00:00Z", "SLC-DONE"],
            ["UC-1", "use-case", "SLC-1", "", "J0", "3", "0.5", "2026-06-17T00:00:00Z", "DONE"],
            ["UC-2", "use-case", "SLC-1", "", "J0", "4", "0.5", "2026-06-17T00:00:00Z", "DONE"],
        ]
        self._write_csv(rows)
        with contextlib.redirect_stdout(io.StringIO()):
            wi.cmd_migrate(argparse.Namespace(project=self.project))
        st = wi.compute_states(self.graphs, wi.load_all_items(self.project)[0])
        self.assertEqual(st["SLC-1"], "done")
        # a done slice lives in active/ (aggregates stay in active; state derived);
        # validate must still be clean
        v = wi.validate_items(self.graphs, self.project)
        self.assertEqual(v, [], v)


# --------------------------------------------------------------------------- #
# Enhanced stats: time-in-state, by_owner attribution, DORA, MTTR-by-class,
# lead-time percentiles. Deterministic fixed timestamps + explicit --now.
# --------------------------------------------------------------------------- #
def _dt(day, hour=0, minute=0):
    return f"2026-06-{day:02d}T{hour:02d}:{minute:02d}:00Z"


NOW = "2026-06-30T00:00:00Z"
import datetime as _pydt
NOW_DT = _pydt.datetime(2026, 6, 30, tzinfo=_pydt.timezone.utc)


class TestStats(Base):
    def _clean_uc(self, iid):
        """A UC with well-spaced timestamps so each interval is a round number.
        registered@d10 00:00 -> ready (made_ready@d10 01:00) so 1h in registered.
        ready -> building (pulled@d10 03:00) so 2h in ready.
        building -> validating (built_green@d10 06:00) so 3h in building.
        validating -> done (validated@d10 10:00) so 4h in validating.
        gross lead time = 10h; lead_time_for_changes (built_green->validated)=4h."""
        return [
            {"ts": _dt(10, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(10, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(10, 3), "event": "pulled", "agent": "orchestrator"},
            {"ts": _dt(10, 6), "event": "built_green", "agent": "engineer"},
            {"ts": _dt(10, 10), "event": "validated", "agent": "tester"},
        ]

    def _rework_uc(self, iid):
        """A UC that gets rejected once then re-passes.
        registered@d11 00:00; ready@01:00; building@02:00; validating@04:00 (2h build);
        rejected@05:00 (1h validating) -> reworking; retried@06:00 (1h reworking)
        -> building; built_green@08:00 (2h building); validated@09:00 (1h validating).
        Recovery(validation rejection): rejected@05 -> next validated@09 = 4h."""
        return [
            {"ts": _dt(11, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(11, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(11, 2), "event": "pulled", "agent": "orchestrator"},
            {"ts": _dt(11, 4), "event": "built_green", "agent": "engineer"},
            {"ts": _dt(11, 5), "event": "rejected", "agent": "tester"},
            {"ts": _dt(11, 6), "event": "retried", "agent": "engineer"},
            {"ts": _dt(11, 8), "event": "built_green", "agent": "engineer"},
            {"ts": _dt(11, 9), "event": "validated", "agent": "tester"},
        ]

    def _stats(self, items=None):
        it = items if items is not None else wi.load_all_items(self.project)[0]
        st = wi.compute_states(self.graphs, it)
        return wi.compute_stats(self.graphs, it, st, now=NOW_DT)

    # ---- time-in-state math ----
    def test_time_in_state_exact(self):
        self.write_item("done", "UC-1", "use-case", self._clean_uc("UC-1"))
        s = self._stats()["overall"]["gross_lead_time"]
        by_state = s["by_state"]
        self.assertAlmostEqual(by_state["registered"]["total_s"], 3600, places=1)
        self.assertAlmostEqual(by_state["ready"]["total_s"], 7200, places=1)
        self.assertAlmostEqual(by_state["building"]["total_s"], 10800, places=1)
        self.assertAlmostEqual(by_state["validating"]["total_s"], 14400, places=1)
        # gross lead time = 10h = 36000s
        self.assertAlmostEqual(s["gross_lead_time_total_s"], 36000, places=1)
        self.assertAlmostEqual(s["gross_lead_time_median_s"], 36000, places=1)

    def test_in_flight_uses_now(self):
        # a UC still building since d20 06:00; now=d30 00:00 => open segment counted
        self.write_item("active", "UC-IF", "use-case", [
            {"ts": _dt(20, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(20, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(20, 3), "event": "pulled", "agent": "orchestrator"},
        ])
        s = self._stats()["overall"]["gross_lead_time"]
        # building entered d20 03:00, now d30 00:00 => 9d 21h open in `building`
        expected = (NOW_DT - _pydt.datetime(2026, 6, 20, 3, tzinfo=_pydt.timezone.utc)).total_seconds()
        self.assertAlmostEqual(s["by_state"]["building"]["total_s"], expected, places=1)

    # ---- by_owner attribution incl. queue vs external ----
    def test_by_owner_attribution(self):
        self.write_item("done", "UC-1", "use-case", self._clean_uc("UC-1"))
        by_owner = self._stats()["overall"]["gross_lead_time"]["by_owner"]
        # registered+ready => queue (1h+2h=3h=10800); building=>engineer(3h); validating=>tester(4h)
        self.assertAlmostEqual(by_owner["queue"]["total_s"], 10800, places=1)
        self.assertAlmostEqual(by_owner["engineer"]["total_s"], 10800, places=1)
        self.assertAlmostEqual(by_owner["tester"]["total_s"], 14400, places=1)
        # percentages sum to ~100
        total_pct = sum(d["pct_of_glt"] for d in by_owner.values())
        self.assertAlmostEqual(total_pct, 100.0, places=0)

    def test_by_owner_external_blocked(self):
        # a UC that gets blocked (external) then unblocked
        self.write_item("done", "UC-B", "use-case", [
            {"ts": _dt(12, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(12, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(12, 2), "event": "blocked", "agent": "flow-manager"},   # ready->blocked
            {"ts": _dt(12, 7), "event": "unblocked", "agent": "flow-manager"},  # 5h external
            {"ts": _dt(12, 8), "event": "pulled", "agent": "orchestrator"},
            {"ts": _dt(12, 9), "event": "built_green", "agent": "engineer"},
            {"ts": _dt(12, 10), "event": "validated", "agent": "tester"},
        ])
        by_owner = self._stats()["overall"]["gross_lead_time"]["by_owner"]
        self.assertAlmostEqual(by_owner["external"]["total_s"], 5 * 3600, places=1)

    # ---- CFR ----
    def test_change_failure_rate(self):
        self.write_item("done", "UC-1", "use-case", self._clean_uc("UC-1"))  # 1 validated, 0 reject
        self.write_item("done", "UC-2", "use-case", self._rework_uc("UC-2"))  # 1 reject then 1 validated
        at = self._stats()["overall"]["dora"]["all_time"]
        # exits from validating: UC-1 {validated:1}; UC-2 {rejected:1, validated:1}
        # cfr = rejected/(validated+rejected) = 1/(2+1) = 0.333...
        self.assertAlmostEqual(at["change_failure_rate"], 1 / 3, places=4)
        self.assertEqual(at["n_validations"], 3)
        self.assertEqual(at["n_validation_failures"], 1)

    def test_cfr_null_when_no_validations(self):
        self.write_item("active", "UC-R", "use-case", [
            {"ts": _dt(10, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(10, 1), "event": "made_ready", "agent": "flow-manager"},
        ])
        at = self._stats()["overall"]["dora"]["all_time"]
        self.assertIsNone(at["change_failure_rate"])

    # ---- lead-time percentiles ----
    def test_lead_time_percentiles(self):
        # three UCs with built_green->validated spans of 1h, 2h, 4h
        for i, hrs in enumerate([1, 2, 4], start=1):
            self.write_item("done", f"UC-L{i}", "use-case", [
                {"ts": _dt(10 + i, 0), "event": "registered", "agent": "flow-manager"},
                {"ts": _dt(10 + i, 1), "event": "made_ready", "agent": "flow-manager"},
                {"ts": _dt(10 + i, 2), "event": "pulled", "agent": "orchestrator"},
                {"ts": _dt(10 + i, 3), "event": "built_green", "agent": "engineer"},
                {"ts": _dt(10 + i, 3 + hrs), "event": "validated", "agent": "tester"},
            ])
        at = self._stats()["overall"]["dora"]["all_time"]
        self.assertEqual(at["lead_time_n"], 3)
        self.assertAlmostEqual(at["lead_time_for_changes_median_s"], 2 * 3600, places=1)
        # p85 of [3600,7200,14400] via linear interp: k=(3-1)*0.85=1.7 -> 7200+(14400-7200)*0.7
        self.assertAlmostEqual(at["lead_time_for_changes_p85_s"], 7200 + 7200 * 0.7, places=1)

    # ---- MTTR by class ----
    def test_mttr_by_class(self):
        # defect: reported@d15 00:00 -> validated@d15 05:00 = 5h
        self.write_item("done", "DEF-1", "defect", [
            {"ts": _dt(15, 0), "event": "reported", "agent": "orchestrator"},
            {"ts": _dt(15, 1), "event": "triaged", "agent": "orchestrator"},
            {"ts": _dt(15, 2), "event": "confirmed", "agent": "engineer"},
            {"ts": _dt(15, 3), "event": "fixed", "agent": "engineer"},
            {"ts": _dt(15, 5), "event": "validated", "agent": "tester"},
        ])
        # UC rework: validation-rejection recovery = 4h (see _rework_uc)
        self.write_item("done", "UC-2", "use-case", self._rework_uc("UC-2"))
        r = self._stats()["overall"]["recovery_by_class"]
        self.assertAlmostEqual(r["defect"]["median_s"], 5 * 3600, places=1)
        self.assertEqual(r["defect"]["n"], 1)
        self.assertAlmostEqual(r["validation_rejection"]["median_s"], 4 * 3600, places=1)
        self.assertEqual(r["validation_rejection"]["n"], 1)
        # no build_failed events => build_failure class is null/0
        self.assertIsNone(r["build_failure"]["median_s"])
        self.assertEqual(r["build_failure"]["n"], 0)

    def test_build_failure_recovery(self):
        # build_failed@d16 02:00 -> retried@d16 03:00 = 1h recovery
        self.write_item("active", "UC-BF", "use-case", [
            {"ts": _dt(16, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(16, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(16, 1, 30), "event": "pulled", "agent": "orchestrator"},
            {"ts": _dt(16, 2), "event": "build_failed", "agent": "engineer"},
            {"ts": _dt(16, 3), "event": "retried", "agent": "engineer"},
        ])
        r = self._stats()["overall"]["recovery_by_class"]
        self.assertAlmostEqual(r["build_failure"]["median_s"], 3600, places=1)
        self.assertEqual(r["build_failure"]["n"], 1)

    # ---- quality by stage ----
    def test_quality_by_stage_and_rework(self):
        self.write_item("done", "UC-1", "use-case", self._clean_uc("UC-1"))
        self.write_item("done", "UC-2", "use-case", self._rework_uc("UC-2"))
        q = self._stats()["overall"]["quality"]["all_time"]
        # validating exits: UC-1 validated; UC-2 rejected+validated => fail 1/3
        self.assertAlmostEqual(q["by_stage"]["validating"]["failure_rate"], 1 / 3, places=4)
        self.assertEqual(q["by_stage"]["validating"]["owner"], "tester")
        # rework rate: 1 of 2 items entered rework (UC-2)
        self.assertAlmostEqual(q["rework_rate"], 0.5, places=4)

    # ---- windowing ----
    def test_defect_arrival_window(self):
        # one defect reported inside 30d, one outside (d01 is >30d before d30? d30-30=May31)
        self.write_item("done", "DEF-IN", "defect", [
            {"ts": _dt(20, 0), "event": "reported", "agent": "orchestrator"},
            {"ts": _dt(20, 1), "event": "triaged", "agent": "orchestrator"},
            {"ts": _dt(20, 2), "event": "confirmed", "agent": "engineer"},
            {"ts": _dt(20, 3), "event": "fixed", "agent": "engineer"},
            {"ts": _dt(20, 4), "event": "validated", "agent": "tester"},
        ])
        self.write_item("done", "DEF-OLD", "defect", [
            {"ts": "2026-05-01T00:00:00Z", "event": "reported", "agent": "orchestrator"},
            {"ts": "2026-05-01T01:00:00Z", "event": "triaged", "agent": "orchestrator"},
            {"ts": "2026-05-01T02:00:00Z", "event": "confirmed", "agent": "engineer"},
            {"ts": "2026-05-01T03:00:00Z", "event": "fixed", "agent": "engineer"},
            {"ts": "2026-05-01T04:00:00Z", "event": "validated", "agent": "tester"},
        ])
        overall = self._stats()["overall"]
        self.assertEqual(overall["quality"]["all_time"]["defect_arrivals_in_window"], 2)
        self.assertEqual(overall["quality"]["trailing_30d"]["defect_arrivals_in_window"], 1)

    # ---- by-type slicing ----
    def test_by_type_slicing(self):
        self.write_item("done", "UC-1", "use-case", self._clean_uc("UC-1"))
        self.write_item("done", "DEF-1", "defect", [
            {"ts": _dt(15, 0), "event": "reported", "agent": "orchestrator"},
            {"ts": _dt(15, 1), "event": "triaged", "agent": "orchestrator"},
            {"ts": _dt(15, 2), "event": "confirmed", "agent": "engineer"},
            {"ts": _dt(15, 3), "event": "fixed", "agent": "engineer"},
            {"ts": _dt(15, 5), "event": "validated", "agent": "tester"},
        ])
        stats = self._stats()
        self.assertIn("use-case", stats["by_type"])
        self.assertIn("defect", stats["by_type"])
        self.assertEqual(stats["by_type"]["use-case"]["n_items"], 1)
        self.assertEqual(stats["by_type"]["defect"]["n_items"], 1)
        # defect MTTR only in the defect slice
        self.assertEqual(stats["by_type"]["defect"]["recovery_by_class"]["defect"]["n"], 1)
        self.assertEqual(stats["by_type"]["use-case"]["recovery_by_class"]["defect"]["n"], 0)

    # ---- empty / divide-by-zero safety ----
    def test_empty_project_no_crash(self):
        stats = self._stats()
        g = stats["overall"]["gross_lead_time"]
        self.assertIsNone(g["gross_lead_time_median_s"])
        self.assertEqual(g["by_state"], {})
        at = stats["overall"]["dora"]["all_time"]
        self.assertIsNone(at["change_failure_rate"])
        self.assertIsNone(at["deployment_frequency_per_active_day"])
        self.assertIsNone(at["mttr_median_s"])

    def test_stats_md_renders(self):
        self.write_item("done", "UC-1", "use-case", self._clean_uc("UC-1"))
        md = wi._render_stats_md(self._stats())
        self.assertIn("Contribution to gross lead time", md)
        self.assertIn("A. DORA four key metrics", md)
        self.assertIn("D. Recovery (MTTR) by failure class", md)


if __name__ == "__main__":
    unittest.main(verbosity=2)
