#!/usr/bin/env python3
"""OI-ROC-029 / §F9i — DECIDING an item must not consume a WIP slot; only STARTING work does.

THE RECORDED INSTANCE (2026-09-16). `make loop-gate PROJECT=ROC` reported **BLOCKED —
`wip depth 11 > wip_limit 8`** while `ListAgents` showed **zero agents running**. Nine of
the eleven occupied slots were defects that had been registered, analysed and never
dispatched: `DEF-ROC-190, -192, -201, -205, -220, -221, -224, -225` each had an event log
of exactly `reported, triaged` and nothing else — no engineer had ever touched one.

THE MECHANISM, and it is NOT a bad habit. The `defect` graph had exactly one edge out of
its initial state, `reported --(triaged)--> reproducing`, and `queue_map` puts
`reproducing` in **wip**. Meanwhile loop-gate check 17 (`undecided-arrival`, §F9b) BLOCKS
the pull on any finding registered this cycle that has not been decided, and names
`--event triaged` as the remedy in as many words. So the substrate contained two blocking
gates in direct mechanical opposition: honour §F9b and the WIP cap gets worse; honour the
cap and findings go undecided. The orchestrator was obeying the instruction it was given.
`process/process-current.md` §F9i (v178) reached the same root cause from the metrics side
— `reported` was 630.5 days, 35.4% of all gross lead time — and ruled: *a decision is free;
only starting work costs a slot.*

THE FIX IS STRUCTURAL, NOT A CONVENTION. `triaged` — the event every agent doc, every
gate remedy and every habit already fires at registration — now lands in `scheduled`, the
post-decision/pre-work state the `open-item` type has always had, which `queue_map` puts
in `ready` and `state_owners` attributes to `queue`. Starting work is `pulled`, which is
already the dispatch marker for `use-case` and `open-item` and already the event that
carries `OWNER=` (v11). So all three flow types now start work with the same event, and
**the wrong habit is not discouraged, it is unreachable**: there is no edge from a
defect's initial state into any wip-queue state, and `pulled` is illegal from `reported`.

AC MAP (from the item's Acceptance conditions):
  AC-029.1 — a registered-and-analysed defect that nobody is working does NOT occupy wip.
  AC-029.2 — dispatching it DOES occupy wip. §F9f: a control only ever seen permitting
             proves nothing, so both directions are demonstrated on one item, in order.
  AC-029.3 — the habit cannot be silently reacquired: NO flow type can reach a wip queue
             from its initial state, and `pulled` is refused at registration time, so
             renaming the habit does not restore it either.
  AC-029.4 — time spent decided-but-unstarted is attributed to `queue`, not to an engineer
             who was never dispatched (harm 3: `by_owner` was partly fictional).
  AC-029.5 — NO HISTORY IS REWRITTEN AND NONE IS INVALIDATED. Every event sequence the
             real registry actually contains still folds to the same terminal state
             through the new graph. Measured over all 223 ROC defect files: the events
             that follow `triaged` are `confirmed` (125), `amended` (22), `blocked` (9),
             `not_reproduced` (1) and nothing-at-all (8). All five are replayed.

Nothing is stubbed: every test drives the REAL graph out of
`process/machinery/state-graphs.json` and the REAL writer (`wi.cmd_append`).
"""
import io
import argparse
import contextlib
import unittest

from test_work_items import Base, wi

WIP = "wip"


class _Drive(Base):
    """Drive the real append against a real item file and read the derived queue."""

    def _append(self, iid, event, agent, **kw):
        ns = argparse.Namespace(project=self.project, id=iid, event=event,
                                agent=agent, ref=None, note=None,
                                ts=kw.pop("ts", "2026-09-16T00:00:00Z"), tokens=None,
                                duration_ms=None, observe=None, probe=None,
                                note_file=None, owner=kw.pop("owner", None))
        for k, v in kw.items():
            setattr(ns, k, v)
        with contextlib.redirect_stdout(io.StringIO()):
            return wi.cmd_append(ns)

    def register_defect(self, iid="DEF-1"):
        """A defect as the orchestrator really registers one: `reported`, then the
        §F9b triage decision in the same act."""
        self.write_item("active", iid, "defect",
                        [{"ts": "2026-09-16T00:00:00Z", "event": "reported",
                          "agent": "orchestrator"}])
        return iid

    def queue_of(self, iid):
        """The DERIVED queue — recomputed from the item's events through the real
        graph, exactly as `wi-project` and `loop-gate` compute it."""
        items, _dup = wi.load_all_items(self.project)
        states = wi.compute_states(self.graphs, items)
        return self.graphs.queue_for(states.get(iid))

    def state_of(self, iid):
        items, _dup = wi.load_all_items(self.project)
        return wi.compute_states(self.graphs, items).get(iid)

    def assertRefused(self, iid, event, agent, why):
        with self.assertRaises(SystemExit, msg=why) as cm:
            with contextlib.redirect_stderr(io.StringIO()):
                self._append(iid, event, agent)
        self.assertNotEqual(cm.exception.code, 0, why)


