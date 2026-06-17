# Is the retro/experiment process actually improving performance?

A point-in-time, deliberately critical assessment (2026-06-17). The companion
`process-map.md` documents *how* the machinery works; this asks whether it
*works* — and is honest about where the evidence can't yet answer that.

**Bottom line up front:** the acceptance machinery is real and completes (changes
get registered, scored, validated, integrated, and pruned — not just
accumulated), and recent per-slice quality is strong. But the headline DORA
metrics **cannot currently confirm the process is the cause** of that, for three
measurement reasons below. The single highest-value next change is to fix the
metrics so the process can credibly score itself — right now it partly can't.

---

## 1. What the machinery did (volume)

Over ~9 active days (2026-06-04 → 06-17, with gaps):

| Artefact | Count |
|---|---|
| Process versions (`process-history/`) | **49** (v01 → v49) |
| Experiments registered | **~42** |
| — integrated into agent files | 17 |
| — retired / reworked | 1 / 2 |
| — validated, awaiting integration | 2 |
| — still active | 23 |
| Defects recorded | **16** (DEFECT-001 … 016) |
| Principle-failure logs | **23** |

**Read:** the throughput of *process change* is very high — ~5 versions per active
day. The acceptance pipeline genuinely **completes**: 17 experiments were folded
into agent files as plain practice and their scaffolding pruned, and the registry
is held bounded by the prune-to-archive rule (v45). This is the strongest
positive finding — the lifecycle in `process-map.md` §2 is not theatre; changes
reach terminal states.

---

## 2. Did the DORA metrics move?

**Cumulative (whole-pipeline) — essentially flat:**

| Metric | Early window | Now | Movement |
|---|---|---|---|
| Gross lead time (median) | 3618 s | 3618 s | none (see §3.2) |
| Change failure rate | ~45 % | 43 % | ~flat |
| MTTR (median) | ~842 s | 843 s | none |
| Deployment frequency | 7 / active-day | 7 / active-day | flat |

**Per-slice quality — strong and improving:**

| Slice | Rework (tester fails / scope) | Approx slice CFR |
|---|---|---|
| s014 | 1 / 4 UCs + defects | ~14 % |
| s015 | 0 / 4 UCs | **0 %** |
| s018 | 1 / 4 UCs (contrast a11y) | ~14 % |

So the recent *lived* experience is markedly better than the *cumulative* number
— three slices delivered with 0–14% rework against a 43% cumulative CFR. **The
two disagree, and the disagreement is the whole story.**

---

## 3. Why the headline metrics can't answer the question (three problems)

### 3.1 CFR is inflated by the defect-as-spec process itself
Every `/defect` writes a `failure` ledger row. So **the more diligently the
operator reports defects, the worse CFR looks** — even when the "failure" is a
human spotting a UI nit, not a deploy breaking. The daily series makes this
stark: 2026-06-10 logged **11 failures against 2 deploys** (the WIP-coherence
defect storm), and 06-12 logged 4/4. CFR is conflating two different things:
*delivery broke* vs *we honestly recorded an issue we found*. As instrumented,
CFR partly measures the process's own diligence, so it can't be used to prove the
process improved quality.

### 3.2 Lead-time and MTTR are medians over the full history
They're computed over 27 slices / 25 failures since 06-04. A median that wide is
**structurally insensitive** to recent improvement — even a perfect run of recent
slices barely moves it for weeks. "3618 s, unchanged" is not evidence of no
improvement; it's evidence the metric can't see improvement on the 2-scoring-
opportunity horizon a retro actually scores on.

### 3.3 The model changed mid-window (confound)
Engineer/orchestrator went sonnet → **fable** (v48) → **opus** (v49) during the
exact window the slice-quality gains appear. EXP-039 itself found a CFR drop on
the more-capable tier. So the recent 0–14% slice rework is **plausibly as much
the model as the process** — and nothing in the current scoring separates them.
EXP-039's gains are, strictly, unattributable to the process.

---

## 4. What the evidence *does* support

