# Principle failure — I assembled my own green bar instead of running the committed gate

**Logged:** 2026-09-16 (ROC, `DEF-ROC-226`, engineer)
**Principles violated:**
- *"An unrun test is a failure"* (user memory, and §17's live-caught→offline-pin rule).
- *"Your green bar must exercise the REAL artifact, not an isolated proxy"* (engineer brief).
- §19d — *"pushed" is never "deployed"*, applied one step earlier: **"my commands passed" is never "the gate passed."**

## What happened

Before pushing `DEF-ROC-226` I verified the change by running the checks I had reached for
individually, and I ran a lot of them:

```
npm --prefix src/app run test        # 2759 green
npm --prefix src/app run build       # tsc clean
npm --prefix src/app run lint        # clean
npm --prefix src/dashboard run test  # 1374 green
npm --prefix src/dashboard run build # clean
make typecheck                       # PASS
make exit-gate                       # read and acted on
```

I pushed on that. **CI went red on all three checks.**

`scripts/pre-push-gate.sh` — committed, in the repo, seven stages — runs all of the above
**and two tiers I did not run at all**:

| tier | what it is | what it caught |
|---|---|---|
| `npm --prefix src/dashboard run test:browser` | 31 files, 286 cases, **real chromium**, `*.browser.test.tsx` — a SEPARATE vitest config that `run test` excludes | `SimulatorPage.uc102.browser.test.tsx` still drove `available-not-reserved`, the strip state the item deleted. Reddened all three CI checks. |
| `npm --prefix src/app run test:acceptance` | 63 files against **real Azurite / Service Bus / Event Hubs emulators**, stood up by the gate itself | `AC-117-5 NON-RESERVED NODE, against the REAL wire` asserted the deleted rule against a real broker. |

Neither is exotic. Both are one line in a script whose entire purpose is to be run before
a push, and the script stands the emulators up and tears them down for you.

## Why it happened (why-chain)

1. **Why did CI fail on a locally-green push?** Two whole test tiers had never been run.
2. **Why not?** I reached for the commands I already knew — `npm run test`, `run build`,
   `run lint` — package by package, and assembled a bar out of them.
3. **Why did that feel sufficient?** Because it was *long*. Six commands, three packages,
   4133 passing cases, plus the exit gate. The **volume of green created confidence that
   stood in for coverage of the tiers.** A short list would have felt incomplete; a long
   list felt like completeness, and completeness is not a feeling.
4. **Why did I not notice `test:browser` existed?** `npm run test` in `src/dashboard` is
   scoped to `vitest.config.ts`. A tier that another config owns is **invisible to the
   command you ran**, and nothing in that command's green output says "there is more."
5. **Root cause: I substituted my own judgement about what constitutes done for the
   project's committed answer to that exact question.** The gate is not a convenience
   wrapper around commands I could run myself — it is the *definition*, versioned, and it
   encodes tiers no individual command reveals.

## Why this one is worth logging rather than shrugging at

The obvious reading is "ran the wrong command, cost one CI cycle." The real cost is
sharper, and it is the reason the acceptance tier exists:

**The acceptance failure was about the real wire.** `AC-117-5` proves *a gate-1 refusal
reaches no broker at all* against a REAL broker rather than a fake publisher. I had
already repointed its jsdom-tier cousins, and they were green. Had I merely deleted the
acceptance case to clear the red, I would have removed the only assertion in the repository
that the refusal path touches no broker — and every remaining test would still have been
green. **A tier you do not run is a tier whose requirements you cannot see you are deleting.**

It also failed in the direction §17 warns about: offline-green, live-broken. The browser
tier exists precisely because jsdom has no layout, and it was measuring two things
(`AC-102-20` strip height parity, `AC-102-21` horizontal overflow) that **no other tier in
the project can judge**.

## What I did about it

Both were repointed rather than deleted, each keeping the property it was really worth:

- the browser tier's vacated resting-state slot is filled by `unavailable` — a state that
  was **already resting and already missing from that file's parity list**, so the
  completeness claim got *stronger* than before the item;
- the acceptance case is driven at deny-by-default on the body shape (a gate-1 refusal that
  survives), **plus a new arm** that publishes the exact node the retired rule refused
  through the real emulator wire and asserts the raised ticket says `[INJECTED]`.

Then `sh scripts/pre-push-gate.sh` — all seven stages, exit 0 — and pushed. CI: Test
**success**, Deploy **success**.

## Corrective action

**For every agent, immediately — the rule, stated so it is checkable:**

> **Run the project's committed pre-push gate. Do not assemble an equivalent.**
> If you cannot name the gate for the repo you are in, that is the first thing to find out,
> before the first commit — not after the first push.

`npm test` is a tier, not a verdict. A package can hold several test configs, and the one
you did not run is invisible to the one you did.

**Preventive, routed rather than asserted:** ROC's gate is `scripts/pre-push-gate.sh`, and
nothing enforces it — it is a script an agent must remember. The candidate fix is a
**committed git `pre-push` hook** (or a `make push` that cannot be bypassed) so the gate is
mechanical rather than remembered. That is a tooling change in the project lane and belongs
to its own item; it is named here so the next retro can route it rather than rediscover it.

## Stated plainly

The tiers I skipped were the two that exercise the REAL thing — a real browser and a real
broker. Everything I *did* run was a proxy. **I built a large, impressive green bar
entirely out of proxies and pushed on it**, which is the precise shape of failure the
engineer brief spends three paragraphs warning about, and I walked into it while holding
those paragraphs.
