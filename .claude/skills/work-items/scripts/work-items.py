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


# ---------------------------------------------------------------------------
# The observation predicate [state-graph v9] — what an `awaiting_observation`
# item is waiting to observe, in a form a MACHINE can evaluate every cycle.
#
# v125 §17c Layer 2: "the load-bearing claim lives in PROSE, where it cannot be
# false." A park whose reason is only a `note:` is exactly that — it can never
# come back negative, so it never ends. So the state cannot be ENTERED without a
# predicate (`append` refuses it; `validate` I6 catches a hand-edit), and the
# predicate is a COMMITTED, RE-RUNNABLE command (§17c.4), not a sentence.
#
# Grammar, deliberately narrow: `make:<target> [VAR=VALUE ...]`, run as
#   make -C work/<project> <target> [VAR=VALUE ...]
# in the PROJECT's own Makefile (project-owned probes over real data; the root
# Makefile is agent-ops). The `make:` scheme is REQUIRED — an unknown or absent
# scheme is never guessed at, and no shell metacharacter is accepted, so the spec
# can never become a shell string. Invocation is argv-list, never shell=True.
#
# The verdict is a REQUIRED SENTINEL LINE ON STDOUT, and the probe must exit 0:
#   `OBSERVATION: observed`  -> the record exists; a tester dispatch is now
#                               ACTIONABLE (loop-gate BLOCKS for it).
#   `OBSERVATION: not-yet`   -> the probe ran and honestly found nothing yet
#                               (legitimate; advisory, re-checked every cycle).
#   anything else            -> BROKEN. No sentinel, both sentinels, a non-zero
#                               exit, a missing target, a crash, a timeout. Fail
#                               CLOSED: a probe that does not exist can never
#                               masquerade as "not observed yet" — that confusion
#                               is the `make wire-provenance` class itself.
#
# WHY A SENTINEL AND NOT AN EXIT CODE (caught live, 2026-08-01, first real run):
# the first cut of this used exit 0 / 3 / other. It passed its unit tests — which
# STUBBED subprocess.run and therefore only proved the mapping agreed with itself.
# Driven against a REAL `make`, every probe read BROKEN: **make does not propagate
# a recipe's exit status.** A recipe exiting 3 makes make print "Error 3" and then
# exit **2** itself, so a three-way exit-code contract is not expressible through
# `make` at all. Exactly the "a mock encodes your belief about platform semantics"
# failure, found only by running the real thing. `test_run_observation_against_a_
# real_make` now pins the verdict against a REAL make invocation so this cannot
# regress into a stub-only agreement again.
# ---------------------------------------------------------------------------
OBSERVE_SCHEME = "make:"
OBS_SENTINEL = "OBSERVATION:"
OBS_OBSERVED = "observed"
OBS_NOT_YET = "not-yet"
_OBS_SENTINEL_RE = re.compile(r"^\s*" + OBS_SENTINEL + r"\s*(\S+)\s*$",
                              re.IGNORECASE | re.MULTILINE)
DEFAULT_OBSERVE_TIMEOUT = 120.0
_OBS_TARGET_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_OBS_ARG_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=[A-Za-z0-9._:/@,+-]*$")


def parse_observe_spec(spec):
    """`make:<target> [VAR=VALUE ...]` -> ['<target>', 'VAR=VALUE', ...].
    Raises ValueError (with the reason) on anything else. Nothing is ever guessed:
    a spec that does not parse is BROKEN, never silently reinterpreted."""
    if not isinstance(spec, str) or not spec.strip():
        raise ValueError("observe spec is empty — an `awaiting_observation` item "
                         "must carry a machine-checkable predicate")
    s = spec.strip()
    if not s.startswith(OBSERVE_SCHEME):
        raise ValueError(f"observe spec {s!r} has no '{OBSERVE_SCHEME}' scheme "
                         f"(the only supported form is "
                         f"'{OBSERVE_SCHEME}<target> [VAR=VALUE ...]')")
    parts = s[len(OBSERVE_SCHEME):].split()
    if not parts:
        raise ValueError(f"observe spec {s!r} names no make target")
    target, args = parts[0], parts[1:]
    if not _OBS_TARGET_RE.match(target):
        raise ValueError(f"observe spec target {target!r} is not a plain make "
                         f"target name (no shell, no paths, no metacharacters)")
    for arg in args:
        if not _OBS_ARG_RE.match(arg):
            raise ValueError(f"observe spec argument {arg!r} is not a plain "
                             f"VAR=VALUE make override")
    return [target] + args


def observe_spec_in_effect(item):
    """The predicate CURRENTLY in effect for `item`: the `observe:` of the LAST
    event that carries one (so a wrong probe is corrected by appending `amended`
    with a new one, never by editing the historical event). None if there is none."""
    spec = None
    for ev in item.events:
        if ev.get("observe"):
            spec = str(ev.get("observe"))
    return spec


def _run_observation(project, spec, timeout=DEFAULT_OBSERVE_TIMEOUT):
    """Evaluate an observation predicate NOW. Returns (verdict, detail) where
    verdict is 'observed' | 'not-yet' | 'broken'. Module-level so the loop-gate
    tests can substitute it (same seam as `_ref_on_trunk`)."""
    try:
        argv = parse_observe_spec(spec)
    except ValueError as e:
        return "broken", f"malformed observe spec: {e}"
    repo = _project_repo(project)
    try:
        r = subprocess.run(["make", "-C", repo] + argv, capture_output=True,
                           text=True, check=False, timeout=timeout)
    except subprocess.TimeoutExpired:
        return "broken", (f"predicate did not complete within {timeout}s (timeout) "
                          f"— a predicate that cannot be evaluated is not a predicate")
    except Exception as e:                      # make missing, repo absent, ...
        return "broken", f"could not run the predicate: {e}"
    out = r.stdout or ""
    tail = (out + (r.stderr or "")).strip()[-400:]
    if r.returncode != 0:
        return "broken", (f"the probe exited {r.returncode} — an observation probe "
                          f"must exit 0 and report its verdict on stdout as "
                          f"`{OBS_SENTINEL} {OBS_OBSERVED}|{OBS_NOT_YET}`: {tail}")
    verdicts = {m.group(1).strip().lower() for m in _OBS_SENTINEL_RE.finditer(out)}
    verdicts &= {OBS_OBSERVED, OBS_NOT_YET}
    if verdicts == {OBS_OBSERVED}:
        return "observed", out.strip()[-400:]
    if verdicts == {OBS_NOT_YET}:
        return "not-yet", out.strip()[-400:]
    if len(verdicts) > 1:
        return "broken", (f"the probe reported BOTH verdicts — ambiguous, so it "
                          f"establishes nothing: {tail}")
    return "broken", (f"the probe printed no `{OBS_SENTINEL} {OBS_OBSERVED}` or "
                      f"`{OBS_SENTINEL} {OBS_NOT_YET}` line, so its verdict is "
                      f"unreadable: {tail}")


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
    # observe: the MACHINE-CHECKABLE liveness predicate of an `awaiting_observation`
    # park [v9] — `make:<target> [VAR=V]`. Required on `not_yet_observed`, optional
    # on the `amended` self-edge (where it REPLACES the predicate in effect).
    if ev.get("observe") not in (None, ""):
        parts.append(f"observe: {_q(ev.get('observe'))}")
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
            try:
                it = load_item(os.path.join(subdir, fn))
            except FileNotFoundError:
                # CONCURRENCY (2026-08-14): multiple agents share one working
                # tree, so an item can be RELOCATED active/ -> done/ between our
                # listdir() and this open(). The file has not been lost — it is
                # already, or about to be, in the other subdir we also scan, so
                # skipping it here is correct rather than merely tolerable.
                # Observed live: `wi-append` died with FileNotFoundError on
                # UC-ROC-079 mid-scan while a concurrent agent closed it; a
                # retry succeeded, which is exactly the signature of a vanished
                # name rather than a missing item. Crashing the whole projection
                # for a rename is the wrong failure mode for a shared tree.
                continue
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
# [state-graph v9] SHIPPED, GREEN, UNPROVEN. Deliberately absent from _DONE_STATES
# and _TERMINAL_RESOLVED: an item awaiting its observation is NOT done and must
# never let a parent aggregate fold to `done`. That fold is precisely what made
# CFR and rework read clean for the five v125 capabilities while nothing worked.
AWAITING_OBSERVATION = "awaiting_observation"
# Non-terminal states in which NOTHING is in flight — the aggregate is waiting on
# the outside world, not being worked. Both are owner-class `external`.
_PARKED_STATES = {"blocked", AWAITING_OBSERVATION}


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
    # PARKED is itself parked: no work can progress until the outside world moves.
    # This keeps a parked aggregate out of the "in_progress" view (queues, stats,
    # board) instead of masquerading as actively-worked. As soon as one non-terminal
    # child is unblocked/working, it falls through to in_progress.
    #
    # [v9] Two parked kinds, and `awaiting_observation` takes PRECEDENCE over
    # `blocked` when both are present: both are external waits, but the unproven-
    # capability fact is the one a reader most needs AND the one that can silently
    # read `done` later, so it is the one the aggregate must announce. Neither is in
    # _TERMINAL_RESOLVED, so either way the aggregate CANNOT read `done` — that is
    # the load-bearing half of the rule; the label is the informative half.
    non_terminal = [k for k in kids if states.get(k) not in _TERMINAL_RESOLVED]
    if non_terminal and all(states.get(k) in _PARKED_STATES for k in non_terminal):
        if any(states.get(k) == AWAITING_OBSERVATION for k in non_terminal):
            return AWAITING_OBSERVATION
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


