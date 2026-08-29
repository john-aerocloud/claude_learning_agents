#!/usr/bin/env python3
"""OI-ROC-006 — firing rights derive from the ITEM, not from a per-transition allowlist.

TEN recorded instances across six roles, each previously patched by widening one
per-transition `agents` list in `process/machinery/state-graphs.json`. The evidence
is archived under `EXP-136`/`EXP-139`/`EXP-140` in `process/experiments-archive.md`
and tabulated on the item; the three most recent (2026-08-26/27) are on
`OI-ROC-006` and `DEF-ROC-128`.

Every test here replays a REAL recorded instance — the item type, the state the item
was actually in, the role that actually did the work, and the transition it was
actually refused — through the REAL writer (`wi.cmd_append`). Nothing is stubbed and
no exec boundary is mocked: the claim is about what the machinery does, so the
machinery is what runs.

AC MAP (from the item's Acceptance conditions):
  AC-006.1 — allowlists REMOVED, not widened; the graph still rejects an event that
             is illegal from the current state.
  AC-006.2 — the ten recorded instances, replayed. RED FIRST on the pre-change
             machinery (8 of the 10 — see the note on instances 1 and 2).
  AC-006.3 — NON-VACUITY: a genuinely wrong actor is still REFUSED.
  AC-006.4 — the existing edge regression tests stay green (they live in
             test_work_items.py; this module adds the rights-model half).
  AC-006.5 — the scoring hook is computable from the event stream.

A NOTE ON INSTANCES 1 AND 2, recorded rather than dressed up. The item asserts all
ten fail on today's machinery. Two do not, and the reason is the finding itself:
instance 1 (`documenter` on a docs-only use-case) was patched by EXP-136 and
instance 2 (`cicd` on an infra-owned defect) by EXP-139 — they are two of the very
widenings this item exists to stop. They are kept here as REGRESSION pins: the
mechanism replacement must not take back what the two patches gave.
"""
import io
import os
import argparse
import contextlib
import unittest

from test_work_items import Base, wi


class _Replay(Base):
    """Drive the real append and report whether it was permitted."""

    def _append(self, iid, event, agent, **kw):
        ns = argparse.Namespace(project=self.project, id=iid, event=event,
                                agent=agent, ref=None, note=None,
                                ts="2026-08-20T00:00:00Z", tokens=None,
                                duration_ms=None, observe=None, probe=None,
                                note_file=None, owner=kw.pop("owner", None))
        for k, v in kw.items():
            setattr(ns, k, v)
        return wi.cmd_append(ns)

    def assertPermitted(self, iid, event, agent, why, **kw):
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                self._append(iid, event, agent, **kw)
        except SystemExit as e:
            err = getattr(self, "_last_err", "")
            self.fail(f"{why}\n  REFUSED: {agent} could not fire '{event}' on "
                      f"{iid} (exit {e.code}) {err}")
        item = wi.load_item(self._find(iid))
        self.assertEqual(item.events[-1]["event"], event)
        self.assertEqual(item.events[-1]["agent"], agent,
                         "the agent field must record who ACTUALLY acted")

    def assertRefused(self, iid, event, agent, why, **kw):
        with self.assertRaises(SystemExit, msg=why) as cm:
            with contextlib.redirect_stderr(io.StringIO()) as err:
                with contextlib.redirect_stdout(io.StringIO()):
                    self._append(iid, event, agent, **kw)
        self.assertNotEqual(cm.exception.code, 0, why)
        return err.getvalue()

    def _find(self, iid):
        for sub in ("active", "done"):
            p = os.path.join(self._items(sub), f"{iid}.md")
            if os.path.exists(p):
                return p
        raise AssertionError(f"no item file for {iid}")

    # --- fixtures: real event histories, not authored states -----------------
    def uc(self, iid, upto, owner=None):
        """A use-case folded to `upto` by REPLAYING the events that get it there —
        never by asserting a state. `owner` is the item's declared owner, the
        mechanism under test (absent on every legacy item)."""
        evs = [{"ts": "2026-08-01T00:00:00Z", "event": "registered", "agent": "flow-manager"}]
        if upto in ("ready", "building", "deploying", "dev-validating"):
            evs.append({"ts": "2026-08-02T00:00:00Z", "event": "made_ready", "agent": "flow-manager"})
        if upto in ("building", "deploying", "dev-validating"):
            evs.append({"ts": "2026-08-03T00:00:00Z", "event": "pulled", "agent": "orchestrator"})
        if upto in ("deploying", "dev-validating"):
            evs.append({"ts": "2026-08-04T00:00:00Z", "event": "built_green", "agent": "engineer"})
        if upto == "dev-validating":
            evs.append({"ts": "2026-08-05T00:00:00Z", "event": "deployed", "agent": "cicd"})
        extra = {"owner": owner} if owner else None
        self.write_item("active", iid, "use-case", evs, extra_fm=extra)
        self.assertEqual(self._state(iid), upto)
        return iid

    def defect(self, iid, upto, owner=None):
        evs = [{"ts": "2026-08-01T00:00:00Z", "event": "reported", "agent": "orchestrator"}]
        if upto in ("reproducing", "fixing", "validating"):
            evs.append({"ts": "2026-08-02T00:00:00Z", "event": "triaged", "agent": "orchestrator"})
        if upto in ("fixing", "validating"):
            evs.append({"ts": "2026-08-03T00:00:00Z", "event": "confirmed", "agent": "engineer"})
        if upto == "validating":
            evs.append({"ts": "2026-08-04T00:00:00Z", "event": "fixed", "agent": "engineer"})
        extra = {"owner": owner} if owner else None
        self.write_item("active", iid, "defect", evs, extra_fm=extra)
        self.assertEqual(self._state(iid), upto)
        return iid

    def _state(self, iid):
        items, _ = wi.load_all_items(self.project)
        return wi.compute_states(self.graphs, items)[iid]


