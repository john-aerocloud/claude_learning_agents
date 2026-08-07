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

    def _building_uc(self, iid, day=10):
        return [{"ts": _dt(day, 0), "event": "registered", "agent": "flow-manager"},
                {"ts": _dt(day, 1), "event": "made_ready", "agent": "flow-manager"},
                {"ts": _dt(day, 2), "event": "pulled", "agent": "orchestrator"}]

    def _reworking_uc(self, iid, day=10):
        return self._building_uc(iid, day) + [
            {"ts": _dt(day, 3), "event": "build_failed", "agent": "engineer"}]

    def _default_policy(self):
        # the shipped OagEventSource defaults
        self._policy([("intake", "min_items", 2), ("intake", "wip_limit", 10),
                      ("ready", "min_items", 3), ("ready", "wip_limit", 4),
                      ("deploy", "min_items", 0), ("deploy", "wip_limit", 1),
                      ("rework", "min_items", 0), ("rework", "wip_limit", 2)])

    def _ready_uc(self, iid, day=10):
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
        """No structured ref => we CANNOT establish the work is done. Report
        UNKNOWN (advisory), never assume either way."""
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
        self.assertEqual(code, 0)             # UNKNOWN does not block
        # ...but it reaches the HEADLINE: a run that failed to establish something
        # may never report "all preconditions hold"
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
            return True                      # git says: on trunk

        orig = wi._ref_on_trunk
        wi._ref_on_trunk = fake
        try:
            f = [x for x in self._gate() if x["check"] == "stalled-validation"][0]
        finally:
            wi._ref_on_trunk = orig
        self.assertEqual(calls, [(self.project, "5095849")])
        self.assertIs(f["on_trunk"], True)    # git, not the stale note
        self.assertIn("on origin trunk", f["message"])

    def test_unresolvable_ref_reports_unknown_push_state(self):
        self._default_policy()
        for i in range(3):
            self.write_item("active", f"UC-R{i}", "use-case", self._ready_uc(10))
        self.write_item("active", "DEF-STALE", "defect",
                        self._validating_defect(20, 12, ref="notasha"))
        orig = wi._ref_on_trunk
        wi._ref_on_trunk = lambda p, r: None       # cannot resolve
        try:
            f = [x for x in self._gate() if x["check"] == "stalled-validation"][0]
        finally:
            wi._ref_on_trunk = orig
        self.assertIsNone(f["on_trunk"])
        self.assertIn("UNKNOWN", f["message"])

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


if __name__ == "__main__":
    unittest.main(verbosity=2)
