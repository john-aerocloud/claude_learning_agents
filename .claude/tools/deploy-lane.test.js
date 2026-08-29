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

test("AC-131-1 / AC-142.2: selecting from the REAL run list picks TRUNK HEAD's run", () => {
  // No --capture-run: the tool must choose, from the real `gh run list` capture.
  // AMENDED BY DEF-ROC-142. This case used to assert it picked the list's NEWEST
  // run (33076365108) with no reference to trunk head at all — which is the
  // defect, written down as a requirement: on a path-filtered workflow the newest
  // run routinely belongs to a DIFFERENT commit, and publishing its verdict as
  // head's produced a false SHUT on 2026-08-29 (and would produce a false OPEN as
  // readily). The property DEF-ROC-131 actually needed — that the tool chooses
  // from the real list rather than being handed a run — is preserved here, now
  // keyed on head. `--head-sha` stands in for `git rev-parse origin/main`, which
  // is what the live path resolves.
  const r = runAtHead(shaOf("33076365108"), { captureDir: CAP });
  assert.ok(["open", "blocked", "in-flight"].includes(r.verdict), JSON.stringify(r));
  assert.strictEqual(r.runId, 33076365108,
    "the run whose head IS trunk head in the real capture is 33076365108");
  assert.strictEqual(r.runSelection, "trunk-head");
});

// ---------------------------------------------------------------------------
// DEF-ROC-142 — THE RUN IT REPORTS ON MUST BE TRUNK HEAD'S RUN.
//
// WHAT HAPPENED, 2026-08-29 09:14:40Z. This limb BLOCKED a real cycle naming run
// 33101512536 at 94be99dc, while `origin/main` was 37dd579 whose deploy job had
// SUCCEEDED. Measured afterwards: trunk head at that moment (ee1f7d9) touched
// ZERO deploy-trigger paths — the workflow filters on `src/app/**`,
// `src/dashboard/**`, `src/tools/replay-injector/**` and the workflow file — so
// it produced ZERO runs (`gh run list` confirms). The limb had no run for head,
// took `runList[0]` — a DIFFERENT commit's run — and published its verdict as if
// it were head's.
//
// THAT STATE IS NORMAL, NOT EXOTIC. Every items-only commit, every process
// commit, every docs commit lands on this trunk with no CI run at all, and this
// project makes them constantly.
//
// AND THE DIRECTION IS AN ACCIDENT OF WHICH RUN HAPPENED TO BE NEWEST. The same
// fallback emits a false OPEN just as readily — which is worse, because it is
// exactly the blindness DEF-ROC-131 built this limb to end. Both directions are
// demonstrated below against the SAME real captures.
//
// PROVENANCE OF THE NEW INPUT.
//   fixtures/deploy-lane/run-33101512536.json  REAL capture, head 94be99dc, taken
//        with `gh run view 33101512536 --json …` — THE run this limb falsely
//        blocked on. Its Deploy job really is `skipped` behind a failed
//        `Function App / lint, test and build`, so replaying it AS trunk head's
//        run is the non-vacuity case (AC-142.3): the fix must still BLOCK here.
//   The run LISTS below are COMPOSED IN-TEST from those real captures' own
//   fields (databaseId/headSha/status/conclusion/createdAt/displayTitle/url read
//   out of the capture, never hand-typed). Composition is required because no
//   single captured `gh run list` contains the run-pairs these cases need; every
//   VALUE in it is still real.
// ---------------------------------------------------------------------------
const LIST_FIELDS = ["databaseId", "headSha", "conclusion", "status", "createdAt",
  "displayTitle", "url"];

/** A capture dir holding the named REAL captures and a run-list.json composed
 *  from their own fields. `order` may reorder the list to prove the verdict does
 *  not depend on it. */
function captureDirOf(ids, { order } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-lane-cap-"));
  const list = [];
  for (const id of ids) {
    const src = path.join(CAP, `run-${id}.json`);
    fs.copyFileSync(src, path.join(dir, `run-${id}.json`));
    const full = JSON.parse(fs.readFileSync(src, "utf8"));
    const row = {};
    for (const k of LIST_FIELDS) row[k] = full[k] === undefined ? null : full[k];
    list.push(row);
  }
  const ordered = order === "reversed" ? [...list].reverse() : list;
  fs.writeFileSync(path.join(dir, "run-list.json"), JSON.stringify(ordered, null, 2));
  return dir;
}

const shaOf = (id) =>
  JSON.parse(fs.readFileSync(path.join(CAP, `run-${id}.json`), "utf8")).headSha;

const SHUT_RUN = "33101512536";          // REAL: Deploy skipped, needs job failed
const INFLIGHT_REAL_RUN = "33098785042"; // REAL: run mid-flight, deploy job not created
/** A real trunk sha that produced NO run — an items-only commit outside the
 *  workflow's path filter. This is the ordinary case, not a contrived one. */
