#!/usr/bin/env python3
"""board_project.py — v82-native, SINGLE-ITEM Linear board projection.

Hexagonal:
  DOMAIN  = the item-file → board-object projection (parse_item, status_for,
            issue_title, label_names, issue_description, upsert). Pure; imports
            no transport type.
  ADAPTER = LinearAdapter — the ONLY thing that touches the GraphQL transport
            (urllib). It is injected into upsert(), so the domain is unit-tested
            with a fake adapter and no network.

The work item is the SINGLE SOURCE OF TRUTH. This tool is a pure, idempotent,
ONE-WAY projection: read one item file, upsert its one Linear issue, done. It
NEVER writes item state and NEVER re-reads the whole board.

CLI:
  board-project --project <p> --item <ID> [--dry-run | --live]
  (default is --dry-run: read-only, print the planned mutation.)

Key handling: read_api_key() loads work/<project>/secrets/linear.local.json at
RUNTIME. The key value NEVER appears in a command string, a log line, or an
error, and NEVER is interpolated into the GraphQL query/variables — it reaches
the wire only via the Authorization request header. If the secrets file / key
is missing the tool STOPS with a clear message (no inlined-key fallback).

Supersedes the retired per-project scripts/sync-linear.py (v82 cutover). Jira
parity is a fast-follow (not built here).
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Optional

LINEAR_ENDPOINT = "https://api.linear.app/graphql"

# repo root = four levels up from this file
# (.claude/skills/board-projection/scripts/board_project.py -> repo root)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", "..", ".."))


def project_root(project: str) -> str:
    return os.path.join(REPO_ROOT, "work", project)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------
class MappingError(RuntimeError):
    pass


class LinearError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# State → board status (canonical: process/linear-mapping.md; states from
# process/machinery/state-graphs.json). ALL v82 states covered.
# ---------------------------------------------------------------------------
_FLOW = {  # use-case
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
_DEFECT = {
    "reported": "Backlog",
    "reproducing": "In Progress",
    "fixing": "In Progress",
    "validating": "In Review",
    "blocked": "Blocked",
    "resolved": "Done",
    "wontfix": "Cancelled",
    "cancelled": "Cancelled",
}
_OPEN_ITEM = {
    "open": "Backlog",
    "scheduled": "Ready",
    "done": "Done",
    "wontfix": "Cancelled",
    "cancelled": "Cancelled",
}
_AGGREGATE = {  # slice / chunk / requirement (derived from children)
    "planned": "Backlog",
    "in_progress": "In Progress",
    "done": "Done",
    "cancelled": "Cancelled",
}
_TABLES = {
    "use-case": _FLOW,
    "defect": _DEFECT,
    "open-item": _OPEN_ITEM,
    "slice": _AGGREGATE,
    "chunk": _AGGREGATE,
    "requirement": _AGGREGATE,
}


def status_for(item_type: str, state: str) -> str:
    table = _TABLES.get(item_type)
    if table is None:
        raise MappingError(f"unknown item type: {item_type!r}")
    status = table.get(state)
    if status is None:
        raise MappingError(f"unmapped state {state!r} for type {item_type!r}")
    return status


# ---------------------------------------------------------------------------
# Item parsing (minimal, stdlib-only — no PyYAML). Tailored to the v82 item
# file shape: YAML frontmatter (scalars + flow lists + an events block-list +
# a nested derived block) then a markdown Definition body.
# ---------------------------------------------------------------------------
@dataclass
class Item:
    id: str
    type: str
    state: str
    title: str
    parents: list = field(default_factory=list)
    job: Optional[str] = None
    body: str = ""
    blocked_note: Optional[str] = None
    has_acceptance: bool = False


def _split_frontmatter(text: str) -> tuple[str, str]:
    """Return (frontmatter, body). Frontmatter is the first `---`…`---` block."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return "", text
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return "\n".join(lines[1:i]), "\n".join(lines[i + 1:])
    return "\n".join(lines[1:]), ""


def _scalar(fm: str, key: str) -> Optional[str]:
    """A column-0 top-level `key: value` scalar (quotes stripped)."""
    m = re.search(rf"^{re.escape(key)}:[ \t]*(.*)$", fm, re.MULTILINE)
    if not m:
        return None
    v = m.group(1).strip()
    if v == "" or v.startswith("#"):
        return None
    if (v.startswith('"') and v.endswith('"')) or \
       (v.startswith("'") and v.endswith("'")):
        v = v[1:-1]
    return v


