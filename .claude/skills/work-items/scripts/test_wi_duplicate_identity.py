#!/usr/bin/env python3
"""DEF-ROC-268 — an id that resolves to MORE THAN ONE item file, with divergent
logs, must not be a thing the invariant set is silent about.

WHAT HAPPENED (measured on the real store, 2026-09-17). `DEF-ROC-231` and
`DEF-ROC-248` each existed in BOTH `items/active/` and `items/done/` in HEAD —
the `done/` copies carrying their `validated` event and the `active/` copies not.
`make wi-validate` reported **clean** through every run of that session.

THE CAUSE WAS CHEAP AND IS NOT THE FINDING. Committing a resolved item is a
RENAME — `items/active/X.md` -> `items/done/X.md`, two paths — and only the
`done/` side was declared to `commit-isolated`, so the deletion of the `active/`
copy was never committed. `commit-isolated` behaved correctly: it commits the
paths you declare, and the remedy is NOT to make it guess the other half of a
rename. Fixed by hand at `5f1b50f6`.

THE FINDING IS THAT NOTHING NOTICED, and the shape of the silence is what makes
it registerable rather than a chore:

  * `I1`–`I4` and `I6`–`I8` are computed from PARSED ITEM FILES and `I9` asks
    whether an event committed in HEAD is missing from the working tree. **None
    of them asks whether an id appears twice.** The invariant set was complete
    about the CONTENTS of item files and silent about the SET of them.
  * The one check that did look — the I4a dup clause — walks THE WORKING TREE
    ONLY, and in the real instance the working tree held one copy while HEAD held
    two. The durable record is the one that was wrong, and no invariant read it.
  * `_head_item_logs` keyed its result BY ID, so the second committed copy
    overwrote the first in a dict: I9 has been picking one copy per id all along
    and never said so.

AND THE TWO HALVES OF THE MACHINERY PICK DIFFERENT COPIES. `find_item_path`
returns `items/active/` FIRST — so every writer (`wi-append`) and `item-brief`
resolve to the ACTIVE copy. `load_all_items` keys by id in walk order, so the
LAST file walked (`done/`) wins — every derived view resolves to the DONE copy.
With two copies present the write path and the read path are operating on
DIFFERENT FILES, which is why "which copy is stale" is the only useful thing to
say and why saying merely "there are two" is not enough.

IT WAS BENIGN IN THE SAFEST DIRECTION AND THAT IS LUCK. `views/queues.json`
listed neither item, so nothing was double-counted. The reverse divergence — an
`active/` copy AHEAD of a `done/` copy — would put a resolved item back in a
queue, or hide a live one.

WHAT IS PINNED HERE (I11):

  1. an id committed at two paths IN HEAD is a violation, even when the working
     tree holds exactly one copy — the founding instance, and the one every
     existing invariant was blind to;
  2. the working-tree duplicate is STILL refused (no refusal is weakened);
  3. the message names BOTH paths and says WHICH COPY IS STALE, by the only rule
     that is sound over an append-only log: a strict subset is behind;
  4. copies that have genuinely DIVERGED are reported as diverged — the tool says
     it cannot tell, and names what each side holds, rather than guessing;
  5. copies that AGREE are still a violation — agreement is not permission;
  6. a HEAD side that CANNOT be established is neither clean nor a plain fail
     (§17i), and `I11` is never named among the invariants that hold while it is
     unknown;
  7. `wi-project` does not resolve the ambiguity by DESTROYING one side — its
     relocation moved the stale `active/` copy on top of the resolved `done/`
     one, which is measured here rather than argued.

DEF-ROC-290 — I11 REPORTED ITSELF HOLDING OVER A POPULATION IT COULD NOT READ.

`compute_duplicate_identity` passed `unreadable=[]` to `_head_item_logs` and
DISCARDED the list, so a committed blob that would not parse left the population
SILENTLY and I11 then named itself among the invariants that hold. Measured by
this module's own tester on the store below: `DEF-D` committed at BOTH paths with
the `active/` blob garbage printed

    I1–I4 + I6 + I7 + I8 + I10 + I11 all hold

while HEAD carried two copies of that id — precisely the violation I11 exists to
find. It was not exploitable, because I9 DOES carry the same list and the run
still read `NOT CLEAN`; the sub-claim was manufactured all the same, and the two
invariants are separately readable, so a caller reading I11's verdict got a false
one. An invariant whose POSITIVE is reachable without the population being
complete is the §F9f mirror — in the invariant written to stop that class.

  8. an unreadable committed blob makes I11 NOT ESTABLISHED and keeps it OUT of
     the holders list, while a clean fully-readable store still puts it IN
     (both directions); it is an UNKNOWN and never an accusation (§17i), and what
     WAS established is still reported alongside it;
  9. a DIVERGENCE where both copies hold the same event NAMES at different
     timestamps is not printed as two identical lists — the second, separate
     reporting fault in the same family.

Nothing is stubbed: every test drives the real `validate_items`, `cmd_validate`,
`cmd_project` and a real git repo.
"""
import io
import os
import re
import shutil
import argparse
import tempfile
import unittest
import contextlib
import subprocess
import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
REAL_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))

