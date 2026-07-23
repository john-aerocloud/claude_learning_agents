#!/usr/bin/env python3
"""Unit tests for board_project.py — the v82-native single-item Linear
board-projection tool. Stdlib unittest only; NO network (the GraphQL transport
is faked). Fixtures are hand-crafted item-file text mirroring the REAL v82
per-item shape (frontmatter + events + derived block + Definition body).
"""
import io
import os
import sys
import json
import tempfile
import unittest
import contextlib
import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "board_project", os.path.join(HERE, "board_project.py"))
bp = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = bp  # dataclass field resolution needs the module registered
_spec.loader.exec_module(bp)


# --- real-shape fixtures ----------------------------------------------------
UC_XA4 = """---
id: UC-XA4
type: use-case
title: 3-hop latency SLO (published -> cross-account folded)
job: J0
value: 13
cost: 2
parents: [SLC-041]
deps: [UC-XA3]
created_ts: "2026-07-11T17:49:55Z"
personas: [P2]
events:
  - {ts: "2026-07-11T17:49:55Z", event: registered, agent: flow-manager}
  - {ts: "2026-07-22T18:19:24Z", event: made_ready, agent: flow-manager, note: buildable}
  - {ts: "2026-07-22T18:26:15Z", event: built_green, agent: engineer, ref: 8a0f2eb}
  - {ts: "2026-07-22T18:53:13Z", event: validated, agent: tester, ref: 1d78a09, tokens: 3000, note: "Prod-validated"}
# --- everything below this line is DERIVED (rendered by the machinery). do not hand-edit. ---
derived:
  state: done
  queue: null
  children: []
  ancestors: [SLC-041, REQ-XACCT-PUSH]
---

_Re-scoped 2026-07-12 by delta-042 (shared-account Aerobus); DEF-XA1._

**Job J0 (P2) — the money-shot.** An integration test measures latency.

### Acceptance
- **AC-XA4.1** — over N >= 20 sampled events, p95 <= 5s AND p99 <= 30s.
- **AC-XA4.2** — every sampled event is received via push.
"""

DEF_XA3 = """---
id: DEF-XA3
type: defect
title: Aerobus publisher PutEvents not chunked to 10
job: J1
value: 21
cost: 2
parents: [UC-XA9]
deps: []
created_ts: "2026-07-22T18:36:35Z"
personas: [P1, P2]
events:
  - {ts: "2026-07-22T18:36:35Z", event: reported, agent: orchestrator, note: "Loop-found on CI run 29946687514, comma, colon: inside"}
  - {ts: "2026-07-22T18:40:12Z", event: confirmed, agent: engineer, note: "repro"}
  - {ts: "2026-07-22T18:43:56Z", event: fixed, agent: engineer, note: "chunk PutEvents"}
  - {ts: "2026-07-22T18:53:11Z", event: validated, agent: tester, note: "Prod-validated"}
# --- everything below this line is DERIVED (rendered by the machinery). do not hand-edit. ---
derived:
  state: resolved
  queue: null
  children: []
  ancestors: [SLC-041, REQ-XACCT-PUSH]
---

## Definition

**Defect (J1).** Publisher does not chunk.

### Acceptance (defect-as-spec)
- **AC-DEF-XA3.1** — chunked to 10.
"""

SLC_041 = """---
id: SLC-041
type: slice
title: Publish-direct-to-Aerobus pilot (FIDS)
job: J0
value: 47
cost: 10
parents: [REQ-XACCT-PUSH]
deps: []
created_ts: "2026-07-11T17:49:55Z"
personas: [P2, P5, P6]
events:
  - {ts: "2026-07-11T17:49:55Z", event: registered, agent: flow-manager, note: first slice}
  - {ts: "2026-07-21T13:00:00Z", event: amended, agent: flow-manager, note: "Reset"}
# --- everything below this line is DERIVED (rendered by the machinery). do not hand-edit. ---
derived:
  state: done
  queue: null
  children: [UC-XA4, UC-XA11]
  ancestors: [REQ-XACCT-PUSH]
---

## Definition

Thinnest vertical slice proving cross-account push.
"""

