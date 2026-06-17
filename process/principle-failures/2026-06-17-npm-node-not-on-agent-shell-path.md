# 2026-06-17 — node/npm not on the non-interactive agent-shell PATH

**Class:** capability gap (recurring per-dispatch tax), §16 tools-over-permissions.

## What happened
The engineer could not run vitest via the allowlisted `npm --prefix
<dir> run <script>` form because `npm`/`node` were not on PATH in the
non-interactive Bash the agent spawns. The interactive login shell has the
nvm-managed node bin on PATH; the agent's non-interactive shell does not inherit
it. The engineer worked around it by prefixing every test invocation with
`PATH=<nvm-node-bin>:$PATH npm --prefix … run …`.

## Why it's a deviation
1. The committed allowlist's `npm --prefix …` pattern **assumes node resolves**.
   When it doesn't, the agent must hand-assemble an env-var prefix inline — a
   novel command shape (§15 forbids hand-assembled env prefixes) that is both a
   per-command tax and a permission-prompt risk.
2. It recurs on **every** node command of **every** node-using project — a
   standing tax, not a one-off.

## Root cause
There is no `env` block in `.claude/settings.json`, so the agent shell relies on
whatever PATH the harness gives a non-interactive shell — which excludes the
nvm-installed toolchain.

## Fix (routed → cicd, EXP-050)
cicd owns `.claude/settings.json` (§16.3). Add a committed `env` block that puts
the node bin directory on PATH for all agent shells, so the plain allowlisted
`npm --prefix …` / `node …` forms resolve with no inline prefix. The node bin
location is environment-specific, so it is a committed-config value, not a rule.
Cross-project (every node project benefits), so it lives in settings, not an
agent file. Targets gross lead time (removes the prefix tax) and command-form
compliance (no hand-assembled PATH prefixes → no novel-shape prompts).
