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


#: Matches the acceptance heading AS THE CORPUS ACTUALLY WRITES IT, at level 2 or 3,
#: with anything after the word (e.g. "### Acceptance (to be authored on pull)").
#: OI-BOARD-ACCEPTANCE-PARSER-MATCHES-NOTHING: the old pattern demanded the literal
#: `## Acceptance criteria`, which essentially NO item uses, so the parser matched
#: NOTHING tree-wide and every item was labelled `needs-acceptance` — a label applied
#: to 100% of items conveys zero information and cannot discriminate an item with ten
#: tagged conditions from one with none. Measured instances: DEFECT-OAG-054 (10 AC ids)
#: and UC-XE1 (13 AC ids, pushed to Linear as DONE *and* needs-acceptance), then
#: UC-DP2/DP3/DP4/DP5 on 2026-08-10. §17e — a gate that cries wolf is fixed, not tolerated.
#: The capture group is the heading LEVEL, which the terminator below needs.
_ACCEPTANCE_HEADING = re.compile(r"^(#{2,3})\s+Acceptance\b")
#: Any level-2 or level-3 heading, with its level captured.
_SECTION_HEADING = re.compile(r"^(#{2,3})\s+")

#: An `AC-…` id. Deliberately cannot end in `.` — `[\w.]*` greedily ate the sentence
#: period, minting phantom ids `AC-061.` / `AC-C11.2.` / `AC-RLNC.` that no criterion
#: could ever match, which would make the residual self-check below cry wolf.
_AC_ID = re.compile(r"\bAC-[A-Za-z0-9](?:[\w.]*[A-Za-z0-9])?")

#: A markdown TABLE row whose FIRST cell is an AC id — `| **AC-OB1.1** | criterion … |`.
#: UC-OB1 transcribes nine criteria that way and DEFECT-OAG-053 registers fifteen.
#: Requiring an AC-shaped first cell skips the header/separator rows.
_TABLE_ROW = re.compile(r"^\|\s*[*_`\s]*(AC-[A-Za-z0-9][\w.]*?)[*_`\s]*\|(.*)$")
#: A list item — BOTH bullet styles the corpus actually uses, measured 2026-08-10:
#: `- **AC-x**` (SLC-042/045/046, the UC-DP* family …) and NUMBERED `1. **AC-x**`
#: (DEFECT-OAG-080/081/082/084/086, the SLC-CSP* family …). Matching only `[-*]`
#: left every numbered item reading zero and LOOKED like a fix.
_LIST_ITEM = re.compile(r"^(?:[-*]|\d+[.)])\s+(.*)$")
#: A criterion declared in PROSE, with no list marker at all: `AC-053.4 — …` or
#: `**\`AC-AP.1\`** — …`. This is the generalisation that stops the "add format five"
#: treadmill: a criterion is anything that DECLARES an id at the start of a line.
_AC_DECL = re.compile(r"^[*_`\s]{0,6}(AC-[A-Za-z0-9][\w.]*?)[*_`]*\s*[—:\-–]")
#: A fenced code block toggles verbatim mode: prod measurements and shell snippets
#: live inside acceptance sections and are not criteria.
_FENCE = re.compile(r"^\s*```")

#: Section text that means "nobody has written this yet" rather than "the parser
#: failed". Kept narrow and literal on purpose: seven items head their section
#: `## Acceptance (to be authored on pull)` and then AUTHOR it without changing the
#: heading, so the HEADING is not evidence of anything — only the BODY is.
_PLACEHOLDER = re.compile(
    r"^(?:_?\s*(?:tbd|tba|to be authored|to be written|none(?: yet)?|n/?a)\b.*)$",
    re.IGNORECASE,
)


def acceptance_sections(body):
    """Every acceptance section in the body, as `(heading, level, lines)`.

    TWO structural fixes, both measured against the real 468-item corpus:

    * **Level-aware termination.** A `## Acceptance` section is closed only by a
      heading of level <= 2. The old terminator matched ANY `##`/`###`, so a level-3
      SUB-heading inside the section ended it — which is how `DEFECT-OAG-053`'s
      FIFTEEN registered criteria (a table under `### Registered acceptance
      criteria`) became invisible while the parser confidently reported 4.
    * **Every section, not just the first.** `DEFECT-OAG-110` and `UC-XC5` each carry
      a SECOND `## Acceptance` section, registered later; the old parser stopped at
      the first and reported 8 of 22.
    """
    lines = body.split("\n")
    out = []
    i = 0
    while i < len(lines):
        m = _ACCEPTANCE_HEADING.match(lines[i])
        if not m:
            i += 1
            continue
        level = len(m.group(1))
        j = i + 1
        buf = []
        while j < len(lines):
            h = _SECTION_HEADING.match(lines[j])
            if h and len(h.group(1)) <= level:
                break
            buf.append(lines[j])
            j += 1
        out.append((lines[i], level, buf))
        i = j
    return out


