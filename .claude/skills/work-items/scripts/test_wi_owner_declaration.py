#!/usr/bin/env python3
"""DEF-ROC-217 — declaring an OWNER must not retroactively invalidate history.

THE RECORDED INSTANCE (2026-09-16, DEF-ROC-145). The orchestrator re-dispatched the
defect to a **cicd** agent and declared `OWNER=cicd` in the same act, which is the
sanctioned v11 dispatch marker. `wi-append` ACCEPTED it. The next `wi-validate` then
failed with three I1 violations — `confirmed`, `fixed` and `amended`, every one of
them fired by **engineer** during an earlier attempt, long before any declaration
existed:

    (I1) DEF-ROC-145: event #4 'confirmed' by agent 'engineer' not permitted
         — 'engineer' does not own this item (owner: cicd)

Why the existing protection does not cover it: v11 chose `default_owners` as the
BACKWARD-COMPATIBLE CLOSURE of the per-transition allowlists it retired, expressly so
that no event in any existing item's history became retrospectively illegal. That
protects the VERSION CHANGE. It does not protect a LATER DECLARATION — and a
declaration narrows, by design.

THE ASYMMETRY IS THE DEFECT. Twenty minutes earlier, on DEF-ROC-191, the same model
got the other half right: `OWNER=engineer` was declared and a **cicd** agent
dispatched, and the machinery refused the ATTRIBUTION at write time. So one bad
pairing of declaration and actor is refused immediately and the other is accepted
silently, then surfaced later as a complaint about a HISTORICAL EVENT — which reads
as "an agent did something it shouldn't have" when the fault is the declaration made
afterwards. A misattribution, in the one file whose whole job is attribution.

AC MAP (from the item's Acceptance conditions):
  AC-217.1 — `wi-append ... OWNER=` REFUSES at declaration time when the declaration
             would make an existing event illegal, NAMING the offending events.
  AC-217.2 — the refusal states the two honest routes: widen, or do not declare.
  AC-217.3 — demonstrated firing (§F9f): narrowing refuses AND widening is permitted.
             A guard only ever seen permitting proves nothing; a guard only ever seen
             refusing is indistinguishable from one that refuses everything.
  AC-217.4 — the narrowing property itself is NOT removed (v11's whole argument), and
             validate/I1 keeps checking history.

Nothing is stubbed: every test drives the REAL writer (`wi.cmd_append`) against a real
item file, and the histories are the real recorded ones.
"""
import io
import os
import argparse
import contextlib
import unittest

from test_work_items import Base, wi