def resolve_note(a):
    """The note's ONLY safe transport is a file; validate whatever route was used.

    OI-WI-APPEND-NOTE-PATH-MANGLES-CONTENT. Three real corruptions of durable prose,
    all in TRANSPORT rather than storage: a `$` expanded away by make (UC-XE1's regex
    end-anchor, recorded as a DIFFERENT claim about the world), a backtick EXECUTED by
    zsh (the macOS `open` binary really ran and the word vanished from a commit
    message), and a `"` that refused a commit outright. The storage layer round-trips
    `$`, commas, backticks and quotes correctly — it is the command line that eats them.

    So `--note-file` is the route to use, and the remaining silent-corruption mode at
    the storage layer is closed here by REJECTION rather than by quiet alteration: an
    event is rendered as a ONE-LINE inline map, so an embedded newline truncates the
    note (`'a\\nb'` was stored and re-read as `'a'`, losing the tail and the character
    before it). Fail closed — a corrupted audit record must not be representable.
    """
    note_file = getattr(a, "note_file", None)
    if note_file and a.note:
        sys.exit("append REJECTED: pass EITHER --note or --note-file, not both.\n"
                 "  They would disagree, and there is no correct way to choose.")
    note = a.note
    if note_file:
        try:
            with open(note_file, encoding="utf-8") as f:
                note = f.read()
        except OSError as e:
            sys.exit(f"append REJECTED: cannot read --note-file {note_file}: {e}")
        # One trailing newline is the FILE FORMAT, not the prose — every editor and
        # `printf '%s\n'` adds it, so rejecting it would reject the safe route itself.
        if note.endswith("\n"):
            note = note[:-1]
    if note and re.search(r"[\r\n]", note):
        print("append REJECTED: the note contains a newline.", file=sys.stderr)
        print("  An event is stored as a ONE-LINE inline map, so a newline would "
              "SILENTLY TRUNCATE the note at that point (and lose the character "
              "before it). It is rejected rather than altered because a corrupted "
              "audit record must not be representable.", file=sys.stderr)
        print("  Write the note as a single line — long is fine, the field has no "
              "length limit.", file=sys.stderr)
        sys.exit(1)
    return note


def cmd_append(a):
    a.note = resolve_note(a)
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

    # --- the observation predicate is REQUIRED, not optional [v9] -------------
    # An `awaiting_observation` park with no machine-checkable predicate is a PROSE
    # park: nothing can ever evaluate whether the observation has landed, so the
    # item sits there for ever and the state becomes a hiding place. Make it
    # unrepresentable at the write, which is the earliest possible catch (v124/
    # EXP-121: an enforcement control must be a REQUIRED dependency, never optional
    # with a permissive default).
    observe = getattr(a, "observe", None)
    if to == AWAITING_OBSERVATION:
        if observe:
            try:
                parse_observe_spec(observe)
            except ValueError as e:
                print(f"append REJECTED: {a.id}: {e}", file=sys.stderr)
                print(f"  the predicate must be '{OBSERVE_SCHEME}<target> "
                      f"[VAR=VALUE ...]' naming a COMMITTED, RE-RUNNABLE target in "
                      f"work/{a.project}/Makefile that exits 0 and prints "
                      f"`{OBS_SENTINEL} {OBS_OBSERVED}` once the observation has "
                      f"landed, or `{OBS_SENTINEL} {OBS_NOT_YET}` while it has not.",
                      file=sys.stderr)
                sys.exit(1)
        elif a.event == "not_yet_observed":
            print(f"append REJECTED: {a.id}: entering '{AWAITING_OBSERVATION}' "
                  f"requires --observe (a machine-checkable liveness predicate).",
                  file=sys.stderr)
            print(f"  This state means SHIPPED, GREEN and UNPROVEN — it is only "
                  f"honest if something can decide when the observation lands. A "
                  f"reason in --note cannot come back negative (§17c Layer 2), so "
                  f"it is not enough.", file=sys.stderr)
            print(f"  e.g. --observe '{OBSERVE_SCHEME}probe-<capability>-observed' "
                  f"— it must exit 0 and print `{OBS_SENTINEL} {OBS_OBSERVED}` or "
                  f"`{OBS_SENTINEL} {OBS_NOT_YET}`; anything else is a BROKEN "
                  f"predicate and blocks the loop.", file=sys.stderr)
            sys.exit(1)
    elif observe:
        print(f"append REJECTED: {a.id}: --observe is only meaningful on a "
              f"transition into '{AWAITING_OBSERVATION}' (got '{a.event}' -> "
              f"'{to}').", file=sys.stderr)
        sys.exit(1)

    ts = a.ts or now_iso()
    new_event = {"ts": ts, "event": a.event, "agent": a.agent}
    if a.ref:
        new_event["ref"] = a.ref
    if observe:
        new_event["observe"] = observe
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


def _is_interpolated(durations):
    """True when an item's state dwell is BACKFILL INTERPOLATION rather than
    measurement.

    A migrated/backfilled item has its event timestamps synthesised by spreading
    a known start..end span evenly across its transitions, so every state segment
    comes out with the SAME duration to the second. Real work never does that: a
    stream of >=3 consecutive segments agreeing to within a second is a signature
    of linear interpolation, not of a process.

    This matters because backfill is not distributed evenly across the state
    space — it lands only on the states the migrated items walked through — so
    pooling it with measured dwell silently biases the time-thief ranking toward
    whichever stages the migration happened to touch. §17f: a number whose
    subject is 'measurement OR interpolation, unknown which' is not a
    measurement. Segregate, never pool.
    """
    nz = [d for d in durations if d > 0]
    if len(nz) < 3:
        return False
    return (max(nz) - min(nz)) <= max(1.0, 0.0005 * max(nz))


