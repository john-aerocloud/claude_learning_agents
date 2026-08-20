#!/usr/bin/env node
'use strict';
/**
 * container-reap.js — DEFECT-OAG-091. A REAPER for per-dispatch local containers.
 *
 * WHY THIS EXISTS. `EXP-133` (v137) correctly diagnosed that a SHARED DynamoDB Local
 * container was the exposure — `docker compose up -d` on a different port recreated
 * the ONE container under another engineer's in-flight suite, whose tests then failed
 * with a connection error indistinguishable from a code failure — and gave every
 * dispatch its own container with a DERIVED name and port. That part works. But it
 * moved the cost from COLLISION to ACCUMULATION and shipped no reaper: the Makefile
 * has `ddb-local-up`, `-down`, `-mine`, `-assert-ours`, `-create-table`, and NOTHING
 * that removes a container whose dispatch is gone. `ddb-local-down` is per-dispatch
 * and must be called by the agent that created the container, so any agent that dies,
 * stalls or forgets leaks its container FOREVER — and dying is common here.
 *
 * Measured 2026-08-10T23:31Z, with no agent having run for two days:
 *
 *     load averages: 19.85 18.46 16.18
 *     19 containers running, 13 of them OAG DynamoDB Local (ten of them 2 DAYS old)
 *
 * A two-file test run took 301 SECONDS. After reaping, 877 MILLISECONDS — 340x. Four
 * consecutive agent deaths immediately preceded the measurement and had all been
 * attributed to agent-side causes; the cause was the machine. The worse harm is
 * evidential: engineers reported reds that were green in isolation, and one misread
 * file ownership under load badly enough to nearly revert another agent's
 * uncommitted work.
 *
 * The parent repo already learned this lesson for worktrees (`worktree-reap`). The
 * same shape of tool was never built for containers. Cleanup was left to agent
 * discipline, and agent discipline is exactly what a dying agent does not have.
 *
 * ---------------------------------------------------------------------------------
 * THE LIVENESS RULE, AND ITS FALSE-POSITIVE RISK (AC-091.2)
 * ---------------------------------------------------------------------------------
 * Liveness is DERIVED, never a hardcoded name list — a name list cannot know whether
 * a dispatch is alive, and this machine routinely runs several Claude INSTANCES over
 * the same project from different worktrees (§0a).
 *
 * A container is reapable only if ALL of these hold. Every one of them fails SAFE
 * toward KEEPING, because the cost of a wrong keep is one idle container and the cost
 * of a wrong reap is somebody's in-flight suite:
 *
 *   1. OWNED     — its `com.docker.compose.project.config_files` label resolves to a
 *                  path ENDING WITH the project's declared compose file
 *                  (`work/<project>/src/app/local/docker-compose.yml`). A PROVENANCE
 *                  predicate, not a name: it admits every worktree/instance of THIS
 *                  project and structurally excludes every other project. No compose
 *                  label at all (`viggo-sql`, buildx) => never owned.
 *   2. OLD ENOUGH— age > `minAgeS` (default 300s). Closes the start/reap race: a
 *                  container created seconds ago, before its lease was written, is
 *                  immune.
 *   3. UNLEASED  — no VALID lease. A lease is a machine-local file
 *                  `<leaseDir>/<container>.lease` holding a bare epoch expiry,
 *                  written by the project's OWN Makefile at `ddb-local-up` and
 *                  RENEWED at every `ddb-local-assert-ours` (i.e. at the entry of
 *                  every gated test tier). A valid lease is an absolute veto,
 *                  whatever the age. The lease dir is machine-local and SHARED
 *                  across worktrees, so one instance's lease protects it from
 *                  another instance's reaper.
 *   4. NOT IN USE— no ESTABLISHED TCP connection on any published host port. This is
 *                  the mid-write guard (AC-091.5 fault 1) and it needs no discipline
 *                  at all.
 *   5. PAST GRACE— a container with NO lease file whatsoever additionally needs
 *                  age > `leaseTtlS`. So a failed lease write, or a container started
 *                  by hand, still gets a full TTL before anything touches it.
 *
 * FALSE-POSITIVE RISK, stated honestly. The exposure is a single UNINTERRUPTED tier
 * invocation that runs longer than `leaseTtlS` (3600s) while holding no TCP
 * connection at the moment of the sweep. Its container is removed and the suite then
 * fails with a connection error — which, per EXP-133's own note, reads as a CODE
 * failure and is the worst kind of phantom. Four things bound it:
 *   (a) the clock restarts at the LAST gated-target entry, not at container creation,
 *       so the threshold is measured from the last observed sign of life;
 *   (b) 3600s is ~12x the WORST run ever measured here (301s, itself under the load
 *       this defect caused) and longer than most whole dispatches — the stall
 *       watchdog kills an agent at 600s of silence;
 *   (c) a run that legitimately needs longer declares it —
 *       `OAG_DDB_LEASE_TTL_S=14400 make -C work/OagEventSource ddb-local-up`;
 *   (d) every removal is APPENDED TO A JOURNAL (`<leaseDir>/reap-journal.log`) and
 *       `ddb-local-assert-ours` reads it, so the phantom is diagnosable in one line
 *       instead of being debugged as a code fault. Recovery is `ddb-local-mine`
 *       again; the container holds only per-run namespaced test tables (`-inMemory`),
 *       so nothing durable is ever lost.
 * The threshold is therefore a declared MAX DISPATCH LIFETIME with an escape hatch,
 * not a round number: `.claude/config/container-reap/<project>.json` states it, and
 * changing it is a visible, reviewed edit.
 *
 * NETWORKS ARE REAPED TOO, and that limb exists because of what the capture showed:
 * the manual 23:32Z mitigation removed 13 containers and left NINETEEN
 * `oag-dynamodb-local-*_default` compose networks behind. `docker rm` does not remove
 * a compose network; only `docker compose down` does, which is exactly the call a
 * dead agent never makes. Docker's default bridge pool is finite, so this accumulates
 * to "could not find an available, non-overlapping IPv4 address pool" — a different
 * and more total failure than load. A network is reapable only if its
 * `com.docker.compose.project` label matches the project's declared pattern, it has
 * ZERO attached endpoints, NO container in ANY state carries that compose project,
 * and it is older than `minAgeS`.
 *
 * A DELIBERATE ASYMMETRY between the two, discovered from the capture and kept. A
 * network can only be attributed by its compose PROJECT NAME (networks carry no
 * config-file label), so the network limb needs an unambiguous pattern — and OAG's
 * PRE-EXP-133 objects were created without `-p`, so compose defaulted their project
 * to the DIRECTORY name, `local`. The exited legacy container is still reaped (its
 * config-file label is unambiguous provenance) but `local_default` is left alone
 * forever, because "local" is a name any project with a `local/` directory would
 * produce and claiming it would be exactly the over-reach AC-091.5 forbids. One
 * stranded legacy network is the right price for that.
 *
 * SIDE-EFFECT SCOPE: `docker rm -f` / `docker network rm`, and append-only writes
 * under the machine-local lease dir. It NEVER touches the working tree — no git, no
 * repo file, no project file (AC-091.4). No network, no credentials.
 *
 * ---------------------------------------------------------------------------------
 * GENERALISATION SWEEP LEDGER (§17g, v138) — DEFECT-OAG-091, 2026-08-11
 * ---------------------------------------------------------------------------------
 * THE FAULT CLASS, stated as a shape rather than a symptom: **a resource created
 * PER DISPATCH whose cleanup depends on the agent that created it calling a teardown
 * command.** Ask that question, not "are there stray containers", because an agent
 * that dies is precisely the one that will not call the teardown — and dying is
 * common here. Every site in the system, declared fixed or not-applicable-because:
 *
 *   1. per-dispatch DynamoDB Local CONTAINER (`ddb-local-mine`)
 *      => FIXED. This tool + loop-gate check 8 + the lease.
 *   2. per-dispatch COMPOSE NETWORK (`<project>_default`)
 *      => FIXED, and FOUND BY THIS SWEEP, not by the report. `docker rm` does not
 *         remove a compose network; only `compose down` does, so the manual
 *         mitigation of 13 containers left NINETEEN networks behind (ages to 3.1
 *         days) that nobody had noticed. Its failure mode is worse than load: it
 *         exhausts docker's finite bridge address pool.
 *   3. per-dispatch LEASE FILE
 *      => FIXED. `pruneLeases` drops a lease whose container is gone, and
 *         `ddb-local-down` releases it on the tidy path.
 *   4. per-dispatch GIT WORKTREE
 *      => ALREADY FIXED, by the sibling of this defect: `worktree-reap` +
 *         `worktree-guard` + loop-gate check 7 (DEFECT-OAG-076). The item's own
 *         provenance names it: "the parent repo already learned this lesson for
 *         worktrees; the same shape of tool was never built for containers."
 *   5. per-run DynamoDB TABLES (`OagFeed-EventStore-PortContract-<runid>-N`, 15
 *      observed in one container)
 *      => NOT APPLICABLE. The container runs `-inMemory`, so the tables die with it.
 *         Reaping the container IS reaping the tables.
 *   6. per-run TEMP DIRS in the test harnesses
 *      => NOT APPLICABLE. Removed in `finally`, and under the OS temp dir, which the
 *         OS reclaims.
 *   7. per-run EPHEMERAL AWS resources from probes
 *      => NOT APPLICABLE HERE. OAG's probes write only to a `PROBE#` partition and
 *         clean up; the cross-project rule that a probe must decide pass/fail AFTER
 *         cleanup (never `process.exit()` inside a `try`) already covers the shape.
 *   8. ORPHANED REMOTE BRANCHES
 *      => SAME SHAPE, ALREADY REGISTERED as OI-ORPHANED-REMOTE-BRANCHES. Not
 *         widened into this fix.
 *   9. long-lived AGENT-STARTED HOST PROCESSES (a dev server, a signing proxy)
 *      => NOT FIXED — REAL AND OPEN, found by this sweep. A ROC vite dev server has
 *         been running for **11 DAYS 15 HOURS** (pid 9762, from a
 *         ROC-worktree agent long gone). Identical shape, different resource, and
 *         NOT reapable by this tool: it belongs to ANOTHER PROJECT, and killing it
 *         would be exactly the over-reach AC-091.5 forbids. Flagged for its own item
 *         rather than silently widened.
 *  10. DANGLING DOCKER VOLUMES / IMAGE LAYERS
 *      => NOT FIXED — REAL AND OPEN, found by this sweep. **1,205 of 1,214 volumes
 *         are dangling**; `docker system df` reports 8.16GB (70%) of images
 *         reclaimable. Same accumulation class, but machine-wide and cross-project,
 *         so it is NOT attributable to OAG by any predicate this tool could apply
 *         safely (OAG's compose declares no volumes at all — `-inMemory`). Flagged
 *         for its own item; a `docker volume prune` here would be an unowned,
 *         cross-project destructive act.
 *
 * WHAT THE SWEEP TEACHES, kept because it is the transferable part: entries 2, 9 and
 * 10 were all invisible from the report and all found by asking the SHAPE question
 * once. Entry 4 is the one that should have prevented this defect — the tool already
 * existed for worktrees and nobody generalised it to containers, which is precisely
 * the failure §17g exists to stop.
 *
 * Usage:
 *   node .claude/tools/container-reap.js scan   --project P [--repo-root R] [--json]
 *   node .claude/tools/container-reap.js reap   --project P [--dry-run] [--json]
 *   node .claude/tools/container-reap.js lease  --container NAME [--ttl S]
 *   node .claude/tools/container-reap.js release --container NAME
 * Test-only injection: [--now <epoch|ISO>] [--lease-dir DIR] [--config FILE]
 *
 * Exit: 0 = swept (including nothing to do) | 1 = usage/internal | 2 = a removal
 * FAILED (a real problem worth seeing). NEVER non-zero merely because orphans exist:
 * this is called before every pull and must not block the loop (AC-091.3).
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT_DEFAULT = path.resolve(__dirname, '..', '..');

/** Defaults are DECLARED here and overridable per project; see the header. */
const POLICY_DEFAULTS = Object.freeze({
  leaseTtlS: 3600,   // declared MAX DISPATCH LIFETIME between signs of life
  minAgeS: 300,      // start/reap race floor
});

