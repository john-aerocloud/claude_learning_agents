# DEFECT-003 — map shows stale data as if live (no disconnect/stale signal)

**Reported:** 2026-06-10 · **Status:** CLOSED (fixed + verified) · **Severity:** HIGH (data-trust on a monitoring tool)

## Resolution
UI (sha `e84162d`): SSE error → `disconnected` state + `stale-banner` ("Disconnected — data may be stale…") + dimmed/`data-stale` figures + `aria-busy`; reconnect (`open`) → immediate `/stage-flow` re-fetch that clears stale (self-heals). LiveStatusDot gained a non-colour-redundant `disconnected` state. 192 tests green. Verified on ephemeral :3009 (drop→banner, restart→re-fetch→clear); operator's :3001 untouched. Process: orchestrator now keeps a persistent server + verifies on ephemeral ports (orchestrator.md, EXP-036). Gap → EXP-036 (observability surfaces must signal staleness, never present stale data as live).

## Four fields
- **Expected:** When the backend is unreachable or data is stale, the map makes that OBVIOUS (a clear disconnected/stale state) and never presents old numbers as current; on reconnect it re-fetches.
- **Actual:** With the server down, the map kept displaying the last-fetched values (e.g. "4 in-flight", "1 in-flight") with no indication they were stale — so the operator saw wrong numbers presented as live.
- **Intent:** Trust the live pipeline view.
- **Importance:** A monitoring tool that silently shows stale data as live is worse than no tool — it misleads. Data-trust.

## Reproduction (confirmed)
The orchestrator's verify steps repeatedly killed the `:3001` server the operator had open. The SPA, on losing its backend, kept rendering the last successful `/stage-flow` fetch (the pre-DEFECT-002-fix 4/1) with no visible "disconnected/stale" cue. The underlying DEFECT-002 was already fixed (live wip=0 on a running server), but the operator could not see it because the page was frozen-stale against a dead backend.

## Classification (§5a)
Our bug — UI does not surface connection/staleness state (primary); orchestrator process discipline killed the shared server (contributing).

## Root cause (latent)
The LiveStatusDot has a 'reconnecting' state but the map still presents the last data prominently with no staleness treatment; and there is no aggressive re-fetch on reconnect. Plus: the orchestrator treated the operator's running server as disposable during verification.

## Fix
UI: on SSE disconnect/error, the map shows a clear, non-colour-redundant STALE/DISCONNECTED indicator (and dims/marks the figures as not-current); on reconnect it re-fetches `/stage-flow` immediately so numbers self-heal. Process: orchestrator verifies on an ephemeral port, never kills the shared :3001, keeps a persistent server up. [sha + prod re-check on close]