def _compute_glt(graphs, flow_items, now):
    """Section B — gross-lead-time decomposition. by_state (time thieves) and
    by_owner (each part's contribution via state_owners). Only DONE items have a
    real gross lead time (genesis->terminal); in-flight items contribute their
    partial time-in-state so 'now' cost is visible too.

    Every figure is reported against the MEASURED denominator and carries its
    backfill share beside it, plus a count-independent MEDIAN per-item dwell so a
    rising share can be told apart from a rising item count (v128 routed this and
    it did not land; v132 implements it)."""
    by_state = defaultdict(float)
    by_owner = defaultdict(float)
    bf_state = defaultdict(float)          # interpolated, held apart
    bf_owner = defaultdict(float)
    dwell_state = defaultdict(list)        # per-ITEM dwell, measured items only
    dwell_owner = defaultdict(list)
    gross_totals = []                      # per-DONE-item gross lead time
    n_backfill = 0
    for it in flow_items:
        segs = [(s, (b - a).total_seconds())
                for s, a, b in walk_states(graphs, it, now)]
        segs = [(s, d) for s, d in segs if d >= 0]
        interpolated = _is_interpolated([d for _, d in segs])
        n_backfill += 1 if interpolated else 0
        per_item_state = defaultdict(float)
        per_item_owner = defaultdict(float)
        for state, dur in segs:
            owner = graphs.owner_of(state) or "unowned"
            if interpolated:
                bf_state[state] += dur
                bf_owner[owner] += dur
            else:
                by_state[state] += dur
                by_owner[owner] += dur
                per_item_state[state] += dur
                per_item_owner[owner] += dur
        for st, t in per_item_state.items():
            if t > 0:
                dwell_state[st].append(t)
        for o, t in per_item_owner.items():
            if t > 0:
                dwell_owner[o].append(t)
        # gross lead time for terminal items = terminal ts - genesis ts
        gen = _first_ts(it, GENESIS_EVENTS)
        term = _last_ts(it, ("validated", "closed", "not_reproduced", "declined"))
        if gen and term and term >= gen and not interpolated:
            gross_totals.append((term - gen).total_seconds())
    total_time = sum(by_state.values())          # MEASURED denominator
    backfill_total = sum(bf_state.values())

    def pack(measured, backfill, dwell):
        out = {}
        for k in sorted(set(measured) | set(backfill),
                        key=lambda k: -measured.get(k, 0.0)):
            m, b = measured.get(k, 0.0), backfill.get(k, 0.0)
            out[k] = {
                "total_s": round(m, 2),
                "pct_of_glt": (round(100 * m / total_time, 2) if total_time else None),
                "median_per_item_s": _median(dwell.get(k, [])),
                "n_items": len(dwell.get(k, [])),
                "backfill_s": round(b, 2),
                "backfill_pct_of_state": (round(100 * b / (m + b), 2) if (m + b) else None),
            }
        return out

    return {
        "gross_lead_time_total_s": round(total_time, 2),
        "gross_lead_time_median_s": _median(gross_totals),
        "gross_lead_time_p85_s": _percentile(gross_totals, 0.85),
        "n_completed_items": len(gross_totals),
        "backfill_total_s": round(backfill_total, 2),
        "backfill_share_of_reported_pct": (
            round(100 * backfill_total / (total_time + backfill_total), 2)
            if (total_time + backfill_total) else None),
        "n_backfill_items": n_backfill,
        "n_measured_items": len(flow_items) - n_backfill,
        "by_state": pack(by_state, bf_state, dwell_state),
        "by_owner": pack(by_owner, bf_owner, dwell_owner),
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
        if g["n_backfill_items"]:
            L.append(f"- **BACKFILL HELD APART: {_fmt(g['backfill_total_s'])} s across "
                     f"{g['n_backfill_items']} interpolated items "
                     f"({_fmt(g['backfill_share_of_reported_pct'], '%')} of the naive total) "
                     f"is EXCLUDED from every figure below.** Those items' event "
                     f"timestamps were synthesised by spreading a span evenly across "
                     f"their transitions, so each state got an identical duration — "
                     f"interpolation, not measurement. It is not spread evenly across "
                     f"states, so pooling it biases the ranking toward whichever "
                     f"stages the migration touched. Per-state backfill share is in "
                     f"the last column; **do not name a constraint from a state whose "
                     f"backfill share is high** (§17f).")
        L.append(f"- Denominator below = **measured dwell only** "
                 f"({g['n_measured_items']} organically-timed items)\n")
        L.append("**Time thieves — by state (ranked on MEASURED dwell)**\n")
        L.append("| State | measured (s) | % of GLT | median/item (s) | n | backfill (s) | backfill % of state |")
        L.append("|-------|--------------|----------|-----------------|---|--------------|---------------------|")
        for st, d in g["by_state"].items():
            L.append(f"| {st} | {_fmt(d['total_s'])} | {_fmt(d['pct_of_glt'], '%')} "
                     f"| {_fmt(d['median_per_item_s'])} | {d['n_items']} "
                     f"| {_fmt(d['backfill_s'])} | {_fmt(d['backfill_pct_of_state'], '%')} |")
        if not g["by_state"]:
            L.append("| _(no timed segments)_ | — | — | — | — | — | — |")
        L.append("\n**Contribution to gross lead time — by owner**  "
                 "_(each part of the process reads its own share here; "
                 "`queue` = pure wait latency, `external` = blocked outside the system. "
                 "`median/item` is COUNT-INDEPENDENT: read it, not the share, to tell "
                 "\"work waits longer\" from \"there is more work\" — the confound that "
                 "made EXP-123's share metric unscoreable.)_\n")
        L.append("| Owner | measured (s) | % of GLT | median/item (s) | n | backfill (s) | backfill % of owner |")
        L.append("|-------|--------------|----------|-----------------|---|--------------|---------------------|")
        for o, d in g["by_owner"].items():
            L.append(f"| {o} | {_fmt(d['total_s'])} | {_fmt(d['pct_of_glt'], '%')} "
                     f"| {_fmt(d['median_per_item_s'])} | {d['n_items']} "
                     f"| {_fmt(d['backfill_s'])} | {_fmt(d['backfill_pct_of_state'], '%')} |")
        if not g["by_owner"]:
            L.append("| _(no timed segments)_ | — | — | — | — | — | — |")

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
    drain the debt. ALSO records the constraint as of this retro, so a later
    `parts-check` can tell a stable constraint from a shifted one (v136)."""
    ts = a.now or now_iso()
    p = _retro_marker_path(a.project)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(ts.strip() + "\n")
    print(f"retro-mark: {a.project} last-retro set to {ts.strip()}")
    con = _read_constraint(a.project)
    if con is not None:
        _write_constraint_marker(a.project, con)
        print(f"retro-mark: {a.project} constraint recorded as "
              f"owner={con['owner']} state={con['state']}")
    else:
        # Do NOT fail the retro close on this; but say so loudly, because a
        # missing record means the next parts-check MUST escalate to a full retro.
        print(f"retro-mark: {a.project} WARNING — could not read the constraint "
              f"from views/stats.json; the next `parts-check` will escalate to a "
              f"full retro rather than assume stability.")


# ---------------------------------------------------------------------------
# Subcommand: parts-check — the CHEAP per-close constraint read (v136, EXP-132)
#
# WHY (owner ruling 2026-08-07): §F8 never batches an INCIDENT, so every defect
# resolve tripped a full retro. With a large defect backlog that spends the whole
# session on retros re-deriving an unchanged answer — measured: the v135 retro
# closed at 13:17:51Z and DEFECT-OAG-060's resolve re-armed the gate at 13:23:43Z,
# six minutes later, on the same constraint. Meanwhile /loop-run step 5a already
# says a STABLE constraint should not pay full-retro overhead. The two rules
# genuinely conflicted.
#
# THIS IS NOT A SOFTENING, AND THE DISTINCTION IS THE WHOLE POINT (§17e, EXP-125).
# The cheap path is available ONLY while the constraint is provably unchanged, and
# THE MACHINERY DECIDES THAT, NOT THE ORCHESTRATOR. If the constraint has SHIFTED —
# or if it cannot be read at all — parts-check REFUSES and the full retro stands.
# So the expensive path is still mandatory in exactly the case a retro exists for:
# something about where time goes has changed.
# ---------------------------------------------------------------------------
def _constraint_marker_path(project):
    return os.path.join(ROOT, "process", "dora", "retro-marker",
                        f"{project}.constraint.txt")


def _read_constraint(project):
    """The current constraint from the DERIVED views: the top GLT-share owner and
    the top GLT-share state. Returns None if it cannot be read — which callers
    must treat as "escalate", never as "unchanged"."""
    p = os.path.join(ROOT, "work", project, "views", "stats.json")
    try:
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        glt = d["overall"]["gross_lead_time"]
    except (OSError, KeyError, ValueError):
        return None

    def top(section):
        rows = glt.get(section) or {}
        best, best_pct = None, None
        for name, row in rows.items():
            try:
                pct = float(row.get("pct_of_glt"))
            except (TypeError, ValueError):
                continue
            # Never name a constraint from a state that is mostly interpolation
            # (§17f.6 / EXP-128) — the whole reason v132 aimed three retros wrong.
            try:
                if float(row.get("backfill_pct_of_state") or 0.0) > 50.0:
                    continue
            except (TypeError, ValueError):
                pass
            if best_pct is None or pct > best_pct:
                best, best_pct = name, pct
        return best, best_pct

    owner, owner_pct = top("by_owner")
    state, state_pct = top("by_state")
    if owner is None or state is None:
        return None
    return {"owner": owner, "owner_pct": owner_pct,
            "state": state, "state_pct": state_pct}


def _write_constraint_marker(project, con):
    p = _constraint_marker_path(project)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(f"{con['owner']}\t{con['state']}\n")


def _read_constraint_marker(project):
    p = _constraint_marker_path(project)
    if not os.path.exists(p):
        return None
    try:
        with open(p, encoding="utf-8") as f:
            parts = f.readline().rstrip("\n").split("\t")
        return (parts[0], parts[1]) if len(parts) >= 2 else None
    except OSError:
        return None


def cmd_parts_check(a):
    """Drain INCIDENT retro debt with a cheap constraint read — but ONLY while the
    constraint is provably unchanged. Exit 0 = drained. Exit 2 = a full retro is
    genuinely due (constraint shifted, unreadable, or routine debt at threshold)."""
    graphs = Graphs.load()
    now = parse_ts(getattr(a, "now", None)) if getattr(a, "now", None) else None
    routine, incidents, _due, _detail, marker = compute_retro_debt(
        graphs, a.project, a.threshold, now)

    cur = _read_constraint(a.project)
    prev = _read_constraint_marker(a.project)
    stamp = (now.strftime("%Y-%m-%dT%H:%M:%SZ") if now else now_iso())

    if cur is None:
        print(f"parts-check[{a.project}] @ {stamp} => ESCALATE — the constraint "
              f"could not be read from views/stats.json. An unreadable instrument "
              f"is NOT evidence of stability. Run `make wi-project PROJECT="
              f"{a.project}` then a FULL /retro.")
        sys.exit(2)

    line = (f"constraint = {cur['owner']} ({cur['owner_pct']}% of GLT) / state "
            f"{cur['state']} ({cur['state_pct']}%)")

    if prev is None:
        print(f"parts-check[{a.project}] @ {stamp} => ESCALATE — {line}; no prior "
              f"constraint on record, so stability cannot be established. A FULL "
              f"/retro is due; it will record the constraint for next time.")
        sys.exit(2)

    if (cur["owner"], cur["state"]) != prev:
        print(f"parts-check[{a.project}] @ {stamp} => ESCALATE — CONSTRAINT "
              f"SHIFTED: {prev[0]}/{prev[1]} -> {cur['owner']}/{cur['state']}. "
              f"{line}. This is real learning and a FULL /retro must walk it "
              f"(exploit / subordinate / elevate). The cheap path is NOT available.")
        sys.exit(2)

    # Routine debt still batches to its own threshold — parts-check drains the
    # INCIDENT arm only. A slice/chunk close backlog is a different signal.
    if len(routine) >= a.threshold:
        print(f"parts-check[{a.project}] @ {stamp} => ESCALATE — {line} "
              f"(unshifted), but ROUTINE debt is {len(routine)}/{a.threshold}. "
              f"parts-check drains the INCIDENT arm only; a batched full /retro "
              f"is due on the routine arm.")
        sys.exit(2)

    # Stable + only incident debt => the cheap path is legitimate. Drain it.
    ts = stamp
    with open(_retro_marker_path(a.project), "w", encoding="utf-8") as f:
        f.write(ts + "\n")
    print(f"parts-check[{a.project}] @ {stamp} => OK (constraint STABLE) — {line}; "
          f"shifted since last close? n. Drained {len(incidents)} incident(s): "
          f"{', '.join(i for i, _t in incidents) or 'none'}. "
          f"Full-retro overhead NOT paid, per the owner ruling of 2026-08-07; the "
          f"full retro remains mandatory the moment the constraint moves.")
    write_statusline({f"retro_debt_{a.project}": 0, f"retro_due_{a.project}": False})
    sys.exit(0)


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
#   5. awaiting-observation [v9] every item in `awaiting_observation` is reported
#      AND its liveness predicate RE-EVALUATED, exactly as `blocked` is re-checked
#      each cycle. observed -> BLOCK (a tester dispatch is now actionable);
#      not-yet -> ADVISORY (legitimate, outstanding, never "satisfied"); broken or
#      absent predicate -> BLOCK (an unverifiable park is the prose-remedy class).
#
# WHY check 1 AND check 5 (the honest fix, 2026-08-01): UC-ML1 was dwelling in
# `dev-validating` with a green `ref:`, so check 1 read it as "work done, only a
# dispatch missing" — FALSE: the dispatch happened and the tester correctly
# declined, because the capability ships INERT and cannot be observed until armed.
# The fix is NOT to exclude a state and move on. `awaiting_observation` leaves
# STALL_STATES, so check 1 stops firing, but the item is then carried by check 5,
# which re-runs its predicate every cycle and BLOCKS the moment the observation
# lands. So a legitimate park is distinguishable from an undispatched item by a
# recorded, machine-evaluated reason — and parking cannot be used to hide, because
# entering the state without a predicate is refused at the write.
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
# `awaiting_observation` is deliberately NOT here: an item there HAS been dispatched
# and the tester recorded a machine-checkable reason it could not conclude. It is
# carried by check 5 instead — see the WHY block above.
STALL_STATES = VALIDATING_STATES
# Events that carry a `ref:` to FINISHED work. `fixed` = defect graph;
# `built_green`/`deployed` = use-case dev lane; `promoted` = the cicd event that
# ENTERS prod-validating (without it, a prod-validating stall would be a blind
# spot in one of the three states this check names).
DONE_WORK_REF_EVENTS = ("fixed", "built_green", "deployed", "promoted")
DEFAULT_STALE_HOURS = 4.0
# Days a BACKLOG item may sit with no recorded decision before it blocks the loop
# (v135, EXP-131). Not a depth cap — see check 4. 7d is a deliberate guess and is
# the first knob to tune from the measured age distribution (median 2.2d / oldest
# 8.0d at open on OagEventSource), exactly as --stale-hours was.
DEFAULT_MAX_BACKLOG_AGE_DAYS = 7.0
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


def _defer_until(item):
    """The item's recorded defer decision as an aware datetime, or None.

    `defer_until:` is a plain frontmatter scalar (`YYYY-MM-DD`, or any parseable
    timestamp). It round-trips through render_item's extra-scalar-fields path, so
    it needs no state-graph edge and no new event type — a defer is a DECISION
    about scheduling, not a state transition, and modelling it as an event would
    wrongly imply the item had moved.

    An UNPARSEABLE value returns None, i.e. it does NOT count as a decision and
    the item keeps blocking. Fail closed: a typo'd date must never read as a
    valid defer, or the gate could be silenced by a malformed line.
    """
    raw = item.fm.get("defer_until")
    if raw in (None, ""):
        return None
    dt = parse_ts(str(raw).strip())
    if dt is None:
        return None
    # A bare `YYYY-MM-DD` parses NAIVE; `now` is aware, and comparing the two
    # raises. Normalise to UTC so the common, most readable form of a defer
    # (a plain date) is the one that works.
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def compute_loop_gate(graphs, project, stale_hours=DEFAULT_STALE_HOURS,
                      threshold=3, now=None, observe=True,
                      observe_timeout=DEFAULT_OBSERVE_TIMEOUT,
                      max_backlog_age_days=DEFAULT_MAX_BACKLOG_AGE_DAYS):
    """PURE-ish computation (the impurities are the read-only git query and the
    observation predicate, both injected via the module-level `_ref_on_trunk` /
    `_run_observation` so tests can substitute them).

    Returns a list of finding dicts, each with:
      check    — 'stalled-validation' | 'ready-below-floor' | 'queue-over-cap'
                 | 'retro-debt' | 'awaiting-observation'
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
            # DEPTH ALONE CANNOT BE ACTED ON (v132). A backlog of 60 items that
            # each clear in an hour is healthy; a backlog of 12 that have each sat
            # three days is the constraint. Report the count-independent AGE
            # beside the count, and name the oldest — the retro needs to know
            # WHICH items are aging, not merely how many exist.
            ages = []
            for mid in members[q]:
                _st, ent = _current_segment(graphs, items[mid], now)
                if ent is not None:
                    ages.append(((now - ent).total_seconds(), mid))
            ages.sort(reverse=True)
            age_txt = ""
            if ages:
                med = _median([a for a, _ in ages])
                oldest_s, oldest_id = ages[0]
                age_txt = (
                    f" AGE (count-independent — read this, not the depth): median "
                    f"{med / 86400.0:.1f}d in-queue across {len(ages)} items, "
                    f"oldest {oldest_id} at {oldest_s / 86400.0:.1f}d."
                    f" Aging inventory is the single largest measured contributor "
                    f"to gross lead time; every item here is either scheduled for a"
                    f" pull or owes an explicit decline/defer-with-date.")
            findings.append(dict(common, severity="advisory",
                                 median_age_s=(_median([a for a, _ in ages]) if ages else None),
                                 oldest_id=(ages[0][1] if ages else None),
                                 oldest_age_s=(ages[0][0] if ages else None),
                                 message=(
                f"ADVISORY (does NOT block the pull) [queue-over-cap] {q} depth "
                f"{depths[q]} > wip_limit {cap} — over by {over}. {q} is a BACKLOG "
                f"queue, and it is STILL over cap: unaddressed, not satisfied. "
                f"Little's Law governs WIP, not backlog depth — the remedy is to "
                f"DELIVER FASTER (raise throughput; decline or defer what will "
                f"never be pulled), never to close real findings to shrink the "
                f"number, and never to stop pulling, which only makes it worse."
                + age_txt)))
        else:
            findings.append(dict(common, severity="block", message=(
                f"[queue-over-cap] {q} depth {depths[q]} > wip_limit {cap} — over "
                f"by {over}. {q} is a WIP STAGE: concurrent work in flight past "
                f"the cap is real harm (aging, context-switching). Remedy: drain "
                f"{over} to done before admitting more; the cap targets gross lead "
                f"time (§F2), work cannot be allowed to age.")))

    # --- 4. aged backlog item carrying NO DECISION (v135, EXP-131) -----------
    # Depth is advisory (check 3) and must stay that way — Little's Law governs
    # WIP, not backlog. But AGE WITHOUT A DECISION is a different quantity and it
    # IS actionable: `open` has been the top GLT contributor for two consecutive
    # retros (42.09% -> 42.18%, median 3.8d/item, ZERO backfill), because findings
    # are generated by every gate/census/probe and retired by nothing.
    #
    # THE CHEAPEST PATH TO GREEN IS A DATED DEFER, NOT A CLOSE. That asymmetry is
    # deliberate and load-bearing: a gate whose cheapest remedy is "close it" would
    # manufacture pressure to close real findings, which §F8a explicitly bans. Here
    # `defer_until:` costs one line and is always available, so declining a genuine
    # finding is never the path of least resistance.
    #
    # A defer EXPIRES. When the date passes the item blocks again — that is what
    # makes it a decision with a shelf life rather than a way to bury the item
    # (the EXP-130 stale-blocker lesson applied to inventory).
    for q in sorted(depths):
        if queue_kind(policy, q) != QUEUE_KIND_BACKLOG:
            continue
        undecided = []
        for mid in members[q]:
            _st, ent = _current_segment(graphs, items[mid], now)
            if ent is None:
                continue
            age_d = (now - ent).total_seconds() / 86400.0
            if age_d <= max_backlog_age_days:
                continue
            deferred_to = _defer_until(items[mid])
            if deferred_to is not None and deferred_to > now:
                continue            # an in-date decision exists — respect it
            undecided.append((age_d, mid, deferred_to))
        if not undecided:
            continue
        undecided.sort(reverse=True)
        shown = ", ".join(f"{mid} ({age:.1f}d"
                          + (" — DEFER EXPIRED" if dt is not None else "")
                          + ")" for age, mid, dt in undecided[:8])
        more = (f" and {len(undecided) - 8} more" if len(undecided) > 8 else "")
        findings.append({
            "check": "aged-backlog-undecided", "severity": "block",
            "queue": q, "ids": [mid for _a, mid, _d in undecided],
            "max_age_days": max_backlog_age_days,
            "message": (
                f"[aged-backlog-undecided] {len(undecided)} item(s) in {q} have sat "
                f"longer than {max_backlog_age_days:.0f}d with NO recorded decision: "
                f"{shown}{more}. This does NOT block on depth (that stays advisory — "
                f"Little's Law governs WIP, not backlog); it blocks on AGE WITHOUT A "
                f"DECISION, which is the count-independent quantity the retro can act "
                f"on. Remedy, per item — EITHER schedule it (make it ready and pull "
                f"it) OR record an explicit dated defer by adding `defer_until: "
                f"YYYY-MM-DD` to its frontmatter. **Do NOT close a real finding to "
                f"clear this gate** (§F8a); a dated defer is one line and is always "
                f"the cheaper move. A defer that has EXPIRED re-blocks by design — "
                f"re-decide it, do not extend it reflexively."),
        })

    # --- 5. awaiting observation: RE-CHECK the predicate, every cycle [v9] ----
    for iid in sorted(items):
        if states.get(iid) != AWAITING_OBSERVATION:
            continue
        it = items[iid]
        # FLOW items only. An aggregate BUBBLES into this state from a child and has
        # no own event stream, so it carries no predicate — reporting it would be a
        # phantom "no predicate" block for every ancestor of one parked use-case.
        if graphs.kind(it.type) != "flow":
            continue
        _st, entered = _current_segment(graphs, it, now)
        dwell = (now - entered).total_seconds() if entered else None
        spec = observe_spec_in_effect(it)
        common = {"check": "awaiting-observation", "ids": [iid],
                  "state": AWAITING_OBSERVATION, "dwell_s": dwell, "spec": spec}
        if not spec:
            # Only reachable by a hand-edit (append refuses it; validate I6 flags
            # it). An unverifiable park is a PROSE park — fail CLOSED and loud.
            findings.append(dict(common, severity="block", verdict="no-predicate",
                                 message=(
                f"[awaiting-observation] {iid} has been parked in "
                f"'{AWAITING_OBSERVATION}' for {_hms(dwell)} but carries NO "
                f"observation predicate — nothing can decide when it is done, so it "
                f"would sit here for ever. Remedy: `make wi-append PROJECT={project} "
                f"ID={iid} EVENT=amended AGENT=solution-architect "
                f"OBSERVE={OBSERVE_SCHEME}<target>` naming a committed re-runnable "
                f"probe (exit 0, printing `{OBS_SENTINEL} {OBS_OBSERVED}` or "
                f"`{OBS_SENTINEL} {OBS_NOT_YET}`).")))
            continue
        if not observe:
            findings.append(dict(common, severity="unknown", verdict="not-evaluated",
                                 message=(
                f"[awaiting-observation] {iid}: predicate '{spec}' was NOT evaluated "
                f"(--no-observe). Parked {_hms(dwell)}; SHIPPED AND GREEN BUT "
                f"UNPROVEN and NOT done. This run establishes nothing about it — "
                f"re-run without --no-observe before concluding anything.")))
            continue
        verdict, detail = _run_observation(project, spec, observe_timeout)
        if verdict == "observed":
            findings.append(dict(common, severity="block", verdict=verdict,
                                 detail=detail, message=(
                f"[awaiting-observation] {iid}: the observation HAS LANDED "
                f"(predicate '{spec}' reported {OBS_SENTINEL} {OBS_OBSERVED}"
                f"{'; ' + detail if detail else ''}) — the "
                f"capability has now been seen working on data we did not author, "
                f"after {_hms(dwell)} parked. A tester dispatch is ACTIONABLE. "
                f"Remedy: dispatch the tester to validate against that real record, "
                f"then `make wi-append PROJECT={project} ID={iid} "
                f"EVENT=validated|rejected AGENT=tester` with the observation "
                f"pointer in NOTE.")))
        elif verdict == "not-yet":
            findings.append(dict(common, severity="advisory", verdict=verdict,
                                 detail=detail, message=(
                f"ADVISORY (does NOT block the pull) [awaiting-observation] {iid} "
                f"parked {_hms(dwell)}: '{spec}' reports NOT YET OBSERVED. SHIPPED "
                f"AND GREEN BUT UNPROVEN — it is NOT done, it must never fold into a "
                f"`done` aggregate, and this is re-checked every cycle. Legitimate "
                f"while the trigger genuinely has not occurred; if the wait is "
                f"unbounded, arm it, force the trigger, or judge it statistically "
                f"(§12d.3) — never conclude it works.")))
        else:
            findings.append(dict(common, severity="block", verdict="broken",
                                 detail=detail, message=(
                f"[awaiting-observation] {iid}: its observation predicate CANNOT BE "
                f"EVALUATED ('{spec}': {detail}). An unrunnable liveness predicate "
                f"is not a predicate (§17c.2) — the item would sit parked for ever "
                f"with no mechanism, which is the `make wire-provenance` class this "
                f"state exists to prevent. Remedy: fix the probe (it must exit 0 "
                f"printing `{OBS_SENTINEL} {OBS_OBSERVED}`/`{OBS_SENTINEL} "
                f"{OBS_NOT_YET}`) or record a corrected one "
                f"with `make wi-append … EVENT=amended … OBSERVE=…`.")))

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

    # --- 6. the test-requirement gate (§17d) — DELEGATED to the real analyser --
    findings.extend(compute_test_requirement_gate(project))

    # --- 7. unrecoverable work in a worktree (DEFECT-OAG-076) — DELEGATED ------
    findings.extend(compute_worktree_guard())

    # --- 8. orphaned local containers (DEFECT-OAG-091) — DELEGATED, AND IT REAPS
    findings.extend(compute_container_reap(project))

    # --- 9. a file a committed make target RUNS must be on trunk — DELEGATED ---
    #        (OI-GITIGNORE-SWALLOWS-COMMITTED-TOOLS). This is the ONLY workflow that
    #        can run it: the analyser lives in the agent-system repo, so a project's
    #        own CI cannot see it.
    findings.extend(compute_make_refs_tracked(project))

    # --- 10. an item's acceptance must be READABLE, or loudly not — DELEGATED --
    #         (OI-ACCEPTANCE-PARSER-SCORES-ZERO-SILENTLY). The loop is the reason
    #         this hangs here: the parser's only other caller is a board sync run
    #         one item at a time, whose stderr nobody reads, so a tree-wide wrong
    #         answer had no observer at all (`f694ea3` matched NOTHING tree-wide
    #         and the only symptom was a label sitting on ~100% of items).
    findings.extend(compute_acceptance_audit(project))

    return findings


# ---------------------------------------------------------------------------
# loop-gate check 10 — an item's acceptance must be READABLE, or loudly not
# (OI-ACCEPTANCE-PARSER-SCORES-ZERO-SILENTLY, AC-AP.1/AC-AP.3)
#
# `parse_acceptance()` returned a COUNT, and `0` conflated two irreconcilable facts:
# the item genuinely has no written acceptance (a real process state — §12a keeps such
# an item out of a build) and the parser could not READ its acceptance. The dangerous
# direction is false-green: the board stamped `needs-acceptance` — a WORK INSTRUCTION
# to go and author acceptance — on OAG-216 (`UC-GSA2`) and OAG-208
# (`DEFECT-OAG-047`), both of which carry conditions their own testers cited BY ID.
# Following that instruction means re-authoring over acceptance that already exists,
# which §12a forbids an engineer to do at all.
#
# WHY IT HANGS HERE. `f694ea3` fixed three formats plus a terminator bug and a FOURTH
# format broke it the next day; all four accidental discoveries on the open item were
# found by someone who went looking. The parser's only other caller is `board-project`,
# one item at a time, whose stderr nobody reads — so a tree-wide wrong answer had no
# observer. The loop is the only continuously-running workflow, and the analyser lives
# in the agent-system repo where a project's own CI cannot see it (same reason as
# check 9). The whole point of the fix is that the answer is now checked BEFORE an
# agent reads "0 acceptance conditions" and defers a buildable item.
#
# SEVERITY, per §F8a ("a gate blocks only on harm that stopping relieves"):
#   findings   -> BLOCK. The next pull is exactly the moment the wrong answer is
#         acted on — an engineer citing ids the gate cannot resolve, or an agent
#         concluding an item is not buildable. One `make acceptance-audit` clears it.
#   unrunnable -> UNKNOWN ("? " line). An unevaluated precondition is not a met one
#         (§17c.2), and "clean" being indistinguishable from "did not run" is the
#         exact shape of the defect this check exists for.
# ---------------------------------------------------------------------------
ACCEPTANCE_AUDIT_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                       "..", "..", "..", "tools", "linear-project.py")
ACCEPTANCE_AUDIT_TIMEOUT = 120.0


