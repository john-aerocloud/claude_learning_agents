# 2026-07-31 — Orchestrator: over-gated, then pushed a "green" that proved nothing; and briefed away the only escape route

Project: OagEventSource. Cycle: DEFECT-OAG-043 (prod ran two live ingest lanes, one un-gated).
Recorded at the v124 gap-closing retro. Four failures, all mine, unsoftened.

## 1. Asserted a pipeline verdict I had not read (REPEAT of 2026-07-30)
I reported that the app-CI **Bundle diff gate** had NOT caught the stale
`infra/assets/ingest-handler/handler.mjs`. It had — correctly, RED, on push `5095849`.
I had looked only at the `infra.yml` run. The real finding was the opposite and more
serious: the gate worked and the **pipeline topology** ignored it (`infra.yml` declares no
dependency on the app-CI lane, so its deploy job ran on to `SST deploy [prod]` and
succeeded, shipping source-correct / artifact-stale / deployed-code-wrong).

This is yesterday's logged class verbatim
(`2026-07-30-orchestrator-asserted-authorised-and-pushed-without-establishing-the-governing-fact`):
**acting on an unverified assumption about a fact owned outside my seat, where being wrong
is plausible rather than loud.** A CI verdict is such a fact. Second consecutive day ⇒ a
pattern, not a slip. Routed: orchestrator.md — when you report green, name which gates ran
on that sha and which artifact each read; a claim about a lane you did not read is an
assumption.

## 2. Pushed a batch of 20 commits on a "green" that was true and meaningless
I verified green and pushed 20 accumulated commits. Green was true; it was also
uninformative, because no gate in the lane I read had read the SHIPPED artifact. A batched
push also destroys the attribution it is batched for: 20 commits share one verdict, so no
gate maps to a change and one red blocks 19 innocents.

## 3. Over-gated: three of four holds were not preconditions
The human corrected me — push on green, do not accumulate. The backlog was my own doing.
Reviewing the four holds, **three were sequencing green work behind unrelated items**, not
genuine preconditions. Consequence is measurable, not stylistic: holding finished work
inflates `validating`/`deploying` dwell, which bills to **tester** and **cicd** in the
by-owner GLT split and disguises orchestrator over-gating as specialist slowness.
DEFECT-OAG-043 itself: 63,518 s booked to `tester` out of 68,720 s GLT, against ~2,400 s of
actual tester effort — the rest was the item sitting in `validating` awaiting a
human-sequenced push and the CI cascade. Routed: orchestrator.md — a hold requires a named
precondition **on the held item itself**.

## 4. A "DO NOT PUSH" brief closed the only escape route, and cost a finished engineer's work
DEFECT-OAG-045: an isolation worktree's auto-clean **destroyed a completed engineer's
commits** (~3 h, ~218 k tokens, unrecoverable). Mechanism: the project repo is a gitignored
nested clone, invisible to the changed-check that decides a worktree is safe to delete. But
the root cause was my briefing — "DO NOT PUSH" meant the GitHub remote; that clone's
`origin` is the local shared repo, and pushing there was the only way the work could
survive. The near-repeat survived only because an agent happened to leave a `git bundle` in
the scratchpad. Routed: orchestrator.md — name the remote in every push instruction; every
brief carries a durable-ref requirement quoted in the return; v80 isolation means an
explicit `git worktree add` on the project repo, never the Agent tool's auto-cleaned
`isolation: "worktree"` for a nested gitignored project repo.

## Also logged: my own metering rule unmet
`DEFECT-OAG-043`'s `validated` event carried `tokens: 0` and no `duration_ms`, for a real
tester dispatch of ~40 min. Registry-wide, token coverage is 2.6% of events and duration
coverage 0.2% — my own §E/§F rules, largely unhonoured, which is why the constraint
analysis cannot separate wait from effort.

## Not a failure — recorded so it is not lost
The concurrent-worktree isolation trial measured WELL on its stated benefit: two engineers,
zero cross-contamination, both suites green at start, zero feature-code conflicts, ~9–15 s
setup via APFS copy-on-write (no `npm ci`), only append-only operational-file conflicts —
against FOUR contamination incidents in the shared tree the same day. The isolation benefit
is real; the storage model beneath it was unsafe.