# --------------------------------------------------------------------------- #
# AC-006.2 — the ten recorded instances, replayed against the real writer
# --------------------------------------------------------------------------- #
class TestTenRecordedInstances(_Replay):

    def test_AC_006_2_instance_01_documenter_advances_a_docs_only_use_case(self):
        """EXP-136 (2026-07-31, UC-ROC-082, the SSO-outage runbook). ALREADY GREEN:
        this is one of the two widenings the item exists to stop. Kept as a
        regression pin — the replacement must not take it back."""
        self.uc("UC-DOCS", "building", owner="documenter")
        self.assertPermitted("UC-DOCS", "built_green", "documenter",
                             "the role that WROTE the runbook must be able to say so")
        self.assertPermitted("UC-DOCS", "deployed", "documenter",
                             "and must not then strand the item in `deploying`")

    def test_AC_006_2_instance_02_cicd_advances_an_infra_owned_defect(self):
        """EXP-139 (2026-08-04, DEF-ROC-020, two uncoordinated writers to one Azure
        Function App's app_settings). ALREADY GREEN — the second widening."""
        self.defect("DEF-INFRA", "reproducing", owner="cicd")
        self.assertPermitted("DEF-INFRA", "confirmed", "cicd",
                             "an infra-owned defect is dispatched to cicd deliberately")
        self.assertPermitted("DEF-INFRA", "fixed", "cicd",
                             "and cicd must be able to report its own fix")

    def test_AC_006_2_instance_03_tester_pulls_a_verification_only_use_case(self):
        """EXP-140 instance 3: a verification-only UC pulled by the tester."""
        self.uc("UC-VONLY", "ready", owner="tester")
        self.assertPermitted("UC-VONLY", "pulled", "tester",
                             "the tester performed the pull; it must be recordable")

    def test_AC_006_2_instance_04_engineer_pulls_an_ORDINARY_use_case(self):
        """EXP-140 instance 4 (UC-ROC-080). The instance that kills the
        'unusual item meets unusual role' explanation: an entirely ordinary
        use-case and the canonical role for it. engineer.md tells the engineer to
        fire `pulled` if it performs the pull; the graph forbade it."""
        self.uc("UC-ORD", "ready")
        self.assertPermitted("UC-ORD", "pulled", "engineer",
                             "two authored artefacts disagreed; the item must settle it")

    def test_AC_006_2_instance_05_tester_records_the_deploy_it_attested(self):
        """EXP-140 instance 5 (UC-ROC-080, 2026-08-14). The item reached `deploying`
        with no cicd in the thread; the TESTER stood the local stack up and checked
        trunk carried the sha, i.e. it did the attestation work — and had to fire
        `deployed` under AGENT=cicd, disclosing the substitution in the note."""
        self.uc("UC-ATTEST", "deploying")
        self.assertPermitted("UC-ATTEST", "deployed", "tester",
                             "the role that did the attestation must record it AS ITSELF")

    def test_AC_006_2_instance_06_solution_architect_confirms_a_design_defect(self):
        """EXP-140 instance 6 (DEF-ROC-026, 2026-08-14) — resolved as a pure design
        decision (delta 016, no code). The role that did 100% of the work had no
        path at all in the defect graph."""
        self.defect("DEF-ARCH", "reproducing")
        self.assertPermitted("DEF-ARCH", "confirmed", "solution-architect",
                             "an architecture-only defect is the architect's work")

    def test_AC_006_2_instance_07_orchestrator_puts_an_item_into_ready(self):
        """EXP-140 instance 7. The flow owner could PULL from Ready but not PUT into
        it: `pulled` was [orchestrator, flow-manager] and `made_ready` was
        [flow-manager]. Nothing is protected by spawning a second agent to append
        one event."""
        self.uc("UC-READY", "registered")
        self.assertPermitted("UC-READY", "made_ready", "orchestrator",
                             "the role that owns sequencing may populate its own queue")

    def test_AC_006_2_instance_08_documenter_advances_a_docs_defect(self):
        """EXP-140 instance 8 (DEF-ROC-037, 2026-08-17) — doc/test-pin drift, a class
        owned by the documenter BY DESIGN, dispatched there on the orchestrator's
        deliberate judgement. Item type and owning role perfectly matched, and the
        graph still said no."""
        self.defect("DEF-DOCS", "reproducing", owner="documenter")
        self.assertPermitted("DEF-DOCS", "confirmed", "documenter",
                             "the class owner reproduced it")
        self.assertPermitted("DEF-DOCS", "fixed", "documenter",
                             "and fixed it")

    def test_AC_006_2_instance_09_solution_architect_reports_its_own_fix(self):
        """EXP-140 instance 9 (DEF-ROC-026, 2026-08-17), verbatim refusal:
        `event 'fixed' is legal here but not for agent 'solution-architect'`.
        It substituted `amended`, left the item in `fixing`, and the item then
        needed an engineer or cicd to append a `fixed` about work neither did."""
        self.defect("DEF-ARCH2", "fixing")
        self.assertPermitted("DEF-ARCH2", "fixed", "solution-architect",
                             "an architecture-only fix is reportable by architecture")

    def test_AC_006_2_instance_10_ui_designer_confirms_a_UI_defect(self):
        """EXP-140 instance TEN (DEF-ROC-057, 2026-08-18) — THE LOAD-BEARING ONE.
        `ui-designer` appears on NO edge of the defect graph at all, so unlike
        instances 8 and 9 it has no legal substitute edge to detour through: it
        cannot move the item one step in any direction. A fix that merely widens
        the graph passes 1-9 and still fails this."""
        self.defect("DEF-UI", "reproducing", owner="ui-designer")
        self.assertPermitted("DEF-UI", "confirmed", "ui-designer",
                             "the role that owns UI quality must be able to record "
                             "that it reproduced a UI defect")