def compute_acceptance_audit(project, timeout=ACCEPTANCE_AUDIT_TIMEOUT):
    """Delegate to the REAL acceptance audit CLI. 0 or 1 finding."""
    common = {"check": "acceptance-audit", "ids": []}
    try:
        # --root/--declared are passed EXPLICITLY from this module's ROOT. The
        # analyser otherwise resolves the corpus from its OWN file location, which
        # would make it sweep the real repo while the caller is pointed at another
        # tree — a check that answers about the wrong population is the same class
        # of silent wrong answer this check exists to catch.
        proc = subprocess.run(
            [sys.executable, os.path.normpath(ACCEPTANCE_AUDIT_SCRIPT),
             "--acceptance-audit", "--project", project, "--root", ROOT,
             "--declared", os.path.join(ROOT, ".claude", "tools",
                                        "acceptance-audit-declared.json")],
            capture_output=True, text=True, timeout=timeout)
    except Exception as exc:                                    # noqa: BLE001
        return [dict(common, severity="unknown", message=(
            f"[acceptance-audit] NOT ESTABLISHED — the check would not run "
            f"({type(exc).__name__}: {str(exc)[:160]}). An unrunnable check is not a "
            f"clean one, and this check exists precisely because a clean answer was "
            f"indistinguishable from no answer. Remedy: "
            f"`make acceptance-audit PROJECT={project}`."))]
    out = (proc.stdout or "") + (proc.stderr or "")
    if "acceptance sweep" not in out and "acceptance audit FAILED" not in out:
        # The analyser did not produce its own headline, so it did not RUN (missing
        # file, import error, wrong interpreter). A non-zero exit from a process that
        # never reached the audit is NOT a finding, and a zero exit from one would be
        # far worse — a clean answer indistinguishable from no answer is the exact
        # false green this check exists for (§17c.2).
        return [dict(common, severity="unknown", message=(
            f"[acceptance-audit] NOT ESTABLISHED — the analyser produced no audit "
            f"output (exit {proc.returncode}): {out.strip()[:200] or '<no output>'}. "
            f"An unrunnable check is not a clean one. Remedy: "
            f"`make acceptance-audit PROJECT={project}`."))]
    if proc.returncode == 0:
        return []
    lines = [l.strip("- ").strip() for l in out.split("\n")
             if l.strip().startswith("- ")]
    ids = sorted({l.split(" ")[0] for l in lines if l})
    head = next((l for l in out.split("\n") if "acceptance audit FAILED" in l), "")
    return [dict(common, severity="block", ids=ids, message=(
        f"[acceptance-audit] {head.strip() or 'acceptance audit FAILED'} — an item's "
        f"acceptance is PRESENT but not fully readable, so a `0` (or an undercount) is "
        f"indistinguishable from an item that genuinely has none: "
        f"{', '.join(ids) or '—'}. The false-green direction is the dangerous one — the "
        f"board's `needs-acceptance` label is a WORK INSTRUCTION, and acting on it means "
        f"re-authoring over acceptance that already exists (§12a forbids it). Remedy: "
        f"`make acceptance-audit PROJECT={project}` and fix the parser, OR — if the "
        f"acceptance is genuinely not enumerable, which is product/architect work — "
        f"declare it with an authority ref (§17h)."))]