def _flow_list(fm: str, key: str) -> list:
    """A column-0 `key: [a, b, c]` flow list."""
    m = re.search(rf"^{re.escape(key)}:[ \t]*\[(.*)\]", fm, re.MULTILINE)
    if not m:
        return []
    inner = m.group(1).strip()
    if not inner:
        return []
    return [x.strip().strip('"').strip("'") for x in inner.split(",") if x.strip()]


def _derived_state(fm: str) -> Optional[str]:
    """The `state:` scalar nested under the `derived:` key."""
    idx = fm.find("\nderived:")
    if idx == -1 and fm.startswith("derived:"):
        idx = 0
    if idx == -1:
        return None
    block = fm[idx:]
    m = re.search(r"^\s+state:[ \t]*(.*)$", block, re.MULTILINE)
    if not m:
        return None
    return m.group(1).strip().strip('"').strip("'")


def _flow_map_field(entry: str, key: str) -> Optional[str]:
    """Extract `key: value` from a single `{...}` YAML flow-mapping line,
    tolerating commas/colons inside a (optionally quoted) value that runs to the
    closing brace or the next top-level field."""
    body = entry.strip()
    if body.startswith("{"):
        body = body[1:]
    if body.endswith("}"):
        body = body[:-1]
    m = re.search(rf"(?:^|,)\s*{re.escape(key)}:\s*", body)
    if not m:
        return None
    rest = body[m.end():]
    if rest.startswith('"'):
        end = rest.find('"', 1)
        return rest[1:end] if end != -1 else rest[1:]
    if rest.startswith("'"):
        end = rest.find("'", 1)
        return rest[1:end] if end != -1 else rest[1:]
    # unquoted: to the next `, <word>:` boundary or end
    m2 = re.search(r",\s*[A-Za-z_][\w-]*:\s", rest)
    return (rest[:m2.start()] if m2 else rest).strip()


def _latest_blocked_note(fm: str) -> Optional[str]:
    """The note of the most recent `event: blocked` entry in the events list."""
    note = None
    for line in fm.splitlines():
        s = line.strip()
        if not s.startswith("- {"):
            continue
        ev = _flow_map_field(s[2:], "event")
        if ev == "blocked":
            note = _flow_map_field(s[2:], "note")
    return note


def _title_from_body(body: str) -> str:
    """Fallback title: the first meaningful line of the body, stripped of
    markdown heading/bold/blockquote/italic markers."""
    for raw in body.splitlines():
        s = raw.strip()
        if not s:
            continue
        if s.startswith("## Definition"):
            continue
        s = re.sub(r"^#+\s*", "", s)          # heading
        s = re.sub(r"^>\s*", "", s)           # blockquote
        s = s.strip("*_ ")                     # bold/italic
        if s:
            return s
    return ""


def _has_acceptance(body: str) -> bool:
    if re.search(r"^#+\s*Acceptance", body, re.MULTILINE | re.IGNORECASE):
        return True
    return bool(re.search(r"\bAC-[A-Za-z0-9.\-]+", body))


def parse_item(text: str) -> Item:
    fm, body = _split_frontmatter(text)
    iid = _scalar(fm, "id") or ""
    itype = _scalar(fm, "type") or ""
    state = _derived_state(fm) or ""
    # Title: prefer the clean frontmatter `title:` (present + authoritative in
    # every real v82 item; some items — e.g. UC-XA4 — have no `## Definition`
    # heading, so body-first extraction would yield a garbage title). Fall back
    # to the body's first meaningful line when frontmatter carries no title.
    title = _scalar(fm, "title") or _title_from_body(body)
    parents = _flow_list(fm, "parents")
    job = _scalar(fm, "job")
    blocked_note = _latest_blocked_note(fm) if state == "blocked" else None
    return Item(
        id=iid, type=itype, state=state, title=title, parents=parents,
        job=job, body=body, blocked_note=blocked_note,
        has_acceptance=_has_acceptance(body),
    )


# ---------------------------------------------------------------------------
# Board-object shaping (pure)
# ---------------------------------------------------------------------------
def issue_title(item: Item) -> str:
    return f"{item.id} · {item.title}".rstrip(" ·")


