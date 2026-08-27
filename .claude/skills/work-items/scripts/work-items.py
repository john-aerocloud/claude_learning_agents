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
    return _run_probe(project, spec, OBS_SENTINEL, _OBS_SENTINEL_RE,
                      (OBS_OBSERVED, OBS_NOT_YET), timeout, "observation")


# ---------------------------------------------------------------------------
# THE REVERSAL PROBE — §17c limb 6 (v144/EXP-143), MECHANISED at v145 (OI-ROC-005)
#
# `blocked` was the one park state nothing re-checked. The machinery already
# enumerated BOTH park states (`_PARKED_STATES`) and already refused
# `not_yet_observed` without a predicate, on the stated grounds that "a park whose
# reason is only a `note:` can never come back negative and therefore never ends".
# That reasoning was never specific to observation; `blocked` was simply left
# exempt. The measured cost: `DEF-ROC-004` sat `blocked` for 28.8 DAYS after both
# of its blockers had already gone, and `blocked` holds 41% of this project's gross
# lead time at a median of 21.7 days per item.
#
# The contract is §17c.2's, copied deliberately rather than reinvented — same
# `make:<target>` scheme, same parser, same timeout, same fail-CLOSED treatment:
#   `BLOCKER: standing`  -> the probe ran and the blocker is genuinely still there
#                           (ADVISORY; legitimate, outstanding, never "satisfied").
#   `BLOCKER: cleared`   -> the blocker is GONE; an `unblocked` dispatch is now
#                           actionable (loop-gate BLOCKS for it).
#   anything else        -> BROKEN. No sentinel, both sentinels, non-zero exit, a
#                           missing target, a crash, a timeout. Fail CLOSED, so a
#                           probe that does not exist can never masquerade as
#                           "still blocked" — the exact mistake DEF-ROC-046 made in
#                           the other direction.
#
# NOTE the asymmetry with observation, which is deliberate: `observed` and
# `cleared` both BLOCK (there is an actionable dispatch), while `not-yet` and
# `standing` are advisory. The park is only honest while something can decide it
# has ended.
# ---------------------------------------------------------------------------
#
# THIRD VERDICT (v154 §F5e.1 q3, ROC 2026-08-26). `not-established` was added because a
# probe that was being HONEST was reported as BROKEN. `probe-blocker-def-roc-053` prints
# "BLOCKER: NOT OBSERVED in this window" — correctly refusing to call non-observation in a
# bounded window a CLEARANCE, which would be exactly the §17i failure this whole scheme
# exists to prevent. The contract admitted only `standing`/`cleared`, so the honest answer
# read as an unreadable one and blocked the loop. The probe was right; the vocabulary was
# wrong.
#   `BLOCKER: not-established` -> the probe RAN and could not determine either way in the
#                           window it had. ADVISORY. Not a pass, not an alarm, and NOT a
#                           reason to stop looking (§17i).
# FAIL-CLOSED IS PRESERVED, which is the whole reason this is safe: the verdict must be
# EXPLICITLY PRINTED. A missing target, a crash, a timeout, no sentinel or both sentinels
# are all still BROKEN, so a probe that does not exist still cannot masquerade as anything.
# The difference between "I ran and cannot tell" and "I did not run" is now expressible,
# and only the former is the probe's to claim.
BLK_SENTINEL = "BLOCKER:"
BLK_STANDING = "standing"
BLK_CLEARED = "cleared"
BLK_NOT_ESTABLISHED = "not-established"
_BLK_SENTINEL_RE = re.compile(r"^\s*" + BLK_SENTINEL + r"\s*(\S+)\s*$",
                              re.IGNORECASE | re.MULTILINE)


def probe_spec_in_effect(item):
    """The reversal probe CURRENTLY in effect for `item`: the `probe:` of the LAST
    event that carries one, so a wrong probe is corrected by appending `amended`
    with a new one and never by editing a historical event. None if there is none.
    Mirror of `observe_spec_in_effect` — same rule, the other park state."""
    spec = None
    for ev in item.events:
        if ev.get("probe"):
            spec = str(ev.get("probe"))
    return spec


def _run_probe(project, spec, sentinel, sentinel_re, names, timeout, what):
    """Evaluate a `make:<target>` predicate NOW and read its sentinel verdict.

    Shared by the observation predicate (§17c.2) and the reversal probe (§17c.6):
    the scheme, the parser, the argv-list invocation, the timeout and the
    fail-CLOSED verdict reading are identical, and only the sentinel word and the
    verdict names differ. `names` is (positive, negative) or, since v154 §F5e.1 q3,
    (positive, negative, *others) — the positive verdict is the one with an ACTIONABLE
    dispatch behind it, and any `others` are additional verdicts the probe may state
    explicitly (the reversal probe's `not-established`). Fail-closed is unchanged: a
    verdict must be PRINTED to be read, so a probe that did not run still reports
    'broken' and can never masquerade as any of these.

    Returns (verdict, detail) where verdict is one of `names` or 'broken'.
    """
    try:
        argv = parse_observe_spec(spec)
    except ValueError as e:
        return "broken", f"malformed {what} spec: {e}"
    positive, negative, *others = names
    allowed = (positive, negative, *others)
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
        return "broken", (f"the probe exited {r.returncode} — a {what} probe must "
                          f"exit 0 and report its verdict on stdout as "
                          f"`{sentinel} " + "|".join(allowed) + f"`: {tail}")
    verdicts = {m.group(1).strip().lower() for m in sentinel_re.finditer(out)}
    verdicts &= set(allowed)
    if len(verdicts) == 1:
        return next(iter(verdicts)), out.strip()[-400:]
    if len(verdicts) > 1:
        return "broken", (f"the probe reported BOTH verdicts — ambiguous, so it "
                          f"establishes nothing: {tail}")
    return "broken", (f"the probe printed no `{sentinel} "
                      + "|".join(allowed) + f"` line, so its verdict is "
                      f"unreadable: {tail}")


def _run_blocker_probe(project, spec, timeout=DEFAULT_OBSERVE_TIMEOUT):
    """Evaluate a reversal probe NOW. Returns (verdict, detail) with verdict
    'cleared' | 'standing' | 'broken'. Module-level so the loop-gate tests can
    substitute it (same seam as `_run_observation` / `_ref_on_trunk`)."""
    return _run_probe(project, spec, BLK_SENTINEL, _BLK_SENTINEL_RE,
                      (BLK_CLEARED, BLK_STANDING, BLK_NOT_ESTABLISHED), timeout,
                      "reversal")


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
    # The file's DECLARED derived block, attached by `load_item` for I8 only
    # (None ⇒ constructed in memory / no block on disk). Never read to decide
    # state: state is fold(events).
    declared = None

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


# Fields that are STRINGS by nature and must never be number-coerced by
# _parse_scalar. A sha of all digits is still a sha (DEFECT-OAG-128).
#
# IMP-029 (opened 2026-08-01, and the fix it prescribed — "coerce `ref:` to str at
# parse time, in the frontmatter loader" — sat unswept for 19 days while the exact
# consequence it predicted happened: "a sha that fails to resolve looks identical to
# a sha that resolves negative") also asked for an AUDIT of the other scalars that
# can be all-digits. Done, through the real parser over all 478 items: the only
# fields parsed as numbers are `value`, `cost`, `tokens`, `duration_ms`, every one
# numeric BY INTENT. So `ref` was the sole live hazard.
#
# `id` and `job` are listed anyway, with a population of ZERO today. That is
# deliberate: they are strings by INTENT (`DEFECT-OAG-128`, `J0`), and the reason
# they are not currently coerced is that nobody has yet written an all-digit one —
# which is luck, not a property. A field protected by the absence of a counterexample
# is the shape §17h warns about; protect it by construction. (`title` is always
# quoted and `defer_until` is date-shaped, so neither needs it.)
EVENT_STRING_FIELDS = ("ref",)
TOP_STRING_FIELDS = ("id", "job", "lane", "type")


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
        k = k.strip()
        # A `ref:` is a SHA — a string by nature, even when every character
        # happens to be a digit. Int-coercing it DESTROYS DATA and the loss is
        # silent: the sha `0605428` was read as the int 605428 and then
        # re-rendered into the item file without its leading zero, so `UC-XA5`
        # permanently records a ref that resolves in NEITHER repo — which is the
        # `git cat-file` signature of destroyed work (DEFECT-OAG-128, and the real
        # commit 06054289ae9d... is on origin/main the whole time). 11 of 202 refs
        # in the registry are all-digit, so this is a standing hazard, not a
        # one-off. resolve_ref repairs the refs already damaged; this stops new ones.
        d[k] = str(val).strip() if k in EVENT_STRING_FIELDS else _parse_scalar(val)
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
            fm[key] = (rest.strip() if key in TOP_STRING_FIELDS
                       else _parse_scalar(rest))
            i += 1
    return fm


def load_item(path):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    fm_text, body = _split_frontmatter(text)
    fm = parse_frontmatter(fm_text)
    it = Item(path, fm, body)
    # The file's OWN COPY of the derived block, kept as-declared and never used to
    # decide anything — its only purpose is I8, which compares it against
    # fold(events). `parse_frontmatter` deliberately discards everything under
    # `derived:`, which is why nothing could see this class of drift before
    # (OI-WI-VALIDATE-IGNORES-DERIVED-STATE-LEGALITY).
    it.declared = _declared_derived_from_text(fm_text)
    return it


# --- the file's declared `derived:` block (READ FOR VALIDATION ONLY) ---------
# `derived:` is a RENDERING of fold(events), marked "do not hand-edit" — and until
# I8 nothing enforced that. Five use-case items were registered with hand-authored
# blocks carrying the aggregate-only `state: planned` / `queue: null` and
# `wi-validate` reported clean; the Linear projector's reality sweep was the only
# thing that noticed. So the block is parsed here EXCLUSIVELY so the gate can
# disagree with it. No other code path may read it: state is the fold, always.
def _declared_derived_from_text(fm_text):
    """Return {'state': …, 'queue': …} as DECLARED in the file, or None when the
    item carries no `derived:` block at all. Missing keys are simply absent from
    the dict (distinct from a key declared `null`)."""
    lines = fm_text.split("\n")
    start = None
    for i, line in enumerate(lines):
        if re.match(r"^derived:\s*$", line):
            start = i
            break
    if start is None:
        return None
    out = {}
    for line in lines[start + 1:]:
        if line.strip() == "" or line.strip().startswith("#"):
            continue
        if not line.startswith(" "):
            break                      # back to a top-level key: block is over
        m = re.match(r"^  (state|queue):\s*(.*)$", line)
        if m:
            out[m.group(1)] = _parse_scalar(m.group(2))
    return out


def declared_derived(path):
    """The `derived:` block as DECLARED in an item file on disk (validation only)."""
    with open(path, encoding="utf-8") as f:
        fm_text, _body = _split_frontmatter(f.read())
    return _declared_derived_from_text(fm_text)


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
    # probe: the MACHINE-CHECKABLE REVERSAL probe of a `blocked` park [v145,
    # §17c limb 6] — same `make:<target> [VAR=V]` scheme, different sentinel.
    # Required on `blocked`, optional on the `amended` self-edge (where it
    # REPLACES the probe in effect — the correction and migration path).
    if ev.get("probe") not in (None, ""):
        parts.append(f"probe: {_q(ev.get('probe'))}")
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


# The AGGREGATE bubble's RANGE — every value `_bubble` above can return, and
# therefore every state an aggregate may legitimately declare. Kept adjacent to
# `_bubble` on purpose: if a future bubble rule can return something else, this set
# is the line it has to cross, and TestLegalStatesDerivation drives `_bubble` over
# every child configuration to prove the two agree (a legal set the code can step
# outside is not a legal set).
_BUBBLE_RANGE = {AGG_INITIAL, "in_progress"} | _PARKED_STATES


def legal_states(graphs, itype):
    """The set of states an item of `itype` may legitimately be IN — DERIVED from
    state-graphs.json, never a hand-kept list (the pattern established by
    OI-LINEAR-CANCELLED-STATE-UNMAPPED's fix, whose whole point was that a
    hand-kept mirror of the graph goes stale silently).

      FLOW      : the initial state plus every `from`/`to` in its transitions.
      AGGREGATE : the initial state, its terminals, and the bubble's range — an
                  aggregate has no own event stream, so its state is not folded
                  but BUBBLED, and a flow-only state (`ready`, `building`) is not
                  something it can ever legitimately be in.

    Returns an empty set for an unknown type (the caller reports that separately)."""
    tdef = graphs.types.get(itype)
    if not tdef:
        return set()
    states = {graphs.initial(itype)} | graphs.terminals(itype)
    if graphs.kind(itype) == "aggregate":
        states |= _BUBBLE_RANGE
    else:
        for t in graphs.transitions(itype):
            states.add(t["from"])
            states.add(t["to"])
    return {s for s in states if s}


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

    # --- the REVERSAL probe is REQUIRED on `blocked`, not optional [v145] -----
    # §17c limb 6 / EXP-143, mechanised by OI-ROC-005. The machinery already
    # enumerated BOTH park states and already refused `not_yet_observed` without a
    # predicate, on the stated grounds that a park whose reason is only a `note:`
    # can never come back negative and therefore never ends. `blocked` was simply
    # left exempt, and it is the more expensive of the two: 41% of gross lead time
    # at a median 21.7 days per item, with DEF-ROC-004 sitting blocked for 28.8
    # DAYS after both of its blockers had already gone. Refuse it at the WRITE,
    # which is the earliest possible catch.
    probe = getattr(a, "probe", None)
    if to == "blocked":
        if probe:
            try:
                parse_observe_spec(probe)
            except ValueError as e:
                print(f"append REJECTED: {a.id}: {e}", file=sys.stderr)
                print(f"  the probe must be '{OBSERVE_SCHEME}<target> "
                      f"[VAR=VALUE ...]' naming a COMMITTED, RE-RUNNABLE target in "
                      f"work/{a.project}/Makefile that exits 0 and prints "
                      f"`{BLK_SENTINEL} {BLK_CLEARED}` once the blocker is gone, or "
                      f"`{BLK_SENTINEL} {BLK_STANDING}` while it is still there.",
                      file=sys.stderr)
                sys.exit(1)
        elif a.event == "blocked":
            print(f"append REJECTED: {a.id}: entering 'blocked' requires --probe "
                  f"(a machine-checkable reversal probe).", file=sys.stderr)
            print(f"  A park whose reason is only a --note cannot come back "
                  f"negative, so nothing ever ends it: `blocked` is the top time "
                  f"thief in this project and DEF-ROC-004 sat here for 28.8 DAYS "
                  f"after both of its blockers had already gone (§17c limb 6).",
                  file=sys.stderr)
            print(f"  e.g. --probe '{OBSERVE_SCHEME}probe-blocker-<id>' — it must "
                  f"exit 0 and print `{BLK_SENTINEL} {BLK_CLEARED}` or "
                  f"`{BLK_SENTINEL} {BLK_STANDING}`; anything else is BROKEN and "
                  f"blocks the loop. A probe that ALWAYS prints "
                  f"`{BLK_SENTINEL} {BLK_STANDING}` is a mechanism that cannot "
                  f"fail — write one that can.", file=sys.stderr)
            sys.exit(1)
    elif probe:
        print(f"append REJECTED: {a.id}: --probe is only meaningful on a "
              f"transition into 'blocked' (got '{a.event}' -> '{to}').",
              file=sys.stderr)
        sys.exit(1)

    ts = a.ts or now_iso()
    new_event = {"ts": ts, "event": a.event, "agent": a.agent}
    if a.ref:
        # THE EARLIEST CATCHABLE POINT for a bad `ref:` — this is where the data
        # ENTERS (DEFECT-OAG-128). Two outcomes, deliberately asymmetric:
        #
        # REFUSED — a ref that is not sha-SHAPED. The contract declares `ref: <sha>`
        #   (process/machinery/CONTRACT.md), so there is no legitimate use and no
        #   judgement to make; `UC-ML1` put an architecture-delta DOCUMENT id
        #   (`delta-052`) in the field and it sat there unnoticed. Refusing costs the
        #   caller one corrected command; accepting costs a permanently unverifiable
        #   ref, and it is the shape a genuinely mistyped sha would hide behind.
        # WARNED, NOT REFUSED — a sha-shaped ref that resolves in NEITHER repo. It is
        #   NOT refused, because the fail-safe direction here is the opposite one: the
        #   event log is the source of truth, and losing a real state transition
        #   because git could not vouch for its sha would be a far worse outcome than
        #   recording a suspect sha. `loop-gate` check 12 is the BLOCKING control and
        #   it sweeps the whole registry every cycle, so nothing escapes — this just
        #   puts the complaint in front of the agent that made the mistake, while it
        #   still remembers what it committed.
        ref = str(a.ref).strip()
        if not _is_sha_shaped(ref):
            print(f"append: REFUSED — `ref: {ref}` is not a commit sha, and the "
                  f"contract declares `ref: <sha>` "
                  f"(process/machinery/CONTRACT.md). A ref that cannot be resolved "
                  f"against a repo can never be verified, and it is exactly the "
                  f"shape a mistyped sha hides behind (DEFECT-OAG-128). If you meant "
                  f"to cite a document (an architecture delta, an ADR), put it in "
                  f"--note; if you meant a commit, pass its sha.", file=sys.stderr)
            sys.exit(1)
        res = resolve_ref(a.project, ref)
        if res["verdict"] == REF_ABSENT:
            print(f"append: WARNING — `ref: {ref}` resolves in NEITHER the "
                  f"project repo (work/{a.project}) NOR the agent-system repo, "
                  f"though both were readable. The event is being RECORDED (the log "
                  f"is the source of truth and losing a real transition is worse "
                  f"than recording a suspect sha), but this is the DEFECT-OAG-072 "
                  f"signature: either the sha is mistyped, or work has been "
                  f"DESTROYED. Check NOW, while you still remember what you "
                  f"committed — `make worktree-guard DIR=--all` — and correct the "
                  f"ref if it is a typo. `make loop-gate` will BLOCK the loop on "
                  f"this until it is resolved.", file=sys.stderr)
        elif res["padded"]:
            print(f"append: note — `ref: {ref}` resolved only after rebuilding a "
                  f"leading zero (`{res['resolved']}`). Record the sha with its "
                  f"leading zero, or a reader will see a commit that does not exist.",
                  file=sys.stderr)
        new_event["ref"] = a.ref
    if observe:
        new_event["observe"] = observe
    if probe:
        new_event["probe"] = probe
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
    # …and PROPAGATE to the ancestors this transition moved. An aggregate's state
    # is not folded from its own events, it BUBBLES from its children, so a child's
    # append can change every ancestor's state — and re-rendering only the appended
    # item left those blocks stale until the next `project`. That mattered little
    # while nothing read them; I8 now compares each block against the fold, so a
    # stale ancestor would fire the gate on an item nobody touched, every cycle,
    # and the pressure would be to weaken I8 rather than to fix the write. Fix the
    # write: the propagation happens here, where the state actually changes.
    for anc_id in _propagation_targets(items, a.id):
        anc = items.get(anc_id)
        # Never (re)CREATE a file: if an ancestor has been relocated or removed by
        # a concurrent agent since we loaded, writing its old path would resurrect
        # a duplicate id (I4). Skipping is correct — `project` re-renders everything.
        if anc is None or not os.path.exists(anc.path):
            continue
        with open(anc.path, "w", encoding="utf-8") as f:
            f.write(render_item(anc, derived_block(graphs, items, states,
                                                   children, anc_id)))
    new_state = states.get(a.id)
    print(f"append: {a.id} {state} --({a.event}/{a.agent})--> {new_state}")
    _maybe_relocate(a.project, a.id, item, new_state, graphs)


