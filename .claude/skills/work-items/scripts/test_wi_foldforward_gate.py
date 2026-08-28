#!/usr/bin/env python3
"""THE FOLD-FORWARD GATE ITSELF, DRIVEN — not its predicate restated in a test.

OI-PARTS-CHECK-MARKER-DIRTIES-THE-TREE-AND-DEFERS-FOLD-FORWARD
  AC-PCM.1  a `retro-mark` / `parts-check` run leaves the parent worktree clean
  AC-PCM.2  `project-update` does not exit 3 as a consequence of a preceding
            `parts-check`
  AC-PCM.3  retro cadence stays derivable — including ACROSS the merge
  AC-PCM.4  non-vacuity: RED on a tree deliberately dirtied by the marker

WHY A SECOND MODULE, WHEN `test_work_items.TestRetroLogStore` ALREADY COVERS THE
STORE. Those tests assert `git status --porcelain` is empty. That is the gate's
INPUT, not the gate: the exit-3 lives in `.claude/scripts/worktree` (`cmd_update`),
a shell script no test executed. Asserting the input while re-typing the
predicate is the isolated-proxy shape the delivery principles reject — if the
gate's cleanliness test ever widened (submodules, `diff HEAD`, an ignored-file
sweep), a porcelain-empty assertion would keep passing while the fold-forward
kept deferring. So these tests run the REAL script against REAL git and read its
REAL exit code.

AND THERE IS A SHARPER REASON, MEASURED ON THE LIVE TREE 2026-08-27. On
`instance/OagEventSource` today `main` is ALREADY an ancestor, so `cmd_update`
returns 0 at its `merge-base --is-ancestor` short-circuit BEFORE it ever looks at
the worktree's cleanliness. A live `make project-update` therefore exits 0 whether
or not the fault is present: the demonstration the acceptance asks for is VACUOUS
on an up-to-date tree, which is the same shape as the ordering that originally hid
the fault (the item's own record: "I ran project-update BEFORE parts-check"). That
unreachability is pinned below (test_the_gate_is_unreachable_...) so nobody reads a
live exit 0 as evidence again — and the two discriminating arms are run here, with
`main` deliberately AHEAD, which is the only state in which the gate speaks.

FIXTURE = the real topology in miniature: an integration tree on `main`, a real
`git worktree` on `instance/TestProj`, the real `.gitignore` copied (so `/work/*/`
and `/process/dora/statusline.json` mean exactly what they mean in the parent
repo), and a TRACKED `process/dora/retro-marker/TestProj.txt` — the pre-cutover
file whose write was the fault.
"""
import io
import os
import json
import shutil
import argparse
import subprocess
import tempfile
import unittest
import contextlib
import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
WORKTREE_SCRIPT = os.path.join(ROOT, ".claude", "scripts", "worktree")
REAL_GITIGNORE = os.path.join(ROOT, ".gitignore")
REAL_GRAPHS = os.path.join(ROOT, "process", "machinery", "state-graphs.json")

_spec = importlib.util.spec_from_file_location(
    "work_items_ffg", os.path.join(HERE, "work-items.py"))
wi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(wi)

PROJECT = "TestProj"
STAMP = "2026-06-20T00:00:00Z"
PRE_CUTOVER = "2026-06-01T00:00:00Z"