const NO_RUN_HEAD = "5e78eebca518835570ffa7ad3a2df79c18367f1a";

/** `run()` with a declared trunk head, which is what the live path resolves from
 *  `git rev-parse origin/main`. */
function runAtHead(headSha, opts = {}) {
  const cfg = opts.cfg === undefined ? BASE_CFG : opts.cfg;
  const root = opts.root || repoRootWith(cfg);
  const argv = ["--project", "ROC", "--repo-root", root, "--json",
    "--capture-dir", opts.captureDir || CAP,
    "--workflow", opts.workflow === undefined ? WORKFLOW : opts.workflow,
    "--head-sha", headSha];
  if (opts.captureRun) argv.push("--capture-run", opts.captureRun);
  if (opts.noGit !== false) argv.push("--no-git");
  return JSON.parse(execFileSync("node", [TOOL, ...argv], { encoding: "utf8" }));
}

test("AC-142.2: the run is chosen by TRUNK HEAD, not by recency — head e1d1b2db's own SHUT run is what is reported", () => {
  // Before the fix this answered `open` about run 33076365108 (head f950220f),
  // silently reporting a DIFFERENT commit's green deploy while trunk head's own
  // deploy was skipped behind a failed test job. That is the false-OPEN
  // direction, and it is the blindness DEF-ROC-131 exists to end.
  const r = runAtHead(shaOf("33072439770"), { captureDir: CAP });
  assert.strictEqual(r.runId, 33072439770, JSON.stringify(r));
  assert.strictEqual(r.headSha, shaOf("33072439770"));
  assert.strictEqual(r.verdict, "blocked");
});

test("AC-142.2: trunk head with NO run is NOT ESTABLISHED — never another commit's SHUT verdict", () => {
  // The literal 2026-08-29 09:14:40Z reproduction: head is an items-only commit
  // with zero runs, and the newest run in the list is the genuinely shut
  // 33101512536 at 94be99dc.
  const dir = captureDirOf([SHUT_RUN, "33076365108"]);
  const r = runAtHead(NO_RUN_HEAD, { captureDir: dir });
  assert.strictEqual(r.verdict, "NOT-ESTABLISHED", JSON.stringify(r));
  assert.strictEqual(r.reason, "no-run-for-trunk-head");
  assert.ok(r.detail.includes(NO_RUN_HEAD.slice(0, 12)),
    `it must name the head it found no run for: ${r.detail}`);
  assert.ok(!/94be99dc/.test(JSON.stringify(r.verdict) + String(r.runId)),
    "no verdict may be published about another commit's run");
});

test("AC-142.2: trunk head with NO run is NOT ESTABLISHED — and never another commit's OPEN verdict either", () => {
  // The same fallback, the other way round, and the more dangerous one: the
  // newest run here is a SUCCESSFUL deploy of a different commit.
  const r = runAtHead(NO_RUN_HEAD, { captureDir: CAP });
  assert.strictEqual(r.verdict, "NOT-ESTABLISHED", JSON.stringify(r));
  assert.strictEqual(r.reason, "no-run-for-trunk-head");
  assert.notStrictEqual(r.verdict, "open");
});

test("AC-142.2: the no-run detail explains the ORDINARY cause, so nobody reads it as a fault", () => {
  const r = runAtHead(NO_RUN_HEAD, { captureDir: CAP });
  assert.ok(/path filter|paths:|trigger path/i.test(r.detail),
    `it must name why a commit produces no run: ${r.detail}`);
  assert.ok(/not.*open|neither/i.test(r.detail),
    `cannot-determine must be stated as neither open nor shut: ${r.detail}`);
});

test("AC-142.2: the payload STATES the head it decided about and how the run was chosen", () => {
  // A caller (loop-gate) must be able to assert the selection rule mechanically,
  // exactly as `decidedBy` already lets it assert the run conclusion was unused.
  const r = runAtHead(shaOf("33076365108"), { captureDir: CAP });
  assert.strictEqual(r.trunkHeadSha, shaOf("33076365108"));
  assert.strictEqual(r.runSelection, "trunk-head");
  assert.strictEqual(r.runId, 33076365108);
});

test("AC-142.2: a replayed run that is NOT trunk head's is REFUSED, not reported", () => {
  const r = runAtHead(shaOf("33072439770"), { captureRun: "33076365108", captureDir: CAP });
  assert.strictEqual(r.verdict, "NOT-ESTABLISHED", JSON.stringify(r));
  assert.strictEqual(r.reason, "run-not-for-trunk-head");
});