_spec = importlib.util.spec_from_file_location(
    "work_items_dupid", os.path.join(HERE, "work-items.py"))
wi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(wi)


REPORTED = {"ts": "2026-09-01T00:00:00Z", "event": "reported",
            "agent": "orchestrator"}
TRIAGED = {"ts": "2026-09-01T01:00:00Z", "event": "triaged",
           "agent": "orchestrator"}
PULLED = {"ts": "2026-09-01T02:00:00Z", "event": "pulled", "agent": "orchestrator"}
CONFIRMED = {"ts": "2026-09-01T03:00:00Z", "event": "confirmed", "agent": "engineer"}
FIXED = {"ts": "2026-09-01T04:00:00Z", "event": "fixed", "agent": "engineer"}
VALIDATED = {"ts": "2026-09-01T05:00:00Z", "event": "validated", "agent": "tester"}

# The SAME event name at a DIFFERENT timestamp. An event's identity is
# (ts, event, agent), so these two are different events that render to the same
# name — the shape DEF-ROC-290's second fault printed identically on both sides.
FIXED_LATER = {"ts": "2026-09-01T04:30:00Z", "event": "fixed", "agent": "engineer"}

RESOLVED_LOG = [REPORTED, TRIAGED, PULLED, CONFIRMED, FIXED, VALIDATED]
STALE_LOG = [REPORTED, TRIAGED, PULLED, CONFIRMED, FIXED]


