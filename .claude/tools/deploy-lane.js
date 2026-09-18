#!/usr/bin/env node
/**
 * deploy-lane — IS THE DEPLOY LANE OPEN? (DEF-ROC-131)
 *
 * OWNER RULING, 2026-08-27: "we should not deploy things that are red — they
 * should get fixed", and "fix the loops to fix things." This is the second half.
 *
 * THE GAP IT CLOSES. `make loop-gate PROJECT=<p>` can emit nineteen distinct
 * findings — stalled validation, stalled work, ready-below-floor, queue-over-cap,
 * retro debt, awaiting-observation, blocked-park, the test-requirement gate, the
 * worktree guard, container reap, ref provenance, make-refs-tracked, acceptance
 * audit, board mapping, sequencer state, three aged-backlog limbs, deploy
 * staleness — and NOT ONE of them asked whether trunk CI was red. So the single
 * condition that stops ALL delivery for a project was invisible to the mechanism
 * whose entire purpose is holding the loop's preconditions. Measured 2026-08-27:
 * four sequential genuine reds, every one of them skipping `deploy-test` because
 * it declares `needs: [test-function-app, test-web-app]`; UC-ROC-105 and
 * UC-ROC-106 built green, committed, PUSHED and undeployable — therefore
 * un-validatable — for most of a cycle; `loop-gate` run repeatedly through that
 * window reporting OK every time; and the orchestrator finding out from an
 * engineer's passing remark in a build report.
 *
 * WHY THIS IS NOT `deploy-staleness.js` (which already reads the deployed host).
 * They are different questions with INDEPENDENT blind spots, and merging them
 * would let either blindness hide the other:
 *   - deploy-staleness asks the HOST what it is running (curl + git). When the
 *     host is unreachable it returns NOT-ESTABLISHED and stops — which is
 *     exactly the moment you most need to know whether CI even tried.
 *   - this asks CI whether the DEPLOY JOB ran (gh + the workflow's needs graph).
 *     It answers with the host down, and it answers BEFORE any deploy exists.
 *   - their severities differ on purpose. Staleness is ADVISORY: refusing to
 *     pull cannot un-stale an environment. A SHUT LANE BLOCKS, because it can be
 *     un-shut, and per the ruling that is the work.
 * deploy-staleness's own header comment already understood the mechanism — "a CI
 * test job failed, deploy-test declares needs: on it, so the deploy was SKIPPED,
 * not failed" — and then never looked at CI. That is the shape of this project's
 * standing family: a control that reads healthy while the thing it guards fails.
 *
 * THE DISCRIMINATION IS THE WHOLE DESIGN. On this repo `Dependency audit
 * (prod-runtime, blocking)` is red on EVERY push — DEF-ROC-068, `deepmerge-ts`
 * reached via `flowbite-react` via `@aerocloudsystems/design-system`, pinned
 * EXACTLY at 7.1.5 by `flowbite-react` 0.12.17, so the wait is unbounded. It is
 * DELIBERATELY not in `deploy-test`'s `needs:` (the workflow says so in a
 * comment), and run 33076365108 PROVES it: the deploy succeeded green while that
 * job was red. All three of the real captures this tool is pinned against carry
 * run conclusion `failure`; one of them deployed. SO THE RUN'S OVERALL
 * CONCLUSION CANNOT DISTINGUISH AN OPEN LANE FROM A SHUT ONE, and a limb that
 * read it would fire permanently and be ignored inside a day. This reads the
 * DEPLOY JOB'S OWN CONCLUSION and the TRANSITIVE CLOSURE OF ITS `needs:`, taken
 * from the workflow file — because the GitHub jobs API does not carry `needs` at
 * all (a job object is exactly conclusion/completedAt/databaseId/name/startedAt/
 * status/steps/url).
 *
 * AND THE CONVERSE, also measured this cycle: a green-so-far run is NOT a landed
 * deploy. The ROC health endpoint served the new `buildSha` while the Deploy job
 * was still `in_progress` — the Function App had swapped and the Web App had
 * not. Firing "deployed, go validate" on that dispatches a tester at a
 * half-completed cutover. So `in-flight` is its own verdict, and it is neither
 * open nor blocked.
 *
 * AND IT MUST ANSWER ABOUT TRUNK HEAD, OR ABOUT NOTHING (DEF-ROC-142).
 * The first version took `runList[0]` — the newest run of the workflow on the
 * branch — and published its verdict as if it were head's. On 2026-08-29 at
 * 09:14:40Z that BLOCKED a real cycle naming run 33101512536 at 94be99dc, while
 * `origin/main` was 37dd579 whose deploy job had SUCCEEDED. Trunk head at that
 * moment (ee1f7d9) was an items-only commit: it touched NONE of the workflow's
 * trigger paths (`src/app/**`, `src/dashboard/**`, `src/tools/replay-injector/**`,
 * the workflow file itself) and therefore produced ZERO runs. THAT STATE IS
 * NORMAL — every items-only, process and docs commit on this trunk is in it, and
 * this project makes them constantly. WHICH DIRECTION THE FALLBACK LIES IN IS AN
 * ACCIDENT of which run happened to be newest: the same code emits a false OPEN
 * just as readily, and that is the worse failure, because it is precisely the
 * blindness this tool was built to end. So the run is now selected BY TRUNK HEAD'S
 * SHA, never by recency; a head with no run is NOT-ESTABLISHED; and the run that
 * was read is re-checked against head before any verdict is emitted. Two
 * consequences worth stating: the selection no longer depends on list ORDER or on
 * which runs the API happened to return (four different answers were observed in
 * one session), and `no run for head` is reported as the ordinary thing it is
 * rather than as a fault.
 *
 * AND THE POPULATION IS DECLARED, NOT INCIDENTAL — SO THE WAIT CAN END (DEF-ROC-220).
 * Selecting by trunk head fixed WHICH run we answer about; it left HOW we find it
 * as `gh run list --limit N` plus a client-side filter, i.e. "of the last N runs,
 * which are this commit's". On a trunk taking many pushes an hour that answer
 * becomes EMPTY within minutes of the run finishing, and EMPTY IS NOT A TERMINAL
 * STATE. Measured 2026-09-16, after the owner noticed shells that were not moving:
 * six waiters stalled on conditions that had become unreachable, the oldest for
 * 8h17m, and FIVE OF SIX were this one bug — loops comparing that empty result
 * with "completed", against runs that had long since succeeded. Killing them was
 * not even inert: one woke the orchestrator with an obsolete result minutes later.
 * Quota survived at 5000/5000 by luck, not design.
 *
 * RAISING THE LIMIT IS NOT THE FIX — it moves the cliff, and a bound chosen by
 * guesswork is the same defect with a bigger number. The run is now addressed BY
 * IDENTITY (`gh run list --commit <sha>`), so the window is not part of the
 * predicate: an empty answer means THE SERVER SAYS THIS COMMIT HAS NO RUNS, which
 * is a fact about the commit and is reported as `no-run-for-sha`. The payload
 * carries `runPopulation` so a caller can tell that established absence from a
 * mere failure to see. The windowed list survives in exactly one place — the
 * "what was the last successful deploy" history scan, which is genuinely a
 * question about recency.
 *
 * ...AND THAT FIX REINTRODUCED THE SAME SHAPE ONE LAYER DOWN, MORE CONFIDENTLY
 * (DEF-ROC-220, round 2 — rejected at validation 2026-09-18). `gh run list
 * --commit` matches on the FULL 40-hex object name and nothing else: handed an
 * ABBREVIATION it returns an EMPTY ARRAY. `--sha` was taken verbatim, so that
 * empty array arrived as `runPopulation: "by-commit"` and was published as an
 * "ESTABLISHED absence rather than a failure to see" — a false sentence citing
 * THIS ITEM as its authority, about a commit whose deploy had SUCCEEDED. And the
 * tool disagreed with itself: `shaEq` deliberately accepts abbreviations, so the
 * MATCHER accepted what the QUERY could not, and nothing bridged or rejected.
 * Abbreviations are this project's ordinary spelling — the human line below prints
 * 12 chars, `git log --oneline` and every item record write 8, and the sibling
 * `exit-gate-ran` resolves them. So the sha is now RESOLVED BEFORE IT IS ASKED
 * ABOUT (`resolveFullSha`): expanded with `git rev-parse`, or, when that is
 * impossible, refused outright as `sha-not-resolved` — a FAILURE TO LOOK, which is
 * neither open nor shut nor an absence. The payload says which route was taken
 * (`shaResolution`). THE INVARIANT, which outranks both halves: this tool must
 * never report an ESTABLISHED ABSENCE about a question the server did not
 * understand.
 *
 * `--wait` IS THE ONE BOUNDED WAITER. It exists so that nobody writes the loop
 * again: two independent bounds (deadline + poll cap), only genuinely transient
 * states waited for, jittered polling, and a timeout that reports UNKNOWN and
 * NEVER a pass (§17i). See THE BOUNDED WAITER at the foot of this file.
 *
 * FOUR VERDICTS, NEVER TWO.
 *   open            the deploy job for TRUNK HEAD's run COMPLETED SUCCESS.
 *   NOT-ESTABLISHED a CANCELLED job left the question open (DEF-ROC-224) — see the
 *                   NO_ANSWER set below; neither open nor shut, and never a change failure
 *   blocked         it did not, and the cause is inside its needs closure (or is
 *                   the deploy job itself). Delivery is stopped. Names the job,
 *                   the sha, the run URL and the owning item.
 *   in-flight       it has not finished. Nothing has landed; nothing is broken.
 *   NOT-ESTABLISHED anything that prevented the reading — no config, no `gh`, no
 *                   runs, an unreadable workflow, a `deployJobId` the workflow
 *                   does not define. An unanswerable question must never render
 *                   as a clean answer; that mistake is what this tool exists to
 *                   correct, so it may not commit it itself.
 *   NOT-ESTABLISHED `wait-timeout`: `--wait` ran out of time. NOT a pass and NOT a
 *                   failure — waiting stopped, the run did not. Carries the last
 *                   thing actually observed as `lastVerdict`/`lastReason`, which
 *                   is never promoted to the verdict.
 *
 * Usage
 *   node deploy-lane.js --project ROC --repo-root . --json
 *   node deploy-lane.js --project ROC --repo-root . --json \
 *        --capture-dir <dir> [--capture-run <id>] [--workflow <path>] [--no-git] \
 *        [--head-sha <sha>]
 *
 *   WATCHING CI AFTER A PUSH — the route, so nobody hand-rolls one (DEF-ROC-220):
 *     make deploy-lane PROJECT=ROC WAIT=1 SHA=$(git -C work/ROC rev-parse HEAD)
 *     make deploy-lane PROJECT=ROC WAIT=1 SHA=<sha> TIMEOUT=1800000 INTERVAL=20000 JSON=1
 *   `--sha` names the commit to ask about (the one you just pushed); with no
 *   `--sha` the question is about trunk head, resolved by git. An ABBREVIATED sha
 *   is accepted and expanded with `git rev-parse` before the server is asked
 *   (DEF-ROC-220); if it cannot be expanded — `--no-git`, or a commit absent from
 *   `repoPath` — the answer is `sha-not-resolved`, never an absence. `--wait` polls that
 *   ONE run until it reaches a verdict, the deadline passes, or the poll cap is
 *   hit. Exit codes without `--json`: 0 answered, 2 BLOCKED, 3 wait-timeout.
 *   Defaults: --wait-timeout-ms 1800000, --poll-interval-ms 20000; both
 *   overridable per project (`waitTimeoutMs`, `pollIntervalMs`).
 *
 *   `--head-sha` DECLARES what trunk head is instead of resolving it with
 *   `git rev-parse <trunkRef>`. It exists so the selection rule can be tested
 *   hermetically; the live path never passes it. `--capture-run` without
 *   `--head-sha` is a REPLAY: the caller asserts the named run IS trunk head's,
 *   and the payload says so (`runSelection: "capture-run-replay"`). Given both,
 *   they must agree or nothing is established.
 *
 *   `--capture-dir` reads REAL CAPTURED `gh` output (`<dir>/run-list.json`,
 *   `<dir>/run-<id>.json`) instead of calling `gh`. It replaces the FETCH, not
 *   the thing under test: the needs-closure reading and the verdict still run
 *   against real payloads. The live end is a committed probe (`make deploy-lane
 *   PROJECT=ROC`), never a mock.
 *
 * Config: .claude/config/deploy-lane/<PROJECT>.json
 *   {
 *     "repo":         "AeroCloudSystems/PpsEventAggregation",
 *     "branch":       "main",
 *     "workflowFile": ".github/workflows/deploy-ROC.yml",
 *     "deployJobId":  "deploy-test",     // the JOB ID, not its display name
 *     "repoPath":     "work/ROC",        // repo holding the workflow + history
 *     "trunkRef":     "origin/main",
 *     "runLimit":     12,                // how far back the run list reaches
 *     "maxJobFetches": 8,                // bound on the last-open-run scan
 *     "timeoutMs":    60000
 *   }
 *
 * Exit code is ALWAYS 0 in --json mode: the caller decides severity. Without
 * --json it prints a human line and exits 2 on `blocked`, so it is usable as a
 * standalone probe.
 */
