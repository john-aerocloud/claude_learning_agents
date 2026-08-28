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
 * FOUR VERDICTS, NEVER TWO.
 *   open            the deploy job for the newest trunk run COMPLETED SUCCESS.
 *   blocked         it did not, and the cause is inside its needs closure (or is
 *                   the deploy job itself). Delivery is stopped. Names the job,
 *                   the sha, the run URL and the owning item.
 *   in-flight       it has not finished. Nothing has landed; nothing is broken.
 *   NOT-ESTABLISHED anything that prevented the reading — no config, no `gh`, no
 *                   runs, an unreadable workflow, a `deployJobId` the workflow
 *                   does not define. An unanswerable question must never render
 *                   as a clean answer; that mistake is what this tool exists to
 *                   correct, so it may not commit it itself.
 *
 * Usage
 *   node deploy-lane.js --project ROC --repo-root . --json
 *   node deploy-lane.js --project ROC --repo-root . --json \
 *        --capture-dir <dir> [--capture-run <id>] [--workflow <path>] [--no-git]
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
const NO_GIT = flag("no-git");
const AS_JSON = flag("json");

const FAILED = new Set(["failure", "cancelled", "timed_out", "startup_failure",
  "action_required", "stale"]);
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
  process.exit(full.verdict === "blocked" ? 2 : 0);
}
function notEstablished(reason, detail) {
  out({ verdict: "NOT-ESTABLISHED", reason, detail: detail || null });
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

// ---- which run, and its jobs ----------------------------------------------
function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024 });
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

let runList;
try {
  runList = readRunList();
} catch (e) {
  notEstablished("gh-run-list-failed",
    `could not list runs of ${path.basename(cfg.workflowFile)} on ${branch} in ${cfg.repo} `
    + `(${String(e.message).slice(0, 240)}). Check \`gh auth status\`. Nothing was read, `
    + `which is not the same as the lane being open.`);
}
if (!Array.isArray(runList) || !runList.length) {
  notEstablished("no-runs",
    `no runs of ${path.basename(cfg.workflowFile)} on ${branch} in ${cfg.repo}. A workflow `
    + `that has never run has never deployed.`);
}
runList.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

const targetId = CAPTURE_RUN || runList[0].databaseId;
let run;
try {
  run = readRun(targetId);
} catch (e) {
  notEstablished("gh-run-view-failed",
    `could not read run ${targetId} in ${cfg.repo} (${String(e.message).slice(0, 240)})`);
}
const runJobs = Array.isArray(run.jobs) ? run.jobs : [];
if (!runJobs.length) {
  notEstablished("run-has-no-jobs",
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
function git(...args) {
  return execFileSync("git", ["-C", repoDir, ...args],
    { encoding: "utf8", timeout: timeoutMs }).trim();
}
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
let lastOpenRun = null;
let lastOpenEstablished = false;
{
  let fetched = 0;
  for (const r of runList) {
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
const nonBlockingFailures = runJobs
  .filter((j) => j.name !== deployJobName && !closureNames.includes(j.name)
                 && FAILED.has(j.conclusion))
  .map((j) => j.name);

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
  suspectItems,
  suspectItemsSource,
  suspectItemsEstablished,
  lastOpenRun,
  lastOpenRunEstablished: lastOpenEstablished,
  undeliveredCommits,
  undeliveredItems,
  // Stated in the payload, not merely in a comment: the caller can assert that
  // the run's overall conclusion was NOT the input to the decision.
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
    out({ ...common, verdict: "in-flight", reason: "deploy-job-not-yet-created",
      blockingJobs: [], detail:
        `run ${targetId} is ${run.status} and "${deployJobName}" has not been created `
        + `yet — GitHub does not list a downstream job until it is queued or skipped. `
        + `NOTHING HAS LANDED and nothing is broken: this is a run still running, NOT a `
        + `renamed job and NOT a shut lane. Jobs so far: `
        + `${runJobs.map((j) => `${j.name} [${j.status}/${j.conclusion || "-"}]`).join(" | ")}. `
        + `Re-read after the run completes.` });
  }
  notEstablished("deploy-job-not-in-run",
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
const closureFailed = closureJobs.filter((j) => FAILED.has(j.conclusion)
  || j.conclusion === "skipped");

// IN-FLIGHT FIRST (AC-131-3). A deploy that has not finished has not landed, and
// is not broken either. This is the half-cutover case: the ROC health endpoint
// served the new buildSha with the Deploy job still in_progress — Function App
// swapped, Web App not — so reading this as `open` dispatches a tester at a
// half-completed cutover.
if (deployJob.status !== "completed" || closureUnfinished.length) {
  out({ ...common, verdict: "in-flight", reason: "deploy-not-finished", blockingJobs: [], detail:
    `"${deployJobName}" is ${deployJob.status} (conclusion ${String(deployJob.conclusion)}) `
    + `at ${String(run.headSha).slice(0, 12)}: NOT LANDED and not broken. Do not read this `
    + `as a deploy and do not dispatch validation against the host yet — a mid-cutover host `
    + `can already be serving the new build from one app while another has not swapped `
    + `(measured on ROC 2026-08-27). Re-read after the run completes.` });
}

if (deployJob.conclusion === "success") {
  out({ ...common, verdict: "open", reason: null, blockingJobs: [], detail:
    `"${deployJobName}" succeeded at ${String(run.headSha).slice(0, 12)}.`
    + (nonBlockingFailures.length
      ? ` ${nonBlockingFailures.length} job(s) in this run FAILED and are outside the `
        + `deploy job's needs closure, so they did not and cannot stop delivery: `
        + `${nonBlockingFailures.join(", ")}. The run's own conclusion is `
        + `"${run.conclusion}" and was not consulted.`
      : "") });
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
  if (FAILED.has(deployJob.conclusion)) {
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

out({ ...common, verdict: "blocked", reason, blockingJobs, detail:
  reason === "deploy-skipped-needs-satisfied"
    ? `"${deployJobName}" is ${deployJob.conclusion} at ${String(run.headSha).slice(0, 12)} `
      + `even though every job in its needs closure (${closureNames.join(", ") || "none"}) `
      + `passed. The lane did not run and this tool CANNOT SEE WHY — read the job's \`if:\` `
      + `guard, any path filter, and any environment approval. Nothing reached the `
      + `environment for this sha.`
    : `"${deployJobName}" is ${deployJob.conclusion} at ${String(run.headSha).slice(0, 12)} `
      + `because ${blockingJobs.map((j) => `"${j.name}" is ${j.conclusion}`).join(" and ")}. `
      + `Everything pushed since is undeployable and therefore un-validatable.` });