const LABEL_CONFIG_FILES = 'com.docker.compose.project.config_files';
const LABEL_PROJECT = 'com.docker.compose.project';

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

/**
 * Per-project config, mirroring the test-requirement-gate convention
 * (.claude/config/<tool>/<project>.json). ABSENT is reported as NOT CONFIGURED and
 * never as clean: a project whose local containers were never declared has not been
 * checked, which is not the same as having none (§17c.2).
 */
function readConfig(project, repoRoot = REPO_ROOT_DEFAULT, explicitFile = null) {
  const file = explicitFile || path.join(repoRoot, '.claude', 'config',
    'container-reap', `${project}.json`);
  if (!fs.existsSync(file)) {
    return { configured: false, project, file, errors: [`no config at ${file}`] };
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { configured: false, project, file, errors: [`unparseable: ${e.message}`] };
  }
  const errors = [];
  if (!raw.composeConfigPathSuffix) errors.push('composeConfigPathSuffix missing');
  if (!raw.composeProjectPattern) errors.push('composeProjectPattern missing');
  if (errors.length) return { configured: false, project, file, errors };
  return {
    configured: true, project, file, errors: [],
    composeConfigPathSuffix: String(raw.composeConfigPathSuffix),
    composeProjectPattern: String(raw.composeProjectPattern),
    leaseTtlS: Number(raw.leaseTtlS ?? POLICY_DEFAULTS.leaseTtlS),
    minAgeS: Number(raw.minAgeS ?? POLICY_DEFAULTS.minAgeS),
  };
}