# ---------------------------------------------------------------------------
# loop-gate check 6 — the §17d test-requirement gate (human ruling, 2026-08-02)
#
#   "The ONLY thing tests should be validating is the requirements. If we are
#    making up tests for coverage that do not map onto requirements then either
#    (a) we are wasting time, or (b) we have identified a new acceptance criteria
#    and we need to retro as to why it wasn't discovered earlier."
#
# The analysis itself lives in ONE place — .claude/tools/test-requirement-gate.js —
# and is DELEGATED to here, never re-implemented (the DRY rule check 4 already
# follows for retro-debt). This is the loop's only continuously-running workflow,
# so it is where the gate has to hang: a gate in no workflow is not a gate.
#
# SEVERITY, per §F8a ("a gate blocks only on harm that stopping relieves"):
#   FAIL  (a count ABOVE the committed ratchet baseline) -> BLOCK. A NEW test that
#         cannot validate a requirement just landed; stopping the line is exactly
#         the remedy, and the fix is one file.
#   PASS  (at or below baseline)                          -> ADVISORY. The standing
#         debt is real and reported every cycle so it stays visible and shrinking,
#         but blocking the pull on it would halt delivery for a backlog — the same
#         constraint inversion the v126 addendum corrected on the intake queue.
#   NOT-CONFIGURED / UNRUNNABLE                           -> UNKNOWN ("? " line).
#         Never silent, never counted as satisfied: an unevaluated precondition is
#         not a met one (v9/§17c.2).
#
# The verdict is read from the STDOUT SENTINEL, not the exit status — `make`
# cannot express a three-way exit (a recipe exiting 3 makes make print `Error 3`
# and exit 2) and the same lesson applies to any wrapper.
# ---------------------------------------------------------------------------
TRG_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "..", "..", "..", "tools", "test-requirement-gate.js")
TRG_SENTINEL = "TRG-VERDICT:"
TRG_TIMEOUT = 120.0


