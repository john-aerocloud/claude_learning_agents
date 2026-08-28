/**
 * deploy-lane — THE ARMING TEST, IN BOTH DIRECTIONS (DEF-ROC-131, AC-131-5).
 *
 * WHY BOTH DIRECTIONS ARE ONE TEST FILE AND NOT TWO. A limb that fires on a
 * shut deploy lane is worthless if it ALSO fires on the standing red, because
 * a signal that is on permanently is a signal nobody reads — and this repo has
 * a permanent red: `Dependency audit (prod-runtime, blocking)` (DEF-ROC-068,
 * `deepmerge-ts` reached via `flowbite-react` via the design system, pinned
 * EXACTLY, no upstream fix). So "fires on a real block" and "stays silent on
 * the standing red" are not two properties, they are one property — the ability
 * to DISCRIMINATE — and it is only proven by asserting both against the SAME
 * real data.
 *
 * PROVENANCE OF EVERY INPUT (§v123 wire-contract rule). `gh run view --json
 * jobs` is a wire we do not own, so nothing here is hand-typed:
 *
 *   fixtures/deploy-lane/run-33072439770.json  REAL capture, head e1d1b2db.
 *   fixtures/deploy-lane/run-33074315261.json  REAL capture, head 56900d80.
 *        Both: run conclusion `failure`; Deploy job `skipped`; the needs job
 *        `Function App / lint, test and build` FAILED. Lane SHUT. These are two
 *        of the four sequential reds that made UC-ROC-105 and UC-ROC-106
 *        undeployable for most of a cycle.
 *   fixtures/deploy-lane/run-33076365108.json  REAL capture, head f950220f.
 *        Run conclusion `failure` — SAME as the two above — yet the Deploy job
 *        SUCCEEDED, because the only failing job is the audit and the audit is
 *        not in `deploy-test`'s `needs:`. This capture is the whole argument:
 *        the run's overall conclusion CANNOT tell an open lane from a shut one.
 *   fixtures/deploy-lane/roc-deploy-workflow.yml  REAL workflow at f950220f.
 *        The `needs:` graph is read from this file because the GitHub jobs API
 *        does not carry `needs` at all (verified: a job object has exactly
 *        conclusion/completedAt/databaseId/name/startedAt/status/steps/url).
 *   fixtures/deploy-lane/run-INFLIGHT-synthetic.json  SYNTHETIC, declared so in
 *        its own `_provenance` field. It confirms NOTHING about the wire. It is
 *        the one edge case reality produced but nobody captured: on 2026-08-27
 *        the ROC health endpoint served the new `buildSha` while the Deploy job
 *        was still `in_progress` (Function App swapped, Web App not), and a
 *        half-completed cutover is not reproducible on demand.
 *
 * NOT A STUBBED BOUNDARY. `--capture-dir` replaces the `gh` FETCH with real
 * captured `gh` output; it does not stub the thing under test. The claim here
 * is about the needs-closure reading and the verdict, and both run against real
 * payloads. The live end — that `gh` really answers this way today — is a
 * committed probe, `make deploy-lane PROJECT=ROC`, not a mock.
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TOOL = path.join(__dirname, "deploy-lane.js");
const CAP = path.join(__dirname, "fixtures", "deploy-lane");
const WORKFLOW = path.join(CAP, "roc-deploy-workflow.yml");

const BLOCKED_RUNS = ["33072439770", "33074315261"];
const OPEN_RUN = "33076365108";
const AUDIT_JOB = "Dependency audit (prod-runtime, blocking)";
const DEPLOY_JOB = "Deploy Function App and Web App to AAS test";
const FN_JOB = "Function App / lint, test and build";
const WEB_JOB = "Web App / lint, test and build";
const INJECTOR_JOB = "Replay Injector / lint, test and build";

/** A throwaway repo-root carrying only a deploy-lane config, so the tool's real
 *  config path is exercised rather than bypassed. */
function repoRootWith(cfg, project = "ROC") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-lane-"));
  const dir = path.join(root, ".claude", "config", "deploy-lane");
  fs.mkdirSync(dir, { recursive: true });
  if (cfg !== null) {
    fs.writeFileSync(path.join(dir, `${project}.json`), JSON.stringify(cfg, null, 2));
  }
  return root;
}

const BASE_CFG = {
  repo: "AeroCloudSystems/PpsEventAggregation",
  branch: "main",
  workflowFile: ".github/workflows/deploy-ROC.yml",
  deployJobId: "deploy-test",
  // ABSOLUTE, and pointing at the REAL ROC repo on purpose: the `suspectItems`
  // claim below is about reading the FULL commit message, which only the real
  // history carries. gh truncates `displayTitle` at ~68 chars and cut the item
  // id off run 33074315261's subject, so a title-only reading could not have
  // named the owner. That is the assertion, not an incidental dependency.
  repoPath: path.resolve(__dirname, "..", "..", "work", "ROC"),
  trunkRef: "origin/main",
};

