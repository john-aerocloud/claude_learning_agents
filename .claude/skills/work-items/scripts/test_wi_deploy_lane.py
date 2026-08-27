#!/usr/bin/env python3
"""loop-gate check 16 — THE LOOP CAN SEE A RED TRUNK (DEF-ROC-131).

OWNER RULING, 2026-08-27: "we should not deploy things that are red -- they should
get fixed", and "FIX THE LOOPS TO FIX THINGS."

WHAT WENT WRONG, and it is the reason every case below exists. `loop-gate` could
emit nineteen distinct findings and not one asked whether trunk CI was red. On
2026-08-27 four sequential genuine reds each SKIPPED `deploy-test` (it declares
`needs: [test-function-app, test-web-app]`); UC-ROC-105 and UC-ROC-106 were built
green, committed, PUSHED and undeployable -- therefore un-validatable, because a
tester cannot validate what is not deployed -- for most of a cycle; the gate was
run repeatedly through that window and reported OK on the pull question every
time; and the orchestrator found out from an engineer's passing remark.

WHY THIS MODULE IS SEPARATE FROM test_work_items.py: another agent held 162
uncommitted lines in that file and in work-items.py while this was written. A
co-owned file is the one hazard `isolated-commit.js` cannot solve by pathspec, so
the honest move is to own a distinct file. `make test-wi` discovers `test_*.py`,
so it runs here with everything else.

WHAT IS AND IS NOT SUBSTITUTED. The cases that assert SEVERITY and MESSAGE
substitute the delegated script, because the claim is about what the GATE does
with an answer -- exactly as checks 6, 7 and 8 already do. But the two cases that
matter most, the discrimination in both directions, drive the REAL
`.claude/tools/deploy-lane.js` against the REAL captured `gh` payloads in
`.claude/tools/fixtures/deploy-lane/`, through a wrapper that redirects only the
FETCH. A fake payload agreeing with a fake reader would prove nothing about
whether run 33076365108's green deploy alongside DEF-ROC-068's red audit is read
correctly, and that is the whole question.
"""
import io
import os
import sys
import json
import shutil
import tempfile
import unittest
import contextlib
import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
REAL_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
CAPTURES = os.path.join(REAL_ROOT, ".claude", "tools", "fixtures", "deploy-lane")
REAL_TOOL = os.path.join(REAL_ROOT, ".claude", "tools", "deploy-lane.js")

_spec = importlib.util.spec_from_file_location(
    "work_items_dl", os.path.join(HERE, "work-items.py"))
wi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(wi)

BLOCKED_RUN = "33072439770"          # REAL capture: Deploy SKIPPED, needs job FAILED
OPEN_RUN = "33076365108"            # REAL capture: Deploy SUCCESS, audit RED
INFLIGHT_RUN = "INFLIGHT-synthetic"  # declared synthetic; confirms nothing about the wire
FN_JOB = "Function App / lint, test and build"
AUDIT_JOB = "Dependency audit (prod-runtime, blocking)"