test("AC-142.1: an IN-FLIGHT run for trunk head is NOT ESTABLISHED, and does not fall back to an older run", () => {
  // The second, separate case. REAL capture 33098785042 was taken mid-flight;
  // pairing it with an older SUCCESSFUL deploy is what the fallback used to
  // resolve as `open`.
  const dir = captureDirOf([INFLIGHT_REAL_RUN, "33076365108"]);
  const r = runAtHead(shaOf(INFLIGHT_REAL_RUN), { captureDir: dir });
  assert.strictEqual(r.runId, Number(INFLIGHT_REAL_RUN), JSON.stringify(r));
  assert.strictEqual(r.verdict, "in-flight");
  assert.notStrictEqual(r.verdict, "blocked");
});

test("AC-142.3 (NON-VACUITY): run 33101512536 replayed AS trunk head's run still BLOCKS", () => {
  // The criterion that matters most. A fix that made this limb advisory in all
  // cases would pass every test above and be worse than the bug: the owner
  // ruling is that a red lane gets FIXED.
  const r = runAtHead(shaOf(SHUT_RUN), { captureRun: SHUT_RUN, captureDir: CAP });
  assert.strictEqual(r.verdict, "blocked", JSON.stringify(r));
  assert.strictEqual(r.runId, 33101512536);
  assert.strictEqual(r.deployJobConclusion, "skipped");
  assert.deepStrictEqual(r.blockingJobs.map((j) => j.name), [FN_JOB]);
});

test("AC-142.3 (NON-VACUITY): the same shut run, reached through the REAL selection path, still BLOCKS", () => {
  // Not via --capture-run: head IS 94be99dc and its run is in the list, which is
  // the shape of a genuinely shut lane on a live trunk.
  const dir = captureDirOf([SHUT_RUN, "33076365108"]);
  const r = runAtHead(shaOf(SHUT_RUN), { captureDir: dir });
  assert.strictEqual(r.verdict, "blocked", JSON.stringify(r));
  assert.strictEqual(r.runId, 33101512536);
  assert.strictEqual(r.runSelection, "trunk-head");
});

test("AC-142.3: a blocked lane at trunk head still names its OWNING ITEM", { skip: REAL_HISTORY }, () => {
  // gh truncated this run's title at "…Decision Log, Sim…", cutting the id off;
  // the real subject ends "(UC-ROC-110)" — the item the 09:14 block named, which
  // was the one true thing in an otherwise false finding. Attribution must
  // survive the selection fix.
  const r = runAtHead(shaOf(SHUT_RUN), { captureRun: SHUT_RUN, captureDir: CAP, noGit: false });
  assert.strictEqual(r.suspectItemsSource, "commit-message");
  assert.ok(r.suspectItems.includes("UC-ROC-110"), JSON.stringify(r.suspectItems));
});

test("AC-142.4: N invocations against a fixed CI state give N identical verdicts", () => {
  // Four different answers about the same question were observed in one session
  // on 2026-08-29. Selection keyed on a sha cannot vary with list ordering or
  // with which runs the API happened to return.
  const dir = captureDirOf([SHUT_RUN, "33076365108"]);
  const head = shaOf(SHUT_RUN);
  const answers = new Set();
  for (let i = 0; i < 5; i += 1) {
    const r = runAtHead(head, { captureDir: dir });
    answers.add(`${r.verdict}@${r.runId}`);
  }
  assert.deepStrictEqual([...answers], ["blocked@33101512536"],
    `five invocations produced ${JSON.stringify([...answers])}`);
});

test("AC-142.4: the verdict does not depend on the ORDER the run list arrives in", () => {
  const head = shaOf("33076365108");
  const a = runAtHead(head, { captureDir: captureDirOf([SHUT_RUN, "33076365108"]) });
  const b = runAtHead(head, { captureDir: captureDirOf([SHUT_RUN, "33076365108"], { order: "reversed" }) });
  assert.strictEqual(a.runId, b.runId, "list order must not choose the run");
  assert.strictEqual(a.verdict, b.verdict);
  assert.strictEqual(a.runId, 33076365108);
});

test("AC-142.2: with no way to establish trunk head, the limb says so — it does not guess a run", () => {
  // `--no-git` and no `--head-sha`: nothing can be resolved. Before the fix this
  // silently reported on runList[0].
  const root = repoRootWith(BASE_CFG);
  const r = JSON.parse(execFileSync("node", [TOOL, "--project", "ROC", "--repo-root", root,
    "--json", "--capture-dir", CAP, "--workflow", WORKFLOW, "--no-git"], { encoding: "utf8" }));
  assert.strictEqual(r.verdict, "NOT-ESTABLISHED", JSON.stringify(r));
  assert.strictEqual(r.reason, "trunk-head-not-established");
});