def label_names(item: Item) -> list:
    out = []
    if item.type == "defect":
        out.append("defect")
    if item.type == "open-item":
        out.append("open-item")
    if item.type == "use-case" and not item.has_acceptance:
        out.append("needs-acceptance")
    if item.state == "blocked":
        out.append("blocked")
    if item.job:
        out.append(f"job:{item.job}")
    return out


def blocked_banner(reason: Optional[str]) -> str:
    if reason:
        return f"> 🚫 **Blocked:** {reason}\n\n"
    return ("> 🚫 **Blocked** — _reason not recorded on the latest `blocked` "
            "event._\n\n")


def issue_description(item: Item) -> str:
    parts = []
    if item.state == "blocked":
        parts.append(blocked_banner(item.blocked_note))
    parts.append(f"_Projected from work item **{item.id}** "
                 f"(type: {item.type}, state: {item.state}). The item file is "
                 f"the single source of truth; do not edit status here._\n")
    body = item.body.strip()
    if body:
        parts.append("\n---\n\n" + body)
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Map cache + config + key
# ---------------------------------------------------------------------------
def config_path(project: str) -> str:
    return os.path.join(project_root(project), ".linear-config.json")


def map_path(project: str) -> str:
    return os.path.join(project_root(project), ".linear-map.json")


def secrets_path(project: str) -> str:
    return os.path.join(project_root(project), "secrets", "linear.local.json")


def load_config(project: str) -> dict:
    p = config_path(project)
    if not os.path.exists(p):
        raise SystemExit(
            f"no Linear binding for project {project!r}: missing {p}. "
            "Linear is optional per project — nothing to project.")
    with open(p) as f:
        return json.load(f)


def load_map(project: str) -> dict:
    p = map_path(project)
    if os.path.exists(p):
        with open(p) as f:
            m = json.load(f)
    else:
        m = {}
    m.setdefault("issues", {})
    m.setdefault("labels", {})
    m.setdefault("states", {})
    m.setdefault("milestones", {})
    m.setdefault("milestone_chunk", {})
    m.setdefault("projects", {})
    m.setdefault("blocked", {})
    return m


def save_map(project: str, m: dict) -> None:
    with open(map_path(project), "w") as f:
        json.dump(m, f, indent=2, sort_keys=True)
        f.write("\n")


def read_api_key(path: str) -> str:
    """Load the Linear key from the secrets file at runtime. NEVER logged or
    inlined. Missing file / placeholder / empty → STOP (no fallback)."""
    if not os.path.exists(path):
        raise SystemExit(
            f"missing Linear secrets file: {path} — cannot project. Create it "
            "from secrets/linear.example.json (never inline the key).")
    with open(path) as f:
        key = (json.load(f).get("linearApiKey") or "").strip()
    if not key or key == "lin_api_REPLACE_ME":
        raise SystemExit(
            "linearApiKey not set in secrets/linear.local.json "
            "(placeholder/empty) — STOP; never inline a key.")
    return key


