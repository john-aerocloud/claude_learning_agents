#!/usr/bin/env python3
"""Claude Code status line — one cheap Python process per refresh.

Reads three things and prints a single line:
  1. stdin           — Claude Code's status JSON (model, cost, transcript, cwd)
  2. process/dora/statusline.json — pre-computed TRAILING-WINDOW DORA snapshot,
     written by dora.py whenever baseline.md / flow.md are regenerated. We never
     grep the big markdown files or run dora.py here — that would burn usage.
  3. tail of the transcript — live context-token usage + % of the context window.

Output, e.g.:
  Opus  OagEventSource  $0.0234  ctx 84.2k 8%  │  CFR 8%  freq 2/day  lead 7492s  par 0.25
"""
import sys, json, os

# Windows consoles default to cp1252, which can't encode the box-drawing and
# dash glyphs below — force UTF-8 so the bar renders under PowerShell/cmd.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
RED = "\033[31m"
YELLOW = "\033[33m"
GREEN = "\033[32m"
CYAN = "\033[36m"


def metric(label, value, unit=""):
    """Dim label, bold value — so the numbers carry the eye."""
    return f"{DIM}{label}{RESET} {BOLD}{v(value)}{unit}{RESET}"


def main():
    try:
        d = json.load(sys.stdin)
    except Exception:
        d = {}

    model_obj = d.get("model") or {}
    model = model_obj.get("display_name") or "?"
    model_id = model_obj.get("id") or ""
    cost = (d.get("cost") or {}).get("total_cost_usd")
    root = (d.get("workspace") or {}).get("project_dir") or os.getcwd()

    # --- cheap DORA snapshot (trailing window) ------------------------------
    snap = _load_json(os.path.join(root, "process", "dora", "statusline.json"))
    project = snap.get("project") or _read(os.path.join(root, "work", "ACTIVE")) or "—"

    # --- live context usage from the transcript tail ------------------------
    ctx_tokens, ctx_pct = context_usage(d.get("transcript_path"), model_id)

    # --- assemble -----------------------------------------------------------
    seg_model = f"{BOLD}{model}{RESET}"
    seg_proj = f"{BOLD}{CYAN}{project}{RESET}"
    cost_str = f"${cost:.4f}" if isinstance(cost, (int, float)) else "$—"
    seg_cost = f"{BOLD}{cost_str}{RESET}"

    # context segment — grade the colour by how full the window is
    if ctx_pct is None:
        seg_ctx = f"{DIM}ctx{RESET} {BOLD}—{RESET}"
    else:
        clr = RED if ctx_pct >= 75 else YELLOW if ctx_pct >= 50 else GREEN
        seg_ctx = f"{DIM}ctx{RESET} {BOLD}{clr}{human(ctx_tokens)} {ctx_pct}%{RESET}"

    dora = "  ".join([
        metric("CFR", snap.get("cfr"), "%"),
        metric("freq", snap.get("freq"), "/day"),
        metric("lead", snap.get("lead"), "s"),
        metric("par", snap.get("par")),
    ])
    sys.stdout.write(f"{seg_model}  {seg_proj}  {seg_cost}  {seg_ctx}  {DIM}│{RESET}  {dora}")


def _read(path):
    try:
        with open(path) as f:
            return f.read().strip()
    except Exception:
        return None


def _load_json(path):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}


def v(x):
    return "–" if x is None else str(x)


def human(n):
    if n is None:
        return "—"
    return f"{n / 1000:.1f}k" if n >= 1000 else str(n)


def context_limit(model_id):
    """Context-window size for the active model. The `[1m]` suffix is Claude Code's
    explicit 1M-beta-variant marker; beyond that, the current Claude 4.x families
    (Opus 4.6/4.7/4.8, Sonnet 4.6, Fable 5 / Mythos 5) ship a 1M window natively —
    their bare ids (e.g. `claude-opus-4-8`) carry no marker. Haiku and anything
    unrecognised stay at the conservative 200K."""
    mid = (model_id or "").lower()
    if "[1m]" in mid:
        return 1_000_000
    if "haiku" in mid:
        return 200_000
    if any(m in mid for m in (
        "opus-4-8", "opus-4-7", "opus-4-6", "sonnet-4-6", "fable-5", "mythos-5",
    )):
        return 1_000_000
    return 200_000


def context_usage(transcript_path, model_id):
    """Sum the input side of the last request in the transcript = current context
    occupancy. Read only the file tail so cost stays flat regardless of length."""
    if not transcript_path or not os.path.exists(transcript_path):
        return None, None
    limit = context_limit(model_id)
    usage = None
    try:
        with open(transcript_path, "rb") as f:
            try:
                f.seek(-262_144, os.SEEK_END)   # last 256 KB is plenty
            except OSError:
                f.seek(0)
            lines = f.read().decode("utf-8", "replace").splitlines()
        for line in reversed(lines):
            line = line.strip()
            if not line or '"usage"' not in line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            u = (obj.get("message") or {}).get("usage") or obj.get("usage")
            if u and u.get("input_tokens") is not None:
                usage = u
                break
    except Exception:
        return None, None
    if not usage:
        return None, None
    used = (usage.get("input_tokens", 0)
            + usage.get("cache_read_input_tokens", 0)
            + usage.get("cache_creation_input_tokens", 0))
    pct = round(100 * used / limit) if limit else 0
    return used, pct


if __name__ == "__main__":
    main()
