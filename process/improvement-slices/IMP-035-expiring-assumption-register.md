# IMP-035 — the expiring-assumption register: make a deferred shortcut announce its own expiry

**Founded by:** `DEF-ROC-193` (owner-reported, blocking, on ROC's only production airport) and
`DEF-ROC-194` (same class, found within the hour, different substrate).
**Registered as:** `EXP-ROC-022`. **Rule:** §F11.7 (process v179).

## The problem in one line

A deliberate, time-limited shortcut records its retirement condition in **prose**, and prose cannot
come back negative — so the shortcut outlives its precondition silently, and the test suite,
having asserted the shortcut, **defends it**.

## What already exists — and it is one adapter, not the mechanism

The `DEF-ROC-193` engineer built
`work/ROC/src/dashboard/src/hardcodedOptionLists.def193.test.ts`. It is a good seed and it has the
right shape:

- scans every `*Options={…}` prop in the dashboard, flags any whose expression resolves to a
  **module-level array literal**
- requires a committed **ledger row naming the endpoint tokens whose appearance retires it**
- three arms: an undeclared list fails; a declared row goes **RED the day its endpoint lands**; a
  **stale** row fails too, so the ledger cannot drift from the tree
- **comments are stripped before matching**, so prose cannot satisfy it — the exact mechanism that
  failed here
- **non-vacuity demonstrated:** it read RED on `SITE_OPTIONS` before the fix, with no change to the
  checker (§F9f)

## The slice — generalise the substrate, keep the shape

`DEF-ROC-194` is the proof the current scope is too narrow: README.md:116 and
docs/03-operations.md:13 assert that production is *"reached only by a separate promotion lane …
not by pushing to `main`"*, while `deploy-roc-apps.yml` deploys prod on **every** push at the pushed
sha, overriding the manifest pin, with no `needs:` on the test lane. A `*Options` checker cannot see
that, and it is the same defect.

**Build:** one register, three fields per row — **site** (file + symbol, or the document claim),
**predicate** (executable, becomes TRUE when the shortcut must go), **owner item** (what removes
it). Adapters resolve a predicate against different substrates: a source symbol, a served endpoint,
a workflow trigger, a documented sentence. The `*Options` checker becomes the first adapter.

## Acceptance

1. Both founding defects are expressible as rows, and **both rows read RED against their own
   pre-fix trees** — including `DEF-ROC-194`'s, which the current checker cannot see at all.
2. A row whose predicate **cannot fire** is refused at declaration time, not merely reported
   (§F9f — a probe that cannot fail proves nothing).
3. The register runs in the gate on every run, and names the shortcut when it fires.
4. **PRODUCT vs PROCESS (§F11.6):** this is a PROCESS check — it asserts how we work, not what we
   ship. It runs locally and must NOT be added to the CI/CD required set.

## The thing to resist

Do not let the register become a place to *record* shortcuts. Its whole value is that a row goes
red on its own; a row that merely describes a shortcut is the comment again, in a new file.
