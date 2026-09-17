#!/usr/bin/env python3
"""OI-ROC-034 / §F9k — REGISTRATION AND TRIAGE ARE ONE ACT, ENFORCED BY THE TOOL
THAT IS ALREADY RUNNING AT THE MOMENT THEY BIND.

THE CONSTRAINT, MEASURED (`views/stats.md`, 2026-09-17). `orchestrator` is
**35.23% of gross lead time** — the largest single owner — and every second of it
is ONE state, `reported`: 682 days of accrued dwell across 180 items, median
**6439 s** between a finding existing and a decision being recorded. That median
is roughly 1.8x the orchestrator's tick interval, so **the dwell is polling
latency, not deliberation.**

WHY THE EXISTING RULE DID NOT FIX IT. §F9b already requires that a finding be
registered WITH its triage decision, in the same act. It is enforced by
`loop-gate`'s `undecided-arrival` limb, which blocks **the pull** — a later,
different act — so it fires about an hour after the cost has been paid, and its
remedy is always retrospective. Meanwhile `wi-mint`, the one tool definitely
running at registration time and the only moment the registering role still holds
the context needed to decide, took **no decision argument at all**. Measured this
cycle: `DEF-ROC-237`, `-238`, `-243` and `-244` sat undecided 1.2–3.2 hours and
were decided only because a gate refused a pull. Each decision then took under a
minute to write, because the context was still recoverable.

WHAT IS REQUIRED, AND WHY IT CANNOT BE FAKED CHEAPLY. `--decide` is a CLOSED
VOCABULARY OF TWO CONSEQUENCES — there is no free-text field to answer `TODO`
with, which is the failure mode §F9k names first (*a required field answered
`TODO` is worse than an absent one, because the gate then reads a lie as
compliance*):

  * `schedule` puts the item in `scheduled` — a `ready`/buffer state that costs
    NO wip slot — where it is a real pull candidate ranked against everything
    else by the value and cost the registerer has just supplied. The cost of
    faking it is that the system actually does the work.
  * `defer` requires a DATE at least `DEFAULT_MIN_DEFER_DAYS` in the future.
    A nearer date buys nothing the gate already grants for free (v157's
    arithmetic), it EXPIRES, and re-dating is bounded by the 30d total-age
    ceiling. The cost of faking it is that the question returns.

Both carry a reason, screened against the placeholder that would make the record
a lie. The screen is deliberately weak — a floor, not a judgement — because the
strong property is the CONSEQUENCE, not the string.

THREE THINGS THIS MUST NOT DO, each with its own class below:
  * not cheap to fake            -> TestTheDecisionCannotBeFakedCheaply
  * not suppress discovery       -> TestDiscoveryIsNotSuppressed
  * not re-create EXP-ROC-020's trap (a decision that costs a wip slot, which is
    the §F9i/OI-ROC-029 failure) -> TestDecidingCostsNoWipSlot

Nothing is stubbed: every test drives the REAL graph out of
`process/machinery/state-graphs.json` and the REAL writer (`wi.cmd_mint`).
"""
import io
import os
import shutil
import argparse
import contextlib
import subprocess
import unittest
from datetime import datetime, timedelta, timezone

from test_work_items import Base, wi

REAL_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                         "..", "..", "..", ".."))
NOW = datetime(2026, 9, 17, 12, 0, 0, tzinfo=timezone.utc)


def in_days(n):
    return (NOW + timedelta(days=n)).date().isoformat()


class _Mint(Base):

    def _ns(self, **kw):
        ns = dict(project=self.project, type="defect", title="a real finding",
                  title_file=None, job="J0", value=3, cost=1, parents=None,
                  deps=None, lane="parent-repo", agent="orchestrator",
                  note=None, note_file=None, body_file=None, id=None,
                  prefix=None, ts=NOW.strftime("%Y-%m-%dT%H:%M:%SZ"),
                  decide="schedule", defer_until=None,
                  decide_note="the live queue is affected now, so it is worked next",
                  decide_note_file=None)
        ns.update(kw)
        return argparse.Namespace(**ns)

    def mint(self, **kw):
        with contextlib.redirect_stdout(io.StringIO()):
            return wi.cmd_mint(self._ns(**kw))

    def refuse(self, **kw):
        with self.assertRaises(SystemExit) as cm, \
                contextlib.redirect_stdout(io.StringIO()):
            self.mint(**kw)
        return str(cm.exception)

    def seed_prefix(self, itype="defect", prefix="DEF-T"):
        return {"prefix": prefix, "type": itype}

    def load(self, iid):
        path, _sub = wi.find_item_path(self.project, iid)
        return wi.load_item(path)

    def state_queue(self, iid):
        items, _dup = wi.load_all_items(self.project)
        st = wi.compute_states(self.graphs, items).get(iid)
        return st, self.graphs.queue_for(st)

    def ids_on_disk(self):
        out = []
        for sub in ("active", "done"):
            d = self._items(sub)
            out += [f[:-3] for f in os.listdir(d) if f.endswith(".md")]
        return sorted(out)


