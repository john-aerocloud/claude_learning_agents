# /process — Agent self-state (PERSISTENT)

This directory is the agents' memory of **how they work**. It is never reset by a
project. Project artifacts live in `/work` and can be wiped at any time; this
directory must survive that.

Hard rule: nothing in `/process` may depend on a specific project existing. It
describes process, not product.

## Layout

| Path | Holds | Written by |
|------|-------|------------|
| `process-current.md` | The current process every agent follows + expected DORA improvement + the change-set queued for the next iteration. | Orchestrator (via `/retro`) |
| `process-history/` | One file per superseded process version: the old process, its DORA numbers, the change made, and the improvement that was anticipated vs. observed. | Orchestrator (via `/retro`) |
| `dora/ledger.csv` | Append-only event log of task timings, failures, and recoveries across all projects. The raw data for optimisation. | Every agent |
| `dora/baseline.md` | Current modal / median / mean completion times per agent + the four DORA metrics, recomputed from the ledger. | `dora-ledger` skill |
| `principles/` | The default delivery approaches (XP, TDD, slicing, trunk-based, roll-forward, JTBD). The beliefs agents act on. | Orchestrator (rarely; via `/retro`) |
| `principle-failures/` | Logged cases where following a principle harmed DORA metrics, with a reflection on why. The corpus that lets agents reason about *when principles fail*. | Any agent that hits one |

## How this is used

1. Agents read `process-current.md` + `principles/` to know how to act.
2. While working they append events to `dora/ledger.csv`.
3. When a belief leads to a DORA regression, the agent logs a
   `principle-failures/` entry.
4. At `/retro` the Orchestrator recomputes DORA, reviews failures, writes a new
   `process-current.md`, and snapshots the old one into `process-history/`.

The loop: **act → measure → reflect → revise process → repeat.**
