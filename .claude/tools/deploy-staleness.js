#!/usr/bin/env node
/**
 * deploy-staleness — is the DEPLOYED artifact the one on trunk?
 *
 * WHY THIS EXISTS (ROC retro 2026-08-24, DEF-ROC-086/087). ROC's only
 * environment went THREE PUSHES without receiving a deploy, and nothing said so.
 * The chain: a CI test job failed, `deploy-test` declares `needs:` on it, so the
 * deploy was **SKIPPED — not failed**. A skipped job renders as a neutral dash
 * and contributes nothing to the run's conclusion, so the run read "a test
 * broke" when the consequence was "the environment is now N commits stale".
 *
 * THE ROOT CAUSE IS IN THE METRIC, NOT THE WORKFLOW, and it is why this tool is
 * a gate check rather than a note in a runbook. Deployment frequency is a fold
 * over ITEM EVENTS — an item entering `deploying` — which is an INTENTION an
 * agent recorded. A push that never deploys emits no event at all, so the one
 * DORA metric whose subject is the outside world is computed from statements
 * about our own intentions. Through the entire dark period ROC's deployment
 * frequency read 6.57/active-day. The metric that should have screamed was
 * structurally incapable of noticing.
 *
 * That is this project's standing absence-vs-ignorance family (eleven registered
 * instances) applied to the measurement layer: "no deploy event" was read as
 * "nothing to deploy" when it meant "we have no idea".
 *
 * So this asks the DEPLOYED HOST what it is running and compares that to trunk.
 * It is the same discipline DEF-ROC-008 taught: ask the deployed app about
 * itself, never our own side of the relationship.
 *
 * ADVISORY BY DESIGN, never blocking. A gate blocks only on harm that stopping
 * relieves; refusing to pull work does not un-stale an environment, it just adds
 * a second problem. So a stale deploy is reported loudly and the loop keeps
 * moving.
 *
 * THREE OUTCOMES, NOT TWO. `current` / `stale` are measurements. Anything that
 * prevented the comparison — no config, unreachable host, unparseable payload,
 * a sha the repo has never heard of — is NOT-ESTABLISHED and says so. An
 * unanswerable question must never render as a clean answer; that is the exact
 * mistake this tool exists to correct.
 *
 * Usage:  node deploy-staleness.js --project ROC --repo-root <path> --json
 * Config: .claude/config/deploy-staleness/<PROJECT>.json
 *   {
 *     "healthUrl":   "https://host/api/health",
 *     "shaField":    "buildSha",          // key in the JSON response
 *     "repoPath":    "work/ROC",          // repo whose trunk we compare against
 *     "trunkRef":    "origin/main",
 *     "triggerPaths": ["src/app", "src/dashboard"],
 *     "insecureTls": true,                // self-signed cert (ROC's is)
 *     "staleCommits": 1,                  // report at or above this many behind
 *     "timeoutMs":   20000
 *   }
 */
"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PROJECT = arg("project");
const REPO_ROOT = path.resolve(arg("repo-root", process.cwd()));

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
  process.exit(0); // never non-zero: the caller decides severity
}

function notEstablished(reason, detail) {
  out({ verdict: "NOT-ESTABLISHED", project: PROJECT, reason, detail: detail || null });
}

if (!PROJECT) notEstablished("no-project", "--project is required");

// ---- config ---------------------------------------------------------------
const cfgPath = path.join(REPO_ROOT, ".claude", "config", "deploy-staleness", `${PROJECT}.json`);
let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
} catch (e) {
  notEstablished("no-config", `${cfgPath} is missing or unreadable (${e.code || e.message})`);
}
for (const k of ["healthUrl", "shaField", "repoPath"]) {
  if (!cfg[k]) notEstablished("config-incomplete", `"${k}" is required in ${cfgPath}`);
}
const trunkRef = cfg.trunkRef || "origin/main";
const staleCommits = Number.isInteger(cfg.staleCommits) ? cfg.staleCommits : 1;
const timeoutMs = cfg.timeoutMs || 20000;
const repoDir = path.resolve(REPO_ROOT, cfg.repoPath);

