# 2026-06-12 — engineer (UC-S015-4): browser suite run against the operator's live :5173

**What happened:** the first `test:browser` runs for UC-S015-4 were launched
without `OBSERVATORY_E2E_PORT`, so Playwright's `reuseExistingServer` matched
the operator's running :5173 dev server (real repo data, no fixture rows).
Result: ~21 false-red e2e failures (fixture item `UC-D1-2` absent on real
data) and two wasted diagnosis runs before the cause was identified.

**Principle violated:** the dispatch brief's standing rule — "NEVER kill
:5173; ephemeral ports" — implies all fixture-backed browser runs use
`OBSERVATORY_E2E_PORT=<ephemeral>`. Read traffic only, no harm to the live
server, but the run shape contradicted the brief and produced false signal.

**Correction:** re-ran with `OBSERVATORY_E2E_PORT=5277` — full suite
153/153 green. The live :5173 was used only for its sanctioned purpose: the
`REUSE_SERVER=1` real-data probe (`e2e/reslice-prompt-real-data.spec.js`).

**Prevention suggestion (for cicd/tooling):** a root make target
(`make e2e-fixture`) that bakes the ephemeral-port env var, so the
fixture-vs-live distinction is a committed command shape rather than agent
memory.
