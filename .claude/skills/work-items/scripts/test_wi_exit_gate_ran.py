#!/usr/bin/env python3
"""loop-gate check 20 — DID THE ENGINEERING EXIT GATE SPEAK? (OI-ROC-025).

WHAT THIS IS ABOUT. §F11.4 clause 1's subject is that a gate must prove it SPOKE:
non-execution is not a pass. `exit-gate-ran` is the thing that proves it, and
DEF-ROC-171 wired it to exactly ONE caller — `scripts/pre-push-gate.sh`, a git
hook that DEF-ROC-191 then measured as UNINSTALLED (`core.hooksPath` unset). So
the control that proves the gate spoke was reachable only through a control
nobody is required to run. DEF-ROC-153 was three consecutive ungated pushes,
found by a human reading a run list.

The remaining caller is the loop gate, which is the only continuously-running
workflow in this system — and it lives in the PARENT repository, a different
lane from DEF-ROC-171's project-repo item. That gap was recorded in a
`_not_covered_here` string in `work/ROC/scripts/guard-coverage.json` and two
prose cross-references, none of which is a work item and none of which anything
will ever pull. OI-ROC-025 is that gap made ownable, and this module is its
executable half.

WHY IT IS A DECLARATION AND NOT A HARDCODED `make` CALL. OI-ROC-025 forbids two
shapes explicitly: the loop gate must not bind to one project's Makefile targets
(a parent control acquiring a project dependency it cannot satisfy for the next
project), and the logic must not be duplicated in the parent (EXP-047 — two
readers of one fact). So the parent runs a command the PROJECT DECLARES in
`.claude/config/exit-gate-ran/<project>.json` and reads a documented five-value
`status` contract. There is ONE implementation of the question (the project's);
the parent is a second CALLER of it, which is the distinction EXP-047 turns on.

THE THREE-VALUED DECLARATION, and why absence is not silence. A project with no
declaration is NOT read as "this project has no exit gate" — the parent cannot
tell that from "somebody forgot". It is reported NOT ESTABLISHED (never blocking, never
an error), and cleared by committing EITHER a probe OR an explicit
`{"gate": "none", "reason": …}`. Silence would be the absence-read-as-a-pass
family this project logs more than any other; a block would wedge every project
that legitimately has no such gate.

AC-025-3 — THE `NONEXEC` DISTINCTION SURVIVES THE MOVE. Only the gate NOT
SPEAKING blocks. A gate that spoke and said NO is a different subject, already
owned by `make exit-gate` on the commit in hand, and blocking every agent in a
shared tree on somebody else's regression is not what §F11.4 is about. That is
asserted in both directions below, and it is decided HERE in the parent (by the
severity map) rather than by passing the project's `NONEXEC=1` flag through —
the property has to be testable where it is claimed.
"""
import os
import json
import shutil
import tempfile
import unittest
import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
REAL_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))

_spec = importlib.util.spec_from_file_location(
    "work_items_egr", os.path.join(HERE, "work-items.py"))
wi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(wi)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="wi-exit-gate-ran-")
        self._orig_root = wi.ROOT
        wi.ROOT = self.tmp
        os.makedirs(os.path.join(self.tmp, ".claude", "config", "exit-gate-ran"))

    def tearDown(self):
        wi.ROOT = self._orig_root
        shutil.rmtree(self.tmp, ignore_errors=True)

    def declare(self, cfg, project="ROC"):
        p = os.path.join(self.tmp, ".claude", "config", "exit-gate-ran",
                         "%s.json" % project)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(cfg, f)
        return p

    def probe(self, payload, exit_code=0, stdout=None):
        """A stand-in for the project's own `exit-gate-ran`, which LOGS ITS ARGV so
        'the gate actually invoked it' is provable, exactly as check 16's tests do."""
        sh = os.path.join(self.tmp, "fake-probe.sh")
        log = os.path.join(self.tmp, "argv.json")
        body = stdout if stdout is not None else json.dumps(payload)
        with open(sh, "w", encoding="utf-8") as f:
            f.write("#!/bin/sh\n")
            f.write("printf '%s' \"$*\" > " + json.dumps(log) + "\n")
            f.write("cat <<'EOF_PAYLOAD'\n%s\nEOF_PAYLOAD\n" % body)
            f.write("exit %d\n" % exit_code)
        os.chmod(sh, 0o755)
        self.argv_log = log
        return [sh]

    def argv(self):
        with open(self.argv_log, encoding="utf-8") as f:
            return f.read()

    def one(self, findings):
        self.assertEqual(len(findings), 1, findings)
        self.assertEqual(findings[0]["check"], "exit-gate-ran")
        return findings[0]


