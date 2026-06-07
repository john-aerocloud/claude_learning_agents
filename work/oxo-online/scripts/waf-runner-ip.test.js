'use strict';
// s007 UC2-S4 — unit tests for waf-runner-ip.js (IMP-008 runner-IP tooling).
// Run: node --test work/oxo-online/scripts/waf-runner-ip.test.js
//
// These tests exercise the PURE logic + the read-modify-write orchestration via
// an injected fake CLI runner — zero real AWS calls, zero network. The live
// add->verify->remove cycle (UC2 §11a probe) covers the platform truth.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseArgs,
  mutateAddresses,
  IP_SET_NAME,
  IP_SET_SCOPE,
  IP_SET_REGION,
  resolveIpSetId,
  runOnce,
  ExternalUnavailableError,
  CallerDataError,
} = require('./waf-runner-ip.js');

test('parseArgs: add/remove subcommand + CIDR + optional --profile passthrough', () => {
  const a = parseArgs(['add', '1.2.3.4/32', '--profile', 'dev-int']);
  assert.equal(a.command, 'add');
  assert.equal(a.cidr, '1.2.3.4/32');
  assert.equal(a.profile, 'dev-int');

  const r = parseArgs(['remove', '5.6.7.8/32']);
  assert.equal(r.command, 'remove');
  assert.equal(r.cidr, '5.6.7.8/32');
  assert.equal(r.profile, undefined);
});

test('parseArgs: rejects an unknown subcommand as a caller 4xx-class data error', () => {
  assert.throws(() => parseArgs(['frobnicate', '1.2.3.4/32']), CallerDataError);
});

test('parseArgs: rejects a missing/malformed CIDR as a caller 4xx-class data error', () => {
  assert.throws(() => parseArgs(['add']), CallerDataError);
  assert.throws(() => parseArgs(['add', 'not-a-cidr']), CallerDataError);
  assert.throws(() => parseArgs(['add', '1.2.3.4']), CallerDataError); // no /len
});

test('mutateAddresses add: append-never-replace, idempotent on a CIDR already present', () => {
  assert.deepEqual(mutateAddresses('add', ['9.9.9.9/32'], '1.2.3.4/32'), [
    '9.9.9.9/32',
    '1.2.3.4/32',
  ]);
  // Already present -> unchanged (survives parallel CI: never clobbers others).
  assert.deepEqual(mutateAddresses('add', ['1.2.3.4/32'], '1.2.3.4/32'), [
    '1.2.3.4/32',
  ]);
});

test('mutateAddresses remove: removes only the target, leaves other runners intact', () => {
  assert.deepEqual(
    mutateAddresses('remove', ['9.9.9.9/32', '1.2.3.4/32'], '1.2.3.4/32'),
    ['9.9.9.9/32'],
  );
  // Removing an absent CIDR is a no-op (idempotent cleanup).
  assert.deepEqual(mutateAddresses('remove', ['9.9.9.9/32'], '1.2.3.4/32'), [
    '9.9.9.9/32',
  ]);
});

test('IP set identity constants are pinned (name/scope/region) — no hard-coded ID', () => {
  assert.equal(IP_SET_NAME, 'oxo-test-runner-ips');
  assert.equal(IP_SET_SCOPE, 'CLOUDFRONT');
  assert.equal(IP_SET_REGION, 'us-east-1');
});

test('resolveIpSetId: resolves the set ID by NAME at call time (no hard-coded ID)', () => {
  const calls = [];
  const fakeCli = (args) => {
    calls.push(args);
    // aws wafv2 list-ip-sets --scope CLOUDFRONT --region us-east-1
    return JSON.stringify({
      IPSets: [
        { Name: 'something-else', Id: 'aaa' },
        { Name: 'oxo-test-runner-ips', Id: 'bbb-111' },
      ],
    });
  };
  const id = resolveIpSetId(fakeCli, undefined);
  assert.equal(id, 'bbb-111');
  const joined = calls[0].join(' ');
  assert.match(joined, /wafv2 list-ip-sets/);
  assert.match(joined, /--scope CLOUDFRONT/);
  assert.match(joined, /--region us-east-1/);
});

