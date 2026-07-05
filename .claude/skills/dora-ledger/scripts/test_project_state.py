#!/usr/bin/env python3
"""Unit test for the single-source-of-truth projection (EXP-048).
Proves item-state and queue-membership are derived purely from ledger events,
so the three-stores-disagree defect family cannot recur for new projects.
Run: "$(sh .claude/skills/dora-ledger/scripts/dora --python)" .claude/skills/dora-ledger/scripts/test_project_state.py"""
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

def test_item_done_is_terminal_bare_dequeue_does_not_reopen():
    # IMP-016 (the bug): a queue-bookkeeping `dequeue` timestamped AFTER `item_done`
    # must NOT resurrect a finished item. `item_done` is terminal; a bare dequeue
    # while terminal is a no-op.
    rows = [
        row("item_registered","UC-3",ts="t1"),
        row("enqueue","UC-3",queue="ready",ts="t2"),
        row("dequeue","UC-3",queue="ready",ts="t3"),
        row("item_done","UC-3",ts="t4"),
        row("dequeue","UC-3",queue="ready",ts="t5"),   # later bare dequeue — MUST be ignored
    ]
    st,_ = derive_project_state(rows)
    assert st["UC-3"] == "done", st

def test_genuine_rework_reopens_a_done_item():
    # An EXPLICIT re-entry (enqueue for rework) legitimately reopens a done item;
    # the following dequeue then correctly shows in-flight.
    rows = [
        row("item_registered","UC-4",ts="t1"),
        row("enqueue","UC-4",queue="ready",ts="t2"),
        row("dequeue","UC-4",queue="ready",ts="t3"),
        row("item_done","UC-4",ts="t4"),
        row("enqueue","UC-4",queue="rework",ts="t5"),   # explicit rework re-entry clears terminal
        row("dequeue","UC-4",queue="rework",ts="t6"),
    ]
    st,_ = derive_project_state(rows)
    assert st["UC-4"] == "in-flight", st

def test_state_transition_reopens_a_done_item():
    # A state_transition is an explicit re-entry and overrides terminal done.
    rows = [
        row("item_registered","UC-5",ts="t1"),
        row("item_done","UC-5",ts="t2"),
        row("state_transition","UC-5",outcome="blocked",ts="t3"),
    ]
    st,_ = derive_project_state(rows)
    assert st["UC-5"] == "blocked", st

def test_item_registered_reopens_a_done_item():
    # A fresh item_registered (explicit re-entry) also clears terminal done.
    rows = [
        row("item_done","UC-6",ts="t1"),
        row("item_registered","UC-6",ts="t2"),
    ]
    st,_ = derive_project_state(rows)
    assert st["UC-6"] == "planned", st

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
