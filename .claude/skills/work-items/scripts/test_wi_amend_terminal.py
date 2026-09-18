#!/usr/bin/env python3
"""DEF-ROC-261 — a RESOLVED item's record must be correctable.

WHAT HAPPENED. Two established corrections to `DEF-ROC-248` could not be recorded:

    event 'amended' is not a legal transition from 'resolved'.
    legal events from here: (none — terminal state)

`resolved` offered no legal events at all, so there was no way to correct a
resolved item's record through the machinery — and `SKILL.md`'s own rule is that
material changes are `amended` events, **never silent edits**. The only two
options left were leave-it-wrong and break-the-contract.

THE ARGUMENT IS ALREADY CONCEDED ONE EDGE OVER. `DEF-ROC-238` fixed exactly this
shape on aggregates: `amended` was refused because `kind == aggregate` was tested
before any event-name check, and the ruling is that **`amended` was never a state
transition** — it is a self-edge that changes nothing and exists purely so a
definition change leaves a trace. Refusing it conflates STATE with AUDIT. **A
terminal state is the same conflation.** `resolved` correctly admits no FLOW
event — the work is done and nothing may restart it silently — but it does not
follow that the RECORD is sealed.

AND IT IS THE `I10` REASONING, NOT THE `amended` REASONING, THAT DEF-ROC-238's
TESTER PUT THE OTHER WAY. Extending I10 (definition provenance) to flow items
would have been the `DEF-ROC-083` unsatisfiable gate, precisely because a flow
item DOES have a terminal state and so a divergence would be unfixable for ever.
That is an argument about a GATE that demands a write, not about whether a write
is possible. This item makes the write possible; it adds no gate.

HOW THE FIX AVOIDS BEING A BACK DOOR, which is the constraint that shaped it. The
edge is NOT added to `state-graphs.json`. `amended` from a terminal state is
recognised by ONE predicate — `is_audit_self_edge` — and everything else in the
machinery reads the GRAPH:

  * `fold_state` skips an event no transition carries, so the state cannot move;
  * `walk_states` skips it too, so `time_in_state` is untouched;
  * the only pre-existing way out of a terminal state (a `use-case` `reopened`
    from `done`) is a deliberate flow edge, untouched and PINNED here, so a
    later edge out of a terminal state has to come past this module;
  * `_maybe_relocate` sees the same terminal state, so the file stays in `done/`.

So the DORA derivation is unchanged BY CONSTRUCTION rather than by care — and it
is measured here anyway, because "by construction" is a claim like any other.

WHAT IS PINNED:
  1. `amended` is accepted from EVERY terminal state of EVERY flow type,
     enumerated FROM THE GRAPH so a new terminal state cannot be silently missed;
  2. the state does not move, the queue stays null, the file stays in `done/`;
  3. every FLOW event is still refused from a terminal state (§F9f — a control
     seen only permitting proves nothing);
  4. this fix adds NO edge to the state graph, so "cannot reopen" is a property
     of the data rather than a promise in a comment — and the ONE edge that does
     leave a terminal state is pinned by value, not assumed absent;
  5. the DORA derivation — gross lead time, cycle time, MTTR, recovery,
     time-in-state, and the whole `dora` block — is byte-identical across the
     append, and the ONLY figure that moves anywhere in the projection is the
     raw count of events, asserted as a whitelist so a later change that moves a
     real metric fails here;
  6. `wi-validate` stays clean afterwards: I1 replays history through the SAME
     predicate the writer used, so an event that was legal to write is legal to
     re-read;
  7. the two `DEF-ROC-248` corrections this item was blocked on can actually be
     recorded, with their notes landing verbatim.

DEF-ROC-291 — AND THE REFUSAL MESSAGE HAD TO FOLLOW.

The fix above made `amended` legal from every terminal state; the refusal that a
terminal state prints did not change, so it still said

    legal events from here: (none — terminal state)

**which is false about the tool that prints it.** It is the EXACT SENTENCE that
caused this item to be registered: the orchestrator hit a refusal on a `resolved`
item, read it, concluded the record was sealed, and raised a defect. It was right
then; the same reading is now wrong in the OPPOSITE direction, so an agent that
needs to correct a terminal item's record reads that it cannot, and will register
a defect or abandon the correction.

The listing is computed FROM THE STATE GRAPH, which by design cannot see
`is_audit_self_edge` — and that separation is precisely what keeps this change
from being a back door. So the refusal builder consults the same predicate the
writer consults; NO edge is added to the graph, which is asserted here from the
graph itself rather than promised.

  8. a refusal from a terminal state NAMES `amended` and says what it is FOR —
     correcting the record, not advancing it — while the flow listing still
     offers only the edges the GRAPH carries (both directions), a refusal from a
     LIVE state is unchanged, and amending the record does not reopen the flow.
"""
import io
import os
import re
import copy
import json
import shutil
import argparse
import tempfile
import unittest
import contextlib
import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
REAL_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))