# --------------------------------------------------------------------------- #
# The act itself
# --------------------------------------------------------------------------- #
class TestRegistrationAndTriageAreOneAct(_Mint):

    def test_a_decided_defect_is_registered_AND_triaged_by_one_command(self):
        iid = self.mint(prefix="DEF-T")
        it = self.load(iid)
        self.assertEqual([e["event"] for e in it.events], ["reported", "triaged"])
        self.assertEqual(it.events[1]["agent"], "orchestrator")
        self.assertEqual(it.events[1]["note"],
                         "the live queue is affected now, so it is worked next")
        self.assertEqual(self.state_queue(iid), ("scheduled", "ready"))
        # …and the store is valid the instant it exists: I1 replays the decision
        # event against the rights model, so a decision at mint is not a special
        # case anything downstream has to forgive.
        self.assertEqual(wi.validate_items(self.graphs, self.project), [])

    def test_the_decision_is_stamped_at_the_registration_INSTANT(self):
        """The whole finding is that the gap between the two acts is the cost.
        There is no gap: both events carry the same timestamp."""
        iid = self.mint(prefix="DEF-T")
        it = self.load(iid)
        self.assertEqual(it.events[0]["ts"], it.events[1]["ts"])

    def test_every_flow_type_has_exactly_ONE_decision_edge_and_mint_finds_it(self):
        """Derived from the graph, never hardcoded: a future type gets this for
        free, and a type that grows a second decision edge FAILS CLOSED here
        rather than having one picked for it."""
        for itype in sorted(t for t in self.graphs.types
                            if self.graphs.kind(t) == "flow"):
            event, to = wi.registration_decision_edge(self.graphs, itype)
            self.assertIsNotNone(event, itype)
            self.assertEqual(self.graphs.queue_for(to), "ready", itype)

    def test_the_decision_lands_on_use_cases_and_open_items_too(self):
        for itype, prefix, expect in (("open-item", "OI-T", "scheduled"),
                                      ("use-case", "UC-T", "ready")):
            iid = self.mint(type=itype, prefix=prefix)
            self.assertEqual(self.state_queue(iid)[0], expect, itype)


class TestReportedCannotBeRestedIn(_Mint):

    def test_a_finding_registered_with_NO_decision_is_REFUSED(self):
        msg = self.refuse(prefix="DEF-T", decide=None)
        self.assertIn("--decide", msg)
        self.assertIn("defer", msg)                 # the always-available route

    def test_the_refusal_leaves_NO_orphan_and_burns_NO_id(self):
        """A refusal after the id has been claimed must give the number back —
        exactly as an edge refusal does (DEF-ROC-203)."""
        self.refuse(prefix="DEF-T", decide=None)
        self.assertEqual(self.ids_on_disk(), [])
        iid = self.mint(prefix="DEF-T")
        self.assertEqual(iid, "DEF-T-001")

    def test_a_DEFER_at_mint_is_what_the_undecided_gate_reads_as_DECIDED(self):
        """The alternative route is recorded, dated and honoured by the very limb
        that used to catch the omission an hour later."""
        iid = self.mint(prefix="DEF-T", decide="defer",
                        defer_until=in_days(14),
                        decide_note="waiting on the owner's taxonomy ruling")
        it = self.load(iid)
        self.assertEqual(it.fm["defer_until"], in_days(14))
        self.assertEqual(self.state_queue(iid), ("reported", "intake"))
        _to, is_decision, why = wi._defer_is_decision(it, NOW, NOW)
        self.assertTrue(is_decision, why)

    def test_the_defer_REASON_is_on_the_permanent_record_with_its_timestamp(self):
        """v157 had to establish the decisions' timing with `git log -S
        defer_until`, because a frontmatter scalar carries no timestamp. The
        reason now rides the genesis event, which does."""
        iid = self.mint(prefix="DEF-T", decide="defer", defer_until=in_days(30),
                        decide_note="waiting on the owner's taxonomy ruling")
        genesis = self.load(iid).events[0]
        self.assertIn("waiting on the owner's taxonomy ruling", genesis["note"])
        self.assertIn(in_days(30), genesis["note"])
        self.assertEqual(genesis["ts"], NOW.strftime("%Y-%m-%dT%H:%M:%SZ"))