def _blocked_payload(**over):
    """A blocked report shaped exactly as deploy-lane.js emits one. Field names are
    pinned by the real-tool cases below, so this cannot drift into a private
    dialect the tool does not speak."""
    base = {
        "project": "ROC", "verdict": "blocked", "reason": "needs-job-failed",
        "runId": 33072439770, "repo": "AeroCloudSystems/PpsEventAggregation",
        "runUrl": "https://github.com/AeroCloudSystems/PpsEventAggregation/actions/runs/33072439770",
        "runConclusion": "failure", "runStatus": "completed",
        "headSha": "e1d1b2db5346cd11c8f29fb95bb50d6db68b9583",
        "deployJobName": "Deploy Function App and Web App to AAS test",
        "deployJobStatus": "completed", "deployJobConclusion": "skipped",
        "needsClosure": ["test-function-app", "test-web-app"],
        "needsClosureJobNames": [FN_JOB, "Web App / lint, test and build"],
        "nonBlockingFailures": [AUDIT_JOB],
        "blockingJobs": [{"name": FN_JOB, "conclusion": "failure", "status": "completed"}],
        "suspectItems": ["DEF-ROC-063"], "suspectItemsSource": "commit-message",
        "suspectItemsEstablished": True,
        "undeliveredCommits": 7, "undeliveredItems": ["UC-ROC-105", "UC-ROC-106"],
        "decidedBy": "deploy-job-and-needs-closure", "detail": "d",
    }
    base.update(over)
    return base


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="wi-deploy-lane-")
        self._orig_root = wi.ROOT
        self._orig_script = wi.DEPLOY_LANE_SCRIPT

    def tearDown(self):
        wi.ROOT = self._orig_root
        wi.DEPLOY_LANE_SCRIPT = self._orig_script
        shutil.rmtree(self.tmp, ignore_errors=True)

    def fake_tool(self, payload, exit_code=0):
        """Substitute the delegated SCRIPT (checks 6/7/8 do the same). Logs its argv
        so 'the gate actually invoked it, with the project' is provable."""
        js = os.path.join(self.tmp, "fake-deploy-lane.js")
        log = os.path.join(self.tmp, "argv.json")
        with open(js, "w", encoding="utf-8") as f:
            f.write("require('fs').writeFileSync(%s, JSON.stringify(process.argv.slice(2)));\n"
                    % json.dumps(log))
            f.write("console.log(JSON.stringify(%s));\n" % json.dumps(payload))
            f.write("process.exit(%d);\n" % exit_code)
        wi.DEPLOY_LANE_SCRIPT = js
        self.argv_log = log
        return js

    def real_tool_on_capture(self, run_id):
        """Drive the REAL tool against a REAL captured gh payload. Only the FETCH is
        redirected; the needs-closure reading and the verdict are the real code."""
        js = os.path.join(self.tmp, "capture-wrapper.js")
        with open(js, "w", encoding="utf-8") as f:
            f.write(
                "const {execFileSync}=require('node:child_process');\n"
                "process.stdout.write(execFileSync('node',[%s,...process.argv.slice(2),\n"
                "  '--capture-dir',%s,'--capture-run',%s,\n"
                "  '--workflow',%s,'--no-git'],{encoding:'utf8'}));\n"
                % (json.dumps(REAL_TOOL), json.dumps(CAPTURES), json.dumps(run_id),
                   json.dumps(os.path.join(CAPTURES, "roc-deploy-workflow.yml"))))
        wi.DEPLOY_LANE_SCRIPT = js
        wi.ROOT = REAL_ROOT   # so the tool reads the real committed ROC config
        return wi.compute_deploy_lane("ROC")

    def lane(self, findings):
        return [f for f in findings if f["check"] == "deploy-lane"]


# ---------------------------------------------------------------------------
# DIRECTION 1 — IT FIRES, and it fires in a way the loop is obliged to act on.
# ---------------------------------------------------------------------------
class TestFires(Base):
    def test_AC_131_4_a_shut_lane_BLOCKS_so_the_loop_cannot_pull_past_it(self):
        self.fake_tool(_blocked_payload())
        f = wi.compute_deploy_lane("ROC")
        self.assertEqual(len(f), 1, f)
        self.assertEqual(f[0]["severity"], "block",
                         "advisory would let the loop pull on past a shut lane, which "
                         "is what happened for most of 2026-08-27")

    def test_AC_131_4_it_names_the_failing_job_the_sha_the_run_and_the_owning_item(self):
        self.fake_tool(_blocked_payload())
        msg = wi.compute_deploy_lane("ROC")[0]["message"]
        self.assertIn(FN_JOB, msg, "the failing job must be named")
        self.assertIn("Deploy Function App and Web App to AAS test", msg)
        self.assertIn("e1d1b2db5346", msg, "the sha the lane is shut at must be named")
        self.assertIn("DEF-ROC-063", msg, "the owning item must be named")
        self.assertIn("/actions/runs/33072439770", msg, "the run must be reachable")

    def test_AC_131_4_the_remedy_is_a_DISPATCH_and_says_waiting_does_not_clear_it(self):
        """TRAP 1. A limb that only blocks converts a deploy stall into a TOTAL
        stall, which is worse than the status quo. The ruling's second clause is
        'fix the loops to FIX things', so the named remedy must be an act."""
        self.fake_tool(_blocked_payload())
        msg = wi.compute_deploy_lane("ROC")[0]["message"]
        self.assertIn("DISPATCH AN ENGINEER", msg)
        self.assertIn("NOT A WAIT", msg)
        self.assertIn("NOT CLEARED BY PULLING SOMETHING ELSE", msg)
        self.assertIn("gh run view", msg, "it must name how to read the real failure")
        self.assertIn("EVENT=build_failed", msg,
                      "the change failure is recorded BEFORE the fix-forward, or CFR "
                      "reads a false 0% (EXP-108)")

    def test_AC_131_4_the_ids_carry_the_owning_items_not_an_empty_list(self):
        self.fake_tool(_blocked_payload())
        self.assertEqual(wi.compute_deploy_lane("ROC")[0]["ids"], ["DEF-ROC-063"])

    def test_AC_131_4_an_unattributable_break_says_NOT_ESTABLISHED_not_no_item(self):
        """Absence vs ignorance, applied to attribution: gh truncates the run title
        at ~68 chars and really did cut the id off run 33074315261's subject."""
        self.fake_tool(_blocked_payload(suspectItems=[], suspectItemsEstablished=False,
                                        suspectItemsSource="run-displayTitle"))
        msg = wi.compute_deploy_lane("ROC")[0]["message"]
        self.assertIn("NOT ESTABLISHED", msg)
        self.assertIn("not 'no item involved'", msg)

    def test_AC_131_4_it_states_the_un_validatable_consequence(self):
        self.fake_tool(_blocked_payload())
        msg = wi.compute_deploy_lane("ROC")[0]["message"]
        self.assertIn("UN-VALIDATABLE", msg)
        self.assertIn("UC-ROC-105", msg)

    def test_AC_131_1_the_gate_INVOKES_the_checker_with_the_project(self):
        self.fake_tool(_blocked_payload())
        wi.compute_deploy_lane("ROC")
        with open(self.argv_log, encoding="utf-8") as f:
            argv = json.load(f)
        self.assertIn("--project", argv)
        self.assertIn("ROC", argv)
        self.assertIn("--json", argv)


