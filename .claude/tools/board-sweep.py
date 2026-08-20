#!/usr/bin/env python3
"""board-sweep.py — the BATCH WRAPPER above the single-item board projection.

DEFECT-OAG-099. The board sweep used to be *orchestration around* the
single-item tool: loop `board-project` over every id, in whatever order the
filesystem produced, writing every item whether or not it needed writing. On the
observed run that spent the rate budget on **269 items that were already
correct** and then ran out — leaving **5 done items showing Blocked**. The same
shape recurred a week later: `UC-CSP1-1` and `UC-CSP1-2`, both TERMINAL, sat
unreconciled for seven days, violating the STAGE F invariant that *a terminal or
blocked board status must never lag its item-file state by more than the current
cycle*.

The single-item projection (`linear-project.py`) is deliberately UNCHANGED: it is
small, testable and credential-safe. This wrapper adds only the four things a
batch needs and a single item cannot know:

  1. ORDER (AC-099.1) — an explicit id list, or a priority order that puts the
     items whose fidelity is REQUIRED first: terminal lag, then parked lag, then
     everything else, most-recently-changed first inside a class. A rate limit is
     a fact of life; losing the important items to one is a design choice.
  2. SKIP (AC-099.2) — an item whose board status already equals its derived
     state is not written at all. This is the only limb that actually *reduces*
     the spend rather than reordering who loses to it.
  3. HONEST SHORTFALL (AC-099.3) — on rate-limit exhaustion, report precisely
     what did not land, by id, in priority order, loudly, and write a resume file
     so the retry starts exactly there.
  4. FAULT HANDLING (AC-099.7) — a rate limit MID-item, two concurrent sweeps, an
     issue a human deleted, a status the workspace does not have, and an item
     added between the read and the write.

It also refuses to run while `STATE_STATUS` has drifted from
`process/machinery/state-graphs.json` (AC-099.4/.5): a state the graph defines
and the mapping lacks is exactly how a terminal item rendered as Backlog twice.
That is a PRECONDITION of the whole sweep, not a per-item surprise.

WHAT THIS DOES NOT CLAIM. It does not make the budget larger. Two of the three
API requests each single-item projection spends are re-reads of IMMUTABLE team
metadata (workflow states + labels) — measured, not assumed, in
board-sweep.test.py. A first full reconcile of ~274 items therefore costs ~822
requests however it is ordered; whether that fits the real budget is a LIVE
measurement (`--budget-probe`), and this tool reports it rather than assuming it.

PROVENANCE — the Linear API is a wire we do not own. Every literal below that we
match against a Linear ERROR is declared `unverified`: no captured real response
confirms it. The property that survives being wrong about them is pinned by test:
an error we do not recognise is classified `other` and is NEVER counted as a
landed write. Fix a literal here only against a real captured response.

STANDARD LIBRARY ONLY. Credential-safe: the api_key is read by this file and by
linear-project.py and is never printed, logged or included in any report.

CLI (see `make board-sweep` / `make board-sweep-plan`):
  board-sweep.py --project P --all
  board-sweep.py --project P --ids UC-A,UC-B --compare full
  board-sweep.py --project P --ids-file .claude/state/board-sweep-P.resume
  board-sweep.py --project P --all --dry-run          # plan + skips, no writes
  board-sweep.py --project P --all --offline-plan     # no network, no secret
"""

import argparse
import json
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]   # tools -> .claude -> repo root
LINEAR_URL = "https://api.linear.app/graphql"

# The single-item projection is imported, never re-implemented (DRY: the mapping
# has exactly one executable home, process/linear-mapping.md its spec).
import importlib.util as _ilu

_spec = _ilu.spec_from_file_location(
    "linear_project", Path(__file__).resolve().parent / "linear-project.py")
lp = _ilu.module_from_spec(_spec)
sys.modules.setdefault("linear_project", lp)
_spec.loader.exec_module(lp)


# --------------------------------------------------------------------------- #
# Exit codes — a sweep's verdict must be mechanically distinguishable
# --------------------------------------------------------------------------- #
EXIT_OK = 0             # everything reconciled; nothing outstanding
EXIT_INCOMPLETE = 2     # ran, but something did not land / was not projectable
EXIT_RATE_LIMITED = 3   # stopped by the rate limit; resume file written
EXIT_LOCKED = 4         # another sweep holds the lock — refused, did not spend
EXIT_PRECONDITION = 5   # refused before spending anything (drift, no ids, ...)


# --------------------------------------------------------------------------- #
# Domain vocabulary (pure)
# --------------------------------------------------------------------------- #
# The STAGE F invariant names these two classes explicitly: a TERMINAL or BLOCKED
# board status must never lag its item file by more than the current cycle. So
# they are the two classes that get the budget first.
TERMINAL_STATES = {"done", "resolved", "wontfix", "cancelled"}
PARKED_STATES = {"blocked", "awaiting_observation"}

