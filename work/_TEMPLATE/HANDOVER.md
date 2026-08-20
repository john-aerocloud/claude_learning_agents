# HANDOVER — picking up <PROJECT>

**Audience: a person or agent who has just been handed this repository and has no other context.**

You can read this whole file in five minutes. Do that before you change anything.

---

## 1. What this repository is

<One paragraph: what the system does, for whom. No history, no roadmap.>

**This repo is deliberately self-contained.** It was built inside a larger agent-operated
delivery system, but it is designed to be lifted out and worked on standalone — which is
why this pack exists. The *artefacts* of the way we work (work items, personas,
architecture, derived views) all live here. Some of the *tooling* does not; §5 says exactly
what is missing and what to do about it.

## 2. Read in this order

| # | Read | Why |
|---|---|---|
| 1 | `README.md` | what exists today, and the caveats that qualify it |
| 2 | `DOCS-LAYOUT.md` | where every document belongs. Read before creating any `.md` |
| 3 | `docs/ways-of-working.md` | how work flows, and which rules are hard gates |
| 4 | `docs/work-items-guide.md` | the work-item substrate — **the file that stops you breaking things** |
| 5 | `docs/personas-and-jobs.md` | who we build for, and how personas are actually used |
| 6 | `RESUME.md` | the live state: what is in flight, what is blocked, what is owed |

`RESUME.md` is the only one of these that goes stale by design. **Trust the repo over the
prose** — if `RESUME.md` and a work item disagree, the item wins, and the derived views win
over both.

## 3. The non-negotiables

Break these and you will corrupt state, lose an audit trail, or ship something untrue.

| Rule | Why it exists |
|---|---|
| **Never hand-edit anything below the `derived:` marker in a work item.** | It is regenerated. Your edit is silently overwritten, and until it is, the item lies. |
| **Never hand-edit anything in `views/`.** | Every view is derived from the item event logs. Edit the items. |
| **An event note is a single line.** A newline is rejected outright. | An event is stored as a one-line record; a newline would truncate it and corrupt an append-only log. |
| **Work on trunk. No feature branches.** | Continuous integration is the point. Long-lived branches hide conflicts. |
| **Test first, always.** | See `docs/ways-of-working.md`. A test written after the code tends to assert what the code does, not what was asked for. |
| **A defect is reproduced BEFORE it is fixed.** | Otherwise you cannot know you fixed it, and "phantom fixes" are how a defect returns. |
| **Never straight to production.** | Prove it in dev; production only confirms. |
| **A green result you never proved could go red is not evidence.** | Gates that cannot fail have shipped here before and read as safety while providing none. |

## 4. Where to go for a given job

| I want to… | Go to |
|---|---|
| understand what the system can do | `README.md`, then `actual/` if present |
| run it locally | `docs/local-development.md` |
| use it / drive the surfaces | `docs/usage.md` |
| fix something that is broken right now | `docs/runbooks/` |
| know why a decision was made | `decision-log.md` |
| know what has been delivered and when | `docs/delivery-history.md` |
| see all work, past and present | `items/done/`, `items/active/` |
| see current state at a glance | `views/` |
| know who we build for | `product/personas.md`, `product/jtbd-map.md` |

## 5. What is NOT in this repo, and what to do about it

The command-line tooling that reads and writes work items lives in the **parent
agent-system repository**, not here. Without it you can still **read** everything (the item
files are plain Markdown and the whole state is in them), but you cannot **regenerate** the
derived views or append events through the checked path.

If you have been handed only this repo and intend to keep the method running, ask the
handing-over party for:

- the work-item machinery (the `wi-append` / `wi-project` / `wi-validate` entry points),
- the state graph that defines which transitions are legal per item type,
- the process document that defines the gates.

**If you will not have that tooling,** say so explicitly and decide deliberately how state
will be tracked instead — do not keep appending events by hand into files whose invariants
nothing is checking. A half-maintained event log is worse than an honestly abandoned one,
because everything downstream still reads as authoritative.
