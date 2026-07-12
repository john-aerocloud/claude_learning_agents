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
        # never touch the REAL statusline.json from a test — redirect into tmp
        self._orig_statusline = wi.STATUSLINE
        wi.STATUSLINE = os.path.join(self.tmp, "process", "dora", "statusline.json")
        os.makedirs(self._items("active"), exist_ok=True)
        os.makedirs(self._items("done"), exist_ok=True)

    def tearDown(self):
        wi.ROOT = self._orig_root
        wi.STATUSLINE = self._orig_statusline
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
            {"ts": "5", "event": "deployed", "agent": "cicd"},
            {"ts": "6", "event": "validated", "agent": "tester"},
        ]
        self.assertEqual(wi.fold_state(self.graphs, "use-case", evs), "done")

    def test_use_case_fold_deploying(self):
        # v4: built_green lands in `deploying`; deployed lands in `dev-validating`
        evs = [
            {"ts": "1", "event": "registered", "agent": "flow-manager"},
            {"ts": "2", "event": "made_ready", "agent": "flow-manager"},
            {"ts": "3", "event": "pulled", "agent": "orchestrator"},
            {"ts": "4", "event": "built_green", "agent": "engineer"},
        ]
        self.assertEqual(wi.fold_state(self.graphs, "use-case", evs), "deploying")
        evs.append({"ts": "5", "event": "deployed", "agent": "cicd"})
        self.assertEqual(wi.fold_state(self.graphs, "use-case", evs), "dev-validating")

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

    # ---- v4 dev-then-prod validation fold ----
    def _base(self):
        return [
            {"ts": "1", "event": "registered", "agent": "flow-manager"},
            {"ts": "2", "event": "made_ready", "agent": "flow-manager"},
            {"ts": "3", "event": "pulled", "agent": "orchestrator"},
            {"ts": "4", "event": "built_green", "agent": "engineer"},
            {"ts": "5", "event": "deployed", "agent": "cicd"},
        ]

    def test_v4_full_cloud_path(self):
        # built_green->deploying, deployed->dev-validating, dev_validated->
        # prod-deploying, promoted->prod-validating, validated->done
        evs = self._base()
        self.assertEqual(wi.fold_state(self.graphs, "use-case", evs), "dev-validating")
        evs.append({"ts": "6", "event": "dev_validated", "agent": "tester"})
        self.assertEqual(wi.fold_state(self.graphs, "use-case", evs), "prod-deploying")
        evs.append({"ts": "7", "event": "promoted", "agent": "cicd"})
        self.assertEqual(wi.fold_state(self.graphs, "use-case", evs), "prod-validating")
        evs.append({"ts": "8", "event": "validated", "agent": "tester"})
        self.assertEqual(wi.fold_state(self.graphs, "use-case", evs), "done")

    def test_v4_local_only_collapse(self):
        # dev==prod (one env): validated straight from dev-validating -> done
        evs = self._base() + [{"ts": "6", "event": "validated", "agent": "tester"}]
        self.assertEqual(wi.fold_state(self.graphs, "use-case", evs), "done")

    def test_v4_reject_from_dev_validating(self):
        evs = self._base() + [{"ts": "6", "event": "rejected", "agent": "tester"}]
        self.assertEqual(wi.fold_state(self.graphs, "use-case", evs), "reworking")

    def test_v4_reject_from_prod_validating(self):
        evs = self._base() + [
            {"ts": "6", "event": "dev_validated", "agent": "tester"},
            {"ts": "7", "event": "promoted", "agent": "cicd"},
            {"ts": "8", "event": "rejected", "agent": "tester"},
        ]
        self.assertEqual(wi.fold_state(self.graphs, "use-case", evs), "reworking")


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
        # v3: built_green -> deploying; deploying --deployed(cicd)--> validating
        self.write_item("active", "UC-D", "use-case",
                        [{"ts": "1", "event": "registered", "agent": "flow-manager"},
                         {"ts": "2", "event": "made_ready", "agent": "flow-manager"},
                         {"ts": "3", "event": "pulled", "agent": "orchestrator"},
                         {"ts": "4", "event": "built_green", "agent": "engineer"},
                         {"ts": "5", "event": "deployed", "agent": "cicd"}])
        with contextlib.redirect_stdout(io.StringIO()):
            self._run_append("UC-D", "validated", "tester")
        self.assertFalse(os.path.exists(os.path.join(self._items("active"), "UC-D.md")))
        self.assertTrue(os.path.exists(os.path.join(self._items("done"), "UC-D.md")))

    def test_append_deployed_by_cicd(self):
        # cicd deploys a UC sitting in `deploying`; lands in dev-validating (v4)
        self.write_item("active", "UC-DP", "use-case",
                        [{"ts": "1", "event": "registered", "agent": "flow-manager"},
                         {"ts": "2", "event": "made_ready", "agent": "flow-manager"},
                         {"ts": "3", "event": "pulled", "agent": "orchestrator"},
                         {"ts": "4", "event": "built_green", "agent": "engineer"}])
        with contextlib.redirect_stdout(io.StringIO()):
            self._run_append("UC-DP", "deployed", "cicd")
        item = wi.load_item(os.path.join(self._items("active"), "UC-DP.md"))
        self.assertEqual(wi.fold_state(self.graphs, "use-case", item.events), "dev-validating")

    def test_append_deployed_wrong_agent_rejected(self):
        # only cicd may fire `deployed`
        self.write_item("active", "UC-DW", "use-case",
                        [{"ts": "1", "event": "registered", "agent": "flow-manager"},
                         {"ts": "2", "event": "made_ready", "agent": "flow-manager"},
                         {"ts": "3", "event": "pulled", "agent": "orchestrator"},
                         {"ts": "4", "event": "built_green", "agent": "engineer"}])
        with self.assertRaises(SystemExit) as cm:
            with contextlib.redirect_stderr(io.StringIO()) as err:
                self._run_append("UC-DW", "deployed", "engineer")
        self.assertNotEqual(cm.exception.code, 0)
        self.assertIn("not for agent", err.getvalue())

    # ---- v4 dev-then-prod append legs ----
    def _at_dev_validating(self, iid):
        self.write_item("active", iid, "use-case",
                        [{"ts": "1", "event": "registered", "agent": "flow-manager"},
                         {"ts": "2", "event": "made_ready", "agent": "flow-manager"},
                         {"ts": "3", "event": "pulled", "agent": "orchestrator"},
                         {"ts": "4", "event": "built_green", "agent": "engineer"},
                         {"ts": "5", "event": "deployed", "agent": "cicd"}])

    def test_v4_dev_validated_promotes(self):
        self._at_dev_validating("UC-PV")
        with contextlib.redirect_stdout(io.StringIO()):
            self._run_append("UC-PV", "dev_validated", "tester")
        item = wi.load_item(os.path.join(self._items("active"), "UC-PV.md"))
        self.assertEqual(wi.fold_state(self.graphs, "use-case", item.events), "prod-deploying")

    def test_v4_promoted_by_cicd(self):
        self._at_dev_validating("UC-PR")
        with contextlib.redirect_stdout(io.StringIO()):
            self._run_append("UC-PR", "dev_validated", "tester")
            self._run_append("UC-PR", "promoted", "cicd")
        item = wi.load_item(os.path.join(self._items("active"), "UC-PR.md"))
        self.assertEqual(wi.fold_state(self.graphs, "use-case", item.events), "prod-validating")

    def test_v4_dev_validated_wrong_agent_rejected(self):
        # cicd may NOT fire dev_validated (tester-only)
        self._at_dev_validating("UC-WA2")
        with self.assertRaises(SystemExit) as cm:
            with contextlib.redirect_stderr(io.StringIO()) as err:
                self._run_append("UC-WA2", "dev_validated", "cicd")
        self.assertNotEqual(cm.exception.code, 0)
        self.assertIn("not for agent", err.getvalue())

    def test_v4_full_prod_path_relocates_to_done(self):
        self._at_dev_validating("UC-FP")
        with contextlib.redirect_stdout(io.StringIO()):
            self._run_append("UC-FP", "dev_validated", "tester")
            self._run_append("UC-FP", "promoted", "cicd")
            self._run_append("UC-FP", "validated", "tester")
        self.assertFalse(os.path.exists(os.path.join(self._items("active"), "UC-FP.md")))
        self.assertTrue(os.path.exists(os.path.join(self._items("done"), "UC-FP.md")))


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
            {"ts": "5", "event": "deployed", "agent": "cicd"},
            {"ts": "6", "event": "validated", "agent": "tester"},
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
            {"ts": "5", "event": "deployed", "agent": "cicd"},
            {"ts": "6", "event": "validated", "agent": "tester"},
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
                         {"ts": "5", "event": "deployed", "agent": "cicd"},
                         {"ts": "6", "event": "validated", "agent": "tester"}])
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
        """A UC with well-spaced timestamps so each interval is a round number (v3).
        registered@d10 00:00 -> ready (made_ready@d10 01:00) so 1h in registered.
        ready -> building (pulled@d10 03:00) so 2h in ready.
        building -> deploying (built_green@d10 06:00) so 3h in building.
        deploying -> validating (deployed@d10 08:00) so 2h in deploying (cicd).
        validating -> done (validated@d10 12:00) so 4h in validating.
        gross lead time = 12h; lead_time_for_changes (built_green->validated)=6h."""
        return [
            {"ts": _dt(10, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(10, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(10, 3), "event": "pulled", "agent": "orchestrator"},
            {"ts": _dt(10, 6), "event": "built_green", "agent": "engineer"},
            {"ts": _dt(10, 8), "event": "deployed", "agent": "cicd"},
            {"ts": _dt(10, 12), "event": "validated", "agent": "tester"},
        ]

    def _rework_uc(self, iid):
        """A UC that gets rejected once then re-passes (v3 path via deploying).
        registered@00; ready@01; building@02; built_green@04 -> deploying;
        deployed@05 -> validating; rejected@06 -> reworking; retried@07 -> building;
        built_green@09 -> deploying; deployed@10 -> validating; validated@10 -> done.
        Recovery(validation rejection): rejected@06 -> next validated@10 = 4h."""
        return [
            {"ts": _dt(11, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(11, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(11, 2), "event": "pulled", "agent": "orchestrator"},
            {"ts": _dt(11, 4), "event": "built_green", "agent": "engineer"},
            {"ts": _dt(11, 5), "event": "deployed", "agent": "cicd"},
            {"ts": _dt(11, 6), "event": "rejected", "agent": "tester"},
            {"ts": _dt(11, 7), "event": "retried", "agent": "engineer"},
            {"ts": _dt(11, 8), "event": "built_green", "agent": "engineer"},
            {"ts": _dt(11, 9, 30), "event": "deployed", "agent": "cicd"},
            {"ts": _dt(11, 10, 0), "event": "validated", "agent": "tester"},
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
        self.assertAlmostEqual(by_state["deploying"]["total_s"], 7200, places=1)   # 2h cicd
        # v4: deployed lands in dev-validating; validated (local-only) -> done
        self.assertAlmostEqual(by_state["dev-validating"]["total_s"], 14400, places=1)
        # gross lead time = 12h = 43200s
        self.assertAlmostEqual(s["gross_lead_time_total_s"], 43200, places=1)
        self.assertAlmostEqual(s["gross_lead_time_median_s"], 43200, places=1)

    def test_deploying_attributed_to_cicd(self):
        self.write_item("done", "UC-1", "use-case", self._clean_uc("UC-1"))
        by_owner = self._stats()["overall"]["gross_lead_time"]["by_owner"]
        self.assertAlmostEqual(by_owner["cicd"]["total_s"], 7200, places=1)   # 2h deploying

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
        # queue = registered(1h)+ready(2h) = 3h = 10800; engineer = building(3h) = 10800;
        # cicd = deploying(2h) = 7200; tester = validating(4h) = 14400
        self.assertAlmostEqual(by_owner["queue"]["total_s"], 10800, places=1)
        self.assertAlmostEqual(by_owner["engineer"]["total_s"], 10800, places=1)
        self.assertAlmostEqual(by_owner["cicd"]["total_s"], 7200, places=1)
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
            {"ts": _dt(12, 10), "event": "deployed", "agent": "cicd"},
            {"ts": _dt(12, 11), "event": "validated", "agent": "tester"},
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
                {"ts": _dt(10 + i, 3, 30), "event": "deployed", "agent": "cicd"},
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
        # v4: exits are from dev-validating (local-only path). UC-1 validated;
        # UC-2 rejected+validated => fail 1/3; owner tester.
        self.assertAlmostEqual(q["by_stage"]["dev-validating"]["failure_rate"], 1 / 3, places=4)
        self.assertEqual(q["by_stage"]["dev-validating"]["owner"], "tester")
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


# --------------------------------------------------------------------------- #
# retro-debt (§F8 cadence gate) + retro-mark + statusline — reimplemented over
# item events (dora.py cutover). Deterministic --now.
# --------------------------------------------------------------------------- #
class TestRetro(Base):
    def _done_uc(self, day, parents):
        # a UC that bubbles a slice done; terminal (validated) at `day` 12:00
        return [
            {"ts": _dt(day, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(day, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(day, 2), "event": "pulled", "agent": "orchestrator"},
            {"ts": _dt(day, 3), "event": "built_green", "agent": "engineer"},
            {"ts": _dt(day, 4), "event": "deployed", "agent": "cicd"},
            {"ts": _dt(day, 12), "event": "validated", "agent": "tester"},
        ]

    def _done_defect(self, day):
        return [
            {"ts": _dt(day, 0), "event": "reported", "agent": "orchestrator"},
            {"ts": _dt(day, 1), "event": "triaged", "agent": "orchestrator"},
            {"ts": _dt(day, 2), "event": "confirmed", "agent": "engineer"},
            {"ts": _dt(day, 3), "event": "fixed", "agent": "engineer"},
            {"ts": _dt(day, 5), "event": "validated", "agent": "tester"},
        ]

    def _make_done_slice(self, slc, uc_days):
        """Write a slice with N done UC children (each terminal at its day)."""
        for i, day in enumerate(uc_days):
            self.write_item("done", f"{slc}-UC{i}", "use-case",
                            self._done_uc(day, [slc]), parents=[slc])
        self.write_item("active", slc, "slice", [
            {"ts": _dt(uc_days[0], 0), "event": "registered", "agent": "flow-manager"}])

    def _debt(self, threshold=3, now=NOW):
        g = self.graphs
        return wi.compute_retro_debt(g, self.project, threshold, wi.parse_ts(now))

    def _run(self, threshold=3, now=NOW):
        ns = argparse.Namespace(project=self.project, threshold=threshold, now=now)
        with contextlib.redirect_stdout(io.StringIO()) as out:
            try:
                wi.cmd_retro_debt(ns)
                code = 0
            except SystemExit as e:
                code = e.code
        return code, out.getvalue()

    # ---- routine batching to threshold ----
    def test_routine_below_threshold_not_due(self):
        self._make_done_slice("SLC-1", [10, 11, 12])   # bubbles done @ d12 12:00
        self._make_done_slice("SLC-2", [13, 14])        # bubbles done @ d14 12:00
        routine, incidents, due, detail, _m = self._debt(threshold=3)
        self.assertEqual(len(routine), 2)
        self.assertEqual(len(incidents), 0)
        self.assertFalse(due)

    def test_routine_at_threshold_due(self):
        self._make_done_slice("SLC-1", [10])
        self._make_done_slice("SLC-2", [11])
        self._make_done_slice("SLC-3", [12])
        routine, incidents, due, detail, _m = self._debt(threshold=3)
        self.assertEqual(len(routine), 3)
        self.assertTrue(due)
        code, _ = self._run(threshold=3)
        self.assertEqual(code, 2)

    # ---- incident fires immediately ----
    def test_incident_defect_fires_immediately(self):
        self._make_done_slice("SLC-1", [10])          # 1 routine
        self.write_item("done", "DEF-1", "defect", self._done_defect(15))
        routine, incidents, due, detail, _m = self._debt(threshold=3)
        self.assertEqual(len(routine), 1)
        self.assertEqual(len(incidents), 1)
        self.assertTrue(due)   # single incident forces due despite routine < threshold

    def test_incident_uc_rejection_fires(self):
        # a use-case with a rejected event (an incident) since the marker
        self.write_item("active", "UC-REJ", "use-case", [
            {"ts": _dt(16, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(16, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(16, 2), "event": "pulled", "agent": "orchestrator"},
            {"ts": _dt(16, 3), "event": "built_green", "agent": "engineer"},
            {"ts": _dt(16, 4), "event": "deployed", "agent": "cicd"},
            {"ts": _dt(16, 5), "event": "rejected", "agent": "tester"},
        ])
        routine, incidents, due, detail, _m = self._debt(threshold=3)
        self.assertEqual(len(incidents), 1)
        self.assertTrue(due)

    # ---- marker resets the count ----
    def test_marker_resets_count(self):
        self._make_done_slice("SLC-1", [10])
        self._make_done_slice("SLC-2", [11])
        self._make_done_slice("SLC-3", [12])   # 3 routine, would be DUE
        # set the marker to AFTER all three bubbled (d12 12:00) -> debt drains to 0
        wi.cmd_retro_mark(argparse.Namespace(project=self.project, now="2026-06-13T00:00:00Z"))
        routine, incidents, due, detail, _m = self._debt(threshold=3)
        self.assertEqual(len(routine), 0)
        self.assertFalse(due)
        code, _ = self._run(threshold=3)
        self.assertEqual(code, 0)

    def test_marker_partial_reset(self):
        self._make_done_slice("SLC-1", [10])   # done @ d10 12:00
        self._make_done_slice("SLC-2", [14])   # done @ d14 12:00
        # marker between the two -> only the later one counts
        wi.cmd_retro_mark(argparse.Namespace(project=self.project, now="2026-06-12T00:00:00Z"))
        routine, incidents, due, detail, _m = self._debt(threshold=3)
        self.assertEqual(len(routine), 1)

    # ---- retro-mark writes the marker file ----
    def test_retro_mark_writes_file(self):
        wi.cmd_retro_mark(argparse.Namespace(project=self.project, now="2026-06-20T00:00:00Z"))
        p = os.path.join(self.tmp, "process", "dora", "retro-marker", f"{self.project}.txt")
        self.assertTrue(os.path.exists(p))
        with open(p) as f:
            self.assertEqual(f.read().strip(), "2026-06-20T00:00:00Z")

    def test_retro_debt_writes_statusline(self):
        self._make_done_slice("SLC-1", [10])
        os.makedirs(os.path.join(self.tmp, "process", "dora"), exist_ok=True)
        wi.STATUSLINE = os.path.join(self.tmp, "process", "dora", "statusline.json")
        self._run(threshold=3)
        with open(wi.STATUSLINE) as f:
            d = json.load(f)
        self.assertEqual(d[f"retro_debt_{self.project}"], 1)
        self.assertIn(f"retro_due_{self.project}", d)

    def test_statusline_merge_preserves_keys(self):
        wi.STATUSLINE = os.path.join(self.tmp, "process", "dora", "statusline.json")
        os.makedirs(os.path.dirname(wi.STATUSLINE), exist_ok=True)
        with open(wi.STATUSLINE, "w") as f:
            json.dump({"cfr": 5, "par": 0.25, "keep_me": "x"}, f)
        wi.write_statusline({"retro_debt_X": 2})
        with open(wi.STATUSLINE) as f:
            d = json.load(f)
        self.assertEqual(d["cfr"], 5)        # not clobbered
        self.assertEqual(d["par"], 0.25)     # not clobbered
        self.assertEqual(d["keep_me"], "x")
        self.assertEqual(d["retro_debt_X"], 2)


class TestProjectStatusline(Base):
    def test_project_writes_dora_statusline_keys(self):
        wi.STATUSLINE = os.path.join(self.tmp, "process", "dora", "statusline.json")
        # a done UC so freq/lead compute; keep existing retro key
        os.makedirs(os.path.dirname(wi.STATUSLINE), exist_ok=True)
        with open(wi.STATUSLINE, "w") as f:
            json.dump({"retro_debt_TestProj": 7}, f)
        self.write_item("done", "UC-1", "use-case", [
            {"ts": _dt(10, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(10, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(10, 2), "event": "pulled", "agent": "orchestrator"},
            {"ts": _dt(10, 3), "event": "built_green", "agent": "engineer"},
            {"ts": _dt(10, 4), "event": "deployed", "agent": "cicd"},
            {"ts": _dt(10, 12), "event": "validated", "agent": "tester"},
        ])
        with contextlib.redirect_stdout(io.StringIO()):
            wi.cmd_project(argparse.Namespace(project=self.project, now=NOW))
        with open(wi.STATUSLINE) as f:
            d = json.load(f)
        # DORA keys the statusline consumes
        self.assertIn("cfr", d)
        self.assertIn("freq", d)
        self.assertIn("lead", d)
        self.assertEqual(d["project"], self.project)
        # merge preserved the retro key
        self.assertEqual(d["retro_debt_TestProj"], 7)


# --------------------------------------------------------------------------- #
# token cost — plumbing vs delivery (cost-split ported from dora.py, EXP-067)
# --------------------------------------------------------------------------- #
class TestTokenCost(Base):
    def _append(self, iid, event, agent, tokens=None):
        ns = argparse.Namespace(project=self.project, id=iid, event=event, agent=agent,
                                ref=None, note=None, ts="2026-06-18T00:00:00Z",
                                tokens=tokens)
        with contextlib.redirect_stdout(io.StringIO()):
            wi.cmd_append(ns)

    def _stats(self):
        it = wi.load_all_items(self.project)[0]
        st = wi.compute_states(self.graphs, it)
        return wi.compute_stats(self.graphs, it, st, now=NOW_DT)

    # ---- classification is verbatim from dora.py:cost_class ----
    def test_cost_class_plumbing_agents(self):
        # orchestrator/flow-manager => plumbing regardless of event
        self.assertEqual(wi.cost_class("orchestrator", "pulled"), "plumbing")
        self.assertEqual(wi.cost_class("flow-manager", "made_ready"), "plumbing")

    def test_cost_class_delivery_agents(self):
        # engineer/tester/cicd building/validating/deploying => delivery
        self.assertEqual(wi.cost_class("engineer", "built_green"), "delivery")
        self.assertEqual(wi.cost_class("tester", "validated"), "delivery")
        self.assertEqual(wi.cost_class("cicd", "deployed"), "delivery")

    # ---- append records --tokens on the event ----
    def test_append_records_tokens(self):
        self.write_item("active", "UC-T", "use-case",
                        [{"ts": "1", "event": "registered", "agent": "flow-manager"}])
        self._append("UC-T", "made_ready", "flow-manager", tokens=1234)
        item = wi.load_item(os.path.join(self._items("active"), "UC-T.md"))
        self.assertEqual(item.events[-1]["tokens"], 1234)

    def test_append_without_tokens_has_no_tokens_key(self):
        self.write_item("active", "UC-N", "use-case",
                        [{"ts": "1", "event": "registered", "agent": "flow-manager"}])
        self._append("UC-N", "made_ready", "flow-manager")  # no tokens
        item = wi.load_item(os.path.join(self._items("active"), "UC-N.md"))
        self.assertNotIn("tokens", item.events[-1])

    # ---- deterministic fixture: exact total / by_owner / split ----
    def _fixture_uc(self):
        # a clean UC with a known token on each event. plumbing = flow-manager +
        # orchestrator events; delivery = engineer/cicd/tester events.
        #   registered  flow-manager  1000  (plumbing)
        #   made_ready  flow-manager  2000  (plumbing)
        #   pulled      orchestrator  4000  (plumbing)
        #   built_green engineer      50000 (delivery)
        #   deployed    cicd          3000  (delivery)
        #   validated   tester        6000  (delivery)
        # total=66000; plumbing=7000; delivery=59000; share=7000/66000
        return [
            {"ts": _dt(10, 0), "event": "registered", "agent": "flow-manager", "tokens": 1000},
            {"ts": _dt(10, 1), "event": "made_ready", "agent": "flow-manager", "tokens": 2000},
            {"ts": _dt(10, 3), "event": "pulled", "agent": "orchestrator", "tokens": 4000},
            {"ts": _dt(10, 6), "event": "built_green", "agent": "engineer", "tokens": 50000},
            {"ts": _dt(10, 8), "event": "deployed", "agent": "cicd", "tokens": 3000},
            {"ts": _dt(10, 12), "event": "validated", "agent": "tester", "tokens": 6000},
        ]

    def test_total_by_owner_and_split_exact(self):
        self.write_item("done", "UC-1", "use-case", self._fixture_uc())
        tc = self._stats()["overall"]["token_cost"]
        self.assertEqual(tc["total_tokens"], 66000)
        # by_owner folds tokens through the event's agent
        self.assertEqual(tc["by_owner"]["engineer"], 50000)
        self.assertEqual(tc["by_owner"]["tester"], 6000)
        self.assertEqual(tc["by_owner"]["cicd"], 3000)
        self.assertEqual(tc["by_owner"]["flow-manager"], 3000)   # 1000+2000
        self.assertEqual(tc["by_owner"]["orchestrator"], 4000)
        # plumbing vs delivery — the EXACT split
        pvd = tc["plumbing_vs_delivery"]
        self.assertEqual(pvd["plumbing_tokens"], 7000)   # fm 3000 + orch 4000
        self.assertEqual(pvd["delivery_tokens"], 59000)  # eng 50000 + cicd 3000 + tester 6000
        self.assertAlmostEqual(pvd["plumbing_share"], 7000 / 66000, places=6)
        # full coverage: every event carried tokens
        self.assertEqual(tc["n_events_with_tokens"], 6)
        self.assertEqual(tc["token_coverage"], 1.0)

    # ---- absent tokens degrade gracefully (no crash, zero/empty) ----
    def test_absent_tokens_zero_and_no_crash(self):
        # the standard clean UC carries NO tokens
        self.write_item("done", "UC-1", "use-case",
                        TestStats._clean_uc(self, "UC-1"))
        tc = self._stats()["overall"]["token_cost"]
        self.assertEqual(tc["total_tokens"], 0)
        self.assertEqual(tc["by_owner"], {})
        self.assertEqual(tc["plumbing_vs_delivery"]["plumbing_tokens"], 0)
        self.assertEqual(tc["plumbing_vs_delivery"]["delivery_tokens"], 0)
        self.assertIsNone(tc["plumbing_vs_delivery"]["plumbing_share"])
        self.assertEqual(tc["token_coverage"], 0.0)

    def test_partial_coverage(self):
        # only some events carry tokens => coverage is a fraction, split over present
        evs = TestStats._clean_uc(self, "UC-1")
        evs[3]["tokens"] = 50000   # built_green (engineer, delivery)
        evs[2]["tokens"] = 4000    # pulled (orchestrator, plumbing)
        self.write_item("done", "UC-1", "use-case", evs)
        tc = self._stats()["overall"]["token_cost"]
        self.assertEqual(tc["total_tokens"], 54000)
        self.assertEqual(tc["plumbing_vs_delivery"]["plumbing_tokens"], 4000)
        self.assertEqual(tc["plumbing_vs_delivery"]["delivery_tokens"], 50000)
        self.assertEqual(tc["n_events_with_tokens"], 2)
        self.assertAlmostEqual(tc["token_coverage"], 2 / 6, places=6)

    def test_stats_md_renders_token_section(self):
        self.write_item("done", "UC-1", "use-case", self._fixture_uc())
        md = wi._render_stats_md(self._stats())
        self.assertIn("E. Token cost — plumbing vs delivery", md)
        self.assertIn("plumbing", md)

    def test_stats_md_token_section_empty_no_crash(self):
        self.write_item("done", "UC-1", "use-case",
                        TestStats._clean_uc(self, "UC-1"))
        md = wi._render_stats_md(self._stats())
        self.assertIn("E. Token cost — plumbing vs delivery", md)
        self.assertIn("No event tokens recorded", md)


# --------------------------------------------------------------------------- #
# Per-item metrics — the single-item projection of the flow/DORA quantities.
# Deterministic fixed timestamps + explicit --now. Full v4 prod path.
# --------------------------------------------------------------------------- #
class TestPerItemMetrics(Base):
    def _full_prod_uc(self):
        """A UC walked the full v4 cloud path with round-number intervals:
        registered@d10 00:00 -> ready (made_ready@01:00)     1h registered
        ready -> building (pulled@03:00)                      2h ready
        building -> deploying (built_green@06:00)             3h building
        deploying -> dev-validating (deployed@08:00)          2h deploying   (cicd)
        dev-validating -> prod-deploying (dev_validated@12:00) 4h dev-validating (tester)
        prod-deploying -> prod-validating (promoted@13:00)    1h prod-deploying (cicd)
        prod-validating -> done (validated@16:00)             3h prod-validating (tester)
        gross lead time = 16h = 57600s; cycle (pulled->done) = 13h = 46800s.
        tokens: built_green engineer 50000 (delivery), pulled orch 4000 (plumbing)."""
        return [
            {"ts": _dt(10, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(10, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(10, 3), "event": "pulled", "agent": "orchestrator", "tokens": 4000},
            {"ts": _dt(10, 6), "event": "built_green", "agent": "engineer", "tokens": 50000},
            {"ts": _dt(10, 8), "event": "deployed", "agent": "cicd"},
            {"ts": _dt(10, 12), "event": "dev_validated", "agent": "tester"},
            {"ts": _dt(10, 13), "event": "promoted", "agent": "cicd"},
            {"ts": _dt(10, 16), "event": "validated", "agent": "tester"},
        ]

    def _metrics(self, iid):
        it = wi.load_all_items(self.project)[0][iid]
        return wi.per_item_metrics(self.graphs, it, NOW_DT)

    def test_gross_lead_time_and_cycle_exact(self):
        self.write_item("done", "UC-1", "use-case", self._full_prod_uc())
        m = self._metrics("UC-1")
        self.assertEqual(m["state"], "done")
        self.assertAlmostEqual(m["gross_lead_time_s"], 57600, places=1)
        self.assertAlmostEqual(m["cycle_time_s"], 46800, places=1)
        self.assertEqual(m["rework_count"], 0)

    def test_time_in_each_state_exact(self):
        self.write_item("done", "UC-1", "use-case", self._full_prod_uc())
        tis = self._metrics("UC-1")["time_in_state"]
        self.assertAlmostEqual(tis["registered"], 3600, places=1)
        self.assertAlmostEqual(tis["ready"], 7200, places=1)
        self.assertAlmostEqual(tis["building"], 10800, places=1)
        self.assertAlmostEqual(tis["deploying"], 7200, places=1)
        self.assertAlmostEqual(tis["dev-validating"], 14400, places=1)
        self.assertAlmostEqual(tis["prod-deploying"], 3600, places=1)
        self.assertAlmostEqual(tis["prod-validating"], 10800, places=1)
        # time-in-state sums to gross lead time
        self.assertAlmostEqual(sum(tis.values()), 57600, places=1)

    def test_time_by_owner(self):
        self.write_item("done", "UC-1", "use-case", self._full_prod_uc())
        tbo = self._metrics("UC-1")["time_by_owner"]
        # queue = registered(1h)+ready(2h) = 3h; engineer = building(3h) = 3h;
        # cicd = deploying(2h)+prod-deploying(1h) = 3h;
        # tester = dev-validating(4h)+prod-validating(3h) = 7h
        self.assertAlmostEqual(tbo["queue"], 10800, places=1)
        self.assertAlmostEqual(tbo["engineer"], 10800, places=1)
        self.assertAlmostEqual(tbo["cicd"], 10800, places=1)
        self.assertAlmostEqual(tbo["tester"], 25200, places=1)

    def test_tokens_split(self):
        self.write_item("done", "UC-1", "use-case", self._full_prod_uc())
        tok = self._metrics("UC-1")["tokens"]
        self.assertEqual(tok["total"], 54000)
        self.assertEqual(tok["plumbing"], 4000)   # orchestrator pulled
        self.assertEqual(tok["delivery"], 50000)  # engineer built_green

    def test_rework_count_and_recovery(self):
        # a UC rejected once at dev-validating then re-passes (recovery = rejected
        # @d11 06:00 -> next validated @d11 10:00 = 4h). rework_count counts the
        # rejected + retried entries = 2.
        self.write_item("done", "UC-2", "use-case", [
            {"ts": _dt(11, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(11, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(11, 2), "event": "pulled", "agent": "orchestrator"},
            {"ts": _dt(11, 4), "event": "built_green", "agent": "engineer"},
            {"ts": _dt(11, 5), "event": "deployed", "agent": "cicd"},
            {"ts": _dt(11, 6), "event": "rejected", "agent": "tester"},
            {"ts": _dt(11, 7), "event": "retried", "agent": "engineer"},
            {"ts": _dt(11, 8), "event": "built_green", "agent": "engineer"},
            {"ts": _dt(11, 9), "event": "deployed", "agent": "cicd"},
            {"ts": _dt(11, 10), "event": "validated", "agent": "tester"},
        ])
        m = self._metrics("UC-2")
        self.assertEqual(m["rework_count"], 2)   # rejected + retried
        self.assertEqual(m["recovery"]["n"], 1)
        self.assertAlmostEqual(m["recovery"]["mttr_median_s"], 4 * 3600, places=1)

    def test_in_flight_uses_now(self):
        # a UC still in dev-validating since d20 08:00; now=d30 -> open segment
        self.write_item("active", "UC-IF", "use-case", [
            {"ts": _dt(20, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(20, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(20, 3), "event": "pulled", "agent": "orchestrator"},
            {"ts": _dt(20, 6), "event": "built_green", "agent": "engineer"},
            {"ts": _dt(20, 8), "event": "deployed", "agent": "cicd"},
        ])
        m = self._metrics("UC-IF")
        self.assertEqual(m["state"], "dev-validating")
        self.assertIsNone(m["gross_lead_time_s"])   # not terminal
        self.assertIsNone(m["cycle_time_s"])
        expected = (NOW_DT - _pydt.datetime(2026, 6, 20, 8, tzinfo=_pydt.timezone.utc)).total_seconds()
        self.assertAlmostEqual(m["time_in_state"]["dev-validating"], expected, places=1)

    def test_aggregate_has_no_per_item_metrics(self):
        self.write_item("active", "SLC-1", "slice",
                        [{"ts": "1", "event": "registered", "agent": "flow-manager"}])
        it = wi.load_all_items(self.project)[0]["SLC-1"]
        self.assertIsNone(wi.per_item_metrics(self.graphs, it, NOW_DT))

    def test_metrics_rendered_into_derived_block(self):
        self.write_item("done", "UC-1", "use-case", self._full_prod_uc())
        with contextlib.redirect_stdout(io.StringIO()):
            wi.cmd_project(argparse.Namespace(project=self.project, now=NOW, item=None))
        text = open(os.path.join(self._items("done"), "UC-1.md")).read()
        self.assertIn("metrics:", text)
        self.assertIn("gross_lead_time_s: 57600", text)
        self.assertIn("cycle_time_s: 46800", text)
        # the metrics sub-block is discarded on re-parse (it lives under derived:)
        item = wi.load_item(os.path.join(self._items("done"), "UC-1.md"))
        self.assertNotIn("metrics", item.fm)

    def test_project_item_prints_metrics(self):
        self.write_item("done", "UC-1", "use-case", self._full_prod_uc())
        with contextlib.redirect_stdout(io.StringIO()) as out:
            wi.cmd_project(argparse.Namespace(project=self.project, now=NOW, item="UC-1"))
        s = out.getvalue()
        self.assertIn("Per-item metrics: UC-1", s)
        self.assertIn("gross lead time", s)
        self.assertIn("57600", s)

    def test_project_item_unknown_id_errors(self):
        with self.assertRaises(SystemExit):
            wi.cmd_project(argparse.Namespace(project=self.project, now=NOW, item="UC-NOPE"))


class NoteRoundTrip(unittest.TestCase):
    """Regression: event `note` values containing commas and/or quotes must survive
    parse+render round-trips without truncation or compounding backslash-escapes.

    Guards the quote-aware `_split_top_commas` + `_unescape_dq`/`_q` fix. Before it,
    a comma inside a quoted note split the inline map (truncating the note at the
    first comma) and each `wi-project`/`wi-append` re-render doubled the backslashes
    on any escaped quote — silently corrupting the audit trail, worse every cycle.
    """

    def test_split_top_commas_keeps_quoted_comma_note_whole(self):
        parts = wi._split_top_commas('event: deployed, note: "a, b, c"')
        self.assertEqual(parts[0].strip(), "event: deployed")
        self.assertEqual(parts[1].strip(), 'note: "a, b, c"')

    def test_inline_map_note_with_commas_not_truncated(self):
        d = wi._parse_inline_map('{event: deployed, agent: cicd, note: "local dev==prod, 47 tests, served"}')
        self.assertEqual(d["note"], "local dev==prod, 47 tests, served")
        self.assertEqual(d["agent"], "cicd")

    def test_scalar_unescapes_embedded_quotes(self):
        self.assertEqual(wi._parse_scalar(r'"say \"hi\" now"'), 'say "hi" now')

    def test_render_parse_roundtrip_is_idempotent(self):
        original = 'local dev==prod: green build, "quoted", 47 tests'
        once = wi._q(original)
        self.assertEqual(wi._parse_scalar(once), original)
        # a second render/parse cycle must be byte-identical — no compounding escapes
        twice = wi._q(wi._parse_scalar(once))
        self.assertEqual(twice, once)
        self.assertEqual(wi._parse_scalar(twice), original)

    def test_event_note_survives_two_render_cycles(self):
        ev = {"ts": "2026-07-11T00:00:00Z", "event": "deployed", "agent": "cicd",
              "note": "local dev==prod: green build, 47 tests, served via preview"}
        r1 = wi._render_event(ev)
        p1 = wi._parse_inline_map(r1)
        self.assertEqual(p1["note"], ev["note"])
        r2 = wi._render_event(p1)
        self.assertEqual(r2, r1)  # idempotent
        self.assertEqual(wi._parse_inline_map(r2)["note"], ev["note"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
