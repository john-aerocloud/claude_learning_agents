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


class CarriedInInsideALargerPush(Base):
    """DEF-ROC-221 — `NO-VERDICT` was answering TWO questions with one word.

    The gate runs per PUSH, not per COMMIT. Of a push of eight commits exactly one
    — the push head — ever gets a run; the other seven are as gated as it is while
    having no run of their own. Asked about one of those seven, the probe honestly
    answers NO-VERDICT, and this caller was reading that word as §F11.4's subject,
    THE GATE DID NOT SPEAK, which is the DEF-ROC-153 condition and BLOCKS. Two
    different facts wearing one name, and only the first may block.

    THE FIX IS NOT TO PASS THE CASE (the trap this item sits in). A blanket pass
    would convert a false block into a false green, which is strictly worse and is
    the class this project logs most (§17i / DEF-ROC-083's mirror). A carried commit
    HAS been through a gate run — the run for the push head that carried it — so the
    honest move is to find THAT run and read its verdict, and to keep blocking when
    even that cannot be found.

    The real evidence: 1656e581, e8bf8f11, 12602b88, dd8953fb all rode into origin
    inside one push landing at 3eb8a59f, where the gate ran and PASSED (run
    35039447274); all four were reported NO-VERDICT.
    """

    def repo(self, chain, trunk_ref="refs/remotes/origin/main"):
        """A REAL git repo at <ROOT>/work/ROC with a linear history, returning the
        shas oldest-first. Real git, because the thing under test is an ancestry
        question and a fake ancestry would prove only that this test agrees with
        itself."""
        import subprocess
        repo = os.path.join(self.tmp, "work", "ROC")
        os.makedirs(repo)
        env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t",
                   GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")

        def g(*args):
            return subprocess.run(["git", "-C", repo, *args], check=True, env=env,
                                  capture_output=True, text=True).stdout.strip()
        g("init", "-q", "-b", "main")
        shas = []
        for msg in chain:
            with open(os.path.join(repo, "f.txt"), "a", encoding="utf-8") as fh:
                fh.write(msg + "\n")
            g("add", "-A")
            g("commit", "-q", "-m", msg)
            shas.append(g("rev-parse", "HEAD"))
        g("branch", "-m", "main", "not-trunk")
        if trunk_ref:
            g("update-ref", trunk_ref, "HEAD")
        return shas

    def probe_map(self, by_sha, default=None):
        """A probe that answers PER SHA, exactly as the real one does: only push
        heads have runs, everything else is NO-VERDICT. It APPENDS every argv it is
        given, so the walk itself — order, count, and that it stopped — is provable
        rather than inferred from the verdict."""
        sh = os.path.join(self.tmp, "fake-probe.sh")
        log = os.path.join(self.tmp, "argv.log")
        dflt = default if default is not None else {
            "status": "NO-VERDICT", "detail": "no run exists for that commit"}
        lines = ["#!/bin/sh", 'printf "ARGV %s\\n" "$*" >> ' + json.dumps(log)]
        lines.append('case "$*" in')
        def body(payload):
            """A str payload is emitted RAW — that is how a probe that stopped
            answering (a make error, an empty run) is expressed, and it must be
            expressible or §17i's arm cannot be tested at all."""
            return payload if isinstance(payload, str) else json.dumps(payload)
        for sha, payload in by_sha.items():
            lines.append("  *%s*) cat <<'EOF_P'\n%s\nEOF_P\n  ;;"
                         % (sha, body(payload)))
        lines.append("  *) cat <<'EOF_D'\n%s\nEOF_D\n  ;;" % body(dflt))
        lines.append("esac")
        sh_path = sh
        with open(sh_path, "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
        os.chmod(sh_path, 0o755)
        self.argv_log = log
        return [sh_path]

    def calls(self):
        """Every argv the probe was handed, in order. Logged with a marker prefix so
        the NO-SHA call — whose argv is the empty string — is COUNTED rather than
        silently filtered away, which is the same absence-versus-evidence mistake
        this whole item is about."""
        if not os.path.exists(self.argv_log):
            return []
        with open(self.argv_log, encoding="utf-8") as fh:
            return [ln[len("ARGV "):] for ln in fh.read().splitlines()
                    if ln.startswith("ARGV")]

    # --- the ride-in direction ------------------------------------------------

    def test_AC_221_1_a_carried_commit_reads_its_push_heads_PASS_and_does_not_block(self):
        """AC-221-1. The four real shas' case: the probe has no run for the commit
        asked about, the push head that carried it PASSED, so the gate DID speak for
        it and nothing blocks."""
        shas = self.repo(["c1", "c2", "c3", "push-head"])
        self.declare({"command": self.probe_map({
            shas[3]: {"status": "PASS", "head": shas[3][:12], "runId": 35039447274,
                      "detail": "run 35039447274 concluded success"}}),
            "shaArg": "SHA={sha}"})
        trace = {}
        findings = wi.compute_exit_gate_ran("ROC", sha=shas[0], trace=trace)
        self.assertEqual(findings, [],
                         "a commit whose push head PASSED has been through a gate "
                         "run; blocking it is the DEF-ROC-221 false block")
        self.assertEqual(trace["resolution"]["pushHead"], shas[3])
        self.assertEqual(trace["resolution"]["status"], "PASS")
        self.assertEqual(trace["resolution"]["asked"], shas[0])
        self.assertEqual(trace["resolution"]["runId"], "35039447274",
                         "'3eb8a59f passed' is not auditable; 'run 35039447274 "
                         "concluded success for 3eb8a59f' is — AC-221-1 asks for "
                         "the run BY NAME, and the real probe reports it as runId")

    def test_AC_221_1_it_names_the_push_head_and_its_run_when_that_run_said_no(self):
        """AC-221-1 — the gated-ancestor case NAMES the push head and its run. The
        FAIL arm is where that is visible in a finding, and it must stay ADVISORY:
        resolving through a carrier may not smuggle a new blocking condition in."""
        shas = self.repo(["c1", "c2", "push-head"])
        self.declare({"command": self.probe_map({
            shas[2]: {"status": "FAIL", "head": shas[2][:12],
                      "runUrl": "https://example/run/999",
                      "detail": "run 999 concluded failure"}}),
            "shaArg": "SHA={sha}"})
        f = self.one(wi.compute_exit_gate_ran("ROC", sha=shas[0]))
        self.assertEqual(f["severity"], "advisory")
        self.assertEqual(f["verdict"], "FAIL")
        self.assertIn(shas[2][:12], f["message"])
        self.assertIn("999", f["message"])
        self.assertIn(shas[0], f["message"],
                      "it must say which commit was ASKED about as well as whose "
                      "run it read, or the reader cannot audit the substitution")
        self.assertIn("push", f["message"].lower())

    def test_AC_221_1_the_first_descendant_with_a_run_is_the_push_head(self):
        """AC-221-1. Runs exist only for push heads, so the walk goes NEAREST FIRST
        and stops at the first descendant that has one — no push-boundary metadata
        is needed and none is guessed. Asserted on the WALK, not just the verdict."""
        shas = self.repo(["c1", "c2", "c3", "c4", "head-a", "later"])
        self.declare({"command": self.probe_map({
            shas[4]: {"status": "PASS", "head": shas[4][:12]},
            shas[5]: {"status": "PASS", "head": shas[5][:12]}}),
            "shaArg": "SHA={sha}"})
        self.assertEqual(wi.compute_exit_gate_ran("ROC", sha=shas[1]), [])
        walked = [c.split("SHA=")[-1] for c in self.calls()]
        self.assertEqual(walked, [shas[1], shas[2], shas[3], shas[4]],
                         "nearest-first, and it must STOP at the first run it finds "
                         "— the nearer push head is the one that carried it, and "
                         "each extra call is a network round trip")

    # --- the genuinely-ungated direction, which must still block --------------

    def test_AC_221_2_no_run_on_any_descendant_still_BLOCKS(self):
        """AC-221-2. The blocking arm is untouched for its real subject: if no
        descendant on trunk has a run either, no push head carried this commit
        through a gate and §F11.4 clause 1's condition holds exactly."""
        shas = self.repo(["c1", "c2", "c3"])
        self.declare({"command": self.probe_map({}), "shaArg": "SHA={sha}"})
        f = self.one(wi.compute_exit_gate_ran("ROC", sha=shas[0]))
        self.assertEqual(f["severity"], "block")
        self.assertEqual(f["verdict"], "NO-VERDICT")
        self.assertIn("did not speak", f["message"].lower())
        self.assertIn("DEF-ROC-221", f["message"],
                      "having looked and found nothing is EVIDENCE — say it, or the "
                      "next reader re-opens this same defect")

    def test_AC_221_2_trunk_head_itself_is_unchanged_and_asks_nothing_extra(self):
        """AC-221-2. Check 20 asks about TRUNK HEAD, with no sha at all, and that
        path must not acquire a single extra probe call or a changed verdict — the
        loop gate is the only continuously-running workflow here."""
        self.declare({"command": self.probe_map(
            {}, default={"status": "NO-VERDICT", "head": "b53ba12c"}),
            "shaArg": "SHA={sha}"})
        f = self.one(wi.compute_exit_gate_ran("ROC"))
        self.assertEqual(f["severity"], "block")
        self.assertEqual(f["verdict"], "NO-VERDICT")
        self.assertEqual(len(self.calls()), 1,
                         "trunk head IS a push head by definition; walking its "
                         "descendants would be both meaningless and a cost paid "
                         "every loop cycle")

    def test_AC_221_3_a_sha_no_readable_repo_carries_blocks_with_a_different_word(self):
        """AC-221-3, §17i. Could-not-look is never a pass, so it still blocks — but
        it is NOT the word used when the gate genuinely did not speak, because the
        whole complaint is that a reader could not tell those apart."""
        self.declare({"command": self.probe_map({}), "shaArg": "SHA={sha}"})
        f = self.one(wi.compute_exit_gate_ran("ROC", sha="deadbeefdeadbeef"))
        self.assertEqual(f["severity"], "block")
        self.assertEqual(f["verdict"], "NO-VERDICT-UNRESOLVED")
        self.assertIn("could not establish", f["message"].lower())

    def test_AC_221_3_a_probe_that_stops_answering_mid_walk_blocks_unresolved(self):
        """AC-221-3, §17i. The walk is N network calls; one of them failing is not a
        verdict about anything, and must not read as either 'gated' or 'never
        gated'. The asked-about commit answers NO-VERDICT (so the walk is reached);
        every descendant answers with a make error, which is not an answer."""
        shas = self.repo(["c1", "c2", "c3"])
        self.declare({"command": self.probe_map(
            {shas[0]: {"status": "NO-VERDICT", "detail": "no run"}},
            default="make: *** No rule to make target"), "shaArg": "SHA={sha}"})
        f = self.one(wi.compute_exit_gate_ran("ROC", sha=shas[0]))
        self.assertEqual(f["severity"], "block")
        self.assertEqual(f["verdict"], "NO-VERDICT-UNRESOLVED")
        self.assertIn("stopped answering", f["message"])

    def test_AC_221_3_the_walk_is_bounded_and_says_so_when_it_stops_at_the_bound(self):
        """AC-221-3. Each step is a network round trip, so the walk is bounded — and
        a walk that stopped at its bound has NOT established that nothing carried
        the commit. It blocks, and says which of the two it is."""
        shas = self.repo(["c%d" % i for i in range(wi.EGR_ANCESTRY_MAX + 5)])
        self.declare({"command": self.probe_map({}), "shaArg": "SHA={sha}"})
        f = self.one(wi.compute_exit_gate_ran("ROC", sha=shas[0]))
        self.assertEqual(f["verdict"], "NO-VERDICT-UNRESOLVED")
        self.assertEqual(len(self.calls()), wi.EGR_ANCESTRY_MAX + 1,
                         "one ask about the commit itself, then at most "
                         "EGR_ANCESTRY_MAX descendants")
        self.assertIn("bound", f["message"])

    def test_AC_221_3_no_trunk_ref_to_walk_is_unresolved_not_an_answer(self):
        """AC-221-3. With no trunk ref in any repo this caller can read, the
        ancestry question cannot be PUT at all — which is not the same as putting it
        and getting nothing back, and must not be reported as though it were."""
        shas = self.repo(["c1", "c2"], trunk_ref=None)
        self.declare({"command": self.probe_map({}), "shaArg": "SHA={sha}"})
        f = self.one(wi.compute_exit_gate_ran("ROC", sha=shas[0]))
        self.assertEqual(f["severity"], "block")
        self.assertEqual(f["verdict"], "NO-VERDICT-UNRESOLVED",
                         "no trunk ref is a question this caller could not put, not "
                         "an answer about the gate")