class VerdictMapping(Base):
    """The five documented statuses, each mapped deliberately."""

    def test_pass_says_nothing(self):
        self.declare({"command": self.probe({"status": "PASS", "head": "abc123"})})
        self.assertEqual(wi.compute_exit_gate_ran("ROC"), [],
                         "a gate that spoke and passed is the ordinary case; a limb "
                         "that printed a line for it would be ignored within a week")

    def test_no_verdict_BLOCKS(self):
        self.declare({"command": self.probe({
            "status": "NO-VERDICT", "head": "b53ba12c",
            "detail": "no run exists for b53ba12c past the grace period"})})
        f = self.one(wi.compute_exit_gate_ran("ROC"))
        self.assertEqual(f["severity"], "block")
        self.assertEqual(f["verdict"], "NO-VERDICT")
        self.assertIn("did not speak", f["message"].lower())
        self.assertIn("b53ba12c", f["message"])
        self.assertIn("no run exists", f["message"])

    def test_fail_is_ADVISORY_not_a_block(self):
        """AC-025-3, the half that is easy to lose when moving the caller."""
        self.declare({"command": self.probe({
            "status": "FAIL", "head": "689ee88", "runId": 33261021005,
            "detail": "run 33261021005 concluded failure"})})
        f = self.one(wi.compute_exit_gate_ran("ROC"))
        self.assertEqual(f["severity"], "advisory")
        self.assertEqual(f["verdict"], "FAIL")
        self.assertIn("SPOKE", f["message"])
        self.assertIn("689ee88", f["message"])
        self.assertNotIn("%%", f["message"],
                         "rendered straight to a terminal, not through a %-format — "
                         "a doubled sign is a typo the live run showed (`false 0%%`)")

    def test_pending_is_not_established(self):
        self.declare({"command": self.probe({
            "status": "PENDING", "head": "b53ba12c", "runStatus": "in_progress"})})
        f = self.one(wi.compute_exit_gate_ran("ROC"))
        self.assertEqual(f["severity"], "unknown")
        self.assertIn("NOT ESTABLISHED", f["message"])

    def test_cannot_determine_is_not_established(self):
        self.declare({"command": self.probe({
            "status": "CANNOT-DETERMINE",
            "detail": "I could not see that far back"})})
        f = self.one(wi.compute_exit_gate_ran("ROC"))
        self.assertEqual(f["severity"], "unknown")
        self.assertIn("NOT ESTABLISHED", f["message"])
        self.assertIn("could not see that far back", f["message"])

    def test_exit_code_is_not_the_verdict(self):
        """The project's probe exits 1 on FAIL and on NO-VERDICT alike. Reading the
        exit code would collapse the two subjects AC-025-3 keeps apart, so the
        STATUS is the verdict and the exit code is not consulted."""
        self.declare({"command": self.probe({"status": "FAIL", "head": "d"},
                                            exit_code=1)})
        self.assertEqual(self.one(wi.compute_exit_gate_ran("ROC"))["severity"],
                         "advisory")

    def test_unknown_status_word_is_not_established(self):
        self.declare({"command": self.probe({"status": "FINE"})})
        f = self.one(wi.compute_exit_gate_ran("ROC"))
        self.assertEqual(f["severity"], "unknown")
        self.assertIn("FINE", f["message"])


class Declaration(Base):
    """Three-valued: a probe, an explicit none-with-reason, or undeclared."""

    def test_undeclared_is_not_established_never_a_block_and_never_an_error(self):
        """NOT ESTABLISHED (`?`), not ADVISORY (`!`): an undeclared project is
        literally a thing this run failed to establish, and it is the bucket checks
        15 and 16 already use for an unconfigured project. It also keeps the limb
        out of the advisory COUNT, which several existing gate tests assert on —
        a new limb must not perturb what the old ones measure."""
        f = self.one(wi.compute_exit_gate_ran("SomeOtherProject"))
        self.assertEqual(f["severity"], "unknown")
        self.assertEqual(f["verdict"], "UNDECLARED")
        self.assertIn("SomeOtherProject", f["message"])
        self.assertIn("gate", f["message"])

    def test_declared_absent_with_a_reason_is_silent(self):
        self.declare({"gate": "none",
                      "reason": "no CI exit gate exists for this project yet"})
        self.assertEqual(wi.compute_exit_gate_ran("ROC"), [],
                         "an explicit, reasoned declaration IS the decision; "
                         "re-reporting it every cycle would punish declaring")

    def test_declared_absent_without_a_reason_is_not_a_decision(self):
        self.declare({"gate": "none"})
        f = self.one(wi.compute_exit_gate_ran("ROC"))
        self.assertEqual(f["severity"], "unknown")
        self.assertEqual(f["verdict"], "UNDECLARED")
        self.assertIn("reason", f["message"])

    def test_config_without_a_command_is_not_established(self):
        self.declare({"timeoutMs": 1000})
        f = self.one(wi.compute_exit_gate_ran("ROC"))
        self.assertEqual(f["severity"], "unknown")
        self.assertIn("command", f["message"])

    def test_unparseable_config_is_not_established(self):
        p = os.path.join(self.tmp, ".claude", "config", "exit-gate-ran", "ROC.json")
        with open(p, "w", encoding="utf-8") as f:
            f.write("{not json")
        f = self.one(wi.compute_exit_gate_ran("ROC"))
        self.assertEqual(f["severity"], "unknown")