# --------------------------------------------------------------------------- #
# AC-006.3 — NON-VACUITY: a genuinely wrong actor is still REFUSED
# --------------------------------------------------------------------------- #
class TestNonVacuity(_Replay):

    def test_AC_006_3_a_role_the_item_does_not_declare_is_refused(self):
        """The exact inverse of instance 10, on the same role, event and item type:
        permitted when the item DECLARES it, refused when it does not. That
        difference is the whole mechanism — the declaration is on the ITEM, made by
        the role that knows the routing, not in a global graph authored by nobody."""
        self.defect("DEF-UNDECL", "reproducing")
        err = self.assertRefused("DEF-UNDECL", "confirmed", "ui-designer",
                                 "an undeclared role must not acquire rights")
        self.assertIn("does not own", err)

    def test_AC_006_3_declaring_an_owner_NARROWS_rights_to_that_owner(self):
        """A declaration is a routing decision, not an additive permit: once a
        defect declares the ui-designer, an engineer that did none of the work
        cannot report a fix on it. Without this the change is a blanket permit
        wearing a derivation's clothes."""
        self.defect("DEF-OWNED", "fixing", owner="ui-designer")
        self.assertRefused("DEF-OWNED", "fixed", "engineer",
                           "an agent may not fire an event on an item it does not own")

    def test_AC_006_3_a_verification_verdict_stays_the_testers(self):
        """The one genuine safety property the allowlists carried, kept and stated
        as a rule instead of enumerated twenty times: EXP-139 refused to widen
        `validated` because 'cicd fixing its own defect and then validating it
        would collapse the gate that caught DEF-ROC-013's misdiagnosis'. An OWNER
        is refused here, which is what makes this non-vacuous."""
        self.uc("UC-VERDICT", "dev-validating")
        self.assertRefused("UC-VERDICT", "validated", "engineer",
                           "the role that built it may not issue the verdict on it")
        self.assertRefused("UC-VERDICT", "validated", "cicd",
                           "nor may the role that deployed it")
        self.assertPermitted("UC-VERDICT", "validated", "tester",
                             "the verdict is the tester's, on every item")

    def test_AC_006_3_an_unknown_role_is_refused(self):
        self.uc("UC-NOBODY", "ready")
        self.assertRefused("UC-NOBODY", "pulled", "not-a-role",
                           "an unrecognised actor has no rights anywhere")

    def test_AC_006_3_only_a_flow_role_may_declare_an_owner(self):
        """Otherwise the derivation is self-serving: any agent could grant itself
        rights in the same act as using them."""
        self.defect("DEF-SELFGRANT", "reproducing")
        self.assertRefused("DEF-SELFGRANT", "confirmed", "ui-designer",
                           "an agent may not declare itself the owner",
                           owner="ui-designer")


