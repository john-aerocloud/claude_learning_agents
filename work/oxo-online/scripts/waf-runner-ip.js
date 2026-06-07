#!/usr/bin/env node
'use strict';
/**
 * waf-runner-ip.js — IMP-008 runner-IP exclusion tooling (s007 UC2-S4).
 *
 * Allowlisted entry point — invoked by the root Makefile targets:
 *   make waf-runner-ip-add   CIDR=1.2.3.4/32 [AWS_PROFILE=dev-int]
 *   make waf-runner-ip-remove CIDR=1.2.3.4/32 [AWS_PROFILE=dev-int]
 * which run:
 *   node work/oxo-online/scripts/waf-runner-ip.js <add|remove> <cidr> [--profile <p>]
 *
 * WHAT IT DOES
 *   Adds/removes a CIDR from the WAFv2 IP set `oxo-test-runner-ips` (CLOUDFRONT
 *   scope, us-east-1) referenced by the CloudFront rate rule in a NOT() scope-down
 *   (s007 UC2-S2). Traffic from an IP in the set bypasses the rate-rule count so a
 *   single CI/local runner's smoke suite is not 429-throttled by the WAF.
 *
 * READ-MODIFY-WRITE WITH LOCK TOKEN (IMP-008 open risk: parallel CI)
 *   WAF IP-set updates require a LockToken (ETag-style). We:
 *     1. resolve the set Id by NAME at call time (list-ip-sets) — no hard-coded Id;
 *     2. get-ip-set -> read the current Addresses + LockToken;
 *     3. append (add) / filter (remove) the CIDR — APPEND-NEVER-REPLACE so a
 *        concurrent runner's IP is never clobbered;
 *     4. update-ip-set WITH that LockToken.
 *   On a lock-token conflict (a concurrent writer beat us) we RETRY ONCE from
 *   step 2 with a fresh token.
 *
 * FAIL-CLOSED (IMP-008 open risk: a missing exclusion masquerades as smoke 429s)
 *   Any external unavailability (cannot reach the WAF endpoint / list-ip-sets /
 *   get-ip-set fails after retries) exits NON-ZERO (ExternalUnavailableError) —
 *   never a silent success. Proceeding without the exclusion would guarantee 429
 *   failures that look like smoke failures. Bad caller input (unknown subcommand /
 *   malformed CIDR) exits non-zero as a 4xx-class CallerDataError.
 *
 * FAILURE TAXONOMY (engineer.md): log lines carry a `category` field so a support
 * engineer can split caller-data (4xx) from external-availability (5xx/timeout).
 */

const { execFileSync } = require('node:child_process');

const IP_SET_NAME = 'oxo-test-runner-ips';
const IP_SET_SCOPE = 'CLOUDFRONT';
// CLOUDFRONT-scope WAF resources live in us-east-1 (AWS hard constraint).
const IP_SET_REGION = 'us-east-1';

// s007a (DEFECT-S007-001) — authorizer per-IP exemption item. The SAME add/remove
// cycle that mutates the WAF IP set also writes/removes a self-cleaning exemption
// item in the connect-attempts table so a runner over its per-IP $connect budget
// is waived one layer deeper. Key namespace EXEMPT#<ip> (distinct from the
// counter key <ip>); 1h TTL backstop (the if:always() remove is primary cleanup).
// Home region eu-west-2 (the table is NOT in us-east-1; only the WAF set is).
const EXEMPTION_TABLE = 'oxo-connect-attempts';
const EXEMPTION_REGION = 'eu-west-2';
const EXEMPTION_TTL_SECONDS = 3600;

/** 4xx-class: the data entering our code is bad (caller's problem). */
class CallerDataError extends Error {}
/** 5xx/timeout-class: an external dependency is unavailable (fail closed). */
class ExternalUnavailableError extends Error {}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested with no AWS).
// ---------------------------------------------------------------------------

const CIDR_RE = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;

function parseArgs(argv) {
  const command = argv[0];
  if (command !== 'add' && command !== 'remove') {
    throw new CallerDataError(
      `unknown subcommand "${command}" — expected "add" or "remove"`,
    );
  }
  const cidr = argv[1];
  if (!cidr || !CIDR_RE.test(cidr)) {
    throw new CallerDataError(
      `missing or malformed CIDR "${cidr}" — expected e.g. 1.2.3.4/32`,
    );
  }
  let profile;
  const pIdx = argv.indexOf('--profile');
  if (pIdx !== -1) profile = argv[pIdx + 1];
  return { command, cidr, profile };
}

/** APPEND-never-replace on add; filter on remove. Idempotent both ways. */
function mutateAddresses(command, current, cidr) {
  if (command === 'add') {
    return current.includes(cidr) ? [...current] : [...current, cidr];
  }
  return current.filter((a) => a !== cidr);
}

