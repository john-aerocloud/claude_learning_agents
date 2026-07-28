#!/usr/bin/env python3
"""linear-project.py — deterministic Linear board projection for ONE work item.

Renders a work item (the SSOT, per process/machinery/CONTRACT.md) into a
correctly-formed Linear issue and upserts it via the Linear GraphQL API,
idempotently. Canonical mapping: process/linear-mapping.md.

STANDARD LIBRARY ONLY (urllib for HTTP). No pip installs. Runs via the
cross-platform launcher that resolves the real python interpreter (see the
`board-project` Makefile target) — never invoke bare python3 on Windows.

This REPLACES the LLM-hand-composed description. The defect it fixes: the old
hand-composition emitted only the FIRST physical line of each hard-wrapped
acceptance criterion. This joins the continuation lines back into the complete
criterion text (pure render — `parse_acceptance`).

The renderer (`parse_*` / `render_description`) is a PURE function of the item
files and takes no network/secret — see linear-project.test.py.

CLI:  linear-project.py --project <P> --id <ID>
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # tools -> .claude -> repo root
LINEAR_URL = "https://api.linear.app/graphql"


# --------------------------------------------------------------------------- #
# Item-file parsing (pure)
# --------------------------------------------------------------------------- #
def split_item(text):
    """Return (frontmatter_text, body_text) splitting on the YAML fence."""
    if not text.startswith("---"):
        return "", text
    parts = text.split("\n")
    # first line is '---'; find the closing '---'
    end = None
    for i in range(1, len(parts)):
        if parts[i].strip() == "---":
            end = i
            break
    if end is None:
        return "", text
    fm = "\n".join(parts[1:end])
    body = "\n".join(parts[end + 1:])
    return fm, body


def _strip_quotes(v):
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    return v


def parse_frontmatter(fm):
    """Minimal, targeted YAML reader for the top-level scalars/lists we need
    plus derived.state. Deliberately ignores the nested events list."""
    out = {}
    lines = fm.split("\n")
    in_derived = False
    for line in lines:
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip())
        if indent == 0:
            in_derived = line.rstrip().startswith("derived:")
            m = re.match(r"^([A-Za-z_]+):\s*(.*)$", line)
            if not m:
                continue
            key, val = m.group(1), m.group(2)
            if key in ("id", "type", "title", "job", "severity"):
                out[key] = _strip_quotes(val)
            elif key in ("personas", "parents", "deps"):
                out[key] = _parse_inline_list(val)
        elif in_derived and indent == 2:
            m = re.match(r"^\s{2}state:\s*(.*)$", line)
            if m:
                out["state"] = _strip_quotes(m.group(1))
    return out


def _parse_inline_list(val):
    val = val.strip()
    if val.startswith("[") and val.endswith("]"):
        inner = val[1:-1].strip()
        if not inner:
            return []
        return [x.strip() for x in inner.split(",") if x.strip()]
    return []


def parse_definition_oneliner(body):
    """The 'What this delivers' one-liner — the text after the em/hyphen dash
    on the `## Definition — …` heading (falls back to None)."""
    m = re.search(r"^##\s+Definition\s*[—-]\s*(.+?)\s*$", body, re.MULTILINE)
    if m:
        return m.group(1).strip()
    return None


def parse_why(body):
    """First sentence of the `**Why (persona/job):**` paragraph, collapsed."""
    m = re.search(r"\*\*Why \(persona/job\):\*\*\s*(.+?)(?:\n\n|\Z)", body, re.DOTALL)
    if not m:
        return None
    txt = re.sub(r"\s+", " ", m.group(1)).strip()
    return txt


def parse_defect_fields(body):
    """For a defect body: capture Expected / Current / Reproduce / Priority
    bold-led paragraphs from the `## Defect (four fields)` section."""
    out = {}
    for label in ("Expected", "Current", "Reproduce", "Priority"):
        m = re.search(
            r"\*\*" + re.escape(label) + r"[^:]*:\*\*\s*(.+?)(?:\n\n|\Z)",
            body,
            re.DOTALL,
        )
        if m:
            out[label] = re.sub(r"\s+", " ", m.group(1)).strip()
    return out


def parse_acceptance(body):
    """THE FIX. Parse the `## Acceptance criteria …` section into a list of
    COMPLETE criteria, joining hard-wrapped continuation lines (subsequent
    indented lines belonging to the same bullet) into one string with wrap
    newlines + indentation collapsed to single spaces."""
    lines = body.split("\n")
    # locate the acceptance-criteria heading
    start = None
    for i, line in enumerate(lines):
        if re.match(r"^##\s+Acceptance criteria", line):
            start = i + 1
            break
    if start is None:
        return []
    criteria = []
    current = None
    for line in lines[start:]:
        if re.match(r"^##\s+", line):  # next top-level section ends the list
            break
        bullet = re.match(r"^[-*]\s+(.*)$", line)
        if bullet:
            if current is not None:
                criteria.append(_collapse(current))
            current = bullet.group(1)
        elif current is not None:
            if line.strip() == "":
                continue  # blank line inside/after a bullet — not a boundary
            if line[:1] in (" ", "\t"):  # indented continuation line
                current += " " + line.strip()
            else:
                # a non-indented, non-bullet line ends the AC list
                break
    if current is not None:
        criteria.append(_collapse(current))
    return criteria


def _collapse(s):
    return re.sub(r"\s+", " ", s).strip()


# --------------------------------------------------------------------------- #
# Reference-file resolution (pure)
# --------------------------------------------------------------------------- #
def resolve_job(job_code, jtbd_text):
    """`J1` -> 'J1 — Get notified of a real device failure' (heading, minus the
    [core]/[secondary] tag). Returns the code alone if unresolved."""
    if not job_code:
        return None
    m = re.search(
        r"^##\s+(" + re.escape(job_code) + r")\b\s*[—-]\s*(.+?)\s*(\[[^\]]*\])?\s*$",
        jtbd_text,
        re.MULTILINE,
    )
    if m:
        return f"{m.group(1)} — {m.group(2).strip()}"
    return job_code


def resolve_persona(pid, personas_text):
    """`P3` -> 'P3 — ROC Build Engineer' (heading, minus the [class: …] tag)."""
    m = re.search(
        r"^###\s+(" + re.escape(pid) + r")\b\s*[—-]\s*(.+?)\s*(\[class:[^\]]*\])?\s*$",
        personas_text,
        re.MULTILINE,
    )
    if m:
        return f"{m.group(1)} — {m.group(2).strip()}"
    return pid


def find_item_file(project, item_id):
    for sub in ("active", "done"):
        p = ROOT / "work" / project / "items" / sub / f"{item_id}.md"
        if p.exists():
            return p
    return None


def load_item(project, item_id):
    p = find_item_file(project, item_id)
    if p is None:
        raise FileNotFoundError(f"item {item_id} not found under work/{project}/items/")
    fm, body = split_item(p.read_text(encoding="utf-8"))
    data = parse_frontmatter(fm)
    data["_body"] = body
    return data


def ancestor_titles(project, item_id):
    """Walk parents to produce [(id, type, title), …] nearest-first."""
    chain = []
    seen = set()
    cur = item_id
    while True:
        p = find_item_file(project, cur)
        if p is None:
            break
        fm, _ = split_item(p.read_text(encoding="utf-8"))
        d = parse_frontmatter(fm)
        parents = d.get("parents", [])
        if not parents:
            break
        parent_id = parents[0]
        if parent_id in seen:
            break
        seen.add(parent_id)
        pp = find_item_file(project, parent_id)
        if pp is None:
            break
        pfm, _ = split_item(pp.read_text(encoding="utf-8"))
        pd = parse_frontmatter(pfm)
        chain.append((parent_id, pd.get("type", ""), pd.get("title", "")))
        cur = parent_id
    return chain


# --------------------------------------------------------------------------- #
# Description composition (pure)
# --------------------------------------------------------------------------- #
def render_description(item, jobs, personas, plan, block_reason=None):
    """Pure render of the five canonical sections (linear-mapping §2a). Omits a
    section when the item genuinely lacks it. `jobs`/`personas` are resolved
    strings; `plan` is [(role, id, title), …]."""
    parts = []
    if block_reason:
        parts.append(f"> **Blocked:** {block_reason}\n")

    if item.get("value_oneliner"):
        parts.append("## What this delivers\n" + item["value_oneliner"])

    if jobs:
        parts.append("## Jobs to be done\n" + "\n".join(f"- {j}" for j in jobs))

    if personas:
        parts.append(
            "## Personas served\n" + "\n".join(f"- {p}" for p in personas)
        )

    if item.get("acceptance"):
        parts.append(
            "## Acceptance criteria\n"
            + "\n".join(f"- {c}" for c in item["acceptance"])
        )

    if item.get("defect_fields"):
        df = item["defect_fields"]
        lines = [f"- **{k}:** {v}" for k, v in df.items()]
        parts.append("## Defect\n" + "\n".join(lines))

    if plan:
        plan_lines = [f"- **{role}:** {iid} · {title}" for role, iid, title in plan]
        if item.get("contribution"):
            plan_lines.append(f"- **Contribution:** {item['contribution']}")
        parts.append("## Part of the plan\n" + "\n".join(plan_lines))

    return "\n\n".join(parts).strip() + "\n"


ROLE_BY_TYPE = {
    "use-case": "Use-case",
    "defect": "Defect",
    "open-item": "Open-item",
    "slice": "Slice",
    "chunk": "Chunk",
    "requirement": "Requirement",
}


def compose(project, item_id):
    """Read item + reference files -> (title, description, labels, state, item)."""
    item = load_item(project, item_id)
    body = item["_body"]
    itype = item.get("type", "")

    item["value_oneliner"] = parse_definition_oneliner(body) or item.get("title")
    item["acceptance"] = parse_acceptance(body)
    item["contribution"] = parse_why(body)
    if itype == "defect":
        item["defect_fields"] = parse_defect_fields(body)

    # jobs
    jobs = []
    if item.get("job"):
        jtbd_p = ROOT / "work" / project / "product" / "jtbd-map.md"
        jtxt = jtbd_p.read_text(encoding="utf-8") if jtbd_p.exists() else ""
        jobs = [resolve_job(item["job"], jtxt)]

    # personas
    personas = []
    if item.get("personas"):
        per_p = ROOT / "work" / project / "product" / "personas.md"
        ptxt = per_p.read_text(encoding="utf-8") if per_p.exists() else ""
        personas = [resolve_persona(pid, ptxt) for pid in item["personas"]]

    # plan (parent chain, nearest-first)
    plan = []
    for iid, ptype, title in ancestor_titles(project, item_id):
        role = ROLE_BY_TYPE.get(ptype, ptype or "Parent")
        plan.append((role, iid, title))

    block_reason = None
    if item.get("state") == "blocked":
        block_reason = _latest_block_note(body)

    description = render_description(item, jobs, personas, plan, block_reason)
    title = f"{item['id']} · {item.get('title', '')}".strip()

    labels = compose_labels(item)
    return title, description, labels, item.get("state"), item


def _latest_block_note(body):
    # events live in frontmatter which we dropped; block reason is best-effort.
    return "see item event log"


def compose_labels(item):
    labels = []
    if item.get("job"):
        labels.append(f"job:{item['job']}")
    itype = item.get("type", "")
    if itype == "defect":
        labels.append("defect")
    if itype == "open-item":
        labels.append("open-item")
    if item.get("state") == "blocked":
        labels.append("blocked")
    if itype == "use-case" and not item.get("acceptance"):
        labels.append("needs-acceptance")
    return labels


# --------------------------------------------------------------------------- #
# State -> board-status name mapping (linear-mapping §2)
# --------------------------------------------------------------------------- #
STATE_STATUS = {
    "use-case": {
        "registered": ["Backlog"],
        "ready": ["Ready", "Todo", "Backlog"],
        "building": ["In Progress"],
        "validating": ["In Review"],
        "dev-validating": ["In Review"],
        "prod-deploying": ["In Progress"],
        "prod-validating": ["In Review"],
        "reworking": ["In Progress (rework)", "In Progress"],
        "blocked": ["Blocked", "Todo", "Backlog"],
        "done": ["Done"],
    },
    "defect": {
        "reported": ["Backlog"],
        "reproducing": ["In Progress"],
        "fixing": ["In Progress"],
        "validating": ["In Review"],
        "blocked": ["Blocked", "Todo", "Backlog"],
        "resolved": ["Done"],
        "wontfix": ["Cancelled", "Canceled"],
    },
    "open-item": {
        "open": ["Backlog"],
        "scheduled": ["Ready", "Todo", "Backlog"],
        "done": ["Done"],
        "wontfix": ["Cancelled", "Canceled"],
    },
}
# aggregate items (slice/chunk/requirement) reuse the flow-item table
STATE_STATUS["slice"] = STATE_STATUS["use-case"].copy()
STATE_STATUS["slice"].update({"planned": ["Backlog"], "in_progress": ["In Progress"]})
STATE_STATUS["chunk"] = STATE_STATUS["slice"]
STATE_STATUS["requirement"] = STATE_STATUS["slice"]


def desired_status_names(itype, state):
    table = STATE_STATUS.get(itype, STATE_STATUS["use-case"])
    return table.get(state, ["Backlog"])


# --------------------------------------------------------------------------- #
# Linear GraphQL client
# --------------------------------------------------------------------------- #
class LinearError(Exception):
    pass


def graphql(api_key, query, variables=None):
    payload = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(
        LINEAR_URL,
        data=payload,
        headers={"Authorization": api_key, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode()
    except urllib.error.HTTPError as e:
        # The RESPONSE body carries no credential (the key is in the request
        # headers only), so it is safe to surface for diagnosis.
        detail = ""
        try:
            body = e.read().decode()
            data = json.loads(body)
            if data.get("errors"):
                detail = ": " + "; ".join(
                    x.get("message", "?") for x in data["errors"]
                )
        except Exception:
            pass
        raise LinearError(f"Linear HTTP {e.code} {e.reason}{detail}")
    except urllib.error.URLError as e:
        raise LinearError(f"Linear connection error: {e.reason}")
    data = json.loads(body)
    if data.get("errors"):
        msgs = "; ".join(e.get("message", "?") for e in data["errors"])
        raise LinearError(f"Linear GraphQL error: {msgs}")
    return data["data"]


def team_states(api_key, team_id):
    d = graphql(
        api_key,
        "query($t:String!){team(id:$t){states{nodes{id name type}}}}",
        {"t": team_id},
    )
    return d["team"]["states"]["nodes"]


def resolve_state_id(states, names):
    by_name = {s["name"].lower(): s["id"] for s in states}
    for n in names:
        if n.lower() in by_name:
            return by_name[n.lower()]
    return None


def team_labels(api_key, team_id):
    d = graphql(
        api_key,
        "query($t:String!){team(id:$t){labels{nodes{id name}}}}",
        {"t": team_id},
    )
    return {n["name"]: n["id"] for n in d["team"]["labels"]["nodes"]}


def ensure_labels(api_key, team_id, wanted):
    existing = team_labels(api_key, team_id)
    ids = []
    for name in wanted:
        if name in existing:
            ids.append(existing[name])
            continue
        d = graphql(
            api_key,
            "mutation($n:String!,$t:String!){issueLabelCreate(input:{name:$n,teamId:$t}){success issueLabel{id name}}}",
            {"n": name, "t": team_id},
        )
        res = d["issueLabelCreate"]
        if not res.get("success"):
            raise LinearError(f"failed to create label {name}")
        ids.append(res["issueLabel"]["id"])
    return ids


# --------------------------------------------------------------------------- #
# Upsert
# --------------------------------------------------------------------------- #
def normalize_entry(entry):
    """Convert entry to dict format, handling old string-only format.
    
    Old format: "uuid-string" (just the issue ID)
    New format: {"type": "...", "id": "...", "identifier": "..."}
    
    Returns either a normalized dict or None if entry is missing.
    For old format, assume it was an issue ID.
    """
    if entry is None:
        return None
    if isinstance(entry, str):
        return {"type": "issue", "id": entry}  # Assume old format was an issue ID
    return entry


def upsert(project, item_id):
    secrets_path = ROOT / "work" / project / "secrets" / "linear.json"
    if not secrets_path.exists():
        print(f"no Linear binding for project {project} (secrets/linear.json absent) — nothing to do")
        return 0
    secrets = json.loads(secrets_path.read_text(encoding="utf-8"))
    api_key = secrets["api_key"]
    team_id = secrets["team_id"]
    id_to_issue = secrets.setdefault("id_to_issue", {})

    title, description, labels, state, item = compose(project, item_id)
    itype = item.get("type", "")

    states = team_states(api_key, team_id)
    state_id = resolve_state_id(states, desired_status_names(itype, state))
    label_ids = ensure_labels(api_key, team_id, labels) if labels else []

    # hierarchy: project (chunk) + milestone (slice) + parent issue (defect->UC)
    project_id = None
    milestone_id = None
    parent_issue_id = None
    for iid, ptype, _title in ancestor_titles(project, item_id):
        entry = id_to_issue.get(iid)
        entry = normalize_entry(entry)
        if not entry:
            continue
        if ptype == "chunk" and entry.get("type") == "project":
            project_id = entry["id"]
        elif ptype == "slice" and entry.get("type") == "milestone":
            milestone_id = entry["id"]
            project_id = project_id or entry.get("project_id")
    if itype == "defect":
        for pid in item.get("parents", []):
            e = id_to_issue.get(pid)
            e = normalize_entry(e)
            if e and e.get("type") == "issue":
                parent_issue_id = e["id"]

    input_fields = {
        "title": title,
        "description": description,
    }
    if state_id:
        input_fields["stateId"] = state_id
    if label_ids:
        input_fields["labelIds"] = label_ids
    if project_id:
        input_fields["projectId"] = project_id
    if milestone_id:
        input_fields["projectMilestoneId"] = milestone_id
    if parent_issue_id:
        input_fields["parentId"] = parent_issue_id

    entry = id_to_issue.get(item_id)
    entry = normalize_entry(entry)
    if entry and entry.get("type") == "issue" and entry.get("id"):
        d = graphql(
            api_key,
            "mutation($id:String!,$in:IssueUpdateInput!){issueUpdate(id:$id,input:$in){success issue{id identifier}}}",
            {"id": entry["id"], "in": input_fields},
        )
        res = d["issueUpdate"]
        if not res.get("success"):
            raise LinearError(f"issueUpdate failed for {item_id}")
        issue = res["issue"]
        action = "updated"
    else:
        create_input = dict(input_fields)
        create_input["teamId"] = team_id
        d = graphql(
            api_key,
            "mutation($in:IssueCreateInput!){issueCreate(input:$in){success issue{id identifier}}}",
            {"in": create_input},
        )
        res = d["issueCreate"]
        if not res.get("success"):
            raise LinearError(f"issueCreate failed for {item_id}")
        issue = res["issue"]
        action = "created"
        id_to_issue[item_id] = {
            "type": "issue",
            "id": issue["id"],
            "identifier": issue["identifier"],
        }
        secrets_path.write_text(
            json.dumps(secrets, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    status_name = next(
        (s["name"] for s in states if s["id"] == state_id), "(unchanged)"
    )
    print(
        f"{action} {issue['identifier']} <- {item_id} "
        f"[state={status_name}] [labels={','.join(labels) or '-'}] "
        f"[{len(item.get('acceptance', []))} AC]"
    )
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Project one work item onto its Linear issue.")
    ap.add_argument("--project", required=True)
    ap.add_argument("--id", required=True, dest="item_id")
    args = ap.parse_args(argv)
    try:
        return upsert(args.project, args.item_id)
    except (LinearError, FileNotFoundError, KeyError) as e:
        print(f"linear-project: ERROR: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