CLASS_TERMINAL = 0
CLASS_PARKED = 1
CLASS_ORDINARY = 2
CLASS_NAMES = {CLASS_TERMINAL: "terminal", CLASS_PARKED: "parked",
               CLASS_ORDINARY: "ordinary"}

# PROVENANCE table (see the module docstring). value = confirmed | unverified.
# `confirmed` would require a captured real Linear response; none exists in this
# repo, so every board-side literal is honestly `unverified`.
PROVENANCE = {
    "HTTP 429 => rate-limit": "unverified",
    "RATELIMITED (GraphQL error extension) => rate-limit": "unverified",
    "Entity not found: Issue => stale-mapping": "unverified",
    "rate limit exceeded (prose) => rate-limit": "unverified",
}

_RATE_LIMIT_RE = re.compile(
    r"(http\s*429|\b429\b|ratelimited|rate[\s_-]?limit)", re.IGNORECASE)
_NOT_FOUND_RE = re.compile(
    r"(entity not found|could not find referenced issue|"
    r"no such issue|issue not found)", re.IGNORECASE)


def classify_error(exc):
    """`rate-limit` | `stale-mapping` | `item-missing` | `other`.

    FAIL-LOUD, never fail-quiet: an error shape we do not recognise is `other`,
    which counts as a FAILURE, never as a landed write. Being wrong about a
    literal can only make us stop too early (safe: the shortfall is reported) —
    it can never make us claim an item landed when it did not."""
    if isinstance(exc, FileNotFoundError):
        return "item-missing"
    msg = str(exc)
    if isinstance(exc, (OSError,)) and "not found" in msg.lower() and "item " in msg:
        return "item-missing"
    if _RATE_LIMIT_RE.search(msg):
        return "rate-limit"
    if _NOT_FOUND_RE.search(msg):
        return "stale-mapping"
    return "other"


@dataclass(frozen=True)
class Facts:
    """What the wrapper needs to know about an item to ORDER and COMPARE it.
    Read from the item file (the SSOT) — never from the board."""
    item_id: str
    itype: str
    state: str
    last_ts: str
    sub: str


def _last_event_ts(frontmatter):
    """The most recent `ts:` in the item's event log — the item's last real
    change, which is what "most recently changed" must mean. Absent => epoch."""
    stamps = re.findall(r"\bts:\s*([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z)",
                        frontmatter)
    return max(stamps) if stamps else "0000-00-00T00:00:00Z"


def read_item_facts(project, root=None):
    """{item_id: Facts} for every active + done item of a project."""
    base = Path(root) if root else ROOT
    out = {}
    for sub in ("active", "done"):
        d = base / "work" / project / "items" / sub
        if not d.is_dir():
            continue
        for p in sorted(d.glob("*.md")):
            text = p.read_text(encoding="utf-8")
            fm, _body = lp.split_item(text)
            data = lp.parse_frontmatter(fm)
            iid = data.get("id") or p.stem
            out[iid] = Facts(item_id=iid, itype=data.get("type", ""),
                             state=data.get("state", ""),
                             last_ts=_last_event_ts(fm), sub=sub)
    return out


def priority_class(facts):
    if facts.state in TERMINAL_STATES:
        return CLASS_TERMINAL
    if facts.state in PARKED_STATES:
        return CLASS_PARKED
    return CLASS_ORDINARY


def _ts_ordinal(ts):
    try:
        return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=timezone.utc).timestamp()
    except ValueError:
        return 0.0


def priority_key(facts):
    """(class, most-recent-first, id) — total and deterministic, so two sweeps
    over the same corpus spend the budget on the same items in the same order."""
    return (priority_class(facts), -_ts_ordinal(facts.last_ts), facts.item_id)


@dataclass
class Plan:
    to_write: list
    skipped: list
    unknown_ids: list
    unprojectable: list        # [(item_id, reason)]
    unresolved_status: list    # ids whose desired status does not exist here

    def summary(self):
        return (f"{len(self.to_write)} to write, {len(self.skipped)} already "
                f"correct (skipped), {len(self.unprojectable)} unprojectable, "
                f"{len(self.unresolved_status)} with no workspace status, "
                f"{len(self.unknown_ids)} unknown id(s)")


def board_matches(resolved_status, obj, compare="status", rendered=None):
    """Does the board object already say what the item file says?

    `status`  — status name only. This is AC-099.2's criterion and the cheapest
                honest one. It CANNOT see title/description drift, which is why
                `full` exists and why a periodic `--compare full` sweep is part
                of operating this (documented in the Makefile target).
    `full`    — status + title + description + label set.
    """
    if obj is None:
        return False
    if resolved_status is None:
        # We cannot set the status at all, so we cannot conclude it matches; the
        # item is written anyway so its LABEL lands (linear-mapping §2).
        return False
    if (obj.get("status_name") or "").strip() != resolved_status:
        return False
    if compare == "full":
        if rendered is None:
            return False
        title, description, labels = rendered
        if (obj.get("title") or "") != title:
            return False
        if (obj.get("description") or "") != description:
            return False
        if sorted(obj.get("labels") or []) != sorted(labels or []):
            return False
    return True


