'use strict';
/**
 * container-reap.test.js — DEFECT-OAG-091 self-tests.
 *
 * THE HARM THIS PINS. EXP-133 (v137) gave every dispatch its OWN DynamoDB Local
 * container — correct, because a SHARED one let engineer B recreate engineer A's
 * container under an in-flight suite. But it moved the cost from COLLISION to
 * ACCUMULATION and shipped no reaper: `ddb-local-down` is per-dispatch and must be
 * called by the agent that created the container, so any agent that dies, stalls or
 * forgets leaks its container FOREVER. On 2026-08-10T23:31Z that was measured:
 *
 *     load averages: 19.85 18.46 16.18
 *     19 containers running, 13 of them OAG DynamoDB Local (ten of them 2 DAYS old)
 *
 * and a two-file test run took 301 SECONDS which took 877 MILLISECONDS after
 * reaping — a 340x difference. Four consecutive agent deaths preceded the
 * measurement and had been attributed to agent-side causes. The cause was the
 * machine. The worse harm is evidential: engineers reported reds that were green in
 * isolation, and one misread file ownership badly enough to nearly revert another
 * agent's uncommitted work.
 *
 * Acceptance criteria under test (DEFECT-OAG-091):
 *   AC-091.1  a committed reaper removes OAG local containers whose dispatch is no
 *             longer live, and is IDEMPOTENT.
 *   AC-091.2  it must not kill a LIVE dispatch's container, including one belonging
 *             to another Claude instance. Liveness is DERIVED (lease expiry + age),
 *             never a hardcoded name list.
 *   AC-091.3  it runs AUTOMATICALLY (loop-gate advisory), safe before every pull.
 *   AC-091.4  the reap MUST NOT touch the working tree.
 *   AC-091.5  fault set: mid-write reap; a dispatch that legitimately outlives the
 *             age threshold; two instances reaping concurrently; a container
 *             belonging to a DIFFERENT project.
 *
 * PROVENANCE OF THE INPUTS (v123/v125 — build the test FROM the real record). The
 * classifier cases are driven by `fixtures/container-reap/*-2026-08-11.jsonl`,
 * captured verbatim from THIS machine at 2026-08-11T10:00Z with
 * `docker inspect --format '{...}'` while the defect was live. That capture is why
 * the network limb exists at all: it shows the manual 23:32Z mitigation removed 13
 * containers and left NINETEEN `oag-dynamodb-local-*_default` compose networks
 * behind, which no one had noticed and which exhaust docker's bridge address pool.
 * A hand-authored fixture would have contained exactly the containers I already
 * knew about.
 *
 * The docker-driving cases create their OWN uniquely-named throwaway containers and
 * remove them; they never touch a container this process did not create.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const reaper = require('./container-reap.js');

const TOOL = path.join(__dirname, 'container-reap.js');
const FIXTURES = path.join(__dirname, 'fixtures', 'container-reap');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// --- the real captured machine state -----------------------------------------

function loadJsonl(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
}
const CAPTURED_CONTAINERS = loadJsonl('containers-2026-08-11.jsonl')
  .map(reaper.normaliseContainer);
const CAPTURED_NETWORKS = loadJsonl('networks-2026-08-11.jsonl')
  .map(reaper.normaliseNetwork);

// The capture's own clock. Ages in the fixture are only meaningful relative to it.
const CAPTURE_NOW = Date.parse('2026-08-11T10:00:00Z') / 1000;

const OAG_CONFIG = {
  project: 'OagEventSource',
  composeConfigPathSuffix: 'work/OagEventSource/src/app/local/docker-compose.yml',
  composeProjectPattern: '^oag-dynamodb-local(-[A-Za-z0-9._-]+)?$',
  leaseTtlS: 3600,
  minAgeS: 300,
};

function classifyCaptured(over = {}) {
  return reaper.classify({
    containers: CAPTURED_CONTAINERS,
    networks: CAPTURED_NETWORKS,
    leases: new Map(),
    established: { available: true, busy: new Set() },
    now: CAPTURE_NOW,
    config: OAG_CONFIG,
    ...over,
  });
}

function verdictOf(report, name) {
  const row = [...report.containers, ...report.networks].find((r) => r.name === name);
  assert.ok(row, `${name} not present in the capture — the fixture changed`);
  return row;
}

// --- AC-091.1 — the reaper identifies real orphans, idempotently --------------

test('AC-091.1 the REAL captured 2-day-old OAG container is classified as an orphan', () => {
  const report = classifyCaptured();
  const row = verdictOf(report, 'oag-dynamodb-local');
  assert.equal(row.verdict, 'reap');
  assert.equal(row.owned, true);
  // 2026-08-07T13:44:36Z -> ~3.9 days at capture time.
  assert.ok(row.ageS > 3 * 86400, `age ${row.ageS}s should be days, not hours`);
});

test('AC-091.1 the NINETEEN real orphaned compose networks the manual mitigation left behind are reaped', () => {
  const report = classifyCaptured();
  const reaped = report.reap.networks;
  // Every one of these was present on the machine at capture time with zero
  // attached containers and no surviving container carrying its compose project.
  assert.ok(reaped.includes('oag-dynamodb-local-defect-051_default'));
  assert.ok(reaped.includes('oag-dynamodb-local-validate-final_default'));
  assert.ok(reaped.includes('oag-dynamodb-local-tester-087_default'));
  assert.equal(reaped.length, 19,
    `expected the 19 captured OAG orphan networks, got ${reaped.length}: ${reaped}`);
});

test('AC-091.1 classification is IDEMPOTENT — the same input yields the same verdicts', () => {
  const a = classifyCaptured();
  const b = classifyCaptured();
  assert.deepEqual(a.reap, b.reap);
  // and a second pass over the state AFTER the reap has nothing left to do
  const after = classifyCaptured({
    containers: CAPTURED_CONTAINERS.filter((c) => !a.reap.containers.includes(c.name)),
    networks: CAPTURED_NETWORKS.filter((n) => !a.reap.networks.includes(n.name)),
  });
  assert.deepEqual(after.reap, { containers: [], networks: [] });
  assert.equal(after.orphanCount, 0);
});

// --- AC-091.2 — liveness is DERIVED, and a live dispatch is never killed -------

test('AC-091.2 a container with a VALID LEASE is kept even when far older than the age threshold', () => {
  // The long-legitimate-run case (AC-091.5 fault 2) is the SAME mechanism: the
  // lease is renewed at every gated target entry, so age alone never reaps.
  const container = reaper.normaliseContainer({
    Name: '/oag-dynamodb-local-uc-long-run',
    Created: new Date((CAPTURE_NOW - 6 * 3600) * 1000).toISOString(),
    Running: true, Status: 'running',
    Labels: {
      'com.docker.compose.project': 'oag-dynamodb-local-uc-long-run',
      'com.docker.compose.project.config_files':
        '/Users/x/Projects/OagEventSource-worktree/work/OagEventSource/src/app/local/docker-compose.yml',
    },
    Ports: { '8000/tcp': [{ HostIp: '0.0.0.0', HostPort: '8321' }] },
  });

  const leased = reaper.classify({
    containers: [container], networks: [], now: CAPTURE_NOW, config: OAG_CONFIG,
    leases: new Map([['oag-dynamodb-local-uc-long-run', CAPTURE_NOW + 900]]),
    established: { available: true, busy: new Set() },
  });
  assert.equal(leased.containers[0].verdict, 'keep');
  assert.equal(leased.containers[0].reason, 'leased');

  // DIFFERENTIAL ARM — the identical 6-hour-old container with an EXPIRED lease
  // IS reaped. Without this arm the keep above could be a blanket refusal.
  const expired = reaper.classify({
    containers: [container], networks: [], now: CAPTURE_NOW, config: OAG_CONFIG,
    leases: new Map([['oag-dynamodb-local-uc-long-run', CAPTURE_NOW - 60]]),
    established: { available: true, busy: new Set() },
  });
  assert.equal(expired.containers[0].verdict, 'reap');
  assert.equal(expired.containers[0].reason, 'lease-expired');
});

test('AC-091.2 ANOTHER CLAUDE INSTANCE\'s container (different worktree path) is owned, and its LEASE protects it', () => {
  // The multi-instance model is normal here (§0a): each instance drives the same
  // project from a DIFFERENT worktree, so the compose config-file label carries a
  // different absolute prefix. Ownership is a PATH-SUFFIX match precisely so a
  // sibling instance's orphans are reapable — and its LIVE container is not.
  const mk = (name) => reaper.normaliseContainer({
    Name: `/${name}`,
    Created: new Date((CAPTURE_NOW - 7200) * 1000).toISOString(),
    Running: true, Status: 'running',
    Labels: {
      'com.docker.compose.project': name,
      'com.docker.compose.project.config_files':
        '/Users/x/Projects/OagEventSource-worktree-2/work/OagEventSource/src/app/local/docker-compose.yml',
    },
    Ports: { '8000/tcp': [{ HostIp: '0.0.0.0', HostPort: '8455' }] },
  });
  const live = mk('oag-dynamodb-local-other-instance-live');
  const dead = mk('oag-dynamodb-local-other-instance-dead');

  const report = reaper.classify({
    containers: [live, dead], networks: [], now: CAPTURE_NOW, config: OAG_CONFIG,
    leases: new Map([[live.name, CAPTURE_NOW + 1800]]),
    established: { available: true, busy: new Set() },
  });
  assert.equal(report.containers.every((c) => c.owned), true,
    'a sibling INSTANCE of the same project must be recognised as ours');
  assert.deepEqual(report.reap.containers, ['oag-dynamodb-local-other-instance-dead']);
});

test('AC-091.2 liveness is derived from a LEASE, not from a name list', () => {
  // Non-vacuity: there is no container-name allowlist/denylist anywhere in the
  // tool. If one were introduced this fails, which is the point — a name list
  // cannot know whether a dispatch is alive.
  const src = fs.readFileSync(TOOL, 'utf8');
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const banned of ['engineer-csp1', 'tester-087', 'validate-final', 'defect-047']) {
    assert.ok(!codeOnly.includes(banned),
      `the tool names a specific dispatch (${banned}) — liveness must be derived`);
  }
});

test('AC-091.2 a container younger than the age floor is kept even with NO lease (start/reap race)', () => {
  const fresh = reaper.normaliseContainer({
    Name: '/oag-dynamodb-local-just-started',
    Created: new Date((CAPTURE_NOW - 30) * 1000).toISOString(),
    Running: true, Status: 'running',
    Labels: {
      'com.docker.compose.project': 'oag-dynamodb-local-just-started',
      'com.docker.compose.project.config_files':
        '/w/work/OagEventSource/src/app/local/docker-compose.yml',
    },
    Ports: {},
  });
  const report = reaper.classify({
    containers: [fresh], networks: [], leases: new Map(),
    established: { available: true, busy: new Set() },
    now: CAPTURE_NOW, config: OAG_CONFIG,
  });
  assert.equal(report.containers[0].verdict, 'keep');
  assert.equal(report.containers[0].reason, 'too-young');
});

test('AC-091.2 an UNLEASED container gets a full TTL of grace before it is ever reaped', () => {
  const mk = (ageS) => reaper.normaliseContainer({
    Name: '/oag-dynamodb-local-unleased',
    Created: new Date((CAPTURE_NOW - ageS) * 1000).toISOString(),
    Running: true, Status: 'running',
    Labels: {
      'com.docker.compose.project': 'oag-dynamodb-local-unleased',
      'com.docker.compose.project.config_files':
        '/w/work/OagEventSource/src/app/local/docker-compose.yml',
    },
    Ports: {},
  });
  const run = (ageS) => reaper.classify({
    containers: [mk(ageS)], networks: [], leases: new Map(),
    established: { available: true, busy: new Set() },
    now: CAPTURE_NOW, config: OAG_CONFIG,
  }).containers[0];

  // A lease-write failure (or a container started by hand) must NOT become an
  // immediate kill: fail-safe direction is KEEP.
  assert.equal(run(1800).reason, 'unleased-grace');
  assert.equal(run(1800).verdict, 'keep');
  assert.equal(run(3600 + 60).verdict, 'reap');
  assert.equal(run(3600 + 60).reason, 'unleased-stale');
});

// --- AC-091.5 fault 5 — a DIFFERENT project must never be touched -------------

test('AC-091.5 no container or network outside this project is EVER in the reap set (real capture)', () => {
  const report = classifyCaptured();
  // These were all present on the machine at capture time and belong to other
  // projects or other tools. Naming them here is the assertion, not the policy.
  for (const foreign of ['aidxout-local-dynamodb', 'roc-local-servicebus',
    'roc-local-eventhubs', 'roc-local-azurite', 'roc-local-sql-edge',
    'viggo-sql', 'viggo-mssql', 'buildx_buildkit_tender_blackburn0']) {
    const row = verdictOf(report, foreign);
    assert.equal(row.owned, false, `${foreign} must not be owned by OagEventSource`);
    assert.equal(row.verdict, 'foreign');
    assert.ok(!report.reap.containers.includes(foreign));
  }
  for (const foreign of ['bridge', 'host', 'none', 'roc-local_default',
    'aidxout-local_default', 'adixout-local_default', 'docker_default',
    'local_default', 'oagprobeproof_default']) {
    assert.ok(!report.reap.networks.includes(foreign),
      `${foreign} must never be reaped`);
  }
  // and the whole reap set is OAG-shaped, by construction not by enumeration
  for (const n of [...report.reap.containers, ...report.reap.networks]) {
    assert.match(n, /^oag-dynamodb-local/);
  }
});

test('AC-091.5 the two real not-ours SHAPES are distinguished: no compose label at all, and another project', () => {
  const report = classifyCaptured();
  // buildx's buildkit container carries `{}` labels — nothing to attribute it by,
  // so it can never be owned. (Discovered from the capture; I had assumed viggo-sql
  // was this case and it is not.)
  assert.equal(verdictOf(report, 'buildx_buildkit_tender_blackburn0').reason,
    'not-owned:no-compose-label');
  // viggo-sql DOES carry a compose config_files label — pointing at
  // work/viggo-fix/docker/docker-compose.yml, i.e. a SIBLING PROJECT in another
  // worktree of this very repo family. That is the hardest exclusion to get right
  // (same machine, same repo family, same user) and the path-suffix predicate makes
  // it structural rather than a judgement call.
  assert.equal(verdictOf(report, 'viggo-sql').reason, 'not-owned:other-project');
  assert.equal(verdictOf(report, 'aidxout-local-dynamodb').reason,
    'not-owned:other-project');
});

// --- AC-091.5 fault 1 — mid-write ---------------------------------------------

test('AC-091.5 a container with an ESTABLISHED connection on its host port is kept (mid-write veto)', () => {
  const busy = reaper.normaliseContainer({
    Name: '/oag-dynamodb-local-mid-write',
    Created: new Date((CAPTURE_NOW - 4 * 3600) * 1000).toISOString(),
    Running: true, Status: 'running',
    Labels: {
      'com.docker.compose.project': 'oag-dynamodb-local-mid-write',
      'com.docker.compose.project.config_files':
        '/w/work/OagEventSource/src/app/local/docker-compose.yml',
    },
    Ports: { '8000/tcp': [{ HostIp: '0.0.0.0', HostPort: '8777' }] },
  });
  const run = (busyPorts, available = true) => reaper.classify({
    containers: [busy], networks: [], leases: new Map(),
    established: { available, busy: new Set(busyPorts) },
    now: CAPTURE_NOW, config: OAG_CONFIG,
  }).containers[0];

  assert.equal(run([8777]).verdict, 'keep');
  assert.equal(run([8777]).reason, 'in-use');
  // DIFFERENTIAL ARM: idle on the same port -> reaped.
  assert.equal(run([]).verdict, 'reap');
  // Probe UNAVAILABLE: the veto cannot be applied. It is not silently treated as
  // satisfied — the row records that in-use was UNKNOWN.
  assert.equal(run([], false).verdict, 'reap');
  assert.equal(run([], false).evidence.inUse, 'unknown');
});

// --- AC-091.5 fault 3 — two instances reaping concurrently --------------------

test('AC-091.5 removing an ALREADY-REMOVED container is success, not an error (concurrent reapers)', () => {
  const name = `container-reap-absent-${process.pid}`;
  const r = reaper.removeContainer(name);
  assert.equal(r.ok, true, `removing an absent container must be idempotent: ${r.err}`);
  assert.equal(r.alreadyGone, true);
});

// --- config -------------------------------------------------------------------

test('AC-091.3 OagEventSource has a committed reap config, and an unconfigured project is UNKNOWN not clean', () => {
  const cfg = reaper.readConfig('OagEventSource', REPO_ROOT);
  assert.equal(cfg.configured, true);
  assert.equal(cfg.composeConfigPathSuffix,
    'work/OagEventSource/src/app/local/docker-compose.yml');
  assert.ok(cfg.leaseTtlS > 0 && cfg.minAgeS > 0);
  const none = reaper.readConfig('NoSuchProjectHere', REPO_ROOT);
  assert.equal(none.configured, false);
});

test('AC-091.3 `scan` on an unconfigured project reports NOT-CONFIGURED and never a clean zero', () => {
  const r = spawnSync('node', [TOOL, 'scan', '--project', 'NoSuchProjectHere',
    '--repo-root', REPO_ROOT, '--json'], { encoding: 'utf8' });
  const out = JSON.parse(r.stdout);
  assert.equal(out.verdict, 'NOT-CONFIGURED');
  assert.notEqual(out.verdict, 'OK');
});

// --- lease file contract (the project Makefile is the WRITER) -----------------

test('AC-091.2 the lease file contract is a bare epoch expiry, and a corrupt lease reads as UNLEASED', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reap-lease-'));
  fs.writeFileSync(path.join(dir, 'a.lease'), '1786000000\n');
  fs.writeFileSync(path.join(dir, 'b.lease'), 'not-a-number\n');
  const leases = reaper.readLeases(dir);
  assert.equal(leases.get('a'), 1786000000);
  assert.equal(leases.has('b'), false, 'a corrupt lease must not be trusted');
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- docker-driving cases ------------------------------------------------------

const DOCKER_OK = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'],
  { encoding: 'utf8' }).status === 0;

/**
 * A free host port in 8900-8999 — deliberately a REALISTIC published port, in the
 * same band `ddb-local-mine` derives (8100-8999) and clear of it.
 *
 * NOT `-p 0:8000`: docker then picks an EPHEMERAL port (55003 was observed), and on
 * this machine `lsof -iTCP:<ephemeral>` did not report the established pair while
 * `lsof -iTCP:8933` reported it on both sides. A test on an ephemeral port would have
 * "proved" the mid-write veto broken when the veto is fine and the TEST was
 * unrepresentative.
 */
