#!/usr/bin/env python3
"""DURABLE PROSE MUST NOT TRANSIT A SHELL UNPROTECTED.

OI-WI-APPEND-NOTE-PATH-MANGLES-CONTENT. Two permanent audit records in this system are
written by every agent as prose on a command line: the work-item event `note:` and the
git commit message. Both are corrupted, silently, by the layers between the caller's
argument and the stored value.

THREE OBSERVED INSTANCES, none of them theoretical:

  1. 2026-08-04, UC-XE1's `validated` note. The tester recorded the regex
     `^oag-aerobus-fanout-[0-9]{12}$`; what is committed reads `...{12}remains` — the
     `$` was expanded away by make (`$ ` is a reference to a variable named " ") and the
     next word closed up. An assertion anchored at end-of-string was recorded as an
     UNANCHORED one: a different claim about the world, with no warning and no diff.
  2. 2026-08-11, an orchestrator git commit message containing a backticked word. zsh
     EXECUTED it — the macOS `open` binary actually ran and the word vanished from the
     committed message. Caught only because the stray program printed usage text. A
     backticked word naming a silent command would have vanished with NO SIGNAL AT ALL.
     Command substitution is strictly worse than truncation because it EXECUTES.
  3. 2026-08-11, while committing OI-BUNDLE-GATE-COVERS-4-OF-12 with a multi-line
     message through `make commit-isolated MSG="$(cat msg.txt)"`:
     `/bin/sh: -c: line 0: unexpected EOF while looking for matching '"'`. The commit
     was REFUSED. Same class, and the only instance that was loud.

WHY THE ROUTE IS THE THING UNDER TEST, NOT THE FUNCTION (AC-WN.2). The storage layer
already round-trips `$`, commas and backticks correctly — verified directly against
`_render_event`/`_parse_inline_map`. Every one of the three instances happened in
TRANSPORT: make's variable expansion, then a shell double-quoted string. So a test that
calls the Python API proves nothing about the layer that did the corrupting; these drive
the REAL `make` targets as a subprocess.

WHAT THE FIX HAS TO BE, given the platform. macOS ships GNU Make 3.81, which has no
`$(file ...)` function, so there is NO way to move prose from a make variable into a
child process without it crossing a shell command line. `$(value NOTE)` defeats make's
own expansion but the shell still eats `$` and still executes backticks. Therefore:

  * the SAFE route is a FILE — the caller writes the prose to a file and passes its
    PATH, which contains no metacharacters. This is exactly `git commit -F`, and it is
    the practice that landed a long metacharacter-bearing message intact today after
    instance 3 destroyed the first attempt.
  * the command-line route cannot be made safe, so it FAILS CLOSED: a NOTE/MSG carrying
    a character that a shell would eat or execute is REJECTED with the file route named,
    never silently altered (AC-WN.3). Fail-closed, because a corrupted audit record
    must not be representable.

Residual, stated rather than hidden: if the CALLER's own shell eats the `$` before make
is invoked (an unquoted double-quoted argument), nothing downstream can detect it — the
character never existed as far as this machinery is concerned. That is precisely why the
file route is the documented one rather than an alternative.
"""
import os
import re
import shutil
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
MAKEFILE = os.path.join(ROOT, "Makefile")

# The three hazards named in the item, in one string, plus the quote that refused
# instance 3's commit outright.
HAZARDS = 'regex ^oag-aerobus-fanout-[0-9]{12}$, and `make wi-project` after "quoted"'

ITEM_TEMPLATE = """---
id: {iid}
type: open-item
title: durable-prose transport probe
job: J0
value: 1
cost: 1
parents: []
deps: []
created_ts: "2026-08-11T00:00:00Z"
events:
  - {{ts: "2026-08-11T00:00:00Z", event: open, agent: flow-manager, note: "seed"}}
---

# {iid}
"""


def run_make(target, **variables):
    """Invoke a REAL make target from the real root, as an agent does."""
    argv = ["make", target] + [f"{k}={v}" for k, v in variables.items()]
    return subprocess.run(argv, cwd=ROOT, capture_output=True, text=True)


