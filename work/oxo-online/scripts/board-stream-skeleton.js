#!/usr/bin/env node
/**
 * board-stream-skeleton.js — §30 walking-skeleton probe for the FIRST DynamoDB
 * Stream in the system (s009 UC2, T-LB-10). Drives ONE controlled game-over
 * transition through the DEPLOYED stream path and asserts the at-least-once →
 * idempotent contract end-to-end on the REAL platform — exactly where un-modelled
 * stream semantics (sharding, redelivery, filter-criteria evaluation, real
 * set-contains atomicity) hide and a local mock cannot see.
 *
 * Allowlisted entry point (via the root Makefile `board-stream-skeleton` target):
 *   node work/oxo-online/scripts/board-stream-skeleton.js <args>
 * Run from the project root. Requires AWS creds in env (SSO profile exported).
 *
 * WHY a controlled Games write (not a full two-browser game): the §30 contract
 * under test is the STREAM → board-fn → Leaderboard idempotency, NOT the move
 * relay (already proven by move-skeleton). The cleanest deterministic trigger is
 * to PUT an `active` Games item carrying host/guest names, then a conditional
 * UpdateItem flipping status active→won — the SAME transition the move CAS emits
 * (delta §3). That fires the real stream record through the real event-source
 * filter into the real board-fn against the real Leaderboard. The gameId is a
 * fresh skeleton UUID so the probe never collides with live play.
 *
 * Probe A (one real game-over → exactly one increment):
 *   - winner Leaderboard.wins 0→1, loser losses 0→1
 *   - each scoredGames contains the gameId EXACTLY once
 *
 * Probe B (replay → no double-count):
 *   - re-PUT the SAME won item (re-emit the transition; at-least-once analogue)
 *   - BOTH Leaderboard rows BYTE-IDENTICAL to after Probe A (no counter moved)
 *   - ConditionalCheckFailed observed in oxo-board-fn CloudWatch logs
 *
 * AWS access: via the `aws` CLI (child_process). get-item / scan /
 * filter-log-events are allowlisted. put-item / update-item are NAMED to cicd as
 * a same-slice allowlist extension (the skeleton is the only writer of a
 * skeleton-prefixed Games item; it never touches a live game).
 *
 * Output: a JSON line per probe, then { "skeleton": "pass" } (exit 0) or
 *   { "skeleton": "fail", ... } (exit 1).
 *
 * Uses Node built-ins only (child_process, crypto). No SDK dependency.
 */

const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');

function parseArgs(argv) {
  const a = { region: 'eu-west-2', timeoutMs: 30000 };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--games-table') a.gamesTable = argv[++i];
    else if (argv[i] === '--leaderboard-table') a.leaderboardTable = argv[++i];
    else if (argv[i] === '--board-fn-log-group') a.logGroup = argv[++i];
    else if (argv[i] === '--region') a.region = argv[++i];
    else if (argv[i] === '--profile') a.profile = argv[++i];
    else if (argv[i] === '--timeout') a.timeoutMs = Number(argv[++i]);
  }
  return a;
}

