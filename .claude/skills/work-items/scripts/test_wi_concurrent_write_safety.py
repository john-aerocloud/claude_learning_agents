#!/usr/bin/env python3
"""DEF-ROC-162 — an event appended while `wi-project` is running must SURVIVE.

WHAT WENT WRONG (observed, not theorised, 2026-08-29). `make wi-append
ID=DEF-ROC-161 EVENT=confirmed` printed its transition and exited 0. Six minutes
later the event was absent from the item file, from the commit made from it, and
from `views/state.md`. Every one of the 373 item files and all five views carried
the identical mtime 22:32:41 — a concurrent agent's `make wi-project`, which
snapshots the whole store with `load_all_items()` ONCE and then writes
`render_item(it, dv)` back over every file from that snapshot. No lock, no
re-read, no compare-and-swap. Both commands exited 0. Neither warned. And
`wi-validate` reported the store CLEAN, because its invariant is
`derived == fold(events)` and that holds just as well over a log with an event
missing from it.

WHAT THESE TESTS ASSERT, and why they are shaped this way:

  * The concurrent writer here puts the event ON DISK (its line rendered by the
    machinery's own `_render_event`, placed by the test) rather than calling
    `cmd_append` in-process. That is deliberate: the load-bearing property is
    "whatever is in the file when we are about to write it survives", which must
    hold for ANY writer — another `wi-append` process, an agent editing prose, a
    future tool — not only for writers that cooperate with our lock. A test that
    used the cooperating path would pass under a lock alone and would not pin the
    property that actually failed.

  * The loss must be IMPOSSIBLE OR LOUD (the item's words). So there are two
    cases per hazard: the event survives, AND the run says on stderr that the log
    changed under it — because a derived block computed from the stale snapshot
    is, for that one item, knowingly behind, and a silent lag is the shape of
    problem this whole item is about.

`make test-wi` discovers `test_*.py`, so this module runs with the rest of the
machinery suite. Separate file, per the co-owned-file rule: test_work_items.py is
7,363 lines and is edited by everyone.
"""
import io
import os
import re
import sys
import time
import shutil
import tempfile
import unittest
import argparse
import threading
import contextlib
import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
REAL_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))

_spec = importlib.util.spec_from_file_location(
    "work_items_cws", os.path.join(HERE, "work-items.py"))
wi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(wi)