class Store(unittest.TestCase):
    """A throwaway item store under a temp ROOT, optionally a real git repo."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="wi-dupid-")
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

    # --- store ------------------------------------------------------------- #
    def _items(self, sub):
        return os.path.join(self.tmp, "work", self.project, "items", sub)

    def path_of(self, iid, sub="active"):
        return os.path.join(self._items(sub), f"{iid}.md")

    def write_item(self, iid, events, sub="active", itype="defect"):
        fm = {"id": iid, "type": itype, "title": iid, "job": "J0",
              "value": 1, "cost": 0.5, "parents": [], "deps": [],
              "created_ts": "2026-09-01T00:00:00Z", "events": list(events)}
        item = wi.Item(self.path_of(iid, sub), fm, "\n## Definition\nstub\n")
        with open(item.path, "w", encoding="utf-8") as f:
            f.write(wi.render_item(item, {"state": None, "queue": None,
                                          "children": [], "ancestors": []}))
        self._finalise_derived()
        return item.path

    def _finalise_derived(self):
        """Render every `derived:` block the way the machinery does, so a fixture
        is as internally consistent as a real store (I8 compares it to the fold).
        With a duplicated id only one copy is reachable through `load_all_items`,
        so the OTHER copy is rendered directly from its own log."""
        items, _dups = wi.load_all_items(self.project)
        states = wi.compute_states(self.graphs, items)
        children = wi.compute_children(items)
        for tid, t in items.items():
            dv = wi.derived_block(self.graphs, items, states, children, tid)
            with open(t.path, "w", encoding="utf-8") as f:
                f.write(wi.render_item(t, dv))

    def render_own_derived(self, path):
        """Give the file at `path` a `derived:` block computed from its OWN log,
        which is what a real duplicated copy carries: it was written when it was
        the only copy."""
        it = wi.load_item(path)
        state = wi.fold_state(self.graphs, it.type, it.events)
        dv = {"state": state, "queue": self.graphs.queue_for(state),
              "children": [], "ancestors": [],
              "metrics": wi.per_item_metrics(self.graphs, it, None)}
        with open(path, "w", encoding="utf-8") as f:
            f.write(wi.render_item(it, dv))

    # --- git --------------------------------------------------------------- #
    def _git(self, *args):
        repo = os.path.join(self.tmp, "work", self.project)
        return subprocess.run(
            ["git", "-C", repo, "-c", "user.email=t@t", "-c", "user.name=t",
             "-c", "commit.gpgsign=false", *args],
            capture_output=True, text=True)

    def git_init(self):
        self.assertEqual(self._git("init", "-q").returncode, 0)

    def git_commit_all(self, msg="items"):
        self._git("add", "-A", "--", "items")
        r = self._git("commit", "-q", "-m", msg)
        self.assertEqual(r.returncode, 0, r.stderr)

    def git_commit_paths(self, msg, *paths):
        """Commit ONLY these paths — the declared-paths commit that made the real
        instance: the rename's `done/` half is declared and its `active/` half,
        the DELETION, is not."""
        self._git("add", "--", *paths)
        r = self._git("commit", "-q", "-m", msg)
        self.assertEqual(r.returncode, 0, r.stderr)

    # --- drive ------------------------------------------------------------- #
    def validate(self):
        return wi.validate_items(self.graphs, self.project)

    def holders(self, out):
        """The invariant names the summary asserts HOLD — the `X + Y all hold`
        list and nothing else.

        Read as a LIST rather than by substring on purpose: I11 appears in the
        NOT-CLEAN sentence EITHER as a holder or as a name that could not be
        established, and a substring test cannot tell those apart — which is the
        very confusion DEF-ROC-290 is about."""
        lines = [l for l in out.splitlines() if l.startswith("validate: ")
                 and ("clean" in l or "NOT CLEAN" in l)]
        self.assertTrue(lines, out)
        seg = lines[-1].split(" all hold")[0]
        for sep in ("withholds the claim. ", " — "):
            if sep in seg:
                seg = seg.rsplit(sep, 1)[1]
                break
        return [n.strip() for n in seg.split(" + ")]

    def validate_output(self):
        out, err = io.StringIO(), io.StringIO()
        code = 0
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                wi.cmd_validate(argparse.Namespace(project=self.project))
            except SystemExit as e:
                code = e.code or 0
        return code, out.getvalue(), err.getvalue()


# --------------------------------------------------------------------------- #
# Limb 1 — the founding instance: duplicated in HEAD, single in the working tree
# --------------------------------------------------------------------------- #
class TestADuplicateCommittedInHEAD(Store):

    def _make_the_real_instance(self, iid="DEF-D"):
        """Reproduce `5f1b50f6`'s store EXACTLY.

        The item is committed while live in `active/`; it is then resolved, which
        RELOCATES the file to `done/`; and the commit that records that declares
        only the `done/` path. HEAD therefore carries TWO copies of one id, the
        `active/` one short of its `validated` event. The working tree carries
        ONE — which is why every working-tree invariant reported clean.
        """
        self.write_item(iid, STALE_LOG, sub="active")
        self.git_init()
        self.git_commit_all("the item while it was live")
        # resolve it through the real writer, which relocates active/ -> done/
        with contextlib.redirect_stdout(io.StringIO()), \
                contextlib.redirect_stderr(io.StringIO()):
            wi.cmd_append(argparse.Namespace(
                project=self.project, id=iid, event="validated", agent="tester",
                ref=None, note=None, ts=VALIDATED["ts"], tokens=None,
                duration_ms=None))
        self.assertTrue(os.path.exists(self.path_of(iid, "done")))
        self.assertFalse(os.path.exists(self.path_of(iid, "active")))
        # `commit-isolated` builds a PRIVATE index from HEAD and adds only the
        # declared paths, so the relocation the machinery helpfully staged is not
        # what gets committed. Clear the index to model that faithfully: the
        # deletion of the active/ half is simply never declared.
        self._git("reset", "-q")
        self.git_commit_paths("declare only the done/ half of the rename",
                              f"items/done/{iid}.md")
        return iid

    def test_the_store_really_is_the_one_that_was_reported(self):
        """NON-VACUITY. Before asserting anything about the gate, prove the
        fixture is the hazard: two committed paths for one id, and the working
        tree holding exactly one file."""
        iid = self._make_the_real_instance()
        committed = self._git("ls-tree", "-r", "--name-only", "HEAD", "items/")
        self.assertIn(f"items/active/{iid}.md", committed.stdout)
        self.assertIn(f"items/done/{iid}.md", committed.stdout)
        on_disk = [p for p in (self.path_of(iid, "active"), self.path_of(iid, "done"))
                   if os.path.exists(p)]
        self.assertEqual(len(on_disk), 1, on_disk)

    def test_it_is_a_VIOLATION_and_names_BOTH_paths(self):
        iid = self._make_the_real_instance()
        v = [x for x in self.validate() if "I11" in x]
        self.assertTrue(v, f"the gate reported this store clean: {self.validate()}")
        joined = " ".join(v)
        self.assertIn(f"items/active/{iid}.md", joined)
        self.assertIn(f"items/done/{iid}.md", joined)
        self.assertIn("HEAD", joined)

    def test_it_names_WHICH_copy_is_stale_and_what_that_copy_is_missing(self):
        """Saying "there are two" is not enough: the remedy was obvious in the
        real instance only because one copy happened to lack a terminal event."""
        iid = self._make_the_real_instance()
        v = " ".join(x for x in self.validate() if "I11" in x)
        self.assertIn("STALE", v)
        self.assertRegex(v, r"STALE[^.]*items/active/" + iid + r"\.md")
        self.assertIn("validated", v, "the message does not say what is missing")

    def test_cmd_validate_exits_NONZERO_on_it(self):
        self._make_the_real_instance()
        code, _out, err = self.validate_output()
        self.assertEqual(code, 1)
        self.assertIn("I11", err)


# --------------------------------------------------------------------------- #
# Limb 2 — the working-tree duplicate is still refused (nothing is weakened)
# --------------------------------------------------------------------------- #
class TestADuplicateInTheWorkingTree(Store):

    def _two_copies(self, iid="DEF-W", active=None, done=None):
        self.write_item(iid, active if active is not None else STALE_LOG,
                        sub="active")
        self.write_item(iid, done if done is not None else RESOLVED_LOG,
                        sub="done")
        self.render_own_derived(self.path_of(iid, "active"))
        self.render_own_derived(self.path_of(iid, "done"))
        return iid

    def test_two_files_on_disk_are_still_a_violation(self):
        iid = self._two_copies()
        v = [x for x in self.validate() if iid in x and ("I4" in x or "I11" in x)]
        self.assertTrue(v, f"the dup refusal was LOST: {self.validate()}")

    def test_it_names_both_paths_and_the_stale_copy(self):
        iid = self._two_copies()
        v = " ".join(x for x in self.validate() if "I11" in x)
        self.assertIn(f"items/active/{iid}.md", v)
        self.assertIn(f"items/done/{iid}.md", v)
        self.assertIn("STALE", v)
        self.assertRegex(v, r"STALE[^.]*items/active/" + iid + r"\.md")

    def test_copies_that_have_DIVERGED_are_not_guessed_at(self):
        """Neither log is a subset of the other, so neither is 'behind'. An
        append-only log admits no honest verdict here and the tool must say so
        rather than pick — the reverse divergence is the dangerous one."""
        iid = self._two_copies(
            active=[REPORTED, TRIAGED, PULLED, CONFIRMED],
            done=[REPORTED, TRIAGED, PULLED, FIXED, VALIDATED])
        v = " ".join(x for x in self.validate() if "I11" in x)
        self.assertIn("DIVERGED", v)
        self.assertNotIn("STALE", v)
        self.assertIn("confirmed", v)       # what only active/ holds
        self.assertIn("fixed", v)           # what only done/ holds

    def test_a_divergence_at_the_SAME_event_NAME_is_not_two_identical_lists(self):
        """DEF-ROC-290's second fault, measured. An event's identity carries its
        TIMESTAMP and the rendering drops it, so two copies that each hold
        `fixed` — at different times, by the same agent — printed the SAME list
        on both sides of the sentence that says they differ. A report that shows
        two things as identical while telling you they are not is worse than
        silence: a reader acts on it.

        The fix must DISAMBIGUATE, not dump the internal form — the name is what
        a reader can act on."""
        iid = self._two_copies(
            active=[REPORTED, TRIAGED, PULLED, CONFIRMED, FIXED],
            done=[REPORTED, TRIAGED, PULLED, CONFIRMED, FIXED_LATER])
        v = " ".join(x for x in self.validate() if "I11" in x)
        self.assertIn("DIVERGED", v)
        sides = re.findall(r"\[([^\]]*)\]", v)
        self.assertEqual(len(sides), 2, f"expected one list per side: {v}")
        self.assertNotEqual(
            sides[0], sides[1],
            "both sides of the divergence rendered IDENTICALLY — the report "
            f"shows two things as the same while saying they differ: {v}")
        self.assertIn(FIXED["ts"], v, "the disambiguator is the timestamp")
        self.assertIn(FIXED_LATER["ts"], v)
        self.assertIn("fixed", v, "the NAME is still what the reader acts on")
        self.assertNotIn("engineer'", v, "the internal signature was dumped")

    def test_a_divergence_at_DIFFERENT_names_stays_as_SHORT_as_it_was(self):
        """Both directions. The timestamp is a DISAMBIGUATOR, not a new default:
        a divergence the names already distinguish must not be cluttered, or the
        listing loses the brevity that makes it readable."""
        iid = self._two_copies(
            active=[REPORTED, TRIAGED, PULLED, CONFIRMED],
            done=[REPORTED, TRIAGED, PULLED, FIXED, VALIDATED])
        v = " ".join(x for x in self.validate() if "I11" in x)
        self.assertIn("DIVERGED", v)
        self.assertIn("confirmed", v)
        self.assertIn("fixed", v)
        self.assertNotIn(CONFIRMED["ts"], v)
        self.assertNotIn(FIXED["ts"], v)

    def test_a_MIXED_divergence_qualifies_ONLY_the_shared_name(self):
        """The two committed cases are all-shared and all-distinct; this is the
        MIXED one, where the `both` intersection actually has to discriminate
        [DEF-ROC-290, tester].

        A divergence usually carries some names the two sides share and some
        they do not, and the rule is per-NAME, not per-report: qualifying the
        whole side would clutter what the names already distinguish, and
        qualifying none of it reprints the founding fault. Pinned because a
        mixed case passes both existing tests while getting this wrong.
        """
        iid = self._two_copies(
            active=[REPORTED, TRIAGED, PULLED, CONFIRMED, FIXED],
            done=[REPORTED, TRIAGED, PULLED, FIXED_LATER, VALIDATED])
        v = " ".join(x for x in self.validate() if "I11" in x)
        self.assertIn("DIVERGED", v)
        sides = re.findall(r"\[([^\]]*)\]", v)
        self.assertEqual(len(sides), 2, f"expected one list per side: {v}")
        # `fixed` is on BOTH sides at different times -> qualified on both
        self.assertIn(f"fixed at {FIXED['ts']}", v)
        self.assertIn(f"fixed at {FIXED_LATER['ts']}", v)
        # `confirmed` and `validated` are each on ONE side -> left alone
        for side in sides:
            self.assertNotIn("confirmed at", side,
                             f"a name only ONE side holds was qualified: {side}")
            self.assertNotIn("validated at", side,
                             f"a name only ONE side holds was qualified: {side}")

    def test_copies_that_AGREE_are_still_a_violation(self):
        """Agreement is not permission: an id must resolve to exactly ONE file,
        because the writer and the readers resolve to different ones."""
        iid = self._two_copies(active=RESOLVED_LOG, done=RESOLVED_LOG)
        v = [x for x in self.validate() if "I11" in x and iid in x]
        self.assertTrue(v, "identical copies were treated as harmless")
        self.assertIn("AGREE", " ".join(v))

    def test_a_clean_store_reports_no_I11_violation(self):
        """NON-VACUITY the other way: the ordinary store, where a terminal item
        lives in done/ and nowhere else, must not trip this."""
        self.write_item("DEF-OK", RESOLVED_LOG, sub="done")
        self.assertEqual([x for x in self.validate() if "I11" in x], [])


# --------------------------------------------------------------------------- #
# Limb 3 — the two halves of the machinery resolve to DIFFERENT copies
# --------------------------------------------------------------------------- #
class TestTheWritePathAndTheReadPathDisagree(Store):
    """This is WHY the invariant has to exist, and it is asserted rather than
    described: with two copies present, the tool has no single answer to "where
    is this item"."""

    def test_find_item_path_reads_active_while_load_all_items_reads_done(self):
        iid = "DEF-X"
        self.write_item(iid, STALE_LOG, sub="active")
        self.write_item(iid, RESOLVED_LOG, sub="done")
        self.render_own_derived(self.path_of(iid, "active"))
        self.render_own_derived(self.path_of(iid, "done"))

        write_path, sub = wi.find_item_path(self.project, iid)
        self.assertEqual(sub, "active", "every writer resolves via find_item_path")
        items, dups = wi.load_all_items(self.project)
        self.assertEqual(items[iid].subdir, "done",
                         "every derived view resolves via load_all_items")
        self.assertNotEqual(write_path, items[iid].path)
        # and the state each half would report differs, which is the whole hazard
        self.assertEqual(wi.fold_state(self.graphs, "defect",
                                       wi.load_item(write_path).events), "validating")
        self.assertEqual(wi.fold_state(self.graphs, "defect", items[iid].events),
                         "resolved")
        self.assertIn(iid, dups)
        self.assertEqual(len(dups[iid]), 2)

    def test_wi_project_DESTROYS_the_other_copy_and_must_not(self):
        """The blind spot is WORSE than picking one, and this is measured rather
        than argued. `_maybe_relocate` resolves the file through
        `find_item_path` — the ACTIVE copy — sees a terminal state, and
        `os.replace`s it onto `items/done/<ID>.md`. The STALE copy silently
        OVERWRITES the resolved one, and the `validated` event that only the
        `done/` copy carried is gone from the working tree with no message.

        So the relocation must REFUSE when the destination already exists, and
        say so: an id that resolves to two files is not a rename to complete."""
        iid = "DEF-P"
        self.write_item(iid, STALE_LOG, sub="active")
        self.write_item(iid, RESOLVED_LOG, sub="done")
        self.render_own_derived(self.path_of(iid, "active"))
        self.render_own_derived(self.path_of(iid, "done"))
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            wi.cmd_project(argparse.Namespace(project=self.project))
        said = out.getvalue() + err.getvalue()

        survived = wi.load_item(self.path_of(iid, "done"))
        self.assertIn("validated", [e["event"] for e in survived.events],
                      "wi-project overwrote the resolved copy with the stale one "
                      "— the terminal event is GONE from the working tree")
        self.assertTrue(os.path.exists(self.path_of(iid, "active")),
                        "the other copy was consumed by a relocation that was "
                        "never a rename")
        self.assertIn(iid, said)
        self.assertIn(f"items/active/{iid}.md", said)
        self.assertIn(f"items/done/{iid}.md", said)


