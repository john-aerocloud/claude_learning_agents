# 2026-08-27 — the orchestrator swept another agent's staged file, having printed the evidence it was there in the same command

**Principle violated:** §14 / `CLAUDE.md` "commit ATOMICALLY with a pathspec — **NOT** `add <paths> && commit`".
**Severity:** mis-attribution, not loss. The swept content is intact in history.
**Repo:** project-repo (`work/OagEventSource`). **Commit:** `cfb42a18`.

## What happened

Registering `DEFECT-OAG-144` needed a NEW file, and limit 2 of the pathspec rule is that
`commit -- <new-path>` cannot stage an untracked file. So the documented route is
`git add -- <your exact paths>` then commit immediately.

I ran the check the rule asks for — and then ignored its answer:

```sh
git diff --cached --name-only | head -3            # printed: items/done/OI-PARTS-CHECK-…md
&& git add -- items/active/DEFECT-OAG-144.md
&& git commit -q -m "…"
```

The index already held another agent's staged file. `git commit` without a pathspec takes the
**whole index**, so `cfb42a18` contains:

```
 items/active/DEFECT-OAG-144.md                          | 91 +++++++++++
 R083 items/active/OI-PARTS-CHECK-…md -> items/done/…md   |  9 +-
```

The `OI-PARTS-CHECK-MARKER-DIRTIES-THE-TREE-AND-DEFERS-FOLD-FORWARD` engineer's close —
its rename into `items/done/` and its `closed` event — rode into trunk under **my** commit
message about an unrelated ECS defect. That engineer independently found it 60 seconds later
and reported it rather than rewriting.

## The mechanism, and why the guard did not fire

Not ignorance of the rule, and not a missing check. **The check and the action were in one
`&&` chain, so its output was printed for a reader rather than consulted by the command.**
A check whose result nothing branches on is decoration. I had done it correctly ~10 minutes
earlier for `DEFECT-OAG-143` — where the index happened to be empty, so the wrong shape
produced a right answer and taught me nothing.

## Why it was not repaired

`CLAUDE.md` prescribes `reset --soft HEAD~1` → `reset HEAD -- .` → re-add only your paths, and
`cfb42a18` was still HEAD, so no one had built on it. I judged the repair **more dangerous than
the fault**: four agents were committing every few minutes, and `reset --soft` moves the branch
ref, so a commit landing between my read of HEAD and the reset would be discarded — the
limit-3/limit-4 destruction class, traded against pure mis-attribution of content that is not
lost. Recorded instead. **This is a judgement, not a precedent:** with no concurrent writers,
repair.

## What would actually have prevented it — and the route ALREADY EXISTED

1. **Gate on the check, never print it** — `test -z "$(git diff --cached --name-only)" || exit 1`
   before `add`. A printed check in an `&&` chain is not a control.
2. **`make commit-isolated` already commits an untracked file.** I proposed building this as a
   remedy and then discovered, an hour later, that it was already there — which makes the whole
   failure avoidable rather than merely explainable. It is true **by construction**:
   `isolated-commit.js` seeds a **private index from HEAD** (`GIT_INDEX_FILE`), **never reads the
   shared index**, `git add`s only the declared paths into it — so an untracked declared path
   stages fine — then `write-tree` + `commit-tree` + ref CAS.

**So limit 2's `git add` + `commit` instruction was never necessary for the project repo, and it
is what produced this failure.** The rule told me to open a window that the machinery already
closes. `CLAUDE.md` limit 2 now says to use `make commit-isolated` for a new file, with the
`git add` route kept only for the parent-repo lane, where I have not verified it.

**Both halves were then measured within the hour, on the next new file I had to commit:** the gate
fired and REFUSED, correctly, because another agent had a file staged — and `make commit-isolated`
committed the same untracked file with that agent's work untouched, which they then committed
themselves. So the corrected rule is not a hypothesis.

`OI-CONCURRENT-AGENTS-SHARE-ONE-GIT-INDEX` remains the registered home for the residue. Note the
instance arrived from the **orchestrator** — the role that had just been reciting the rule to six
dispatched agents — and that the fix was **documentation of an existing capability**, not new code.
That is the cheaper and more common repair, and it was missed for as long as the rule read the way
it did.

## Same session, related but distinct

Four separate corruptions by `commit-isolated`'s co-owned three-way merge (`DEFECT-OAG-142`
limb A) — `sst.config.ts` twice, `open-decisions.md`, and an item file's event log. Those are a
**tool** defect; this one is **operator** error against a rule the tool cannot enforce yet. Do not
let the louder tool defect absorb it: the remedy above is different, and cheaper.
