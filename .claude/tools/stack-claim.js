#!/usr/bin/env node
'use strict';
/**
 * stack-claim.js — DEF-ROC-062. The LEASE WRITER `container-reap.js` has always
 * expected but that NO project ever supplied.
 *
 * WHY THIS EXISTS. `container-reap.js` reads a lease at `<leaseDir>/<container>.lease`
 * — a bare epoch expiry — and treats a VALID lease as an absolute veto whatever the
 * container's age. Without a writer, the reaper's only signal is age, and age cannot
 * distinguish "in active use" from "abandoned": at 2026-08-19T15:41Z the ROC reaper
 * destroyed FOUR RUNNING containers (`4 owned, 4 running`) mid-validation, because
 * the stack had simply been up longer than `leaseTtlS` — a genuinely long-lived,
 * actively-used stack is indistinguishable from an orphan without a claim (see
 * DEF-ROC-062, both amendments). Raising `leaseTtlS` does not fix this; it only
 * widens the window in which a genuinely orphaned wave accumulates (thirteen leaked
 * containers once drove load average to 19.85 and a two-file test run from 877ms to
 * 301s — DEFECT-OAG-091). The cure is the CLAIM: an explicit, machine-local,
 * TTL-bounded fact that a specific set of containers is in use right now.
 *
 * THE MECHANISM, one lease per owned RUNNING container:
 *   - `claim`   enumerates containers currently owned by the project (same
 *               provenance predicate container-reap.js uses — the compose
 *               config-file label, never a name list) and RUNNING, and writes/
 *               renews a `<name>.lease` for each via container-reap.js's own
 *               `writeLease` — the SAME file the reaper already reads, so no
 *               change to the reaper was needed. It also writes a project-level
 *               `<project>.claim.json` marker (who, when, until, which
 *               containers) purely for VISIBILITY — `make stack-status` or a
 *               bare `cat` tells another agent the stack is in use without
 *               them needing to know container names or run docker themselves.
 *   - `release` deletes those lease files + the marker (teardown path).
 *   - `status`  reports the marker + live lease validity per container.
 * TTL means a dead agent's claim simply EXPIRES — nothing deadlocks. RENEW is
 * just calling `claim` again: the clock restarts from the last observed sign of
 * life, exactly OagEventSource's `ddb-local-assert-ours` precedent (renewed at
 * every gated test tier), not from when the stack was first brought up.
 *
 * IDENTITY IS ADVISORY, NOT LOAD-BEARING FOR THE VETO. The reaper's veto only
 * needs a valid lease to exist — it does not care who wrote it. `label` exists
 * so two agents sharing this machine can tell each other apart in `status`
 * output and so a genuine second claimant is refused (see CONFLICT below)
 * rather than silently overwriting the first. Because a fresh CLI invocation is
 * a fresh OS process (no stable pid across an agent's own claim/renew/release
 * calls), the default label is deliberately PROCESS-INDEPENDENT
 * (`user@host`, no pid) so a lone operator's own renewals never self-conflict;
 * a dispatch that wants real mutual exclusion from a sibling agent passes an
 * explicit `--label` (e.g. the work-item id) consistently across its own
 * claim/renew/release calls.
 *
 * CONFLICT is a courtesy, not a hard lock: if a DIFFERENT label holds a
 * currently-valid claim, `claim`/`release` refuse (exit 2) unless `--force`.
 * Scheduling exclusivity itself remains the orchestrator's job (DEF-ROC-062
 * note 4) — this only makes that exclusivity CHECKABLE instead of assumed.
 *
 * Usage:
 *   node .claude/tools/stack-claim.js claim   --project P [--ttl S] [--label L] [--force] [--json]
 *   node .claude/tools/stack-claim.js release --project P [--label L] [--force] [--json]
 *   node .claude/tools/stack-claim.js status  --project P [--json]
 * Test-only injection: [--now <epoch|ISO>] [--lease-dir DIR] [--config FILE] [--repo-root R]
 *
 * Exit: 0 = claimed/released/nothing-to-claim/status | 1 = usage/config/docker error
 *       | 2 = CONFLICT (another label holds a valid claim; retry with --force)
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const reap = require('./container-reap.js');

const REPO_ROOT_DEFAULT = path.resolve(__dirname, '..', '..');
// Renew cadence mirrors OagEventSource's ddb-local-assert-ours precedent: long
// enough to outlast any gated tier, short enough that a dead agent's claim clears
// well inside a session rather than lingering for the old 4h age-only workaround.
const DEFAULT_TTL_S = 3600;

function defaultLabel() {
  return process.env.STACK_CLAIM_LABEL || `${os.userInfo().username}@${os.hostname()}`;
}

function claimFile(project, dir) {
  return path.join(dir, `${project}.claim.json`);
}

function readClaim(project, dir) {
  try { return JSON.parse(fs.readFileSync(claimFile(project, dir), 'utf8')); }
  catch { return null; }
}

function writeClaimFile(project, dir, record) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(claimFile(project, dir), `${JSON.stringify(record, null, 2)}\n`);
}

function deleteClaimFile(project, dir) {
  try { fs.unlinkSync(claimFile(project, dir)); return true; } catch { return false; }
}

/** Same provenance predicate the reaper uses — never a container-name list. */
function ownedContainers(project, repoRoot, configFile) {
  const config = reap.readConfig(project, repoRoot, configFile);
  if (!config.configured) {
    return { config, containers: null, err: `no container-reap config for ${project} (${config.file})` };
  }
  const cRes = reap.dockerContainers();
  if (!cRes.ok) return { config, containers: null, err: `docker unavailable: ${cRes.err}` };
  const owned = cRes.rows.filter((c) => reap.ownsContainer(c, config).owned);
  return { config, containers: owned, err: null };
}

