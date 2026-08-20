# `blocked` is the one park state nothing re-checks — and the rule that should have caught it was prose

**Date:** 2026-08-20 · **Project:** ROC · **Fired by:** `/defect` on `DEF-ROC-073` family
**Process version at failure:** v141 → remedied at **v142** (§17c limb 6, EXP-143)

## The principle that failed

§17c Layer 2 — *"a park whose reason is only a `note:` can never come back negative and therefore
never ends"* — and §17c limb 3 — *an environmental premise ROTS and must be "a code guard with an
owner, or a registered item that re-checks it when the environment changes."*

Both were already written. Both are correct. Neither held.

## What happened

The human reported that events written to the bus produced no Jira tickets and no feedback.
Diagnosis found the deployed pipeline **healthy** — it raises a real PPSM Alert in ~2 seconds — and
the events being silently discarded at the topic, because they lacked the `RocTestMarker='true'`
application property that the single, SQL-filtered subscription requires. Service Bus drops a
non-matching message with a **success ack to the publisher** and no dead-letter.

The reason nobody had ever caught this is the part worth recording. ROC's event-driven path — the
product's entire job — **had never once executed in the cloud**, because there was no way to publish
to the topic (namespace IP firewall plus no send role). The system recorded that correctly, as
external blockage, in `DEF-ROC-004`.

**Then nothing ever re-checked it.**

`DEF-ROC-004` sat in `blocked` for **28.8 days after both of its blockers had already gone**. Its
`roc-test` subscription was created on 2026-07-22 — *the same day the defect was raised*. The
namespace IP firewall now allowlists the operator egress `88.97.177.220`. The blockage was falsified
in about five minutes, by trying.

Meanwhile `external` accounts for **46.3% of this project's gross lead time at a median 19.3 days
per item** — the largest single cost in ROC, named as the constraint in `RESUME.md` — and its only
detector is a human deciding to re-ask.

## Why the principle did not hold

Because it was applied to **one of the two park states**, and stated as prose for the other.

The machinery itself enumerates both: `_PARKED_STATES = {"blocked", AWAITING_OBSERVATION}`.
`append` **refuses** `not_yet_observed` without `OBSERVE=make:<target>`, on the explicit stated
grounds quoted above. That reasoning has nothing to do with observation specifically — substitute
"blocked" and the sentence is unchanged and still true. `blocked` was simply left exempt, and takes
a prose `note:` and nothing else.

And limb 3 already demanded the re-check. `DEF-ROC-004` **was** the registered item limb 3 asks
for. It re-checked nothing, because nothing made it. So §17c Layer 2's own sentence —

> *"A remedy written as prose reproduces the defect it was written for."*

— came true **against the rule that wrote it**. That is the uncomfortable finding, and it is the
whole justification for mechanising rather than restating.

## The recurring root cause this belongs to

**"A mechanism that asserts nothing and cannot fail"** — ROC's documented dominant defect pattern
(`RESUME.md`), now at 10+ instances. This is its most expensive form yet, because for the first time
it is the **flow system itself** rather than the product: the state that holds nearly half the
project's lead time cannot report that its own reason has expired.

Note the same defect produced two more instances in the product: a topic that discards messages in
silence, and a `not-handled` outcome that raises nothing and signals nothing. Three in one incident,
and none of them able to go red.

## The remedy (mechanised, not prosed — §17c.5)

**§17c limb 6, cross-agent and binding, hence the v142 bump.** `EVENT=blocked` requires
`PROBE=make:<target>` — a committed, re-runnable target printing `BLOCKER: standing` (advisory) or
`BLOCKER: cleared` (`loop-gate` **BLOCKS**; an `unblocked` dispatch is actionable), with anything
else — missing target, crash, both sentinels, non-zero exit, timeout — treated as a BROKEN predicate
that blocks, exactly as §17c.2 already treats an unrunnable observation probe.

Tracked as **EXP-143** against **gross lead time** (`external` share + median time-in-`blocked`),
with its falsification stated up front: if probes honestly report `standing` and the external share
does not move, the ceremony is pure cost and the row is killed, not re-tuned.

## The lesson, generalised

**An externally-blocked item is not blocked; it is UNVERIFIED-blocked, until something that can fail
says so.** A blocker is a claim about the world, and the world changes without telling us.

Corollary, from the same incident and worth its own line: **a deny-by-default safety boundary left
closed indefinitely does not prevent the unsafe action — it guarantees it.** `replay-injector`'s
`ALLOWED_NAMESPACES` was empty for a month. The need to inject did not go away, so the operator
hand-rolled a sender that omitted the marker. The safety mechanism, by staying closed, *created* the
unsafe path it existed to prevent.