def _propagation_targets(items, iid):
    """Every TRANSITIVE parent of `iid` — the items whose derived state can move
    because this one did. Walks ALL parents, not just the first: `compute_ancestors`
    deliberately reports one chain for display, but a child with two parents bubbles
    into both, and a rendering left stale in the second is exactly the drift I8
    reports. Cycle-guarded (I3 is what rejects a cycle; this must not hang on one)."""
    out, seen, frontier = [], {iid}, [iid]
    while frontier:
        nxt = []
        for cur in frontier:
            it = items.get(cur)
            if not it:
                continue
            for p in it.parents:
                if p in seen:
                    continue
                seen.add(p)
                out.append(p)
                nxt.append(p)
        frontier = nxt
    return out


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
# which counted frozen-ledger rows). The "last retro" boundary is the newest event
# in the project's own append-only cadence log, work/<project>/items/retro-log.md,
# written by retro-mark and by parts-check's drain (see the block below it for why
# it is there and not in the shared parent repo, and why not a git tag).
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
# --- THE CADENCE RECORD LIVES IN THE PROJECT'S OWN EVENT SUBSTRATE ----------
#
# `work/<project>/items/retro-log.md` — an append-only log of one event per retro
# close / per cheap incident-drain, carrying the instant AND the constraint as of
# that close. Written by `retro-mark` and by `parts-check`'s drain; read by
# `compute_retro_debt` and `cmd_parts_check`. Nothing else writes it.
#
# WHY IT MOVED HERE (v146 retro ruling on
# OI-PARTS-CHECK-MARKER-DIRTIES-THE-TREE-AND-DEFERS-FOLD-FORWARD, 5 sightings):
# it used to be a TRACKED one-line file in the shared parent repo,
# `process/dora/retro-marker/<project>.txt`. So a documented READ (`parts-check`,
# which STAGE F runs after every close and as the incident-debt drain) left the
# parent worktree DIRTY, and `.claude/scripts/worktree update` exits 3 DEFERRED on
# an unclean worktree — i.e. every loop cycle silently skipped the fold-forward
# that CLAUDE.md §0a Rule 4 requires to run CONTINUOUSLY. Unbounded, once per
# invocation, and WORSENING with throughput.
#
# WHY *THIS* STORE, AND WHY NOT THE OBVIOUS CHEAPER ONE. The tempting fix is to
# derive last-retro from the newest `process-v<NN>` GIT TAG: no new state, dirties
# nothing, and the retro already writes it. It is wrong for one decisive reason —
# THE TAG NAMESPACE IS GLOBAL AND RETRO DEBT IS PER-PROJECT. ROC's next tag would
# silently become OagEventSource's "last retro" and this project's incident debt
# would read as drained by another project's work
# (process/principle-failures/2026-08-20-global-registry-per-project-reality.md).
# The marker FILE and the git TAG are the same defect in different clothes: a
# GLOBAL store asked to hold PER-PROJECT state. `work/<project>/items/` is the
# only store that cannot make one project's record stand in for another's, which
# is v82's single-source-of-truth rule doing real work rather than being cited.
#
# TWO PROPERTIES THAT MAKE IT SAFE, both pinned by tests:
#  * it lives IN `items/` but NOT in `items/{active,done}/`, so `load_all_items`
#    never sees it: no state, no queue, no GLT share — therefore it can never
#    perturb the constraint that `parts-check` reads out of `views/stats.json`.
#    (Precedent: `items/blocks.csv` is a non-item file in the same directory.)
#  * the parent repo gitignores `/work/*/`, so writing here is INVISIBLE to the
#    fold-forward gate. The record is still written — the tree is clean because
#    the write went to the repo that owns the fact, not because nothing happened.
#
# THE OLD PARENT-REPO FILES ARE FROZEN, NOT DELETED. They are never written again
# but are still READ as a fallback (`_retro_verdict`). That is deliberate and it
# is the whole cutover strategy: `git rm --cached` + a `.gitignore` rule would
# fold forward into every OTHER instance worktree, DELETE their working marker,
# and force ROC / AdixOut / OperationalFlowSimulator into a spurious full retro
# mid-cycle with nothing in their tree explaining why (delta-075 R7). With the
# fallback, no other project moves at all until its own next retro-mark.
RETRO_LOG_NAME = "retro-log.md"
RETRO_CLOSED = "retro_closed"
RETRO_DRAINED = "debt_drained"


def _retro_log_path(project):
    return os.path.join(items_dir(project), RETRO_LOG_NAME)


def _legacy_retro_marker_path(project):
    """FROZEN as of the v146 ruling — read only, never written."""
    return os.path.join(ROOT, "process", "dora", "retro-marker", f"{project}.txt")


def _legacy_constraint_marker_path(project):
    """FROZEN as of the v146 ruling — read only, never written."""
    return os.path.join(ROOT, "process", "dora", "retro-marker",
                        f"{project}.constraint.txt")


def _read_retro_log(project):
    """The project's retro events, oldest first. [] if there is no log."""
    p = _retro_log_path(project)
    if not os.path.exists(p):
        return []
    try:
        with open(p, encoding="utf-8") as f:
            fm_text, _body = _split_frontmatter(f.read())
    except OSError:
        return []
    evs = parse_frontmatter(fm_text).get("events") or []
    return [e for e in evs if isinstance(e, dict) and e.get("ts")]


_RETRO_LOG_BODY = """
## What this is

The **authoritative, append-only record of this project's retro cadence** — one
event per retro close (`retro_closed`) or per cheap incident-debt drain
(`debt_drained`), each carrying the constraint as of that close. `retro-debt`
measures debt SINCE the newest event here; `parts-check` compares the current
constraint against the newest one recorded here.

It lives in `items/` but **not** in `items/active/` or `items/done/`, so it is not
a work item and no fold, queue, metric or derived view sees it.

Written only by `make retro-mark` and `make parts-check`. Do not hand-edit.
`process/dora/retro-marker/*.txt` in the parent repo is the FROZEN pre-cutover
record — read as a fallback, never written again. See
`OI-PARTS-CHECK-MARKER-DIRTIES-THE-TREE-AND-DEFERS-FOLD-FORWARD`.
"""


def _append_retro_log(project, event):
    """Append ONE event. The only writer of the cadence record."""
    events = _read_retro_log(project) + [event]
    lines = ["---", "id: RETRO-LOG", f"project: {_q(project)}",
             "# append-only cadence record — NOT a work item (see the body)",
             "events:"]
    for ev in events:
        parts = [f"ts: {_q(ev.get('ts'))}", f"event: {_q(ev.get('event'))}",
                 f"agent: {_q(ev.get('agent'))}"]
        for k in ("constraint_owner", "constraint_state"):
            if ev.get(k) not in (None, ""):
                parts.append(f"{k}: {_q(ev.get(k))}")
        lines.append("  - {" + ", ".join(parts) + "}")
    lines += ["---", _RETRO_LOG_BODY]
    p = _retro_log_path(project)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def _rel(path):
    try:
        return os.path.relpath(path, ROOT)
    except ValueError:
        return path


def _retro_verdict(project):
    """(kind, ts, source) — `("known", dt, where)` or `("unknown", None, why)`.

    A VERDICT, not a sentinel (delta-074 R10). The old reader returned epoch for
    "absent", so `retro-debt` PRINTED `since last retro 1970-01-01` as if it were
    a fact — one channel carrying three different meanings (never retro'd / record
    lost / fresh tree). While the record was tracked, absence was rare; now that it
    is per-project, absence is the ROUTINE state of a new project, so the
    overloaded channel would be load-bearing on the happy path. The exit-2
    direction is UNCHANGED — this is legibility, never a softening.
    """
    evs = _read_retro_log(project)
    for ev in reversed(evs):
        ts = parse_ts(str(ev.get("ts")))
        if ts:
            return ("known", ts, _rel(_retro_log_path(project)))
    legacy = _legacy_retro_marker_path(project)
    if os.path.exists(legacy):
        try:
            with open(legacy, encoding="utf-8") as f:
                ts = parse_ts(f.readline().strip())
            if ts:
                return ("known", ts, f"{_rel(legacy)} (frozen pre-cutover record)")
        except OSError:
            pass
    return ("unknown", None,
            f"no retro record at {_rel(_retro_log_path(project))}; no frozen "
            f"marker at {_rel(legacy)} — all-time debt shown, a FULL retro is owed")


def _read_retro_marker(project):
    """The last-retro datetime (UTC), or epoch (= all-time debt) if UNKNOWN.

    FAIL-CLOSED and that is the property that makes a per-project store safe: an
    absent record cannot silently SKIP a retro, it forces one (every close and
    resolve in project history counts as debt), and the resulting retro's
    `retro-mark` re-seeds the log — so the system self-heals after exactly one
    retro. Callers wanting to SHOW the boundary must use `_retro_verdict`.
    """
    _kind, ts, _why = _retro_verdict(project)
    return ts or datetime(1970, 1, 1, tzinfo=timezone.utc)


def _retro_since_phrase(project):
    kind, ts, why = _retro_verdict(project)
    if kind == "known":
        return ts.strftime("%Y-%m-%dT%H:%M:%SZ")
    return f"UNKNOWN ({why})"


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
    since = _retro_since_phrase(a.project)
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
    ts = (a.now or now_iso()).strip()
    con = _read_constraint(a.project)
    ev = {"ts": ts, "event": RETRO_CLOSED, "agent": "orchestrator"}
    if con is not None:
        ev["constraint_owner"] = con["owner"]
        ev["constraint_state"] = con["state"]
    _append_retro_log(a.project, ev)
    print(f"retro-mark: {a.project} last-retro set to {ts}")
    if con is not None:
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


def _read_constraint_marker(project):
    """The constraint as of the last close — `(owner, state)` or None.

    Rides the cadence log event (so ONE store holds both halves of the fact and
    they cannot drift), scanning newest-first for an event that CARRIES one: a
    close whose constraint was unreadable must not ERASE the last known
    constraint, or the next parts-check would escalate on a bookkeeping gap
    rather than on a real shift. Falls back to the FROZEN parent-repo
    `<project>.constraint.txt` so no project loses stability at the cutover.
    """
    for ev in reversed(_read_retro_log(project)):
        owner, state = ev.get("constraint_owner"), ev.get("constraint_state")
        if owner and state:
            return (str(owner), str(state))
    p = _legacy_constraint_marker_path(project)
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

    # Stable + only incident debt => the cheap path is legitimate. Drain it — by
    # APPENDING to the project's own cadence log, never by writing a tracked file
    # in the shared parent repo (that write is what deferred the fold-forward).
    _append_retro_log(a.project, {
        "ts": stamp, "event": RETRO_DRAINED, "agent": "orchestrator",
        "constraint_owner": cur["owner"], "constraint_state": cur["state"]})
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
#      AND its liveness predicate RE-EVALUATED. (This comment used to say "exactly
#      as `blocked` is re-checked each cycle" — THAT MECHANISM DOES NOT EXIST: no
#      limb of this gate looks at `blocked` at all, and 7 flow items were sitting
#      there on 2026-08-20, the oldest for 16.46 days. Registered as
#      OI-LOOP-GATE-NEVER-RECHECKS-A-BLOCK rather than left as a claim about a
#      control nobody built — §17i's mirror image.) observed -> BLOCK (a tester
#      dispatch is now actionable);
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
#
# DEPLOY-PENDING STATES ARE IN SCOPE TOO (v152, ROC 2026-08-26). This is NOT the
# "deploying is uncovered" claim — check 11 already covers `deploying`, at
# STALLED_WORK_HOURS' 24h. The measured gap is the WINDOW BETWEEN THE TWO
# THRESHOLDS: check 1 closes it at `--stale-hours` (4h) for validating states, so an
# item whose work is PROVABLY DONE (a ref-bearing `built_green`) parked in
# `deploying` was named by NOTHING for 4h-24h. `UC-ROC-102` sat there 12.0h — 260x
# cicd's own `deploying` median of 166s across 52 items — and this morning's gate
# BLOCKED on `UC-ROC-104` at 11.5h in `dev-validating` while saying nothing about it.
#
# The asymmetry had no justification: check 1's entire rationale is "the work is DONE
# and only a dispatch is missing", and under a PIPELINE deploy (push -> CI, which is
# ROC's only deploy path) that is exactly what `deploying` means — the deploy landed,
# and only the `deployed` EVENT is missing. No agent fires it there: the loop-run
# contract makes the ORCHESTRATOR fire the CI-confirmed `deployed`, so when it does
# not, the item cannot reach a tester at all. That is a RECURRENCE, not a novelty —
# `process/principle-failures/2026-07-22-uc-adix-015-missing-cicd-deployed-event-blocks-tester.md`
# recorded the identical mechanism on AdixOut and promised an improvement slice that
# was never built. The evidence quality is identical to the validating case (a
# structured ref proving finished work), so the threshold now is too.
DEPLOY_PENDING_STATES = {"deploying", "prod-deploying"}
STALL_STATES = VALIDATING_STATES | DEPLOY_PENDING_STATES
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