# ---------------------------------------------------------------------------
# DIRECTION 2 — IT STAYS SILENT on DEF-ROC-068's standing audit red.
# ---------------------------------------------------------------------------
class TestSilent(Base):
    def test_AC_131_2_an_open_lane_with_a_standing_red_elsewhere_produces_NO_finding(self):
        """DEF-ROC-068's audit red is on EVERY push. A limb that fired on it would
        be permanently on and ignored inside a day."""
        self.fake_tool({"verdict": "open", "deployJobName": "Deploy", "headSha": "f950220f",
                        "runConclusion": "failure", "nonBlockingFailures": [AUDIT_JOB],
                        "deployJobConclusion": "success", "runUrl": "u"})
        self.assertEqual(wi.compute_deploy_lane("ROC"), [],
                         "silence here is the property that keeps the limb trusted")

    def test_AC_131_2_the_blocked_message_disowns_the_run_conclusion_and_names_the_closure(self):
        self.fake_tool(_blocked_payload())
        msg = wi.compute_deploy_lane("ROC")[0]["message"]
        self.assertIn("NEVER the run's overall conclusion", msg)
        self.assertIn(AUDIT_JOB, msg)
        self.assertIn("OUTSIDE that closure and are not why", msg)


# ---------------------------------------------------------------------------
# AC-131-3 — a green-so-far run is NOT a landed deploy.
# ---------------------------------------------------------------------------
class TestInFlight(Base):
    def test_AC_131_3_an_in_progress_deploy_is_NOT_ESTABLISHED_never_clean_never_block(self):
        self.fake_tool({"verdict": "in-flight", "deployJobName": "Deploy",
                        "deployJobStatus": "in_progress", "headSha": "f950220f8191a",
                        "runUrl": "u", "reason": "deploy-not-finished"})
        f = wi.compute_deploy_lane("ROC")
        self.assertEqual(len(f), 1, "silence would read as a landed deploy")
        self.assertEqual(f[0]["severity"], "unknown",
                         "nothing is broken, so it must not block; nothing has landed, "
                         "so it must not be clean")
        msg = f[0]["message"]
        self.assertIn("NOTHING HAS LANDED", msg)
        self.assertIn("half-completed cutover", msg)
        self.assertIn("do NOT dispatch validation", msg.replace("Do NOT", "do NOT"))


# ---------------------------------------------------------------------------
# An unanswerable question must never render as a clean answer (§17i).
# ---------------------------------------------------------------------------
class TestNotEstablished(Base):
    def test_AC_131_1_an_unrunnable_checker_is_unknown_never_a_silent_pass(self):
        wi.DEPLOY_LANE_SCRIPT = os.path.join(self.tmp, "does-not-exist.js")
        f = wi.compute_deploy_lane("ROC")
        self.assertEqual(len(f), 1, f)
        self.assertEqual(f[0]["severity"], "unknown")
        self.assertIn("NOT ESTABLISHED", f[0]["message"])
        self.assertIn("gh auth status", f[0]["message"])

    def test_AC_131_1_a_NOT_ESTABLISHED_verdict_is_unknown_never_clean(self):
        self.fake_tool({"verdict": "NOT-ESTABLISHED", "reason": "no-config",
                        "detail": "the config is missing"})
        f = wi.compute_deploy_lane("ROC")
        self.assertEqual(len(f), 1, f)
        self.assertEqual(f[0]["severity"], "unknown")
        self.assertIn("no-config", f[0]["message"])

    def test_AC_131_1_unparseable_stdout_is_unknown_never_clean(self):
        js = os.path.join(self.tmp, "garbage.js")
        with open(js, "w", encoding="utf-8") as f:
            f.write("console.log('not json');\n")
        wi.DEPLOY_LANE_SCRIPT = js
        f = wi.compute_deploy_lane("ROC")
        self.assertEqual(len(f), 1, f)
        self.assertEqual(f[0]["severity"], "unknown")


