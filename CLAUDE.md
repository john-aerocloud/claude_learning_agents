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