class Unrunnable(Base):
    """§17i — an answer we could not establish is never a pass, and never an alarm."""

    def test_missing_command_is_not_established(self):
        self.declare({"command": [os.path.join(self.tmp, "does-not-exist")]})
        f = self.one(wi.compute_exit_gate_ran("ROC"))
        self.assertEqual(f["severity"], "unknown")
        self.assertIn("NOT ESTABLISHED", f["message"])

    def test_non_json_output_is_not_established(self):
        self.declare({"command": self.probe(None, stdout="make: *** no rule")})
        f = self.one(wi.compute_exit_gate_ran("ROC"))
        self.assertEqual(f["severity"], "unknown")
        self.assertIn("no rule", f["message"])

    def test_timeout_is_not_established(self):
        sh = os.path.join(self.tmp, "slow.sh")
        with open(sh, "w", encoding="utf-8") as f:
            f.write("#!/bin/sh\nsleep 5\n")
        os.chmod(sh, 0o755)
        self.declare({"command": [sh], "timeoutMs": 200})
        f = self.one(wi.compute_exit_gate_ran("ROC"))
        self.assertEqual(f["severity"], "unknown")
        self.assertIn("timeout", f["message"].lower())


class AskingAboutOneCommit(Base):
    """`--sha` is how the check is PROVEN TO FIRE (§F9f/§17c.2) — a limb only ever
    observed printing nothing proves nothing."""

    def test_sha_is_passed_through_the_declared_argument(self):
        self.declare({"command": self.probe({"status": "PASS"}),
                      "shaArg": "SHA={sha}"})
        wi.compute_exit_gate_ran("ROC", sha="689ee88")
        self.assertIn("SHA=689ee88", self.argv())

    def test_no_sha_means_trunk_head_and_no_extra_argument(self):
        self.declare({"command": self.probe({"status": "PASS"}),
                      "shaArg": "SHA={sha}"})
        wi.compute_exit_gate_ran("ROC")
        self.assertNotIn("SHA=", self.argv())

    def test_a_sha_the_declaration_cannot_carry_is_not_established(self):
        """Silently answering about trunk head when the caller asked about a
        specific commit would be a wrong answer wearing a right one's clothes."""
        self.declare({"command": self.probe({"status": "PASS"})})
        f = self.one(wi.compute_exit_gate_ran("ROC", sha="689ee88"))
        self.assertEqual(f["severity"], "unknown")
        self.assertIn("shaArg", f["message"])


class WiredIntoTheLoop(Base):
    """A guard nobody invokes is not a control (DEF-ROC-165) — which is the whole
    reason OI-ROC-025 exists. Assert the limb is IN the gate, not merely written."""

    def test_compute_loop_gate_calls_it(self):
        with open(os.path.join(HERE, "work-items.py"), encoding="utf-8") as f:
            src = f.read()
        body = src[src.index("def compute_loop_gate("):
                   src.index("\ndef ", src.index("def compute_loop_gate(") + 10)]
        self.assertIn("compute_exit_gate_ran(project)", body,
                      "the limb must be invoked by compute_loop_gate itself; a "
                      "check that exists and is not wired is DEF-ROC-165 exactly")


class TheCommittedROCDeclaration(unittest.TestCase):
    """The declaration is a claim about the REAL project repo. Checked against it,
    offline — a config agreeing with a fake is the self-consistent pair that stays
    green while nothing works (§ wire-contract provenance)."""

    CFG = os.path.join(REAL_ROOT, ".claude", "config", "exit-gate-ran", "ROC.json")

    def test_roc_is_declared(self):
        self.assertTrue(os.path.exists(self.CFG), self.CFG)

    def test_the_declared_target_exists_in_the_real_project_makefile(self):
        with open(self.CFG, encoding="utf-8") as f:
            cfg = json.load(f)
        cmd = cfg["command"]
        self.assertEqual(cmd[:3], ["make", "-C", "work/ROC"], cmd)
        target = cmd[3]
        with open(os.path.join(REAL_ROOT, "work", "ROC", "Makefile"),
                  encoding="utf-8") as f:
            mk = f.read()
        self.assertIn("\n%s:" % target, mk,
                      "the declaration names a target work/ROC/Makefile does not "
                      "define — the check would report NOT ESTABLISHED forever")
        self.assertIn("{sha}", cfg["shaArg"])


if __name__ == "__main__":
    unittest.main()
