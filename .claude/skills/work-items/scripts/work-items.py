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
import argparse, csv, json, os, re, subprocess, sys
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
# Statusline snapshot — the cheap pre-formatted file .claude/statusline.py reads.
# work-items.py is now the writer (ledger cutover: dora.py is retiring). We
# MERGE-update (read existing JSON, set keys, write back) so retro-debt keys and
# the DORA keys never clobber each other. Schema matched from .claude/statusline.py:
# flat top-level keys `project`, `cfr` (int %), `freq` (/active-day), `lead` (s),
# `par` (2dp float), plus `retro_debt_<project>` / `retro_due_<project>`.
# ---------------------------------------------------------------------------
STATUSLINE = os.path.join(ROOT, "process", "dora", "statusline.json")


def write_statusline(updates):
    """Merge `updates` into process/dora/statusline.json (mirrors dora.py). None
    values are stored as JSON null so a metric with no data renders as '–'."""
    data = {}
    if os.path.exists(STATUSLINE):
        try:
            with open(STATUSLINE, encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            data = {}
    data.update(updates)
    os.makedirs(os.path.dirname(STATUSLINE), exist_ok=True)
    with open(STATUSLINE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=0)


def _r0(x):
    """Round to int for the statusline (matches dora.py's _r0); None passes through."""
    return round(x) if isinstance(x, (int, float)) else None


# ---------------------------------------------------------------------------
# State-graph loader
# ---------------------------------------------------------------------------
class Graphs:
    """Loaded state-graphs.json — the declarative per-type state machines."""

    def __init__(self, data):
        self.version = data.get("version")
        self.queue_map = data.get("queue_map", {})
        self.state_owners = data.get("state_owners", {})
        self.types = data.get("types", {})

    def owner_of(self, state):
        """Who is accountable for time spent in `state` — an agent name, or the
        classes 'queue' (pure wait) / 'external' (blocked outside the system).
        Terminal/aggregate states have no owner (None)."""
        v = self.state_owners.get(state)
        return v if v and not v.startswith("_") else None

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


def _unescape_dq(s):
    """Unescape a double-quoted scalar body: \\" -> " and \\\\ -> \\ (left-to-right)."""
    out = []
    i = 0
    while i < len(s):
        if s[i] == "\\" and i + 1 < len(s) and s[i + 1] in '"\\':
            out.append(s[i + 1])
            i += 2
        else:
            out.append(s[i])
            i += 1
    return "".join(out)


def _parse_scalar(v):
    v = v.strip()
    if v == "" or v == "~" or v == "null":
        return None
    if v.startswith('"') and v.endswith('"') and len(v) >= 2:
        return _unescape_dq(v[1:-1])
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
    """Split on commas not inside braces/brackets and not inside a double-quoted
    string (honouring \\-escapes), so a quoted `note` containing commas stays whole."""
    out, depth, cur = [], 0, ""
    in_str = False
    esc = False
    for ch in s:
        if in_str:
            cur += ch
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
            cur += ch
            continue
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
        return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return s


def _render_list(vals):
    return "[" + ", ".join(_q(v) for v in vals) + "]"


def _render_event(ev):
    parts = [f"ts: {_q(ev.get('ts'))}", f"event: {_q(ev.get('event'))}",
             f"agent: {_q(ev.get('agent'))}"]
    if ev.get("ref") not in (None, ""):
        parts.append(f"ref: {_q(ev.get('ref'))}")
    # tokens: OPTIONAL subagent token cost of producing this transition. Rendered
    # only when present (absent ⇒ unknown, treated as 0 by the cost-split fold).
    if ev.get("tokens") not in (None, ""):
        parts.append(f"tokens: {_q(ev.get('tokens'))}")
    # duration_ms: OPTIONAL real per-stage work-effort (the dispatched agent's
    # reported cycle time for THIS transition). Rides the event exactly as `tokens`
    # does; absent ⇒ unknown, treated as 0/uncounted by the agent-cycle-time fold.
    if ev.get("duration_ms") not in (None, ""):
        parts.append(f"duration_ms: {_q(ev.get('duration_ms'))}")
    if ev.get("note") not in (None, ""):
        parts.append(f"note: {_q(ev.get('note'))}")
    return "{" + ", ".join(parts) + "}"


# Field render order for the frontmatter (contract's order).
_FIELD_ORDER = ["id", "type", "title", "job", "value", "cost",
                "parents", "deps", "created_ts"]


def _render_map(vals):
    """Render a {k: v} scalar map inline for a nested derived field."""
    return "{" + ", ".join(f"{k}: {_q(v)}" for k, v in vals.items()) + "}"


def _render_metrics_block(L, metrics):
    """Render the per-item DORA/flow `metrics:` sub-block under derived: (nested,
    2-space indent). No-op when metrics is None (aggregates)."""
    if not metrics:
        return
    L.append("  metrics:")
    L.append(f"    gross_lead_time_s: {_q(metrics.get('gross_lead_time_s'))}")
    L.append(f"    cycle_time_s: {_q(metrics.get('cycle_time_s'))}")
    L.append(f"    time_in_state: {_render_map(metrics.get('time_in_state', {}))}")
    L.append(f"    time_by_owner: {_render_map(metrics.get('time_by_owner', {}))}")
    L.append(f"    rework_count: {_q(metrics.get('rework_count'))}")
    rec = metrics.get("recovery", {})
    L.append(f"    recovery: {{n: {_q(rec.get('n'))}, "
             f"mttr_median_s: {_q(rec.get('mttr_median_s'))}, "
             f"mttr_mean_s: {_q(rec.get('mttr_mean_s'))}}}")
    tok = metrics.get("tokens", {})
    L.append(f"    tokens: {{total: {_q(tok.get('total'))}, "
             f"plumbing: {_q(tok.get('plumbing'))}, "
             f"delivery: {_q(tok.get('delivery'))}}}")


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
    _render_metrics_block(L, derived.get("metrics"))
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
# A cancelled child is terminal-but-not-delivered: it must NOT block an aggregate
# from completing, but it also does not, by itself, make the aggregate "done".
_TERMINAL_RESOLVED = _DONE_STATES | {"cancelled"}


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
    if all(states.get(k) in _TERMINAL_RESOLVED for k in kids):
        # every child is terminal: done if at least one actually delivered,
        # else (all cancelled) the aggregate itself is cancelled.
        return "done" if any(states.get(k) in _DONE_STATES for k in kids) else "cancelled"
    # An aggregate whose only non-terminal (not-yet-delivered) children are ALL
    # `blocked` is itself blocked: no work can progress until they clear. This
    # keeps a parked-on-external aggregate out of the "in_progress" view (queues,
    # stats, board) instead of masquerading as actively-worked. As soon as one
    # non-terminal child is unblocked/working, it falls through to in_progress.
    non_terminal = [k for k in kids if states.get(k) not in _TERMINAL_RESOLVED]
    if non_terminal and all(states.get(k) == "blocked" for k in non_terminal):
        return "blocked"
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


def derived_block(graphs, items, states, children, iid, now=None):
    it = items[iid]
    state = states.get(iid)
    queue = graphs.queue_for(state) if state is not None else None
    d = {
        "state": state,
        "queue": queue,
        "children": children.get(iid, []),
        "ancestors": compute_ancestors(items, iid),
    }
    # per-item DORA/flow metrics (flow items only; aggregates have no own stream)
    m = per_item_metrics(graphs, it, now)
    if m is not None:
        d["metrics"] = m
    return d


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
    # tokens: the subagent_tokens the dispatched specialist spent producing this
    # transition. Optional — rides the state event so cost-split is a pure fold.
    if getattr(a, "tokens", None) is not None:
        new_event["tokens"] = a.tokens
    # duration_ms: the dispatched agent's REAL cycle time (work-effort) for this
    # transition. Optional — rides the state event so agent-cycle-time is a pure fold.
    if getattr(a, "duration_ms", None) is not None:
        new_event["duration_ms"] = a.duration_ms
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
    terminal = state in graphs.terminals(item.type) or state in ("done", "resolved", "wontfix", "cancelled")
    want = "done" if terminal else "active"
    cur_path, cur_sub = find_item_path(project, iid)
    if cur_sub and cur_sub != want:
        dst_dir = os.path.join(items_dir(project), want)
        os.makedirs(dst_dir, exist_ok=True)
        dst = os.path.join(dst_dir, f"{iid}.md")
        os.replace(cur_path, dst)
        print(f"  relocated {iid} -> items/{want}/")
        _git_stage_relocation(project, cur_path, dst)


def _git_stage_relocation(project, cur_path, dst):
    """Best-effort: record the active/<->done/ rename in the project's git repo
    so a completed item's `items/done/<ID>.md` is never left UNTRACKED (a recurring
    hygiene gap — the file moved on disk via os.replace above, but git was never
    told, so a later *targeted* `git add <paths>` in the commit step silently
    missed the new file; observed on UC-ADIX-009, UC-ADIX-010, ...).

    Staging (not committing) is exactly the caller's intent here: wi mutations are
    always followed by a commit of the item change, so the moved file must be in
    the index. This NEVER raises and NEVER affects the move — the relocation has
    already succeeded above; this only annotates git. It is a silent no-op outside
    a git repo (the machinery's own temp-dir tests) and in the parent/integration
    tree (where `work/*` is gitignored, so the pathspec is ignored and git exits
    non-zero, which we swallow). `git add -A -- <old> <new>` stages BOTH the
    deletion of the vacated path and the addition of the new one."""
    repo = os.path.join(ROOT, "work", project)
    try:
        subprocess.run(
            ["git", "-C", repo, "add", "-A", "--", cur_path, dst],
            check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


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
    now = parse_ts(getattr(a, "now", None)) if getattr(a, "now", None) else None

    # `project --item <ID>`: print ONE item's per-item metrics to stdout and stop
    # (no re-render / view rewrite). A focused read for a single work item.
    item_id = getattr(a, "item", None)
    if item_id:
        if item_id not in items:
            sys.exit(f"project --item: no item {item_id} in work/{a.project}/items/")
        m = per_item_metrics(graphs, items[item_id], now)
        if m is None:
            print(f"{item_id} is an aggregate ({items[item_id].type}); "
                  f"per-item flow metrics apply to flow items only.")
            return
        print(_render_item_metrics_text(m))
        return

    # 1. re-render every item's derived block + relocate terminal items to done/
    for iid, it in list(items.items()):
        dv = derived_block(graphs, items, states, children, iid, now=now)
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

    # 5. stats view (reuses `now` computed above)
    stats = compute_stats(graphs, items, states, now=now)
    _write_stats(vd, stats)

    # 6. statusline snapshot — the DORA keys .claude/statusline.py renders.
    # Merge (not overwrite) so retro_debt_*/retro_due_* keys survive. Uses the
    # ALL-TIME DORA figures; cfr as an integer percent (statusline prints "<cfr>%").
    dora = stats["overall"]["dora"]["all_time"]
    cfr = dora["change_failure_rate"]
    write_statusline({
        "project": a.project,
        "cfr": _r0(cfr * 100) if cfr is not None else None,
        "freq": _r0(dora["deployment_frequency_per_active_day"]),
        "lead": _r0(dora["lead_time_for_changes_median_s"]),
    })

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
# Stats — pure functions of event timestamps (SOLE record; cutover from ledger).
#
# Everything here reads ONLY the items' `events:` streams. The design idea: fold
# gives the state BETWEEN two consecutive events, so time-in-state[S] = Σ of the
# intervals whose leading event lands the item in S. state_owners maps each state
# to who is accountable for that time (an agent, or the classes 'queue' = pure
# wait latency / 'external' = blocked outside the system) — that is how each part
# of the process reads its own contribution to gross lead time.
# ---------------------------------------------------------------------------
TERMINAL_STATES = {"done", "resolved", "wontfix", "cancelled"}
GENESIS_EVENTS = ("registered", "reported", "open")
REWORK_ENTRY_EVENTS = {"build_failed", "deploy_failed", "rejected", "retried", "reopened"}
# v4: the use-case validation stage is split dev-then-prod; the defect graph still
# uses one `validating`. Any `rejected` exit from ANY of these is a change failure,
# so CFR/quality-by-stage fold over the whole set (kept as one metric family).
VALIDATING_STATES = {"validating", "dev-validating", "prod-validating"}

# --- plumbing vs delivery cost classification (ported verbatim from dora.py's
# cost-split, v59/EXP-067; the ledger it read is now frozen, so the SAME rule is
# reimplemented here over item EVENTS so the metric stays continuous) -----------
# "Plumbing" = the cost of RUNNING the agent OS (coordination, flow management,
# bookkeeping, gates) vs producing/validating customer value ("delivery"). Rule
# (identical to dora.py:cost_class): an event is plumbing if its agent runs the
# machine (orchestrator/flow-manager) OR its event is a coordination/bookkeeping
# marker; everything else (engineer/tester/ui/product/architect/cicd/documenter
# building, validating, designing, deploying) is delivery.
PLUMBING_AGENTS = {"orchestrator", "flow-manager"}
# dora.py's PLUMBING_EVENTS were ledger bookkeeping rows (enqueue/dequeue/retro/
# item_registered/loop_wake/parallel_dispatch/collision/gate_decision/
# log_decision). In the work-item event vocabulary the equivalent coordination/
# bookkeeping transitions are the flow-manager/orchestrator markers below; the
# agent rule already subsumes them (they are all fired by a plumbing agent), so
# the split is identical whether keyed on agent or event.
PLUMBING_EVENTS = {"registered", "made_ready", "pulled", "blocked", "unblocked",
                   "scheduled", "reported", "triaged"}


def cost_class(agent, event):
    """plumbing iff agent runs the OS OR the event is a coordination/bookkeeping
    marker; else delivery. Verbatim rule from dora.py:cost_class."""
    return "plumbing" if (agent in PLUMBING_AGENTS or event in PLUMBING_EVENTS) else "delivery"


def _compute_token_cost(flow_items):
    """Token-cost section: total, by_owner (fold each event's `tokens` through the
    event's AGENT — the owner that produced the transition), and the
    plumbing-vs-delivery split (dora.py's classification, ported). An event with
    no `tokens` contributes 0 and is not counted toward coverage. `token_coverage`
    = fraction of events that carried a `tokens` value (mirrors dora.py's coverage
    over task_end rows), so a project whose events pre-date `--tokens` reads 0."""
    total = 0
    by_owner = defaultdict(int)
    split = {"plumbing": 0, "delivery": 0}
    n_events = 0
    n_with_tokens = 0
    for it in flow_items:
        for ev in it.events:
            n_events += 1
            tk = ev.get("tokens")
            if not isinstance(tk, (int, float)):
                continue
            tk = int(tk)
            n_with_tokens += 1
            total += tk
            by_owner[ev.get("agent") or "unowned"] += tk
            split[cost_class(ev.get("agent"), ev.get("event"))] += tk
    coverage = (n_with_tokens / n_events) if n_events else None
    return {
        "total_tokens": total,
        "by_owner": {o: by_owner[o] for o in sorted(by_owner, key=lambda k: -by_owner[k])},
        "plumbing_vs_delivery": {
            "plumbing_tokens": split["plumbing"],
            "delivery_tokens": split["delivery"],
            "plumbing_share": _ratio(split["plumbing"], total),
        },
        "token_coverage": coverage,
        "n_events_with_tokens": n_with_tokens,
        "n_events": n_events,
    }


def _walk_events(graphs, item):
    """Yield (from_state, event) for each event that is a legal transition, where
    from_state is the state the item was IN when the event fired — i.e. the STAGE in
    which the producing agent did the work (built_green fires from `building`, so the
    engineer's effort is attributed to `building`). The genesis event yields the
    item's initial state. Illegal-from-here events are skipped (mirrors walk_states /
    _exits_from). Empty for aggregates (no own stream)."""
    if graphs.kind(item.type) != "flow":
        return
    trans = graphs.transitions(item.type)
    state = graphs.initial(item.type)
    first = True
    for ev in item.events:
        name = ev.get("event")
        if first:
            first = False
            if name == graphs.initial(item.type):
                yield (state, ev)  # genesis: effort (if any) sits in the initial state
                continue
        nxt = None
        for t in trans:
            if t["from"] == state and t["event"] == name:
                nxt = t["to"]
                break
        if nxt is None:
            continue
        yield (state, ev)
        state = nxt


def _compute_agent_cycle_time(graphs, flow_items, glt_total_s):
    """Section F — the REAL per-stage work-effort each dispatched agent spent
    (duration_ms), folded alongside gross lead time. GLT stays the honest TOTAL
    elapsed (waits + steering gaps + outages included); this is its complement.

    - by_owner: total/median/n duration_ms folded through the event's AGENT (who
      did the work).
    - by_stage: total/median/n duration_ms folded through the FROM-state of the
      transition (where the work happened), carrying that state's owner.
    - cycle_time_vs_glt: Σ agent effort (s) / gross-lead-time total (s) — how much
      of the total lead time was actual agent effort vs wait/overhead. None when GLT
      is 0 (nothing timed).
    - duration_coverage: fraction of legal-walk events that carried a duration_ms
      (grows as dispatches pass --duration-ms).
    """
    by_owner = defaultdict(list)   # owner (agent) -> [durations_ms]
    by_stage = defaultdict(list)   # from-state    -> [durations_ms]
    total_ms = 0
    n_events = 0
    n_with = 0
    for it in flow_items:
        for from_state, ev in _walk_events(graphs, it):
            n_events += 1
            d = ev.get("duration_ms")
            if not isinstance(d, (int, float)):
                continue
            d = int(d)
            n_with += 1
            total_ms += d
            by_owner[ev.get("agent") or "unowned"].append(d)
            by_stage[from_state].append(d)

    def pack_owner(m):
        return {o: {"total_ms": sum(v), "median_ms": _median(v), "n": len(v)}
                for o, v in sorted(m.items(), key=lambda kv: -sum(kv[1]))}
    by_stage_out = {
        st: {"total_ms": sum(v), "median_ms": _median(v), "n": len(v),
             "owner": graphs.owner_of(st)}
        for st, v in sorted(by_stage.items(), key=lambda kv: -sum(kv[1]))
    }
    total_s = total_ms / 1000.0
    return {
        "total_ms": total_ms,
        "total_s": round(total_s, 2),
        "by_owner": pack_owner(by_owner),
        "by_stage": by_stage_out,
        "gross_lead_time_total_s": glt_total_s,
        # None when no duration data (the ratio is UNKNOWN, not zero effort) — mirrors
        # token_cost.plumbing_share; a 0 would falsely read "no effort".
        "cycle_time_vs_glt": (_ratio(total_s, glt_total_s) if total_ms else None),
        "duration_coverage": (n_with / n_events) if n_events else None,
        "n_events_with_duration": n_with,
        "n_events": n_events,
    }


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


def _mean(xs):
    return (sum(xs) / len(xs)) if xs else None


def _percentile(xs, p):
    """Linear-interpolation percentile (p in [0,1]). None on empty."""
    if not xs:
        return None
    s = sorted(xs)
    if len(s) == 1:
        return s[0]
    k = (len(s) - 1) * p
    lo = int(k)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def _ratio(num, den):
    return (num / den) if den else None


def walk_states(graphs, item, now):
    """Replay an item's events, yielding (state, entered_ts, exited_ts) segments.

    fold gives the state BETWEEN consecutive events; a segment runs from the ts of
    the event that ENTERED a state to the ts of the next (transition) event. The
    genesis event enters the item's initial state. The final open segment runs to
    `now` (for a still-in-flight item) OR is closed by the terminal event. Illegal
    events (I1 territory) are skipped for the walk so a bad hand-edit can't crash
    stats. Returns [] for aggregates (no own stream)."""
    if graphs.kind(item.type) != "flow":
        return []
    trans = graphs.transitions(item.type)
    state = graphs.initial(item.type)
    entered = None
    segments = []
    for ev in item.events:
        name = ev.get("event")
        ts = parse_ts(ev.get("ts"))
        if entered is None:
            # genesis: this event establishes the initial state
            if name == graphs.initial(item.type):
                entered = ts
                continue
            # tolerate a missing genesis marker: first event still starts the clock
            entered = ts
        nxt = None
        for t in trans:
            if t["from"] == state and t["event"] == name:
                nxt = t["to"]
                break
        if nxt is None:
            continue  # illegal-from-here; ignore for the walk
        if ts and entered and ts >= entered:
            segments.append((state, entered, ts))
        state = nxt
        entered = ts
    # trailing open segment (item still in `state`); close at `now` unless terminal
    if entered is not None and state not in TERMINAL_STATES and now and now >= entered:
        segments.append((state, entered, now))
    return segments


def _exits_from(graphs, item):
    """Count exits from each state by event, for quality (fail-exit) ratios.
    Returns {state: {event: count}} over the LEGAL walk of transitions."""
    trans = graphs.transitions(item.type)
    state = graphs.initial(item.type)
    exits = defaultdict(lambda: defaultdict(int))
    first = True
    for ev in item.events:
        name = ev.get("event")
        if first:
            first = False
            if name == graphs.initial(item.type):
                continue
        nxt = None
        for t in trans:
            if t["from"] == state and t["event"] == name:
                nxt = t["to"]
                break
        if nxt is None:
            continue
        exits[state][name] += 1
        state = nxt
    return exits


def _duration_after(item, trigger_events, resolve_events):
    """List of (seconds) from each `trigger` event to the NEXT `resolve` event
    that follows it in the stream (recovery timing). Used for MTTR-by-class."""
    out = []
    pending = None
    for ev in item.events:
        name = ev.get("event")
        ts = parse_ts(ev.get("ts"))
        if name in trigger_events:
            pending = ts
        elif name in resolve_events and pending is not None and ts and ts >= pending:
            out.append((ts - pending).total_seconds())
            pending = None
    return out


def _in_window(ts, now, days):
    if days is None:
        return True
    if not ts or not now:
        return False
    return ts >= (now - timedelta(days=days))


def _compute_dora(graphs, flow_items, states, now, window_days):
    """Section A — the four DORA metrics over a set of flow items, windowed by
    the TERMINAL event's timestamp for rate metrics (frequency, CFR)."""
    # deployment_frequency: terminal validated/done/deploy events per active-day
    terminal_ts = []
    for it in flow_items:
        t = _last_ts(it, ("validated", "closed", "deploy"))
        if t is None and states.get(it.id) in TERMINAL_STATES:
            t = _last_ts(it, ("not_reproduced", "declined"))
        if t and _in_window(t, now, window_days):
            terminal_ts.append(t)
    days = {t.date() for t in terminal_ts}
    freq = _ratio(len(terminal_ts), len(days))

    # lead_time_for_changes: built_green -> validated per item (median + p85)
    lts = []
    for it in flow_items:
        bg = _first_ts(it, ("built_green", "fixed"))
        vd_ts = _last_ts(it, ("validated",))
        if bg and vd_ts and vd_ts >= bg and _in_window(vd_ts, now, window_days):
            lts.append((vd_ts - bg).total_seconds())

    # change_failure_rate [retro v87]: (validation rejections + deploy-pipeline
    # failures) / (validations + deploy failures). A `rejected` (tester validation
    # failure, exit from ANY validating stage — v4 dev/prod split + defect single
    # `validating`) OR a `deploy_failed` (deploy/CI failure, e.g. a red pipeline on
    # push) is a change failure. deploy_failed was added because a fixed-forward
    # deploy failure recorded only `built_green` was invisible → CFR read a false 0%.
    validated = rejected = deploy_failed = 0
    for it in flow_items:
        for st, evc in _exits_from(graphs, it).items():
            for name, c in evc.items():
                if st in VALIDATING_STATES and name == "validated":
                    validated += c
                elif st in VALIDATING_STATES and name == "rejected":
                    rejected += c
                elif name == "deploy_failed":
                    deploy_failed += c
    cfr = _ratio(rejected + deploy_failed, validated + rejected + deploy_failed)

    # mttr: any failure event -> its recovery (aggregated across the classes in D)
    all_recoveries = []
    for it in flow_items:
        all_recoveries += _duration_after(it, {"build_failed"}, {"built_green", "retried", "done", "validated"})
        all_recoveries += _duration_after(it, {"deploy_failed"}, {"built_green", "retried", "deployed", "done", "validated"})
        all_recoveries += _duration_after(it, {"rejected"}, {"validated", "resolved", "done"})
        all_recoveries += _duration_after(it, {"reported"}, {"validated", "resolved"})

    return {
        "deployment_frequency_per_active_day": freq,
        "n_terminal_events": len(terminal_ts),
        "n_active_days": len(days),
        "lead_time_for_changes_median_s": _median(lts),
        "lead_time_for_changes_p85_s": _percentile(lts, 0.85),
        "lead_time_n": len(lts),
        "change_failure_rate": cfr,
        "n_validations": validated + rejected,
        "n_validation_failures": rejected,
        "n_deploy_failures": deploy_failed,
        "mttr_median_s": _median(all_recoveries),
        "mttr_mean_s": _mean(all_recoveries),
        "mttr_n": len(all_recoveries),
    }


def _compute_glt(graphs, flow_items, now):
    """Section B — gross-lead-time decomposition. by_state (time thieves) and
    by_owner (each part's contribution via state_owners). Only DONE items have a
    real gross lead time (genesis->terminal); in-flight items contribute their
    partial time-in-state so 'now' cost is visible too."""
    by_state = defaultdict(float)
    by_owner = defaultdict(float)
    gross_totals = []  # per-DONE-item gross lead time
    for it in flow_items:
        segs = walk_states(graphs, it, now)
        for state, a, b in segs:
            dur = (b - a).total_seconds()
            if dur < 0:
                continue
            by_state[state] += dur
            owner = graphs.owner_of(state) or "unowned"
            by_owner[owner] += dur
        # gross lead time for terminal items = terminal ts - genesis ts
        gen = _first_ts(it, GENESIS_EVENTS)
        term = _last_ts(it, ("validated", "closed", "not_reproduced", "declined"))
        if gen and term and term >= gen:
            gross_totals.append((term - gen).total_seconds())
    total_time = sum(by_state.values())
    by_state_out = {
        s: {"total_s": round(t, 2), "pct_of_glt": (round(100 * t / total_time, 2) if total_time else None)}
        for s, t in sorted(by_state.items(), key=lambda kv: -kv[1])
    }
    by_owner_out = {
        o: {"total_s": round(t, 2), "pct_of_glt": (round(100 * t / total_time, 2) if total_time else None)}
        for o, t in sorted(by_owner.items(), key=lambda kv: -kv[1])
    }
    return {
        "gross_lead_time_total_s": round(total_time, 2),
        "gross_lead_time_median_s": _median(gross_totals),
        "gross_lead_time_p85_s": _percentile(gross_totals, 0.85),
        "n_completed_items": len(gross_totals),
        "by_state": by_state_out,
        "by_owner": by_owner_out,
    }


def _compute_quality(graphs, flow_items, now, window_days):
    """Section C — quality per stage/owner. building.build_failed rate,
    validating.rejection rate (each attributed to the state owner); overall
    rework rate; defect arrival rate over the window."""
    stage_exits = defaultdict(lambda: {"total": 0, "fail": 0})
    FAIL_EXIT = {"building": "build_failed", "deploying": "deploy_failed",
                 "prod-deploying": "deploy_failed", "validating": "rejected",
                 "dev-validating": "rejected", "prod-validating": "rejected",
                 "reproducing": "not_reproduced"}
    for it in flow_items:
        for st, evc in _exits_from(graphs, it).items():
            if st not in FAIL_EXIT:
                continue
            tot = sum(evc.values())
            fail = evc.get(FAIL_EXIT[st], 0)
            stage_exits[st]["total"] += tot
            stage_exits[st]["fail"] += fail
    by_stage = {}
    for st, d in stage_exits.items():
        by_stage[st] = {
            "owner": graphs.owner_of(st),
            "failure_rate": _ratio(d["fail"], d["total"]),
            "n_exits": d["total"],
            "n_failures": d["fail"],
        }
    reworked = sum(1 for it in flow_items
                   if any(ev.get("event") in REWORK_ENTRY_EVENTS for ev in it.events))
    rework_rate = _ratio(reworked, len(flow_items))
    # defect arrival: defects whose `reported` falls in the window
    defect_arrivals = 0
    for it in flow_items:
        if it.type != "defect":
            continue
        rep = _first_ts(it, ("reported",))
        if rep and _in_window(rep, now, window_days):
            defect_arrivals += 1
    return {
        "by_stage": by_stage,
        "rework_rate": rework_rate,
        "n_reworked": reworked,
        "n_flow_items": len(flow_items),
        "defect_arrivals_in_window": defect_arrivals,
    }


def _compute_recovery(graphs, flow_items):
    """Section D — MTTR split by failure class (median + mean each)."""
    build_fail, val_reject, defect = [], [], []
    for it in flow_items:
        build_fail += _duration_after(it, {"build_failed"},
                                      {"built_green", "retried", "done", "validated"})
        val_reject += _duration_after(it, {"rejected"},
                                      {"validated", "resolved", "done"})
        defect += _duration_after(it, {"reported"}, {"validated", "resolved"})

    def pack(xs):
        return {"median_s": _median(xs), "mean_s": _mean(xs), "n": len(xs)}
    return {"build_failure": pack(build_fail),
            "validation_rejection": pack(val_reject),
            "defect": pack(defect)}


def _stats_for_set(graphs, flow_items, states, now):
    """All four sections + windowed rate metrics for one set of flow items."""
    glt = _compute_glt(graphs, flow_items, now)
    return {
        "n_items": len(flow_items),
        "dora": {
            "all_time": _compute_dora(graphs, flow_items, states, now, None),
            "trailing_30d": _compute_dora(graphs, flow_items, states, now, 30),
        },
        "gross_lead_time": glt,
        "quality": {
            "all_time": _compute_quality(graphs, flow_items, now, None),
            "trailing_30d": _compute_quality(graphs, flow_items, now, 30),
        },
        "recovery_by_class": _compute_recovery(graphs, flow_items),
        "token_cost": _compute_token_cost(flow_items),
        # Section F — REAL per-stage agent work-effort vs the honest total lead time.
        "agent_cycle_time": _compute_agent_cycle_time(
            graphs, flow_items, glt["gross_lead_time_total_s"]),
    }


# ---------------------------------------------------------------------------
# Per-item metrics — the SAME flow/DORA quantities, but for ONE item. A pure
# re-composition of the existing helpers (walk_states / _first_ts / _last_ts /
# _duration_after / REWORK_ENTRY_EVENTS / _compute_token_cost) so the numbers are
# definitionally consistent with the aggregate view. The vision wants every
# metric trackable per single item; this is that projection, rendered into each
# item's derived `metrics:` block and printed by `project --item`.
# ---------------------------------------------------------------------------
_ITEM_TERMINAL_EVENTS = ("validated", "closed", "not_reproduced", "declined")


def per_item_metrics(graphs, item, now):
    """Return the single-item flow/DORA block for one FLOW item (dict), or None
    for an aggregate (no own event stream). Pure function of the item's events.

    - gross_lead_time_s: genesis (registered/reported/open) -> terminal event.
    - time_in_state: {state: seconds} via walk_states (open segment closed at now).
    - cycle_time_s: pulled -> done/terminal (the delivery clock, excludes intake).
    - rework_count: number of REWORK_ENTRY_EVENTS in the stream.
    - recoveries / mttr: recovery durations (any failure -> its next recovery) with
      count, median, mean — the per-item MTTR.
    - tokens: total + plumbing/delivery split + by_owner (via _compute_token_cost
      over the single-item set)."""
    if graphs.kind(item.type) != "flow":
        return None
    if now is None:
        now = datetime.now(timezone.utc)

    gen = _first_ts(item, GENESIS_EVENTS)
    term = _last_ts(item, _ITEM_TERMINAL_EVENTS)
    glt = (term - gen).total_seconds() if (gen and term and term >= gen) else None

    # time-in-each-state (rounded), owner attribution mirrors the aggregate GLT
    by_state = defaultdict(float)
    by_owner = defaultdict(float)
    for state, a, b in walk_states(graphs, item, now):
        dur = (b - a).total_seconds()
        if dur < 0:
            continue
        by_state[state] += dur
        by_owner[graphs.owner_of(state) or "unowned"] += dur
    time_in_state = {s: round(t, 2) for s, t in
                     sorted(by_state.items(), key=lambda kv: -kv[1])}
    time_by_owner = {o: round(t, 2) for o, t in
                     sorted(by_owner.items(), key=lambda kv: -kv[1])}

    # cycle time: pulled -> terminal (delivery clock). Use the FIRST pulled and the
    # terminal event; None if the item was never pulled or is not yet terminal.
    pulled = _first_ts(item, ("pulled",))
    cycle = (term - pulled).total_seconds() if (pulled and term and term >= pulled) else None

    rework_count = sum(1 for ev in item.events
                       if ev.get("event") in REWORK_ENTRY_EVENTS)

    # recoveries / MTTR: same trigger->recovery pairs the aggregate recovery uses.
    recoveries = []
    recoveries += _duration_after(item, {"build_failed"},
                                  {"built_green", "retried", "done", "validated"})
    recoveries += _duration_after(item, {"rejected"},
                                  {"validated", "resolved", "done"})
    recoveries += _duration_after(item, {"reported"}, {"validated", "resolved"})

    tokens = _compute_token_cost([item])
    return {
        "id": item.id,
        "type": item.type,
        "state": fold_state(graphs, item.type, item.events),
        "gross_lead_time_s": (round(glt, 2) if glt is not None else None),
        "cycle_time_s": (round(cycle, 2) if cycle is not None else None),
        "time_in_state": time_in_state,
        "time_by_owner": time_by_owner,
        "rework_count": rework_count,
        "recovery": {
            "n": len(recoveries),
            "mttr_median_s": _median(recoveries),
            "mttr_mean_s": _mean(recoveries),
        },
        "tokens": {
            "total": tokens["total_tokens"],
            "plumbing": tokens["plumbing_vs_delivery"]["plumbing_tokens"],
            "delivery": tokens["plumbing_vs_delivery"]["delivery_tokens"],
            "by_owner": tokens["by_owner"],
        },
    }


def _render_item_metrics_text(m):
    """Human-readable stdout rendering of one item's per-item metrics."""
    L = [f"# Per-item metrics: {m['id']} [{m['type']}] — state {m['state']}",
         f"  gross lead time (genesis->terminal): {_fmt(m['gross_lead_time_s'], ' s')}",
         f"  cycle time (pulled->done):           {_fmt(m['cycle_time_s'], ' s')}",
         f"  rework count:                        {m['rework_count']}"]
    rec = m["recovery"]
    L.append(f"  recoveries: n={rec['n']}, MTTR median={_fmt(rec['mttr_median_s'], ' s')}, "
             f"mean={_fmt(rec['mttr_mean_s'], ' s')}")
    L.append("  time-in-state:")
    for st, t in m["time_in_state"].items():
        L.append(f"    {st:16} {_fmt(t, ' s')}")
    if not m["time_in_state"]:
        L.append("    (no timed segments)")
    L.append("  time-by-owner:")
    for o, t in m["time_by_owner"].items():
        L.append(f"    {o:16} {_fmt(t, ' s')}")
    tok = m["tokens"]
    L.append(f"  tokens: total={tok['total']} "
             f"(plumbing={tok['plumbing']}, delivery={tok['delivery']})")
    if tok["by_owner"]:
        L.append("  tokens by owner: " +
                 ", ".join(f"{o}={t}" for o, t in tok["by_owner"].items()))
    return "\n".join(L)


def compute_stats(graphs, items, states, now=None):
    """Enhanced stats: DORA + gross-lead-time decomposition (by_state / by_owner)
    + quality-by-stage + recovery-by-class, sliced overall and by item type.
    `now` (datetime, UTC) is the reference for in-flight open segments + windows;
    defaults to datetime.now(utc)."""
    if now is None:
        now = datetime.now(timezone.utc)
    flow = [it for it in items.values() if graphs.kind(it.type) == "flow"]
    by_type = defaultdict(list)
    for it in flow:
        by_type[it.type].append(it)

    result = {
        "generated": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "reference_now": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "note": "SOLE record: computed from item event-logs (ledger cutover). "
                "state_owners attributes gross-lead-time to each part of the process.",
        "overall": _stats_for_set(graphs, flow, states, now),
        "by_type": {t: _stats_for_set(graphs, its, states, now)
                    for t, its in sorted(by_type.items())},
    }
    return result


def _fmt(x, unit=""):
    if x is None:
        return "—"
    if isinstance(x, float):
        s = f"{x:.2f}" if abs(x) < 100 else f"{x:.0f}"
    else:
        s = str(x)
    return f"{s}{unit}"


def _pct(x):
    return "—" if x is None else f"{100 * x:.1f}%"


def _write_stats(vd, stats):
    with open(os.path.join(vd, "stats.json"), "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2)
    with open(os.path.join(vd, "stats.md"), "w", encoding="utf-8") as f:
        f.write(_render_stats_md(stats))


def _render_stats_md(stats):
    L = [f"# Flow + DORA stats (derived) — generated {stats['generated']}\n",
         "_SOLE record: computed from each item's `events:` stream (ledger "
         "cutover). Reference now = " f"`{stats['reference_now']}`. "
         "Substrate reset accepted (CONTRACT §4). Do not hand-edit._\n"]

    def section(title, s):
        L.append(f"\n## {title} ({s['n_items']} flow items)\n")
        # A. DORA
        at, w = s["dora"]["all_time"], s["dora"]["trailing_30d"]
        L.append("### A. DORA four key metrics\n")
        L.append("| Metric | All-time | Trailing 30d |")
        L.append("|--------|----------|--------------|")
        L.append(f"| Deployment frequency (/active-day) | {_fmt(at['deployment_frequency_per_active_day'])} "
                 f"| {_fmt(w['deployment_frequency_per_active_day'])} |")
        L.append(f"| Lead time for changes — median (s) | {_fmt(at['lead_time_for_changes_median_s'])} "
                 f"| {_fmt(w['lead_time_for_changes_median_s'])} |")
        L.append(f"| Lead time for changes — p85 (s) | {_fmt(at['lead_time_for_changes_p85_s'])} "
                 f"| {_fmt(w['lead_time_for_changes_p85_s'])} |")
        L.append(f"| Change failure rate | {_pct(at['change_failure_rate'])} "
                 f"| {_pct(w['change_failure_rate'])} |")
        L.append(f"| MTTR — median (s) | {_fmt(at['mttr_median_s'])} | {_fmt(w['mttr_median_s'])} |")
        L.append(f"| MTTR — mean (s) | {_fmt(at['mttr_mean_s'])} | {_fmt(w['mttr_mean_s'])} |")

        # B. GLT decomposition
        g = s["gross_lead_time"]
        L.append("\n### B. Gross lead time — decomposition\n")
        L.append(f"- Total time-in-flight (all segments): **{_fmt(g['gross_lead_time_total_s'])} s**")
        L.append(f"- Per-item gross lead time: median **{_fmt(g['gross_lead_time_median_s'])} s**, "
                 f"p85 **{_fmt(g['gross_lead_time_p85_s'])} s** "
                 f"({g['n_completed_items']} completed items)\n")
        L.append("**Time thieves — by state (ranked)**\n")
        L.append("| State | total time (s) | % of GLT |")
        L.append("|-------|----------------|----------|")
        for st, d in g["by_state"].items():
            L.append(f"| {st} | {_fmt(d['total_s'])} | {_fmt(d['pct_of_glt'], '%')} |")
        if not g["by_state"]:
            L.append("| _(no timed segments)_ | — | — |")
        L.append("\n**Contribution to gross lead time — by owner**  "
                 "_(each part of the process reads its own share here; "
                 "`queue` = pure wait latency, `external` = blocked outside the system)_\n")
        L.append("| Owner | total time (s) | % of GLT |")
        L.append("|-------|----------------|----------|")
        for o, d in g["by_owner"].items():
            L.append(f"| {o} | {_fmt(d['total_s'])} | {_fmt(d['pct_of_glt'], '%')} |")
        if not g["by_owner"]:
            L.append("| _(no timed segments)_ | — | — |")

        # C. quality
        q = s["quality"]["all_time"]
        L.append("\n### C. Quality by stage / owner\n")
        L.append("| Stage | owner | failure rate | fails / exits |")
        L.append("|-------|-------|--------------|---------------|")
        for st, d in sorted(q["by_stage"].items()):
            L.append(f"| {st} | {d['owner']} | {_pct(d['failure_rate'])} "
                     f"| {d['n_failures']} / {d['n_exits']} |")
        if not q["by_stage"]:
            L.append("| _(no fail-path exits)_ | — | — | — |")
        L.append(f"\n- Overall rework rate: **{_pct(q['rework_rate'])}** "
                 f"({q['n_reworked']}/{q['n_flow_items']} items ever entered rework)")
        L.append(f"- Defect arrivals — all-time: **{q['defect_arrivals_in_window']}**, "
                 f"trailing 30d: **{s['quality']['trailing_30d']['defect_arrivals_in_window']}**")

        # D. recovery by class
        r = s["recovery_by_class"]
        L.append("\n### D. Recovery (MTTR) by failure class\n")
        L.append("| Class | median (s) | mean (s) | n |")
        L.append("|-------|------------|----------|---|")
        for cls, label in (("build_failure", "Build failure"),
                           ("validation_rejection", "Validation rejection"),
                           ("defect", "Defect (reported→resolved)")):
            d = r[cls]
            L.append(f"| {label} | {_fmt(d['median_s'])} | {_fmt(d['mean_s'])} | {d['n']} |")

        # E. token cost — plumbing vs delivery
        tc = s["token_cost"]
        pvd = tc["plumbing_vs_delivery"]
        cov = tc["token_coverage"]
        L.append("\n### E. Token cost — plumbing vs delivery\n")
        L.append("_Plumbing = running the agent OS (orchestrator + flow-manager + "
                 "coordination/bookkeeping transitions); delivery = producing / "
                 "validating customer value (classification ported from dora.py "
                 "cost-split, EXP-067). Token cost rides each state event's optional "
                 "`tokens`. Watch the plumbing SHARE and its trend._\n")
        if not tc["total_tokens"]:
            L.append("_No event tokens recorded (coverage "
                     f"{_pct(cov)}) — nothing to split yet._")
        else:
            L.append("| class | tokens | share |")
            L.append("|-------|--------|-------|")
            L.append(f"| plumbing | {pvd['plumbing_tokens']} | {_pct(pvd['plumbing_share'])} |")
            L.append(f"| delivery | {pvd['delivery_tokens']} "
                     f"| {_pct(_ratio(pvd['delivery_tokens'], tc['total_tokens']))} |")
            L.append(f"| **TOTAL** | **{tc['total_tokens']}** | 100.0% |")
            L.append(f"\n_Plumbing share: **{_pct(pvd['plumbing_share'])}** "
                     f"(token coverage {_pct(cov)} of "
                     f"{tc['n_events']} events — grows as dispatches carry `--tokens`)._")
            L.append("\n**By owner**\n")
            L.append("| owner | tokens |")
            L.append("|-------|--------|")
            for o, tk in tc["by_owner"].items():
                L.append(f"| {o} | {tk} |")

        # F. agent cycle time — REAL work-effort vs gross lead time
        act = s["agent_cycle_time"]
        cov = act["duration_coverage"]
        L.append("\n### F. Agent cycle time — work-effort vs gross lead time\n")
        L.append("_The REAL per-stage cycle time each dispatched agent spent "
                 "(`duration_ms`, reported by the dispatch layer, riding each state "
                 "event). GLT above stays the honest TOTAL elapsed (all waits, "
                 "human-steering gaps and outages included); this is its COMPLEMENT "
                 "— how much of that total was actual agent effort. The delta is the "
                 "overhead/wait the process must squeeze._\n")
        if not act["total_ms"]:
            L.append("_No agent duration recorded (coverage "
                     f"{_pct(cov)}) — pass `--duration-ms` on stage appends._")
        else:
            L.append(f"- Total agent work-effort: **{_fmt(act['total_ms'])} ms** "
                     f"(**{_fmt(act['total_s'])} s**)")
            L.append(f"- Cycle time vs gross lead time: "
                     f"**{_pct(act['cycle_time_vs_glt'])}** of GLT "
                     f"(**{_fmt(act['gross_lead_time_total_s'])} s** total elapsed) "
                     f"— the rest is wait/overhead")
            L.append(f"- Duration coverage: {_pct(cov)} of {act['n_events']} "
                     "legal-walk events carried a duration\n")
            L.append("**Agent work-effort — by owner (ranked)**\n")
            L.append("| Owner | total (ms) | median (ms) | n |")
            L.append("|-------|------------|-------------|---|")
            for o, d in act["by_owner"].items():
                L.append(f"| {o} | {_fmt(d['total_ms'])} | {_fmt(d['median_ms'])} "
                         f"| {d['n']} |")
            L.append("\n**Agent work-effort — by stage**\n")
            L.append("| Stage | owner | total (ms) | median (ms) | n |")
            L.append("|-------|-------|------------|-------------|---|")
            for st, d in act["by_stage"].items():
                L.append(f"| {st} | {d['owner']} | {_fmt(d['total_ms'])} "
                         f"| {_fmt(d['median_ms'])} | {d['n']} |")

    section("Overall", stats["overall"])
    for t, s in stats["by_type"].items():
        section(f"By type — {t}", s)
    return "\n".join(L) + "\n"


# ---------------------------------------------------------------------------
# Subcommands: retro-debt (the §F8 cadence GATE) + retro-mark (drain the debt)
#
# Reimplemented over ITEM EVENTS (ledger cutover: replaces `dora.py retro-debt`,
# which counted frozen-ledger rows). The "last retro" marker is a one-line ISO
# timestamp at process/dora/retro-marker/<project>.txt, written by retro-mark.
#
# Debt since the marker:
#   ROUTINE   = slice/chunk aggregates that BUBBLED to done after the marker
#               (bubble time = ts of the last child's terminal event), PLUS
#               use-case dev-validation rework (a build_failed / rejected event
#               after the marker): a dev reject that gets fixed + re-validated is
#               the process WORKING (XP/TDD/dev-first catching a defect BEFORE
#               prod), not an incident — so it BATCHES to the threshold (learning
#               still captured at the batched retro), it does not trip an
#               immediate retro.
#   INCIDENT  = defect items whose terminal validated/resolved event is after the
#               marker (a defect against SHIPPED work is a real escape worth an
#               immediate retro).
# DUE iff routine >= threshold OR incidents >= 1. Routine (slice-closes +
# uc-rework) batches to the threshold; a single incident (defect-resolve) fires
# immediately. (IMP-019, v101: uc-rework reclassified incident->routine.)
# ---------------------------------------------------------------------------
def _retro_marker_path(project):
    return os.path.join(ROOT, "process", "dora", "retro-marker", f"{project}.txt")


def _read_retro_marker(project):
    """Return the last-retro datetime (UTC), or epoch (all-time) if absent."""
    p = _retro_marker_path(project)
    if os.path.exists(p):
        try:
            with open(p, encoding="utf-8") as f:
                ts = parse_ts(f.readline().strip())
                if ts:
                    return ts
        except OSError:
            pass
    return datetime(1970, 1, 1, tzinfo=timezone.utc)


def _terminal_ts(item):
    """The ts an item reached a terminal state (its last validated/closed/
    not_reproduced/declined event), or None."""
    return _last_ts(item, ("validated", "closed", "not_reproduced", "declined"))


def _aggregate_bubble_ts(graphs, items, iid, children):
    """When aggregate `iid` bubbled to done = the ts of its LAST child's terminal
    event (the moment the final closing child made the parent done). None unless
    every child is terminal-done."""
    kids = children.get(iid, [])
    if not kids:
        # childless done aggregate (decommission slice): use its own `closed` marker
        own = _last_ts(items[iid], ("closed",))
        return own
    kid_terms = []
    for k in kids:
        child = items.get(k)
        if not child:
            return None
        if graphs.kind(child.type) == "aggregate":
            t = _aggregate_bubble_ts(graphs, items, k, children)
        else:
            t = _terminal_ts(child)
        if t is None:
            return None  # a child not yet done => aggregate not bubbled
        kid_terms.append(t)
    return max(kid_terms) if kid_terms else None


def compute_retro_debt(graphs, project, threshold, now):
    """Pure computation. Returns (routine, incidents, due, detail[])."""
    items, _dup = load_all_items(project)
    states = compute_states(graphs, items)
    children = compute_children(items)
    marker = _read_retro_marker(project)

    routine, incidents, detail = [], [], []
    for iid, it in items.items():
        kind = graphs.kind(it.type)
        if kind == "aggregate" and it.type in ("slice", "chunk"):
            if states.get(iid) == "done":
                bt = _aggregate_bubble_ts(graphs, items, iid, children)
                if bt and bt > marker and (now is None or bt <= now):
                    routine.append((iid, bt))
                    detail.append((bt, "slice-close", iid))
        elif it.type == "defect":
            if states.get(iid) in ("resolved", "done"):
                t = _terminal_ts(it)
                if t and t > marker and (now is None or t <= now):
                    incidents.append((iid, t))
                    detail.append((t, "defect-resolve", iid))
        elif it.type == "use-case":
            for ev in it.events:
                if ev.get("event") in ("build_failed", "rejected"):
                    t = parse_ts(ev.get("ts"))
                    if t and t > marker and (now is None or t <= now):
                        # IMP-019 (v101): a dev-validation reject / build-fail that
                        # gets fixed + re-validated is the process WORKING, not an
                        # incident — batch it as ROUTINE (accrues toward the
                        # threshold), do NOT trip an immediate retro. A defect
                        # against SHIPPED work stays an immediate incident (branch
                        # above).
                        routine.append((iid, t))
                        detail.append((t, "uc-rework", iid))
                        break
    due = (len(routine) >= threshold) or (len(incidents) >= 1)
    detail.sort(key=lambda d: d[0] or datetime(1970, 1, 1, tzinfo=timezone.utc))
    return routine, incidents, due, detail, marker


def cmd_retro_debt(a):
    graphs = Graphs.load()
    now = parse_ts(getattr(a, "now", None)) if getattr(a, "now", None) else None
    threshold = a.threshold
    routine, incidents, due, detail, marker = compute_retro_debt(
        graphs, a.project, threshold, now)
    n = len(routine) + len(incidents)
    reason = ("incident (immediate)" if incidents else
              f"routine {len(routine)}>={threshold}" if len(routine) >= threshold else
              f"routine {len(routine)}<{threshold}")
    since = marker.strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"retro-debt[{a.project}] = {n} (routine {len(routine)}/{threshold}, "
          f"incidents {len(incidents)}) since last retro {since} "
          f"=> {'RETRO DUE — drain before advancing ['+reason+']' if due else 'ok'}")
    for ts, kind, ident in detail:
        tss = ts.strftime("%Y-%m-%dT%H:%M:%SZ") if ts else "—"
        print(f"  - {tss}  {kind:18}  {ident}")
    write_statusline({f"retro_debt_{a.project}": n, f"retro_due_{a.project}": due})
    sys.exit(2 if due else 0)


def cmd_retro_mark(a):
    """Write the last-retro marker = now — the reset `/retro` calls at close to
    drain the debt."""
    ts = a.now or now_iso()
    p = _retro_marker_path(a.project)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(ts.strip() + "\n")
    print(f"retro-mark: {a.project} last-retro set to {ts.strip()}")


# ---------------------------------------------------------------------------
# Subcommand: loop-gate — the MECHANICAL pull-precondition gate (v126)
#
# WHY THIS EXISTS (retro evidence, OagEventSource 2026-08-01): STAGE F documents
# several loop preconditions as orchestrator JUDGEMENT, and they are reliably
# skipped. Measured: DEFECT-OAG-045 sat in `validating` 127,636s (35.5h) and
# DEFECT-OAG-048 98,224s — both already pushed AND deployed, both merely awaiting
# a tester dispatch nobody made; Ready sat at 1 against a `min_items` floor of 3;
# Intake sat at 14 against a `wip_limit` of 10 with the cap enforced NOWHERE.
# Meanwhile the ONE obligation that IS mechanised — `retro-debt` (exit 2 = RETRO
# DUE) — fired correctly and forced a retro that would otherwise have been
# skipped. The pattern is unambiguous: **the mechanised gate is obeyed; the
# documented one is not.** So this mechanises the rest, in the SAME shape as
# retro-debt (same launcher, --project, human-readable lines, exit 0/2).
#
# Reports EVERY violated precondition (never just the first), then exits:
#   exit 0 — all preconditions hold, the loop may pull.
#   exit 2 — one or more BLOCKING preconditions violated; each printed as one
#            actionable line naming the ids involved and the remedy.
#
# Checks:
#   1. stalled-validation  an item in validating/dev-validating/prod-validating
#      whose dwell > --stale-hours (default 4) AND whose latest ref-bearing
#      done-work event (fixed/built_green/deployed/promoted) carries a `ref:` —
#      i.e. the work is DONE and only a dispatch is missing. Highest-value check;
#      this is the 35.5h case.
#   2. ready-below-floor   depth(ready) < ready.min_items from queues/policy.csv.
#   3. queue-over-cap      a queue depth > its wip_limit. TWO SEVERITIES (v126 addendum):
#      BLOCKING for a WIP-STAGE queue, ADVISORY-only for a BACKLOG queue — see
#      the QUEUE KIND block below for why.
#   4. retro-debt          DELEGATED to compute_retro_debt (never re-implemented).
#
# NEVER derive "is it pushed / is it deployed" from event-note PROSE. That exact
# mistake produced a confident, precisely-quantified, WRONG conclusion: a note
# reading "NOT pushed — push is the prod apply" was ~35h stale while the commit
# had been on origin/main the whole time. Push state comes from the STRUCTURED
# `ref:` field verified against git (`merge-base --is-ancestor <ref> origin/…`)
# inside the project's OWN repo at work/<p>/ (v50: separate repo, gitignored by
# the parent — hence `git -C`). An unresolvable ref reports UNKNOWN; we never
# assume either way.
# ---------------------------------------------------------------------------
# The states where "work done, only a dispatch missing" can strand an item.
# (VALIDATING_STATES is the same set the CFR/quality metrics fold over.)
STALL_STATES = VALIDATING_STATES
# Events that carry a `ref:` to FINISHED work. `fixed` = defect graph;
# `built_green`/`deployed` = use-case dev lane; `promoted` = the cicd event that
# ENTERS prod-validating (without it, a prod-validating stall would be a blind
# spot in one of the three states this check names).
DONE_WORK_REF_EVENTS = ("fixed", "built_green", "deployed", "promoted")
DEFAULT_STALE_HOURS = 4.0
# §F2 seed defaults, used only when queues/policy.csv lacks the row. The retro
# TUNES these in policy.csv — they are never the authority, just the fallback.
POLICY_DEFAULTS = {
    "intake": {"min_items": 2, "wip_limit": 10},
    "ready": {"min_items": 3, "wip_limit": 4},
    "deploy": {"min_items": 0, "wip_limit": 1},
    "rework": {"min_items": 0, "wip_limit": 2},
}
# Candidate trunk refs, in order, for the push-state check.
TRUNK_CANDIDATES = ("origin/HEAD", "origin/main", "origin/master")

# --- QUEUE KIND (v126 addendum) — what decides whether over-cap BLOCKS or merely warns --
# Little's Law governs WORK IN PROGRESS, not backlog depth.
#   * a WIP-STAGE queue over its cap (ready / wip / rework / any future in-flight
#     stage) is real concurrent-work harm — aging, context-switching — and BLOCKS.
#   * a BACKLOG queue over its cap (`intake`: unstarted demand) is ADVISORY. Its
#     depth says "more is wanted than is being delivered"; the remedy is to
#     DELIVER FASTER — which is exactly the pull a block would prevent. Blocking
#     on it INVERTS the constraint and creates pressure to close real findings
#     just to shrink the number.
# Founding case (2026-08-01, first real run of this gate): a legitimate
# differential sweep produced ~15 verified-real sub-cost-4 findings; the
# flow-manager correctly refused to close any of them, and the loop halted for
# having done good discovery work.
#
# DECLARE the classification in queues/policy.csv. That file is LONG-format
# (queue,param,value,…), so `kind` is a new PARAM ROW — `intake,kind,backlog,…` —
# never a new column; no other reader's columns change and old files stay valid.
# The maps below are the FALLBACK for a policy.csv predating the row; an
# undeclared queue defaults to `wip`, i.e. fail-CLOSED (a future in-flight stage
# blocks until somebody classifies it). Keep this knowledge here, in one place.
QUEUE_KIND_BACKLOG = "backlog"
QUEUE_KIND_WIP = "wip"
DEFAULT_QUEUE_KINDS = {"intake": QUEUE_KIND_BACKLOG}
# policy params whose value is a WORD, not a count (read_queue_policy would
# otherwise drop them when int() fails).
POLICY_STR_PARAMS = ("kind",)


def queue_kind(policy, queue):
    """'backlog' | 'wip' for `queue`: the policy.csv `kind` row if declared, else
    DEFAULT_QUEUE_KINDS, else 'wip' (fail-closed). An unrecognised declared value
    falls back rather than inventing a third severity."""
    declared = str(policy.get(queue, {}).get("kind", "")).strip().lower()
    if declared in (QUEUE_KIND_BACKLOG, QUEUE_KIND_WIP):
        return declared
    return DEFAULT_QUEUE_KINDS.get(queue, QUEUE_KIND_WIP)


def read_queue_policy(project):
    """Parse work/<project>/queues/policy.csv into {queue: {param: int}}, layered
    over POLICY_DEFAULTS. The buffer knobs are OWNED BY THE RETRO and held in that
    config — never hardcoded here (§F2)."""
    pol = {q: dict(v) for q, v in POLICY_DEFAULTS.items()}
    path = os.path.join(ROOT, "work", project, "queues", "policy.csv")
    if not os.path.exists(path):
        return pol
    try:
        with open(path, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                q = (row.get("queue") or "").strip()
                p = (row.get("param") or "").strip()
                v = (row.get("value") or "").strip()
                if not q or not p:
                    continue
                if p in POLICY_STR_PARAMS:
                    pol.setdefault(q, {})[p] = v
                    continue
                try:
                    pol.setdefault(q, {})[p] = int(v)
                except ValueError:
                    continue
    except OSError:
        pass
    return pol


def _project_repo(project):
    return os.path.join(ROOT, "work", project)


def _git(repo, *args):
    """Run git in `repo`; return (rc, stdout). rc None when git/repo unusable."""
    try:
        r = subprocess.run(["git", "-C", repo, *args], capture_output=True,
                           text=True, check=False)
        return r.returncode, (r.stdout or "").strip()
    except Exception:
        return None, ""


def _ref_on_trunk(project, ref):
    """True/False iff `ref` IS/IS-NOT an ancestor of the project repo's origin
    trunk; None = UNKNOWN (no repo, git unavailable, ref or trunk unresolvable).

    The whole point: push state is a fact in GIT, never a claim in an event note."""
    if not ref:
        return None
    ref = str(ref)
    repo = _project_repo(project)
    if not os.path.exists(os.path.join(repo, ".git")):
        return None
    rc, _ = _git(repo, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}")
    if rc != 0:
        return None                     # ref not resolvable here -> UNKNOWN
    for trunk in TRUNK_CANDIDATES:
        rc, _ = _git(repo, "rev-parse", "--verify", "--quiet", f"{trunk}^{{commit}}")
        if rc != 0:
            continue
        rc, _ = _git(repo, "merge-base", "--is-ancestor", ref, trunk)
        if rc == 0:
            return True
        if rc == 1:
            return False
        return None                     # git error -> UNKNOWN, never a guess
    return None                         # no origin trunk -> UNKNOWN


def _last_ref_event(item, event_names):
    """The LAST event in `event_names` that carries a structured `ref:` (or None).
    Prose in `note:` is deliberately never consulted."""
    found = None
    for ev in item.events:
        if ev.get("event") in event_names and ev.get("ref"):
            found = ev
    return found


def _current_segment(graphs, item, now):
    """(state, entered_ts) for the item's still-open segment, or (None, None)."""
    segs = walk_states(graphs, item, now)
    if not segs:
        return None, None
    state, entered, _exited = segs[-1]
    return state, entered


def _hms(seconds):
    if seconds is None:
        return "—"
    h = seconds / 3600.0
    return f"{h:.1f}h" if h < 48 else f"{h / 24:.1f}d"


def compute_loop_gate(graphs, project, stale_hours=DEFAULT_STALE_HOURS,
                      threshold=3, now=None):
    """PURE-ish computation (the only impurity is the read-only git query, which
    is injected via the module-level `_ref_on_trunk` so tests can substitute it).

    Returns a list of finding dicts, each with:
      check    — 'stalled-validation' | 'ready-below-floor' | 'queue-over-cap'
                 | 'retro-debt'
      severity — 'block'    exit 2; the loop may not pull until it is cleared
                 'advisory' exit UNAFFECTED; real, reported, but not WIP harm
                            (a BACKLOG queue over cap — see the QUEUE KIND block)
                 'unknown'  exit UNAFFECTED; we could not establish it either way
      ids      — the work-item ids involved
      message  — one actionable line: what is wrong AND the remedy
    """
    items, _dup = load_all_items(project)
    states = compute_states(graphs, items)
    policy = read_queue_policy(project)
    if now is None:
        now = parse_ts(now_iso())
    findings = []

    # --- 1. stalled validation (the 35.5h case) ------------------------------
    stale_s = float(stale_hours) * 3600.0
    for iid in sorted(items):
        it = items[iid]
        if states.get(iid) not in STALL_STATES:
            continue
        state, entered = _current_segment(graphs, it, now)
        if state not in STALL_STATES or entered is None:
            continue
        dwell = (now - entered).total_seconds()
        if dwell <= stale_s:
            continue
        ev = _last_ref_event(it, DONE_WORK_REF_EVENTS)
        if ev is None:
            # dwell is long but NO structured ref => we cannot establish the work
            # is finished. Report UNKNOWN; never assume either way.
            findings.append({
                "check": "stalled-validation", "severity": "unknown",
                "ids": [iid], "state": state, "dwell_s": dwell, "ref": None,
                "on_trunk": None,
                "message": (f"[stalled-validation] UNKNOWN: {iid} has been in "
                            f"'{state}' for {_hms(dwell)} (>{stale_hours}h) but no "
                            f"{'/'.join(DONE_WORK_REF_EVENTS)} event carries a "
                            f"`ref:` — cannot establish whether the work is done. "
                            f"Remedy: append the missing ref (make wi-append … "
                            f"REF=<sha>) or dispatch the tester."),
            })
            continue
        # str(): an all-digit short sha (e.g. DEFECT-OAG-045's 5095849) is parsed
        # back from the item file as an int by the frontmatter scalar reader.
        ref = str(ev.get("ref"))
        on_trunk = _ref_on_trunk(project, ref)
        push = ("on origin trunk" if on_trunk is True else
                "NOT on origin trunk" if on_trunk is False else
                "push state UNKNOWN (ref unresolvable in work/%s)" % project)
        findings.append({
            "check": "stalled-validation", "severity": "block",
            "ids": [iid], "state": state, "dwell_s": dwell, "ref": ref,
            "on_trunk": on_trunk, "event": ev.get("event"),
            "message": (f"[stalled-validation] {iid} has been in '{state}' for "
                        f"{_hms(dwell)} (>{stale_hours}h); the work is DONE "
                        f"({ev.get('event')} ref {ref}, {push}) — only a dispatch "
                        f"is missing. Remedy: dispatch the tester now, then "
                        f"`make wi-append PROJECT={project} ID={iid} "
                        f"EVENT=validated|rejected AGENT=tester`."),
        })

    # --- derived queue depths (pure function of state via queue_map) ----------
    depths = defaultdict(int)
    members = defaultdict(list)
    for iid in sorted(items):
        q = graphs.queue_for(states.get(iid))
        if q:
            depths[q] += 1
            members[q].append(iid)

    # --- 2. ready below floor ------------------------------------------------
    floor = policy.get("ready", {}).get("min_items",
                                        POLICY_DEFAULTS["ready"]["min_items"])
    ready_depth = depths.get("ready", 0)
    if ready_depth < floor:
        findings.append({
            "check": "ready-below-floor", "severity": "block",
            "ids": members.get("ready", []), "queue": "ready",
            "depth": ready_depth, "floor": floor,
            "message": (f"[ready-below-floor] ready depth {ready_depth} < "
                        f"min_items {floor} "
                        f"({', '.join(members.get('ready', [])) or 'empty'}). "
                        f"Remedy: replenish NOW, in parallel (§F3) — product "
                        f"decomposes the next use-cases; below-floor is never "
                        f"'expected' or tolerated."),
        })

    # --- 3. queue over cap (two severities — see the QUEUE KIND block) --------
    for q in sorted(depths):
        cap = policy.get(q, {}).get("wip_limit")
        if cap is None:
            continue                     # no cap declared for this queue
        if depths[q] <= cap:
            continue
        over = depths[q] - cap
        kind = queue_kind(policy, q)
        common = {"check": "queue-over-cap", "ids": members[q], "queue": q,
                  "depth": depths[q], "cap": cap, "over": over, "kind": kind}
        if kind == QUEUE_KIND_BACKLOG:
            # ADVISORY: reported prominently, never affects the exit code.
            findings.append(dict(common, severity="advisory", message=(
                f"ADVISORY (does NOT block the pull) [queue-over-cap] {q} depth "
                f"{depths[q]} > wip_limit {cap} — over by {over}. {q} is a BACKLOG "
                f"queue, and it is STILL over cap: unaddressed, not satisfied. "
                f"Little's Law governs WIP, not backlog depth — the remedy is to "
                f"DELIVER FASTER (raise throughput; decline or defer what will "
                f"never be pulled), never to close real findings to shrink the "
                f"number, and never to stop pulling, which only makes it worse.")))
        else:
            findings.append(dict(common, severity="block", message=(
                f"[queue-over-cap] {q} depth {depths[q]} > wip_limit {cap} — over "
                f"by {over}. {q} is a WIP STAGE: concurrent work in flight past "
                f"the cap is real harm (aging, context-switching). Remedy: drain "
                f"{over} to done before admitting more; the cap targets gross lead "
                f"time (§F2), work cannot be allowed to age.")))

    # --- 4. retro debt (DELEGATED — do not duplicate that logic) -------------
    routine, incidents, due, _detail, marker = compute_retro_debt(
        graphs, project, threshold, now)
    if due:
        reason = ("incident (immediate)" if incidents
                  else f"routine {len(routine)}>={threshold}")
        ids = [i for i, _t in incidents] + [i for i, _t in routine]
        findings.append({
            "check": "retro-debt", "severity": "block", "ids": ids,
            "routine": len(routine), "incidents": len(incidents),
            "threshold": threshold,
            "message": (f"[retro-debt] RETRO DUE [{reason}] — routine "
                        f"{len(routine)}/{threshold}, incidents "
                        f"{len(incidents)} since "
                        f"{marker.strftime('%Y-%m-%dT%H:%M:%SZ')} "
                        f"({', '.join(ids) or '—'}). Remedy: fire /retro, then "
                        f"`make retro-mark PROJECT={project}` to drain it."),
        })

    return findings


def cmd_loop_gate(a):
    graphs = Graphs.load()
    now = parse_ts(getattr(a, "now", None)) if getattr(a, "now", None) else None
    stale_hours = getattr(a, "stale_hours", DEFAULT_STALE_HOURS)
    findings = compute_loop_gate(graphs, a.project, stale_hours=stale_hours,
                                threshold=a.threshold, now=now)
    blocking = [f for f in findings if f["severity"] == "block"]
    advisory = [f for f in findings if f["severity"] == "advisory"]
    unknown = [f for f in findings if f["severity"] == "unknown"]
    stamp = (now or parse_ts(now_iso())).strftime("%Y-%m-%dT%H:%M:%SZ")
    # ADVISORY findings NEVER affect the verdict or the exit code — but they are
    # always printed, and an advisory-only run says so explicitly so "may pull"
    # can never be read as "everything is satisfied".
    adv_tail = (f"; {len(advisory)} advisory (non-blocking, still outstanding)"
                if advisory else "")
    verdict = (f"BLOCKED ({len(blocking)} violated precondition"
               f"{'' if len(blocking) == 1 else 's'}) — do NOT pull until cleared"
               if blocking else
               ("OK — no BLOCKING precondition violated, the loop may pull"
                if advisory else
                "OK — all preconditions hold, the loop may pull"))
    print(f"loop-gate[{a.project}] @ {stamp} (stale-hours {stale_hours}) "
          f"=> {verdict}{adv_tail}")
    for f in blocking:
        print(f"  - {f['message']}")
    for f in advisory:
        print(f"  ! {f['message']}")
    for f in unknown:
        print(f"  ? {f['message']}")
    sys.exit(2 if blocking else 0)


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
        is_terminal = state in ("done", "resolved", "wontfix", "cancelled")
        if is_terminal and q is not None:
            violations.append(f"(I2) {iid}: terminal state '{state}' but queue '{q}' is non-null")

        # I4b: a done FLOW item must live in done/ (aggregates always stay in
        # active/ — their state is DERIVED from children, not their own stream,
        # so a bubbled-done chunk/slice is not physically archived).
        if graphs.kind(it.type) == "flow":
            if state in ("done", "resolved", "wontfix", "cancelled") and getattr(it, "subdir", None) == "active":
                violations.append(f"(I4) {iid}: terminal ('{state}') but in items/active/ (must be items/done/)")
            if state not in ("done", "resolved", "wontfix", "cancelled") and getattr(it, "subdir", None) == "done":
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
        # v4: validation is split dev-then-prod. The full CLOUD path folds a
        # migrated done UC legally under v4:
        #   registered -> ready -> building -> deploying -> dev-validating
        #   -> prod-deploying -> prod-validating -> done
        # i.e. built_green (deploy-to-dev) -> deployed -> dev_validated
        # (dev AC passed, promote) -> promoted (deploy-to-prod) -> validated
        # (prod green). cicd owns deploying + prod-deploying; tester owns both
        # validating states — so both deploy legs and both validations are
        # attributable in the gross-lead-time breakdown.
        "done": [("registered", "flow-manager"), ("made_ready", "flow-manager"),
                 ("pulled", "orchestrator"), ("built_green", "engineer"),
                 ("deployed", "cicd"), ("dev_validated", "tester"),
                 ("promoted", "cicd"), ("validated", "tester")],
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
            subdir = "done" if state in ("done", "resolved", "wontfix", "cancelled") else "active"

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
    ap.add_argument("--tokens", type=int,
                    help="subagent_tokens the dispatched specialist spent producing "
                         "this transition (optional; feeds the plumbing-vs-delivery "
                         "cost-split in `project` stats)")
    ap.add_argument("--duration-ms", dest="duration_ms", type=int,
                    help="the dispatched agent's REAL cycle time in ms for this "
                         "transition (optional; feeds the agent-cycle-time-vs-GLT "
                         "block in `project` stats — work-effort vs total lead time)")
    ap.set_defaults(func=cmd_append)

    pr = sub.add_parser("project")
    pr.add_argument("--project", required=True)
    pr.add_argument("--now", help="reference 'now' (ISO-8601 UTC) for in-flight "
                                  "time-in-state + rate windows; default: real now")
    pr.add_argument("--item", help="print ONE item's per-item DORA/flow metrics to "
                                   "stdout (no view re-render); default: recompute all")
    pr.set_defaults(func=cmd_project)

    va = sub.add_parser("validate")
    va.add_argument("--project", required=True)
    va.set_defaults(func=cmd_validate)

    mi = sub.add_parser("migrate")
    mi.add_argument("--project", required=True)
    mi.set_defaults(func=cmd_migrate)

    rd = sub.add_parser("retro-debt")
    rd.add_argument("--project", required=True)
    rd.add_argument("--threshold", type=int, default=3)
    rd.add_argument("--now", help="reference 'now' (ISO-8601 UTC) for deterministic tests")
    rd.set_defaults(func=cmd_retro_debt)

    rm = sub.add_parser("retro-mark")
    rm.add_argument("--project", required=True)
    rm.add_argument("--now", help="marker timestamp (ISO-8601 UTC); default: real now")
    rm.set_defaults(func=cmd_retro_mark)

    lg = sub.add_parser("loop-gate",
                        help="MECHANICAL pull-precondition gate: exit 2 if any "
                             "blocking precondition is violated (stalled "
                             "validation / ready below floor / queue over cap / "
                             "retro due)")
    lg.add_argument("--project", required=True)
    lg.add_argument("--stale-hours", dest="stale_hours", type=float,
                    default=DEFAULT_STALE_HOURS,
                    help="dwell in validating/dev-validating/prod-validating "
                         f"beyond which a done-but-undispatched item BLOCKS the "
                         f"loop (default {DEFAULT_STALE_HOURS})")
    lg.add_argument("--threshold", type=int, default=3,
                    help="retro-debt routine threshold (passed through to the "
                         "retro-debt computation this delegates to)")
    lg.add_argument("--now", help="reference 'now' (ISO-8601 UTC) for deterministic tests")
    lg.set_defaults(func=cmd_loop_gate)

    a = p.parse_args(argv)
    a.func(a)


if __name__ == "__main__":
    main()
