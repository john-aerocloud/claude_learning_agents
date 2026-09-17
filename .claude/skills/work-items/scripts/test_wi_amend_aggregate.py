#!/usr/bin/env python3
"""DEF-ROC-238 — an aggregate must be AMENDABLE through the machinery, and a
definition change that left no event must be distinguishable from one that did.

THE CONTRADICTION THE SYSTEM HELD AGAINST ITSELF (2026-09-17, hit live while
amending `REQ-ROC-030` from the owner's ticket-taxonomy feedback):

  * `SKILL.md` says aggregates *"carry only registered/amended events for audit"*
    — i.e. `amended` is expected to work on exactly these types.
  * `SKILL.md` also says material changes are `amended` events, *"never silent
    edits"*, and that `wi-mint` is the only supported way to create an item,
    *"never hand-write items/active/<ID>.md"*.
  * `work-items.py` refused EVERY event on an aggregate, keyed on the type's
    `kind` BEFORE any event-name check — which left a hand-edit as the only
    remaining route. **The contract forbade the only thing it permitted.**

THE DISTINCTION THE FIX TURNS ON, and the reason this is not "let events
through": the refusal is RIGHT ABOUT STATE and WRONG ABOUT AUDIT.
`state-graphs.json` correctly gives an aggregate no `events` map — its state
bubbles from its children, so a flow event on it would be meaningless and STAYS
REFUSED. But `amended` on an aggregate was never a state transition. It is a
self-edge that changes nothing and exists purely so a definition change leaves a
trace. One predicate conflated the two.

WHAT MADE IT URGENT rather than tidy, and what the second half of this module is
about: the author hand-edited `REQ-ROC-030` (`value: 2` -> `5`, `defer_until`
removed) and `make wi-validate` came back CLEAN on I1–I4 and I6–I9. **The
invariant set could not tell an amendment from a forgery**, because the write
path that would have stamped it is the one that refused. Every aggregate
definition in the project was editable with no trace and the gate said fine.

SO THE FIX HAS THREE LIMBS, and the third is the one with teeth:

  1. `amended` — and ONLY `amended` — is accepted on an aggregate: recorded, no
     fold attempted, no state changed. Every flow event is still refused, with a
     message that now names the real reason (§F9f: a control only ever seen
     permitting proves nothing, so both directions are driven on one item).
  2. The AUTHORED ECONOMICS a hand-edit used to change (`value`, `cost`, `job`,
     `defer_until`) are settable THROUGH that same call — `--set value=5` — so
     the change and its record are one act rather than two, and the act is what
     writes the file.
  3. **I10, the provenance invariant.** Every machinery write stamps the
     resulting economics on the event it writes (`econ:`). An aggregate whose
     file disagrees with its own last stamp has been edited by something that
     was not the machinery — which is exactly the forgery the gate could not
     see. An aggregate with no stamp yet is NOT ESTABLISHED, never a pass (§17i):
     it says so, and it establishes itself the next time the item is written.

Nothing is stubbed: every test drives the REAL graph out of
`process/machinery/state-graphs.json` and the REAL writers (`wi.cmd_append`,
`wi.cmd_mint`, `wi.validate_items`).
"""
import io
import os
import shutil
import argparse
import contextlib
import subprocess
import unittest

from test_work_items import Base, wi

REAL_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                         "..", "..", "..", ".."))


def read(path):
    with io.open(path, encoding="utf-8") as f:
        return f.read()