# --------------------------------------------------------------------------- #
# Limb 4 — cannot-establish is never a pass, and I11 enters the summary with a
# verdict (the DEF-ROC-238 composition, so a name with no verdict is unsayable)
# --------------------------------------------------------------------------- #
class TestTheVerdictIsComposedNotWritten(Store):

    def test_a_clean_store_names_I11_among_the_invariants_that_hold(self):
        self.write_item("DEF-C", RESOLVED_LOG, sub="done")
        self.git_init()
        self.git_commit_all()
        code, out, _err = self.validate_output()
        self.assertEqual(code, 0, out)
        self.assertIn("clean", out)
        self.assertIn("I11", out)

    def test_with_no_git_repo_I11s_HEAD_side_is_NOT_ESTABLISHED(self):
        """§17i — an unaskable question is never a pass. No repo means the
        durable record cannot be read, which is exactly the record the real
        instance was wrong in."""
        self.write_item("DEF-N", RESOLVED_LOG, sub="done")     # no git init
        code, out, _err = self.validate_output()
        self.assertEqual(code, 0, "an unestablished invariant is not a plain fail")
        self.assertIn("NOT CLEAN", out)
        self.assertIn("I11", out)
        self.assertIn("NOT ESTABLISHED", out.upper())

    def test_I11_is_never_named_among_the_holders_while_it_is_unknown(self):
        held = wi.validate_summary("P", i9_unknown=False, unstamped=0,
                                   i11_unknown="git is unavailable")
        head = held.split("NOT CLEAN")[-1]
        self.assertNotIn("I11 +", head.split("all hold")[0])
        self.assertIn("I11", held)

    def test_the_summary_cannot_name_an_invariant_without_a_verdict(self):
        """DEF-ROC-238's mechanism, re-asserted for the invariant added here: the
        sentence is composed from (name, verdict, clause) triples, so I11 could
        not be appended to a list of bare names."""
        verdicts = wi._invariant_verdicts(i9_unknown=False, unstamped=0,
                                          i11_unknown=None)
        names = [n for n, _v, _c in verdicts]
        self.assertIn("I11", names)
        for entry in verdicts:
            self.assertEqual(len(entry), 3, entry)


