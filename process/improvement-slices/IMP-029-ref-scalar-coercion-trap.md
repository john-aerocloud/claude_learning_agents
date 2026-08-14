# IMP-029 — `ref:` is silently coerced to `int` when a short sha is all-digits

**Opened:** 2026-08-01 (OAG retro v126). **Owner:** work-items machinery
(`.claude/skills/work-items/scripts/work-items.py`). **Found by:** the engineer building
`make loop-gate` (EXP-123), who worked around it locally and correctly declined to widen
scope.

## The defect

Item frontmatter is parsed such that an event's `ref:` value becomes a **Python `int`** when
the short sha happens to be all digits. `5095849` — the DEFECT-OAG-045 fix, and the founding
example of the whole v126 retro — is exactly that shape.

`loop-gate` coerces with `str()` internally, so the new gate is safe. **Every other consumer
of `ref:` is not.** A consumer that does `ref.startswith(...)`, slices it, passes it to a
`git` argv, or compares it to a string sha will either raise or silently mismatch, and the
mismatch is the dangerous case: a sha that fails to resolve looks identical to a sha that
resolves negative.

## Why it matters more than it looks

The v126 finding is that push/deploy state must be **derived** from the structured `ref:`
plus `git merge-base --is-ancestor`, precisely because prose lies (§F8a, §17c). That rule now
depends on `ref:` being trustworthy. A type that changes based on whether a sha contains a
letter is a latent hole directly under the new load-bearing mechanism — roughly 1 in 16
short shas are all-digits at 7 characters, so this fails intermittently and looks like an
environment problem.

## The fix

Coerce `ref:` to `str` **at parse time**, in the frontmatter loader, so no downstream consumer
can ever see an `int`. Audit the other scalar fields for the same trap (`id`, `job`, and
anything else that can be all-digits — `job: J17` is safe, a bare `job: 17` would not be).

**Acceptance is the gate firing (§17c), not the code landing:** a test that appends an event
with an all-digit `ref:` and asserts every read path returns a `str`, observed RED against the
current loader before the fix.

## Not done here

Deliberately not fixed inside the `loop-gate` work — that change was already load-bearing for
a versioned process bump, and widening it to touch the shared frontmatter loader would have
put every other item-file consumer in the blast radius of an unversioned edit. Queued as its
own slice so it gets its own red test and its own review.