function freePort() {
  for (let p = 8900; p < 9000; p += 1) {
    const r = spawnSync('lsof', ['-nP', `-iTCP:${p}`], { encoding: 'utf8' });
    if (!(r.stdout || '').trim()) return p;
  }
  throw new Error('no free port in 8900-8999');
}

/** Create a throwaway container with THIS project-shape's compose labels. */
function makeSelfTestContainer(suffix, tmpRoot) {
  const project = `oag-selftest-${process.pid}-${suffix}`;
  const compose = path.join(tmpRoot, 'work', 'SelfTestProject', 'src', 'app',
    'local', 'docker-compose.yml');
  const hostPort = freePort();
  execFileSync('docker', ['run', '-d', '--name', project,
    '--label', `com.docker.compose.project=${project}`,
    '--label', `com.docker.compose.project.config_files=${compose}`,
    '-p', `${hostPort}:8000`,
    'amazon/dynamodb-local:2.5.2',
    '-jar', 'DynamoDBLocal.jar', '-inMemory', '-sharedDb'], { encoding: 'utf8' });
  return { project, hostPort };
}

/**
 * Wait until the container is REALLY SERVING, not merely published.
 *
 * Docker Desktop's proxy LISTENs on the host port the instant `docker run` returns,
 * so a `connect` succeeds and is then RESET while the JVM is still starting. The
 * first version of the mid-write test connected immediately, held a socket that was
 * already dead, and reported the veto broken when the veto was fine — a false red
 * that cost a debugging pass. Readiness is proven by an actual response byte.
 */
