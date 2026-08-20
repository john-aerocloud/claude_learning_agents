# Principle failure — the change-graph was false-clean at three intermediate shas (DEF-ROC-066)

**Logged:** 2026-08-20 (engineer, DEF-ROC-066)
**Principle violated:** v124 / §"cheap marker first, narrative last" — *put the node/edge and its
`:::changed` mark in the SAME commit as the code — a two-line diff, never deferred — and let the
`edge-ledger.md` row land with the commit that COMPLETES the item.* Sub-step commits are NOT exempt.

## What happened
DEF-ROC-066 landed as three green red→green increments, each committed immediately per v95:

- `4620cea` — a new final arm in `classifySharedStoreRow` plus two new exports
  (`isDriftedSeededSitePattern`, `seededSitePatternFor`) — i.e. a **behaviour change to a modelled
  node** (`sharedStorePrune`).
- `45c80a2` — a **new module** `local/sitePatternRestore.ts` with a **new edge**
  `sitePatternRestore → sharedStorePrune`.
- `7b97986` — the e2e wiring (unmodelled tier, correctly ledger-only).

The `class-deps.mmd` node/edge/`:::changed` marks and the `edge-ledger.md` row landed only at
`7c3dcbb`, after all three. So for roughly forty minutes, `make impacted-tests` run against any of
those three shas would have reported **no changed nodes** while a new module on the local-tooling
path and a behaviour change to the audit classifier had just been introduced.

## Why this is a failure and not bookkeeping
This is the exact shape DEFECT-OAG-044 registered, from the same direction: the delivered head was
correct and the intermediate shas were **false-clean**. The rule exists to keep the MECHANICAL
signal honest at *every sha a tool might read*, not only at the boundary — and the marks were a
two-line diff in each case, so there was no cost argument for deferring them.

Aggravating: the item I was fixing is *itself* an instance of "a mechanism that asserts nothing",
and a `.mmd` that is clean while the code changed is precisely that.

## Why it happened (why-chain)
1. Why were the marks deferred? → I sequenced the work as "code green → commit → next increment",
   and treated the graph as a delivery-time artefact alongside the ledger narrative.
2. Why did that feel right? → The ledger ROW genuinely does belong at the completing commit, and I
   collapsed "narrative last" into "graph last". The rule explicitly separates the two.
3. Root cause: **no mechanical check ties a commit that adds a module or changes a modelled node's
   behaviour to a `.mmd` diff in the same commit.** The rule is prose, so under increment pressure
   it is remembered late.

## Corrective action (routed, not claimed)
- **Preventive, mechanical:** a pre-commit / loop-gate check — when a commit's diff adds a file under
  a modelled source root, or touches a file whose module name appears as a node in
  `architecture/dependencies/*.mmd`, REQUIRE that the same commit also diffs a `.mmd`. Fails closed,
  with an explicit `--no-graph` escape that must name a reason (so an unmodelled-tier change like the
  e2e wiring can still land cleanly). Candidate EXP for cicd; this is the second registered instance
  of the class (DEFECT-OAG-044 was the first, OFS v115 the inverse), so the prose has now failed twice.
- **Immediate:** the graph and ledger are correct at `7c3dcbb`; nothing needs re-work in the code.