/** The ROC repo is a separate, parent-gitignored repo, so it is ABSENT from any
 *  parent-repo worktree or export. The one case that needs real history therefore
 *  declares it CANNOT BE RUN rather than failing — a test that would not run must
 *  say so, never render as either a pass or a defect (§17i). Every other case here
 *  is hermetic. */
const REAL_HISTORY = fs.existsSync(path.join(BASE_CFG.repoPath, ".git"))
  ? false   // node:test skips on a PRESENT `skip` key in some versions, so this must be false, never null
  : `SKIPPED, NOT PASSED: ${BASE_CFG.repoPath} is absent (the project repo is a `
    + `separate gitignored repo, so it is not in a parent-repo worktree or export). `
    + `This case reads a REAL commit message and cannot be established without it.`;

function run(opts = {}) {
  const cfg = opts.cfg === undefined ? BASE_CFG : opts.cfg;
  const root = opts.root || repoRootWith(cfg);
  const argv = ["--project", opts.project || "ROC", "--repo-root", root, "--json",
    "--capture-dir", opts.captureDir || CAP,
    "--workflow", opts.workflow === undefined ? WORKFLOW : opts.workflow];
  if (opts.captureRun) argv.push("--capture-run", opts.captureRun);
  if (opts.noGit) argv.push("--no-git");
  const stdout = execFileSync("node", [TOOL, ...argv], { encoding: "utf8" });
  return JSON.parse(stdout);
}