class _Drive(Base):
    """Drive the real append/mint against real item files."""

    def _append(self, iid, event, agent="orchestrator", **kw):
        ns = argparse.Namespace(project=self.project, id=iid, event=event,
                                agent=agent, ref=None, note=kw.pop("note", None),
                                ts=kw.pop("ts", "2026-09-17T00:00:00Z"),
                                tokens=None, duration_ms=None, observe=None,
                                probe=None, note_file=None,
                                owner=kw.pop("owner", None),
                                set=kw.pop("set", None))
        for k, v in kw.items():
            setattr(ns, k, v)
        with contextlib.redirect_stdout(io.StringIO()):
            return wi.cmd_append(ns)

    def _mint(self, **kw):
        ns = dict(project=self.project, type="defect", title="a finding",
                  title_file=None, job="J0", value=1, cost=1, parents=None,
                  deps=None, lane="parent-repo", agent="orchestrator",
                  note=None, note_file=None, body_file=None, id=None,
                  prefix=None, ts="2026-09-17T00:00:00Z",
                  decide="schedule", decide_note="the reason this was decided",
                  decide_note_file=None, defer_until=None)
        ns.update(kw)
        with contextlib.redirect_stdout(io.StringIO()):
            return wi.cmd_mint(argparse.Namespace(**ns))

    def requirement(self, iid="REQ-T-001", **fm):
        """An aggregate as the machinery really writes one: a `registered`
        genesis event for audit, and no flow state of its own."""
        return self.write_item("active", iid, "requirement",
                               [{"ts": "2026-09-14T00:00:00Z",
                                 "event": "registered", "agent": "flow-manager"}],
                               extra_fm=fm or None)

    def load(self, iid):
        path, _sub = wi.find_item_path(self.project, iid)
        return wi.load_item(path)

    def edit_frontmatter_by_hand(self, iid, **fields):
        """The forgery: change the file's authored economics with an editor, the
        way the defect's own report did, leaving no event behind."""
        path, _sub = wi.find_item_path(self.project, iid)
        it = wi.load_item(path)
        fm = dict(it.fm)
        for k, v in fields.items():
            if v is None:
                fm.pop(k, None)
            else:
                fm[k] = v
        fm["events"] = it.events
        text = wi.render_item(wi.Item(path, fm, it.body), it.declared or {})
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)


# --------------------------------------------------------------------------- #
# Limb 1 — the refusal is right about STATE and wrong about AUDIT
# --------------------------------------------------------------------------- #
class TestAmendedIsAcceptedOnAnAggregate(_Drive):

    def test_amended_on_a_requirement_is_recorded_and_the_note_lands_verbatim(self):
        self.requirement()
        note = ("SECOND, INDEPENDENT OWNER ASK FOR THE SAME THING — the defer "
                "condition a defer exists to wait for has been met.")
        self._append("REQ-T-001", "amended", agent="orchestrator", note=note)
        it = self.load("REQ-T-001")
        self.assertEqual([e["event"] for e in it.events],
                         ["registered", "amended"])
        self.assertEqual(it.events[-1]["note"], note)
        self.assertEqual(it.events[-1]["agent"], "orchestrator")

    def test_the_aggregate_s_state_is_untouched_by_the_amendment(self):
        """An `amended` on an aggregate is a self-edge that changes nothing:
        state still bubbles from children, which is what the old refusal was
        right about."""
        self.requirement()
        before = wi.compute_states(self.graphs,
                                   wi.load_all_items(self.project)[0])["REQ-T-001"]
        self._append("REQ-T-001", "amended", note="a definition correction")
        after = wi.compute_states(self.graphs,
                                  wi.load_all_items(self.project)[0])["REQ-T-001"]
        self.assertEqual(before, "planned")
        self.assertEqual(after, before)
        self.assertEqual(wi.validate_items(self.graphs, self.project), [])

    def test_amended_works_on_every_aggregate_type_not_just_requirement(self):
        for itype, iid in (("requirement", "REQ-T-001"), ("chunk", "CHK-T-001"),
                           ("slice", "SLC-T-001")):
            self.write_item("active", iid, itype,
                            [{"ts": "2026-09-14T00:00:00Z", "event": "registered",
                              "agent": "flow-manager"}])
            self._append(iid, "amended", note=f"a correction to the {itype}")
            self.assertEqual([e["event"] for e in self.load(iid).events],
                             ["registered", "amended"], itype)