# v155 — the TOTAL-AGE CEILING past which an in-date `defer_until:` stops exempting a
# backlog item. Set well above DEFAULT_MAX_BACKLOG_AGE_DAYS on purpose: a defer is a
# legitimate instrument and must stay cheap for a genuine wait. This is only the point
# at which RE-DATING is no longer one of the available answers, because the measured
# failure was serial re-dating (36 items, twice in 9 days, none reaching `done`), not
# the first defer. 30d ~= four re-dates at the 7d threshold.
DEFAULT_MAX_DEFER_TOTAL_DAYS = 30.0
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


def _git(repo, *args, _stdin=None):
    """Run git in `repo`; return (rc, stdout). rc None when git/repo unusable.

    `_stdin` feeds a batched command (`cat-file --batch-check`). Its output is NOT
    stripped when stdin is used: the batch protocol is positional, one answer line
    per input line, so stripping would silently shift the mapping."""
    try:
        r = subprocess.run(["git", "-C", repo, *args], capture_output=True,
                           text=True, check=False, input=_stdin)
        out = r.stdout or ""
        return r.returncode, (out.rstrip("\n") if _stdin is not None else out.strip())
    except Exception:
        return None, ""


# ---------------------------------------------------------------------------
# A `ref:` IS REPO-SCOPED, AND NOTHING RECORDED WHICH REPO (DEFECT-OAG-128)
#
# This system has TWO repos by design (§v50): the agent system (this parent repo:
# .claude/, process/, Makefile, CLAUDE.md) and each project's own nested repo at
# work/<project>/, which the parent gitignores. A `ref:` on an item is a sha in
# ONE of them, and the item does not reliably say which.
#
# The bug this replaces: `_ref_on_trunk` ran `merge-base --is-ancestor` ALWAYS in
# `git -C work/<project>`. A parent-lane ref does not exist there at all, so the
# check did not merely answer WRONG — the ref failed to RESOLVE, which is the
# `git cat-file -t fb080d9 => fatal: Not a valid object name` signature by which
# DEFECT-OAG-072's destruction was diagnosed. Measured on the real registry
# (2026-08-20, 478 items / 202 distinct refs): SEVEN refs resolve only in the
# parent repo, and every one read as unresolvable. Reproduced before the fix:
#   _ref_on_trunk('OagEventSource', '8dae2cc')  -> None   (real, on parent main)
#   _ref_on_trunk('OagEventSource', 'deadbee')  -> None   (fabricated, nowhere)
# LITERALLY EQUAL. So the failure was §17i in BOTH directions at once: a
# wrong-place lookup rendered as a routine UNKNOWN, and the one alarm that means
# real data loss rendered as that same routine UNKNOWN — i.e. MUTED. Narrowing the
# false positives without muting the true one is the whole job here.
#
# WHY `lane:` IS NOT THE ROUTING KEY, though the defect report proposed it.
# Two measurements killed that design:
#   1. `lane:` is ABSENT on 382 of 478 items (79.9%) — not on 4 of 6 as reported.
#      Routing on a field four fifths of the registry lacks just moves the wrong
#      answer around.
#   2. `lane:` is SINGLE-VALUED and real items span BOTH repos. DEFECT-OAG-091 was
#      cited as "an outright misdeclaration" (declared project-repo, ref on the
#      parent). It is not. Its own event log reads "Two lanes, two repos, never
#      mixed": 898880d4 is a project commit AND 2c6a7d58 is a parent commit. The
#      field cannot express that, so the declaration is INCOMPLETE, not false.
# So resolution SEARCHES BOTH REPOS, always, and `lane:` is demoted from a routing
# key to a CROSS-CHECKED ASSERTION. That direction cannot invent a false "missing":
# a ref present in either repo is found. `lane:` is still load-bearing for
# `make dispatch-check` (DEFECT-OAG-076) — this changes only ref resolution.
#
# THE FOUR VERDICTS, and why three is not enough (§17i). PASS/FAIL/COULD-NOT-LOOK
# maps onto ancestry, but "the object is not in ANY repo" is a fourth thing that
# must not hide inside COULD-NOT-LOOK — it is the only verdict that means work may
# have been destroyed, and it has to stay loud to be worth anything.
#   REF_ON_TRUNK         the object exists and is an ancestor of that repo's origin
#                        trunk => pushed.
#   REF_NOT_ON_TRUNK     the object EXISTS in a repo we read, but is not on its
#                        origin trunk => committed and unpushed. NOT lost.
#   REF_ABSENT           every lane repo was READABLE and none has the object.
#                        THE DEFECT-OAG-072 ALARM. Loud, blocking.
#   REF_CANNOT_DETERMINE we could not look: a lane repo was unreadable, or the
#                        object exists but no origin trunk resolves. NEVER a pass,
#                        and never the destroyed-work alarm either.
# The asymmetry that makes REF_NOT_ON_TRUNK safe to report: a remote-tracking ref
# can be STALE (this worktree's parent origin/main is weeks behind, because the
# owner owns the parent push), and staleness can only ever produce a false
# NOT-ON-TRUNK — never a false ON-TRUNK, and never a false ABSENT.
# §17g GENERALISATION SWEEP — every site that resolves a ref/sha against a repo.
# The shape asked, per §17g: "where else is an object looked up in ONE repo when the
# system has two?" Each entry is FIXED or NOT-APPLICABLE-BECAUSE. "I checked" is not
# a ledger, so the reasons are recorded, including the one that surprised me.
#
#  1. work-items.py `_ref_on_trunk`                          FIXED — the reported bug.
#  2. work-items.py loop-gate check 1 push-state rendering   FIXED — one string served
#     both a wrong-repo lookup and a destroyed commit; now four distinct verdicts.
#  3. work-items.py — NO registry-wide existence check existed at all   FIXED (check 12).
#     Not a repo-blindness instance: an ABSENCE. Check 1 only sees items stalled in
#     validation, so a destroyed commit on a DONE item had no observer anywhere —
#     which is exactly how DEFECT-OAG-072 was lost.
#  4. work-items.py `cmd_append` (the WRITE path)            FIXED — validated where
#     the data enters; non-sha refused, absent-sha warned-but-recorded.
#  5. work-items.py `_parse_scalar` / `_parse_inline_map`     FIXED — a ref is never
#     number-coerced (IMP-029, prescribed 19 days earlier and unswept); plus the
#     zero-padded repair for the refs already damaged on disk.
#  6. .claude/commands/loop-run.md                            FIXED — it INSTRUCTED
#     every reader to run the lookup in the project repo. A doc that teaches the
#     defect is a defect.
#  7. process/process-current.md §F8a                         FIXED — same, and this
#     is the authoritative rule the doc above derives from.
#  8. .claude/tools/impacted-tests.js `resolveDiffRoot`        NOT APPLICABLE — already
#     repo-aware, and this is the sweep's real finding: EXP-104 fixed THIS EXACT SHAPE
#     ("a SHA that only exists in the project's nested repo was `fatal: bad revision`
#     in the parent, and vice versa"), noted it had "recurred 5x before this fix",
#     converged on the same design (ask each candidate repo who owns the sha, raise
#     an ACTIONABLE error when neither does) — and NOBODY SWEPT IT TO work-items.py.
#     A fix in one tool is not a sweep (§17g). That is the whole reason this defect
#     existed, and it is the second time in this file's history (see 5).
#  9. .claude/tools/worktree-guard.js `assessRepo`            NOT APPLICABLE — it asks
#     EVERY surviving witness repo whether a sha survives, and takes the shas from
#     `rev-list` in the repo under assessment. Multi-repo by construction.
# 10. .claude/tools/isolated-commit.js                        NOT APPLICABLE — the repo
#     is a required parameter; every lookup is `git -C <that repo>`.
# 11. .claude/scripts/worktree (`merge-base --is-ancestor "$br" main`)  NOT APPLICABLE —
#     BRANCH names in the parent repo, not item refs. Parent-scoped by definition.
# 12. .claude/tools/make-refs-tracked.js                      NOT APPLICABLE — resolves
#     FILE paths (`ls-files`/`check-ignore`), never a commit object, and takes its
#     repo as `--repo-root`.
# 13. .claude/tools/linear-project.py + the board projections  NOT APPLICABLE — MEASURED,
#     not assumed: they run no git at all and never consume `ref:`. The boards project
#     item state, so a wrong push reading cannot reach them.
# 14. work/<project>/Makefile `assert-build-identity`         NOT APPLICABLE, AND MUST
#     STAY THAT WAY — `git cat-file -e $(BUILD_SHA)` deliberately resolves ONLY in the
#     project repo. Same shape, OPPOSITE correct answer, because the QUESTION differs:
#     check 12 asks "does this object exist ANYWHERE" (destroyed-work), while this asks
#     "does this object belong to THIS repo" (provenance). DEFECT-OAG-036 was caused by
#     a parent-repo sha being accepted as a project build identity, so widening this to
#     search both repos would REGRESS it. Recorded because the next person running this
#     sweep will see the shape and be tempted.
#
# UNMASKING CHECK (§17g's second half): does this fix open a latent path? Yes, one, and
# it is a benign direction. check 12 can now BLOCK the loop, which nothing did before —
# so a false positive here halts delivery. That is why absence is concluded ONLY from a
# fully-readable, protocol-validated search, why a non-sha ref is an advisory, and why
# the zero-padding repair exists: each is a false-positive source found by building the
# alarm, and the first two were found by mutation rather than by reasoning.
REF_ON_TRUNK = "on_trunk"
REF_NOT_ON_TRUNK = "not_on_trunk"
REF_ABSENT = "absent"
REF_CANNOT_DETERMINE = "cannot_determine"

LANE_PROJECT = "project-repo"
LANE_PARENT = "parent-repo"
# Longest abbreviation a zero-padding repair will try. Git refuses an ambiguous
# abbreviation rather than guessing, so the only cost of a wide range is a few
# cheap rev-parse calls, and only ever for an all-digit ref (11 of 202 measured).
SHA_PAD_MAX_WIDTH = 12


def _lane_repos(project):
    """[(lane, repo_path)] — EVERY repo a `ref:` could name, project repo first.

    Ordering is deliberate: the overwhelming majority of refs are project-lane
    (194 of 202 measured), so the first probe usually hits."""
    return [(LANE_PROJECT, _project_repo(project)), (LANE_PARENT, ROOT)]


def _repo_readable(repo):
    """True iff `repo` is a git repo we can query. `.git` is a FILE in a worktree
    and a DIRECTORY in a normal clone, so exists() is the right test for both."""
    return bool(repo) and os.path.exists(os.path.join(repo, ".git"))


def _ref_candidates(ref):
    """[ref, *zero-padded retries] — the recorded ref plus the shas it would be if
    a LEADING ZERO had been eaten by int-coercion.

    Found while building this check, and it matters because without it the new
    ABSENT alarm FALSE-FIRES on its first real run. `_parse_scalar` int-coerces any
    all-digit frontmatter value, so the sha `0605428` was read as the int 605428 and
    then RE-RENDERED into the item file without its leading zero. `UC-XA5` therefore
    records `ref: 605428`, which resolves in NEITHER repo — the exact ABSENT
    signature — while the real commit `06054289ae9d50bf194b98643d920939b5d7531b`
    ("test(aerobus): pin out-of-org/unlisted principal DENIED...") sits on
    origin/main. The data loss is already on disk in items written before the
    _parse_scalar fix below, so recovery has to happen at READ time too.
    Only all-digit refs can have suffered it; a ref with any hex letter was never
    coerced. Ambiguity is not a hazard: git REFUSES an ambiguous abbreviation
    rather than guessing, so a padded candidate either resolves uniquely or not."""
    ref = str(ref or "").strip()
    if not ref:
        return []
    out = [ref]
    if ref.isdigit():
        for w in range(len(ref) + 1, SHA_PAD_MAX_WIDTH + 1):
            out.append(ref.rjust(w, "0"))
    return out


def _trunk_candidates(repo):
    """Origin trunk refs to test ancestry against, in order.

    ONLY `origin/*` refs: the question is "is it PUSHED", and a local branch
    answers a different one. The parent repo adds `origin/<its current branch>`
    because a parent-lane commit's push destination in a per-project worktree is
    `origin/instance/<project>`, not `origin/main` — without it every parent-lane
    ref would read NOT-ON-TRUNK for the wrong reason."""
    cands = list(TRUNK_CANDIDATES)
    rc, branch = _git(repo, "rev-parse", "--abbrev-ref", "HEAD")
    if rc == 0 and branch and branch != "HEAD":
        cand = "origin/" + branch
        if cand not in cands:
            cands.append(cand)
    return cands


def resolve_ref(project, ref):
    """Where a `ref:` lives and whether it is pushed. THE seam the gate calls.

    Returns a dict, never a bare tri-state, because the caller must be able to tell
    the four outcomes apart:
      verdict    REF_ON_TRUNK | REF_NOT_ON_TRUNK | REF_ABSENT | REF_CANNOT_DETERMINE
      lane       the lane whose repo the object was found in, or None
      trunk      the origin trunk it is an ancestor of, or None
      resolved   the sha actually used (may be a zero-padded repair of `ref`)
      padded     True iff a leading zero had to be rebuilt to resolve it
      searched   [lane, ...] repos we could read
      unreadable [lane, ...] repos we could NOT read (why ABSENT must not be
                 concluded from a partial search)
    """
    out = {"ref": None if ref is None else str(ref), "verdict": REF_CANNOT_DETERMINE,
           "lane": None, "trunk": None, "resolved": None, "padded": False,
           "searched": [], "unreadable": [], "reason": None}
    cands = _ref_candidates(ref)
    if not cands:
        out["reason"] = "no ref recorded"
        return out
    hits = []                                  # [(lane, repo, sha, padded)]
    for lane, repo in _lane_repos(project):
        if not _repo_readable(repo):
            out["unreadable"].append(lane)
            continue
        out["searched"].append(lane)
        for cand in cands:
            rc, _ = _git(repo, "rev-parse", "--verify", "--quiet",
                         "%s^{commit}" % cand)
            if rc is None:                     # git itself unusable => not a search
                out["unreadable"].append(lane)
                if lane in out["searched"]:
                    out["searched"].remove(lane)
                break
            if rc == 0:
                hits.append((lane, repo, cand, cand != cands[0]))
                break
    if not hits:
        if out["unreadable"] or not out["searched"]:
            out["reason"] = ("could not read the %s repo(s), so the object's absence "
                             "was never established"
                             % ", ".join(out["unreadable"] or ["(none searched)"]))
            return out                          # COULD-NOT-LOOK, never the alarm
        out["verdict"] = REF_ABSENT
        out["reason"] = ("resolves in NONE of the %d readable repo(s): %s"
                         % (len(out["searched"]), ", ".join(out["searched"])))
        return out
    # Found. Ancestry is asked in EVERY repo that has it before concluding
    # not-on-trunk, so a repo with no origin trunk cannot mask a repo that has one.
    best = None
    for lane, repo, sha, padded in hits:
        for trunk in _trunk_candidates(repo):
            rc, _ = _git(repo, "rev-parse", "--verify", "--quiet",
                         "%s^{commit}" % trunk)
            if rc != 0:
                continue
            rc, _ = _git(repo, "merge-base", "--is-ancestor", sha, trunk)
            if rc == 0:
                out.update(verdict=REF_ON_TRUNK, lane=lane, trunk=trunk,
                           resolved=sha, padded=padded,
                           reason="ancestor of %s in the %s repo" % (trunk, lane))
                return out
            if rc == 1 and best is None:
                best = (REF_NOT_ON_TRUNK, lane, sha, padded,
                        "the object EXISTS in the %s repo but is not an ancestor of "
                        "any origin trunk there — committed, not pushed (and NOT "
                        "lost)" % lane)
    if best is not None:
        v, lane, sha, padded, why = best
        out.update(verdict=v, lane=lane, resolved=sha, padded=padded, reason=why)
        return out
    lane, _repo, sha, padded = hits[0]
    out.update(lane=lane, resolved=sha, padded=padded,
               reason=("the object exists in the %s repo but no origin trunk "
                       "resolves there, so push state could not be established"
                       % lane))
    return out                                  # COULD-NOT-LOOK