def compute_test_requirement_gate(project, timeout=TRG_TIMEOUT):
    """Run the committed analyser over `project` and return 0 or 1 finding."""
    common = {"check": "test-requirement-gate", "ids": []}
    try:
        proc = subprocess.run(
            ["node", os.path.normpath(TRG_SCRIPT), "--project", project,
             "--repo-root", ROOT, "--json"],
            capture_output=True, text=True, timeout=timeout)
        report = json.loads(proc.stdout)
    except Exception as exc:                                    # noqa: BLE001
        return [dict(common, severity="unknown", verdict="UNRUNNABLE", ac=None,
                     authored=None, message=(
            f"[test-requirement-gate] NOT ESTABLISHED — the analyser would not run "
            f"({type(exc).__name__}: {str(exc)[:160]}). An unrunnable gate is not a "
            f"clean one. Remedy: `make test-requirement-gate PROJECT={project}` and "
            f"fix what it reports."))]

    verdict = report.get("verdict")
    counts = report.get("counts", {})
    ac, authored = counts.get("ac", 0), counts.get("authored", 0)
    base = report.get("baseline") or {}
    common = dict(common, verdict=verdict, ac=ac, authored=authored)

    if verdict == "NOT-CONFIGURED":
        return [dict(common, severity="unknown", message=(
            f"[test-requirement-gate] NOT ESTABLISHED — no "
            f".claude/config/test-requirement-gate/{project}.json, so nothing was "
            f"checked. That is not the same as clean: no test in this project is "
            f"known to declare the acceptance criterion it validates, and no "
            f"authored-precondition rule ran. Remedy: copy the OagEventSource "
            f"config, measure the honest baseline, commit it."))]

    detail = (f"limb1 untagged={ac} (baseline {base.get('ac', 0)}), "
              f"limb2 authored-preconditions={authored} "
              f"(baseline {base.get('authored', 0)}), "
              f"allowlist={counts.get('allowlistEntries', 0)} entries "
              f"suppressing {counts.get('allowlisted', 0)}")

    if verdict == "FAIL":
        worst = "; ".join(
            f"{v['rule']} {v['file']}:{v['line']}"
            for v in report.get("violations", []) if v.get("limb") == "authored")[:600]
        cfg_err = "; ".join(report.get("configErrors", []))[:400]
        return [dict(common, severity="block", message=(
            f"[test-requirement-gate] REGRESSION above the committed ratchet — "
            f"{detail}. A test that cannot validate a requirement has just landed. "
            f"Per the ruling it is either WASTE (delete it) or an UNDISCOVERED "
            f"acceptance criterion (register it, and the discovery gap earns a "
            f"retro). Remedy: `make test-requirement-gate PROJECT={project} "
            f"VERBOSE=1`." + (f" Limb-2 hits: {worst}." if worst else "")
            + (f" CONFIG ERRORS: {cfg_err}." if cfg_err else "")))]

    if ac or authored:
        return [dict(common, severity="advisory", message=(
            f"ADVISORY (does NOT block the pull) [test-requirement-gate] standing "
            f"debt at the ratchet floor: {detail}. Every one of these is, per the "
            f"ruling, either waste or an undiscovered acceptance criterion — the "
            f"number may only SHRINK (`make test-requirement-gate-baseline` refuses "
            f"to raise it). Reported every cycle so it cannot quietly become normal."))]

    return []


# ---------------------------------------------------------------------------
# loop-gate check 7 — unrecoverable work in a worktree (DEFECT-OAG-076)
#
# `DEFECT-OAG-072` was delivered complete — 11 files, 3096 tests green, three
# mutation demonstrations, live `gh` verification — and destroyed by a worktree
# auto-clean: `git cat-file -t fb080d9` => `fatal: Not a valid object name`. An
# agent dispatched with `isolation: worktree` onto a PROJECT-REPO item finds no
# project repo (the parent gitignores each project's own nested repo, so it is
# never in the worktree) and no legal way to commit, so it CLONES the project
# repo inside its worktree and commits there — and the clean-up takes the objects
# with it. The cleanup is documented safe because it removes an *unchanged*
# worktree; the change lived in a nested repo that check cannot see.
#
# Prevention lives at the dispatch (`make dispatch-check`) and at every removal
# path (`make worktree-guard`). This is the DETECTION limb, and it hangs here
# because the loop is the only continuously-running workflow: it finds the work
# WHILE THE OBJECTS STILL EXIST, when a `git bundle` still rescues them.
#
# The analysis lives in ONE place — .claude/tools/worktree-guard.js — and is
# DELEGATED to, never re-implemented (the DRY rule checks 4 and 6 already follow).
#
# SEVERITY, per §F8a ("a gate blocks only on harm that stopping relieves"):
#   at-risk work found -> BLOCK. Pulling more work does not make it recoverable;
#         stopping is precisely the remedy, and the remedy is one command.
#   unrunnable         -> UNKNOWN ("? " line). Never silent, never counted as
#         satisfied: an unevaluated precondition is not a met one (§17c.2).
# ---------------------------------------------------------------------------
WTG_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "..", "..", "..", "tools", "worktree-guard.js")
WTG_TIMEOUT = 120.0


def compute_worktree_guard(timeout=WTG_TIMEOUT):
    """Sweep every worktree a cleanup could delete; report work that exists only
    there. Returns 0 or 1 finding."""
    common = {"check": "worktree-guard", "ids": []}
    try:
        proc = subprocess.run(
            ["node", os.path.normpath(WTG_SCRIPT), "scan-all",
             "--repo-root", ROOT, "--json"],
            capture_output=True, text=True, timeout=timeout)
        report = json.loads(proc.stdout)
    except Exception as exc:                                    # noqa: BLE001
        return [dict(common, severity="unknown", message=(
            f"[worktree-guard] NOT ESTABLISHED — the guard would not run "
            f"({type(exc).__name__}: {str(exc)[:160]}). An unrunnable guard is not "
            f"a clean one, and this is the check that stands between a finished "
            f"agent's commits and DEFECT-OAG-072's fate. Remedy: "
            f"`make worktree-guard DIR=--all`."))]

    if report.get("safe"):
        return []

    at_risk = []
    for res in report.get("results", []):
        if res.get("safe"):
            continue
        for r in res.get("repos", []):
            if not r.get("unsafe"):
                continue
            at_risk.append((res.get("root", "?"), r.get("repo", "?"),
                            len(r.get("atRisk", [])), len(r.get("dirty", []))))
    detail = "; ".join(
        f"{repo} ({n} commit(s) at risk, {d} uncommitted)" for _root, repo, n, d in at_risk
    )[:800] or "see `make worktree-guard DIR=--all`"
    roots = sorted({root for root, _repo, _n, _d in at_risk})
    return [dict(common, severity="block", ids=[], roots=roots, message=(
        f"[worktree-guard] WORK THAT EXISTS NOWHERE ELSE is sitting in a worktree "
        f"a cleanup can delete: {detail}. This is how DEFECT-OAG-072 was destroyed "
        f"(git cat-file -t fb080d9 => Not a valid object name) — and the objects are "
        f"STILL ON DISK right now, which is the only reason it is recoverable. "
        f"Remedy: make it durable (push to the LOCAL shared repo, or "
        f"`make worktree-guard DIR=--all RESCUE_TO=<dir>` to bundle it), then re-run. "
        f"Fix the cause too: a project-repo item must never take worktree isolation "
        f"(`make dispatch-check ID=<item> ISOLATION=worktree`). Affected: "
        f"{', '.join(roots) or '—'}."))]