class TestFlowEventsAreStillRefusedOnAnAggregate(_Drive):
    """§F9f — a control demonstrated only permitting proves nothing. The whole
    point of the fix is that it keeps the refusal it was right about."""

    def test_every_flow_event_is_still_refused_on_a_requirement(self):
        self.requirement()
        for event in ("pulled", "triaged", "fixed", "built_green", "validated",
                      "made_ready", "closed", "blocked", "cancelled"):
            with self.assertRaises(SystemExit) as cm, \
                    contextlib.redirect_stdout(io.StringIO()):
                self._append("REQ-T-001", event)
            self.assertIn("aggregate", str(cm.exception), event)
            self.assertEqual([e["event"] for e in self.load("REQ-T-001").events],
                             ["registered"], event)

    def test_the_refusal_names_the_EVENT_so_the_reason_is_the_real_one(self):
        self.requirement()
        with self.assertRaises(SystemExit) as cm, \
                contextlib.redirect_stdout(io.StringIO()):
            self._append("REQ-T-001", "pulled")
        msg = str(cm.exception)
        self.assertIn("pulled", msg)
        self.assertIn("amended", msg)          # …and it names the route that works


# --------------------------------------------------------------------------- #
# Limb 2 — the authored economics are settable THROUGH the amendment
# --------------------------------------------------------------------------- #
class TestTheAmendmentCarriesTheChange(_Drive):

    def test_set_applies_the_change_and_records_it_on_the_event(self):
        """The real hand-edit this defect was reported from: value 2 -> 5 with
        the defer cleared, which no event recorded."""
        self.write_item("active", "REQ-T-001", "requirement",
                        [{"ts": "2026-09-14T00:00:00Z", "event": "registered",
                          "agent": "flow-manager"}],
                        extra_fm={"value": 2, "defer_until": "2026-09-29"})
        self._append("REQ-T-001", "amended", note="the owner raised it",
                     set=["value=5", "defer_until="])
        it = self.load("REQ-T-001")
        self.assertEqual(it.fm["value"], 5)
        self.assertNotIn("defer_until", it.fm)
        self.assertIn("value=5", it.events[-1]["econ"])
        self.assertIn("defer_until=-", it.events[-1]["econ"])

    def test_a_field_outside_the_authored_economics_is_REFUSED(self):
        """`--set` is not a general file editor: it settles the fields a
        definition change actually moves, and nothing derived or structural."""
        self.requirement()
        for bad in ("state=done", "type=defect", "events=[]", "id=REQ-T-999",
                    "parents=REQ-T-002"):
            with self.assertRaises(SystemExit) as cm, \
                    contextlib.redirect_stdout(io.StringIO()):
                self._append("REQ-T-001", "amended", note="x", set=[bad])
            self.assertIn("--set", str(cm.exception), bad)

    def test_set_is_REFUSED_on_any_event_that_is_not_an_amendment(self):
        self.write_item("active", "DEF-T-001", "defect",
                        [{"ts": "2026-09-14T00:00:00Z", "event": "reported",
                          "agent": "orchestrator"}])
        with self.assertRaises(SystemExit) as cm, \
                contextlib.redirect_stdout(io.StringIO()):
            self._append("DEF-T-001", "triaged", set=["value=5"])
        self.assertIn("amended", str(cm.exception))

    def test_a_value_carrying_a_shell_metacharacter_is_REFUSED(self):
        """The same hazard NOTE= has, answered differently because the answer can
        be: an economic value is a number, a date or a job id, so it is refused
        on its meaning rather than given a file route."""
        self.requirement()
        for bad in ("value=$(whoami)", "job=J`id`", 'cost="1"', "defer_until=a b"):
            with self.assertRaises(SystemExit) as cm, \
                    contextlib.redirect_stdout(io.StringIO()):
                self._append("REQ-T-001", "amended", note="x", set=[bad])
            self.assertIn("--set", str(cm.exception), bad)

    def test_a_malformed_set_is_refused_rather_than_guessed(self):
        self.requirement()
        for bad in ("value", "=5", "value 5"):
            with self.assertRaises(SystemExit), \
                    contextlib.redirect_stdout(io.StringIO()):
                self._append("REQ-T-001", "amended", note="x", set=[bad])