class StoreFixture(unittest.TestCase):
    """A throwaway item store under a temp ROOT. Never touches real project data."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="wi-cws-")
        self.project = "TestProj"
        self._orig_root = wi.ROOT
        wi.ROOT = self.tmp
        os.makedirs(os.path.join(self.tmp, "process", "machinery"), exist_ok=True)
        shutil.copy(os.path.join(REAL_ROOT, "process", "machinery", "state-graphs.json"),
                    os.path.join(self.tmp, "process", "machinery", "state-graphs.json"))
        wi.GRAPHS_PATH = os.path.join(self.tmp, "process", "machinery", "state-graphs.json")
        self.graphs = wi.Graphs.load(wi.GRAPHS_PATH)
        self._orig_statusline = wi.STATUSLINE
        wi.STATUSLINE = os.path.join(self.tmp, "process", "dora", "statusline.json")
        for sub in ("active", "done"):
            os.makedirs(self._items(sub), exist_ok=True)

    def tearDown(self):
        wi.ROOT = self._orig_root
        wi.STATUSLINE = self._orig_statusline
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _items(self, sub):
        return os.path.join(self.tmp, "work", self.project, "items", sub)

    def path_of(self, iid, sub="active"):
        return os.path.join(self._items(sub), f"{iid}.md")

    def write_item(self, iid, itype, events, parents=None, sub="active"):
        fm = {"id": iid, "type": itype, "title": iid, "job": "J0",
              "value": 1, "cost": 0.5, "parents": parents or [], "deps": [],
              "created_ts": "2026-08-01T00:00:00Z", "events": events}
        item = wi.Item(self.path_of(iid, sub), fm, "\n## Definition\nstub\n")
        with open(item.path, "w", encoding="utf-8") as f:
            f.write(wi.render_item(item, {"state": None, "queue": None,
                                          "children": [], "ancestors": []}))
        # finalise every derived block the way the machinery does, so the fixture
        # is as consistent as a real store (I8 compares block against fold).
        items, _dup = wi.load_all_items(self.project)
        states = wi.compute_states(self.graphs, items)
        children = wi.compute_children(items)
        for tid, t in items.items():
            dv = wi.derived_block(self.graphs, items, states, children, tid)
            with open(t.path, "w", encoding="utf-8") as f:
                f.write(wi.render_item(t, dv))
        return item.path

    # --- the concurrent writer -------------------------------------------- #
    def inject_event_on_disk(self, iid, event, agent, ts, note=None, sub="active"):
        """Land an event in the item file the way another PROCESS lands one: the
        line is rendered by the machinery's own `_render_event`, appended to the
        end of the `events:` block, and the file is on disk before we return."""
        ev = {"ts": ts, "event": event, "agent": agent}
        if note:
            ev["note"] = note
        path = self.path_of(iid, sub)
        with open(path, encoding="utf-8") as f:
            lines = f.read().split("\n")
        last = None
        for i, line in enumerate(lines):
            if line.startswith("  - {ts:"):
                last = i
        assert last is not None, f"{path}: no events block to append to"
        lines.insert(last + 1, "  - " + wi._render_event(ev))
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        return ev

    def events_on_disk(self, iid):
        path = self.path_of(iid)
        if not os.path.exists(path):
            path = self.path_of(iid, "done")
        return [(e.get("ts"), e.get("event"), e.get("agent"))
                for e in wi.load_item(path).events]

    def run_project(self, mid_run=None):
        """Run the REAL `cmd_project` over the fixture store, invoking `mid_run`
        once — after the store has been snapshotted, before the last item is
        written. That is precisely the window DEF-ROC-162 reports."""
        real_render = wi.render_item
        fired = []

        def hook(item, derived):
            if mid_run is not None and not fired:
                fired.append(item.id)
                mid_run()
            return real_render(item, derived)

        out, err = io.StringIO(), io.StringIO()
        wi.render_item = hook
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                wi.cmd_project(argparse.Namespace(project=self.project))
        finally:
            wi.render_item = real_render
        self.assertTrue(fired or mid_run is None,
                        "the mid-run hook never fired — the test proves nothing")
        return out.getvalue(), err.getvalue()


class TestProjectPreservesConcurrentAppend(StoreFixture):

    def _two_items(self):
        # DEF-A sorts first, so it is rendered first and the hook fires on it;
        # DEF-Z is still to be written from the snapshot when the event lands.
        self.write_item("DEF-A", "defect",
                        [{"ts": "2026-08-01T00:00:00Z", "event": "reported",
                          "agent": "orchestrator"}])
        self.write_item("DEF-Z", "defect",
                        [{"ts": "2026-08-01T00:00:00Z", "event": "reported",
                          "agent": "orchestrator"},
                         {"ts": "2026-08-01T01:00:00Z", "event": "triaged",
                          "agent": "orchestrator"}])

    def test_event_appended_during_project_survives(self):
        """THE FOUNDING CASE. DEF-ROC-161's `confirmed`, to the letter."""
        self._two_items()
        injected = {}

        def concurrent_append():
            injected.update(self.inject_event_on_disk(
                "DEF-Z", "confirmed", "engineer", "2026-08-01T02:00:00Z"))

        self.run_project(mid_run=concurrent_append)

        sig = (injected["ts"], injected["event"], injected["agent"])
        self.assertIn(
            sig, self.events_on_disk("DEF-Z"),
            "DEF-ROC-162: `project` wrote DEF-Z back from a snapshot it loaded "
            "before the append landed, so the event was silently destroyed.")
        self.assertEqual(len(self.events_on_disk("DEF-Z")), 3)

    def test_project_reports_a_log_that_changed_under_it(self):
        """IMPOSSIBLE OR LOUD: the event survives, and because the derived block
        for that item was computed from the stale snapshot, the run must SAY so."""
        self._two_items()

        def concurrent_append():
            self.inject_event_on_disk("DEF-Z", "confirmed", "engineer",
                                      "2026-08-01T02:00:00Z")

        _out, err = self.run_project(mid_run=concurrent_append)
        self.assertIn("DEF-Z", err)
        self.assertRegex(err.lower(), r"chang|concurren|re-?run",
                         "a concurrent change to an event log must be reported, "
                         "not absorbed silently")

    def test_no_concurrency_no_noise(self):
        """The guard must not cry wolf: an ordinary projection says nothing on
        stderr and leaves every log byte-identical."""
        self._two_items()
        before = {i: self.events_on_disk(i) for i in ("DEF-A", "DEF-Z")}
        _out, err = self.run_project()
        self.assertEqual(err.strip(), "")
        for i in ("DEF-A", "DEF-Z"):
            self.assertEqual(before[i], self.events_on_disk(i))


