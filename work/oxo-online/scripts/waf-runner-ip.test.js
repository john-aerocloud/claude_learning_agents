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
  cidrToIp,
  exemptionKey,
  writeExemption,
  EXEMPTION_TABLE,
  EXEMPTION_REGION,
  EXEMPTION_TTL_SECONDS,
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

// ---------------------------------------------------------------------------
// s007a (DEFECT-S007-001) — the SAME add/remove cycle also Put/Deletes the
// authorizer exemption item (EXEMPT#<ip>, ttl=now+3600) in oxo-connect-attempts
// so a runner over its per-IP $connect budget is waived (one layer deeper than
// the WAF exclusion). Self-cleaning; fail-closed on add.
// ---------------------------------------------------------------------------

test('cidrToIp: strips the /len to the bare IP (the authorizer keys on sourceIp)', () => {
  assert.equal(cidrToIp('1.2.3.4/32'), '1.2.3.4');
  assert.equal(cidrToIp('10.0.0.7/32'), '10.0.0.7');
});

test('exemptionKey: namespaces the IP under EXEMPT# (distinct from the counter key)', () => {
  assert.equal(exemptionKey('1.2.3.4'), 'EXEMPT#1.2.3.4');
});

test('exemption constants pinned: table=oxo-connect-attempts, region=eu-west-2, ttl=3600', () => {
  assert.equal(EXEMPTION_TABLE, 'oxo-connect-attempts');
  assert.equal(EXEMPTION_REGION, 'eu-west-2');
  assert.equal(EXEMPTION_TTL_SECONDS, 3600);
});

test('writeExemption add: PutItem EXEMPT#<ip> into oxo-connect-attempts in eu-west-2 with profile passthrough', () => {
  let putArgs;
  const fakeCli = (args) => {
    if (args.includes('put-item')) putArgs = args;
    return '';
  };
  writeExemption(fakeCli, { command: 'add', cidr: '1.2.3.4/32', profile: 'dev-int' }, () => 1_000_000);
  assert.ok(putArgs, 'add must PutItem the exemption');
  const joined = putArgs.join(' ');
  assert.match(joined, /dynamodb put-item/);
  assert.match(joined, /--table-name oxo-connect-attempts/);
  assert.match(joined, /--region eu-west-2/);
  assert.match(joined, /--profile dev-int/);
});

test('writeExemption add: the put-item --item carries EXEMPT#<ip> and ttl=now+3600 (parsed from raw args)', () => {
  let putArgs;
  const fakeCli = (args) => {
    if (args.includes('put-item')) putArgs = args;
    return '';
  };
  const now = 1_000_000;
  writeExemption(fakeCli, { command: 'add', cidr: '1.2.3.4/32' }, () => now);
  assert.ok(putArgs, 'expected a put-item call');
  const itemIdx = putArgs.indexOf('--item');
  const item = JSON.parse(putArgs[itemIdx + 1]);
  assert.equal(item.sourceIp.S, 'EXEMPT#1.2.3.4');
  assert.equal(Number(item.ttl.N), now + 3600);
});

test('writeExemption remove: DeleteItem EXEMPT#<ip> (self-cleaning; mirrors WAF remove)', () => {
  let delArgs;
  const fakeCli = (args) => {
    if (args.includes('delete-item')) delArgs = args;
    return '';
  };
  writeExemption(fakeCli, { command: 'remove', cidr: '1.2.3.4/32' }, () => 1_000_000);
  assert.ok(delArgs, 'remove must DeleteItem the exemption');
  const joined = delArgs.join(' ');
  assert.match(joined, /dynamodb delete-item/);
  assert.match(joined, /--table-name oxo-connect-attempts/);
  const keyIdx = delArgs.indexOf('--key');
  const key = JSON.parse(delArgs[keyIdx + 1]);
  assert.equal(key.sourceIp.S, 'EXEMPT#1.2.3.4');
});

test('writeExemption add: PutItem failure fails closed (throws) so smoke does not run un-exempted', () => {
  const fakeCli = (args) => {
    if (args.includes('put-item')) {
      const e = new Error('ThrottlingException');
      e.stderr = 'ThrottlingException';
      throw e;
    }
    return '';
  };
  assert.throws(
    () => writeExemption(fakeCli, { command: 'add', cidr: '1.2.3.4/32' }, () => 1_000_000),
    ExternalUnavailableError,
  );
});

test('writeExemption remove: a DeleteItem failure is best-effort (swallowed; 1h TTL is the backstop)', () => {
  const fakeCli = (args) => {
    if (args.includes('delete-item')) {
      const e = new Error('Could not connect to the endpoint URL');
      e.stderr = 'Could not connect to the endpoint URL';
      throw e;
    }
    return '';
  };
  // remove must NOT throw — the if:always() cleanup is best-effort and the TTL
  // backstops a leaked exemption (≤1h).
  assert.doesNotThrow(() =>
    writeExemption(fakeCli, { command: 'remove', cidr: '1.2.3.4/32' }, () => 1_000_000),
  );
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