def _ref_on_trunk(project, ref):
    """BACK-COMPAT tri-state over resolve_ref: True on trunk / False not on trunk /
    None could-not-establish. Kept because callers and tests hold this shape.

    REF_ABSENT maps to **None, never False**. False means "committed but not pushed
    yet", which is ordinary and unalarming; a destroyed object must never be able to
    hide inside it. Anything that needs to SEE the absent case must call resolve_ref
    — which is why the gate does."""
    v = resolve_ref(project, ref)["verdict"]
    return True if v == REF_ON_TRUNK else False if v == REF_NOT_ON_TRUNK else None


def check_declared_lane(project, declared, refs):
    """Cross-check an item's `lane:` against where its refs ACTUALLY resolve.

    `lane:` is CHECKED here, never trusted for routing (see the block above). The
    verdicts, and why each is its own thing rather than pass/fail:
      consistent      the declared lane is among the lanes the refs resolve in.
      spans-both      the refs resolve in BOTH repos. NOT a violation: a
                      single-valued field cannot express a two-lane item, so the
                      declaration is INCOMPLETE, not false. DEFECT-OAG-091's real
                      shape — it was reported as "an outright misdeclaration" and
                      is not one; flagging it would manufacture a violation out of
                      a correct item.
      contradicted    every ref resolves, and NONE of them in the declared lane.
                      The genuine misdeclaration class.
      undeclared      no `lane:`. 382 of 478 items (79.9%, measured) — so this is
                      the registry's normal state and cannot be a violation. It
                      carries the lane the refs imply, which is what makes a
                      backfill mechanical rather than a judgement call.
      cannot-determine  no ref resolved anywhere readable, so the declaration was
                      never tested against anything (§17i).
    """
    declared = (str(declared).strip() if declared not in (None, "") else None)
    lanes, absent, undet = [], [], []
    for ref in (refs or []):
        r = resolve_ref(project, ref)
        if r["lane"] and r["lane"] not in lanes:
            lanes.append(r["lane"])
        elif r["verdict"] == REF_ABSENT:
            absent.append(r["ref"])
        elif not r["lane"]:
            undet.append(r["ref"])
    out = {"declared": declared, "resolved_lanes": lanes,
           "absent_refs": absent, "undetermined_refs": undet}
    if not lanes:
        out["verdict"] = "cannot-determine"
    elif declared is None:
        out["verdict"] = "undeclared"
    elif len(lanes) > 1:
        out["verdict"] = "spans-both"
    elif declared in lanes:
        out["verdict"] = "consistent"
    else:
        out["verdict"] = "contradicted"
    return out


# ---------------------------------------------------------------------------
# loop-gate check 12 — EVERY recorded `ref:` must resolve in SOME repo we can read
# (DEFECT-OAG-128, AC-128.2 — the general close-time push gate AC-116.2 asked for)
#
# Check 1 only ever looks at items that are STALLED IN VALIDATION, which is a tiny
# and transient slice. A destroyed commit on a DONE item is exactly the thing
# nobody re-reads: DEFECT-OAG-072 was delivered complete, closed, and annihilated,
# and the loss was found by a human happening to run `git cat-file`. So the sweep
# has to be over the WHOLE registry, every cycle, or the alarm has no observer.
#
# Only EXISTENCE is asked here, never ancestry — "is this object still anywhere on
# disk" is the destroyed-work question, and unpushed-ness is check 1's business.
# That is also what makes it affordable at 202 refs: existence is BATCHED into ONE
# `cat-file --batch-check` per repo (measured 66 ms for the real registry, 2 git
# calls total), where per-ref rev-parse would be ~400 subprocess spawns before
# every pull.
#
# THE FAIL-SAFE DIRECTION, which is the whole reason this check is careful rather
# than loud: if a lane repo cannot be read, absence was NEVER ESTABLISHED, so the
# result is COULD-NOT-LOOK and not the alarm. Screaming "destroyed work" off a
# partial search is precisely how a real alarm gets trained out of people, and
# being ignored is how DEFECT-OAG-072 was lost in the first place.
def _batch_ref_existence(project, refs):
    """({ref: lane-or-None}, [unreadable lanes]) for many refs in ~2 git calls.

    `cat-file --batch-check` answers one line per input line, in order, so the
    mapping back is positional. A padded repair candidate (see _ref_candidates) is
    submitted alongside its original and credited to it."""
    pairs = []                                   # [(ref, candidate)]
    for ref in refs:
        for cand in _ref_candidates(ref):
            pairs.append((str(ref), cand))
    found = {str(r): None for r in refs}
    unreadable = []
    if not pairs:
        return found, unreadable
    for lane, repo in _lane_repos(project):
        if not _repo_readable(repo):
            unreadable.append(lane)
            continue
        rc, out = _git(repo, "cat-file", "--batch-check",
                       _stdin="".join(c + "\n" for _r, c in pairs))
        if rc is None:
            unreadable.append(lane)
            continue
        lines = out.split("\n")
        # THE ANSWER IS VALIDATED, NOT COUNTED. `--batch-check` is POSITIONAL, one
        # answer per input line, and every answer is either `<oid> <type> <size>` or
        # `<input> missing`. A TRUNCATED or otherwise malformed reply therefore
        # shifts the mapping and refs begin reading ABSENT because a neighbour's
        # line was consumed — a FALSE destroyed-work alarm off a plumbing fault.
        # A length check alone does NOT catch it: with one input, losing the only
        # line leaves [""], whose length still matches, and the blank parses as
        # not-a-commit. This is the v143 truncation class (worktree-guard read NOT
        # ESTABLISHED once the repo's history grew past a 64 KiB pipe buffer —
        # nothing regressed, the world got bigger), so the protocol is checked
        # shape-wise and any violation is COULD-NOT-LOOK.
        def _ok(line):
            parts = line.split()
            return (len(parts) == 3 and parts[1] in ("commit", "tree", "blob", "tag")
                    ) or (len(parts) == 2 and parts[1] == "missing")

        if len(lines) != len(pairs) or not all(_ok(l) for l in lines):
            unreadable.append(lane)
            continue
        for (ref, _cand), line in zip(pairs, lines):
            parts = line.split()
            if len(parts) == 3 and parts[1] == "commit" and found.get(ref) is None:
                found[ref] = lane
    return found, unreadable


# A `ref:` the CONTRACT says is a sha (process/machinery/CONTRACT.md: `ref: <sha>`).
# That declaration is the AUTHORITY for treating a non-hex ref as a MALFORMED REF
# rather than as a destroyed commit (§17h — an exclusion needs an authority, and a
# counter may not call its own population benign). Found on the check's first real
# run: `UC-ML1` records `ref: delta-052` on a solution-architect `amended` event —
# an architecture-delta DOCUMENT id in a field the contract reserves for a sha. It
# is a real contract violation and it is reported as one; it is NOT destroyed work,
# and letting it fire the destroyed-work alarm would have made the alarm's first
# ever firing a false one.
# Git's own minimum abbreviation length. An all-digit ref SHORTER than this cannot
# be a usable sha at all, so it is malformed rather than repairable.
GIT_MIN_ABBREV = 4


def _is_sha_shaped(ref):
    """Could `ref` be a commit sha, i.e. is it worth asking git about?

    Two admitted shapes, and the second is not redundant. An ALL-DIGIT ref of any
    length >= 4 is admitted even below the 6-char hex floor, because int-coercion
    SHORTENS a sha by however many leading zeros it ate — `0605428` became `605428`,
    and a sha with two leading zeros would fall further. Applying the hex floor to
    it would classify a repairable sha as malformed and silently exclude it from
    the existence check, which is the hiding place §17h warns about. Below git's own
    4-char abbreviation floor there is nothing to ask, so that IS malformed."""
    r = str(ref).strip()
    if re.fullmatch(r"[0-9a-fA-F]{6,40}", r):
        return True
    return r.isdigit() and GIT_MIN_ABBREV <= len(r) <= 40


def compute_ref_provenance(project, items=None):
    """Findings for refs that resolve in NO readable repo, and for a declared
    `lane:` every one of its refs contradicts."""
    common = {"check": "ref-provenance"}
    try:
        if items is None:
            items, _dup = load_all_items(project)
    except Exception as exc:                                     # noqa: BLE001
        return [dict(common, severity="unknown", ids=[], message=(
            f"[ref-provenance] COULD NOT LOOK — the item registry would not load "
            f"({type(exc).__name__}: {str(exc)[:160]}). NOTHING was checked about "
            f"whether any recorded commit still exists, which is not the same as "
            f"every commit being fine (§17i)."))]
    by_ref = {}                                  # sha-shaped ref -> [item ids]
    malformed = {}                               # non-sha ref -> [(item, event)]
    declared = {}                                # item id -> (lane, [refs])
    for iid in sorted(items):
        it = items[iid]
        refs = []
        for ev in it.events:
            if not ev.get("ref"):
                continue
            r = str(ev["ref"]).strip()
            if _is_sha_shaped(r):
                refs.append(r)
                by_ref.setdefault(r, []).append(iid)
            else:
                malformed.setdefault(r, []).append((iid, ev.get("event")))
        lane = (it.fm.get("lane") if hasattr(it, "fm") else None)
        if refs:
            declared[iid] = (lane, refs)
    if not by_ref and not malformed:
        return []
    found, unreadable = _batch_ref_existence(project, sorted(by_ref))
    out = []
    if malformed:
        out.append(dict(
            common, severity="advisory",
            ids=sorted({i for w in malformed.values() for i, _e in w}),
            malformed=sorted(malformed),
            message=("ADVISORY (does NOT block the pull) [ref-provenance] "
                     + "; ".join(
                         "`ref: %s` on %s (%s)" % (
                             r, "/".join(sorted({i for i, _e in w})),
                             "/".join(sorted({str(e) for _i, e in w})))
                         for r, w in sorted(malformed.items())[:8])
                     + " — %d recorded ref(s) are NOT sha-shaped, so their existence "
                       "was NEVER CHECKED. The contract declares `ref: <sha>` "
                       "(process/machinery/CONTRACT.md), so this is a contract "
                       "violation rather than a naming preference — and it is "
                       "REPORTED rather than skipped, because a silent exclusion is "
                       "exactly where a genuinely mistyped sha would hide (§17h). It "
                       "is deliberately NOT the destroyed-work alarm: a document id "
                       "was never a commit, and letting it fire that alarm would have "
                       "made the alarm's first ever firing a false one. Remedy: move "
                       "the document reference into `note:` and either record the "
                       "real sha or omit `ref:`." % len(malformed))))
    if unreadable:
        return [dict(common, severity="unknown", ids=[], unreadable=unreadable,
                     message=(
            f"[ref-provenance] COULD NOT LOOK — the {', '.join(unreadable)} repo(s) "
            f"were unreadable, so the {len(by_ref)} recorded ref(s) were NOT checked "
            f"for existence. This run establishes nothing about destroyed work; it "
            f"is not a pass (§17i). Remedy: run from the project root so both "
            f"work/{project}/.git and the agent-system repo are visible."))]
    absent = sorted(r for r, lane in found.items() if lane is None)
    if absent:
        ids = sorted({i for r in absent for i in by_ref[r]})
        detail = "; ".join(f"{r} ({', '.join(by_ref[r])})" for r in absent[:8])
        out.append(dict(common, severity="block", ids=ids, absent=absent, message=(
            f"[ref-provenance] *** {len(absent)} RECORDED COMMIT(S) EXIST IN NEITHER "
            f"REPO *** — {detail}. This is the DEFECT-OAG-072 signature (`git "
            f"cat-file -t fb080d9` => Not a valid object name) for an item that was "
            f"DELIVERED COMPLETE and whose objects were then destroyed with an agent "
            f"worktree. Both repos were READABLE and neither holds these objects. "
            f"RESCUE BEFORE ANYTHING ELSE — `make worktree-guard DIR=--all`, and "
            f"check every nested clone for objects before any worktree is removed; "
            f"do NOT remove anything and do NOT re-run to see if it clears. If a ref "
            f"is merely MISTYPED, correct the item rather than muting the check.")))
    contradicted = []
    for iid, (lane, refs) in sorted(declared.items()):
        if not lane:
            continue                             # 79.9% of the registry; not a fault
        lanes = sorted({found[r] for r in refs if found.get(r)})
        if lanes and str(lane) not in lanes:
            contradicted.append((iid, str(lane), lanes))
    if contradicted:
        out.append(dict(common, severity="advisory",
                        ids=[i for i, _d, _a in contradicted],
                        contradicted=contradicted, message=(
            "ADVISORY (does NOT block the pull) [ref-provenance] "
            + "; ".join(f"{i} declares lane:{d} but every ref resolves in "
                        f"{'/'.join(a)}" for i, d, a in contradicted[:8])
            + ". `lane:` is what `make dispatch-check` routes a dispatch on "
              "(DEFECT-OAG-076), so a wrong one sends an agent to a worktree that "
              "cannot hold its work. NOT blocking, because ref resolution no longer "
              "trusts this field and an item whose refs span BOTH repos is "
              "incomplete rather than wrong (DEFECT-OAG-091's real shape). Remedy: "
              "correct `lane:` on the named items.")))
    return out


def _last_ref_event(item, event_names):
    """The LAST event in `event_names` that carries a structured `ref:` (or None).
    Prose in `note:` is deliberately never consulted."""
    found = None
    for ev in item.events:
        if ev.get("event") in event_names and ev.get("ref"):
            found = ev
    return found


def _current_segment(graphs, item, now):
    """(state, entered_ts) for the item's still-open segment, or (None, None).

    ADJACENT SEGMENTS IN THE SAME STATE ARE MERGED [v145]. A self-loop (`amended`)
    opens a new segment in `walk_states`, which is right for the event log and
    WRONG for the question every caller here is asking: "how long has this item
    been sitting in this state?" Attaching a reversal probe to a 34-day park is an
    `amended`, and without this merge the gate would report that park as 0.0h old —
    i.e. migrating the parks to make their age visible would have HIDDEN it, on the
    single largest contributor to gross lead time. The same applies to the
    stalled-validation dwell: amending a stalled item must not reset its clock.
    Per-state totals in `stats.md` sum every segment and are unaffected."""
    segs = walk_states(graphs, item, now)
    if not segs:
        return None, None
    state, entered, _exited = segs[-1]
    i = len(segs) - 2
    while i >= 0 and segs[i][0] == state:
        entered = segs[i][1]
        i -= 1
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


