#!/usr/bin/env python3
"""THE DRIFT GATE DID NOT CHECK THE ONE THING EVERY READER TRUSTS.

OI-WI-VALIDATE-IGNORES-DERIVED-STATE-LEGALITY. Under v82 an item's state is
`fold(events)`; the `derived:` block at the foot of the item file is a RENDERING of
that fold. Every reader consumes the rendering — the queue views, the board
projector, `item-brief`, and every agent that opens an item file and reads its state
off the block. Nothing compared the two.

`validate_items` implemented I1 (event-transition legality), I2 (terminal vs queue),
I3 (edge resolution + dep cycles), I4 (one file per id, terminal lives in done/),
I6 (an `awaiting_observation` park carries an observation predicate) and I7 (a
`blocked` park carries a reversal probe). Verified against the code on 2026-08-27:
**none of them read the `derived:` block at all** — `parse_frontmatter` stops dead at
the `derived:` key and discards everything below it, so a hand-authored or stale
block could not be seen, let alone checked.

FOUNDING INSTANCE (2026-08-03, recorded on the item). Five `use-case` items were
registered with hand-authored derived blocks carrying `state: planned` and
`queue: null` — both AGGREGATE-ONLY values; the use-case graph has no `planned`
state at all. `make wi-validate` reported `clean — I1-I4 + I6 all hold`.
`make wi-project` then healed all five to `registered`/`intake`, so the machinery
could compute the right answer the whole time and the gate simply never asked. The
only thing that caught it was an unrelated tool (the Linear projector's reality
sweep over `(type, state)` pairs).

WHY THAT IS WORSE THAN HAVING NO GATE. `wi-validate clean` is quoted as assurance
that the item graph is sound — it was cited repeatedly through that session as
evidence, in commit messages and in reports to the owner. A gate that is silent on a
whole class of corruption is worse than an absent one, because it is BELIEVED. This
is §17c's own logic turned on the drift gate: the check that could have come back
negative here never could.

I8, the invariant these tests pin, has four limbs and fails CLOSED on each:

  a. the `derived:` block EXISTS and declares a `state:` — an item with no rendering
     has nothing for a reader to trust, and `null` is not a state any graph defines;
  b. `derived.state` is a state the item's OWN TYPE'S graph defines (the founding
     instance: `planned` on a `use-case`, `ready` on a `slice`). The legal set is
     DERIVED FROM `state-graphs.json` — the pattern OI-LINEAR-CANCELLED-STATE-
     UNMAPPED's fix established — never a hand-kept literal list;
  c. `derived.state` EQUALS `fold(events)` (for an aggregate, the bubbled state).
     Limb (b) cannot catch a plausible lie: `ready` on a use-case that has folded to
     `done` is a legal state and the wrong one;
  d. `derived.queue` equals `queue_map[derived.state]`.

And the remedy in every message is `make wi-project` — REGENERATE the rendering.
Never "correct the derived block", which is the act that caused this.

WHAT KEEPS I8 FROM FALSE-REDDENING, which is load-bearing (AC-DSL.5). An
aggregate's state BUBBLES from its children, so a child's `append` used to leave
every ancestor's rendered block stale — I8 limb (c) would then have fired on a
slice for a reason nobody caused and the honest remedy would have looked like
weakening the check. `append` now re-renders the appended item's ANCESTORS too, so
the propagation happens at the write, and the pin below drives the real append.

AC MAP (the item's numbered acceptance, which is unlabelled prose):
  AC-DSL.1 = acceptance 1 — the invariant exists: legality + queue_map agreement.
  AC-DSL.2 = acceptance 2 — OBSERVED RED against a hand-authored illegal block.
  AC-DSL.3 = acceptance 3 — GREEN on a healed tree.
  AC-DSL.4 = the brief's addition — RED when derived.state disagrees with fold.
  AC-DSL.5 = the false-red guard: an append propagates to ancestors.
"""
import importlib.util
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "work_items_i8", os.path.join(HERE, "work-items.py"))
wi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(wi)

