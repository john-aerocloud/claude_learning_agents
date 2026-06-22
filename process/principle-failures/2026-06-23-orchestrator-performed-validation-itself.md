# 2026-06-23 — orchestrator ran the validation itself instead of delegating to the tester

**Class:** role-boundary failure (orchestrator does sequencing+gates, NOT the work). Surfaced by human ("why is the main loop doing testing and not delegated to the tester?").

## What happened
When the live FIDS board needed render-validation and the Claude browser extension
wasn't connected, the orchestrator (main loop) ran **headless Chrome by hand**
(`--dump-dom` / `--screenshot`) to confirm the board rendered. It got the answer —
but it did the tester's job in the main loop.

## Why it's a deviation
The orchestrator's charter: own sequencing, gates, DORA, ToC — and make NO
engineering/validation/product calls; delegate them. Doing validation in the main
loop: (a) skips the committed validation framework (Playwright, §35); (b) leaves no
reusable, committed asset — the next deploy can't repeat it; (c) hides the work from
the role that owns and improves it; (d) masked that Playwright was never installed
(the real gap). A separate failure [ui-validated-without-observing-render] had let
the tester defer the render; the orchestrator "covered" for it by improvising rather
than sending the tester back to fix the tooling.

## Root cause
No explicit rule barred the orchestrator from performing a specialist's task when a
tool was missing/unavailable; "missing tool" was treated as licence to do it inline
rather than as a capability gap to route to the owning agent.

## Fix (routed → orchestrator.md "You sequence and gate — you do NOT do the work")
The orchestrator never runs tests/validation/engineering itself. Missing or
unavailable tooling → **dispatch the tester** to install/wire it and validate, not
improvise. A one-off ground-truth probe to ADJUDICATE conflicting agent reports is
allowed, but it never replaces the owning agent's validation — send them back to do
it through the committed framework. Targets CFR + lead time (the right asset gets
built once, by the right role).
