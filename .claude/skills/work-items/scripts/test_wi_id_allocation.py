#!/usr/bin/env python3
"""DEF-ROC-203 — two concurrent actors must never be able to mint the SAME item id.

WHAT WENT WRONG (observed, not theorised, 2026-09-15). Two agents on the same
trunk both created **DEF-ROC-201** — one at 19:32Z for a quarantine-gauge defect,
one at 19:49Z for an unrelated prod-storage defect. The second file simply landed
on the first in the shared working tree. Both agents did the correct thing: each
read the highest existing id and wrote max+1. That is a READ-MODIFY-WRITE WITH A
STALE READ — between A's read and A's write, B reads the same max — and nothing
serialised the two, nothing detected the clash at write time, and nothing warned.
It was caught only because the losing agent happened to reopen its own file and
found someone else's defect in it. Nothing guaranteed that.

Third subsystem with one root: `CLAUDE.md` records the same shape for the EXP-142
experiment-id collision, and the co-owned-append-target losses that produced
`make commit-isolated` are the same shape again.

WHAT THESE TESTS ASSERT, and why they are shaped this way:

  * `TestTheHandProcedureCollides` is the WITNESS. It performs the procedure the
    agents actually follow — read the max, then write max+1 — in real parallel
    processes, with the reads forced to complete before any write. It asserts the
    collision HAPPENS: one id, one surviving file, the other actors' work gone
    with no error anywhere. It is deliberately not a test of the machinery; it is
    the reproduction, kept executable so the defect can never be argued away.

  * `TestConcurrentMint` drives REAL PARALLEL PROCESSES through `mint` and
    asserts the ids are all distinct. §F9f: a control demonstrated only in the
    happy path proves nothing, so the concurrency here is real (separate OS
    processes, released together by a barrier), not simulated in one thread.

  * `TestConcurrentMint.test_..._with_the_store_lock_DISABLED` is the one that
    pins the MECHANISM rather than the outcome. The store lock serialises the
    mints, but a lock is a cooperating convention — the platform can lack the
    primitive (`store_lock` says so itself on a platform with neither `fcntl` nor
    `msvcrt`), and a future caller can forget it. The allocation is therefore an
    `O_CREAT|O_EXCL` create-or-fail against the item path, which is the same
    "allocate atomically or fail" discipline `isolated-commit.js` gets from its
    ref compare-and-swap. With the lock removed the ids must STILL be distinct.

  * `TestMintRefusesAnExistingId` — the cheap half of the fix, and the one that
    converts a silent overwrite into a loud refusal at the moment of collision
    rather than 17 minutes later. The existing file must be BYTE-IDENTICAL
    afterwards: "refused" means nothing was written, not that it was rewritten
    with the same bytes.

`make test-wi` discovers `test_*.py`, so this module runs with the rest of the
machinery suite. Separate file, per the co-owned-file rule.
"""
import io
import os
import re
import sys
import time
import json
import shutil
import tempfile
import argparse
import unittest
import subprocess
import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
REAL_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
SOURCE = os.path.join(HERE, "work-items.py")

def read(path):
    with io.open(path, encoding="utf-8") as f:
        return f.read()


_spec = importlib.util.spec_from_file_location("work_items_ida", SOURCE)
wi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(wi)


