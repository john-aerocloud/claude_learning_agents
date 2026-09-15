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
import subprocess
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


class TestWritersAreSerialised(StoreFixture):
    """The re-read/rebase guard above means a concurrent event is never LOST. It
    does not mean two writers may interleave freely: `append` decides whether a
    transition is LEGAL against the log it loaded, so two appends that overlap can
    both pass a check that only one of them should have passed and leave an
    ILLEGAL log behind — which has already stopped this loop once, when a
    duplicated event in an item file manufactured a transition that cannot exist
    (DEFECT-OAG-142). So the store's writers are serialised by a lock, and the
    property under test is: an append's legality is decided against the log it
    actually lands on.
    """

    def _append_in_thread(self, iid, event, agent, ts, results, key, gate=None):
        def run():
            if gate is not None:
                gate.wait(timeout=10)
            out, err = io.StringIO(), io.StringIO()
            try:
                with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                    wi.cmd_append(argparse.Namespace(
                        project=self.project, id=iid, event=event, agent=agent,
                        ref=None, note=None, ts=ts, tokens=None, duration_ms=None))
                results[key] = ("ok", out.getvalue() + err.getvalue())
            except SystemExit as e:
                results[key] = (f"exit:{e.code}", out.getvalue() + err.getvalue())
            except BaseException as e:                      # pragma: no cover
                results[key] = (f"raise:{type(e).__name__}", str(e))
        t = threading.Thread(target=run, daemon=True)
        return t

    def test_two_overlapping_appends_cannot_both_record_the_same_transition(self):
        """FAILING-DIRECTION NOTE: this test is deterministic when it PASSES (the
        second writer cannot enter while the first holds the lock, whatever the
        timing) and depends on a 1s margin only to reproduce the unserialised
        loss. It can therefore never be a false green."""
        self.write_item("DEF-L", "defect",
                        [{"ts": "2026-08-01T00:00:00Z", "event": "reported",
                          "agent": "orchestrator"}])
        results, entered = {}, threading.Event()
        second = self._append_in_thread("DEF-L", "triaged", "orchestrator",
                                        "2026-08-01T02:00:00Z", results, "b",
                                        gate=entered)

        real_load = wi.load_all_items
        fired = []

        def hook(project):
            if not fired:            # inside the first append's critical section
                fired.append(True)
                second.start()
                entered.set()        # let the second writer try to get in
                time.sleep(1.0)      # …it must not succeed while we hold the lock
            return real_load(project)

        wi.load_all_items = hook
        try:
            first = self._append_in_thread("DEF-L", "triaged", "orchestrator",
                                           "2026-08-01T01:00:00Z", results, "a")
            first.start()
            first.join(timeout=30)
            second.join(timeout=30)
        finally:
            wi.load_all_items = real_load

        self.assertTrue(fired, "the hook never fired — the test proves nothing")
        names = [e[1] for e in self.events_on_disk("DEF-L")]
        self.assertEqual(
            names, ["reported", "triaged"],
            f"both overlapping appends recorded `triaged`, so the log now folds "
            f"through a transition that does not exist in the state graph. "
            f"results={results}")
        verdicts = sorted(v[0] for v in results.values())
        self.assertEqual(len(results), 2, results)
        self.assertEqual(verdicts.count("ok"), 1,
                         f"exactly one writer may succeed: {results}")
        self.assertTrue(any(v[0].startswith("exit:") and v[0] != "exit:0"
                            for v in results.values()),
                        f"the loser must FAIL LOUDLY, not silently: {results}")

    def test_a_lock_that_cannot_be_taken_fails_loudly(self):
        """CANNOT MEASURE IS NEVER A PASS. If the lock is held past the deadline
        the command exits non-zero saying so — it never proceeds unserialised."""
        self.write_item("DEF-T", "defect",
                        [{"ts": "2026-08-01T00:00:00Z", "event": "reported",
                          "agent": "orchestrator"}])
        holder_in = threading.Event()
        release = threading.Event()
        held = {}

        def holder():
            with wi.store_lock(self.project):
                holder_in.set()
                release.wait(timeout=10)
            held["done"] = True

        t = threading.Thread(target=holder, daemon=True)
        t.start()
        self.assertTrue(holder_in.wait(timeout=10), "holder never took the lock")
        try:
            with self.assertRaises(SystemExit) as cm:
                with contextlib.redirect_stdout(io.StringIO()), \
                     contextlib.redirect_stderr(io.StringIO()) as err:
                    wi.cmd_append(argparse.Namespace(
                        project=self.project, id="DEF-T", event="triaged",
                        agent="orchestrator", ref=None, note=None,
                        ts="2026-08-01T01:00:00Z", tokens=None, duration_ms=None,
                        lock_timeout=0.2))
            self.assertNotEqual(cm.exception.code, 0)
            said = (str(cm.exception.code) + err.getvalue()).lower()
            self.assertIn("lock", said)
            self.assertIn("nothing has been written", said)
        finally:
            release.set()
            t.join(timeout=10)
        # …and nothing was written while we could not hold the lock
        self.assertEqual([e[1] for e in self.events_on_disk("DEF-T")], ["reported"])

    def test_the_lock_dies_with_its_holder(self):
        """A lock nobody can release is worse than no lock. This one is an OS
        file lock, so a holder that is killed releases it with its file
        descriptor — there is no stale record to clean up and no recovery path to
        get wrong. Proven with a real process, killed."""
        code = ("import sys,time\n"
                "import fcntl\n"
                "f=open(sys.argv[1],'a+')\n"
                "fcntl.flock(f.fileno(), fcntl.LOCK_EX)\n"
                "print('held', flush=True)\n"
                "time.sleep(60)\n")
        path = wi._store_lock_path(self.project)
        import subprocess
        proc = subprocess.Popen([sys.executable, "-c", code, path],
                                stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(proc.stdout.readline().strip(), "held")
            with self.assertRaises(SystemExit):          # genuinely held: we wait, then fail
                with contextlib.redirect_stderr(io.StringIO()):
                    with wi.store_lock(self.project, timeout=0.2):
                        pass                              # pragma: no cover
            proc.kill()
            proc.wait(timeout=10)
            with wi.store_lock(self.project, timeout=5.0):
                pass                                      # the OS released it
        finally:
            if proc.poll() is None:
                proc.kill()
            proc.stdout.close()

    def test_nesting_in_one_thread_does_not_deadlock(self):
        """Re-entrant per THREAD (a future caller nesting append inside project
        must not hang) and NOT per process (another thread must still block)."""
        with wi.store_lock(self.project, timeout=1.0):
            with wi.store_lock(self.project, timeout=1.0):
                pass
        blocked = {}

        def other():
            try:
                with wi.store_lock(self.project, timeout=0.2):
                    blocked["got"] = True
            except SystemExit:
                blocked["got"] = False

        with wi.store_lock(self.project, timeout=1.0):
            t = threading.Thread(target=other, daemon=True)
            t.start()
            t.join(timeout=10)
        self.assertEqual(blocked.get("got"), False,
                         "a second THREAD must not inherit the lock")


class TestWriteLanesAreEnumerated(unittest.TestCase):
    """EXP-121, applied to this module: a control that is optional on a shared
    primitive is a control some lane omits. Every lane that writes an item file
    must go through `write_item_file`, and every command that writes the store
    must take the store lock. A new lane that declares neither fails HERE, at
    compile-time-ish, rather than in six months in a lost event.
    """

    SOURCE = os.path.join(HERE, "work-items.py")

    # The declared exceptions, each with its reason: both CREATE files that do
    # not exist yet, so there is no on-disk log to preserve and nothing to rebase
    # onto. Both take the store lock all the same, and `_mint_locked` hands the
    # file straight to `write_item_file` for its derived block the moment it
    # exists — the raw render is the CLAIM (an O_EXCL create-or-fail, which is
    # what makes a duplicate id impossible), not a rewrite of anyone's log.
    DECLARED_CREATORS = {"_migrate_locked", "_mint_locked"}

    def _functions(self):
        with io.open(self.SOURCE, encoding="utf-8") as fh:
            src = fh.read()
        import ast
        tree = ast.parse(src)
        lines = src.split("\n")
        out = {}
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                out[node.name] = "\n".join(
                    lines[node.lineno - 1:node.end_lineno])
        return out

    def test_every_item_file_write_goes_through_the_primitive(self):
        offenders = []
        for name, body in self._functions().items():
            if name in ("write_item_file", "_atomic_write", "render_item"):
                continue
            if "render_item(" not in body:
                continue
            if name in self.DECLARED_CREATORS:
                continue
            offenders.append(name)
        self.assertEqual(
            offenders, [],
            f"these functions render an item file without going through "
            f"`write_item_file`, so they carry none of its guards "
            f"(re-read / rebase / fail-closed): {offenders}. Route them through "
            f"the primitive, or declare them in DECLARED_CREATORS with a reason.")

    # --- the lane enumeration itself, DERIVED rather than listed -------------
    # Every `cmd_*` subcommand is a lane into this module, and each one must
    # DECLARE which side of the store it is on. The list used to be three
    # hardcoded writer names, which is the EXP-121 shape this class exists to
    # refuse: a control that a new lane can omit by simply not being named. A new
    # subcommand that writes the store and forgets the lock now fails HERE,
    # because it appears in neither declaration.
    STORE_WRITERS = {
        "cmd_append":  "appends one edge-checked event to an item file",
        "cmd_project": "re-renders every derived block + the views",
        "cmd_migrate": "creates item files from the retired CSV substrate",
        "cmd_mint":    "allocates an id and creates the item file (DEF-ROC-203)",
    }
    STORE_READERS = {
        "cmd_validate":    "reads and reports; writes nothing",
        "cmd_retro_debt":  "reads the item store + the retro log; writes nothing",
        "cmd_retro_mark":  "writes the RETRO log, never an item file",
        "cmd_parts_check": "reads the retro log + the constraint; writes nothing",
        "cmd_loop_gate":   "reads the store and runs probes; writes nothing",
    }

    def test_every_subcommand_declares_which_side_of_the_store_it_is_on(self):
        undeclared = sorted(
            name for name in self._functions()
            if name.startswith("cmd_")
            and name not in self.STORE_WRITERS
            and name not in self.STORE_READERS)
        self.assertEqual(
            undeclared, [],
            f"these subcommands are declared in neither STORE_WRITERS nor "
            f"STORE_READERS: {undeclared}. Declare each one with its reason — a "
            f"lane nobody enumerated is a lane that can omit the lock silently "
            f"(EXP-121). If it writes item files it must take `store_lock`.")

    def test_every_store_writer_takes_the_lock(self):
        fns = self._functions()
        for name in sorted(self.STORE_WRITERS):
            self.assertIn(name, fns, f"{name} has been renamed — re-declare the lanes")
            self.assertIn(
                "store_lock(", fns[name],
                f"{name} writes the item store but does not take the store lock, "
                f"so it can interleave with the other writer (DEF-ROC-162)")

    def test_a_declared_reader_does_not_write_item_files(self):
        fns = self._functions()
        for name in sorted(self.STORE_READERS):
            self.assertIn(name, fns, f"{name} has been renamed — re-declare the lanes")
            for writer in ("write_item_file(", "_atomic_write("):
                self.assertNotIn(
                    writer, fns[name],
                    f"{name} is declared a READER but calls {writer} — either it "
                    f"is a writer (declare it, and take the store lock) or the "
                    f"call does not belong there")


class TestEventLossIsDETECTABLE(StoreFixture):
    """DEF-ROC-162's second facet, in the item's own words: *nothing in the
    repository can currently answer "has an event ever been dropped?", because
    the only record that an append happened is the file it was appended to.*

    There IS one other durable record, and it costs nothing to consult: git.
    Item logs are APPEND-ONLY by contract, so an event present in HEAD and absent
    from the working tree is a dropped event — full stop. This is the same lesson
    this project has now paid for three times: *wherever absence is treated as
    evidence, ask whether the thing still exists on the reference side.* HEAD is
    the reference side, and `wi-project` never asked it anything.

    WHAT THIS CANNOT SEE, stated because a detector whose blind spot is undocumented
    is worse than none: an event appended and destroyed BEFORE the next commit was
    never in HEAD, so nothing here will find it — which is exactly what happened to
    DEF-ROC-161. That window is closed by the write-path guards above (impossible or
    loud), not by this. A complete answer needs an append journal, and that is a
    separate piece of work with its own new failure modes.
    """

    def _git(self, *args):
        repo = os.path.join(self.tmp, "work", self.project)
        return subprocess.run(
            ["git", "-C", repo, "-c", "user.email=t@t", "-c", "user.name=t",
             "-c", "commit.gpgsign=false", *args],
            capture_output=True, text=True)

    def _commit_store(self):
        self.assertEqual(self._git("init", "-q").returncode, 0)
        self._git("add", "-A", "--", "items")
        r = self._git("commit", "-q", "-m", "items")
        self.assertEqual(r.returncode, 0, r.stderr)

    def _drop_an_event_from_disk(self, iid, event):
        """Exactly what DEF-ROC-162 did: an event line disappears from the file,
        leaving a shorter log that is internally perfectly consistent."""
        path = self.path_of(iid)
        with open(path, encoding="utf-8") as f:
            lines = f.read().split("\n")
        keep = [l for l in lines
                if not (l.startswith("  - {ts:") and f"event: {event}" in l)]
        self.assertEqual(len(keep), len(lines) - 1, "no event line was dropped")
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(keep))

    def test_a_dropped_committed_event_is_REPORTED(self):
        self.write_item("DEF-D", "defect",
                        [{"ts": "2026-08-01T00:00:00Z", "event": "reported",
                          "agent": "orchestrator"},
                         {"ts": "2026-08-01T01:00:00Z", "event": "triaged",
                          "agent": "orchestrator"},
                         {"ts": "2026-08-01T02:00:00Z", "event": "confirmed",
                          "agent": "engineer"}])
        self._commit_store()
        self._drop_an_event_from_disk("DEF-D", "confirmed")

        findings = wi.compute_event_loss(self.project)
        self.assertTrue(findings, "a dropped event produced NO finding")
        self.assertEqual(findings[0]["severity"], "block")
        self.assertIn("DEF-D", findings[0]["message"])
        self.assertIn("confirmed", findings[0]["message"])

        violations = wi.validate_items(self.graphs, self.project)
        self.assertTrue(any("I9" in v and "DEF-D" in v for v in violations),
                        f"wi-validate still reports this store clean: {violations}")

    def test_an_ordinary_append_is_not_a_loss(self):
        """NON-VACUITY IN THE OTHER DIRECTION: the working tree is normally AHEAD
        of HEAD. Growth is not loss, and a check that blocked on it would be
        turned off within the hour."""
        self.write_item("DEF-G", "defect",
                        [{"ts": "2026-08-01T00:00:00Z", "event": "reported",
                          "agent": "orchestrator"}])
        self._commit_store()
        with contextlib.redirect_stdout(io.StringIO()), \
             contextlib.redirect_stderr(io.StringIO()):
            wi.cmd_append(argparse.Namespace(
                project=self.project, id="DEF-G", event="triaged",
                agent="orchestrator", ref=None, note=None,
                ts="2026-08-01T01:00:00Z", tokens=None, duration_ms=None))
        self.assertEqual(wi.compute_event_loss(self.project), [])
        self.assertEqual([v for v in wi.validate_items(self.graphs, self.project)
                          if "I9" in v], [])

    def test_a_relocated_item_is_not_a_loss(self):
        """The likeliest false positive: a terminal item's file MOVES active/ ->
        done/, so its committed path holds nothing. The question is never "is the
        path still there" but "is the ITEM still there"."""
        self.write_item("DEF-R", "defect",
                        [{"ts": "2026-08-01T00:00:00Z", "event": "reported",
                          "agent": "orchestrator"},
                         {"ts": "2026-08-01T01:00:00Z", "event": "triaged",
                          "agent": "orchestrator"},
                         {"ts": "2026-08-01T02:00:00Z", "event": "confirmed",
                          "agent": "engineer"},
                         {"ts": "2026-08-01T03:00:00Z", "event": "fixed",
                          "agent": "engineer"}])
        self._commit_store()
        with contextlib.redirect_stdout(io.StringIO()), \
             contextlib.redirect_stderr(io.StringIO()):
            wi.cmd_append(argparse.Namespace(
                project=self.project, id="DEF-R", event="validated",
                agent="tester", ref=None, note=None,
                ts="2026-08-01T04:00:00Z", tokens=None, duration_ms=None))
        self.assertTrue(os.path.exists(self.path_of("DEF-R", "done")),
                        "fixture did not relocate — re-check the terminal event")
        self.assertEqual(wi.compute_event_loss(self.project), [])

    def test_an_UNREADABLE_check_is_neither_clean_nor_a_violation(self):
        """CANNOT MEASURE IS NEVER A PASS AND NEVER A PLAIN FAIL. With no git
        repo the answer is NOT ESTABLISHED: reported, not counted as a violation,
        and never absorbed into `clean`."""
        self.write_item("DEF-U", "defect",
                        [{"ts": "2026-08-01T00:00:00Z", "event": "reported",
                          "agent": "orchestrator"}])
        findings = wi.compute_event_loss(self.project)          # no git init
        self.assertEqual([f["severity"] for f in findings], ["unknown"])
        self.assertIn("NOT ESTABLISHED", findings[0]["message"])
        self.assertEqual([v for v in wi.validate_items(self.graphs, self.project)
                          if "I9" in v], [])
        out = io.StringIO()
        with contextlib.redirect_stdout(out), \
             contextlib.redirect_stderr(io.StringIO()):
            try:
                wi.cmd_validate(argparse.Namespace(project=self.project))
            except SystemExit:
                pass
        self.assertIn("NOT ESTABLISHED", out.getvalue(),
                      "validate reported on the store without saying that the "
                      "event-loss invariant could not be established")

    def test_the_loop_gate_runs_this_check(self):
        """DEF-ROC-165's lesson, applied to my own deliverable: a guard nothing
        invokes is the same failure wearing a different costume. The loop gate runs
        before every pull, so the detector runs every cycle without anyone
        remembering to."""
        with io.open(os.path.join(HERE, "work-items.py"), encoding="utf-8") as fh:
            src = fh.read()
        import ast
        body = None
        for node in ast.walk(ast.parse(src)):
            if isinstance(node, ast.FunctionDef) and node.name == "compute_loop_gate":
                body = "\n".join(src.split("\n")[node.lineno - 1:node.end_lineno])
        self.assertIsNotNone(body, "compute_loop_gate has been renamed")
        self.assertIn("compute_event_loss(", body,
                      "the event-loss detector is invoked by nothing that runs "
                      "automatically (DEF-ROC-165)")


