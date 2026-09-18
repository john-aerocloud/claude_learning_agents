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

// ===========================================================================
// DEF-ROC-224 — A CANCELLED JOB ESTABLISHES NOTHING. IT IS NOT A DEPLOY FAILURE.
//
// THE RULING, settled at DEF-ROC-156 and held identically by ROC's
// `scripts/exit-gate-ran.mjs`: `cancelled` answers ONLY "did we get an answer"
// (no). It never answers "was the answer good or bad". So it belongs with the
// NO-ANSWER class — NOT-ESTABLISHED here, NO-VERDICT there — and never with the
// SPOKE-AND-SAID-NO class, whether the job was killed mid-flight or while queued.
//
// WHY IT MATTERS. Both directions of harm are live. A false SHUT stops the loop
// for no reason, and this tool's own rationale says a limb that fires untruthfully
// is ignored inside a day. A cancelled deploy ALSO must not be counted as a change
// failure: it is an availability gap in the CI substrate, not a quality signal
// about the change, and counting it would put a non-event into CFR.
//
// PROVENANCE — THIS IS A REAL CAPTURE, NOT THE FIXTURE MUTATION THE ITEM EXPECTED.
//   fixtures/deploy-lane/run-35121920918.json        REAL capture, head bffd1773,
//        workflow `ROC / Release candidate`, taken 2026-09-17. Run conclusion
//        `cancelled` with FIVE materialised jobs: two of the three needs-closure
//        jobs `cancelled`, the third `success`, the `package` job itself
//        `cancelled`, and the out-of-closure audit `cancelled`.
//   fixtures/deploy-lane/roc-release-candidate-workflow.yml   REAL workflow at
//        that exact sha, so the needs closure is read rather than asserted.
//
// This matters more than convenience. On 2026-08-29 a tester established that
// every cancelled ROC run then in existence carried ZERO JOBS — GitHub does not
// materialise jobs for a run cancelled while still queued — and said plainly that
// the job-level trigger could not be observed in the wild, so the defect was
// reproduced only by mutating a fixture. Reality has since produced it: this
// workflow's concurrency group is `roc-release-candidate-${{ github.ref }}`,
// ref-keyed like deploy-ROC.yml, so a newer push evicts a run that has already
// started and its running jobs are cancelled individually.
//
// MEASURED BEFORE THE FIX, against that real capture:
//   verdict "blocked", reason "needs-job-failed", citing two CANCELLED jobs as the
//   cause, and the cancelled audit listed under `nonBlockingFailures`.
//
// The three variants below are DERIVED FROM THAT CAPTURE AT RUN TIME by changing
// named job conclusions and nothing else. They are never written into the fixture
// directory and their capture stems carry the word MUTATED, so no diff or grep can
// mistake one for a capture. Each declares exactly what it changed.
// ===========================================================================

const CANCELLED_RUN = "35121920918";
const RC_WORKFLOW = path.join(CAP, "roc-release-candidate-workflow.yml");
const PACKAGE_JOB = "Package verified ROC candidate (no deployment)";
const RC_CFG = { ...BASE_CFG, workflowFile: ".github/workflows/roc-release-candidate.yml",
  deployJobId: "package" };

/** The real capture, re-read from disk each time so a mutation cannot leak between cases. */
function realCancelledCapture() {
  return JSON.parse(fs.readFileSync(path.join(CAP, `run-${CANCELLED_RUN}.json`), "utf8"));
}

/**
 * A capture dir holding ONE run derived from the real capture by setting the named
 * jobs' conclusions. `stem` becomes the capture id, and it must carry MUTATED.
 */
