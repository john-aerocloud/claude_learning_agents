# Goal

Create a series of agents that are capable of improving over time by feeding them projects.

I want to then use these agents to build software.

# How this repo operates

See `README.md` for the full system. In short:

- Agents live in `.claude/agents/` (orchestrator + product, solution-architect,
  cicd, engineer, tester). The orchestrator regulates flow only and delegates
  every product/architecture/engineering decision.
- Drive work with the slash commands in `.claude/commands/`: `/project-new`,
  `/requirement-new`, `/slice-next`, `/iteration-run`, `/retro`, `/project-stop`.
- `/process` is PERSISTENT agent self-state (process, principles, DORA, learned
  failures) and must never reference a specific project. `/work` is RESETTABLE
  project output.
- Before crawling files, read the `process-framework` skill — it says what to
  load for each task and keeps context small. Record/compute metrics with the
  `dora-ledger` skill.

# Working-directory conventions

**All commands run from the project root** (the directory containing this file).

- Use `npm --prefix work/<project>/src/app run <cmd>` instead of `cd ... && npm run <cmd>`
- Run `python3 .claude/skills/dora-ledger/scripts/dora.py` from project root only — the path is root-relative
- The committed allowlist is in `.claude/settings.json`; add novel patterns there, not in `.local.json`