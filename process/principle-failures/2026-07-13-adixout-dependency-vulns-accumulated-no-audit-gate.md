---
date: 2026-07-13
project: AdixOut
iteration: 0
principle: supply-chain safety — a vulnerability signal must be an executable gate in the loop, not a banner someone must notice
dora_metric_harmed: change_failure_rate
---

## Expected
Dependency vulnerabilities are caught close to when they are introduced, by a check
that runs inside the delivery loop — so a high/critical advisory is a cheap bump at
the next push, never an accumulation discovered late.

## Actual
Across the WHOLE first AdixOut requirement (REQ-001, many use-cases and deploys), the
project accumulated **10 open Dependabot alerts** — including a **CRITICAL** vitest
UI-server arbitrary-file-read/exec, a HIGH vite `server.fs.deny` bypass, and 3
MEDIUMs — in BOTH lockfiles, entirely unnoticed by the agents. Nothing in the loop
ever ran `npm audit` or read the Dependabot state; the only signal was GitHub's
Dependabot banner, which no agent looks at. The vulns surfaced only because the human
explicitly directed attention to them (and even then the count carried in-session was
stale — "2 critical, 2 high" vs the real 10). They were then remediated cleanly as
DEF-ADIX-001 (all dev/build/test deps, no prod-runtime exposure — but the CRITICAL was
real and had sat unaddressed for the whole requirement).

## Why the principle did not hold
Vulnerability detection lived OUTSIDE the loop, as a passive external banner, with no
agent owning it and no executable gate consuming it. The build/push gate ran
lint+test but never an audit, so supply-chain drift was invisible to every
done-condition and to CFR. This is the same family as the render-diagrams gap
(EXP-088) and the false-green class: a "did you actually check?" that was a
convention/banner rather than a committed gate that fails.

## Guidance for next time
- **Make the vulnerability check an executable gate in the loop.** A `make audit`
  target (`npm audit --audit-level=high` across EVERY manifest — root AND each
  sub-package; DEF-ADIX-001's vulns were in both) wired into the build/push gate cicd
  owns, so a new high/critical advisory fails the gate at the next push instead of
  accumulating. Routed to `cicd.md`. [EXP-112]
- A found advisory is triaged like any defect (a `DEF-` via intake, §3). Dev/build/test
  advisories are still fixed (supply-chain hygiene) but flagged no-prod-runtime-exposure
  so they're prioritised correctly against runtime-exposed ones.
- A remediating toolchain bump (e.g. a vitest major) is verified green across ALL test
  tiers before it is push-green (EXP-110) — never pin back to a vulnerable version to
  keep tests passing.
- Sibling lesson to EXP-088/EXP-087: turn a passive "someone should notice" signal into
  a committed gate that fails loudly.
