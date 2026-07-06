#!/usr/bin/env python3
"""Work-item machinery — the event-sourced single-source-of-truth model.

Contract: process/machinery/CONTRACT.md ; state machines: process/machinery/state-graphs.json.

ONE principle: each fact is stored once (in the item file's append-only `events:`),
and every other view (queues, state, tree, stats) is a PURE FUNCTION of the item set,
computed on read — never persisted-and-hand-synced. An item's current state is
fold(events) through its type's state graph; appending an event that is not a legal
transition (or is by a wrong agent) is REJECTED at write time — the drift class
(a half-transition) becomes unrepresentable.

Subcommands:
  append   --project P --id ID --event E --agent A [--ref R] [--note N] [--ts ISO]
  project  --project P
  validate --project P
  migrate  --project P

Stdlib only. Frontmatter is parsed by hand (the tiny YAML-ish subset the contract
uses); JSON via stdlib json. Invoke via the launcher `sh .../work-items <cmd>`.
"""
import argparse, csv, json, os, re, sys
from datetime import datetime, timezone, timedelta
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
GRAPHS_PATH = os.path.join(ROOT, "process", "machinery", "state-graphs.json")


# ---------------------------------------------------------------------------
# Time
# ---------------------------------------------------------------------------
def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_ts(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        return None


# ---------------------------------------------------------------------------
# State-graph loader
# ---------------------------------------------------------------------------
class Graphs:
    """Loaded state-graphs.json — the declarative per-type state machines."""

    def __init__(self, data):
        self.version = data.get("version")
        self.queue_map = data.get("queue_map", {})
        self.types = data.get("types", {})

    @classmethod
    def load(cls, path=GRAPHS_PATH):
        with open(path, encoding="utf-8") as f:
            return cls(json.load(f))

    def kind(self, itype):
        return self.types.get(itype, {}).get("kind")

    def initial(self, itype):
        return self.types.get(itype, {}).get("initial")

    def terminals(self, itype):
        return set(self.types.get(itype, {}).get("terminal", []))

    def transitions(self, itype):
        return self.types.get(itype, {}).get("transitions", [])

    def queue_for(self, state):
        # queue_map values may be null (JSON null -> Python None): no queue.
        return self.queue_map.get(state)

    def legal_from(self, itype, state):
        """List of (event, to, agents) legal from `state` for this type."""
        return [(t["event"], t["to"], t.get("agents", []))
                for t in self.transitions(itype) if t["from"] == state]


# ---------------------------------------------------------------------------
# The reducer — fold(events) -> current state, through the type graph
# ---------------------------------------------------------------------------
def fold_state(graphs, itype, events):
    """Fold an item's event list to its current state through its type's graph.

    FLOW types replay each event as a transition from the current state; an event
    that is not a legal transition from the current state is IGNORED for the fold
    (validate/I1 is the gate that catches such illegal history — the fold itself
    stays total so state.md never crashes on bad data). AGGREGATE types have no
    own event stream driving state (state bubbles from children); the fold returns
    their initial state and the caller bubbles.
    """
    itype_def = graphs.types.get(itype)
    if not itype_def:
        return None
    state = graphs.initial(itype)
    if graphs.kind(itype) == "aggregate":
        return state  # bubbled by caller
    trans = graphs.transitions(itype)
    for ev in events:
        name = ev.get("event")
        moved = False
        for t in trans:
            if t["from"] == state and t["event"] == name:
                state = t["to"]
                moved = True
                break
        # illegal-from-here events are left for validate/I1 to flag; fold ignores.
        if not moved:
            continue
    return state


def check_transition(graphs, itype, state, event, agent):
    """Return (ok, to_state, legal_here). ok iff `event` is a legal transition
    from `state` for this type AND `agent` is in that transition's agents."""
    legal_here = graphs.legal_from(itype, state)
    for ev_name, to, agents in legal_here:
        if ev_name == event:
            return (agent in agents, to, legal_here)
    return (False, None, legal_here)


# ---------------------------------------------------------------------------
# Item file I/O — hand-rolled YAML-ish frontmatter (contract's tiny subset)
# ---------------------------------------------------------------------------
class Item:
    def __init__(self, path, fm, body):
        self.path = path
        self.fm = fm          # ordered dict of frontmatter fields (excluding derived)
        self.body = body

    @property
    def id(self):
        return self.fm.get("id")

    @property
    def type(self):
        return self.fm.get("type")

    @property
    def parents(self):
        return list(self.fm.get("parents", []) or [])

    @property
    def deps(self):
        return list(self.fm.get("deps", []) or [])

    @property
    def events(self):
        return list(self.fm.get("events", []) or [])


def _split_frontmatter(text):
    """Return (frontmatter_text, body_text). Frontmatter is the block between the
    first two `---` fences."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise ValueError("no frontmatter fence")
    end = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end is None:
        raise ValueError("unterminated frontmatter")
    return "\n".join(lines[1:end]), "\n".join(lines[end + 1:])


def _parse_scalar(v):
    v = v.strip()
    if v == "" or v == "~" or v == "null":
        return None
    if v.startswith('"') and v.endswith('"') and len(v) >= 2:
        return v[1:-1]
    if v.startswith("'") and v.endswith("'") and len(v) >= 2:
        return v[1:-1]
    # int / float
    if re.fullmatch(r"-?\d+", v):
        return int(v)
    if re.fullmatch(r"-?\d+\.\d+", v):
        return float(v)
    return v


def _parse_inline_list(v):
    """`[a, b, c]` -> ['a','b','c'] ; `[]` -> []."""
    v = v.strip()
    inner = v[1:-1].strip()
    if not inner:
        return []
    return [_parse_scalar(x) for x in _split_top_commas(inner)]


def _split_top_commas(s):
    """Split on commas not inside braces/brackets."""
    out, depth, cur = [], 0, ""
    for ch in s:
        if ch in "[{":
            depth += 1
        elif ch in "]}":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(cur)
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur)
    return out


def _parse_inline_map(v):
    """`{ts: ..., event: ..., agent: ..., note: "..."}` -> dict."""
    v = v.strip()
    inner = v[1:-1].strip()
    d = {}
    if not inner:
        return d
    for part in _split_top_commas(inner):
        if ":" not in part:
            continue
        k, _, val = part.partition(":")
        d[k.strip()] = _parse_scalar(val)
    return d


def parse_frontmatter(fm_text):
    """Parse the contract's frontmatter subset:
      scalar:  key: value
      inline list:  key: [a, b]
      block list:   key:\n  - item     (items may be inline maps)
    Everything under a top-level `derived:` key is discarded (it is re-rendered).
    """
    fm = {}
    lines = fm_text.split("\n")
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        if not line.strip() or line.strip().startswith("#"):
            i += 1
            continue
        # top-level key (no leading whitespace)
        m = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if not m:
            i += 1
            continue
        key, rest = m.group(1), m.group(2).strip()
        if key == "derived":
            break  # everything below is derived; stop parsing frontmatter
        if rest.startswith("[") and rest.endswith("]"):
            fm[key] = _parse_inline_list(rest)
            i += 1
        elif rest == "":
            # block list of `- ...` items, OR empty scalar
            items = []
            j = i + 1
            while j < n and re.match(r"^\s+-\s+", lines[j]):
                item_txt = re.sub(r"^\s+-\s+", "", lines[j]).strip()
                if item_txt.startswith("{"):
                    items.append(_parse_inline_map(item_txt))
                else:
                    items.append(_parse_scalar(item_txt))
                j += 1
            if items:
                fm[key] = items
                i = j
            else:
                fm[key] = None
                i += 1
        else:
            fm[key] = _parse_scalar(rest)
            i += 1
    return fm


def load_item(path):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    fm_text, body = _split_frontmatter(text)
    fm = parse_frontmatter(fm_text)
    return Item(path, fm, body)


# --- rendering -------------------------------------------------------------
def _q(v):
    """Render a scalar for frontmatter (quote titles/notes containing specials)."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v)
    if s == "" or re.search(r'[:#\[\]{}",]', s) or s.strip() != s:
        return '"' + s.replace('"', '\\"') + '"'
    return s


def _render_list(vals):
    return "[" + ", ".join(_q(v) for v in vals) + "]"


def _render_event(ev):
    parts = [f"ts: {_q(ev.get('ts'))}", f"event: {_q(ev.get('event'))}",
             f"agent: {_q(ev.get('agent'))}"]
    if ev.get("ref") not in (None, ""):
        parts.append(f"ref: {_q(ev.get('ref'))}")
    if ev.get("note") not in (None, ""):
        parts.append(f"note: {_q(ev.get('note'))}")
    return "{" + ", ".join(parts) + "}"


# Field render order for the frontmatter (contract's order).
_FIELD_ORDER = ["id", "type", "title", "job", "value", "cost",
                "parents", "deps", "created_ts"]


def render_item(item, derived):
    """Render the whole item file: frontmatter (authoritative fields + events)
    + the DERIVED block + the markdown body."""
    fm = item.fm
    L = ["---"]
    for key in _FIELD_ORDER:
        if key not in fm:
            continue
        v = fm[key]
        if key in ("parents", "deps"):
            L.append(f"{key}: {_render_list(v or [])}")
        else:
            L.append(f"{key}: {_q(v)}")
    # any extra authoritative scalar fields not in the canonical order (future-proof)
    for key, v in fm.items():
        if key in _FIELD_ORDER or key == "events":
            continue
        if isinstance(v, list):
            L.append(f"{key}: {_render_list(v)}")
        else:
            L.append(f"{key}: {_q(v)}")
    # events (append-only)
    L.append("events:")
    for ev in item.events:
        L.append("  - " + _render_event(ev))
    # derived block
    L.append("# --- everything below this line is DERIVED (rendered by the machinery). "
             "do not hand-edit. ---")
    L.append("derived:")
    L.append(f"  state: {_q(derived.get('state'))}")
    L.append(f"  queue: {_q(derived.get('queue'))}")
    L.append(f"  children: {_render_list(derived.get('children', []))}")
    L.append(f"  ancestors: {_render_list(derived.get('ancestors', []))}")
    L.append("---")
    body = item.body
    if body and not body.startswith("\n"):
        L.append("")
    L.append(body.rstrip("\n") if body else "")
    return "\n".join(L) + "\n"


# ---------------------------------------------------------------------------
# Item-set loading (across active/ + done/)
# ---------------------------------------------------------------------------
def items_dir(project):
    return os.path.join(ROOT, "work", project, "items")


def load_all_items(project):
    """Return {id: Item} across items/active/ and items/done/. If a stray id
    appears in both, both are kept (validate/I4 will flag it) — keyed by (dir,id)
    is overkill; we key by id and record dup ids separately for I4."""
    d = items_dir(project)
    items = {}
    dup_ids = []
    for sub in ("active", "done"):
        subdir = os.path.join(d, sub)
        if not os.path.isdir(subdir):
            continue
        for fn in sorted(os.listdir(subdir)):
            if not fn.endswith(".md"):
                continue
            it = load_item(os.path.join(subdir, fn))
            it.subdir = sub  # remember which folder it lives in
            if it.id in items:
                dup_ids.append(it.id)
            items[it.id] = it
    return items, dup_ids


# ---------------------------------------------------------------------------
# Derivation — the pure functions the projection needs
# ---------------------------------------------------------------------------
AGG_INITIAL = "planned"


def compute_states(graphs, items):
    """Return {id: state} for all items. Flow items fold their events; aggregates
    bubble from children per `bubble: done_when_all_children_done`. Aggregates
    are resolved with a topological-ish fixpoint (children before parents) so a
    chunk-of-slices bubbles correctly."""
    children = compute_children(items)
    states = {}

    # first pass: flow items via fold
    for iid, it in items.items():
        if graphs.kind(it.type) == "flow":
            states[iid] = fold_state(graphs, it.type, it.events)

    # iterate aggregates to fixpoint (bubbling can be multi-level)
    agg_ids = [iid for iid, it in items.items() if graphs.kind(it.type) == "aggregate"]
    for _ in range(len(agg_ids) + 1):
        changed = False
        for iid in agg_ids:
            it = items[iid]
            kids = children.get(iid, [])
            new = _bubble(graphs, items, kids, states, agg_item=it)
            if states.get(iid) != new:
                states[iid] = new
                changed = True
        if not changed:
            break
    return states


# states that count as an aggregate child being "done" (done_when_all_children_done)
_DONE_STATES = {"done", "resolved"}


def _bubble(graphs, items, kids, states, agg_item=None):
    """done iff ALL children done; in_progress iff ANY child is past its own
    initial state; else planned. A child whose state is not yet computed is
    treated as at its initial (not done, not in-progress).

    Vacuous case: a CHILDLESS aggregate (a standalone deliverable slice with no
    use-case children, e.g. a decommission slice) has no children to fold over.
    "all children done" is vacuously true, but we only conclude `done` when the
    aggregate carries its own `closed` audit marker (recorded at migration from
    its dora_ref/ledger closure) — otherwise a genuinely-empty planned aggregate
    would falsely read done. Without the marker, a childless aggregate is planned."""
    if not kids:
        if agg_item is not None and any(ev.get("event") == "closed"
                                        for ev in agg_item.events):
            return "done"
        return AGG_INITIAL
    if all(states.get(k) in _DONE_STATES for k in kids):
        return "done"
    if any(_child_past_initial(graphs, items, k, states) for k in kids):
        return "in_progress"
    return AGG_INITIAL


def _child_past_initial(graphs, items, k, states):
    """True iff child k is in a state other than its OWN type's initial state
    (and other than None). Uses the child's own type so a UC at 'registered'
    (its initial) does NOT count as progress, but a slice at 'in_progress' does."""
    st = states.get(k)
    if st is None:
        return False
    child = items.get(k)
    if not child:
        return False
    return st != graphs.initial(child.type)


def compute_children(items):
    """children[id] = ids of items whose `parents` include id (DERIVED, who-names-me)."""
    children = defaultdict(list)
    for iid, it in items.items():
        for p in it.parents:
            children[p].append(iid)
    for p in children:
        children[p].sort()
    return dict(children)


def compute_ancestors(items, iid):
    """Full parent chain (first parent walked upward). Guards against cycles."""
    chain = []
    seen = set()
    cur = iid
    while True:
        it = items.get(cur)
        if not it or not it.parents:
            break
        parent = it.parents[0]
        if parent in seen:
            break
        seen.add(parent)
        chain.append(parent)
        cur = parent
    return chain


def derived_block(graphs, items, states, children, iid):
    it = items[iid]
    state = states.get(iid)
    queue = graphs.queue_for(state) if state is not None else None
    return {
        "state": state,
        "queue": queue,
        "children": children.get(iid, []),
        "ancestors": compute_ancestors(items, iid),
    }


# ---------------------------------------------------------------------------
# Subcommand: append
# ---------------------------------------------------------------------------
def find_item_path(project, iid):
    d = items_dir(project)
    for sub in ("active", "done"):
        p = os.path.join(d, sub, f"{iid}.md")
        if os.path.exists(p):
            return p, sub
    return None, None


def cmd_append(a):
    graphs = Graphs.load()
    path, sub = find_item_path(a.project, a.id)
    if not path:
        sys.exit(f"append: no item {a.id} in work/{a.project}/items/(active|done)/")
    item = load_item(path)
    state = fold_state(graphs, item.type, item.events)
    if graphs.kind(item.type) == "aggregate":
        sys.exit(f"append: {a.id} is an aggregate ({item.type}); its state bubbles "
                 f"from children — you do not append flow events to it.")

    ok, to, legal_here = check_transition(graphs, item.type, state, a.event, a.agent)
    if not ok:
        legal_desc = ", ".join(f"{ev} (agents: {'/'.join(ags)})"
                               for ev, _to, ags in legal_here) or "(none — terminal state)"
        print(f"append REJECTED: {a.id} is in state '{state}'.", file=sys.stderr)
        # distinguish wrong-agent from illegal-event for a clearer message
        ev_exists = any(ev == a.event for ev, _t, _ags in legal_here)
        if ev_exists:
            print(f"  event '{a.event}' is legal here but not for agent '{a.agent}'.",
                  file=sys.stderr)
        else:
            print(f"  event '{a.event}' is not a legal transition from '{state}'.",
                  file=sys.stderr)
        print(f"  legal events from here: {legal_desc}", file=sys.stderr)
        print("  If this transition SHOULD exist, open an amendment experiment "
              "(EXP-NNN) to add it to process/machinery/state-graphs.json — "
              "do not hand-edit item state.", file=sys.stderr)
        sys.exit(1)

    ts = a.ts or now_iso()
    new_event = {"ts": ts, "event": a.event, "agent": a.agent}
    if a.ref:
        new_event["ref"] = a.ref
    if a.note:
        new_event["note"] = a.note
    item.fm.setdefault("events", [])
    item.fm["events"] = item.events + [new_event]

    # recompute derived for THIS item (children/ancestors need the whole set)
    items, _dup = load_all_items(a.project)
    items[a.id] = item  # our in-memory edited copy wins
    states = compute_states(graphs, items)
    children = compute_children(items)
    dv = derived_block(graphs, items, states, children, a.id)

    # if the append made it terminal, it must move to done/ (I4). We render in
    # place here; `project` performs the physical relocation authoritatively.
    with open(path, "w", encoding="utf-8") as f:
        f.write(render_item(item, dv))
    new_state = states.get(a.id)
    print(f"append: {a.id} {state} --({a.event}/{a.agent})--> {new_state}")
    _maybe_relocate(a.project, a.id, item, new_state, graphs)


def _maybe_relocate(project, iid, item, state, graphs):
    """Move a FLOW file between active/ and done/ so a terminal item lives in
    done/ (I4). Aggregates always stay in active/ — their state is derived from
    children, not their own event stream, so a bubbled-done chunk/slice is never
    physically archived (there is no own terminal event to archive on)."""
    if graphs.kind(item.type) == "aggregate":
        return
    terminal = state in graphs.terminals(item.type) or state in ("done", "resolved", "wontfix")
    want = "done" if terminal else "active"
    cur_path, cur_sub = find_item_path(project, iid)
    if cur_sub and cur_sub != want:
        dst_dir = os.path.join(items_dir(project), want)
        os.makedirs(dst_dir, exist_ok=True)
        dst = os.path.join(dst_dir, f"{iid}.md")
        os.replace(cur_path, dst)
        print(f"  relocated {iid} -> items/{want}/")


# ---------------------------------------------------------------------------
# Subcommand: project (recompute all views + re-render derived blocks)
# ---------------------------------------------------------------------------
def views_dir(project):
    return os.path.join(ROOT, "work", project, "views")


def cmd_project(a):
    graphs = Graphs.load()
    items, _dup = load_all_items(a.project)
    states = compute_states(graphs, items)
    children = compute_children(items)

    # 1. re-render every item's derived block + relocate terminal items to done/
    for iid, it in list(items.items()):
        dv = derived_block(graphs, items, states, children, iid)
        with open(it.path, "w", encoding="utf-8") as f:
            f.write(render_item(it, dv))
        _maybe_relocate(a.project, iid, it, states.get(iid), graphs)

    vd = views_dir(a.project)
    os.makedirs(vd, exist_ok=True)

    # 2. queues view
    queues = defaultdict(list)
    for iid in sorted(items):
        q = graphs.queue_for(states.get(iid))
        if q:
            queues[q].append(iid)
    _write_queues(vd, queues, states, items)

    # 3. state view
    _write_state(vd, states, items)

    # 4. tree view
    _write_tree(vd, items, children, states)

    # 5. stats view
    stats = compute_stats(graphs, items, states)
    _write_stats(vd, stats)

    qcounts = {q: len(v) for q, v in sorted(queues.items())}
    print(f"project: {len(items)} items | queues={qcounts} | "
          f"done={sum(1 for s in states.values() if s in ('done','resolved'))}")


def _write_queues(vd, queues, states, items):
    data = {q: queues[q] for q in sorted(queues)}
    with open(os.path.join(vd, "queues.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    L = [f"# Queues (derived) — generated {now_iso()}\n",
         "_Pure function of the item set via queue_map[state]. Do not hand-edit._\n",
         "| Queue | depth | items |", "|-------|-------|-------|"]
    for q in sorted(queues):
        L.append(f"| {q} | {len(queues[q])} | {', '.join(queues[q])} |")
    if not queues:
        L.append("| _(all items terminal/aggregate — no queues)_ | 0 | — |")
    with open(os.path.join(vd, "queues.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")


def _write_state(vd, states, items):
    L = [f"# Item state (derived) — generated {now_iso()}\n",
         "_state = fold(events) through the type graph (aggregates bubble). "
         "Do not hand-edit._\n",
         "| Item | type | state |", "|------|------|-------|"]
    for iid in sorted(states):
        L.append(f"| {iid} | {items[iid].type} | {states[iid]} |")
    with open(os.path.join(vd, "state.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")


def _write_tree(vd, items, children, states):
    L = [f"# Dependency tree (derived) — generated {now_iso()}\n",
         "_parents/children are the hierarchy (children = who-names-me); "
         "deps are peer prerequisites. Do not hand-edit._\n"]
    roots = [iid for iid, it in items.items() if not it.parents]

    def emit(iid, depth):
        it = items[iid]
        dep_s = f" deps={it.deps}" if it.deps else ""
        L.append(f"{'  ' * depth}- {iid} [{it.type}] "
                 f"({states.get(iid)}){dep_s}")
        for c in children.get(iid, []):
            emit(c, depth + 1)

    for r in sorted(roots):
        emit(r, 0)
    with open(os.path.join(vd, "tree.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")


# ---------------------------------------------------------------------------
# Stats — pure functions of event timestamps
# ---------------------------------------------------------------------------
def _first_ts(item, event_names):
    for ev in item.events:
        if ev.get("event") in event_names:
            return parse_ts(ev.get("ts"))
    return None


def _last_ts(item, event_names):
    found = None
    for ev in item.events:
        if ev.get("event") in event_names:
            found = parse_ts(ev.get("ts"))
    return found


def _median(xs):
    if not xs:
        return None
    s = sorted(xs)
    n = len(s)
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2


def compute_stats(graphs, items, states):
    flow = [it for it in items.values() if graphs.kind(it.type) == "flow"]
    done_ids = [it for it in flow if states.get(it.id) in ("done", "resolved")]

    lead_times, cycle_times = [], []
    for it in done_ids:
        reg = _first_ts(it, ("registered", "reported", "open"))
        done = _last_ts(it, ("validated", "closed"))
        if reg and done and done >= reg:
            lead_times.append((done - reg).total_seconds())
        pulled = _first_ts(it, ("pulled",))
        if pulled and done and done >= pulled:
            cycle_times.append((done - pulled).total_seconds())

    # MTTR: defects only (reported -> resolved)
    mttrs = []
    for it in items.values():
        if it.type != "defect":
            continue
        rep = _first_ts(it, ("reported",))
        res = _last_ts(it, ("validated",))
        if rep and res and res >= rep and states.get(it.id) == "resolved":
            mttrs.append((res - rep).total_seconds())

    # rework rate: flow items with any rework re-entry event / total flow items
    rework_events = {"build_failed", "rejected", "retried", "reopened"}
    reworked = sum(1 for it in flow
                   if any(ev.get("event") in rework_events for ev in it.events))
    rework_rate = (reworked / len(flow)) if flow else None

    wip = sum(1 for it in flow if graphs.queue_for(states.get(it.id)) == "wip")

    return {
        "throughput_done": len(done_ids),
        "lead_time_median_s": _median(lead_times),
        "lead_time_n": len(lead_times),
        "cycle_time_median_s": _median(cycle_times),
        "cycle_time_n": len(cycle_times),
        "mttr_median_s": _median(mttrs),
        "mttr_n": len(mttrs),
        "current_wip": wip,
        "rework_rate": rework_rate,
        "n_flow_items": len(flow),
    }


def _fmt(x):
    if x is None:
        return "—"
    if isinstance(x, float):
        return f"{x:.2f}" if x < 100 else f"{x:.0f}"
    return str(x)


def _write_stats(vd, stats):
    with open(os.path.join(vd, "stats.json"), "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2)
    L = [f"# Flow + DORA stats (derived) — generated {now_iso()}\n",
         "_Computed from item event timestamps. Substrate reset accepted "
         "(CONTRACT §4). Do not hand-edit._\n",
         "| Metric | Value | n |", "|--------|-------|---|",
         f"| Throughput (done) | {stats['throughput_done']} | — |",
         f"| Lead time median (registered→done) | {_fmt(stats['lead_time_median_s'])} s | "
         f"{stats['lead_time_n']} |",
         f"| Cycle time median (pulled→done) | {_fmt(stats['cycle_time_median_s'])} s | "
         f"{stats['cycle_time_n']} |",
         f"| MTTR median (defect reported→resolved) | {_fmt(stats['mttr_median_s'])} s | "
         f"{stats['mttr_n']} |",
         f"| Current WIP | {stats['current_wip']} | — |",
         f"| Rework rate | {_fmt(stats['rework_rate'])} | {stats['n_flow_items']} flow items |"]
    with open(os.path.join(vd, "stats.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")


# ---------------------------------------------------------------------------
# Subcommand: validate — the drift GATE (invariants I1–I4)
# ---------------------------------------------------------------------------
def cmd_validate(a):
    graphs = Graphs.load()
    violations = validate_items(graphs, a.project)
    if violations:
        print(f"validate: {len(violations)} violation(s) in {a.project}:", file=sys.stderr)
        for v in violations:
            print(f"  - {v}", file=sys.stderr)
        sys.exit(1)
    print(f"validate: {a.project} clean — I1–I4 all hold.")


def validate_items(graphs, project):
    items, dup_ids = load_all_items(project)
    states = compute_states(graphs, items)
    violations = []

    # I4a: exactly one file per id (dup ids across active/+done/)
    for d in sorted(set(dup_ids)):
        violations.append(f"(I4) id {d} appears in more than one item file")

    for iid, it in items.items():
        # I1: every event is a legal transition (flow types only)
        if graphs.kind(it.type) == "flow":
            st = graphs.initial(it.type)
            for idx, ev in enumerate(it.events):
                name = ev.get("event")
                # The GENESIS event names the item's initial state (the entry that
                # establishes state, e.g. `registered`/`reported`/`open`). It is not
                # itself a transition FROM anything, so it is legal by definition.
                if idx == 0 and name == graphs.initial(it.type):
                    continue
                nxt = None
                for t in graphs.transitions(it.type):
                    if t["from"] == st and t["event"] == name:
                        nxt = t["to"]
                        break
                if nxt is None:
                    violations.append(
                        f"(I1) {iid}: event #{idx + 1} '{name}' is not a legal "
                        f"transition from state '{st}'")
                    break  # can't fold further; one report per item is enough
                # also check the agent is allowed for that transition
                agents = next((t.get("agents", []) for t in graphs.transitions(it.type)
                               if t["from"] == st and t["event"] == name), [])
                if ev.get("agent") and ev.get("agent") not in agents:
                    violations.append(
                        f"(I1) {iid}: event #{idx + 1} '{name}' by agent "
                        f"'{ev.get('agent')}' not permitted (allowed: {agents})")
                st = nxt

        # I2: no item both terminal/done AND in a non-null queue
        state = states.get(iid)
        q = graphs.queue_for(state) if state is not None else None
        is_terminal = state in ("done", "resolved", "wontfix")
        if is_terminal and q is not None:
            violations.append(f"(I2) {iid}: terminal state '{state}' but queue '{q}' is non-null")

        # I4b: a done FLOW item must live in done/ (aggregates always stay in
        # active/ — their state is DERIVED from children, not their own stream,
        # so a bubbled-done chunk/slice is not physically archived).
        if graphs.kind(it.type) == "flow":
            if state in ("done", "resolved", "wontfix") and getattr(it, "subdir", None) == "active":
                violations.append(f"(I4) {iid}: terminal ('{state}') but in items/active/ (must be items/done/)")
            if state not in ("done", "resolved", "wontfix") and getattr(it, "subdir", None) == "done":
                violations.append(f"(I4) {iid}: non-terminal ('{state}') but in items/done/ (must be items/active/)")

    # I3: edge consistency — parents/deps resolve; no cycles in deps
    for iid, it in items.items():
        for p in it.parents:
            if p not in items:
                violations.append(f"(I3) {iid}: parent '{p}' does not resolve to an item")
        for d in it.deps:
            if d not in items:
                violations.append(f"(I3) {iid}: dep '{d}' does not resolve to an item")
    cyc = _find_dep_cycle(items)
    if cyc:
        violations.append(f"(I3) dependency cycle in deps: {' -> '.join(cyc)}")

    return violations


def _find_dep_cycle(items):
    """DFS for a cycle in the `deps` graph. Returns the cycle path or None."""
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {iid: WHITE for iid in items}
    stack = []

    def dfs(u):
        color[u] = GRAY
        stack.append(u)
        for v in items[u].deps:
            if v not in items:
                continue
            if color[v] == GRAY:
                return stack[stack.index(v):] + [v]
            if color[v] == WHITE:
                r = dfs(v)
                if r:
                    return r
        stack.pop()
        color[u] = BLACK
        return None

    for iid in items:
        if color[iid] == WHITE:
            r = dfs(iid)
            if r:
                return r
    return None


# ---------------------------------------------------------------------------
# Subcommand: migrate — one-shot from items.csv + ledger
# ---------------------------------------------------------------------------
# Synthesised legal paths to each current state, per type.
_FLOW_PATHS = {
    "use-case": {
        "ready": [("registered", "flow-manager"), ("made_ready", "flow-manager")],
        "done": [("registered", "flow-manager"), ("made_ready", "flow-manager"),
                 ("pulled", "orchestrator"), ("built_green", "engineer"),
                 ("validated", "tester")],
        "blocked": [("registered", "flow-manager"), ("made_ready", "flow-manager"),
                    ("blocked", "flow-manager")],
    },
    "defect": {
        "reported": [("reported", "orchestrator")],
        "done": [("reported", "orchestrator"), ("triaged", "orchestrator"),
                 ("confirmed", "engineer"), ("fixed", "engineer"), ("validated", "tester")],
        "resolved": [("reported", "orchestrator"), ("triaged", "orchestrator"),
                     ("confirmed", "engineer"), ("fixed", "engineer"), ("validated", "tester")],
        "wontfix": [("reported", "orchestrator"), ("triaged", "orchestrator"),
                    ("not_reproduced", "orchestrator")],
        "blocked": [("reported", "orchestrator"), ("triaged", "orchestrator"),
                    ("confirmed", "engineer"), ("blocked", "flow-manager")],
    },
    "open-item": {
        "open": [("open", "orchestrator")],
        "done": [("open", "orchestrator"), ("closed", "orchestrator")],
        "wontfix": [("open", "orchestrator"), ("declined", "orchestrator")],
    },
}
# defect terminal for "done"-ish is `resolved`; map csv "done" -> resolved for defects
_DEFECT_DONE_STATE = "resolved"


def _ledger_done_ids(project):
    """Set of ids the ledger closed via item_done (item_id or ref)."""
    ids = set()
    done_ts = {}   # id -> first item_done ts
    ledger = os.path.join(ROOT, "process", "dora", "ledger", f"{project}.csv")
    if not os.path.exists(ledger):
        return ids, done_ts
    with open(ledger, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("event") != "item_done":
                continue
            for key in ("item_id", "ref"):
                v = (row.get(key) or "").strip()
                if v:
                    ids.add(v)
                    ts = row.get("timestamp")
                    if v not in done_ts and ts:
                        done_ts[v] = ts
    return ids, done_ts


def _blocked_ids(project):
    ids = set()
    bp = os.path.join(items_dir(project), "blocks.csv")
    if os.path.exists(bp):
        with open(bp, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                v = (row.get("item") or "").strip()
                if v:
                    ids.add(v)
    return ids


def _load_mmd_deps(project):
    """Parse use-case-deps.mmd `A --> B` edges. mermaid node ids drop the hyphen
    (UC0, UC-CC1 -> UCCC1). Return {item_id: [dep_ids]} keyed by the CSV id form.
    We map mermaid node -> csv id by inserting the hyphen back: UC0 -> UC-0,
    UCCC1 -> UC-CC1 (best-effort; only used to populate `deps`)."""
    path = os.path.join(ROOT, "work", project, "architecture", "dependencies",
                        "use-case-deps.mmd")
    edges = defaultdict(list)
    if not os.path.exists(path):
        return {}
    edge_re = re.compile(r"^\s*([A-Za-z][\w]*)\s*-->\s*([A-Za-z][\w]*)\s*$")
    for line in open(path, encoding="utf-8"):
        m = edge_re.match(line)
        if not m:
            continue
        src, dst = _mmd_to_id(m.group(1)), _mmd_to_id(m.group(2))
        # edge A --> B means B depends on A (A is prerequisite)
        edges[dst].append(src)
    return {k: sorted(set(v)) for k, v in edges.items()}


def _mmd_to_id(node):
    """UC0 -> UC-0 ; UCCC1 -> UC-CC1 ; UCA1 -> UC-A1 ; UCO8 -> UC-O8.
    Insert a hyphen after the leading letter-run prefix (UC) that abuts the rest."""
    m = re.match(r"^(UC|SLC|CHK)(.*)$", node)
    if not m:
        return node
    return f"{m.group(1)}-{m.group(2)}"


def _title_for(project, row):
    """Best-effort title: from a slice's use-cases.md/slice.md if easily found,
    else the dora_ref's leading token, else the id."""
    iid = row["id"]
    dora_ref = (row.get("dora_ref") or "").strip()
    # take the leading token of dora_ref before the first ';' as a human-ish title
    if dora_ref:
        head = dora_ref.split(";")[0].strip()
        if head and head.upper() not in ("DONE", ""):
            return head
    return iid


def cmd_migrate(a):
    project = a.project
    csv_path = os.path.join(items_dir(project), "items.csv")
    if not os.path.exists(csv_path):
        sys.exit(f"migrate: no items.csv at {csv_path}")
    graphs = Graphs.load()

    done_ids, done_ts = _ledger_done_ids(project)
    blocked = _blocked_ids(project)
    mmd_deps = _load_mmd_deps(project)

    active_dir = os.path.join(items_dir(project), "active")
    done_dir = os.path.join(items_dir(project), "done")
    os.makedirs(active_dir, exist_ok=True)
    os.makedirs(done_dir, exist_ok=True)

    rows = []
    with open(csv_path, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    created = 0
    for row in rows:
        iid = (row.get("id") or "").strip()
        if not iid:
            continue
        itype = (row.get("type") or "").strip()
        parent = (row.get("parent") or "").strip()
        parents = [p for p in parent.split(";") if p] if parent else []
        deps = mmd_deps.get(iid, [])
        created_ts = (row.get("created_ts") or "").strip() or now_iso()
        dora_ref = (row.get("dora_ref") or "").strip()

        # determine current state
        is_done = ("DONE" in dora_ref.upper()) or (iid in done_ids)
        is_blocked = iid in blocked
        is_wontfix = ("WONT-DO" in dora_ref.upper() or "WONTFIX" in dora_ref.upper()
                      or "SUPERSEDED" in dora_ref.upper())

        kind = graphs.kind(itype)
        if kind == "aggregate":
            # aggregates carry only registration for audit; state bubbles from children.
            events = [{"ts": created_ts, "event": "registered", "agent": "flow-manager"}]
            # A CHILDLESS aggregate that was itself closed (standalone deliverable
            # slice, e.g. a decommission slice) records a `closed` audit marker so
            # the vacuous empty-children bubble resolves to done, not planned.
            children_col = (row.get("children") or "").strip()
            if not children_col and ("DONE" in dora_ref.upper() or iid in done_ids):
                events.append({"ts": done_ts.get(iid) or created_ts,
                               "event": "closed", "agent": "flow-manager"})
            subdir = "active"  # aggregate physical location = active (state derived)
        else:
            state = _target_flow_state(itype, is_done, is_blocked, is_wontfix)
            events = _synth_events(itype, state, created_ts, done_ts.get(iid))
            subdir = "done" if state in ("done", "resolved", "wontfix") else "active"

        title = _title_for(project, row)
        fm = {
            "id": iid,
            "type": itype,
            "title": title,
            "job": (row.get("job") or "").strip() or None,
            "value": _num(row.get("value")),
            "cost": _num(row.get("cost")),
            "parents": parents,
            "deps": deps,
            "created_ts": created_ts,
            "events": events,
        }
        body = _migrate_body(project, row, title)
        item = Item(os.path.join(items_dir(project), subdir, f"{iid}.md"), fm, body)
        # write to correct folder; ensure no stale copy in the other folder
        _remove_other(project, iid, subdir)
        # derived block will be finalised by `project`; render a provisional one
        with open(item.path, "w", encoding="utf-8") as fo:
            fo.write(render_item(item, {"state": None, "queue": None,
                                        "children": [], "ancestors": []}))
        created += 1

    # finalise derived blocks + relocate + write views by running project logic
    ns = argparse.Namespace(project=project)
    cmd_project(ns)
    print(f"migrate: {created} item file(s) created from {len(rows)} row(s) in items.csv")


def _num(v):
    v = (v or "").strip()
    if not v:
        return None
    try:
        f = float(v)
        return int(f) if f == int(f) else f
    except ValueError:
        return v


def _target_flow_state(itype, is_done, is_blocked, is_wontfix):
    # `is_done` is AUTHORITATIVE (a ledger item_done closure or an explicit DONE
    # marker in this item's own dora_ref) and takes precedence over the looser
    # `is_wontfix` TEXT heuristic — the text can match a cross-reference to another
    # item (e.g. a defect note mentioning "UC-SP5-superseded"), which must NOT
    # reclassify a genuinely-closed item as wontfix.
    if itype == "defect":
        if is_done:
            return "resolved"
        if is_wontfix:
            return "wontfix"
        if is_blocked:
            return "blocked"
        return "reported"
    if itype == "open-item":
        if is_done:
            return "done"
        if is_wontfix:
            return "wontfix"
        return "open"
    # use-case
    if is_done:
        return "done"
    if is_wontfix:
        # a use-case has no wontfix terminal in the graph; a superseded/wont-do UC
        # is treated as closed (done) for migration — see _synth_events fallback.
        return "wontfix"
    if is_blocked:
        return "blocked"
    return "ready"


def _synth_events(itype, state, created_ts, terminal_ts):
    """Build a LEGAL path of events ending in `state`, with monotonic timestamps.
    First event stamped created_ts; terminal event stamped terminal_ts if known;
    intermediate steps interpolated between."""
    path = _FLOW_PATHS.get(itype, {}).get(state)
    if path is None:
        # wontfix for use-case has no synth path; fall back to a minimal legal one
        if itype == "use-case" and state == "wontfix":
            # use-case graph has no wontfix; treat as done (superseded == closed)
            path = _FLOW_PATHS["use-case"]["done"]
            state = "done"
        else:
            path = [(list(_graph_initial_event(itype)))]
    start = parse_ts(created_ts) or datetime.now(timezone.utc)
    end = parse_ts(terminal_ts) if terminal_ts else None
    n = len(path)
    events = []
    if end and end > start and n > 1:
        step = (end - start) / (n - 1)
    else:
        step = timedelta(minutes=1)
    for i, (ev, agent) in enumerate(path):
        if i == 0:
            ts = start
        elif end and i == n - 1:
            ts = end
        else:
            ts = start + step * i
        events.append({"ts": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                       "event": ev, "agent": agent})
    return events


def _graph_initial_event(itype):
    return {"use-case": ("registered", "flow-manager"),
            "defect": ("reported", "orchestrator"),
            "open-item": ("open", "orchestrator")}.get(itype, ("registered", "flow-manager"))


def _remove_other(project, iid, keep_sub):
    other = "done" if keep_sub == "active" else "active"
    p = os.path.join(items_dir(project), other, f"{iid}.md")
    if os.path.exists(p):
        os.remove(p)


def _migrate_body(project, row, title):
    """Pull real definition from a slice's use-cases.md/slice.md if easily found,
    else a stub referencing the dora_ref."""
    iid = row["id"]
    dora_ref = (row.get("dora_ref") or "").strip()
    defn = _find_definition(project, row)
    if defn:
        return f"\n## Definition\n\n{defn}\n"
    return (f"\n## Definition\n\n_{title}_ (migrated from items.csv). "
            f"dora_ref: `{dora_ref or '—'}`. "
            f"Definition text not auto-located; fill in from the slice docs.\n")


def _find_definition(project, row):
    """Best-effort: if the row is a slice, read the first paragraph of its
    slice.md; if a use-case, try to grab its line from the parent slice's
    use-cases.md. Kept simple — a stub is acceptable per the contract."""
    iid = row["id"]
    itype = (row.get("type") or "").strip()
    slices_root = os.path.join(ROOT, "work", project, "slices")
    if not os.path.isdir(slices_root):
        return None
    if itype == "slice":
        # find a slice dir starting with the numeric part of the slice id
        m = re.match(r"SLC-(\d+)", iid)
        if m:
            prefix = m.group(1)
            for d in sorted(os.listdir(slices_root)):
                if d.startswith(prefix + "-") or d.startswith(prefix):
                    sm = os.path.join(slices_root, d, "slice.md")
                    if os.path.exists(sm):
                        return _first_paragraph(sm)
    return None


def _first_paragraph(path):
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return None
    # skip a leading frontmatter/heading, grab first non-heading paragraph
    for block in re.split(r"\n\s*\n", text):
        b = block.strip()
        if b and not b.startswith("#") and not b.startswith("---"):
            return b[:600]
    return None


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main(argv=None):
    p = argparse.ArgumentParser(prog="work-items")
    sub = p.add_subparsers(dest="cmd", required=True)

    ap = sub.add_parser("append")
    ap.add_argument("--project", required=True)
    ap.add_argument("--id", required=True)
    ap.add_argument("--event", required=True)
    ap.add_argument("--agent", required=True)
    ap.add_argument("--ref")
    ap.add_argument("--note")
    ap.add_argument("--ts")
    ap.set_defaults(func=cmd_append)

    pr = sub.add_parser("project")
    pr.add_argument("--project", required=True)
    pr.set_defaults(func=cmd_project)

    va = sub.add_parser("validate")
    va.add_argument("--project", required=True)
    va.set_defaults(func=cmd_validate)

    mi = sub.add_parser("migrate")
    mi.add_argument("--project", required=True)
    mi.set_defaults(func=cmd_migrate)

    a = p.parse_args(argv)
    a.func(a)


if __name__ == "__main__":
    main()