def _criteria_from(lines):
    """Split one acceptance section's lines into complete criteria + leftover prose.

    A criterion STARTS at a list item, an AC-id table row, or a prose line that
    DECLARES an AC id; continuation lines (indented, or blank-then-indented) join
    onto it with wrap newlines collapsed to single spaces. Anything else is prose.
    Crucially the scan does NOT stop at the first prose line — the old parser
    `break`ed there, so an intervening paragraph hid every criterion after it.
    """
    criteria = []
    prose = []
    current = None
    kind = None          # 'list' | 'table' | 'prose' — decides what CONTINUES it
    fenced = False

    def flush():
        nonlocal current, kind
        if current is not None:
            criteria.append(_collapse(current))
            current = None
            kind = None

    for line in lines:
        if _FENCE.match(line):
            fenced = not fenced
            flush()
            prose.append(line)
            continue
        if fenced:
            prose.append(line)
            continue
        trow = _TABLE_ROW.match(line)
        if trow:
            flush()
            current = "%s %s" % (trow.group(1), trow.group(2).strip().rstrip("|").strip())
            kind = "table"
            continue
        item = _LIST_ITEM.match(line)
        if item and not line[:1].isspace():
            flush()
            current = item.group(1)
            kind = "list"
            continue
        if line.strip() == "":
            # A blank line ends a PARAGRAPH criterion (markdown paragraph semantics)
            # but not a list/table one, where a blank line between an item and its
            # indented continuation is normal.
            if kind == "prose":
                flush()
            continue
        if line[:1] in (" ", "\t"):
            if current is not None:
                current += " " + line.strip()  # indented continuation
            else:
                prose.append(line)
            continue
        if _AC_DECL.match(line):  # a criterion declared in prose, no list marker
            flush()
            current = line.strip()
            kind = "prose"
            continue
        if kind == "prose":
            # An UNINDENTED wrap line: a paragraph criterion's continuation is not
            # indented, so requiring indentation here would silently truncate it.
            current += " " + line.strip()
            continue
        flush()
        prose.append(line)
    flush()
    return criteria, prose


def _line_start_ids(line):
    """The AC id a line DECLARES, if any — i.e. one standing at the start of the line
    once a list marker, table pipe and emphasis/backtick markup are stripped.

    This is what makes the residual self-check both HONEST and NON-VACUOUS. An id
    merely REFERENCED mid-sentence is not a dropped criterion — the real corpus is
    full of such references (`### Registered acceptance criteria (the AC-053.n
    vocabulary …)`, "`AC-110.A6`–`A11` discharge `AC-110.8`'s fault set") and
    counting them as residuals would make the check cry wolf on the very items it
    exists to protect. An id standing where a DECLARATION goes and reaching no
    criterion is a genuine drop: the parse read that line and produced nothing.
    """
    s = line.strip()
    s = re.sub(r"^(?:[-*]|\d+[.)])\s+", "", s)
    s = re.sub(r"^\|\s*", "", s)
    s = s.lstrip("*_`> ")
    m = re.match(r"(AC-[A-Za-z0-9](?:[\w.]*[A-Za-z0-9])?)", s)
    return [m.group(1)] if m else []


def acceptance_report(body):
    """THE LOUD PARSE. Returns a verdict, never a bare count.

    OI-ACCEPTANCE-PARSER-SCORES-ZERO-SILENTLY: `parse_acceptance()` returned a COUNT,
    and `0` conflated two irreconcilable facts — *this item genuinely has no written
    acceptance* (a real process state; §12a keeps such an item out of a build) and
    *I could not read this item's acceptance*. Every consumer saw them as identical,
    and the dangerous direction is false-green: the board stamped `needs-acceptance`
    — a WORK INSTRUCTION to go and author acceptance — on `UC-GSA2` (OAG-216) and
    `DEFECT-OAG-047` (OAG-208), both of which carry conditions their own testers
    cited BY ID. Following that instruction means re-authoring over existing
    acceptance, which §12a forbids an engineer to do at all.

    `status` is one of:

    * ``parsed``       — criteria extracted, and no id in the section was left behind.
    * ``truncated``    — criteria extracted BUT an `AC-…` id present in the section
                         reached none of them. **The parse checks itself**: it can no
                         longer under-count silently. This is the class that hid
                         `DEFECT-OAG-053` (4 of 20) and `DEFECT-OAG-110` (8 of 22).
    * ``unreadable``   — a section with ids in it yielded ZERO criteria: a parser
                         fault, stated as one.
    * ``unenumerated`` — a section carrying real acceptance PROSE with no citable id
                         and no list. Authored, but the §17d gate cannot trace to it.
                         `UC-GSA2` is the founding case. Not a parser fault, and NOT
                         "no acceptance".
    * ``empty``        — a heading with nothing under it, or an explicit placeholder.
    * ``none``         — no acceptance section, and no AC-led list anywhere.
    * ``orphan``       — no recognised section, but a list/table of AC ids exists
                         somewhere in the body: acceptance under a heading we do not
                         know. Measured population on the real corpus: 0 items.

    §17h: no class is described as benign. Each is a population with a measured size
    that the sweep prints, and four of the seven can go red.
    """
    secs = acceptance_sections(body)
    criteria = []
    prose = []
    for _h, _lvl, lines in secs:
        c, p = _criteria_from(lines)
        criteria.extend(c)
        prose.extend(p)
    text = "\n".join(l for _h, _lvl, lines in secs for l in lines).strip()
    sec_ids = set(_AC_ID.findall(text))
    got_ids = set()
    for c in criteria:
        got_ids |= set(_AC_ID.findall(c))
    declared = set()
    for _h, _lvl, lines in secs:
        for line in lines:
            declared |= set(_line_start_ids(line))
    residual = sorted(declared - got_ids)

    if not secs:
        # No recognised heading. Acceptance authored under an UNKNOWN heading would
        # still leave a STRUCTURAL trace: AC ids leading list items or table rows.
        # A bare mention in prose is NOT that — 17 migrated stubs cite another item's
        # `AC-…` in a `dora_ref`, and the old body-wide `AC-` heuristic labelled every
        # one of them `acceptance-unparsed`, i.e. accused the parser on 17 items that
        # simply have no acceptance. A label that fires that widely discriminates
        # nothing, which is the disease this whole family is about.
        orphan = set()
        for line in body.split("\n"):
            m = _TABLE_ROW.match(line) or _LIST_ITEM.match(line)
            if not m:
                continue
            tail = m.group(1) if _TABLE_ROW.match(line) else m.group(1)
            d = _AC_DECL.match(tail) or re.match(r"^[*_`\s]{0,6}(AC-[A-Za-z0-9][\w.]*)", tail)
            if d:
                orphan.add(d.group(1))
        orphan = sorted(orphan)
        status = "orphan" if len(orphan) >= 2 else "none"
        return {"status": status, "criteria": [], "residual_ids": [], "sections": [],
                "text": "", "orphan_ids": orphan}

    if criteria and residual:
        status = "truncated"
    elif criteria:
        status = "parsed"
    elif not text or all(_PLACEHOLDER.match(l.strip()) for l in text.split("\n") if l.strip()):
        status = "empty"
    elif sec_ids:
        status = "unreadable"
    else:
        status = "unenumerated"
    return {"status": status, "criteria": criteria, "residual_ids": residual,
            "sections": [h for h, _l, _b in secs], "text": text, "orphan_ids": []}