class _Declare(Base):
    """Drive the real append with an OWNER declaration and report the outcome."""

    def _append(self, iid, event, agent, owner=None, **kw):
        ns = argparse.Namespace(project=self.project, id=iid, event=event,
                                agent=agent, ref=None, note=None,
                                ts="2026-09-16T00:00:00Z", tokens=None,
                                duration_ms=None, observe=None, probe=None,
                                note_file=None, owner=owner)
        for k, v in kw.items():
            setattr(ns, k, v)
        return wi.cmd_append(ns)

    def assertDeclarationRefused(self, iid, event, agent, owner, why):
        """Refused, and the stderr is returned so the test can read what it SAID —
        the message is half of this defect, not decoration around it."""
        with self.assertRaises(SystemExit, msg=why) as cm:
            with contextlib.redirect_stderr(io.StringIO()) as err:
                with contextlib.redirect_stdout(io.StringIO()):
                    self._append(iid, event, agent, owner=owner)
        self.assertNotEqual(cm.exception.code, 0, why)
        text = err.getvalue()
        # and the refusal must LEAVE NOTHING BEHIND: a rejected declaration that
        # had already written the event would be the same defect with extra steps.
        item = wi.load_item(self._find(iid))
        self.assertNotEqual(item.events[-1].get("event"), event,
                            "a REFUSED declaration must not have appended its event")
        self.assertNotIn("owner", item.fm,
                         "a REFUSED declaration must not have written `owner:`")
        return text

    def assertDeclarationPermitted(self, iid, event, agent, owner, why):
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                with contextlib.redirect_stderr(io.StringIO()) as err:
                    self._append(iid, event, agent, owner=owner)
        except SystemExit as e:
            self.fail(f"{why}\n  REFUSED (exit {e.code}): {err.getvalue()}")
        item = wi.load_item(self._find(iid))
        self.assertEqual(item.events[-1]["event"], event)
        return item

    def _find(self, iid):
        for sub in ("active", "done"):
            p = os.path.join(self._items(sub), f"{iid}.md")
            if os.path.exists(p):
                return p
        raise AssertionError(f"no item file for {iid}")

    def _state(self, iid):
        items, _ = wi.load_all_items(self.project)
        return wi.compute_states(self.graphs, items)[iid]

    # --- fixtures: REAL histories, replayed; never an asserted state ----------
    def def_145(self, iid="DEF-145", owner=None):
        """DEF-ROC-145's real shape at the moment of the mistake: two orchestrator
        events, then an engineer attempt (confirmed + fixed), then the tester's
        rejection — and the re-dispatch lands on `fixing`, exactly where the
        orchestrator declared OWNER=cicd."""
        evs = [
            {"ts": "2026-08-29T11:14:45Z", "event": "reported", "agent": "orchestrator"},
            {"ts": "2026-08-29T12:17:02Z", "event": "triaged", "agent": "orchestrator"},
            {"ts": "2026-09-14T16:32:47Z", "event": "confirmed", "agent": "engineer"},
            {"ts": "2026-09-14T16:35:57Z", "event": "fixed", "agent": "engineer"},
            {"ts": "2026-09-15T10:24:42Z", "event": "rejected", "agent": "tester"},
        ]
        extra = {"owner": owner} if owner else None
        self.write_item("active", iid, "defect", evs, extra_fm=extra)
        self.assertEqual(self._state(iid), "fixing")
        return iid

    def flow_only_uc(self, iid="UC-FLOW"):
        """A use-case whose whole history was fired by FLOW ROLES — nothing an
        owner declaration can invalidate, because a flow role may fire anything."""
        evs = [
            {"ts": "2026-09-01T00:00:00Z", "event": "registered", "agent": "flow-manager"},
            {"ts": "2026-09-02T00:00:00Z", "event": "made_ready", "agent": "orchestrator"},
        ]
        self.write_item("active", iid, "use-case", evs)
        self.assertEqual(self._state(iid), "ready")
        return iid


# --------------------------------------------------------------------------- #
# AC-217.1 / AC-217.3 — the REFUSING arm: narrowing an item that has history
# --------------------------------------------------------------------------- #
class TestNarrowingIsRefused(_Declare):

    def test_AC_217_1_the_recorded_instance_OWNER_cicd_over_engineer_history(self):
        """The 2026-09-16 mistake, replayed through the real writer. `OWNER=cicd` on
        an item two of whose events were fired by `engineer` must be refused HERE,
        not discovered at the next validate."""
        iid = self.def_145()
        text = self.assertDeclarationRefused(
            iid, "amended", "orchestrator", "cicd",
            "declaring cicd over an item engineer already worked invalidates that "
            "history, and the write path is where that is knowable")
        self.assertIn("OWNER", text)
        self.assertIn("cicd", text)

    def test_AC_217_1_the_refusal_NAMES_the_events_it_would_invalidate(self):
        """Naming them is the whole point. 'this would break history' sends the
        operator to `wi-validate` to find out WHICH history; the writer already
        knows, and an unnamed refusal is the same misattribution one step earlier."""
        iid = self.def_145()
        text = self.assertDeclarationRefused(
            iid, "amended", "orchestrator", "cicd", "must name the events")
        self.assertIn("confirmed", text, "event #3 'confirmed' by engineer")
        self.assertIn("fixed", text, "event #4 'fixed' by engineer")
        self.assertIn("engineer", text, "and the ROLE that actually fired them")
        self.assertIn("#3", text, "with the index validate would have used")
        self.assertIn("#4", text)

    def test_AC_217_1_it_does_NOT_name_events_the_declaration_leaves_legal(self):
        """`reported`/`triaged` were fired by the ORCHESTRATOR, a flow role, which
        may fire anything on any item — so they survive the declaration untouched.
        A refusal that swept them in would be teaching the operator to distrust it."""
        iid = self.def_145()
        text = self.assertDeclarationRefused(
            iid, "amended", "orchestrator", "cicd", "must be specific")
        self.assertNotIn("triaged", text)
        self.assertNotIn("#2", text)

    def test_AC_217_1_a_tester_verdict_in_history_is_not_broken_by_a_declaration(self):
        """`rejected` is the tester's by right on every item [v11], independent of
        the owner — so the declaration cannot invalidate it and must not claim to."""
        iid = self.def_145()
        text = self.assertDeclarationRefused(
            iid, "amended", "orchestrator", "cicd", "must be specific")
        self.assertNotIn("rejected", text)
        self.assertNotIn("fired by 'tester'", text)

    def test_AC_217_1_the_refusal_is_fail_CLOSED_before_the_transition_check(self):
        """The declaration is refused even when the event itself is impeccable. If
        the guard sat after the transition check, an operator would fix a reported
        transition problem and hit the real one only on the second attempt."""
        iid = self.def_145()
        text = self.assertDeclarationRefused(
            iid, "amended", "orchestrator", "cicd",
            "'amended' by the orchestrator from 'fixing' is a wholly legal "
            "transition; the DECLARATION is what is wrong")
        self.assertNotIn("is in state", text,
                         "this must not be reported as a transition problem")