function mutatedCaptureDir(stem, changes) {
  assert.ok(/MUTATED/.test(stem), "a derived input must say so in its own file name");
  const raw = realCancelledCapture();
  for (const [name, conclusion] of Object.entries(changes)) {
    const j = raw.jobs.find((x) => x.name === name);
    assert.ok(j, `the real capture must contain ${name} for this mutation to mean anything`);
    j.conclusion = conclusion;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-lane-mut-"));
  fs.writeFileSync(path.join(dir, `run-${stem}.json`), JSON.stringify(raw));
  fs.copyFileSync(path.join(CAP, "run-list.json"), path.join(dir, "run-list.json"));
  return dir;
}

const rc = (opts = {}) => run({ root: repoRootWith(RC_CFG), workflow: RC_WORKFLOW,
  noGit: true, captureRun: CANCELLED_RUN, ...opts });

test("AC-224-0: the input really is a REAL capture carrying JOB-LEVEL cancellations", () => {
  // Non-vacuity, asserted before anything is claimed from it. If this capture were
  // ever replaced by one with no cancelled jobs, every case below would go green
  // while proving nothing — the shape this repository has shipped twice.
  const raw = realCancelledCapture();
  assert.strictEqual(raw.conclusion, "cancelled");
  assert.strictEqual(raw.status, "completed");
  const cancelled = raw.jobs.filter((j) => j.conclusion === "cancelled").map((j) => j.name);
  assert.ok(cancelled.length >= 3, `expected job-level cancellations, got ${JSON.stringify(cancelled)}`);
  assert.ok(cancelled.includes(PACKAGE_JOB), "the deploy job itself must be one of them");
  assert.ok(raw.jobs.some((j) => j.conclusion === "success"),
    "and at least one job must have SUCCEEDED, so 'everything is cancelled' is not the only shape under test");
});

test("AC-224-1: cancelled needs jobs read NOT-ESTABLISHED, never a deploy failure", () => {
  const r = rc();
  assert.strictEqual(r.verdict, "NOT-ESTABLISHED", JSON.stringify(r));
  assert.strictEqual(r.reason, "needs-job-cancelled", JSON.stringify(r));
  assert.notStrictEqual(r.verdict, "blocked",
    "a superseded run establishes nothing about the lane; it did not say the deploy failed");
  assert.deepStrictEqual(r.blockingJobs || [], [],
    "nothing is blocking, because nothing was established");
});

test("AC-224-1: BOTH DIRECTIONS — a genuinely FAILED needs job in the SAME run still reads BLOCKED", () => {
  // The half that makes the other half worth anything, asserted against the SAME
  // real input with ONE conclusion changed. A fix that made everything
  // NOT-ESTABLISHED would be strictly worse than the defect.
  const dir = mutatedCaptureDir("MUTATED-35121920918-webapp-failed",
    { "Web App / lint, test and build": "failure" });
  const r = run({ root: repoRootWith(RC_CFG), workflow: RC_WORKFLOW, noGit: true,
    captureDir: dir, captureRun: "MUTATED-35121920918-webapp-failed" });
  assert.strictEqual(r.verdict, "blocked", JSON.stringify(r));
  assert.strictEqual(r.reason, "needs-job-failed");
  assert.deepStrictEqual(r.blockingJobs.map((j) => j.name), [WEB_JOB],
    "ONLY the genuinely failed job is named as the cause — a cancelled sibling is not a cause");
  assert.strictEqual(r.blockingJobs[0].conclusion, "failure");
});

test("AC-224-2: a cancelled DEPLOY JOB whose needs all passed is NOT-ESTABLISHED, not a failure", () => {
  // The other route into the FAILED set (deploy-lane.js's third call site). With
  // the closure green, the only thing left to read is the deploy job's own
  // cancellation — and it establishes nothing either.
  const dir = mutatedCaptureDir("MUTATED-35121920918-needs-green",
    { "Web App / lint, test and build": "success", "Function App / lint, test and build": "success" });
  const r = run({ root: repoRootWith(RC_CFG), workflow: RC_WORKFLOW, noGit: true,
    captureDir: dir, captureRun: "MUTATED-35121920918-needs-green" });
  assert.strictEqual(r.verdict, "NOT-ESTABLISHED", JSON.stringify(r));
  assert.strictEqual(r.reason, "deploy-job-cancelled", JSON.stringify(r));
  assert.strictEqual(r.deployJobConclusion, "cancelled");
});

test("AC-224-2: BOTH DIRECTIONS — a deploy job that genuinely FAILED with its needs green still BLOCKS", () => {
  const dir = mutatedCaptureDir("MUTATED-35121920918-deploy-failed", {
    "Web App / lint, test and build": "success",
    "Function App / lint, test and build": "success",
    [PACKAGE_JOB]: "failure",
  });
  const r = run({ root: repoRootWith(RC_CFG), workflow: RC_WORKFLOW, noGit: true,
    captureDir: dir, captureRun: "MUTATED-35121920918-deploy-failed" });
  assert.strictEqual(r.verdict, "blocked", JSON.stringify(r));
  assert.strictEqual(r.reason, "deploy-job-failed");
  assert.deepStrictEqual(r.blockingJobs.map((j) => j.name), [PACKAGE_JOB]);
});

test("AC-224-3: NOT-ESTABLISHED here is LOUD and NAMED — never a shrug, never silence", () => {
  // DEF-ROC-156's lesson is that a control built to catch a silent gate was itself
  // blind. Moving `cancelled` out of the FAILED set must not move it into silence.
  const r = rc();
  assert.match(r.detail || "", /cancel/i, `it must name what actually happened: ${r.detail}`);
  assert.match(r.detail || "", new RegExp(WEB_JOB.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "and name the jobs it is talking about, so the reader can go and look");
  assert.match(r.detail || "", /NOT a deploy failure|establishes nothing|not a change failure/i,
    `it must actively disclaim the failure reading rather than merely omitting it: ${r.detail}`);
  assert.ok(r.runUrl && /^https:\/\/github\.com\//.test(r.runUrl),
    "the full context must survive — a NOT-ESTABLISHED with no run url cannot be acted on");
  assert.ok(r.headSha, "and it must still name the sha it could not establish anything about");
  assert.ok(Array.isArray(r.noAnswerJobs) && r.noAnswerJobs.length >= 2,
    `the cancelled jobs must be enumerated in the payload, got ${JSON.stringify(r.noAnswerJobs)}`);
});

test("AC-224-3: the HUMAN line an operator reads says NOT ESTABLISHED and names the cancellation", () => {
  // `make deploy-lane PROJECT=ROC` is a real surface, and its exit code is read.
  const root = repoRootWith(RC_CFG);
  const stdout = execFileSync("node", [TOOL, "--project", "ROC", "--repo-root", root,
    "--capture-dir", CAP, "--capture-run", CANCELLED_RUN,
    "--workflow", RC_WORKFLOW, "--no-git"], { encoding: "utf8" });
  assert.match(stdout, /NOT ESTABLISHED/, stdout);
  assert.match(stdout, /cancel/i, stdout);
  assert.ok(!/BLOCKED/.test(stdout), `a superseded run must not print BLOCKED: ${stdout}`);
});

test("AC-224-4: a cancelled job OUTSIDE the needs closure is not a FAILURE — but is still named", () => {
  // The third call site. The audit is deliberately outside `package`'s needs, and in
  // this real run it was cancelled. Calling it a failure is wrong; dropping it
  // silently is the DEF-ROC-156 mistake in miniature.
  const dir = mutatedCaptureDir("MUTATED-35121920918-needs-green", {
    "Web App / lint, test and build": "success", "Function App / lint, test and build": "success",
  });
  const r = run({ root: repoRootWith(RC_CFG), workflow: RC_WORKFLOW, noGit: true,
    captureDir: dir, captureRun: "MUTATED-35121920918-needs-green" });
  assert.ok(!(r.nonBlockingFailures || []).includes(AUDIT_JOB),
    `a cancelled job is not a failure: ${JSON.stringify(r.nonBlockingFailures)}`);
  assert.ok((r.nonBlockingCancellations || []).includes(AUDIT_JOB),
    `...but it must still be reported: ${JSON.stringify(r.nonBlockingCancellations)}`);
});

test("AC-224-5: the three REAL fixtures this tool was built on are completely unaffected", () => {
  // The whole existing discrimination — a shut lane on a failed needs job, an OPEN
  // lane under a red audit — must be untouched by a change to a neighbouring class.
  for (const id of BLOCKED_RUNS) {
    const r = run({ captureRun: id, noGit: true });
    assert.strictEqual(r.verdict, "blocked", `${id}: ${JSON.stringify(r)}`);
    assert.strictEqual(r.reason, "needs-job-failed");
  }
  const open = run({ captureRun: OPEN_RUN, noGit: true });
  assert.strictEqual(open.verdict, "open", JSON.stringify(open));
  assert.deepStrictEqual(open.nonBlockingFailures, [AUDIT_JOB],
    "a genuinely FAILED out-of-closure job is still reported as a failure");
});

// ===========================================================================
// DEF-ROC-220 — THE POPULATION MUST BE DECLARED, AND THE WAIT MUST END.
//
// THE DEFECT, measured 2026-09-16 after the owner noticed shells that were not
// moving. Six waiters were stalled on conditions that had become UNREACHABLE,
// the oldest for 8h17m, and FIVE OF SIX WERE ONE BUG: a loop polling for a sha
// inside a FIXED-SIZE WINDOW (`gh run list --limit N`). Once newer runs displace
// that sha the filter returns EMPTY, and EMPTY IS NOT A TERMINAL STATE, so the
// comparison with "completed" can never match. The loop cannot tell NOT FINISHED
// YET from I CAN NO LONGER SEE IT — the absence-read-as-evidence shape this
// project has already hit in the commit guard (DEFECT-OAG-142), the coverage gate
// and the observation probe (DEF-ROC-199). On this trunk it is the NORMAL case,
// not an edge one: ROC pushes many commits an hour, so a sha leaves a 12-run
// window in minutes.
//
// RAISING `--limit` IS NOT THE FIX. It moves the cliff, and a bound chosen by
// guesswork is the same defect with a bigger number. The population has to stop
// being "whatever happened to fit in the last N runs" and start being DECLARED:
// address the run BY IDENTITY (`gh run list --commit <sha>`), so the window is
// not part of the predicate at all.
//
// WHY THESE CASES DRIVE A FAKE `gh` ON PATH RATHER THAN `--capture-dir`.
// `--capture-dir` replaces the FETCH, and the window IS the fetch — a capture
// directory hands the tool a list that was never truncated, so the whole defect
// is invisible from inside it. That is precisely why 41 green tests never saw
// this. The fake is a REAL EXECUTABLE resolved through PATH, honouring `--limit`
// and `--commit` the way `gh` 2.95 does, so the argv the tool actually builds is
// what decides the outcome. Nothing here stubs `child_process`; the exec
// boundary is driven, not replaced.
//
// PROVENANCE OF THE RUN PAYLOADS. The two runs whose VERDICT is asserted are the
// committed REAL captures, used UNMODIFIED:
//   run-33076365108.json          REAL, head f950220f, Deploy job SUCCEEDED.
//   run-INFLIGHT-synthetic.json   the repo's existing DECLARED synthetic (see its
//                                 own `_provenance`), head f950220f, Deploy job
//                                 `in_progress` and never finishing.
// The only authored data is the BUSY TRUNK around them — list rows with other
// shas and no jobs, which exist solely to push the target out of the window.
// They are declared synthetic here and no verdict is read from them.
// ===========================================================================

const REAL_OPEN_RUN = JSON.parse(fs.readFileSync(path.join(CAP, `run-${OPEN_RUN}.json`), "utf8"));
const REAL_INFLIGHT_RUN = JSON.parse(
  fs.readFileSync(path.join(CAP, "run-INFLIGHT-synthetic.json"), "utf8"));
const TARGET_SHA = REAL_OPEN_RUN.headSha;

/** A `gh` that honours `--limit` and `--commit` as gh 2.95 does. Written to a temp
 *  dir and put FIRST on PATH, so the tool's own `execFileSync("gh", …)` reaches it. */
const FAKE_GH = `#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const argv = process.argv.slice(2);
const corpus = JSON.parse(fs.readFileSync(process.env.FAKE_GH_CORPUS, "utf8"));
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(argv) + "\\n");
const val = (n) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : null; };
const fields = () => (val("--json") || "").split(",").filter(Boolean);
const pick = (o, fs2) => { const r = {}; for (const f of fs2) if (f in o) r[f] = o[f]; return r; };
function bump(key) {
  const p = process.env.FAKE_GH_STATE + "." + key;
  let n = 0; try { n = Number(fs.readFileSync(p, "utf8")) || 0; } catch (e) { n = 0; }
  fs.writeFileSync(p, String(n + 1));
  return n;
}
if (argv[0] === "run" && argv[1] === "list") {
  const commit = val("--commit");
  let runs = corpus.runs.slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  // gh filters by commit SERVER-SIDE: the population is the runs of that commit.
  if (commit) runs = runs.filter((r) =>
    String(r.headSha).toLowerCase() === String(commit).toLowerCase());
  // ...and only then applies --limit. This is the window that ate the sha.
  runs = runs.slice(0, Number(val("--limit") || 30));
  // "the run does not exist YET": the first N listings find nothing at all.
  if (corpus.appearAfter && bump("list") < corpus.appearAfter) runs = [];
  process.stdout.write(JSON.stringify(runs.map((r) => pick(r, fields().filter((f) => f !== "jobs")))) + "\\n");
  process.exit(0);
}
if (argv[0] === "run" && argv[1] === "view") {
  const run = corpus.runs.find((r) => String(r.databaseId) === String(argv[2]));
  if (!run) { process.stderr.write("no such run\\n"); process.exit(1); }
  process.stdout.write(JSON.stringify(pick(run, fields())) + "\\n");
  process.exit(0);
}
process.stderr.write("fake gh: unsupported " + argv.join(" ") + "\\n");
process.exit(1);
`;

/** Synthetic busy trunk: `n` rows NEWER than the target, each a different sha.
 *  Declared synthetic; no verdict is ever read from one. */
function busyTrunk(n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const sha = String(i).padStart(2, "0").repeat(20).slice(0, 40);
    out.push({
      _provenance: "SYNTHETIC — a busy-trunk list row. Asserts nothing; it exists only to "
        + "displace the real capture out of a fixed-size window.",
      databaseId: 40000000000 + i,
      headSha: sha,
      conclusion: "success",
      status: "completed",
      createdAt: `2026-08-28T0${Math.floor(i / 10)}:${String(i % 60).padStart(2, "0")}:00Z`,
      displayTitle: `chore: busy trunk ${i}`,
      event: "push",
      url: `https://github.com/AeroCloudSystems/PpsEventAggregation/actions/runs/${40000000000 + i}`,
      jobs: [],
    });
  }
  return out;
}

function liveRun(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-lane-gh-"));
  const ghPath = path.join(dir, "gh");
  fs.writeFileSync(ghPath, FAKE_GH);
  fs.chmodSync(ghPath, 0o755);
  const corpusPath = path.join(dir, "corpus.json");
  fs.writeFileSync(corpusPath, JSON.stringify({ runs: opts.runs, appearAfter: opts.appearAfter || 0 }));
  const logPath = path.join(dir, "gh.log");
  fs.writeFileSync(logPath, "");
  const root = repoRootWith({ ...BASE_CFG, ...(opts.cfg || {}) });
  const argv = ["--project", "ROC", "--repo-root", root, "--json", "--workflow", WORKFLOW,
    "--no-git", "--head-sha", opts.sha, ...(opts.argv || [])];
  const started = Date.now();
  const stdout = execFileSync("node", [TOOL, ...argv], {
    encoding: "utf8",
    timeout: opts.killAfterMs || 60000,
    env: { ...process.env,
      PATH: dir + path.delimiter + process.env.PATH,
      FAKE_GH_CORPUS: corpusPath,
      FAKE_GH_LOG: logPath,
      FAKE_GH_STATE: path.join(dir, "state") },
  });
  const calls = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { r: JSON.parse(stdout), calls, elapsedMs: Date.now() - started };
}

const listCalls = (calls) => calls.filter((a) => a[0] === "run" && a[1] === "list");

test("AC-220-1: a sha DISPLACED out of the listing window still yields its TRUE verdict", () => {
  // The exact 2026-09-16 condition: the run exists and finished long ago, but 20
  // newer runs sit in front of it and the config's window is 12. Reading the
  // window, the tool sees nothing and can conclude nothing. Reading by IDENTITY,
  // it reads the real capture whose Deploy job SUCCEEDED, which is the truth.
  const { r } = liveRun({
    sha: TARGET_SHA,
    runs: [REAL_OPEN_RUN, ...busyTrunk(20)],
    cfg: { runLimit: 12 },
  });
  assert.strictEqual(r.verdict, "open", JSON.stringify(r));
  assert.strictEqual(r.runId, Number(OPEN_RUN));
  assert.strictEqual(r.headSha, TARGET_SHA);
});

test("AC-220-1: the resolution DECLARES its population — gh is asked --commit <sha>, not --limit N", () => {
  // The property, not the symptom. A bigger --limit passes the case above and is
  // still the same defect; what makes it gone is that the sha, not a position in
  // a list, decides which runs are candidates.
  const { calls } = liveRun({
    sha: TARGET_SHA,
    runs: [REAL_OPEN_RUN, ...busyTrunk(20)],
    cfg: { runLimit: 12 },
  });
  const resolving = listCalls(calls).filter((a) => a.includes("--commit"));
  assert.ok(resolving.length >= 1,
    `the run must be addressed by identity: ${JSON.stringify(listCalls(calls))}`);
  assert.ok(resolving.every((a) => a[a.indexOf("--commit") + 1] === TARGET_SHA),
    `--commit must name the sha under test: ${JSON.stringify(resolving)}`);
});

test("AC-220-3: a sha with NO run at all TERMINATES with an established absence, not a window story", () => {
  // The other direction, and the one that must never be a pass: nothing ran for
  // this commit. Said plainly, and said as a fact about the COMMIT rather than
  // about how far back we happened to look.
  const { r } = liveRun({ sha: TARGET_SHA, runs: busyTrunk(20), cfg: { runLimit: 12 } });
  assert.strictEqual(r.verdict, "NOT-ESTABLISHED", JSON.stringify(r));
  assert.strictEqual(r.reason, "no-run-for-sha");
  assert.strictEqual(r.runPopulation, "by-commit");
  assert.ok(!/newest \d+ run/.test(r.detail),
    `the absence must not be attributed to the size of a window: ${r.detail}`);
  assert.ok(/neither/i.test(r.detail), `neither open nor shut must be stated: ${r.detail}`);
});

test("AC-220-2: --wait on a run that never finishes ENDS at its deadline and says UNKNOWN", () => {
  // The bound demonstrated by EXCEEDING it. The in-flight capture never completes,
  // so the only thing that can end this is the deadline. If the process does not
  // exit, execFileSync's kill makes the case fail — which is the honest result for
  // a waiter that does not terminate.
  const { r, elapsedMs } = liveRun({
    sha: REAL_INFLIGHT_RUN.headSha,
    runs: [REAL_INFLIGHT_RUN],
    argv: ["--wait", "--wait-timeout-ms", "600", "--poll-interval-ms", "50"],
    killAfterMs: 30000,
  });
  assert.strictEqual(r.verdict, "NOT-ESTABLISHED", JSON.stringify(r));
  assert.strictEqual(r.reason, "wait-timeout");
  assert.strictEqual(r.lastVerdict, "in-flight");
  assert.ok(r.waited && r.waited.polls > 1, `it must have polled: ${JSON.stringify(r.waited)}`);
  assert.strictEqual(r.waited.terminatedBy, "deadline");
  assert.ok(elapsedMs < 20000, `it must end near its deadline, not at the kill: ${elapsedMs}ms`);
});

test("AC-220-2: a wait that timed out is UNKNOWN — never open, never blocked, never a pass", () => {
  // §17i. A bounded wait that could not establish the verdict reports that it could
  // not. The whole point of ending the loop is lost if ending it invents an answer.
  const { r } = liveRun({
    sha: REAL_INFLIGHT_RUN.headSha,
    runs: [REAL_INFLIGHT_RUN],
    argv: ["--wait", "--wait-timeout-ms", "300", "--poll-interval-ms", "50"],
    killAfterMs: 30000,
  });
  assert.notStrictEqual(r.verdict, "open");
  assert.notStrictEqual(r.verdict, "blocked");
  assert.strictEqual(r.reason, "wait-timeout");
  assert.ok(/UNKNOWN|not established|could not/i.test(r.detail), r.detail);
});

test("AC-220-3: --wait on a sha with no run is BOUNDED too — absence is waited for, then reported", () => {
  // A run genuinely does not exist for a few seconds after a push, so absence must
  // be waitable. It must not therefore be waitable FOR EVER: the same deadline ends
  // it, and the answer is still that nothing was established.
  const { r } = liveRun({
    sha: TARGET_SHA,
    runs: busyTrunk(20),
    cfg: { runLimit: 12 },
    argv: ["--wait", "--wait-timeout-ms", "400", "--poll-interval-ms", "50"],
    killAfterMs: 30000,
  });
  assert.strictEqual(r.verdict, "NOT-ESTABLISHED", JSON.stringify(r));
  assert.strictEqual(r.reason, "wait-timeout");
  assert.strictEqual(r.lastReason, "no-run-for-sha");
  assert.ok(r.waited.polls > 1, JSON.stringify(r.waited));
});

test("AC-220-4: a run that appears WHILE waiting is picked up and its true verdict returned", () => {
  // The push-then-watch case an agent actually runs at step 8 of the loop: the run
  // does not exist for the first two polls, then it is there and it is green.
  const { r, calls } = liveRun({
    sha: TARGET_SHA,
    runs: [REAL_OPEN_RUN],
    appearAfter: 2,
    argv: ["--wait", "--wait-timeout-ms", "20000", "--poll-interval-ms", "50"],
    killAfterMs: 30000,
  });
  assert.strictEqual(r.verdict, "open", JSON.stringify(r));
  assert.strictEqual(r.runId, Number(OPEN_RUN));
  assert.ok(r.waited.polls >= 3, `it must have waited through the absence: ${JSON.stringify(r.waited)}`);
  assert.strictEqual(r.waited.terminatedBy, "verdict");
  assert.ok(listCalls(calls).length >= 3, JSON.stringify(listCalls(calls)));
});

test("AC-220-4: the agent files name the bounded waiter, and carry no unbounded polling recipe", () => {
  // Candidate direction 3 on the item: whatever lands must be THE DOCUMENTED ROUTE,
  // or agents keep hand-rolling the unbounded form — which is how five identical
  // stalled loops came to exist in one session.
  const agentsDir = path.join(__dirname, "..", "agents");
  const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
  // The route as committed: `make deploy-lane … WAIT=1`, or the tool's own --wait.
  const named = files.filter((f) => {
    const text = fs.readFileSync(path.join(agentsDir, f), "utf8");
    return /deploy-lane/.test(text) && /WAIT=1|--wait\b/.test(text);
  });
  for (const required of ["engineer.md", "cicd.md"]) {
    assert.ok(named.includes(required),
      `${required} must name the committed bounded waiter as the route for watching CI`);
  }
  // ...and the standing half: no agent file may carry a COPYABLE polling loop over
  // `gh`. This one is vacuously true today and is here so it stays that way — the
  // recipe is what gets pasted into a shell, and five identical pastes is how one
  // bug became six stalled processes. It keys on the LOOP, not on the word
  // `--limit`, so the paragraphs above may go on explaining why the window is fatal.
  for (const f of files) {
    const lines = fs.readFileSync(path.join(agentsDir, f), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!/\bgh (run|api)\b/.test(line)) return;
      const near = lines.slice(Math.max(0, i - 2), i + 4).join("\n");
      assert.ok(!/\b(sleep|while|until)\b/.test(near),
        `${f}:${i + 1} carries a hand-rolled gh polling loop; agents copy these verbatim`);
    });
  }
});