# ---------------------------------------------------------------------------
# loop-gate check 11 — STALLED WORK: an item CLAIMED (or SCHEDULED) with NO
# RECORDED ACTIVITY (DEFECT-OAG-127)
#
# WHY THIS EXISTS. Check 1 above covers VALIDATION states only, and only BLOCKS
# when the work is provably finished (a structured `ref:`). So every state where
# work is actually DONE — `fixing`, `building`, `reproducing`, `deploying`,
# `reworking` — was a blind spot, and so was an item SCHEDULED into `ready` that
# nobody ever pulled. Measured 2026-08-19 by replaying the REAL item files at
# project-repo commit 9ff713ee through this very gate: SIX wip items idle
# 4.92-7.31d (DEFECT-OAG-046 @7.31d fixing, UC-C11/UC-C11b @5.94d building,
# DEFECT-OAG-116 @5.13d, DEFECT-OAG-120 @4.92d fixing) and THREE `scheduled`
# items idle 5.12-8.11d — and of those nine the entire gate named NONE. The only
# id it named was the one ref-bearing `validating` item.
#
# THE COST WAS A WRONG DECISION, NOT A MISSING ALARM. `wip: 7` reads identically
# whether seven agents are working or seven items are abandoned, so the flow
# decision taken on it was inverted in BOTH directions inside one session: 35
# items were deferred to September for "no capacity" while no work was happening
# at all, and three scheduled items sat 127-199h while `wip` showed four free
# slots. That is the §17h shape at the flow layer — a counter whose unhealthy
# state is indistinguishable from its healthy one — so check 3's WIP line now
# states that it counts OCCUPANCY and prints the activity split beside it, and the
# gate's header carries that split on EVERY run (the wrong decision was taken
# while wip was UNDER its cap, so an over-cap-only signal would not have helped).
#
# WHAT THIS CHECK HONESTLY KNOWS, AND WHAT IT DOES NOT. It knows one fact: NO
# EVENT HAS BEEN RECORDED FOR THIS ITEM SINCE <t>. It CANNOT distinguish an agent
# working a hard item for six hours from an item nobody is holding, because
# nothing in this system records a dispatch — there is no start-of-dispatch event,
# no lease and no heartbeat on the item. The signal that would separate them is
# exactly that: a dispatch record (id + start ts, released on return) written by
# the dispatcher and read here, which is the open finding
# OI-LOOP-GATE-CANNOT-SEE-A-DISPATCH-IN-FLIGHT (the converse blind spot: the gate
# also cannot tell a live dispatch from none). Until that exists this check must
# NOT claim abandonment, and it does not: it reports the idle fact, and the remedy
# asks the reader to decide between the three possibilities. A proxy was available
# — the per-dispatch DynamoDB-Local containers carry a DISPATCH id — and was
# deliberately NOT used: not every dispatch starts one, so it would answer "no
# container therefore abandoned" wrongly, which is a guess wearing a measurement's
# clothes.
#
# THRESHOLDS ARE DERIVED, AND DELIBERATELY NOT FROM THE TAIL. views/stats.md §B
# (measured dwell, backfill held apart per §17f) gives per-state MEDIAN dwell:
# reproducing 733s, fixing 670s, building 1536s, deploying 685s, dev-validating
# 1790s, validating 10001s, reworking 4626s, prod-deploying 65s, prod-validating
# 26s. 24h is 58x-3300x every one of them. The p95 of the same distribution is
# 12-92h — but that tail IS the pathology (its top entries are the very abandoned
# segments above), so deriving the threshold from it would define the disease as
# normal, which is the §17h trap in the measurement itself. Hence: median-anchored.
#
# The states differ by two orders of magnitude among themselves and ALL of them by
# two more from the threshold, so splitting 24h into per-state numbers would be
# false precision — with ONE exception the data does justify: `scheduled` has a
# median of 55091s (15.3h, n=20, ZERO backfill), an order of magnitude above every
# work state, because it is a DIFFERENT QUANTITY (queue latency, not effort). So
# the ready-stage states get their own, larger number. The map is nevertheless
# keyed PER STATE, so a state that later proves different can be tuned alone, and
# `queues/policy.csv` carries a per-queue `stall_hours` override so the number is
# owned by the retro like every other buffer knob (§F2) rather than by this file.
#
# Measured against history at these numbers: 52 firings across ~600 closed
# segments (3-12% per state), every one of them a real stall (DEFECT-OAG-045 @36h
# is the founding stalled-validation case; UC-C11 @146h; DEFECT-OAG-046 @176h). At
# any instant only OPEN segments are reported, so the steady-state report is
# empty when work is moving — which is what keeps it from becoming background
# noise, the failure mode that let `make render-diagrams` sit red for 20 days.
STALLED_WORK_HOURS = {
    # agent-owned WIP-stage states: nobody has recorded anything in a day
    "building": 24.0, "fixing": 24.0, "reproducing": 24.0, "reworking": 24.0,
    "deploying": 24.0, "prod-deploying": 24.0,
    "validating": 24.0, "dev-validating": 24.0, "prod-validating": 24.0,
    # ready-stage: scheduled and not pulled. Queue latency, not effort.
    "ready": 48.0, "scheduled": 48.0,
}
# FAIL-CLOSED default for a state added to the graph later: it is covered (and so
# FIRES) rather than silently exempt. The completeness test pins the population,
# so a new WIP-stage state forces a deliberate decision rather than a blind spot.
DEFAULT_STALLED_WORK_HOURS = 24.0
# policy.csv param that overrides the above per QUEUE (the retro's knob, §F2).
STALLED_WORK_POLICY_PARAM = "stall_hours"


def stalled_work_hours_for(state, policy=None, graphs=None):
    """Idle-hours threshold for `state`: the queues/policy.csv `stall_hours` row
    for its queue if declared (retro-owned), else the derived per-state default,
    else DEFAULT_STALLED_WORK_HOURS (fail-closed)."""
    if policy is not None and graphs is not None:
        q = graphs.queue_for(state)
        if q:
            raw = policy.get(q, {}).get(STALLED_WORK_POLICY_PARAM)
            if raw not in (None, ""):
                try:
                    return float(raw)
                except (TypeError, ValueError):
                    pass            # unparseable -> fall through to the default
    return float(STALLED_WORK_HOURS.get(state, DEFAULT_STALLED_WORK_HOURS))


def stalled_work_states(graphs, policy):
    """{state: threshold_hours} for every state this check MUST cover — DERIVED
    from state-graphs.json, never a hand list, so a state added later cannot
    become a blind spot the way `fixing`/`building` did:

      * non-terminal (a terminal state cannot stall), AND
      * in a queue at all (an aggregate/planned state has no own stream), AND
      * that queue is NOT a BACKLOG queue — a backlog item is aging inventory,
        which check 4 owns by AGE-WITHOUT-A-DECISION; reporting it here too would
        give one item two different remedies, AND
      * not owner-class `external` — `blocked`/`awaiting_observation` items carry a
        RECORDED reason for the wait and are re-checked by check 5. An UNRECORDED
        wait is what this check is for.

    An unclassified queue defaults to `wip` (queue_kind fails closed), so a new
    in-flight stage is INSIDE this population until somebody says otherwise."""
    out = {}
    for state in graphs.queue_map:
        if state.startswith("_") or state in TERMINAL_STATES:
            continue
        q = graphs.queue_for(state)
        if not q:
            continue
        if queue_kind(policy, q) == QUEUE_KIND_BACKLOG:
            continue
        if graphs.owner_of(state) == "external":
            continue
        out[state] = stalled_work_hours_for(state, policy, graphs)
    return out


# The ready-stage queue: its members are SCHEDULED, not claimed, so they get the
# other remedy (pull it / de-schedule it) — AC-127.3.
STALLED_WORK_SCHEDULED_QUEUE = "ready"


def _last_event_ts(item):
    """The latest PARSEABLE event timestamp on an item, or None.

    DEF-ROC-089. Used only by `stalled-work`'s CLAIMED limb, to answer "has
    anything been recorded against this occupied WIP slot lately". Deliberately
    NOT used by any age/park computation: `_current_segment` merges same-state
    segments so that an `amended` cannot reset a park's age (v145), and that must
    stay true.

    Unparseable timestamps are SKIPPED rather than treated as now — a garbled `ts`
    must not manufacture activity that would hold a slot open.
    """
    latest = None
    for ev in (item.events or []):
        ts = parse_ts(ev.get("ts"))
        if ts is None:
            continue
        if latest is None or ts > latest:
            latest = ts
    return latest


def _open_segment_entered(graphs, item, state, now):
    """(entered_ts, None) for the item's still-open segment in `state`, or
    (None, reason) when the idle time CANNOT BE COMPUTED.

    §17i: a control that cannot look must SAY SO. The tempting shape here is
    `if entered is None: continue` — which is what checks 3 and 4 do — and it
    collapses could-not-look into a silent pass. It is reachable: an event whose
    `ts` will not parse leaves walk_states with no timed segment for the state the
    fold actually reports, so the item's idle time is unknowable while the item
    still occupies a WIP slot."""
    if graphs.kind(item.type) != "flow":
        return None, ("it is an aggregate — it has no own event stream, so its "
                      "idle time is a property of its children, not of itself")
    seg_state, entered = _current_segment(graphs, item, now)
    if entered is None:
        return None, ("no timed segment could be replayed from its event log "
                      "(no parseable event timestamps)")
    if seg_state != state:
        return None, (f"its last replayable segment is '{seg_state}' but the fold "
                      f"reports '{state}' — an event timestamp is missing or will "
                      f"not parse, so the clock for '{state}' never started")
    return entered, None


def compute_wip_activity(graphs, project, now=None, policy=None):
    """OCCUPANCY vs ACTIVITY per WIP-stage queue — the distinction AC-127.4 exists
    to force. Returns {queue: {occupied, active, idle, unreadable, idle_ids}}.

    `occupied` is what every depth/cap number in this system has always meant.
    `active` = a recorded event inside the state's stall threshold. `idle` = past
    it. `unreadable` = could-not-look, counted SEPARATELY so it is never quietly
    added to `active` (§17i)."""
    items, _dup = load_all_items(project)
    states = compute_states(graphs, items)
    if policy is None:
        policy = read_queue_policy(project)
    if now is None:
        now = parse_ts(now_iso())
    return _wip_activity(graphs, items, states, policy, now)


def _wip_activity(graphs, items, states, policy, now):
    """The pure half of compute_wip_activity, so the gate computes the split from
    the SAME item load it already did rather than re-reading the tree."""
    pop = stalled_work_states(graphs, policy)
    out = {}
    for iid in sorted(items):
        state = states.get(iid)
        if state not in pop:
            continue
        q = graphs.queue_for(state)
        row = out.setdefault(q, {"occupied": 0, "active": 0, "idle": 0,
                                 "unreadable": 0, "idle_ids": []})
        row["occupied"] += 1
        entered, _why = _open_segment_entered(graphs, items[iid], state, now)
        if entered is None:
            row["unreadable"] += 1
            continue
        if (now - entered).total_seconds() > pop[state] * 3600.0:
            row["idle"] += 1
            row["idle_ids"].append(iid)
        else:
            row["active"] += 1
    return out


def _activity_phrase(row):
    """The occupancy/activity split as one readable clause. Used in the gate header
    and in check 3's WIP line so `depth` can never again be read as activity."""
    if not row:
        return None
    txt = (f"{row['occupied']} occupied = {row['active']} with recorded activity / "
           f"{row['idle']} idle past threshold")
    if row.get("unreadable"):
        txt += f" / {row['unreadable']} NOT ESTABLISHED"
    if row.get("idle_ids"):
        txt += f" (idle: {', '.join(row['idle_ids'][:6])})"
    return txt


