'use strict';
/**
 * stack-claim.test.js — DEF-ROC-062 self-tests.
 *
 * THE HARM THIS PINS. With no lease writer, container-reap.js's absolute-veto
 * protection was unreachable for ROC: at 2026-08-19T15:41Z the reaper destroyed
 * FOUR RUNNING containers mid-validation because age was the only signal
 * available. These tests pin the writer side of that contract: `claim` writes
 * the SAME lease file format the reaper already reads, `release` removes it, a
 * TTL means an unrenewed claim eventually stops vetoing (no deadlock), and a
 * genuine second claimant is refused rather than silently overwritten.
 *
 * All docker/config interaction is stubbed via dependency injection points
 * (`ownedContainers` is exercised through `reap.dockerContainers`/`readConfig`,
 * which these tests fake by pointing `--repo-root`/`--config` at a throwaway
 * fixture tree) — no real docker call, no real container, fully offline.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const reap = require('./container-reap.js');
const sc = require('./stack-claim.js');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// A fake `ownedContainers` swap: rather than reach into docker, monkeypatch the
// module's own dependency by stubbing reap.dockerContainers/readConfig for the
// duration of one test. Node's CJS cache means `reap` here IS the same module
// object `stack-claim.js` required, so this is safe and self-contained.
function withFakeDocker(rows, fn) {
  const origDocker = reap.dockerContainers;
  const origConfig = reap.readConfig;
  reap.dockerContainers = () => ({ ok: true, err: null, rows });
  reap.readConfig = () => ({
    configured: true, project: 'FakeProj', file: '<stub>',
    composeConfigPathSuffix: 'work/FakeProj/src/app/local/docker-compose.yml',
    composeProjectPattern: '^fakeproj-local(-[A-Za-z0-9._-]+)?$',
    leaseTtlS: 3600, minAgeS: 300,
  });
  try { return fn(); } finally {
    reap.dockerContainers = origDocker;
    reap.readConfig = origConfig;
  }
}

function ownedRow(name) {
  return {
    name, createdMs: Date.now(), running: true, status: 'running',
    labels: { 'com.docker.compose.project.config_files':
      '/abs/work/FakeProj/src/app/local/docker-compose.yml' },
    hostPorts: [],
  };
}

test('claim writes a lease container-reap.js itself reads as valid', () => {
  const dir = tmpDir('stack-claim-lease-');
  const now = 1_000_000;
  withFakeDocker([ownedRow('fakeproj-a'), ownedRow('fakeproj-b')], () => {
    const r = sc.claim({ project: 'FakeProj', leaseDir: dir, ttl: 3600, now, label: 'x' });
    assert.equal(r.verdict, 'CLAIMED');
    assert.deepEqual(r.claimed.sort(), ['fakeproj-a', 'fakeproj-b']);
  });
  const leases = reap.readLeases(dir);
  assert.equal(leases.get('fakeproj-a'), now + 3600);
  assert.equal(leases.get('fakeproj-b'), now + 3600);
  // the reaper's own classifier must see this as a valid, absolute-veto lease
  const cls = reap.classifyContainers({
    containers: [{ name: 'fakeproj-a', createdMs: now * 1000 - 10_000 * 1000, running: true,
      labels: { 'com.docker.compose.project.config_files':
        '/abs/work/FakeProj/src/app/local/docker-compose.yml' }, hostPorts: [] }],
    leases, established: { available: true, busy: new Set() }, now,
    config: { leaseTtlS: 3600, minAgeS: 300,
      composeConfigPathSuffix: 'work/FakeProj/src/app/local/docker-compose.yml' },
  });
  assert.equal(cls[0].verdict, 'keep');
  assert.equal(cls[0].reason, 'leased');
});

test('claim on an empty stack is a soft no-op, never an error', () => {
  const dir = tmpDir('stack-claim-empty-');
  withFakeDocker([], () => {
    const r = sc.claim({ project: 'FakeProj', leaseDir: dir, now: 1000 });
    assert.equal(r.ok, true);
    assert.equal(r.verdict, 'NOTHING-TO-CLAIM');
    assert.deepEqual(r.claimed, []);
  });
});

test('release removes every leased container and the marker; idempotent', () => {
  const dir = tmpDir('stack-claim-release-');
  withFakeDocker([ownedRow('fakeproj-a')], () => {
    sc.claim({ project: 'FakeProj', leaseDir: dir, ttl: 100, now: 1000, label: 'me' });
  });
  assert.ok(reap.readLeases(dir).has('fakeproj-a'));
  const r1 = sc.release({ project: 'FakeProj', leaseDir: dir, label: 'me' });
  assert.equal(r1.verdict, 'RELEASED');
  assert.equal(reap.readLeases(dir).has('fakeproj-a'), false);
  assert.equal(fs.existsSync(sc.claimFile('FakeProj', dir)), false);
  // releasing again with nothing claimed is a clean no-op, not an error
  const r2 = sc.release({ project: 'FakeProj', leaseDir: dir, label: 'me' });
  assert.equal(r2.verdict, 'NOTHING-TO-RELEASE');
  assert.equal(r2.ok, true);
});

test('a live claim by a DIFFERENT label refuses without --force', () => {
  const dir = tmpDir('stack-claim-conflict-');
  withFakeDocker([ownedRow('fakeproj-a')], () => {
    const first = sc.claim({ project: 'FakeProj', leaseDir: dir, ttl: 3600, now: 1000, label: 'agent-A' });
    assert.equal(first.verdict, 'CLAIMED');
    const second = sc.claim({ project: 'FakeProj', leaseDir: dir, ttl: 3600, now: 1100, label: 'agent-B' });
    assert.equal(second.verdict, 'CONFLICT');
    assert.equal(second.ok, false);
    // --force overrides
    const forced = sc.claim({ project: 'FakeProj', leaseDir: dir, ttl: 3600, now: 1200,
      label: 'agent-B', force: true });
    assert.equal(forced.verdict, 'CLAIMED');
  });
  const claimed = sc.readClaim('FakeProj', dir);
  assert.equal(claimed.label, 'agent-B');
});

test('the SAME label may always re-claim (renew) with no conflict', () => {
  const dir = tmpDir('stack-claim-renew-');
  withFakeDocker([ownedRow('fakeproj-a')], () => {
    sc.claim({ project: 'FakeProj', leaseDir: dir, ttl: 1000, now: 1000, label: 'agent-A' });
    const renewed = sc.claim({ project: 'FakeProj', leaseDir: dir, ttl: 1000, now: 1500, label: 'agent-A' });
    assert.equal(renewed.verdict, 'CLAIMED');
  });
  // renewal from now=1500 pushes expiry to 2500, not the original 2000 —
  // proves the clock measures from the LAST sign of life, not creation.
  const leases = reap.readLeases(dir);
  assert.equal(leases.get('fakeproj-a'), 2500);
});

test('a TTL that elapses with no renewal stops vetoing — no deadlock', () => {
  const dir = tmpDir('stack-claim-ttl-expiry-');
  withFakeDocker([ownedRow('fakeproj-a')], () => {
    sc.claim({ project: 'FakeProj', leaseDir: dir, ttl: 100, now: 1000, label: 'dead-agent' });
  });
  const leases = reap.readLeases(dir);
  const expiredNow = 1000 + 100 + 1; // one second past expiry, never renewed
  const cls = reap.classifyContainers({
    containers: [{ name: 'fakeproj-a', createdMs: (1000 - 10_000) * 1000, running: true,
      labels: { 'com.docker.compose.project.config_files':
        '/abs/work/FakeProj/src/app/local/docker-compose.yml' }, hostPorts: [] }],
    leases, established: { available: true, busy: new Set() }, now: expiredNow,
    config: { leaseTtlS: 50, minAgeS: 10,
      composeConfigPathSuffix: 'work/FakeProj/src/app/local/docker-compose.yml' },
  });
  assert.equal(cls[0].verdict, 'reap');
  assert.equal(cls[0].reason, 'lease-expired');
});

test('status reports validity without requiring a claim to exist', () => {
  const dir = tmpDir('stack-claim-status-');
  const noClaim = withFakeDocker([ownedRow('fakeproj-a')], () =>
    sc.status({ project: 'FakeProj', leaseDir: dir, now: 1000 }));
  assert.equal(noClaim.claim, null);
  assert.equal(noClaim.claimValid, false);
  assert.equal(noClaim.containers[0].leaseValid, false);

  withFakeDocker([ownedRow('fakeproj-a')], () => {
    sc.claim({ project: 'FakeProj', leaseDir: dir, ttl: 500, now: 1000, label: 'me' });
  });
  const withClaim = withFakeDocker([ownedRow('fakeproj-a')], () =>
    sc.status({ project: 'FakeProj', leaseDir: dir, now: 1200 }));
  assert.equal(withClaim.claimValid, true);
  assert.equal(withClaim.containers[0].leaseValid, true);
  assert.equal(withClaim.containers[0].leaseRemainingS, 1500 - 1200);
});