"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const PROJECT = arg("project");
const REPO_ROOT = path.resolve(arg("repo-root", process.cwd()));
const CAPTURE_DIR = arg("capture-dir");
const CAPTURE_RUN = arg("capture-run");
const WORKFLOW_OVERRIDE = arg("workflow");
// `--sha` is the LIVE way to name the commit (an agent asking about the commit it
// just pushed); `--head-sha` is the same declaration under the name the selection
// tests already use. One resolution path, so the waiter cannot drift from the gate.
const HEAD_SHA_ARG = arg("head-sha") || arg("sha");
const HEAD_SHA_FLAG = arg("head-sha") ? "--head-sha" : "--sha";
const NO_GIT = flag("no-git");
const AS_JSON = flag("json");
const WAIT = flag("wait");

const FAILED = new Set(["failure", "timed_out", "startup_failure",
  "action_required", "stale"]);
/**
 * CONCLUSIONS THAT ARE AN ABSENCE OF ANSWER RATHER THAN AN ANSWER OF "NO" (DEF-ROC-224).
 *
 * `cancelled` used to sit in FAILED, so a SUPERSEDED run read as a deploy FAILURE. The
 * ruling, settled at DEF-ROC-156 and held identically by ROC's `scripts/exit-gate-ran.mjs`:
 * a cancellation answers only "did we get an answer" (no). It never answers "was the answer
 * good or bad", and GitHub's conclusion cannot tell a cancel that reflects a known-bad
 * result from one that reflects mere displacement. So it routes to NOT-ESTABLISHED, the
 * same verdict DEF-ROC-142 introduced for a head with no run at all.
 *
 * BOTH DIRECTIONS OF HARM ARE REAL. A false SHUT stops the loop for nothing, and this
 * tool's own rationale says a limb that fires untruthfully is ignored inside a day. And a
 * cancelled deploy must not be counted as a CHANGE FAILURE: it is an availability gap in
 * the CI substrate, not a quality signal about the change, so counting it would put a
 * non-event into CFR.
 */
