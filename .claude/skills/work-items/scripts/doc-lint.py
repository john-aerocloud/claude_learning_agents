#!/usr/bin/env python3
"""doc-lint — process-doc conformance gate (process §27.5).

Scans the LIVE process/agent/skill/root docs for a DENYLIST of RETIRED mechanics
from the QueueApproach delivery model (event-log ledger + hand-synced queue CSVs).
The event-sourced work-item substrate (v82, process/machinery/CONTRACT.md) is the
sole source of truth now; any live doc that still tells an agent to use a retired
mechanic is a drift hazard.

Exit non-zero listing file:line for every hit; print clean and exit 0 otherwise.

A line may carry an inline `<!-- doc-lint:allow -->` escape to whitelist a legit
mention (e.g. the dora-ledger frozen-archive stub, or a historical citation).

stdlib-only. Invoke via `make doc-lint` (uses the same python the dora launcher
resolves). Paths are resolved relative to the repo root (this script's ../../../..).
"""
import os
import re
import sys

# Repo root: .claude/skills/work-items/scripts/doc-lint.py -> up 4.
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))

ALLOW = "doc-lint:allow"
ALLOW_BEGIN = "doc-lint:allow-begin"  # start a sanctioned region (e.g. §F0's command-map)
ALLOW_END = "doc-lint:allow-end"     # end it

# --- The set of LIVE docs to scan -------------------------------------------
# Explicit files + globbed trees. The dora-ledger frozen-archive stub and this
# script itself are EXCLUDED (they legitimately name the retired mechanics).
EXPLICIT = [
    "process/process-current.md",
    "process/README.md",
    "process/linear-mapping.md",
    "CLAUDE.md",
    "README.md",
    "work/README.md",
]
GLOB_DIRS = [
    ".claude/agents",
    ".claude/commands",
    ".claude/skills",
]
EXCLUDE_PATHS = {
    ".claude/skills/dora-ledger/SKILL.md",           # the frozen-archive stub
    ".claude/skills/work-items/scripts/doc-lint.py",  # this script
}


def _is_scannable(rel):
    if rel in EXCLUDE_PATHS:
        return False
    return rel.endswith(".md")


def collect_files():
    files = []
    for rel in EXPLICIT:
        p = os.path.join(ROOT, rel)
        if os.path.isfile(p) and _is_scannable(rel):
            files.append(rel)
    for d in GLOB_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for dirpath, _dirs, filenames in os.walk(base):
            for fn in sorted(filenames):
                abs_p = os.path.join(dirpath, fn)
                rel = os.path.relpath(abs_p, ROOT).replace(os.sep, "/")
                if _is_scannable(rel):
                    files.append(rel)
    # de-dup, stable order
    seen = set()
    out = []
    for f in files:
        if f not in seen:
            seen.add(f)
            out.append(f)
    return out


# --- The DENYLIST of retired mechanics --------------------------------------
# Each rule: (human label, compiled regex). Case-insensitive where safe.
DENYLIST = [
    ("dora record write-path", re.compile(r"\bdora[ \-]record\b", re.I)),
    ("dora.py record", re.compile(r"\bdora\.py\s+record\b", re.I)),
    ("dora.py flow", re.compile(r"\bdora\.py\s+flow\b", re.I)),
    ("dora.py compute", re.compile(r"\bdora\.py\s+compute\b", re.I)),
    ("dora.py cost-split/log-decision (retired subcmd)",
     re.compile(r"\bdora(?:\.py)?[ \-]?(?:cost-split|log-decision)\b", re.I)),
    ("retired dora-* make target", re.compile(r"\bdora-(?:record|compute|flow)\b", re.I)),
    # membership queues are retired (derived into views/queues.*); queues/policy.csv is a
    # LIVE retro-owned buffer-config INPUT and is deliberately NOT flagged.
    ("queues/*.csv membership store",
     re.compile(r"queues/(?:ready|staging|intake|rework|deploy)\.csv", re.I)),
    # state.md as a WRITTEN store is retired; the DERIVED view work/<p>/views/state.md
    # is legitimate, so a `views/`-qualified mention is not a hit.
    ("state.md written store", re.compile(r"(?<!views/)\bstate\.md\b", re.I)),
    ("blocks.csv", re.compile(r"\bblocks\.csv\b", re.I)),
    ("reconcile-registry", re.compile(r"reconcile[- ]registry", re.I)),
    ("ledger-drift", re.compile(r"ledger[- ]drift", re.I)),
    ("sync-linear.py", re.compile(r"\bsync-linear\.py\b", re.I)),
    ("project-state (retired dora subcmd)", re.compile(r"\bproject-state\b", re.I)),
    ("item_done (old event name)", re.compile(r"\bitem_done\b")),
    # --- retired FILE artifacts (v82 re-audit) — replaced by derived views / git tags.
    ("dora/flow.md (retired dora output)", re.compile(r"\bdora/flow\.md\b", re.I)),
    ("baseline.md (retired dora output)", re.compile(r"\bbaseline\.md\b", re.I)),
    ("per-project.md (retired dora output)", re.compile(r"\bper-project\.md\b", re.I)),
    # items-tree.md is retired (derived into views/tree.md); the DERIVED view is fine.
    ("items-tree.md (retired store)", re.compile(r"(?<!views/)\bitems-tree\.md\b", re.I)),
    ("STATE-MODEL.md (retired doc)", re.compile(r"\bSTATE-MODEL\.md\b")),
    # per-version process-history files are retired — snapshots are git tags process-v<NN>.
    ("process-history/v<NN> per-version file", re.compile(r"process-history/v\d")),
]


def scan():
    hits = []  # (rel, lineno, label, line_text)
    for rel in collect_files():
        p = os.path.join(ROOT, rel)
        try:
            with open(p, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
        except OSError as e:
            print(f"doc-lint: cannot read {rel}: {e}", file=sys.stderr)
            continue
        in_allow_region = False
        for i, line in enumerate(lines, start=1):
            if ALLOW_BEGIN in line:
                in_allow_region = True
                continue
            if ALLOW_END in line:
                in_allow_region = False
                continue
            if in_allow_region:
                continue
            if ALLOW in line:
                continue
            for label, rx in DENYLIST:
                if rx.search(line):
                    hits.append((rel, i, label, line.rstrip("\n")))
    return hits


def main():
    hits = scan()
    if not hits:
        print("doc-lint: clean — no retired mechanics in the live docs.")
        return 0
    print(f"doc-lint: {len(hits)} retired-mechanic hit(s) in the live docs:\n")
    for rel, lineno, label, text in hits:
        snippet = text.strip()
        if len(snippet) > 120:
            snippet = snippet[:117] + "..."
        print(f"  {rel}:{lineno}: [{label}]")
        print(f"      {snippet}")
    print(
        "\nEach hit is a live doc still naming a retired QueueApproach mechanic.\n"
        "Repoint it to the event-sourced substrate (make wi-append / wi-project /\n"
        "wi-validate; work/<p>/views/*), or add an inline <!-- doc-lint:allow -->\n"
        "on the line if the mention is a legitimate historical/archive citation."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