# --------------------------------------------------------------------------- #
# Limb 3 — I10: what now distinguishes an amendment from a FORGERY
# --------------------------------------------------------------------------- #
class TestForgeryIsDistinguishableFromAmendment(_Drive):

    def test_an_amendment_through_the_machinery_validates_CLEAN(self):
        self.requirement()
        self._append("REQ-T-001", "amended", note="the owner raised it",
                     set=["value=5"])
        self.assertEqual(wi.validate_items(self.graphs, self.project), [])

    def test_a_HAND_EDIT_after_a_stamped_event_is_REPORTED_by_I10(self):
        """The forgery, performed exactly as the defect report performed it."""
        self.requirement()
        self._append("REQ-T-001", "amended", note="the owner raised it",
                     set=["value=5"])
        self.edit_frontmatter_by_hand("REQ-T-001", value=9, defer_until=None)
        violations = wi.validate_items(self.graphs, self.project)
        self.assertTrue(any(v.startswith("(I10)") for v in violations), violations)
        self.assertTrue(any("REQ-T-001" in v for v in violations), violations)

    def test_I10_names_the_route_that_would_have_made_the_change_honest(self):
        self.requirement()
        self._append("REQ-T-001", "amended", note="x", set=["value=5"])
        self.edit_frontmatter_by_hand("REQ-T-001", value=9)
        msg = "\n".join(v for v in wi.validate_items(self.graphs, self.project)
                        if v.startswith("(I10)"))
        self.assertIn("amended", msg)
        # …in the form an agent actually invokes (the allowlisted `make` target),
        # not the bare Python flag, which no agent is supposed to run directly.
        self.assertIn("SET=", msg)
        self.assertIn("wi-append", msg)

    def test_re_declaring_the_hand_edit_through_the_machinery_CLEARS_it(self):
        """The remedy must be reachable, or the gate is unsatisfiable
        (DEF-ROC-083). An aggregate has no terminal state, so `amended` — and
        therefore the remedy — is available on every aggregate for ever."""
        self.requirement()
        self._append("REQ-T-001", "amended", note="x", set=["value=5"])
        self.edit_frontmatter_by_hand("REQ-T-001", value=9)
        self.assertNotEqual(wi.validate_items(self.graphs, self.project), [])
        self._append("REQ-T-001", "amended", ts="2026-09-17T01:00:00Z",
                     note="declaring the edit that was made by hand",
                     set=["value=9"])
        self.assertEqual(wi.validate_items(self.graphs, self.project), [])

    def test_an_aggregate_with_NO_stamp_is_NOT_ESTABLISHED_never_a_pass(self):
        """§17i — 'cannot measure' is never a pass and never a plain fail. A
        pre-existing aggregate carries no baseline, so I10 has nothing to
        compare; it must SAY SO rather than read clean."""
        self.requirement()
        self.assertEqual(wi.validate_items(self.graphs, self.project), [])
        unstamped = wi.econ_unstamped_ids(self.graphs, self.project)
        self.assertEqual(unstamped, ["REQ-T-001"])
        self._append("REQ-T-001", "amended", note="x", set=["value=5"])
        self.assertEqual(wi.econ_unstamped_ids(self.graphs, self.project), [])