function claim({ project, repoRoot = REPO_ROOT_DEFAULT, configFile = null,
  leaseDir = reap.leaseDirDefault(), ttl = DEFAULT_TTL_S, label = defaultLabel(),
  force = false, now = Math.floor(Date.now() / 1000) }) {
  const { containers, err } = ownedContainers(project, repoRoot, configFile);
  if (err) return { ok: false, verdict: 'ERROR', message: err, claimed: [] };

  const running = containers.filter((c) => c.running);
  if (!running.length) {
    return {
      ok: true, verdict: 'NOTHING-TO-CLAIM', claimed: [],
      message: `no running ${project} containers found — nothing claimed `
        + '(bring the stack up first)',
    };
  }

  const existing = readClaim(project, leaseDir);
  const existingValid = !!existing && Number(existing.expiresAt) > now;
  if (existingValid && existing.label !== label && !force) {
    return {
      ok: false, verdict: 'CONFLICT', claimed: [],
      message: `${project} stack already claimed by "${existing.label}" until `
        + `${new Date(existing.expiresAt * 1000).toISOString()} — pass --force to override`,
    };
  }

  const names = running.map((c) => c.name);
  const expiresAt = now + Number(ttl);
  for (const name of names) reap.writeLease(name, ttl, leaseDir, now);
  const record = {
    project, label, pid: process.pid, host: os.hostname(),
    claimedAt: now, expiresAt, ttlS: Number(ttl), containers: names,
  };
  writeClaimFile(project, leaseDir, record);
  reap.journal(leaseDir, [`CLAIMED stack ${project} by ${label} ttl=${ttl}s `
    + `containers=${names.join(',')}`]);
  return {
    ok: true, verdict: 'CLAIMED', claimed: names, record,
    message: `claimed ${names.length} container(s) for ${project} until `
      + `${new Date(expiresAt * 1000).toISOString()}`,
  };
}

function release({ project, leaseDir = reap.leaseDirDefault(),
  label = defaultLabel(), force = false }) {
  const existing = readClaim(project, leaseDir);
  if (!existing) {
    return {
      ok: true, verdict: 'NOTHING-TO-RELEASE', released: [],
      message: `no active claim for ${project} — nothing to release`,
    };
  }
  if (existing.label !== label && !force) {
    return {
      ok: false, verdict: 'CONFLICT', released: [],
      message: `${project} stack is claimed by "${existing.label}", not "${label}" `
        + '— pass --force',
    };
  }
  const names = existing.containers || [];
  for (const name of names) reap.releaseLease(name, leaseDir);
  deleteClaimFile(project, leaseDir);
  reap.journal(leaseDir, [`RELEASED stack ${project} by ${label} `
    + `containers=${names.join(',')}`]);
  return {
    ok: true, verdict: 'RELEASED', released: names,
    message: `released ${names.length} container lease(s) for ${project}`,
  };
}