# --------------------------------------------------------------------------- #
# AC-217.2 — the refusal states the two HONEST routes
# --------------------------------------------------------------------------- #
class TestTheRefusalStatesTheHonestRoutes(_Declare):

    def test_AC_217_2_it_offers_the_WIDENED_declaration_ready_to_use(self):
        """Widening was the right answer on DEF-ROC-145 — both roles genuinely
        worked it — so the message computes it rather than describing it."""
        iid = self.def_145()
        text = self.assertDeclarationRefused(
            iid, "amended", "orchestrator", "cicd", "must offer the widening")
        self.assertIn("OWNER=cicd,engineer", text,
                      "the exact string the operator should run next")

    def test_AC_217_2_it_offers_NOT_DECLARING_as_the_other_route(self):
        """The second route is real and must be stated: an item that is merely
        being re-dispatched does not always need a narrowing at all."""
        iid = self.def_145()
        text = self.assertDeclarationRefused(
            iid, "amended", "orchestrator", "cicd", "must offer not declaring")
        self.assertIn("without OWNER=", text)

    def test_AC_217_2_it_refuses_to_suggest_rewriting_the_history(self):
        """The failure mode this guards is an operator under time pressure making
        the history fit the declaration. The message says so, in as many words."""
        iid = self.def_145()
        text = self.assertDeclarationRefused(
            iid, "amended", "orchestrator", "cicd", "must warn off the third route")
        self.assertIn("rewrite", text.lower())