class DecisionIsFree(_Drive):
    """AC-029.1 / AC-029.2 — the two directions, on one item, in order."""

    def test_deciding_a_defect_does_not_consume_a_wip_slot(self):
        """AC-029.1. THE RECORDED INSTANCE: this is the exact event log of
        DEF-ROC-220/221/224/225 — `reported, triaged` and nothing else — and it held
        a WIP slot for hours with no agent alive."""
        iid = self.register_defect()
        self._append(iid, "triaged", "orchestrator")
        self.assertNotEqual(
            self.queue_of(iid), WIP,
            "a defect that has been registered and TRIAGED — decided, but with no "
            "dispatch recorded and nobody working it — must not occupy a WIP slot. "
            "Little's Law governs work IN FLIGHT; decided-but-unstarted is inventory.")

    def test_dispatching_that_same_defect_does_consume_a_wip_slot(self):
        """AC-029.2, §F9f. The negative arm alone would be satisfied by a graph in
        which nothing ever reaches wip, which would be a worse bug than the one
        being fixed. Same item, one more event: the slot is taken."""
        iid = self.register_defect()
        self._append(iid, "triaged", "orchestrator")
        before = self.queue_of(iid)
        self._append(iid, "pulled", "orchestrator", owner="engineer")
        after = self.queue_of(iid)
        self.assertNotEqual(before, WIP, "precondition: deciding is free")
        self.assertEqual(
            after, WIP,
            "DISPATCHING the defect must occupy a WIP slot — `pulled` is the moment "
            "an agent starts holding the work, and it is the same dispatch marker "
            "`use-case` and `open-item` already use.")
        self.assertEqual(self.state_of(iid), "reproducing",
                         "and the dispatched defect is reproducing, as before")

    def test_the_wip_count_changes_only_at_the_dispatch(self):
        """The property the loop-gate actually reads, stated as a sequence: two
        registered-and-decided defects and one dispatched defect give a wip depth of
        ONE, not three. That is the number that must agree with ListAgents."""
        for n in (1, 2, 3):
            iid = self.register_defect(f"DEF-{n}")
            self._append(iid, "triaged", "orchestrator")
        self._append("DEF-3", "pulled", "orchestrator", owner="engineer")
        items, _dup = wi.load_all_items(self.project)
        states = wi.compute_states(self.graphs, items)
        depth = sum(1 for i in items
                    if self.graphs.queue_for(states.get(i)) == WIP)
        self.assertEqual(depth, 1,
                         "wip depth must equal the number of items actually dispatched")


class TheHabitCannotBeReacquired(_Drive):
    """AC-029.3 — enforced by the shape of the graph, not by anyone remembering."""

    def test_no_flow_type_can_reach_a_wip_queue_from_its_initial_state(self):
        """THE GENERAL FORM of the defect, pinned for every present and FUTURE type.

        The bug was not 'someone fired the wrong event'. It was that the only
        decision edge available out of the initial state landed in wip, so recording
        a decision and starting work were the same act. Any type that reintroduces
        that shape turns this red — including one that does not exist yet."""
        offenders = []
        for itype in sorted(self.graphs.types):
            if self.graphs.kind(itype) != "flow":
                continue
            initial = self.graphs.initial(itype)
            for t in self.graphs.transitions(itype):
                if t["from"] != initial or t["to"] == initial:
                    continue
                if self.graphs.queue_for(t["to"]) == WIP:
                    offenders.append(f"{itype}: {initial} --({t['event']})--> {t['to']}")
        self.assertEqual(
            offenders, [],
            "a type whose FIRST move off its initial state lands in wip makes "
            "deciding an item cost a WIP slot, which puts §F9b (decide on arrival) "
            "and loop-gate check 3 (wip over cap) in direct opposition. Offending "
            "edge(s): " + "; ".join(offenders))

    def test_dispatching_is_refused_before_a_decision_is_recorded(self):
        """Renaming the habit must not restore it. An orchestrator that starts
        firing `pulled` at registration instead is REFUSED — a defect is dispatchable
        only once it has been decided."""
        iid = self.register_defect()
        self.assertRefused(iid, "pulled", "orchestrator",
                           "`pulled` from `reported` must be illegal: dispatch "
                           "presupposes a decision")
        self.assertNotEqual(self.queue_of(iid), WIP,
                            "and the refusal leaves the item out of wip")

    def test_every_forward_move_out_of_the_decision_state_costs_a_slot(self):
        """The rule is 'a decision is free; STARTING work costs a slot' — so the
        decision state must not become a second place work can hide. Every non-
        terminal, non-self forward edge out of it leads to wip."""
        decision = self.state_of_after_triage()
        free = []
        for t in self.graphs.transitions("defect"):
            if t["from"] != decision or t["to"] == decision:
                continue
            q = self.graphs.queue_for(t["to"])
            if q is None or q == "waiting":
                continue          # terminal, or an explicit park with a probe
            if q != WIP:
                free.append(f"{decision} --({t['event']})--> {t['to']} [{q}]")
        self.assertEqual(free, [],
                         "work must not be startable without taking a slot: " +
                         "; ".join(free))

    def state_of_after_triage(self):
        iid = self.register_defect("DEF-Q")
        self._append(iid, "triaged", "orchestrator")
        return self.state_of(iid)


