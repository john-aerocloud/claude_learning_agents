#!/usr/bin/env python3
"""DORA ledger tool. Append events and compute the four key metrics.

Usage:
  dora.py record --project P --iteration N --slice S --agent A --event E \
      [--duration SECONDS] [--outcome O] [--ref R] [--note "..."]
  dora.py compute            # rewrites process/dora/baseline.md from ledger.csv

Events:  task_start task_end deploy failure recovery gate
Outcomes: success fail rolled_forward rolled_back na
All times UTC ISO-8601. Ledger is append-only.
"""
import argparse, csv, os, statistics, sys
from datetime import datetime, timezone
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
LEDGER = os.path.join(ROOT, "process", "dora", "ledger.csv")
BASELINE = os.path.join(ROOT, "process", "dora", "baseline.md")
COLS = ["timestamp","project","iteration","slice","agent","event",
        "duration_s","outcome","ref","note"]
AGENTS = ["product","solution-architect","cicd","engineer","ui-designer","tester","documenter","orchestrator"]

def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def parse_ts(s):
    try:
        return datetime.fromisoformat(s.replace("Z","+00:00"))
    except Exception:
        return None

def read_rows():
    rows = []
    if not os.path.exists(LEDGER):
        return rows
    with open(LEDGER) as f:
        for line in f:
            if line.startswith("#") or not line.strip():
                continue
            r = next(csv.reader([line]))
            if r and r[0] == "timestamp":
                continue
            r += [""] * (len(COLS) - len(r))
            rows.append(dict(zip(COLS, r)))
    return rows

def cmd_record(a):
    new = not os.path.exists(LEDGER)
    with open(LEDGER, "a", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(COLS)
        w.writerow([now_iso(), a.project, a.iteration, a.slice, a.agent,
                    a.event, a.duration or "", a.outcome or "na",
                    a.ref or "", a.note or ""])
    print(f"recorded {a.event} for {a.agent} ({a.project}/{a.slice})")

def modal(xs):
    if not xs: return None
    try: return statistics.mode(xs)
    except statistics.StatisticsError: return statistics.median(xs)

def fmt(x):
    return "—" if x is None else (f"{x:.0f}" if isinstance(x,(int,float)) else str(x))

def cmd_compute(_):
    rows = read_rows()
    # per-agent task durations
    durs = defaultdict(list)
    for r in rows:
        if r["event"] == "task_end" and r["duration_s"].strip():
            try: durs[r["agent"]].append(float(r["duration_s"]))
            except ValueError: pass
    # deploys, failures, recoveries
    deploys = [r for r in rows if r["event"] == "deploy"]
    failures = [r for r in rows if r["event"] == "failure"]
    days = {parse_ts(r["timestamp"]).date() for r in rows if parse_ts(r["timestamp"])}
    deploy_freq = (len(deploys)/len(days)) if days else None
    cfr = (len(failures)/len(deploys)*100) if deploys else None
    # MTTR: pair each failure with the next recovery in the same slice
    recs = sorted([r for r in rows if r["event"]=="recovery"], key=lambda r:r["timestamp"])
    mttrs = []
    for frow in failures:
        ft = parse_ts(frow["timestamp"])
        for rec in recs:
            if rec["slice"]==frow["slice"] and rec["project"]==frow["project"]:
                rt = parse_ts(rec["timestamp"])
                if ft and rt and rt >= ft:
                    mttrs.append((rt-ft).total_seconds()); break
    mttr = statistics.median(mttrs) if mttrs else None
    # gross lead time per slice: first task_start -> first successful deploy
    starts, ships = {}, {}
    for r in rows:
        key = (r["project"], r["slice"])
        ts = parse_ts(r["timestamp"])
        if not ts: continue
        if r["event"]=="task_start":
            starts[key] = min(starts.get(key, ts), ts)
        if r["event"]=="deploy" and r["outcome"] in ("success","rolled_forward"):
            ships[key] = min(ships.get(key, ts), ts)
    leads = [(ships[k]-starts[k]).total_seconds() for k in ships if k in starts and ships[k]>=starts[k]]
    lead = statistics.median(leads) if leads else None

    L = []
    L.append("# DORA Baseline (computed)\n")
    L.append(f"_Generated {now_iso()} from ledger.csv. Do not hand-edit._\n")
    L.append("## Four key metrics (whole pipeline)\n")
    L.append("| Metric | Value | Window |")
    L.append("|--------|-------|--------|")
    L.append(f"| Gross lead time (median) | {fmt(lead)} s | {len(leads)} slice(s) |")
    L.append(f"| Deployment frequency | {fmt(deploy_freq)} /active-day | {len(days)} day(s) |")
    L.append(f"| Change failure rate | {fmt(cfr)} % | {len(deploys)} deploy(s) |")
    L.append(f"| MTTR (median) | {fmt(mttr)} s | {len(mttrs)} failure(s) |\n")
    L.append("## Per-agent task completion (seconds)\n")
    L.append("| Agent | n | modal | median | mean |")
    L.append("|-------|---|-------|--------|------|")
    for ag in AGENTS:
        xs = durs.get(ag, [])
        L.append(f"| {ag} | {len(xs)} | {fmt(modal(xs))} | "
                 f"{fmt(statistics.median(xs) if xs else None)} | "
                 f"{fmt(statistics.mean(xs) if xs else None)} |")
    # constraint = agent with highest median task time
    med = {ag: statistics.median(durs[ag]) for ag in durs if durs[ag]}
    constraint = max(med, key=med.get) if med else None
    L.append("\n## Theory-of-Constraints read\n")
    L.append(f"- Constraint (slowest median step): **{fmt(constraint)}**")
    L.append("- Recommended exploit/subordinate action: _(orchestrator fills in)_")
    with open(BASELINE, "w") as f:
        f.write("\n".join(L) + "\n")
    print(f"wrote {BASELINE} | lead={fmt(lead)}s freq={fmt(deploy_freq)} cfr={fmt(cfr)}% mttr={fmt(mttr)}s constraint={constraint}")

def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("record")
    for n in ["project","iteration","slice","agent","event"]:
        r.add_argument(f"--{n}", required=True)
    for n in ["duration","outcome","ref","note"]:
        r.add_argument(f"--{n}")
    r.set_defaults(func=cmd_record)
    c = sub.add_parser("compute"); c.set_defaults(func=cmd_compute)
    a = p.parse_args(); a.func(a)

if __name__ == "__main__":
    main()