// ---------------------------------------------------------------------------
// leases (this tool only READS them; the project's Makefile is the sole WRITER)
// ---------------------------------------------------------------------------

function leaseDirDefault() {
  return process.env.CONTAINER_LEASE_DIR
    || path.join(os.homedir(), '.claude-container-leases');
}

/**
 * `<name>.lease` holding a bare epoch-seconds expiry. Deliberately the most trivial
 * format there is, because the WRITER is a shell one-liner in the project's own
 * Makefile (`expr $(date +%s) + $TTL > …`) and the project repo must stay standalone
 * — it may not depend on a parent-repo tool path. One writer, one reader, a format
 * with nothing to diverge about.
 *
 * An UNPARSEABLE lease is treated as NO lease, which routes it to the full
 * `leaseTtlS` grace window rather than to an immediate kill.
 */
function readLeases(dir = leaseDirDefault()) {
  const leases = new Map();
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return leases; }
  for (const f of names) {
    if (!f.endsWith('.lease')) continue;
    let txt;
    try { txt = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    const expiry = Number(String(txt).trim().split(/\s+/)[0]);
    if (!Number.isFinite(expiry) || expiry <= 0) continue;
    leases.set(f.slice(0, -'.lease'.length), expiry);
  }
  return leases;
}

/**
 * `now` is test-only injection (DEF-ROC-062 stack-claim.js self-tests), mirroring
 * the same convention `sweep()` already uses — real callers never pass it and get
 * the wall clock, exactly as before.
 */