def plan_sweep(facts, *, board_lookup, resolver, compare="status",
               renderer=None, explicit=None, order=None):
    """Decide WHO gets written and IN WHAT ORDER. Pure: all board knowledge
    arrives through `board_lookup` / `resolver` callables."""
    if explicit:
        ids = [i for i in explicit if i in facts]
        unknown = [i for i in explicit if i not in facts]
        ordering = order or "explicit"
    else:
        ids = list(facts)
        unknown = []
        ordering = order or "priority"

    to_write, skipped, unprojectable, unresolved = [], [], [], []
    for iid in ids:
        f = facts[iid]
        try:
            candidates = lp.desired_status_names(f.itype, f.state)
        except lp.UnmappedStateError as e:
            # AC-099.4: refused, by id, with the reason. NEVER written as Backlog.
            unprojectable.append((iid, str(e)))
            continue
        resolved = resolver(candidates)
        if resolved is None:
            unresolved.append(iid)
        rendered = renderer(iid) if (compare == "full" and renderer) else None
        if board_matches(resolved, board_lookup(iid), compare, rendered):
            skipped.append(iid)
        else:
            to_write.append(iid)

    if ordering == "priority":
        to_write.sort(key=lambda i: priority_key(facts[i]))
        skipped.sort()
    return Plan(to_write=to_write, skipped=skipped, unknown_ids=unknown,
                unprojectable=unprojectable, unresolved_status=unresolved)


# --------------------------------------------------------------------------- #
# Result + report
# --------------------------------------------------------------------------- #
@dataclass
class Result:
    landed: list
    skipped: list
    failures: list          # [(id, class, message)]
    not_landed: list        # [(id, outcome, message)] — outcome: indeterminate
                            # | not-attempted
    stopped_reason: object
    unknown_ids: list
    unprojectable: list
    unresolved_status: list
    appeared_after: list
    vanished: list
    budget: object
    notes: list = field(default_factory=list)

    @property
    def not_landed_ids(self):
        return [i for i, _o, _m in self.not_landed]

    @property
    def outstanding_ids(self):
        """Everything the NEXT sweep still owes, in priority order: the items the
        rate limit took first, then per-item failures, then anything that
        appeared after the snapshot."""
        seen, out = set(), []
        for iid in (self.not_landed_ids + [i for i, _c, _m in self.failures]
                    + self.appeared_after):
            if iid not in seen:
                seen.add(iid)
                out.append(iid)
        return out

    @property
    def exit_code(self):
        if self.stopped_reason == "rate-limit":
            return EXIT_RATE_LIMITED
        if (self.failures or self.not_landed or self.unknown_ids
                or self.unprojectable or self.unresolved_status
                or self.appeared_after or self.vanished):
            return EXIT_INCOMPLETE
        return EXIT_OK


def format_report(res, project, plan=None):
    """The loud part. A shortfall a human has to go looking for is the defect."""
    L = []
    L.append(f"board-sweep[{project}] — {len(res.landed)} written, "
             f"{len(res.skipped)} already correct (skipped), "
             f"{len(res.failures)} failed, {len(res.not_landed)} NOT reconciled")
    if res.budget:
        b = res.budget
        if b.get("established"):
            L.append(f"   budget: limit={b.get('limit')} "
                     f"remaining={b.get('remaining')} "
                     f"spent_this_sweep={b.get('spent', '?')}")
        else:
            L.append("   budget: NOT ESTABLISHED — the API returned no "
                     "rate-limit headers, so the real budget is unmeasured "
                     "(this tool will not guess it)")
    if res.stopped_reason == "rate-limit":
        L.append("")
        L.append(f"!! RATE LIMIT — the sweep STOPPED with "
                 f"{len(res.not_landed)} item(s) NOT reconciled. In priority "
                 f"order (highest fidelity need first):")
        for iid, outcome, msg in res.not_landed:
            extra = " (write may or may not have landed — NOT ESTABLISHED)" \
                if outcome == "indeterminate" else ""
            L.append(f"     - {iid} [{outcome}]{extra}")
        L.append("   These items' board status still LAGS their item file. "
                 "Re-run with --ids-file <resume> to resume exactly here.")
    if res.failures:
        L.append("")
        L.append(f"!! {len(res.failures)} FAILED item(s) (not a rate limit — "
                 f"these need a look):")
        for iid, cls, msg in res.failures:
            L.append(f"     - {iid} [{cls}] {msg}")
    if res.unprojectable:
        L.append("")
        L.append(f"!! {len(res.unprojectable)} UNPROJECTABLE item(s) — a state "
                 f"the mapping does not cover. REFUSED rather than rendered as "
                 f"Backlog (AC-099.4):")
        for iid, reason in res.unprojectable:
            L.append(f"     - {iid}: {reason.splitlines()[0]}")
    if res.unresolved_status:
        L.append("")
        L.append(f"!! STATUS NOT SET for {len(res.unresolved_status)} item(s) — "
                 f"this workspace has none of the mapped status names, so only "
                 f"the LABEL carries the meaning (linear-mapping §2):")
        for iid in res.unresolved_status:
            L.append(f"     - {iid}")
    if res.appeared_after:
        L.append("")
        L.append(f"!! {len(res.appeared_after)} item(s) APPEARED AFTER the "
                 f"snapshot read and were never considered: "
                 f"{', '.join(res.appeared_after)}")
    if res.vanished:
        L.append("")
        L.append(f"!! {len(res.vanished)} item(s) VANISHED mid-sweep (file gone): "
                 f"{', '.join(res.vanished)}")
    if res.unknown_ids:
        L.append("")
        L.append(f"!! {len(res.unknown_ids)} requested id(s) have no item file: "
                 f"{', '.join(res.unknown_ids)}")
    for n in res.notes:
        L.append(f"   note: {n}")
    if res.exit_code == EXIT_OK:
        L.append("")
        L.append("OK — every requested item's board status now matches its item "
                 "file; nothing outstanding.")
    return "\n".join(L)