async function waitServing(port, budgetMs = 30000) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((res) => {
      const s = net.createConnection({ host: '127.0.0.1', port });
      const done = (v) => { s.destroy(); res(v); };
      s.setTimeout(2000, () => done(false));
      s.once('error', () => done(false));
      s.once('connect', () => s.write('GET / HTTP/1.1\r\nHost: x\r\n\r\n'));
      s.once('data', () => done(true));
      s.once('close', () => res(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`container on :${port} never served within ${budgetMs}ms`);
}

function selfTestConfig(tmpRoot) {
  const dir = path.join(tmpRoot, '.claude', 'config', 'container-reap');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SelfTestProject.json'), JSON.stringify({
    composeConfigPathSuffix: 'work/SelfTestProject/src/app/local/docker-compose.yml',
    composeProjectPattern: `^oag-selftest-${process.pid}-[A-Za-z0-9._-]+$`,
    leaseTtlS: 3600,
    minAgeS: 300,
  }));
  return tmpRoot;
}

test('AC-091.5 a REAL container mid-write is kept, and reaped once the connection closes', { skip: !DOCKER_OK && 'docker unavailable' }, async () => {
  const tmpRoot = selfTestConfig(fs.mkdtempSync(path.join(os.tmpdir(), 'reap-live-')));
  const leaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reap-leases-'));
  const { project, hostPort } = makeSelfTestContainer('midwrite', tmpRoot);
  const future = Math.floor(Date.now() / 1000) + 7200;   // past every threshold
  const args = ['--project', 'SelfTestProject', '--repo-root', tmpRoot,
    '--lease-dir', leaseDir, '--now', String(future), '--json'];
  try {
    await waitServing(hostPort);
    // hold a real connection open, exactly as an in-flight suite would
    const sock = net.createConnection({ host: '127.0.0.1', port: hostPort });
    await new Promise((res, rej) => { sock.once('connect', res); sock.once('error', rej); });
    sock.write('GET / HTTP/1.1\r\nHost: x\r\n\r\n');
    await new Promise((res) => { sock.once('data', res); });
    const busy = JSON.parse(spawnSync('node', [TOOL, 'reap', ...args],
      { encoding: 'utf8' }).stdout);
    const row = busy.containers.find((c) => c.name === project);
    assert.equal(row.verdict, 'keep');
    assert.equal(row.reason, 'in-use');
    assert.equal(spawnSync('docker', ['inspect', project]).status, 0,
      'the in-use container must still exist');

    sock.destroy();
    await new Promise((r) => setTimeout(r, 1500));
    const idle = JSON.parse(spawnSync('node', [TOOL, 'reap', ...args],
      { encoding: 'utf8' }).stdout);
    assert.ok(idle.removed.containers.includes(project),
      `idle container should have been reaped: ${JSON.stringify(idle.removed)}`);
    assert.notEqual(spawnSync('docker', ['inspect', project]).status, 0,
      'the idle container must be gone');
  } finally {
    spawnSync('docker', ['rm', '-f', project]);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(leaseDir, { recursive: true, force: true });
  }
});

