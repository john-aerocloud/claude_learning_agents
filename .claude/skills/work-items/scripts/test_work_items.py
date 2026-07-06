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


if __name__ == "__main__":
    unittest.main(verbosity=2)