# --------------------------------------------------------------------------- #
# AC-006.1 — the graph constrains SHAPE, and the allowlists are GONE
# --------------------------------------------------------------------------- #
class TestShapeOnly(_Replay):

    def test_AC_006_1_no_transition_carries_an_agent_allowlist(self):
        """REMOVED, not widened. An eleventh patch is explicitly not on the table,
        and a residual list would be exactly where the twelfth would go."""
        offenders = [(t, tr) for t in self.graphs.types
                     for tr in self.graphs.transitions(t) if "agents" in tr]
        self.assertEqual(offenders, [],
                         f"{len(offenders)} transitions still carry an `agents` allowlist")

    def test_AC_006_1_an_illegal_event_from_this_state_is_still_rejected(self):
        """Shape is still enforced: the owner of an item does not get to skip a
        state. `built_green` from `ready` needs `pulled` first."""
        self.uc("UC-SHAPE", "ready")
        err = self.assertRefused("UC-SHAPE", "built_green", "engineer",
                                 "an owner may not fire an event illegal from here")
        self.assertIn("not a legal transition", err)

    def test_AC_006_1_a_terminal_item_still_admits_nothing(self):
        self.uc("UC-TERM", "dev-validating")
        self.assertPermitted("UC-TERM", "validated", "tester", "reaches done")
        self.assertRefused("UC-TERM", "built_green", "engineer",
                           "a terminal state has no legal events")

    def test_AC_006_1_the_rights_model_is_declared_in_the_graph_file(self):
        """The rule must be readable where the graph is read, not buried in python."""
        fr = self.graphs.firing_rights
        self.assertTrue(fr, "no `firing_rights` block in state-graphs.json")
        self.assertEqual(sorted(fr["flow_roles"]), ["flow-manager", "orchestrator"])
        for itype in [t for t in self.graphs.types
                      if self.graphs.kind(t) == "flow"]:
            self.assertIn(itype, fr["default_owners"],
                          f"{itype} has no default owner set, so an undeclared item "
                          f"of that type would be unworkable")
        self.assertEqual(sorted(fr["event_roles"]),
                         ["dev_validated", "not_yet_observed", "rejected", "validated"])