# --------------------------------------------------------------------------- #
# Resume list (the retry's input)
# --------------------------------------------------------------------------- #
def read_ids_file(path):
    p = Path(path)
    if not p.exists():
        return []
    ids = []
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            ids.append(line)
    return ids


def write_ids_file(path, ids, header=None):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    body = ""
    if header:
        body += f"# {header}\n"
    body += "".join(f"{i}\n" for i in ids)
    p.write_text(body, encoding="utf-8")
    return p


# --------------------------------------------------------------------------- #
# Concurrency (AC-099.7b) — two sweeps must not double-spend one budget
# --------------------------------------------------------------------------- #
class SweepLocked(Exception):
    pass


@dataclass
class Lock:
    path: Path
    action: str          # acquired | stolen
    token: str
    message: str = ""


def _lock_payload():
    return {"pid": os.getpid(), "host": socket.gethostname(),
            "started": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "token": f"{socket.gethostname()}:{os.getpid()}:{time.time()}"}


def _pid_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except Exception:
        return True
    return True


def acquire_lock(path, stale_seconds=1800):
    """Advisory lock. A crashed sweep must not wedge the board for ever, so a
    lock whose file is older than `stale_seconds` — or whose holder process on
    THIS host is gone — is broken, loudly."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = _lock_payload()

    def _create():
        fd = os.open(str(p), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh)
        return payload["token"]

    try:
        return Lock(path=p, action="acquired", token=_create())
    except FileExistsError:
        pass

    age = max(0.0, time.time() - p.stat().st_mtime)
    try:
        held = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        held = {}
    steal_reason = None
    if age > stale_seconds:
        steal_reason = (f"stale lock broken: age {int(age)}s > "
                        f"{stale_seconds}s (holder pid={held.get('pid')} "
                        f"host={held.get('host')})")
    elif (held.get("host") == socket.gethostname()
            and isinstance(held.get("pid"), int)
            and not _pid_alive(held["pid"])):
        steal_reason = (f"stale lock broken: holder pid {held.get('pid')} on "
                        f"this host is gone")
    if steal_reason is None:
        raise SweepLocked(
            f"another board-sweep is already running (pid={held.get('pid')} "
            f"host={held.get('host')} started={held.get('started')}, lock age "
            f"{int(age)}s). REFUSED without spending any budget — two sweeps "
            f"would double-spend one rate limit and race the id->issue map. "
            f"If that sweep is dead, delete {p} or lower --lock-stale-seconds.")
    try:
        p.unlink()
    except FileNotFoundError:
        pass
    return Lock(path=p, action="stolen", token=_create(), message=steal_reason)


def release_lock(path, held):
    p = Path(path)
    try:
        cur = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return False
    if held is not None and cur.get("token") != held.token:
        return False       # someone else's lock — never remove it
    try:
        p.unlink()
    except FileNotFoundError:
        return False
    return True


# --------------------------------------------------------------------------- #
# Preconditions (AC-099.4 / AC-099.5)
# --------------------------------------------------------------------------- #
def check_preconditions(graphs=None):
    """The sweep REFUSES to run while the state->status table has drifted from
    the state graph. A state the graph defines and the mapping lacks is exactly
    the shape that rendered `cancelled` and then `awaiting_observation` as
    unstarted Backlog. Checking it per item makes it a surprise mid-spend;
    checking it here makes it a refusal that costs nothing."""
    findings = []
    for kind, itype, state in lp.audit_state_status(graphs):
        if kind == "unmapped":
            findings.append(
                f"UNMAPPED {itype}/{state}: state-graphs.json defines it, "
                f"STATE_STATUS does not — it would render as Backlog. Add the "
                f"row to STATE_STATUS (.claude/tools/linear-project.py) AND to "
                f"process/linear-mapping.md §2 in the same commit.")
        elif kind == "unknown-state":
            findings.append(
                f"STALE-KEY {itype}/{state}: STATE_STATUS maps a state the "
                f"graph does not define — editorial drift hides real gaps.")
        else:
            findings.append(f"UNTYPED {itype}: graph type has no STATE_STATUS table")
    return findings


# --------------------------------------------------------------------------- #
# Budget (the question we refuse to assume the answer to)
# --------------------------------------------------------------------------- #
def parse_budget_headers(headers):
    """Linear returns its rate budget in response headers. If they are absent we
    say NOT ESTABLISHED — we never substitute a documented number for a
    measured one."""
    low = {str(k).lower(): v for k, v in dict(headers).items()}

    def _int(*names):
        for n in names:
            if n in low:
                try:
                    return int(str(low[n]).strip())
                except ValueError:
                    return None
        return None

    limit = _int("x-ratelimit-requests-limit", "x-ratelimit-limit")
    remaining = _int("x-ratelimit-requests-remaining", "x-ratelimit-remaining")
    reset = _int("x-ratelimit-requests-reset", "x-ratelimit-reset")
    complexity = _int("x-complexity", "x-ratelimit-complexity-remaining")
    return {"established": limit is not None or remaining is not None,
            "limit": limit, "remaining": remaining, "reset": reset,
            "complexity_remaining": complexity}


def probe_budget(api_key):
    """ONE cheap request (`{viewer{id}}`) to read the rate-limit headers. Costs
    a single unit of the thing it measures, which is the cheapest honest way to
    answer "is the budget big enough". Never raises: an unmeasurable budget is
    reported as NOT ESTABLISHED, not as an error that stops the sweep."""
    payload = json.dumps({"query": "{viewer{id}}"}).encode()
    req = urllib.request.Request(
        LINEAR_URL, data=payload,
        headers={"Authorization": api_key, "Content-Type": "application/json"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp.read()
            return parse_budget_headers(resp.headers)
    except urllib.error.HTTPError as e:
        got = parse_budget_headers(getattr(e, "headers", {}) or {})
        got["http_status"] = e.code
        return got
    except Exception as e:
        return {"established": False, "limit": None, "remaining": None,
                "reset": None, "complexity_remaining": None,
                "error": type(e).__name__}


def estimate_budget(items_to_write, requests_per_write, snapshot_requests=0):
    """The arithmetic, stated rather than implied. `requests_per_write` is
    MEASURED against the real single-item path in board-sweep.test.py — it is
    not a guess, and if the projection's call pattern changes the test moves."""
    total = items_to_write * requests_per_write + snapshot_requests
    return {"items_to_write": items_to_write,
            "requests_per_write": requests_per_write,
            "snapshot_requests": snapshot_requests,
            "total_requests": total}