import argparse  # noqa: E402  (after the module load, as the sibling suite does)


DONE_UC_EVENTS = [
    {"ts": "2026-06-17T00:00:00Z", "event": "registered", "agent": "flow-manager"},
    {"ts": "2026-06-17T01:00:00Z", "event": "made_ready", "agent": "flow-manager"},
    {"ts": "2026-06-17T02:00:00Z", "event": "pulled", "agent": "orchestrator"},
    {"ts": "2026-06-17T03:00:00Z", "event": "built_green", "agent": "engineer"},
    {"ts": "2026-06-17T04:00:00Z", "event": "deployed", "agent": "cicd"},
    {"ts": "2026-06-17T05:00:00Z", "event": "validated", "agent": "tester"},
]
REGISTERED_UC_EVENTS = [
    {"ts": "2026-06-17T00:00:00Z", "event": "registered", "agent": "flow-manager"},
]
READY_UC_EVENTS = REGISTERED_UC_EVENTS + [
    {"ts": "2026-06-17T01:00:00Z", "event": "made_ready", "agent": "flow-manager"},
]


class Base(unittest.TestCase):
    """Temp-dir fixtures only. NEVER the real project data (the corpus sweep is
    `make wi-validate` itself, run against the live tree, not from a unit test)."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="wi-i8-")
        self.project = "TestProj"
        self._orig_root = wi.ROOT
        wi.ROOT = self.tmp
        real_graphs = os.path.join(self._orig_root, "process", "machinery",
                                   "state-graphs.json")
        os.makedirs(os.path.join(self.tmp, "process", "machinery"), exist_ok=True)
        shutil.copy(real_graphs,
                    os.path.join(self.tmp, "process", "machinery", "state-graphs.json"))
        self._orig_graphs_path = wi.GRAPHS_PATH
        wi.GRAPHS_PATH = os.path.join(self.tmp, "process", "machinery",
                                      "state-graphs.json")
        self.graphs = wi.Graphs.load(wi.GRAPHS_PATH)
        self._orig_statusline = wi.STATUSLINE
        wi.STATUSLINE = os.path.join(self.tmp, "process", "dora", "statusline.json")
        os.makedirs(self._items("active"), exist_ok=True)
        os.makedirs(self._items("done"), exist_ok=True)

    def tearDown(self):
        wi.ROOT = self._orig_root
        wi.GRAPHS_PATH = self._orig_graphs_path
        wi.STATUSLINE = self._orig_statusline
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _items(self, sub):
        return os.path.join(self.tmp, "work", self.project, "items", sub)

    def write_item(self, sub, iid, itype, events, derived, parents=None, deps=None):
        """Write an item file with an EXPLICITLY CHOSEN derived block — the whole
        point here is to author the drift the gate must catch. `derived=None`
        writes no derived block at all."""
        fm = {"id": iid, "type": itype, "title": "t", "job": "J0",
              "value": 1, "cost": 0.5, "parents": parents or [], "deps": deps or [],
              "created_ts": "2026-06-17T00:00:00Z", "events": events}
        item = wi.Item(os.path.join(self._items(sub), f"{iid}.md"), fm, "\n## Definition\nstub\n")
        text = wi.render_item(item, derived or {"state": None, "queue": None,
                                                "children": [], "ancestors": []})
        if derived is None:
            # strip the whole derived block: everything from the marker to the
            # closing fence of the frontmatter.
            lines = text.split("\n")
            keep, dropping = [], False
            for ln in lines:
                if ln.startswith("# --- everything below this line is DERIVED"):
                    dropping = True
                    continue
                if dropping and ln.strip() == "---":
                    dropping = False
                    keep.append(ln)
                    continue
                if dropping:
                    continue
                keep.append(ln)
            text = "\n".join(keep)
        with open(item.path, "w", encoding="utf-8") as f:
            f.write(text)
        return item.path

    def heal(self):
        """Re-render every item's derived block from the fold — what
        `make wi-project` does, and the ONLY legitimate remedy for a violation."""
        items, _ = wi.load_all_items(self.project)
        states = wi.compute_states(self.graphs, items)
        children = wi.compute_children(items)
        for iid, it in items.items():
            dv = wi.derived_block(self.graphs, items, states, children, iid)
            with open(it.path, "w", encoding="utf-8") as f:
                f.write(wi.render_item(it, dv))

    def violations(self):
        return wi.validate_items(self.graphs, self.project)

    def i8(self):
        return [v for v in self.violations() if "(I8)" in v]


# --------------------------------------------------------------------------- #
# The legal-state set is DERIVED from state-graphs.json, not hand-listed.
# --------------------------------------------------------------------------- #
class TestLegalStatesDerivation(Base):
    def test_flow_legal_states_come_from_the_type_graph(self):
        """AC-DSL.1: every state reachable in the use-case graph is legal for a
        use-case, and nothing else is."""
        legal = wi.legal_states(self.graphs, "use-case")
        for t in self.graphs.transitions("use-case"):
            self.assertIn(t["from"], legal)
            self.assertIn(t["to"], legal)
        self.assertIn(self.graphs.initial("use-case"), legal)
        # AGGREGATE-ONLY states must NOT be legal for a flow type — this is the
        # founding instance's exact shape.
        self.assertNotIn("planned", legal)
        self.assertNotIn("in_progress", legal)

    def test_aggregate_legal_states_are_exactly_what_bubble_can_return(self):
        """AC-DSL.1: an aggregate's state is not folded from its own events, it is
        BUBBLED, so its legal set is the bubble's range — and a flow-only state
        (`ready`, `building`) is not in it."""
        legal = wi.legal_states(self.graphs, "slice")
        for s in ("planned", "in_progress", "done", "cancelled", "blocked",
                  "awaiting_observation"):
            self.assertIn(s, legal, s)
        for s in ("ready", "building", "registered", "reworking", "reported",
                  "fixing", "validating", "resolved", "scheduled"):
            self.assertNotIn(s, legal, s)

    def test_bubble_can_never_return_a_state_outside_the_legal_set(self):
        """AC-DSL.1 (non-vacuity of the derivation itself): drive `_bubble` over every child
        configuration that matters and assert each result is declared legal. A
        legal set that the code can step outside is not a legal set."""
        legal = wi.legal_states(self.graphs, "slice")
        agg = wi.Item("p", {"id": "SLC-X", "type": "slice", "events": []}, "")
        agg_closed = wi.Item("p", {"id": "SLC-Y", "type": "slice", "events": [
            {"ts": "1", "event": "closed", "agent": "flow-manager"}]}, "")
        cases = [
            ([], {}, agg),                                        # childless
            ([], {}, agg_closed),                                 # childless + closed
            (["a"], {"a": "done"}, agg),
            (["a"], {"a": "cancelled"}, agg),
            (["a", "b"], {"a": "done", "b": "cancelled"}, agg),
            (["a"], {"a": "registered"}, agg),
            (["a"], {"a": "ready"}, agg),
            (["a"], {"a": "blocked"}, agg),
            (["a"], {"a": "awaiting_observation"}, agg),
            (["a", "b"], {"a": "blocked", "b": "awaiting_observation"}, agg),
            (["a", "b"], {"a": "done", "b": "blocked"}, agg),
            (["a"], {}, agg),                                     # child not computed
        ]
        for kids, states, item in cases:
            got = wi._bubble(self.graphs, {}, kids, states, agg_item=item)
            self.assertIn(got, legal, f"_bubble returned {got!r} for {kids}/{states}")


# --------------------------------------------------------------------------- #
# I8 limb (b): the declared state must be one the item's own graph defines.
# THE FOUNDING INSTANCE.
# --------------------------------------------------------------------------- #
class TestI8Legality(Base):
    def test_founding_instance_use_case_declaring_planned_is_caught(self):
        """AC-DSL.2 (OBSERVED RED): the real 2026-08-03 corruption — a `use-case`
        whose hand-authored block carries the aggregate-only `state: planned` and
        `queue: null`. This passed `wi-validate` clean before I8 existed."""
        self.write_item("active", "UC-DP1", "use-case", REGISTERED_UC_EVENTS,
                        derived={"state": "planned", "queue": None,
                                 "children": [], "ancestors": []})
        v = self.i8()
        self.assertTrue(v, "the founding corruption was not caught")
        joined = " ".join(v)
        self.assertIn("UC-DP1", joined)
        self.assertIn("planned", joined)
        self.assertIn("use-case", joined)

    def test_all_five_founding_children_are_each_reported(self):
        """AC-DSL.2: the corruption arrived FIVE items at a time, so one report per
        item — a gate that collapses them to one finding hides four."""
        for n in range(1, 6):
            self.write_item("active", f"UC-DP{n}", "use-case", REGISTERED_UC_EVENTS,
                            derived={"state": "planned", "queue": None,
                                     "children": [], "ancestors": []})
        v = self.i8()
        for n in range(1, 6):
            self.assertTrue(any(f"UC-DP{n}" in x for x in v), f"UC-DP{n} unreported")

    def test_aggregate_declaring_a_flow_only_state_is_caught(self):
        """AC-DSL.2: the mirror image — a `slice` carrying the flow-only `ready`."""
        self.write_item("done", "UC-1", "use-case", DONE_UC_EVENTS, parents=["SLC-1"],
                        derived={"state": "done", "queue": None, "children": [],
                                 "ancestors": ["SLC-1"]})
        self.write_item("active", "SLC-1", "slice", [
            {"ts": "2026-06-17T00:00:00Z", "event": "registered", "agent": "flow-manager"}],
            derived={"state": "ready", "queue": "ready", "children": ["UC-1"],
                     "ancestors": []})
        v = self.i8()
        self.assertTrue(any("SLC-1" in x and "ready" in x for x in v), v)

    def test_a_state_no_graph_defines_at_all_is_caught(self):
        """AC-DSL.2: a typo or an invented state — `in-progress` for `in_progress`,
        the shape a hand-edit actually produces."""
        self.write_item("active", "UC-T", "use-case", REGISTERED_UC_EVENTS,
                        derived={"state": "in-progress", "queue": "wip",
                                 "children": [], "ancestors": []})
        self.assertTrue(any("UC-T" in x for x in self.i8()), self.i8())


# --------------------------------------------------------------------------- #
# I8 limb (c): a LEGAL but WRONG state — what legality alone cannot see.
# --------------------------------------------------------------------------- #
class TestI8AgreesWithFold(Base):
    def test_legal_but_stale_state_is_caught(self):
        """AC-DSL.4: `ready` is a perfectly legal use-case state. This item's events
        fold to `done`. Limb (b) is blind to it; limb (c) is the whole reason a
        legality check is the FLOOR and not the ceiling."""
        self.write_item("done", "UC-STALE", "use-case", DONE_UC_EVENTS,
                        derived={"state": "ready", "queue": "ready",
                                 "children": [], "ancestors": []})
        v = self.i8()
        self.assertTrue(v, "a legal-but-wrong declared state was not caught")
        joined = " ".join(v)
        self.assertIn("UC-STALE", joined)
        self.assertIn("ready", joined)
        self.assertIn("done", joined)          # names the fold's answer
        self.assertIn("fold(events)", joined)  # and says where truth lives

    def test_a_backdated_state_is_caught_in_the_other_direction(self):
        """AC-DSL.4: drift is not always behind. A block claiming `done` on an item
        whose events stop at `registered` would let a reader (and the board) read a
        thing as delivered that was never pulled."""
        self.write_item("active", "UC-AHEAD", "use-case", REGISTERED_UC_EVENTS,
                        derived={"state": "done", "queue": None,
                                 "children": [], "ancestors": []})
        self.assertTrue(any("UC-AHEAD" in x for x in self.i8()), self.i8())

    def test_stale_aggregate_state_is_caught(self):
        """AC-DSL.4: a slice whose children are all delivered but whose block still
        reads `planned` — the lie a reader is most likely to act on."""
        self.write_item("done", "UC-1", "use-case", DONE_UC_EVENTS, parents=["SLC-1"],
                        derived={"state": "done", "queue": None, "children": [],
                                 "ancestors": ["SLC-1"]})
        self.write_item("active", "SLC-1", "slice", [
            {"ts": "2026-06-17T00:00:00Z", "event": "registered", "agent": "flow-manager"}],
            derived={"state": "planned", "queue": None, "children": ["UC-1"],
                     "ancestors": []})
        v = self.i8()
        self.assertTrue(any("SLC-1" in x and "planned" in x and "done" in x for x in v), v)


# --------------------------------------------------------------------------- #
# I8 limb (a): no block, or a null state, is not a pass.
# --------------------------------------------------------------------------- #
class TestI8BlockPresence(Base):
    def test_missing_derived_block_is_a_violation(self):
        """AC-DSL.1 (fail CLOSED): an item file with no rendering at all must not
        pass the gate by having nothing to disagree with. Absence of a claim was
        the loophole in the class this whole item belongs to."""
        self.write_item("active", "UC-NODERIVED", "use-case", REGISTERED_UC_EVENTS,
                        derived=None)
        v = self.i8()
        self.assertTrue(any("UC-NODERIVED" in x for x in v), v)

    def test_null_state_is_a_violation(self):
        """AC-DSL.1: `state: null` is the PROVISIONAL block `migrate` writes before
        `project` finalises it. Persisted, it makes an item invisible to every
        derived view — so it is drift, not an exemption."""
        self.write_item("active", "UC-NULL", "use-case", REGISTERED_UC_EVENTS,
                        derived={"state": None, "queue": None,
                                 "children": [], "ancestors": []})
        self.assertTrue(any("UC-NULL" in x for x in self.i8()), self.i8())


# --------------------------------------------------------------------------- #
# I8 limb (d): the queue is a pure function of the state.
# --------------------------------------------------------------------------- #
class TestI8Queue(Base):
    def test_queue_disagreeing_with_queue_map_is_caught(self):
        """AC-DSL.1: `ready` maps to queue `ready`. A block claiming `wip` would
        hide the item from the pull while showing it as in-flight."""
        self.write_item("active", "UC-Q", "use-case", READY_UC_EVENTS,
                        derived={"state": "ready", "queue": "wip",
                                 "children": [], "ancestors": []})
        v = self.i8()
        self.assertTrue(any("UC-Q" in x and "queue" in x for x in v), v)

    def test_null_queue_on_a_queued_state_is_caught(self):
        """AC-DSL.1: the founding instance's OTHER half — `queue: null` on an item
        that belongs in a queue drops it out of the flow silently."""
        self.write_item("active", "UC-QN", "use-case", READY_UC_EVENTS,
                        derived={"state": "ready", "queue": None,
                                 "children": [], "ancestors": []})
        self.assertTrue(any("UC-QN" in x and "queue" in x for x in self.i8()), self.i8())


# --------------------------------------------------------------------------- #
# NON-VACUITY, the pair that matters: the SAME tree red then green.
# --------------------------------------------------------------------------- #
class TestI8NonVacuity(Base):
    def test_red_then_green_on_the_same_tree(self):
        """AC-DSL.2 + AC-DSL.3: author the corruption -> RED; run the projection
        (the only legitimate remedy) -> GREEN. Nothing else changes."""
        self.write_item("done", "UC-1", "use-case", DONE_UC_EVENTS, parents=["SLC-1"],
                        derived={"state": "planned", "queue": None, "children": [],
                                 "ancestors": []})
        self.write_item("active", "UC-2", "use-case", READY_UC_EVENTS, parents=["SLC-1"],
                        derived={"state": "planned", "queue": None, "children": [],
                                 "ancestors": []})
        self.write_item("active", "SLC-1", "slice", [
            {"ts": "2026-06-17T00:00:00Z", "event": "registered", "agent": "flow-manager"}],
            derived={"state": "planned", "queue": None, "children": [], "ancestors": []})
        red = self.i8()
        # all three: both use-cases carry an illegal state, and the slice's
        # `planned` is legal-for-a-slice but WRONG (its children have moved).
        self.assertEqual(len(red), 3, f"expected UC-1, UC-2 and SLC-1, got {red}")
        for iid in ("UC-1", "UC-2", "SLC-1"):
            self.assertTrue(any(iid in x for x in red), f"{iid} unreported")
        self.heal()
        self.assertEqual(self.violations(), [], "healed tree is not clean")

    def test_a_correctly_rendered_tree_is_clean_for_every_state_in_every_graph(self):
        """AC-DSL.3: I8 must be silent on legitimate data — one item parked in each
        reachable state of each flow type, rendered by the machinery. If I8 fired
        here it would be a gate nobody could keep green."""
        seeded = 0
        for itype, sub in (("use-case", None), ("defect", None), ("open-item", None)):
            for state in sorted(wi.legal_states(self.graphs, itype)):
                path = _synth_path(self.graphs, itype, state)
                if path is None:
                    continue
                iid = f"{itype[:3].upper()}-{state.replace('-', '').replace('_', '')}"
                terminal = state in ("done", "resolved", "wontfix", "cancelled")
                self.write_item("done" if terminal else "active", iid, itype, path,
                                derived={"state": None, "queue": None,
                                         "children": [], "ancestors": []})
                seeded += 1
        self.assertGreater(seeded, 10, "the sweep seeded almost nothing")
        self.heal()
        v = [x for x in self.violations() if "(I8)" in x]
        self.assertEqual(v, [], v)


def _synth_path(graphs, itype, target):
    """BFS a legal event path from the type's initial state to `target`, carrying a
    legal agent (and the park predicates I6/I7 require). None if unreachable."""
    from collections import deque
    start = graphs.initial(itype)
    if target == start:
        return [{"ts": "2026-06-17T00:00:00Z", "event": start, "agent": _agent_for(itype)}]
    seen = {start}
    q = deque([(start, [])])
    while q:
        st, path = q.popleft()
        for ev, to, agents in graphs.legal_from(itype, st):
            if to in seen:
                continue
            step = {"event": ev, "agent": agents[0]}
            if to == "awaiting_observation":
                step["observe"] = "make:observe-x"
            if to == "blocked":
                step["probe"] = "make:probe-x"
            newp = path + [step]
            if to == target:
                out = [{"ts": "2026-06-17T00:00:00Z", "event": start,
                        "agent": _agent_for(itype)}]
                for i, s in enumerate(newp):
                    s = dict(s)
                    s["ts"] = f"2026-06-17T{i + 1:02d}:00:00Z"
                    out.append(s)
                return out
            seen.add(to)
            q.append((to, newp))
    return None


def _agent_for(itype):
    return {"use-case": "flow-manager", "defect": "orchestrator",
            "open-item": "orchestrator"}[itype]


# --------------------------------------------------------------------------- #
# THE FALSE-RED GUARD: an append must propagate to the ancestors it moves.
# --------------------------------------------------------------------------- #
class TestAppendPropagatesToAncestors(Base):
    def _append(self, iid, event, agent, **kw):
        ns = argparse.Namespace(project=self.project, id=iid, event=event, agent=agent,
                                ref=None, note=None, note_file=None, observe=None,
                                probe=None, tokens=None, duration_ms=None, ts=None)
        for k, val in kw.items():
            setattr(ns, k, val)
        import contextlib
        import io
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            wi.cmd_append(ns)
        return buf.getvalue()

    def test_append_on_a_child_leaves_the_whole_tree_clean(self):
        """AC-DSL.5: without ancestor propagation, appending `made_ready` to the
        only child of a `planned` slice bubbles the slice to `in_progress` while its
        file still reads `planned` — I8 would then fire on an item nobody touched,
        every cycle, and the pressure would be to weaken I8 rather than fix the
        write. So the write is what is fixed, and this is the pin."""
        self.write_item("active", "UC-1", "use-case", REGISTERED_UC_EVENTS,
                        parents=["SLC-1"], derived={"state": None, "queue": None,
                                                    "children": [], "ancestors": []})
        self.write_item("active", "SLC-1", "slice", [
            {"ts": "2026-06-17T00:00:00Z", "event": "registered", "agent": "flow-manager"}],
            derived={"state": None, "queue": None, "children": [], "ancestors": []})
        self.heal()
        self.assertEqual(self.violations(), [], "fixture not clean before the append")

        self._append("UC-1", "made_ready", "flow-manager")

        self.assertEqual(self.violations(), [],
                         "the append left an ancestor's derived block stale")
        # and the propagation is real, not vacuous: the slice's FILE now says so.
        slc = wi.load_item(os.path.join(self._items("active"), "SLC-1.md"))
        self.assertEqual(wi.declared_derived(slc.path)["state"], "in_progress")

    def test_append_propagates_through_two_levels(self):
        """AC-DSL.5: bubbling is multi-level (chunk of slices), so propagation must
        walk the full ancestor chain, not just the immediate parent."""
        self.write_item("active", "CHK-1", "chunk", [
            {"ts": "2026-06-17T00:00:00Z", "event": "registered", "agent": "flow-manager"}],
            derived=None)
        self.write_item("active", "SLC-1", "slice", [
            {"ts": "2026-06-17T00:00:00Z", "event": "registered", "agent": "flow-manager"}],
            parents=["CHK-1"], derived=None)
        self.write_item("active", "UC-1", "use-case", REGISTERED_UC_EVENTS,
                        parents=["SLC-1"], derived=None)
        self.heal()
        self._append("UC-1", "made_ready", "flow-manager")
        self.assertEqual(self.violations(), [], "propagation stopped short of the chunk")
        chk = os.path.join(self._items("active"), "CHK-1.md")
        self.assertEqual(wi.declared_derived(chk)["state"], "in_progress")


# --------------------------------------------------------------------------- #
# The gate must SAY what it is and what to do — a violation whose remedy is
# "edit the derived block" would teach the very act that caused this.
# --------------------------------------------------------------------------- #
class TestI8Message(Base):
    def test_message_names_the_projection_as_the_remedy(self):
        """AC-DSL.1: the remedy is the PROJECTION, never an edit to the block."""
        self.write_item("active", "UC-DP1", "use-case", REGISTERED_UC_EVENTS,
                        derived={"state": "planned", "queue": None,
                                 "children": [], "ancestors": []})
        joined = " ".join(self.i8())
        self.assertIn("wi-project", joined)
        self.assertNotIn("hand-edit the derived", joined)

    def test_clean_banner_names_I8_so_the_assurance_is_accurate(self):
        """AC-DSL.1. The banner is the sentence that gets QUOTED as assurance. It listed
        `I1-I4 + I6 + I7`; if I8 runs and the banner does not say so, the report is
        again narrower than it reads."""
        import contextlib
        import io
        self.write_item("done", "UC-1", "use-case", DONE_UC_EVENTS,
                        derived={"state": None, "queue": None,
                                 "children": [], "ancestors": []})
        self.heal()
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            wi.cmd_validate(argparse.Namespace(project=self.project))
        self.assertIn("I8", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
