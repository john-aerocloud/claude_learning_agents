# User manual — the self-improving delivery system

How to drive this system: the mental model, the commands you type, the agents that do
the work, and how it all fits together. `README.md` says *what* the system is; this says
*how to use it*. The rules the agents follow live in `process/process-current.md` (v82);
the substrate is defined in `process/machinery/CONTRACT.md`.

---

## 1. The one idea you need

**A work item is the single source of truth.** Every unit of work — a requirement, a
chunk, a slice, a use-case, a defect — is one file under `work/<project>/items/`. It
carries its definition, its dependency edges, and an **append-only event log**. Its
current state is *computed* by folding those events through a state machine
(`process/machinery/state-graphs.json`) — never stored, never hand-edited.

Everything else is a **view derived from the items**: the queues, the dependency tree,
the Linear/Jira board, and all delivery metrics. You never sync these by hand; you
regenerate them. This is why the board can't drift from reality and why a "done" item
can't still be sitting in a queue — those are the same computed fact.

The prior model (multiple hand-synced stores) is archived at git tag `QueueApproach`.

---

## 2. How work flows

```
Job-to-be-done → Chunk → Slice → Use-case → (built, deployed, validated) → done
                                     ↑ defects enter here too
```

1. **You state a requirement** (`/project-new` or `/intake`). Product turns it into a
   vision, the architect sets the shape, and it's decomposed into chunks → slices →
   use-cases, each an item file with value/cost and dependency edges.
2. **The loop pulls and builds** (`/loop-run`). Continuously, it pulls the largest set of
   *independent* ready use-cases, builds each TDD-on-trunk, deploys per use-case, and
   validates in production — then replenishes the next work just-in-time. It runs until
   the queues drain and the requirement is done, then asks you for more.
3. **Done bubbles up.** A slice is done when its use-cases are; a chunk when its slices
   are; the requirement when its chunks are. All derived from the item events.

**The only routine human gate is intake** (`/intake`) — you decide what work enters.
Deploys (including infra) auto-approve under an automated policy assurance; the only
other human touch is a genuinely irreversible production-data operation.

---

## 3. The commands (what you type)

Run all of these from the project root. `<name>` is a project; if omitted, the
machine-local `work/ACTIVE` pointer is used.

**Starting & steering work**
- `/project-new <name> [problem]` — scaffold a new project workspace and start the
  new-requirement workflow (vision → architecture → chunks → capabilities).
- `/requirement-new <name>` — run that new-requirement workflow for an existing project
  (add another requirement). Vision/architecture are logged, not human-gated.
- `/intake` — **the human gate.** Bring in a new requirement *or* a defect: it captures
  and (for defects) reproduces, creates the item file, and appends the first event
  (`registered` / `reported`). Queue membership is derived — there's no manual enqueue.
- `/loop-run <name>` — run the continuous pull loop (the workhorse). Autonomous: it
  pulls, builds, deploys, validates, replenishes, and retros at cadence until done.
- `/defect …` — report a defect. Intake happens at `/intake`; this adds the one thing
  intake doesn't: the mandatory **gap-closing retro** once the fix ships.

**Seeing state**
- `/flow-status <name>` — read-only: queue depths vs their buffers, the current
  constraint (biggest contributor to gross lead time), and the work-item tree. Derived
  by `make wi-project` from the items.
- `/project-list` — all projects with status and last activity; marks the active one.

**Switching & parking**
- `/project-switch <name>` — set the active project and rebuild resume context.
- `/project-stop <name>` — park a project (self-state in `/process` is untouched).

**Internal (the loop calls these; you rarely do)**
- `/slice-next <name>` — product's just-in-time slice replenishment.
- `/retro <name>` — recompute metrics, review learned failures, score experiments, and
  write the next process version. Fires automatically at the §F8 cadence.
- `/refactor-process` — the rationalization gate: restructure the process docs, keep them
  precise, run `make doc-lint`. Run at major cutovers / every ~10 versions (§27.6).

---

## 4. The agents (who does the work)

The **orchestrator** sequences work and enforces gates; the **flow-manager** owns flow
decisions (what to pull, when to replenish) — both make *no* product/engineering calls.
Specialists do the actual work: **product** (JTBD, slicing, value), **solution-architect**
(C4 architecture, security), **cicd** (pipelines, deploy roles, rollback), **engineer**
(TDD-on-trunk build, defects-as-spec), **ui-designer** (UI structure + polish),
**tester** (validates in production through the public surface), **documenter** (keeps
user docs honest). Two **projection agents** — **linear** and **jira** — mirror each item
onto its board issue, idempotently and in parallel; they never write back to the item.

---

## 5. The machinery (the commands under the hood)

State and metrics run through one tool (`sh .claude/skills/work-items/scripts/work-items`,
wrapped as `make` targets):

- `make wi-append PROJECT=<p> ID=<id> EVENT=<e> AGENT=<role>` — **the only way to change
  item state.** It's edge-checked: an illegal transition is rejected (and wanting a
  transition the graph lacks is a *process experiment*, not an ad-hoc edit).
- `make wi-project PROJECT=<p>` — regenerate all views (`work/<p>/views/`): queues, state,
  tree, and `stats.{md,json}`. Run after each loop pass.
- `make wi-validate PROJECT=<p>` — the drift gate (invariants I1–I4). Run before pulling.
- `make doc-lint` — the *docs* drift gate: fails if any live doc names a retired mechanic
  (the discipline that keeps this rationalized set from rotting, process §27).

**Reading metrics** — `work/<p>/views/stats.md` gives the four DORA metrics **plus** each
part of the process's *contribution to gross lead time* (agent-work vs queue-wait vs
external-blocked), its *quality* (failure/rework rate by stage), and its *recovery* (MTTR
by failure class). That's how you find the constraint to attack next.

---

## 6. Where things live

- **`process/`** — persistent agent self-state, **project-agnostic**: the rulebook
  (`process-current.md`), `machinery/` (the contract + state graphs), `principles/`,
  `principle-failures/` (the learned-failure corpus), `experiments.md`, `improvement-slices/`.
  The DORA CSV `ledger/` is a **frozen** QueueApproach archive (never appended).
- **`work/<project>/`** — resettable project output, and its **own git repo** (so a
  project can be lifted out to stand alone). `items/{active,done}/` is the truth; `views/`
  is derived. `work/ACTIVE` is machine-local (never committed).
- **Two repos, never mixed:** commit project output inside `work/<project>`; commit
  agent-system/process changes (`.claude/`, `process/`, `CLAUDE.md`, `README.md`) in the
  parent repo (process §14).
- **Skills** (`.claude/skills/`) protect context: `work-items` (the substrate),
  `process-framework` (the doc-map), `delivery-principles`, `aws-architecture`,
  `ui-design-system`, and the vendor-neutral OTel bundle.

---

## 7. How the system improves itself

Every process change is a **falsifiable experiment** (`process/experiments.md`) with a
target metric and a scoring horizon. Retros recompute the metrics, review the
`principle-failures/` corpus, score open experiments, and write the next version. Process
snapshots are git tags (`process-v<NN>`), not files. The `§27` discipline + `make
doc-lint` keep the rulebook precise so it doesn't accrete back into a palimpsest — which
is exactly the failure the v82 cutover fixed.

---

## 8. Running more than one at once

Multiple instances can share the parent repo. Each owns its machine-local `work/ACTIVE`,
works on its own branch (`instance/<project>`), and reconciles to `main` continuously.
Per-item files are inherently disjoint, so concurrent instances don't clobber each other.
Always invoke the tools via their cross-platform launchers (never bare `python3`).
