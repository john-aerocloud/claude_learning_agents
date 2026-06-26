#!/usr/bin/env python3
"""DORA ledger tool. Append events and compute the four key metrics.

Usage:
  dora.py record --project P --iteration N --slice S --agent A --event E \
      [--duration SECONDS] [--outcome O] [--ref R] [--note "..."] \
      [--item-id ID] [--queue Q]
  dora.py compute            # rewrites process/dora/baseline.md from ledger.csv
  dora.py flow --project P    # rewrites work/P/dora/flow.md (queues + time thieves)

Events:  task_start task_end deploy failure recovery gate
         enqueue dequeue collision parallel_dispatch stage_enter stage_exit
Outcomes: success fail rolled_forward rolled_back na
All times UTC ISO-8601. Ledger is append-only.

v40 (pull-based flow): adds item_id + queue columns and the flow events above so
per-WORK-ITEM lead time, per-QUEUE length/wait, time-thief attribution, and
parallelism efficiency are computable. Back-compatible: rows written before v40
have 10 fields; read_rows() pads item_id/queue to "" so old data still computes.
"""
import argparse, csv, os, re, statistics, sys
from datetime import datetime, timezone
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
LEDGER = os.path.join(ROOT, "process", "dora", "ledger.csv")
BASELINE = os.path.join(ROOT, "process", "dora", "baseline.md")
STATUSLINE = os.path.join(ROOT, "process", "dora", "statusline.json")
COLS = ["timestamp","project","iteration","slice","agent","event",
        "duration_s","outcome","ref","note","item_id","queue","tokens"]
AGENTS = ["product","solution-architect","cicd","engineer","ui-designer","tester","documenter","orchestrator","flow-manager"]
STAGES = ["cicd","ui-designer","engineer","tester"]

def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def write_statusline(updates):
    """Maintain process/dora/statusline.json — a tiny pre-formatted snapshot the
    Claude Code status line reads VERY cheaply (one small file, no markdown
    grep, no dora.py run per refresh). dora.py is the single writer: compute()
    and flow() each merge their own keys here right after rewriting their big
    markdown file, so the cheap file is always in step with baseline.md/flow.md."""
    import json
    data = {}
    if os.path.exists(STATUSLINE):
        try:
            with open(STATUSLINE) as f:
                data = json.load(f)
        except Exception:
            data = {}
    data.update(updates)   # store None as null so a metric with no data reads as "–"
    with open(STATUSLINE, "w") as f:
        json.dump(data, f, indent=0)

def _r0(x):
    return round(x) if isinstance(x, (int, float)) else None

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
            r += [""] * (len(COLS) - len(r))   # pad pre-v40 rows (10 -> 12)
            rows.append(dict(zip(COLS, r)))
    return rows