# ---------------------------------------------------------------------------
# Adapter — the ONLY transport-touching code. Injected into upsert().
# ---------------------------------------------------------------------------
class LinearAdapter:
    def __init__(self, api_key: str, team_id: str,
                 endpoint: str = LINEAR_ENDPOINT, max_attempts: int = 6):
        self._api_key = api_key          # NEVER logged / echoed / interpolated
        self._team_id = team_id
        self._endpoint = endpoint
        self._max_attempts = max_attempts

    def _request(self, query: str, variables: dict) -> dict:
        body = json.dumps({"query": query, "variables": variables}).encode()
        attempt = 0
        while True:
            attempt += 1
            req = urllib.request.Request(
                self._endpoint, data=body, method="POST",
                headers={
                    "Authorization": self._api_key,   # raw personal key
                    "Content-Type": "application/json",
                },
            )
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    payload = json.loads(resp.read().decode())
                if payload.get("errors"):
                    msg = json.dumps(payload["errors"])[:500]
                    if "ratelimit" in msg.lower() or "rate limit" in msg.lower():
                        if attempt < self._max_attempts:
                            self._backoff(attempt)
                            continue
                    # A GraphQL error on data WE sent is our bug (internal).
                    raise LinearError(f"category=internal graphql-errors: {msg}")
                return payload["data"]
            except urllib.error.HTTPError as e:
                code = e.code
                detail = e.read().decode(errors="replace")[:300]
                if code == 429 or 500 <= code < 600:
                    if attempt < self._max_attempts:
                        self._backoff(attempt)
                        continue
                    raise LinearError(
                        f"category=external-availability http={code} "
                        f"after {attempt} attempts")
                raise LinearError(f"category=internal http={code} detail={detail}")
            except urllib.error.URLError as e:
                if attempt < self._max_attempts:
                    self._backoff(attempt)
                    continue
                raise LinearError(
                    f"category=external-availability conn-error after "
                    f"{attempt} attempts: {e.reason}")

    def _backoff(self, attempt: int) -> None:
        time.sleep(min(30.0, (2 ** attempt) * 0.5) + random.uniform(0, 0.5))

    def team_states(self) -> dict:
        q = ("query($t:String!){team(id:$t){states(first:50)"
             "{nodes{id name type}}}}")
        d = self._request(q, {"t": self._team_id})
        return {n["name"]: n["id"] for n in d["team"]["states"]["nodes"]}

    def create_issue(self, *, title: str, state_id: str,
                     project_id: Optional[str] = None,
                     milestone_id: Optional[str] = None,
                     label_ids: Optional[list] = None,
                     parent_id: Optional[str] = None,
                     description: Optional[str] = None) -> str:
        inp: dict = {"title": title, "teamId": self._team_id, "stateId": state_id}
        if description is not None:
            inp["description"] = description
        if project_id:
            inp["projectId"] = project_id
        if milestone_id:
            inp["projectMilestoneId"] = milestone_id
        if label_ids:
            inp["labelIds"] = label_ids
        if parent_id:
            inp["parentId"] = parent_id
        q = "mutation($i:IssueCreateInput!){issueCreate(input:$i){issue{id}}}"
        d = self._request(q, {"i": inp})
        return d["issueCreate"]["issue"]["id"]

    def update_issue(self, *, issue_id: str, state_id: str,
                     title: Optional[str] = None,
                     project_id: Optional[str] = None,
                     milestone_id: Optional[str] = None,
                     label_ids: Optional[list] = None,
                     parent_id: Optional[str] = None,
                     description: Optional[str] = None) -> None:
        inp: dict = {"stateId": state_id}
        if title is not None:
            inp["title"] = title
        if description is not None:
            inp["description"] = description
        if project_id:
            inp["projectId"] = project_id
        if milestone_id:
            inp["projectMilestoneId"] = milestone_id
        if label_ids:
            inp["labelIds"] = label_ids
        if parent_id:
            inp["parentId"] = parent_id
        q = ("mutation($id:String!,$i:IssueUpdateInput!)"
             "{issueUpdate(id:$id,input:$i){success}}")
        self._request(q, {"id": issue_id, "i": inp})

    def create_comment(self, issue_id: str, body: str) -> None:
        q = "mutation($i:CommentCreateInput!){commentCreate(input:$i){success}}"
        self._request(q, {"i": {"issueId": issue_id, "body": body}})


# ---------------------------------------------------------------------------
# Upsert — the projection decision (pure w.r.t. the injected adapter)
# ---------------------------------------------------------------------------
def _resolve_state_id(status: str, m: dict, adapter, live: bool) -> Optional[str]:
    """Map a status name → Linear workflow-state id via the cached `states`
    map; if absent and we're live, query the team's states once and cache."""
    sid = m["states"].get(status)
    if sid:
        return sid
    if live and adapter is not None:
        fresh = adapter.team_states()
        m["states"].update(fresh)
        return fresh.get(status)
    return None  # dry-run and uncached: shown as unresolved in the plan


def _label_ids(names: list, m: dict) -> list:
    """Only attach labels already present in the map (never create live)."""
    return [m["labels"][n] for n in names if n in m["labels"]]


def _parent_attach(item: Item, m: dict) -> dict:
    """Resolve the board-tree attach for this item:
      - defect / open-item → SUB-ISSUE of its parent UC (parentId) where the
        parent issue id is known.
      - use-case → its slice's milestone + chunk project where resolvable.
    Returns kwargs subset {parent_id?, milestone_id?, project_id?}."""
    out: dict = {}
    parent = item.parents[0] if item.parents else None
    if item.type in ("defect", "open-item") and parent:
        pid = m["issues"].get(parent)
        if pid:
            out["parent_id"] = pid
    elif item.type == "use-case" and parent:
        mid = m["milestones"].get(parent)
        if mid:
            out["milestone_id"] = mid
        chunk = m["milestone_chunk"].get(parent)
        if chunk and chunk in m["projects"]:
            out["project_id"] = m["projects"][chunk]
    return out