- **The acceptance lifecycle converges on hard problems.** The clearest proof:
  the coherence-detector built for DEFECT-004/013 then *automatically caught*
  the DEFECT-013 and DEFECT-015 recurrences — later defects in a family were
  caught by tooling earlier ones produced. That is the gap→experiment→mechanism
  loop working as designed.
- **Integration keeps agent files honest, not bloated.** Validated behaviour is
  folded in (file shorter-or-equal) and scaffolding removed; 17 such fold-ins.
- **The system is resilient.** It absorbed two session-limit cutoffs and a live
  model outage (Fable 5) without losing the work chain — re-tiering and resuming
  from partials, recording the resilience rule (§7a).

## 5. What it does *not* yet support

- **That the process — as distinct from the model, or from simply practising the
  craft — caused any measurable DORA gain.** The headline metrics are flat or
  confounded; the favourable numbers are per-slice and model-confounded.
- **That 49 versions in 9 active days is efficient.** ~**10 of 16 defects** are
  one family — *derived "now"-state coherence across the ledger / items.csv /
  queues* (DEFECT-001, 002, 004, 009, 010, 011, 012, 013, 015, 016). The process
  re-patched the same wound seven-plus times before converging. Healthy that it
  converged; expensive that it took that many passes. A concentration this high
  is a signal the *architecture* (three separate sources of truth) was the root —
  a structural single-source-of-truth fix might have pre-empted the family more
  cheaply than the patch sequence did.

---

## 6. Recommended changes (candidate experiments — these feed back into §2)

> **Update (2026-06-17): all four enacted (human-directed).** #1 → dora.py CFR
> classifier + process §3 (EXP-044); #2 → dora.py trailing-window table
> (EXP-045); #3 → §7a scoring quarantine (EXP-046); #4 → IMP-010 post-mortem,
> which concluded *adopt a forward single-source-of-truth principle* (EXP-047)
> rather than refactor the delivered observatory. First recompute confirmed #1:
> **cumulative CFR 43%→20%** — over half the old number was defect-intake
> inflation, exactly as predicted below.


Ordered by leverage. The first is a prerequisite for the process to honestly
score itself at all.

1. **Fix CFR validity (measurement experiment, highest priority).** Distinguish
   `deploy_failure` from `defect_intake` in the ledger so CFR measures what broke
   in *delivery*, not how diligently issues were *reported*. Target metric: CFR
   validity. Anticipated effect: CFR becomes a usable quality signal that can
   rise *or fall* with process changes. **Until this lands, "is the process
   improving quality?" is unanswerable from CFR.**
2. **Add trailing-window DORA (last-N-slices) beside the cumulative medians.** So
   a retro can see movement inside the horizon it scores on (§3.2). Target:
   lead-time/MTTR observability. Anticipated effect: experiments become scorable
   on real recent data, not a history-dominated median.
3. **Quarantine model-tier changes in scoring.** When a model changes, freeze
   process-attribution claims for a window (or hold one agent on the old tier as
   a control). Target: attribution integrity. Anticipated effect: EXP-039-class
   gains become attributable to process vs model.
4. **Coherence-family post-mortem.** Treat the 10/16 concentration as evidence
   that one architectural decision (ledger + items.csv + queues as three truths)
   generated the defect family, and evaluate a single-source-of-truth refactor
   against the cost of the patch sequence. Target: CFR + lead time.

Items 1–3 are the gating ones: **the retro/experiment process is structurally
sound and demonstrably completes its lifecycle, but it is currently scoring
itself on metrics that are confounded (CFR), insensitive (medians), or
attribution-blind (model changes). Fix those three and the next assessment can
answer "is it improving performance?" with evidence instead of caveats.**

---

## 7. One-line answer

The *acceptance* process works — changes earn permanence through a real,
completing lifecycle, and it converges on hard problems. Whether it's *improving
DORA performance* is **not yet provable**, because the metrics it scores against
are confounded by the defect-reporting process, insensitive to recent change, and
blind to a concurrent model upgrade. The recent slice-level quality (0–14%
rework) is genuinely good but cannot be cleanly credited to the process over the
model. Fix the three measurement gaps in §6 before claiming causation.