# --------------------------------------------------------------------------- #
# Limb 5 — I11 may only report over the population it could READ [DEF-ROC-290]
# --------------------------------------------------------------------------- #
class TestAnUnreadableCommittedBlobWithholdsI11(Store):
    """The fail-open this module's own tester found while PASSING DEF-ROC-268."""

    GARBAGE = "this is not an item file: no frontmatter fence at all\n"

    def _the_store_that_printed_I11_ALL_HOLD(self, iid="DEF-D"):
        """HEAD carries TWO copies of one id and the `active/` one is GARBAGE.

        Built the way the real instance was built — the item is committed while
        live, resolved through the real writer (which relocates it), and only the
        `done/` half of the rename is declared — and then the committed
        `active/` blob is replaced with something `_head_item_logs` cannot parse.
        That blob's id never reaches the population, so the duplication is
        invisible to anything that reads the population alone.
        """
        self.write_item(iid, STALE_LOG, sub="active")
        self.git_init()
        self.git_commit_all("the item while it was live")
        with contextlib.redirect_stdout(io.StringIO()), \
                contextlib.redirect_stderr(io.StringIO()):
            wi.cmd_append(argparse.Namespace(
                project=self.project, id=iid, event="validated", agent="tester",
                ref=None, note=None, ts=VALIDATED["ts"], tokens=None,
                duration_ms=None))
        self._git("reset", "-q")
        self.git_commit_paths("declare only the done/ half of the rename",
                              f"items/done/{iid}.md")
        with open(self.path_of(iid, "active"), "w", encoding="utf-8") as f:
            f.write(self.GARBAGE)
        self.git_commit_paths("the committed active/ copy is now unparseable",
                              f"items/active/{iid}.md")
        os.remove(self.path_of(iid, "active"))   # the working tree holds ONE
        return iid

    def test_the_fixture_really_is_the_store_that_manufactured_the_pass(self):
        """NON-VACUITY, and it is the whole mechanism: HEAD holds two paths for
        one id, the blob will not parse, and the POPULATION therefore holds one
        copy — so `len(copies) < 2` is true of a genuine duplication."""
        iid = self._the_store_that_printed_I11_ALL_HOLD()
        committed = self._git("ls-tree", "-r", "--name-only", "HEAD", "items/").stdout
        self.assertIn(f"items/active/{iid}.md", committed)
        self.assertIn(f"items/done/{iid}.md", committed)
        unreadable = []
        head = wi._head_item_logs(self.project, unreadable=unreadable)
        self.assertEqual(len(head.get(iid, [])), 1,
                         "the fixture's blob parsed after all")
        self.assertEqual([pth for pth, _why in unreadable],
                         [f"items/active/{iid}.md"])

    def test_I11_is_NOT_ESTABLISHED_and_names_the_blob_it_could_not_read(self):
        iid = self._the_store_that_printed_I11_ALL_HOLD()
        unknown = [f for f in wi.compute_duplicate_identity(self.project)
                   if f["severity"] == "unknown"]
        self.assertTrue(unknown, "I11 reported over a population it could not "
                                 "read and said nothing about the shortfall")
        msg = " ".join(f["message"] for f in unknown)
        self.assertIn("NOT ESTABLISHED", msg)
        self.assertIn(f"items/active/{iid}.md", msg,
                      "the message does not say WHICH blob it could not read")

    def test_an_unreadable_blob_WITHHOLDS_and_never_ACCUSES(self):
        """§17i. An unparseable blob is an UNKNOWN, not a duplicate: it must not
        become a violation, and it must not fail the gate."""
        self._the_store_that_printed_I11_ALL_HOLD()
        self.assertEqual(
            [f for f in wi.compute_duplicate_identity(self.project)
             if f["severity"] == "block"], [])
        self.assertEqual([x for x in self.validate() if "I11" in x], [])
        code, _out, _err = self.validate_output()
        self.assertEqual(code, 0, "withholding a claim is not a plain fail")

    def test_the_summary_does_NOT_name_I11_among_the_HOLDERS(self):
        """The measured symptom, read as a list rather than a substring: the
        tester's run printed `… + I11 all hold` over two copies of one id."""
        self._the_store_that_printed_I11_ALL_HOLD()
        code, out, _err = self.validate_output()
        self.assertEqual(code, 0)
        self.assertIn("NOT CLEAN", out)
        self.assertNotIn("I11", self.holders(out),
                         f"I11 named itself among the holders: {out}")
        self.assertIn("I11", out, "and its verdict is still stated")

    def test_a_clean_fully_readable_store_STILL_names_I11_among_the_holders(self):
        """BOTH DIRECTIONS (§F9f). An invariant that never claims to hold is as
        useless as one that always does — which is why this sits next to the
        test above and reads the same list."""
        self.write_item("DEF-OK", RESOLVED_LOG, sub="done")
        self.git_init()
        self.git_commit_all()
        code, out, _err = self.validate_output()
        self.assertEqual(code, 0, out)
        self.assertIn("clean", out)
        self.assertIn("I11", self.holders(out), out)

    def test_what_WAS_established_is_still_reported_alongside_the_unknown(self):
        """Partial coverage, the I9 rule applied to I11: an unreadable blob must
        not swallow a duplication the run DID see."""
        iid = self._the_store_that_printed_I11_ALL_HOLD()
        other = "DEF-E"
        self.write_item(other, STALE_LOG, sub="active")
        self.write_item(other, RESOLVED_LOG, sub="done")
        self.render_own_derived(self.path_of(other, "active"))
        self.render_own_derived(self.path_of(other, "done"))
        self.git_commit_paths("a second id committed at BOTH paths",
                             f"items/active/{other}.md", f"items/done/{other}.md")
        findings = wi.compute_duplicate_identity(self.project)
        in_head = [f for f in findings if f["severity"] == "block"
                   and f.get("where") == "in HEAD" and f.get("id") == other]
        self.assertTrue(in_head, f"the established duplication was lost: {findings}")
        self.assertTrue([f for f in findings if f["severity"] == "unknown"])
        self.assertNotIn(iid, " ".join(f["message"] for f in in_head))

    def test_I11_WITHHOLDS_ON_ITS_OWN_WITH_I9_SILENCED(self):
        """I11's verdict must come from I11's OWN list, never from I9's.

        THE REASON THIS IS PINNED SEPARATELY [DEF-ROC-290, tester]: the defect
        was reported as "not currently exploitable", because I9 carries the same
        unreadable list and the run still read NOT CLEAN. That is a property of
        a SIBLING invariant, not of this one, and it is exactly the kind of
        accidental cover that makes a fail-open look harmless until the sibling
        changes. So the only honest check is to take the cover away: silence I9
        entirely and ask whether I11 still refuses to claim it holds.

        Measured both ways by the tester before this landed — against the
        pre-fix build the same store reads
        `clean - I1-I4 + I6 + I7 + I8 + I10 + I11 all hold`, which is the
        founding symptom with I9's honesty removed.
        """
        self._the_store_that_printed_I11_ALL_HOLD()
        orig = wi.compute_event_loss
        wi.compute_event_loss = lambda *a, **k: []       # I9 reads CLEAN
        try:
            code, out, _err = self.validate_output()
        finally:
            wi.compute_event_loss = orig
        self.assertIn("I9 holds", out, "the fixture did not silence I9")
        self.assertIn("NOT CLEAN", out,
                      f"I11 failed to withhold with I9 silenced — its verdict "
                      f"was riding on a sibling invariant:\n{out}")
        self.assertIn("NOT ESTABLISHED", out)
        self.assertNotIn("I11", self.holders(out),
                         f"I11 named among the HOLDERS with I9 silenced: {out}")
        self.assertEqual(code, 0, "an unknown is never a plain FAIL (§17i)")


