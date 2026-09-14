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
//      only when there is CAPACITY TO ACT and it was not used.
//
//      OCCUPANCY IS NOT ACTIVITY (v176). Until 2026-09-14 that capacity test was
//      `wip < cap` on QUEUE DEPTH, with the comment "waiting on agents at cap is
//      legitimate — that is the loop working, not stalling." That reading is false, and
//      it is false in exactly the case this hook exists to catch. ROC's `wip` has been
//      16 against a cap of 8 since 2026-08-29 with NINE of those slots idle — so the
//      "agents are busy" branch was true *because* work had stalled, and this hook
//      permitted every stop for SIXTEEN DAYS. DEF-ROC-153's fix sat pushed and green in
//      `validating` for 15.8 of them with no tester ever dispatched.
//
//      The failure shape is worth naming, because it is not a typo: the guard's stall
//      signal and its healthy signal were THE SAME NUMBER, so the worse the stall got,
//      the more confidently the guard licensed the stop. `loop-gate` had the right words
//      for it all along — "THIS DEPTH IS OCCUPANCY, NOT ACTIVITY ... those slots are NOT
//      capacity in use" — and this hook simply never asked it.
//
//      So capacity is now measured on ACTIVITY: a `wip` slot whose item has recorded no
//      event for STALE_HOURS is not an agent working, it is work owed a decision, and it
//      blocks the stop in its own right regardless of `ready` depth.
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
  const listOf = (name) => { const v = queues[name]; if (!v) return []; return Array.isArray(v) ? v : (v.items ?? []); };
  const depth = (name) => listOf(name).length;

  const ready = depth('ready'), wip = depth('wip'), rework = depth('rework');

  // wip_limit from the policy INPUT file, never guessed.
  let cap = 8;
  const policy = join(ROOT, 'work', project, 'queues', 'policy.csv');
  if (existsSync(policy)) {
    const row = readFileSync(policy, 'utf8').split('\n').find((l) => l.startsWith('wip,wip_limit,'));
    if (row) { const n = Number(row.split(',')[2]); if (Number.isFinite(n) && n > 0) cap = n; }
  }

  // --- OCCUPANCY IS NOT ACTIVITY (v176) ------------------------------------------
  // A `wip` slot counts as capacity-in-use only if its item has recorded an event
  // recently. Everything here is best-effort: if the item store cannot be read we fall
  // back to the old depth reading rather than risk trapping a session on this hook's
  // own bug (non-negotiable #2). `idleUnknown` records that we fell back, so the block
  // reason never claims an activity reading it does not have.
  const STALE_HOURS = Number(process.env.LOOP_STALE_HOURS) > 0 ? Number(process.env.LOOP_STALE_HOURS) : 24;
  const now = Date.now();
  let idleWip = [], idleUnknown = false;
  try {
    for (const id of listOf('wip')) {
      let path = null;
      for (const sub of ['active', 'done']) {
        const p = join(ROOT, 'work', project, 'items', sub, `${id}.md`);
        if (existsSync(p)) { path = p; break; }
      }
      if (!path) { idleUnknown = true; continue; }
      const txt = readFileSync(path, 'utf8');
      let last = null, m;
      const re = /\{ts:\s*"([^"]+)"/g;
      while ((m = re.exec(txt)) !== null) last = m[1];
      const t = last ? Date.parse(last) : NaN;
      if (!Number.isFinite(t)) { idleUnknown = true; continue; }
      if (now - t > STALE_HOURS * 3600e3) idleWip.push({ id, hours: (now - t) / 3600e3 });
    }
  } catch { idleWip = []; idleUnknown = true; }

  // Capacity is ACTIVE slots, never occupied ones. If we could not establish activity,
  // `activeWip` degrades to the old occupancy figure — conservative, and disclosed.
  const activeWip = idleUnknown && idleWip.length === 0 ? wip : wip - idleWip.length;

  if (rework === 0 && idleWip.length === 0 && (ready === 0 || activeWip >= cap)) {
    allow(`nothing pullable (ready ${ready}, wip ${wip}/${cap} with ${activeWip} active` +
          `${idleUnknown ? ', activity NOT established for some items' : ''}, rework ${rework})`);
  }

  let n = 0;
  try { n = Number(readFileSync(COUNTER, 'utf8').trim()) || 0; } catch {}
  if (n >= MAX_CONSECUTIVE) allow(`bounded: ${n} consecutive blocks already — allowing so a hook fault cannot trap the session`);
  writeFileSync(COUNTER, String(n + 1));

  const idleList = idleWip
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 6)
    .map((x) => `${x.id} (${x.hours < 48 ? `${x.hours.toFixed(1)}h` : `${(x.hours / 24).toFixed(1)}d`})`)
    .join(', ');

  const what = rework > 0
    ? `rework is ${rework} — §F2 says drain rework FIRST`
    : idleWip.length > 0
      ? `wip is ${wip}/${cap} but only ${activeWip} of those slots show any activity. ` +
        `${idleWip.length} have recorded NOTHING for over ${STALE_HOURS}h: ${idleList}` +
        `${idleWip.length > 6 ? ` and ${idleWip.length - 6} more` : ''}. ` +
        `OCCUPANCY IS NOT ACTIVITY — an idle slot is not an agent working, it is work owed ` +
        `a decision, and it is the cheapest work available because it was already chosen`
      : `ready is ${ready} and wip is ${wip}/${cap} with ${activeWip} active, so there is capacity to pull`;

  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason:
      `§F9.4 — ENDING THE TURN *IS* THE STOP. ${what}. Do not end the turn at a non-gate ` +
      `boundary: pull and dispatch the next ready work in the SAME turn, and keep chaining. ` +
      `A report is INLINE and terse; it never replaces the next dispatch.\n\n` +
      (idleWip.length > 0
        ? `Each idle item takes ONE of three decisions — it is an idle FACT, not a verdict, ` +
          `because nothing records whether a dispatch is in flight:\n` +
          `  (a) RE-DISPATCH it — nobody is holding it;\n` +
          `  (b) RELEASE it — say what it waits on: make wi-append PROJECT=${project} ` +
          `ID=<id> EVENT=blocked AGENT=flow-manager NOTE=<what it waits on>;\n` +
          `  (c) if it IS being worked, append the event already earned so the clock restarts.\n` +
          `Do NOT raise the wip cap to work around it — the cap is not what is full.\n\n`
        : '') +
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