def stored_note(item_path, index=-1):
    """Read the note back through the REAL parser (the reader agents/views use)."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "work_items_probe", os.path.join(HERE, "work-items.py"))
    wi = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(wi)
    item = wi.load_item(item_path)
    return item.events[index].get("note")


class ScratchProject(unittest.TestCase):
    """A throwaway project under work/ — gitignored, disjoint from every real one."""

    project = "_WI_PROSE_PROBE"

    def setUp(self):
        self.items = os.path.join(ROOT, "work", self.project, "items", "active")
        os.makedirs(self.items, exist_ok=True)
        os.makedirs(os.path.join(ROOT, "work", self.project, "items", "done"), exist_ok=True)
        self.iid = "OI-PROSE"
        self.item = os.path.join(self.items, f"{self.iid}.md")
        with open(self.item, "w", encoding="utf-8") as f:
            f.write(ITEM_TEMPLATE.format(iid=self.iid))
        self.tmp = tempfile.mkdtemp(prefix="wi-prose-")

    def tearDown(self):
        shutil.rmtree(os.path.join(ROOT, "work", self.project), ignore_errors=True)
        shutil.rmtree(self.tmp, ignore_errors=True)


class TestNoteRoundTrip(ScratchProject):

    def test_ac_wn_1_note_file_round_trips_byte_identically(self):
        """AC-WN.1 / AC-WN.4 — `$`, a comma, a backtick and a quote survive the REAL
        `make wi-append` route byte-for-byte. The comma limb retires the comma-free
        convention: agents may write English again."""
        note_file = os.path.join(self.tmp, "note.txt")
        with open(note_file, "w", encoding="utf-8") as f:
            f.write(HAZARDS)
        r = run_make("wi-append", PROJECT=self.project, ID=self.iid,
                     EVENT="amended", AGENT="orchestrator", NOTE_FILE=note_file)
        self.assertEqual(r.returncode, 0, f"{r.stdout}\n{r.stderr}")
        self.assertEqual(stored_note(self.item), HAZARDS)

    def test_ac_wn_5_command_substitution_never_executes(self):
        """AC-WN.5 — the widened class. A backticked command in durable prose must be
        STORED, never RUN. Instance 2 ran `open`; this asserts the shell never sees it,
        by giving it a command whose execution leaves physical evidence."""
        sentinel = os.path.join(self.tmp, "EXECUTED")
        note = f"before `touch {sentinel}` after"
        note_file = os.path.join(self.tmp, "note.txt")
        with open(note_file, "w", encoding="utf-8") as f:
            f.write(note)
        r = run_make("wi-append", PROJECT=self.project, ID=self.iid,
                     EVENT="amended", AGENT="orchestrator", NOTE_FILE=note_file)
        self.assertEqual(r.returncode, 0, f"{r.stdout}\n{r.stderr}")
        self.assertFalse(
            os.path.exists(sentinel),
            "COMMAND SUBSTITUTION EXECUTED: a backticked command inside a durable "
            "audit note ran as a shell command. This is instance 2's mechanism.")
        self.assertEqual(stored_note(self.item), note)

    def test_ac_wn_3_a_hazardous_NOTE_on_the_command_line_is_rejected(self):
        """AC-WN.3 — fail closed. The command-line route cannot be made safe on GNU
        Make 3.81, so a NOTE carrying a shell-active character is REFUSED with the file
        route named — never silently stored in altered form."""
        r = run_make("wi-append", PROJECT=self.project, ID=self.iid,
                     EVENT="amended", AGENT="orchestrator",
                     NOTE="anchored at [0-9]{12}$ end")
        self.assertNotEqual(r.returncode, 0,
                            "a hazardous NOTE= was ACCEPTED; the audit record is "
                            "corruptible without warning")
        combined = r.stdout + r.stderr
        self.assertIn("NOTE_FILE", combined,
                      "the rejection must name the safe route, or the caller can only "
                      "guess: " + combined)
        # and nothing was written
        self.assertEqual(stored_note(self.item), "seed")

    def test_ac_wn_3_an_embedded_newline_is_rejected_not_truncated(self):
        """AC-WN.3, storage limb. A newline in a note SILENTLY TRUNCATES: the inline-map
        event is one line, so `'newline\\nhere'` was stored and re-read as `'newlin'` —
        losing the tail AND the last character before it. A third silent mode, alongside
        the `$` and the (already-fixed) comma. Reject at the write."""
        note_file = os.path.join(self.tmp, "note.txt")
        with open(note_file, "w", encoding="utf-8") as f:
            f.write("first line\nsecond line")
        r = run_make("wi-append", PROJECT=self.project, ID=self.iid,
                     EVENT="amended", AGENT="orchestrator", NOTE_FILE=note_file)
        self.assertNotEqual(r.returncode, 0,
                            "a multi-line note was ACCEPTED and will be stored "
                            "truncated at the first newline")
        combined = r.stdout + r.stderr
        self.assertRegex(combined, r"(?i)newline|single line|one line")
        self.assertEqual(stored_note(self.item), "seed")

    def test_ac_wn_1_a_trailing_newline_on_the_file_is_not_content(self):
        """A note file written by any sane tool ends with a newline; that is the file
        format, not part of the prose. One trailing newline is stripped rather than
        rejected, or the safe route would reject almost every file given to it."""
        note_file = os.path.join(self.tmp, "note.txt")
        with open(note_file, "w", encoding="utf-8") as f:
            f.write(HAZARDS + "\n")
        r = run_make("wi-append", PROJECT=self.project, ID=self.iid,
                     EVENT="amended", AGENT="orchestrator", NOTE_FILE=note_file)
        self.assertEqual(r.returncode, 0, f"{r.stdout}\n{r.stderr}")
        self.assertEqual(stored_note(self.item), HAZARDS)


class TestCommitMessageRoundTrip(unittest.TestCase):
    """Instances 2 and 3 — the OTHER durable prose record. `make commit-isolated` passed
    the message as `--message "$(MSG)"`, the identical shape to `--note "$(NOTE)"`."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="wi-commit-")
        self.repo = os.path.join(self.tmp, "repo")
        os.makedirs(self.repo)
        for args in (["init", "-q", "-b", "main"],
                     ["config", "user.email", "prose@test"],
                     ["config", "user.name", "prose"]):
            subprocess.run(["git", "-C", self.repo] + args, check=True,
                           capture_output=True, text=True)
        with open(os.path.join(self.repo, "seed.txt"), "w") as f:
            f.write("seed\n")
        subprocess.run(["git", "-C", self.repo, "add", "seed.txt"], check=True,
                       capture_output=True, text=True)
        subprocess.run(["git", "-C", self.repo, "commit", "-qm", "seed"], check=True,
                       capture_output=True, text=True)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _write(self, name="a.txt", body="one\n"):
        with open(os.path.join(self.repo, name), "w") as f:
            f.write(body)
        return name

    def test_ac_wn_6_a_metacharacter_bearing_message_lands_verbatim(self):
        """AC-WN.6 — a multi-line commit message containing `$`, a backtick, a comma and
        a double quote is committed BYTE-IDENTICALLY. Instance 3 is the case where the
        quote alone refused the commit outright; instance 2 is the case where the
        backtick ran."""
        path = self._write()
        message = ('fix(x): keep $HOME, a `backtick` and a "quote" intact\n'
                   '\n'
                   'A body line with ^anchor$ and, a comma.\n')
        # NOT `msg.txt`: a message-file name with no identity token is now REFUSED,
        # because several agents each choosing `msg.txt` in the shared per-session
        # scratchpad is how a COMMIT MESSAGE CROSSED between two agents on 2026-08-21
        # (e29fb8f0, 49e9f0a8). The name below is what the guard asks for.
        msg_file = os.path.join(self.tmp, "msg-AC-WN6-durable-prose.txt")
        with open(msg_file, "w", encoding="utf-8") as f:
            f.write(message)
        r = run_make("commit-isolated", REPO=self.repo, MSG_FILE=msg_file, PATHS=path)
        self.assertEqual(r.returncode, 0, f"{r.stdout}\n{r.stderr}")
        got = subprocess.run(["git", "-C", self.repo, "log", "-1", "--pretty=%B"],
                             capture_output=True, text=True, check=True).stdout
        self.assertEqual(got.rstrip("\n"), message.rstrip("\n"))

    def test_ac_wn_3_a_hazardous_MSG_on_the_command_line_is_rejected(self):
        """AC-WN.3 for the commit lane. Silent corruption of a commit message is worse
        than a refused commit: the commit is permanent and nobody re-reads it."""
        path = self._write()
        r = run_make("commit-isolated", REPO=self.repo,
                     MSG="fix(x): a `word` and $HOME", PATHS=path)
        self.assertNotEqual(r.returncode, 0,
                            "a hazardous MSG= was ACCEPTED — the backtick would be "
                            "EXECUTED by the shell (instance 2)")
        self.assertIn("MSG_FILE", r.stdout + r.stderr)