# --------------------------------------------------------------------------- #
# The sweep itself
# --------------------------------------------------------------------------- #
def drop_mapping(secrets_path, item_id):
    """Forget a dead id->issue mapping so the next projection CREATES a fresh
    issue. Reads and rewrites the secrets file WITHOUT ever printing it."""
    p = Path(secrets_path)
    data = json.loads(p.read_text(encoding="utf-8"))
    if item_id in data.get("id_to_issue", {}):
        data["id_to_issue"].pop(item_id)
        tmp = p.with_suffix(p.suffix + ".tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n",
                       encoding="utf-8")
        os.replace(tmp, p)
        return True
    return False


def run_sweep(plan, write, *, root=None, project=None, resume_path=None,
              secrets_path=None, heal_stale_mappings=True, snapshot_ids=None,
              max_writes=None, budget=None, printer=None):
    """Walk `plan.to_write` IN ORDER, writing via `write(item_id)`.

    Stops dead on a rate limit (every further call would 429 anyway) and reports
    the shortfall. Everything else is per-item: one bad item never costs the rest
    of the priority list its turn."""
    say = printer or (lambda *_a, **_k: None)
    landed, failures, not_landed, vanished, notes = [], [], [], [], []
    stopped = None
    queue = list(plan.to_write)

    def _rate_limited_at(idx, iid, msg):
        # AC-099.7a: a 429 raised AFTER a partial write is indistinguishable from
        # one raised before it. We refuse to guess: the item is INDETERMINATE and
        # goes FIRST in the resume list. The projection is idempotent, so the
        # retry converges; claiming it landed would be the only unrecoverable
        # answer.
        not_landed.append((iid, "indeterminate", msg))
        for later in queue[idx + 1:]:
            not_landed.append((later, "not-attempted", "stopped by rate limit"))

    for idx, iid in enumerate(queue):
        if max_writes is not None and len(landed) >= max_writes:
            not_landed.append((iid, "not-attempted",
                              f"--max-writes {max_writes} reached"))
            for later in queue[idx + 1:]:
                not_landed.append((later, "not-attempted",
                                   f"--max-writes {max_writes} reached"))
            stopped = "max-writes"
            break
        try:
            write(iid)
            landed.append(iid)
            say(f"  wrote  {iid}")
            continue
        except Exception as exc:
            kind = classify_error(exc)
            msg = str(exc)

        if kind == "rate-limit":
            _rate_limited_at(idx, iid, msg)
            stopped = "rate-limit"
            say(f"  RATE-LIMITED at {iid}")
            break

        if kind == "item-missing":
            vanished.append(iid)
            notes.append(f"{iid}: item file vanished mid-sweep — skipped, not fatal")
            say(f"  vanished {iid}")
            continue

        if kind == "stale-mapping":
            if heal_stale_mappings and secrets_path:
                healed = drop_mapping(secrets_path, iid)
                notes.append(
                    f"{iid}: stale-mapping — the mapped Linear issue is gone "
                    f"(deleted?); mapping {'dropped' if healed else 'already absent'}"
                    f", retrying so a fresh issue is created")
                try:
                    write(iid)
                    landed.append(iid)
                    say(f"  wrote  {iid} (after stale-mapping heal)")
                    continue
                except Exception as exc2:
                    kind2 = classify_error(exc2)
                    if kind2 == "rate-limit":
                        _rate_limited_at(idx, iid, str(exc2))
                        stopped = "rate-limit"
                        break
                    failures.append((iid, kind2, str(exc2)))
                    continue
            failures.append((iid, "stale-mapping", msg))
            continue

        failures.append((iid, kind, msg))
        say(f"  FAILED {iid}: {msg}")

    appeared_after = []
    if snapshot_ids is not None and project:
        now_ids = set(read_item_facts(project, root=root))
        appeared_after = sorted(now_ids - set(snapshot_ids))

    res = Result(landed=landed, skipped=list(plan.skipped), failures=failures,
                 not_landed=not_landed, stopped_reason=stopped,
                 unknown_ids=list(plan.unknown_ids),
                 unprojectable=list(plan.unprojectable),
                 unresolved_status=list(plan.unresolved_status),
                 appeared_after=appeared_after, vanished=vanished,
                 budget=budget, notes=notes)
    if resume_path is not None:
        write_ids_file(
            resume_path, res.outstanding_ids,
            header=("board-sweep resume list (priority order) — "
                    f"{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}"
                    f"; re-run with --ids-file to resume exactly here"))
    return res