# a UC that is BLOCKED, has NO acceptance, and no frontmatter title (body-fallback)
UC_BLOCKED = """---
id: UC-ZZ1
type: use-case
job: J2
parents: [SLC-099]
created_ts: "2026-07-01T00:00:00Z"
events:
  - {ts: "2026-07-01T00:00:00Z", event: registered, agent: flow-manager}
  - {ts: "2026-07-02T00:00:00Z", event: made_ready, agent: flow-manager}
  - {ts: "2026-07-03T00:00:00Z", event: pulled, agent: orchestrator}
  - {ts: "2026-07-04T00:00:00Z", event: blocked, agent: orchestrator, note: "waiting on dev-shared IAM grant, comma inside"}
derived:
  state: blocked
  queue: waiting
  children: []
  ancestors: [SLC-099]
---

Onboard the FIDS consumer to the shared bus.
"""


class TestParse(unittest.TestCase):
    def test_use_case_frontmatter_and_state(self):
        it = bp.parse_item(UC_XA4)
        self.assertEqual(it.id, "UC-XA4")
        self.assertEqual(it.type, "use-case")
        self.assertEqual(it.state, "done")
        self.assertEqual(it.parents, ["SLC-041"])
        self.assertEqual(it.job, "J0")
        self.assertTrue(it.has_acceptance)
        self.assertIsNone(it.blocked_note)

    def test_title_from_frontmatter(self):
        it = bp.parse_item(UC_XA4)
        self.assertEqual(
            it.title, "3-hop latency SLO (published -> cross-account folded)")

    def test_defect_parse(self):
        it = bp.parse_item(DEF_XA3)
        self.assertEqual(it.type, "defect")
        self.assertEqual(it.state, "resolved")
        self.assertEqual(it.parents, ["UC-XA9"])
        self.assertTrue(it.has_acceptance)

    def test_aggregate_slice_parse(self):
        it = bp.parse_item(SLC_041)
        self.assertEqual(it.type, "slice")
        self.assertEqual(it.state, "done")
        self.assertEqual(it.title, "Publish-direct-to-Aerobus pilot (FIDS)")

    def test_blocked_note_is_latest(self):
        it = bp.parse_item(UC_BLOCKED)
        self.assertEqual(it.state, "blocked")
        self.assertIn("dev-shared IAM grant", it.blocked_note)
        # comma inside the note must survive (no truncation)
        self.assertIn("comma inside", it.blocked_note)

    def test_title_body_fallback_when_no_frontmatter_title(self):
        it = bp.parse_item(UC_BLOCKED)
        self.assertEqual(it.title, "Onboard the FIDS consumer to the shared bus.")

    def test_needs_acceptance_when_absent(self):
        it = bp.parse_item(UC_BLOCKED)
        self.assertFalse(it.has_acceptance)


class TestStatusMap(unittest.TestCase):
    def test_use_case_all_states(self):
        cases = {
            "registered": "Backlog",
            "ready": "Ready",
            "building": "In Progress",
            "deploying": "In Progress",
            "prod-deploying": "In Progress",
            "reworking": "In Progress",
            "dev-validating": "In Review",
            "validating": "In Review",
            "prod-validating": "In Review",
            "blocked": "Blocked",
            "done": "Done",
            "cancelled": "Cancelled",
        }
        for state, status in cases.items():
            self.assertEqual(bp.status_for("use-case", state), status, state)

    def test_defect_all_states(self):
        cases = {
            "reported": "Backlog",
            "reproducing": "In Progress",
            "fixing": "In Progress",
            "validating": "In Review",
            "blocked": "Blocked",
            "resolved": "Done",
            "wontfix": "Cancelled",
            "cancelled": "Cancelled",
        }
        for state, status in cases.items():
            self.assertEqual(bp.status_for("defect", state), status, state)

    def test_open_item_all_states(self):
        cases = {
            "open": "Backlog",
            "scheduled": "Ready",
            "done": "Done",
            "wontfix": "Cancelled",
            "cancelled": "Cancelled",
        }
        for state, status in cases.items():
            self.assertEqual(bp.status_for("open-item", state), status, state)

    def test_aggregate_states(self):
        for t in ("slice", "chunk", "requirement"):
            self.assertEqual(bp.status_for(t, "planned"), "Backlog")
            self.assertEqual(bp.status_for(t, "in_progress"), "In Progress")
            self.assertEqual(bp.status_for(t, "done"), "Done")
            self.assertEqual(bp.status_for(t, "cancelled"), "Cancelled")

    def test_unknown_state_raises(self):
        with self.assertRaises(bp.MappingError):
            bp.status_for("use-case", "no-such-state")