# --------------------------------------------------------------------------- #
# AC-217.3 — the PERMITTING arm. A guard only ever seen refusing proves nothing.
# --------------------------------------------------------------------------- #
class TestWideningAndHonestDeclarationsArePermitted(_Declare):

    def test_AC_217_3_WIDENING_to_the_roles_that_already_acted_is_PERMITTED(self):
        """The corrective the message itself offers must actually work — this is
        the arm that proves the guard discriminates rather than blocks."""
        iid = self.def_145()
        item = self.assertDeclarationPermitted(
            iid, "amended", "orchestrator", "cicd,engineer",
            "both roles genuinely worked this item; the widened set is the honest "
            "record and must be writable")
        self.assertEqual(sorted(item.fm["owner"]), ["cicd", "engineer"])

    def test_AC_217_3_the_widened_item_then_VALIDATES_clean(self):
        """End to end: the route the refusal recommends leaves an item that passes
        the very invariant whose late complaint started this. If it did not, the
        message would be sending operators somewhere that does not work."""
        iid = self.def_145()
        self.assertDeclarationPermitted(iid, "amended", "orchestrator",
                                        "cicd,engineer", "the widening")
        ns = argparse.Namespace(project=self.project, quiet=False)
        with contextlib.redirect_stdout(io.StringIO()) as out:
            try:
                wi.cmd_validate(ns)
            except SystemExit as e:
                self.fail(f"validate refused the widened item: {out.getvalue()}")

    def test_AC_217_3_declaring_on_an_item_with_no_owned_history_is_PERMITTED(self):
        """The ordinary dispatch — declare at the moment the item is routed, before
        any non-flow role has touched it. This is the common case and must stay
        frictionless: flow-role events cannot be invalidated by any declaration."""
        iid = self.flow_only_uc()
        item = self.assertDeclarationPermitted(
            iid, "pulled", "orchestrator", "ui-designer",
            "declaring an owner at dispatch is the mechanism working as intended")
        self.assertEqual(item.fm["owner"], ["ui-designer"])

    def test_AC_217_3_RE_declaring_the_SAME_owner_is_PERMITTED(self):
        """An item already narrowed to `cicd` and worked by `cicd` can be declared
        `cicd` again — nothing changes, so nothing can break. An idempotent
        re-dispatch must not be refused."""
        iid = self.def_145(owner="cicd,engineer")
        item = self.assertDeclarationPermitted(
            iid, "amended", "orchestrator", "cicd,engineer",
            "a declaration that changes nothing invalidates nothing")
        self.assertEqual(sorted(item.fm["owner"]), ["cicd", "engineer"])


# --------------------------------------------------------------------------- #
# AC-217.4 — what must NOT change. The narrowing property is load-bearing.
# --------------------------------------------------------------------------- #
class TestTheNarrowingPropertyIsIntact(_Declare):

    def test_AC_217_4_a_role_that_does_not_own_the_item_is_STILL_refused(self):
        """v11's whole argument: a narrowed item stops an engineer who did none of
        the work reporting a fix on someone else's item. The fix for DEF-ROC-217
        must not buy its quiet by loosening this."""
        iid = self.def_145()
        self.assertDeclarationPermitted(iid, "amended", "orchestrator",
                                        "cicd,engineer", "widen first")
        with self.assertRaises(SystemExit) as cm:
            with contextlib.redirect_stderr(io.StringIO()) as err:
                with contextlib.redirect_stdout(io.StringIO()):
                    self._append(iid, "fixed", "ui-designer")
        self.assertNotEqual(cm.exception.code, 0)
        self.assertIn("does not own this item", err.getvalue())

    def test_AC_217_4_DEF_ROC_191s_half_still_refuses_the_bad_ATTRIBUTION(self):
        """The half that was already right, pinned so the fix to the other half
        cannot quietly take it back: declare `engineer`, then let `cicd` try to
        fire — refused at write time, which is what made the asymmetry visible."""
        iid = self.flow_only_uc()
        self.assertDeclarationPermitted(iid, "pulled", "orchestrator", "engineer",
                                        "the declaration itself is fine")
        with self.assertRaises(SystemExit) as cm:
            with contextlib.redirect_stderr(io.StringIO()) as err:
                with contextlib.redirect_stdout(io.StringIO()):
                    self._append(iid, "built_green", "cicd")
        self.assertNotEqual(cm.exception.code, 0)
        self.assertIn("does not own this item", err.getvalue())

    def test_AC_217_4_a_PRE_EXISTING_I1_violation_is_not_blamed_on_the_declaration(self):
        """Correct attribution, which is what this defect is about. An item whose
        history was ALREADY illegal under its own declared owner (a hand-edit, or a
        rights change nobody reconciled) has a real problem — but it is validate's
        to report, and it is NOT caused by a later declaration that breaks nothing
        new. Blaming the declaration for it would be the same misattribution over
        again, pointing the other way."""
        iid = self.def_145(owner="cicd")          # already invalid: engineer events
        item = self.assertDeclarationPermitted(
            iid, "amended", "orchestrator", "cicd,tester",
            "this declaration newly invalidates nothing; the standing violation is "
            "validate's to name, and naming it here would blame the wrong act")
        self.assertEqual(sorted(item.fm["owner"]), ["cicd", "tester"])


if __name__ == "__main__":
    unittest.main()
