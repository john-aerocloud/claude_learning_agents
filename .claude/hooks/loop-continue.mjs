#!/usr/bin/env node
// §F13a / EXP-ROC-016 — mechanise §F9.4 ("ENDING THE TURN *IS* the stop").
//
// §F9.4 has been prose since it was written and was violated ~20 times in a single
// session BY THE ROLE THAT OWNS IT. A rule that its own author breaks that often does
// not need restating; it needs a mechanism (§17c.5).
//
// This is a Stop hook. It BLOCKS the end of a turn when the loop could have pulled and
// did not, and it makes stopping an EXPLICIT, RECORDED act instead of the default.
//
// Three things it deliberately does NOT do, each because the obvious version traps the
// session or lies:
//
//   1. It does NOT block merely because work exists. `ready` is almost never empty here,
//      so "block while any work exists" would make the session unstoppable. It blocks
//      only when there is CAPACITY TO ACT and it was not used: ready > 0 AND wip < cap.
//      Waiting on agents at cap is legitimate — that is the loop working, not stalling.
//
//   2. It FAILS OPEN. Any error — missing project, unreadable view, bad JSON — allows the
//      stop and says why on stderr. A hook that can trap a session on its own bug is
//      worse than no hook, and this one guards the top of the process.
//
//   3. It is BOUNDED. After MAX_CONSECUTIVE blocks it allows the stop regardless, so a
//      mistake here can cost a few turns and never a session. The counter resets whenever
//      a stop is allowed.
//
// THE ESCAPE HATCH IS THE POINT, not a loophole. A legitimate stop (§F5 intake,
// requirement-complete, a §0b irreversible op, or a genuine question for the owner) is
// declared by writing ONE LINE of reason to the yield file. It is consumed on use, so it
// cannot silently persist into the next turn — every stop is deliberate and leaves a
// record.
import { readFileSync, existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAX_CONSECUTIVE = 3;
const COUNTER = join(ROOT, '.claude', '.loop-continue-count');

const allow = (why) => { try { unlinkSync(COUNTER); } catch {} if (why) process.stderr.write(`loop-continue: ${why}\n`); process.exit(0); };

try {
  const active = join(ROOT, 'work', 'ACTIVE');
  if (!existsSync(active)) allow('no work/ACTIVE — not a project tree');
  const project = readFileSync(active, 'utf8').trim();
  if (!project || project === 'none') allow(`work/ACTIVE is "${project}" — no project is being driven`);

  const yieldFile = join(ROOT, 'work', project, '.loop-yield');
  if (existsSync(yieldFile)) {
    const reason = readFileSync(yieldFile, 'utf8').trim();
    unlinkSync(yieldFile);                       // one-shot: consumed on use
    allow(`declared yield, consumed: ${reason || '(no reason given)'}`);
  }

  const qPath = join(ROOT, 'work', project, 'views', 'queues.json');
  if (!existsSync(qPath)) allow(`${qPath} absent — queue depth not established`);
  const q = JSON.parse(readFileSync(qPath, 'utf8'));
  const queues = q.queues ?? q;
  const depth = (name) => { const v = queues[name]; if (!v) return 0; const items = Array.isArray(v) ? v : (v.items ?? []); return items.length; };

  const ready = depth('ready'), wip = depth('wip'), rework = depth('rework');

  // wip_limit from the policy INPUT file, never guessed.
  let cap = 8;
  const policy = join(ROOT, 'work', project, 'queues', 'policy.csv');
  if (existsSync(policy)) {
    const row = readFileSync(policy, 'utf8').split('\n').find((l) => l.startsWith('wip,wip_limit,'));
    if (row) { const n = Number(row.split(',')[2]); if (Number.isFinite(n) && n > 0) cap = n; }
  }

  if (rework === 0 && (ready === 0 || wip >= cap)) {
    allow(`nothing pullable (ready ${ready}, wip ${wip}/${cap}, rework ${rework})`);
  }

  let n = 0;
  try { n = Number(readFileSync(COUNTER, 'utf8').trim()) || 0; } catch {}
  if (n >= MAX_CONSECUTIVE) allow(`bounded: ${n} consecutive blocks already — allowing so a hook fault cannot trap the session`);
  writeFileSync(COUNTER, String(n + 1));

  const what = rework > 0
    ? `rework is ${rework} — §F2 says drain rework FIRST`
    : `ready is ${ready} and wip is ${wip}/${cap}, so there is capacity to pull`;

  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason:
      `§F9.4 — ENDING THE TURN *IS* THE STOP. ${what}. Do not end the turn at a non-gate ` +
      `boundary: pull and dispatch the next ready work in the SAME turn, and keep chaining. ` +
      `A report is INLINE and terse; it never replaces the next dispatch.\n\n` +
      `If this stop IS legitimate — §F5 requirement intake, requirement-complete, a §0b ` +
      `irreversible operation, or a genuine question only the owner can answer — declare it ` +
      `and stop:\n` +
      `  echo "<one line: why this is a real gate>" > work/${project}/.loop-yield\n` +
      `It is consumed on use, so every deliberate stop leaves a record. ` +
      `(block ${n + 1} of ${MAX_CONSECUTIVE}; after that the stop is allowed regardless.)`,
  }));
  process.exit(0);
} catch (e) {
  allow(`FAILED OPEN: ${e && e.message ? e.message : e}`);
}