# ---------------------------------------------------------------------------
# loop-gate check 9 — a file a committed `make` target RUNS must be on trunk
# (OI-GITIGNORE-SWALLOWS-COMMITTED-TOOLS, AC-GI.3)
#
# A blanket `.gitignore` on `src/app/scripts/*.mjs` silently swallowed a COMMITTED
# TOOL SIX TIMES in one project. Every firing is identical: an engineer writes a
# re-runnable tool, wires a make target to it, `git add`s it, GIT SAYS NOTHING, the
# suite is green, and the tool exists on exactly one machine. The most recent
# (DEFECT-OAG-070) was the tool producing the real AWS-shaped fixture that whole fix
# depended on.
#
# That is the DEF-ROC-001 / v89 FALSE GREEN: nothing goes red, because nothing was
# looking. The established remedy had become "append another negation line", which is
# why the ignore file's negation list had become a written record of the trap firing —
# and each negation made the next firing MORE likely, because nine curated exceptions
# read as deliberate rather than broken.
#
# The analysis lives in ONE place — .claude/tools/make-refs-tracked.js — and is
# DELEGATED to, never re-implemented (the DRY rule checks 4, 6, 7 and 8 follow).
#
# WHY IT HANGS HERE. Two reasons, and the second is the load-bearing one:
#   1. The loop is the only continuously-running workflow. A gate in no workflow is
#      not a gate — and this project found THREE controls in one day that existed and
#      were invoked nowhere.
#   2. The project's own CI CANNOT run it. The analyser lives in the agent-system
#      repo; a project clone does not contain `.claude/tools/`. So the pull loop is
#      the only place the general form can hang at all. (The project ALSO carries a
#      narrow local pin of the same property in its own suite, which its CI does run.)
# And it catches the omission WHILE THE FILE STILL EXISTS ON DISK — one `git add`
# from safe, which is the whole reason to check before a pull rather than after.
#
# SEVERITY, per §F8a ("a gate blocks only on harm that stopping relieves"):
#   untracked -> BLOCK. The file is on someone's disk RIGHT NOW; pulling more work is
#         how it gets lost, and the remedy is one command.
#   dangling  -> ADVISORY. The file is already gone, so stopping recovers nothing —
#         but it is reported every cycle so a dead target cannot become normal.
#   unrunnable -> UNKNOWN ("? " line). Never silent, never counted as satisfied: an
#         unevaluated precondition is not a met one (§17c.2), and "clean" being
#         indistinguishable from "did not run" IS the shape of the defect.
# ---------------------------------------------------------------------------
MRT_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "..", "..", "..", "tools", "make-refs-tracked.js")
MRT_TIMEOUT = 120.0


def compute_make_refs_tracked(project, timeout=MRT_TIMEOUT):
    """Assert every file a committed make target runs is on trunk. 0 or 1 finding."""
    common = {"check": "make-refs-tracked", "ids": []}
    try:
        proc = subprocess.run(
            ["node", os.path.normpath(MRT_SCRIPT), "--project", project,
             "--repo-root", ROOT, "--json"],
            capture_output=True, text=True, timeout=timeout)
        report = json.loads(proc.stdout)
    except Exception as exc:                                    # noqa: BLE001
        return [dict(common, severity="unknown", untracked=None, dangling=None,
                     message=(
            f"[make-refs-tracked] NOT ESTABLISHED — the check would not run "
            f"({type(exc).__name__}: {str(exc)[:160]}). An unrunnable check is not a "
            f"clean one, and a clean answer that is indistinguishable from no answer "
            f"is exactly the false green this check exists for. Remedy: "
            f"`make make-refs-tracked PROJECT={project}`."))]

    counts = report.get("counts") or {}
    untracked = counts.get("untracked") or 0
    dangling = counts.get("dangling") or 0
    common = dict(common, untracked=untracked, dangling=dangling,
                  refs=counts.get("refs", 0))

    def named(kind, limit=5):
        refs = [f.get("ref", "?") for f in report.get("findings", [])
                if f.get("kind") == kind]
        return ", ".join(refs[:limit]) + (" …" if len(refs) > limit else "")

    if untracked:
        return [dict(common, severity="block", message=(
            f"[make-refs-tracked] {untracked} file(s) a COMMITTED MAKE TARGET RUNS "
            f"are NOT ON TRUNK: {named('untracked')}. They exist on this machine and "
            f"nowhere else, nothing regenerates them, and NOTHING WILL GO RED — a "
            f"green suite here runs a file no one else has (DEF-ROC-001 / v89). This "
            f"trap has fired six times on one directory. Caught while the file still "
            f"EXISTS, so the remedy is one command: commit it — and if a .gitignore "
            f"rule swallowed it, FIX THE RULE, do not add a negation."
            + (f" Also {dangling} dangling reference(s): {named('dangling')}."
               if dangling else "")))]

    if dangling:
        return [dict(common, severity="advisory", message=(
            f"ADVISORY (does NOT block the pull) [make-refs-tracked] {dangling} "
            f"committed make target(s) name a file that is NOT IN THE REPO AT ALL: "
            f"{named('dangling')}. The target outlived its file, so it cannot run for "
            f"anyone — the same false green from the other direction. Stopping the "
            f"line recovers nothing, so this is advisory, but it is reported every "
            f"cycle so a dead target cannot quietly become normal. Remedy: restore "
            f"the file or delete the target."))]

    return []


# ---------------------------------------------------------------------------
# loop-gate check 8 — orphaned local containers, AND THE REAP ITSELF
# (DEFECT-OAG-091)
#
# EXP-133 (v137) correctly gave every dispatch its OWN DynamoDB Local container —
# a shared one let engineer B recreate engineer A's container under an in-flight
# suite — but it moved the cost from COLLISION to ACCUMULATION and shipped no
# reaper. `ddb-local-down` is per-dispatch and must be called by the agent that
# created the container, so any agent that dies, stalls or forgets leaks its
# container FOREVER, and dying is common here.
#
# Measured 2026-08-10T23:31Z with no agent having run for two days:
#     load averages: 19.85 18.46 16.18
#     19 containers running, 13 of them OAG DynamoDB Local (ten of them 2 DAYS old)
# A two-file test run took 301 SECONDS; 877 MILLISECONDS after reaping — 340x. Four
# consecutive agent deaths immediately preceded it and had all been attributed to
# agent-side causes. The worse harm is evidential: engineers reported reds that were
# green in isolation, and one misread file ownership under load badly enough to
# nearly revert another agent's uncommitted work.
#
# WHY IT REAPS RATHER THAN REPORTS. §17e: "a reaper nobody invokes is the same class
# of failure as the missing one". Leaving the removal to a remembered command leaves
# it to exactly the agent discipline that leaked the containers. The loop is the only
# continuously-running workflow here, so this is where the sweep has to happen —
# before EVERY pull, automatically. It is safe to do inside a gate because every one
# of the reaper's five predicates fails safe toward KEEPING (ownership by compose
# provenance, an age floor, a live lease, an established-connection veto, and a full
# TTL of grace for an unleased container) and because it touches nothing but docker
# objects and a machine-local lease dir — never the working tree (AC-091.4).
# `CONTAINER_REAP_MODE=scan` makes it read-only for anyone who wants that.
#
# The analysis and the removal live in ONE place — .claude/tools/container-reap.js —
# and are DELEGATED to, never re-implemented (checks 4, 6 and 7 already follow).
#
# SEVERITY, per §F8a ("a gate blocks only on harm that stopping relieves"):
#   orphans found/removed -> ADVISORY. Blocking would be perverse: the sweep has
#         already relieved the harm, and idle containers are not a reason to stop the
#         line. Reported every cycle so a recurring leak stays visible.
#   a removal FAILED      -> ADVISORY, named. Stopping the loop does not un-wedge a
#         container, but a silently-swallowed failure is how this defect came back.
#   NOT-CONFIGURED /
#   UNRUNNABLE            -> UNKNOWN ("? " line). Never silent, never counted as
#         satisfied: an unevaluated precondition is not a met one (§17c.2).
# ---------------------------------------------------------------------------
CREAP_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "..", "..", "..", "tools", "container-reap.js")
CREAP_TIMEOUT = 180.0