function writeLease(container, ttlS, dir = leaseDirDefault(),
  now = Math.floor(Date.now() / 1000)) {
  fs.mkdirSync(dir, { recursive: true });
  const expiry = Number(now) + Number(ttlS);
  fs.writeFileSync(path.join(dir, `${container}.lease`), `${expiry}\n`);
  return expiry;
}

function releaseLease(container, dir = leaseDirDefault()) {
  try { fs.unlinkSync(path.join(dir, `${container}.lease`)); return true; }
  catch { return false; }
}

/** Append-only, machine-local, so a phantom connection error is diagnosable. */
function journal(dir, lines) {
  if (!lines.length) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'reap-journal.log'),
      lines.map((l) => `${new Date().toISOString()} ${l}\n`).join(''));
  } catch { /* the journal is diagnostics; never fail a sweep on it */ }
}

/** Drop lease files whose container no longer exists (machine-local housekeeping). */
function pruneLeases(dir, liveNames) {
  const leases = readLeases(dir);
  const pruned = [];
  for (const name of leases.keys()) {
    if (!liveNames.has(name)) { if (releaseLease(name, dir)) pruned.push(name); }
  }
  return pruned;
}

// ---------------------------------------------------------------------------
// docker adapters
// ---------------------------------------------------------------------------

const CONTAINER_FMT = '{"Name":{{json .Name}},"Created":{{json .Created}},'
  + '"Running":{{json .State.Running}},"Status":{{json .State.Status}},'
  + '"Labels":{{json .Config.Labels}},"Ports":{{json .NetworkSettings.Ports}}}';
const NETWORK_FMT = '{"Name":{{json .Name}},"Created":{{json .Created}},'
  + '"Labels":{{json .Labels}},"Attached":{{len .Containers}}}';

function docker(args, timeout = 60000) {
  return spawnSync('docker', args, { encoding: 'utf8', timeout });
}