def parse_acceptance(body):
    """Back-compat COUNT-ONLY view: the list of complete criteria, wrapped lines
    joined. Callers that need to know whether a zero is real must read
    `acceptance_report()` — a bare list cannot express "I could not read this"."""
    return acceptance_report(body)["criteria"]


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
        block = "## Acceptance criteria\n" + "\n".join(f"- {c}" for c in item["acceptance"])
        if item.get("acceptance_status") == "truncated":
            # Never render a truncated list as if it were the whole set: a reader
            # who trusts it concludes the missing conditions do not exist.
            block += (
                "\n\n> ⚠️ **Acceptance is TRUNCATED on the board.** These ids are written "
                "in the item but reached no criterion the renderer could read: "
                + ", ".join(f"`{i}`" for i in item.get("acceptance_residual", []))
                + ". Read the item file, not this list."
            )
        parts.append(block)
    elif item.get("acceptance_status") in ("unenumerated", "unreadable", "orphan"):
        # AC-AP.1/AC-AP.2: a zero is never silent. The board previously showed NO
        # acceptance section at all and stamped `needs-acceptance`, so a human was
        # told to author acceptance over the top of text that already existed.
        why = {
            "unenumerated": "written as prose with no citable `AC-…` id, so it "
                            "**could not be enumerated** into criteria",
            "unreadable": "present but the renderer **could not read it** — this is a "
                          "parser fault, not a missing-acceptance item",
            "orphan": "written under a heading the renderer does not recognise, so it "
                      "**could not be enumerated**",
        }[item["acceptance_status"]]
        note = ("## Acceptance criteria\n> ⚠️ **This item's acceptance is %s.** It is NOT "
                "absent — do not author over it (§12a).\n" % why)
        if item.get("acceptance_text"):
            note += "\n" + "\n".join(
                "> " + l if l.strip() else ">" for l in item["acceptance_text"].split("\n")
            )
        parts.append(note)

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
    rep = acceptance_report(body)
    item["acceptance"] = rep["criteria"]
    # AC-AP.2 — the verdict travels WITH the count to every consumer. A bare list
    # cannot say "I could not read this", which is the whole defect.
    item["acceptance_status"] = rep["status"]
    item["acceptance_residual"] = rep["residual_ids"]
    item["acceptance_text"] = rep["text"]
    item["acceptance_orphan"] = rep["orphan_ids"]
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
    # `awaiting_observation` shares the Blocked status (no workspace has a
    # dedicated one) but is a DIFFERENT fact: shipped and verified, waiting on
    # reality to confirm it. The label is what keeps the two distinguishable on
    # the board instead of collapsing into "blocked".
    if item.get("state") == "awaiting_observation":
        labels.append("awaiting-observation")
    # --- acceptance labelling: THREE facts, three labels (AC-AP.1/AC-AP.2) --------
    # OI-ACCEPTANCE-PARSER-SCORES-ZERO-SILENTLY. Two things were wrong here.
    #
    # (1) `needs-acceptance` is a WORK INSTRUCTION - it tells a human to go and author
    #     acceptance. It was stamped on OAG-216 (`UC-GSA2`) and OAG-208
    #     (`DEFECT-OAG-047`), both of which carry conditions their own testers cited BY
    #     ID. Acting on it means re-authoring over existing acceptance, which §12a
    #     forbids an engineer to do at all - worse than the original omission.
    # (2) The old branch was gated on `itype == "use-case"`, so a DEFECT whose
    #     acceptance was unreadable produced NO label and NO warning at all.
    #     `DEFECT-OAG-047`'s ten conditions were invisible in exactly that silence.
    #
    # The parser-fault signal is type-independent; the authoring instruction is not.
    # The old "any `AC-` substring in the body" heuristic is gone with them: 17
    # migrated stubs cite another item's `AC-...` inside a `dora_ref`, so it accused the
    # parser on 17 items that simply have no acceptance - a label that fires that
    # widely discriminates nothing, which is this family's whole disease.
    status = item.get("acceptance_status")
    if status in ("truncated", "unreadable", "orphan"):
        sys.stderr.write(
            "WARN acceptance-parser: %s status=%s - the item's acceptance is present but "
            "NOT fully readable%s. Labelling `acceptance-unparsed`, NOT `needs-acceptance`: "
            "the item is not at fault, the parser is. Run `make acceptance-audit`. "
            "See OI-ACCEPTANCE-PARSER-SCORES-ZERO-SILENTLY.\n"
            % (
                item.get("id", "<unknown>"),
                status,
                (" (ids reaching no criterion: %s)" % ", ".join(item["acceptance_residual"]))
                if item.get("acceptance_residual") else "",
            )
        )
        labels.append("acceptance-unparsed")
    elif status == "unenumerated":
        # A distinct, honest third state: acceptance IS authored, as prose, and cannot
        # be cited by the §17d gate. Neither the parser's fault nor a missing item.
        sys.stderr.write(
            "WARN acceptance-parser: %s status=unenumerated - acceptance prose is present "
            "with no citable `AC-...` id, so §17d cannot trace a test to it. Labelling "
            "`acceptance-unenumerated`. Enumerating it is PRODUCT/ARCHITECT work (§12a), "
            "never the engineer's.\n" % item.get("id", "<unknown>")
        )
        labels.append("acceptance-unenumerated")
    elif itype == "use-case" and not item.get("acceptance"):
        # status is `none` or `empty`: genuinely nothing authored. THIS is the only
        # state in which telling a human to author acceptance is correct.
        labels.append("needs-acceptance")
    return labels


