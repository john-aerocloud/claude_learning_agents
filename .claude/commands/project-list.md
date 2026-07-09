---
description: List all projects (across their worktrees + parked repos) with status, work state, and last activity.
allowed-tools: Read, Bash
---

Act as the **orchestrator**. Projects live in per-project worktrees (branch
`instance/<project>`), not in this integration tree's `work/`. Enumerate them from
BOTH places:

- **Active worktrees** — `make project-worktrees` lists every worktree; each
  `instance/<project>` entry is a live project at `<wt>/work/<project>/`.
- **Parked (stopped) repos** — any `work/<project>/` directory in THIS integration
  tree is a project whose worktree was retired by `/project-stop` (repo parked, branch
  retained). List these too, marked `parked`.

For each project read from its actual location (worktree or parked):
- name + `status` from `project.md`,
- current work state from the DERIVED views — `views/state.md` (each item's folded
  state) and `views/stats.md` (throughput / done vs in-flight); a slice is delivered
  when its state folds to `done`, not by the presence of a `result.md` file,
- timestamp of the last `decision-log.md` entry,
- any gate awaiting human sign-off,
- unmerged process debt: does `instance/<project>` have commits not yet folded into
  `main`? (flag it — it's reintegration owed, `make project-foldback PROJECT=<p>`).

Render as a compact table (project | location | status | work state | last activity |
gate pending | process-debt). End with the recommended next command per project and the
tree/session to run it in. Note that this integration tree drives no project itself
(`work/ACTIVE` = `none`); each project is driven from its own worktree session.
