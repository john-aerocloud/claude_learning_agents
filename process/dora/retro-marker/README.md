# FROZEN — this directory is the PRE-CUTOVER retro cadence record (read-only)

Nothing writes these files any more.

**Live store:** `work/<project>/items/retro-log.md` — an append-only log of one
event per retro close (`retro_closed`) or cheap incident-debt drain
(`debt_drained`), each carrying the constraint as of that close. Written by
`make retro-mark` and `make parts-check`; read by `make retro-debt`, `make
parts-check` and `make loop-gate`.

**Why it moved** (v146 retro ruling on
`OI-PARTS-CHECK-MARKER-DIRTIES-THE-TREE-AND-DEFERS-FOLD-FORWARD`, five
sightings): these files are **tracked**, so a documented *read* —
`parts-check`, which STAGE F runs after every close and as the incident-debt
drain — left the parent worktree dirty. `.claude/scripts/worktree update` exits
**3 DEFERRED** on an unclean worktree, so every loop cycle silently skipped the
fold-forward that `CLAUDE.md` §0a Rule 4 requires to run *continuously*. One
dirty-tree event per invocation, unbounded, and worsening with throughput.

The replacement store is not merely elsewhere — it is **per-project by
construction**. That is the point: a *global* store asked to hold *per-project*
state is the defect (`process/principle-failures/2026-08-20-global-registry-per-project-reality.md`),
and it is why deriving last-retro from the newest `process-v<NN>` **git tag** —
which needs no new state and dirties nothing — was also rejected: the tag
namespace is global, so one project's retro would silently become another's.

**These files are still READ, as a fallback**, when a project has no log yet.
That is the whole cutover strategy: `git rm --cached` plus a `.gitignore` rule
would fold forward into every other instance worktree, delete their working
marker, and force ROC / AdixOut / OperationalFlowSimulator into a spurious full
retro mid-cycle with nothing in their tree explaining why. With the fallback, no
project's cadence moves until its own next `retro-mark`.

They may be deleted at any time by anyone, with one consequence: the project
loses its pre-cutover boundary and its next `retro-debt` reads **UNKNOWN** and
counts all-time debt — which **fails closed** (it forces a retro, it cannot skip
one), and that retro's `retro-mark` re-seeds the live log.