const NO_ANSWER = new Set(["cancelled"]);
/** Did this job's CONCLUSION stop the lane? Asked in ONE place, because the three
 *  call sites below each carry a different consequence and a membership test
 *  repeated three times is three chances to answer the same question differently. */
const failed = (j) => FAILED.has(j && j.conclusion);
/** Did this job leave the question OPEN? Never a failure, and never silence either. */
const noAnswer = (j) => NO_ANSWER.has(j && j.conclusion);
/** Work-item ids, as this system writes them in commit subjects. */
const ITEM_RE = /\b((?:UC|DEF|REQ|SLC|CHK|OI|IMP|EXP)-[A-Z][A-Z0-9]*-\d+)\b/g;

let OUT_DONE = false;
function out(obj) {
  if (OUT_DONE) return;
  OUT_DONE = true;
  const full = { project: PROJECT, ...obj };
  if (AS_JSON) {
    process.stdout.write(JSON.stringify(full) + "\n");
    process.exit(0);
  }
  process.stdout.write(render(full) + "\n");
  // THREE OUTCOMES, THREE CODES (DEF-ROC-220, §17i). 0 answered, 2 shut, 3 the
  // wait ran out. A timeout must not share an exit code with either an answer or
  // a red: a caller that cannot tell a broken measurement from a real regression
  // fixes the wrong one.
  if (full.reason === "wait-timeout") process.exit(3);
  process.exit(full.verdict === "blocked" ? 2 : 0);
}
/** NOT-ESTABLISHED as a VALUE. `notEstablished()` below is the same thing wired
 *  straight to the exit, kept for the permanent conditions read before any
 *  polling begins. */
function ne(reason, detail) {
  return { verdict: "NOT-ESTABLISHED", reason, detail: detail || null };
}
function notEstablished(reason, detail) {
  out(ne(reason, detail));
}

function render(r) {
  if (r.verdict === "open") {
    const nb = r.nonBlockingFailures.length
      ? ` (non-blocking reds, unchanged: ${r.nonBlockingFailures.join(", ")})` : "";
    return `deploy-lane[${r.project}] OPEN — "${r.deployJobName}" succeeded at `
      + `${String(r.headSha).slice(0, 12)} (run ${r.runId})${nb}`;
  }
  if (r.verdict === "blocked") {
    return `deploy-lane[${r.project}] BLOCKED — "${r.deployJobName}" is `
      + `${r.deployJobConclusion} at ${String(r.headSha).slice(0, 12)}; cause: `
      + `${r.blockingJobs.map((j) => `${j.name} [${j.conclusion}]`).join(", ") || r.reason}`
      + `; owner: ${(r.suspectItems || []).join(", ") || "UNKNOWN"}; ${r.runUrl}`;
  }
  if (r.verdict === "in-flight") {
    const state = r.deployJobStatus
      ? `is ${r.deployJobStatus}`
      : "has not been created yet (the run is still going)";
    return `deploy-lane[${r.project}] IN-FLIGHT — "${r.deployJobName}" ${state} at `
      + `${String(r.headSha).slice(0, 12)}; nothing has landed. ${r.runUrl}`;
  }
  if (r.reason === "wait-timeout") {
    return `deploy-lane[${r.project}] UNKNOWN — could not establish a verdict in `
      + `${r.waited.timeoutMs}ms (${r.waited.polls} poll(s), ended by ${r.waited.terminatedBy}); `
      + `last reading ${r.lastVerdict || "none"}`
      + `${r.lastReason ? ` (${r.lastReason})` : ""}. NOT a pass and NOT a red. ${r.runUrl || ""}`;
  }
  return `deploy-lane[${r.project}] NOT ESTABLISHED (${r.reason}) — ${r.detail || "no detail"}`;
}

if (!PROJECT) notEstablished("no-project", "--project is required");

// ---- config ---------------------------------------------------------------
const cfgPath = path.join(REPO_ROOT, ".claude", "config", "deploy-lane", `${PROJECT}.json`);
let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
} catch (e) {
  notEstablished("no-config",
    `${cfgPath} is missing or unreadable (${e.code || e.message}). Until it exists, `
    + `nothing is known about whether ${PROJECT}'s deploy lane is open — which is NOT `
    + `the same as it being open.`);
}
for (const k of ["repo", "workflowFile", "deployJobId", "repoPath"]) {
  if (!cfg[k]) notEstablished("config-incomplete", `"${k}" is required in ${cfgPath}`);
}
const branch = cfg.branch || "main";
const trunkRef = cfg.trunkRef || "origin/main";
const runLimit = cfg.runLimit || 12;
const maxJobFetches = cfg.maxJobFetches || 8;
const timeoutMs = cfg.timeoutMs || 60000;
const repoDir = path.resolve(REPO_ROOT, cfg.repoPath);
// How many runs OF ONE COMMIT to fetch. This is not a window over trunk: the
// population is already declared by the sha, and this only bounds re-runs and
// manual dispatches of that same commit, newest of which is the one we want.
const runsPerShaLimit = cfg.runsPerShaLimit || 20;
// The wait's two bounds. Both are declared, neither is discovered by running out
// of patience (DEF-ROC-220).
const waitTimeoutMs = Number(arg("wait-timeout-ms", cfg.waitTimeoutMs || 1800000));
const pollIntervalMs = Number(arg("poll-interval-ms", cfg.pollIntervalMs || 20000));

/** Same-prefix commit comparison. Module scope because the run lookup needs it
 *  BEFORE the verdict is computed (DEF-ROC-220 moved the sha to the front). */
function shaEq(a, b) {
  const x = String(a || "").toLowerCase();
  const y = String(b || "").toLowerCase();
  if (!x || !y) return false;
  const n = Math.min(x.length, y.length);
  if (n < 7) return false;              // too short to identify a commit
  return x.slice(0, n) === y.slice(0, n);
}

// ---- the workflow's job graph ---------------------------------------------
// `needs` is read from the workflow SOURCE because the GitHub jobs API does not
// expose it. A deliberately narrow line parser, not a general YAML reader: it
// only has to find job ids at 2-space indent under `jobs:` and their `name:` /
// `needs:` at 4-space indent. Step names sit at 6+ spaces behind a `- `, so they
// cannot be mistaken for a job name. It is pinned against the REAL workflow.
const workflowPath = WORKFLOW_OVERRIDE
  ? path.resolve(WORKFLOW_OVERRIDE)
  : path.join(repoDir, cfg.workflowFile);