test('AC-091.5 TWO reapers racing on the same REAL orphan both succeed and remove it once', { skip: !DOCKER_OK && 'docker unavailable' }, async () => {
  const tmpRoot = selfTestConfig(fs.mkdtempSync(path.join(os.tmpdir(), 'reap-race-')));
  const leaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reap-leases-'));
  const { project } = makeSelfTestContainer('race', tmpRoot);
  const future = Math.floor(Date.now() / 1000) + 7200;
  const args = ['reap', '--project', 'SelfTestProject', '--repo-root', tmpRoot,
    '--lease-dir', leaseDir, '--now', String(future), '--json'];
  try {
    const [a, b] = await Promise.all([0, 1].map(() => new Promise((res) => {
      const { spawn } = require('node:child_process');
      const p = spawn('node', [TOOL, ...args], { encoding: 'utf8' });
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.on('close', (code) => res({ code, out }));
    })));
    assert.equal(a.code, 0, `first reaper exit ${a.code}: ${a.out}`);
    assert.equal(b.code, 0, `second reaper exit ${b.code}: ${b.out}`);
    const removedBy = [a, b].filter((r) => JSON.parse(r.out).removed.containers.includes(project));
    assert.ok(removedBy.length >= 1, 'at least one reaper must report the removal');
    assert.notEqual(spawnSync('docker', ['inspect', project]).status, 0);
  } finally {
    spawnSync('docker', ['rm', '-f', project]);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(leaseDir, { recursive: true, force: true });
  }
});

