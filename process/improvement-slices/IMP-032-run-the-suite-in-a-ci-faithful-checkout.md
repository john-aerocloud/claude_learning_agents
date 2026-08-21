# IMP-032 — local is not a faithful model of CI, and both fidelity mechanisms already exist

**Opened:** 2026-08-21 (v147 retro, OagEventSource)
**Focus question:** *why are we finding test failures on a CI pipeline and not locally?*
**Owner:** cicd + the project Makefile (project-repo lane)
**Targets:** change failure rate (primary), lead time (secondary)

## The answer, in one line

**Because the local run and the CI run differ in three measured ways, nothing measures the
divergence, and the cheap signal is the one we have taught ourselves to distrust.**

## The three divergences, each measured today

### 1. Topology — permanent, structural, by construction

CI checks out **the project repo alone**. A dev worktree has that same repo **nested inside the
parent**. So anything that reads above the project root works locally and **cannot** work in CI.

Measured: the first probe dispatch shipped a spec that read
`.claude/skills/work-items/scripts/work-items.py` at module scope. Locally: green. In CI the file
failed to **collect** — `Test Files 1 failed | 403 passed`, `5341 passed`. The engineer then swept
all **522** committed specs and found **exactly one** reached above the project root: the one CI
had just caught.

This is a consequence of v50 (a project is its own repo) meeting the worktree model. It is not a
bug and will not go away.

### 2. Concurrency and load — opposite directions, and this is the expensive one

Local: up to five agents on a 14-core machine, each with its own DynamoDB Local container,
several running full suites at once. CI: a dedicated 2-core runner, one suite.

So load-dependent verdicts diverge **both ways**:

- `AC-AV.11` asserts a forced race *did* interleave. Under local contention it fails; in isolation
  it passes. **Five separate dispatches hit it today**, each correctly attributing it.
- Three dispatches independently reported that **whole-suite reds are currently untrustworthy on
  first read**, because source-scanning gates read files another agent was mid-write on.

**That is the damaging half.** The cheap, fast signal has become unreliable, so agents have learned
to discount a local red — which is precisely the reflex that lets a real regression through. The
trusted signal (CI) is the slow, expensive one: a wedged gate held two items in non-terminal states
for over two hours today.

### 3. Environment — measured as real, cause still open

`OI-A-WEDGED-CI-RUN…`: the suite runs **45s** locally unrestricted and **98s** at
`--maxWorkers=2` (matching a hosted runner's cores) — but **two consecutive CI runs stalled dead**
after `defect-oag-063-withdrawn-lifecycle-closure.test.ts`, with **18 and 86 minutes of total
silence**. ~2× is not 50×. Restricting parallelism does not reproduce it, so it is not the suite
outgrowing the runner.

## Why-chain (root cause, ≥3 levels)

1. **Why are failures found in CI and not locally?** The two environments differ in topology,
   concurrency and runner behaviour.
2. **Why does that surprise us each time?** Nothing runs the suite under CI-like conditions before
   the push, so the divergence is discovered by the pipeline rather than measured beforehand.
3. **Why has nobody built that?** Because the local run *looks* authoritative — same command, same
   repo, green — and its unfaithfulness is invisible until CI contradicts it.
4. **Why is the contradiction expensive rather than cheap?** Because a CI verdict costs a full
   pipeline round-trip, and until today an in-progress job's logs were unreadable
   (`BlobNotFound`), so **the only way to observe a run was to end it**.

## The fix — compose two mechanisms this repo already has

Neither needs inventing. **Both are committed, proven, and neither is pointed at the test suite.**

| existing mechanism | what it already does | which divergence it solves |
|---|---|---|
| `scripts/bundle-at-sha.sh` | builds in a **disposable `git worktree` at a committed sha**, provisions `node_modules` there, runs the same build. Its own header documents why this is *not* the `DEFECT-OAG-072` shape: that loss was a nested clone with its own `.git`, whereas a `git worktree` of this repo shares this repo's objects. | **concurrency** — a clean checkout at a sha cannot see another agent's mid-write file |
| `make check-probes-standalone` | builds a **real lifted-out tree** (a plain file copy, never a nested clone) and asserts behaviour there | **topology** — a lifted-out project repo *is* the CI topology |

**So the slice is: run the suite in a CI-faithful checkout — a disposable worktree at a committed
sha, lifted out so nothing above the project root is reachable, with workers restricted to the CI
core count.** One target, composing two proven scripts.

## Acceptance

- **AC-032.1** — a `make` target runs the full suite in a disposable worktree **at a named
  committed sha**, with `node_modules` provisioned there, and reports pass/fail. Demonstrated to
  give the same verdict as CI on a sha where CI is known-green.
- **AC-032.2** — the checkout is **lifted out**: nothing above the project root is reachable.
  Non-vacuity: a spec that reads a parent-repo path must **fail** there and pass in the shared
  tree — reproducing the `403 passed / 1 failed` collect error the first probe dispatch hit.
- **AC-032.3** — worker count is **derived from a declared CI core count**, not hardcoded, and the
  target records the wall-clock so `IMP-031`-style trailing comparison is possible.
- **AC-032.4** — it is **contention-free by construction**: prove it by running it while another
  agent has uncommitted edits in the shared tree, and asserting those edits cannot affect the
  verdict.
- **AC-032.5** — a run whose verdict **could not be established** (provisioning failed, sha absent)
  exits distinctly from a test failure, reusing the exit-3 / exit-4 vocabulary the census lane and
  the probes already use. A "cannot tell" must never read as green.

## What this must NOT become

- **Not a replacement for CI.** CI stays the gate. This is a pre-push predictor, and if it ever
  starts being treated as the verdict, that is the failure.
- **Not a reason to stop running the fast local suite.** The shared-tree run stays as the
  inner loop; this is the confirmation step before a push.
- **Not a nested clone.** `bundle-at-sha.sh`'s header explains exactly why, and `DEFECT-OAG-072`
  was delivered complete and destroyed by that shape. Use `git worktree` or a file copy, per the
  existing precedents.
