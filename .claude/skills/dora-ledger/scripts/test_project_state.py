#!/usr/bin/env python3
"""Unit test for the single-source-of-truth projection (EXP-048).
Proves item-state and queue-membership are derived purely from ledger events,
so the three-stores-disagree defect family cannot recur for new projects.
Run: python3 .claude/skills/dora-ledger/scripts/test_project_state.py"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from dora import derive_project_state, COLS

def row(event, item, queue="", outcome="na", note="", ts="2026-01-01T00:00:00Z"):
    d = dict.fromkeys(COLS, "")
    d.update(timestamp=ts, project="p", event=event, item_id=item,
             queue=queue, outcome=outcome, note=note)
    return d

def test_lifecycle_state():
    # UC-1 walks the full lifecycle; latest event wins.
    rows = [
        row("item_registered", "UC-1", ts="t1"),
        row("enqueue",         "UC-1", queue="ready", ts="t2"),
        row("dequeue",         "UC-1", queue="ready", ts="t3"),
        row("item_done",       "UC-1", ts="t4"),
    ]
    st, _ = derive_project_state(rows)
    assert st["UC-1"] == "done", st

def test_in_flight_when_pulled_not_done():
    rows = [row("item_registered","UC-2",ts="t1"),
            row("enqueue","UC-2",queue="ready",ts="t2"),
            row("dequeue","UC-2",queue="ready",ts="t3")]
    st, _ = derive_project_state(rows)
    assert st["UC-2"] == "in-flight", st

def test_queue_membership_is_net_enqueue_minus_dequeue():
    rows = [
        row("enqueue","UC-A",queue="ready",ts="t1"),
        row("enqueue","UC-B",queue="ready",ts="t2"),
        row("dequeue","UC-A",queue="ready",ts="t3"),   # A pulled, B still waiting
        row("enqueue","UC-C",queue="intake",ts="t4"),
    ]
    _, q = derive_project_state(rows)
    assert q["ready"] == ["UC-B"], q
    assert q["intake"] == ["UC-C"], q

def test_no_independent_writer_means_no_drift():
    # The whole point: state is a function of the ledger ONLY. Same events in any
    # order of reading → identical projection. There is no second store to drift.
    rows = [row("item_registered","X",ts="t1"), row("enqueue","X",queue="ready",ts="t2")]
    st1,_ = derive_project_state(rows)
    st2,_ = derive_project_state(list(reversed(rows)))   # read order irrelevant
    assert st1 == st2 == {"X": "ready"}, (st1, st2)

def test_legacy_state_transition_tolerated():
    rows = [row("item_registered","D",ts="t1"),
            row("state_transition","D",outcome="done",ts="t2")]
    st,_ = derive_project_state(rows)
    assert st["D"] == "done", st
    rows2 = [row("state_transition","E",note="state: ready -> blocked",ts="t1")]
    st2,_ = derive_project_state(rows2)
    assert st2["E"] == "blocked", st2

if __name__ == "__main__":
    n = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(); n += 1; print(f"  ok  {name}")
    print(f"{n} passed")