# ---------------------------------------------------------------------------
# AC-131-5 — THE ARMING TEST, both directions, through the REAL tool against the
# REAL captured gh payloads. Nothing here is a fake talking to a fake.
# ---------------------------------------------------------------------------
class TestArmedAgainstRealCaptures(Base):
    def test_AC_131_5_real_capture_33072439770_ARMS_the_gate_and_it_BLOCKS(self):
        f = self.lane(self.real_tool_on_capture(BLOCKED_RUN))
        self.assertEqual(len(f), 1, f)
        self.assertEqual(f[0]["severity"], "block")
        self.assertIn(FN_JOB, f[0]["message"])
        self.assertIn("THE DEPLOY LANE IS SHUT", f[0]["message"])

    def test_AC_131_5_real_capture_33076365108_leaves_the_gate_SILENT(self):
        """The same run's OVERALL conclusion is `failure`, identical to the blocked
        capture above, and its audit job is red. The deploy job succeeded. If this
        returns a finding, the limb is noise."""
        self.assertEqual(self.real_tool_on_capture(OPEN_RUN), [])

    def test_AC_131_5_the_synthetic_in_flight_variant_is_neither_of_the_two(self):
        f = self.lane(self.real_tool_on_capture(INFLIGHT_RUN))
        self.assertEqual(len(f), 1, f)
        self.assertEqual(f[0]["severity"], "unknown")


# ---------------------------------------------------------------------------
# AC-131-1 — it runs BEFORE EVERY PULL, not merely when someone calls the tool.
# ---------------------------------------------------------------------------
class TestWiredIntoTheGate(Base):
    def _project(self):
        """The smallest project the gate will load: real state graphs, empty item
        set. Every other check is filtered out; the claim is only that check 16 is
        part of `compute_loop_gate`'s output."""
        wi.ROOT = self.tmp
        os.makedirs(os.path.join(self.tmp, "process", "machinery"), exist_ok=True)
        shutil.copy(os.path.join(self._orig_root, "process", "machinery", "state-graphs.json"),
                    os.path.join(self.tmp, "process", "machinery", "state-graphs.json"))
        wi.GRAPHS_PATH = os.path.join(self.tmp, "process", "machinery", "state-graphs.json")
        graphs = wi.Graphs.load(wi.GRAPHS_PATH)
        for sub in ("active", "done"):
            os.makedirs(os.path.join(self.tmp, "work", "P", "items", sub), exist_ok=True)
        return graphs

    def test_AC_131_1_compute_loop_gate_carries_the_deploy_lane_finding(self):
        graphs = self._project()
        self.fake_tool(_blocked_payload())
        findings = wi.compute_loop_gate(graphs, "P", observe=False)
        f = self.lane(findings)
        self.assertEqual(len(f), 1,
                         "a limb the gate does not call is a limb that cannot fire; "
                         "checks: %s" % sorted({x["check"] for x in findings}))
        self.assertEqual(f[0]["severity"], "block")

    def test_AC_131_1_a_shut_lane_makes_the_gate_exit_2_and_print_the_line(self):
        """The exit code is the only thing /loop-run STEP 0b honours mechanically."""
        self._project()
        self.fake_tool(_blocked_payload())
        ns = __import__("argparse").Namespace(
            project="P", stale_hours=4.0, threshold=3, now=None, observe=False,
            observe_timeout=wi.DEFAULT_OBSERVE_TIMEOUT,
            max_backlog_age_days=wi.DEFAULT_MAX_BACKLOG_AGE_DAYS,
            max_defer_total_days=wi.DEFAULT_MAX_DEFER_TOTAL_DAYS)
        with contextlib.redirect_stdout(io.StringIO()) as out:
            with self.assertRaises(SystemExit) as ctx:
                wi.cmd_loop_gate(ns)
        self.assertEqual(ctx.exception.code, 2)
        text = out.getvalue()
        self.assertIn("THE DEPLOY LANE IS SHUT", text)
        self.assertIn("BLOCKED", text.splitlines()[0])


if __name__ == "__main__":
    unittest.main()