function normaliseContainer(raw) {
  const ports = [];
  for (const binds of Object.values(raw.Ports || {})) {
    for (const b of binds || []) {
      const p = Number(b.HostPort);
      if (Number.isFinite(p)) ports.push(p);
    }
  }
  return {
    name: String(raw.Name || '').replace(/^\//, ''),
    createdMs: Date.parse(raw.Created),
    running: raw.Running === true,
    status: raw.Status || (raw.Running ? 'running' : 'unknown'),
    labels: raw.Labels || {},
    hostPorts: ports,
  };
}

function normaliseNetwork(raw) {
  return {
    name: String(raw.Name || ''),
    createdMs: Date.parse(raw.Created),
    labels: raw.Labels || {},
    attached: Number(raw.Attached || 0),
  };
}

function inspectAll(kind, fmt, normalise) {
  const ls = kind === 'container'
    ? docker(['ps', '-aq'])
    : docker(['network', 'ls', '-q']);
  if (ls.status !== 0) {
    const err = (ls.stderr || ls.error?.message || 'docker unavailable').trim();
    return { ok: false, err, rows: [] };
  }
  const ids = (ls.stdout || '').trim().split('\n').filter(Boolean);
  if (!ids.length) return { ok: true, err: null, rows: [] };
  const args = kind === 'container'
    ? ['inspect', '--format', fmt, ...ids]
    : ['network', 'inspect', '--format', fmt, ...ids];
  const r = docker(args);
  const rows = [];
  for (const line of (r.stdout || '').trim().split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(normalise(JSON.parse(line))); } catch { /* skip a torn line */ }
  }
  // status !== 0 with rows present just means one id vanished mid-inspect (another
  // reaper, a finishing dispatch). That is normal here, not an error.
  if (r.status !== 0 && !rows.length) {
    return { ok: false, err: (r.stderr || '').trim(), rows: [] };
  }
  return { ok: true, err: null, rows };
}

const dockerContainers = () => inspectAll('container', CONTAINER_FMT, normaliseContainer);
const dockerNetworks = () => inspectAll('network', NETWORK_FMT, normaliseNetwork);

/**
 * The mid-write guard's evidence: which of these host ports currently carries an
 * ESTABLISHED TCP connection. Probed per-candidate-port so it is precise and cheap.
 *
 * If `lsof` is unavailable the veto CANNOT be evaluated. It is not silently treated
 * as satisfied — `available:false` is reported, and every affected row records
 * `inUse: 'unknown'`. The veto is a REFINEMENT over the lease, not the primary
 * control, so an unavailable probe must not disable reaping altogether (that would
 * reinstate the very accumulation this tool exists to stop).
 */
function establishedHostPorts(ports) {
  const busy = new Set();
  if (!ports.length) return { available: true, busy };
  let available = false;
  for (const port of new Set(ports)) {
    const r = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:ESTABLISHED'],
      { encoding: 'utf8', timeout: 15000 });
    // lsof exits 1 for "no matches", which is a successful evaluation.
    if (r.error || r.status === null || r.status > 1) continue;
    available = true;
    if ((r.stdout || '').trim()) busy.add(port);
  }
  return { available, busy };
}

/**
 * IDEMPOTENT / RACE-SAFE (AC-091.5 fault 3): two instances sweeping concurrently
 * compute the same list, one `rm` wins, and the loser must treat "No such container"
 * as the SUCCESSFUL outcome.
 *
 * MEASURED, not assumed (v110): `docker rm -f <absent>` on this machine's Docker
 * (server 28.x) exits **0** and writes "No such container" to STDERR — it does NOT
 * exit non-zero as one would expect. Both shapes are handled, because keying only on
 * the exit status would have silently mis-reported `alreadyGone` and keying only on
 * the text would break on a docker that exits 1.
 */
function removeContainer(name) {
  const r = docker(['rm', '-f', name]);
  const err = (r.stderr || '').trim();
  const gone = /No such container|is already in progress|removal of container/i.test(err);
  if (r.status === 0) return { ok: true, alreadyGone: gone, err: gone ? err : null };
  if (gone) return { ok: true, alreadyGone: true, err };
  return { ok: false, alreadyGone: false, err };
}

function removeNetwork(name) {
  const r = docker(['network', 'rm', name]);
  if (r.status === 0) return { ok: true, alreadyGone: false, err: null };
  const err = (r.stderr || '').trim();
  if (/not found|No such network/i.test(err)) {
    return { ok: true, alreadyGone: true, err };
  }
  return { ok: false, alreadyGone: false, err };
}

// ---------------------------------------------------------------------------
// the classifier — PURE, so every fault case is a unit test
// ---------------------------------------------------------------------------