def compute_loop_gate(graphs, project, stale_hours=DEFAULT_STALE_HOURS,
                      threshold=3, now=None, observe=True,
                      observe_timeout=DEFAULT_OBSERVE_TIMEOUT,
                      max_backlog_age_days=DEFAULT_MAX_BACKLOG_AGE_DAYS,
                      max_defer_total_days=DEFAULT_MAX_DEFER_TOTAL_DAYS):
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
        # FOUR outcomes, rendered DISTINCTLY (DEFECT-OAG-128). This line used to
        # read "push state UNKNOWN (ref unresolvable in work/<project>)" for BOTH a
        # parent-lane ref (which merely lived in the other repo) and a sha that
        # existed nowhere at all — one string for a non-event and for destroyed
        # work. Collapsing "I looked in the wrong place" into either a pass or the
        # data-loss alarm was the whole defect.
        res = resolve_ref(project, ref)
        on_trunk = (True if res["verdict"] == REF_ON_TRUNK else
                    False if res["verdict"] == REF_NOT_ON_TRUNK else None)
        repaired = (" [ref recorded as `%s`; resolved as `%s` — a leading zero was "
                    "eaten by int-coercion, see DEFECT-OAG-128]"
                    % (ref, res["resolved"])) if res["padded"] else ""
        if res["verdict"] == REF_ON_TRUNK:
            push = "PUSHED — on %s in the %s repo" % (res["trunk"], res["lane"])
        elif res["verdict"] == REF_NOT_ON_TRUNK:
            push = ("NOT PUSHED — the commit EXISTS in the %s repo but is on no "
                    "origin trunk there. It is unpushed, NOT lost" % res["lane"])
        elif res["verdict"] == REF_ABSENT:
            push = ("*** COMMIT OBJECT ABSENT FROM EVERY REPO *** — this is the "
                    "DEFECT-OAG-072 signature (`git cat-file -t fb080d9` => Not a "
                    "valid object name) for an item whose work was DELIVERED AND "
                    "DESTROYED. %s. RESCUE FIRST, do not re-run: `make "
                    "worktree-guard DIR=--all`, and check any nested clone for "
                    "objects before anything is removed" % res["reason"])
        else:
            push = ("push state COULD NOT BE ESTABLISHED — %s. This is not a pass "
                    "and not an alarm (§17i)" % res["reason"])
        # The REMEDY IS STATE-DEPENDENT (v152). Telling someone to "dispatch the
        # tester" at a `deploying` stall is the wrong instruction and cannot be
        # followed: the graph has no validating edge from there, so the missing act is
        # the `deployed` event, not a tester. A gate whose remedy the writer REJECTS
        # is the DEF-ROC-084 class (its aged-backlog remedy named an event `wi-append`
        # refuses, 7/7), so the two states get their own sentences.
        if state in DEPLOY_PENDING_STATES:
            nxt = "prod-validating" if state == "prod-deploying" else "dev-validating"
            remedy = (f"Remedy: CONFIRM the deploy landed green (for a PIPELINE deploy "
                      f"read the CI run, never an event note), then fire it yourself — "
                      f"`make wi-append PROJECT={project} ID={iid} EVENT=deployed "
                      f"AGENT=cicd REF=<deployed sha> NOTE_FILE=<path>` — and dispatch "
                      f"the tester in the SAME turn (the deploy and the tester dispatch "
                      f"are ONE act). Under a pipeline deploy NO agent fires `deployed`, "
                      f"so until you do, {iid} cannot reach {nxt} and no tester is "
                      f"dispatchable. Never spoof AGENT=cicd from an engineer/tester.")
        else:
            remedy = (f"Remedy: dispatch the tester now, then "
                      f"`make wi-append PROJECT={project} ID={iid} "
                      f"EVENT=validated|rejected AGENT=tester`.")
        findings.append({
            "check": "stalled-validation", "severity": "block",
            "ids": [iid], "state": state, "dwell_s": dwell, "ref": ref,
            "on_trunk": on_trunk, "ref_verdict": res["verdict"],
            "ref_lane": res["lane"], "ref_resolved": res["resolved"],
            "event": ev.get("event"),
            "message": (f"[stalled-validation] {iid} has been in '{state}' for "
                        f"{_hms(dwell)} (>{stale_hours}h); the work is DONE "
                        f"({ev.get('event')} ref {ref}, {push}){repaired} — only a dispatch "
                        f"is missing. {remedy}"),
        })

    # --- 11. STALLED WORK — claimed or scheduled, with NO RECORDED ACTIVITY ---
    #     (DEFECT-OAG-127; see the block above compute_wip_activity for the whole
    #     argument, the measured derivation, and what this check does NOT claim.)
    #     UNCONDITIONAL: no flag reaches it, because a gate with an off switch is a
    #     gate that cannot fail (§17i).
    already_blocked = {i for f in findings
                       if f["check"] == "stalled-validation" and f["severity"] == "block"
                       for i in f.get("ids", [])}
    stall_pop = stalled_work_states(graphs, policy)
    for iid in sorted(items):
        state = states.get(iid)
        if state not in stall_pop:
            continue
        # Check 1 already named it with the MORE SPECIFIC remedy (the work is done,
        # dispatch the tester), so yield to it. Its UNKNOWN case is deliberately NOT
        # excluded: "we cannot tell whether the work is finished" is a different
        # question from "nothing has happened for a week", and the second one blocks.
        if iid in already_blocked:
            continue
        it = items[iid]
        thr_h = stall_pop[state]
        entered, why = _open_segment_entered(graphs, it, state, now)
        queue = graphs.queue_for(state)
        owner = graphs.owner_of(state)
        scheduled = (queue == STALLED_WORK_SCHEDULED_QUEUE)
        # HONOUR THE REMEDY THIS CHECK PRINTS (DEF-ROC-083). Its own message offers
        # "de-schedule it and record an explicit dated decision (`defer_until:`)", and
        # until now it did not read the field — so doing exactly what the gate said
        # left the pull blocked with no way out. A gate that cannot be SATISFIED is the
        # mirror of the gate-that-cannot-fail this project logs most, and it is worse
        # in one way: the first merely fails to catch things, the second stops all work.
        #
        # NARROW BY CONSTRUCTION, and the narrowness is the point:
        #  - only the SCHEDULED kind. `ready` is a schedule nobody has started, so
        #    deferring it is a real scheduling decision. A CLAIMED wip slot is work
        #    someone is supposed to be holding, and a date in the future says nothing
        #    about whether anyone is holding it — that still blocks.
        #  - EXPIRY still bites. A defer whose date has passed blocks again, which is
        #    what stops `defer_until` from becoming a permanent silencer.
        #  - UNPARSEABLE is not a decision (`_defer_until` returns None), matching the
        #    rule the aged-backlog check already applies.
        if scheduled:
            deferred_to = _defer_until(it)
            if deferred_to is not None and deferred_to > now:
                continue
        kind = "scheduled-not-pulled" if scheduled else "claimed-no-activity"
        common = {"check": "stalled-work", "ids": [iid], "state": state,
                  "queue": queue, "owner": owner, "kind": kind,
                  "threshold_h": thr_h}
        if entered is None:
            # BLOCKS, and deliberately: §17i — where the control is a gate, an
            # answer it could not establish is not a pass. The subject here is an
            # OCCUPIED WIP slot, i.e. exactly the thing whose idleness caused 35
            # items to be deferred; "we could not tell" about it must stop the pull
            # in the same way "it is idle" does. (Check 4's could-not-look is
            # UNKNOWN instead, because its whole queue class is advisory by design —
            # see the QUEUE KIND block.)
            findings.append(dict(
                common, severity="block", idle_s=None,
                message=(
                    f"[stalled-work] COULD NOT LOOK: {iid} is in '{state}' (queue "
                    f"{queue}) and holds that slot, but its idle time cannot be "
                    f"computed — {why}. This run establishes NOTHING about whether "
                    f"it is being worked, and silence is not a pass (§17i), so it "
                    f"BLOCKS. Remedy: repair the item's event stream (every event "
                    f"needs a parseable `ts:`; an item with NO events has no history "
                    f"at all — append its genesis event with `make wi-append "
                    f"PROJECT={project} ID={iid} EVENT=<genesis> AGENT=<agent>`), "
                    f"then re-run.")))
            continue
        # DEF-ROC-089 — MEASURE FROM THE LAST RECORDED ACTIVITY, not from the
        # state entry. This check's own remedy (c) reads "if it IS being worked,
        # append the event already earned so the clock restarts", and until now
        # nothing restarted it: `entered` moves only on a STATE CHANGE. From
        # `fixing` the legal events are fixed/blocked/amended/validating, so the
        # one HONEST option for work in progress (`amended`) could not clear the
        # gate and the other three are false statements about the work. Measured
        # 2026-08-24: an `amended` carrying a real measurement was appended to
        # DEF-ROC-053 and the next gate run still reported "NO RECORDED EVENT
        # since", sixty seconds later.
        #
        # This is the SECOND time this check has printed a remedy it did not
        # honour — DEF-ROC-083 was the `defer_until` limb — and the comment above
        # that fix names the failure mode: a gate that cannot be SATISFIED is
        # worse than one that cannot fail, because it stops all work.
        #
        # `max(...)` is what keeps the check's teeth: the clock is the LATER of
        # "entered the state" and "last event", so an item with no events since
        # entry is unchanged, and a STALE event cannot hold a slot open either.
        # The gaming objection — spam `amended` to keep a slot — is answered on
        # DEF-ROC-089: the gate already invites that exact append, and an
        # `amended` is a permanent audited note where an idle slot is not.
        # NARROW TO THE `claimed` LIMB, AND THE NARROWNESS IS LOAD-BEARING.
        # `_current_segment` merges adjacent same-state segments ON PURPOSE (v145):
        # attaching a reversal probe to a 34-day park is an `amended`, and if that
        # reset the clock then migrating the parks to make their age VISIBLE would
        # instead have HIDDEN it — on the single largest contributor to gross lead
        # time. That reasoning is correct and is untouched here.
        #
        # The two limbs ask different questions, which is why one answer cannot
        # serve both:
        #   - SCHEDULED / parked / aged-backlog ask "how long has this SAT here?"
        #     An amendment is commentary on a wait, not the end of it. Clock =
        #     state entry. (v145, DEF-ROC-083.)
        #   - CLAIMED asks "is anyone HOLDING this WIP slot?" — its own message
        #     says "nothing is known to be happening in it". There, a recorded
        #     event IS the thing being asked about, and its own remedy (c) says so.
        # So only the claimed limb reads activity.
        last_event = _last_event_ts(it) if not scheduled else None
        activity_from = max(entered, last_event) if last_event else entered
        idle_s = (now - activity_from).total_seconds()
        measured_from = ("its last recorded event" if last_event and last_event > entered
                         else f"entering '{state}'")
        if idle_s <= thr_h * 3600.0:
            continue
        if scheduled:
            msg = (
                f"[stalled-work] {iid} has been SCHEDULED in '{state}' with NO "
                f"activity for {_hms(idle_s)}, measured from {measured_from} "
                f"(threshold {thr_h:.0f}h). A scheduled item nobody pulls is invisible aging "
                f"inventory: it holds a '{queue}' slot, and '{queue}' depth then "
                f"reads as if the schedule were being honoured. Remedy — PULL it "
                f"now (it was already chosen, so this is the cheapest work "
                f"available), OR de-schedule it and record an explicit dated "
                f"decision (`defer_until: YYYY-MM-DD` in its frontmatter), OR "
                f"cancel it. Do NOT leave it scheduled: aging inventory is the "
                f"largest measured contributor to gross lead time.")
        else:
            msg = (
                f"[stalled-work] {iid} has been in '{state}' ({owner}) with NO "
                f"activity for {_hms(idle_s)}, measured from {measured_from} "
                f"(threshold {thr_h:.0f}h) — the '{queue}' slot is OCCUPIED and nothing is "
                f"known to be happening in it. THIS IS AN IDLE FACT, NOT A VERDICT: "
                f"the event log cannot tell an in-flight dispatch from work nobody "
                f"is holding, because no dispatch is recorded anywhere "
                f"(OI-LOOP-GATE-CANNOT-SEE-A-DISPATCH-IN-FLIGHT). Decide it, three "
                f"ways: (a) RE-DISPATCH — the work is fine and nobody is holding it; "
                f"(b) RELEASE — it is genuinely waiting on something, so say so and "
                f"free the slot: `make wi-append PROJECT={project} ID={iid} "
                f"EVENT=blocked AGENT=flow-manager NOTE=<what it waits on>`; (c) if "
                f"it IS being worked, append the event already earned so the clock "
                f"restarts. Until then this slot must NOT be read as capacity in "
                f"use — do not raise the WIP cap to work around it.")
        findings.append(dict(common, severity="block", idle_s=idle_s, message=msg))

    # --- derived queue depths (pure function of state via queue_map) ----------
    depths = defaultdict(int)
    members = defaultdict(list)
    for iid in sorted(items):
        q = graphs.queue_for(states.get(iid))
        if q:
            depths[q] += 1
            members[q].append(iid)

    # OCCUPANCY vs ACTIVITY (AC-127.4). Every depth number above counts OCCUPANCY;
    # this is the same population split by whether anything has been RECORDED
    # against it lately. Computed from the items already loaded.
    activity = _wip_activity(graphs, items, states, policy, now)

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
            # THIS DEPTH COUNTS OCCUPANCY, NOT ACTIVITY, and saying so is AC-127.4.
            # Reading it as activity is what cost 35 wrongly-deferred items: the
            # cap was "full" of work nothing was happening to. The split rides on
            # the same line so the two numbers can never be confused again.
            row = activity.get(q) or {}
            split = _activity_phrase(row)
            findings.append(dict(common, severity="block",
                                 active=row.get("active"), idle=row.get("idle"),
                                 unreadable=row.get("unreadable"),
                                 idle_ids=row.get("idle_ids", []),
                                 message=(
                f"[queue-over-cap] {q} depth {depths[q]} > wip_limit {cap} — over "
                f"by {over}. THIS DEPTH IS OCCUPANCY, NOT ACTIVITY"
                + (f" — {split}. " if split else ". ") +
                f"{q} is a WIP STAGE: concurrent work in flight past the cap is "
                f"real harm (aging, context-switching). Remedy: drain {over} to "
                f"done before admitting more — and if the idle count above is "
                f"non-zero, those slots are NOT capacity in use, so re-dispatch or "
                f"release them (see the [stalled-work] lines) BEFORE concluding "
                f"there is no capacity. The cap targets gross lead time (§F2), "
                f"work cannot be allowed to age.")))

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
        unreadable = []
        over_ceiling = []
        for mid in members[q]:
            st_m = states.get(mid)
            ent, why = _open_segment_entered(graphs, items[mid], st_m, now)
            if ent is None:
                # §17g sweep off DEFECT-OAG-127: this used to be a bare `continue`,
                # so an item whose AGE cannot be established was exempt from the
                # aging gate FOR EVER, silently, and `validate` reports clean for it
                # too. Measured population on OagEventSource 2026-08-20: THREE items
                # with an EMPTY `events:` list (DEFECT-OAG-129 and DEFECT-OAG-130 at
                # value 26, and OI-DEF124-SWEEP-LEDGER) — registered by hand, folding
                # to their initial state with no genesis event, hence no segment and
                # no age. They could have sat there indefinitely.
                unreadable.append((mid, why))
                continue
            age_d = (now - ent).total_seconds() / 86400.0
            if age_d <= max_backlog_age_days:
                continue
            deferred_to = _defer_until(items[mid])
            if deferred_to is not None and deferred_to > now:
                # An in-date decision exists — respect it, but NOT for ever.
                #
                # v155, and this is the retro's root-cause fix. This branch used to
                # be an unconditional `continue`, so an in-date defer exempted the
                # item NO MATTER HOW MANY TIMES IT HAD BEEN RE-DATED. That made the
                # gate satisfiable indefinitely WITHOUT MOVING ANY WORK: re-dating
                # is the cheapest compliant action, so re-dating is what happened.
                #
                # MEASURED, OagEventSource 2026-08-27: the same 36-item batch had
                # been mechanically re-staggered TWICE in 9 days (2026-08-18 and
                # 2026-08-19) and NOT ONE of them had reached `done` in between.
                # Items 22-25 days old were being re-dated three weeks out. The
                # gate reported satisfied throughout, because each individual defer
                # was a legal, in-date decision. The check measured DECISION and
                # never MOVEMENT — this project's control-satisfiable-without-
                # achieving-its-purpose family, arriving in the flow gate itself.
                #
                # So a defer buys TIME, not IMMUNITY: past a total-age ceiling,
                # re-dating is no longer an available answer and the item must be
                # scheduled, declined, or escalated. Deliberately keyed on TOTAL
                # IN-QUEUE AGE rather than on a defer COUNT: the count is not
                # recorded anywhere (frontmatter holds one value, overwritten each
                # time), whereas age is already computed above and is exactly the
                # quantity serial re-dating is used to hide.
                if age_d <= max_defer_total_days:
                    continue
                over_ceiling.append((age_d, mid, deferred_to))
                continue
            undecided.append((age_d, mid, deferred_to))
        if unreadable:
            # UNKNOWN, not block — and the asymmetry with check 11 is deliberate,
            # not an oversight: this queue class is ADVISORY BY DESIGN (blocking on
            # backlog inverts the constraint, see the QUEUE KIND block), so the
            # honest report here is NOT ESTABLISHED, which reaches the headline and
            # can never read as satisfied.
            findings.append({
                "check": "aged-backlog-unreadable", "severity": "unknown",
                "queue": q, "ids": [m for m, _w in unreadable],
                "message": (
                    f"[aged-backlog-unreadable] NOT ESTABLISHED: the age of "
                    f"{len(unreadable)} item(s) in {q} CANNOT BE COMPUTED, so the "
                    f"aging gate above did not consider them at all: "
                    + "; ".join(f"{m} ({w})" for m, w in unreadable[:6])
                    + (f"; and {len(unreadable) - 6} more not listed"
                       if len(unreadable) > 6 else "")
                    + f". An item with no computable age is exempt from every "
                      f"age-based limb for ever — that is not the same as clean "
                      f"(§17i). Remedy (DEF-ROC-084 — the previous wording named an "
                      f"event this graph REFUSES): append an `amended` event CARRYING "
                      f"`--ts` set to the item's true registration instant — "
                      f"`sh .claude/skills/work-items/scripts/work-items append "
                      f"--project {project} --id <id> --event amended --agent "
                      f"flow-manager --ts <YYYY-MM-DDTHH:MM:SSZ> --note-file <path>`. "
                      f"NOT a genesis event: an empty `events:` list ALREADY folds to "
                      f"the type's `initial` state, so `reported`-from-`reported` is "
                      f"not a legal transition and the sole writer rejects it. And NOT "
                      f"without `--ts`: a default now-stamp resets the item's age to "
                      f"zero, so the repair would destroy the very measurement this "
                      f"check exists to restore (recover the true instant from the "
                      f"commit that ADDED the item file: `git -C <repo> log "
                      f"--diff-filter=A --format=%aI -1 -- <path>`, converted to UTC)."),
            })
        if over_ceiling:
            over_ceiling.sort(reverse=True)
            findings.append({
                "check": "aged-backlog-defer-ceiling", "severity": "block",
                "queue": q, "ids": [m for _a, m, _d in over_ceiling],
                "max_defer_total_days": max_defer_total_days,
                "message": (
                    f"[aged-backlog-defer-ceiling] {len(over_ceiling)} item(s) in {q} "
                    f"hold an IN-DATE defer but have now been in-queue longer than the "
                    f"{max_defer_total_days:.0f}d total-age CEILING, so re-dating is no "
                    f"longer an available answer: "
                    + ", ".join(f"{m} ({a:.1f}d in queue, deferred to "
                               f"{d.date().isoformat()})"
                               for a, m, d in over_ceiling[:8])
                    + (f" and {len(over_ceiling) - 8} more"
                       if len(over_ceiling) > 8 else "")
                    + f". A defer buys TIME, NOT IMMUNITY. This limb exists because "
                      f"the in-date branch used to exempt an item no matter how many "
                      f"times it had been re-dated, which made this gate satisfiable "
                      f"INDEFINITELY WITHOUT MOVING ANY WORK — measured on "
                      f"OagEventSource 2026-08-27: one 36-item batch re-staggered "
                      f"TWICE in 9 days with NOT ONE item reaching `done` in between, "
                      f"while the gate reported satisfied throughout because each "
                      f"individual defer was legal and in-date. Remedy, per item — "
                      f"SCHEDULE it (and pull it), or DECLINE it, or ESCALATE it to a "
                      f"named party. Extending the date again is NOT one of the three, "
                      f"and §F8a's prohibition still stands: do NOT close a real "
                      f"finding to clear this gate. If a whole class of these is real "
                      f"but never pulled, that is a CAPACITY decision for the retro "
                      f"(a standing WIP allocation), not a dating decision."),
            })
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

    # --- 5b. blocked: RE-RUN the reversal probe, every cycle [v145, §17c.6] ---
    # The sibling of check 5, and the more expensive park of the two: `blocked`
    # holds the largest single share of gross lead time in this project at a median
    # of ~3 weeks per item. Its only detector used to be a human deciding to
    # re-ask, and DEF-ROC-004 sat here for 28.8 DAYS after both of its blockers had
    # already gone. Severities mirror check 5 exactly — the verdict with an
    # ACTIONABLE dispatch behind it BLOCKS:
    #   cleared  -> BLOCK. The blocker is gone; an `unblocked` append is available.
    #   standing -> ADVISORY. Honest, outstanding, never "satisfied".
    #   broken   -> BLOCK. An unrunnable probe is not a probe (§17c.2), and a probe
    #               that does not exist must never masquerade as "still blocked".
    for iid in sorted(items):
        if states.get(iid) != "blocked":
            continue
        it = items[iid]
        # FLOW items only — an aggregate BUBBLES into `blocked` from a child and has
        # no own event stream to carry a probe. The probe lives on the child, and
        # reporting the ancestors would be a phantom block for each of them.
        if graphs.kind(it.type) != "flow":
            continue
        _st, entered = _current_segment(graphs, it, now)
        dwell = (now - entered).total_seconds() if entered else None
        spec = probe_spec_in_effect(it)
        common = {"check": "blocked-park", "ids": [iid], "state": "blocked",
                  "dwell_s": dwell, "spec": spec}
        if not spec:
            findings.append(dict(common, severity="block", verdict="no-predicate",
                                 message=(
                f"[blocked-park] {iid} has been parked in 'blocked' for "
                f"{_hms(dwell)} but carries NO reversal probe — nothing can decide "
                f"when the blocker ends, so it would sit here for ever. This is the "
                f"DEF-ROC-004 shape (28.8 days blocked after both blockers had "
                f"already gone). Remedy: `make wi-append PROJECT={project} ID={iid} "
                f"EVENT=amended AGENT=flow-manager "
                f"PROBE={OBSERVE_SCHEME}<target>` naming a committed re-runnable "
                f"probe (exit 0, printing `{BLK_SENTINEL} {BLK_CLEARED}` or "
                f"`{BLK_SENTINEL} {BLK_STANDING}`) — or, if it should not be "
                f"blocked at all, `EVENT=unblocked` and say why.")))
            continue
        if not observe:
            findings.append(dict(common, severity="unknown", verdict="not-evaluated",
                                 message=(
                f"[blocked-park] {iid}: reversal probe '{spec}' was NOT evaluated "
                f"(--no-observe). Parked {_hms(dwell)}. This run establishes nothing "
                f"about whether the blocker is still there — re-run without "
                f"--no-observe before concluding anything.")))
            continue
        verdict, detail = _run_blocker_probe(project, spec, observe_timeout)
        if verdict == BLK_CLEARED:
            findings.append(dict(common, severity="block", verdict=verdict,
                                 detail=detail, message=(
                f"[blocked-park] {iid}: THE BLOCKER IS GONE (probe '{spec}' reported "
                f"{BLK_SENTINEL} {BLK_CLEARED}{'; ' + detail if detail else ''}) "
                f"after {_hms(dwell)} parked. An `unblocked` dispatch is ACTIONABLE "
                f"and this is the single largest recoverable cost in the system. "
                f"Remedy: `make wi-append PROJECT={project} ID={iid} "
                f"EVENT=unblocked AGENT=flow-manager` with the probe output in NOTE, "
                f"then pull it.")))
        elif verdict == BLK_STANDING:
            findings.append(dict(common, severity="advisory", verdict=verdict,
                                 detail=detail, message=(
                f"ADVISORY (does NOT block the pull) [blocked-park] {iid} parked "
                f"{_hms(dwell)}: '{spec}' reports the blocker is STILL BLOCKED. "
                f"Legitimate and re-checked every cycle — but it is OUTSTANDING, "
                f"never satisfied, and `blocked` is the top contributor to gross "
                f"lead time. If the wait is unbounded, escalate it, buy round it, or "
                f"decide the item should not be blocked — never let the probe become "
                f"the reason nobody looks.")))
        elif verdict == BLK_NOT_ESTABLISHED:
            findings.append(dict(common, severity="advisory", verdict=verdict,
                                 detail=detail, message=(
                f"NOT ESTABLISHED (does NOT block the pull) [blocked-park] {iid} parked "
                f"{_hms(dwell)}: '{spec}' RAN and could not tell either way in the window "
                f"it had{'; ' + detail if detail else ''}. This is not a pass and not an "
                f"alarm (§17i) — it is the probe declining to call non-observation a "
                f"clearance, which is correct. But NOTHING IS SATISFIED: the park is still "
                f"costing gross lead time and nobody has established it should end. If the "
                f"window is too small to ever conclude, widen it, force the trigger, or "
                f"judge it statistically (§12d.3) — never let a permanent "
                f"'not-established' become the reason nobody looks.")))
        else:
            findings.append(dict(common, severity="block", verdict="broken",
                                 detail=detail, message=(
                f"[blocked-park] {iid}: its reversal probe CANNOT BE EVALUATED "
                f"('{spec}': {detail}). An unrunnable probe is not a probe "
                f"(§17c.2), and a probe that does not exist must NEVER masquerade "
                f"as 'still blocked' — that is DEF-ROC-046's mistake in the other "
                f"direction. Remedy: fix the probe (exit 0, printing "
                f"`{BLK_SENTINEL} {BLK_CLEARED}`/`{BLK_SENTINEL} {BLK_STANDING}`/"
                f"`{BLK_SENTINEL} {BLK_NOT_ESTABLISHED}`) "
                f"or record a corrected one with "
                f"`make wi-append … EVENT=amended … PROBE=…`.")))

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
                        f"{_retro_since_phrase(project)} "
                        f"({', '.join(ids) or '—'}). Remedy: fire /retro, then "
                        f"`make retro-mark PROJECT={project}` to drain it."),
        })

    # --- 6. the test-requirement gate (§17d) — DELEGATED to the real analyser --
    findings.extend(compute_test_requirement_gate(project))

    # --- 7. unrecoverable work in a worktree (DEFECT-OAG-076) — DELEGATED ------
    findings.extend(compute_worktree_guard())

    # --- 8. orphaned local containers (DEFECT-OAG-091) — DELEGATED, AND IT REAPS
    findings.extend(compute_container_reap(project))

    # --- 14. an in-progress git operation ARMED in a shared tree — DELEGATED ----
    #         (OI-ABANDONED-SEQUENCER-STATE-ARMS-A-56-COMMIT-DESTRUCTION, AC-SEQ.2).
    #         The third member of the shared-tree family CLAUDE.md documents (`git
    #         stash -u`, `git checkout`) and the first one a gate looks for. It hangs
    #         here because the state is INVISIBLE to `git status --porcelain`: every
    #         cleanliness check in this system passes with an armed sequencer, so the
    #         only way it is ever seen is a check that looks for the state itself,
    #         before the next wave of dispatches adds to the pile at stake.
    findings.extend(compute_sequencer_guard())

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

    # --- 13. every state in the graph has a board-status row — DELEGATED -------
    #     NUMBER COLLISION, resolved here rather than silently: DEFECT-OAG-099's
    #     own docs call this "check 11", and so does the DEFECT-OAG-127
    #     stalled-work check above — they were authored in parallel by agents
    #     that could not see each other. Renumbered to 13 (12 is ref-provenance)
    #     so the comments are unambiguous. Nothing functional changed: the
    #     runtime `check` keys were already distinct ("stalled-work" vs
    #     "board-mapping"), which is why nothing was shadowed.
    #         (DEFECT-OAG-099 AC-099.5). An unmapped state does not fail, it
    #         renders as unstarted BACKLOG — the board saying "not started" about
    #         a terminal item, or about code running in production. That has now
    #         happened TWICE (`cancelled` from state-graph v5; `awaiting_observation`
    #         from v9), each time discovered by a human noticing, because the only
    #         consumer was a per-item board sync whose stderr nobody reads. The
    #         mapping is a hand-maintained table and the graph is not, so the two
    #         drift on any commit that adds a state; hanging the check here makes
    #         "add a state" and "add its row" one enforced commit.
    findings.extend(compute_board_mapping_drift())
    # --- 12. every recorded `ref:` must still EXIST somewhere — DELEGATED ------
    #         (DEFECT-OAG-128). Deliberately registry-wide including DONE items:
    #         a destroyed commit on a closed item is the case nobody re-reads, and
    #         it is exactly what happened to DEFECT-OAG-072. `items` is threaded in
    #         rather than re-loaded: 478 files is ~340ms, and a gate that runs before
    #         every pull pays that on every cycle for nothing.
    findings.extend(compute_ref_provenance(project, items=items))

    # --- 15. is the DEPLOYED artifact the one on trunk? — DELEGATED -----------
    #         (ROC retro 2026-08-24; DEF-ROC-086/087). The only check that reads
    #         the OUTSIDE WORLD rather than our own event log. Deployment
    #         frequency is a fold over item events, so a push that never deployed
    #         emits nothing and the metric keeps reporting a healthy rate — ROC
    #         ran three pushes dark at 6.57 deploys/active-day. Advisory: refusing
    #         to pull cannot un-stale an environment.
    findings.extend(compute_deploy_staleness(project))

    return findings


