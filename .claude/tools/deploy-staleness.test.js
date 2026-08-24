"use strict";
/**
 * deploy-staleness — the branch that matters is "a DEPLOYABLE change is behind".
 *
 * The live ROC run already exercises `current`-ish drift (1 commit behind, none of
 * it deployable). What no live run could exercise on demand is the DEF-ROC-086
 * condition itself: the environment behind trunk by a commit that touches a
 * deploy-trigger path. That is the case whose absence went unnoticed for three
 * pushes, so it is the case that gets a test.
 *
 * Each case builds a REAL temporary git repo and a REAL config, and stubs only
 * the one thing that cannot be built locally — the deployed host — with a tiny
 * `curl` shim on PATH that prints a chosen buildSha. Stubbing curl rather than
 * the tool's own logic keeps the git comparison, the config parsing and the
 * three-outcome vocabulary all under test.
 */
const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TOOL = path.join(__dirname, "deploy-staleness.js");

function sh(cmd, args, cwd, env) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", env: env || process.env }).trim();
}

/** A repo root containing `.claude/config/deploy-staleness/<P>.json` and a project repo. */
function scaffold({ triggerPaths, healthBody, shaPicker }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depstale-"));
  const repo = path.join(root, "work", "PROJ");
  fs.mkdirSync(repo, { recursive: true });
  const g = (...a) => sh("git", ["-C", repo, ...a]);
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");

  const write = (rel, txt) => {
    const p = path.join(repo, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, txt);
  };

  // c1: the deployed commit
  write("src/app/a.ts", "one");
  g("add", "-A"); g("commit", "-qm", "c1 app");
  const c1 = g("rev-parse", "HEAD");

  // c2: docs only — NOT a trigger path
  write("README.md", "docs");
  g("add", "-A"); g("commit", "-qm", "c2 docs");
  const c2 = g("rev-parse", "HEAD");

  // c3: touches a trigger path — this is the deployable one
  write("src/app/b.ts", "two");
  g("add", "-A"); g("commit", "-qm", "c3 app");
  const c3 = g("rev-parse", "HEAD");

  // `origin/main` without a network: a local ref of that exact name.
  g("update-ref", "refs/remotes/origin/main", "HEAD");

  const cfgDir = path.join(root, ".claude", "config", "deploy-staleness");
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(path.join(cfgDir, "PROJ.json"), JSON.stringify({
    healthUrl: "https://example.invalid/api/health",
    shaField: "buildSha",
    repoPath: "work/PROJ",
    trunkRef: "origin/main",
    triggerPaths: triggerPaths === undefined ? ["src/app"] : triggerPaths,
    staleCommits: 1,
  }));

  // the curl shim
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const body = healthBody !== undefined
    ? healthBody
    : JSON.stringify({ buildSha: shaPicker({ c1, c2, c3 }) });
  fs.writeFileSync(path.join(bin, "curl"),
    `#!/bin/sh\ncat <<'EOF'\n${body}\nEOF\n`, { mode: 0o755 });

  return { root, repo, c1, c2, c3, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } };
}

function run(s) {
  return JSON.parse(sh("node", [TOOL, "--project", "PROJ", "--repo-root", s.root, "--json"],
    s.root, s.env));
}

test("stale AND deployable: the DEF-ROC-086 condition is reported as such", () => {
  const s = scaffold({ shaPicker: ({ c1 }) => c1 });
  const r = run(s);
  assert.strictEqual(r.verdict, "stale");
  assert.strictEqual(r.behind, 2, "c2 + c3 are behind");
  assert.strictEqual(r.deployableChangesBehind, true,
    "c3 touches src/app, so undelivered deployable work IS sitting on trunk");
});

test("stale but NOT deployable: docs-only drift is not a dark deploy", () => {
  // Deployed at c2's parent would be stale-and-deployable; deployed AT c3 with a
  // later docs commit is the case that must NOT read as a dark deploy.
  const s = scaffold({ shaPicker: ({ c3 }) => c3 });
  const g = (...a) => sh("git", ["-C", s.repo, ...a]);
  fs.writeFileSync(path.join(s.repo, "NOTES.md"), "later docs");
  g("add", "-A"); g("commit", "-qm", "c4 docs");
  g("update-ref", "refs/remotes/origin/main", "HEAD");
  const r = run(s);
  assert.strictEqual(r.verdict, "stale");
  assert.strictEqual(r.behind, 1);
  assert.strictEqual(r.deployableChangesBehind, false,
    "only a docs commit is behind — expected drift, not undelivered work");
});

test("current: deployed == trunk", () => {
  const s = scaffold({ shaPicker: ({ c3 }) => c3 });
  const r = run(s);
  assert.strictEqual(r.verdict, "current");
  assert.strictEqual(r.behind, 0);
});

test("a sha the repo never saw is NOT ESTABLISHED, never 'stale'", () => {
  // The real case: a deploy from a branch, a fork, or rewritten history. Calling
  // that "stale" would invent a comparison the repo cannot make.
  const s = scaffold({ healthBody: JSON.stringify({ buildSha: "0".repeat(40) }) });
  const r = run(s);
  assert.strictEqual(r.verdict, "NOT-ESTABLISHED");
  assert.strictEqual(r.reason, "deployed-sha-unknown-to-repo");
});

test("a response with no sha field is NOT ESTABLISHED, and names the keys it did see", () => {
  const s = scaffold({ healthBody: JSON.stringify({ ok: true, other: 1 }) });
  const r = run(s);
  assert.strictEqual(r.verdict, "NOT-ESTABLISHED");
  assert.strictEqual(r.reason, "no-sha-field");
  assert.match(r.detail, /ok/);
});

test("a non-JSON response is NOT ESTABLISHED, not a crash", () => {
  // An App Service serving its "Unavailable" HTML page is the observed real case.
  const s = scaffold({ healthBody: "<!DOCTYPE html><html>Web App - Unavailable</html>" });
  const r = run(s);
  assert.strictEqual(r.verdict, "NOT-ESTABLISHED");
  assert.strictEqual(r.reason, "host-not-json");
});

test("a missing config is NOT ESTABLISHED — an unconfigured project is not a current one", () => {
  const s = scaffold({ shaPicker: ({ c3 }) => c3 });
  fs.rmSync(path.join(s.root, ".claude", "config", "deploy-staleness", "PROJ.json"));
  const r = run(s);
  assert.strictEqual(r.verdict, "NOT-ESTABLISHED");
  assert.strictEqual(r.reason, "no-config");
});

test("exits 0 in every case — severity is the caller's decision, not an exit code", () => {
  // A probe that exits non-zero on "not established yet" is a BROKEN predicate,
  // not an honest one (work-items SKILL.md, "Shipped but UNPROVEN").
  const s = scaffold({ healthBody: "not json at all" });
  const outp = execFileSync("node", [TOOL, "--project", "PROJ", "--repo-root", s.root, "--json"],
    { cwd: s.root, env: s.env, encoding: "utf8" });
  assert.match(outp, /NOT-ESTABLISHED/);
});

test("no triggerPaths configured leaves the deployable subset UNKNOWN, never false", () => {
  const s = scaffold({ triggerPaths: [], shaPicker: ({ c1 }) => c1 });
  const r = run(s);
  assert.strictEqual(r.verdict, "stale");
  assert.strictEqual(r.deployableChangesBehind, null,
    "unconfigured must be unknown — reporting false would claim nothing is missing");
});