let wfText;
try {
  wfText = fs.readFileSync(workflowPath, "utf8");
} catch (e) {
  notEstablished("no-workflow",
    `cannot read ${workflowPath} (${e.code || e.message}) — the deploy job's needs graph `
    + `lives there and the GitHub API does not carry it, so nothing can be decided.`);
}

function parseJobGraph(text) {
  const lines = text.split(/\r?\n/);
  let inJobs = false;
  let cur = null;
  const jobs = {}; // id -> { name, needs: [] }
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^jobs:\s*$/.test(line)) { inJobs = true; continue; }
    if (!inJobs) continue;
    // a top-level key ends the jobs block
    if (/^[A-Za-z0-9_.-]+:/.test(line)) { inJobs = false; continue; }
    const jobId = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (jobId) { cur = jobId[1]; jobs[cur] = { name: null, needs: [] }; continue; }
    if (!cur) continue;
    const nm = line.match(/^ {4}name:\s*(.+?)\s*$/);
    if (nm) {
      jobs[cur].name = nm[1].replace(/^["']|["']$/g, "");
      continue;
    }
    const nd = line.match(/^ {4}needs:\s*(.*)$/);
    if (nd) {
      const inline = nd[1].trim();
      if (inline.startsWith("[")) {
        jobs[cur].needs = inline.replace(/^\[|\]$/g, "").split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      } else if (inline) {
        jobs[cur].needs = [inline.replace(/^["']|["']$/g, "")];
      } else {
        // block list on the following lines
        for (let k = i + 1; k < lines.length; k += 1) {
          const item = lines[k].match(/^ {6}-\s*(.+?)\s*$/);
          if (!item) break;
          jobs[cur].needs.push(item[1].replace(/^["']|["']$/g, ""));
          i = k;
        }
      }
    }
  }
  return jobs;
}

const jobGraph = parseJobGraph(wfText);
const jobIds = Object.keys(jobGraph);
if (!jobIds.length) {
  notEstablished("workflow-unparseable",
    `no jobs could be read out of ${workflowPath} — refusing to guess. A workflow whose `
    + `graph we cannot read means the needs closure is unknown, not empty.`);
}
const DEPLOY_ID = cfg.deployJobId;
if (!jobGraph[DEPLOY_ID]) {
  notEstablished("deploy-job-not-in-workflow",
    `deployJobId "${DEPLOY_ID}" is not a job in ${workflowPath}. Job ids found: `
    + `${jobIds.join(", ")}. Fix ${cfgPath}; do NOT infer a deploy job by name.`);
}

// transitive closure of `needs`, excluding the deploy job itself
function needsClosure(id) {
  const seen = new Set();
  const stack = [...(jobGraph[id] ? jobGraph[id].needs : [])];
  while (stack.length) {
    const n = stack.pop();
    if (seen.has(n) || n === id) continue;
    if (!jobGraph[n]) continue; // a needs entry the workflow does not define
    seen.add(n);
    stack.push(...jobGraph[n].needs);
  }
  return [...seen];
}
const closure = needsClosure(DEPLOY_ID);
const displayName = (id) => (jobGraph[id] && jobGraph[id].name) || id;
const deployJobName = displayName(DEPLOY_ID);
const closureNames = closure.map(displayName);

// ---- the two external readers ----------------------------------------------
// Both live at module scope, beside each other, because both are read BEFORE the
// verdict is formed: `gh` answers which runs exist for a commit, and `git` answers
// what that commit IS. `git` used to be declared inside `evaluate()` a hundred
// lines below its first use and was reachable there only by function hoisting —
// which worked, and told the reader the opposite of the truth about when it is
// needed. Identical behaviour: it closes over `repoDir` and `timeoutMs`, both of
// which are module scope already.
function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024 });
}
function git(...args) {
  return execFileSync("git", ["-C", repoDir, ...args],
    { encoding: "utf8", timeout: timeoutMs }).trim();
}

const FULL_SHA_RE = /^[0-9a-f]{40}$/i;
/**
 * THE SERVER MATCHES ON THE FULL OBJECT NAME AND ONLY ON IT (DEF-ROC-220, round 2).
 *
 * Addressing the run by identity fixed the window defect and immediately
 * reintroduced its own shape one layer down. Measured on the live wire 2026-09-18:
 *   gh run list --commit edaa74f635153c70f972f3c9fb2c0354b7647cae -> [ {…success…} ]
 *   gh run list --commit edaa74f63515                             -> []
 * `--sha` was taken VERBATIM, so that empty array arrived carrying
 * `runPopulation: "by-commit"` and was published as an ESTABLISHED absence about a
 * commit whose deploy had SUCCEEDED — citing THIS ITEM as its authority. A
 * regression, not a pre-existing limit: measured on the NEWEST run so window
 * position could not be the confound, the pre-fix tool answered OPEN for the
 * 12-char `c5a7b13cd6f2` and this one answered NOT-ESTABLISHED.
 *
 * AND THE TOOL DISAGREED WITH ITSELF: `shaEq` above deliberately accepts
 * abbreviations (`n < 7` is the only rejection), so the matcher accepted what the
 * query could not, and nothing bridged or rejected. Abbreviations are the SPELLING
 * THIS PROJECT USES — the human line below prints 12 chars, `git log --oneline` and
 * every item record write 8, and the sibling tool (`scripts/exit-gate-ran.mjs`,
 * `make exit-gate-ran SHA=1656e581`) resolves them — so an agent will reasonably
 * expect both to.
 *
 * TWO ANSWERS, NEVER A THIRD. Expand it (`git rev-parse`), or REFUSE to claim a
 * population for a question that was never asked. The invariant that outranks both:
 * THE TOOL MUST NEVER REPORT AN ESTABLISHED ABSENCE ABOUT A QUESTION THE SERVER DID
 * NOT UNDERSTAND. Returns { sha, how } or { error }.
 */
function resolveFullSha(sha) {
  const s = String(sha || "").trim();
  if (FULL_SHA_RE.test(s)) return { sha: s.toLowerCase(), how: "as-given-40-hex" };
  if (!s) return { error: "it is empty" };
  if (NO_GIT) {
    return { error: `--no-git was given, so there is no repository to expand it against` };
  }
  let full;
  try {
    full = git("rev-parse", "--verify", `${s}^{commit}`);
  } catch (e) {
    return { error: `\`git -C ${repoDir} rev-parse --verify ${s}^{commit}\` failed `
      + `(${String(e.message).slice(0, 160)}) — the commit is not in that repository, or the `
      + `abbreviation is ambiguous` };
  }
  if (!FULL_SHA_RE.test(full)) {
    return { error: `git rev-parse returned "${String(full).slice(0, 60)}", which is not a `
      + `40-hex object name` };
  }
  return { sha: full.toLowerCase(), how: "git-rev-parse" };
}

function readRunList() {
  if (CAPTURE_DIR) {
    return JSON.parse(fs.readFileSync(path.join(CAPTURE_DIR, "run-list.json"), "utf8"));
  }
  return JSON.parse(gh(["run", "list", "--repo", cfg.repo, "--branch", branch,
    "--workflow", path.basename(cfg.workflowFile), "--limit", String(runLimit),
    "--json", "databaseId,headSha,conclusion,status,createdAt,displayTitle,event,url"]));
}

function readRun(id) {
  if (CAPTURE_DIR) {
    return JSON.parse(fs.readFileSync(path.join(CAPTURE_DIR, `run-${id}.json`), "utf8"));
  }
  return JSON.parse(gh(["run", "view", String(id), "--repo", cfg.repo, "--json",
    "databaseId,headSha,conclusion,status,createdAt,displayTitle,url,jobs"]));
}

/**
 * THE POPULATION IS DECLARED BY THE SHA, NEVER BY A WINDOW (DEF-ROC-220).
 *
 * `gh run list --limit N` answers a question nobody asked: "of the N most recent
 * runs, which are this commit's?" On a trunk that takes many pushes an hour, the
 * answer becomes EMPTY within minutes of the run finishing — and empty is not a
 * verdict, it is a failure to see. Five of the six waiters found stalled on
 * 2026-09-16 were loops comparing that empty result with "completed"; the oldest
 * had been doing it for 8h17m against a run that had long since succeeded.
 *
 * RAISING THE LIMIT IS NOT THE FIX. It moves the cliff, and a bound chosen by
 * guesswork is the same defect with a bigger number. `--commit <sha>` makes the
 * server select by IDENTITY, so the window stops being part of the predicate: the
 * residual `--limit` here bounds only how many RE-RUNS OF THE SAME COMMIT come
 * back, and the newest of those is exactly what we want.
 *
 * Returns { runs, population } — `population` is reported in the payload so a
 * caller can tell an ESTABLISHED absence ("the server says this commit has no
 * runs") from a window artefact, which is the distinction the defect turned on.
 */
function readRunsForSha(sha) {
  if (CAPTURE_DIR) {
    // A capture may declare the identity answer directly; otherwise we are reading
    // a WINDOW that was captured, and must say so rather than claim the server
    // answered about this commit.
    const byCommit = path.join(CAPTURE_DIR, `run-list-commit-${String(sha).toLowerCase()}.json`);
    if (fs.existsSync(byCommit)) {
      return { runs: JSON.parse(fs.readFileSync(byCommit, "utf8")), population: "by-commit" };
    }
    return { runs: readRunList().filter((r) => shaEq(r.headSha, sha)), population: "window-capture" };
  }
  return {
    runs: JSON.parse(gh(["run", "list", "--repo", cfg.repo, "--branch", branch,
      "--workflow", path.basename(cfg.workflowFile), "--commit", String(sha),
      "--limit", String(runsPerShaLimit),
      "--json", "databaseId,headSha,conclusion,status,createdAt,displayTitle,event,url"])),
    population: "by-commit",
  };
}

/**
 * THE READING, AS A VALUE RATHER THAN AN EXIT (DEF-ROC-220).
 *
 * Everything from here down used to run at top level and END THE PROCESS through
 * `out()`/`notEstablished()`. That shape can be read exactly ONCE, which is why a
 * caller who needed the answer REPEATEDLY had no choice but to hand-roll its own
 * polling loop around `gh` — and five of the six stalled waiters found on
 * 2026-09-16 were exactly that hand-rolled loop. Returning the verdict instead of
 * exiting on it is what lets the bounded waiter below be ONE implementation.
 *
 * Config and workflow parsing stay ABOVE this line on purpose: a missing config or
 * an unparseable workflow is a PERMANENT condition, and re-reading it on a timer
 * would be waiting for something that cannot arrive.
 */
function evaluate(opts) {
  const skipHistory = !!(opts && opts.skipHistory);
  // ---- WHICH COMMIT ARE WE ANSWERING ABOUT? (DEF-ROC-142) -------------------
  // The run is chosen by TRUNK HEAD'S SHA, never by recency. The newest run of
  // this workflow on the branch is a DIFFERENT question: on a path-filtered
  // workflow it routinely belongs to an older commit, because every items-only /
  // process / docs commit produces no run at all. The old code published that
  // run's verdict as head's — a false SHUT on 2026-08-29, and a false OPEN just
  // as readily.
  //
  // THIS NOW HAPPENS FIRST (DEF-ROC-220). The commit has to be known BEFORE the
  // runs are fetched, because the commit is what DECLARES which runs to fetch.
  // While the list came first, the fetch could only be "the last N", and the
  // filter was applied to whatever that happened to contain.
  let trunkHeadSha = null;
  let trunkHeadSource = null;
  let runSelection = null;
  let shaResolution = null;
  if (HEAD_SHA_ARG) {
    // DEF-ROC-220 round 2 — RESOLVE BEFORE ASKING, OR DO NOT CLAIM TO HAVE ASKED.
    const resolved = resolveFullSha(HEAD_SHA_ARG);
    if (resolved.error) {
      return ne("sha-not-resolved",
        `${HEAD_SHA_FLAG} was given "${String(HEAD_SHA_ARG).slice(0, 64)}", which is not a full `
        + `40-hex object name, and it could not be expanded into one: ${resolved.error}. `
        + `NOTHING WAS ASKED, SO NOTHING IS KNOWN — this is a FAILURE TO LOOK, and it is NEITHER `
        + `open NOR shut NOR an absence. \`gh run list --commit\` matches on the FULL object name `
        + `only: handed an abbreviation it returns an EMPTY ARRAY, and publishing that emptiness `
        + `as a fact about the commit is exactly the absence-read-as-evidence shape this item `
        + `exists to end (DEF-ROC-220: a 12-char sha of a commit whose deploy had SUCCEEDED read `
        + `as \`no-run-for-sha\`). Pass the full sha — \`git -C ${repoDir} rev-parse <ref>\` — or `
        + `drop --no-git so it can be expanded here.`);
    }
    trunkHeadSha = resolved.sha;
    trunkHeadSource = HEAD_SHA_FLAG;
    shaResolution = resolved.how;
  } else if (CAPTURE_RUN) {
    // REPLAY: the caller asserts the named run IS trunk head's run. Test-only —
    // the live path passes neither flag. Recorded in the payload so a reading can
    // never be mistaken for one taken against a resolved head.
    trunkHeadSource = "capture-run-assertion";
  } else if (!NO_GIT) {
    try {
      trunkHeadSha = git("rev-parse", trunkRef);
      trunkHeadSource = `git rev-parse ${trunkRef}`;
      shaResolution = "git-rev-parse";
    } catch (e) {
      return ne("trunk-head-unresolved",
        `\`git -C ${repoDir} rev-parse ${trunkRef}\` failed (${String(e.message).slice(0, 200)}), `
        + `so the commit this question is ABOUT is unknown. A verdict read off whatever run `
        + `happens to be newest would be a statement about a DIFFERENT commit (DEF-ROC-142). `
        + `Fetch ${trunkRef} in ${repoDir}, or pass --head-sha.`);
    }
  } else {
    return ne("trunk-head-not-established",
      `--no-git was given with no --head-sha and no --capture-run, so trunk head cannot be `
      + `established. Nothing is known about the deploy lane, which is NOT the same as it `
      + `being open (DEF-ROC-142).`);
  }

  let targetId;
  let runPopulation = null;
  if (CAPTURE_RUN) {
    targetId = CAPTURE_RUN;
    runSelection = trunkHeadSha ? "capture-run-at-declared-head" : "capture-run-replay";
    runPopulation = "capture-run";
  } else {
    let found;
    try {
      found = readRunsForSha(trunkHeadSha);
    } catch (e) {
      return ne("gh-run-list-failed",
        `could not list runs of ${path.basename(cfg.workflowFile)} for commit `
        + `${String(trunkHeadSha).slice(0, 12)} in ${cfg.repo} `
        + `(${String(e.message).slice(0, 240)}). Check \`gh auth status\`. Nothing was read, `
        + `which is not the same as the lane being open.`);
    }
    runPopulation = found.population;
    const candidates = (found.runs || []).filter((r) => shaEq(r.headSha, trunkHeadSha));
    if (!candidates.length) {
      // DEF-ROC-220 — TWO DIFFERENT ABSENCES, and conflating them is the defect.
      // `by-commit`: the SERVER was asked about this commit and said it has no
      // runs. That is an ESTABLISHED absence about the commit, and it is ordinary.
      // `window-capture`: we read a captured WINDOW, so all we know is that the
      // sha was not in it — which is exactly the reading that kept six waiters
      // spinning. Naming them differently is what lets a caller tell them apart.
      const windowed = runPopulation !== "by-commit";
      // The population is part of the ANSWER here, not a footnote: it is what
      // separates "the server says there is no such run" from "we did not see one".
      return { runPopulation, shaResolution, trunkHeadSha, trunkHeadSource,
        ...ne(windowed ? "no-run-for-trunk-head" : "no-run-for-sha",
        `no run of ${path.basename(cfg.workflowFile)} on ${branch} has head `
        + `${String(trunkHeadSha).slice(0, 12)} (per ${trunkHeadSource})`
        + (windowed
          ? `, within the newest ${(found.runs || []).length} run(s) of the captured window. `
            + `A window cannot establish an absence (DEF-ROC-220). `
          : `. The population was DECLARED BY THE COMMIT (\`gh run list --commit\`), not by a `
            + `window of the last N runs, so this is an ESTABLISHED absence rather than a `
            + `failure to see (DEF-ROC-220). `)
        + `THIS IS ORDINARY, NOT A FAULT: the workflow is `
        + `PATH-FILTERED, so a commit touching none of its trigger paths — every items-only, `
        + `process, or docs commit — produces no run at all. Nothing is therefore established `
        + `about this commit: it is NEITHER open NOR shut, and the verdict of a different `
        + `commit's run is not evidence about it (DEF-ROC-142: reading one BLOCKED a real cycle `
        + `on 2026-08-29, and the same fallback returns a false OPEN just as readily). If the `
        + `run has not been CREATED yet, \`--wait\` waits for it, bounded.`) };
    }
    // Deterministic even if several runs share the head sha (a re-run, a manual
    // dispatch): newest first, databaseId as the tie-break so ordering can never
    // depend on how the API happened to return the list.
    candidates.sort((a, b) => (String(b.createdAt).localeCompare(String(a.createdAt))
      || Number(b.databaseId) - Number(a.databaseId)));
    targetId = candidates[0].databaseId;
    runSelection = "trunk-head";
  }

  let run;
  try {
    run = readRun(targetId);
  } catch (e) {
    return ne("gh-run-view-failed",
      `could not read run ${targetId} in ${cfg.repo} (${String(e.message).slice(0, 240)})`);
  }
  // The invariant restated where the verdict is actually formed: whatever route
  // chose this run, it must be TRUNK HEAD's. A mismatch here means the list and the
  // run disagree, or a replay was pointed at the wrong commit — never a verdict.
  if (trunkHeadSha === null) {
    trunkHeadSha = run.headSha;           // the replay's asserted head
  } else if (!shaEq(run.headSha, trunkHeadSha)) {
    return ne("run-not-for-trunk-head",
      `run ${targetId} has head ${String(run.headSha).slice(0, 12)}, which is NOT trunk head `
      + `${String(trunkHeadSha).slice(0, 12)} (per ${trunkHeadSource}). A verdict about another `
      + `commit's run is not a verdict about trunk (DEF-ROC-142).`);
  }
  const runJobs = Array.isArray(run.jobs) ? run.jobs : [];
  if (!runJobs.length) {
    return ne("run-has-no-jobs",
      `run ${targetId} reported no jobs, so the deploy job's state cannot be read`);
  }

  const byName = new Map();
  for (const j of runJobs) if (!byName.has(j.name)) byName.set(j.name, j);
  // ABSENT IS TWO DIFFERENT THINGS, and conflating them was a real bug caught live
  // on 2026-08-27 at 18:33Z (real capture run-33098785042.json). GitHub does not
  // materialise a downstream job in the jobs list until it is queued or skipped, so
  // on a run that is STILL GOING the deploy job is absent ALTOGETHER. The first
  // version of this tool answered `deploy-job-not-in-run` and told the operator the
  // job had probably been RENAMED — an honest NOT-ESTABLISHED carrying a WRONG
  // diagnosis, which would have sent someone to edit the config on every push. The
  // run's own status is what separates the two: not-completed => in-flight;
  // completed => the job really is missing, so the config or the workflow moved.
  const deployJob = byName.get(deployJobName) || null;

  // ---- who owns the fix -----------------------------------------------------
  // The truncated `displayTitle` gh returns (…, ~68 chars) frequently cuts the
  // trailing item id off, so the FULL commit message is preferred when the repo is
  // readable. Where neither yields an id we say so rather than reporting an empty
  // list: a blocked lane with no named owner cannot be dispatched, and "no ids
  // found" must not read as "no item involved".
  function idsIn(text) {
    return [...new Set(String(text || "").match(ITEM_RE) || [])];
  }
  let suspectItems = [];
  let suspectItemsSource = null;
  let suspectItemsEstablished = false;
  if (!NO_GIT) {
    try {
      suspectItems = idsIn(git("log", "-1", "--format=%s%n%b", String(run.headSha)));
      suspectItemsSource = "commit-message";
      suspectItemsEstablished = true;
    } catch { /* fall through to the title */ }
  }
  if (!suspectItemsEstablished) {
    const title = String(run.displayTitle || "");
    suspectItems = idsIn(title);
    suspectItemsSource = "run-displayTitle";
    // gh truncates the title with an ellipsis; a truncated title that yielded
    // nothing has NOT established that no item is involved.
    suspectItemsEstablished = suspectItems.length > 0 || !/[…]|\.\.\.$/.test(title);
  }

  // ---- how much is stuck behind a shut lane --------------------------------
  // Bounded scan backwards for the newest run whose deploy job actually succeeded:
  // that sha is the last thing the environment can have received.
  //
  // THIS is the one question a recency window genuinely answers — "what is the
  // most recent successful deploy" is ABOUT recency — so the windowed list stays
  // here and only here. It is history, not the verdict: if it cannot be read the
  // scan reports nothing established and the verdict is unaffected, and `--wait`
  // skips it entirely between polls rather than re-fetching it on every tick.
  let lastOpenRun = null;
  let lastOpenEstablished = false;
  if (!skipHistory) {
    let fetched = 0;
    let recent = [];
    try { recent = readRunList(); } catch { recent = []; }
    if (!Array.isArray(recent)) recent = [];
    recent.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    for (const r of recent) {
      if (String(r.databaseId) === String(targetId)) continue;
      if (fetched >= maxJobFetches) break;
      let full;
      try { full = readRun(r.databaseId); } catch { continue; } finally { fetched += 1; }
      const dj = (full.jobs || []).find((j) => j.name === deployJobName);
      if (dj && dj.status === "completed" && dj.conclusion === "success") {
        lastOpenRun = { runId: full.databaseId, headSha: full.headSha, at: full.createdAt };
        lastOpenEstablished = true;
        break;
      }
    }
  }
  let undeliveredCommits = null;
  let undeliveredItems = [];
  if (!NO_GIT && lastOpenRun) {
    try {
      const range = `${lastOpenRun.headSha}..${trunkRef}`;
      undeliveredCommits = Number(git("rev-list", "--count", range));
      undeliveredItems = idsIn(git("log", "--format=%s%n%b", range));
    } catch { undeliveredCommits = null; }
  }

  // ---- the verdict ----------------------------------------------------------
  const outsideClosure = (j) => j.name !== deployJobName && !closureNames.includes(j.name);
  const nonBlockingFailures = runJobs.filter((j) => outsideClosure(j) && failed(j)).map((j) => j.name);
  // DEF-ROC-224. Dropping a cancelled out-of-closure job from the failure list must not
  // drop it from the REPORT: DEF-ROC-156's whole lesson is that a control built to catch a
  // silent gate was itself blind, and moving `cancelled` out of one bucket into silence
  // would be that mistake in miniature.
  const nonBlockingCancellations = runJobs.filter((j) => outsideClosure(j) && noAnswer(j)).map((j) => j.name);

  const common = {
    runId: Number(run.databaseId),
    runUrl: run.url,
    runConclusion: run.conclusion,
    runStatus: run.status,
    runTitle: run.displayTitle,
    headSha: run.headSha,
    repo: cfg.repo,
    branch,
    workflow: cfg.workflowFile,
    deployJobId: DEPLOY_ID,
    deployJobName,
    deployJobStatus: deployJob ? deployJob.status : null,
    deployJobConclusion: deployJob && deployJob.conclusion !== undefined
      ? deployJob.conclusion : null,
    deployJobUrl: (deployJob && deployJob.url) || null,
    needsClosure: closure,
    needsClosureJobNames: closureNames,
    nonBlockingFailures,
    nonBlockingCancellations,
    suspectItems,
    suspectItemsSource,
    suspectItemsEstablished,
    lastOpenRun,
    lastOpenRunEstablished: lastOpenEstablished,
    undeliveredCommits,
    undeliveredItems,
    trunkHeadSha,
    trunkHeadSource,
    runSelection,
    runPopulation,
    shaResolution,
    // Stated in the payload, not merely in a comment: the caller can assert that
    // the run's overall conclusion was NOT the input to the decision, and (since
    // DEF-ROC-142) that the run it decided about really is trunk head's.
    decidedBy: "deploy-job-and-needs-closure",
  };

  if (!deployJob) {
    if (String(run.status) !== "completed") {
      // STATED RESIDUAL, not a hidden one: if a job in the needs closure has ALREADY
      // failed while the deploy job is not yet created, the skip is a foregone
      // conclusion and this under-calls it as in-flight for the few minutes until the
      // run completes. That is deliberate — asserting `blocked` about a job GitHub has
      // not created yet would be claiming to know an outcome we have not observed, and
      // the gate runs before every pull, so it self-corrects on the next invocation.
      return ({ ...common, verdict: "in-flight", reason: "deploy-job-not-yet-created",
        blockingJobs: [], detail:
          `run ${targetId} is ${run.status} and "${deployJobName}" has not been created `
          + `yet — GitHub does not list a downstream job until it is queued or skipped. `
          + `NOTHING HAS LANDED and nothing is broken: this is a run still running, NOT a `
          + `renamed job and NOT a shut lane. Jobs so far: `
          + `${runJobs.map((j) => `${j.name} [${j.status}/${j.conclusion || "-"}]`).join(" | ")}. `
          + `Re-read after the run completes.` });
    }
    return ne("deploy-job-not-in-run",
      `run ${targetId} is COMPLETED and carries no job named "${deployJobName}" (jobs `
      + `present: ${runJobs.map((j) => j.name).join(" | ")}). The run is over, so the job `
      + `is genuinely missing: either the workflow's deploy job was renamed without `
      + `updating ${cfgPath}, or deployJobId points at a workflow this config no longer `
      + `describes. Nothing about the lane is established until that is fixed.`);
  }

  const closureJobs = closureNames
    .map((n) => byName.get(n))
    .filter(Boolean);
  const closureUnfinished = closureJobs.filter((j) => j.status !== "completed");
  const closureFailed = closureJobs.filter((j) => failed(j) || j.conclusion === "skipped");
  const closureCancelled = closureJobs.filter((j) => noAnswer(j));

  // IN-FLIGHT FIRST (AC-131-3). A deploy that has not finished has not landed, and
  // is not broken either. This is the half-cutover case: the ROC health endpoint
  // served the new buildSha with the Deploy job still in_progress — Function App
  // swapped, Web App not — so reading this as `open` dispatches a tester at a
  // half-completed cutover.
  if (deployJob.status !== "completed" || closureUnfinished.length) {
    return ({ ...common, verdict: "in-flight", reason: "deploy-not-finished", blockingJobs: [], detail:
      `"${deployJobName}" is ${deployJob.status} (conclusion ${String(deployJob.conclusion)}) `
      + `at ${String(run.headSha).slice(0, 12)}: NOT LANDED and not broken. Do not read this `
      + `as a deploy and do not dispatch validation against the host yet — a mid-cutover host `
      + `can already be serving the new build from one app while another has not swapped `
      + `(measured on ROC 2026-08-27). Re-read after the run completes.` });
  }

  if (deployJob.conclusion === "success") {
    return ({ ...common, verdict: "open", reason: null, blockingJobs: [], detail:
      `"${deployJobName}" succeeded at ${String(run.headSha).slice(0, 12)}.`
      + (nonBlockingFailures.length
        ? ` ${nonBlockingFailures.length} job(s) in this run FAILED and are outside the `
          + `deploy job's needs closure, so they did not and cannot stop delivery: `
          + `${nonBlockingFailures.join(", ")}. The run's own conclusion is `
          + `"${run.conclusion}" and was not consulted.`
        : "") });
  }

  // DEF-ROC-224 — NOTHING WAS ESTABLISHED. Deliberately placed AFTER `closureFailed` is
  // computed and consulted only when it is EMPTY: a genuine failure in the needs closure
  // SHUTS the lane whatever else was cancelled beside it, because the deploy is skipped on
  // that failure regardless. An established shut always outranks a not-established.
  if (!closureFailed.length && (closureCancelled.length || noAnswer(deployJob))) {
    const cancelled = closureCancelled.length ? closureCancelled : [deployJob];
    const reason = closureCancelled.length ? "needs-job-cancelled" : "deploy-job-cancelled";
    return ({ ...common, verdict: "NOT-ESTABLISHED", reason, blockingJobs: [],
      noAnswerJobs: cancelled.map((j) => j.name),
      detail:
        `${cancelled.map((j) => `"${j.name}"`).join(" and ")} ${cancelled.length > 1 ? "were" : "was"} `
        + `CANCELLED at ${String(run.headSha).slice(0, 12)}, so NOTHING IS ESTABLISHED about `
        + `"${deployJobName}" for this commit: it is NEITHER open NOR shut. A cancelled job is `
        + `NOT a deploy failure and NOT a change failure — it answers only "did we get an `
        + `answer" (no), never "was the answer good or bad", and a run superseded by a newer `
        + `push was cancelled for being out of date rather than for being wrong. Do NOT read `
        + `this as a red and do NOT record a change failure against the commit. Counting it `
        + `would put a non-event into CFR and a false SHUT here stops the loop for nothing. `
        + `Re-run the run, or push the commit that actually needs to reach the environment, `
        + `then re-read this. Jobs in this run: `
        + `${runJobs.map((j) => `${j.name} [${j.status}/${j.conclusion || "-"}]`).join(" | ")}.` });
  }

  let blockingJobs = closureFailed.map((j) => ({
    name: j.name,
    conclusion: j.conclusion,
    status: j.status,
    url: j.url || null,
    needsPath: `${DEPLOY_ID} needs ${closure.find((id) => displayName(id) === j.name) || "?"}`,
  }));
  let reason = "needs-job-failed";
  if (!blockingJobs.length) {
    if (failed(deployJob)) {
      reason = "deploy-job-failed";
      blockingJobs = [{ name: deployJobName, conclusion: deployJob.conclusion,
        status: deployJob.status, url: deployJob.url || null, needsPath: "the deploy job itself" }];
    } else {
      // Every needs job passed and the deploy STILL did not run. We do not know
      // why (an `if:` guard, a path filter, a required-reviewer wait). The lane is
      // shut all the same, and "we cannot see why" is precisely the dark-deploy
      // condition this tool exists for — so it blocks, and says it cannot see why.
      reason = "deploy-skipped-needs-satisfied";
    }
  }

  return ({ ...common, verdict: "blocked", reason, blockingJobs, detail:
    reason === "deploy-skipped-needs-satisfied"
      ? `"${deployJobName}" is ${deployJob.conclusion} at ${String(run.headSha).slice(0, 12)} `
        + `even though every job in its needs closure (${closureNames.join(", ") || "none"}) `
        + `passed. The lane did not run and this tool CANNOT SEE WHY — read the job's \`if:\` `
        + `guard, any path filter, and any environment approval. Nothing reached the `
        + `environment for this sha.`
      : `"${deployJobName}" is ${deployJob.conclusion} at ${String(run.headSha).slice(0, 12)} `
        + `because ${blockingJobs.map((j) => `"${j.name}" is ${j.conclusion}`).join(" and ")}. `
        + `Everything pushed since is undeployable and therefore un-validatable.` });

}


// ---------------------------------------------------------------------------
// THE BOUNDED WAITER (DEF-ROC-220)
//
// ONE implementation, because six hand-rolled ones were found stalled in a single
// session and five of them were the same bug. The rules it exists to hold:
//
//   1. IT TERMINATES. Two independent bounds — a DEADLINE and a POLL CAP — so a
//      zero/absurd interval cannot turn the deadline check into a hot spin, and
//      neither bound depends on the thing being waited for.
//   2. A TIMEOUT IS `UNKNOWN`, NEVER A PASS (§17i). The verdict on running out of
//      time is NOT-ESTABLISHED/wait-timeout, carrying the LAST thing actually
//      observed under `lastVerdict`/`lastReason` — never promoted to an answer.
//   3. ONLY GENUINELY TRANSIENT STATES ARE WAITED FOR. `in-flight` (not finished),
//      an absent run (not created yet), and a failed `gh` call (retryable, so it
//      gets backoff rather than a conclusion). A cancelled run, a renamed deploy
//      job, a missing config are all settled facts: waiting cannot change them, so
//      waiting on them is exactly the unreachable condition this defect is about.
//   4. THE POLL IS JITTERED. Several agents watching CI at once must not
//      synchronise into a burst; quota survived 2026-09-16 by luck, not design.
// ---------------------------------------------------------------------------
const WAITABLE = new Set([
  "no-run-for-sha",           // the run has not been CREATED yet
  "no-run-for-trunk-head",    // same, as seen through a captured window
  "gh-run-list-failed",       // retryable: rate limit, network, transient 5xx
  "gh-run-view-failed",
]);
/** Is this reading one that a later reading could legitimately change? */
function waitable(r) {
  if (r.verdict === "in-flight") return true;
  if (r.verdict !== "NOT-ESTABLISHED") return false;
  return WAITABLE.has(r.reason);
}
/** Synchronous sleep with ±20% jitter, never longer than the time left. */
function sleepSync(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function jittered(ms) {
  return Math.max(1, Math.round(ms * (0.8 + Math.random() * 0.4)));
}

function waitForVerdict() {
  const startedAt = Date.now();
  const deadline = startedAt + waitTimeoutMs;
  // The second, independent bound. Derived from the two declared numbers, so it
  // cannot be the thing that silently decides the wait — it only stops a
  // degenerate interval from spinning.
  const maxPolls = Math.max(2, Math.ceil(waitTimeoutMs / Math.max(1, pollIntervalMs)) + 2);
  let polls = 0;
  let last = null;
  while (polls < maxPolls) {
    polls += 1;
    const r = evaluate({ skipHistory: true });
    if (!waitable(r)) {
      // Settled. Re-read in full so the report carries the history the single-shot
      // reading would have had (last successful deploy, undelivered commits).
      const full = evaluate();
      return { ...full,
        waited: { polls, elapsedMs: Date.now() - startedAt, timeoutMs: waitTimeoutMs,
          pollIntervalMs, terminatedBy: "verdict" } };
    }
    last = r;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    sleepSync(Math.min(jittered(pollIntervalMs), remaining));
  }
  const elapsedMs = Date.now() - startedAt;
  const terminatedBy = polls >= maxPolls && Date.now() < deadline ? "poll-cap" : "deadline";
  return { ...(last || {}),
    verdict: "NOT-ESTABLISHED",
    reason: "wait-timeout",
    lastVerdict: (last && last.verdict) || null,
    lastReason: (last && last.reason) || null,
    waited: { polls, elapsedMs, timeoutMs: waitTimeoutMs, pollIntervalMs, terminatedBy },
    detail:
      `UNKNOWN — could not establish a verdict for `
      + `${String((last && last.trunkHeadSha) || HEAD_SHA_ARG || "trunk head").slice(0, 12)} `
      + `within ${waitTimeoutMs}ms (${polls} poll(s), ended by ${terminatedBy}). The last `
      + `reading was ${(last && last.verdict) || "none"}`
      + `${last && last.reason ? ` (${last.reason})` : ""}. THIS IS NOT A PASS AND NOT A `
      + `FAILURE: waiting stopped, the run did not. Read the run yourself, or wait again with `
      + `a longer --wait-timeout-ms. A waiter that invented an answer here would be the same `
      + `fault as one that never stopped (DEF-ROC-220, §17i).`
      + `${last && last.detail ? ` Last detail: ${last.detail}` : ""}`,
  };
}

out(WAIT ? waitForVerdict() : evaluate());