# ---------------------------------------------------------------------------
# loop-gate check 15 — IS THE DEPLOYED ARTIFACT THE ONE ON TRUNK?
# (ROC retro 2026-08-24; DEF-ROC-086 / DEF-ROC-087)
#
# ROC's ONLY environment went THREE PUSHES with no deploy and nothing said so. A
# CI test job failed; `deploy-test` declares `needs:` on it; so the deploy was
# SKIPPED — not failed. A skipped job renders as a neutral dash and contributes
# nothing to the run's conclusion, so the run read "a test broke" when the
# consequence was "the environment is now N commits stale".
#
# WHY THIS BELONGS IN THE GATE AND NOT IN A RUNBOOK. Deployment frequency here is
# a fold over ITEM EVENTS — an item entering `deploying` — i.e. an INTENTION an
# agent recorded. A push that never deploys emits no event, so the one DORA metric
# whose subject is the OUTSIDE WORLD is computed from statements about our own
# intentions. Through the whole dark period ROC's deployment frequency read
# 6.57/active-day. The metric that should have screamed could not see it. That is
# the absence-vs-ignorance family (eleven registered instances in this project)
# applied to the measurement layer: "no deploy event" read as "nothing to deploy"
# when it meant "we have no idea".
#
# ADVISORY, never blocking — deliberately. A gate blocks only on harm that
# stopping relieves, and refusing to pull work does not un-stale an environment;
# it just adds a second problem on top of the first.
# ---------------------------------------------------------------------------
DEPSTALE_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               "..", "..", "..", "tools", "deploy-staleness.js")
DEPSTALE_TIMEOUT = 60.0


def compute_deploy_staleness(project, timeout=DEPSTALE_TIMEOUT):
    """Compare the DEPLOYED build identity against trunk. 0 or 1 finding."""
    common = {"check": "deploy-staleness", "ids": []}
    try:
        proc = subprocess.run(
            ["node", os.path.normpath(DEPSTALE_SCRIPT), "--project", project,
             "--repo-root", ROOT, "--json"],
            capture_output=True, text=True, timeout=timeout)
        report = json.loads(proc.stdout)
    except Exception as exc:                                    # noqa: BLE001
        return [dict(common, severity="unknown", verdict="UNRUNNABLE", message=(
            f"[deploy-staleness] NOT ESTABLISHED — the checker would not run "
            f"({type(exc).__name__}: {str(exc)[:160]}). Nothing was checked, which is "
            f"NOT the same as 'the environment is current': this is the only check "
            f"that reads what the deployed host is actually running, and its absence "
            f"is exactly the condition under which ROC ran three pushes dark. "
            f"Remedy: `node .claude/tools/deploy-staleness.js --project {project} "
            f"--repo-root . --json`."))]

    verdict = report.get("verdict")
    if verdict == "NOT-ESTABLISHED":
        return [dict(common, severity="unknown", verdict=verdict, message=(
            f"[deploy-staleness] NOT ESTABLISHED ({report.get('reason')}) — "
            f"{report.get('detail') or 'no detail'}. An unanswerable question must "
            f"never render as a clean answer. Until this is established, deployment "
            f"frequency for {project} is a fold over recorded INTENTIONS and no "
            f"statement about the deployed environment is supported by anything. "
            f"Remedy: commit .claude/config/deploy-staleness/{project}.json (copy "
            f"ROC's) or fix what the reason names."))]

    if verdict != "stale":
        return []

    behind = report.get("behind")
    dep = report.get("deployableChangesBehind")
    age_h = (report.get("deployedAgeS") or 0) / 3600.0
    if dep is True:
        weight = ("At least one of those commits touches a DEPLOY-TRIGGER path, so "
                  "there IS undelivered work sitting on trunk — this is the DEF-ROC-086 "
                  "condition, live.")
    elif dep is False:
        weight = ("None of those commits touches a deploy-trigger path, so nothing "
                  "deployable is missing — this is EXPECTED drift, not a dark deploy.")
    else:
        weight = ("Whether any of them touches a deploy-trigger path could NOT be "
                  "determined, so treat the deployable subset as unknown rather than "
                  "empty.")
    return [dict(common, severity="advisory", verdict=verdict,
                 deployed=report.get("deployedSha"), trunk=report.get("trunkSha"),
                 behind=behind, deployable=dep, message=(
        f"ADVISORY (does NOT block the pull) [deploy-staleness] {project}'s deployed "
        f"host reports {str(report.get('deployedSha'))[:12]} while {report.get('trunkRef')} "
        f"is {str(report.get('trunkSha'))[:12]} — the environment is {behind} commit(s) "
        f"BEHIND trunk, and the deployed commit is {age_h:.1f}h old. {weight} This is "
        f"advisory because stopping the pull cannot un-stale an environment. Read it "
        f"as the answer to a question NO other signal answers: a deploy that never "
        f"ran leaves no failed job (its `needs:` failed, so it was SKIPPED) and no "
        f"item event, so deployment frequency keeps reporting a healthy rate while "
        f"nothing reaches the environment. Any acceptance condition reading 'verified "
        f"against the deployed host' is unmeetable until this closes."))]


# ---------------------------------------------------------------------------
# loop-gate check 11 — state-graph <-> board-status mapping drift
# (DEFECT-OAG-099, AC-099.5). Offline: no project, no corpus, no network, no
# secret. DELEGATED to the ONE executable home of the mapping audit
# (.claude/tools/board-sweep.py --audit-mapping) — never re-implemented here.
# ---------------------------------------------------------------------------
BOARD_SWEEP_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                  "..", "..", "..", "tools", "board-sweep.py")
BOARD_MAPPING_TIMEOUT = 60.0


def compute_board_mapping_drift(script=None, graphs_path=None,
                                timeout=BOARD_MAPPING_TIMEOUT):
    """0 or 1 finding. UNKNOWN (never clean) if the analyser did not run: an
    unevaluated precondition is not a met one (§17c.2)."""
    common = {"check": "board-mapping", "ids": []}
    argv = [sys.executable, os.path.normpath(script or BOARD_SWEEP_SCRIPT),
            "--audit-mapping"]
    if graphs_path:
        argv += ["--graphs", graphs_path]
    try:
        proc = subprocess.run(argv, capture_output=True, text=True,
                              timeout=timeout)
    except Exception as exc:                                    # noqa: BLE001
        return [dict(common, severity="unknown", message=(
            f"[board-mapping] NOT ESTABLISHED — the mapping audit would not run "
            f"({type(exc).__name__}: {str(exc)[:160]}). An unrunnable check is not "
            f"a clean one. Remedy: `make board-audit`."))]
    out = ((proc.stdout or "") + (proc.stderr or "")).strip()
    if "board-mapping gate" not in out:
        return [dict(common, severity="unknown", message=(
            f"[board-mapping] NOT ESTABLISHED — the audit produced no verdict "
            f"(exit {proc.returncode}): {out[:200] or '<no output>'}. An "
            f"unrunnable check is not a clean one. Remedy: `make board-audit`."))]
    if proc.returncode == 0:
        return []
    states = sorted({m for m in re.findall(r"\b(?:UNMAPPED|STALE-KEY)\s+\S+/(\S+?):",
                                           out)})
    return [dict(common, severity="block", ids=[], message=(
        f"[board-mapping] {out.splitlines()[0]} "
        f"{('states: ' + ', '.join(states) + '. ') if states else ''}"
        f"An unmapped state renders as unstarted Backlog — the board lying about "
        f"a terminal or in-production item, which has happened twice. Remedy: add "
        f"the row to STATE_STATUS in .claude/tools/linear-project.py AND to "
        f"process/linear-mapping.md §2, in the same commit as the state; then "
        f"`make board-audit`."))]


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
            f"VERBOSE=1`. To find WHOSE it is rather than guessing: "
            f"`make test-requirement-gate-clean PROJECT={project}` measures the "
            f"COMMITTED tree — if HEAD scores the floor exactly the regression is in "
            f"the uncommitted range; set-diff the two --json violation lists on "
            f"limb|file:line|rule to name the lines (DEFECT-OAG-106)."
            + (f" Limb-2 hits: {worst}." if worst else "")
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


