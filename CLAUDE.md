# Goal

Create a series of agents that are capable of improving over time by feeding them projects.

I want to then use these agents to build software.

# How this repo operates

See `README.md` for the full system. In short:

- Agents live in `.claude/agents/` (orchestrator + flow-manager, product,
  solution-architect, cicd, engineer, ui-designer, tester, documenter). The
  orchestrator regulates flow only and delegates every product/architecture/
  engineering decision; the flow-manager (v40) owns queue state and flow decisions.
- **v40 — pull-based flow.** Delivery is pull, not push: a continuous inner dev
  loop (`/loop-run`) pulls the maximal independent set of ready use-cases from
  costed, per-queue-buffered queues; product replenishes just-in-time; **two gates
  only** — intake (`/intake`) and infra-bearing deploy. Cross-agent rules:
  `process/process-current.md` **STAGE F**. Rationale/diagrams/worked-retro:
  `Version2-design/`. Use `/flow-status` to see queues, buffers, and time thieves.
- Drive work with the slash commands in `.claude/commands/`: v40 `/intake`,
  `/loop-run`, `/flow-status`; plus `/project-new`, `/slice-next` (now JIT
  replenishment), `/iteration-run` (one loop pass), `/retro`, `/defect`,
  `/project-stop`.
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
- **Slice artifacts are project output:** every `slice.md` / `use-cases.md` /
  `acceptance.md` / `route.md` / `ui-design.md` / `test-plan.md` / `result.md`
  is written and read under `work/<project>/slices/<nnn>-<slug>/` — NEVER a
  bare root-level `slices/`. A bare `slices/` path leaks one project's output
  into the system root and is a principle failure. (Note: `/process/improvement-slices/`
  is a separate, persistent process concept and is unrelated.)
- **Two repositories — project output vs the agent system (v50).** Each
  `work/<project>/` is its **own independent git repo** (so a project can be
  lifted out and live standalone). Commit **project output** inside it:
  `git -C work/<project> add <paths> && git -C work/<project> commit -m "…"`.
  Commit **agent-structure / process** changes (`.claude/`, `process/`,
  `CLAUDE.md`, `README.md`) in THIS parent repo. The parent `.gitignore`s
  `/work/*/`, so it never tracks project contents; `work/ACTIVE`,
  `work/README.md`, and `work/_TEMPLATE/` stay in the parent as agent-system
  state. Never mix the two in one commit (process §14).