class TestMintStampsTheBaseline(_Drive):
    """An item minted from now on is checkable FROM BIRTH: the genesis event
    carries the economics the registerer declared, so the FIRST hand-edit is
    caught, not just a later one."""

    def test_a_minted_aggregate_carries_a_registered_event_with_the_baseline(self):
        self._mint(type="requirement", prefix="REQ-T", value=2, cost=1,
                   job="J1", decide=None)
        it = self.load("REQ-T-001")
        self.assertEqual([e["event"] for e in it.events], ["registered"])
        self.assertIn("value=2", it.events[0]["econ"])
        self.assertIn("cost=1", it.events[0]["econ"])
        self.assertEqual(wi.validate_items(self.graphs, self.project), [])
        self.assertEqual(wi.econ_unstamped_ids(self.graphs, self.project), [])

    def test_the_FIRST_hand_edit_of_a_minted_aggregate_is_caught(self):
        self._mint(type="requirement", prefix="REQ-T", value=2, decide=None)
        self.edit_frontmatter_by_hand("REQ-T-001", value=5)
        violations = wi.validate_items(self.graphs, self.project)
        self.assertTrue(any(v.startswith("(I10)") for v in violations), violations)


# --------------------------------------------------------------------------- #
# Limb 4 — THE LINE THE READER ACTUALLY READS
#
# The mechanism above is only worth what the tool SAYS about it. On the real ROC
# store the run printed, in this order:
#
#   validate: I10 (definition provenance) NOT ESTABLISHED for 88 aggregate(s) …
#   validate: ROC clean — I1–I4 + I6 + I7 + I8 + I10 all hold …        (exit 0)
#
# 100% of the population unestablished, and the LAST line — the one a CI tail
# and a reader take away — asserts the invariant holds. Both live documents this
# change added say the opposite (`SKILL.md`: "never a pass"; `CONTRACT.md`:
# "never clean"), and v128 records that this very sentence has been quoted all
# session as assurance it does not provide. §17i: cannot-measure is never a pass
# and never a plain fail. I9 was already carved out of that sentence BY NAME;
# I10 had been appended to the list asserted to hold instead.
# --------------------------------------------------------------------------- #
class TestTheSummaryLineDoesNotOverstate(_Drive):

    def summary(self):
        """The LAST line `wi-validate` prints — driven through the real
        subcommand, not through the composer, because the charge was about what
        the tool says rather than about what a helper returns."""
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            wi.cmd_validate(argparse.Namespace(project=self.project))
        lines = [l for l in buf.getvalue().strip().split("\n") if l.strip()]
        return lines[-1]

    def holds_clause(self, line):
        """The part of the sentence that asserts invariants HOLD — the list
        immediately before `all hold`, wherever in the sentence it sits."""
        return line.split(" all hold")[0].split(". ")[-1]

    def test_the_summary_does_NOT_claim_I10_holds_when_an_aggregate_is_unstamped(self):
        """The rejection, in one assertion. The store's only item is an
        aggregate with no stamp, so I10 has nothing to compare — and the
        sentence must not name it among the invariants that hold."""
        self.requirement()
        line = self.summary()
        self.assertNotIn("I10", self.holds_clause(line), line)
        self.assertIn("I10 could NOT be established", line)
        self.assertIn("1 aggregate", line)

    def test_the_summary_DOES_claim_I10_holds_once_every_aggregate_is_stamped(self):
        """Both directions (§F9f): a carve-out that never closes is just a
        permanent disclaimer, and would say nothing about the store either."""
        self.requirement()
        self._append("REQ-T-001", "amended", note="the owner raised it",
                     set=["value=5"])
        line = self.summary()
        self.assertIn("I10", self.holds_clause(line), line)
        self.assertNotIn("I10 could NOT be established", line)

    def test_the_headline_withholds_CLEAN_while_any_invariant_is_unestablished(self):
        """`clean` is the word that gets quoted back. It may only describe a
        store where every invariant was ASKED and answered."""
        self.requirement()
        line = self.summary()
        self.assertNotIn("clean", line, line)
        # …and it is not a plain fail either (§17i): it says what it found.
        self.assertIn("no violation", line)

    def test_an_unestablished_invariant_does_not_turn_the_gate_RED(self):
        """§17i's other half: NOT ESTABLISHED is not a failure. The pull is not
        blocked by a question that could not be asked — it is un-blessed."""
        self.requirement()
        try:
            self.summary()
        except SystemExit as e:                      # pragma: no cover - the bug
            self.fail(f"an unstamped aggregate exited the gate ({e})")

    def test_I9_is_not_claimed_to_hold_when_IT_could_not_be_established_either(self):
        """The generalisation, because one instance was found by accident and
        that says nothing about the rest: NO invariant may appear in the holds
        list while its own check reports NOT ESTABLISHED. The test store is not
        a git repository, so I9 — which compares the working tree against HEAD —
        genuinely cannot be answered here."""
        self.requirement()
        self._append("REQ-T-001", "amended", note="x", set=["value=5"])
        line = self.summary()
        self.assertNotIn("I9", self.holds_clause(line), line)
        self.assertIn("I9 could NOT be established", line)