# --------------------------------------------------------------------------- #
# Errors (declared here: the state mapping below raises, and main() catches
# LinearError -> exit 1 with a message rather than a traceback)
# --------------------------------------------------------------------------- #
class LinearError(Exception):
    pass


# --------------------------------------------------------------------------- #
# State -> board-status name mapping (linear-mapping §2)
# --------------------------------------------------------------------------- #
# Candidate status names are tried IN ORDER against the team's real workflow
# states (resolve_state_id) — the first that exists wins, so a list can carry a
# preferred name a given workspace may not have. Nothing here CREATES a workflow
# state; unresolvable names simply fall through.
#
# CANCELLED / AWAITING-OBSERVATION: `cancelled` (state-graph v5) and
# `awaiting_observation` (v9) were both absent from this table for their whole
# lifetimes, and the old `table.get(state, ["Backlog"])` fallback rendered them
# as unstarted Backlog with no signal — OI-LINEAR-CANCELLED-STATE-UNMAPPED. The
# entries below close that; `desired_status_names` now REFUSES rather than
# degrades, and `audit_state_status` derives coverage from state-graphs.json so
# the table cannot silently drift from the graph again.
_CANCELLED = ["Cancelled", "Canceled"]  # US spelling is what this workspace has
# An `awaiting_observation` item is shipped-but-unproven: owner-class `external`,
# derived queue `waiting` — the same PARKED class as `blocked` (work-items.py
# _PARKED_STATES). No workspace we project to has a dedicated status, so it reads
# as the closest honest one, Blocked, and is told apart from a true block by the
# `awaiting-observation` LABEL (compose_labels). It must never read as Backlog:
# the item is deployed and verified, merely unconfirmed by reality.
_AWAITING = ["Awaiting Observation", "Blocked", "In Review", "Todo", "Backlog"]
_BLOCKED = ["Blocked", "Todo", "Backlog"]

STATE_STATUS = {
    "use-case": {
        "registered": ["Backlog"],
        "ready": ["Ready", "Todo", "Backlog"],
        "building": ["In Progress"],
        "deploying": ["In Progress"],
        "validating": ["In Review"],
        "dev-validating": ["In Review"],
        "prod-deploying": ["In Progress"],
        "prod-validating": ["In Review"],
        "reworking": ["In Progress (rework)", "In Progress"],
        "blocked": _BLOCKED,
        "awaiting_observation": _AWAITING,
        "done": ["Done"],
        "cancelled": _CANCELLED,
    },
    "defect": {
        "reported": ["Backlog"],
        "reproducing": ["In Progress"],
        "fixing": ["In Progress"],
        "validating": ["In Review"],
        "blocked": _BLOCKED,
        "awaiting_observation": _AWAITING,
        "resolved": ["Done"],
        "wontfix": _CANCELLED,
        "cancelled": _CANCELLED,
    },
    "open-item": {
        "open": ["Backlog"],
        "scheduled": ["Ready", "Todo", "Backlog"],
        "done": ["Done"],
        "wontfix": _CANCELLED,
        "cancelled": _CANCELLED,
    },
}
# Aggregate items (slice/chunk/requirement) hold ONLY what the bubble can produce
# (work-items.py `_bubble`), so they get their own EXACT table rather than a copy
# of the use-case one. The copy was a superset carrying a dozen states an
# aggregate can never hold, which defeated the inverse sweep: stale keys could
# hide there indefinitely.
_AGGREGATE_STATUS = {
    "planned": ["Backlog"],
    "in_progress": ["In Progress"],
    "blocked": _BLOCKED,
    "awaiting_observation": _AWAITING,
    "done": ["Done"],
    "cancelled": _CANCELLED,
}
for _agg in ("slice", "chunk", "requirement"):
    STATE_STATUS[_agg] = dict(_AGGREGATE_STATUS)


class UnmappedStateError(LinearError):
    """A state the projector cannot HONESTLY render. Raised, never defaulted:
    the whole point of OI-LINEAR-CANCELLED-STATE-UNMAPPED is that a wrong board
    status is worse than a refused projection, because it reads as real work."""


