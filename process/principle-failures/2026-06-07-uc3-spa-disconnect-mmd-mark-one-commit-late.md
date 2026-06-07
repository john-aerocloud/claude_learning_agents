# Principle deviation — UC3 SPA disconnect class-deps mark landed one commit late

- **Date:** 2026-06-07
- **Slice:** s007-disconnect (iteration 10), UC3 (SPA survivor UX)
- **Agent:** engineer (UC3)
- **Principle:** Change-impact model "update in the same commit" — any commit that
  adds/redirects a dependency edge updates the relevant `.mmd` in THAT commit,
  marking changed nodes/edges (engineer.md §"The change-impact model").

## What happened
The UC3-S2 commit (3a93358) added the SPA `opponent-disconnected` handler — a new
SPA seam (`spa-online-disconnect`) consuming the frame over the `spa-ws-client`
transport. The matching `class-deps.mmd` node + edge were NOT in that commit; they
landed one commit later (c15cdc6). The route.md note ("UC3 adds nothing to
class-deps") was taken too literally — UC3 did add a real, distinct SPA seam worth
marking for the tester's test plan.

## Why it is bounded / not delivery-impacting
- The mark landed BEFORE slice delivery (the tester clears marks at delivery), so
  the tester's test-plan input is complete and correct at consume time.
- `@covers spa-online-disconnect` tags on the specs were authored from the start,
  so the impacted specs were always mechanically listable once the node existed.
- No production behaviour was affected; this is a model-currency timing lapse.

## Corrective note for next time
When a route step says a layer "adds nothing" to a model file, still re-evaluate
against the actual diff: a new behaviour branch on an existing component is a new
seam. Mark it in the SAME commit as the code.