// ---- what is DEPLOYED ------------------------------------------------------
// curl rather than fetch: the target may present a self-signed cert (ROC's does,
// which is why every documented curl against it carries -k) and `-k` is the one
// switch that expresses that without disabling TLS process-wide.
let deployedSha;
try {
  const curlArgs = ["-s", "--max-time", String(Math.ceil(timeoutMs / 1000))];
  if (cfg.insecureTls) curlArgs.push("-k");
  curlArgs.push(cfg.healthUrl);
  const body = execFileSync("curl", curlArgs, { encoding: "utf8", timeout: timeoutMs + 5000 });
  if (!body.trim()) notEstablished("host-empty-response", `${cfg.healthUrl} returned no body`);
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    notEstablished("host-not-json",
      `${cfg.healthUrl} did not return JSON (first 160 chars: ${body.slice(0, 160).replace(/\s+/g, " ")})`);
  }
  deployedSha = json[cfg.shaField];
  if (!deployedSha || typeof deployedSha !== "string") {
    notEstablished("no-sha-field",
      `the response carried no usable "${cfg.shaField}" (keys: ${Object.keys(json).join(", ")})`);
  }
} catch (e) {
  notEstablished("host-unreachable", `${cfg.healthUrl}: ${String(e.message).slice(0, 200)}`);
}

// ---- what is on TRUNK -----------------------------------------------------
function git(...args) {
  return execFileSync("git", ["-C", repoDir, ...args], { encoding: "utf8" }).trim();
}

let trunkSha;
try {
  trunkSha = git("rev-parse", trunkRef);
} catch (e) {
  notEstablished("no-trunk-ref",
    `cannot resolve ${trunkRef} in ${cfg.repoPath} (${String(e.message).slice(0, 160)})`);
}

// A sha the repo has never seen is NOT "stale" — it is unknown, and saying
// "stale" would be inventing a comparison we cannot make. This is the real case
// where a deploy came from a branch, a fork, or a since-rewritten history.
try {
  git("cat-file", "-e", `${deployedSha}^{commit}`);
} catch {
  notEstablished("deployed-sha-unknown-to-repo",
    `the host reports ${deployedSha.slice(0, 12)} but ${cfg.repoPath} has no such commit — ` +
    `it may be from another branch, a fork, or rewritten history`);
}

// ---- the comparison -------------------------------------------------------
const behind = Number(git("rev-list", "--count", `${deployedSha}..${trunkSha}`));
const ahead = Number(git("rev-list", "--count", `${trunkSha}..${deployedSha}`));

// Only commits that touch a TRIGGER path can ever produce a deploy, so counting
// raw commits would cry stale over a README. Reported alongside the raw count
// rather than instead of it: the raw number is what "the environment is behind
// trunk" honestly means, and the deployable subset is what is ACTIONABLE.
let deployable = null;
if (Array.isArray(cfg.triggerPaths) && cfg.triggerPaths.length && behind > 0) {
  try {
    const names = git("diff", "--name-only", deployedSha, trunkSha)
      .split("\n").map((s) => s.trim()).filter(Boolean);
    deployable = names.some((n) => cfg.triggerPaths.some((p) => n === p || n.startsWith(`${p}/`)));
  } catch {
    deployable = null; // unknown, not false
  }
}

let deployedAgeS = null;
try {
  deployedAgeS = Math.max(0, Math.floor(Date.now() / 1000) - Number(git("show", "-s", "--format=%ct", deployedSha)));
} catch { /* age is a nicety; its absence is not a failure */ }

out({
  verdict: behind >= staleCommits ? "stale" : "current",
  project: PROJECT,
  healthUrl: cfg.healthUrl,
  deployedSha,
  trunkSha,
  trunkRef,
  behind,
  ahead,
  deployableChangesBehind: deployable,
  deployedAgeS,
  staleCommits,
});