# ---------------------------------------------------------------------------
# loop-gate check 14 — AN IN-PROGRESS GIT OPERATION ARMED IN A SHARED TREE
# (OI-ABANDONED-SEQUENCER-STATE-ARMS-A-56-COMMIT-DESTRUCTION, AC-SEQ.2)
#
# `.git/sequencer` sat in the shared `work/OagEventSource` tree for SIX HOURS
# holding a two-step revert todo with `head=b55d15e0`. That saved head was FIFTY-SIX
# commits behind HEAD — the entire output of seven agents in one session (2 resolved
# defects, 2 closed open-items, 6 registered findings) — and `git revert --abort`
# rewinds to it. The revert it described had already been completed by another route
# (`a8bd0dee`, an ancestor of origin/main), so it was residue describing finished
# work, and the natural way out of a stuck revert was a 56-commit destruction.
#
# WHY IT HANGS HERE RATHER THAN ANYWHERE ELSE. The state is INVISIBLE to
# `git status --porcelain`, so every cleanliness check in this system — this gate's
# own dirty-tree reasoning, the fold-forward check — passes with it armed. Only a
# check that looks for the state itself can see it, and the loop is the only
# continuously-running workflow: it finds it BEFORE the next wave of dispatches
# adds more commits to the pile at stake. It was found ONCE, by a tester noticing
# it as an aside at the end of an unrelated validation.
#
# The analysis lives in ONE place — .claude/tools/sequencer-guard.js — and is
# DELEGATED to, never re-implemented (checks 4, 6, 7, 8, 9, 10 already follow).
# It is READ-ONLY: it never runs `--abort`, `--quit` or any writing verb. Unlike
# check 8 it must NOT self-heal — clearing the state requires first establishing
# what it describes (the incident's operator verified `a8bd0dee` had completed the
# revert), and that is a judgement, not a sweep.
#
# SEVERITY, per §F8a ("a gate blocks only on harm that stopping relieves"), decided
# deliberately because the two cases are genuinely different:
#   commits at stake, or residue we could not MEASURE, or state abandoned past the
#   grace window  -> BLOCK. Stopping is precisely the remedy and the remedy is one
#         command (`git <verb> --quit`). Pulling more work makes it strictly worse:
#         the prescribed shared-tree commit path (isolated-commit.js: `commit-tree`
#         + ref CAS) never clears branch state the way `git commit` does, so every
#         commit the next wave lands ADDS to the count at stake. That is how the
#         gap reached 56. An unmeasurable state fails CLOSED — a count we could not
#         establish is not a count of zero (§17c.2).
#   fresh, and NOTHING at stake  -> ADVISORY. A conflicted merge or single-pick
#         revert someone is resolving right now discards no commits at all
#         (measured), and stopping the line for it would be perverse. Still printed
#         every cycle, so it can never read as satisfied.
#   unrunnable  -> UNKNOWN ("? " line). An unevaluated precondition is not a met one.
# ---------------------------------------------------------------------------
SEQG_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "..", "..", "..", "tools", "sequencer-guard.js")
SEQG_TIMEOUT = 120.0


def compute_sequencer_guard(timeout=SEQG_TIMEOUT):
    """Sweep the parent repo, every worktree and every nested project repo for an
    armed in-progress git operation, and report HOW MANY COMMITS `--abort` would
    discard. Returns 0 or 1 finding."""
    common = {"check": "sequencer-guard", "ids": []}
    try:
        proc = subprocess.run(
            ["node", os.path.normpath(SEQG_SCRIPT), "scan",
             "--repo-root", ROOT, "--json"],
            capture_output=True, text=True, timeout=timeout)
        report = json.loads(proc.stdout)
    except Exception as exc:                                    # noqa: BLE001
        return [dict(common, severity="unknown", message=(
            f"[sequencer-guard] NOT ESTABLISHED — the guard would not run "
            f"({type(exc).__name__}: {str(exc)[:160]}). An unrunnable guard is not a "
            f"clean tree, and this state is INVISIBLE to `git status --porcelain`, so "
            f"nothing else in this system is looking: an abandoned `.git/sequencer` "
            f"once sat armed for six hours over 56 commits of seven agents' work. "
            f"Remedy: `make sequencer-guard`."))]

    verdict = report.get("verdict")
    if verdict == "CLEAN":
        return []

    worst = report.get("worstDiscard", 0)
    unmeasured = report.get("unmeasured", 0)
    detail = []
    for r in report.get("repos", []):
        for s in r.get("states", []):
            n = s.get("discard")
            detail.append(
                "%s in %s: %s commit(s) at stake, idle %s, %s"
                % (s.get("kind"), r.get("dir"),
                   "NOT ESTABLISHED" if n is None else n,
                   "UNKNOWN" if s.get("ageS") is None else "%ss" % s.get("ageS"),
                   "ARMED NOW" if s.get("armedNow") else "one `--continue` from armed"))
    detail_txt = "; ".join(detail)[:900] or "see `make sequencer-guard`"
    quits = "; ".join(sorted({
        "git -C %s %s" % (r.get("dir"), s.get("quit"))
        for r in report.get("repos", []) for s in r.get("states", [])}))[:500]

    if verdict == "ADVISORY":
        return [dict(common, severity="advisory", worst_discard=worst, message=(
            f"ADVISORY (does NOT block the pull) [sequencer-guard] an in-progress git "
            f"operation is present but NOTHING is at stake yet: {detail_txt}. This is "
            f"what a conflict someone is resolving right now looks like, and "
            f"`--abort` on it discards no commits (measured). It is reported because "
            f"the state is INVISIBLE to `git status --porcelain` and because the count "
            f"grows with every commit that lands while it sits: the founding incident "
            f"reached 56 commits over six hours. If it is not yours, clear it with "
            f"`--quit` (never `--abort`): {quits}."))]

    return [dict(common, severity="block", worst_discard=worst,
                 unmeasured=unmeasured, message=(
        f"[sequencer-guard] AN IN-PROGRESS GIT OPERATION IS ARMED IN A SHARED TREE — "
        f"up to {worst} commit(s) would be made unreachable"
        + (f", and {unmeasured} state(s) could not be measured at all (fails CLOSED)"
           if unmeasured else "")
        + f": {detail_txt}. `git status --porcelain` says NOTHING about this, which is "
        f"why every cleanliness check here passes with it armed — it was found once, "
        f"by a tester noticing it as an aside. THE SAFE VERB IS THE OBSCURE ONE: "
        f"`--quit` clears the state and leaves HEAD and the working tree exactly as "
        f"they are; `--abort` rewinds to a saved head that goes stale by design here "
        f"(the prescribed `commit-tree` + ref-CAS commit path never clears branch "
        f"state, so the gap grows with every commit — it reached 56 over six hours). "
        f"Do NOT `--continue` either: one `--continue` rewrites `abort-safety` to the "
        f"current head and RE-ARMS the rewind (measured, both arms, "
        f".claude/tools/sequencer-guard.test.js). Remedy: establish what the state "
        f"describes (the founding incident verified `a8bd0dee` had already completed "
        f"the revert and was an ancestor of origin/main), then {quits}."))]


def cmd_loop_gate(a):
    graphs = Graphs.load()
    now = parse_ts(getattr(a, "now", None)) if getattr(a, "now", None) else None
    stale_hours = getattr(a, "stale_hours", DEFAULT_STALE_HOURS)
    findings = compute_loop_gate(
        graphs, a.project, stale_hours=stale_hours, threshold=a.threshold, now=now,
        observe=getattr(a, "observe", True),
        observe_timeout=getattr(a, "observe_timeout", None) or DEFAULT_OBSERVE_TIMEOUT,
        max_backlog_age_days=getattr(a, "max_backlog_age_days", None)
        or DEFAULT_MAX_BACKLOG_AGE_DAYS,
        max_defer_total_days=getattr(a, "max_defer_total_days", None)
        or DEFAULT_MAX_DEFER_TOTAL_DAYS)
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
    # OCCUPANCY vs ACTIVITY on EVERY run, not only when a queue is over its cap
    # (AC-127.4): the 35-item wrong deferral was decided while wip was UNDER cap.
    # A could-not-look is counted apart and never folded into `active` (§17i).
    try:
        act = compute_wip_activity(graphs, a.project, now=now)
    except Exception as exc:                          # never silently: say so
        act, act_err = None, exc
    else:
        act_err = None
    if act_err is not None:
        act_txt = f"; wip/ready activity NOT ESTABLISHED ({act_err})"
    else:
        parts = []
        for q in sorted(act):
            row = act[q]
            seg = (f"{q} {row['occupied']} occupied = {row['active']} active / "
                   f"{row['idle']} idle")
            if row.get("unreadable"):
                seg += f" / {row['unreadable']} NOT ESTABLISHED"
            parts.append(seg)
        act_txt = ("; " + "; ".join(parts)) if parts else "; wip/ready empty"
    print(f"loop-gate[{a.project}] @ {stamp} (stale-hours {stale_hours}"
          f"{act_txt}) => {verdict}{adv_tail}")
    for f in blocking:
        print(f"  - {f['message']}")
    for f in advisory:
        print(f"  ! {f['message']}")
    for f in unknown:
        print(f"  ? {f['message']}")
    sys.exit(2 if blocking else 0)


# ---------------------------------------------------------------------------
# Subcommand: validate — the drift GATE (invariants I1–I4, I6, I7, I8)
# ---------------------------------------------------------------------------
def cmd_validate(a):
    graphs = Graphs.load()
    violations = validate_items(graphs, a.project)
    if violations:
        print(f"validate: {len(violations)} violation(s) in {a.project}:", file=sys.stderr)
        for v in violations:
            print(f"  - {v}", file=sys.stderr)
        sys.exit(1)
    print(f"validate: {a.project} clean — I1–I4 + I6 + I7 + I8 all hold.")


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

        # I7: a `blocked` FLOW item carries a VALID reversal probe [v145, §17c.6].
        # Exactly the role I6 plays for the sibling park state: `append` refuses the
        # transition without one, so a violation here means a hand-edit or a park
        # made before the rule existed. Aggregates are exempt for the same reason —
        # a slice/chunk BUBBLES into `blocked` from a child and has no own stream.
        if state == "blocked" and graphs.kind(it.type) == "flow":
            spec = probe_spec_in_effect(it)
            if not spec:
                violations.append(
                    f"(I7) {iid}: in 'blocked' with NO reversal probe — nothing can "
                    f"decide when the blocker ends. Record one via `wi-append … "
                    f"EVENT=amended … PROBE={OBSERVE_SCHEME}<target>`; do not "
                    f"hand-edit item state.")
            else:
                try:
                    parse_observe_spec(spec)
                except ValueError as e:
                    violations.append(
                        f"(I7) {iid}: reversal probe is not evaluable: {e}")

        # I8: the file's OWN `derived:` block agrees with fold(events) — the one
        # thing every reader assumes this gate checks, and until now the only thing
        # it did not (OI-WI-VALIDATE-IGNORES-DERIVED-STATE-LEGALITY). `derived:` is
        # a RENDERING of the fold, but it is what the queue views, the board
        # projector, `item-brief` and every agent that opens the file actually read.
        # FOUNDING INSTANCE: five use-case items registered with hand-authored
        # blocks carrying the AGGREGATE-ONLY `state: planned` / `queue: null` — a
        # use-case graph has no `planned` state at all — and `wi-validate` reported
        # `clean`. `wi-project` healed all five, so the machinery could compute the
        # right answer the whole time; the gate simply never asked.
        # The remedy is ALWAYS `make wi-project` (re-render), NEVER an edit to the
        # block — editing it is the act that caused this.
        violations.extend(_check_I8(graphs, iid, it, state, project))

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


_I8_REMEDY = ("re-render it with `make wi-project PROJECT={project}` — the block is "
              "a rendering of fold(events), so the fix is to regenerate it, never "
              "to correct it in place")


def _check_I8(graphs, iid, it, state, project):
    """I8 — the DECLARED `derived:` block must agree with fold(events).

    Four limbs, each failing CLOSED, in the order that gives the most useful
    message first:
      (a) the block exists and declares a state — `null`/absent is not a pass,
          it is an item no derived view can see;
      (b) the declared state is one the item's OWN type graph defines (the
          founding instance: `planned` on a use-case);
      (c) the declared state EQUALS the computed state — legality alone cannot
          catch a plausible lie (`ready` on a use-case that folded to `done`);
      (d) the declared queue equals queue_map[declared state].
    """
    out = []
    remedy = _I8_REMEDY.format(project=project)
    declared = it.declared
    if declared is None:
        out.append(f"(I8) {iid}: no `derived:` block — every derived view (queues, "
                   f"board, item-brief) reads that block, so an item without one is "
                   f"invisible to all of them; {remedy}")
        return out
    if "state" not in declared or declared.get("state") is None:
        out.append(f"(I8) {iid}: `derived.state` is null/absent while fold(events) "
                   f"says '{state}' — a provisional block was persisted; {remedy}")
        return out
    ds = declared.get("state")
    legal = legal_states(graphs, it.type)
    if legal and ds not in legal:
        out.append(f"(I8) {iid}: `derived.state: {ds}` is not a state the "
                   f"'{it.type}' graph defines (legal: {', '.join(sorted(legal))}); "
                   f"fold(events) says '{state}'; {remedy}")
    elif ds != state:
        out.append(f"(I8) {iid}: `derived.state: {ds}` disagrees with fold(events), "
                   f"which says '{state}' — the block is stale or hand-authored, and "
                   f"the fold is the truth; {remedy}")
    dq = declared.get("queue") if "queue" in declared else "<absent>"
    exp_q = graphs.queue_for(ds)
    if dq != exp_q:
        out.append(f"(I8) {iid}: `derived.queue: {dq}` is not queue_map['{ds}'] "
                   f"(= {exp_q}) — the queue is a pure function of the state, so a "
                   f"declared queue that disagrees puts the item in the wrong queue "
                   f"view or in none; {remedy}")
    return out


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
    ap.add_argument("--probe",
                    help="REQUIRED when entering `blocked` (§17c limb 6): the "
                         "machine-checkable REVERSAL probe, "
                         f"'{OBSERVE_SCHEME}<target> [VAR=VALUE ...]' — a committed "
                         "re-runnable make target in work/<project>/ that exits 0 and "
                         f"prints `{BLK_SENTINEL} {BLK_CLEARED}` once the blocker is "
                         f"gone (or `{BLK_SENTINEL} {BLK_STANDING}` while it is still "
                         "there). Anything else is BROKEN and blocks the loop. Also "
                         "accepted on the `amended` self-edge, where it REPLACES the "
                         "probe in effect — that is how a wrong probe is corrected, "
                         "and how a pre-v145 park is migrated. Rejected on any other "
                         "event. WHY: `blocked` holds the largest share of gross lead "
                         "time of any state, and its only detector used to be a human "
                         "deciding to re-ask — DEF-ROC-004 sat blocked for 28.8 DAYS "
                         "after both of its blockers had already gone.")
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
    lg.add_argument("--max-defer-total-days", dest="max_defer_total_days",
                    type=float, default=DEFAULT_MAX_DEFER_TOTAL_DAYS,
                    help="TOTAL in-queue days after which an IN-DATE `defer_until:` "
                         "stops exempting a backlog item, so re-dating is no longer "
                         "an available answer and it must be scheduled, declined or "
                         f"escalated (default {DEFAULT_MAX_DEFER_TOTAL_DAYS}). A defer "
                         "buys time, not immunity")
    lg.add_argument("--threshold", type=int, default=3,
                    help="retro-debt routine threshold (passed through to the "
                         "retro-debt computation this delegates to)")
    lg.add_argument("--now", help="reference 'now' (ISO-8601 UTC) for deterministic tests")
    lg.set_defaults(func=cmd_loop_gate)

    a = p.parse_args(argv)
    a.func(a)


if __name__ == "__main__":
    main()