def compute_container_reap(project, timeout=CREAP_TIMEOUT):
    """Sweep (and by default REMOVE) this project's orphaned local containers and
    compose networks. Returns 0 or 1 finding."""
    common = {"check": "container-reap", "ids": []}
    mode = os.environ.get("CONTAINER_REAP_MODE", "reap")
    if mode not in ("reap", "scan"):
        mode = "reap"
    try:
        proc = subprocess.run(
            ["node", os.path.normpath(CREAP_SCRIPT), mode, "--project", project,
             "--repo-root", ROOT, "--json"],
            capture_output=True, text=True, timeout=timeout)
        report = json.loads(proc.stdout)
    except Exception as exc:                                    # noqa: BLE001
        return [dict(common, severity="unknown", verdict="UNRUNNABLE", message=(
            f"[container-reap] NOT ESTABLISHED — the reaper would not run "
            f"({type(exc).__name__}: {str(exc)[:160]}). An unrunnable reaper is not a "
            f"clean machine, and this is the check that stands between the next wave "
            f"of dispatches and a load average of 19.85 (a two-file test run at 301s "
            f"instead of 877ms). Remedy: `make container-reap PROJECT={project}`."))]

    verdict = report.get("verdict")
    if verdict != "OK":
        return [dict(common, severity="unknown", verdict=verdict, message=(
            f"[container-reap] NOT ESTABLISHED ({verdict}) — "
            f"{report.get('message', 'no detail')}. Nothing was checked, which is not "
            f"the same as clean: this project's local containers are undeclared, so "
            f"an orphan wave would accumulate unseen. Remedy: commit "
            f".claude/config/container-reap/{project}.json (copy the OagEventSource "
            f"one) and re-run `make container-reap PROJECT={project}`."))]

    removed = report.get("removed") or {"containers": [], "networks": []}
    reapable = report.get("reap") or {"containers": [], "networks": []}
    failed = report.get("failed") or []
    n_rc, n_rn = len(removed.get("containers", [])), len(removed.get("networks", []))
    n_pc, n_pn = len(reapable.get("containers", [])), len(reapable.get("networks", []))
    if not (n_rc or n_rn or n_pc or n_pn or failed):
        return []

    owned = report.get("owned") or {}
    if mode == "reap":
        head = (f"REAPED {n_rc} container(s) + {n_rn} network(s)"
                if (n_rc or n_rn) else
                f"{n_pc} container(s) + {n_pn} network(s) reapable but NOT removed")
    else:
        head = (f"scan-only (CONTAINER_REAP_MODE=scan): {n_pc} container(s) + "
                f"{n_pn} network(s) ORPHANED and left in place")
    names = ", ".join((removed.get("containers") or reapable.get("containers") or [])
                      + (removed.get("networks") or reapable.get("networks") or []))
    fail_tail = ("  FAILED: " + "; ".join(
        f"{f.get('kind')} {f.get('name')}: {str(f.get('err'))[:120]}"
        for f in failed)) if failed else ""
    probe = report.get("establishedProbe")
    probe_tail = ("" if probe == "ok" else
                  f" The in-use probe was {probe}, so the mid-write veto could not be "
                  f"evaluated — reaps in this sweep record inUse=unknown.")
    return [dict(common, severity="advisory", verdict=verdict,
                 removed=removed, reapable=reapable, failed=failed, message=(
        f"ADVISORY (does NOT block the pull) [container-reap] {head} for {project} "
        f"({owned.get('containers', '?')} owned, {owned.get('running', '?')} running): "
        f"{names[:400]}. Every orphan is a dead dispatch's container that nothing else "
        f"would ever remove — thirteen of them once drove load to 19.85 and made a "
        f"two-file test run take 301s instead of 877ms (340x), killing four agents in "
        f"a row and producing reds that were green in isolation. A RECURRING nonzero "
        f"count here means dispatches are dying before `ddb-local-down`, which is a "
        f"defect about the dispatch, not about the reaper."
        + probe_tail + fail_tail))]


def cmd_loop_gate(a):
    graphs = Graphs.load()
    now = parse_ts(getattr(a, "now", None)) if getattr(a, "now", None) else None
    stale_hours = getattr(a, "stale_hours", DEFAULT_STALE_HOURS)
    findings = compute_loop_gate(
        graphs, a.project, stale_hours=stale_hours, threshold=a.threshold, now=now,
        observe=getattr(a, "observe", True),
        observe_timeout=getattr(a, "observe_timeout", None) or DEFAULT_OBSERVE_TIMEOUT,
        max_backlog_age_days=getattr(a, "max_backlog_age_days", None)
        or DEFAULT_MAX_BACKLOG_AGE_DAYS)
    blocking = [f for f in findings if f["severity"] == "block"]
    advisory = [f for f in findings if f["severity"] == "advisory"]
    unknown = [f for f in findings if f["severity"] == "unknown"]
    stamp = (now or parse_ts(now_iso())).strftime("%Y-%m-%dT%H:%M:%SZ")
    # ADVISORY findings NEVER affect the verdict or the exit code — but they are
    # always printed, and an advisory-only run says so explicitly so "may pull"
    # can never be read as "everything is satisfied".
    adv_tail = (f"; {len(advisory)} advisory (non-blocking, still outstanding)"
                if advisory else "")
    # UNKNOWN findings likewise never affect the exit code, but they MUST reach the
    # headline: an `awaiting_observation` item whose predicate was not evaluated
    # (--no-observe) or a stalled item whose ref will not resolve is a thing this
    # run FAILED TO ESTABLISH, and "all preconditions hold" would read as if it had.
    adv_tail += (f"; {len(unknown)} NOT ESTABLISHED (see ? lines)" if unknown else "")
    verdict = (f"BLOCKED ({len(blocking)} violated precondition"
               f"{'' if len(blocking) == 1 else 's'}) — do NOT pull until cleared"
               if blocking else
               ("OK — no BLOCKING precondition violated, the loop may pull"
                if (advisory or unknown) else
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
    print(f"validate: {a.project} clean — I1–I4 + I6 all hold.")


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

        # I6: an `awaiting_observation` FLOW item carries a VALID machine-checkable
        # observation predicate. `append` refuses the transition without one, so a
        # violation here means a hand-edit — the same role I2 plays for the
        # terminal/queue pair. (I5 is RESERVED for IMP-011's CORE-job invariant,
        # which is still owed; this is deliberately NOT that number.)
        # AGGREGATES are exempt by construction: a slice/chunk BUBBLES into this
        # state from a child and has no own event stream to carry a predicate — the
        # predicate lives on the child, which is checked in its own right.
        if state == AWAITING_OBSERVATION and graphs.kind(it.type) == "flow":
            spec = observe_spec_in_effect(it)
            if not spec:
                violations.append(
                    f"(I6) {iid}: in '{AWAITING_OBSERVATION}' with NO observation "
                    f"predicate — nothing can decide when it is done. Record one "
                    f"via `wi-append … EVENT=amended … OBSERVE={OBSERVE_SCHEME}"
                    f"<target>`; do not hand-edit item state.")
            else:
                try:
                    parse_observe_spec(spec)
                except ValueError as e:
                    violations.append(
                        f"(I6) {iid}: observation predicate is not evaluable: {e}")

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
    ap.add_argument("--note-file", dest="note_file",
                    help="read the note from a FILE instead of the command line — the "
                         "ONLY route that cannot corrupt it "
                         "(OI-WI-APPEND-NOTE-PATH-MANGLES-CONTENT). Prose on a command "
                         "line crosses make's variable expansion and then a shell "
                         "double-quoted string: `$` is expanded away (a real audit "
                         "note lost a regex's end-anchor this way) and a backtick is "
                         "EXECUTED (a real commit message lost a word to the macOS "
                         "`open` binary actually running). A PATH has no "
                         "metacharacters, so nothing can eat it. Same idea as "
                         "`git commit -F`. One trailing newline is stripped; any other "
                         "newline is REJECTED, because the event is stored as a "
                         "one-line inline map and would be silently truncated.")
    ap.add_argument("--ts")
    ap.add_argument("--observe",
                    help="REQUIRED when entering `awaiting_observation` (event "
                         "not_yet_observed): the machine-checkable liveness "
                         f"predicate, '{OBSERVE_SCHEME}<target> [VAR=VALUE ...]' — a "
                         "committed re-runnable make target in work/<project>/ that "
                         f"exits 0 and prints `{OBS_SENTINEL} {OBS_OBSERVED}` once "
                         f"the observation has landed (or `{OBS_SENTINEL} "
                         f"{OBS_NOT_YET}` while it has not). Also accepted on the "
                         "`amended` self-edge, where it REPLACES the predicate in "
                         "effect. Rejected on any other event.")
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

    pc = sub.add_parser("parts-check",
                        help="CHEAP per-close constraint read: drains INCIDENT "
                             "retro debt ONLY while the constraint is provably "
                             "unchanged; exit 2 escalates to a full retro")
    pc.add_argument("--project", required=True)
    pc.add_argument("--threshold", type=int, default=3,
                    help="routine-debt batch threshold (default 3); parts-check "
                         "drains the INCIDENT arm only and escalates if routine "
                         "debt has reached this")
    pc.add_argument("--now", help="reference timestamp (ISO-8601 UTC)")
    pc.set_defaults(func=cmd_parts_check)

    lg = sub.add_parser("loop-gate",
                        help="MECHANICAL pull-precondition gate: exit 2 if any "
                             "blocking precondition is violated (stalled "
                             "validation / ready below floor / queue over cap / "
                             "retro due / observation landed)")
    lg.add_argument("--project", required=True)
    lg.add_argument("--no-observe", dest="observe", action="store_false",
                    default=True,
                    help="skip re-evaluating `awaiting_observation` liveness "
                         "predicates (they can be slow real-data queries). Each "
                         "parked item is then reported as NOT EVALUATED — a skipped "
                         "run can never read as satisfied.")
    lg.add_argument("--observe-timeout", dest="observe_timeout", type=float,
                    default=DEFAULT_OBSERVE_TIMEOUT,
                    help="seconds an observation predicate may take before it is "
                         f"BROKEN (default {DEFAULT_OBSERVE_TIMEOUT})")
    lg.add_argument("--stale-hours", dest="stale_hours", type=float,
                    default=DEFAULT_STALE_HOURS,
                    help="dwell in validating/dev-validating/prod-validating "
                         f"beyond which a done-but-undispatched item BLOCKS the "
                         f"loop (default {DEFAULT_STALE_HOURS})")
    lg.add_argument("--max-backlog-age-days", dest="max_backlog_age_days",
                    type=float, default=DEFAULT_MAX_BACKLOG_AGE_DAYS,
                    help="days a BACKLOG item may sit with no recorded decision "
                         "(schedule it, or `defer_until: YYYY-MM-DD`) before it "
                         f"BLOCKS the loop (default {DEFAULT_MAX_BACKLOG_AGE_DAYS}). "
                         "Blocks on AGE-WITHOUT-A-DECISION, never on depth")
    lg.add_argument("--threshold", type=int, default=3,
                    help="retro-debt routine threshold (passed through to the "
                         "retro-debt computation this delegates to)")
    lg.add_argument("--now", help="reference 'now' (ISO-8601 UTC) for deterministic tests")
    lg.set_defaults(func=cmd_loop_gate)

    a = p.parse_args(argv)
    a.func(a)


if __name__ == "__main__":
    main()