class TestTheRemedyNamesTheFieldThatMoved(_Drive):
    """A remedy that names the wrong field is a remedy the reader has to
    correct before running it, and the only person who can correct it is the one
    who already knows the answer."""

    def remedy(self, **hand_edit):
        self.requirement()
        self._append("REQ-T-001", "amended", note="x",
                     set=["value=5", "cost=1", "defer_until=2026-09-29"])
        self.edit_frontmatter_by_hand("REQ-T-001", **hand_edit)
        return "\n".join(v for v in wi.validate_items(self.graphs, self.project)
                          if v.startswith("(I10)"))

    def test_a_moved_cost_is_named_in_the_remedy_not_value(self):
        msg = self.remedy(cost=3)
        self.assertIn("SET='cost=3'", msg)
        self.assertNotIn("value=", msg.split("wi-append")[1])

    def test_a_CLEARED_field_is_declared_as_an_empty_value(self):
        msg = self.remedy(defer_until=None)
        self.assertIn("SET='defer_until='", msg)

    def test_two_moved_fields_are_both_named_in_the_order_SET_takes_them(self):
        msg = self.remedy(value=9, job="J4")
        self.assertIn("SET='value=9'", msg)
        self.assertIn("SET2='job=J4'", msg)


class TestWhatI10DoesNotCover(_Drive):
    """THE LIMIT OF AN UNSIGNED STAMP, pinned rather than left for a reader to
    discover. I10 compares the file against the stamp on its own last event, so
    an edit that rewrites BOTH agrees with itself. I9 does not see it either:
    an event's identity is `(ts, event, agent)` deliberately, so a value changed
    INSIDE an already-committed event line is not a dropped event. Git history
    is what remains. This test exists so the contract's statement of the limit
    is executable — if a later change closes the hole, this test fails and the
    contract gets corrected in the same act."""

    def rewrite_the_stamp_too(self, iid, econ):
        path, _sub = wi.find_item_path(self.project, iid)
        it = wi.load_item(path)
        events = [dict(e) for e in it.events]
        events[-1]["econ"] = econ
        fm = dict(it.fm)
        fm["events"] = events
        text = wi.render_item(wi.Item(path, fm, it.body), it.declared or {})
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)

    def test_a_hand_edit_that_also_rewrites_the_stamp_passes_I10(self):
        self.requirement()
        self._append("REQ-T-001", "amended", note="x", set=["value=5"])
        self.edit_frontmatter_by_hand("REQ-T-001", value=9)
        self.assertNotEqual(wi.validate_items(self.graphs, self.project), [])
        self.rewrite_the_stamp_too("REQ-T-001", "value=9 cost=0.5 job=J0 defer_until=-")
        self.assertEqual(wi.validate_items(self.graphs, self.project), [],
                         "I10 is a consistency check against the item's own "
                         "record, not a signature — if this now fails, the "
                         "guarantee grew and CONTRACT.md must say so")


