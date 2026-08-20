# 2026-08-20 — a GLOBAL registry read against PER-PROJECT reality, twice in four hours

**Class:** recurring root cause. Third occurrence of the colliding-id half
(`2026-08-14-reconcile-latency-15-days-and-colliding-experiment-ids.md` is the second), and the
first time the class has been seen in a *different* registry on the same day.
**Logged from:** ROC retro v145, fired mechanically on incident debt (`DEF-ROC-076` resolve).

## The two instances

| # | registry | global part | per-project part | what it printed / did |
|---|---|---|---|---|
| 1 | `.claude/tools/acceptance-audit-declared.json` (`DEF-ROC-077`) | one declared-exception registry for every project | the audit sweep runs over ONE project's item tree | five OagEventSource rows looked stale from ROC's tree, so it printed **"delete the row"** — and it BLOCKED ROC's `loop-gate` while doing so |
| 2 | `process/experiments.md` (`EXP-142` collision) | one monotonic id counter | ids allocated per-instance from whatever the worktree holds | two different experiments both minted `EXP-142` — `main`'s test-requirement-gate ratchet (v142) and ROC's screen-viewport hypothesis, the same day |

Instance 1 was found at 12:38Z and fixed by 12:43Z. Instance 2 was recorded by v144 at ~13:00Z and
fixed structurally at v145. Nobody connected them at the time; they are the same defect.

## Why it is one defect and not two coincidences

Shared global namespace **+** per-instance writers **+** no uniqueness check. Each writer reads a
registry the other is concurrently advancing, and neither the read nor the write is checked against
the other's reality. The consequences differ only in blast radius:

- instance 1 emitted a **destructive remedy against another project's data**, so obeying the tool
  was the failure mode;
- instance 2 silently made two records claim one identity, and — this is the part that costs — left
  **neither instance with standing to fix it**, because relabelling either half rewrites another
  project's retro records. v144 was right to refuse, and being right left it unfixed.

## The root cause, four levels down

1. **Why was the retro's own instrument corrupted?** Two instances allocated the same experiment id.
2. **Why?** The id came from a global counter read at author time from a file the other instance had
   already advanced on `main` — a read-modify-write race with a stale read.
3. **Why was that possible?** Nothing checked id uniqueness at commit, at fold-back, or at retro.
4. **Why did the gap survive v143, which looked straight at it?** v143 scoped the WIP **cap**
   per-project and left the **id space** global. The fix was applied to the budget and not to the
   namespace, and the remedy that would have covered the rest was written into the file's own prose
   header ("cap = 8 PER PROJECT"), which no tool reads.

Level 4 is the transferable one, and it is the same shape as v144's finding one version earlier: a
remedy written as prose reproduces the defect it was written for. Work items have been
project-namespaced since the beginning (`DEF-ROC-077`, `DEFECT-OAG-091`); experiments were not, for
no reason anyone ever decided.

## The aggravating finding

`process/experiments.md` was carrying **two genres in one id space**: capped falsifiable hypotheses,
and long-form findings awaiting a decision. Six ROC-authored `##` sections had no registry row, so
the cap never governed them and no retro ever scored them. One of them (`## EXP-140`) had reached
**ten instances across six roles** with its replacement mechanism already stated, and had produced no
owner, no acceptance and no item in three weeks. An unregistered finding accretes evidence forever
and never becomes work.

Note the second-order harm, which is why this belongs in principle-failures and not just a changelog:
several of those ten instances were resolved by an agent appending under a role it was not, honestly
noting the substitution. A spoofed `AGENT=` corrupts the `by_owner` contribution table that every
retro reads to NAME the constraint. The registry defect and the attribution defect feed each other.

## What changed (v145)

- Experiment ids are **`EXP-<PROJ>-<nnn>`**; the bare-numeric space is **FROZEN**. Collision becomes
  impossible by construction, not detected afterwards by a human reading two files.
- A finding awaiting a decision is an **item** or a dated `open-items.md` entry — never an `##`
  section. `experiments.md` holds rows and scoring notes only.
- `make process-lint` (9 self-tests) enforces both, plus the version-heading match and the
  per-project cap, and is a **prerequisite of `make doc-lint`** so the retro's existing step-7 gate
  carries it with no new prose. First run against the real repo: **16 violations, all real.**
- The ten-instance finding became `EXP-ROC-002` + item `OI-ROC-006`.

## What is still owed

`process-lint` does not score rows, and does not block a row that is past its horizon still at
`0/N` — that needs the item event stream and belongs in `loop-gate`. §25a records it as owed. Until
it exists, the 3-strikes rule still depends on someone performing the scoring step, which §25a's own
text says has never once happened.