# --------------------------------------------------------------------------- #
# §F9k's first failure mode — a required field answered `TODO`
# --------------------------------------------------------------------------- #
class TestTheDecisionCannotBeFakedCheaply(_Mint):

    def test_the_decision_is_a_CLOSED_VOCABULARY_not_a_free_text_field(self):
        for bad in ("TODO", "later", "yes", "triaged", "maybe", ""):
            msg = self.refuse(prefix="DEF-T", decide=bad)
            self.assertIn("schedule", msg, bad)
            self.assertIn("defer", msg, bad)

    def test_a_PLACEHOLDER_reason_is_refused_on_both_routes(self):
        for placeholder in ("TODO", "tbd", "n/a", "-", "?", "   ", "xxx", "fixme"):
            msg = self.refuse(prefix="DEF-T", decide_note=placeholder)
            self.assertIn("reason", msg.lower(), placeholder)
            msg = self.refuse(prefix="DEF-T", decide="defer",
                              defer_until=in_days(14), decide_note=placeholder)
            self.assertIn("reason", msg.lower(), placeholder)

    def test_a_missing_reason_is_refused(self):
        msg = self.refuse(prefix="DEF-T", decide_note=None)
        self.assertIn("reason", msg.lower())

    def test_a_defer_INSIDE_the_window_the_gate_already_grants_is_refused(self):
        """v157's arithmetic, applied at the moment instead of a week later: a
        defer shorter than the backlog-age limb decides nothing, because the item
        had that window for free. Six of nine decisions in the v156 cycle were
        the same date, expiring inside 13 hours."""
        for days in (0, 1, 3, 6):
            msg = self.refuse(prefix="DEF-T", decide="defer",
                              defer_until=in_days(days))
            self.assertIn(f"{wi.DEFAULT_MIN_DEFER_DAYS:.0f}", msg, days)

    def test_a_defer_in_the_PAST_or_unparseable_is_refused(self):
        for bad in (in_days(-1), "soon", "2026-13-40", "next week"):
            self.refuse(prefix="DEF-T", decide="defer", defer_until=bad)

    def test_a_defer_with_NO_date_is_refused(self):
        msg = self.refuse(prefix="DEF-T", decide="defer", defer_until=None)
        self.assertIn("--defer-until", msg)

    def test_a_date_passed_WITHOUT_choosing_defer_is_refused_not_ignored(self):
        """A silently-ignored argument is how an agent comes to believe it
        recorded something it did not (DEF-ROC-248's shape, the same day)."""
        msg = self.refuse(prefix="DEF-T", decide="schedule",
                          defer_until=in_days(14))
        self.assertIn("--defer-until", msg)


# --------------------------------------------------------------------------- #
# §F9k's second failure mode — suppressing the activity the rule governs
# --------------------------------------------------------------------------- #
class TestDiscoveryIsNotSuppressed(_Mint):

    def test_EVERY_known_role_can_register_a_finding_through_the_defer_route(self):
        """The always-available route needs no firing rights, because it appends
        no transition — it records a dated decision on the genesis event. If any
        role could be refused outright, the control would be suppressing
        discovery, which §F9k says kills it rather than tuning it."""
        for role in sorted(self.graphs.known_roles):
            iid = self.mint(prefix="DEF-T", agent=role, decide="defer",
                            defer_until=in_days(10),
                            decide_note=f"{role} found it adjacent to other work")
            self.assertEqual(self.load(iid).events[0]["agent"], role)

    def test_a_role_without_firing_rights_is_pointed_AT_THE_ROUTE_IT_HAS(self):
        msg = self.refuse(prefix="DEF-T", agent="ui-designer", decide="schedule")
        self.assertIn("defer", msg)
        self.assertEqual(self.ids_on_disk(), [],
                         "a refused decision must not leave the finding half-registered")

    def test_registering_an_AGGREGATE_is_unchanged_and_needs_no_decision(self):
        """Nothing about slicing gets more expensive: an aggregate has no flow
        state, so there is nothing to decide and a decision is refused rather
        than silently absorbed."""
        iid = self.mint(type="requirement", prefix="REQ-T", decide=None,
                        decide_note=None)
        self.assertEqual([e["event"] for e in self.load(iid).events],
                         ["registered"])
        msg = self.refuse(type="requirement", prefix="REQ-T", decide="schedule")
        self.assertIn("aggregate", msg)