_spec = importlib.util.spec_from_file_location(
    "work_items_amendterm", os.path.join(HERE, "work-items.py"))
wi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(wi)

NOW = wi.parse_ts("2026-09-20T00:00:00Z")

# One log per terminal state, written the way the machinery would have written it.
TERMINAL_LOGS = {
    ("defect", "resolved"): [
        ("2026-09-01T00:00:00Z", "reported", "orchestrator"),
        ("2026-09-01T01:00:00Z", "triaged", "orchestrator"),
        ("2026-09-01T02:00:00Z", "pulled", "orchestrator"),
        ("2026-09-01T03:00:00Z", "confirmed", "engineer"),
        ("2026-09-01T04:00:00Z", "fixed", "engineer"),
        ("2026-09-01T05:00:00Z", "validated", "tester"),
    ],
    ("defect", "wontfix"): [
        ("2026-09-01T00:00:00Z", "reported", "orchestrator"),
        ("2026-09-01T01:00:00Z", "triaged", "orchestrator"),
        ("2026-09-01T02:00:00Z", "pulled", "orchestrator"),
        ("2026-09-01T03:00:00Z", "not_reproduced", "engineer"),
    ],
    ("defect", "cancelled"): [
        ("2026-09-01T00:00:00Z", "reported", "orchestrator"),
        ("2026-09-01T01:00:00Z", "cancelled", "orchestrator"),
    ],
    ("use-case", "done"): [
        ("2026-09-01T00:00:00Z", "registered", "flow-manager"),
        ("2026-09-01T01:00:00Z", "made_ready", "flow-manager"),
        ("2026-09-01T02:00:00Z", "pulled", "orchestrator"),
        ("2026-09-01T03:00:00Z", "built_green", "engineer"),
        ("2026-09-01T04:00:00Z", "deployed", "cicd"),
        ("2026-09-01T05:00:00Z", "validated", "tester"),
    ],
    ("use-case", "cancelled"): [
        ("2026-09-01T00:00:00Z", "registered", "flow-manager"),
        ("2026-09-01T01:00:00Z", "cancelled", "flow-manager"),
    ],
    ("open-item", "done"): [
        ("2026-09-01T00:00:00Z", "open", "orchestrator"),
        ("2026-09-01T01:00:00Z", "closed", "orchestrator"),
    ],
    ("open-item", "wontfix"): [
        ("2026-09-01T00:00:00Z", "open", "orchestrator"),
        ("2026-09-01T01:00:00Z", "declined", "orchestrator"),
    ],
    ("open-item", "cancelled"): [
        ("2026-09-01T00:00:00Z", "open", "orchestrator"),
        ("2026-09-01T01:00:00Z", "cancelled", "orchestrator"),
    ],
}