# --- the child process -------------------------------------------------------
# One program, three modes. It is a real program in a real process: the point of
# this module is that nothing about the allocation may depend on the actors being
# threads in one interpreter, or on them cooperating.
CHILD = r'''
import argparse, contextlib, importlib.util, os, sys, time

src, root, project, mode, idx, barrier_dir = sys.argv[1:7]
spec = importlib.util.spec_from_file_location("wi_child", src)
wi = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wi)
wi.ROOT = root
wi.GRAPHS_PATH = os.path.join(root, "process", "machinery", "state-graphs.json")

def barrier():
    """Announce readiness, then wait for the parent to release everyone at once."""
    with open(os.path.join(barrier_dir, "ready-%s" % idx), "w") as f:
        f.write("1")
    go = os.path.join(barrier_dir, "GO")
    deadline = time.time() + 60
    while not os.path.exists(go):
        if time.time() > deadline:
            sys.exit("child %s: barrier never released" % idx)
        time.sleep(0.005)

items = os.path.join(root, "work", project, "items")

if mode == "hand":
    # EXACTLY the hand procedure: read the highest existing id, mint max+1.
    nums = []
    for sub in ("active", "done"):
        d = os.path.join(items, sub)
        if not os.path.isdir(d):
            continue
        for fn in os.listdir(d):
            if fn.startswith("DEF-T-") and fn.endswith(".md"):
                nums.append(int(fn[len("DEF-T-"):-3]))
    nxt = "DEF-T-%03d" % ((max(nums) if nums else 0) + 1)
    barrier()          # every actor has now READ; only then does anyone write
    fm = {"id": nxt, "type": "defect", "title": "child %s" % idx, "job": "J0",
          "value": 1, "cost": 1, "parents": [], "deps": [],
          "created_ts": "2026-09-15T00:00:00Z",
          "events": [{"ts": "2026-09-15T00:00:00Z", "event": "reported",
                      "agent": "orchestrator"}]}
    item = wi.Item(os.path.join(items, "active", nxt + ".md"), fm,
                   "\n## What happened\nchild %s\n" % idx)
    with open(item.path, "w", encoding="utf-8") as f:
        f.write(wi.render_item(item, {"state": "reported", "queue": "wip",
                                      "children": [], "ancestors": []}))
    print(nxt)
    sys.exit(0)

if mode == "mint-nolock":
    @contextlib.contextmanager
    def _no_lock(project, timeout=None):
        yield None
    wi.store_lock = _no_lock

ns = argparse.Namespace(
    project=project, type="defect", title="child %s" % idx, title_file=None,
    job="J0", value=1, cost=1, parents=None, deps=None, lane="parent-repo",
    agent="orchestrator", note=None, note_file=None, body_file=None,
    id=None, prefix=None, ts=None)
barrier()
wi.cmd_mint(ns)
'''