// ---------------------------------------------------------------------------
// DIRECTION 1 — IT FIRES on a deploy-blocking red.
// ---------------------------------------------------------------------------
for (const runId of BLOCKED_RUNS) {
  test(`AC-131-2 / AC-131-1: real run ${runId} — Deploy SKIPPED behind a failed needs job reads BLOCKED`, () => {
    const r = run({ captureRun: runId, noGit: true });
    assert.strictEqual(r.verdict, "blocked", JSON.stringify(r));
    assert.strictEqual(r.deployJobName, DEPLOY_JOB);
    assert.strictEqual(r.deployJobConclusion, "skipped");
    const names = r.blockingJobs.map((j) => j.name);
    assert.deepStrictEqual(names, [FN_JOB],
      `the blocking job must be named exactly, got ${JSON.stringify(r.blockingJobs)}`);
    assert.strictEqual(r.blockingJobs[0].conclusion, "failure");
    assert.strictEqual(r.runId, Number(runId));
    assert.ok(r.headSha && r.headSha.length >= 12, "must name the sha the lane is shut at");
    assert.ok(/^https:\/\/github\.com\//.test(r.runUrl), "must name the run URL");
  });

  test(`AC-131-2: real run ${runId} — the RUN's own conclusion is 'failure' and is NOT what decided it`, () => {
    const r = run({ captureRun: runId, noGit: true });
    assert.strictEqual(r.runConclusion, "failure");
    assert.strictEqual(r.decidedBy, "deploy-job-and-needs-closure",
      "the verdict must be derived from the deploy job + its needs graph, never the run conclusion");
  });
}

test("AC-131-4: a blocked lane names the OWNING ITEM, read out of the breaking commit", () => {
  // Real capture 33072439770's displayTitle is
  //   "style(DEF-ROC-063): the probe's affordance floor was declared and nev..."
  // so the owning item is recoverable without any git access at all.
  const r = run({ captureRun: "33072439770", noGit: true });
  assert.ok(Array.isArray(r.suspectItems), JSON.stringify(r));
  assert.ok(r.suspectItems.includes("DEF-ROC-063"),
    `must name the item in the breaking commit, got ${JSON.stringify(r.suspectItems)}`);
});

test("AC-131-4: the second real blocked run names ITS item from the FULL commit message",
  { skip: REAL_HISTORY }, () => {
  // gh's truncated title for this run is
  //   "fix(simulator-proof): the rot gate judged the item store from an UNCO…"
  // — the id was cut off. The real subject ends "(UC-ROC-106, ROC-19)".
  const r = run({ captureRun: "33074315261" });
  assert.strictEqual(r.suspectItemsSource, "commit-message");
  assert.ok(r.suspectItems.includes("UC-ROC-106"),
    `a blocked lane with no named owner cannot be dispatched: ${JSON.stringify(r.suspectItems)}`);
});

test("AC-131-4: a truncated title that yields no id is NOT-ESTABLISHED, never an empty list", () => {
  // The absence-vs-ignorance rule applied to attribution: "no ids found in 68
  // truncated characters" must never read as "no item is involved".
  const r = run({ captureRun: "33074315261", noGit: true });
  assert.strictEqual(r.suspectItemsSource, "run-displayTitle");
  assert.deepStrictEqual(r.suspectItems, []);
  assert.strictEqual(r.suspectItemsEstablished, false,
    "a truncated title yielding nothing establishes nothing");
});

// ---------------------------------------------------------------------------
// DIRECTION 2 — IT STAYS SILENT on DEF-ROC-068's standing audit red.
// This is the direction that decides whether the limb survives a day.
// ---------------------------------------------------------------------------
test("AC-131-2: real run 33076365108 — Deploy SUCCEEDED while the audit was RED, so the lane reads OPEN", () => {
  const r = run({ captureRun: OPEN_RUN, noGit: true });
  assert.strictEqual(r.verdict, "open", JSON.stringify(r));
  assert.strictEqual(r.deployJobConclusion, "success");
  assert.deepStrictEqual(r.blockingJobs, [],
    "nothing may be blocking when the deploy job itself succeeded");
});

test("AC-131-2: the standing audit red is reported as NON-BLOCKING, by name, and changes nothing", () => {
  const r = run({ captureRun: OPEN_RUN, noGit: true });
  assert.strictEqual(r.runConclusion, "failure",
    "the run really is red — that is the point");
  assert.deepStrictEqual(r.nonBlockingFailures, [AUDIT_JOB],
    `DEF-ROC-068's red must be named and excluded, got ${JSON.stringify(r.nonBlockingFailures)}`);
  assert.strictEqual(r.verdict, "open");
});

test("AC-131-2: the needs closure is read from the WORKFLOW, and excludes audit + injector", () => {
  const r = run({ captureRun: OPEN_RUN, noGit: true });
  assert.deepStrictEqual([...r.needsClosureJobNames].sort(), [FN_JOB, WEB_JOB].sort(),
    `deploy-test needs exactly the two test jobs, got ${JSON.stringify(r.needsClosureJobNames)}`);
  assert.ok(!r.needsClosureJobNames.includes(AUDIT_JOB),
    "the audit is DELIBERATELY not in deploy-test's needs (the workflow says so, and run 33076365108 proves it)");
  assert.ok(!r.needsClosureJobNames.includes(INJECTOR_JOB),
    "the replay injector is never deployed and is deliberately not in needs");
  assert.deepStrictEqual([...r.needsClosure].sort(), ["test-function-app", "test-web-app"]);
});

// ---------------------------------------------------------------------------
// AC-131-3 — a green-so-far run is NOT a landed deploy.
// ---------------------------------------------------------------------------
test("AC-131-3: a Deploy job still in_progress is IN-FLIGHT — never 'open', never 'blocked'", () => {
  // The capture id is the FILENAME STEM on purpose: `run-INFLIGHT-synthetic.json`
  // keeps the word SYNTHETIC in the path, so this input can never be mistaken in
  // a diff or a grep for one of the three real captures beside it.
  const r = run({ captureRun: "INFLIGHT-synthetic", noGit: true });
  assert.strictEqual(r.verdict, "in-flight", JSON.stringify(r));
  assert.strictEqual(r.deployJobStatus, "in_progress");
  assert.strictEqual(r.deployJobConclusion, null);
  assert.ok(/half|mid-cutover|not landed|still running/i.test(r.detail || ""),
    `must say plainly that nothing has landed yet, got: ${r.detail}`);
});

test("AC-131-3: a RUN still in progress whose deploy job has not been CREATED yet is IN-FLIGHT", () => {
  // REAL capture 33098785042, taken live at 18:33Z on 2026-08-27 while the run was
  // mid-flight. GitHub does not materialise a downstream job in the jobs list until
  // it is queued or skipped, so the deploy job is ABSENT ALTOGETHER. The first
  // version of this tool called that `deploy-job-not-in-run` and told the operator
  // the job had probably been RENAMED — an honest NOT-ESTABLISHED with a WRONG
  // diagnosis, which would have sent someone to edit the config on every push.
  const r = run({ captureRun: "33098785042", noGit: true });
  assert.strictEqual(r.verdict, "in-flight", JSON.stringify(r));
  assert.strictEqual(r.reason, "deploy-job-not-yet-created");
  assert.strictEqual(r.deployJobStatus, null);
  assert.ok(/NOT a renamed job/.test(r.detail || ""),
    `it must actively disclaim the rename, not merely omit it: ${r.detail}`);
  assert.ok(/NOT a shut lane/.test(r.detail || ""), r.detail);
  assert.ok(/NOTHING HAS LANDED/.test(r.detail || ""), r.detail);
});

test("AC-131-3: the HUMAN line for an uncreated deploy job says so, not \"is null\"", () => {
  // `make deploy-lane PROJECT=ROC` is the standalone probe an operator reads, so its
  // one line is a real surface. "is null" is the shape of a message nobody trusts.
  const root = repoRootWith(BASE_CFG);
  const stdout = execFileSync("node", [TOOL, "--project", "ROC", "--repo-root", root,
    "--capture-dir", CAP, "--capture-run", "33098785042",
    "--workflow", WORKFLOW, "--no-git"], { encoding: "utf8" });
  assert.ok(!/is null/.test(stdout), stdout);
  assert.ok(/IN-FLIGHT/.test(stdout), stdout);
  assert.ok(/has not been created yet/.test(stdout), stdout);
  assert.ok(/nothing has landed/i.test(stdout), stdout);
});

test("AC-131-2: an unfinished job's conclusion is the EMPTY STRING on the real wire, not null", () => {
  // Pinned because the tool's failure set is a membership test: if "" were ever
  // treated as a failure, every in-flight run would read as a shut lane. This is a
  // fact about `gh`, taken from the real capture, not from the synthetic variant
  // (which used null and would have hidden it).
  const raw = JSON.parse(fs.readFileSync(path.join(CAP, "run-33098785042.json"), "utf8"));
  const unfinished = raw.jobs.filter((j) => j.status === "in_progress");
  assert.ok(unfinished.length > 0, "the capture must actually contain an unfinished job");
  for (const j of unfinished) {
    assert.strictEqual(j.conclusion, "", `${j.name} carried ${JSON.stringify(j.conclusion)}`);
  }
  const r = run({ captureRun: "33098785042", noGit: true });
  assert.deepStrictEqual(r.blockingJobs, [],
    "an empty-string conclusion must never be read as a failure");
});

test("AC-131-1: a COMPLETED run with no deploy job IS a config/rename problem", () => {
  // The other half of the split: once the run is over, an absent deploy job really
  // is a renamed job or a workflow the config no longer describes.
  const root = repoRootWith({ ...BASE_CFG, deployJobId: "deploy-prod" });
  const r = run({ root, captureRun: OPEN_RUN, noGit: true,
    workflow: path.join(CAP, "renamed-deploy-job-workflow.yml") });
  assert.strictEqual(r.verdict, "NOT-ESTABLISHED");
  assert.strictEqual(r.reason, "deploy-job-not-in-run");
  assert.ok(/rename/i.test(r.detail || ""), r.detail);
});

// ---------------------------------------------------------------------------
// NOT-ESTABLISHED — an unanswerable question must never render as 'open'.
// ---------------------------------------------------------------------------
test("AC-131-1: no config is NOT-ESTABLISHED, never 'open'", () => {
  const r = run({ cfg: null });
  assert.strictEqual(r.verdict, "NOT-ESTABLISHED");
  assert.strictEqual(r.reason, "no-config");
});

test("AC-131-1: a workflow file we cannot read is NOT-ESTABLISHED, never 'open'", () => {
  const r = run({ captureRun: OPEN_RUN, workflow: path.join(CAP, "does-not-exist.yml"), noGit: true });
  assert.strictEqual(r.verdict, "NOT-ESTABLISHED");
  assert.strictEqual(r.reason, "no-workflow");
});

test("AC-131-1: a deployJobId absent from the workflow is NOT-ESTABLISHED, never 'open'", () => {
  const root = repoRootWith({ ...BASE_CFG, deployJobId: "deploy-to-mars" });
  const r = run({ root, captureRun: OPEN_RUN, noGit: true });
  assert.strictEqual(r.verdict, "NOT-ESTABLISHED");
  assert.strictEqual(r.reason, "deploy-job-not-in-workflow");
  assert.ok(/deploy-to-mars/.test(r.detail || ""), r.detail);
  assert.ok(/deploy-test/.test(r.detail || ""),
    "it must list the job ids it DID find, or the operator cannot fix the config");
});

test("AC-131-1: selecting the latest run from the REAL run list picks the deploy workflow's newest", () => {
  // No --capture-run: the tool must choose, from the real `gh run list` capture.
  const r = run({ noGit: true });
  assert.ok(["open", "blocked", "in-flight"].includes(r.verdict), JSON.stringify(r));
  assert.strictEqual(r.runId, 33076365108,
    "the newest run of the deploy workflow on trunk in the real capture is 33076365108");
});
