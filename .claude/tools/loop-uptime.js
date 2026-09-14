#!/usr/bin/env node
// loop-uptime — how much of the measured window was the loop actually RUNNING?
//
// WHY THIS EXISTS. Gross lead time is wall-clock, and `/loop-run` is specified as a
// continuous process (§F9). Those two facts are only consistent while the loop is
// actually running — and until now NOTHING recorded whether it was. So the figure every
// retro names its constraint from, and gates its entire change budget on (§5b), is
// bidirectionally sensitive to an input nobody measured.
//
// That was written down as a principle failure on 2026-08-24
// (`a-constraint-movement-quoted-without-loop-uptime`, OagEventSource, 60.9h of downtime
// accounting for 72% of the constraint's median) and NOT MECHANISED. Three weeks later
// ROC took a SIXTEEN-DAY outage that no mechanism noticed, and the same retro-time
// question — "did this constraint move, or did we just stop?" — was unanswerable again.
// A recorded root cause that is left un-mechanised does not stay the same size.
//
// WHAT IT MEASURES, and what it deliberately does NOT.
// It needs no new recording: the item event logs ALREADY carry every timestamp the system
// has produced. A QUIET PERIOD is a gap between consecutive events across the whole
// project longer than --gap-hours. That is an honest proxy and it is stated as one:
//
//   * It CANNOT distinguish "no session was running" from "a session was running and
//     produced nothing." Both are loop downtime for lead-time purposes, which is why the
//     proxy is adequate — but it is not an attendance record and must not be quoted as one.
//   * It reads the events as filed. An event appended late lands at its real `ts:`, so a
//     backfilled log looks busier than the wall-clock was. Backfill is rare here (§17f
//     holds it apart) but the direction of the bias is toward OVER-stating uptime.
//   * A gap at the very END of the window (now - last event) IS counted: an outage you are
//     still inside is the one that matters most, and the 2026-08-29 outage was invisible
//     precisely because everyone kept looking backwards.
//
// Usage:
//   node .claude/tools/loop-uptime.js --project ROC [--since 2026-08-29T21:26:39Z]
//                                     [--gap-hours 12] [--top 10] [--json]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const flag = (name) => argv.includes(`--${name}`);

const project = arg('project', existsSync(join(ROOT, 'work', 'ACTIVE'))
  ? readFileSync(join(ROOT, 'work', 'ACTIVE'), 'utf8').trim() : null);
if (!project || project === 'none') {
  process.stderr.write('loop-uptime: no project (pass --project <name>)\n');
  process.exit(2);
}

const gapHours = Number(arg('gap-hours', 12));
const top = Number(arg('top', 10));
const sinceRaw = arg('since', null);
const since = sinceRaw ? Date.parse(sinceRaw) : null;
if (sinceRaw && !Number.isFinite(since)) {
  process.stderr.write(`loop-uptime: --since "${sinceRaw}" is not a parseable timestamp\n`);
  process.exit(2);
}

// --- collect every event timestamp the project has ever recorded -------------------
const stamps = [];
let files = 0;
for (const sub of ['active', 'done']) {
  const dir = join(ROOT, 'work', project, 'items', sub);
  if (!existsSync(dir)) continue;
  for (const fn of readdirSync(dir)) {
    if (!fn.endsWith('.md')) continue;
    files++;
    const txt = readFileSync(join(dir, fn), 'utf8');
    const re = /\{ts:\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(txt)) !== null) {
      const t = Date.parse(m[1]);
      if (Number.isFinite(t)) stamps.push(t);
    }
  }
}
if (!stamps.length) {
  process.stderr.write(`loop-uptime: no events found under work/${project}/items — nothing to measure\n`);
  process.exit(2);
}
stamps.sort((a, b) => a - b);

const now = Date.now();
const from = since ?? stamps[0];
const to = now;
const inWindow = stamps.filter((t) => t >= from && t <= to);

// A window with no events at all is a TOTAL outage, not an error. Say so.
const elapsedMs = to - from;
const threshold = gapHours * 3600e3;

// Gaps: between consecutive in-window events, plus the leading gap (from -> first event)
// and the trailing gap (last event -> now). Both edges count; see the header note.
const marks = [from, ...inWindow, to];
const gaps = [];
for (let i = 1; i < marks.length; i++) {
  const d = marks[i] - marks[i - 1];
  if (d > threshold) gaps.push({ start: marks[i - 1], end: marks[i], ms: d });
}
const quietMs = gaps.reduce((s, g) => s + g.ms, 0);
const uptimePct = elapsedMs > 0 ? (1 - quietMs / elapsedMs) * 100 : 100;

const iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
const dur = (ms) => {
  const h = ms / 3600e3;
  return h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`;
};

if (flag('json')) {
  process.stdout.write(JSON.stringify({
    project, from: iso(from), to: iso(to), gap_hours: gapHours,
    items_read: files, events_in_window: inWindow.length,
    elapsed_s: Math.round(elapsedMs / 1000),
    quiet_s: Math.round(quietMs / 1000),
    uptime_pct: Number(uptimePct.toFixed(2)),
    quiet_periods: gaps.map((g) => ({ from: iso(g.start), to: iso(g.end), hours: Number((g.ms / 3600e3).toFixed(2)) })),
  }, null, 1) + '\n');
  process.exit(0);
}

process.stdout.write(
  `loop-uptime[${project}] ${iso(from)} -> ${iso(to)} (${dur(elapsedMs)}), quiet = any gap > ${gapHours}h\n` +
  `  events in window: ${inWindow.length} across ${files} item files\n` +
  `  LOOP UPTIME: ${uptimePct.toFixed(1)}%  —  quiet ${dur(quietMs)} of ${dur(elapsedMs)} in ${gaps.length} period(s)\n`);

if (!gaps.length) {
  process.stdout.write(`  no quiet period exceeded ${gapHours}h.\n`);
} else {
  process.stdout.write(`  longest quiet periods:\n`);
  for (const g of [...gaps].sort((a, b) => b.ms - a.ms).slice(0, top)) {
    const trailing = g.end === to ? '  <-- STILL INSIDE THIS ONE' : '';
    process.stdout.write(`    ${dur(g.ms).padStart(7)}  ${iso(g.start)} -> ${iso(g.end)}${trailing}\n`);
  }
}
process.stdout.write(
  `  READ THIS BEFORE QUOTING A CONSTRAINT MOVEMENT: downtime is real gross lead time and is\n` +
  `  NOT to be netted off, but it is not evidence about how any AGENT performed. A constraint\n` +
  `  that moved across a window with low uptime moved for a reason this figure explains first.\n` +
  `  Proxy, not an attendance record: a running session that produced nothing reads as quiet.\n`);