function status({ project, repoRoot = REPO_ROOT_DEFAULT, configFile = null,
  leaseDir = reap.leaseDirDefault(), now = Math.floor(Date.now() / 1000) }) {
  const existing = readClaim(project, leaseDir);
  const claimValid = !!existing && Number(existing.expiresAt) > now;
  const { containers, err } = ownedContainers(project, repoRoot, configFile);
  const leases = reap.readLeases(leaseDir);
  const rows = (containers || []).map((c) => {
    const exp = leases.get(c.name);
    return {
      name: c.name, running: c.running,
      leaseValid: Number.isFinite(exp) && exp > now,
      leaseRemainingS: Number.isFinite(exp) ? Math.round(exp - now) : null,
    };
  });
  return {
    ok: true, verdict: err ? 'DOCKER-UNAVAILABLE' : 'OK', message: err || null,
    project, claim: existing, claimValid, containers: rows,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--json') a.json = true;
    else if (t === '--force') a.force = true;
    else if (t === '--project') a.project = argv[++i];
    else if (t === '--repo-root') a.repoRoot = argv[++i];
    else if (t === '--config') a.configFile = argv[++i];
    else if (t === '--lease-dir') a.leaseDir = argv[++i];
    else if (t === '--ttl') a.ttl = Number(argv[++i]);
    else if (t === '--label') a.label = argv[++i];
    else if (t === '--now') a.now = argv[++i];
    else a._.push(t);
  }
  return a;
}

function parseNow(v) {
  if (v == null) return null;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t / 1000 : null;
}

function humanReport(cmd, r) {
  const lines = [`stack-claim[${cmd}]: ${r.verdict} — ${r.message || ''}`];
  if (cmd === 'status' && r.claim) {
    lines.push(`  claimed by "${r.claim.label}" at ${new Date(r.claim.claimedAt * 1000).toISOString()}, `
      + `${r.claimValid ? 'VALID' : 'EXPIRED'} until ${new Date(r.claim.expiresAt * 1000).toISOString()}`);
  }
  if (cmd === 'status') {
    for (const c of r.containers) {
      lines.push(`  ${c.name} running=${c.running} lease=${c.leaseValid ? 'valid' : 'invalid'} `
        + `remaining=${c.leaseRemainingS ?? 'none'}s`);
    }
  }
  return lines.join('\n');
}

function main(argv = process.argv.slice(2)) {
  const a = parseArgs(argv);
  const cmd = a._[0];
  if (!['claim', 'release', 'status'].includes(cmd)) {
    console.error('usage: stack-claim.js claim|release|status --project P '
      + '[--ttl S] [--label L] [--force] [--json]');
    return 1;
  }
  if (!a.project) { console.error('stack-claim: --project required'); return 1; }

  const now = parseNow(a.now) ?? Math.floor(Date.now() / 1000);
  const common = {
    project: a.project, repoRoot: a.repoRoot || REPO_ROOT_DEFAULT,
    configFile: a.configFile, leaseDir: a.leaseDir || reap.leaseDirDefault(), now,
  };

  let result;
  if (cmd === 'claim') {
    result = claim({ ...common, ttl: Number.isFinite(a.ttl) ? a.ttl : DEFAULT_TTL_S,
      label: a.label || defaultLabel(), force: !!a.force });
  } else if (cmd === 'release') {
    result = release({ ...common, label: a.label || defaultLabel(), force: !!a.force });
  } else {
    result = status(common);
  }

  console.log(a.json ? JSON.stringify(result, null, 2) : humanReport(cmd, result));
  if (result.verdict === 'ERROR') return 1;
  if (result.verdict === 'CONFLICT') return 2;
  return 0;
}

module.exports = {
  DEFAULT_TTL_S, defaultLabel, claimFile, readClaim, writeClaimFile, deleteClaimFile,
  ownedContainers, claim, release, status, main,
};

// Set `exitCode`, never a synchronous exit on main's return value (truncates stdout
// past the 64 KiB pipe buffer). Named by the .claude/tools sweep, AC-DEFECT-OAG-076.5.
if (require.main === module) process.exitCode = main();