class TestTitleFormat(unittest.TestCase):
    def test_issue_title(self):
        it = bp.parse_item(UC_XA4)
        self.assertEqual(
            bp.issue_title(it),
            "UC-XA4 · 3-hop latency SLO (published -> cross-account folded)")


class TestLabels(unittest.TestCase):
    def test_defect_label(self):
        self.assertIn("defect", bp.label_names(bp.parse_item(DEF_XA3)))

    def test_needs_acceptance_label(self):
        self.assertIn("needs-acceptance", bp.label_names(bp.parse_item(UC_BLOCKED)))
        self.assertIn("blocked", bp.label_names(bp.parse_item(UC_BLOCKED)))

    def test_use_case_with_acceptance_no_needs_acceptance(self):
        self.assertNotIn("needs-acceptance", bp.label_names(bp.parse_item(UC_XA4)))


# --- fake transport: records calls, returns canned data, NEVER hits network --
class FakeAdapter:
    def __init__(self, new_issue_id="NEW-ISSUE-ID"):
        self.calls = []
        self.created = []
        self.updated = []
        self.comments = []
        self._new_issue_id = new_issue_id

    def team_states(self):
        return {"Backlog": "s-backlog", "Ready": "s-ready",
                "In Progress": "s-prog", "In Review": "s-review",
                "Blocked": "s-blocked", "Done": "s-done",
                "Cancelled": "s-cancelled"}

    def create_issue(self, **kw):
        self.created.append(kw)
        self.calls.append(("create", kw))
        return self._new_issue_id

    def update_issue(self, **kw):
        self.updated.append(kw)
        self.calls.append(("update", kw))

    def create_comment(self, issue_id, body):
        self.comments.append((issue_id, body))


def _cfg():
    return {"teamId": "team-1", "teamKey": "OAG", "initiativeName": "P"}


def _base_map():
    return {
        "issues": {},
        "labels": {"defect": "l-defect", "open-item": "l-oi",
                   "needs-acceptance": "l-na", "blocked": "l-blocked",
                   "job:J0": "l-j0"},
        "states": {"Backlog": "s-backlog", "Ready": "s-ready",
                   "In Progress": "s-prog", "In Review": "s-review",
                   "Blocked": "s-blocked", "Done": "s-done"},
        "milestones": {}, "milestone_chunk": {}, "projects": {},
    }