class StoreFixture(unittest.TestCase):
    """A throwaway item store under a temp ROOT. Never touches real project data."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="wi-ida-")
        self.project = "TestProj"
        self._orig_root = wi.ROOT
        self._orig_graphs = wi.GRAPHS_PATH
        wi.ROOT = self.tmp
        os.makedirs(os.path.join(self.tmp, "process", "machinery"), exist_ok=True)
        shutil.copy(os.path.join(REAL_ROOT, "process", "machinery", "state-graphs.json"),
                    os.path.join(self.tmp, "process", "machinery", "state-graphs.json"))
        wi.GRAPHS_PATH = os.path.join(self.tmp, "process", "machinery",
                                      "state-graphs.json")
        self.graphs = wi.Graphs.load(wi.GRAPHS_PATH)
        for sub in ("active", "done"):
            os.makedirs(self._items(sub), exist_ok=True)

    def tearDown(self):
        wi.ROOT = self._orig_root
        wi.GRAPHS_PATH = self._orig_graphs
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _items(self, sub):
        return os.path.join(self.tmp, "work", self.project, "items", sub)

    def path_of(self, iid, sub="active"):
        return os.path.join(self._items(sub), f"{iid}.md")

    def seed(self, iid, itype="defect", sub="active", title=None, genesis=None):
        """Write one existing item, rendered by the machinery itself."""
        ini = self.graphs.initial(itype)
        fm = {"id": iid, "type": itype, "title": title or iid, "job": "J0",
              "value": 1, "cost": 1, "parents": [], "deps": [],
              "created_ts": "2026-09-01T00:00:00Z",
              "events": [{"ts": "2026-09-01T00:00:00Z",
                          "event": genesis or ini, "agent": "orchestrator"}]}
        item = wi.Item(self.path_of(iid, sub), fm, f"\n## Definition\n{iid}\n")
        with open(item.path, "w", encoding="utf-8") as f:
            f.write(wi.render_item(item, {"state": ini, "queue": None,
                                          "children": [], "ancestors": []}))
        self.reproject()
        return item.path

    def reproject(self):
        """Finalise every derived block the way the machinery does, so the fixture
        is as consistent as a real store (I8 compares block against fold)."""
        items, _dup = wi.load_all_items(self.project)
        states = wi.compute_states(self.graphs, items)
        children = wi.compute_children(items)
        for tid, t in items.items():
            dv = wi.derived_block(self.graphs, items, states, children, tid)
            with open(t.path, "w", encoding="utf-8") as f:
                f.write(wi.render_item(t, dv))

    def item_ids_on_disk(self):
        out = []
        for sub in ("active", "done"):
            for fn in os.listdir(self._items(sub)):
                if fn.endswith(".md"):
                    out.append(fn[:-3])
        return sorted(out)

    # --- the real parallel actors ---------------------------------------- #
    def run_children(self, mode, n, timeout=120):
        """Spawn `n` real processes, hold them at a barrier until every one has
        reached it, release them together, and return their results."""
        barrier_dir = os.path.join(self.tmp, f"barrier-{mode}-{n}")
        os.makedirs(barrier_dir, exist_ok=True)
        prog = os.path.join(self.tmp, "child.py")
        with open(prog, "w", encoding="utf-8") as f:
            f.write(CHILD)
        procs = []
        for i in range(n):
            procs.append(subprocess.Popen(
                [sys.executable, prog, SOURCE, self.tmp, self.project, mode,
                 str(i), barrier_dir],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True))
        try:
            deadline = time.time() + timeout
            while len([f for f in os.listdir(barrier_dir)
                       if f.startswith("ready-")]) < n:
                if time.time() > deadline:
                    raise AssertionError(
                        f"only {len(os.listdir(barrier_dir))} of {n} children "
                        f"reached the barrier")
                if any(p.poll() is not None for p in procs):
                    break          # one died early; let communicate() report it
                time.sleep(0.01)
            with open(os.path.join(barrier_dir, "GO"), "w") as f:
                f.write("go")
            out = []
            for p in procs:
                so, se = p.communicate(timeout=timeout)
                out.append((p.returncode, so, se))
            return out
        finally:
            for p in procs:
                if p.poll() is None:              # pragma: no cover
                    p.kill()

    @staticmethod
    def minted_ids(results):
        """The id each child reports — the LAST non-empty line of its stdout."""
        ids = []
        for rc, so, se in results:
            lines = [l.strip() for l in so.split("\n") if l.strip()]
            ids.append(lines[-1] if lines else None)
        return ids


# ---------------------------------------------------------------------------
# The witness: the defect itself, reproduced
# ---------------------------------------------------------------------------
class TestTheHandProcedureCollides(StoreFixture):
    """This is DEF-ROC-201, executable. It is NOT a test of the machinery — it is
    the reproduction of the procedure the machinery has to replace, and it must
    keep passing: the day read-max-then-write stops colliding, the reason for
    everything below has changed."""

    def test_read_max_then_write_hands_four_actors_the_same_id(self):
        self.seed("DEF-T-001")
        results = self.run_children("hand", 4)
        for rc, so, se in results:
            self.assertEqual(rc, 0, f"a hand-writing child failed: {se}")
        ids = self.minted_ids(results)

        # 1. Every actor minted the SAME id, and every actor believed it had won.
        self.assertEqual(set(ids), {"DEF-T-002"},
                         f"expected the stale-read collision, got {ids}")

        # 2. Exactly one file exists for it — three actors' work was overwritten
        #    in the shared tree with no error, no warning and no trace.
        self.assertEqual(self.item_ids_on_disk(), ["DEF-T-001", "DEF-T-002"])
        survivor = wi.load_item(self.path_of("DEF-T-002")).fm["title"]
        self.assertRegex(survivor, r"^child \d$")
        losers = [f"child {i}" for i in range(4) if f"child {i}" != survivor]
        text = read(self.path_of("DEF-T-002"))
        for lost in losers:
            self.assertNotIn(lost, text,
                             "the losing actor's item is gone from the store")


# ---------------------------------------------------------------------------
# Acceptance 1 — two CONCURRENT mints cannot produce the same id
# ---------------------------------------------------------------------------
class TestConcurrentMint(StoreFixture):

    N = 8

    def _assert_all_distinct(self, results):
        for rc, so, se in results:
            self.assertEqual(rc, 0, f"a mint failed: {se}")
        ids = self.minted_ids(results)
        self.assertEqual(len(set(ids)), len(ids),
                         f"two concurrent mints produced the same id: {ids}")
        self.assertIsNone(next((i for i in ids if not i), None),
                          f"a mint reported no id: {ids}")
        # every id exists on disk, and each carries ITS OWN child's title — an id
        # that is distinct but whose file was overwritten is the same loss.
        titles = set()
        for iid in ids:
            path, sub = wi.find_item_path(self.project, iid)
            self.assertIsNotNone(path, f"{iid} was reported but is not on disk")
            titles.add(wi.load_item(path).fm["title"])
        self.assertEqual(len(titles), len(ids),
                         f"an item file was overwritten: {sorted(titles)}")
        return ids

    def test_eight_concurrent_mints_are_all_distinct(self):
        self.seed("DEF-T-001")
        ids = self._assert_all_distinct(self.run_children("mint", self.N))
        # …and the allocation is dense and readable: 002..009, no id burned, no
        # gap. Losing the sequence would be losing the point of keeping it.
        nums = sorted(int(i.rsplit("-", 1)[1]) for i in ids)
        self.assertEqual(nums, list(range(2, 2 + self.N)),
                         f"ids are not the dense next block: {sorted(ids)}")

    def test_eight_concurrent_mints_are_distinct_with_the_store_lock_DISABLED(self):
        """The property must come from the ALLOCATION, not from a lock a caller
        can forget and a platform can lack. With `store_lock` replaced by a no-op
        in every child, the O_EXCL create-or-fail is the only thing left."""
        self.seed("DEF-T-001")
        self._assert_all_distinct(self.run_children("mint-nolock", self.N))

    def test_the_store_is_still_valid_after_a_concurrent_mint_storm(self):
        """Distinct ids are not enough: the store they land in has to pass the
        gate. A mint that raced into an item the gate rejects has moved the
        failure, not removed it."""
        self.seed("DEF-T-001")
        results = self.run_children("mint", self.N)
        for rc, so, se in results:
            self.assertEqual(rc, 0, f"a mint failed: {se}")
        self.assertEqual(len(self.item_ids_on_disk()), self.N + 1,
                         "the storm did not actually register anything")
        self.assertEqual(wi.validate_items(self.graphs, self.project), [])


# ---------------------------------------------------------------------------
# Acceptance 2 — a write to an already-existing item id is REFUSED
# ---------------------------------------------------------------------------
class TestMintRefusesAnExistingId(StoreFixture):

    def _ns(self, **kw):
        ns = dict(project=self.project, type="defect", title="a new defect",
                  title_file=None, job="J0", value=1, cost=1, parents=None,
                  deps=None, lane="parent-repo", agent="orchestrator", note=None,
                  note_file=None, body_file=None, id=None, prefix=None, ts=None)
        ns.update(kw)
        return argparse.Namespace(**ns)

    def test_an_explicit_id_that_exists_in_active_is_refused_and_nothing_written(self):
        path = self.seed("DEF-T-001", title="the ORIGINAL defect")
        before = read(path)
        with self.assertRaises(SystemExit) as cm:
            wi.cmd_mint(self._ns(id="DEF-T-001"))
        said = str(cm.exception)
        self.assertIn("REFUSED", said)
        self.assertIn("DEF-T-001", said)
        self.assertEqual(read(path), before,
                         "the existing item must be BYTE-IDENTICAL after a refusal")

    def test_an_explicit_id_that_exists_in_DONE_is_refused_too(self):
        """A completed item's id is still taken. Refusing only against active/
        would resurrect a duplicate id in the archive (I4)."""
        path = self.seed("DEF-T-009", sub="done", genesis="reported",
                         title="a finished defect")
        before = read(path)
        with self.assertRaises(SystemExit) as cm:
            wi.cmd_mint(self._ns(id="DEF-T-009"))
        self.assertIn("REFUSED", str(cm.exception))
        self.assertIn("done", str(cm.exception))
        self.assertEqual(read(path), before)

    def test_the_sequence_skips_an_id_taken_in_done(self):
        """Allocation reads BOTH folders, so an archived id is never reissued."""
        self.seed("DEF-T-001")
        self.seed("DEF-T-002", sub="done")
        wi.cmd_mint(self._ns())
        self.assertIn("DEF-T-003", self.item_ids_on_disk())


# ---------------------------------------------------------------------------
# The minted item is VALID BY CONSTRUCTION, and a refusal leaves no wreckage
# ---------------------------------------------------------------------------
class TestMintProducesAValidItem(StoreFixture):

    def _ns(self, **kw):
        ns = dict(project=self.project, type="defect", title="a new defect",
                  title_file=None, job="J0", value=1, cost=1, parents=None,
                  deps=None, lane="parent-repo", agent="orchestrator", note=None,
                  note_file=None, body_file=None, id=None, prefix=None, ts=None)
        ns.update(kw)
        return argparse.Namespace(**ns)

    def test_the_minted_item_passes_the_gate(self):
        self.seed("REQ-T-001", itype="requirement", genesis="registered")
        self.seed("DEF-T-001")
        wi.cmd_mint(self._ns(parents="REQ-T-001", note="raised from a real run"))
        path, sub = wi.find_item_path(self.project, "DEF-T-002")
        self.assertEqual(sub, "active")
        it = wi.load_item(path)
        self.assertEqual(it.type, "defect")
        self.assertEqual(it.parents, ["REQ-T-001"])
        self.assertEqual(it.fm["lane"], "parent-repo")
        # the genesis event is the type's initial state — the one event that is
        # not a transition and therefore cannot be appended (there is no edge to
        # fire), which is exactly why creation has to write it.
        self.assertEqual([e["event"] for e in it.events], ["reported"])
        self.assertEqual(it.events[0]["agent"], "orchestrator")
        self.assertEqual(it.events[0]["note"], "raised from a real run")
        # …and the derived block agrees with the fold (I8), with no `wi-project`
        # run in between: a registration that needs a second command to become
        # valid leaves a window in which the store is not.
        self.assertEqual(wi.validate_items(self.graphs, self.project), [])
        self.assertEqual(it.declared["state"], "reported")

    def test_an_aggregate_type_is_minted_without_a_flow_event(self):
        self.seed("REQ-T-001", itype="requirement", genesis="registered")
        wi.cmd_mint(self._ns(type="slice", prefix="SLC-T", title="a slice",
                             parents="REQ-T-001"))
        path, _sub = wi.find_item_path(self.project, "SLC-T-001")
        self.assertIsNotNone(path)
        self.assertEqual(wi.validate_items(self.graphs, self.project), [])

    def test_a_refused_registration_leaves_NO_orphan_and_burns_NO_id(self):
        """The id is allocated by CREATING the file, so a later refusal has to
        remove it. An orphan half-item would be worse than the collision: it
        passes nothing and blocks the number for ever."""
        self.seed("DEF-T-001")
        with self.assertRaises(SystemExit) as cm:
            wi.cmd_mint(self._ns(parents="REQ-T-NOPE"))
        self.assertIn("REQ-T-NOPE", str(cm.exception))
        self.assertEqual(self.item_ids_on_disk(), ["DEF-T-001"])
        wi.cmd_mint(self._ns())                     # the number is still free
        self.assertEqual(self.item_ids_on_disk(), ["DEF-T-001", "DEF-T-002"])

    def test_the_id_is_the_last_line_of_stdout(self):
        """Callers have to capture it — `ID=$(make wi-mint … | tail -1)`."""
        self.seed("DEF-T-001")
        buf = io.StringIO()
        import contextlib as _c
        with _c.redirect_stdout(buf):
            wi.cmd_mint(self._ns())
        self.assertEqual([l for l in buf.getvalue().split("\n") if l.strip()][-1],
                         "DEF-T-002")


# ---------------------------------------------------------------------------
# The id SHAPE is read off the store, never guessed
# ---------------------------------------------------------------------------
class TestIdShapeComesFromTheStore(StoreFixture):

    def _ns(self, **kw):
        ns = dict(project=self.project, type="defect", title="t", title_file=None,
                  job="J0", value=1, cost=1, parents=None, deps=None,
                  lane="parent-repo", agent="orchestrator", note=None,
                  note_file=None, body_file=None, id=None, prefix=None, ts=None)
        ns.update(kw)
        return argparse.Namespace(**ns)

    def test_the_prefix_and_width_are_taken_from_the_type_s_existing_items(self):
        """Projects disagree about the prefix — ROC writes `DEF-ROC-203`,
        OagEventSource writes `DEFECT-OAG-043`. The convention is whatever the
        store already does, so it is READ, not assumed."""
        self.seed("DEFECT-OAG-0041")
        wi.cmd_mint(self._ns())
        self.assertIn("DEFECT-OAG-0042", self.item_ids_on_disk())

    def test_the_type_s_own_precedent_wins_over_another_type_s(self):
        self.seed("UC-T-007", itype="use-case", genesis="registered")
        self.seed("DEF-T-002")
        wi.cmd_mint(self._ns(type="use-case"))
        self.assertIn("UC-T-008", self.item_ids_on_disk())

    def test_with_no_precedent_and_no_prefix_it_REFUSES_rather_than_guessing(self):
        self.seed("UC-T-007", itype="use-case", genesis="registered")
        with self.assertRaises(SystemExit) as cm:
            wi.cmd_mint(self._ns(type="defect"))
        said = str(cm.exception)
        self.assertIn("--prefix", said)
        self.assertEqual(self.item_ids_on_disk(), ["UC-T-007"])

    def test_an_explicit_prefix_seeds_a_type_with_no_precedent(self):
        self.seed("UC-T-007", itype="use-case", genesis="registered")
        wi.cmd_mint(self._ns(type="defect", prefix="DEF-T"))
        self.assertIn("DEF-T-001", self.item_ids_on_disk())


# ---------------------------------------------------------------------------
# The lane declaration is REQUIRED, not optional (EXP-121)
# ---------------------------------------------------------------------------
class TestMintRequiresItsControls(StoreFixture):

    def _ns(self, **kw):
        ns = dict(project=self.project, type="defect", title="t", title_file=None,
                  job="J0", value=1, cost=1, parents=None, deps=None,
                  lane="parent-repo", agent="orchestrator", note=None,
                  note_file=None, body_file=None, id=None, prefix=None, ts=None)
        ns.update(kw)
        return argparse.Namespace(**ns)

    def test_an_absent_lane_is_refused_not_defaulted(self):
        """`make dispatch-check` fails CLOSED on an undeclared lane, and
        DEFECT-OAG-076 destroyed a delivered item because a lane was wrong. A
        permissive default here would re-create exactly that."""
        self.seed("DEF-T-001")
        with self.assertRaises(SystemExit) as cm:
            wi.cmd_mint(self._ns(lane=None))
        self.assertIn("lane", str(cm.exception).lower())
        self.assertEqual(self.item_ids_on_disk(), ["DEF-T-001"])

    def test_an_unknown_lane_is_refused(self):
        self.seed("DEF-T-001")
        with self.assertRaises(SystemExit):
            wi.cmd_mint(self._ns(lane="somewhere-else"))
        self.assertEqual(self.item_ids_on_disk(), ["DEF-T-001"])

    def test_an_unknown_type_is_refused(self):
        self.seed("DEF-T-001")
        with self.assertRaises(SystemExit) as cm:
            wi.cmd_mint(self._ns(type="epic", prefix="EPIC-T"))
        self.assertIn("epic", str(cm.exception))
        self.assertEqual(self.item_ids_on_disk(), ["DEF-T-001"])

    def test_an_unknown_agent_is_refused(self):
        """The genesis event is a permanent audit record naming who registered
        the item; a role nobody recognises makes it unauditable."""
        self.seed("DEF-T-001")
        with self.assertRaises(SystemExit) as cm:
            wi.cmd_mint(self._ns(agent="nobody"))
        self.assertIn("nobody", str(cm.exception))
        self.assertEqual(self.item_ids_on_disk(), ["DEF-T-001"])


# ---------------------------------------------------------------------------
# The TRANSPORT, driven for real — the lesson of the note-corruption class
# ---------------------------------------------------------------------------
class TestTheRealMakeTarget(unittest.TestCase):
    """The Python API never saw the note corruption; the command line did. So the
    agent-facing route is driven end-to-end here, against a throwaway project
    under the real `work/` (gitignored, disjoint from every real one)."""

    project = "_WI_MINT_PROBE"

    def setUp(self):
        self.items = os.path.join(REAL_ROOT, "work", self.project, "items")
        os.makedirs(os.path.join(self.items, "active"), exist_ok=True)
        os.makedirs(os.path.join(self.items, "done"), exist_ok=True)
        self.tmp = tempfile.mkdtemp(prefix="wi-mint-probe-")

    def tearDown(self):
        shutil.rmtree(os.path.join(REAL_ROOT, "work", self.project),
                      ignore_errors=True)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_make(self, target, **variables):
        argv = ["make", target] + [f"{k}={v}" for k, v in variables.items()]
        return subprocess.run(argv, cwd=REAL_ROOT, capture_output=True, text=True)

    def test_make_wi_mint_registers_an_item_and_prints_its_id(self):
        r = self.run_make("wi-mint", PROJECT=self.project, TYPE="defect",
                          PREFIX="DEF-PROBE", TITLE="a probe defect",
                          JOB="J0", VALUE="1", COST="1", LANE="parent-repo",
                          AGENT="orchestrator")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        iid = [l.strip() for l in r.stdout.split("\n") if l.strip()][-1]
        self.assertEqual(iid, "DEF-PROBE-001")
        self.assertTrue(os.path.exists(
            os.path.join(self.items, "active", "DEF-PROBE-001.md")))

    def test_make_wi_mint_REFUSES_an_existing_id_through_the_real_route(self):
        first = self.run_make("wi-mint", PROJECT=self.project, TYPE="defect",
                              PREFIX="DEF-PROBE", TITLE="the original",
                              JOB="J0", VALUE="1", COST="1", LANE="parent-repo",
                              AGENT="orchestrator")
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        path = os.path.join(self.items, "active", "DEF-PROBE-001.md")
        before = read(path)
        second = self.run_make("wi-mint", PROJECT=self.project, TYPE="defect",
                               ID="DEF-PROBE-001", TITLE="the intruder",
                               JOB="J0", VALUE="1", COST="1", LANE="parent-repo",
                               AGENT="orchestrator")
        self.assertNotEqual(second.returncode, 0,
                            "the real route silently overwrote an existing item")
        self.assertIn("REFUSED", second.stdout + second.stderr)
        self.assertEqual(read(path), before)

    def test_a_title_a_shell_would_eat_is_refused_by_the_make_guard(self):
        """Same hazard class as NOTE=, same remedy: the file route. A `$` is
        expanded away and a backtick is EXECUTED on the way into a permanent
        record, so the command-line route must refuse rather than corrupt."""
        r = self.run_make("wi-mint", PROJECT=self.project, TYPE="defect",
                          PREFIX="DEF-PROBE", JOB="J0", VALUE="1", COST="1",
                          LANE="parent-repo", AGENT="orchestrator",
                          TITLE="matches ^oag-[0-9]{12}$ exactly")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("REFUSED", r.stdout + r.stderr)
        self.assertIn("TITLE_FILE", r.stdout + r.stderr)

    def test_a_title_from_a_FILE_round_trips_through_the_real_route(self):
        hazard = 'regex ^oag-[0-9]{12}$, a `backtick` and a "quote"'
        tf = os.path.join(self.tmp, "title.txt")
        with io.open(tf, "w", encoding="utf-8") as f:
            f.write(hazard)
        r = self.run_make("wi-mint", PROJECT=self.project, TYPE="defect",
                          PREFIX="DEF-PROBE", TITLE_FILE=tf, JOB="J0",
                          VALUE="1", COST="1", LANE="parent-repo",
                          AGENT="orchestrator")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        path = os.path.join(self.items, "active", "DEF-PROBE-001.md")
        self.assertEqual(wi.load_item(path).fm["title"], hazard)


# ---------------------------------------------------------------------------
# The subcommand exists where the agents are told it does
# ---------------------------------------------------------------------------
class TestMintIsReachable(unittest.TestCase):

    def test_mint_is_a_registered_subcommand(self):
        r = subprocess.run(
            ["sh", os.path.join(".claude", "skills", "work-items", "scripts",
                                "work-items"), "mint", "--help"],
            cwd=REAL_ROOT, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("--lane", r.stdout)

    def test_the_makefile_exposes_it(self):
        mk = read(os.path.join(REAL_ROOT, "Makefile"))
        self.assertRegex(mk, r"(?m)^wi-mint:")
        phony = " ".join(l for l in mk.split("\n") if l.startswith(".PHONY:"))
        self.assertIn("wi-mint", phony,
                      "wi-mint must be .PHONY like the other wi-* targets")


if __name__ == "__main__":                                   # pragma: no cover
    unittest.main()
