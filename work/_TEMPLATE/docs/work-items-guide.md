# Work items — the substrate

**Read this before you change any file under `items/`.** It is the one guide whose rules,
if broken, corrupt state rather than merely making a mess.

Terms in full on first use: **AC** = acceptance criterion; **SSOT** = single source of
truth; **UC** = use-case.

---

## 1. The model in one paragraph

**The work item is the single source of truth.** Each item is one Markdown file holding its
own definition *and* its complete append-only event log. An item's current state is not
stored anywhere — it is computed: **`state = fold(events)`**. Everything else you can see
(queues, the dependency tree, delivery metrics, the board) is a **derived view**, recomputed
from those logs on demand and never hand-maintained.

The practical consequence: **to change what the system believes, append an event.** Never
edit a status field, because there isn't one.

## 2. Layout

```
items/
  active/<ID>.md     work in progress or not yet started
  done/<ID>.md       completed — the SAME file, moved verbatim
views/               ALL DERIVED. never hand-edit
```

An item moves from `active/` to `done/` when its fold reaches a terminal state. Nothing is
rewritten on the way; the file is the whole history.

## 3. Anatomy of an item file

Three regions. Only the first is yours to write.

| Region | Yours? | What it is |
|---|---|---|
| **Authored frontmatter** — `id`, `type`, `title`, `value`, `cost`, `parents`, `deps`, `lane`, `personas`, `job`, `defer_until` | **yes** | the definition, and flow decisions about it |
| **`events:`** | **append only, via the tool** | the audit log. Never rewrite or reorder |
| **Everything below the `derived:` marker** | **NO — NEVER** | machine-written. `state`, `queue`, `ancestors`, metrics |
| **Markdown body** (after the frontmatter) | **yes** | the prose: definition, acceptance criteria, evidence |

**If you hand-edit the derived block**, your edit is overwritten the next time views are
regenerated — and until then the file states something false. There is no case where editing
it is correct.

## 4. Item types and how they relate

<Adjust to this project's actual types — read a few real files in `items/done/` to confirm.>

| Type | What it is |
|---|---|
| `requirement` | a unit of value the owner asked for |
| `chunk` | a coherent part of a requirement |
| `slice` | the smallest increment that delivers real customer value |
| `use-case` | a single testable behaviour, with acceptance criteria |
| `defect` | something that does not work as intended |
| `open-item` | a verified finding not yet scheduled |

Hierarchy is expressed by the **`parents:`** edge on the child, never by a list on the
parent — so a parent's children are derived. Completion **bubbles up**: a parent reaches
done when its children do. You never hand-transition a parent.

**`deps:`** is different from `parents:`. It means *this cannot start until that is done*,
and it is what the pull loop reads to decide what can safely be worked in parallel.

## 5. Changing state — the only supported path

State changes go through the **append tool**, which is edge-checked against a per-type state
graph. An illegal transition is **refused, not applied**.

```
<append-tool> --project <PROJECT> --id <ITEM-ID> --event <EVENT> --agent <ROLE> [--note-file <FILE>]
```

Then regenerate the views, and validate:

```
<project-tool>   # recompute views/ from all item logs
<validate-tool>  # invariant/drift gate — non-zero means stop
```

**If a transition is refused, read the error.** It lists the events that *are* legal from
the current state, and which roles may fire each. That message is almost always telling you
that your mental model of the item's state is wrong — not that the graph is.

## 6. The pitfalls — every one of these has already cost real time

| Pitfall | What happens | Do this instead |
|---|---|---|
| A **newline** in an event note | rejected outright | write it as one line. Long is fine — there is no length limit |
| Passing a long note on the command line | shell mangling, and punctuation can truncate it | write the note to a file and pass the **note-file** option |
| Using a *similar-looking* option name for the note file | on at least one occasion silently accepted, writing an **EMPTY** note into an append-only log | use the exact documented option name; **verify the note landed** by reading the item back |
| Hand-editing `derived:` | silently overwritten; file lies until then | append an event |
| Hand-editing `views/` | overwritten on next regeneration | change the items |
| Creating an item by copying another | stale `id`, inherited events, corrupt history | start from the authored frontmatter only, with an empty `events:` list |
| Assuming an empty `events:` list means "no state" | the fold gives a **type-specific initial state** — so the first legal event is often *not* "created" | read the refusal message; it names the legal first events |
| Concluding "it is pushed / deployed" from an event **note** | notes go stale; one was ~35h stale and produced a confident wrong diagnosis | derive it from the recorded commit ref and the actual git history |

## 7. Concurrency — why this design was chosen

Multiple agents work at once. Because every item is **its own file**, concurrent writes to
different items do not contend. That is deliberate: an earlier single-shared-index design
produced lost updates.

Two things still contend and need care:

- **the git index**, if two workers stage at once — commit with an explicit pathspec naming
  only your own files rather than staging broadly;
- **the same item**, if two workers append to it — don't; one owner per item at a time.

## 8. How to read the state of the world quickly

Read `views/` — never recompute it in your head from the item files:

| File | Answers |
|---|---|
| `views/queues.*` | what is where, and how deep each queue is |
| `views/tree.*` | the dependency and parent/child structure |
| `views/stats.*` | delivery metrics, and where time is actually going |
| `views/state.*` | every item's current folded state |

If a view looks wrong, **regenerate it first**, then trust it. If it is still wrong, the bug
is in an item's event log, not in the view.