class TestUpsert(unittest.TestCase):
    def test_create_writes_id_back(self):
        it = bp.parse_item(UC_XA4)
        m = _base_map()
        fake = FakeAdapter(new_issue_id="issue-xa4")
        res = bp.upsert(it, _cfg(), m, fake, live=True)
        self.assertEqual(res["action"], "create")
        self.assertEqual(res["issue_id"], "issue-xa4")
        self.assertEqual(res["status"], "Done")
        # id written back into the map
        self.assertEqual(m["issues"]["UC-XA4"], "issue-xa4")
        self.assertEqual(len(fake.created), 1)
        self.assertEqual(len(fake.updated), 0)
        self.assertEqual(fake.created[0]["title"],
                         "UC-XA4 · 3-hop latency SLO (published -> cross-account folded)")
        self.assertEqual(fake.created[0]["state_id"], "s-done")

    def test_update_patches_in_place_no_dup(self):
        it = bp.parse_item(UC_XA4)
        m = _base_map()
        m["issues"]["UC-XA4"] = "existing-id"
        fake = FakeAdapter()
        res = bp.upsert(it, _cfg(), m, fake, live=True)
        self.assertEqual(res["action"], "update")
        self.assertEqual(res["issue_id"], "existing-id")
        # no new id, still one entry, no create call
        self.assertEqual(m["issues"]["UC-XA4"], "existing-id")
        self.assertEqual(len(fake.created), 0)
        self.assertEqual(len(fake.updated), 1)
        self.assertEqual(fake.updated[0]["issue_id"], "existing-id")

    def test_dry_run_does_not_call_adapter(self):
        it = bp.parse_item(UC_XA4)
        m = _base_map()
        fake = FakeAdapter()
        res = bp.upsert(it, _cfg(), m, fake, live=False)
        self.assertEqual(res["action"], "create")
        self.assertEqual(len(fake.calls), 0)
        # dry-run must NOT mutate the map
        self.assertNotIn("UC-XA4", m["issues"])

    def test_blocked_posts_banner_comment(self):
        it = bp.parse_item(UC_BLOCKED)
        m = _base_map()
        m["issues"]["UC-ZZ1"] = "existing"
        fake = FakeAdapter()
        bp.upsert(it, _cfg(), m, fake, live=True)
        self.assertTrue(fake.comments, "a blocked item should post a why comment")
        self.assertIn("dev-shared IAM grant", fake.comments[0][1])

    def test_defect_attaches_as_subissue_when_parent_resolvable(self):
        it = bp.parse_item(DEF_XA3)  # parents [UC-XA9]
        m = _base_map()
        m["issues"]["UC-XA9"] = "uc-xa9-id"
        fake = FakeAdapter(new_issue_id="def-id")
        bp.upsert(it, _cfg(), m, fake, live=True)
        self.assertEqual(fake.created[0].get("parent_id"), "uc-xa9-id")
        self.assertIn("l-defect", fake.created[0].get("label_ids", []))


class TestKeySafety(unittest.TestCase):
    def test_read_api_key_missing_file_stops_clean(self):
        with tempfile.TemporaryDirectory() as d:
            missing = os.path.join(d, "nope.json")
            with self.assertRaises(SystemExit):
                bp.read_api_key(missing)

    def test_read_api_key_placeholder_stops(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "linear.local.json")
            with open(p, "w") as f:
                json.dump({"linearApiKey": "lin_api_REPLACE_ME"}, f)
            with self.assertRaises(SystemExit):
                bp.read_api_key(p)

    def test_read_api_key_reads_value(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "linear.local.json")
            with open(p, "w") as f:
                json.dump({"linearApiKey": "lin_api_SECRET123"}, f)
            self.assertEqual(bp.read_api_key(p), "lin_api_SECRET123")

    def test_key_only_flows_through_auth_header_never_query_or_shell(self):
        # The key must reach the wire ONLY via the Authorization header — never
        # interpolated into the GraphQL query/variables and never into a shell.
        captured = {}

        def fake_urlopen(req, timeout=0):
            captured["headers"] = dict(req.headers)
            captured["body"] = req.data.decode()

            class R:
                def __enter__(self): return self
                def __exit__(self, *a): return False
                def read(self): return json.dumps({"data": {"ok": 1}}).encode()
            return R()

        real = bp.urllib.request.urlopen
        bp.urllib.request.urlopen = fake_urlopen
        try:
            ad = bp.LinearAdapter("lin_api_SECRET123", team_id="team-1")
            ad._request("query{viewer{id}}", {"v": 1})
        finally:
            bp.urllib.request.urlopen = real
        # Authorization header carries the key (header name is case-insensitive)
        hdrs = {k.lower(): v for k, v in captured["headers"].items()}
        self.assertEqual(hdrs.get("authorization"), "lin_api_SECRET123")
        # the key NEVER appears in the request body (query + variables)
        self.assertNotIn("lin_api_SECRET123", captured["body"])

    def test_source_has_no_shell_execution(self):
        with open(os.path.join(HERE, "board_project.py")) as _f:
            src = _f.read()
        for banned in ("import subprocess", "os.system", "os.popen",
                       "shell=True", "import os\nimport pty"):
            self.assertNotIn(banned, src, f"{banned} must not appear")


if __name__ == "__main__":
    unittest.main()