# --------------------------------------------------------------------------- #
# The AGENT-FACING route, end to end
# --------------------------------------------------------------------------- #
class TestTheRealMakeRoute(unittest.TestCase):
    """The Python API is not what an agent runs. A fix that works only when
    called from Python is a fix nobody can reach: the `make` wiring is part of
    the change, so it is driven here against a throwaway project under the real
    (gitignored) `work/`, disjoint from every real one."""

    project = "_WI_AMEND_PROBE"

    def setUp(self):
        self.items = os.path.join(REAL_ROOT, "work", self.project, "items")
        os.makedirs(os.path.join(self.items, "active"), exist_ok=True)
        os.makedirs(os.path.join(self.items, "done"), exist_ok=True)

    def tearDown(self):
        shutil.rmtree(os.path.join(REAL_ROOT, "work", self.project),
                      ignore_errors=True)

    def run_make(self, target, **variables):
        argv = ["make", target] + [f"{k}={v}" for k, v in variables.items()]
        return subprocess.run(argv, cwd=REAL_ROOT, capture_output=True, text=True)

    def mint_requirement(self):
        r = self.run_make("wi-mint", PROJECT=self.project, TYPE="requirement",
                          PREFIX="REQ-PROBE", TITLE="a probe requirement",
                          JOB="J0", VALUE="2", COST="1", LANE="parent-repo",
                          AGENT="flow-manager")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return os.path.join(self.items, "active", "REQ-PROBE-001.md")

    def test_amending_an_aggregate_through_make_works_and_validates_clean(self):
        path = self.mint_requirement()
        r = self.run_make("wi-append", PROJECT=self.project, ID="REQ-PROBE-001",
                          EVENT="amended", AGENT="orchestrator",
                          SET="value=5", SET2="defer_until=",
                          NOTE="a second independent ask for the same thing")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        it = wi.load_item(path)
        self.assertEqual(it.fm["value"], 5)
        self.assertEqual([e["event"] for e in it.events],
                         ["registered", "amended"])
        v = self.run_make("wi-validate", PROJECT=self.project)
        self.assertEqual(v.returncode, 0, v.stdout + v.stderr)
        self.assertIn("I10", v.stdout)

    def test_a_hand_edit_through_the_real_gate_FAILS_it(self):
        path = self.mint_requirement()
        text = read(path).replace("value: 2", "value: 9")
        with io.open(path, "w", encoding="utf-8") as f:
            f.write(text)
        v = self.run_make("wi-validate", PROJECT=self.project)
        self.assertNotEqual(v.returncode, 0,
                            "the gate passed a forged definition change")
        self.assertIn("(I10)", v.stdout + v.stderr)

    def test_the_gate_does_not_report_a_store_CLEAN_with_an_unstamped_aggregate(self):
        """THE TESTER'S MINIMAL REPRO, driven through the route a CI tail reads.

        A store whose only item is one aggregate with no stamp: the gate printed
        the NOT-ESTABLISHED line and then, unconditionally, `clean — … I10 all
        hold`, exit 0. 100% of the population unestablished, and the last line
        asserting the invariant holds."""
        path = self.mint_requirement()
        # …as every aggregate registered before this machinery existed looks:
        it = wi.load_item(path)
        events = [{k: v for k, v in e.items() if k != "econ"} for e in it.events]
        fm = dict(it.fm, events=events)
        with io.open(path, "w", encoding="utf-8") as f:
            f.write(wi.render_item(wi.Item(path, fm, it.body), it.declared or {}))

        v = self.run_make("wi-validate", PROJECT=self.project)
        # §17i — never a plain fail: an unaskable question does not block.
        self.assertEqual(v.returncode, 0, v.stdout + v.stderr)
        self.assertIn("NOT ESTABLISHED", v.stdout)
        last = [l for l in v.stdout.strip().split("\n") if l.strip()][-1]
        self.assertNotIn("I10", last.split(" all hold")[0].split(". ")[-1], last)
        self.assertNotIn("clean", last, last)

    def test_a_flow_event_on_an_aggregate_is_still_refused_through_make(self):
        self.mint_requirement()
        r = self.run_make("wi-append", PROJECT=self.project, ID="REQ-PROBE-001",
                          EVENT="pulled", AGENT="orchestrator")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("aggregate", r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