# --------------------------------------------------------------------------- #
# Linear adapters (the only part that touches the network)
# --------------------------------------------------------------------------- #
_ISSUES_Q = """
query($t:String!,$c:String){
  team(id:$t){
    issues(first:100, after:$c, includeArchived:true){
      pageInfo{hasNextPage endCursor}
      nodes{id identifier title description state{name} labels{nodes{name}}}
    }
  }
}"""


def fetch_board_snapshot(api_key, team_id, page_query=None):
    """One paginated READ of the whole team's issues -> {issue_id: object}.

    ~1 request per 100 issues, versus the 3-per-item the write path costs. This
    read is what makes the SKIP possible, and the skip is what actually reduces
    the spend."""
    snapshot, cursor, pages = {}, None, 0
    while True:
        data = (page_query or lp.graphql)(api_key, _ISSUES_Q,
                                          {"t": team_id, "c": cursor})
        conn = data["team"]["issues"]
        pages += 1
        for n in conn["nodes"]:
            snapshot[n["id"]] = {
                "id": n["id"], "identifier": n.get("identifier"),
                "title": n.get("title") or "",
                "description": n.get("description") or "",
                "status_name": ((n.get("state") or {}).get("name") or ""),
                "labels": [x["name"] for x in
                           ((n.get("labels") or {}).get("nodes") or [])],
            }
        if not conn["pageInfo"]["hasNextPage"]:
            return snapshot, pages
        cursor = conn["pageInfo"]["endCursor"]


def make_resolver(workflow_state_names):
    """The mapping's candidate list is a PREFERENCE order (linear-mapping §2:
    Blocked -> else Todo -> else Backlog). The resolver returns the first name
    this workspace actually has, or None when it has none of them."""
    have = {n.lower(): n for n in workflow_state_names}

    def resolve(candidates):
        for c in candidates:
            if c.lower() in have:
                return have[c.lower()]
        return None
    return resolve


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def default_resume_path(project, root=None):
    return (Path(root) if root else ROOT) / ".claude" / "state" / \
        f"board-sweep-{project}.resume"


