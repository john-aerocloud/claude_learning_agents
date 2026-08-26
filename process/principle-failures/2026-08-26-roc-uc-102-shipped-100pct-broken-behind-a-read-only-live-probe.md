# 2026-08-26 — UC-ROC-102 shipped 100% broken behind a "LIVE CONFIRMED" that could not exercise the write path

**Project:** ROC · **Items:** `UC-ROC-102`, `DEF-ROC-111` · **Recurrence of:**
`2026-07-22-uc-adix-015-missing-cicd-deployed-event-blocks-tester.md`

## What happened

The Simulator's Publish control shipped **unable to publish at all** — 100% of screen
publishes were `400 caller-data-4xx` — and stayed that way until a human reported it. Every
gate was green. The owner's question is the right one: *how did we think this worked?*

## The three things that had to line up, and did

**1. A "LIVE CONFIRMED" that structurally could not exercise the feature.** `UC-ROC-102`'s
`built_green` note reads *"LIVE CONFIRMED on the deployed host in a REAL BROWSER via the
committed probe `npm run probe:uc102-live`"* — 26 assertions green. That probe's own header
says it **"NEVER WRITES. It issues no POST to the publish route at all — deliberately"**,
because `requests{outcome:"disabled"} > 0` while no window is open is a documented intrusion
signal (runbook §3). The claim was TRUE of the closed-window state and read as end-to-end.
It was the strongest-sounding evidence in the item, and it covered everything except the
one thing the item existed to add.

**2. Three tests PINNED the defect rather than missing it.** Not a coverage gap — an
actively enforced wrong contract:
- `SimulatorPage.uc102.publish.test.tsx:422` asserted the body EQUALS `{node, device, status, airport: null}`.
- `publishApi.test.ts:112` asserted the exact key set INCLUDING `airport`, under a comment
  correctly reasoning that *"the route DENIES BY DEFAULT on the body shape, so an extra field is a 400"*.
- `uc101PublishRequest.test.ts:106` asserted the route REFUSES `airport` — but only for
  `"LHR"`, never `null`, which is the only value the screen ever sent.

Two suites asserting contradictory halves of one contract, both green, because each checked
its own side against a fixture of our own making. **A client assertion verified against our
own mock proves only that we are self-consistent.**

**3. No tester was ever dispatched — and none could be.** `UC-ROC-102` sat in `deploying`
for **12.0 hours** (cicd's own median for that state is **166s** across 52 items — **260x**).
ROC deploys by pipeline, and under a pipeline deploy **no agent fires `deployed`**; the
loop-run contract puts that on the orchestrator, who did not. So the item was parked short
of validation by construction. Meanwhile `loop-gate` check 1 BLOCKED that same morning on
`UC-ROC-104` at 11.5h in `dev-validating` and said nothing about this — check 1 covers
validating states at 4h, check 11 covers `deploying` at 24h, and 12.0h fell in the gap.

## Why-chain

1. A 100%-broken feature read as shipped → its only "live" evidence came from a tier designed never to POST.
2. That was never corrected → no tester was dispatched.
3. No tester was dispatched → the item sat in `deploying`; the `deployed` event was never fired.
4. The event was never fired → under a pipeline deploy no agent owns it; the orchestrator does, and missed it.
5. Nothing caught the omission → provably-done work in `deploying` is unnamed by any limb between 4h and 24h.
6. 12h did not look anomalous → nothing compares dwell against the state's own median.

## Why this is a principle failure and not just a defect

The identical mechanism — missing `deployed` under a pipeline deploy stranding an item
short of the tester — was recorded on **AdixOut on 2026-07-22** (`UC-ADIX-015`). That entry
closed by promising an improvement slice to move the emission into CI. **It was never
built.** A root cause that recurs across projects after being named once is a system failure
to smooth it, not an agent's mistake.

## What changed (v152)

- **`loop-gate` check 1 now covers `deploying`/`prod-deploying`** when a ref-bearing
  done-work event proves the work finished, with a **state-appropriate remedy** — fire
  `deployed` (AGENT=cicd) and dispatch the tester in the same turn, not "dispatch the
  tester", which has no legal edge from `deploying` and would be the DEF-ROC-084 class of
  remedy the writer rejects.
- **Process §F5d** — a validation tier that cannot exercise an item's primary mutating path
  may not be cited as live confirmation of it without naming what it did NOT exercise, and
  an AC covering a mutating action cannot be discharged by read-only evidence.

## What is deliberately NOT changed

`probe-uc102-live.mjs` stays read-only. Its abstention is correct and load-bearing — a UI
that probed its own write route would destroy the intrusion signal. The failure was never
that the probe abstained; it was **calling an abstention a confirmation**.