/**
 * OWNERSHIP IS PROVENANCE, NOT A NAME. The compose config-file label records the
 * absolute path of the compose file the container was started from. A path-SUFFIX
 * match on `work/<project>/…/docker-compose.yml` therefore:
 *   - admits every worktree and every Claude instance of THIS project (their
 *     absolute prefixes differ; the suffix does not), so a sibling instance's
 *     orphans are reclaimable rather than immortal; and
 *   - structurally excludes every other project (`work/AdixOut/…`, `work/ROC/…`)
 *     and everything with no compose label at all.
 * The label may hold a comma-separated LIST of compose files; any entry matching is
 * enough.
 */
function ownsContainer(container, config) {
  const raw = container.labels[LABEL_CONFIG_FILES];
  if (!raw) return { owned: false, why: 'no-compose-label' };
  const suffix = config.composeConfigPathSuffix.replace(/\\/g, '/');
  const paths = String(raw).split(',').map((p) => p.trim().replace(/\\/g, '/'));
  const hit = paths.some((p) => p === suffix || p.endsWith(`/${suffix}`));
  return hit ? { owned: true, why: null } : { owned: false, why: 'other-project' };
}

function classifyContainers({ containers, leases, established, now, config }) {
  const ttl = config.leaseTtlS ?? POLICY_DEFAULTS.leaseTtlS;
  const minAge = config.minAgeS ?? POLICY_DEFAULTS.minAgeS;
  return containers.map((c) => {
    const ageS = Number.isFinite(c.createdMs) ? now - c.createdMs / 1000 : 0;
    const base = {
      name: c.name, running: c.running, status: c.status,
      ageS: Math.round(ageS), hostPorts: c.hostPorts,
      composeProject: c.labels[LABEL_PROJECT] || null,
    };
    const own = ownsContainer(c, config);
    if (!own.owned) {
      return { ...base, owned: false, verdict: 'foreign',
        reason: `not-owned:${own.why}`, evidence: {} };
    }
    const lease = leases.get(c.name);
    const leaseValid = Number.isFinite(lease) && lease > now;
    const inUse = c.running
      ? (established.available
        ? c.hostPorts.some((p) => established.busy.has(p))
        : 'unknown')
      : false;
    const evidence = {
      leaseExpiry: Number.isFinite(lease) ? lease : null,
      leaseRemainingS: Number.isFinite(lease) ? Math.round(lease - now) : null,
      inUse,
    };
    const keep = (reason) => ({ ...base, owned: true, verdict: 'keep', reason, evidence });

    // Ordered vetoes, every one failing SAFE toward keeping.
    if (ageS < minAge) return keep('too-young');
    if (leaseValid) return keep('leased');
    if (inUse === true) return keep('in-use');
    if (!Number.isFinite(lease) && ageS < ttl) return keep('unleased-grace');
    const reason = !c.running ? 'exited-stale'
      : Number.isFinite(lease) ? 'lease-expired' : 'unleased-stale';
    return { ...base, owned: true, verdict: 'reap', reason, evidence };
  });
}

function classifyNetworks({ networks, containers, now, config }) {
  const minAge = config.minAgeS ?? POLICY_DEFAULTS.minAgeS;
  const re = new RegExp(config.composeProjectPattern);
  // A container in ANY state (including exited) still references its network, so it
  // must veto: `docker network rm` on a network an exited container is attached to
  // either refuses or breaks that container's config.
  const claimed = new Set(containers
    .map((c) => c.labels[LABEL_PROJECT]).filter(Boolean));
  return networks.map((n) => {
    const ageS = Number.isFinite(n.createdMs) ? now - n.createdMs / 1000 : 0;
    const project = n.labels[LABEL_PROJECT] || null;
    const base = { name: n.name, ageS: Math.round(ageS), attached: n.attached,
      composeProject: project };
    if (!project) {
      return { ...base, owned: false, verdict: 'foreign',
        reason: 'not-owned:no-compose-label', evidence: {} };
    }
    if (!re.test(project)) {
      return { ...base, owned: false, verdict: 'foreign',
        reason: 'not-owned:other-project', evidence: {} };
    }
    const evidence = { claimedByContainer: claimed.has(project) };
    const keep = (reason) => ({ ...base, owned: true, verdict: 'keep', reason, evidence });
    if (ageS < minAge) return keep('too-young');
    if (n.attached > 0) return keep('attached');
    if (claimed.has(project)) return keep('has-container');
    return { ...base, owned: true, verdict: 'reap', reason: 'orphan-network', evidence };
  });
}

