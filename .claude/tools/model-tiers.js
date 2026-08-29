#!/usr/bin/env node
// DOES §7a's TIER LIST MATCH THE AGENT FRONTMATTER? — process §7a, v172.
//
// WHY THIS EXISTS. §7a carried a hand-maintained sentence naming every agent's model tier.
// It said `documenter` was haiku; it had been **opus**. It omitted `linear` and `jira`
// entirely. Nobody noticed, because nothing compared the two — a record beside the thing it
// describes, perishing quietly (§F9g). A tier list that is wrong is worse than none: it is
// what a retro reads when deciding what to change.
//
// So the list is ASSERTED rather than maintained. Frontmatter is the truth; §7a must agree.
//
// Exit 0 = agree. Exit 1 = disagree (or a tier is unreadable — NOT a pass, §17i).
//
//   node .claude/tools/model-tiers.js [--json]

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const json = process.argv.includes("--json");
const AGENT_DIR = ".claude/agents";
const PROCESS = "process/process-current.md";

// --- truth: the frontmatter -----------------------------------------------------------
const actual = {};
for (const f of readdirSync(AGENT_DIR).filter((n) => n.endsWith(".md"))) {
  const name = f.replace(/\.md$/, "");
  const src = readFileSync(join(AGENT_DIR, f), "utf8");
  const fm = src.split(/^---$/m)[1] ?? "";
  const m = fm.match(/^model:\s*(\S+)\s*$/m);
  actual[name] = m ? m[1] : "<inherit>";
}

// --- claim: §7a's ```model-tiers fenced block (machine-readable, never prose) -----------
const proc = readFileSync(PROCESS, "utf8");
const block = proc.match(/```model-tiers\n([\s\S]*?)```/);
if (!block) {
  fail([
    "§7a has no ```model-tiers block in " + PROCESS + " — the claim could not be read, and that is NOT a pass (§17i).",
  ]);
}
const claimed = {};
for (const line of block[1].split("\n")) {
  const m = line.trim().match(/^(opus|sonnet|haiku|fable)\s+([a-z0-9-]+)$/);
  if (m) claimed[m[2]] = m[1];
  else if (line.trim()) fail([`unparseable line in the model-tiers block: ${JSON.stringify(line)} — expected "<tier> <agent>".`]);
}

const problems = [];
for (const [agent, tier] of Object.entries(actual)) {
  if (tier === "<inherit>") continue;
  if (!(agent in claimed)) problems.push(`§7a does not name \`${agent}\` at all — it is on \`${tier}\`. An omitted agent is how \`linear\`/\`jira\` went untracked.`);
  else if (claimed[agent] !== tier) problems.push(`\`${agent}\`: §7a says **${claimed[agent]}**, frontmatter says **${tier}**. Frontmatter is the truth — fix the prose, or the agent, deliberately.`);
}
for (const agent of Object.keys(claimed)) {
  if (!(agent in actual)) problems.push(`§7a names \`${agent}\`, but there is no \`${AGENT_DIR}/${agent}.md\` — a tier for an agent that does not exist.`);
}

function fail(list) {
  if (json) console.log(JSON.stringify({ status: "MISMATCH", problems: list, actual }, null, 2));
  else {
    console.log("MODEL-TIERS: MISMATCH");
    for (const p of list) console.log("  - " + p);
  }
  process.exit(1);
}
if (problems.length) fail(problems);
if (json) console.log(JSON.stringify({ status: "OK", actual }, null, 2));
else {
  console.log("MODEL-TIERS: OK — §7a matches the agent frontmatter.");
  for (const [a, t] of Object.entries(actual).sort()) console.log(`  ${t.padEnd(8)} ${a}`);
}
