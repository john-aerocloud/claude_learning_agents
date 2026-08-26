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
import subprocess
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
                   title="t", body="\n## Definition\nstub\n", extra_fm=None):
        fm = {"id": iid, "type": itype, "title": title,
              "job": "J0", "value": 1, "cost": 0.5,
              "parents": parents or [], "deps": deps or [],
              "created_ts": "2026-06-17T00:00:00Z", "events": events}
        # extra scalar frontmatter (e.g. v135 `defer_until:`) rides the
        # future-proof extra-fields path in render_item
        fm.update(extra_fm or {})
        item = wi.Item(os.path.join(self._items(sub), f"{iid}.md"), fm, body)
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

    def test_use_case_fold_cancelled(self):
        # [v87] a UC cancelled from a working state folds to the terminal `cancelled`
        evs = [
            {"ts": "1", "event": "registered", "agent": "flow-manager"},
            {"ts": "2", "event": "made_ready", "agent": "flow-manager"},
            {"ts": "3", "event": "cancelled", "agent": "orchestrator"},
        ]
        self.assertEqual(wi.fold_state(self.graphs, "use-case", evs), "cancelled")
        self.assertIn("cancelled", self.graphs.terminals("use-case"))

    def test_use_case_fold_deploy_failed(self):
        # [v87] deploy_failed from `deploying` lands in reworking
        evs = [
            {"ts": "1", "event": "registered", "agent": "flow-manager"},
            {"ts": "2", "event": "made_ready", "agent": "flow-manager"},
            {"ts": "3", "event": "pulled", "agent": "orchestrator"},
            {"ts": "4", "event": "built_green", "agent": "engineer"},
            {"ts": "5", "event": "deploy_failed", "agent": "cicd"},
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

    @unittest.skipUnless(shutil.which("git"), "git not on PATH")
    def test_relocation_to_done_is_staged_in_git_not_left_untracked(self):
        # Hygiene regression: when a completed item moves active/ -> done/, the
        # machinery must record the rename in the project's git repo so the new
        # done/<ID>.md is never left UNTRACKED for a later targeted `git add` to
        # miss (recurred on UC-ADIX-009, UC-ADIX-010).
        repo = os.path.join(self.tmp, "work", self.project)
        os.makedirs(repo, exist_ok=True)
        for args in (["init", "-q"], ["config", "user.email", "t@t"], ["config", "user.name", "t"]):
            subprocess.run(["git", "-C", repo, *args], check=True)
        self.write_item("active", "UC-GIT", "use-case",
                        [{"ts": "1", "event": "registered", "agent": "flow-manager"},
                         {"ts": "2", "event": "made_ready", "agent": "flow-manager"},
                         {"ts": "3", "event": "pulled", "agent": "orchestrator"},
                         {"ts": "4", "event": "built_green", "agent": "engineer"},
                         {"ts": "5", "event": "deployed", "agent": "cicd"}])
        subprocess.run(["git", "-C", repo, "add", "-A"], check=True)
        subprocess.run(["git", "-C", repo, "commit", "-qm", "active item"], check=True)
        with contextlib.redirect_stdout(io.StringIO()):
            self._run_append("UC-GIT", "validated", "tester")
        # physically moved to done/
        self.assertTrue(os.path.exists(os.path.join(self._items("done"), "UC-GIT.md")))
        # the new done/ path is STAGED (in the index vs HEAD), not untracked
        staged = subprocess.run(["git", "-C", repo, "diff", "--cached", "--name-only"],
                                capture_output=True, text=True, check=True).stdout
        self.assertIn("items/done/UC-GIT.md", staged)
        # nothing about the item is left dangling untracked
        porcelain = subprocess.run(["git", "-C", repo, "status", "--porcelain"],
                                   capture_output=True, text=True, check=True).stdout
        self.assertNotIn("??", porcelain)

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
# The `amended` self-edge invariant (CONTRACT.md §2, state-graph v7/v8).
#
# CONTRACT.md already ASSERTS it — "Every non-terminal flow state has an
# `amended` self-edge" — but v7 delivered it on two of the THREE flow graphs;
# `open-item` was missed. Consequence observed 2026-08-01: the flow-manager could
# not record a legitimate scope-narrowing on the open-item OI-CHUNKS-STALE-REF
# and (correctly) refused to hand-work-around the graph. So the invariant is
# asserted GENERICALLY here, across every flow type and every reachable
# non-terminal state, so a future type cannot reintroduce the gap.
# --------------------------------------------------------------------------- #
class TestAmendedSelfEdge(Base):
    AMEND_AGENTS = ["solution-architect", "product", "flow-manager", "orchestrator"]

    def _states(self, itype):
        """Every non-terminal state reachable in `itype`'s graph."""
        g = self.graphs
        trans = g.transitions(itype)
        terminal = set(g.terminals(itype))
        seen = {g.initial(itype)}
        for t in trans:
            seen.add(t["from"])
            seen.add(t["to"])
        return sorted(s for s in seen if s not in terminal)

    def test_every_flow_type_has_amended_on_every_nonterminal_state(self):
        flow_types = [t for t in self.graphs.types if self.graphs.kind(t) == "flow"]
        self.assertIn("open-item", flow_types)
        for itype in flow_types:
            edges = {t["from"] for t in self.graphs.transitions(itype)
                     if t["event"] == "amended" and t["to"] == t["from"]}
            for state in self._states(itype):
                self.assertIn(state, edges,
                              f"{itype}/{state} has no `amended` self-edge")

    def test_amend_agents_are_uniform(self):
        for itype in [t for t in self.graphs.types
                      if self.graphs.kind(t) == "flow"]:
            for t in self.graphs.transitions(itype):
                if t["event"] == "amended":
                    self.assertEqual(sorted(t["agents"]),
                                     sorted(self.AMEND_AGENTS), f"{itype}/{t}")

    def test_open_item_can_record_an_amendment(self):
        """The founding case, end to end through the real writer: an open item is
        amended and STAYS in its state, with the reason on the event."""
        self.write_item("active", "OI-X", "open-item",
                        [{"ts": "2026-06-10T00:00:00Z", "event": "open",
                          "agent": "orchestrator"}])
        with contextlib.redirect_stdout(io.StringIO()):
            wi.cmd_append(argparse.Namespace(
                project=self.project, id="OI-X", event="amended",
                agent="flow-manager", note="scope narrowed", ref=None,
                ts="2026-06-11T00:00:00Z", tokens=None, duration_ms=None))
        items, _ = wi.load_all_items(self.project)
        st = wi.compute_states(self.graphs, items)
        self.assertEqual(st["OI-X"], "open")          # self-edge: state unchanged
        self.assertEqual(items["OI-X"].events[-1]["event"], "amended")
        self.assertEqual(items["OI-X"].events[-1]["note"], "scope narrowed")

    def test_amend_a_scheduled_open_item(self):
        self.write_item("active", "OI-S", "open-item",
                        [{"ts": "2026-06-10T00:00:00Z", "event": "open",
                          "agent": "orchestrator"},
                         {"ts": "2026-06-10T01:00:00Z", "event": "scheduled",
                          "agent": "flow-manager"}])
        with contextlib.redirect_stdout(io.StringIO()):
            wi.cmd_append(argparse.Namespace(
                project=self.project, id="OI-S", event="amended",
                agent="product", note="narrowed", ref=None,
                ts="2026-06-11T00:00:00Z", tokens=None, duration_ms=None))
        items, _ = wi.load_all_items(self.project)
        self.assertEqual(wi.compute_states(self.graphs, items)["OI-S"], "scheduled")

    def test_open_item_amend_is_time_preserving(self):
        """The self-edge must not distort dwell: an amend closes and reopens the
        same state, so `open` is still one contiguous 2-day stretch."""
        evs = [{"ts": "2026-06-10T00:00:00Z", "event": "open",
                "agent": "orchestrator"},
               {"ts": "2026-06-11T00:00:00Z", "event": "amended",
                "agent": "flow-manager"}]
        self.write_item("active", "OI-T", "open-item", evs)
        items, _ = wi.load_all_items(self.project)
        segs = wi.walk_states(self.graphs, items["OI-T"],
                              wi.parse_ts("2026-06-12T00:00:00Z"))
        self.assertEqual({s for s, _e, _x in segs}, {"open"})
        total = sum((x - e).total_seconds() for _s, e, x in segs)
        self.assertEqual(total, 2 * 86400)


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

    def _cancelled_uc(self):
        return [
            {"ts": "1", "event": "registered", "agent": "flow-manager"},
            {"ts": "2", "event": "cancelled", "agent": "orchestrator"},
        ]

    def test_bubble_mixed_done_cancelled_is_done(self):
        # [v87] a cancelled child does NOT block completion; one real done => slice done
        self.write_item("done", "UC-1", "use-case", self._done_uc(), parents=["SLC-1"])
        self.write_item("done", "UC-2", "use-case", self._cancelled_uc(), parents=["SLC-1"])
        self.write_item("active", "SLC-1", "slice", self._reg())
        st = wi.compute_states(self.graphs, wi.load_all_items(self.project)[0])
        self.assertEqual(st["SLC-1"], "done")

    def test_bubble_all_cancelled_is_cancelled(self):
        # [v87] every child cancelled => the aggregate itself is cancelled (not done)
        self.write_item("done", "UC-1", "use-case", self._cancelled_uc(), parents=["SLC-1"])
        self.write_item("done", "UC-2", "use-case", self._cancelled_uc(), parents=["SLC-1"])
        self.write_item("active", "SLC-1", "slice", self._reg())
        st = wi.compute_states(self.graphs, wi.load_all_items(self.project)[0])
        self.assertEqual(st["SLC-1"], "cancelled")


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

    # ---- v132: backfill interpolation is held APART from measured dwell ----
    def _backfilled_uc(self):
        """A MIGRATED item: its timestamps were synthesised by spreading a span
        evenly across its transitions, so every state segment is exactly 2h. Real
        work never produces >=3 consecutive identical segments."""
        return [
            {"ts": _dt(12, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(12, 2), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(12, 4), "event": "pulled", "agent": "orchestrator"},
            {"ts": _dt(12, 6), "event": "built_green", "agent": "engineer"},
            {"ts": _dt(12, 8), "event": "deployed", "agent": "cicd"},
            {"ts": _dt(12, 10), "event": "validated", "agent": "tester"},
        ]

    def test_interpolated_dwell_excluded_from_measured_totals(self):
        """The whole point: a backfilled item must not move the time-thief
        ranking. Its dwell is reported in its own column, never pooled."""
        self.write_item("done", "UC-1", "use-case", self._clean_uc("UC-1"))
        self.write_item("done", "UC-BF", "use-case", self._backfilled_uc())
        s = self._stats()["overall"]["gross_lead_time"]
        by_state = s["by_state"]
        # measured totals are IDENTICAL to the clean-item-only case
        self.assertAlmostEqual(by_state["registered"]["total_s"], 3600, places=1)
        self.assertAlmostEqual(by_state["building"]["total_s"], 10800, places=1)
        self.assertAlmostEqual(s["gross_lead_time_total_s"], 43200, places=1)
        # the interpolated 2h-per-state shows up only as backfill
        self.assertAlmostEqual(by_state["registered"]["backfill_s"], 7200, places=1)
        self.assertAlmostEqual(by_state["building"]["backfill_s"], 7200, places=1)
        # and a backfilled item is not counted as a completed measurement
        self.assertEqual(s["n_completed_items"], 1)

    def test_backfill_share_and_counts_reported(self):
        self.write_item("done", "UC-1", "use-case", self._clean_uc("UC-1"))
        self.write_item("done", "UC-BF", "use-case", self._backfilled_uc())
        s = self._stats()["overall"]["gross_lead_time"]
        self.assertEqual(s["n_backfill_items"], 1)
        self.assertEqual(s["n_measured_items"], 1)
        # 5 states x 2h = 36000s interpolated vs 43200s measured
        self.assertAlmostEqual(s["backfill_total_s"], 36000, places=1)
        self.assertAlmostEqual(s["backfill_share_of_reported_pct"],
                               100 * 36000 / (36000 + 43200), places=1)
        # per-state share is visible so a constraint call can be refused
        self.assertAlmostEqual(
            s["by_state"]["registered"]["backfill_pct_of_state"],
            100 * 7200 / (7200 + 3600), places=1)

    def test_two_equal_segments_is_not_interpolation(self):
        """Guard against false positives: agreeing twice is coincidence, and
        wrongly excluding real dwell would be worse than pooling it."""
        self.assertFalse(wi._is_interpolated([3600, 3600]))
        self.assertFalse(wi._is_interpolated([3600, 3600, 7200]))
        self.assertTrue(wi._is_interpolated([3600, 3600, 3600]))
        # zero-length segments must not make an item look uniform
        self.assertFalse(wi._is_interpolated([0, 0, 0, 5]))

    def test_median_per_item_dwell_is_count_independent(self):
        """v128 routed this and it never landed; it is the number that tells
        'work waits longer' from 'there is more work'. Adding items at the SAME
        dwell must move the share but NOT the median."""
        self.write_item("done", "UC-1", "use-case", self._clean_uc("UC-1"))
        one = self._stats()["overall"]["gross_lead_time"]["by_state"]["registered"]
        self.assertAlmostEqual(one["median_per_item_s"], 3600, places=1)
        self.assertEqual(one["n_items"], 1)
        for n in (2, 3, 4):
            self.write_item("done", f"UC-{n}", "use-case", self._clean_uc(f"UC-{n}"))
        many = self._stats()["overall"]["gross_lead_time"]["by_state"]["registered"]
        self.assertAlmostEqual(many["total_s"], 4 * 3600, places=1)   # share grew
        self.assertAlmostEqual(many["median_per_item_s"], 3600, places=1)  # median did not
        self.assertEqual(many["n_items"], 4)

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

    def test_cfr_counts_deploy_failed(self):
        # [v87] a deploy_failed (deploy/CI failure) is a CHANGE FAILURE — the fix for
        # CFR reading a false 0% when a fixed-forward deploy failure left no event.
        deploy_failed_uc = [
            {"ts": _dt(12, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(12, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(12, 2), "event": "pulled", "agent": "orchestrator"},
            {"ts": _dt(12, 4), "event": "built_green", "agent": "engineer"},
            {"ts": _dt(12, 5), "event": "deploy_failed", "agent": "cicd"},   # CI red
            {"ts": _dt(12, 6), "event": "retried", "agent": "engineer"},
            {"ts": _dt(12, 8), "event": "built_green", "agent": "engineer"},
            {"ts": _dt(12, 9), "event": "deployed", "agent": "cicd"},
            {"ts": _dt(12, 10), "event": "validated", "agent": "tester"},
        ]
        self.write_item("done", "UC-DF", "use-case", deploy_failed_uc)
        at = self._stats()["overall"]["dora"]["all_time"]
        # 1 deploy_failed + 1 validated => cfr = 1/(1+1) = 0.5 (was 0 before v87)
        self.assertAlmostEqual(at["change_failure_rate"], 0.5, places=4)
        self.assertEqual(at["n_deploy_failures"], 1)
        self.assertGreater(at["change_failure_rate"], 0)

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

    # ---- IMP-019 (v101): a use-case dev-validation reject is ROUTINE, not an
    #      immediate incident (a dev reject fixed + re-validated is the process
    #      WORKING — it BATCHES to the threshold, it does not trip immediately). ----
    def test_uc_rejection_is_routine_not_immediate_incident(self):
        # a use-case with a rejected event since the marker -> ROUTINE, not incident
        self.write_item("active", "UC-REJ", "use-case", [
            {"ts": _dt(16, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(16, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(16, 2), "event": "pulled", "agent": "orchestrator"},
            {"ts": _dt(16, 3), "event": "built_green", "agent": "engineer"},
            {"ts": _dt(16, 4), "event": "deployed", "agent": "cicd"},
            {"ts": _dt(16, 5), "event": "rejected", "agent": "tester"},
        ])
        routine, incidents, due, detail, _m = self._debt(threshold=3)
        self.assertEqual(len(incidents), 0)          # NOT an immediate incident
        self.assertEqual(len(routine), 1)            # batches as routine
        self.assertFalse(due)                        # below threshold -> not due
        self.assertIn("uc-rework", [d[1] for d in detail])

    def test_uc_reject_then_validated_is_routine(self):
        # the founding UC-ADIX-019 shape: rejected (dev-catch) -> fixed -> validated,
        # all within the same slice. The reject is the process WORKING, so it batches
        # as ROUTINE, it does NOT trip an immediate retro.
        self.write_item("done", "UC-REVAL", "use-case", [
            {"ts": _dt(16, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(16, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(16, 2), "event": "pulled", "agent": "orchestrator"},
            {"ts": _dt(16, 3), "event": "built_green", "agent": "engineer"},
            {"ts": _dt(16, 4), "event": "deployed", "agent": "cicd"},
            {"ts": _dt(16, 5), "event": "rejected", "agent": "tester"},
            {"ts": _dt(16, 6), "event": "built_green", "agent": "engineer"},
            {"ts": _dt(16, 7), "event": "deployed", "agent": "cicd"},
            {"ts": _dt(16, 12), "event": "validated", "agent": "tester"},
        ])
        routine, incidents, due, detail, _m = self._debt(threshold=3)
        self.assertEqual(len(incidents), 0)          # dev-catch is not an incident
        self.assertEqual(len(routine), 1)            # counted once (uc-rework)
        self.assertFalse(due)                        # below threshold -> batches

    def test_uc_rework_batches_to_threshold(self):
        # accumulated dev-rework still triggers a BATCHED retro at the threshold
        for i in range(3):
            self.write_item("active", f"UC-RW{i}", "use-case", [
                {"ts": _dt(16, 0), "event": "registered", "agent": "flow-manager"},
                {"ts": _dt(16, 1), "event": "made_ready", "agent": "flow-manager"},
                {"ts": _dt(16, 2), "event": "pulled", "agent": "orchestrator"},
                {"ts": _dt(16, 3), "event": "built_green", "agent": "engineer"},
                {"ts": _dt(16, 4), "event": "deployed", "agent": "cicd"},
                {"ts": _dt(16, 5), "event": "rejected", "agent": "tester"},
            ])
        routine, incidents, due, detail, _m = self._debt(threshold=3)
        self.assertEqual(len(incidents), 0)
        self.assertEqual(len(routine), 3)
        self.assertTrue(due)                         # threshold reached -> batched retro

    def test_uc_build_failed_is_routine_not_immediate_incident(self):
        self.write_item("active", "UC-BF", "use-case", [
            {"ts": _dt(16, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(16, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(16, 2), "event": "pulled", "agent": "orchestrator"},
            {"ts": _dt(16, 3), "event": "build_failed", "agent": "engineer"},
        ])
        routine, incidents, due, detail, _m = self._debt(threshold=3)
        self.assertEqual(len(incidents), 0)
        self.assertEqual(len(routine), 1)
        self.assertFalse(due)

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

    # ---- retro-mark records the boundary — in the PROJECT substrate ----------
    # AC-PCM.1. This test used to assert the marker was written to the TRACKED
    # path process/dora/retro-marker/<project>.txt. Repointing it to the new
    # store WITHOUT a red step would have converted the whole change into a false
    # green (delta-075 §9), so it is split: the positive assertion moves to the
    # new store, and the negative — the old path is NOT written — is asserted
    # here as well as in TestRetroLogStore's fitness function.
    def test_retro_mark_records_the_boundary_in_the_project_substrate(self):
        wi.cmd_retro_mark(argparse.Namespace(project=self.project, now="2026-06-20T00:00:00Z"))
        p = os.path.join(self.tmp, "work", self.project, "items", "retro-log.md")
        self.assertTrue(os.path.exists(p))
        self.assertEqual(wi._read_retro_marker(self.project),
                         wi.parse_ts("2026-06-20T00:00:00Z"))

    def test_retro_mark_does_not_write_the_frozen_parent_repo_marker(self):
        legacy = os.path.join(self.tmp, "process", "dora", "retro-marker",
                              f"{self.project}.txt")
        wi.cmd_retro_mark(argparse.Namespace(project=self.project, now="2026-06-20T00:00:00Z"))
        self.assertFalse(os.path.exists(legacy),
                         "a documented read/close still writes a tracked parent file")

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


class TestPartsCheck(Base):
    """v136 / EXP-132 — the cheap per-close constraint read.

    The property under test is NOT "it drains debt". It is that the cheap path is
    available ONLY when stability is PROVEN, and that every other case escalates.
    A parts-check that could pass on a shifted or unreadable constraint would be
    the softening §17e/EXP-125 forbid, so most of these tests assert REFUSAL.
    """
    def _defect(self, day):
        return [
            {"ts": _dt(day, 0), "event": "reported", "agent": "orchestrator"},
            {"ts": _dt(day, 1), "event": "triaged", "agent": "orchestrator"},
            {"ts": _dt(day, 2), "event": "confirmed", "agent": "engineer"},
            {"ts": _dt(day, 3), "event": "fixed", "agent": "engineer"},
            {"ts": _dt(day, 5), "event": "validated", "agent": "tester"}]

    def _stats(self, owner, state, owner_backfill_pct=0.0):
        """Write a minimal views/stats.json with a known constraint."""
        d = os.path.join(self.tmp, "work", self.project, "views")
        os.makedirs(d, exist_ok=True)
        doc = {"overall": {"gross_lead_time": {
            "by_owner": {
                owner: {"pct_of_glt": 60.0,
                        "backfill_pct_of_state": owner_backfill_pct},
                "engineer": {"pct_of_glt": 5.0, "backfill_pct_of_state": 0.0}},
            "by_state": {
                state: {"pct_of_glt": 42.0, "backfill_pct_of_state": 0.0},
                "fixing": {"pct_of_glt": 3.0, "backfill_pct_of_state": 0.0}}}}}
        with open(os.path.join(d, "stats.json"), "w", encoding="utf-8") as f:
            json.dump(doc, f)

    def _marker(self, ts="2026-06-01T00:00:00Z", constraint=None):
        """Seed the LIVE store — the project's own cadence log. (The FROZEN
        parent-repo files are still read as a fallback; that path is covered in
        TestRetroLogStore, which drains a legacy-seeded project end to end.)"""
        ev = {"ts": ts, "event": wi.RETRO_CLOSED, "agent": "orchestrator"}
        if constraint:
            ev["constraint_owner"] = constraint["owner"]
            ev["constraint_state"] = constraint["state"]
        wi._append_retro_log(self.project, ev)

    def _run(self, threshold=3, now=NOW):
        ns = argparse.Namespace(project=self.project, threshold=threshold, now=now)
        with contextlib.redirect_stdout(io.StringIO()) as out:
            try:
                wi.cmd_parts_check(ns)
                code = 0
            except SystemExit as e:
                code = e.code
        return code, out.getvalue()

    def test_stable_constraint_drains_the_incident(self):
        self._marker(constraint={"owner": "queue", "state": "open"})
        self._stats("queue", "open")
        self.write_item("done", "DEF-1", "defect", self._defect(15))
        code, out = self._run()
        self.assertEqual(code, 0, out)
        self.assertIn("STABLE", out)
        self.assertIn("DEF-1", out)
        # and the debt is genuinely drained, not merely reported as fine
        self.assertGreater(wi._read_retro_marker(self.project),
                           wi.parse_ts("2026-06-14T00:00:00Z"))

    def test_shifted_constraint_escalates_and_does_NOT_drain(self):
        self._marker(ts="2026-06-01T00:00:00Z",
                     constraint={"owner": "queue", "state": "open"})
        self._stats("tester", "validating")          # both moved
        self.write_item("done", "DEF-1", "defect", self._defect(15))
        code, out = self._run()
        self.assertEqual(code, 2, out)
        self.assertIn("CONSTRAINT SHIFTED", out)
        self.assertIn("queue/open -> tester/validating", out)
        # the marker must be UNTOUCHED — an escalation may never drain debt
        self.assertEqual(wi._read_retro_marker(self.project),
                         wi.parse_ts("2026-06-01T00:00:00Z"))

    def test_unreadable_constraint_escalates(self):
        """An instrument that cannot be read is NOT evidence of stability."""
        self._marker(constraint={"owner": "queue", "state": "open"})
        # no stats.json at all
        self.write_item("done", "DEF-1", "defect", self._defect(15))
        code, out = self._run()
        self.assertEqual(code, 2, out)
        self.assertIn("could not be read", out)

    def test_no_prior_record_escalates(self):
        self._marker()                                # marker but NO constraint
        self._stats("queue", "open")
        self.write_item("done", "DEF-1", "defect", self._defect(15))
        code, out = self._run()
        self.assertEqual(code, 2, out)
        self.assertIn("no prior constraint on record", out)

    def test_routine_debt_at_threshold_still_escalates(self):
        """parts-check drains the INCIDENT arm only; a slice-close backlog is a
        different signal and keeps its batched full retro."""
        self._marker(constraint={"owner": "queue", "state": "open"})
        self._stats("queue", "open")
        for i in range(3):
            self._make_slice_close(i)
        code, out = self._run(threshold=3)
        self.assertEqual(code, 2, out)
        self.assertIn("ROUTINE debt", out)

    def _make_slice_close(self, i):
        uc = f"UC-P{i}"
        self.write_item("done", uc, "use-case", [
            {"ts": _dt(15, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(15, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(15, 2), "event": "pulled", "agent": "orchestrator"},
            {"ts": _dt(15, 3), "event": "built_green", "agent": "engineer"},
            {"ts": _dt(15, 4), "event": "deployed", "agent": "cicd"},
            {"ts": _dt(15, 12), "event": "validated", "agent": "tester"}],
            parents=[f"SLC-P{i}"])
        self.write_item("done", f"SLC-P{i}", "slice", [
            {"ts": _dt(14, 0), "event": "registered", "agent": "flow-manager"}])

    def test_high_backfill_owner_is_never_named_the_constraint(self):
        """§17f.6 / EXP-128 — interpolation is not measurement, and the rule binds
        this instrument too, or parts-check could 'confirm' a phantom constraint."""
        self._stats("queue", "open", owner_backfill_pct=88.0)   # queue is mostly backfill
        con = wi._read_constraint(self.project)
        self.assertIsNotNone(con)
        self.assertEqual(con["owner"], "engineer")   # the clean runner-up, not queue


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


# --------------------------------------------------------------------------- #
# Agent cycle time — the REAL per-stage work-effort each dispatched agent spent
# (duration_ms), folded alongside gross lead time. GLT stays the honest TOTAL
# elapsed (waits + steering gaps + outages included); this is its complement —
# how much of that total was actual agent effort vs wait/overhead.
# --------------------------------------------------------------------------- #
class TestAgentCycleTime(Base):
    def _append(self, iid, event, agent, duration_ms=None):
        ns = argparse.Namespace(project=self.project, id=iid, event=event, agent=agent,
                                ref=None, note=None, ts="2026-06-18T00:00:00Z",
                                tokens=None, duration_ms=duration_ms)
        with contextlib.redirect_stdout(io.StringIO()):
            wi.cmd_append(ns)

    def _stats(self):
        it = wi.load_all_items(self.project)[0]
        st = wi.compute_states(self.graphs, it)
        return wi.compute_stats(self.graphs, it, st, now=NOW_DT)

    def _fixture_uc(self):
        # the clean UC (GLT total = 43200s = 12h) with a known duration_ms per event.
        # duration_ms is attributed per-OWNER via the event's agent, and per-STAGE
        # via the state the item was IN when the event fired (the from-state — where
        # the agent did the work):
        #   made_ready  flow-manager  5000     (from registered)
        #   pulled      orchestrator  10000    (from ready)
        #   built_green engineer      4800000  (from building) — the ~4.8M-ms engineer
        #   deployed    cicd          60000    (from deploying)
        #   validated   tester        120000   (from dev-validating)
        # total = 4995000 ms = 4995 s ; genesis `registered` carries no duration.
        return [
            {"ts": _dt(10, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(10, 1), "event": "made_ready", "agent": "flow-manager", "duration_ms": 5000},
            {"ts": _dt(10, 3), "event": "pulled", "agent": "orchestrator", "duration_ms": 10000},
            {"ts": _dt(10, 6), "event": "built_green", "agent": "engineer", "duration_ms": 4800000},
            {"ts": _dt(10, 8), "event": "deployed", "agent": "cicd", "duration_ms": 60000},
            {"ts": _dt(10, 12), "event": "validated", "agent": "tester", "duration_ms": 120000},
        ]

    # ---- append records --duration-ms on the event (mirrors --tokens) ----
    def test_append_records_duration_ms(self):
        self.write_item("active", "UC-D", "use-case",
                        [{"ts": "1", "event": "registered", "agent": "flow-manager"}])
        self._append("UC-D", "made_ready", "flow-manager", duration_ms=54321)
        item = wi.load_item(os.path.join(self._items("active"), "UC-D.md"))
        self.assertEqual(item.events[-1]["duration_ms"], 54321)

    def test_append_without_duration_has_no_key(self):
        self.write_item("active", "UC-N", "use-case",
                        [{"ts": "1", "event": "registered", "agent": "flow-manager"}])
        self._append("UC-N", "made_ready", "flow-manager")  # no duration
        item = wi.load_item(os.path.join(self._items("active"), "UC-N.md"))
        self.assertNotIn("duration_ms", item.events[-1])

    def test_duration_ms_survives_render_roundtrip(self):
        ev = {"ts": _dt(10, 6), "event": "built_green", "agent": "engineer",
              "duration_ms": 4800000, "tokens": 50000}
        r = wi._render_event(ev)
        p = wi._parse_inline_map(r)
        self.assertEqual(p["duration_ms"], 4800000)
        self.assertEqual(p["tokens"], 50000)

    # ---- deterministic fixture: exact totals / by_owner / by_stage / ratio ----
    def test_total_and_by_owner_exact(self):
        self.write_item("done", "UC-1", "use-case", self._fixture_uc())
        act = self._stats()["overall"]["agent_cycle_time"]
        self.assertEqual(act["total_ms"], 4995000)
        self.assertAlmostEqual(act["total_s"], 4995.0, places=2)
        bo = act["by_owner"]
        self.assertEqual(bo["engineer"]["total_ms"], 4800000)
        self.assertEqual(bo["engineer"]["median_ms"], 4800000)
        self.assertEqual(bo["engineer"]["n"], 1)
        self.assertEqual(bo["tester"]["total_ms"], 120000)
        self.assertEqual(bo["cicd"]["total_ms"], 60000)
        self.assertEqual(bo["orchestrator"]["total_ms"], 10000)
        self.assertEqual(bo["flow-manager"]["total_ms"], 5000)

    def test_by_stage_exact_with_owner(self):
        self.write_item("done", "UC-1", "use-case", self._fixture_uc())
        bs = self._stats()["overall"]["agent_cycle_time"]["by_stage"]
        # effort is attributed to the state the item was IN when the event fired
        self.assertEqual(bs["building"]["total_ms"], 4800000)
        self.assertEqual(bs["building"]["owner"], "engineer")
        self.assertEqual(bs["deploying"]["total_ms"], 60000)
        self.assertEqual(bs["deploying"]["owner"], "cicd")
        self.assertEqual(bs["dev-validating"]["total_ms"], 120000)
        self.assertEqual(bs["dev-validating"]["owner"], "tester")
        # readying stages are queue-owned even though flow-manager/orchestrator acted
        self.assertEqual(bs["registered"]["total_ms"], 5000)   # made_ready fired here
        self.assertEqual(bs["ready"]["total_ms"], 10000)       # pulled fired here

    def test_cycle_time_vs_glt_ratio(self):
        # GLT total (all segments) for the clean UC = 43200s; effort = 4995s.
        self.write_item("done", "UC-1", "use-case", self._fixture_uc())
        s = self._stats()["overall"]
        self.assertAlmostEqual(s["gross_lead_time"]["gross_lead_time_total_s"], 43200, places=1)
        act = s["agent_cycle_time"]
        self.assertAlmostEqual(act["gross_lead_time_total_s"], 43200, places=1)
        self.assertAlmostEqual(act["cycle_time_vs_glt"], 4995.0 / 43200.0, places=6)
        # GLT itself is UNCHANGED by adding cycle time (honest total elapsed)
        self.assertAlmostEqual(s["gross_lead_time"]["gross_lead_time_median_s"], 43200, places=1)

    def test_full_coverage_reported(self):
        self.write_item("done", "UC-1", "use-case", self._fixture_uc())
        act = self._stats()["overall"]["agent_cycle_time"]
        # 5 of 6 legal-walk events carry a duration (genesis `registered` does not)
        self.assertEqual(act["n_events_with_duration"], 5)
        self.assertAlmostEqual(act["duration_coverage"], 5 / 6, places=6)

    # ---- absent durations degrade gracefully (no crash, zero/empty/None) ----
    def test_absent_durations_zero_and_no_crash(self):
        self.write_item("done", "UC-1", "use-case",
                        TestStats._clean_uc(self, "UC-1"))
        act = self._stats()["overall"]["agent_cycle_time"]
        self.assertEqual(act["total_ms"], 0)
        self.assertEqual(act["by_owner"], {})
        self.assertEqual(act["by_stage"], {})
        self.assertIsNone(act["cycle_time_vs_glt"])
        self.assertEqual(act["n_events_with_duration"], 0)

    def test_median_over_multiple_durations(self):
        # two engineer built_green events across a rework loop => median of the two
        evs = TestStats._rework_uc(self, "UC-1")
        # attach durations to the two built_green (engineer) events
        eng_durations = []
        for ev in evs:
            if ev["event"] == "built_green":
                d = 1000 * (len(eng_durations) + 3)  # 3000, 4000
                ev["duration_ms"] = d
                eng_durations.append(d)
        self.write_item("done", "UC-1", "use-case", evs)
        bo = self._stats()["overall"]["agent_cycle_time"]["by_owner"]
        self.assertEqual(bo["engineer"]["n"], 2)
        self.assertEqual(bo["engineer"]["total_ms"], 3000 + 4000)
        self.assertEqual(bo["engineer"]["median_ms"], (3000 + 4000) / 2)

    # ---- stats.md renders the §F block ----
    def test_stats_md_renders_cycle_time_section(self):
        self.write_item("done", "UC-1", "use-case", self._fixture_uc())
        md = wi._render_stats_md(self._stats())
        self.assertIn("F. Agent cycle time", md)
        self.assertIn("cycle time vs gross lead time", md.lower())

    def test_stats_md_cycle_time_empty_no_crash(self):
        self.write_item("done", "UC-1", "use-case",
                        TestStats._clean_uc(self, "UC-1"))
        md = wi._render_stats_md(self._stats())
        self.assertIn("F. Agent cycle time", md)
        self.assertIn("No agent duration recorded", md)


# --------------------------------------------------------------------------- #
# loop-gate — the MECHANICAL §F pull-precondition gate (v126). Four blocking
# checks: stalled validation, ready-below-floor, queue-over-cap, retro debt.
# Modelled on retro-debt: same launcher, --project, human-readable lines,
# exit 0 = may pull / exit 2 = BLOCKED.
#
# All timestamps are explicit and `--now` is passed, so every assertion is
# deterministic. Git is NEVER touched from a test (ROOT is a temp dir with no
# project repo, so push-state resolves UNKNOWN unless monkeypatched).
# --------------------------------------------------------------------------- #
class TestLoopGate(Base):
    def _policy(self, rows):
        """Write work/<P>/queues/policy.csv from (queue, param, value) rows."""
        d = os.path.join(self.tmp, "work", self.project, "queues")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "policy.csv"), "w", encoding="utf-8") as f:
            f.write("queue,param,value,unit,owner,target_metric,last_tuned,experiment\n")
            for q, p, v in rows:
                f.write(f"{q},{p},{v},count,flow-manager,throughput,2026-06-01,EXP-022\n")

    # DEFAULT DAY = 29, i.e. ~1 day before NOW (DEFECT-OAG-127). It used to be 10 —
    # TWENTY DAYS stale — and every "healthy fixture" test below therefore asserted
    # that a queue full of month-old inventory was a satisfied precondition. That is
    # precisely the condition check 11 exists to catch, so the fixtures were changed
    # rather than the check weakened: a test whose baseline is the pathology can only
    # ever ratify it. A test that WANTS a stale item passes the day explicitly.
    def _building_uc(self, iid, day=29):
        return [{"ts": _dt(day, 0), "event": "registered", "agent": "flow-manager"},
                {"ts": _dt(day, 1), "event": "made_ready", "agent": "flow-manager"},
                {"ts": _dt(day, 2), "event": "pulled", "agent": "orchestrator"}]

    def _reworking_uc(self, iid, day=29):
        return self._building_uc(iid, day) + [
            {"ts": _dt(day, 3), "event": "build_failed", "agent": "engineer"}]

    def _default_policy(self):
        # the shipped OagEventSource defaults
        self._policy([("intake", "min_items", 2), ("intake", "wip_limit", 10),
                      ("ready", "min_items", 3), ("ready", "wip_limit", 4),
                      ("deploy", "min_items", 0), ("deploy", "wip_limit", 1),
                      ("rework", "min_items", 0), ("rework", "wip_limit", 2)])

    def _ready_uc(self, iid, day=29):
        return [{"ts": _dt(day, 0), "event": "registered", "agent": "flow-manager"},
                {"ts": _dt(day, 1), "event": "made_ready", "agent": "flow-manager"}]

    def _validating_defect(self, day, hour, ref="abc1234", fixed_ref=True):
        """A defect parked in `validating` since day/hour — fix done (ref), only
        a tester dispatch missing. This is the DEFECT-OAG-045 shape."""
        evs = [{"ts": _dt(day, 0), "event": "reported", "agent": "orchestrator"},
               {"ts": _dt(day, 1), "event": "triaged", "agent": "orchestrator"},
               {"ts": _dt(day, 2), "event": "confirmed", "agent": "engineer"},
               {"ts": _dt(day, hour), "event": "fixed", "agent": "engineer"}]
        if fixed_ref:
            evs[-1]["ref"] = ref
        return evs

    # NEVER_AGES: a max-backlog-age so large the v135 age check cannot fire. The
    # depth-focused tests below use it to isolate DEPTH from AGE — the two are
    # deliberately different quantities with different severities, and a test for
    # one must not be perturbed by the other.
    NEVER_AGES = 10_000.0

    def _gate(self, stale_hours=4.0, threshold=3, now=NOW, observe=True,
              observe_timeout=None,
              max_backlog_age_days=wi.DEFAULT_MAX_BACKLOG_AGE_DAYS):
        return wi.compute_loop_gate(
            self.graphs, self.project, stale_hours=stale_hours,
            threshold=threshold, now=wi.parse_ts(now), observe=observe,
            observe_timeout=(wi.DEFAULT_OBSERVE_TIMEOUT if observe_timeout is None
                             else observe_timeout),
            max_backlog_age_days=max_backlog_age_days)

    def _run(self, stale_hours=4.0, threshold=3, now=NOW, observe=True,
             max_backlog_age_days=wi.DEFAULT_MAX_BACKLOG_AGE_DAYS):
        ns = argparse.Namespace(project=self.project, stale_hours=stale_hours,
                                threshold=threshold, now=now, observe=observe,
                                max_backlog_age_days=max_backlog_age_days,
                                observe_timeout=wi.DEFAULT_OBSERVE_TIMEOUT)
        with contextlib.redirect_stdout(io.StringIO()) as out:
            try:
                wi.cmd_loop_gate(ns)
                code = 0
            except SystemExit as e:
                code = e.code
        return code, out.getvalue()

    def _checks(self, findings):
        return [f["check"] for f in findings if f["severity"] == "block"]

    def _advisories(self, findings):
        return [f for f in findings if f["severity"] == "advisory"]

    # ---- all clear -----------------------------------------------------------
    def test_all_preconditions_hold_exits_zero(self):
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        findings = self._gate()
        self.assertEqual(self._checks(findings), [], findings)
        code, out = self._run()
        self.assertEqual(code, 0)
        self.assertIn("may pull", out)

    # ---- check 1: stalled validation ----------------------------------------
    def test_stalled_validation_blocks(self):
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        # fixed@d20 12:00 with a ref; now = d30 -> ~10 days in `validating`
        self.write_item("active", "DEF-STALE", "defect",
                        self._validating_defect(20, 12, ref="5095849"))
        findings = self._gate()
        self.assertIn("stalled-validation", self._checks(findings))
        f = [x for x in findings if x["check"] == "stalled-validation"][0]
        self.assertIn("DEF-STALE", f["ids"])
        self.assertEqual(f["state"], "validating")
        self.assertEqual(f["ref"], "5095849")
        self.assertGreater(f["dwell_s"], 4 * 3600)
        code, out = self._run()
        self.assertEqual(code, 2)
        self.assertIn("DEF-STALE", out)
        self.assertIn("stalled-validation", out)

    # ---- check 1, v152: DEPLOY-PENDING states, the 4h-24h window -------------
    #
    # ROC 2026-08-26. NOT "deploying was uncovered" — check 11 covers it at 24h. The
    # gap was the window BETWEEN the thresholds: provably-done work (ref-bearing
    # `built_green`) parked in `deploying` was named by nothing for 4h-24h.
    # `UC-ROC-102` sat there 12.0h, 260x cicd's own 166s median, while the same gate
    # run BLOCKED on `UC-ROC-104` at 11.5h in `dev-validating`. Recurrence of
    # principle-failure 2026-07-22 (AdixOut, UC-ADIX-015): under a PIPELINE deploy no
    # agent fires `deployed`, so the item cannot reach a tester at all.
    def _deploying_uc_with_ref(self, day, hour=0, ref="cafe123"):
        """`built_green` WITH a ref at day/hour and nothing since -> parked in
        `deploying` with the work provably finished."""
        return self._ready_uc(day - 1) + [
            {"ts": _dt(day, hour), "event": "pulled", "agent": "orchestrator"},
            {"ts": _dt(day, hour), "event": "built_green", "agent": "engineer",
             "ref": ref},
        ]

    def test_stalled_deploying_with_a_ref_blocks(self):
        """The UC-ROC-102 case. FAILS against the pre-v152 gate, where
        STALL_STATES was VALIDATING_STATES and `deploying` was simply skipped."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        self.write_item("active", "UC-DEPLOY-STALE", "use-case",
                        self._deploying_uc_with_ref(20, 12, ref="cafe123"))
        findings = self._gate()
        self.assertIn("stalled-validation", self._checks(findings))
        f = [x for x in findings
             if x["check"] == "stalled-validation" and "UC-DEPLOY-STALE" in x["ids"]][0]
        self.assertEqual(f["severity"], "block")
        self.assertEqual(f["state"], "deploying")
        self.assertEqual(f["ref"], "cafe123")
        self.assertGreater(f["dwell_s"], 4 * 3600)
        self.assertEqual(self._run()[0], 2)

    def test_stalled_deploying_remedy_names_the_deployed_event_not_the_tester(self):
        """A remedy the sole writer REJECTS is the DEF-ROC-084 class. There is no
        validating edge out of `deploying`, so "dispatch the tester" is unfollowable:
        the missing act is the `deployed` event, fired by cicd."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        self.write_item("active", "UC-DEPLOY-STALE", "use-case",
                        self._deploying_uc_with_ref(20, 12))
        f = [x for x in self._gate()
             if x["check"] == "stalled-validation" and "UC-DEPLOY-STALE" in x["ids"]][0]
        self.assertIn("EVENT=deployed", f["message"])
        self.assertIn("AGENT=cicd", f["message"])
        self.assertIn("dev-validating", f["message"])
        # It must NOT hand over the validating-state remedy, which cannot be followed.
        self.assertNotIn("EVENT=validated|rejected", f["message"])

    def test_stalled_prod_deploying_points_at_prod_validating(self):
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        events = self._deploying_uc_with_ref(20, 10, ref="beef456") + [
            {"ts": _dt(20, 11), "event": "deployed", "agent": "cicd", "ref": "beef456"},
            {"ts": _dt(20, 12), "event": "dev_validated", "agent": "tester",
             "ref": "beef456"},
        ]
        self.write_item("active", "UC-PROD-STALE", "use-case", events)
        hits = [x for x in self._gate()
                if x["check"] == "stalled-validation" and "UC-PROD-STALE" in x["ids"]]
        if hits and hits[0]["state"] == "prod-deploying":
            self.assertIn("prod-validating", hits[0]["message"])
            self.assertIn("AGENT=cicd", hits[0]["message"])

    def test_validating_remedy_is_unchanged_by_the_deploy_pending_addition(self):
        """Regression guard: the validating sentence must not drift while adding a
        second one beside it."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        self.write_item("active", "DEF-STALE", "defect",
                        self._validating_defect(20, 12, ref="5095849"))
        f = [x for x in self._gate()
             if x["check"] == "stalled-validation" and "DEF-STALE" in x["ids"]][0]
        self.assertIn("dispatch the tester now", f["message"])
        self.assertIn("EVENT=validated|rejected", f["message"])
        self.assertNotIn("EVENT=deployed", f["message"])

    def test_deploy_pending_states_are_a_subset_of_stall_states(self):
        """Fail-closed pin: if someone re-narrows STALL_STATES, this names it."""
        self.assertTrue(wi.DEPLOY_PENDING_STATES <= wi.STALL_STATES)
        self.assertTrue(wi.VALIDATING_STATES <= wi.STALL_STATES)
        self.assertIn("deploying", wi.STALL_STATES)
        self.assertIn("prod-deploying", wi.STALL_STATES)
        # VALIDATING_STATES is also the CFR/quality fold set and must NOT have grown.
        self.assertEqual(wi.VALIDATING_STATES,
                         {"validating", "dev-validating", "prod-validating"})

    def test_validation_within_threshold_does_not_block(self):
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        # fixed 2h before `now` -> under the 4h default
        self.write_item("active", "DEF-FRESH", "defect",
                        self._validating_defect(29, 22, ref="deadbee"))
        findings = self._gate()
        self.assertNotIn("stalled-validation", self._checks(findings))
        self.assertEqual(self._run()[0], 0)

    def test_stale_hours_is_overridable(self):
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        self.write_item("active", "DEF-FRESH", "defect",
                        self._validating_defect(29, 22, ref="deadbee"))  # 2h dwell
        self.assertNotIn("stalled-validation", self._checks(self._gate(stale_hours=4)))
        self.assertIn("stalled-validation", self._checks(self._gate(stale_hours=1)))

    def test_stalled_validation_without_ref_is_unknown_not_block(self):
        """No structured ref => we CANNOT establish the work is done. CHECK 1 reports
        UNKNOWN (never assumes either way) — and since DEFECT-OAG-127 the idle fact
        itself is carried by check 11, so the loop no longer walks past it."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        self.write_item("active", "DEF-NOREF", "defect",
                        self._validating_defect(20, 12, fixed_ref=False))
        findings = self._gate()
        self.assertNotIn("stalled-validation", self._checks(findings))
        unknown = [f for f in findings if f["severity"] == "unknown"]
        self.assertTrue(any("DEF-NOREF" in f["ids"] for f in unknown), findings)
        code, out = self._run()
        # CHECK 1's verdict is still UNKNOWN and still does not block — that is what
        # this test is about. The RUN, however, now exits 2, because check 11
        # (DEFECT-OAG-127) sees the ten-day IDLENESS, which is a fact independent of
        # whether the work is finished. Before that check existed, an item could sit
        # in `validating` for a week with no ref and the loop pulled straight past it.
        self.assertEqual(code, 2)
        self.assertIn("stalled-work", out)
        # ...and the unknown still reaches the HEADLINE: a run that failed to
        # establish something may never report "all preconditions hold"
        self.assertIn("NOT ESTABLISHED", out)
        self.assertNotIn("all preconditions hold", out)

    def test_uc_dev_validating_stall_blocks_on_deployed_ref(self):
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        self.write_item("active", "UC-STALE", "use-case", [
            {"ts": _dt(20, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(20, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(20, 2), "event": "pulled", "agent": "orchestrator"},
            {"ts": _dt(20, 3), "event": "built_green", "agent": "engineer", "ref": "aaa111"},
            {"ts": _dt(20, 4), "event": "deployed", "agent": "cicd", "ref": "bbb222"},
        ])
        f = [x for x in self._gate() if x["check"] == "stalled-validation"][0]
        self.assertIn("UC-STALE", f["ids"])
        self.assertEqual(f["state"], "dev-validating")
        self.assertEqual(f["ref"], "bbb222")     # LATEST ref-bearing done-work event

    def test_prod_validating_stall_blocks(self):
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        self.write_item("active", "UC-PROD", "use-case", [
            {"ts": _dt(20, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(20, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(20, 2), "event": "pulled", "agent": "orchestrator"},
            {"ts": _dt(20, 3), "event": "built_green", "agent": "engineer", "ref": "aaa111"},
            {"ts": _dt(20, 4), "event": "deployed", "agent": "cicd", "ref": "bbb222"},
            {"ts": _dt(20, 5), "event": "dev_validated", "agent": "tester"},
            {"ts": _dt(20, 6), "event": "promoted", "agent": "cicd", "ref": "ccc333"},
        ])
        f = [x for x in self._gate() if x["check"] == "stalled-validation"][0]
        self.assertIn("UC-PROD", f["ids"])
        self.assertEqual(f["state"], "prod-validating")

    def test_stalled_validation_clears_when_validated(self):
        """Proof-of-fire pair: RED with the item parked in validating, GREEN once
        the tester's `validated` event lands."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        evs = self._validating_defect(20, 12, ref="5095849")
        self.write_item("active", "DEF-STALE", "defect", evs)
        self.assertEqual(self._run()[0], 2)
        # tester dispatched -> validated. (Set the retro marker past the resolve so
        # the now-resolved defect's retro debt — check 4 — isn't what we measure.)
        os.remove(os.path.join(self._items("active"), "DEF-STALE.md"))
        self.write_item("done", "DEF-STALE", "defect",
                        evs + [{"ts": _dt(21, 0), "event": "validated", "agent": "tester"}])
        wi.cmd_retro_mark(argparse.Namespace(project=self.project,
                                            now="2026-06-22T00:00:00Z"))
        self.assertEqual(self._run()[0], 0)

    # ---- push state comes from GIT, never from event-note PROSE --------------
    def test_push_state_from_git_not_note_prose(self):
        """The founding error: an event NOTE claiming 'NOT pushed' was 35h stale
        while the ref WAS on origin/main. The note must never be consulted."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        evs = self._validating_defect(20, 12, ref="5095849")
        evs[-1]["note"] = "NOT pushed — push is the prod apply"
        self.write_item("active", "DEF-STALE", "defect", evs)
        calls = []

        def fake(project, ref):
            calls.append((project, ref))
            return {"ref": ref, "verdict": wi.REF_ON_TRUNK, "lane": wi.LANE_PROJECT,
                    "trunk": "origin/main", "resolved": ref, "padded": False,
                    "searched": [wi.LANE_PROJECT, wi.LANE_PARENT], "unreadable": [],
                    "reason": "ancestor"}

        orig = wi.resolve_ref
        wi.resolve_ref = fake
        try:
            f = [x for x in self._gate() if x["check"] == "stalled-validation"][0]
        finally:
            wi.resolve_ref = orig
        self.assertEqual(calls, [(self.project, "5095849")])
        self.assertIs(f["on_trunk"], True)    # git, not the stale note
        self.assertIn("PUSHED", f["message"])

    def _stub_resolve(self, verdict, **kw):
        base = {"verdict": verdict, "lane": None, "trunk": None, "resolved": None,
                "padded": False, "searched": [], "unreadable": [], "reason": "stub"}
        base.update(kw)
        return lambda p, r: dict(base, ref=r)

    def test_a_ref_absent_from_EVERY_repo_screams_destroyed_work(self):
        """DEFECT-OAG-128 / AC-128.2. Before the fix this rendered as the SAME
        string as a parent-lane ref that merely lived in the other repo — so the
        one alarm that means real data loss was muted inside a routine UNKNOWN."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        self.write_item("active", "DEF-STALE", "defect",
                        self._validating_defect(20, 12, ref="deadbee"))
        orig = wi.resolve_ref
        wi.resolve_ref = self._stub_resolve(
            wi.REF_ABSENT, searched=[wi.LANE_PROJECT, wi.LANE_PARENT],
            reason="resolves in NONE of the 2 readable repo(s)")
        try:
            f = [x for x in self._gate() if x["check"] == "stalled-validation"][0]
        finally:
            wi.resolve_ref = orig
        self.assertEqual(f["ref_verdict"], wi.REF_ABSENT)
        self.assertIsNone(f["on_trunk"])
        self.assertIn("ABSENT FROM EVERY REPO", f["message"])
        self.assertIn("DEFECT-OAG-072", f["message"])
        self.assertIn("worktree-guard", f["message"])       # the rescue, not a re-run

    def test_a_ref_we_COULD_NOT_LOOK_UP_is_neither_a_pass_nor_the_alarm(self):
        """§17i, and the distinction the defect existed for: 'I could not look' must
        be visibly different from BOTH 'pushed' and 'destroyed'."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        self.write_item("active", "DEF-STALE", "defect",
                        self._validating_defect(20, 12, ref="notasha"))
        orig = wi.resolve_ref
        wi.resolve_ref = self._stub_resolve(
            wi.REF_CANNOT_DETERMINE, unreadable=[wi.LANE_PARENT],
            reason="could not read the parent-repo repo(s)")
        try:
            f = [x for x in self._gate() if x["check"] == "stalled-validation"][0]
        finally:
            wi.resolve_ref = orig
        self.assertEqual(f["ref_verdict"], wi.REF_CANNOT_DETERMINE)
        self.assertIsNone(f["on_trunk"])
        self.assertIn("COULD NOT BE ESTABLISHED", f["message"])
        self.assertNotIn("ABSENT FROM EVERY REPO", f["message"])   # not the alarm
        self.assertNotIn("PUSHED —", f["message"])                 # not a pass

    def test_an_existing_but_unpushed_ref_says_NOT_LOST_in_so_many_words(self):
        """The commonest parent-lane state (the owner owns the parent push). It must
        not read like the destroyed-work case, which is what a reader of the old
        single UNKNOWN string had to guess at."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        self.write_item("active", "DEF-STALE", "defect",
                        self._validating_defect(20, 12, ref="8dae2cc"))
        orig = wi.resolve_ref
        wi.resolve_ref = self._stub_resolve(
            wi.REF_NOT_ON_TRUNK, lane=wi.LANE_PARENT, resolved="8dae2cc",
            searched=[wi.LANE_PROJECT, wi.LANE_PARENT])
        try:
            f = [x for x in self._gate() if x["check"] == "stalled-validation"][0]
        finally:
            wi.resolve_ref = orig
        self.assertIs(f["on_trunk"], False)
        self.assertEqual(f["ref_lane"], wi.LANE_PARENT)
        self.assertIn("NOT lost", f["message"])
        self.assertIn("parent-repo", f["message"])

    def test_a_zero_stripped_ref_says_so_instead_of_looking_destroyed(self):
        """UC-XA5's `605428`. The message must name the repair, or the next reader
        re-derives the leading-zero bug from scratch."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        self.write_item("active", "DEF-STALE", "defect",
                        self._validating_defect(20, 12, ref="605428"))
        orig = wi.resolve_ref
        wi.resolve_ref = self._stub_resolve(
            wi.REF_ON_TRUNK, lane=wi.LANE_PROJECT, trunk="origin/main",
            resolved="0605428", padded=True)
        try:
            f = [x for x in self._gate() if x["check"] == "stalled-validation"][0]
        finally:
            wi.resolve_ref = orig
        self.assertEqual(f["ref_resolved"], "0605428")
        self.assertIn("leading zero was eaten", f["message"])

    def test_ref_on_trunk_returns_none_without_repo(self):
        # ROOT is a temp dir: work/<P> is not a git repo -> UNKNOWN, never a guess
        self.assertIsNone(wi._ref_on_trunk(self.project, "5095849"))

    # ---- check 2: ready below floor -----------------------------------------
    def test_ready_below_floor_blocks(self):
        self._default_policy()
        self.write_item("active", "UC-XC5", "use-case", self._ready_uc(10))   # ready=1
        findings = self._gate()
        self.assertIn("ready-below-floor", self._checks(findings))
        f = [x for x in findings if x["check"] == "ready-below-floor"][0]
        self.assertEqual((f["depth"], f["floor"]), (1, 3))
        code, out = self._run()
        self.assertEqual(code, 2)
        self.assertIn("ready depth 1 < min_items 3", out)

    def test_ready_at_floor_does_not_block(self):
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        self.assertNotIn("ready-below-floor", self._checks(self._gate()))

    def test_scheduled_open_items_count_toward_ready(self):
        # queue_map: both `ready` and `scheduled` map to the ready queue
        self._default_policy()
        self.write_item("active", "UC-R0", "use-case", self._ready_uc(10))
        for i in range(2):
            self.write_item("active", f"OI-{i}", "open-item", [
                {"ts": _dt(10, 0), "event": "open", "agent": "orchestrator"},
                {"ts": _dt(10, 1), "event": "scheduled", "agent": "flow-manager"}])
        self.assertNotIn("ready-below-floor", self._checks(self._gate()))

    # ---- check 3: queue over cap -------------------------------------------
    # TWO SEVERITIES (v126 addendum). A WIP-STAGE queue over cap is real concurrent-work
    # harm and BLOCKS. A BACKLOG queue (intake) over cap is ADVISORY: Little's Law
    # governs WIP, not backlog depth, and blocking the pull for a deep backlog
    # INVERTS the constraint — the remedy for a deep backlog is to deliver faster,
    # which is exactly what the block prevents. Founding case (2026-08-01): a
    # legitimate differential sweep produced ~15 verified-real sub-cost-4 findings;
    # the flow-manager correctly refused to close any of them and the loop halted
    # for having done good discovery work.
    def test_intake_over_cap_is_advisory_not_blocking(self):
        """PROOF CASE 1: backlog over cap ALONE => exit 0, advisory printed."""
        self._policy([("ready", "min_items", 0), ("intake", "wip_limit", 10)])
        for i in range(14):
            self.write_item("active", f"OI-{i:02d}", "open-item", [
                {"ts": _dt(10, 0), "event": "open", "agent": "orchestrator"}])
        findings = self._gate(max_backlog_age_days=self.NEVER_AGES)
        self.assertNotIn("queue-over-cap", self._checks(findings))   # NOT blocking
        adv = self._advisories(findings)
        self.assertEqual([f["queue"] for f in adv], ["intake"], findings)
        f = adv[0]
        self.assertEqual((f["check"], f["queue"], f["depth"], f["cap"], f["over"]),
                         ("queue-over-cap", "intake", 14, 10, 4))
        self.assertEqual(f["kind"], wi.QUEUE_KIND_BACKLOG)
        code, out = self._run(max_backlog_age_days=self.NEVER_AGES)
        self.assertEqual(code, 0)                                    # exit 0
        self.assertIn("may pull", out)
        # the advisory is still reported PROMINENTLY, with depth + overage + remedy,
        # and is unmistakably NOT satisfied
        self.assertIn("ADVISORY", out)
        self.assertIn("intake depth 14 > wip_limit 10", out)
        self.assertIn("over by 4", out)
        self.assertIn("deliver faster", out.lower())

    def test_wip_stage_over_cap_blocks(self):
        """PROOF CASE 2: a WIP-stage queue over cap => exit 2."""
        self._policy([("ready", "min_items", 0), ("wip", "wip_limit", 1)])
        for i in range(3):
            self.write_item("active", f"UC-B{i}", "use-case", self._building_uc(i))
        findings = self._gate()
        self.assertIn("queue-over-cap", self._checks(findings))
        f = [x for x in findings if x["check"] == "queue-over-cap"][0]
        self.assertEqual((f["queue"], f["depth"], f["cap"], f["kind"]),
                         ("wip", 3, 1, wi.QUEUE_KIND_WIP))
        code, out = self._run()
        self.assertEqual(code, 2)
        self.assertIn("wip depth 3 > wip_limit 1", out)

    def test_ready_over_cap_blocks(self):
        self._policy([("ready", "min_items", 0), ("ready", "wip_limit", 2)])
        for i in range(4):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        f = [x for x in self._gate() if x["check"] == "queue-over-cap"][0]
        self.assertEqual((f["severity"], f["queue"], f["depth"]), ("block", "ready", 4))
        self.assertEqual(self._run()[0], 2)

    def test_rework_over_cap_blocks(self):
        self._policy([("ready", "min_items", 0), ("rework", "wip_limit", 1)])
        for i in range(2):
            self.write_item("active", f"UC-RW{i}", "use-case", self._reworking_uc(i))
        f = [x for x in self._gate() if x["check"] == "queue-over-cap"][0]
        self.assertEqual((f["severity"], f["queue"], f["depth"]), ("block", "rework", 2))
        self.assertEqual(self._run()[0], 2)

    def test_backlog_advisory_and_wip_block_together(self):
        """PROOF CASE 3: both together => exit 2, advisory STILL shown alongside."""
        self._policy([("ready", "min_items", 0), ("intake", "wip_limit", 1),
                      ("wip", "wip_limit", 1)])
        for i in range(3):
            self.write_item("active", f"OI-{i}", "open-item", [
                {"ts": _dt(10, 0), "event": "open", "agent": "orchestrator"}])
        for i in range(2):
            self.write_item("active", f"UC-B{i}", "use-case", self._building_uc(i))
        findings = self._gate()
        by_sev = {f["queue"]: f["severity"] for f in findings
                  if f["check"] == "queue-over-cap"}
        self.assertEqual(by_sev, {"intake": "advisory", "wip": "block"})
        code, out = self._run()
        self.assertEqual(code, 2)                       # the WIP violation blocks
        self.assertIn("wip depth 2 > wip_limit 1", out)  # blocking line
        self.assertIn("intake depth 3 > wip_limit 1", out)  # advisory line STILL shown
        self.assertIn("ADVISORY", out)

    def test_queue_at_cap_does_not_block(self):
        self._policy([("ready", "min_items", 0), ("intake", "wip_limit", 10)])
        for i in range(10):
            self.write_item("active", f"OI-{i:02d}", "open-item", [
                {"ts": _dt(10, 0), "event": "open", "agent": "orchestrator"}])
        findings = self._gate()
        self.assertNotIn("queue-over-cap", self._checks(findings))
        self.assertEqual(self._advisories(findings), [])   # at cap: not even advisory

    def test_every_over_cap_queue_is_reported_not_just_the_first(self):
        self._policy([("ready", "min_items", 0), ("intake", "wip_limit", 1),
                      ("rework", "wip_limit", 0)])
        for i in range(3):
            self.write_item("active", f"OI-{i}", "open-item", [
                {"ts": _dt(10, 0), "event": "open", "agent": "orchestrator"}])
        self.write_item("active", "UC-RW", "use-case", self._reworking_uc(10))
        qs = sorted(f["queue"] for f in self._gate() if f["check"] == "queue-over-cap")
        self.assertEqual(qs, ["intake", "rework"])

    # ---- the backlog/wip classification is DECLARED, not a hardcoded name ----
    def test_queue_kind_declared_in_policy_csv(self):
        """policy.csv is long-format (queue,param,value), so `kind` is a new PARAM
        ROW — no column change, so no other reader of the file is affected."""
        self._policy([("ready", "min_items", 0), ("rework", "wip_limit", 1),
                      ("rework", "kind", "backlog")])
        for i in range(2):
            self.write_item("active", f"UC-RW{i}", "use-case", self._reworking_uc(i))
        findings = self._gate(max_backlog_age_days=self.NEVER_AGES)
        self.assertNotIn("queue-over-cap", self._checks(findings))   # declared backlog
        self.assertEqual([f["queue"] for f in self._advisories(findings)], ["rework"])
        self.assertEqual(self._run(max_backlog_age_days=self.NEVER_AGES)[0], 0)

    def test_policy_csv_can_declare_intake_as_wip(self):
        """The declaration is authoritative in BOTH directions — the default map is
        only a fallback, never an override."""
        self._policy([("ready", "min_items", 0), ("intake", "wip_limit", 1),
                      ("intake", "kind", "wip")])
        for i in range(3):
            self.write_item("active", f"OI-{i}", "open-item", [
                {"ts": _dt(10, 0), "event": "open", "agent": "orchestrator"}])
        self.assertIn("queue-over-cap", self._checks(self._gate()))
        self.assertEqual(self._run()[0], 2)

    def test_undeclared_queue_defaults_to_wip_fail_closed(self):
        """A future in-flight stage nobody classified BLOCKS (fail-closed); only
        `intake` defaults to backlog."""
        self.assertEqual(wi.queue_kind({}, "wip"), wi.QUEUE_KIND_WIP)
        self.assertEqual(wi.queue_kind({}, "rework"), wi.QUEUE_KIND_WIP)
        self.assertEqual(wi.queue_kind({}, "ready"), wi.QUEUE_KIND_WIP)
        self.assertEqual(wi.queue_kind({}, "some-future-stage"), wi.QUEUE_KIND_WIP)
        self.assertEqual(wi.queue_kind({}, "intake"), wi.QUEUE_KIND_BACKLOG)

    def test_unrecognised_kind_value_falls_back_to_default(self):
        self.assertEqual(wi.queue_kind({"wip": {"kind": "nonsense"}}, "wip"),
                         wi.QUEUE_KIND_WIP)
        self.assertEqual(wi.queue_kind({"intake": {"kind": "nonsense"}}, "intake"),
                         wi.QUEUE_KIND_BACKLOG)
        self.assertEqual(wi.queue_kind({"intake": {"kind": " BACKLOG "}}, "intake"),
                         wi.QUEUE_KIND_BACKLOG)

    def test_template_seed_policy_csv_declares_the_kinds(self):
        """The `work/_TEMPLATE` seed (agent-system state, not project data) DECLARES
        the classification, so every new project ships it visible where the retro
        tunes the buffers — not only in code. Existing projects whose policy.csv
        predates the `kind` row are covered by the fallback map, which is why the
        row is additive and nothing breaks."""
        path = os.path.join(self._orig_root, "work", "_TEMPLATE", "queues",
                            "policy.csv")
        rows = [r for r in open(path, encoding="utf-8").read().splitlines()
                if r.strip()][1:]
        kinds = {r.split(",")[0]: r.split(",")[2] for r in rows
                 if r.split(",")[1] == "kind"}
        self.assertEqual(kinds.get("intake"), "backlog", kinds)
        for q in ("ready", "rework", "deploy"):
            self.assertEqual(kinds.get(q), "wip", f"{q}: {kinds}")
        # and the header/column set is UNCHANGED — `kind` is a new row, not a column
        header = open(path, encoding="utf-8").readline().strip()
        self.assertEqual(header, "queue,param,value,unit,owner,target_metric,"
                                 "last_tuned,experiment")

    def test_advisory_only_run_says_it_may_pull_and_still_shows_advisory(self):
        """An advisory-only run must be unmistakable: exit 0, 'may pull', AND the
        advisory reported so it cannot be read as satisfied."""
        self._policy([("ready", "min_items", 0), ("intake", "wip_limit", 2)])
        for i in range(5):
            self.write_item("active", f"OI-{i}", "open-item", [
                {"ts": _dt(10, 0), "event": "open", "agent": "orchestrator"}])
        code, out = self._run(max_backlog_age_days=self.NEVER_AGES)
        self.assertEqual(code, 0)
        self.assertIn("may pull", out)
        self.assertNotIn("BLOCKED", out)
        self.assertIn("ADVISORY", out)
        self.assertIn("1 advisory", out.lower())

    # ---- check 4: retro debt (DELEGATED to compute_retro_debt, not re-coded) --
    def test_retro_debt_due_blocks(self):
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        # a resolved defect since the marker = an INCIDENT -> immediate retro debt
        self.write_item("done", "DEF-RESOLVED", "defect", [
            {"ts": _dt(15, 0), "event": "reported", "agent": "orchestrator"},
            {"ts": _dt(15, 1), "event": "triaged", "agent": "orchestrator"},
            {"ts": _dt(15, 2), "event": "confirmed", "agent": "engineer"},
            {"ts": _dt(15, 3), "event": "fixed", "agent": "engineer", "ref": "f00d"},
            {"ts": _dt(15, 5), "event": "validated", "agent": "tester"}])
        findings = self._gate()
        self.assertIn("retro-debt", self._checks(findings))
        code, out = self._run()
        self.assertEqual(code, 2)
        self.assertIn("RETRO DUE", out)

    def test_retro_debt_clears_after_retro_mark(self):
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        self.write_item("done", "DEF-RESOLVED", "defect", [
            {"ts": _dt(15, 0), "event": "reported", "agent": "orchestrator"},
            {"ts": _dt(15, 1), "event": "triaged", "agent": "orchestrator"},
            {"ts": _dt(15, 2), "event": "confirmed", "agent": "engineer"},
            {"ts": _dt(15, 3), "event": "fixed", "agent": "engineer", "ref": "f00d"},
            {"ts": _dt(15, 5), "event": "validated", "agent": "tester"}])
        self.assertEqual(self._run()[0], 2)
        wi.cmd_retro_mark(argparse.Namespace(project=self.project,
                                            now="2026-06-16T00:00:00Z"))
        self.assertNotIn("retro-debt", self._checks(self._gate()))
        self.assertEqual(self._run()[0], 0)

    def test_retro_debt_delegates_to_compute_retro_debt(self):
        """DRY: loop-gate must CALL the existing retro-debt logic, not clone it."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        calls = []
        orig = wi.compute_retro_debt

        def spy(graphs, project, threshold, now):
            calls.append((project, threshold))
            return ([], [], False, [], wi.parse_ts("2026-06-01T00:00:00Z"))

        wi.compute_retro_debt = spy
        try:
            self._gate(threshold=7)
        finally:
            wi.compute_retro_debt = orig
        self.assertEqual(calls, [(self.project, 7)])

    # ---- check 11: board-mapping drift (DEFECT-OAG-099, AC-099.5) -----------
    def test_AC_099_5_board_mapping_drift_is_a_standing_gate_before_every_pull(self):
        """A state in state-graphs.json with no board-status row renders as
        unstarted Backlog — which has happened twice. AC-099.5 wants the check
        AUTOMATIC, and §17e says a gate in no workflow is not a gate, so it hangs
        on the loop's only continuously-running workflow."""
        self._default_policy()
        findings = wi.compute_board_mapping_drift()
        self.assertEqual(findings, [], f"committed mapping should be clean: {findings}")
        self.assertNotIn("board-mapping", self._checks(self._gate()))

    def test_AC_099_5_a_drifted_board_mapping_blocks_the_pull(self):
        drifted = wi.compute_board_mapping_drift(
            graphs_path=self._write_drifted_graphs())
        self.assertEqual([f["check"] for f in drifted], ["board-mapping"])
        self.assertEqual(drifted[0]["severity"], "block")
        self.assertIn("a_throwaway_state", drifted[0]["message"])
        self.assertIn("linear-mapping.md", drifted[0]["message"])

    def test_AC_099_5_an_unrunnable_board_mapping_check_is_UNKNOWN_not_clean(self):
        """§17c.2: an unevaluated precondition is not a met one."""
        findings = wi.compute_board_mapping_drift(
            script="/nonexistent/board-sweep.py")
        self.assertEqual([f["severity"] for f in findings], ["unknown"])
        self.assertIn("NOT ESTABLISHED", findings[0]["message"])

    def test_AC_099_5_loop_gate_delegates_rather_than_cloning_the_audit(self):
        """DRY: the mapping audit has ONE executable home."""
        self._default_policy()
        calls = []
        orig = wi.compute_board_mapping_drift
        wi.compute_board_mapping_drift = lambda *a, **k: (calls.append(1) or [])
        try:
            self._gate()
        finally:
            wi.compute_board_mapping_drift = orig
        self.assertEqual(len(calls), 1)

    def _write_drifted_graphs(self):
        import json as _json
        src = os.path.join(wi.ROOT, "process", "machinery", "state-graphs.json")
        with open(src, encoding="utf-8") as fh:
            g = _json.load(fh)
        g["types"]["use-case"]["transitions"].append(
            {"from": "ready", "event": "throwaway", "to": "a_throwaway_state",
             "agents": ["engineer"]})
        p = os.path.join(self.tmp, "drifted-state-graphs.json")
        with open(p, "w", encoding="utf-8") as fh:
            _json.dump(g, fh)
        return p

    # ---- reports EVERY violation, not just the first ------------------------
    # ---- check 4b: aged backlog item with NO DECISION (v135, EXP-131) --------
    # The constraint these guard: `open` was the top GLT contributor for two
    # consecutive retros. The gate blocks on AGE-WITHOUT-A-DECISION, which is
    # count-independent, and NEVER on depth (that stays advisory — Little's Law).
    def _open_items(self, n, day=10, extra_fm=None):
        self._policy([("ready", "min_items", 0)])   # no depth cap at all
        for i in range(n):
            self.write_item("active", f"OI-A{i}", "open-item",
                            [{"ts": _dt(day, 0), "event": "open",
                              "agent": "orchestrator"}],
                            extra_fm=extra_fm)

    def test_aged_backlog_item_with_no_decision_blocks(self):
        """20d old, no decision => BLOCK. Note there is NO wip_limit here at all,
        so this cannot be the depth check firing under another name."""
        self._open_items(2, day=10)                       # NOW is 2026-06-30
        findings = self._gate()
        self.assertIn("aged-backlog-undecided", self._checks(findings))
        f = [x for x in findings if x["check"] == "aged-backlog-undecided"][0]
        self.assertEqual(sorted(f["ids"]), ["OI-A0", "OI-A1"])
        code, out = self._run()
        self.assertEqual(code, 2)
        self.assertIn("aged-backlog-undecided", out)
        # the remedy must offer the CHEAP path, and must forbid the harmful one
        self.assertIn("defer_until", out)
        self.assertIn("Do NOT close a real finding", out)

    def test_young_backlog_item_does_not_block(self):
        """Age is the trigger. A fresh item is fine however many there are."""
        self._open_items(25, day=28)                      # 2d old at NOW
        self.assertNotIn("aged-backlog-undecided", self._checks(self._gate()))
        self.assertEqual(self._run()[0], 0)

    def test_in_date_defer_clears_the_block(self):
        """A dated defer IS a decision — one line, and the gate goes green."""
        self._open_items(2, day=10, extra_fm={"defer_until": "2026-07-15"})
        self.assertNotIn("aged-backlog-undecided", self._checks(self._gate()))
        self.assertEqual(self._run()[0], 0)

    def test_expired_defer_re_blocks(self):
        """A defer has a SHELF LIFE (the EXP-130 lesson applied to inventory):
        once the date passes it is no longer a decision and the item returns."""
        self._open_items(2, day=10, extra_fm={"defer_until": "2026-06-20"})
        findings = self._gate()                            # NOW = 06-30, expired
        self.assertIn("aged-backlog-undecided", self._checks(findings))
        code, out = self._run()
        self.assertEqual(code, 2)
        self.assertIn("DEFER EXPIRED", out)

    def test_unparseable_defer_is_not_a_decision(self):
        """FAIL CLOSED: a typo'd date must never silence the gate."""
        self._open_items(2, day=10, extra_fm={"defer_until": "soon-ish"})
        self.assertIn("aged-backlog-undecided", self._checks(self._gate()))
        self.assertEqual(self._run()[0], 2)

    def test_wip_queue_is_untouched_by_the_age_check(self):
        """The check is scoped to BACKLOG queues; a WIP stage has its own cap and
        its own severity, and must not acquire a second, overlapping block."""
        self._policy([("ready", "min_items", 0), ("wip", "wip_limit", 99)])
        for i in range(2):
            self.write_item("active", f"UC-B{i}", "use-case", self._building_uc(i))
        self.assertNotIn("aged-backlog-undecided", self._checks(self._gate()))

    def test_reports_all_violated_preconditions(self):
        self._policy([("intake", "wip_limit", 1), ("ready", "min_items", 3),
                      ("rework", "wip_limit", 0)])
        for i in range(3):
            self.write_item("active", f"OI-{i}", "open-item", [
                {"ts": _dt(10, 0), "event": "open", "agent": "orchestrator"}])
        self.write_item("active", "UC-RW", "use-case", self._reworking_uc(10))
        self.write_item("active", "DEF-STALE", "defect",
                        self._validating_defect(20, 12, ref="5095849"))
        self.write_item("done", "DEF-RESOLVED", "defect", [
            {"ts": _dt(15, 0), "event": "reported", "agent": "orchestrator"},
            {"ts": _dt(15, 1), "event": "triaged", "agent": "orchestrator"},
            {"ts": _dt(15, 2), "event": "confirmed", "agent": "engineer"},
            {"ts": _dt(15, 3), "event": "fixed", "agent": "engineer", "ref": "f00d"},
            {"ts": _dt(15, 5), "event": "validated", "agent": "tester"}])
        findings = self._gate(max_backlog_age_days=self.NEVER_AGES)
        checks = set(self._checks(findings))
        self.assertEqual(checks, {"stalled-validation", "ready-below-floor",
                                  "queue-over-cap", "retro-debt"})
        # and the backlog advisory rides ALONGSIDE the four blocking violations
        self.assertEqual([f["queue"] for f in self._advisories(findings)], ["intake"])
        code, out = self._run(max_backlog_age_days=self.NEVER_AGES)
        self.assertEqual(code, 2)
        for token in ("stalled-validation", "ready-below-floor",
                      "queue-over-cap", "retro-debt", "ADVISORY"):
            self.assertIn(token, out)

    # ---- check 5: awaiting-observation RE-CHECK (v9) -------------------------
    # An item in `awaiting_observation` is shipped, green and UNPROVEN. It is not
    # done, and the ONE thing that must happen every cycle is that its liveness
    # predicate is re-evaluated — exactly as `blocked` is re-checked. Three
    # verdicts, and the severities are deliberate:
    #   observed  -> BLOCK. Reality has now produced the record; a tester dispatch
    #                is available and ACTIONABLE. This is the whole point.
    #   not-yet   -> ADVISORY. Legitimate (a rare branch may wait weeks) but still
    #                outstanding, so it is printed prominently and never "satisfied".
    #   broken    -> BLOCK. An unrunnable predicate is the `make wire-provenance`
    #                class (§17c.2): the item would sit parked for ever with no
    #                mechanism. Fail CLOSED and loud.
    def _awaiting_uc(self, day=20, spec="make:probe-genesis-observed",
                     ref="7468849", observe=True):
        evs = [{"ts": _dt(day, 0), "event": "registered", "agent": "flow-manager"},
               {"ts": _dt(day, 1), "event": "made_ready", "agent": "flow-manager"},
               {"ts": _dt(day, 2), "event": "pulled", "agent": "orchestrator"},
               {"ts": _dt(day, 3), "event": "built_green", "agent": "engineer",
                "ref": ref},
               {"ts": _dt(day, 4), "event": "deployed", "agent": "cicd", "ref": ref},
               {"ts": _dt(day, 5), "event": "not_yet_observed", "agent": "tester",
                "note": "inert behind GENESIS_PHASE_EVENTS_ENABLED=false"}]
        if observe:
            evs[-1]["observe"] = spec
        return evs

    def _fake_observe(self, verdict, detail="", record=None):
        def fake(project, spec, timeout=None):
            if record is not None:
                record.append((project, spec, timeout))
            return verdict, detail
        return fake

    def _with_observe(self, verdict, detail="", **kw):
        orig = wi._run_observation
        wi._run_observation = self._fake_observe(verdict, detail)
        try:
            return self._gate(**kw)
        finally:
            wi._run_observation = orig

    def _run_with_observe(self, verdict, detail="", **kw):
        orig = wi._run_observation
        wi._run_observation = self._fake_observe(verdict, detail)
        try:
            return self._run(**kw)
        finally:
            wi._run_observation = orig

    def test_awaiting_observation_not_yet_is_advisory_not_blocking(self):
        """PROOF CASE: the honest park. Reported every cycle, never blocking."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        self.write_item("active", "UC-ML1", "use-case", self._awaiting_uc())
        findings = self._with_observe("not-yet")
        self.assertNotIn("awaiting-observation", self._checks(findings))
        adv = [f for f in findings if f["check"] == "awaiting-observation"
               and f["severity"] == "advisory"]
        self.assertEqual([f["ids"] for f in adv], [["UC-ML1"]], findings)
        self.assertEqual(adv[0]["verdict"], "not-yet")
        self.assertEqual(adv[0]["spec"], "make:probe-genesis-observed")
        code, out = self._run_with_observe("not-yet")
        self.assertEqual(code, 0)
        self.assertIn("may pull", out)
        self.assertIn("ADVISORY", out)
        self.assertIn("UC-ML1", out)
        self.assertIn("NOT YET OBSERVED", out)
        self.assertIn("UNPROVEN", out)

    def test_awaiting_observation_observed_blocks_and_asks_for_a_dispatch(self):
        """PROOF CASE: the observation LANDED. That is actionable, so it BLOCKS
        until the tester is dispatched — the same lever as check 1."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        self.write_item("active", "UC-ML1", "use-case", self._awaiting_uc())
        findings = self._with_observe("observed", "3 real OagFlightCancelled")
        self.assertIn("awaiting-observation", self._checks(findings))
        f = [x for x in findings if x["check"] == "awaiting-observation"][0]
        self.assertEqual((f["severity"], f["verdict"], f["ids"]),
                         ("block", "observed", ["UC-ML1"]))
        code, out = self._run_with_observe("observed", "3 real OagFlightCancelled")
        self.assertEqual(code, 2)
        self.assertIn("HAS LANDED", out)
        self.assertIn("dispatch the tester", out)
        self.assertIn("AGENT=tester", out)

    def test_awaiting_observation_broken_predicate_blocks(self):
        """An observation predicate that cannot be EVALUATED is not a predicate.
        This is the `make wire-provenance` class and it must be loud, not silent."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        self.write_item("active", "UC-ML1", "use-case", self._awaiting_uc())
        findings = self._with_observe("broken", "No rule to make target 'probe-x'")
        self.assertIn("awaiting-observation", self._checks(findings))
        f = [x for x in findings if x["check"] == "awaiting-observation"][0]
        self.assertEqual(f["verdict"], "broken")
        code, out = self._run_with_observe("broken", "No rule to make target")
        self.assertEqual(code, 2)
        self.assertIn("CANNOT BE EVALUATED", out)
        self.assertIn("No rule to make target", out)

    def test_awaiting_observation_without_a_predicate_blocks(self):
        """A predicate-less park (only reachable by hand-editing the file, since
        `append` refuses it) is a prose park: unverifiable, so it BLOCKS."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        self.write_item("active", "UC-ML1", "use-case",
                        self._awaiting_uc(observe=False))
        findings = self._with_observe("observed")   # never consulted
        f = [x for x in findings if x["check"] == "awaiting-observation"][0]
        self.assertEqual((f["severity"], f["verdict"]), ("block", "no-predicate"))
        self.assertIsNone(f["spec"])
        code, out = self._run_with_observe("observed")
        self.assertEqual(code, 2)
        self.assertIn("NO observation predicate", out)

    def test_no_observe_flag_reports_unknown_never_silently_clean(self):
        """Skipping the evaluation is allowed (it can be a slow real-data query)
        but a skipped run must be UNMISTAKABLE — never read as satisfied."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        self.write_item("active", "UC-ML1", "use-case", self._awaiting_uc())
        calls = []
        orig = wi._run_observation
        wi._run_observation = self._fake_observe("observed", record=calls)
        try:
            findings = self._gate(observe=False)
            code, out = self._run(observe=False)
        finally:
            wi._run_observation = orig
        self.assertEqual(calls, [])                       # never evaluated
        f = [x for x in findings if x["check"] == "awaiting-observation"][0]
        self.assertEqual((f["severity"], f["verdict"]), ("unknown", "not-evaluated"))
        self.assertEqual(code, 0)
        self.assertIn("NOT evaluated", out)
        self.assertIn("UC-ML1", out)
        # the HEADLINE must not read "all preconditions hold" when a thing was not
        # established — that is the same false-clean shape the state exists to stop
        self.assertNotIn("all preconditions hold", out)
        self.assertIn("NOT ESTABLISHED", out)

    def test_predicate_is_re_evaluated_every_run_like_blocked(self):
        """`awaiting_observation` is re-checked EVERY cycle — the predicate is run
        on each invocation, with the declared timeout, never cached."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        self.write_item("active", "UC-ML1", "use-case", self._awaiting_uc())
        calls = []
        orig = wi._run_observation
        wi._run_observation = self._fake_observe("not-yet", record=calls)
        try:
            self._gate()
            self._gate(observe_timeout=9.0)
        finally:
            wi._run_observation = orig
        self.assertEqual([c[1] for c in calls],
                         ["make:probe-genesis-observed"] * 2)
        self.assertEqual(calls[0][2], wi.DEFAULT_OBSERVE_TIMEOUT)
        self.assertEqual(calls[1][2], 9.0)

    def test_amended_observe_replaces_the_predicate_in_effect(self):
        """The predicate in effect is the LAST event carrying one, so a wrong probe
        is corrected by an `amended` — not by editing the historical event."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        evs = self._awaiting_uc(spec="make:probe-old")
        evs.append({"ts": _dt(21, 0), "event": "amended", "agent": "solution-architect",
                    "observe": "make:probe-new", "note": "probe corrected"})
        self.write_item("active", "UC-ML1", "use-case", evs)
        calls = []
        orig = wi._run_observation
        wi._run_observation = self._fake_observe("not-yet", record=calls)
        try:
            self._gate()
        finally:
            wi._run_observation = orig
        self.assertEqual([c[1] for c in calls], ["make:probe-new"])

    # ---- the HONEST fix to check 1: parked-with-a-reason vs nobody-dispatched --
    def test_check1_skips_parked_item_but_still_fires_on_undispatched_one(self):
        """BOTH DIRECTIONS IN ONE RUN. UC-PARKED and UC-NODISPATCH are identical
        (built_green + deployed with a ref, dwelling ~10 days) except that
        UC-PARKED recorded a machine-checkable reason and moved to
        `awaiting_observation`. Check 1 must fire on exactly one of them.

        This is not "exclude the state and move on": the parked item is only
        parked because it carries a predicate the gate re-evaluates every cycle
        (check 5), and the moment that predicate says `observed` the gate BLOCKS
        for the same missing dispatch. Parking cannot be used to hide."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        self.write_item("active", "UC-PARKED", "use-case", self._awaiting_uc(day=20))
        self.write_item("active", "UC-NODISPATCH", "use-case", [
            {"ts": _dt(20, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(20, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(20, 2), "event": "pulled", "agent": "orchestrator"},
            {"ts": _dt(20, 3), "event": "built_green", "agent": "engineer", "ref": "aaa111"},
            {"ts": _dt(20, 4), "event": "deployed", "agent": "cicd", "ref": "bbb222"},
        ])
        findings = self._with_observe("not-yet")
        stalled = [f for f in findings if f["check"] == "stalled-validation"]
        ids = sorted(i for f in stalled for i in f["ids"])
        self.assertEqual(ids, ["UC-NODISPATCH"])          # fires on the real stall
        self.assertNotIn("UC-PARKED", ids)                # not on the honest park
        # ...and UC-PARKED is NOT invisible: it is reported by check 5 in the SAME run
        aw = [f for f in findings if f["check"] == "awaiting-observation"]
        self.assertEqual([f["ids"] for f in aw], [["UC-PARKED"]])
        code, out = self._run_with_observe("not-yet")
        self.assertEqual(code, 2)                          # the real stall blocks
        self.assertIn("UC-NODISPATCH", out)
        self.assertIn("UC-PARKED", out)                    # both named, differently
        self.assertIn("NOT YET OBSERVED", out)

    def test_parked_item_is_not_pullable_and_not_in_flight(self):
        """queue attribution: `awaiting_observation` maps to `waiting`, the same
        class as `blocked` — it is not pullable and not counted as WIP."""
        self.assertEqual(self.graphs.queue_for("awaiting_observation"), "waiting")
        self._policy([("ready", "min_items", 0), ("wip", "wip_limit", 1)])
        self.write_item("active", "UC-ML1", "use-case", self._awaiting_uc())
        findings = self._with_observe("not-yet")
        self.assertNotIn("queue-over-cap", self._checks(findings))

    # ---- the predicate SPEC: narrow, committed, never a shell string ---------
    def test_observe_spec_accepts_a_make_target_with_args(self):
        self.assertEqual(wi.parse_observe_spec("make:probe-x"), ["probe-x"])
        self.assertEqual(
            wi.parse_observe_spec("make:count-event-type AWS_PROFILE=prod-datain "
                                  "OAG_EVENT_STORE_TABLE=OagFeed-EventStore"),
            ["count-event-type", "AWS_PROFILE=prod-datain",
             "OAG_EVENT_STORE_TABLE=OagFeed-EventStore"])

    def test_observe_spec_rejects_shell_and_unknown_schemes(self):
        for bad in ("probe-x",                       # no scheme: never guessed
                    "sh:probe-x",                    # unknown scheme
                    "make:probe-x; rm -rf /",        # shell metacharacter
                    "make:probe-x && echo",
                    "make:probe-x $(id)",
                    "make:probe-x | tee f",
                    "make:", "make: ", "", None,
                    "make:probe-x NOTANARG"):        # bare word, not VAR=VALUE
            with self.assertRaises(ValueError, msg=repr(bad)):
                wi.parse_observe_spec(bad)

    def _probe_makefile(self, body):
        """A REAL Makefile in the temp project, so `_run_observation` is exercised
        against a REAL `make` — see test_run_observation_against_a_real_make."""
        d = os.path.join(self.tmp, "work", self.project)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "Makefile"), "w", encoding="utf-8") as f:
            f.write(body)

    def test_run_observation_against_a_real_make(self):
        """THE PIN THAT WAS MISSING. The first cut of this predicate used a
        three-way EXIT-CODE contract (0/3/other) and its stubbed test passed —
        proving only that the mapping agreed with itself. Against a REAL `make`
        every probe read BROKEN, because **make does not propagate a recipe's exit
        status**: a recipe exiting 3 makes make print "Error 3" and exit 2. So the
        verdict is a SENTINEL LINE on stdout, and this test drives real `make`."""
        self._probe_makefile(
            "yes:\n\t@echo 'OBSERVATION: observed'\n"
            "no:\n\t@echo '0 of 5,308,984 events'\n\t@echo 'OBSERVATION: not-yet'\n"
            "silent:\n\t@echo 'I found some stuff'\n"
            "crashes:\n\t@echo boom >&2; exit 1\n"
            "codeonly:\n\t@exit 3\n"
            "both:\n\t@echo 'OBSERVATION: observed'; echo 'OBSERVATION: not-yet'\n")
        run = lambda t: wi._run_observation(self.project, f"make:{t}")
        self.assertEqual(run("yes")[0], "observed")
        self.assertEqual(run("no")[0], "not-yet")
        # a probe that says something helpful but no VERDICT establishes nothing
        self.assertEqual(run("silent")[0], "broken")
        self.assertEqual(run("crashes")[0], "broken")
        # the founding bug: an exit-3-only probe is BROKEN, never "not yet"
        self.assertEqual(run("codeonly")[0], "broken")
        self.assertEqual(run("both")[0], "broken")          # ambiguous => broken
        # a target that DOES NOT EXIST is broken, never "not observed yet"
        v, detail = run("no-such-target")
        self.assertEqual(v, "broken")
        self.assertIn("No rule to make target", detail)
        # and the not-yet detail carries the probe's own output for the operator
        self.assertIn("5,308,984", run("no")[1])

    def test_run_observation_invokes_the_project_makefile_without_a_shell(self):
        seen = {}

        class R:
            returncode, stdout, stderr = 0, "OBSERVATION: observed", ""

        def fake_run(argv, **kw):
            seen["argv"], seen["kw"] = argv, kw
            return R()

        orig = wi.subprocess.run
        wi.subprocess.run = fake_run
        try:
            self.assertEqual(
                wi._run_observation(self.project,
                                    "make:probe-x AWS_PROFILE=prod-datain")[0],
                "observed")
        finally:
            wi.subprocess.run = orig
        self.assertEqual(seen["argv"],
                         ["make", "-C", os.path.join(self.tmp, "work", self.project),
                          "probe-x", "AWS_PROFILE=prod-datain"])
        self.assertNotIn("shell", seen["kw"])       # argv list, never a shell string

    def test_run_observation_malformed_spec_is_broken_never_executed(self):
        called = []
        orig = wi.subprocess.run
        wi.subprocess.run = lambda *a, **k: called.append(a)
        try:
            verdict, detail = wi._run_observation(self.project, "make:x; rm -rf /")
        finally:
            wi.subprocess.run = orig
        self.assertEqual(verdict, "broken")
        self.assertEqual(called, [])
        self.assertIn("spec", detail.lower())

    def test_run_observation_timeout_is_broken_not_not_yet(self):
        def boom(argv, **kw):
            raise wi.subprocess.TimeoutExpired(argv, kw.get("timeout"))
        orig = wi.subprocess.run
        wi.subprocess.run = boom
        try:
            verdict, detail = wi._run_observation(self.project, "make:probe-x",
                                                  timeout=5)
        finally:
            wi.subprocess.run = orig
        self.assertEqual(verdict, "broken")
        self.assertIn("timeout", detail.lower())

    # ---- check 6: the test-requirement gate (§17d, human ruling 2026-08-02) --
    #
    # These drive the REAL `.claude/tools/test-requirement-gate.js` over REAL test
    # sources written into the temp tree. Nothing is stubbed — stubbing the exec
    # boundary here would be founding-evidence instance 2 reproduced inside the
    # check that exists to catch it, and the gate's own exec-boundary rule would
    # (rightly) flag this file for it.

    def _trg_config(self, cfg):
        d = os.path.join(self.tmp, ".claude", "config", "test-requirement-gate")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, f"{self.project}.json"), "w", encoding="utf-8") as f:
            json.dump(cfg, f)

    def _trg_tests(self, name, body):
        d = os.path.join(self.tmp, "work", self.project, "src", "tests")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, name), "w", encoding="utf-8") as f:
            f.write(body)

    def _trg_scaffold(self, baseline_ac, cases):
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        self._trg_config({
            "project": self.project, "mode": "ratchet",
            "roots": [{"path": f"work/{self.project}/src", "limbs": ["ac", "authored"]}],
            "baseline": {"ac": baseline_ac, "authored": 0},
        })
        self._trg_tests("a.test.ts",
                        "describe('g', () => {\n"
                        + "".join(f"  it('case {i}', () => {{}})\n" for i in range(cases))
                        + "})\n")

    def test_trg_at_baseline_is_advisory_and_never_blocks(self):
        self._trg_scaffold(baseline_ac=2, cases=2)
        findings = self._gate()
        self.assertNotIn("test-requirement-gate", self._checks(findings))
        adv = [f for f in self._advisories(findings) if f["check"] == "test-requirement-gate"]
        self.assertEqual(len(adv), 1, findings)
        self.assertEqual(adv[0]["verdict"], "PASS")
        self.assertEqual(adv[0]["ac"], 2)
        code, out = self._run()
        self.assertEqual(code, 0)
        self.assertIn("test-requirement-gate", out)

    def test_trg_regression_above_baseline_BLOCKS_the_pull(self):
        """A NEW untagged test case landed. Stopping the line relieves exactly that
        harm (§F8a), so unlike the standing debt this one blocks."""
        self._trg_scaffold(baseline_ac=2, cases=3)
        findings = self._gate()
        self.assertIn("test-requirement-gate", self._checks(findings))
        f = [x for x in findings if x["check"] == "test-requirement-gate"][0]
        self.assertEqual(f["verdict"], "FAIL")
        self.assertEqual(f["ac"], 3)
        code, out = self._run()
        self.assertEqual(code, 2)
        self.assertIn("test-requirement-gate", out)

    def test_trg_limb2_authored_precondition_BLOCKS(self):
        """The founding shape, end to end through the loop gate: a real capture with
        a leaf deleted off it."""
        self._trg_scaffold(baseline_ac=0, cases=0)
        self._trg_tests("b.test.ts",
                        "import { readConfirmingRecords } from '../src/adapters/fixture-corpus-reader.js'\n"
                        "const record = readConfirmingRecords()[0]\n"
                        "describe('AC-X.1 g', () => {\n"
                        "  it('one', () => { delete record.statusDetails })\n"
                        "})\n")
        findings = self._gate()
        self.assertIn("test-requirement-gate", self._checks(findings))
        f = [x for x in findings if x["check"] == "test-requirement-gate"][0]
        self.assertEqual(f["authored"], 1)
        self.assertIn("delete-on-real-capture", f["message"])

    def test_trg_absent_config_is_reported_NOT_ESTABLISHED_never_silent(self):
        """A project with no gate config must not read as satisfied — the whole
        §F8a point is that an unevaluated precondition is not a met one."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        findings = self._gate()
        f = [x for x in findings if x["check"] == "test-requirement-gate"]
        self.assertEqual(len(f), 1, findings)
        self.assertEqual(f[0]["severity"], "unknown")
        self.assertEqual(f[0]["verdict"], "NOT-CONFIGURED")
        code, out = self._run()
        self.assertEqual(code, 0)
        self.assertIn("NOT ESTABLISHED", out)

    def test_trg_unrunnable_tool_is_unknown_never_a_silent_pass(self):
        """If the analyser cannot run at all, that is a thing this cycle FAILED TO
        ESTABLISH. It must never be indistinguishable from clean."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        self._trg_config({"project": self.project, "mode": "ratchet", "roots": []})
        orig = wi.TRG_SCRIPT
        wi.TRG_SCRIPT = os.path.join(self.tmp, "no-such-tool.js")
        try:
            findings = self._gate()
        finally:
            wi.TRG_SCRIPT = orig
        f = [x for x in findings if x["check"] == "test-requirement-gate"][0]
        self.assertEqual(f["severity"], "unknown")
        self.assertEqual(f["verdict"], "UNRUNNABLE")

    # ---- check 7: unrecoverable work in a worktree (DEFECT-OAG-076) ---------
    #
    # DEFECT-OAG-072 was delivered complete and DESTROYED by a worktree auto-clean
    # (`git cat-file -t fb080d9` => `fatal: Not a valid object name`). The loop is
    # the only continuously-running workflow, so it is where the detection has to
    # hang: work that exists nowhere else must be found while the objects still
    # exist, not after they are gone. These drive the REAL guard over a REAL git
    # topology built in the temp tree — nothing is stubbed.

    def _git(self, repo, *args):
        subprocess.run(["git", "-C", repo, *args], check=True,
                       capture_output=True, text=True)

    def _init_repo(self, d):
        os.makedirs(d, exist_ok=True)
        subprocess.run(["git", "init", "-q", "-b", "main", d], check=True,
                       capture_output=True, text=True)
        self._git(d, "config", "user.email", "a@b.test")
        self._git(d, "config", "user.name", "A")
        self._git(d, "config", "commit.gpgsign", "false")
        return d

    def _write_file(self, root, rel, text):
        p = os.path.join(root, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            f.write(text)

    def _parent_topology(self):
        """The real shape: a parent repo that gitignores each project's own nested
        repo, plus a worktree that therefore does NOT contain it."""
        parent = self._init_repo(os.path.join(self.tmp, "parent"))
        self._write_file(parent, ".gitignore", "/work/*/\n")
        self._write_file(parent, "CLAUDE.md", "agent system\n")
        self._git(parent, "add", "-A")
        self._git(parent, "commit", "-q", "-m", "base")
        proj = self._init_repo(os.path.join(parent, "work", "DemoProject"))
        self._write_file(proj, "src/a.ts", "a\n")
        self._git(proj, "add", "-A")
        self._git(proj, "commit", "-q", "-m", "project base")
        wt = os.path.join(self.tmp, "agent-wt")
        self._git(parent, "worktree", "add", "-q", wt, "-b", "worktree-agent-1", "main")
        return parent, proj, wt

    def test_worktree_guard_clean_tree_produces_no_finding(self):
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        parent, _proj, _wt = self._parent_topology()
        orig, wi.ROOT = wi.ROOT, parent
        try:
            findings = self._gate()
        finally:
            wi.ROOT = orig
        self.assertNotIn("worktree-guard",
                         [f["check"] for f in findings])

    def test_worktree_guard_unrecoverable_work_BLOCKS_the_pull(self):
        """The fb080d9 shape: an agent with no project repo in its worktree cloned
        one in and committed there. Stopping the loop relieves exactly that harm —
        the objects are still on disk and can be rescued (§F8a)."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        parent, proj, wt = self._parent_topology()
        clone = os.path.join(wt, "work", "DemoProject")
        subprocess.run(["git", "clone", "-q", proj, clone], check=True,
                       capture_output=True, text=True)
        self._git(clone, "config", "user.email", "a@b.test")
        self._git(clone, "config", "user.name", "A")
        self._write_file(clone, "src/delivered.ts", "delivered\n")
        self._git(clone, "add", "-A")
        self._git(clone, "commit", "-q", "-m", "the work that would be destroyed")

        orig, wi.ROOT = wi.ROOT, parent
        try:
            findings = self._gate()
            f = [x for x in findings if x["check"] == "worktree-guard"]
            self.assertEqual(len(f), 1, findings)
            self.assertEqual(f[0]["severity"], "block")
            self.assertIn("agent-wt", f[0]["message"])
            code, out = self._run()
        finally:
            wi.ROOT = orig
        self.assertEqual(code, 2)
        self.assertIn("worktree-guard", out)

    def test_worktree_guard_unrunnable_is_unknown_never_a_silent_pass(self):
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        parent, _proj, _wt = self._parent_topology()
        orig_root, wi.ROOT = wi.ROOT, parent
        orig_script, wi.WTG_SCRIPT = wi.WTG_SCRIPT, os.path.join(self.tmp, "nope.js")
        try:
            findings = self._gate()
        finally:
            wi.ROOT, wi.WTG_SCRIPT = orig_root, orig_script
        f = [x for x in findings if x["check"] == "worktree-guard"]
        self.assertEqual(len(f), 1, findings)
        self.assertEqual(f[0]["severity"], "unknown")
        self.assertIn("NOT ESTABLISHED", f[0]["message"])

    # ---- check 8: orphaned local containers (DEFECT-OAG-091) -----------------
    #
    # THE HARM. EXP-133 gave every dispatch its own DynamoDB Local container and
    # shipped no reaper, so a dying agent leaks its container forever. Measured
    # 2026-08-10T23:31Z: load 19.85, thirteen orphaned OAG containers (ten of them
    # 2 DAYS old), a two-file test run at 301 SECONDS that took 877ms after reaping
    # — 340x — and four consecutive agent deaths that had been blamed on the agents.
    #
    # WHY IT HANGS HERE. §17e: a reaper nobody invokes is the same class of failure
    # as the missing one. The loop is the only continuously-running workflow, so the
    # gate is where the reap has to happen — BEFORE every pull, automatically, never
    # on request. That is also why check 8 REAPS rather than merely scanning.
    #
    # SEAM. These cases substitute the delegated SCRIPT (as checks 6 and 7 already
    # do) because the claim under test is the finding's SEVERITY and MESSAGE — that
    # orphans never block the pull and that an unrunnable reaper is never silent.
    # What the reaper does to real docker objects is pinned against REAL containers
    # in .claude/tools/container-reap.test.js, not here.
    def _fake_creap(self, payload, argv_log=None, exit_code=0):
        js = os.path.join(self.tmp, "fake-creap.js")
        log = argv_log or os.path.join(self.tmp, "creap-argv.json")
        with open(js, "w", encoding="utf-8") as f:
            f.write("require('fs').writeFileSync(%s, JSON.stringify(process.argv.slice(2)));\n"
                    % json.dumps(log))
            f.write("console.log(JSON.stringify(%s));\n" % json.dumps(payload))
            f.write("process.exit(%d);\n" % exit_code)
        return js, log

    def _gate_with_creap(self, payload, **kw):
        js, log = self._fake_creap(payload)
        orig, wi.CREAP_SCRIPT = wi.CREAP_SCRIPT, js
        try:
            findings = self._gate(**kw)
        finally:
            wi.CREAP_SCRIPT = orig
        with open(log, encoding="utf-8") as f:
            argv = json.load(f)
        return findings, argv

    def _creap(self, findings):
        return [f for f in findings if f["check"] == "container-reap"]

    def test_container_reap_orphans_are_an_ADVISORY_and_never_block_the_pull(self):
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        findings, _argv = self._gate_with_creap({
            "verdict": "OK", "orphanCount": 13, "establishedProbe": "ok",
            "reap": {"containers": ["oag-dynamodb-local-defect-051"], "networks": []},
            "removed": {"containers": ["oag-dynamodb-local-defect-051"],
                        "networks": ["oag-dynamodb-local-defect-051_default"]},
            "failed": [], "owned": {"containers": 4, "running": 3},
        })
        f = self._creap(findings)
        self.assertEqual(len(f), 1, findings)
        self.assertEqual(f[0]["severity"], "advisory")
        self.assertIn("1 container", f[0]["message"])
        self.assertIn("1 network", f[0]["message"])
        self.assertNotIn("container-reap", self._checks(findings))

    def test_container_reap_runs_the_REAPER_not_merely_a_scan(self):
        """§17e — the whole point. A gate that only counted orphans would leave the
        removal to the same agent discipline that leaked them."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        _findings, argv = self._gate_with_creap({
            "verdict": "OK", "orphanCount": 0, "establishedProbe": "ok",
            "reap": {"containers": [], "networks": []},
            "removed": {"containers": [], "networks": []}, "failed": [],
            "owned": {"containers": 0, "running": 0},
        })
        self.assertEqual(argv[0], "reap",
                         "the loop-gate must REAP, not merely scan: %s" % argv)
        self.assertIn("--project", argv)
        self.assertIn(self.project, argv)

    def test_container_reap_clean_machine_produces_no_finding(self):
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        findings, _argv = self._gate_with_creap({
            "verdict": "OK", "orphanCount": 0, "establishedProbe": "ok",
            "reap": {"containers": [], "networks": []},
            "removed": {"containers": [], "networks": []}, "failed": [],
            "owned": {"containers": 1, "running": 1},
        })
        self.assertEqual(self._creap(findings), [])

    def test_container_reap_failed_removal_is_reported_not_swallowed(self):
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        findings, _argv = self._gate_with_creap({
            "verdict": "OK", "orphanCount": 1, "establishedProbe": "unavailable",
            "reap": {"containers": ["oag-dynamodb-local-x"], "networks": []},
            "removed": {"containers": [], "networks": []},
            "failed": [{"kind": "container", "name": "oag-dynamodb-local-x",
                        "err": "device or resource busy"}],
            "owned": {"containers": 1, "running": 1},
        })
        f = self._creap(findings)
        self.assertEqual(len(f), 1, findings)
        self.assertIn("FAILED", f[0]["message"])
        self.assertIn("oag-dynamodb-local-x", f[0]["message"])
        # a failed removal still must not stop the line (§F8a)
        self.assertEqual(f[0]["severity"], "advisory")

    def test_container_reap_unrunnable_is_unknown_never_a_silent_pass(self):
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        orig, wi.CREAP_SCRIPT = wi.CREAP_SCRIPT, os.path.join(self.tmp, "nope.js")
        try:
            findings = self._gate()
        finally:
            wi.CREAP_SCRIPT = orig
        f = self._creap(findings)
        self.assertEqual(len(f), 1, findings)
        self.assertEqual(f[0]["severity"], "unknown")
        self.assertIn("NOT ESTABLISHED", f[0]["message"])

    def test_container_reap_not_configured_is_unknown_never_clean(self):
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        findings, _argv = self._gate_with_creap({
            "verdict": "NOT-CONFIGURED", "orphanCount": None,
            "message": "no container-reap config for TestProj",
            "reap": {"containers": [], "networks": []},
            "removed": {"containers": [], "networks": []}, "failed": [],
        })
        f = self._creap(findings)
        self.assertEqual(len(f), 1, findings)
        self.assertEqual(f[0]["severity"], "unknown")
        self.assertIn("NOT ESTABLISHED", f[0]["message"])

    # ---- check 14: an in-progress git operation ARMED in a shared tree ------
    #
    # (OI-ABANDONED-SEQUENCER-STATE-ARMS-A-56-COMMIT-DESTRUCTION, AC-SEQ.2.)
    # `.git/sequencer` sat in the SHARED work/OagEventSource tree for six hours
    # holding a two-step revert todo whose saved head was FIFTY-SIX commits behind
    # HEAD — the whole output of seven agents in one session — and `git revert
    # --abort` rewinds to it. `git status --porcelain` reports NOTHING about it, so
    # every cleanliness check in this system, including this gate, passed with it
    # armed; it was found once, by a tester noticing it as an aside.
    #
    # WHY IT HANGS HERE. The loop is the only continuously-running workflow, so it
    # is the only place the state is looked at before the next wave of dispatches
    # adds more commits to the pile at stake — and the pile GROWS here by design,
    # because the prescribed shared-tree commit path (isolated-commit.js:
    # commit-tree + ref CAS) never clears branch state the way `git commit` does.
    #
    # The first two cases drive the REAL analyser over a REAL planted sequencer in
    # a REAL two-repo topology — nothing is stubbed, and the state is planted only
    # ever in a temp tree (arming one in the shared tree is the hazard itself). The
    # rest substitute the script, as checks 6/7/8 do, because their claim is about
    # the finding's SEVERITY and MESSAGE.

    def _plant_stale_sequencer(self, repo, n_after=5):
        """A REAL stopped revert sequencer, then `n_after` commits landing on top of
        it the way agents actually commit here (commit-tree + ref CAS, which unlike
        `git commit` never clears branch state — exactly why the founding state
        survived 56 commits). Returns (saved_head, [shas at stake])."""
        def w(rel, text):
            path = os.path.join(repo, rel)
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)

        def c(msg):
            self._git(repo, "add", "-A")
            self._git(repo, "commit", "-q", "-m", msg)
            return subprocess.run(["git", "-C", repo, "rev-parse", "HEAD"],
                                  check=True, capture_output=True,
                                  text=True).stdout.strip()

        self._init_repo(repo)
        w("f.txt", "A\n")
        w("o.txt", "x\n")
        c("c1")
        w("f.txt", "B\n")
        c_f = c("cF")
        w("o.txt", "x\ny\n")
        c_o = c("cO")
        w("f.txt", "C\n")
        c("cLater")
        # cO reverts cleanly, cF then CONFLICTS: the sequencer stops and stays.
        r = subprocess.run(["git", "-C", repo, "revert", "--no-edit", c_o, c_f],
                           capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0, "the revert was meant to conflict")
        seq = os.path.join(repo, ".git", "sequencer")
        self.assertTrue(os.path.isdir(seq), "no sequencer planted")
        with open(os.path.join(seq, "head"), encoding="utf-8") as f:
            saved = f.read().strip()
        # tidy the tree WITHOUT `git reset`, which would clear the very state we plant
        self._git(repo, "checkout", "-q", "HEAD", "--", "f.txt")
        after = []
        for i in range(1, n_after + 1):
            w("agent%d.txt" % i, "work %d\n" % i)
            self._git(repo, "add", "--", "agent%d.txt" % i)
            tree = subprocess.run(["git", "-C", repo, "write-tree"], check=True,
                                  capture_output=True, text=True).stdout.strip()
            parent = subprocess.run(["git", "-C", repo, "rev-parse", "HEAD"],
                                    check=True, capture_output=True,
                                    text=True).stdout.strip()
            sha = subprocess.run(["git", "-C", repo, "commit-tree", tree, "-p",
                                  parent, "-m", "agent commit %d" % i], check=True,
                                 capture_output=True, text=True).stdout.strip()
            self._git(repo, "update-ref", "refs/heads/main", sha)
            after.append(sha)
        return saved, after

    def _seqg(self, findings):
        return [f for f in findings if f["check"] == "sequencer-guard"]

    def test_sequencer_guard_clean_tree_produces_no_finding(self):
        """AC-SEQ.2 — the differential arm: the check is not a blanket alarm."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        parent, proj, _wt = self._parent_topology()
        orig, wi.ROOT = wi.ROOT, parent
        try:
            findings = self._gate()
        finally:
            wi.ROOT = orig
        self.assertEqual(self._seqg(findings), [])

    def test_sequencer_guard_armed_state_in_the_NESTED_repo_BLOCKS_and_names_the_count(self):
        """AC-SEQ.2 — the founding shape end to end: the state is in the NESTED
        project repo (a parent-only sweep would see nothing), it is INVISIBLE to
        `git status --porcelain`, and the finding carries the COUNT — because
        "state present" is ignorable and "N commits at stake" is not."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        parent, proj, _wt = self._parent_topology()
        saved, after = self._plant_stale_sequencer(proj, n_after=5)
        porcelain = subprocess.run(["git", "-C", proj, "status", "--porcelain"],
                                   check=True, capture_output=True, text=True)
        self.assertEqual(porcelain.stdout.strip(), "",
                         "the whole point: this state is invisible to porcelain")
        truth = int(subprocess.run(
            ["git", "-C", proj, "rev-list", "--count", "%s..HEAD" % saved],
            check=True, capture_output=True, text=True).stdout.strip())
        self.assertEqual(truth, len(after) + 1)

        orig, wi.ROOT = wi.ROOT, parent
        try:
            findings = self._gate()
            f = self._seqg(findings)
            self.assertEqual(len(f), 1, findings)
            self.assertEqual(f[0]["severity"], "block")
            self.assertEqual(f[0]["worst_discard"], truth)
            self.assertIn("%d commit(s) would be made unreachable" % truth,
                          f[0]["message"])
            self.assertIn("--quit", f[0]["message"])
            code, out = self._run()
        finally:
            wi.ROOT = orig
        self.assertEqual(code, 2)
        self.assertIn("sequencer-guard", out)

    def _fake_seqg(self, payload, exit_code=0):
        js = os.path.join(self.tmp, "fake-seqg.js")
        log = os.path.join(self.tmp, "seqg-argv.json")
        with open(js, "w", encoding="utf-8") as f:
            f.write("require('fs').writeFileSync(%s, JSON.stringify(process.argv.slice(2)));\n"
                    % json.dumps(log))
            f.write("console.log(JSON.stringify(%s));\n" % json.dumps(payload))
            f.write("process.exit(%d);\n" % exit_code)
        return js, log

    def _gate_with_seqg(self, payload, **kw):
        js, log = self._fake_seqg(payload)
        orig, wi.SEQG_SCRIPT = wi.SEQG_SCRIPT, js
        try:
            findings = self._gate(**kw)
        finally:
            wi.SEQG_SCRIPT = orig
        with open(log, encoding="utf-8") as f:
            argv = json.load(f)
        return findings, argv

    def _state(self, kind="sequencer", discard=0, age_s=10, armed=False, quit_="revert --quit"):
        return {"kind": kind, "verb": "revert", "discard": discard, "ageS": age_s,
                "armedNow": armed, "quit": quit_, "stale": False}

    def test_sequencer_guard_fresh_with_nothing_at_stake_is_ADVISORY(self):
        """AC-SEQ.2 — §F8a: a conflicted merge someone is resolving RIGHT NOW
        discards no commits (measured), so stopping the line for it would be
        perverse. It is still printed, so it can never read as satisfied."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        findings, _argv = self._gate_with_seqg({
            "verdict": "ADVISORY", "worstDiscard": 0, "unmeasured": 0,
            "repos": [{"dir": "/tmp/x", "states": [
                self._state(kind="MERGE_HEAD", discard=0, quit_="merge --quit")]}],
        })
        f = self._seqg(findings)
        self.assertEqual(len(f), 1, findings)
        self.assertEqual(f[0]["severity"], "advisory")
        self.assertNotIn("sequencer-guard", self._checks(findings))
        self.assertIn("merge --quit", f[0]["message"])

    def test_sequencer_guard_unmeasurable_state_fails_CLOSED(self):
        """AC-SEQ.2 — a count we could not establish is not a count of zero
        (§17c.2). It blocks, and it says which limb was unmeasured."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        findings, _argv = self._gate_with_seqg({
            "verdict": "BLOCK", "worstDiscard": 0, "unmeasured": 1,
            "repos": [{"dir": "/tmp/x", "states": [self._state(discard=None)]}],
        })
        f = self._seqg(findings)
        self.assertEqual(len(f), 1, findings)
        self.assertEqual(f[0]["severity"], "block")
        self.assertIn("could not be measured", f[0]["message"])
        self.assertIn("NOT ESTABLISHED", f[0]["message"])
        self.assertIn("sequencer-guard", self._checks(findings))

    def test_sequencer_guard_is_READ_ONLY_never_a_writing_verb(self):
        """AC-SEQ.2 — unlike check 8 this one must NOT self-heal: clearing the state
        needs someone to establish what it DESCRIBES first (the founding operator
        verified a8bd0dee had already completed the revert). A gate that could run
        `--abort` would be the destruction it exists to prevent."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        _findings, argv = self._gate_with_seqg({
            "verdict": "CLEAN", "worstDiscard": 0, "unmeasured": 0, "repos": []})
        self.assertEqual(argv[0], "scan", "the only permitted verb: %s" % argv)
        for forbidden in ("--abort", "--quit", "--continue", "reset", "clear", "reap"):
            self.assertNotIn(forbidden, argv)

    def test_sequencer_guard_unrunnable_is_unknown_never_a_silent_pass(self):
        """AC-SEQ.2 — an unevaluated precondition is not a met one (§17c.2), and
        this state is invisible to everything else, so silence here is total."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        orig, wi.SEQG_SCRIPT = wi.SEQG_SCRIPT, os.path.join(self.tmp, "nope.js")
        try:
            findings = self._gate()
        finally:
            wi.SEQG_SCRIPT = orig
        f = self._seqg(findings)
        self.assertEqual(len(f), 1, findings)
        self.assertEqual(f[0]["severity"], "unknown")
        self.assertIn("NOT ESTABLISHED", f[0]["message"])

    # ---- check 9: a file a committed make target RUNS must be on trunk -------
    #
    # (OI-GITIGNORE-SWALLOWS-COMMITTED-TOOLS, AC-GI.3.) A blanket .gitignore on
    # `src/app/scripts/*.mjs` silently swallowed a committed tool SIX times in one
    # project: tool written, make target wired, `git add` says nothing, suite green,
    # tool on exactly one machine. The DEF-ROC-001 / v89 FALSE GREEN — nothing goes red
    # because nothing was looking, and the remedy had become "append a negation line",
    # so the negation list became a written record of the trap firing.
    #
    # It hangs HERE because the loop is the only continuously-running workflow (as
    # checks 6, 7 and 8 already are), and because it finds the omission WHILE THE FILE
    # STILL EXISTS ON DISK — one `git add` from safe. It also CANNOT hang in the
    # project's own CI: the analyser lives in the agent-system repo, which a project
    # clone does not contain.
    #
    # SEVERITY, per §F8a ("a gate blocks only on harm that stopping relieves"):
    #   untracked -> BLOCK. The file exists on someone's disk right now; pulling more
    #        work is how it gets lost, and the remedy is one command.
    #   dangling  -> ADVISORY. The file is already gone; stopping recovers nothing.
    #   unrunnable -> UNKNOWN. Never silent (§17c.2) — "clean" being indistinguishable
    #        from "did not run" IS the shape of the defect.
    #
    # NOTHING IS STUBBED HERE. These drive the REAL .claude/tools/make-refs-tracked.js
    # against a REAL git repo with a REAL index and REAL ignore rules, because the
    # claim is "the loop gate goes red on an untracked tool" and the git index is the
    # seam that claim is ABOUT (§17d limb 2). An earlier draft substituted the script
    # and passed while `cmd_loop_gate` — which re-invokes the real analyser — still
    # exited 0. Stubbing would have shipped a wiring that never fired.

    def _mrt_repo(self, makefile, present=(), tracked=(), gitignore=None):
        """A REAL git repo at work/<project>: real files, real index, real ignores."""
        repo = os.path.join(self.tmp, "work", self.project)
        os.makedirs(repo, exist_ok=True)
        with open(os.path.join(repo, "Makefile"), "w", encoding="utf-8") as f:
            f.write(makefile)
        if gitignore is not None:
            with open(os.path.join(repo, ".gitignore"), "w", encoding="utf-8") as f:
                f.write(gitignore)
        for rel in set(present) | set(tracked):
            p = os.path.join(repo, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                f.write("// a committed tool\n")

        def git(*args):
            subprocess.run(["git", "-C", repo, *args], check=True,
                           capture_output=True, text=True)
        git("init", "-q")
        git("config", "user.email", "t@t")
        git("config", "user.name", "t")
        git("add", "Makefile", *(([".gitignore"] if gitignore is not None else [])))
        for rel in tracked:
            git("add", "-f", rel)
        git("commit", "-qm", "scaffold")
        return repo

    def _mrt(self, findings):
        return [f for f in findings if f["check"] == "make-refs-tracked"]

    def _mrt_scaffold(self):
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))

    def test_mrt_untracked_tool_BLOCKS_the_pull(self):
        """The file is on a disk RIGHT NOW and one `git add` from safe. Stopping the
        line relieves exactly that harm (§F8a), so this one blocks."""
        self._mrt_scaffold()
        self._mrt_repo(
            "capture:\n\tnode scripts/capture-ddb-stream-records.mjs\n",
            present=["scripts/capture-ddb-stream-records.mjs"],
            gitignore="scripts/*.mjs\n")
        findings = self._gate()
        self.assertIn("make-refs-tracked", self._checks(findings))
        f = self._mrt(findings)[0]
        self.assertEqual(f["severity"], "block")
        self.assertEqual(f["untracked"], 1)
        self.assertIn("capture-ddb-stream-records.mjs", f["message"])
        code, out = self._run()
        self.assertEqual(code, 2)
        self.assertIn("make-refs-tracked", out)

    def test_mrt_the_same_tool_committed_is_clean(self):
        """The discriminating other half: identical repo, file tracked -> no finding.
        Without this the block above could be firing on something else entirely."""
        self._mrt_scaffold()
        self._mrt_repo(
            "capture:\n\tnode scripts/capture-ddb-stream-records.mjs\n",
            tracked=["scripts/capture-ddb-stream-records.mjs"],
            gitignore="scripts/*.mjs\n")
        findings = self._gate()
        self.assertEqual(self._mrt(findings), [], findings)
        code, _out = self._run()
        self.assertEqual(code, 0)

    def test_mrt_dangling_ref_is_ADVISORY_and_never_blocks(self):
        """The file is already gone, so stopping recovers nothing — but it is reported
        every cycle so a dead target cannot quietly become normal."""
        self._mrt_scaffold()
        self._mrt_repo("sync:\n\tpython3 scripts/sync-linear.py --dry-run\n")
        findings = self._gate()
        self.assertNotIn("make-refs-tracked", self._checks(findings))
        adv = [f for f in self._advisories(findings) if f["check"] == "make-refs-tracked"]
        self.assertEqual(len(adv), 1, findings)
        self.assertEqual(adv[0]["dangling"], 1)
        self.assertIn("sync-linear.py", adv[0]["message"])
        code, out = self._run()
        self.assertEqual(code, 0)
        self.assertIn("make-refs-tracked", out)

    def test_mrt_untracked_blocks_even_when_a_dangling_ref_is_also_present(self):
        """A mixed verdict must take the WORST severity, not the first one seen."""
        self._mrt_scaffold()
        self._mrt_repo(
            "a:\n\tnode scripts/here.mjs\nb:\n\tpython3 scripts/gone.py\n",
            present=["scripts/here.mjs"], gitignore="scripts/*.mjs\n")
        findings = self._gate()
        self.assertIn("make-refs-tracked", self._checks(findings))
        f = self._mrt(findings)[0]
        self.assertEqual(f["severity"], "block")
        self.assertEqual((f["untracked"], f["dangling"]), (1, 1))
        self.assertIn("gone.py", f["message"], "the advisory limb must still be reported")

    def test_mrt_generated_artifact_is_not_a_finding(self):
        """The exemption is DERIVED from a committed generator's --outfile=, never a
        hand-kept list — a hand-kept list is the negation list this item deletes."""
        self._mrt_scaffold()
        self._mrt_repo(
            "build:\n\tesbuild src/main.ts --outfile=build/main.mjs\nrun:\n\tnode build/main.mjs\n",
            present=["build/main.mjs"], tracked=["src/main.ts"],
            gitignore="build/\n")
        findings = self._gate()
        self.assertEqual(self._mrt(findings), [], findings)

    def test_mrt_unrunnable_is_unknown_never_a_silent_pass(self):
        """An unevaluated precondition is not a met one (§17c.2). A checker that cannot
        run must not be indistinguishable from a clean one — that asymmetry IS the
        shape of the defect this check exists for."""
        self._mrt_scaffold()
        orig = wi.MRT_SCRIPT
        wi.MRT_SCRIPT = os.path.join(self.tmp, "not-a-script.js")   # does not exist
        try:
            findings = self._gate()
        finally:
            wi.MRT_SCRIPT = orig
        f = self._mrt(findings)
        self.assertEqual(len(f), 1, findings)
        self.assertEqual(f[0]["severity"], "unknown")
        self.assertIn("NOT ESTABLISHED", f[0]["message"])
        self.assertNotIn("make-refs-tracked", self._checks(findings))

    # ---- check 10: acceptance-audit (OI-ACCEPTANCE-PARSER-SCORES-ZERO-SILENTLY)
    # Every fixture below is a REAL item file copied VERBATIM out of the live corpus.
    # Authoring one would be authoring the precondition (§17d.2): the whole claim is
    # about what real item text does to the parser.
    def _accept(self, findings):
        return [f for f in findings if f["check"] == "acceptance-audit"]

    def _copy_real_item(self, iid):
        for sub in ("active", "done"):
            src = os.path.join(self._orig_root, "work", "OagEventSource", "items", sub,
                               iid + ".md")
            if os.path.exists(src):
                shutil.copy2(src, os.path.join(self._items("active"), iid + ".md"))
                return
        self.skipTest("real item %s not present; fixture must be harvested" % iid)

    def _declared(self, payload):
        d = os.path.join(self.tmp, ".claude", "tools")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "acceptance-audit-declared.json"), "w") as fh:
            fh.write(payload)

    def test_acceptance_audit_blocks_on_a_real_unreadable_item(self):
        """AC-AP.1 — a zero must be LOUD, and it must block BEFORE the next pull: the
        pull is the moment an agent acts on 'this item has no acceptance'."""
        self._copy_real_item("UC-GSA2")
        self._declared('{"declared": {}}')
        f = self._accept(self._gate())
        self.assertEqual(len(f), 1, f)
        self.assertEqual(f[0]["severity"], "block")
        self.assertIn("UC-GSA2", f[0]["ids"])
        self.assertIn("PRESENT but not fully readable", f[0]["message"])

    def test_acceptance_audit_blocks_on_a_real_truncated_item_naming_the_lost_id(self):
        """The residual self-check: DEFECT-OAG-062 registered AC-062.6/AC-062.7 in an
        event and never added them to its acceptance list. A count could not say so."""
        self._copy_real_item("DEFECT-OAG-062")
        self._declared('{"declared": {}}')
        f = self._accept(self._gate())
        self.assertEqual(len(f), 1, f)
        self.assertIn("DEFECT-OAG-062", f[0]["ids"])

    def test_acceptance_audit_is_clean_when_a_real_item_parses(self):
        """Non-vacuity in the other direction — it is not a check that always fires.
        DEFECT-OAG-053's fifteen registered criteria live in a table under a level-3
        sub-heading, which is precisely what used to terminate the section."""
        self._copy_real_item("DEFECT-OAG-053")
        self._declared('{"declared": {}}')
        self.assertEqual(self._accept(self._gate()), [])

    def test_acceptance_audit_declared_row_needs_an_authority(self):
        """§17h limb 1 — an exclusion with no authority is a FINDING, not a sample."""
        self._copy_real_item("UC-GSA2")
        self._declared('{"declared": {"UC-GSA2": {"status": "unenumerated"}}}')
        f = self._accept(self._gate())
        self.assertEqual(len(f), 1, f)
        self.assertEqual(f[0]["severity"], "block")

    def test_acceptance_audit_declared_with_authority_clears_the_block(self):
        self._copy_real_item("UC-GSA2")
        self._declared('{"declared": {"UC-GSA2": {"status": "unenumerated",'
                       ' "authority": "delta-054 section 15"}}}')
        self.assertEqual(self._accept(self._gate()), [])

    def test_acceptance_audit_unrunnable_is_unknown_never_a_silent_pass(self):
        """An unevaluated precondition is not a met one (§17c.2) — and for THIS check
        the asymmetry is the defect itself: a clean answer indistinguishable from no
        answer is exactly how a tree-wide zero survived."""
        self._copy_real_item("UC-GSA2")
        self._declared('{"declared": {}}')
        orig = wi.ACCEPTANCE_AUDIT_SCRIPT
        wi.ACCEPTANCE_AUDIT_SCRIPT = os.path.join(self.tmp, "not-a-script.py")
        try:
            f = self._accept(self._gate())
        finally:
            wi.ACCEPTANCE_AUDIT_SCRIPT = orig
        self.assertEqual(len(f), 1, f)
        self.assertEqual(f[0]["severity"], "unknown")
        self.assertIn("NOT ESTABLISHED", f[0]["message"])

    def test_acceptance_audit_asks_about_the_CALLER_root_not_its_own(self):
        """The analyser resolves the corpus from its own file location by default. If
        the check did not pass --root, it would sweep the REAL repo while the caller
        points elsewhere — a check answering about the wrong population, which is the
        same silent-wrong-answer class it exists to catch."""
        self._declared('{"declared": {}}')          # empty temp corpus, no items
        self.assertEqual(self._accept(self._gate()), [])

    # ---- policy.csv handling ------------------------------------------------
    def test_missing_policy_csv_uses_documented_defaults(self):
        # no policy.csv at all -> the §F2 seed defaults (ready 3/4, intake 2/10)
        self.write_item("active", "UC-R0", "use-case", self._ready_uc(10))
        f = [x for x in self._gate() if x["check"] == "ready-below-floor"][0]
        self.assertEqual(f["floor"], 3)

    def test_policy_csv_is_read_not_hardcoded(self):
        self._policy([("ready", "min_items", 1)])
        self.write_item("active", "UC-R0", "use-case", self._ready_uc(10))
        self.assertNotIn("ready-below-floor", self._checks(self._gate()))

    def test_read_queue_policy_parses_rows(self):
        self._default_policy()
        pol = wi.read_queue_policy(self.project)
        self.assertEqual(pol["ready"]["min_items"], 3)
        self.assertEqual(pol["intake"]["wip_limit"], 10)

    # ---- CLI wiring ---------------------------------------------------------
    def test_cli_subcommand_registered(self):
        # `loop-gate` is a real subcommand and --project is required
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as cm:
                wi.main(["loop-gate"])
        self.assertEqual(cm.exception.code, 2)   # argparse usage error, not "invalid choice"

    def test_cli_end_to_end_exit_two(self):
        self._default_policy()
        self.write_item("active", "UC-R0", "use-case", self._ready_uc(10))
        with contextlib.redirect_stdout(io.StringIO()) as out:
            with self.assertRaises(SystemExit) as cm:
                wi.main(["loop-gate", "--project", self.project, "--now", NOW])
        self.assertEqual(cm.exception.code, 2)
        self.assertIn("BLOCKED", out.getvalue())