class Store(unittest.TestCase):
    """A throwaway item store under a temp ROOT, driving the REAL writers."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="wi-amendterm-")
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

    def _items(self, sub):
        return os.path.join(self.tmp, "work", self.project, "items", sub)

    def terminal_item(self, iid, itype="defect", state="resolved"):
        """An item ALREADY in a terminal state, living in items/done/ as I4
        requires, with a `derived:` block rendered by the machinery."""
        events = [{"ts": ts, "event": ev, "agent": ag}
                  for ts, ev, ag in TERMINAL_LOGS[(itype, state)]]
        fm = {"id": iid, "type": itype, "title": iid, "job": "J0",
              "value": 1, "cost": 0.5, "parents": [], "deps": [],
              "created_ts": events[0]["ts"], "events": events}
        item = wi.Item(os.path.join(self._items("done"), f"{iid}.md"), fm,
                       "\n## Definition\nstub\n")
        with open(item.path, "w", encoding="utf-8") as f:
            f.write(wi.render_item(item, {"state": None, "queue": None,
                                          "children": [], "ancestors": []}))
        items, _d = wi.load_all_items(self.project)
        states = wi.compute_states(self.graphs, items)
        children = wi.compute_children(items)
        dv = wi.derived_block(self.graphs, items, states, children, iid)
        with open(item.path, "w", encoding="utf-8") as f:
            f.write(wi.render_item(items[iid], dv))
        self.assertEqual(states[iid], state, "fixture is not in the state claimed")
        return item.path

    def load(self, iid):
        path, _sub = wi.find_item_path(self.project, iid)
        return wi.load_item(path)

    def append(self, iid, event, agent="orchestrator", note=None,
               ts="2026-09-17T12:00:00Z", **kw):
        ns = argparse.Namespace(project=self.project, id=iid, event=event,
                                agent=agent, ref=None, note=note, ts=ts,
                                tokens=None, duration_ms=None, observe=None,
                                probe=None, note_file=None, owner=None, set=None)
        for k, v in kw.items():
            setattr(ns, k, v)
        with contextlib.redirect_stdout(io.StringIO()):
            return wi.cmd_append(ns)

    def append_expecting_refusal(self, iid, event, **kw):
        err = io.StringIO()
        with self.assertRaises(SystemExit) as cm, \
                contextlib.redirect_stdout(io.StringIO()), \
                contextlib.redirect_stderr(err):
            self.append(iid, event, **kw)
        return err.getvalue() + str(cm.exception)

    def _graph_events_of(self, itype):
        """Every event the GRAPH carries for this type, derived rather than
        listed, so an event added later is probed without anyone remembering."""
        return {t["event"] for t in self.graphs.transitions(itype)}

    def _graph_events_from(self, itype, state):
        """The events the GRAPH carries OUT of one state — the `legal_here` set
        the refusal listing is built from."""
        return {t["event"] for t in self.graphs.transitions(itype)
                if t["from"] == state}

    def terminal_pairs(self):
        """Every (type, terminal state) the GRAPH declares for a flow type.

        Enumerated from the contract, not from a literal, so a terminal state
        added later cannot silently escape these tests — the failure mode the
        item named ("check `cancelled` and every sibling, not just the one I
        happened to hit")."""
        pairs = []
        for itype in sorted(self.graphs.types):
            if self.graphs.kind(itype) != "flow":
                continue
            for term in sorted(self.graphs.terminals(itype)):
                pairs.append((itype, term))
        return pairs


# --------------------------------------------------------------------------- #
# Limb 1 — the record is correctable from every terminal state
# --------------------------------------------------------------------------- #
class TestAmendedIsAcceptedFromATerminalState(Store):

    def test_the_fixtures_cover_every_terminal_state_the_graph_declares(self):
        """NON-VACUITY, and the completeness this item explicitly asked for."""
        self.assertEqual(sorted(self.terminal_pairs()),
                         sorted(TERMINAL_LOGS.keys()))

    def test_amended_is_recorded_from_every_terminal_state(self):
        for itype, term in self.terminal_pairs():
            with self.subTest(type=itype, state=term):
                iid = f"X-{itype}-{term}".upper()
                self.terminal_item(iid, itype, term)
                before = [e["event"] for e in self.load(iid).events]
                self.append(iid, wi.AMENDED, note="the record was wrong: …")
                after = self.load(iid)
                self.assertEqual([e["event"] for e in after.events],
                                 before + [wi.AMENDED])
                self.assertEqual(after.events[-1]["note"],
                                 "the record was wrong: …")

    def test_the_state_does_not_move_and_the_queue_stays_null(self):
        for itype, term in self.terminal_pairs():
            with self.subTest(type=itype, state=term):
                iid = f"S-{itype}-{term}".upper()
                self.terminal_item(iid, itype, term)
                self.append(iid, wi.AMENDED, note="a correction to the record")
                items, _d = wi.load_all_items(self.project)
                states = wi.compute_states(self.graphs, items)
                self.assertEqual(states[iid], term, "the self-edge MOVED state")
                self.assertIsNone(self.graphs.queue_for(states[iid]))
                self.assertEqual(items[iid].declared.get("state"), term)
                self.assertIsNone(items[iid].declared.get("queue"))

    def test_the_file_stays_in_done(self):
        """A relocation back to active/ would be a reopen by another name."""
        self.terminal_item("DEF-STAY")
        self.append("DEF-STAY", wi.AMENDED, note="a correction to the record")
        _path, sub = wi.find_item_path(self.project, "DEF-STAY")
        self.assertEqual(sub, "done")

    def test_the_two_DEF_ROC_248_corrections_can_be_recorded(self):
        """The acceptance test named on the item: two established corrections
        that had no route into the record at all."""
        self.terminal_item("DEF-248")
        one = ("The headline claim is NOT supported. The literal token `x` was "
               "the message passed, so limb 1b — the one-token outcome guard — "
               "is the limb that carries the wild instance, not limb 1.")
        two = ("`lane: project-repo` in this item's frontmatter is WRONG: the "
               "work was entirely parent-repo. `make dispatch-check` fails "
               "CLOSED on lane, which is DEFECT-OAG-076.")
        self.append("DEF-248", wi.AMENDED, note=one, ts="2026-09-17T12:00:00Z")
        self.append("DEF-248", wi.AMENDED, note=two, ts="2026-09-17T12:01:00Z")
        notes = [e.get("note") for e in self.load("DEF-248").events
                 if e["event"] == wi.AMENDED]
        self.assertEqual(notes, [one, two])
        self.assertEqual(wi.validate_items(self.graphs, self.project), [])


# --------------------------------------------------------------------------- #
# Limb 2 — it is not a back door (§F9f: a control seen only permitting proves
# nothing, so both directions are driven)
# --------------------------------------------------------------------------- #
class TestNothingElseGetsThroughATerminalState(Store):

    def flow_events(self, _itype=None):
        """Every event ANY flow type declares, MINUS the audit self-edge —
        derived from the graph, never listed [DEF-ROC-291, tester].

        This was a hand-written tuple of 18 names sitting beside a
        `terminal_pairs()` that was already graph-derived, and the two had
        drifted: the graph declares 25 and SIX were never probed here
        (`dev_validated`, `not_yet_observed`, `promoted`,
        `pulled_for_validation`, `scheduled`, `unblocked`). The writer refuses
        all six correctly — measured before this changed — so nothing was
        broken; but a safety test whose event set is maintained separately from
        the graph it protects is the same two-copies shape as the defect it was
        written for, and the next event added to the graph is the one it would
        have missed.

        The UNION across flow types rather than the events of THIS type, so the
        breadth of the old literal is kept: an event a type does not declare at
        all must still be refused, and dropping those would have traded six new
        probes for fifty lost ones.
        """
        out = set()
        for itype in self.graphs.types:
            if self.graphs.kind(itype) != "flow":
                continue
            out |= self._graph_events_of(itype)
        return sorted(out - {wi.AMENDED})

    def test_every_flow_event_is_still_refused_from_every_terminal_state(self):
        """A FRESH item per attempt, deliberately. The first version of this test
        reused one item and its `reopened` attempt SUCCEEDED — `use-case`/`done`
        really does carry a reopen edge — after which every later event was being
        judged from `building`. A back-door test that silently walks the item out
        of the state it is testing proves nothing at all."""
        for itype, term in self.terminal_pairs():
            legal = self._graph_events_from(itype, term)
            for event in self.flow_events(itype):
                if event in legal:
                    continue          # a pre-existing edge, untouched by this fix
                with self.subTest(type=itype, state=term, event=event):
                    iid = f"R-{itype}-{term}-{event}".upper()
                    self.terminal_item(iid, itype, term)
                    before = [e["event"] for e in self.load(iid).events]
                    msg = self.append_expecting_refusal(iid, event)
                    self.assertIn("not a legal transition", msg)
                    self.assertEqual([e["event"] for e in self.load(iid).events],
                                     before, f"{event} CHANGED the log")

    def test_this_fix_adds_NO_edge_out_of_any_terminal_state(self):
        """`cannot reopen` is a property of the DATA, not a promise in a comment.
        The fix deliberately adds nothing to `state-graphs.json`: `amended` from a
        terminal state is recognised by ONE predicate in the writer, and every
        derivation (fold, walk, relocation, metrics) reads the GRAPH — so if the
        graph has no way out, there is no way out.

        The one pre-existing way out is PINNED rather than asserted away: a
        `use-case` in `done` can be `reopened` into `building`, which is a
        deliberate flow edge and is not this item's to change. Pinning it means a
        LATER edge out of a terminal state has to come past this test."""
        found = {(itype, t["from"], t["event"], t["to"])
                 for itype, term in self.terminal_pairs()
                 for t in self.graphs.transitions(itype) if t["from"] == term}
        self.assertEqual(found, {("use-case", "done", "reopened", "building")})
        self.assertNotIn(wi.AMENDED, {ev for _t, _f, ev, _to in found})

    def test_the_fold_ignores_the_audit_self_edge(self):
        """Not merely "the state happens to be the same": the fold does not see
        the event at all, which is why nothing downstream can be moved by it."""
        for itype, term in self.terminal_pairs():
            with self.subTest(type=itype, state=term):
                events = [{"ts": ts, "event": ev, "agent": ag}
                          for ts, ev, ag in TERMINAL_LOGS[(itype, term)]]
                amended = events + [{"ts": "2026-09-17T12:00:00Z",
                                     "event": wi.AMENDED, "agent": "engineer"}]
                self.assertEqual(wi.fold_state(self.graphs, itype, amended),
                                 wi.fold_state(self.graphs, itype, events))

    def test_a_flow_item_still_cannot_change_its_economics_through_the_amendment(self):
        """`--set` rides an aggregate's amendment only [DEF-ROC-238]. Making the
        record correctable must not quietly widen that."""
        self.terminal_item("DEF-SET")
        msg = self.append_expecting_refusal("DEF-SET", wi.AMENDED,
                                            set=["value=9"], note="n")
        self.assertIn("AGGREGATE", msg)
        self.assertEqual(self.load("DEF-SET").fm.get("value"), 1)


# --------------------------------------------------------------------------- #
# Limb 3 — the DORA derivation is SHOWN unchanged, not assumed to be
# --------------------------------------------------------------------------- #
class TestTheDerivationIsUntouched(Store):

    def _metrics(self, iid):
        return wi.per_item_metrics(self.graphs, self.load(iid), NOW)

    def _stats(self):
        items, _d = wi.load_all_items(self.project)
        states = wi.compute_states(self.graphs, items)
        s = wi.compute_stats(self.graphs, items, states, NOW)
        s.pop("generated", None)
        s.pop("reference_now", None)
        return s

    def test_every_per_item_metric_is_identical_across_the_amendment(self):
        for itype, term in self.terminal_pairs():
            with self.subTest(type=itype, state=term):
                iid = f"M-{itype}-{term}".upper()
                self.terminal_item(iid, itype, term)
                before = copy.deepcopy(self._metrics(iid))
                self.append(iid, wi.AMENDED, note="a correction to the record",
                            agent="engineer")
                self.assertEqual(self._metrics(iid), before)

    def test_the_terminal_timestamp_that_drives_lead_time_and_MTTR_does_not_move(self):
        self.terminal_item("DEF-TS")
        before = wi._terminal_ts(self.load("DEF-TS"))
        # an amendment landing LONG after the terminal event is the hazard case
        self.append("DEF-TS", wi.AMENDED, note="a correction to the record",
                    ts="2026-09-19T23:00:00Z")
        self.assertEqual(wi._terminal_ts(self.load("DEF-TS")), before)

    @staticmethod
    def _flat(d, pre=""):
        out = {}
        for k, v in d.items():
            if isinstance(v, dict):
                out.update(TestTheDerivationIsUntouched._flat(v, pre + k + "."))
            else:
                out[pre + k] = v
        return out

    def test_the_only_figure_the_amendment_MOVES_is_the_raw_event_COUNT(self):
        """MEASURED, not assumed — the item asked for the derivation to be SHOWN
        unchanged across such an append rather than argued to be.

        Every DORA figure is identical: lead time (median and p85), MTTR, change
        failure rate, deployment frequency, gross lead time and its by-state /
        by-owner decomposition, quality and recovery. The ONLY fields that move
        are `token_cost.n_events`, the raw count of events in the store, which
        rose by exactly the number of amendments because that many events were
        genuinely recorded. It is the denominator of `token_coverage` — and
        `token_coverage` itself does not move here because these fixtures carry
        no token values at all, so the enumeration below is the honest claim
        rather than a rounder one.

        The exhaustive form is the point: it is a WHITELIST of what may move, so
        a later change that moves a real metric fails this test instead of
        slipping through an assertion about the two or three fields someone
        thought to name."""
        ids = [f"D-{itype}-{term}".upper() for itype, term in sorted(TERMINAL_LOGS)]
        for (itype, term), iid in zip(sorted(TERMINAL_LOGS), ids):
            self.terminal_item(iid, itype, term)
        before = self._flat(self._stats())
        for iid in ids:
            self.append(iid, wi.AMENDED, note="a correction to the record",
                        ts="2026-09-19T23:00:00Z")
        after = self._flat(self._stats())

        moved = {k: (before.get(k), after.get(k))
                 for k in sorted(set(before) | set(after))
                 if before.get(k) != after.get(k)}
        self.assertEqual(sorted(moved), sorted(
            k for k in before if k.endswith("token_cost.n_events")),
            f"a figure other than the raw event count moved: {moved}")
        for k, (b, a) in moved.items():
            self.assertGreater(a, b, k)

    def test_the_DORA_block_itself_is_byte_identical(self):
        """The narrower, load-bearing half of the assertion above, stated on its
        own so the reason this item's constraint is met is not buried in a
        whitelist: `resolved` timestamps drive lead time and MTTR, and an audit
        self-edge landing AFTER them moves neither."""
        ids = [f"E-{itype}-{term}".upper() for itype, term in sorted(TERMINAL_LOGS)]
        for (itype, term), iid in zip(sorted(TERMINAL_LOGS), ids):
            self.terminal_item(iid, itype, term)
        before = json.dumps(self._stats()["overall"]["dora"], sort_keys=True)
        for iid in ids:
            self.append(iid, wi.AMENDED, note="a correction to the record",
                        ts="2026-09-19T23:00:00Z")
        self.assertEqual(
            json.dumps(self._stats()["overall"]["dora"], sort_keys=True), before)

    def test_time_in_state_is_not_extended_by_the_amendment(self):
        """The subtlest way an audit event could move a number: a later event
        reopening the final segment. `walk_states` skips an event no transition
        carries, so it cannot."""
        self.terminal_item("DEF-TIS")
        before = dict(self._metrics("DEF-TIS")["time_in_state"])
        self.append("DEF-TIS", wi.AMENDED, note="a correction to the record",
                    ts="2026-09-19T23:00:00Z")
        self.assertEqual(self._metrics("DEF-TIS")["time_in_state"], before)


# --------------------------------------------------------------------------- #
# Limb 4 — the gate reads history through the SAME predicate the writer used
# --------------------------------------------------------------------------- #
class TestValidateAcceptsWhatAppendWrote(Store):

    def test_wi_validate_is_clean_after_an_amendment_from_every_terminal_state(self):
        """An event that was LEGAL TO WRITE must be legal to re-read. I1 replays
        every historical event against the current rights/legality model, so a
        writer and a validator that disagree would leave the store permanently
        dirty the moment anyone used the new route."""
        for itype, term in self.terminal_pairs():
            iid = f"V-{itype}-{term}".upper()
            self.terminal_item(iid, itype, term)
            self.append(iid, wi.AMENDED, note="a correction to the record",
                        agent="engineer")
        self.assertEqual(wi.validate_items(self.graphs, self.project), [])

    def test_an_ILLEGAL_event_in_a_terminal_log_is_still_an_I1_violation(self):
        """NON-VACUITY: the I1 replay was widened for ONE event, not switched
        off. A hand-edited `reopened` after `validated` is still caught."""
        path = self.terminal_item("DEF-BAD")
        it = wi.load_item(path)
        fm = dict(it.fm)
        fm["events"] = it.events + [{"ts": "2026-09-19T00:00:00Z",
                                     "event": "reopened", "agent": "engineer"}]
        with open(path, "w", encoding="utf-8") as f:
            f.write(wi.render_item(wi.Item(path, fm, it.body), it.declared or {}))
        v = wi.validate_items(self.graphs, self.project)
        self.assertTrue(any("(I1)" in x and "reopened" in x for x in v), v)


# --------------------------------------------------------------------------- #
# Limb 5 — the refusal LISTING is true of the tool that prints it [DEF-ROC-291]
# --------------------------------------------------------------------------- #
class TestTheRefusalListingIsTrueOfItsOwnTool(Store):
    """The listing is read ALONE, as the tool's own account of what it accepts
    next — which is why a false one costs a whole defect cycle each way."""

    def _refuse_from(self, itype, term, prefix, event="pulled"):
        iid = f"{prefix}-{itype}-{term}".upper()
        self.terminal_item(iid, itype, term)
        return iid, self.append_expecting_refusal(iid, event)

    def _listing(self, msg):
        """The `legal events from here:` line and nothing else — the sentence
        under test, read as its own line so a claim made elsewhere in the
        refusal cannot be mistaken for one made here."""
        lines = [l for l in msg.splitlines() if "legal events from here:" in l]
        self.assertEqual(len(lines), 1, msg)
        return lines[0]

    def live_item(self, iid="DEF-LIVE"):
        """An item in a LIVE state, for the other direction. `scheduled` is
        chosen because `amended` is an ORDINARY GRAPH EDGE from there, so the
        terminal-state sentence would be redundant and misleading."""
        events = [{"ts": "2026-09-01T00:00:00Z", "event": "reported",
                   "agent": "orchestrator"},
                  {"ts": "2026-09-01T01:00:00Z", "event": "triaged",
                   "agent": "orchestrator"}]
        fm = {"id": iid, "type": "defect", "title": iid, "job": "J0",
              "value": 1, "cost": 0.5, "parents": [], "deps": [],
              "created_ts": events[0]["ts"], "events": events}
        item = wi.Item(os.path.join(self._items("active"), f"{iid}.md"), fm,
                       "\n## Definition\nstub\n")
        with open(item.path, "w", encoding="utf-8") as f:
            f.write(wi.render_item(item, {"state": None, "queue": None,
                                          "children": [], "ancestors": []}))
        items, _d = wi.load_all_items(self.project)
        states = wi.compute_states(self.graphs, items)
        children = wi.compute_children(items)
        with open(item.path, "w", encoding="utf-8") as f:
            f.write(wi.render_item(items[iid], wi.derived_block(
                self.graphs, items, states, children, iid)))
        self.assertEqual(states[iid], "scheduled")
        return iid

    def test_the_false_sentence_is_GONE_from_every_terminal_state(self):
        """The measured symptom, and the reason this was registered rather than
        noted: this literal sentence caused DEF-ROC-261 to be raised."""
        for itype, term in self.terminal_pairs():
            with self.subTest(type=itype, state=term):
                _iid, msg = self._refuse_from(itype, term, "F")
                self.assertNotIn("(none — terminal state)", msg,
                                 "the refusal still claims NOTHING is legal "
                                 "from here, which is false about its own tool")

    def test_a_terminal_refusal_NAMES_amended_and_says_what_it_is_FOR(self):
        for itype, term in self.terminal_pairs():
            with self.subTest(type=itype, state=term):
                _iid, msg = self._refuse_from(itype, term, "N")
                self.assertIn(wi.AMENDED, msg,
                              "the one event that IS legal here is unnamed")
                self.assertIn("record", msg,
                              "it names the event without saying what it is "
                              "for — correcting the record, not advancing it")
                self.assertRegex(msg, r"EVENT=" + wi.AMENDED,
                                 "a refusal that names a remedy gives the "
                                 "command that applies it")

    def test_amended_is_NOT_offered_as_an_ordinary_next_STEP(self):
        """It is an audit self-edge, not progress. A listing that offers it
        alongside flow events invites it to be used as one, so it carries its
        own sentence and stays out of the flow list."""
        for itype, term in self.terminal_pairs():
            with self.subTest(type=itype, state=term):
                _iid, msg = self._refuse_from(itype, term, "O")
                self.assertNotIn(wi.AMENDED, self._listing(msg))

    def test_the_listing_offers_EXACTLY_the_edges_the_GRAPH_carries(self):
        """BOTH DIRECTIONS (§F9f), and the constraint the item set: the message
        changing must not change what is offered. Every event the graph carries
        for the type is probed — the one real edge out of a terminal state
        (`use-case` `done` -> `reopened`) must still be offered, and every other
        flow event must still be absent."""
        for itype, term in self.terminal_pairs():
            legal = self._graph_events_from(itype, term)
            _iid, msg = self._refuse_from(itype, term, "G")
            listing = self._listing(msg)
            for event in sorted(self._graph_events_of(itype)):
                if event == wi.AMENDED:
                    continue                    # its own sentence, above
                with self.subTest(type=itype, state=term, event=event):
                    pattern = r"\b" + re.escape(event) + r"\b"
                    if event in legal:
                        self.assertRegex(listing, pattern,
                                         "a real edge stopped being offered")
                    else:
                        self.assertNotRegex(listing, pattern,
                                            "an illegal event is offered")

    def test_a_refusal_from_a_LIVE_state_is_UNCHANGED(self):
        """The other direction. From `scheduled`, `amended` is an ordinary graph
        edge and is ALREADY in the listing, so the terminal-state sentence must
        not be printed: a message that says the same thing everywhere says
        nothing, and the value of the listing is being short and true."""
        iid = self.live_item()
        msg = self.append_expecting_refusal(iid, "triaged")
        listing = self._listing(msg)
        self.assertRegex(listing, r"\b" + wi.AMENDED + r"\b",
                         "the ordinary graph edge stopped being offered")
        self.assertNotIn("terminal state", msg)
        self.assertNotIn("record", msg)

    def test_amending_the_record_does_NOT_reopen_the_flow(self):
        """The attempt the new wording might tempt: `amended` is available, so
        perhaps the item carries on from there. It does not — the fold cannot see
        the audit self-edge, so the state after an amendment is the SAME terminal
        state and every flow event is still refused at exit 1."""
        for itype, term in self.terminal_pairs():
            with self.subTest(type=itype, state=term):
                iid = f"T-{itype}-{term}".upper()
                self.terminal_item(iid, itype, term)
                self.append(iid, wi.AMENDED, note="a correction to the record")
                msg = self.append_expecting_refusal(iid, "pulled")
                self.assertIn("not a legal transition", msg)
                self.assertIn(f"state '{term}'", msg)

    def test_the_listings_honesty_is_NOT_bought_with_a_GRAPH_EDGE(self):
        """The constraint that shaped DEF-ROC-261, re-asserted for the message:
        the graph must STILL refuse `amended` from every terminal state, read
        through the same graph-reading function the listing is built from. If
        the listing became true by adding an edge, the state could move — and
        `wi-validate`, `fold_state`, `walk_states`, `_maybe_relocate` and the
        metrics would all follow it out of the terminal state."""
        for itype, term in self.terminal_pairs():
            with self.subTest(type=itype, state=term):
                owners = self.graphs.default_owners(itype) \
                    if hasattr(self.graphs, "default_owners") else None
                offered = {ev for ev, _to, _ags
                           in self.graphs.legal_from(itype, term, owners or set())}
                self.assertNotIn(wi.AMENDED, offered,
                                 "an edge was added to state-graphs.json")

    def test_the_four_SMUGGLES_still_fail(self):
        """Driven by DEF-ROC-261's tester and pinned here, because they are what
        makes the amendment an AUDIT record rather than a route: `--set` on a
        flow item's economics, on its derived STATE, on its TYPE, and a flow
        event after an amendment. All four exit 1 and leave the record as it
        was."""
        iid = "DEF-SMUGGLE"
        self.terminal_item(iid)
        before = self.load(iid)
        for spec in ("value=9", "state=building", "type=use-case"):
            with self.subTest(set=spec):
                msg = self.append_expecting_refusal(iid, wi.AMENDED,
                                                    set=[spec], note="n")
                self.assertTrue("AGGREGATE" in msg or "may only change" in msg,
                                msg)
        self.append(iid, wi.AMENDED, note="a correction to the record")
        msg = self.append_expecting_refusal(iid, "reopened")
        self.assertIn("not a legal transition", msg)
        after = self.load(iid)
        self.assertEqual(after.fm.get("value"), before.fm.get("value"))
        self.assertEqual(after.fm.get("type"), before.fm.get("type"))
        self.assertEqual([e["event"] for e in after.events],
                         [e["event"] for e in before.events] + [wi.AMENDED])


if __name__ == "__main__":
    unittest.main()