def default_lock_path(project, root=None):
    return (Path(root) if root else ROOT) / ".claude" / "state" / \
        f"board-sweep-{project}.lock"


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Reconcile a project's whole board, spending a finite rate "
                    "budget on the items whose fidelity is required FIRST.")
    ap.add_argument("--project", required=False,
                    help="required except for --audit-mapping")
    ap.add_argument("--audit-mapping", action="store_true",
                    help="ONLY check that every state in state-graphs.json has a "
                         "board-status mapping row, and exit (AC-099.5). No "
                         "project, no corpus, no network, no secret — so it can "
                         "run in any workflow. Non-zero (5) on any drift.")
    ap.add_argument("--graphs", default=None,
                    help="alternate state-graphs.json (the drift gate's own test "
                         "drives the real CLI against an injected state)")
    g = ap.add_argument_group("which items, in what order (AC-099.1)")
    g.add_argument("--ids", default=None,
                   help="comma-separated ids, in the order you want them "
                        "written (highest fidelity need first)")
    g.add_argument("--ids-file", default=None,
                   help="one id per line, order honoured — this is what a "
                        "resume file is")
    g.add_argument("--all", action="store_true",
                   help="every active+done item, in PRIORITY order")
    g.add_argument("--order", choices=["priority", "explicit"], default=None,
                   help="default: explicit when --ids/--ids-file is given, "
                        "priority otherwise")
    ap.add_argument("--compare", choices=["status", "full"], default="status",
                    help="skip predicate (AC-099.2). `status` is cheap and is "
                         "the acceptance criterion; `full` also compares "
                         "title/description/labels — run it periodically to "
                         "catch description drift the status compare cannot see.")
    ap.add_argument("--max-writes", type=int, default=None,
                    help="self-imposed budget cap: stop after N writes and "
                         "report the remainder (a rate limit you chose)")
    ap.add_argument("--dry-run", action="store_true",
                    help="read the board, plan, report — write nothing")
    ap.add_argument("--offline-plan", action="store_true",
                    help="no network and no secret: show the PRIORITY ORDER "
                         "only (every item counts as needing a write)")
    ap.add_argument("--no-heal-stale-mappings", dest="heal", default=True,
                    action="store_false",
                    help="do not drop the id->issue mapping when Linear says "
                         "the issue is gone (default: heal and retry once)")
    ap.add_argument("--budget-probe", dest="budget_probe", default=True,
                    action="store_true", help="(default) measure the real rate "
                    "budget before and after, from the API's own headers")
    ap.add_argument("--no-budget-probe", dest="budget_probe",
                    action="store_false")
    ap.add_argument("--resume-file", default=None)
    ap.add_argument("--lock-file", default=None)
    ap.add_argument("--lock-stale-seconds", type=int, default=1800)
    ap.add_argument("--root", default=None,
                    help="alternate repo root (tests drive the real CLI)")
    args = ap.parse_args(argv)

    root = Path(args.root) if args.root else ROOT
    graphs = lp.load_state_graphs(args.graphs) if args.graphs else None

    if args.audit_mapping:
        findings = check_preconditions(graphs)
        if findings:
            print(f"board-mapping gate FAILED — {len(findings)} state(s) in "
                  f"state-graphs.json have no board-status mapping row. An "
                  f"unmapped state renders as unstarted Backlog, which has now "
                  f"happened twice (cancelled, awaiting_observation):")
            for f in findings:
                print(f"  - {f}")
            return EXIT_PRECONDITION
        print("board-mapping gate CLEAN — every state in state-graphs.json has "
              "a board-status row (both directions).")
        return EXIT_OK

    if not args.project:
        ap.error("--project is required (or use --audit-mapping)")
    lp.ROOT = root          # the single-item tool reads the same corpus
    project = args.project

    findings = check_preconditions(graphs)
    if findings:
        print("board-sweep REFUSED — the state->board-status mapping has "
              "drifted from process/machinery/state-graphs.json. A drifted "
              "table renders real states as unstarted Backlog, which is the "
              "defect this sweep exists to stop reproducing:", file=sys.stderr)
        for f in findings:
            print(f"  - {f}", file=sys.stderr)
        return EXIT_PRECONDITION

    explicit = None
    if args.ids:
        explicit = [i.strip() for i in args.ids.split(",") if i.strip()]
    elif args.ids_file:
        explicit = read_ids_file(args.ids_file)
        if not explicit:
            print(f"board-sweep: {args.ids_file} names no ids — nothing "
                  f"outstanding. Nothing to do.")
            return EXIT_OK
    elif not args.all:
        print("board-sweep: give --ids, --ids-file or --all (refusing to guess "
              "which items matter)", file=sys.stderr)
        return EXIT_PRECONDITION

    facts = read_item_facts(project, root=root)
    if not facts:
        print(f"board-sweep: no items under work/{project}/items/ — nothing to "
              f"do (is this the integration tree?)", file=sys.stderr)
        return EXIT_PRECONDITION
    snapshot_ids = sorted(facts)

    if args.offline_plan:
        plan = plan_sweep(facts, board_lookup=lambda i: None,
                          resolver=lambda names: names[0], explicit=explicit,
                          order=args.order)
        print(f"board-sweep[{project}] OFFLINE PLAN (no network, no secret) — "
              f"ORDER ONLY: with no board read nothing can be known to already "
              f"match, so every item counts as needing a write. "
              f"{len(plan.to_write)} in order, "
              f"{len(plan.unprojectable)} unprojectable, "
              f"{len(plan.unknown_ids)} unknown id(s).")
        for i, iid in enumerate(plan.to_write, 1):
            print(f"  {i:4d}. {iid}  [{CLASS_NAMES[priority_class(facts[iid])]}]"
                  f"  state={facts[iid].state}")
        for iid, reason in plan.unprojectable:
            print(f"  !! UNPROJECTABLE {iid}: {reason.splitlines()[0]}")
        for iid in plan.unknown_ids:
            print(f"  !! UNKNOWN ID {iid}: no item file under "
                  f"work/{project}/items/ — nothing to project")
        est = estimate_budget(len(plan.to_write), 3, 0)
        print(f"  estimated cost: {est['total_requests']} API requests "
              f"({est['requests_per_write']}/item, measured — see "
              f"board-sweep.test.py)")
        if plan.unprojectable or plan.unknown_ids:
            return EXIT_INCOMPLETE
        return EXIT_OK

    secrets_path = root / "work" / project / "secrets" / "linear.json"
    if not secrets_path.exists():
        print(f"board-sweep: no Linear binding for {project} "
              f"(secrets/linear.json absent) — nothing to do")
        return EXIT_OK
    secrets = json.loads(secrets_path.read_text(encoding="utf-8"))
    api_key, team_id = secrets["api_key"], secrets["team_id"]

    lock_path = Path(args.lock_file) if args.lock_file else \
        default_lock_path(project, root)
    try:
        held = acquire_lock(lock_path, args.lock_stale_seconds)
    except SweepLocked as e:
        print(f"board-sweep REFUSED: {e}", file=sys.stderr)
        return EXIT_LOCKED
    if held.action == "stolen":
        print(f"board-sweep: {held.message}")

    try:
        before = probe_budget(api_key) if args.budget_probe else None
        snapshot, pages = fetch_board_snapshot(api_key, team_id)
        states = lp.team_states(api_key, team_id)
        resolver = make_resolver([s["name"] for s in states])
        id_to_issue = secrets.get("id_to_issue", {})

        def board_lookup(item_id):
            entry = lp.normalize_entry(id_to_issue.get(item_id))
            if not entry or entry.get("type") != "issue":
                return None
            return snapshot.get(entry.get("id"))

        renderer = None
        if args.compare == "full":
            def renderer(iid):
                title, desc, labels, _st, _item = lp.compose(project, iid)
                return title, desc, labels

        plan = plan_sweep(facts, board_lookup=board_lookup, resolver=resolver,
                          compare=args.compare, renderer=renderer,
                          explicit=explicit, order=args.order)
        print(f"board-sweep[{project}] plan: {plan.summary()} "
              f"(board read in {pages} request(s))")

        if args.dry_run:
            for i, iid in enumerate(plan.to_write, 1):
                print(f"  {i:4d}. would write {iid} "
                      f"[{CLASS_NAMES[priority_class(facts[iid])]}] "
                      f"state={facts[iid].state}")
            est = estimate_budget(len(plan.to_write), 3, pages)
            print(f"  estimated cost: {est['total_requests']} API requests")
            if before:
                print(f"  budget before: {before}")
            return EXIT_OK

        resume = Path(args.resume_file) if args.resume_file else \
            default_resume_path(project, root)
        res = run_sweep(plan, lambda iid: lp.upsert(project, iid), root=root,
                        project=project, resume_path=resume,
                        secrets_path=secrets_path,
                        heal_stale_mappings=args.heal,
                        snapshot_ids=snapshot_ids, max_writes=args.max_writes,
                        printer=print)
        if args.budget_probe:
            after = probe_budget(api_key)
            if before and before.get("remaining") is not None \
                    and after.get("remaining") is not None:
                after["spent"] = before["remaining"] - after["remaining"]
            res.budget = after
        print(format_report(res, project))
        if res.outstanding_ids:
            print(f"  resume: {resume}")
        return res.exit_code
    finally:
        release_lock(lock_path, held)


if __name__ == "__main__":
    sys.exit(main())