class TestTheLoopGateAsksThisBeforeEveryPull(Store):
    """DEF-ROC-165's lesson, applied to the invariant added here: a guard nothing
    invokes automatically is the same failure in a costume. The real instance
    survived a whole session of `wi-validate` runs, and the moment the answer
    matters is the PULL — the writer and the derived Ready view resolve to
    different copies."""

    def test_compute_loop_gate_invokes_the_duplicate_check(self):
        src = io.open(os.path.join(HERE, "work-items.py"), encoding="utf-8").read()
        body = src.split("def compute_loop_gate(", 1)[1].split("\ndef ", 1)[0]
        self.assertIn("compute_duplicate_identity(", body,
                      "the duplicate-identity check is invoked by nothing that "
                      "runs automatically")

    def test_the_gate_reports_a_duplicate_as_a_finding(self):
        iid = "DEF-G"
        self.write_item(iid, STALE_LOG, sub="active")
        self.write_item(iid, RESOLVED_LOG, sub="done")
        self.render_own_derived(self.path_of(iid, "active"))
        self.render_own_derived(self.path_of(iid, "done"))
        findings = [f for f in wi.compute_duplicate_identity(self.project)
                    if f["severity"] == "block"]
        self.assertTrue(findings)
        self.assertEqual(findings[0]["ids"], [iid],
                         "loop-gate findings are keyed by `ids`")


if __name__ == "__main__":
    unittest.main()