def desired_status_names(itype, state):
    """The board-status candidates for (itype, state).

    FAIL-CLOSED. There is deliberately NO fallback: an unmapped state, an unknown
    item type, or a missing derived.state RAISES. The previous silent degradation
    to ["Backlog"] is exactly how a terminal `cancelled` item spent from
    state-graph v5 until 2026-08-03 rendering as unstarted work, and how two
    deployed-and-verified `awaiting_observation` items (UC-ML1, UC-XC5) read as
    Backlog — with no error, log or exception anywhere to notice."""
    table = STATE_STATUS.get(itype)
    if table is None:
        raise UnmappedStateError(
            f"unknown item type {itype!r}: no STATE_STATUS table. Projection "
            f"REFUSED (it would have silently borrowed the use-case mapping). "
            f"Add the type to STATE_STATUS in .claude/tools/linear-project.py "
            f"(source of truth: process/machinery/state-graphs.json). "
            f"Known types: {sorted(STATE_STATUS)}"
        )
    if state is None:
        raise UnmappedStateError(
            f"item type {itype!r} has NO derived.state to project. Projection "
            f"REFUSED (it would have silently rendered as Backlog). Run "
            f"`make wi-project` to regenerate the derived block, or check the "
            f"item's frontmatter parses (source of truth: "
            f"process/machinery/state-graphs.json)."
        )
    if state not in table:
        raise UnmappedStateError(
            f"unmapped state {state!r} for item type {itype!r}. Projection "
            f"REFUSED (it would have silently rendered as Backlog — i.e. as "
            f"unstarted work). Add {state!r} to STATE_STATUS[{itype!r}] in "
            f".claude/tools/linear-project.py; the state is defined in the "
            f"source of truth process/machinery/state-graphs.json. "
            f"Mapped states for {itype!r}: {sorted(table)}"
        )
    return table[state]


# --------------------------------------------------------------------------- #
# STATE_STATUS <-> state-graphs.json drift audit (pure)
#
# The root cause was a hand-maintained table with no mechanical tie to the graph
# it mirrors. These helpers DERIVE the expected coverage from the graph file, so
# the offline test (linear-project.test.py) goes red the moment a new state lands
# unmapped — instead of the board quietly misreporting it for months.
# --------------------------------------------------------------------------- #
STATE_GRAPHS_PATH = ROOT / "process" / "machinery" / "state-graphs.json"
# The aggregate bubble's own working state (work-items.py `_bubble` -> the only
# state it emits that is neither the initial, a terminal, nor an external wait).
AGGREGATE_WORKING_STATE = "in_progress"


def load_state_graphs(path=None):
    p = Path(path) if path else STATE_GRAPHS_PATH
    return json.loads(p.read_text(encoding="utf-8"))


def external_wait_states(graphs):
    """The PARKED states, read from the graph's own `state_owners` rather than
    hand-listed: owner-class `external` == waiting on the outside world. Keeps
    the aggregate range self-maintaining if a third external wait is ever added."""
    owners = graphs.get("state_owners", {})
    return {s for s, owner in owners.items() if owner == "external"}


def graph_states(graphs, itype):
    """Every state an item of `itype` can HOLD, derived from state-graphs.json.

    Flow types: initial + terminal + every `from`/`to` in the transition table.
    Aggregate types declare no transitions (their state BUBBLES from children per
    work-items.py `_bubble`), so their range is initial + terminal + the working
    state + the external-wait states an all-parked aggregate bubbles to."""
    t = graphs.get("types", {}).get(itype)
    if t is None:
        return set()
    states = {t.get("initial")} | set(t.get("terminal", []))
    if t.get("kind") == "aggregate":
        states |= {AGGREGATE_WORKING_STATE} | external_wait_states(graphs)
    else:
        for tr in t.get("transitions", []):
            states.add(tr.get("from"))
            states.add(tr.get("to"))
    return {s for s in states if s}


def audit_state_status(graphs=None):
    """Both directions (there is no half of this worth having):
      ('unmapped', itype, state)      a state the graph defines, table lacks
                                      -> the live defect class; board lies.
      ('unknown-state', itype, state)  a table key naming no real graph state
                                      -> stale editorial debt; hides drift.
      ('untyped', itype, None)         a graph type with no table at all.
    Returns [] when the table and the graph agree exactly."""
    graphs = graphs if graphs is not None else load_state_graphs()
    gaps = []
    for itype in graphs.get("types", {}):
        expected = graph_states(graphs, itype)
        table = STATE_STATUS.get(itype)
        if table is None:
            gaps.append(("untyped", itype, None))
            continue
        for state in sorted(expected - set(table)):
            gaps.append(("unmapped", itype, state))
        for state in sorted(set(table) - expected):
            gaps.append(("unknown-state", itype, state))
    return gaps


def project_state_pairs(project):
    """The (type, state) pairs ACTUALLY present in a project's item files — the
    audit against reality rather than against the graph. Cheap frontmatter read;
    no machinery import (this tool stays stdlib-only and standalone)."""
    pairs = set()
    for sub in ("active", "done"):
        d = ROOT / "work" / project / "items" / sub
        if not d.is_dir():
            continue
        for p in sorted(d.glob("*.md")):
            fm, _ = split_item(p.read_text(encoding="utf-8"))
            data = parse_frontmatter(fm)
            if data.get("type") and data.get("state"):
                pairs.add((data["type"], data["state"]))
    return pairs