class AttributionIsHonest(_Drive):
    """AC-029.4 — harm 3: `by_owner` had been counting phantom engineer time."""

    def test_decided_but_unstarted_time_is_attributed_to_the_queue(self):
        iid = self.register_defect()
        self._append(iid, "triaged", "orchestrator")
        owner = self.graphs.owner_of(self.state_of(iid))
        self.assertEqual(
            owner, "queue",
            "time an item spends decided-but-undispatched is QUEUE latency. "
            "Attributing it to `engineer` is what made nine items accrue "
            "`reproducing` time against an agent that was never dispatched, and "
            "any retro reading by_owner to find its constraint read it.")

    def test_dispatched_time_is_attributed_to_the_engineer(self):
        """The other direction: once dispatched, it IS the engineer's time."""
        iid = self.register_defect()
        self._append(iid, "triaged", "orchestrator")
        self._append(iid, "pulled", "orchestrator", owner="engineer")
        self.assertEqual(self.graphs.owner_of(self.state_of(iid)), "engineer")


class RecordedHistoryStillFolds(_Drive):
    """AC-029.5 — no event is rewritten, and none becomes illegal.

    State is fold(events). Changing where `triaged` LANDS re-interprets every
    existing log, so each shape the real registry contains is replayed here. The
    successor census below is a real measurement over all 223 `work/ROC/items/**/
    DEF-*.md` files on 2026-09-16, not a guess at what histories might look like."""

    REAL_SHAPES = {
        # successor of `triaged` (count in the registry) -> the log, and where it must end
        "confirmed (125)": (["reported", "triaged", "confirmed", "fixed", "validated"],
                            "resolved"),
        "amended (22)": (["reported", "triaged", "amended", "confirmed", "fixed",
                          "validated"], "resolved"),
        "blocked (9)": (["reported", "triaged", "blocked"], "blocked"),
        "not_reproduced (1)": (["reported", "triaged", "not_reproduced"], "wontfix"),
        # the real log of DEF-ROC-169, which WAS genuinely in flight and must stay so
        "in flight": (["reported", "triaged", "pulled", "amended", "confirmed",
                       "build_failed", "fixed", "rejected", "fixed"], "validating"),
        # THE ONE HISTORY THE SUCCESSOR CENSUS MISSED, found by running the real
        # `wi-validate` against the real registry rather than by reasoning: this is
        # DEF-ROC-219 verbatim. An engineer WAS working it and the build went red,
        # but no `pulled` event existed to record the dispatch, so under v13 the
        # annotation lands on `scheduled`. See the `_v13` note in state-graphs.json
        # for why the two change-failure self-edges are the backward-compatible
        # closure (v11's principle) and not a licence for work to hide.
        "change failure before the dispatch marker existed":
            (["reported", "triaged", "amended", "build_failed", "confirmed",
              "fixed", "validated"], "resolved"),
    }

    def test_every_recorded_history_shape_still_reaches_the_same_terminal(self):
        for label, (log, expected) in self.REAL_SHAPES.items():
            with self.subTest(shape=label):
                events = [{"ts": f"2026-09-16T00:{i:02d}:00Z", "event": e,
                           "agent": "orchestrator"} for i, e in enumerate(log)]
                got = wi.fold_state(self.graphs, "defect", events)
                self.assertEqual(
                    got, expected,
                    f"the recorded shape `{label}` must fold exactly as it did "
                    f"before; a history that stops folding is a history the change "
                    f"silently invalidated (DEF-ROC-217's class)")

    def test_the_eight_undispatched_items_leave_wip_with_no_event_written(self):
        """THE CORRECTION, and it needs no forward event at all. The eight items
        holding slots have the log `reported, triaged` — nothing is rewritten; the
        SAME events fold to a non-wip state through the corrected graph."""
        events = [{"ts": "2026-09-16T00:00:00Z", "event": "reported",
                   "agent": "orchestrator"},
                  {"ts": "2026-09-16T00:01:00Z", "event": "triaged",
                   "agent": "orchestrator"}]
        state = wi.fold_state(self.graphs, "defect", events)
        self.assertNotEqual(self.graphs.queue_for(state), WIP)
        self.assertIsNotNone(state, "and it folds to a real state, not to nothing")

    def test_an_amended_decision_is_still_an_annotation(self):
        """`amended` from the decision state must be a SELF-edge — 22 real items
        depend on it, and an annotation that moved the state would be counted as a
        stage exit (DEF-ROC-120)."""
        iid = self.register_defect()
        self._append(iid, "triaged", "orchestrator")
        before = self.state_of(iid)
        self._append(iid, "amended", "orchestrator")
        self.assertEqual(self.state_of(iid), before)
        self.assertTrue(self.graphs.is_annotation("defect", before, "amended"))


if __name__ == "__main__":
    unittest.main()