class FoldForwardGate(unittest.TestCase):
    """A real integration tree + a real worktree + the real gate script."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="wi-ffg-")
        self.main_tree = os.path.join(self.tmp, "integration")
        os.makedirs(self.main_tree)
        self._git(self.main_tree, "init", "-q", "-b", "main")
        self._git(self.main_tree, "config", "user.email", "t@t")
        self._git(self.main_tree, "config", "user.name", "t")
        shutil.copy(REAL_GITIGNORE, os.path.join(self.main_tree, ".gitignore"))
        # the TRACKED pre-cutover marker — the file whose write was the fault
        md = os.path.join(self.main_tree, "process", "dora", "retro-marker")
        os.makedirs(md)
        self._write(os.path.join(md, f"{PROJECT}.txt"), PRE_CUTOVER + "\n")
        self._git(self.main_tree, "add", "-A")
        self._git(self.main_tree, "commit", "-qm", "seed")

        # a real worktree on instance/<project>, exactly as `worktree ensure` makes
        self.wt = os.path.join(self.tmp, f"{PROJECT}-worktree")
        self._git(self.main_tree, "worktree", "add", "-q", self.wt,
                  "-b", f"instance/{PROJECT}", "main")

        # point the machinery at the WORKTREE — that is the tree an agent runs in
        self._orig = (wi.ROOT, wi.STATUSLINE, wi.GRAPHS_PATH)
        wi.ROOT = self.wt
        wi.STATUSLINE = os.path.join(self.wt, "process", "dora", "statusline.json")
        wi.GRAPHS_PATH = REAL_GRAPHS
        os.makedirs(os.path.join(self.wt, "work", PROJECT, "items", "active"))
        os.makedirs(os.path.join(self.wt, "work", PROJECT, "items", "done"))
        self._stats("queue", "open")
        self.assertEqual(self._porcelain(), "", "fixture did not start clean")

    def tearDown(self):
        wi.ROOT, wi.STATUSLINE, wi.GRAPHS_PATH = self._orig
        # release the worktree registration before the dir goes
        subprocess.run(["git", "-C", self.main_tree, "worktree", "remove",
                        "--force", self.wt], capture_output=True, text=True)
        shutil.rmtree(self.tmp, ignore_errors=True)

    # --- helpers ---------------------------------------------------------- #
    def _git(self, where, *args):
        r = subprocess.run(("git", "-C", where) + args,
                           capture_output=True, text=True)
        return r

    def _write(self, path, text):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)

    def _porcelain(self):
        return self._git(self.wt, "status", "--porcelain").stdout.strip()

    def _stats(self, owner, state):
        d = os.path.join(self.wt, "work", PROJECT, "views")
        os.makedirs(d, exist_ok=True)
        self._write(os.path.join(d, "stats.json"), json.dumps(
            {"overall": {"gross_lead_time": {
                "by_owner": {owner: {"pct_of_glt": 60.0,
                                     "backfill_pct_of_state": 0.0}},
                "by_state": {state: {"pct_of_glt": 42.0,
                                     "backfill_pct_of_state": 0.0}}}}}))

    def _advance_main(self, name="process/process-current.md"):
        """Put a commit on `main` that the worktree does not have, so the gate is
        actually REACHED. Without this the whole check short-circuits at exit 0."""
        self._write(os.path.join(self.main_tree, name), "v154\n")
        self._git(self.main_tree, "add", "--", name)
        self._git(self.main_tree, "commit", "-qm", "process bump on main")
        self.assertFalse(self._main_is_ancestor(), "fixture: main is not ahead")

    def _main_is_ancestor(self):
        return self._git(self.wt, "merge-base", "--is-ancestor",
                         "main", f"instance/{PROJECT}").returncode == 0

    def _update(self):
        """THE REAL GATE. `make project-update` = this, one shell hop away."""
        return subprocess.run(["sh", WORKTREE_SCRIPT, "update", PROJECT],
                              cwd=self.wt, capture_output=True, text=True)

    def _pre_cutover_parts_check_write(self):
        """What EVERY parts-check used to do: one ISO line into the tracked file."""
        self._write(os.path.join(self.wt, "process", "dora", "retro-marker",
                                 f"{PROJECT}.txt"), STAMP + "\n")

    def _real_writers(self):
        """The two REAL cadence writers, in the order STAGE F runs them."""
        with contextlib.redirect_stdout(io.StringIO()):
            wi.cmd_retro_mark(argparse.Namespace(project=PROJECT, now=STAMP))
            with self.assertRaises(SystemExit) as e:
                wi.cmd_parts_check(argparse.Namespace(
                    project=PROJECT, threshold=3, now="2026-06-21T00:00:00Z"))
        self.assertEqual(e.exception.code, 0, "parts-check did not take the cheap path")

    # --- AC-PCM.4 — the RED arm, against the real gate -------------------- #
    def test_ac_pcm_4_RED_the_tracked_marker_write_makes_the_REAL_GATE_exit_3(self):
        """The fault, reproduced through the actual script rather than its
        predicate: a tracked one-line write nobody authored, and the fold-forward
        CLAUDE.md §0a Rule 4 requires to run continuously does not run."""
        self._advance_main()
        self._pre_cutover_parts_check_write()
        r = self._update()
        self.assertEqual(r.returncode, 3, r.stdout + r.stderr)
        self.assertIn("DEFERRED", r.stderr)
        # and the consequence, not just the exit code: main did NOT land
        self.assertFalse(self._main_is_ancestor(),
                         "the gate exited 3 but the merge happened anyway")

    def test_ac_pcm_4_RED_arm_is_caused_by_the_MARKER_and_nothing_else(self):
        """Isolates the cause: same fixture, same advance, no marker write => the
        gate passes. So the exit 3 above is the marker's, not the fixture's."""
        self._advance_main()
        r = self._update()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertTrue(self._main_is_ancestor())

    # --- AC-PCM.1 + AC-PCM.2 — the GREEN arm, in the hiding order --------- #
    def test_ac_pcm_1_and_2_parts_check_THEN_update_folds_forward_for_real(self):
        """AC-PCM.2's exact ordering — check first, gate second — with `main`
        deliberately ahead so the gate is REACHED. Exit 0 here is evidence."""
        self._advance_main()
        self._real_writers()
        self.assertEqual(self._porcelain(), "",
                         "a cadence write dirtied the parent worktree")
        r = self._update()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertNotIn("DEFERRED", r.stderr)
        self.assertTrue(self._main_is_ancestor(),
                        "exit 0 but the fold-forward did not actually land")
        # clean because the write went to the repo that OWNS the fact, not
        # because nothing was written
        log = os.path.join(self.wt, "work", PROJECT, "items", "retro-log.md")
        self.assertTrue(os.path.exists(log), "no cadence record was written")

    def test_ac_pcm_1_the_frozen_parent_files_are_never_rewritten(self):
        """The fossils stay byte-identical: `git status` cannot go dirty from a
        file nothing writes. (Deletion was refused deliberately — delta-075 R7 —
        so that no OTHER project's cadence moves at the cutover.)"""
        fossil = os.path.join(self.wt, "process", "dora", "retro-marker",
                              f"{PROJECT}.txt")
        with open(fossil, "rb") as f:
            before = f.read()
        self._real_writers()
        with open(fossil, "rb") as f:
            self.assertEqual(f.read(), before)
        self.assertEqual(self._porcelain(), "")

    # --- AC-PCM.3 — the record survives the merge the gate was blocking ---- #
    def test_ac_pcm_3_the_cadence_record_survives_the_fold_forward_merge(self):
        """The point of relocating INTO `work/<project>/`: the parent-repo merge
        that fold-forward performs must not touch the cadence record. If it did,
        every fold-forward would silently reset retro debt."""
        self._advance_main()
        self._real_writers()
        self.assertEqual(self._update().returncode, 0)
        # BOTH arms survive the merge, each on its own boundary (DEF-ROC-130):
        # `_real_writers` runs the full close at STAMP then the cheap drain at
        # 06-21, so the incident arm is at the drain and the routine arm at the
        # close. A merge that reset either would silently reset retro debt.
        self.assertEqual(wi._read_retro_marker(PROJECT, wi.ARM_INCIDENT),
                         wi.parse_ts("2026-06-21T00:00:00Z"))
        self.assertEqual(wi._read_retro_marker(PROJECT, wi.ARM_ROUTINE),
                         wi.parse_ts(STAMP))
        for arm in wi.ARMS:
            kind, _ts, src = wi._retro_verdict(PROJECT, arm)
            self.assertEqual(kind, "known", arm)
            self.assertIn("retro-log.md", src)

    # --- the vacuity pin: why a LIVE exit 0 is not evidence ---------------- #
    def test_the_gate_is_unreachable_when_main_is_already_an_ancestor(self):
        """MEASURED ON THE LIVE TREE (2026-08-27): `main` was already an ancestor
        of `instance/OagEventSource`, so `cmd_update` short-circuits to exit 0
        BEFORE the cleanliness gate. A dirty tree exits 0 too. Therefore a live
        `make project-update` exit 0 says nothing about this defect either way,
        and every discriminating test above advances `main` first."""
        self.assertTrue(self._main_is_ancestor())
        self._pre_cutover_parts_check_write()          # the fault IS present
        self.assertNotEqual(self._porcelain(), "")
        r = self._update()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("already up to date", r.stdout + r.stderr)
        self.assertNotIn("DEFERRED", r.stderr)


if __name__ == "__main__":
    unittest.main()