function aws(args, opts) {
  const full = [...args, '--region', OPTS.region, '--output', 'json'];
  if (OPTS.profile) full.push('--profile', OPTS.profile);
  const out = execFileSync('aws', full, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
  return out ? JSON.parse(out) : {};
}

let OPTS;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Read a Leaderboard row by playerName; returns null if absent. */
function getRow(name) {
  const res = aws([
    'dynamodb', 'get-item',
    '--table-name', OPTS.leaderboardTable,
    '--key', JSON.stringify({ playerName: { S: name } }),
    '--consistent-read',
  ]);
  if (!res.Item) return null;
  const it = res.Item;
  const n = (k) => (it[k] && it[k].N ? Number(it[k].N) : 0);
  const scored = it.scoredGames && it.scoredGames.SS ? it.scoredGames.SS : [];
  return { wins: n('wins'), draws: n('draws'), losses: n('losses'), scoredGames: scored };
}

/** PUT an active Games item carrying the two names (the pre-game-over state). */
function putActiveGame(gameId, hostName, guestName) {
  const ttl = Math.floor(Date.now() / 1000) + 3600;
  aws([
    'dynamodb', 'put-item',
    '--table-name', OPTS.gamesTable,
    '--item', JSON.stringify({
      gameId: { S: gameId },
      status: { S: 'active' },
      hostName: { S: hostName },
      guestName: { S: guestName },
      winner: { S: 'X' },
      board: { S: 'XXX OO   ' },
      ttl: { N: String(ttl) },
    }),
  ]);
}

/** Flip status active→won (the transition the stream filter passes to board-fn). */
function winGame(gameId) {
  aws([
    'dynamodb', 'update-item',
    '--table-name', OPTS.gamesTable,
    '--key', JSON.stringify({ gameId: { S: gameId } }),
    '--update-expression', 'SET #s = :won',
    '--condition-expression', '#s = :active',
    '--expression-attribute-names', JSON.stringify({ '#s': 'status' }),
    '--expression-attribute-values', JSON.stringify({ ':won': { S: 'won' }, ':active': { S: 'active' } }),
  ]);
}

/** Poll for a Leaderboard row to reach an expected counter, up to timeout. */
async function waitForCounter(name, field, expected) {
  const deadline = Date.now() + OPTS.timeoutMs;
  while (Date.now() < deadline) {
    const row = getRow(name);
    if (row && row[field] >= expected) return row;
    await sleep(2000);
  }
  return getRow(name);
}

/** Count ConditionalCheckFailed-equivalent log lines for board-fn since `sinceMs`. */
function conditionalFailuresSince(sinceMs) {
  const res = aws([
    'logs', 'filter-log-events',
    '--log-group-name', OPTS.logGroup,
    '--start-time', String(sinceMs),
    '--filter-pattern', 'already_scored',
  ]);
  return (res.events || []).length;
}

async function main() {
  OPTS = parseArgs(process.argv);
  const required = {
    gamesTable: '--games-table',
    leaderboardTable: '--leaderboard-table',
    logGroup: '--board-fn-log-group',
  };
  for (const [key, flag] of Object.entries(required)) {
    if (!OPTS[key]) {
      console.error(JSON.stringify({ skeleton: 'fail', reason: `missing ${flag}` }));
      process.exit(2);
    }
  }

  // Fresh skeleton names so the probe is isolated from live play and repeatable.
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const gameId = `skel-${randomUUID()}`;
  const winner = `W${tag}`.slice(0, 10);
  const loser = `L${tag}`.slice(0, 10);

  const before = { winner: getRow(winner), loser: getRow(loser) };
  const startMs = Date.now() - 1000;

  // --- Probe A: one real game-over → exactly one increment ------------------
  putActiveGame(gameId, winner, loser);
  await sleep(500);
  winGame(gameId);

  const winRow = await waitForCounter(winner, 'wins', (before.winner?.wins ?? 0) + 1);
  const loseRow = await waitForCounter(loser, 'losses', (before.loser?.losses ?? 0) + 1);

  const probeA = {
    winnerWins: winRow?.wins,
    loserLosses: loseRow?.losses,
    winnerScoredOnce: (winRow?.scoredGames || []).filter((g) => g === gameId).length === 1,
    loserScoredOnce: (loseRow?.scoredGames || []).filter((g) => g === gameId).length === 1,
  };
  const aPass =
    winRow && loseRow &&
    winRow.wins === (before.winner?.wins ?? 0) + 1 &&
    loseRow.losses === (before.loser?.losses ?? 0) + 1 &&
    probeA.winnerScoredOnce && probeA.loserScoredOnce;
  console.log(JSON.stringify({ probe: 'A', pass: !!aPass, ...probeA }));

  // --- Probe B: replay → no double-count ------------------------------------
  // Re-emit the SAME transition (re-PUT active then win again). board-fn runs
  // the SAME two conditional UpdateItems; contains(scoredGames, gameId) is now
  // TRUE → ConditionalCheckFailed → swallowed (logged `already_scored`). The
  // rows must be byte-identical to after Probe A.
  const afterA = { winner: getRow(winner), loser: getRow(loser) };
  putActiveGame(gameId, winner, loser); // re-set to active (same gameId)
  await sleep(500);
  winGame(gameId); // same active→won transition → redelivered tally

  await sleep(8000); // allow the stream + board-fn to process the replay
  const afterB = { winner: getRow(winner), loser: getRow(loser) };

  const byteIdentical =
    JSON.stringify(afterA.winner) === JSON.stringify(afterB.winner) &&
    JSON.stringify(afterA.loser) === JSON.stringify(afterB.loser);
  const condFails = conditionalFailuresSince(startMs);
  const probeB = { byteIdentical, alreadyScoredLogLines: condFails };
  const bPass = byteIdentical && condFails >= 1;
  console.log(JSON.stringify({ probe: 'B', pass: !!bPass, ...probeB }));

  if (aPass && bPass) {
    console.log(JSON.stringify({ skeleton: 'pass', gameId, winner, loser }));
    process.exit(0);
  }
  console.log(JSON.stringify({ skeleton: 'fail', gameId, winner, loser, probeA, probeB }));
  process.exit(1);
}

main().catch((err) => {
  console.error(JSON.stringify({ skeleton: 'fail', error: String(err && err.message ? err.message : err) }));
  process.exit(1);
});