test('AC-091.4 a REAL reap leaves the working tree byte-identical — status, untracked files and both HEADs', { skip: !DOCKER_OK && 'docker unavailable' }, () => {
  // The blast radius if this is wrong is another agent's uncommitted work: on
  // 2026-08-10 the manual reap had to leave 53 changed paths, CSP1's 4 untracked
  // files and DEFECT-OAG-047's 11 files byte-intact. That property is ASSERTED
  // here, not observed once.
  const snapshot = () => {
    const repos = [REPO_ROOT, path.join(REPO_ROOT, 'work', 'OagEventSource')];
    return repos.map((repo) => {
      const status = spawnSync('git', ['-C', repo, 'status', '--porcelain'],
        { encoding: 'utf8' }).stdout || '';
      const head = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'],
        { encoding: 'utf8' }).stdout || '';
      // hash the CONTENT of every path git reports as changed or untracked
      const files = status.split('\n').filter(Boolean)
        .map((l) => l.slice(3).replace(/^"|"$/g, ''))
        .filter((p) => !p.endsWith('/'))
        .map((p) => path.join(repo, p));
      const digests = files.map((f) => {
        try {
          return `${f}:${require('node:crypto').createHash('sha256')
            .update(fs.readFileSync(f)).digest('hex')}`;
        } catch { return `${f}:UNREADABLE`; }
      });
      return { repo, status, head, digests };
    });
  };

  const tmpRoot = selfTestConfig(fs.mkdtempSync(path.join(os.tmpdir(), 'reap-tree-')));
  const leaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reap-leases-'));
  const { project } = makeSelfTestContainer('tree', tmpRoot);
  const future = Math.floor(Date.now() / 1000) + 7200;
  try {
    const before = snapshot();
    const out = JSON.parse(spawnSync('node', [TOOL, 'reap',
      '--project', 'SelfTestProject', '--repo-root', tmpRoot,
      '--lease-dir', leaseDir, '--now', String(future), '--json'],
      { encoding: 'utf8' }).stdout);
    // NON-VACUITY: the reap must actually have removed something, or "unchanged"
    // proves nothing.
    assert.ok(out.removed.containers.includes(project),
      'the reap did nothing, so tree-integrity is vacuous');
    const after = snapshot();
    assert.deepEqual(after, before,
      'the reap changed the working tree — that is another agent\'s uncommitted work');
  } finally {
    spawnSync('docker', ['rm', '-f', project]);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(leaseDir, { recursive: true, force: true });
  }
});

test('AC-091.1 `reap` against the REAL machine in DRY-RUN removes nothing and names only OAG objects', { skip: !DOCKER_OK && 'docker unavailable' }, () => {
  const before = execFileSync('docker', ['ps', '-aq'], { encoding: 'utf8' }).trim();
  const out = JSON.parse(spawnSync('node', [TOOL, 'reap', '--project',
    'OagEventSource', '--repo-root', REPO_ROOT, '--dry-run', '--json'],
    { encoding: 'utf8' }).stdout);
  assert.equal(out.dryRun, true);
  assert.deepEqual(out.removed, { containers: [], networks: [] });
  for (const n of [...out.reap.containers, ...out.reap.networks]) {
    assert.match(n, /^oag-dynamodb-local/,
      'dry-run named a non-OAG object as reapable');
  }
  assert.equal(execFileSync('docker', ['ps', '-aq'], { encoding: 'utf8' }).trim(), before,
    'a dry run must not remove anything');
});