# --------------------------------------------------------------------------- #
# `awaiting_observation` — state-graph v9 (process v125 §12d obligation 3 / §17c.1)
#
# WHY (founding case, 2026-08-01): UC-ML1 shipped, deployed and was independently
# re-verified green AND inert (2158 offline tests, 103 against real DynamoDB Local,
# the deployed Lambda bytes and the ECS image pulled by digest both confirmed) — and
# then the tester correctly REFUSED to append any event, because none of
# `dev_validated` / `validated` / `rejected` honestly represents "shipped, deployed,
# re-verified green and inert, but UNPROVABLE until armed". The remedy had been
# written in v125's changelog as a COMPLETED change and never existed; §12d even
# carried an interim "held out of `done` by hand" instruction. A hand-hold is not a
# state, so this is the state.
#
# The invariant that matters: an item here is NOT done and can never fold into a
# `done` aggregate. The predicate that gets it out is MACHINE-CHECKABLE and
# re-checked every cycle (TestLoopGate check 5), never a claim in prose (§17c
# Layer 2 — the load-bearing claim living where it cannot be false).
# --------------------------------------------------------------------------- #
AWAIT = "awaiting_observation"


class TestAwaitingObservationGraph(Base):
    def _edge(self, itype, frm, event):
        return [t for t in self.graphs.transitions(itype)
                if t["from"] == frm and t["event"] == event]

    def test_state_exists_on_use_case_and_defect_and_is_non_terminal(self):
        for itype in ("use-case", "defect"):
            states = {t["to"] for t in self.graphs.transitions(itype)}
            self.assertIn(AWAIT, states, itype)
            self.assertNotIn(AWAIT, self.graphs.terminals(itype), itype)

    def test_open_item_deliberately_does_not_have_it(self):
        """NOT blanket-added. An open-item is a finding/decision-debt note: it has
        no deployable capability and no observation surface, so `closed` is a
        bookkeeping act, not a capability claim. An open item whose closure needs an
        observation belongs registered as a use-case or defect."""
        states = {t["to"] for t in self.graphs.transitions("open-item")}
        self.assertNotIn(AWAIT, states)

    def test_entry_edges_from_every_validation_state(self):
        """`prod-validating` is included deliberately: all five v125 capabilities
        were PROD-validated and had still never fired on real data. Leaving it out
        would make the founding class unrepresentable."""
        for frm in ("dev-validating", "validating", "prod-validating"):
            e = self._edge("use-case", frm, "not_yet_observed")
            self.assertEqual(len(e), 1, frm)
            self.assertEqual(e[0]["to"], AWAIT)
            self.assertEqual(e[0]["agents"], ["tester"])
        e = self._edge("defect", "validating", "not_yet_observed")
        self.assertEqual(len(e), 1)
        self.assertEqual((e[0]["to"], e[0]["agents"]), (AWAIT, ["tester"]))

    def test_exit_edges_observed_and_falsified(self):
        uc = {(t["event"], t["to"]) for t in self.graphs.transitions("use-case")
              if t["from"] == AWAIT}
        self.assertIn(("validated", "done"), uc)         # the observation landed
        self.assertIn(("rejected", "reworking"), uc)     # it FALSIFIED the capability
        self.assertIn(("amended", AWAIT), uc)            # v8 generic invariant
        self.assertIn(("cancelled", "cancelled"), uc)    # descoped, never stuck
        d = {(t["event"], t["to"]) for t in self.graphs.transitions("defect")
             if t["from"] == AWAIT}
        self.assertIn(("validated", "resolved"), d)
        self.assertIn(("rejected", "fixing"), d)
        self.assertIn(("amended", AWAIT), d)
        self.assertIn(("cancelled", "cancelled"), d)

    def test_exit_events_are_the_testers(self):
        for itype in ("use-case", "defect"):
            for t in self.graphs.transitions(itype):
                if t["from"] == AWAIT and t["event"] in ("validated", "rejected",
                                                         "not_yet_observed"):
                    self.assertEqual(t["agents"], ["tester"], t)

    def test_time_is_attributed_to_external_not_to_the_tester(self):
        """A WAIT must never wear the tester's name (v126 constraint finding): the
        item is waiting for REALITY to produce a record, which is outside the
        system — the same owner class as `blocked`."""
        self.assertEqual(self.graphs.owner_of(AWAIT), "external")
        self.assertEqual(self.graphs.state_owners[AWAIT],
                         self.graphs.state_owners["blocked"])

    def test_queue_is_waiting_not_null(self):
        """Non-null: a null queue means terminal/aggregate and would make the item
        INVISIBLE in queues.md — which is the by-hand invisibility being removed."""
        self.assertEqual(self.graphs.queue_for(AWAIT), "waiting")

    def test_graph_version_bumped_with_a_rationale_note(self):
        with open(wi.GRAPHS_PATH, encoding="utf-8") as f:
            raw = json.load(f)
        self.assertGreaterEqual(raw["version"], 9)
        self.assertIn("_v9", raw)
        self.assertIn(AWAIT, raw["_v9"])

    def test_fold_reaches_and_leaves_the_state(self):
        base = [{"ts": "1", "event": "registered", "agent": "flow-manager"},
                {"ts": "2", "event": "made_ready", "agent": "flow-manager"},
                {"ts": "3", "event": "pulled", "agent": "orchestrator"},
                {"ts": "4", "event": "built_green", "agent": "engineer"},
                {"ts": "5", "event": "deployed", "agent": "cicd"},
                {"ts": "6", "event": "not_yet_observed", "agent": "tester"}]
        self.assertEqual(wi.fold_state(self.graphs, "use-case", base), AWAIT)
        self.assertEqual(wi.fold_state(self.graphs, "use-case", base + [
            {"ts": "7", "event": "amended", "agent": "product"}]), AWAIT)
        self.assertEqual(wi.fold_state(self.graphs, "use-case", base + [
            {"ts": "7", "event": "validated", "agent": "tester"}]), "done")
        self.assertEqual(wi.fold_state(self.graphs, "use-case", base + [
            {"ts": "7", "event": "rejected", "agent": "tester"}]), "reworking")

    def test_amend_in_state_is_time_preserving(self):
        evs = [{"ts": _dt(10, 0), "event": "registered", "agent": "flow-manager"},
               {"ts": _dt(10, 1), "event": "made_ready", "agent": "flow-manager"},
               {"ts": _dt(10, 2), "event": "pulled", "agent": "orchestrator"},
               {"ts": _dt(10, 3), "event": "built_green", "agent": "engineer"},
               {"ts": _dt(10, 4), "event": "deployed", "agent": "cicd"},
               {"ts": _dt(11, 0), "event": "not_yet_observed", "agent": "tester",
                "observe": "make:probe-x"},
               {"ts": _dt(12, 0), "event": "amended", "agent": "product"}]
        self.write_item("active", "UC-A", "use-case", evs)
        items, _ = wi.load_all_items(self.project)
        segs = wi.walk_states(self.graphs, items["UC-A"], wi.parse_ts(_dt(13, 0)))
        await_s = sum((x - e).total_seconds() for s, e, x in segs if s == AWAIT)
        self.assertEqual(await_s, 2 * 86400)

    def test_metrics_attribute_the_dwell_to_external(self):
        evs = [{"ts": _dt(10, 0), "event": "registered", "agent": "flow-manager"},
               {"ts": _dt(10, 1), "event": "made_ready", "agent": "flow-manager"},
               {"ts": _dt(10, 2), "event": "pulled", "agent": "orchestrator"},
               {"ts": _dt(10, 3), "event": "built_green", "agent": "engineer"},
               {"ts": _dt(10, 4), "event": "deployed", "agent": "cicd"},
               {"ts": _dt(10, 5), "event": "not_yet_observed", "agent": "tester",
                "observe": "make:probe-x"}]
        self.write_item("active", "UC-A", "use-case", evs)
        items, _ = wi.load_all_items(self.project)
        m = wi.per_item_metrics(self.graphs, items["UC-A"], wi.parse_ts(_dt(12, 5)))
        self.assertAlmostEqual(m["time_in_state"][AWAIT], 2 * 86400, places=1)
        self.assertAlmostEqual(m["time_by_owner"]["external"], 2 * 86400, places=1)
        self.assertNotIn(AWAIT, m["time_by_owner"])