def run_audit(project=None):
    """CLI `--audit`: report drift both directions, plus (with --project) every
    real item state. Exits non-zero on any finding — usable as a standing gate."""
    graphs = load_state_graphs()
    gaps = audit_state_status(graphs)
    for kind, itype, state in gaps:
        if kind == "unmapped":
            print(f"UNMAPPED      {itype}/{state}: graph defines it, STATE_STATUS "
                  f"does not -> would render as Backlog")
        elif kind == "unknown-state":
            print(f"STALE-KEY     {itype}/{state}: STATE_STATUS maps it, the graph "
                  f"defines no such state for this type")
        else:
            print(f"UNTYPED       {itype}: graph type has no STATE_STATUS table")
    bad_real = []
    if project:
        print(f"real (type,state) pairs in {project} -> status candidates, tried "
              f"in order; the FIRST that exists in the team's workflow wins "
              f"(offline: candidates are not resolved against the live team here)")
        for itype, state in sorted(project_state_pairs(project)):
            try:
                names = desired_status_names(itype, state)
                print(f"ok  {itype}/{state} -> {' | '.join(names)}")
            except UnmappedStateError as e:
                bad_real.append((itype, state))
                print(f"UNPROJECTABLE {itype}/{state}: {e}")
    if gaps or bad_real:
        print(f"\nAUDIT FAILED: {len(gaps)} table/graph gap(s), "
              f"{len(bad_real)} unprojectable real item state(s)")
        return 1
    print("\nAUDIT CLEAN: STATE_STATUS matches state-graphs.json exactly"
          + (f", and every real item state in {project} projects" if project else ""))
    return 0


# --------------------------------------------------------------------------- #
# Linear GraphQL client
# --------------------------------------------------------------------------- #
# --------------------------------------------------------------------------- #
# Tree-wide acceptance sweep + audit gate (AC-AP.1 / AC-AP.3 / AC-AP.4)
#
# `f694ea3` established that the tree-wide answer can be catastrophically wrong
# while looking fine: the parser matched NOTHING across every item and the only
# symptom was a `needs-acceptance` label sitting on ~100% of the board. A parser
# that is only exercised one item at a time, by a board sync nobody reads the
# stderr of, has no observer. This is that observer, and it is a GATE.
#
# WHY A GATE AND NOT A LOOSER REGEX (AC-AP.4, decision recorded). Three formats
# plus a terminator bug were fixed tree-wide in `f694ea3`; a FOURTH format broke it
# the next day. Chasing formats is the "exempt it every time it is used" shape
# (`OI-GITIGNORE-SWALLOWS-COMMITTED-TOOLS`). So the parse was made robust
# STRUCTURALLY — level-aware sections, every section, a criterion is any line that
# DECLARES an id — and, more importantly, it now CHECKS ITSELF: an id standing in a
# declaration position that reached no criterion is a residual, and a residual makes
# the verdict `truncated`. Format five cannot silently under-count, because the
# parse is no longer the only witness to its own output. The sweep is what turns
# that self-check from a per-item warning into a tree-wide, blocking fact.
#
# §17h: no class here is described as benign. Every class is printed with its
# MEASURED SIZE, including `parsed` and `none`, and four of the seven can go red.
# --------------------------------------------------------------------------- #
#: Classes that are a FINDING: the item's acceptance is present and not fully
#: readable. Hard zero — no count ratchet, because each one is an individually
#: nameable item, not a population.
FINDING_STATUSES = ("truncated", "unreadable", "orphan", "unenumerated")
DECLARED_PATH = Path(__file__).resolve().parent / "acceptance-audit-declared.json"


def sweep_acceptance(project, root=None):
    """Every item under work/<project>/items/{active,done}/ with its acceptance
    verdict. Pure: reads files, no network. Sorted by id for a stable report."""
    base = Path(root) if root else ROOT
    rows = []
    for sub in ("active", "done"):
        d = base / "work" / project / "items" / sub
        if not d.is_dir():
            continue
        for f in sorted(d.glob("*.md")):
            fm, body = split_item(f.read_text(encoding="utf-8"))
            data = parse_frontmatter(fm)
            rep = acceptance_report(body)
            rows.append({
                "id": data.get("id") or f.stem,
                "type": data.get("type", ""),
                "state": data.get("state", ""),
                "queue": sub,
                "path": str(f.relative_to(base)),
                "status": rep["status"],
                "criteria": rep["criteria"],
                "residual_ids": rep["residual_ids"],
                "orphan_ids": rep["orphan_ids"],
                "sections": rep["sections"],
            })
    return sorted(rows, key=lambda r: r["id"])