class TestAppendPreservesConcurrentAppend(StoreFixture):
    """The SAME shape inside `append` itself: it loads the file, computes, then
    writes the whole file back — so an event landing in between is lost, and its
    ancestor-propagation loop writes parents from a snapshot for the same reason.
    """

    def test_append_does_not_lose_a_concurrent_event_on_the_same_item(self):
        self.write_item("DEF-1", "defect",
                        [{"ts": "2026-08-01T00:00:00Z", "event": "reported",
                          "agent": "orchestrator"}])
        real_load = wi.load_all_items
        fired = []

        def hook(project):
            res = real_load(project)
            if not fired:                      # after append's re-load, before its write
                fired.append(True)
                self.inject_event_on_disk("DEF-1", "amended", "orchestrator",
                                          "2026-08-01T00:30:00Z", note="a note")
            return res

        wi.load_all_items = hook
        try:
            with contextlib.redirect_stdout(io.StringIO()), \
                 contextlib.redirect_stderr(io.StringIO()):
                wi.cmd_append(argparse.Namespace(
                    project=self.project, id="DEF-1", event="triaged",
                    agent="orchestrator", ref=None, note=None,
                    ts="2026-08-01T01:00:00Z", tokens=None, duration_ms=None))
        finally:
            wi.load_all_items = real_load
        self.assertTrue(fired, "the hook never fired — the test proves nothing")
        sigs = self.events_on_disk("DEF-1")
        self.assertIn(("2026-08-01T00:30:00Z", "amended", "orchestrator"), sigs,
                      "append wrote the file back from its own snapshot and "
                      "destroyed an event that had landed in the meantime")
        self.assertIn(("2026-08-01T01:00:00Z", "triaged", "orchestrator"), sigs,
                      "append lost its OWN event")

    def test_ancestor_propagation_does_not_lose_a_concurrent_event(self):
        self.write_item("REQ-P", "requirement",
                        [{"ts": "2026-08-01T00:00:00Z", "event": "registered",
                          "agent": "flow-manager"}])
        self.write_item("DEF-C", "defect",
                        [{"ts": "2026-08-01T00:00:00Z", "event": "reported",
                          "agent": "orchestrator"}], parents=["REQ-P"])
        real_load = wi.load_all_items
        fired = []

        def hook(project):
            res = real_load(project)
            if not fired:
                fired.append(True)
                self.inject_event_on_disk("REQ-P", "amended", "product",
                                          "2026-08-01T00:30:00Z", note="scope")
            return res

        wi.load_all_items = hook
        try:
            with contextlib.redirect_stdout(io.StringIO()), \
                 contextlib.redirect_stderr(io.StringIO()):
                wi.cmd_append(argparse.Namespace(
                    project=self.project, id="DEF-C", event="triaged",
                    agent="orchestrator", ref=None, note=None,
                    ts="2026-08-01T01:00:00Z", tokens=None, duration_ms=None))
        finally:
            wi.load_all_items = real_load
        self.assertTrue(fired)
        self.assertIn(("2026-08-01T00:30:00Z", "amended", "product"),
                      self.events_on_disk("REQ-P"),
                      "the ancestor was re-rendered from a snapshot, which "
                      "destroyed an event appended to the PARENT in between")


if __name__ == "__main__":
    unittest.main()
