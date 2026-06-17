# Live-blocking defect misdiagnosed; root causes had no test that could fail

**Date:** 2026-06-06
**Principles touched:** acceptance tests define done; test at the level the
risk lives (browser-transport contract); code↔policy contract pins.

## What happened

A WebSocket slice (005-join-game) was reported through two defect rounds as a
Lambda-side problem: round 1 a ConditionalCheck issue, round 2 a register
AccessDenied (IAM grants PutItem/DeleteItem on Connections, code used
UpdateItem). The AccessDenied was a real bug and was fixed. But it was NOT why
online pairing failed in production. With the lambda fixed, every live pairing
still failed.

The actual prod-blocking root causes were two browser-transport facts that no
test in the suite could exercise:

1. **Missing runtime-config wiring.** The deploy pipeline wrote the live WSS
   URL to `/config.js`, but `index.html` never referenced it, so
   `window.OXO_CONFIG` was `undefined`, the SPA opened a socket to `undefined`,
   and the UI degraded to the generic error. (The pipeline comment even said
   "the engineer wires this" — it was never wired or pinned.)
2. **CSP blocked the WebSocket.** The CloudFront CSP shipped
   `connect-src 'self'`. The same-origin `/api/*` fetch passed, so this looked
   fine — but the cross-origin WSS endpoint was silently blocked by the browser
   (no socket created at all). A direct `node ws` connection worked, which is
   exactly why unit/integration tests and manual node probes never caught it.

## Why it happened

Every test operated below the browser-transport boundary: lambda unit tests
(SDK mocks), infra synth assertions (resource shape), and even smoke tests that
asserted DOM but whose own `.click()` on a disabled button masked the real
failure with a 30s actionability timeout. Nothing asserted the two contracts
that actually gate a browser WebSocket: (a) `index.html` loads `/config.js`
before the bundle, and (b) CSP `connect-src` admits the WSS origin. Both are
"works in node, blocked in browser" failures — invisible to any non-browser
probe.

## Generalised lesson

**Put a failing test at the level the risk actually lives.** A WebSocket
slice's risk lives in the browser's transport/security layer (config injection
ordering, CSP connect-src), not only in the Lambda. When a "deploy wires this"
hand-off exists, the receiving role must land a contract test that fails until
the wiring is present — otherwise the wiring's absence is undetectable until a
human watches a browser. Diagnosis that stops at the first true-but-secondary
bug (AccessDenied) without reproducing the end-to-end user symptom will keep
re-opening the same defect.

Fixes landed this round, each red→green: index.html `/config.js` ordering
(unit contract test on the source HTML), CSP `connect-src` wss origin (synth
assertion), plus the named register Put fix, the error-frame drain, the client
close-grace window, and the GONE-host 4041 categorisation.

## Code↔policy contract gap (for the retro)

register.ts had drifted from its IAM policy: the code issued UpdateItem on the
Connections table while the least-privilege role grants only PutItem/DeleteItem
there. There was no test pinning the code to the granted action set, so the
drift was invisible until prod AccessDenied. A `register.test.ts` block now
pins the Connections write to a Put (asserts no Update against that table) — a
mechanical code↔policy contract. Generalise: where a role grants a NARROW
action set on a resource, the code that writes that resource should carry a
test asserting it uses only granted actions, so least-privilege and code cannot
silently diverge.

## Suggested process response

- Engineer: when a deploy step says "the app/engineer wires X", land a contract
  test that fails until X is wired (here: index.html→/config.js ordering).
- Tester: a browser slice needs at least one test that fails when the browser
  security/transport layer (CSP connect-src, mixed content, config presence)
  is wrong — and must not click `disabled` elements with actionable `.click()`
  (use force/dispatch to assert inertness), or the harness masks real failures.
- Both: a defect is not closed until the end-to-end USER symptom is reproduced
  and pinned, not just the first true-but-partial cause.