# --------------------------------------------------------------------------- #
# EXP-ROC-020's trap — §F9i / OI-ROC-029
# --------------------------------------------------------------------------- #
class TestDecidingCostsNoWipSlot(_Mint):

    def test_no_decision_at_mint_can_land_in_wip_on_ANY_flow_type(self):
        """The failure this must not re-create, stated as the graph property
        rather than as three assertions about today's three types: a decision
        that consumes a slot puts §F9b back into mechanical opposition with the
        wip cap, which is what blocked the loop at 11/8 with zero agents
        running."""
        for itype in sorted(t for t in self.graphs.types
                            if self.graphs.kind(t) == "flow"):
            _event, to = wi.registration_decision_edge(self.graphs, itype)
            self.assertNotEqual(self.graphs.queue_for(to), "wip", itype)

    def test_deciding_ten_findings_occupies_ZERO_wip(self):
        for n in range(10):
            self.mint(prefix="DEF-T", decide="schedule",
                      decide_note=f"finding {n} is worked in turn")
        items, _dup = wi.load_all_items(self.project)
        states = wi.compute_states(self.graphs, items)
        queues = [self.graphs.queue_for(s) for s in states.values()]
        self.assertEqual(queues.count("wip"), 0)
        self.assertEqual(queues.count("ready"), 10)


# --------------------------------------------------------------------------- #
# The AGENT-FACING route
# --------------------------------------------------------------------------- #
class TestTheRealMakeRoute(unittest.TestCase):

    project = "_WI_DECIDE_PROBE"

    def setUp(self):
        self.items = os.path.join(REAL_ROOT, "work", self.project, "items")
        os.makedirs(os.path.join(self.items, "active"), exist_ok=True)
        os.makedirs(os.path.join(self.items, "done"), exist_ok=True)

    def tearDown(self):
        shutil.rmtree(os.path.join(REAL_ROOT, "work", self.project),
                      ignore_errors=True)

    def run_make(self, **variables):
        argv = ["make", "wi-mint"] + [f"{k}={v}" for k, v in variables.items()]
        return subprocess.run(argv, cwd=REAL_ROOT, capture_output=True, text=True)

    def base(self, **kw):
        v = dict(PROJECT=self.project, TYPE="defect", PREFIX="DEF-PROBE",
                 TITLE="a probe defect", JOB="J0", VALUE="3", COST="1",
                 LANE="parent-repo", AGENT="orchestrator")
        v.update(kw)
        return v

    def test_a_decided_registration_works_through_make(self):
        r = self.run_make(**self.base(
            DECIDE="schedule",
            DECIDE_NOTE="it affects the live queue so it is worked next"))
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        it = wi.load_item(os.path.join(self.items, "active", "DEF-PROBE-001.md"))
        self.assertEqual([e["event"] for e in it.events], ["reported", "triaged"])

    def test_make_REFUSES_a_registration_that_carries_no_decision(self):
        r = self.run_make(**self.base())
        self.assertNotEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("DECIDE", r.stdout + r.stderr)
        self.assertFalse(os.path.exists(
            os.path.join(self.items, "active", "DEF-PROBE-001.md")))

    def test_the_defer_route_works_through_make(self):
        r = self.run_make(**self.base(
            DECIDE="defer", DEFER_UNTIL=in_days(21),
            DECIDE_NOTE="parked behind the owner's taxonomy ruling"))
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        it = wi.load_item(os.path.join(self.items, "active", "DEF-PROBE-001.md"))
        self.assertEqual(it.fm["defer_until"], in_days(21))


if __name__ == "__main__":
    unittest.main()
