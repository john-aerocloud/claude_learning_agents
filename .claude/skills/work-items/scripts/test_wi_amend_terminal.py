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
"""
import io
import os
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

    FLOW_EVENTS = ("pulled", "triaged", "confirmed", "fixed", "built_green",
                   "deployed", "validated", "rejected", "made_ready", "closed",
                   "blocked", "cancelled", "reopened", "retried", "declined",
                   "not_reproduced", "build_failed", "deploy_failed")

    def _graph_events_from(self, itype, state):
        return {t["event"] for t in self.graphs.transitions(itype)
                if t["from"] == state}

    def test_every_flow_event_is_still_refused_from_every_terminal_state(self):
        """A FRESH item per attempt, deliberately. The first version of this test
        reused one item and its `reopened` attempt SUCCEEDED — `use-case`/`done`
        really does carry a reopen edge — after which every later event was being
        judged from `building`. A back-door test that silently walks the item out
        of the state it is testing proves nothing at all."""
        for itype, term in self.terminal_pairs():
            legal = self._graph_events_from(itype, term)
            for event in self.FLOW_EVENTS:
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


if __name__ == "__main__":
    unittest.main()
