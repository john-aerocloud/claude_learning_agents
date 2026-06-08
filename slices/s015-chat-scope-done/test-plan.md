---
slice: s015-chat-scope-done
iteration: 18
tester: tester (Claude Sonnet 4.6)
date: 2026-06-08
last-validated-sha: 86d36a3
prod-url: https://d3pf3kcvzpau1x.cloudfront.net
---

# Test plan — s015: C7 done-condition validation

## EXP-019: impacted-tests result

`make impacted-tests SINCE=86d36a3 PROJECT=oxo-online` output:

```
No changed/added/removed nodes in architecture/dependencies/*.mmd.
EXIT 0 (clean — nothing to tick off).
```

**Changed node count: 0.** s015 has no code or .mmd change — the impacted set is empty.
This is the expected/honest result: EXP-019 records it as a valid data point (odd case,
no-code-change slice, impacted∪core = core-only = 6 specs / 12 total).

## Component-map .mmd check

Verified: `component-map.mmd` has NO `classDef changed` assignments active. The s014
changed marks were already cleared at s014 delivery (confirmed in the .mmd comments:
"s014 changed marks CLEARED (2026-06-08 — tester consumed)"). Nothing to clear for s015.

## Test scope derivation

Since impacted-tests returned empty, the scope is:
- **REGRESSION CORE** (always-run, 6 specs): shell, board-geometry, slice005-h2-pairing,
  slice006-move-relay, slice007-disconnect, slice009-arcade-scoreboard
- **s015 NEW GUARD SPECS** (3 specs, all new per acceptance.md):
  - AC1.1 — `slice015-s-scope-1-isolation.spec.ts` (S-SCOPE-1 main: C3 receives zero frames)
  - AC1.2 — `slice015-s-scope-1-forged.spec.ts` (S-SCOPE-1 forged-gameId: silent reject, C1/C2 zero frames)
  - AC1.3/AC1.4 — `slice015-t-p95-gameover.spec.ts` (formal p95 >=5 sends <=1000ms; T-GAMEOVER-1 chat absent post game-over)
- **AC1.5 S-regression**: covered by running the full smoke suite INCLUDING slice014-chat-send

## Tick-off

| AC | Case | Spec | Status |
|----|------|------|--------|
| ID-1 | Identity: served build-sha == deployed sha | shell.spec.ts + slice015 specs (all) | [x] PASS — sha=9794c5e |
| AC1.1 | S-SCOPE-1 main: C3 receives zero chat-message frames from G1 | slice015-s-scope-1-isolation.spec.ts | [x] PASS |
| AC1.2 | S-SCOPE-1 forged-gameId: silent reject, C1/C2 zero frames, C3 WS stays open | slice015-s-scope-1-forged.spec.ts | [x] PASS |
| AC1.3 | T-P95-1: >=5 sends, p95 <=1000ms (prod timing) | slice015-t-p95-gameover.spec.ts | [x] PASS — p95=196ms |
| AC1.4 | T-GAMEOVER-1: chat-input, chat-send-btn, chat-panel all absent post game-over | slice015-t-p95-gameover.spec.ts | [x] PASS |
| AC1.5 | S-regression: all prior flows unaffected (91 tests) | Full smoke suite | [x] PASS — 91/91 14.9s |

## Uncovered changed nodes

None — impacted-tests returned empty (no .mmd changes). No new spec required beyond
the acceptance cases. No waivers needed.

## Budget notes

Rate-limiting layers:
1. CloudFront WAF: 100/5-min per IP — exemption via `make waf-runner-ip-add`
2. WS authorizer: per-IP ConnectAttempts — same exemption (EXEMPT#<ip> DDB item)

The 3-context isolation test opens 3 WS connections; p95 test opens 2. Full run ~8 connections.
Use `make smoke-ci` / `make validate-impacted-ci` for the WAF+WS exemption cycle.