def cmd_record(a):
    new = not os.path.exists(LEDGER)
    item_id = (a.item_id or a.slice or "").strip()   # default item_id to slice for back-compat
    with open(LEDGER, "a", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(COLS)
        w.writerow([now_iso(), a.project, a.iteration, a.slice, a.agent,
                    a.event, a.duration or "", a.outcome or "na",
                    a.ref or "", a.note or "", item_id, a.queue or "", a.tokens or ""])
    print(f"recorded {a.event} for {a.agent} ({a.project}/{a.slice}/{item_id})")

def cmd_log_decision(a):
    """Append a row to work/<project>/decision-log.md (mechanical bookkeeping →
    a committed tool, v47, so the orchestrator doesn't Read+Edit the file by hand).
    Auto-stamps the timestamp; escapes pipes so the markdown table stays valid."""
    path = os.path.join(ROOT, "work", a.project, "decision-log.md")
    if not os.path.exists(path):
        sys.exit(f"no decision-log at {path}")
    def cell(s): return (s or "").replace("|", "\\|").replace("\n", " ").strip()
    row = f"| {now_iso()} | {cell(a.gate)} | {cell(a.decision)} | {cell(a.by or 'orchestrator')} | {cell(a.rationale)} | {cell(a.anchor)} |\n"
    with open(path, "a") as f:
        f.write(row)
    print(f"logged decision '{cell(a.gate)}' to {a.project}/decision-log.md ({cell(a.anchor)})")

def modal(xs):
    if not xs: return None
    try: return statistics.mode(xs)
    except statistics.StatisticsError: return statistics.median(xs)

def fmt(x):
    return "—" if x is None else (f"{x:.0f}" if isinstance(x,(int,float)) else str(x))

# --- failure classification (process v51, CFR validity / EXP-044) ---------
# A production issue is one of two KINDS, and they must not be conflated:
#   deploy_failure — a change we just shipped failed its own validation (tester
#     sent a just-deployed UC to Rework). This is what classic DORA CFR measures:
#     "what fraction of DEPLOYS broke." Logged event 'deploy_failure', or legacy
#     'failure' whose ref is NOT a defect id (e.g. ...-REWORK).
#   defect_intake — a defect raised against the STANDING system via /defect
#     (ref 'DEFECT-NNN...'). It is real and production-impacting, but it is not a
#     failure OF a specific recent deploy, so counting it in CFR inflates the
#     numerator without a deploy in the denominator (the v49 retro finding:
#     06-10 showed 11 such 'failures' against 2 deploys). Reported separately as a
#     defect-arrival rate; excluded from CFR. Reclassified RETROACTIVELY here by
#     ref, so historical CFR corrects without rewriting the append-only ledger.
# Both kinds still count toward MTTR (recovery speed for ANY prod issue).
DEFECT_REF = re.compile(r"^DEFECT-\d+")

def is_defect_intake(r):
    return r["event"] == "defect_intake" or (
        r["event"] in ("failure", "defect_intake") and DEFECT_REF.match(r["ref"].strip()))

def is_deploy_failure(r):
    return (r["event"] == "deploy_failure" or
            (r["event"] == "failure" and not DEFECT_REF.match(r["ref"].strip())))

# --- plumbing vs delivery cost classification (v59, EXP-067) ----------------
# "Plumbing" = the cost of RUNNING the agent OS (coordination, flow management,
# bookkeeping, gates, retros) as opposed to producing/validating customer value
# ("delivery"). The retro watches the plumbing SHARE of tokens + time so it can
# target system overhead with evidence, not just total cost. Rule: a row is
# plumbing if its agent runs the machine (orchestrator/flow-manager) OR its event
# is a coordination/bookkeeping marker; everything else (engineer/tester/ui/
# product/architect/cicd/documenter building, validating, designing, deploying)
# is delivery.
PLUMBING_AGENTS = {"orchestrator", "flow-manager"}
PLUMBING_EVENTS = {"retro", "gate_decision", "log_decision", "enqueue", "dequeue",
                   "item_registered", "loop_wake", "parallel_dispatch", "collision"}
def cost_class(agent, event):
    return "plumbing" if (agent in PLUMBING_AGENTS or event in PLUMBING_EVENTS) else "delivery"

def _cost_split(rows):
    """Sum duration_s + tokens by plumbing/delivery class over a row subset.
    Returns (agg, token_coverage_fraction)."""
    agg = {"plumbing": {"time": 0.0, "tokens": 0}, "delivery": {"time": 0.0, "tokens": 0}}
    tok_rows = 0
    for r in rows:
        cls = cost_class(r["agent"], r["event"])
        d = r["duration_s"].strip()
        if d:
            try: agg[cls]["time"] += float(d)
            except ValueError: pass
        t = (r.get("tokens") or "").strip()
        if t:
            try: agg[cls]["tokens"] += int(float(t)); tok_rows += 1
            except ValueError: pass
    end_rows = [r for r in rows if r["event"] == "task_end"]
    coverage = (tok_rows / len(end_rows)) if end_rows else None
    return agg, coverage

def _metrics(rows):
    """Compute the four key metrics over an arbitrary row subset (used for both
    the cumulative baseline and the trailing window)."""
    deploys = [r for r in rows if r["event"] == "deploy"]
    deploy_fails = [r for r in rows if is_deploy_failure(r)]
    defects      = [r for r in rows if is_defect_intake(r)]
    days = {parse_ts(r["timestamp"]).date() for r in rows if parse_ts(r["timestamp"])}
    freq = (len(deploys)/len(days)) if days else None
    cfr  = (len(deploy_fails)/len(deploys)*100) if deploys else None
    defect_rate = (len(defects)/len(days)) if days else None
    # MTTR spans BOTH kinds: any prod issue → its matching recovery/defect_resolved.
    issues = sorted(deploy_fails + defects, key=lambda r: r["timestamp"])
    resolutions = sorted([r for r in rows if r["event"] in ("recovery","defect_resolved")],
                         key=lambda r: r["timestamp"])
    mttrs = []
    for frow in issues:
        ft = parse_ts(frow["timestamp"])
        for rec in resolutions:
            if rec["slice"]==frow["slice"] and rec["project"]==frow["project"]:
                rt = parse_ts(rec["timestamp"])
                if ft and rt and rt >= ft:
                    mttrs.append((rt-ft).total_seconds()); break
    mttr = statistics.median(mttrs) if mttrs else None
    starts, ships = {}, {}
    for r in rows:
        key = (r["project"], r["slice"]); ts = parse_ts(r["timestamp"])
        if not ts: continue
        if r["event"]=="task_start": starts[key] = min(starts.get(key, ts), ts)
        if r["event"]=="deploy" and r["outcome"] in ("success","rolled_forward"):
            ships[key] = min(ships.get(key, ts), ts)
    leads = [(ships[k]-starts[k]).total_seconds() for k in ships if k in starts and ships[k]>=starts[k]]
    lead = statistics.median(leads) if leads else None
    return dict(lead=lead, n_leads=len(leads), freq=freq, n_days=len(days),
                cfr=cfr, n_deploys=len(deploys), n_deployfail=len(deploy_fails),
                defect_rate=defect_rate, n_defects=len(defects),
                mttr=mttr, n_mttrs=len(mttrs))

WINDOW_DEPLOYS = 12   # trailing window = rows since the Nth-most-recent deploy

def cmd_compute(_):
    rows = read_rows()
    durs = defaultdict(list)
    for r in rows:
        if r["event"] == "task_end" and r["duration_s"].strip():
            try: durs[r["agent"]].append(float(r["duration_s"]))
            except ValueError: pass

    cum = _metrics(rows)
    # trailing window: rows at/after the timestamp of the Nth-most-recent deploy
    deploy_ts = sorted([r["timestamp"] for r in rows if r["event"]=="deploy"])
    win_rows, win_label = rows, "all"
    if len(deploy_ts) > WINDOW_DEPLOYS:
        cutoff = deploy_ts[-WINDOW_DEPLOYS]
        win_rows = [r for r in rows if r["timestamp"] >= cutoff]
        win_label = f"last {WINDOW_DEPLOYS} deploys"
    win = _metrics(win_rows)

    def table(m):
        return [
            "| Metric | Value | Window |",
            "|--------|-------|--------|",
            f"| Gross lead time (median) | {fmt(m['lead'])} s | {m['n_leads']} slice(s) |",
            f"| Deployment frequency | {fmt(m['freq'])} /active-day | {m['n_days']} day(s) |",
            f"| Change failure rate (deploys only) | {fmt(m['cfr'])} % | {m['n_deployfail']}/{m['n_deploys']} deploys |",
            f"| Defect intake rate (separate, NOT in CFR) | {fmt(m['defect_rate'])} /active-day | {m['n_defects']} defect(s) |",
            f"| MTTR (median, any prod issue) | {fmt(m['mttr'])} s | {m['n_mttrs']} issue(s) |",
        ]

    L = []
    L.append("# DORA Baseline (computed)\n")
    L.append(f"_Generated {now_iso()} from ledger.csv. Do not hand-edit._\n")
    L.append("## Four key metrics — CUMULATIVE (whole pipeline)\n")
    L += table(cum)
    L.append("\n> CFR counts **deploy failures only** (a shipped change that failed "
             "its validation); defect intakes raised via /defect against the standing "
             "system are reported separately and excluded from CFR (process §3, v51). "
             "MTTR spans both kinds.\n")
    L.append(f"## Trailing window — {win_label}\n")
    L.append("_Recent-only view, so improvement is visible inside a retro's scoring "
             "horizon rather than lost in a history-dominated median (EXP-045)._\n")
    L += table(win)
    L.append("")
    L.append("## Per-agent task completion (seconds)\n")
    L.append("| Agent | n | modal | median | mean |")
    L.append("|-------|---|-------|--------|------|")
    for ag in AGENTS:
        xs = durs.get(ag, [])
        L.append(f"| {ag} | {len(xs)} | {fmt(modal(xs))} | "
                 f"{fmt(statistics.median(xs) if xs else None)} | "
                 f"{fmt(statistics.mean(xs) if xs else None)} |")
    # plumbing vs delivery system-overhead split (v59, EXP-067)
    pl, cov = _cost_split(rows)
    ptt = pl["plumbing"]["time"] + pl["delivery"]["time"]
    ptk = pl["plumbing"]["tokens"] + pl["delivery"]["tokens"]
    def _shr(x, tot): return ("%.0f%%" % (100 * x / tot)) if tot else "—"
    L.append("\n## Plumbing vs delivery (system overhead — EXP-067)\n")
    L.append("Plumbing = running the agent OS (orchestrator + flow-manager + "
             "retro/gate/bookkeeping events); delivery = producing/validating "
             "customer value. Watch the plumbing SHARE and its trend.\n")
    L.append("| class | time (s) | time % | tokens | tokens % |")
    L.append("|-------|----------|--------|--------|----------|")
    for cls in ("plumbing", "delivery"):
        L.append(f"| {cls} | {fmt(pl[cls]['time'])} | {_shr(pl[cls]['time'],ptt)} "
                 f"| {pl[cls]['tokens']} | {_shr(pl[cls]['tokens'],ptk)} |")
    L.append(f"\n_Plumbing share: time {_shr(pl['plumbing']['time'],ptt)}, "
             f"tokens {_shr(pl['plumbing']['tokens'],ptk)} "
             f"(token coverage {('%.0f%%' % (100*cov)) if cov is not None else '—'} of "
             f"task_end rows — grows as dispatches log --tokens, v59)._")

    med = {ag: statistics.median(durs[ag]) for ag in durs if durs[ag]}
    constraint = max(med, key=med.get) if med else None
    L.append("\n## Theory-of-Constraints read\n")
    L.append(f"- Constraint (slowest median step): **{fmt(constraint)}**")
    L.append("- Recommended exploit/subordinate action: _(orchestrator fills in)_")
    with open(BASELINE, "w") as f:
        f.write("\n".join(L) + "\n")
    # cheap status-line snapshot — TRAILING WINDOW (recent-only), matches the
    # window table written above (EXP-045).
    write_statusline({"cfr": _r0(win["cfr"]), "freq": _r0(win["freq"]),
                      "lead": _r0(win["lead"]), "window": win_label,
                      "dora_updated": now_iso()})
    print(f"wrote {BASELINE} | cumulative: lead={fmt(cum['lead'])}s freq={fmt(cum['freq'])} "
          f"cfr={fmt(cum['cfr'])}% (deploys only; {cum['n_defects']} defect-intakes excluded) "
          f"mttr={fmt(cum['mttr'])}s | window({win_label}): cfr={fmt(win['cfr'])}% lead={fmt(win['lead'])}s "
          f"| constraint={constraint}")

def _pair_waits(events):
    """FIFO-pair enqueue->dequeue timestamps; return (waits[], outstanding_depth)."""
    q, waits = [], []
    for ev, ts in sorted(events, key=lambda x: x[1] or datetime.min.replace(tzinfo=timezone.utc)):
        if ts is None: continue
        if ev == "enqueue":
            q.append(ts)
        elif ev == "dequeue" and q:
            waits.append((ts - q.pop(0)).total_seconds())
    return waits, len(q)

def _read_policy(project):
    """Read per-queue buffer policy (uniform: min_items + wip_limit per queue)."""
    pol={}
    pp=os.path.join(ROOT,"work",project,"queues","policy.csv")
    if os.path.exists(pp):
        for row in csv.DictReader(open(pp)):
            pol.setdefault(row["queue"],{})[row["param"]]=row["value"]
    return pol

def cmd_flow(a):
    rows = [r for r in read_rows() if r["project"] == a.project]
    out = a.out or os.path.join(ROOT, "work", a.project, "dora", "flow.md")
    pol = _read_policy(a.project)

    # per-queue events carry the item so rework (re-entry) is countable
    per_queue = defaultdict(list)   # queue -> [(event, ts, item)]
    for r in rows:
        if r["event"] in ("enqueue","dequeue") and r["queue"]:
            per_queue[r["queue"]].append((r["event"], parse_ts(r["timestamp"]), r["item_id"]))

    queue_stats, all_queue_waits = {}, []
    for q, evs in per_queue.items():
        waits, length = _pair_waits([(e,t) for e,t,_ in evs])   # dwell pairs; length = outstanding
        deqs = [t for e,t,_ in evs if e=="dequeue" and t]
        days = {t.date() for t in deqs}
        throughput = (len(deqs)/len(days)) if days else None     # items dequeued / active-day
        enq_count = defaultdict(int)
        for e,t,it in evs:
            if e=="enqueue" and it: enq_count[it]+=1
        items_enq = len(enq_count)
        reentries = sum(c-1 for c in enq_count.values() if c>1)  # times items came BACK
        rework_rate = (reentries/items_enq) if items_enq else None
        queue_stats[q] = {"length": length, "n_through": len(waits),
                          "median_wait": statistics.median(waits) if waits else None,
                          "total_wait": sum(waits) if waits else 0.0,
                          "throughput": throughput, "reentries": reentries,
                          "rework_rate": rework_rate}
        all_queue_waits += waits

    # per-item lead time + queue wait + service time
    item_rows = defaultdict(list)
    for r in rows:
        if r["item_id"]:
            item_rows[r["item_id"]].append(r)
    item_stats = {}
    for it, rs in item_rows.items():
        starts = [t for t in (parse_ts(r["timestamp"]) for r in rs if r["event"] in ("task_start","enqueue")) if t]
        ships  = [t for t in (parse_ts(r["timestamp"]) for r in rs if r["event"]=="deploy" and r["outcome"] in ("success","rolled_forward")) if t]
        dones  = [t for t in (parse_ts(r["timestamp"]) for r in rs if r["event"] in ("deploy","task_end")) if t]
        start = min(starts) if starts else None
        end   = (min(ships) if ships else (max(dones) if dones else None))
        lead = (end - start).total_seconds() if (start and end and end >= start) else None
        evs_by_q = defaultdict(list)
        for r in rs:
            if r["event"] in ("enqueue","dequeue") and r["queue"]:
                evs_by_q[r["queue"]].append((r["event"], parse_ts(r["timestamp"])))
        qwait = 0.0
        for q, evs in evs_by_q.items():
            w, _ = _pair_waits(evs); qwait += sum(w)
        service = 0.0
        for r in rs:
            if r["event"] in ("task_end","stage_exit") and r["duration_s"].strip():
                try: service += float(r["duration_s"])
                except ValueError: pass
        item_stats[it] = {"lead": lead, "qwait": qwait, "service": service}

    collisions = [r for r in rows if r["event"]=="collision"]
    pd_rows = [r for r in rows if r["event"]=="parallel_dispatch"]
    effs = []
    for r in pd_rows:
        m_ach = re.search(r"achieved=(\d+)", r["note"] or "")
        m_max = re.search(r"max=(\d+)", r["note"] or "")
        if m_ach and m_max and int(m_max.group(1)) > 0:
            effs.append(int(m_ach.group(1))/int(m_max.group(1)))
    par_eff = statistics.mean(effs) if effs else None

    def rr(x): return ("%.2f"%x) if x is not None else "—"
    L = []
    L.append(f"# Flow view — {a.project}\n")
    L.append(f"_Generated {now_iso()} from ledger.csv + queues/policy.csv. Do not hand-edit._\n")
    L.append("## Queues — buffer control + statistical metrics\n")
    L.append("Buffer control per queue = **min_items** (replenish floor) + **WIP limit** (cap). "
             "Metrics: **length** (now), **throughput** (dequeues/active-day), **dwell** (enqueue→dequeue, "
             "the time to be taken off the queue — the queue's slice of GLT), **rework rate** "
             "(re-entries ÷ items).\n")
    L.append("| Queue | min_items | WIP limit | length | throughput /day | dwell median (s) | rework rate | items through |")
    L.append("|-------|-----------|-----------|--------|-----------------|------------------|-------------|---------------|")
    if queue_stats:
        for q in sorted(queue_stats):
            s=queue_stats[q]; p=pol.get(q,{})
            L.append(f"| {q} | {p.get('min_items','—')} | {p.get('wip_limit','—')} | {s['length']} | "
                     f"{fmt(s['throughput'])} | {fmt(s['median_wait'])} | {rr(s['rework_rate'])} | {s['n_through']} |")
    else:
        for q in sorted(pol) or ["intake","ready","deploy","rework"]:
            p=pol.get(q,{})
            L.append(f"| {q} | {p.get('min_items','—')} | {p.get('wip_limit','—')} | 0 | — | — | — | 0 |")

    L.append("\n## Time thieves (wall-clock not spent doing the work)\n")
    total_qwait = sum(all_queue_waits) if all_queue_waits else 0.0
    L.append("| Thief | Value | Source |")
    L.append("|-------|-------|--------|")
    L.append(f"| Queue dwell (all queues) | {fmt(total_qwait)} s | enqueue->dequeue pairs = the wait part of GLT |")
    L.append(f"| Hidden-edge collisions | {len(collisions)} | declared independence proven false (s13) |")
    L.append(f"| Parallelism efficiency | {rr(par_eff)} | achieved / max independent set |")
    if collisions:
        L.append("\n### Collisions (-> correct the dependency tree)\n")
        L.append("| when | item | other (ref) | shared seam (note) |")
        L.append("|------|------|-------------|--------------------|")
        for c in collisions:
            L.append(f"| {c['timestamp']} | {c['item_id']} | {c['ref']} | {c['note']} |")

    L.append("\n## Per-item lead time (created -> shipped)\n")
    L.append("| item | lead (s) | queue dwell (s) | service (s) | wait share |")
    L.append("|------|----------|-----------------|-------------|------------|")
    if item_stats:
        for it in sorted(item_stats):
            s = item_stats[it]
            share = ("%.0f%%" % (100*s["qwait"]/s["lead"])) if (s["lead"] and s["lead"]>0) else "—"
            L.append(f"| {it} | {fmt(s['lead'])} | {fmt(s['qwait'])} | {fmt(s['service'])} | {share} |")
    else:
        L.append("| _(no item-tagged rows yet)_ | — | — | — | — |")

    L.append("\n_Every metric ties back to the two system numbers: Σ dwell across queues is the WAIT part "
             "of gross lead time; the throughput of the binding (lowest-throughput) queue is system throughput; "
             "rework rate inflates both. Hidden-edge rate (collisions/slice) and false-edge rate live in "
             "architecture/dependencies/edge-ledger.md._")

    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        f.write("\n".join(L) + "\n")
    # cheap status-line snapshot — parallelism efficiency for this project.
    write_statusline({"project": a.project,
                      "par": round(par_eff, 2) if par_eff is not None else None,
                      "flow_updated": now_iso()})
    print(f"wrote {out} | queues={len(queue_stats)} items={len(item_stats)} collisions={len(collisions)} par_eff={rr(par_eff)}")

# --- single source of truth: state PROJECTED from the ledger (v52, EXP-048) ----
# The append-only ledger is the ONE writer of dynamic state. An item's current
# state and a queue's membership are DERIVED here, never independently stored, so
# the three-stores-disagree defect family (10/16 of observatory's defects) cannot
# occur by construction — there is nothing to keep in sync. New projects use this;
# existing projects keep their hand-maintained items.csv `state` + queue CSVs.
# Canonical lifecycle events: item_registered→planned, enqueue→<queue>,
# dequeue→in-flight, item_done→done. Tolerant of legacy state_transition rows.
def derive_project_state(rows):
    """Pure projection. Returns (item_state {id:state}, queue_members {queue:[ids]})."""
    by_item = defaultdict(list)
    for r in rows:
        if r["item_id"]:
            by_item[r["item_id"]].append(r)
    item_state = {}
    for it, rs in by_item.items():
        st = None
        for r in sorted(rs, key=lambda r: r["timestamp"]):
            e = r["event"]
            if e == "item_registered":            st = "planned"
            elif e == "enqueue":                  st = (r["queue"] or "queued")
            elif e == "dequeue":                  st = "in-flight"
            elif e == "item_done":                st = "done"
            elif e in ("state_transition", "state-transition"):
                o = (r["outcome"] or "").strip()
                if o and o != "na":
                    st = o
                else:
                    m = re.search(r"->\s*([A-Za-z][A-Za-z\-]*)", r["note"] or "")
                    if m: st = m.group(1)
        if st is not None:
            item_state[it] = st
    net = defaultdict(lambda: defaultdict(int))   # queue -> item -> (enqueues - dequeues)
    for r in rows:
        if r["queue"] and r["item_id"] and r["event"] in ("enqueue", "dequeue"):
            net[r["queue"]][r["item_id"]] += 1 if r["event"] == "enqueue" else -1
    queue_members = {q: sorted([it for it, n in items.items() if n > 0])
                     for q, items in net.items()}
    return item_state, queue_members

def cmd_project_state(a):
    rows = [r for r in read_rows() if r["project"] == a.project]
    item_state, queue_members = derive_project_state(rows)
    out = a.out or os.path.join(ROOT, "work", a.project, "state.md")
    L = [f"# Derived state — {a.project}\n",
         f"_Generated {now_iso()} by `dora.py project-state` from the ledger (the single",
         "source of truth, EXP-048). DO NOT hand-edit — edit by appending a ledger event._\n",
         "## Queue membership (derived)\n",
         "| Queue | depth | items |", "|-------|-------|-------|"]
    for q in sorted(queue_members):
        mem = queue_members[q]
        L.append(f"| {q} | {len(mem)} | {', '.join(mem) if mem else '—'} |")
    L.append("\n## Item state (derived)\n")
    L.append("| Item | state |"); L.append("|------|-------|")
    for it in sorted(item_state):
        L.append(f"| {it} | {item_state[it]} |")
    # bonus coherence check against a legacy hand-maintained items.csv, if present
    drift = []
    ip = os.path.join(ROOT, "work", a.project, "items", "items.csv")
    if os.path.exists(ip):
        for row in csv.DictReader(open(ip)):
            stated = (row.get("state") or "").strip()
            derived = item_state.get(row.get("id", ""))
            if stated and derived and stated != derived:
                drift.append((row["id"], stated, derived))
        if drift:
            L.append("\n## ⚠ Drift vs hand-maintained items.csv (legacy projects only)\n")
            L.append("| Item | items.csv says | ledger-derived |"); L.append("|------|----------------|----------------|")
            for it, s, d in drift: L.append(f"| {it} | {s} | {d} |")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        f.write("\n".join(L) + "\n")
    print(f"wrote {out} | items={len(item_state)} queues={len(queue_members)} "
          f"{'DRIFT=%d (legacy)' % len(drift) if drift else 'coherent'}")

def cmd_cost_split(a):
    """Show how much TIME + TOKENS go to plumbing (running the OS) vs delivery
    (customer value) — the retro's system-overhead lens (v59, EXP-067)."""
    rows = read_rows()
    if a.project:
        rows = [r for r in rows if r["project"] == a.project]
    if a.window:
        deploy_ts = sorted([r["timestamp"] for r in rows if r["event"] == "deploy"])
        if len(deploy_ts) > a.window:
            cutoff = deploy_ts[-a.window]
            rows = [r for r in rows if r["timestamp"] >= cutoff]
    agg, coverage = _cost_split(rows)
    tt = agg["plumbing"]["time"] + agg["delivery"]["time"]
    tk = agg["plumbing"]["tokens"] + agg["delivery"]["tokens"]
    def pct(x, tot): return ("%.0f%%" % (100 * x / tot)) if tot else "—"
    label = (a.project or "ALL") + (f" (last {a.window} deploys)" if a.window else "")
    cov = ("%.0f%%" % (100 * coverage)) if coverage is not None else "—"
    print(f"# Plumbing vs Delivery — {label}")
    print(f"{'class':10}{'time_s':>10}{'time%':>7}{'tokens':>12}{'tok%':>7}")
    for cls in ("plumbing", "delivery"):
        print(f"{cls:10}{agg[cls]['time']:>10.0f}{pct(agg[cls]['time'],tt):>7}"
              f"{agg[cls]['tokens']:>12}{pct(agg[cls]['tokens'],tk):>7}")
    print(f"{'TOTAL':10}{tt:>10.0f}{'100%':>7}{tk:>12}{'100%':>7}")
    print(f"PLUMBING SHARE: time={pct(agg['plumbing']['time'],tt)} "
          f"tokens={pct(agg['plumbing']['tokens'],tk)} | token coverage={cov} of task_end rows")

def cmd_retro_debt(a):
    """MECHANICAL §F8 auto-retro gate (v68). Counts retro-triggering events since
    the last `retro` ledger row for the project, and EXITS NON-ZERO when the debt
    has reached the cadence threshold — so the loop cannot advance past a due retro
    by orchestrator discretion. The retro firing automatically is thus a property
    of the loop machinery (a checkable gate), not a rule the orchestrator may skip.

    Retro-triggering events (the §F8 cadence — slice-completion + threshold events):
      - a SLICE close   (item_done / bubble whose item_id starts SLC- or is a CHK-)
      - a defect resolve (defect_resolved, or a recovery whose ref is a DEFECT- id)
      - a deploy_failure (a shipped change that failed its own validation)
    A `retro` row resets the counter to zero (drains the debt).

    Threshold default = 1 (retro is due the moment ANY slice closes or a defect
    resolves — the §F8 default of "retro at slice completion"). Raise via
    --threshold for a project that batches. Output is machine-readable so the
    loop/flow-manager can gate on it; exit code 2 == retro DUE (debt >= threshold)."""
    rows = [r for r in read_rows() if r["project"] == a.project]
    # find the timestamp of the last retro row
    last_retro_ts = None
    for r in rows:
        if r["event"] == "retro":
            ts = parse_ts(r["timestamp"])
            if ts and (last_retro_ts is None or ts > last_retro_ts):
                last_retro_ts = ts
    debt = []
    for r in rows:
        ts = parse_ts(r["timestamp"])
        # only events strictly AFTER the last retro count as debt; an unparseable
        # timestamp (malformed legacy row) is treated as pre-retro, never new debt
        if last_retro_ts is not None and (ts is None or ts <= last_retro_ts):
            continue
        ev, item, ref = r["event"], (r["item_id"] or ""), (r["ref"] or "")
        is_slice_close = ev in ("item_done", "bubble") and (
            item.startswith("SLC-") or item.startswith("CHK-")
        ) and (r["outcome"] in ("done", "success"))
        is_defect_resolve = ev == "defect_resolved" or (
            ev == "recovery" and ref.startswith("DEFECT-")
        )
        is_deploy_failure = ev == "deploy_failure" or (
            ev == "failure" and not ref.startswith("DEFECT-")
        )
        if is_slice_close or is_defect_resolve or is_deploy_failure:
            kind = ("slice-close" if is_slice_close else
                    "defect-resolve" if is_defect_resolve else "deploy-failure")
            debt.append((r["timestamp"], kind, item or ref))
    n = len(debt)
    thr = a.threshold
    due = n >= thr
    since = last_retro_ts.strftime("%Y-%m-%dT%H:%M:%SZ") if last_retro_ts else "(no prior retro)"
    print(f"retro-debt[{a.project}] = {n} (threshold {thr}) since last retro {since} "
          f"=> {'RETRO DUE — drain before advancing' if due else 'ok'}")
    for ts, kind, ident in debt:
        print(f"  - {ts}  {kind:14}  {ident}")
    write_statusline({f"retro_debt_{a.project}": n, f"retro_due_{a.project}": due})
    sys.exit(2 if due else 0)

def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("record")
    for n in ["project","iteration","slice","agent","event"]:
        r.add_argument(f"--{n}", required=True)
    for n in ["duration","outcome","ref","note","item-id","queue","tokens"]:
        r.add_argument(f"--{n}")
    r.set_defaults(func=cmd_record)
    c = sub.add_parser("compute"); c.set_defaults(func=cmd_compute)
    cs = sub.add_parser("cost-split")
    cs.add_argument("--project")
    cs.add_argument("--window", type=int)
    cs.set_defaults(func=cmd_cost_split)
    fl = sub.add_parser("flow")
    fl.add_argument("--project", required=True)
    fl.add_argument("--out")
    fl.set_defaults(func=cmd_flow)
    ld = sub.add_parser("log-decision")
    ld.add_argument("--project", required=True)
    for n in ["gate","decision","rationale","anchor"]:
        ld.add_argument(f"--{n}", required=True)
    ld.add_argument("--by")
    ld.set_defaults(func=cmd_log_decision)
    ps = sub.add_parser("project-state")
    ps.add_argument("--project", required=True)
    ps.add_argument("--out")
    ps.set_defaults(func=cmd_project_state)
    rd = sub.add_parser("retro-debt")
    rd.add_argument("--project", required=True)
    rd.add_argument("--threshold", type=int, default=1)
    rd.set_defaults(func=cmd_retro_debt)
    a = p.parse_args()
    a.func(a)

if __name__ == "__main__":
    main()