class TestAwaitingObservationAppend(Base):
    """PROOF-OF-FIRE through the REAL writer: the new edges observed working, the
    illegal ones observed REFUSED."""

    def _deployed_uc(self, iid="UC-ML1"):
        self.write_item("active", iid, "use-case", [
            {"ts": _dt(10, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(10, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(10, 2), "event": "pulled", "agent": "orchestrator"},
            {"ts": _dt(10, 3), "event": "built_green", "agent": "engineer",
             "ref": "7468849"},
            {"ts": _dt(10, 4), "event": "deployed", "agent": "cicd", "ref": "7468849"},
        ])
        return iid

    def _append(self, iid, event, agent, observe=None, note=None, ref=None,
                ts=None):
        ns = argparse.Namespace(project=self.project, id=iid, event=event,
                                agent=agent, note=note, ref=ref,
                                ts=ts or _dt(11, 0), tokens=None,
                                duration_ms=None, observe=observe)
        with contextlib.redirect_stdout(io.StringIO()) as out:
            wi.cmd_append(ns)
        return out.getvalue()

    def _append_fails(self, iid, event, agent, **kw):
        with contextlib.redirect_stderr(io.StringIO()) as err:
            with self.assertRaises(SystemExit) as cm:
                self._append(iid, event, agent, **kw)
        self.assertNotEqual(cm.exception.code, 0)
        return err.getvalue()

    def _state(self, iid):
        items, _ = wi.load_all_items(self.project)
        return wi.compute_states(self.graphs, items)[iid], items[iid]

    # ---- the edges WORK ------------------------------------------------------
    def test_dev_validating_to_awaiting_observation(self):
        iid = self._deployed_uc()
        out = self._append(iid, "not_yet_observed", "tester",
                           observe="make:probe-genesis-observed",
                           note="inert behind GENESIS_PHASE_EVENTS_ENABLED=false")
        self.assertIn(f"dev-validating --(not_yet_observed/tester)--> {AWAIT}", out)
        state, item = self._state(iid)
        self.assertEqual(state, AWAIT)
        self.assertEqual(item.events[-1]["observe"], "make:probe-genesis-observed")
        # and it is NOT terminal, so it stays in items/active/
        self.assertTrue(os.path.exists(
            os.path.join(self._items("active"), f"{iid}.md")))
        self.assertFalse(os.path.exists(
            os.path.join(self._items("done"), f"{iid}.md")))

    def test_validate_only_route_can_park_too(self):
        self.write_item("active", "UC-V", "use-case", [
            {"ts": _dt(10, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(10, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(10, 2), "event": "pulled_for_validation",
             "agent": "orchestrator"}])
        self._append("UC-V", "not_yet_observed", "tester", observe="make:probe-x")
        self.assertEqual(self._state("UC-V")[0], AWAIT)

    def test_observation_lands_then_done(self):
        iid = self._deployed_uc()
        self._append(iid, "not_yet_observed", "tester", observe="make:probe-x")
        self._append(iid, "validated", "tester", ts=_dt(20, 0),
                     note="observed on stream OAG#BA123#2026-08-04 seq 7")
        self.assertEqual(self._state(iid)[0], "done")
        self.assertTrue(os.path.exists(
            os.path.join(self._items("done"), f"{iid}.md")))

    def test_observation_falsifies_then_reworking(self):
        iid = self._deployed_uc()
        self._append(iid, "not_yet_observed", "tester", observe="make:probe-x")
        self._append(iid, "rejected", "tester", ts=_dt(20, 0),
                     note="armed; the real record shows the event never fires")
        self.assertEqual(self._state(iid)[0], "reworking")

    def test_predicate_corrected_by_an_amendment(self):
        iid = self._deployed_uc()
        self._append(iid, "not_yet_observed", "tester", observe="make:probe-old")
        self._append(iid, "amended", "solution-architect", ts=_dt(12, 0),
                     observe="make:probe-new", note="probe was measuring the wrong thing")
        state, item = self._state(iid)
        self.assertEqual(state, AWAIT)
        self.assertEqual(wi.observe_spec_in_effect(item), "make:probe-new")

    def test_defect_can_park_and_resolve(self):
        self.write_item("active", "DEF-1", "defect", [
            {"ts": _dt(10, 0), "event": "reported", "agent": "orchestrator"},
            {"ts": _dt(10, 1), "event": "triaged", "agent": "orchestrator"},
            {"ts": _dt(10, 2), "event": "confirmed", "agent": "engineer"},
            {"ts": _dt(10, 3), "event": "fixed", "agent": "engineer", "ref": "abc"}])
        self._append("DEF-1", "not_yet_observed", "tester", observe="make:probe-x")
        self.assertEqual(self._state("DEF-1")[0], AWAIT)
        self._append("DEF-1", "validated", "tester", ts=_dt(20, 0))
        self.assertEqual(self._state("DEF-1")[0], "resolved")

    # ---- the ILLEGAL ones are REFUSED ---------------------------------------
    def test_cannot_park_from_building(self):
        self.write_item("active", "UC-B", "use-case", [
            {"ts": _dt(10, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(10, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(10, 2), "event": "pulled", "agent": "orchestrator"}])
        err = self._append_fails("UC-B", "not_yet_observed", "tester",
                                 observe="make:probe-x")
        self.assertIn("not a legal transition from 'building'", err)

    def test_only_the_tester_may_park(self):
        iid = self._deployed_uc()
        err = self._append_fails(iid, "not_yet_observed", "engineer",
                                 observe="make:probe-x")
        self.assertIn("not for agent 'engineer'", err)

    def test_cannot_deploy_out_of_a_park(self):
        iid = self._deployed_uc()
        self._append(iid, "not_yet_observed", "tester", observe="make:probe-x")
        err = self._append_fails(iid, "deployed", "cicd", ts=_dt(12, 0))
        self.assertIn(f"not a legal transition from '{AWAIT}'", err)

    def test_cannot_dev_validate_out_of_a_park(self):
        """No back door to prod-deploying: the way out is the observation."""
        iid = self._deployed_uc()
        self._append(iid, "not_yet_observed", "tester", observe="make:probe-x")
        err = self._append_fails(iid, "dev_validated", "tester", ts=_dt(12, 0))
        self.assertIn(f"not a legal transition from '{AWAIT}'", err)

    # ---- the predicate is REQUIRED, not optional (v124/EXP-121) --------------
    def test_park_without_a_predicate_is_refused(self):
        """The state cannot be ENTERED without a machine-checkable predicate — so
        a prose park is unrepresentable, not merely discouraged."""
        iid = self._deployed_uc()
        err = self._append_fails(iid, "not_yet_observed", "tester",
                                 note="waiting for a real cancellation")
        self.assertIn("--observe", err)
        self.assertEqual(self._state(iid)[0], "dev-validating")   # unmoved

    def test_park_with_a_malformed_predicate_is_refused_at_the_write(self):
        iid = self._deployed_uc()
        err = self._append_fails(iid, "not_yet_observed", "tester",
                                 observe="probe-x; rm -rf /")
        self.assertIn("observe", err.lower())
        self.assertEqual(self._state(iid)[0], "dev-validating")

    def test_observe_is_refused_on_an_unrelated_event(self):
        iid = self._deployed_uc()
        err = self._append_fails(iid, "dev_validated", "tester",
                                 observe="make:probe-x")
        self.assertIn("observe", err.lower())

    # ---- I6: validate catches a HAND-EDITED predicate-less park -------------
    def test_validate_flags_a_hand_edited_predicate_less_park(self):
        self.write_item("active", "UC-H", "use-case", [
            {"ts": _dt(10, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(10, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(10, 2), "event": "pulled", "agent": "orchestrator"},
            {"ts": _dt(10, 3), "event": "built_green", "agent": "engineer"},
            {"ts": _dt(10, 4), "event": "deployed", "agent": "cicd"},
            {"ts": _dt(11, 0), "event": "not_yet_observed", "agent": "tester"}])
        v = wi.validate_items(self.graphs, self.project)
        self.assertTrue(any("(I6)" in x and "UC-H" in x for x in v), v)

    def test_validate_clean_with_a_predicate(self):
        iid = self._deployed_uc()
        self._append(iid, "not_yet_observed", "tester", observe="make:probe-x")
        self.assertEqual(wi.validate_items(self.graphs, self.project), [])

    def test_cli_exposes_observe(self):
        iid = self._deployed_uc()
        with contextlib.redirect_stdout(io.StringIO()):
            wi.main(["append", "--project", self.project, "--id", iid,
                     "--event", "not_yet_observed", "--agent", "tester",
                     "--observe", "make:probe-x", "--ts", _dt(11, 0)])
        self.assertEqual(self._state(iid)[0], AWAIT)


class TestAwaitingObservationBubble(Base):
    """THE load-bearing invariant: an `awaiting_observation` child must never let
    its parent aggregate read `done`. The five v125 capabilities folded into `done`
    slices while nothing worked; that is what made CFR and rework read clean."""

    def _reg(self):
        return [{"ts": _dt(10, 0), "event": "registered", "agent": "flow-manager"}]

    def _done_uc(self):
        return [{"ts": _dt(10, 0), "event": "registered", "agent": "flow-manager"},
                {"ts": _dt(10, 1), "event": "made_ready", "agent": "flow-manager"},
                {"ts": _dt(10, 2), "event": "pulled", "agent": "orchestrator"},
                {"ts": _dt(10, 3), "event": "built_green", "agent": "engineer"},
                {"ts": _dt(10, 4), "event": "deployed", "agent": "cicd"},
                {"ts": _dt(10, 5), "event": "validated", "agent": "tester"}]

    def _await_uc(self):
        return self._done_uc()[:-1] + [
            {"ts": _dt(10, 5), "event": "not_yet_observed", "agent": "tester",
             "observe": "make:probe-x"}]

    def _blocked_uc(self):
        return [{"ts": _dt(10, 0), "event": "registered", "agent": "flow-manager"},
                {"ts": _dt(10, 1), "event": "made_ready", "agent": "flow-manager"},
                {"ts": _dt(10, 2), "event": "blocked", "agent": "flow-manager"}]

    def _states(self):
        return wi.compute_states(self.graphs, wi.load_all_items(self.project)[0])

    def test_awaiting_child_prevents_the_slice_from_reading_done(self):
        self.write_item("done", "UC-1", "use-case", self._done_uc(), parents=["SLC-1"])
        self.write_item("active", "UC-2", "use-case", self._await_uc(), parents=["SLC-1"])
        self.write_item("active", "SLC-1", "slice", self._reg())
        st = self._states()
        self.assertNotEqual(st["SLC-1"], "done")
        self.assertEqual(st["SLC-1"], AWAIT)

    def test_all_children_awaiting_bubbles_awaiting(self):
        self.write_item("active", "UC-1", "use-case", self._await_uc(), parents=["SLC-1"])
        self.write_item("active", "UC-2", "use-case", self._await_uc(), parents=["SLC-1"])
        self.write_item("active", "SLC-1", "slice", self._reg())
        self.assertEqual(self._states()["SLC-1"], AWAIT)

    def test_bubble_is_multilevel(self):
        self.write_item("active", "UC-1", "use-case", self._await_uc(), parents=["SLC-1"])
        self.write_item("active", "SLC-1", "slice", self._reg(), parents=["CHK-1"])
        self.write_item("active", "CHK-1", "chunk", self._reg())
        st = self._states()
        self.assertEqual(st["SLC-1"], AWAIT)
        self.assertNotEqual(st["CHK-1"], "done")
        self.assertEqual(st["CHK-1"], AWAIT)

    def test_awaiting_takes_precedence_over_blocked(self):
        """Both are external waits; the unproven-capability fact is the one a reader
        most needs, and it is the one that can silently read `done` later."""
        self.write_item("active", "UC-1", "use-case", self._await_uc(), parents=["SLC-1"])
        self.write_item("active", "UC-2", "use-case", self._blocked_uc(), parents=["SLC-1"])
        self.write_item("active", "SLC-1", "slice", self._reg())
        self.assertEqual(self._states()["SLC-1"], AWAIT)

    def test_all_blocked_still_bubbles_blocked(self):
        """Regression: the pre-existing blocked rule is unchanged."""
        self.write_item("active", "UC-1", "use-case", self._blocked_uc(), parents=["SLC-1"])
        self.write_item("active", "UC-2", "use-case", self._blocked_uc(), parents=["SLC-1"])
        self.write_item("active", "SLC-1", "slice", self._reg())
        self.assertEqual(self._states()["SLC-1"], "blocked")

    def test_a_child_still_building_wins_over_awaiting(self):
        """Real work in flight => in_progress; the park is not allowed to mask it."""
        self.write_item("active", "UC-1", "use-case", self._await_uc(), parents=["SLC-1"])
        self.write_item("active", "UC-2", "use-case", [
            {"ts": _dt(10, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(10, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(10, 2), "event": "pulled", "agent": "orchestrator"}],
            parents=["SLC-1"])
        self.write_item("active", "SLC-1", "slice", self._reg())
        self.assertEqual(self._states()["SLC-1"], "in_progress")

    def test_the_slice_reads_done_once_the_observation_lands(self):
        """BOTH DIRECTIONS: the park is a hold, not a permanent veto."""
        self.write_item("active", "UC-1", "use-case", self._await_uc(), parents=["SLC-1"])
        self.write_item("active", "SLC-1", "slice", self._reg())
        self.assertEqual(self._states()["SLC-1"], AWAIT)
        with contextlib.redirect_stdout(io.StringIO()):
            wi.cmd_append(argparse.Namespace(
                project=self.project, id="UC-1", event="validated", agent="tester",
                note="observed on a real record", ref=None, ts=_dt(20, 0),
                tokens=None, duration_ms=None, observe=None))
        self.assertEqual(self._states()["SLC-1"], "done")

    def test_awaiting_aggregate_is_in_the_waiting_queue_not_none(self):
        self.write_item("active", "UC-1", "use-case", self._await_uc(), parents=["SLC-1"])
        self.write_item("active", "SLC-1", "slice", self._reg())
        with contextlib.redirect_stdout(io.StringIO()):
            wi.cmd_project(argparse.Namespace(project=self.project, now=_dt(21, 0),
                                              item=None))
        with open(os.path.join(self.tmp, "work", self.project, "views",
                               "queues.json")) as f:
            q = json.load(f)
        self.assertIn("UC-1", q.get("waiting", []))
        self.assertIn("SLC-1", q.get("waiting", []))

    def test_validate_stays_clean_with_an_awaiting_aggregate(self):
        """I2/I4: `awaiting_observation` is non-terminal, so the child stays in
        items/active/ and the non-null queue is correct, not a violation. I6 exempts
        the AGGREGATE: it bubbles into the state and has no own event stream to carry
        a predicate — the predicate lives on the child, checked in its own right."""
        self.write_item("active", "UC-1", "use-case", self._await_uc(), parents=["SLC-1"])
        self.write_item("active", "SLC-1", "slice", self._reg())
        self.assertEqual(wi.validate_items(self.graphs, self.project), [])

    def test_loop_gate_does_not_report_the_bubbled_aggregate(self):
        """Check 5 covers FLOW items only: otherwise every ancestor of one parked
        use-case would raise a phantom 'no predicate' block."""
        self.write_item("active", "UC-1", "use-case", self._await_uc(), parents=["SLC-1"])
        self.write_item("active", "SLC-1", "slice", self._reg(), parents=["CHK-1"])
        self.write_item("active", "CHK-1", "chunk", self._reg())
        orig = wi._run_observation
        wi._run_observation = lambda p, s, timeout=None: ("not-yet", "")
        try:
            findings = wi.compute_loop_gate(
                self.graphs, self.project, now=wi.parse_ts(_dt(21, 0)))
        finally:
            wi._run_observation = orig
        aw = [f for f in findings if f["check"] == "awaiting-observation"]
        self.assertEqual([f["ids"] for f in aw], [["UC-1"]], findings)


# --------------------------------------------------------------------------- #
# THE REVERSAL PROBE — §17c limb 6 / EXP-143, mechanised by OI-ROC-005
#
# `blocked` was the one park state nothing re-checked, while holding 41% of ROC's
# gross lead time at a median 21.7 DAYS per item. The founding measurement:
# DEF-ROC-004 sat `blocked` for 28.8 days after both of its blockers had already
# gone, and the only detector was a human deciding to re-ask.
#
# These tests are the acceptance of OI-ROC-005, AC-005.1 .. AC-005.5. They are
# written against the SAME contract as the observation predicate deliberately, so
# the two park states cannot drift apart again.
# --------------------------------------------------------------------------- #
class TestReversalProbeAppend(Base):
    """AC-005.1 / AC-005.2 — the write refuses a park with no machine-checkable
    reversal probe, and refuses a malformed one BEFORE the event is written."""

    def _ns(self, iid, event, agent, probe=None):
        return argparse.Namespace(project=self.project, id=iid, event=event,
                                  agent=agent, ref=None, note=None,
                                  ts="2026-06-18T00:00:00Z", probe=probe)

    def _blockable_uc(self, iid="UC-B"):
        self.write_item("active", iid, "use-case",
                        [{"ts": "1", "event": "registered", "agent": "flow-manager"},
                         {"ts": "2", "event": "made_ready", "agent": "flow-manager"}])
        return os.path.join(self._items("active"), f"{iid}.md")

    def test_AC_005_1_blocked_without_a_probe_is_REFUSED(self):
        """PROOF-OF-FIRE. The whole finding is that a park whose reason is only a
        note can never come back negative, so it never ends."""
        path = self._blockable_uc()
        with self.assertRaises(SystemExit) as cm:
            with contextlib.redirect_stderr(io.StringIO()) as err:
                wi.cmd_append(self._ns("UC-B", "blocked", "flow-manager"))
        self.assertNotEqual(cm.exception.code, 0)
        msg = err.getvalue()
        self.assertIn("requires --probe", msg)
        self.assertIn("BLOCKER:", msg)
        # and NOTHING was written — the refusal is at the write, not after it
        self.assertEqual(len(wi.load_item(path).events), 2)

    def test_AC_005_2_a_malformed_probe_fails_before_the_event_is_written(self):
        path = self._blockable_uc()
        for bad in ("probe-x",                      # no make: scheme
                    "make:",                        # no target
                    "make:x; rm -rf /",             # shell metacharacters
                    "make:../escape"):              # not a plain target
            with self.subTest(bad=bad):
                with self.assertRaises(SystemExit) as cm:
                    with contextlib.redirect_stderr(io.StringIO()) as err:
                        wi.cmd_append(self._ns("UC-B", "blocked", "flow-manager",
                                               probe=bad))
                self.assertNotEqual(cm.exception.code, 0)
                self.assertIn("REJECTED", err.getvalue())
                self.assertEqual(len(wi.load_item(path).events), 2)

    def test_a_valid_probe_is_written_onto_the_event_and_is_readable(self):
        path = self._blockable_uc()
        with contextlib.redirect_stdout(io.StringIO()):
            wi.cmd_append(self._ns("UC-B", "blocked", "flow-manager",
                                   probe="make:probe-blocker-uc-b"))
        it = wi.load_item(path)
        self.assertEqual(it.events[-1].get("probe"), "make:probe-blocker-uc-b")
        self.assertEqual(wi.probe_spec_in_effect(it), "make:probe-blocker-uc-b")

    def test_a_wrong_probe_is_corrected_by_amending_never_by_editing_history(self):
        """The LAST event carrying a probe wins — same rule as `observe:`, so a
        bad probe is fixed forward and the history stays append-only."""
        path = self._blockable_uc()
        with contextlib.redirect_stdout(io.StringIO()):
            wi.cmd_append(self._ns("UC-B", "blocked", "flow-manager",
                                   probe="make:probe-wrong"))
            wi.cmd_append(self._ns("UC-B", "amended", "flow-manager",
                                   probe="make:probe-right"))
        it = wi.load_item(path)
        self.assertEqual(wi.probe_spec_in_effect(it), "make:probe-right")
        self.assertEqual(it.events[-2].get("probe"), "make:probe-wrong")

    def test_probe_on_a_transition_that_is_not_a_park_is_REFUSED(self):
        """A probe means "this park is re-checkable". On any other transition it
        would be dead metadata that nothing evaluates — refuse it rather than
        store something misleading."""
        self.write_item("active", "UC-P", "use-case",
                        [{"ts": "1", "event": "registered", "agent": "flow-manager"}])
        with self.assertRaises(SystemExit) as cm:
            with contextlib.redirect_stderr(io.StringIO()) as err:
                wi.cmd_append(self._ns("UC-P", "made_ready", "flow-manager",
                                       probe="make:probe-x"))
        self.assertNotEqual(cm.exception.code, 0)
        self.assertIn("only meaningful", err.getvalue())


class TestReversalProbeRunner(Base):
    """AC-005.4 — all five BROKEN cases, against a REAL `make`.

    Stubbing subprocess here would prove only that the mapping agrees with itself:
    that is exactly how the observation predicate's first cut passed its tests and
    then read BROKEN for every probe in the field, because **make does not
    propagate a recipe's exit status**. So this drives real make."""

    def _probe_makefile(self, body):
        d = os.path.join(self.tmp, "work", self.project)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "Makefile"), "w", encoding="utf-8") as f:
            f.write(body)

    def test_AC_005_4_the_five_broken_cases_and_the_two_real_verdicts(self):
        self._probe_makefile(
            "cleared:\n\t@echo 'the roc-test subscription exists'\n\t@echo 'BLOCKER: cleared'\n"
            "standing:\n\t@echo 'still 403 from the deploy SP'\n\t@echo 'BLOCKER: standing'\n"
            "silent:\n\t@echo 'I looked at some things'\n"
            "crashes:\n\t@echo boom >&2; exit 1\n"
            "codeonly:\n\t@exit 3\n"
            "both:\n\t@echo 'BLOCKER: standing'; echo 'BLOCKER: cleared'\n")
        run = lambda t: wi._run_blocker_probe(self.project, f"make:{t}")
        # the two real verdicts
        self.assertEqual(run("cleared")[0], "cleared")
        self.assertEqual(run("standing")[0], "standing")
        # 1. no sentinel at all — helpful output, no verdict, establishes nothing
        self.assertEqual(run("silent")[0], "broken")
        # 2. a crash
        self.assertEqual(run("crashes")[0], "broken")
        # 3. an exit-code-only contract, which `make` cannot express
        self.assertEqual(run("codeonly")[0], "broken")
        # 4. both sentinels — ambiguous, so it establishes nothing
        self.assertEqual(run("both")[0], "broken")
        # 5. a target that DOES NOT EXIST must never masquerade as "still blocked"
        verdict, detail = run("no-such-target")
        self.assertEqual(verdict, "broken")
        self.assertIn("No rule to make target", detail)
        # the operator gets the probe's own words, both ways round
        self.assertIn("roc-test subscription", run("cleared")[1])
        self.assertIn("403", run("standing")[1])

    def test_a_timeout_is_broken_not_standing(self):
        self._probe_makefile("slow:\n\t@sleep 5\n\t@echo 'BLOCKER: standing'\n")
        verdict, detail = wi._run_blocker_probe(self.project, "make:slow", timeout=0.4)
        self.assertEqual(verdict, "broken")
        self.assertIn("timeout", detail)

    def test_a_malformed_spec_is_never_executed(self):
        called = []
        orig = wi.subprocess.run
        wi.subprocess.run = lambda *a, **k: called.append(a)
        try:
            verdict, detail = wi._run_blocker_probe(self.project, "make:x; rm -rf /")
        finally:
            wi.subprocess.run = orig
        self.assertEqual(verdict, "broken")
        self.assertEqual(called, [])
        self.assertIn("malformed", detail)

    def test_the_probe_runs_the_project_makefile_without_a_shell(self):
        seen = {}

        class R:
            returncode, stdout, stderr = 0, "BLOCKER: cleared", ""

        def fake_run(argv, **kw):
            seen["argv"], seen["kw"] = argv, kw
            return R()

        orig = wi.subprocess.run
        wi.subprocess.run = fake_run
        try:
            self.assertEqual(
                wi._run_blocker_probe(self.project,
                                      "make:probe-blocker-x SUB=aas-test")[0],
                "cleared")
        finally:
            wi.subprocess.run = orig
        self.assertEqual(seen["argv"],
                         ["make", "-C", os.path.join(self.tmp, "work", self.project),
                          "probe-blocker-x", "SUB=aas-test"])
        self.assertNotIn("shell", seen["kw"])


class TestReversalProbeLoopGate(TestLoopGate):
    """AC-005.3 / AC-005.5 — the gate re-runs every blocked item's probe EVERY
    cycle. `cleared` BLOCKS (an `unblocked` dispatch is actionable); `standing` is
    advisory; anything else BLOCKS as BROKEN.

    Inherits TestLoopGate's helpers so the severities are asserted through the
    SAME gate driver as every other check."""

    def _blocked_defect(self, iid="DEF-1", day=1, spec="make:probe-blocker-def-1"):
        evs = [{"ts": _dt(day, 0), "event": "reported", "agent": "orchestrator"},
               {"ts": _dt(day, 1), "event": "triaged", "agent": "orchestrator"},
               {"ts": _dt(day, 2), "event": "confirmed", "agent": "engineer"},
               {"ts": _dt(day, 3), "event": "blocked", "agent": "flow-manager",
                "note": "waiting on the deploy service principal"}]
        if spec:
            evs[-1]["probe"] = spec
        return evs

    def _fake_probe(self, verdict, detail="", record=None):
        def fake(project, spec, timeout=None):
            if record is not None:
                record.append((project, spec, timeout))
            return verdict, detail
        return fake

    def _with_probe(self, verdict, detail="", run=False, **kw):
        orig = wi._run_blocker_probe
        wi._run_blocker_probe = self._fake_probe(verdict, detail)
        try:
            return self._run(**kw) if run else self._gate(**kw)
        finally:
            wi._run_blocker_probe = orig

    def _quiet_ready(self):
        """Three ready UCs + the shipped policy, so the OTHER checks are silent
        and the blocked finding is the only thing under test."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))

    def test_AC_005_3_standing_is_ADVISORY_and_does_not_block(self):
        self._quiet_ready()
        self.write_item("active", "DEF-1", "defect", self._blocked_defect())
        findings = self._with_probe("standing", "403 from the deploy SP")
        self.assertNotIn("blocked-park", self._checks(findings))
        adv = [f for f in findings
               if f["check"] == "blocked-park" and f["severity"] == "advisory"]
        self.assertEqual([f["ids"] for f in adv], [["DEF-1"]], findings)
        self.assertEqual(adv[0]["verdict"], "standing")
        code, out = self._with_probe("standing", "403 from the deploy SP", run=True)
        self.assertEqual(code, 0)
        self.assertIn("ADVISORY", out)
        self.assertIn("DEF-1", out)
        self.assertIn("STILL BLOCKED", out.upper())

    def test_AC_005_3_cleared_BLOCKS_and_names_the_unblocked_append(self):
        """The founding failure: DEF-ROC-004 blocked for 28.8 days after its
        blockers had gone. `cleared` is actionable, so it must stop the pull."""
        self._quiet_ready()
        self.write_item("active", "DEF-1", "defect", self._blocked_defect())
        findings = self._with_probe("cleared", "the roc-test subscription exists")
        self.assertIn("blocked-park", self._checks(findings))
        f = [x for x in findings if x["check"] == "blocked-park"][0]
        self.assertEqual((f["severity"], f["verdict"], f["ids"]),
                         ("block", "cleared", ["DEF-1"]))
        code, out = self._with_probe("cleared", "subscription exists", run=True)
        self.assertEqual(code, 2)
        self.assertIn("EVENT=unblocked", out)
        self.assertIn("DEF-1", out)

    def test_AC_005_4_a_broken_probe_BLOCKS(self):
        self._quiet_ready()
        self.write_item("active", "DEF-1", "defect", self._blocked_defect())
        findings = self._with_probe("broken", "No rule to make target 'probe-x'")
        self.assertIn("blocked-park", self._checks(findings))
        f = [x for x in findings if x["check"] == "blocked-park"][0]
        self.assertEqual(f["verdict"], "broken")
        code, out = self._with_probe("broken", "No rule to make target", run=True)
        self.assertEqual(code, 2)
        self.assertIn("CANNOT BE EVALUATED", out)

    def test_a_blocked_item_with_NO_probe_BLOCKS(self):
        """Only reachable by a hand-edit or a pre-v145 park. Fail CLOSED: an
        unverifiable park is exactly the prose park this limb exists to end."""
        self._quiet_ready()
        self.write_item("active", "DEF-1", "defect", self._blocked_defect(spec=None))
        findings = self._with_probe("cleared")      # never consulted
        f = [x for x in findings if x["check"] == "blocked-park"][0]
        self.assertEqual((f["severity"], f["verdict"]), ("block", "no-predicate"))
        self.assertIsNone(f["spec"])
        code, out = self._with_probe("cleared", run=True)
        self.assertEqual(code, 2)
        self.assertIn("NO reversal probe", out)

    def test_no_observe_flag_reports_unknown_never_silently_clean(self):
        self._quiet_ready()
        self.write_item("active", "DEF-1", "defect", self._blocked_defect())
        calls = []
        orig = wi._run_blocker_probe
        wi._run_blocker_probe = self._fake_probe("cleared", record=calls)
        try:
            findings = self._gate(observe=False)
            code, out = self._run(observe=False)
        finally:
            wi._run_blocker_probe = orig
        self.assertEqual(calls, [])
        f = [x for x in findings if x["check"] == "blocked-park"][0]
        self.assertEqual((f["severity"], f["verdict"]), ("unknown", "not-evaluated"))
        self.assertEqual(code, 0)
        self.assertIn("NOT ESTABLISHED", out)

    def test_the_probe_is_re_evaluated_on_EVERY_run(self):
        """The whole finding was that nothing re-checked. A cached or once-only
        evaluation would reproduce it exactly."""
        self._quiet_ready()
        self.write_item("active", "DEF-1", "defect", self._blocked_defect())
        calls = []
        orig = wi._run_blocker_probe
        wi._run_blocker_probe = self._fake_probe("standing", record=calls)
        try:
            self._gate()
            self._gate()
            self._gate()
        finally:
            wi._run_blocker_probe = orig
        self.assertEqual(len(calls), 3)
        self.assertEqual({c[1] for c in calls}, {"make:probe-blocker-def-1"})

    def test_attaching_a_probe_must_not_RESET_the_park_age(self):
        """THE MIGRATION MUST NOT HIDE THE COST IT EXISTS TO EXPOSE. Attaching a
        probe to an old park is an `amended` self-loop, which opens a new segment in
        `walk_states`. Without merging adjacent same-state segments the gate reports
        a 34-day park as 0.0h — so migrating the parks to make their age visible
        would have ERASED it, on the largest single contributor to gross lead time.
        Observed for real on the first migration run."""
        self._quiet_ready()
        evs = self._blocked_defect(day=1)                       # blocked on day 1
        evs.append({"ts": _dt(20, 0), "event": "amended", "agent": "flow-manager",
                    "probe": "make:probe-blocker-def-1"})       # amended 19 days later
        self.write_item("active", "DEF-1", "defect", evs)
        findings = self._with_probe("standing")
        f = [x for x in findings if x["check"] == "blocked-park"][0]
        # NOW is day 30, so the park is ~29 days old, NOT the 10 days since the
        # amend and certainly not zero.
        self.assertGreater(f["dwell_s"], 25 * 86400, f)

    def test_an_AGGREGATE_that_bubbled_to_blocked_is_exempt(self):
        """A slice BUBBLES into blocked from a child and has no own event stream,
        so it carries no probe. Reporting it would be a phantom block for every
        ancestor of one parked item — the probe lives on the child."""
        self._quiet_ready()
        self.write_item("active", "DEF-1", "defect",
                        self._blocked_defect(), parents=["SLC-1"])
        self.write_item("active", "SLC-1", "slice", [])
        findings = self._with_probe("standing")
        ids = [i for f in findings if f["check"] == "blocked-park" for i in f["ids"]]
        self.assertEqual(ids, ["DEF-1"])


class TestReversalProbeInvariant(Base):
    """I7 — a `blocked` FLOW item carries a valid reversal probe. `append` refuses
    the transition without one, so a violation here means a hand-edit; this is the
    same role I6 plays for `awaiting_observation`."""

    def _validate(self):
        """Violations go to STDERR (a gate's findings must not be swallowed by a
        stdout pipe); the clean line goes to stdout. Capture both."""
        ns = argparse.Namespace(project=self.project)
        with contextlib.redirect_stdout(io.StringIO()) as out:
            with contextlib.redirect_stderr(io.StringIO()) as err:
                try:
                    wi.cmd_validate(ns)
                    code = 0
                except SystemExit as e:
                    code = e.code
        return code, out.getvalue() + err.getvalue()

    def _blocked(self, probe):
        evs = [{"ts": _dt(1, 0), "event": "reported", "agent": "orchestrator"},
               {"ts": _dt(1, 1), "event": "triaged", "agent": "orchestrator"},
               {"ts": _dt(1, 2), "event": "confirmed", "agent": "engineer"},
               {"ts": _dt(1, 3), "event": "blocked", "agent": "flow-manager"}]
        if probe:
            evs[-1]["probe"] = probe
        return evs

    def test_I7_flags_a_hand_edited_park_with_no_probe(self):
        self.write_item("active", "DEF-9", "defect", self._blocked(None))
        code, out = self._validate()
        self.assertNotEqual(code, 0)
        self.assertIn("(I7)", out)
        self.assertIn("DEF-9", out)

    def test_I7_flags_an_unevaluable_probe(self):
        self.write_item("active", "DEF-9", "defect", self._blocked("probe-x"))
        code, out = self._validate()
        self.assertNotEqual(code, 0)
        self.assertIn("(I7)", out)

    def test_I7_is_satisfied_by_a_valid_probe(self):
        self.write_item("active", "DEF-9", "defect",
                        self._blocked("make:probe-blocker-def-9"))
        code, out = self._validate()
        self.assertEqual(code, 0, out)

# loop-gate check 11 — STALLED WORK (DEFECT-OAG-127)
#
# The defect: check 1 (`stalled-validation`) covers VALIDATION states only, and only
# blocks when the work is provably DONE (a `ref:`). Work abandoned in `fixing`,
# `building`, `reproducing`, `deploying`, `reworking` — and an item SCHEDULED into
# `ready` that is never pulled — was invisible to every limb of the gate. Measured
# 2026-08-19 by replaying the REAL item files at commit 9ff713ee against the real
# gate: six WIP items idle 4.92-7.31d and three `scheduled` items idle 5.12-8.11d,
# and the only id the whole gate named was the one ref-bearing `validating` item.
#
# Fixtures below are hand-built (a state machine is ours, not a wire we do not own),
# but the DURATIONS and the states are taken from that real reconstruction.
# --------------------------------------------------------------------------- #
class TestStalledWork(Base):
    """AC-127.1 .. AC-127.5. REUSES TestLoopGate's fixture builders by explicit
    binding rather than inheritance: subclassing would re-run all of that class's
    tests under this name, which reads as coverage and is only duplication."""

    _policy = TestLoopGate._policy
    _default_policy = TestLoopGate._default_policy
    _ready_uc = TestLoopGate._ready_uc
    _building_uc = TestLoopGate._building_uc
    _reworking_uc = TestLoopGate._reworking_uc
    _validating_defect = TestLoopGate._validating_defect
    _gate = TestLoopGate._gate
    _run = TestLoopGate._run
    NEVER_AGES = TestLoopGate.NEVER_AGES

    # ---- fixture builders, each parked in one state with NO further event ------
    def _fixing_defect(self, day, hour=0):
        """A defect in `fixing` since day/hour and nothing since — no `fixed`, so
        check 1 cannot see it and never could."""
        return [{"ts": _dt(day, 0), "event": "reported", "agent": "orchestrator"},
                {"ts": _dt(day, hour), "event": "triaged", "agent": "orchestrator"},
                {"ts": _dt(day, hour), "event": "confirmed", "agent": "engineer"}]

    def _reproducing_defect(self, day, hour=0):
        return [{"ts": _dt(day, 0), "event": "reported", "agent": "orchestrator"},
                {"ts": _dt(day, hour), "event": "triaged", "agent": "orchestrator"}]

    def _deploying_uc(self, day, hour=0):
        return self._building_at(day) + [
            {"ts": _dt(day, hour), "event": "built_green", "agent": "engineer"}]

    def _building_at(self, day, hour=0):
        """`building` since day/hour, nothing since. TestLoopGate._building_uc
        hardcodes hours 0-2; a threshold test needs the hour."""
        return [{"ts": _dt(day, 0), "event": "registered", "agent": "flow-manager"},
                {"ts": _dt(day, hour), "event": "made_ready", "agent": "flow-manager"},
                {"ts": _dt(day, hour), "event": "pulled", "agent": "orchestrator"}]

    def _scheduled_oi(self, day, hour=0):
        return [{"ts": _dt(day, 0), "event": "open", "agent": "flow-manager"},
                {"ts": _dt(day, hour), "event": "scheduled", "agent": "flow-manager"}]

    def _blocks(self, findings, check="stalled-work"):
        return [f for f in findings
                if f["check"] == check and f["severity"] == "block"]

    def _fresh_ready(self):
        """Three ready items that are ACTUALLY fresh (day 29 -> ~1d before NOW),
        so the ready floor is satisfied without smuggling in stale inventory. The
        old fixtures used day 10 == 20 days stale, which is exactly the condition
        this check exists to catch."""
        for i in range(3):
            # NB _ready_uc's first arg is the id, the SECOND is the day
            self.write_item("active", f"UC-R{i}", "use-case",
                            self._ready_uc(f"UC-R{i}", 29))

    # ---- AC-089.* — the clock the remedy says to restart must be restartable --
    def test_AC_089_1_an_amended_event_restarts_the_claimed_slot_clock(self):
        """DEF-ROC-089. The check's own remedy (c) reads "if it IS being worked,
        append the event already earned so the clock restarts". It measured time
        since the item ENTERED the state, so only a STATE CHANGE moved it — and
        from `fixing` the legal events are fixed/blocked/amended/validating, so
        the only HONEST one (`amended`) could not clear the gate and the other
        three are lies about the work. Measured on the real registry: an `amended`
        carrying a genuine measurement was appended to DEF-ROC-053 and the next
        gate run still said "NO RECORDED EVENT since", 60 seconds later."""
        self._default_policy()
        self._fresh_ready()
        # entered `fixing` on day 23 (~7d stale) but ACTIVE 1 minute ago
        events = self._fixing_defect(23) + [
            {"ts": _dt(29, 23), "event": "amended", "agent": "orchestrator",
             "note": "measured the rate; instrument committed"}]
        self.write_item("active", "DEF-WORKED", "defect", events)
        findings = self._gate()
        self.assertEqual(
            [f for f in self._blocks(findings) if "DEF-WORKED" in f["ids"]], [],
            "an item with recorded activity inside the threshold is NOT idle")

    def test_AC_089_2_a_genuinely_quiet_slot_still_blocks(self):
        """The other direction, and the one that matters more: making any event
        restart the clock must NOT turn the check off. No events at all since the
        state was entered still blocks."""
        self._default_policy()
        self._fresh_ready()
        self.write_item("active", "DEF-IDLE", "defect", self._fixing_defect(23))
        findings = self._gate()
        got = [f for f in self._blocks(findings) if "DEF-IDLE" in f["ids"]]
        self.assertEqual(len(got), 1, findings)
        self.assertEqual(got[0]["kind"], "claimed-no-activity")

    def test_AC_089_2b_an_OLD_amended_does_not_keep_a_slot_alive(self):
        """A stale `amended` is not activity. Entered day 20, last touched day 21,
        so ~8 days quiet — still blocks, and the idle time is measured from the
        EVENT, not from the state entry."""
        self._default_policy()
        self._fresh_ready()
        events = self._fixing_defect(20) + [
            {"ts": _dt(21, 0), "event": "amended", "agent": "orchestrator"}]
        self.write_item("active", "DEF-STALE", "defect", events)
        findings = self._gate()
        got = [f for f in self._blocks(findings) if "DEF-STALE" in f["ids"]]
        self.assertEqual(len(got), 1, findings)

    def test_AC_089_3_an_amendment_does_NOT_reset_a_SCHEDULED_item_clock(self):
        """The v145 behaviour DEF-ROC-089's fix must not break, and the reason it
        exists: `_current_segment` merges adjacent same-state segments so that
        attaching a reversal probe to a 34-day park — which is an `amended` —
        cannot reset that park's age. Without the merge, migrating the parks to
        make their age VISIBLE would have HIDDEN it, on the single largest
        contributor to gross lead time.

        So the two limbs must answer differently: CLAIMED asks "is anyone holding
        this slot" (activity counts, AC-089.1); SCHEDULED asks "how long has this
        sat here" (an amendment is commentary on a wait, not the end of it)."""
        self._default_policy()
        self._fresh_ready()
        # scheduled long ago, amended one minute ago — must STILL block
        events = self._scheduled_oi(20) + [
            {"ts": _dt(29, 23), "event": "amended", "agent": "flow-manager",
             "note": "attached a reversal probe"}]
        self.write_item("active", "OI-PARKED", "open-item", events)
        findings = self._gate()
        got = [f for f in self._blocks(findings) if "OI-PARKED" in f["ids"]]
        self.assertEqual(len(got), 1,
                         "an amendment must not reset a SCHEDULED item's clock (v145)")
        self.assertEqual(got[0]["kind"], "scheduled-not-pulled")
        # and it is still measured from the state entry, not from the amendment
        self.assertGreater(got[0]["idle_s"], 8 * 24 * 3600.0)

    def test_AC_089_4_the_message_does_not_claim_no_events_when_events_exist(self):
        """AC-089.4 — the printed sentence was false on its face. It must describe
        what it actually measured."""
        self._default_policy()
        self._fresh_ready()
        events = self._fixing_defect(20) + [
            {"ts": _dt(21, 0), "event": "amended", "agent": "orchestrator"}]
        self.write_item("active", "DEF-MSG", "defect", events)
        findings = self._gate()
        msg = [f for f in self._blocks(findings) if "DEF-MSG" in f["ids"]][0]["message"]
        self.assertNotIn("NO RECORDED EVENT since", msg,
                         "an item WITH events must not be described as having none")
        self.assertIn("last recorded event", msg)

    # ---- AC-127.1 — the build states are no longer blind spots ---------------
    def test_AC_127_1_work_abandoned_in_a_build_state_blocks(self):
        """The reconstructed 2026-08-19 population: `fixing`/`building`/`reproducing`/
        `deploying` idle for days, which the gate could not see at all."""
        self._default_policy()
        self._fresh_ready()
        self.write_item("active", "DEF-FIXING", "defect", self._fixing_defect(23))
        self.write_item("active", "UC-BUILDING", "use-case", self._building_at(24))
        self.write_item("active", "DEF-REPRO", "defect", self._reproducing_defect(25))
        self.write_item("active", "UC-DEPLOYING", "use-case", self._deploying_uc(24, 2))
        findings = self._gate()
        got = sorted(i for f in self._blocks(findings) for i in f["ids"])
        self.assertEqual(got, ["DEF-FIXING", "DEF-REPRO", "UC-BUILDING", "UC-DEPLOYING"],
                         findings)
        by_id = {f["ids"][0]: f for f in self._blocks(findings)}
        self.assertEqual(by_id["DEF-FIXING"]["state"], "fixing")
        self.assertEqual(by_id["DEF-REPRO"]["state"], "reproducing")
        self.assertEqual(by_id["UC-BUILDING"]["state"], "building")
        self.assertEqual(by_id["UC-DEPLOYING"]["state"], "deploying")
        self.assertEqual(by_id["DEF-FIXING"]["owner"], "engineer")
        self.assertEqual(by_id["UC-DEPLOYING"]["owner"], "cicd")
        # the idle time is REPORTED, not merely detected
        self.assertGreater(by_id["DEF-FIXING"]["idle_s"], 6 * 86400)
        code, out = self._run()
        self.assertEqual(code, 2)
        for iid in ("DEF-FIXING", "UC-BUILDING", "DEF-REPRO", "UC-DEPLOYING"):
            self.assertIn(iid, out)
        self.assertIn("stalled-work", out)

    def test_AC_127_1_reworking_is_covered_too(self):
        self._default_policy()
        self._fresh_ready()
        self.write_item("active", "UC-RW", "use-case", self._reworking_uc("x", 23))
        got = sorted(i for f in self._blocks(self._gate()) for i in f["ids"])
        self.assertEqual(got, ["UC-RW"])

    def test_AC_127_1_scheduled_but_never_pulled_blocks(self):
        """The other arm of the SAME blind spot: three items sat in `ready`, already
        SCHEDULED, for 127-199h while the gate reported nothing and `wip` showed four
        free slots. An item nobody pulled raises nothing today."""
        self._default_policy()
        self._fresh_ready()
        self.write_item("active", "OI-SCHED", "open-item", self._scheduled_oi(21))
        self.write_item("active", "UC-SCHED", "use-case",
                        self._ready_uc("UC-SCHED", 21))
        blocks = self._blocks(self._gate())
        got = sorted(i for f in blocks for i in f["ids"])
        self.assertEqual(got, ["OI-SCHED", "UC-SCHED"], blocks)
        by_id = {f["ids"][0]: f for f in blocks}
        self.assertEqual(by_id["OI-SCHED"]["state"], "scheduled")
        self.assertEqual(by_id["UC-SCHED"]["state"], "ready")
        # a scheduled item is a DIFFERENT quantity from a claimed one, and the
        # finding says which it is (AC-127.3 needs the two remedies separable)
        self.assertEqual(by_id["OI-SCHED"]["kind"], "scheduled-not-pulled")
        self.assertEqual(by_id["UC-SCHED"]["kind"], "scheduled-not-pulled")

    def test_AC_127_1_work_within_its_threshold_does_not_block(self):
        """NOT NOISY, and this is the limb that proves it: an item worked for hours
        is not abandoned. Everything here is inside its threshold and NOTHING fires
        — so a green run of this class means something."""
        self._default_policy()
        self._fresh_ready()
        # `building` since day 29 18:00 -> 6h before NOW
        self.write_item("active", "UC-BUSY", "use-case", self._building_at(29, 18))
        self.write_item("active", "DEF-BUSY", "defect", self._fixing_defect(29, 20))
        self.write_item("active", "OI-JUST-SCHED", "open-item", self._scheduled_oi(28, 6))
        findings = self._gate()
        self.assertEqual(self._blocks(findings), [], findings)

    def test_AC_127_1_a_parked_item_is_not_reported_as_stalled_work(self):
        """`blocked` and `awaiting_observation` are owner=external: a recorded reason
        exists and check 5 / the block re-check own them. Reporting them here would
        double-count the one thing that IS already visible."""
        self._default_policy()
        self._fresh_ready()
        self.write_item("active", "UC-BLOCKED", "use-case",
                        self._ready_uc("UC-BLOCKED", 10)
                        + [{"ts": _dt(11, 0), "event": "blocked",
                                               "agent": "flow-manager"}])
        self.assertEqual(self._blocks(self._gate()), [])

    def test_AC_127_1_intake_is_not_reported_as_stalled_work(self):
        """An item in a BACKLOG queue is aging inventory, not abandoned work: check 4
        owns it by AGE-WITHOUT-A-DECISION, and blocking on it here would report the
        same item twice under two remedies."""
        self._default_policy()
        self._fresh_ready()
        self.write_item("active", "DEF-INTAKE", "defect",
                        [{"ts": _dt(1, 0), "event": "reported", "agent": "orchestrator"}])
        self.write_item("active", "OI-OPEN", "open-item",
                        [{"ts": _dt(1, 0), "event": "open", "agent": "flow-manager"}])
        self.assertEqual(self._blocks(self._gate()), [])

    # ---- AC-127.1 (completeness) — the population may not be a hand list ------
    def test_AC_127_1_every_wip_stage_state_has_a_threshold(self):
        """THE GUARD AGAINST THE DEFECT RECURRING. The population is DERIVED from
        state-graphs.json (non-terminal + non-backlog queue + not owner=external),
        so a state added to the graph later is covered by construction. If a future
        state has no threshold, this fails rather than silently exempting it."""
        pop = wi.stalled_work_states(self.graphs, wi.read_queue_policy(self.project))
        self.assertEqual(
            sorted(pop),
            sorted(["building", "deploying", "dev-validating", "prod-deploying",
                    "prod-validating", "reworking", "reproducing", "fixing",
                    "validating", "ready", "scheduled"]),
            "a state entered/left the WIP-STAGE population — give it a threshold "
            "and update this pin deliberately")
        for state, hours in pop.items():
            self.assertIsInstance(hours, float)
            self.assertGreater(hours, 0.0)

    def test_AC_127_1_an_unlisted_wip_state_fails_closed(self):
        """A state in the population with no entry in the derived map takes the
        WORK default and therefore still FIRES. Fail-closed: a new state is never
        silently exempt."""
        self.assertEqual(wi.stalled_work_hours_for("some-future-state"),
                         wi.DEFAULT_STALLED_WORK_HOURS)

    # ---- AC-127.2 — the thresholds come from the measured distribution --------
    def test_AC_127_2_thresholds_are_the_measured_ones(self):
        """Derived from views/stats.md §B measured-dwell medians (backfill held
        apart per §17f): fixing 670s, reproducing 733s, building 1536s, deploying
        685s, dev-validating 1790s, validating 10001s, reworking 4626s. 24h is
        58-3400x every one of them. `scheduled`'s median is 55091s (15.3h, ZERO
        backfill) — an order of magnitude higher and a DIFFERENT quantity (queue
        latency, not effort), so it gets its own, larger number."""
        for s in ("building", "fixing", "reproducing", "reworking", "deploying",
                  "prod-deploying", "validating", "dev-validating", "prod-validating"):
            self.assertEqual(wi.stalled_work_hours_for(s), 24.0, s)
        for s in ("ready", "scheduled"):
            self.assertEqual(wi.stalled_work_hours_for(s), 48.0, s)
        self.assertGreater(wi.stalled_work_hours_for("scheduled"),
                           wi.stalled_work_hours_for("building"))

    def test_AC_127_2_the_retro_can_tune_it_in_policy_csv(self):
        """Same ownership as every other buffer knob (§F2): the number lives in
        queues/policy.csv, per QUEUE, and the code default is only the fallback."""
        self._policy([("intake", "min_items", 2), ("intake", "wip_limit", 10),
                      ("ready", "min_items", 3), ("ready", "wip_limit", 4),
                      ("wip", "stall_hours", 240)])
        self._fresh_ready()
        self.write_item("active", "DEF-FIXING", "defect", self._fixing_defect(23))
        # 7 days idle < the tuned 240h -> no finding
        self.assertEqual(self._blocks(self._gate()), [])
        pol = wi.read_queue_policy(self.project)
        self.assertEqual(wi.stalled_work_hours_for("fixing", pol, self.graphs), 240.0)

    # ---- AC-127.3 — the remedy distinguishes re-dispatch from release ---------
    def test_AC_127_3_remedy_offers_redispatch_AND_release(self):
        self._default_policy()
        self._fresh_ready()
        self.write_item("active", "DEF-FIXING", "defect", self._fixing_defect(23))
        msg = self._blocks(self._gate())[0]["message"]
        self.assertIn("RE-DISPATCH", msg)
        self.assertIn("RELEASE", msg)
        self.assertIn("EVENT=blocked", msg)          # the release is executable
        self.assertIn("DEF-FIXING", msg)
        self.assertIn("fixing", msg)

    def test_AC_127_3_message_claims_no_activity_never_abandonment(self):
        """POINT OF HONESTY. The event log CANNOT distinguish an agent working a hard
        item for six hours from an item nobody holds: nothing records a dispatch. So
        the finding reports the fact it has (no event since T) and must not assert
        the inference it cannot make."""
        self._default_policy()
        self._fresh_ready()
        self.write_item("active", "DEF-FIXING", "defect", self._fixing_defect(23))
        msg = self._blocks(self._gate())[0]["message"]
        # DEF-ROC-089 changed the WORDING and this assertion moved with it. The
        # old literal was "NO RECORDED EVENT since", which AC-089.4 removed
        # BECAUSE IT WAS FALSE whenever events existed — an item amended sixty
        # seconds ago was described as having no recorded event. The property
        # this test actually guards is unchanged and is re-asserted below: state
        # the FACT (no activity for X, and what X was measured from), never the
        # INFERENCE (that the work was abandoned).
        self.assertIn("no activity", msg.lower())
        self.assertIn("measured from", msg.lower())
        self.assertNotIn("abandoned", msg.lower())
        self.assertIn("cannot tell", msg.lower())

    def test_AC_127_3_scheduled_remedy_differs_from_the_claimed_one(self):
        self._default_policy()
        self._fresh_ready()
        self.write_item("active", "OI-SCHED", "open-item", self._scheduled_oi(21))
        msg = self._blocks(self._gate())[0]["message"]
        self.assertIn("PULL", msg)
        self.assertIn("defer_until", msg)

    # ---- AC-127.4 — depth is occupancy, and it must say so -------------------
    def test_AC_127_4_wip_over_cap_says_it_counts_occupancy(self):
        """`wip: 7` looks identical whether seven agents are working or seven items
        are abandoned. That reading cost 35 deferred items."""
        self._policy([("intake", "min_items", 2), ("intake", "wip_limit", 10),
                      ("ready", "min_items", 3), ("ready", "wip_limit", 4),
                      ("wip", "wip_limit", 2)])
        self._fresh_ready()
        for i in range(3):
            self.write_item("active", f"DEF-S{i}", "defect", self._fixing_defect(23, i))
        over = [f for f in self._gate()
                if f["check"] == "queue-over-cap" and f.get("queue") == "wip"]
        self.assertEqual(len(over), 1, over)
        msg = over[0]["message"]
        self.assertIn("OCCUPANCY", msg.upper())
        self.assertIn("0 with recorded activity", msg)
        self.assertIn("3 idle", msg)
        self.assertEqual(over[0]["active"], 0)
        self.assertEqual(over[0]["idle"], 3)

    def test_AC_127_4_header_reports_occupied_versus_active_every_run(self):
        """It must be on EVERY run, not only when over cap: the wrong decision was
        taken while wip was UNDER its cap."""
        self._default_policy()
        self._fresh_ready()
        self.write_item("active", "DEF-BUSY", "defect", self._fixing_defect(29, 20))
        self.write_item("active", "DEF-IDLE", "defect", self._fixing_defect(23))
        code, out = self._run()
        head = out.splitlines()[0]
        self.assertIn("wip 2 occupied", head)
        self.assertIn("1 active", head)
        self.assertIn("1 idle", head)

    def test_AC_127_4_activity_split_is_computable_on_its_own(self):
        self._default_policy()
        self._fresh_ready()
        self.write_item("active", "DEF-BUSY", "defect", self._fixing_defect(29, 20))
        self.write_item("active", "DEF-IDLE", "defect", self._fixing_defect(23))
        act = wi.compute_wip_activity(self.graphs, self.project, now=wi.parse_ts(NOW))
        self.assertEqual(act["wip"]["occupied"], 2)
        self.assertEqual(act["wip"]["active"], 1)
        self.assertEqual(act["wip"]["idle"], 1)
        self.assertEqual(act["wip"]["idle_ids"], ["DEF-IDLE"])
        self.assertEqual(act["ready"]["occupied"], 3)
        self.assertEqual(act["ready"]["idle"], 0)

    # ---- §17i — a check that cannot look must SAY SO, never pass -------------
    def test_17i_unreadable_dwell_reports_could_not_look(self):
        """An item whose latest event carries an unparseable ts has NO open segment
        for its current state, so its idle time cannot be computed. The old shape
        (`if ent is None: continue`) collapses that into a pass — the exact class
        §17i was written against."""
        self._default_policy()
        self._fresh_ready()
        self.write_item("active", "DEF-BADTS", "defect",
                        [{"ts": _dt(20, 0), "event": "reported", "agent": "orchestrator"},
                         {"ts": _dt(20, 1), "event": "triaged", "agent": "orchestrator"},
                         {"ts": "not-a-timestamp", "event": "confirmed",
                          "agent": "engineer"}])
        findings = [f for f in self._gate() if f["check"] == "stalled-work"]
        self.assertEqual(len(findings), 1, findings)
        # and it BLOCKS: the subject is an OCCUPIED WIP slot, so "we could not tell"
        # must stop the pull exactly as "it is idle" does (§17i).
        self.assertEqual(findings[0]["severity"], "block")
        self.assertIsNone(findings[0]["idle_s"])
        self.assertIn("COULD NOT LOOK", findings[0]["message"].upper())
        self.assertIn("DEF-BADTS", findings[0]["message"])
        code, out = self._run()
        self.assertEqual(code, 2)
        self.assertIn("COULD NOT LOOK", out)

    def test_17i_check_is_unconditional_no_flag_can_switch_it_off(self):
        """--no-observe exists and skips check 5's predicates. Nothing may skip THIS
        limb: a gate with an off switch is a gate that cannot fail."""
        self._default_policy()
        self._fresh_ready()
        self.write_item("active", "DEF-FIXING", "defect", self._fixing_defect(23))
        for kwargs in ({"observe": False}, {"observe": True},
                       {"max_backlog_age_days": self.NEVER_AGES},
                       {"stale_hours": 100000.0}):
            with self.subTest(**kwargs):
                self.assertEqual(
                    [i for f in self._blocks(self._gate(**kwargs)) for i in f["ids"]],
                    ["DEF-FIXING"], kwargs)

    # ---- the second hole check 1 left: a stall with NO ref never blocked ------
    def test_a_stalled_validation_without_a_ref_now_BLOCKS(self):
        """Check 1 reports UNKNOWN (non-blocking) when a validating item carries no
        `ref:` — so an item idle for a week in `validating` never stopped the loop.
        Idleness is a fact independent of whether the work is finished."""
        self._default_policy()
        self._fresh_ready()
        self.write_item("active", "DEF-NOREF", "defect",
                        self._validating_defect(22, 3, fixed_ref=False))
        findings = self._gate()
        self.assertEqual([f["severity"] for f in findings
                          if f["check"] == "stalled-validation"], ["unknown"])
        self.assertEqual([i for f in self._blocks(findings) for i in f["ids"]],
                         ["DEF-NOREF"])

    # ---- AC-127.5 (§17g sweep) — the same shape found in check 4 -------------
    def test_AC_127_5_backlog_item_with_no_computable_age_is_NOT_ESTABLISHED(self):
        """Swept out of this defect: check 4 did `if ent is None: continue`, so an
        item whose AGE cannot be computed was exempt from the aging gate for ever
        and `validate` reported clean for it too. Real population when this was
        measured: THREE — DEFECT-OAG-129 and DEFECT-OAG-130 (value 26 each) and
        OI-DEF124-SWEEP-LEDGER, all with an EMPTY `events:` list."""
        self._default_policy()
        self._fresh_ready()
        self.write_item("active", "DEF-NOEVENTS", "defect", [])
        findings = self._gate(max_backlog_age_days=1.0)
        un = [f for f in findings if f["check"] == "aged-backlog-unreadable"]
        self.assertEqual(len(un), 1, findings)
        self.assertEqual(un[0]["severity"], "unknown")
        self.assertIn("DEF-NOEVENTS", un[0]["ids"])
        self.assertIn("NOT ESTABLISHED", un[0]["message"])
        # it is NOT counted as an aged-undecided item either way — the point is that
        # the gate says so out loud instead of skipping it
        aged = [f for f in findings if f["check"] == "aged-backlog-undecided"]
        self.assertTrue(all("DEF-NOEVENTS" not in f["ids"] for f in aged), aged)
        code, out = self._run(max_backlog_age_days=1.0)
        self.assertIn("NOT ESTABLISHED", out)
        self.assertIn("DEF-NOEVENTS", out)

    def test_AC_127_5_a_readable_backlog_item_is_still_measured_normally(self):
        """Non-vacuity for the limb above: the unreadable path must not swallow the
        ordinary one."""
        self._default_policy()
        self._fresh_ready()
        self.write_item("active", "DEF-OLD", "defect",
                        [{"ts": _dt(1, 0), "event": "reported", "agent": "orchestrator"}])
        findings = self._gate(max_backlog_age_days=1.0)
        aged = [f for f in findings if f["check"] == "aged-backlog-undecided"]
        self.assertEqual(len(aged), 1, findings)
        self.assertIn("DEF-OLD", aged[0]["ids"])
        self.assertEqual([f for f in findings
                          if f["check"] == "aged-backlog-unreadable"], [])

    def test_no_double_report_when_check1_already_blocks_the_item(self):
        """One item, one remedy. Check 1's finding is the more specific one (the work
        is DONE, dispatch the tester), so this limb yields to it."""
        self._default_policy()
        self._fresh_ready()
        self.write_item("active", "DEF-DONE", "defect",
                        self._validating_defect(22, 3, ref="abc1234"))
        findings = self._gate()
        self.assertEqual([f["check"] for f in findings
                          if "DEF-DONE" in f.get("ids", [])], ["stalled-validation"])


# ===========================================================================
# DEFECT-OAG-128 — a `ref:` is REPO-SCOPED, and the derivation looked in one repo
#
# Reproduced BEFORE the fix, against the real repos (recorded on the item):
#   _ref_on_trunk('OagEventSource', '8dae2cc') -> None   real, on the parent's main
#   _ref_on_trunk('OagEventSource', 'deadbee') -> None   fabricated, nowhere at all
# equal — so a wrong-place lookup and a destroyed commit were the same reading, and
# loop-gate printed the same string for both. These cases keep them apart.
#
# The topology is built with REAL git repos, not a patched seam. The whole defect is
# about WHICH REPO A LOOKUP LANDS IN, so a fake that answers by lane would assert
# the belief instead of the behaviour.
# ===========================================================================
class TestRefRepoScoping(Base):
    def _git(self, repo, *args):
        return subprocess.run(["git", "-C", repo, *args], capture_output=True,
                              text=True, check=False)

    def _init_repo(self, d, branch="main"):
        os.makedirs(d, exist_ok=True)
        self._git(d, "init", "-q", "-b", branch)
        self._git(d, "config", "user.email", "a@b.test")
        self._git(d, "config", "user.name", "A")
        self._git(d, "config", "commit.gpgsign", "false")
        return d

    def _write(self, root, rel, text):
        p = os.path.join(root, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            f.write(text)

    def _commit(self, repo, rel, text, msg):
        """A commit, and its short sha."""
        self._write(repo, rel, text)
        self._git(repo, "add", "-A")
        self._git(repo, "commit", "-q", "-m", msg)
        return self._git(repo, "rev-parse", "--short=7", "HEAD").stdout.strip()

    def _push(self, repo):
        """Publish the current branch to this repo's own `origin`, so origin/<b>
        exists. `--bare` because a non-bare push target refuses a checked-out
        branch — and the check tests ORIGIN refs only, deliberately: the question
        is 'is it PUSHED', which a local branch cannot answer."""
        remote = repo + "-origin.git"
        if not os.path.exists(remote):
            subprocess.run(["git", "init", "-q", "--bare", remote], check=True)
            self._git(repo, "remote", "add", "origin", remote)
        br = self._git(repo, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
        self._git(repo, "push", "-q", "origin", br)
        self._git(repo, "fetch", "-q", "origin")

    def _topology(self, parent_branch="main"):
        """The real shape: a parent repo that gitignores each project's own nested
        repo, so the project repo is a SEPARATE repo living inside the parent's
        working tree. Both are real; neither can see the other's objects.

        Built AT `wi.ROOT` rather than in a side directory, so the items the gate
        reads and the repos it queries share one root — the same relationship they
        have in production. Patching ROOT to a repo elsewhere silently pointed
        `load_all_items` at an empty tree and every finding came back empty, which
        is the sort of vacuous green this whole item is about."""
        parent = self._init_repo(self.tmp, parent_branch)
        self._write(parent, ".gitignore", "/work/*/\n")
        self._commit(parent, "CLAUDE.md", "agent system\n", "parent base")
        proj = self._init_repo(os.path.join(parent, "work", self.project))
        self._commit(proj, "src/a.ts", "a\n", "project base")
        self.assertEqual(os.path.abspath(parent), os.path.abspath(wi.ROOT))
        return parent, proj

    # -- AC-128.1: resolution finds the ref in whichever repo actually holds it --
    def test_AC_128_1_a_parent_lane_ref_resolves_and_reads_PUSHED(self):
        """The six real cases. A parent-repo commit on the parent's origin trunk
        must read ON-TRUNK — not missing, which is what the defect produced."""
        parent, _proj = self._topology()
        sha = self._commit(parent, "process/x.md", "x\n", "a parent-lane fix")
        self._push(parent)
        r = wi.resolve_ref(self.project, sha)
        self.assertEqual(r["verdict"], wi.REF_ON_TRUNK, r)
        self.assertEqual(r["lane"], wi.LANE_PARENT, r)

    def test_AC_128_1_a_project_lane_ref_still_resolves_the_control_arm(self):
        """The arm that already worked and must keep working — the fix must not
        buy the parent lane at the project lane's expense."""
        parent, proj = self._topology()
        sha = self._commit(proj, "src/b.ts", "b\n", "a project-lane fix")
        self._push(proj)
        r = wi.resolve_ref(self.project, sha)
        self.assertEqual(r["verdict"], wi.REF_ON_TRUNK, r)
        self.assertEqual(r["lane"], wi.LANE_PROJECT, r)

    def test_AC_128_1_a_parent_ref_is_NOT_read_out_of_the_project_repo(self):
        """The mechanism, asserted directly: the two repos have disjoint histories,
        so a parent sha must be absent from the project repo. If this ever fails the
        fixture has stopped reproducing the defect's precondition and every other
        case in this class is vacuous."""
        parent, proj = self._topology()
        sha = self._commit(parent, "process/y.md", "y\n", "parent only")
        self.assertEqual(
            self._git(proj, "rev-parse", "--verify", "--quiet",
                      sha + "^{commit}").returncode, 1)

    def test_AC_128_1_committed_but_unpushed_is_NOT_ON_TRUNK_not_absent(self):
        """A parent-lane commit that exists but was never pushed (the normal state
        of this repo — the owner owns the parent push). It is UNPUSHED, which is a
        different fact from LOST, and conflating them is the defect."""
        parent, _proj = self._topology()
        sha = self._commit(parent, "process/z.md", "z\n", "unpushed parent work")
        self._push(parent)
        sha2 = self._commit(parent, "process/z2.md", "z2\n", "later, unpushed")
        r = wi.resolve_ref(self.project, sha2)
        self.assertEqual(r["verdict"], wi.REF_NOT_ON_TRUNK, r)
        self.assertEqual(r["lane"], wi.LANE_PARENT, r)
        self.assertNotEqual(r["verdict"], wi.REF_ABSENT)
        self.assertTrue(sha)          # the pushed sibling really was pushed

    def test_AC_128_1_parent_trunk_is_the_worktree_branchs_origin_not_only_main(self):
        """A per-project worktree sits on `instance/<project>`, so a parent-lane
        commit's push destination is origin/instance/<project>. Without that
        candidate every parent ref reads NOT-ON-TRUNK for the wrong reason."""
        parent, _proj = self._topology(parent_branch="instance/" + self.project)
        sha = self._commit(parent, "process/w.md", "w\n", "on the instance branch")
        self._push(parent)
        r = wi.resolve_ref(self.project, sha)
        self.assertEqual(r["verdict"], wi.REF_ON_TRUNK, r)
        self.assertEqual(r["trunk"], "origin/instance/" + self.project, r)

    # -- AC-128.2: the DEFECT-OAG-072 alarm survives, and is DISTINCT ----------
    def test_AC_128_2_a_sha_that_exists_NOWHERE_is_ABSENT_and_LOUD(self):
        """The alarm that means work may have been destroyed. Before the fix this
        returned the same None as a wrong-repo lookup, i.e. it did not exist."""
        parent, _proj = self._topology()
        self._push(parent)
        r = wi.resolve_ref(self.project, "deadbee")
        self.assertEqual(r["verdict"], wi.REF_ABSENT, r)
        self.assertEqual(sorted(r["searched"]),
                         sorted([wi.LANE_PARENT, wi.LANE_PROJECT]), r)
        self.assertEqual(r["unreadable"], [], r)

    def test_AC_128_2_ABSENT_is_a_DIFFERENT_verdict_from_a_wrong_repo_lookup(self):
        """THE regression this defect is. Both arms in one assertion, so the fix
        cannot be satisfied by making them agree again in the other direction."""
        parent, _proj = self._topology()
        real = self._commit(parent, "process/r.md", "r\n", "real parent work")
        self._push(parent)
        found = wi.resolve_ref(self.project, real)
        absent = wi.resolve_ref(self.project, "deadbee")
        self.assertNotEqual(found["verdict"], absent["verdict"])
        self.assertEqual(found["verdict"], wi.REF_ON_TRUNK)
        self.assertEqual(absent["verdict"], wi.REF_ABSENT)

    def test_AC_128_2_an_UNREADABLE_repo_is_CANNOT_DETERMINE_never_ABSENT(self):
        """§17i. If a lane repo could not be read, the object's absence was never
        established — and claiming destroyed work on a partial search is how a real
        alarm gets trained out of people."""
        parent, proj = self._topology()
        self._push(parent)
        shutil.rmtree(os.path.join(proj, ".git"))
        r = wi.resolve_ref(self.project, "deadbee")
        self.assertEqual(r["verdict"], wi.REF_CANNOT_DETERMINE, r)
        self.assertIn(wi.LANE_PROJECT, r["unreadable"], r)

    def test_AC_128_2_no_ref_at_all_is_CANNOT_DETERMINE_never_ABSENT(self):
        parent, _proj = self._topology()
        for empty in (None, "", "   "):
            r = wi.resolve_ref(self.project, empty)
            self.assertEqual(r["verdict"], wi.REF_CANNOT_DETERMINE, (empty, r))

    # -- the third fault, found by BUILDING the alarm (UC-XA5 / `605428`) ------
    def test_AC_128_2_an_all_digit_ref_stripped_of_its_leading_zero_is_repaired(self):
        """Without this the new ABSENT alarm FALSE-FIRES on its first real run.
        `_parse_scalar` int-coerces an all-digit frontmatter value, so the sha
        `0605428` was read as 605428 and re-rendered WITHOUT the zero; `UC-XA5`
        therefore records a ref that resolves in neither repo — the exact ABSENT
        signature — while its real commit 06054289ae9d50bf194b98643d920939b5d7531b
        sits on origin/main. Repaired at READ time because the loss is already on
        disk in every item written before the parser fix.

        Driven by a REAL git object, not a stubbed lookup: `commit-tree` is searched
        until it mints a sha with a leading zero followed by digits, so the
        int-coercion is applied to a sha git will actually resolve. The object is
        deliberately left unreachable — the claim is that the repair stops the
        FALSE ABSENT, and reachability would test ancestry instead."""
        _parent, proj = self._topology()
        tree = self._git(proj, "rev-parse", "HEAD^{tree}").stdout.strip()
        head = self._git(proj, "rev-parse", "HEAD").stdout.strip()
        target = None
        for i in range(4000):
            sha = self._git(proj, "commit-tree", tree, "-p", head,
                            "-m", "hunt %d" % i).stdout.strip()
            # width 7 deliberately: that is the abbreviation this registry records,
            # so `mangled` comes out at 6 chars — UC-XA5's exact shape.
            if sha.startswith("0") and sha[:7].isdigit():
                target = sha[:7]
                break
        self.assertIsNotNone(
            target, "no leading-zero all-digit abbreviation minted in 4000 tries; "
                    "the fixture stopped exercising the int-coercion repair")
        mangled = str(int(target))
        self.assertNotEqual(mangled, target)          # the coercion really bites
        r = wi.resolve_ref(self.project, mangled)
        baseline = wi.resolve_ref(self.project, mangled + "f" * 8)
        self.assertNotEqual(r["verdict"], wi.REF_ABSENT, r)
        self.assertTrue(r["padded"], r)
        self.assertEqual(r["resolved"], target, r)
        # and the repair is NOT a blanket "never say absent": a genuinely absent
        # sha of the same shape still reads ABSENT.
        self.assertEqual(baseline["verdict"], wi.REF_ABSENT, baseline)

    def test_AC_128_2_the_padding_repair_is_bounded_to_all_digit_refs(self):
        """A ref with any hex letter was never int-coerced, so padding it would be
        inventing candidates. Pure limb, no git."""
        self.assertEqual(wi._ref_candidates("8dae2cc"), ["8dae2cc"])
        cands = wi._ref_candidates("605428")
        self.assertEqual(cands[0], "605428")
        self.assertIn("0605428", cands)
        self.assertTrue(all(c.lstrip("0") == "605428" for c in cands[1:]), cands)

    def test_AC_128_2_the_root_cause_a_ref_is_never_int_coerced_on_read(self):
        """The repair above recovers old damage; this stops NEW damage. A sha is a
        string by nature and must round-trip through the item file unchanged."""
        ev = wi._parse_inline_map(
            '{ts: "2026-01-01T00:00:00Z", event: fixed, agent: engineer, ref: 0605428}')
        self.assertEqual(ev["ref"], "0605428")
        self.assertIsInstance(ev["ref"], str)

    def test_AC_128_2_string_by_intent_frontmatter_is_never_number_coerced(self):
        """IMP-029's unfinished audit, closed. The audit itself (via the real parser
        over all 478 items) found only value/cost/tokens/duration_ms parsed as
        numbers, every one numeric BY INTENT — so `ref` was the sole live hazard.
        `id` and `job` are protected anyway at a population of ZERO: the reason they
        are not coerced today is that nobody has written an all-digit one, which is
        luck, not a property (§17h)."""
        fm = wi.parse_frontmatter(
            "id: 12345678\ntype: defect\njob: 17\nlane: parent-repo\n"
            "value: 28\ncost: 2\n")
        self.assertEqual(fm["id"], "12345678")
        self.assertIsInstance(fm["id"], str)
        self.assertEqual(fm["job"], "17")
        self.assertIsInstance(fm["job"], str)
        # and the genuinely numeric fields are STILL numbers — the guard must not
        # turn the metric fields into strings and break every fold downstream.
        self.assertEqual((fm["value"], fm["cost"]), (28, 2))
        self.assertIsInstance(fm["value"], int)

    def test_AC_128_2_a_ref_round_trips_through_a_real_item_file(self):
        """End to end, not just the parser: write an item carrying `0605428`, read
        it back, and the leading zero is still there. This is the path that ate it —
        wi-project re-renders the file it just read."""
        self.write_item("active", "UC-ZERO", "use-case", [
            {"ts": _dt(1, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(1, 1), "event": "made_ready", "agent": "flow-manager"},
            {"ts": _dt(1, 2), "event": "pulled", "agent": "orchestrator"},
            {"ts": _dt(1, 3), "event": "built_green", "agent": "engineer",
             "ref": "0605428"},
        ])
        items, _dup = wi.load_all_items(self.project)
        ev = [e for e in items["UC-ZERO"].events if e.get("event") == "built_green"][0]
        self.assertEqual(str(ev["ref"]), "0605428")

    # -- AC-128.4: a declared lane is CROSS-CHECKED, not trusted ---------------
    def test_AC_128_4_a_lane_contradicted_by_every_ref_is_reported(self):
        parent, proj = self._topology()
        sha = self._commit(proj, "src/c.ts", "c\n", "a project-lane fix")
        self._push(proj)
        bad = wi.check_declared_lane(self.project, wi.LANE_PARENT, [sha])
        good = wi.check_declared_lane(self.project, wi.LANE_PROJECT, [sha])
        self.assertEqual(bad["verdict"], "contradicted", bad)
        self.assertEqual(bad["resolved_lanes"], [wi.LANE_PROJECT], bad)
        self.assertEqual(good["verdict"], "consistent", good)

    def test_AC_128_4_a_genuinely_TWO_LANE_item_is_NOT_a_misdeclaration(self):
        """DEFECT-OAG-091's real shape, and the reason `lane:` cannot be the routing
        key. Its log says "Two lanes, two repos, never mixed": 898880d4 project +
        2c6a7d58 parent. A single-valued field cannot express that, so declaring
        either one is INCOMPLETE, not FALSE. Calling it a misdeclaration would
        manufacture a violation out of a correct item."""
        parent, proj = self._topology()
        p_sha = self._commit(proj, "src/d.ts", "d\n", "project half")
        self._push(proj)
        q_sha = self._commit(parent, "process/d.md", "d\n", "parent half")
        self._push(parent)
        r = wi.check_declared_lane(self.project, wi.LANE_PROJECT, [p_sha, q_sha])
        self.assertEqual(r["verdict"], "spans-both", r)
        self.assertEqual(sorted(r["resolved_lanes"]),
                         sorted([wi.LANE_PARENT, wi.LANE_PROJECT]), r)

    def test_AC_128_4_an_absent_lane_is_UNDECLARED_not_a_violation(self):
        """`lane:` is absent on 382 of 478 items (79.9% — measured, not assumed), so
        treating absence as a violation would fail four fifths of the registry.
        It reports as UNDECLARED with the lane its refs imply, which is what makes a
        backfill mechanical."""
        parent, proj = self._topology()
        sha = self._commit(proj, "src/e.ts", "e\n", "a project-lane fix")
        self._push(proj)
        r = wi.check_declared_lane(self.project, None, [sha])
        self.assertEqual(r["verdict"], "undeclared", r)
        self.assertEqual(r["resolved_lanes"], [wi.LANE_PROJECT], r)

    def test_AC_128_4_a_lane_check_with_no_resolvable_ref_CANNOT_DETERMINE(self):
        parent, _proj = self._topology()
        r = wi.check_declared_lane(self.project, wi.LANE_PARENT, ["deadbee"])
        self.assertEqual(r["verdict"], "cannot-determine", r)
        self.assertEqual(r["resolved_lanes"], [], r)

    # -- back-compat: the tri-state wrapper still means what it meant ----------
    def test_the_tri_state_wrapper_delegates_and_never_calls_ABSENT_true(self):
        parent, proj = self._topology()
        sha = self._commit(proj, "src/f.ts", "f\n", "pushed")
        self._push(proj)
        self.assertIs(wi._ref_on_trunk(self.project, sha), True)
        unpushed = self._commit(proj, "src/g.ts", "g\n", "unpushed")
        self.assertIs(wi._ref_on_trunk(self.project, unpushed), False)
        # ABSENT maps to None, NOT to False: "the object is gone" must never
        # render as the ordinary, unalarming "not pushed yet".
        self.assertIsNone(wi._ref_on_trunk(self.project, "deadbee"))

    # ===================================================================
    # check 12 — every recorded `ref:` must still EXIST somewhere
    # (DEFECT-OAG-128 / AC-128.2). Check 1 only ever looks at items STALLED IN
    # VALIDATION; a destroyed commit on a DONE item is what nobody re-reads, and
    # that is precisely what happened to DEFECT-OAG-072.
    # ===================================================================
    def _done_item(self, iid, ref, lane=None, event="fixed"):
        evs = [
            {"ts": _dt(1, 0), "event": "reported", "agent": "orchestrator"},
            {"ts": _dt(1, 1), "event": "triaged", "agent": "orchestrator"},
            {"ts": _dt(1, 2), "event": "confirmed", "agent": "engineer"},
            {"ts": _dt(1, 3), "event": event, "agent": "engineer", "ref": ref},
            {"ts": _dt(1, 4), "event": "validated", "agent": "tester"},
        ]
        self.write_item("done", iid, "defect", evs,
                        extra_fm=({"lane": lane} if lane else None))

    def _default_policy(self):
        os.makedirs(os.path.join(self.tmp, "work", self.project, "queues"),
                    exist_ok=True)
        with open(os.path.join(self.tmp, "work", self.project, "queues",
                               "policy.csv"), "w", encoding="utf-8") as f:
            f.write("queue,param,value,owner,rationale\n"
                    "ready,min_items,3,retro,seed\n"
                    "ready,wip_limit,4,retro,seed\n"
                    "intake,min_items,2,retro,seed\n"
                    "intake,wip_limit,10,retro,seed\n"
                    "intake,kind,backlog,retro,seed\n")

    def _ready_uc(self, day):
        return [
            {"ts": _dt(day, 0), "event": "registered", "agent": "flow-manager"},
            {"ts": _dt(day, 1), "event": "made_ready", "agent": "flow-manager"},
        ]

    def _run_cli(self):
        buf = io.StringIO()
        args = argparse.Namespace(project=self.project, stale_hours=4.0, threshold=3,
                                  now="2026-06-25T00:00:00Z", observe=False,
                                  observe_timeout=5, max_backlog_age_days=7.0)
        code = 0
        with contextlib.redirect_stdout(buf):
            try:
                code = wi.cmd_loop_gate(args) or 0
            except SystemExit as ex:      # the gate exits 2; that IS the block
                code = ex.code or 0
        return code, buf.getvalue()

    def _prov(self, _parent=None, **kw):
        """`_parent` is accepted and ignored: the topology IS wi.ROOT, so there is
        nothing to redirect. Kept in the signature because each caller passing its
        parent makes the topology dependency visible at the call site."""
        return wi.compute_ref_provenance(self.project, **kw)

    def test_AC_128_2_check12_a_DONE_items_destroyed_commit_BLOCKS_the_loop(self):
        """The DEFECT-OAG-072 case exactly: an item DELIVERED COMPLETE and CLOSED
        whose objects are gone. Nothing else in the gate looks at a done item."""
        parent, _proj = self._topology()
        self._done_item("DEF-LOST", "deadbee")
        f = self._prov(parent)
        self.assertEqual([x["severity"] for x in f], ["block"], f)
        self.assertEqual(f[0]["ids"], ["DEF-LOST"])
        self.assertIn("EXIST IN NEITHER REPO", f[0]["message"])
        self.assertIn("DEFECT-OAG-072", f[0]["message"])
        self.assertIn("worktree-guard", f[0]["message"])   # rescue, not a re-run
        self.assertNotIn("re-run to see if it clears", f[0]["message"].split("do NOT")[0])

    def test_AC_128_2_check12_a_PARENT_lane_ref_is_NOT_reported_destroyed(self):
        """The defect itself, at registry scale: six real items read as destroyed
        because the lookup only ever entered the project repo."""
        parent, _proj = self._topology()
        sha = self._commit(parent, "process/p.md", "p\n", "a parent-lane fix")
        self._done_item("DEF-PARENT", sha)
        self.assertEqual(self._prov(parent), [])

    def test_AC_128_2_check12_a_PROJECT_lane_ref_is_NOT_reported_destroyed(self):
        parent, proj = self._topology()
        sha = self._commit(proj, "src/p.ts", "p\n", "a project-lane fix")
        self._done_item("DEF-PROJ", sha)
        self.assertEqual(self._prov(parent), [])

    def test_AC_128_2_check12_an_unpushed_commit_is_not_an_alarm(self):
        """Existence, never ancestry. Unpushed-ness is check 1's business and is a
        completely ordinary state of the parent repo."""
        parent, _proj = self._topology()
        sha = self._commit(parent, "process/u.md", "u\n", "never pushed anywhere")
        self._done_item("DEF-UNPUSHED", sha)
        self.assertEqual(self._prov(parent), [])

    def test_AC_128_2_check12_an_unreadable_repo_is_COULD_NOT_LOOK_not_the_alarm(self):
        """§17i. A partial search cannot establish absence, and crying destroyed-work
        off one is how the alarm gets trained out of people — which is how
        DEFECT-OAG-072 was lost."""
        parent, proj = self._topology()
        self._done_item("DEF-LOST", "deadbee")
        shutil.rmtree(os.path.join(proj, ".git"))
        f = self._prov(parent)
        self.assertEqual([x["severity"] for x in f], ["unknown"], f)
        self.assertIn("COULD NOT LOOK", f[0]["message"])
        self.assertIn("not a pass", f[0]["message"])
        self.assertNotIn("EXIST IN NEITHER REPO", f[0]["message"])

    def test_AC_128_2_check12_a_non_sha_ref_is_advisory_never_destroyed_work(self):
        """`UC-ML1` records `ref: delta-052` — an architecture-delta DOCUMENT id on a
        solution-architect `amended` event. The contract declares `ref: <sha>`, which
        is the AUTHORITY for excluding it (§17h); it is REPORTED, because a silent
        exclusion is where a mistyped sha would hide. Found on the check's first real
        run, and without it the alarm's first ever firing would have been false."""
        parent, _proj = self._topology()
        self._done_item("DEF-DOCREF", "delta-052", event="amended")
        f = self._prov(parent)
        self.assertEqual([x["severity"] for x in f], ["advisory"], f)
        self.assertIn("NOT sha-shaped", f[0]["message"])
        self.assertIn("delta-052", f[0]["message"])
        self.assertIn("CONTRACT.md", f[0]["message"])
        self.assertNotIn("EXIST IN NEITHER REPO", f[0]["message"])

    def test_AC_128_2_check12_a_MISTYPED_sha_still_reaches_the_alarm(self):
        """The exclusion above must not become a hiding place. A ref that is still
        sha-SHAPED but wrong is destroyed-work-shaped and must block."""
        parent, _proj = self._topology()
        real = self._commit(parent, "process/m.md", "m\n", "the real commit")
        self._done_item("DEF-TYPO", ("f" if real[0] != "f" else "e") + real[1:] + "ab")
        f = self._prov(parent)
        self.assertEqual([x["severity"] for x in f], ["block"], f)

    def test_AC_128_2_check12_the_zero_stripped_ref_does_not_false_fire(self):
        """UC-XA5's `605428`, at registry scale: the batched probe must submit the
        zero-padded repair candidates too, or this check false-fires on the 11
        all-digit refs already damaged on disk."""
        _parent, proj = self._topology()
        tree = self._git(proj, "rev-parse", "HEAD^{tree}").stdout.strip()
        head = self._git(proj, "rev-parse", "HEAD").stdout.strip()
        target = None
        for i in range(4000):
            sha = self._git(proj, "commit-tree", tree, "-p", head,
                            "-m", "hunt %d" % i).stdout.strip()
            # width 7 deliberately: that is the abbreviation this registry records,
            # so `mangled` comes out at 6 chars — UC-XA5's exact shape.
            if sha.startswith("0") and sha[:7].isdigit():
                target = sha[:7]
                break
        self.assertIsNotNone(target, "fixture stopped minting a leading-zero sha")
        mangled = str(int(target))
        self.assertNotEqual(mangled, target)
        self._done_item("DEF-ZERO", mangled)
        self.assertEqual(self._prov(_parent), [])

    def test_AC_128_2_check12_an_all_digit_ref_BELOW_the_hex_floor_is_still_asked_about(self):
        """Found by mutation: `return False` on the all-digit branch SURVIVED, because
        every other case sits at or above the 6-char hex floor. Int-coercion shortens
        a sha by however many leading zeros it ate, so a 4- or 5-digit ref can still
        be a repairable sha — and excluding it would route it to the MALFORMED
        advisory, i.e. silently out of the existence check, which is the hiding place
        §17h names. Below git's own 4-char abbreviation floor there is nothing to ask,
        so THAT is malformed."""
        self.assertTrue(wi._is_sha_shaped("1234"))          # 4 digits: askable
        self.assertTrue(wi._is_sha_shaped("12345"))         # 5 digits: askable
        self.assertFalse(wi._is_sha_shaped("123"))          # under git's floor
        self.assertFalse(wi._is_sha_shaped("delta-052"))    # not a sha at all
        # and it reaches the ALARM, not the advisory, when it resolves nowhere
        _parent, _proj = self._topology()
        self._done_item("DEF-SHORT", "1234")
        f = self._prov()
        self.assertEqual([x["severity"] for x in f], ["block"], f)
        self.assertEqual(f[0]["absent"], ["1234"], f)

    def test_AC_128_2_check12_a_TRUNCATED_batch_answer_is_unreadable_not_absence(self):
        """Found by mutation: dropping the length check SURVIVED. `cat-file
        --batch-check` is POSITIONAL — one answer line per input line — so a SHORT
        answer silently shifts every mapping after the cut and refs start reading as
        absent because their neighbour's line was consumed. This is the v143
        truncation class that made `worktree-guard` report NOT ESTABLISHED after the
        repo's history simply grew past a 64 KiB pipe buffer: nothing regressed, the
        world got bigger. A partial answer must read COULD-NOT-LOOK, never absence."""
        _parent, proj = self._topology()
        sha = self._commit(proj, "src/tr.ts", "tr\n", "a real commit")
        self._done_item("DEF-REAL", sha)
        real_git = wi._git

        def truncating(repo, *args, _stdin=None):
            rc, out = real_git(repo, *args, _stdin=_stdin)
            if _stdin is not None and out:
                out = "\n".join(out.split("\n")[:-1])      # lose the last line
            return rc, out

        wi._git = truncating
        try:
            f = self._prov()
        finally:
            wi._git = real_git
        self.assertEqual([x["severity"] for x in f], ["unknown"], f)
        self.assertIn("COULD NOT LOOK", f[0]["message"])
        self.assertNotIn("EXIST IN NEITHER REPO", f[0]["message"])

    # -- the EARLIEST catchable point: the append path, where the data enters ----
    def _append(self, iid, event, agent, ref):
        args = argparse.Namespace(project=self.project, id=iid, event=event,
                                  agent=agent, ref=ref, note=None, ts=None,
                                  observe=None, tokens=None, duration_ms=None,
                                  note_path=None, amend=None)
        err, out = io.StringIO(), io.StringIO()
        code = 0
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(out):
            try:
                wi.cmd_append(args)
            except SystemExit as ex:
                code = ex.code or 0
        return code, err.getvalue() + out.getvalue()

    def _open_defect(self, iid):
        self.write_item("active", iid, "defect", [
            {"ts": _dt(1, 0), "event": "reported", "agent": "orchestrator"},
            {"ts": _dt(1, 1), "event": "triaged", "agent": "orchestrator"},
            {"ts": _dt(1, 2), "event": "confirmed", "agent": "engineer"},
        ])

    def test_AC_128_2_append_REFUSES_a_ref_that_is_not_a_commit_sha(self):
        """`UC-ML1` put an architecture-delta DOCUMENT id (`delta-052`) in a field the
        contract reserves for a sha, and it sat there unnoticed until a control was
        built. There is no legitimate use, so this is refused rather than warned:
        refusing costs one corrected command, accepting costs a permanently
        unverifiable ref — and it is the shape a mistyped sha hides behind."""
        self._topology()
        self._open_defect("DEF-DOC")
        code, out = self._append("DEF-DOC", "fixed", "engineer", "delta-052")
        self.assertEqual(code, 1, out)
        self.assertIn("REFUSED", out)
        self.assertIn("CONTRACT.md", out)
        self.assertIn("--note", out)                    # names the remedy
        items, _d = wi.load_all_items(self.project)
        self.assertEqual([e for e in items["DEF-DOC"].events
                          if e.get("event") == "fixed"], [], "nothing was written")

    def test_AC_128_2_append_WARNS_but_still_RECORDS_a_sha_absent_everywhere(self):
        """Deliberately asymmetric to the refusal above. The event log IS the source
        of truth, so losing a real state transition because git could not vouch for
        its sha is worse than recording a suspect one. check 12 is the blocking
        control; this puts the complaint in front of the agent that made the mistake
        while it still remembers what it committed."""
        self._topology()
        self._open_defect("DEF-GONE")
        code, out = self._append("DEF-GONE", "fixed", "engineer", "deadbee")
        self.assertEqual(code, 0, out)
        self.assertIn("WARNING", out)
        self.assertIn("DEFECT-OAG-072", out)
        self.assertIn("worktree-guard", out)
        self.assertIn("BLOCK the loop", out)
        items, _d = wi.load_all_items(self.project)
        self.assertEqual([str(e["ref"]) for e in items["DEF-GONE"].events
                          if e.get("event") == "fixed"], ["deadbee"],
                         "the transition must NOT be lost")

    def test_AC_128_1_append_accepts_a_PARENT_lane_sha_in_silence(self):
        """The regression that matters most here: before the fix a parent-lane sha
        would have been the thing that looked destroyed. It must pass without a
        murmur, or every parent-lane append trains the agent to ignore the warning."""
        parent, _proj = self._topology()
        sha = self._commit(parent, "process/ap.md", "ap\n", "parent-lane work")
        self._open_defect("DEF-PAR")
        code, out = self._append("DEF-PAR", "fixed", "engineer", sha)
        self.assertEqual(code, 0, out)
        self.assertNotIn("WARNING", out)
        self.assertNotIn("REFUSED", out)

    def test_AC_128_1_append_accepts_a_PROJECT_lane_sha_in_silence(self):
        _parent, proj = self._topology()
        sha = self._commit(proj, "src/ap.ts", "ap\n", "project-lane work")
        self._open_defect("DEF-PRJ")
        code, out = self._append("DEF-PRJ", "fixed", "engineer", sha)
        self.assertEqual(code, 0, out)
        self.assertNotIn("WARNING", out)
        self.assertNotIn("REFUSED", out)

    def test_AC_128_4_check12_a_contradicted_lane_is_reported_but_never_BLOCKS(self):
        """AC-128.4. Advisory on purpose: resolution no longer trusts `lane:`, so a
        wrong one costs a misrouted DISPATCH (DEFECT-OAG-076), not a wrong push
        reading — and blocking the loop on a stale field would stop delivery over a
        bookkeeping error."""
        parent, proj = self._topology()
        sha = self._commit(proj, "src/l.ts", "l\n", "project-lane work")
        self._done_item("DEF-BADLANE", sha, lane=wi.LANE_PARENT)
        f = self._prov(parent)
        self.assertEqual([x["severity"] for x in f], ["advisory"], f)
        self.assertEqual(f[0]["ids"], ["DEF-BADLANE"])
        self.assertIn("declares lane:parent-repo", f[0]["message"])
        self.assertIn("dispatch-check", f[0]["message"])

    def test_AC_128_4_check12_a_TWO_LANE_item_is_not_reported_at_all(self):
        """DEFECT-OAG-091's real shape — one project ref and one parent ref, declaring
        either. A single-valued field cannot express that, so the declaration is
        INCOMPLETE not FALSE, and flagging it would manufacture a violation."""
        parent, proj = self._topology()
        p_sha = self._commit(proj, "src/t.ts", "t\n", "project half")
        q_sha = self._commit(parent, "process/t.md", "t\n", "parent half")
        self.write_item("done", "DEF-TWOLANE", "defect", [
            {"ts": _dt(1, 0), "event": "reported", "agent": "orchestrator"},
            {"ts": _dt(1, 1), "event": "triaged", "agent": "orchestrator"},
            {"ts": _dt(1, 2), "event": "confirmed", "agent": "engineer"},
            {"ts": _dt(1, 3), "event": "fixed", "agent": "engineer", "ref": p_sha},
            {"ts": _dt(1, 4), "event": "validated", "agent": "tester", "ref": q_sha},
        ], extra_fm={"lane": wi.LANE_PROJECT})
        self.assertEqual(self._prov(parent), [])

    def test_AC_128_4_check12_an_UNDECLARED_lane_is_not_reported(self):
        """382 of 478 items (79.9%) have no `lane:`. Treating that as a violation
        would fail four fifths of the registry on its first run."""
        parent, proj = self._topology()
        sha = self._commit(proj, "src/n.ts", "n\n", "no lane declared")
        self._done_item("DEF-NOLANE", sha, lane=None)
        self.assertEqual(self._prov(parent), [])

    def test_AC_128_2_check12_is_UNCONDITIONAL_and_reaches_the_exit_code(self):
        """A gate with an off switch is a gate that cannot fail (§17i). No flag
        reaches this check, and its block must actually stop the pull — asserted
        through the real CLI, not the pure function."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        parent, _proj = self._topology()
        self._done_item("DEF-LOST", "deadbee")
        code, out = self._run_cli()
        self.assertEqual(code, 2, out)
        self.assertIn("ref-provenance", out)
        self.assertIn("EXIST IN NEITHER REPO", out)

    def test_AC_128_2_check12_registry_wide_findings_are_deduped_by_ref(self):
        """Two items citing one destroyed sha is ONE loss, named twice — a per-item
        finding would make a single incident look like a spreading one."""
        parent, _proj = self._topology()
        self._done_item("DEF-A", "deadbee")
        self._done_item("DEF-B", "deadbee")
        f = self._prov(parent)
        self.assertEqual(len(f), 1, f)
        self.assertEqual(f[0]["ids"], ["DEF-A", "DEF-B"])
        self.assertEqual(f[0]["absent"], ["deadbee"])


# --------------------------------------------------------------------------- #
# OI-PARTS-CHECK-MARKER-DIRTIES-THE-TREE-AND-DEFERS-FOLD-FORWARD
#   AC-PCM.1  a retro-mark / parts-check run leaves the PARENT worktree clean
#   AC-PCM.2  `project-update` does not exit 3 as a consequence of a preceding
#             parts-check (the gate's input is `git status --porcelain`)
#   AC-PCM.3  retro cadence stays DERIVABLE (and absence still fails CLOSED)
#   AC-PCM.4  non-vacuity: RED on a tree deliberately dirtied by the marker
#
# THE DECIDED SHAPE (v146 retro, option 3): the last-retro instant and the
# constraint-as-of-that-retro live in the PROJECT's own event substrate, as an
# append-only log at work/<project>/items/retro-log.md. The parent-repo files
# process/dora/retro-marker/*.txt are FROZEN — never written again, still READ
# as a fallback so no project's cadence moves on the cutover.
#
# WHY THE SUBSTRATE AND NOT A GIT TAG (the option that looks free and is not):
# the process-v<NN> tag namespace is GLOBAL and retro debt is PER-PROJECT, so
# ROC's next tag would silently become OagEventSource's "last retro". The marker
# FILE and the git TAG are the same defect in different clothes — a global store
# asked to hold per-project state. Pinned by test_ac_pcm_3_two_projects_*.
# --------------------------------------------------------------------------- #
class TestRetroLogStore(Base):
    def _stats(self, owner, state):
        d = os.path.join(self.tmp, "work", self.project, "views")
        os.makedirs(d, exist_ok=True)
        doc = {"overall": {"gross_lead_time": {
            "by_owner": {owner: {"pct_of_glt": 60.0, "backfill_pct_of_state": 0.0}},
            "by_state": {state: {"pct_of_glt": 42.0, "backfill_pct_of_state": 0.0}}}}}
        with open(os.path.join(d, "stats.json"), "w", encoding="utf-8") as f:
            json.dump(doc, f)

    def _legacy_marker(self, ts, project=None, constraint=None):
        """Write the FROZEN parent-repo files exactly as the pre-cutover code did."""
        project = project or self.project
        p = wi._legacy_retro_marker_path(project)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            f.write(ts + "\n")
        if constraint:
            cp = wi._legacy_constraint_marker_path(project)
            with open(cp, "w", encoding="utf-8") as f:
                f.write("%s\t%s\n" % (constraint[0], constraint[1]))

    def _process_tree(self):
        """Every file under the temp ROOT's process/ dir, with its bytes — the
        parent-repo footprint. statusline.json is gitignored in the real repo, so
        it is excluded: it can never dirty a tracked tree."""
        out = {}
        base = os.path.join(self.tmp, "process")
        for dirpath, _dirs, files in os.walk(base):
            for fn in files:
                fp = os.path.join(dirpath, fn)
                rel = os.path.relpath(fp, self.tmp)
                if rel.endswith(os.path.join("dora", "statusline.json")):
                    continue
                with open(fp, "rb") as f:
                    out[rel] = f.read()
        return out

    def _mark(self, ts, project=None):
        with contextlib.redirect_stdout(io.StringIO()):
            wi.cmd_retro_mark(argparse.Namespace(project=project or self.project,
                                                 now=ts))

    # ---- AC-PCM.1 — the write lands in the project substrate, not the parent --
    def test_ac_pcm_1_retro_mark_writes_the_project_retro_log(self):
        self._mark("2026-06-20T00:00:00Z")
        log = os.path.join(self.tmp, "work", self.project, "items", "retro-log.md")
        self.assertTrue(os.path.exists(log), "retro-mark wrote no per-project log")
        evs = wi._read_retro_log(self.project)
        self.assertEqual(len(evs), 1)
        self.assertEqual(evs[0]["event"], "retro_closed")
        self.assertEqual(evs[0]["ts"], "2026-06-20T00:00:00Z")
        self.assertEqual(wi._read_retro_marker(self.project),
                         wi.parse_ts("2026-06-20T00:00:00Z"))

    def test_ac_pcm_1_retro_mark_leaves_the_parent_process_tree_byte_identical(self):
        """THE fitness function (delta-075 R10): any write under process/ is RED.
        Not a budget — a documented read has zero write footprint on the shared
        tree, and the friction is a RATE (one dirty-tree event per invocation)."""
        self._stats("queue", "open")
        before = self._process_tree()
        self._mark("2026-06-20T00:00:00Z")
        self.assertEqual(self._process_tree(), before)
        self.assertFalse(os.path.exists(wi._legacy_retro_marker_path(self.project)))
        self.assertFalse(os.path.exists(wi._legacy_constraint_marker_path(self.project)))

    def test_ac_pcm_1_parts_check_drain_leaves_the_parent_process_tree_identical(self):
        """parts-check is the per-close READ. Its drain must not touch process/."""
        self._legacy_marker("2026-06-01T00:00:00Z", constraint=("queue", "open"))
        self._stats("queue", "open")
        self.write_item("done", "DEF-1", "defect", [
            {"ts": _dt(15, 0), "event": "reported", "agent": "orchestrator"},
            {"ts": _dt(15, 1), "event": "triaged", "agent": "orchestrator"},
            {"ts": _dt(15, 2), "event": "confirmed", "agent": "engineer"},
            {"ts": _dt(15, 3), "event": "fixed", "agent": "engineer"},
            {"ts": _dt(15, 5), "event": "validated", "agent": "tester"}])
        before = self._process_tree()
        with contextlib.redirect_stdout(io.StringIO()) as out:
            with self.assertRaises(SystemExit) as e:
                wi.cmd_parts_check(argparse.Namespace(
                    project=self.project, threshold=3, now=NOW))
        self.assertEqual(e.exception.code, 0, out.getvalue())
        self.assertEqual(self._process_tree(), before,
                         "parts-check wrote a parent-repo file")
        evs = wi._read_retro_log(self.project)
        self.assertEqual([x["event"] for x in evs], ["debt_drained"])
        # and the boundary really moved — a drain that records nothing is a no-op
        self.assertEqual(wi._read_retro_marker(self.project), wi.parse_ts(NOW))

    def test_ac_pcm_1_escalating_parts_check_appends_nothing(self):
        """An escalation may NEVER drain debt — so it may never append."""
        self._legacy_marker("2026-06-01T00:00:00Z", constraint=("queue", "open"))
        self._stats("tester", "validating")            # constraint SHIFTED
        with contextlib.redirect_stdout(io.StringIO()) as out:
            with self.assertRaises(SystemExit) as e:
                wi.cmd_parts_check(argparse.Namespace(
                    project=self.project, threshold=3, now=NOW))
        self.assertEqual(e.exception.code, 2, out.getvalue())
        self.assertEqual(wi._read_retro_log(self.project), [])
        self.assertEqual(wi._read_retro_marker(self.project),
                         wi.parse_ts("2026-06-01T00:00:00Z"))

    # ---- AC-PCM.3 — cadence stays derivable, and the cutover moves nothing ----
    def test_ac_pcm_3_legacy_marker_is_read_through_when_no_log_exists(self):
        """THE CUTOVER PIN. Every existing project (OagEventSource, ROC, AdixOut,
        OperationalFlowSimulator) has a frozen tracked marker and no log yet. Its
        next retro-debt must return the SAME boundary — no spurious full retro,
        which is what the naive `gitignore + git rm --cached` form would cause."""
        self._legacy_marker("2026-06-14T09:00:00Z")
        self.assertEqual(wi._read_retro_marker(self.project),
                         wi.parse_ts("2026-06-14T09:00:00Z"))
        kind, ts, src = wi._retro_verdict(self.project)
        self.assertEqual(kind, "known")
        self.assertEqual(ts, wi.parse_ts("2026-06-14T09:00:00Z"))
        self.assertIn("frozen", src)

    def test_ac_pcm_3_legacy_constraint_marker_is_read_through(self):
        self._legacy_marker("2026-06-01T00:00:00Z", constraint=("queue", "open"))
        self.assertEqual(wi._read_constraint_marker(self.project), ("queue", "open"))

    def test_ac_pcm_3_the_log_is_authoritative_once_it_exists(self):
        """ONE writer wins (EXP-047) — the log is not reconciled against the
        frozen file with a max(); if it exists it IS the record, even when it
        names an EARLIER instant than the fossil."""
        self._legacy_marker("2026-06-25T00:00:00Z")
        self._mark("2026-06-10T00:00:00Z")
        self.assertEqual(wi._read_retro_marker(self.project),
                         wi.parse_ts("2026-06-10T00:00:00Z"))
        _k, _t, src = wi._retro_verdict(self.project)
        self.assertIn("retro-log.md", src)

    def test_ac_pcm_3_newest_log_event_wins_and_the_log_is_append_only(self):
        self._mark("2026-06-10T00:00:00Z")
        self._mark("2026-06-20T00:00:00Z")
        evs = wi._read_retro_log(self.project)
        self.assertEqual([e["ts"] for e in evs],
                         ["2026-06-10T00:00:00Z", "2026-06-20T00:00:00Z"])
        self.assertEqual(wi._read_retro_marker(self.project),
                         wi.parse_ts("2026-06-20T00:00:00Z"))

    def test_ac_pcm_3_constraint_rides_the_log_event(self):
        self._stats("queue", "open")
        self._mark("2026-06-20T00:00:00Z")
        self.assertEqual(wi._read_constraint_marker(self.project), ("queue", "open"))
        ev = wi._read_retro_log(self.project)[-1]
        self.assertEqual((ev["constraint_owner"], ev["constraint_state"]),
                         ("queue", "open"))

    def test_ac_pcm_3_constraint_read_scans_back_past_events_without_one(self):
        """A drain that could not read the constraint must not ERASE the last
        known one — the reader takes the newest event that CARRIES one."""
        self._stats("queue", "open")
        self._mark("2026-06-10T00:00:00Z")
        os.remove(os.path.join(self.tmp, "work", self.project, "views", "stats.json"))
        self._mark("2026-06-20T00:00:00Z")        # no constraint readable
        self.assertEqual(wi._read_constraint_marker(self.project), ("queue", "open"))
        self.assertEqual(wi._read_retro_marker(self.project),
                         wi.parse_ts("2026-06-20T00:00:00Z"))

    # ---- AC-PCM.3 — PER-PROJECT INDEPENDENCE (the anti-git-tag pin) ----------
    def test_ac_pcm_3_two_projects_retro_histories_cannot_alias(self):
        """The reason a global store (the marker dir, or a process-v<NN> git tag)
        is wrong: one project's retro must never read as another's."""
        other = "OtherProj"
        os.makedirs(os.path.join(self.tmp, "work", other, "items", "active"),
                    exist_ok=True)
        self._mark("2026-06-20T00:00:00Z")                 # TestProj retro'd
        k, _ts, why = wi._retro_verdict(other)
        self.assertEqual(k, "unknown", why)                # OtherProj did NOT
        self._mark("2026-06-28T00:00:00Z", project=other)  # now OtherProj does
        self.assertEqual(wi._read_retro_marker(self.project),
                         wi.parse_ts("2026-06-20T00:00:00Z"))
        self.assertEqual(wi._read_retro_marker(other),
                         wi.parse_ts("2026-06-28T00:00:00Z"))

    def test_ac_pcm_3_the_log_is_not_an_item_and_perturbs_no_derived_view(self):
        """It lives IN items/ but not in active/|done/, so it is invisible to
        load_all_items — no state, no queue, no GLT share, and therefore it can
        never move the constraint that parts-check reads."""
        self.write_item("active", "UC-1", "use-case", [
            {"ts": _dt(10, 0), "event": "registered", "agent": "flow-manager"}])
        before, _d = wi.load_all_items(self.project)
        self._mark("2026-06-20T00:00:00Z")
        after, _d2 = wi.load_all_items(self.project)
        self.assertEqual(sorted(after), sorted(before))
        self.assertEqual(sorted(after), ["UC-1"])

    # ---- AC-PCM.3 / delta-074 R10 — ABSENCE IS A VERDICT, NOT 1970 -----------
    def test_ac_pcm_3_absent_record_reads_UNKNOWN_and_still_fails_closed(self):
        """Once the store is per-project, absence is the ROUTINE state of a new
        project — so the overloaded 1970 sentinel becomes load-bearing on the
        happy path. It must print UNKNOWN and the paths looked at, and keep its
        exit-2 direction. A legibility change, never a softening."""
        self.write_item("done", "DEF-1", "defect", [
            {"ts": _dt(15, 0), "event": "reported", "agent": "orchestrator"},
            {"ts": _dt(15, 1), "event": "triaged", "agent": "orchestrator"},
            {"ts": _dt(15, 2), "event": "confirmed", "agent": "engineer"},
            {"ts": _dt(15, 3), "event": "fixed", "agent": "engineer"},
            {"ts": _dt(15, 5), "event": "validated", "agent": "tester"}])
        with contextlib.redirect_stdout(io.StringIO()) as out:
            with self.assertRaises(SystemExit) as e:
                wi.cmd_retro_debt(argparse.Namespace(
                    project=self.project, threshold=3, now=NOW))
        txt = out.getvalue()
        self.assertEqual(e.exception.code, 2, txt)         # FAIL CLOSED
        self.assertIn("UNKNOWN", txt)
        self.assertNotIn("1970-01-01", txt)
        self.assertIn("retro-log.md", txt)                 # names where it looked
        self.assertIn("RETRO DUE", txt)

    def test_ac_pcm_3_known_record_prints_the_instant_not_a_verdict_word(self):
        """The happy path's wording is UNCHANGED — this is a relocation, and a
        changed line here would be a changed cadence signal."""
        self._legacy_marker("2026-06-14T09:00:00Z")
        with contextlib.redirect_stdout(io.StringIO()) as out:
            with self.assertRaises(SystemExit):
                wi.cmd_retro_debt(argparse.Namespace(
                    project=self.project, threshold=3, now=NOW))
        self.assertIn("since last retro 2026-06-14T09:00:00Z => ok", out.getvalue())

    # ---- SCOPE FENCE (delta-075 §5.1) — these must NOT have moved ------------
    def test_scope_fence_read_constraint_still_reads_project_views_stats(self):
        self._stats("queue", "open")
        self.assertEqual(wi._read_constraint(self.project)["owner"], "queue")
        os.remove(os.path.join(self.tmp, "work", self.project, "views", "stats.json"))
        self.assertIsNone(wi._read_constraint(self.project))

    def test_scope_fence_retro_mark_still_warns_loudly_when_constraint_unreadable(self):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            wi.cmd_retro_mark(argparse.Namespace(project=self.project,
                                                 now="2026-06-20T00:00:00Z"))
        self.assertIn("WARNING", out.getvalue())
        self.assertIn("escalate", out.getvalue())


class TestRetroMarkerTreeCleanliness(unittest.TestCase):
    """AC-PCM.1/2/4 over a REAL git repo shaped like the parent worktree.

    The gate this defect trips is `.claude/scripts/worktree update`'s
    `[ -n "$(git status --porcelain)" ] && exit 3`, so `git status --porcelain`
    IS the acceptance surface — asserted here against real git, not simulated.

    AC-PCM.4 is discharged by test_..._RED_witness_..., which reproduces the
    fault by writing the tracked path exactly as the pre-cutover code did. A
    suite that only ever ran the post-fix path would prove nothing.
    """
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="wi-clean-")
        self.project = "TestProj"
        self._orig_root, wi.ROOT = wi.ROOT, self.tmp
        self._orig_statusline = wi.STATUSLINE
        wi.STATUSLINE = os.path.join(self.tmp, "process", "dora", "statusline.json")
        os.makedirs(os.path.join(self.tmp, "process", "dora", "retro-marker"))
        os.makedirs(os.path.join(self.tmp, "work", self.project, "items", "active"))
        # Mirror the parent repo's ignore semantics EXACTLY by copying its real
        # .gitignore — the two facts this acceptance rests on are both in there
        # and neither is mine to restate: `/work/*/` (each project is its own
        # gitignored repo, so the cadence log is invisible to this gate) and
        # `/process/dora/statusline.json` (already machine-local, which is why
        # parts-check's OTHER write never dirtied a tree). Copying rather than
        # hand-writing means un-ignoring either one turns this test RED for a
        # real reason instead of leaving the fixture quietly wrong.
        shutil.copy(os.path.join(self._orig_root, ".gitignore"),
                    os.path.join(self.tmp, ".gitignore"))
        # ... and the fact that makes the fault possible at all: the parent-repo
        # marker directory is TRACKED.
        with open(os.path.join(self.tmp, "process", "dora", "retro-marker",
                               f"{self.project}.txt"), "w") as f:
            f.write("2026-06-01T00:00:00Z\n")
        self._git("init", "-q", "-b", "main")
        self._git("config", "user.email", "t@t")
        self._git("config", "user.name", "t")
        self._git("add", "-A")
        self._git("commit", "-qm", "seed")
        self.assertEqual(self._porcelain(), "")

    def tearDown(self):
        wi.ROOT, wi.STATUSLINE = self._orig_root, self._orig_statusline
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _git(self, *args):
        return subprocess.run(("git", "-C", self.tmp) + args,
                              capture_output=True, text=True).stdout

    def _porcelain(self):
        return self._git("status", "--porcelain").strip()

    def test_ac_pcm_4_RED_witness_writing_the_tracked_marker_dirties_the_tree(self):
        """The fault, reproduced: this is what every parts-check used to do."""
        with open(os.path.join(self.tmp, "process", "dora", "retro-marker",
                               f"{self.project}.txt"), "w") as f:
            f.write("2026-06-20T00:00:00Z\n")
        self.assertNotEqual(self._porcelain(), "",
                            "the RED witness did not reproduce")
        self.assertIn("retro-marker", self._porcelain())

    def test_ac_pcm_1_and_2_retro_mark_then_parts_check_leave_the_tree_clean(self):
        """AC-PCM.2's ordering — the one that HID the fault: the check runs FIRST,
        and only then is the fold-forward gate evaluated."""
        d = os.path.join(self.tmp, "work", self.project, "views")
        os.makedirs(d)
        with open(os.path.join(d, "stats.json"), "w") as f:
            json.dump({"overall": {"gross_lead_time": {
                "by_owner": {"queue": {"pct_of_glt": 60.0,
                                       "backfill_pct_of_state": 0.0}},
                "by_state": {"open": {"pct_of_glt": 42.0,
                                      "backfill_pct_of_state": 0.0}}}}}, f)
        with contextlib.redirect_stdout(io.StringIO()):
            wi.cmd_retro_mark(argparse.Namespace(project=self.project,
                                                 now="2026-06-20T00:00:00Z"))
        self.assertEqual(self._porcelain(), "",
                         "retro-mark dirtied the parent worktree")
        with contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit) as e:
                wi.cmd_parts_check(argparse.Namespace(
                    project=self.project, threshold=3,
                    now="2026-06-21T00:00:00Z"))
        self.assertEqual(e.exception.code, 0)
        self.assertEqual(self._porcelain(), "",
                         "parts-check dirtied the parent worktree")
        # the record IS there — clean because it is in the project's own repo,
        # which the parent gitignores, not because nothing was written
        self.assertEqual(wi._read_retro_marker(self.project),
                         wi.parse_ts("2026-06-21T00:00:00Z"))
class TestStalledWorkHonoursItsOwnRemedy(TestLoopGate):
    """DEF-ROC-083 — the `stalled-work` check PRINTS `defer_until:` as a remedy and
    does not read it, so the block it raises cannot be cleared by doing what it says.

    A gate that cannot fail is the failure this project logs most often. This is its
    mirror: a gate that cannot be SATISFIED. Measured on ROC 2026-08-21 — `UC-ROC-093`
    was given `defer_until: 2026-09-04`, the field survived the renderer, and the gate
    kept blocking the pull on it with a message naming that exact field.

    The expiry behaviour must survive the fix: a defer that has PASSED blocks again,
    which is what stops `defer_until` becoming a permanent silencer."""

    def _scheduled_uc(self, day=1):
        return [{"ts": _dt(day, 0), "event": "registered", "agent": "flow-manager"},
                {"ts": _dt(day, 1), "event": "made_ready", "agent": "flow-manager"}]

    def _stalled(self, findings):
        return [f for f in findings
                if f["check"] == "stalled-work" and f["severity"] == "block"]

    def test_AC_083_1_an_UNEXPIRED_defer_clears_the_stalled_work_block(self):
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(29))
        # scheduled on day 1, NOW is day 30 -> 29 days idle, far past any threshold
        self.write_item("active", "UC-OLD", "use-case", self._scheduled_uc(1))
        before = self._stalled(self._gate())
        self.assertIn("UC-OLD", [i for f in before for i in f["ids"]], before)

        self.write_item("active", "UC-OLD", "use-case", self._scheduled_uc(1),
                        extra_fm={"defer_until": "2026-12-31"})
        after = self._stalled(self._gate())
        self.assertNotIn("UC-OLD", [i for f in after for i in f["ids"]],
                         "the check still blocks an item deferred exactly as its own "
                         "remedy instructs")

    def test_AC_083_2_an_EXPIRED_defer_blocks_again(self):
        """Otherwise `defer_until` is a permanent silencer, which is worse than the
        stall it hides."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(29))
        self.write_item("active", "UC-OLD", "use-case", self._scheduled_uc(1),
                        extra_fm={"defer_until": "2026-06-20"})   # NOW is 2026-06-30
        f = self._stalled(self._gate())
        self.assertIn("UC-OLD", [i for x in f for i in x["ids"]], f)

    def test_AC_083_3_an_UNPARSEABLE_defer_is_not_a_decision(self):
        """A value nobody can read must not buy silence — same rule the aged-backlog
        check already applies."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(29))
        self.write_item("active", "UC-OLD", "use-case", self._scheduled_uc(1),
                        extra_fm={"defer_until": "whenever"})
        f = self._stalled(self._gate())
        self.assertIn("UC-OLD", [i for x in f for i in x["ids"]], f)

    def test_AC_083_4_a_defer_does_NOT_excuse_a_CLAIMED_slot_only_a_scheduled_one(self):
        """The two stall kinds are different facts. `ready` is a schedule nobody has
        started, and deferring it is a legitimate scheduling decision. A `wip` slot is
        CLAIMED — work someone is supposed to be holding — and a date in the future
        says nothing about whether it is being worked, so it must still block."""
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(29))
        evs = [{"ts": _dt(1, 0), "event": "reported", "agent": "orchestrator"},
               {"ts": _dt(1, 1), "event": "triaged", "agent": "orchestrator"},
               {"ts": _dt(1, 2), "event": "confirmed", "agent": "engineer"}]
        self.write_item("active", "DEF-CLAIMED", "defect", evs,
                        extra_fm={"defer_until": "2026-12-31"})
        f = self._stalled(self._gate())
        self.assertIn("DEF-CLAIMED", [i for x in f for i in x["ids"]], f)


if __name__ == "__main__":
    unittest.main(verbosity=2)