/** Strip the /len so we have the bare IP the authorizer keys on (sourceIp). */
function cidrToIp(cidr) {
  return cidr.split('/')[0];
}

/** Namespace the IP under EXEMPT# — distinct from the counter PK (<ip>). */
function exemptionKey(ip) {
  return `EXEMPT#${ip}`;
}

// ---------------------------------------------------------------------------
// CLI orchestration (the `cli` runner is injected so tests use a fake).
// `cli(args: string[]) => string (stdout)`; throws on non-zero exit.
// ---------------------------------------------------------------------------

function defaultCli(args) {
  // execFileSync throws on non-zero exit; we surface stdout/stderr for triage.
  try {
    return execFileSync('aws', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    // Attach stderr so classifiers can read the AWS error text.
    err.stderr = err.stderr ? String(err.stderr) : String(err.message);
    throw err;
  }
}

function isUnavailable(err) {
  const s = String(err.stderr || err.message || '');
  return (
    /Could not connect|EndpointConnectionError|Connect timeout|RequestTimeout|ThrottlingException|InternalServiceException|ServiceUnavailable|5\d\d/.test(
      s,
    )
  );
}

function isLockConflict(err) {
  const s = String(err.stderr || err.message || '');
  return /WAFOptimisticLockException|OptimisticLock|lock token/i.test(s);
}

function profileArgs(profile) {
  return profile ? ['--profile', profile] : [];
}

/** Resolve the IP-set Id by NAME at call time (no hard-coded Id). */
function resolveIpSetId(cli, profile) {
  let out;
  try {
    out = cli([
      'wafv2',
      'list-ip-sets',
      '--scope',
      IP_SET_SCOPE,
      '--region',
      IP_SET_REGION,
      ...profileArgs(profile),
    ]);
  } catch (err) {
    if (isUnavailable(err)) {
      throw new ExternalUnavailableError(
        `list-ip-sets unavailable — failing closed: ${err.stderr || err.message}`,
      );
    }
    throw err;
  }
  const parsed = JSON.parse(out);
  const set = (parsed.IPSets || []).find((s) => s.Name === IP_SET_NAME);
  if (!set) {
    throw new ExternalUnavailableError(
      `IP set ${IP_SET_NAME} not found in ${IP_SET_SCOPE}/${IP_SET_REGION} — failing closed (deploy the IPSet first)`,
    );
  }
  return set.Id;
}

function getIpSet(cli, id, profile) {
  let out;
  try {
    out = cli([
      'wafv2',
      'get-ip-set',
      '--name',
      IP_SET_NAME,
      '--scope',
      IP_SET_SCOPE,
      '--region',
      IP_SET_REGION,
      '--id',
      id,
      ...profileArgs(profile),
    ]);
  } catch (err) {
    if (isUnavailable(err)) {
      throw new ExternalUnavailableError(
        `get-ip-set unavailable — failing closed: ${err.stderr || err.message}`,
      );
    }
    throw err;
  }
  const parsed = JSON.parse(out);
  const lockToken = parsed.LockToken;
  if (!lockToken) {
    throw new ExternalUnavailableError(
      'get-ip-set returned no LockToken — failing closed (cannot safely update)',
    );
  }
  return { addresses: parsed.IPSet?.Addresses || [], lockToken };
}

function updateIpSet(cli, id, addresses, lockToken, profile) {
  cli([
    'wafv2',
    'update-ip-set',
    '--name',
    IP_SET_NAME,
    '--scope',
    IP_SET_SCOPE,
    '--region',
    IP_SET_REGION,
    '--id',
    id,
    '--lock-token',
    lockToken,
    '--addresses',
    ...addresses,
    ...profileArgs(profile),
  ]);
}

/**
 * One add/remove operation: resolve -> get(token) -> mutate -> update(token),
 * retrying ONCE on a lock-token conflict. Fails closed (throws) on external
 * unavailability — never returns success without the exclusion in place.
 */
function runOnce(cli, { command, cidr, profile }) {
  const id = resolveIpSetId(cli, profile);

  const attempt = () => {
    const { addresses, lockToken } = getIpSet(cli, id, profile);
    const next = mutateAddresses(command, addresses, cidr);
    try {
      updateIpSet(cli, id, next, lockToken, profile);
    } catch (err) {
      if (isUnavailable(err)) {
        throw new ExternalUnavailableError(
          `update-ip-set unavailable — failing closed: ${err.stderr || err.message}`,
        );
      }
      throw err; // lock conflict or other — handled by caller's retry
    }
    return next;
  };

  try {
    const next = attempt();
    log('ok', { command, cidr, count: next.length, category: 'success' });
    return next;
  } catch (err) {
    if (isLockConflict(err)) {
      log('retry', { command, cidr, category: 'lock-conflict' });
      // Retry ONCE with a fresh token (a concurrent writer beat us).
      const next = attempt();
      log('ok', { command, cidr, count: next.length, category: 'success-after-retry' });
      return next;
    }
    throw err;
  }
}

/**
 * s007a (DEFECT-S007-001) — write/remove the authorizer exemption item for this
 * runner IP, mirroring the WAF add/remove. `now` is injected for deterministic
 * tests (defaults to wall-clock seconds).
 *   add    -> PutItem  { sourceIp: EXEMPT#<ip>, ttl: now + 3600 } — FAIL-CLOSED:
 *             a Put failure throws ExternalUnavailableError so the caller exits
 *             non-zero and the smoke does NOT run un-exempted.
 *   remove -> DeleteItem { sourceIp: EXEMPT#<ip> } — BEST-EFFORT: a Delete failure
 *             is swallowed (the if:always() remove must not fail the job) since the
 *             1h TTL is the backstop for a leaked exemption.
 * Issues ONLY PutItem/DeleteItem on the connect-attempts table under the EXEMPT#
 * namespace — exactly the deploy-role ConnectExemptionWrite grant (LeadingKeys
 * EXEMPT#*). No UpdateItem, no read, no counter key.
 */
function writeExemption(cli, { command, cidr, profile }, now = () => Math.floor(Date.now() / 1000)) {
  const ip = cidrToIp(cidr);
  const key = exemptionKey(ip);
  if (command === 'add') {
    const ttl = now() + EXEMPTION_TTL_SECONDS;
    const item = JSON.stringify({ sourceIp: { S: key }, ttl: { N: String(ttl) } });
    try {
      cli([
        'dynamodb',
        'put-item',
        '--table-name',
        EXEMPTION_TABLE,
        '--region',
        EXEMPTION_REGION,
        '--item',
        item,
        ...profileArgs(profile),
      ]);
    } catch (err) {
      // Fail closed: an un-written exemption means the runner stays rate-blocked,
      // which would look like smoke failures — surface it before smoke runs.
      log('fail', { command, cidr, category: 'external-availability', op: 'exemption-put', error: err.stderr || err.message });
      throw new ExternalUnavailableError(
        `exemption put-item failed — failing closed: ${err.stderr || err.message}`,
      );
    }
    log('exemption-ok', { command, key, ttl, category: 'success' });
    return;
  }
  // remove — best-effort self-clean; TTL is the backstop.
  const keyJson = JSON.stringify({ sourceIp: { S: key } });
  try {
    cli([
      'dynamodb',
      'delete-item',
      '--table-name',
      EXEMPTION_TABLE,
      '--region',
      EXEMPTION_REGION,
      '--key',
      keyJson,
      ...profileArgs(profile),
    ]);
    log('exemption-ok', { command, key, category: 'success' });
  } catch (err) {
    // Best-effort: do NOT throw. The 1h TTL bounds any leaked exemption.
    log('exemption-skip', { command, key, category: 'best-effort-cleanup', error: err.stderr || err.message });
  }
}

function log(evt, fields) {
  // Structured single-line log (support runbook input).
  console.log(JSON.stringify({ evt: `waf-runner-ip-${evt}`, ...fields }));
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    log('reject', { category: '4xx-caller-data', error: err.message });
    process.exitCode = 2;
    return;
  }
  try {
    // WAF IP-set exclusion FIRST (the existing IMP-008 op, fail-closed on add).
    runOnce(defaultCli, args);
    // s007a — then the authorizer per-IP exemption (same self-cleaning cycle).
    // On add this fails closed; on remove it is best-effort (TTL backstop).
    writeExemption(defaultCli, args);
  } catch (err) {
    const category =
      err instanceof ExternalUnavailableError
        ? 'external-availability'
        : err instanceof CallerDataError
          ? '4xx-caller-data'
          : 'internal-service';
    log('fail', { command: args.command, cidr: args.cidr, category, error: err.message });
    // Fail closed: non-zero exit so the smoke does NOT run without the exclusion.
    process.exitCode = 1;
  }
}

// Export pure + orchestration helpers for unit tests; run as CLI when invoked
// directly.
module.exports = {
  parseArgs,
  mutateAddresses,
  resolveIpSetId,
  getIpSet,
  updateIpSet,
  runOnce,
  cidrToIp,
  exemptionKey,
  writeExemption,
  ExternalUnavailableError,
  CallerDataError,
  IP_SET_NAME,
  IP_SET_SCOPE,
  IP_SET_REGION,
  EXEMPTION_TABLE,
  EXEMPTION_REGION,
  EXEMPTION_TTL_SECONDS,
};

if (require.main === module) {
  main(process.argv.slice(2));
}