test('runOnce add: get-ip-set (lock token) -> mutate -> update-ip-set WITH the token', () => {
  const calls = [];
  const fakeCli = (args) => {
    calls.push(args.join(' '));
    if (args.includes('list-ip-sets')) {
      return JSON.stringify({ IPSets: [{ Name: IP_SET_NAME, Id: 'bbb-111' }] });
    }
    if (args.includes('get-ip-set')) {
      return JSON.stringify({
        IPSet: { Addresses: ['9.9.9.9/32'] },
        LockToken: 'tok-abc',
      });
    }
    if (args.includes('update-ip-set')) {
      return JSON.stringify({ NextLockToken: 'tok-def' });
    }
    throw new Error('unexpected call: ' + args.join(' '));
  };
  runOnce(fakeCli, { command: 'add', cidr: '1.2.3.4/32', profile: 'dev-int' });
  const update = calls.find((c) => c.includes('update-ip-set'));
  assert.ok(update, 'expected an update-ip-set call');
  assert.match(update, /--lock-token tok-abc/); // the token from get-ip-set
  assert.match(update, /--id bbb-111/);
  assert.match(update, /9\.9\.9\.9\/32/); // existing kept (append-never-replace)
  assert.match(update, /1\.2\.3\.4\/32/); // new appended
  assert.match(update, /--profile dev-int/); // passthrough honoured
});

test('runOnce: retries ONCE on a lock-token conflict, then succeeds', () => {
  let updateAttempts = 0;
  const fakeCli = (args) => {
    if (args.includes('list-ip-sets'))
      return JSON.stringify({ IPSets: [{ Name: IP_SET_NAME, Id: 'bbb-111' }] });
    if (args.includes('get-ip-set'))
      return JSON.stringify({ IPSet: { Addresses: [] }, LockToken: 'tok-' + updateAttempts });
    if (args.includes('update-ip-set')) {
      updateAttempts += 1;
      if (updateAttempts === 1) {
        const e = new Error('WAFOptimisticLockException: token stale');
        e.stderr = 'WAFOptimisticLockException';
        throw e;
      }
      return JSON.stringify({ NextLockToken: 'final' });
    }
    throw new Error('unexpected: ' + args.join(' '));
  };
  runOnce(fakeCli, { command: 'add', cidr: '1.2.3.4/32' });
  assert.equal(updateAttempts, 2, 'expected exactly one retry on token conflict');
});

test('runOnce: a persistent lock conflict surfaces as a failure (not silent)', () => {
  const fakeCli = (args) => {
    if (args.includes('list-ip-sets'))
      return JSON.stringify({ IPSets: [{ Name: IP_SET_NAME, Id: 'bbb-111' }] });
    if (args.includes('get-ip-set'))
      return JSON.stringify({ IPSet: { Addresses: [] }, LockToken: 'tok' });
    if (args.includes('update-ip-set')) {
      const e = new Error('WAFOptimisticLockException');
      e.stderr = 'WAFOptimisticLockException';
      throw e;
    }
    throw new Error('unexpected');
  };
  assert.throws(() => runOnce(fakeCli, { command: 'add', cidr: '1.2.3.4/32' }));
});

test('fail-closed: checkip / list-ip-sets unreachable surfaces ExternalUnavailableError, never a silent success', () => {
  const fakeCli = (args) => {
    if (args.includes('list-ip-sets')) {
      const e = new Error('Could not connect to the endpoint URL');
      e.stderr = 'Could not connect to the endpoint URL';
      throw e;
    }
    throw new Error('unexpected');
  };
  assert.throws(
    () => runOnce(fakeCli, { command: 'add', cidr: '1.2.3.4/32' }),
    ExternalUnavailableError,
  );
});