class TestAnUnreadableFileIsHealedLOUDLY(StoreFixture):
    """A cost of trusting the disk copy, paid for deliberately. Before the
    re-read, `project` overwrote every file from its snapshot, which meant a
    TRUNCATED or corrupted item file was silently HEALED. Now the disk is the
    authority — so an unparseable file must not take the whole projection down
    with it, and it must not pass in silence either: the snapshot is a valid
    item, so we write it back and SAY that we replaced an unreadable file.
    """

    def test_a_truncated_file_is_restored_from_the_snapshot_and_reported(self):
        self.write_item("DEF-X", "defect",
                        [{"ts": "2026-08-01T00:00:00Z", "event": "reported",
                          "agent": "orchestrator"}])
        self.write_item("DEF-Y", "defect",
                        [{"ts": "2026-08-01T00:00:00Z", "event": "reported",
                          "agent": "orchestrator"},
                         {"ts": "2026-08-01T01:00:00Z", "event": "triaged",
                          "agent": "orchestrator"}])

        def truncate():
            with open(self.path_of("DEF-Y"), "w", encoding="utf-8") as f:
                f.write("---\nid: DEF-Y\n")      # a torn write: no closing fence

        _out, err = self.run_project(mid_run=truncate)

        self.assertIn("DEF-Y", err)
        self.assertRegex(err.lower(), r"unreadable|could not be parsed|corrupt")
        # …and the item is a valid item again, with its log intact
        ev = self.events_on_disk("DEF-Y")
        self.assertEqual([e[1] for e in ev], ["reported", "triaged"])
        self.assertEqual(wi.validate_items(self.graphs, self.project), [])


if __name__ == "__main__":
    unittest.main()