class TestTheDeclarationIsTheDispatch(_Replay):
    """The mechanism only works if the declaration OUTLIVES the command that made
    it — rights are derived from the ITEM, so the item is where the routing
    decision has to be readable: by the next agent, by I1's replay of history, and
    by anyone opening the file."""

    def test_AC_006_1_a_flow_role_declares_the_owner_and_it_persists(self):
        """End to end, exactly as a dispatch runs: the orchestrator triages a UI
        defect and declares the routing in the SAME act (v124), and the ui-designer
        then records its own work as itself, with no OWNER= of its own and nothing
        else in the thread."""
        self.defect("DEF-DISPATCH", "reported")
        self.assertPermitted("DEF-DISPATCH", "triaged", "orchestrator",
                             "the flow role routes the item", owner="ui-designer")
        item = wi.load_item(self._find("DEF-DISPATCH"))
        self.assertEqual(item.fm["owner"], ["ui-designer"],
                         "the declaration must be ON the item, not only in the command")
        self.assertPermitted("DEF-DISPATCH", "confirmed", "ui-designer",
                             "the declared owner then works the item as itself")
        self.assertPermitted("DEF-DISPATCH", "fixed", "ui-designer",
                             "…for every non-verdict transition, not one edge")
        self.assertPermitted("DEF-DISPATCH", "validated", "tester",
                             "and the verdict is still independent")

    def test_AC_006_3_an_owner_naming_an_unknown_role_is_refused(self):
        """A declaration that names nobody would silently narrow the item to an
        empty owner set and make it unworkable by anyone but a flow role — a
        wedge introduced by a typo. Refused at the write."""
        self.defect("DEF-TYPO", "reported")
        err = self.assertRefused("DEF-TYPO", "triaged", "orchestrator",
                                 "a typo must not silently narrow an item to nobody",
                                 owner="ui-desginer")
        self.assertIn("not a known agent role", err)

    def test_AC_006_2_history_written_under_a_declaration_stays_valid(self):
        """I1 replays history through the same derivation, so a declared-owner item
        must still validate clean after the fact — otherwise every routing decision
        would become drift the moment it was made."""
        self.defect("DEF-HIST", "reported")
        self.assertPermitted("DEF-HIST", "triaged", "orchestrator", "route it",
                             owner="documenter")
        self.assertPermitted("DEF-HIST", "confirmed", "documenter", "work it")
        self.assertEqual([v for v in wi.validate_items(self.graphs, self.project)
                          if "(I1)" in v], [])


# --------------------------------------------------------------------------- #
# AC-006.5 — the scoring hook: role-spoofed / blocked transitions per 20 items
# --------------------------------------------------------------------------- #
class TestScoringHook(_Replay):

    def _hook(self):
        items, _ = wi.load_all_items(self.project)
        states = wi.compute_states(self.graphs, items)
        return wi.compute_stats(self.graphs, items, states)["firing_rights"]

    def test_AC_006_5_the_hook_counts_disclosed_substitutions_per_20_items(self):
        """EXP-ROC-002 is scored on this count going to zero, NEVER on 'those ten
        transitions now work'. A blocked transition leaves no event, so the honest
        measure is the DISCLOSURE the agent wrote in the note it did land — which
        is what every one of the ten did. The count is therefore a FLOOR, and the
        stats section says so."""
        self.write_item("active", "UC-S1", "use-case",
                        [{"ts": "2026-08-01T00:00:00Z", "event": "registered",
                          "agent": "flow-manager"},
                         {"ts": "2026-08-02T00:00:00Z", "event": "made_ready",
                          "agent": "flow-manager"},
                         {"ts": "2026-08-03T00:00:00Z", "event": "pulled",
                          "agent": "orchestrator",
                          "note": "Dispatched to engineer (orchestrator pull; the "
                                  "engineer role cannot fire pulled per the type graph)."}])
        self.write_item("active", "UC-S2", "use-case",
                        [{"ts": "2026-08-01T00:00:00Z", "event": "registered",
                          "agent": "flow-manager"},
                         {"ts": "2026-08-02T00:00:00Z", "event": "made_ready",
                          "agent": "flow-manager"}])
        hook = self._hook()
        self.assertEqual(hook["window_items"], 20)
        self.assertGreaterEqual(hook["disclosed_substitutions"], 1,
                                "the real disclosure wording must be recognised")
        self.assertIn("UC-S1", [i["id"] for i in hook["instances"]])
        self.assertNotIn("UC-S2", [i["id"] for i in hook["instances"]])
        self.assertIsNotNone(hook["per_20_items"])

    def test_AC_006_5_a_clean_window_scores_zero(self):
        """The count must be able to come back zero AND non-zero — a hook that can
        only report good news is the DEF-ROC-120 failure in a new place."""
        self.uc("UC-CLEAN", "ready")
        hook = self._hook()
        self.assertEqual(hook["disclosed_substitutions"], 0)
        self.assertEqual(hook["instances"], [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
