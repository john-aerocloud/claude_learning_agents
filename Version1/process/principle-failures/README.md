# Principle failures (the "where beliefs broke" corpus)

One file per case where following a default principle harmed a DORA metric, or
where a deliberate deviation was needed. These are reviewed at every retro and
are the strongest input to revising the process.

Filename: `YYYY-MM-DD-<project>-<short-slug>.md`

Use the template below.

```markdown
---
date: YYYY-MM-DD
project: <project>
iteration: <n>
principle: <which default approach, e.g. "slice value" / "roll forward">
dora_metric_harmed: <lead_time|deploy_freq|change_failure_rate|mttr>
---

## Expected
What we believed would happen by following the principle.

## Actual
What actually happened, with the DORA evidence (ledger refs).

## Why the principle did not hold
The specific condition that made the general rule wrong here.

## Guidance for next time
A narrower rule or a detection signal — "when X holds, prefer Y instead."
Do NOT overturn the global principle here; that only happens at retro.
```

Keep entries short and concrete. Pattern across several entries → propose a
process change at retro.