function classify({ containers = [], networks = [], leases = new Map(),
  established = { available: true, busy: new Set() }, now, config }) {
  const cRows = classifyContainers({ containers, leases, established, now, config });
  const nRows = classifyNetworks({ networks, containers, now, config });
  const reap = {
    containers: cRows.filter((r) => r.verdict === 'reap').map((r) => r.name),
    networks: nRows.filter((r) => r.verdict === 'reap').map((r) => r.name),
  };
  return {
    now, config: { leaseTtlS: config.leaseTtlS, minAgeS: config.minAgeS,
      composeConfigPathSuffix: config.composeConfigPathSuffix,
      composeProjectPattern: config.composeProjectPattern },
    containers: cRows, networks: nRows, reap,
    orphanCount: reap.containers.length + reap.networks.length,
    owned: {
      containers: cRows.filter((r) => r.owned).length,
      running: cRows.filter((r) => r.owned && r.running).length,
    },
    establishedProbe: established.available ? 'ok' : 'unavailable',
  };
}

// ---------------------------------------------------------------------------
// sweep (scan | reap)
// ---------------------------------------------------------------------------

function sweep({ project, repoRoot = REPO_ROOT_DEFAULT, configFile = null,
  leaseDir = leaseDirDefault(), now = null, dryRun = false, mode = 'scan' }) {
  const config = readConfig(project, repoRoot, configFile);
  const at = now == null ? Math.floor(Date.now() / 1000) : now;
  if (!config.configured) {
    return {
      verdict: 'NOT-CONFIGURED', project, at, dryRun, configErrors: config.errors,
      orphanCount: null, containers: [], networks: [],
      reap: { containers: [], networks: [] },
      removed: { containers: [], networks: [] }, failed: [],
      message: `no container-reap config for ${project} (${config.file}) — nothing `
        + 'was checked, which is NOT the same as clean',
    };
  }

  const cRes = dockerContainers();
  if (!cRes.ok) {
    return {
      verdict: 'UNRUNNABLE', project, at, dryRun, orphanCount: null,
      containers: [], networks: [], reap: { containers: [], networks: [] },
      removed: { containers: [], networks: [] }, failed: [],
      message: `docker would not answer: ${cRes.err}`,
    };
  }
  const nRes = dockerNetworks();

  // probe ONLY the candidates' ports (precise and cheap)
  const candidatePorts = cRes.rows
    .filter((c) => c.running && ownsContainer(c, config).owned)
    .flatMap((c) => c.hostPorts);
  const established = establishedHostPorts(candidatePorts);
  const leases = readLeases(leaseDir);

  const report = classify({
    containers: cRes.rows, networks: nRes.rows, leases, established,
    now: at, config,
  });

  const removed = { containers: [], networks: [] };
  const failed = [];
  if (mode === 'reap' && !dryRun) {
    const lines = [];
    for (const row of report.containers.filter((r) => r.verdict === 'reap')) {
      const r = removeContainer(row.name);
      if (r.ok) {
        removed.containers.push(row.name);
        releaseLease(row.name, leaseDir);
        lines.push(`REAPED container ${row.name} reason=${row.reason} `
          + `age=${row.ageS}s ports=${row.hostPorts.join(',') || '-'} `
          + `inUse=${row.evidence.inUse}${r.alreadyGone ? ' (already gone)' : ''}`);
      } else {
        failed.push({ kind: 'container', name: row.name, err: r.err });
      }
    }
    // networks AFTER containers: removing the container is what frees the network
    for (const row of report.networks.filter((r) => r.verdict === 'reap')) {
      const r = removeNetwork(row.name);
      if (r.ok) {
        removed.networks.push(row.name);
        lines.push(`REAPED network ${row.name} reason=${row.reason} age=${row.ageS}s`);
      } else {
        // "has active endpoints" here means a container appeared between the
        // classify and the rm. Not a failure worth an exit code — next sweep.
        if (/active endpoints/i.test(r.err || '')) continue;
        failed.push({ kind: 'network', name: row.name, err: r.err });
      }
    }
    journal(leaseDir, lines);
    pruneLeases(leaseDir, new Set(cRes.rows.map((c) => c.name)
      .filter((n) => !removed.containers.includes(n))));
  }

  return { verdict: 'OK', project, at, dryRun, ...report, removed, failed };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--json') a.json = true;
    else if (t === '--dry-run') a.dryRun = true;
    else if (t === '--project') a.project = argv[++i];
    else if (t === '--repo-root') a.repoRoot = argv[++i];
    else if (t === '--config') a.configFile = argv[++i];
    else if (t === '--lease-dir') a.leaseDir = argv[++i];
    else if (t === '--container') a.container = argv[++i];
    else if (t === '--ttl') a.ttl = Number(argv[++i]);
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

function humanReport(rep, mode) {
  const out = [];
  if (rep.verdict !== 'OK') {
    out.push(`container-reap: ${rep.verdict} — ${rep.message}`);
    return out.join('\n');
  }
  const reaped = mode === 'reap' && !rep.dryRun
    ? `${rep.removed.containers.length} container(s) + ${rep.removed.networks.length} network(s) REMOVED`
    : `${rep.reap.containers.length} container(s) + ${rep.reap.networks.length} network(s) reapable${rep.dryRun ? ' (DRY RUN)' : ''}`;
  out.push(`container-reap[${rep.project}]: ${reaped}; `
    + `${rep.owned.containers} owned (${rep.owned.running} running); `
    + `in-use probe ${rep.establishedProbe}`);
  for (const r of rep.containers.filter((x) => x.owned)) {
    out.push(`  ${r.verdict === 'reap' ? 'REAP' : 'keep'} container ${r.name} `
      + `${r.reason} age=${r.ageS}s lease=${r.evidence.leaseRemainingS ?? 'none'} `
      + `inUse=${r.evidence.inUse}`);
  }
  for (const r of rep.networks.filter((x) => x.owned && x.verdict === 'reap')) {
    out.push(`  REAP network ${r.name} ${r.reason} age=${r.ageS}s`);
  }
  for (const f of rep.failed) out.push(`  FAILED ${f.kind} ${f.name}: ${f.err}`);
  return out.join('\n');
}

function main(argv = process.argv.slice(2)) {
  const a = parseArgs(argv);
  const cmd = a._[0];

  if (cmd === 'lease' || cmd === 'release') {
    if (!a.container) { console.error('container-reap: --container required'); return 1; }
    const dir = a.leaseDir || leaseDirDefault();
    if (cmd === 'release') {
      releaseLease(a.container, dir);
      console.log(`container-reap: lease released for ${a.container}`);
      return 0;
    }
    const ttl = Number.isFinite(a.ttl) ? a.ttl : POLICY_DEFAULTS.leaseTtlS;
    const expiry = writeLease(a.container, ttl, dir);
    console.log(`container-reap: lease for ${a.container} until ${new Date(expiry * 1000).toISOString()} (${ttl}s)`);
    return 0;
  }

  if (cmd !== 'scan' && cmd !== 'reap') {
    console.error('usage: container-reap.js scan|reap --project P [--dry-run] [--json]\n'
      + '       container-reap.js lease|release --container NAME [--ttl S]');
    return 1;
  }
  if (!a.project) { console.error('container-reap: --project required'); return 1; }

  const rep = sweep({
    project: a.project, repoRoot: a.repoRoot || REPO_ROOT_DEFAULT,
    configFile: a.configFile, leaseDir: a.leaseDir || leaseDirDefault(),
    now: parseNow(a.now), dryRun: !!a.dryRun, mode: cmd,
  });
  console.log(a.json ? JSON.stringify(rep, null, 2) : humanReport(rep, cmd));
  // Orphans existing is NEVER a non-zero exit: this runs before every pull.
  return rep.failed.length ? 2 : 0;
}

module.exports = {
  POLICY_DEFAULTS, readConfig, leaseDirDefault, readLeases, writeLease,
  releaseLease, pruneLeases, journal, normaliseContainer, normaliseNetwork,
  ownsContainer, classifyContainers, classifyNetworks, classify,
  dockerContainers, dockerNetworks, establishedHostPorts,
  removeContainer, removeNetwork, sweep, main,
};

if (require.main === module) {
  // §17g sweep off AC-DEFECT-OAG-076.5: `process.exit()` does not wait for a PIPE
  // to drain, so any payload over the 64 KiB pipe buffer reaches the consumer
  // TRUNCATED. `worktree-guard scan-all --json` hit exactly that on 2026-08-19 and
  // loop-gate read the guard as unrunnable. Set exitCode; let the runtime flush.
  process.exitCode = main();
}