class TestGeneralisationSweep(unittest.TestCase):
    """§17g — THE SWEEP LEDGER, AS AN ASSERTION.

    The sweep question: WHERE ELSE DOES DURABLE PROSE TRANSIT A SHELL? A prose answer
    rots silently; an asserted absence is self-cleaning. So the ledger below is executed
    against the real Makefile, and a NEW prose-bearing variable interpolated into a
    recipe fails this test rather than becoming the fourth instance.

    THE LEDGER — every make variable whose value is human prose destined for a permanent
    record, and its disposition:

      NOTE      (wi-append)         FIXED   — NOTE_FILE is the safe route; a hazardous
                                              NOTE= is rejected with it named.
      MSG       (commit-isolated)   FIXED   — MSG_FILE likewise. Instances 2 and 3.
      OBSERVE   (wi-append)         SAFE BY SHAPE — not prose: a validated
                                              `make:<target> [VAR=V]` predicate, parsed
                                              by parse_observe_spec, which rejects
                                              anything else. Cannot carry prose.
      REF/TOKENS/DURATION_MS        SAFE BY SHAPE — sha / integers.
      PROJECT/ID/EVENT/AGENT/PATHS  SAFE BY SHAPE — identifiers and paths, all
                                              validated or path-shaped; not prose.
      NOW/TS                        SAFE BY SHAPE — ISO timestamps.

    NOT SWEPT, and why: a bare `git commit -m "..."` typed directly by an agent into its
    own shell is upstream of every tool here and cannot be defended by this repo's
    machinery — the corruption happens in the agent's shell before any of our code runs.
    The mitigation is the documented practice (write the message to a file, pass -F or
    MSG_FILE), which is why `commit-isolated` now HAS a file route to point at. Stated
    as a known residual, not silently omitted.
    """

    #: make variables that legitimately carry prose into a recipe, each of which MUST
    #: have a `<VAR>_FILE` companion and a hazard rejection.
    PROSE_VARS = {"NOTE": "wi-append", "MSG": "commit-isolated"}

    #: Interpolations that are NOT prose. Declared, so a new one has to be classified.
    NOT_PROSE = {
        "REF", "TOKENS", "DURATION_MS", "OBSERVE", "PROJECT", "ID", "EVENT", "AGENT",
        # PROBE [v145]: a `make:<target> [VAR=VALUE]` spec, not prose. It goes
        # through `parse_observe_spec`, which rejects anything that is not a plain
        # make target plus plain VAR=VALUE overrides — no paths, no quotes, no shell
        # metacharacter of any kind — and the spec is invoked as an argv LIST, never
        # a shell string. Same disposition, and the same reason, as OBSERVE.
        "PROBE",
        "PATHS", "REPO", "NOW", "TS",
        # the file routes themselves: a PATH, which is the whole point — it has no
        # metacharacters, so nothing downstream can eat it.
        "NOTE_FILE", "MSG_FILE",
        # the hazard guards. They expand to `1` or to nothing and NEVER echo the
        # offending character back out — emitting what they found into their own
        # `[ -n "…" ]` string would reproduce the bug inside the check for it.
        "NOTE_HAZARD", "MSG_HAZARD",
        # the two MESSAGE-GUARD escape hatches
        # (OI-CO-OWNED-LEDGER-FILES-CROSS-ATTRIBUTE-WORK-AND-ONE-CROSSED-A-COMMIT-MESSAGE).
        # Boolean opt-outs, not prose: each expands to a fixed literal FLAG NAME
        # (`--allow-duplicate-message` / `--allow-shared-message-file`) or to nothing,
        # and neither ever echoes its own value into a shell string. Same disposition,
        # and the same reason, as NOTE_HAZARD/MSG_HAZARD.
        "MSG_DUP_OK", "MSG_FILE_SHARED_OK",
        # the CO-OWNED-MERGE escape hatch. Same SHAPE and same disposition as the two
        # above: it expands to the fixed literal flag name `--no-coowned-merge` or to
        # nothing, and never echoes its own value into a shell string.
        #
        # Declared here rather than left undeclared because its omission made
        # committed trunk RED (`998e54f` added the variable to `Makefile` without a
        # disposition, and this sweep caught it — working as designed).
        #
        # It is worth saying WHEN it is legitimate, because the sweep's job is to force
        # exactly that reason to be written down. This escape turns OFF the three-way
        # merge, so reaching for it as a reflex reproduces the silent LOSS the merge was
        # built to stop (1-of-4 surviving writers, measured 2026-08-26). It is correct
        # in one shape only: a WHOLE-FILE REPAIR of damage the merge itself caused,
        # where a merge against the same wrong base would re-corrupt the repair. That is
        # not hypothetical — on 2026-08-27 the merge duplicated a 377-line block in
        # `sst.config.ts` twice from base `265bea2c`, three rows in `open-decisions.md`,
        # and two events inside an item file's log (manufacturing an illegal transition
        # and stopping the loop). Every one of those repairs had to run with the merge
        # off. Read `git diff` first, every time; see `DEFECT-OAG-142`.
        "COOWNED_MERGE_OFF",
    }

    def setUp(self):
        with open(MAKEFILE, encoding="utf-8") as f:
            self.mk = f.read()

    def _recipe(self, target):
        m = re.search(r"^%s:.*\n((?:[ \t].*\n|\n)*)" % re.escape(target),
                      self.mk, re.M)
        self.assertIsNotNone(m, f"no `{target}:` target in the Makefile")
        return m.group(1)

    def test_every_prose_var_has_a_file_route(self):
        """A prose variable with no file route has no safe route at all."""
        for var, target in self.PROSE_VARS.items():
            recipe = self._recipe(target)
            self.assertIn(
                f"{var}_FILE", recipe,
                f"`{target}` takes prose in {var}= but offers no {var}_FILE route. On "
                f"GNU Make 3.81 there is no way to move prose off a shell command line "
                f"except a file, so without it the target has no safe form.")

    def test_no_undeclared_prose_bearing_interpolation_in_the_prose_targets(self):
        """The completeness half of the gate (v123 step 3): a NEW variable interpolated
        into one of these recipes must be classified as prose (and get a file route) or
        declared not-prose. A ledger that only catches entries that became false is half
        a gate."""
        for target in sorted(set(self.PROSE_VARS.values())):
            recipe = self._recipe(target)
            used = set(re.findall(r"\$\((?:value )?([A-Z][A-Z0-9_]*)\)", recipe))
            undeclared = used - set(self.PROSE_VARS) - self.NOT_PROSE
            # make-internal and tool-path variables are not caller prose.
            undeclared -= {"MAKE", "CURDIR", "WORKITEMS", "WIPY", "APP", "ROOT"}
            self.assertEqual(
                undeclared, set(),
                f"`{target}` interpolates {sorted(undeclared)} into a shell command "
                f"line with no disposition in this ledger. If it is human prose bound "
                f"for a permanent record it needs a <VAR>_FILE route and a hazard "
                f"rejection; if it is not, declare it in NOT_PROSE and say why.")

    def test_the_ledger_is_not_empty_and_names_the_founding_instances(self):
        """A sweep with no ledger does not satisfy §17g, and an empty ledger is a sweep
        that was not done."""
        self.assertGreaterEqual(len(self.PROSE_VARS), 2)
        self.assertIn("NOTE", self.PROSE_VARS)
        self.assertIn("MSG", self.PROSE_VARS)


if __name__ == "__main__":
    unittest.main()
