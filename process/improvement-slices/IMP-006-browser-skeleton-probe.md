# IMP-006 — Browser-driven skeleton probe + Playwright MCP capability

**Status:** queued 2026-06-06
**Owner:** cicd (MCP/Playwright capability + allowlist) / engineer (skeleton spec author) / tester (browser-transport coverage)
**Human decision required:** whether to install the Playwright MCP server (a
harness/config change with cost — token budget, an extra MCP surface). The
behavioural rules below land regardless; this slice builds the capability that
makes them cheap.

## Job

The named pipeline constraint is the **tester** (median 1130s, the slowest agent
step). The biggest driver of tester cost is not the tester being slow — it is
the QUALITY of work arriving at the tester. The most expensive defect to date
(DEFECT-005-001, MTTR 5807s, 2 re-validation rounds) had 4 of 6 root causes that
were **browser-only** and gave a FALSE GREEN to every check run before hand-off:

- CSP `connect-src 'self'` silently blocked the cross-origin WSS (a `node ws`
  probe connected fine — same code, no CSP — so it "passed").
- `/config.js` was written by the pipeline but never referenced by `index.html`,
  so `window.OXO_CONFIG` was `undefined` and the SPA opened a socket to
  `undefined` (invisible to node).
- Close-code delivery and frame/close ordering were browser-runtime semantics.

The existing skeleton probe (`work/oxo-online/scripts/ws-probe.js`) is a **node
`ws`** probe — precisely the tool that bypasses the layer the risk lives in. The
engineer had no cheap way to drive a REAL browser against the deployed surface
before handing to the tester, so these leaked to production validation.

## Why Playwright MCP is NOT redundant with committed Playwright specs

These serve two different jobs and the s005 defect proves both are needed:

| | Committed Playwright specs (`tests/`) | Playwright MCP (interactive browser) |
|---|---|---|
| Job | REGRESSION — keep known behaviour from breaking | DISCOVERY — find the unknown end-to-end break |
| When | CI / validation, every run | exploratory, while building the skeleton or reproducing a defect |
| Knows what to assert? | yes (you wrote the assertion) | no — you are looking for what you don't yet know is wrong |
| Output | pass/fail on a fixed contract | observations (console errors, blocked requests, undefined config) that you THEN turn into a committed spec |

You cannot write the regression spec for a failure mode you have not yet
discovered. For DEFECT-005-001 nobody knew to assert "CSP admits the WSS origin"
until a real browser surfaced the silent block. Playwright MCP is the cheap
real-browser driver that surfaces it; the committed spec is what you write
afterwards so it never regresses. **Discovery feeds regression; neither replaces
the other.** (A scripted headless Playwright run can also discover, but MCP lets
the agent drive and observe live console/network/CSP without first authoring a
throwaway script — lowest-friction discovery.)

## DORA target

- **MTTR** (primary): browser-only defect classes are surfaced at skeleton time
  / in exploratory reproduction, not after a production hand-off and a
  re-validation round. Target: new-mechanism browser slices have 0 browser-only
  root causes reaching prod; any defect MTTR < 900s.
- **Gross lead time** (constraint = tester): fewer defect-fix-revalidate rounds
  through the slowest stage; the tester validates a slice that already works
  end-to-end in a browser.
- **CFR** (protects): each discovered browser-transport break becomes a
  committed failing-then-passing spec (standing regression).

## Done condition (observable, testable)

1. A browser-level skeleton entry point exists and is allowlisted: a committed
   `tests/skeleton/` Playwright spec (headless, runs in CI/locally) that drives
   ONE real request through the full deployed new-mechanism path in a real
   browser, replacing the node `ws-probe.js` pattern for browser-delivered
   mechanisms. `make skeleton` (or equivalent) runs + records it.
2. IF the human approves it: the Playwright MCP server is configured in
   `.claude/settings.json` (or the harness config), documented in the cicd agent
   capability notes, with its allowlist/permission shape set so engineer and
   tester can drive a browser without per-call prompts.
3. The next new-platform-mechanism browser slice uses the browser skeleton probe
   before use-case build-out; the retro scores browser-only causes reaching prod
   (target 0).

## Protection

- The skeleton spec is committed and run by `make skeleton`; it is standing
  regression, not a one-off.
- The behavioural rules (engineer: "real client = real browser, node probe does
  not satisfy"; tester: "≥1 browser-transport spec; no actionable click on
  disabled; user symptom reproduced before close") are already in the agent
  definitions (v27) and bind regardless of whether the MCP server is installed —
  the MCP is the convenience that makes them cheap, not the rule itself.