#: §17g GENERALISATION SWEEP — "where ELSE does an extractor's failure look exactly
#: like a legitimate empty answer?" Asked of every extractor in this file, and the
#: answer was worse than the reported defect: TWO MORE match NOTHING tree-wide.
#:
#: Each row is (name, extractor-callable-key, "what a zero means"). The measured
#: population is printed by `--acceptance-audit` on every run and PINNED by
#: `linear-project.test.py`, in BOTH directions — a pinned-zero extractor that starts
#: matching also goes red, forcing the ledger to be updated rather than drifting. The
#: cure for this class is not vigilance, it is that a tree-wide zero cannot be quiet.
#:
#: MEASURED 2026-08-19 over the real 468-item OagEventSource corpus:
#:   acceptance             219 sections / 1081 criteria   FIXED by this item
#:   definition_oneliner      0 / 468   FINDING — matches `## Definition — <text>`;
#:                                     NO item writes a dash-suffixed heading. Masked
#:                                     because compose() falls back to the title, so
#:                                     the board renders the title twice and looks fine.
#:   why                      1 / 469   FINDING — matches `**Why (persona/job):**`; no
#:                                     item USES that literal. The "Contribution" line
#:                                     has therefore NEVER rendered on any board issue.
#:                                     The single hit is the ledger PROSE of
#:                                     OI-ACCEPTANCE-PARSER-SCORES-ZERO-SILENTLY, which
#:                                     quotes the literal while recording that nothing
#:                                     uses it — the extractor matched the sentence
#:                                     documenting that it matches nothing, and the pin
#:                                     caught that contamination immediately. One
#:                                     self-referential mention in 469 items is STRONGER
#:                                     evidence than a bare zero.
#:   defect_fields           53 / 97 defects, 44 with ZERO fields — the `## Defect
#:                                     (four fields)` shape is not what half the
#:                                     corpus writes, so those issues carry no Defect
#:                                     section at all.
#:   job_resolved           352 / 468 items carrying a `job`; 116 unresolved over 8
#:                                     distinct codes (J1–J5, J9 absent from
#:                                     jtbd-map.md, plus compound values like `J0/J3`
#:                                     the resolver cannot express). Degradation here
#:                                     is VISIBLE (a bare code renders instead of the
#:                                     job name), which is why it is lower severity
#:                                     than the two silent zeros.
#:   persona_resolved        all resolve — healthy.
#:   block_note             the `blocked` banner; see the measured figure below.
#: NOT fixed here and deliberately NOT fixed blind: what the authoring surface for
#: `Definition`/`Why`/`Defect` SHOULD be is a linear-mapping §2a decision, not an
#: engineer's regex guess — the same reasoning that keeps `unenumerated` items out of
#: an engineer's hands (§12a). Registered in this ledger, reported every run.
EXTRACTOR_LEDGER = (
    ("acceptance", "a zero conflated 'no acceptance authored' with 'unreadable'",
     "FIXED — acceptance_report() + make acceptance-audit"),
    ("definition_oneliner", "an omitted 'What this delivers'; masked by the title fallback",
     "FINDING — 0/468, owner: linear-mapping §2a authoring decision"),
    ("why", "an omitted 'Contribution' line on every board issue",
     "FINDING — 1/469 and the one hit is this ledger's own prose, owner: "
     "linear-mapping §2a authoring decision"),
    ("defect_fields", "a defect issue with no Defect section",
     "FINDING — 44 of 97 defects at zero, owner: linear-mapping §2a"),
    ("job_resolved", "a bare job code instead of the job name (VISIBLE degradation)",
     "FINDING — 116 unresolved over 8 codes, owner: product/jtbd-map.md"),
    ("persona_resolved", "a bare persona code instead of the persona name",
     "healthy — all resolve"),
    ("block_note", "a blocked item with no reason banner",
     "reported; a blocked item with no note in its log is legitimate"),
)


def extractor_population(project, root=None):
    """Measure EVERY extractor in this file against the real corpus.

    An extractor that matches NOTHING tree-wide is the reported defect's whole shape,
    and it is invisible per-item: each individual empty answer is indistinguishable
    from an item that legitimately lacks the field. Only the POPULATION can tell.
    """
    base = Path(root) if root else ROOT
    jt_p = base / "work" / project / "product" / "jtbd-map.md"
    per_p = base / "work" / project / "product" / "personas.md"
    jt = jt_p.read_text(encoding="utf-8") if jt_p.exists() else ""
    per = per_p.read_text(encoding="utf-8") if per_p.exists() else ""
    pop = {k: {"hits": 0, "total": 0} for k, _w, _s in EXTRACTOR_LEDGER}
    for sub in ("active", "done"):
        d = base / "work" / project / "items" / sub
        if not d.is_dir():
            continue
        for f in sorted(d.glob("*.md")):
            fm, body = split_item(f.read_text(encoding="utf-8"))
            data = parse_frontmatter(fm)
            rep = acceptance_report(body)
            pop["acceptance"]["total"] += 1
            pop["acceptance"]["hits"] += 1 if rep["criteria"] else 0
            for key, fn in (("definition_oneliner", parse_definition_oneliner),
                            ("why", parse_why)):
                pop[key]["total"] += 1
                pop[key]["hits"] += 1 if fn(body) else 0
            if data.get("type") == "defect":
                pop["defect_fields"]["total"] += 1
                pop["defect_fields"]["hits"] += 1 if parse_defect_fields(body) else 0
            if data.get("job"):
                pop["job_resolved"]["total"] += 1
                pop["job_resolved"]["hits"] += 1 if resolve_job(data["job"], jt) != data["job"] else 0
            for pid in data.get("personas") or []:
                pop["persona_resolved"]["total"] += 1
                pop["persona_resolved"]["hits"] += 1 if resolve_persona(pid, per) != pid else 0
            if data.get("state") == "blocked":
                pop["block_note"]["total"] += 1
                pop["block_note"]["hits"] += 1 if _latest_block_note(body) else 0
    return pop


def load_declared(path=None):
    """The declared-exception registry. §17h limb 1: an exclusion of an item from
    the finding population is a decision and carries a machine-checkable AUTHORITY
    ref. An entry with no authority is itself a finding."""
    p = Path(path) if path else DECLARED_PATH
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8")).get("declared", {})