def upsert(item: Item, cfg: dict, m: dict, adapter, live: bool) -> dict:
    status = status_for(item.type, item.state)
    title = issue_title(item)
    desc = issue_description(item)
    names = label_names(item)
    lids = _label_ids(names, m)
    attach = _parent_attach(item, m)
    state_id = _resolve_state_id(status, m, adapter, live)
    existing = m["issues"].get(item.id)

    result = {
        "id": item.id, "status": status, "title": title,
        "labels": names, "state_id": state_id,
    }

    if existing:
        result["action"] = "update"
        result["issue_id"] = existing
        if live:
            adapter.update_issue(
                issue_id=existing, state_id=state_id, title=title,
                description=desc, label_ids=lids, **attach)
            _sync_block_comment(item, m, existing, status, adapter, live=True)
    else:
        result["action"] = "create"
        if live:
            new_id = adapter.create_issue(
                title=title, state_id=state_id, description=desc,
                label_ids=lids, **attach)
            m["issues"][item.id] = new_id
            result["issue_id"] = new_id
            _sync_block_comment(item, m, new_id, status, adapter, live=True)
        else:
            result["issue_id"] = None
    return result


def _sync_block_comment(item: Item, m: dict, issue_id: str, status: str,
                        adapter, live: bool) -> None:
    """Post a one-time '🚫 Blocked: why' comment on entering blocked (or when
    the reason changes) and a '✅ Unblocked' note when it clears. Idempotent via
    m['blocked']."""
    blk = m.setdefault("blocked", {})
    prev = blk.get(item.id)
    if item.state == "blocked":
        reason = item.blocked_note or ""
        if prev != reason:
            if live and issue_id:
                adapter.create_comment(
                    issue_id, f"🚫 **Blocked:** {reason or '_reason not recorded_'}")
            blk[item.id] = reason
    elif prev is not None:
        if live and issue_id:
            adapter.create_comment(issue_id, f"✅ **Unblocked** — now *{status}*.")
        blk.pop(item.id, None)


# ---------------------------------------------------------------------------
# Item-file location + CLI
# ---------------------------------------------------------------------------
def find_item_file(project: str, item_id: str) -> str:
    for sub in ("active", "done"):
        p = os.path.join(project_root(project), "items", sub, f"{item_id}.md")
        if os.path.exists(p):
            return p
    raise SystemExit(
        f"item {item_id!r} not found under work/{project}/items/(active|done)/")


def _print_plan(res: dict, live: bool) -> None:
    mode = "LIVE" if live else "DRY-RUN"
    sid = res.get("state_id") or "(unresolved — will query team states live)"
    print(f"[{mode}] {res['action'].upper()} {res['id']}")
    print(f"  title : {res['title']}")
    print(f"  status: {res['status']}  (stateId={sid})")
    print(f"  labels: {', '.join(res['labels']) or '(none)'}")
    if res.get("issue_id"):
        print(f"  issue : {res['issue_id']}")


def main(argv=None, adapter_factory=None) -> int:
    ap = argparse.ArgumentParser(
        prog="board-project",
        description="Project ONE v82 work item onto its Linear issue "
                    "(idempotent, one-way; never writes item state).")
    ap.add_argument("--project", required=True)
    ap.add_argument("--item", required=True, help="work-item id, e.g. UC-XA4")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--dry-run", action="store_true", default=True)
    g.add_argument("--live", action="store_true")
    args = ap.parse_args(argv)
    live = bool(args.live)

    cfg = load_config(args.project)
    m = load_map(args.project)
    text = open(find_item_file(args.project, args.item)).read()
    item = parse_item(text)

    if item.id != args.item:
        print(f"warning: file id {item.id!r} != requested {args.item!r}",
              file=sys.stderr)

    adapter = None
    if live:
        key = read_api_key(secrets_path(args.project))
        factory = adapter_factory or (
            lambda: LinearAdapter(key, team_id=cfg["teamId"]))
        adapter = factory()

    res = upsert(item, cfg, m, adapter, live=live)
    _print_plan(res, live)

    if live:
        save_map(args.project, m)
        print(f"  map   : wrote {map_path(args.project)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
