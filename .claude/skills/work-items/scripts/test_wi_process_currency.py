#!/usr/bin/env python3
"""§19e / EXP-OAG-008 — THE PROCESS-CURRENCY LIMB, DRIVEN AGAINST REAL GIT.

WHY REAL GIT AND NOT A MOCK. This limb exists because an instance sat 14 process
versions behind `main`, rebuilt a control that already existed upstream, and
NOTHING SAID SO. A mocked `git` would let the test agree with my model of git
rather than with git — and "the model was right, the tool was not" is the exact
shape that produced the fault. Every case below builds a throwaway repository,
puts it in a real state, and reads what the real function returns.

AND THE VACUITY TRAP IS THE POINT OF THIS FILE. The row that registered this
change (EXP-OAG-008) names its own first failure mode: *"a limb that reports 'N
commits behind' and always passes is a control that cannot come back negative —
this project's dominant failure family. Scoring MUST confirm it BLOCKED at least
once, not merely that it printed."* On the live tree today the limb is SILENT and
correct (we folded forward an hour ago), so a live run proves nothing. These
cases are the only place it is ever seen to speak.
"""
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import importlib.util
spec = importlib.util.spec_from_file_location("wi", os.path.join(HERE, "work-items.py"))
wi = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wi)


def git(repo, *args):
    subprocess.run(["git", "-C", repo] + list(args), check=True,
                   capture_output=True, text=True)


def write(repo, path, text):
    full = os.path.join(repo, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w") as fh:
        fh.write(text)


class ProcessCurrencyLimb(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="wi-currency-")
        self.repo = os.path.join(self.tmp, "r")
        os.makedirs(self.repo)
        git(self.repo, "init", "-q", "-b", "main")
        git(self.repo, "config", "user.email", "t@t")
        git(self.repo, "config", "user.name", "t")
        write(self.repo, "README.md", "base\n")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-qm", "base")
        git(self.repo, "checkout", "-q", "-b", "instance/x")
        self._root = wi.ROOT
        wi.ROOT = self.repo

    def tearDown(self):
        wi.ROOT = self._root

    def advance_main(self, path, text, msg):
        git(self.repo, "checkout", "-q", "main")
        write(self.repo, path, text)
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-qm", msg)
        git(self.repo, "checkout", "-q", "instance/x")

    # -- the SILENT cases: a limb must not cry wolf, or it gets waived ---------

    def test_up_to_date_instance_produces_NO_finding(self):
        self.assertEqual(wi.compute_process_currency(), [])

    def test_ON_trunk_produces_no_finding(self):
        # The integration tree IS the base. Reporting it as behind itself would be
        # noise on every single run in the one tree that can never be stale.
        git(self.repo, "checkout", "-q", "main")
        self.assertEqual(wi.compute_process_currency(), [])

    def test_instance_AHEAD_of_trunk_is_not_behind_it(self):
        # Local commits are not staleness. Confusing "diverged" with "behind" would
        # fire on every instance that has done any work, which is all of them.
        write(self.repo, "local.md", "mine\n")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-qm", "local work")
        self.assertEqual(wi.compute_process_currency(), [])

    # -- the SPEAKING cases: this is what the row demands be demonstrated ------

    def test_behind_on_NON_process_files_is_ADVISORY_not_a_block(self):
        # Ordinary drift. Blocking here is how a gate teaches people to waive it.
        self.advance_main("work/notes.md", "x\n", "project output")
        f = wi.compute_process_currency()
        self.assertEqual(len(f), 1)
        self.assertEqual(f[0]["severity"], "advisory")
        self.assertIn("project-update", f[0]["message"])

    def test_behind_on_THE_PROCESS_LAYER_BLOCKS(self):
        # THE CASE THAT COST A SESSION. Not advisory: the rules you are about to
        # work under have changed and you cannot know it.
        self.advance_main("process/process-current.md",
                          "# Current Process\n\n## F11. exit gate\n", "process(v160)")
        f = wi.compute_process_currency()
        self.assertEqual(len(f), 1)
        self.assertEqual(f[0]["severity"], "block")

    def test_the_block_NAMES_THE_CHANGED_SECTIONS_not_just_a_count(self):
        # THE WHOLE DESIGN. "14 commits behind" is a number people scroll past;
        # "§F11 changed and you are about to write a coupling gate" is a fact that
        # stops them. If this assertion is ever relaxed to a count, the limb has
        # become the decoration it was built to replace.
        self.advance_main("process/process-current.md",
                          "# Current Process\n\n## F11. exit gate\n\n## 19d. artefact\n",
                          "process(v170)")
        msg = wi.compute_process_currency()[0]["message"]
        self.assertIn("§F11", msg)
        self.assertIn("§19d", msg)

    def test_an_agent_definition_counts_as_the_process_layer(self):
        # engineer.md is where the rules are actually READ. A currency check that
        # watched only process-current.md would have been silent on the very merge
        # that exposed this fault — the conflict was in engineer.md.
        self.advance_main(".claude/agents/engineer.md", "gate\n", "engineer")
        self.assertEqual(wi.compute_process_currency()[0]["severity"], "block")

    def test_CANNOT_ESTABLISH_is_UNKNOWN_and_never_silently_current(self):
        # No such trunk. "I could not tell" must never round to "you are current" —
        # that is the direction that hides the fault (DEF-ROC-046's shape), and it is
        # the only outcome here that would let a stale instance run unwarned.
        f = wi.compute_process_currency(trunk="no-such-branch")
        self.assertEqual(len(f), 1)
        self.assertEqual(f[0]["severity"], "unknown")
        self.assertNotEqual(f[0]["severity"], "block")

    def test_section_parsing_DEGRADES_to_the_file_list_rather_than_failing(self):
        # A currency check that breaks on an unexpected heading is a currency check
        # somebody deletes. With no parseable headings it must still BLOCK and still
        # say something useful.
        self.advance_main("process/process-current.md", "no headings here at all\n", "p")
        f = wi.compute_process_currency()
        self.assertEqual(f[0]["severity"], "block")
        self.assertIn("process/process-current.md", f[0]["message"])


if __name__ == "__main__":
    unittest.main()