def audit_acceptance(project, root=None, declared_path=None):
    """Run the sweep and return (rows, counts, errors).

    `errors` is empty only when EVERY finding is either absent or declared with an
    authority, AND no declaration has gone stale. Stale declarations fail too: that
    is what makes this shrink-only rather than a high-water mark that drifts
    (§17d.5 — a ratchet only a human can tighten is not a ratchet)."""
    rows = sweep_acceptance(project, root=root)
    counts = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    declared = load_declared(declared_path)
    findings = {r["id"]: r for r in rows if r["status"] in FINDING_STATUSES}
    errors = []
    for iid, r in sorted(findings.items()):
        d = declared.get(iid)
        if not d:
            detail = ""
            if r["residual_ids"]:
                detail = " ids reaching no criterion: %s." % ", ".join(r["residual_ids"])
            if r["orphan_ids"]:
                detail = " AC-led list outside any recognised section: %s." % ", ".join(
                    r["orphan_ids"])
            errors.append(
                "%s (%s) status=%s — acceptance is PRESENT but not fully readable.%s "
                "Fix the parser if it is a parser fault; if the acceptance is genuinely "
                "not enumerable, that is PRODUCT/ARCHITECT work (§12a) and must be "
                "declared in %s with an authority ref."
                % (iid, r["path"], r["status"], detail, DECLARED_PATH.name)
            )
        elif not str(d.get("authority", "")).strip():
            errors.append(
                "%s is declared in %s with NO `authority` — §17h: an exclusion with no "
                "authority is a FINDING, not a sample." % (iid, DECLARED_PATH.name)
            )
        elif d.get("status") and d["status"] != r["status"]:
            errors.append(
                "%s is declared as status=%s but now measures %s — re-decide it rather "
                "than carrying a stale exemption." % (iid, d["status"], r["status"])
            )
    for iid in sorted(declared):
        if iid not in findings:
            errors.append(
                "%s is declared as a known acceptance finding but is NO LONGER one — "
                "delete the row from %s. A declaration that outlives its finding is how "
                "a ratchet becomes a high-water mark." % (iid, DECLARED_PATH.name)
            )
    return rows, counts, errors


def run_acceptance_audit(project, root=None, declared_path=None, verbose=True):
    rows, counts, errors = audit_acceptance(project, root=root, declared_path=declared_path)
    if verbose:
        print("acceptance sweep — %s: %d items" % (project, len(rows)))
        # Every class with its measured size. `parsed`/`none`/`empty` are printed too:
        # a class that is never reported cannot be noticed when it moves.
        for status in ("parsed", "truncated", "unreadable", "unenumerated", "empty",
                       "none", "orphan"):
            n = counts.get(status, 0)
            crit = sum(len(r["criteria"]) for r in rows if r["status"] == status)
            print("  %-13s %4d items%s" % (status, n, (", %d criteria" % crit) if crit else ""))
        print("  %-13s %4d criteria across the corpus"
              % ("TOTAL", sum(len(r["criteria"]) for r in rows)))
        # §17g sweep: the SIBLING extractors' populations, every run. Two of them
        # match NOTHING tree-wide — the reported defect's exact shape, one file over.
        print("  --- extractor populations (§17g sweep; a tree-wide ZERO is a finding)")
        pop = extractor_population(project, root=root)
        for key, meaning, verdict in EXTRACTOR_LEDGER:
            n, tot = pop[key]["hits"], pop[key]["total"]
            flag = "  <== ZERO TREE-WIDE" if tot and not n else ""
            print("      %-20s %4d / %-4d  %s%s" % (key, n, tot, verdict, flag))
            print("      %-20s        %s" % ("", meaning))
        declared = load_declared(declared_path)
        for r in rows:
            if r["status"] in FINDING_STATUSES:
                mark = "declared" if r["id"] in declared else "FINDING "
                print("  [%s] %-46s %-13s %s"
                      % (mark, r["id"], r["status"],
                         ",".join(r["residual_ids"] + r["orphan_ids"])))
    if errors:
        print("\nacceptance audit FAILED — %d finding(s):" % len(errors))
        for e in errors:
            print("  - " + e)
        return 1
    if verbose:
        print("\nacceptance audit PASS — every unreadable acceptance is declared with an "
              "authority, and no declaration has gone stale.")
    return 0


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
    ap.add_argument("--project", required=False)
    ap.add_argument("--id", required=False, dest="item_id")
    ap.add_argument(
        "--audit",
        action="store_true",
        help="offline: report STATE_STATUS drift against process/machinery/"
             "state-graphs.json (both directions) and, with --project, every real "
             "item state. No network, no secret. Non-zero on any finding.",
    )
    ap.add_argument(
        "--acceptance-audit",
        action="store_true",
        help="offline: sweep EVERY item's acceptance and report the verdict class of "
             "each (AC-AP.3). Non-zero when an item's acceptance is present but not "
             "fully readable and is not declared with an authority ref. No network.",
    )
    ap.add_argument("--root", default=None,
                    help="alternate repo root for the acceptance sweep (used by the "
                         "non-vacuity demonstration, which must drive the REAL CLI).")
    ap.add_argument("--declared", default=None,
                    help="alternate declared-exception registry path.")
    args = ap.parse_args(argv)
    if args.acceptance_audit:
        if not args.project:
            ap.error("--acceptance-audit requires --project")
        return run_acceptance_audit(args.project, root=args.root,
                                    declared_path=args.declared)
    if args.audit:
        try:
            return run_audit(args.project)
        except (LinearError, FileNotFoundError, KeyError) as e:
            print(f"linear-project: ERROR: {e}", file=sys.stderr)
            return 1
    if not args.project or not args.item_id:
        ap.error("--project and --id are required (or use --audit)")
    try:
        return upsert(args.project, args.item_id)
    except (LinearError, FileNotFoundError, KeyError) as e:
        print(f"linear-project: ERROR: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
