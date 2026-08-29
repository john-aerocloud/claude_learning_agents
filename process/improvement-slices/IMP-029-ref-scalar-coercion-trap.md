# IMP-029 — `ref:` is silently coerced to `int` when a short sha is all-digits

**Status:** QUEUED (re-decided v159 retro, ROC 2026-08-29) — OagEventSource-origin; ROC reports, does not retire (§25a v143/v145). Still real: a silent int coercion on an all-digit short sha corrupts the one field `loop-gate`'s push/ancestry checks resolve against.

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

---

## RESOLVED 2026-08-20 (DEFECT-OAG-128) — and the 19-day delay had a measurable cost

**This slice was right about everything, including the consequence, and nobody swept it.**
It said: *"a sha that fails to resolve looks identical to a sha that resolves negative."*
That is exactly what happened. `UC-XA5`'s `built_green` recorded the sha `0605428`; the
loader int-coerced it to `605428`; `wi-project` then RE-RENDERED the item file without the
leading zero, so **the data loss is now permanent on disk**. The ref resolves in neither
repo, which is the `git cat-file -t fb080d9` → *Not a valid object name* signature of
destroyed work — while the real commit `06054289ae9d50bf194b98643d920939b5d7531b`
("test(aerobus): pin out-of-org/unlisted principal DENIED on live Aerobus policy") has been
on `origin/main` the whole time.

It also cost a would-be **FALSE POSITIVE on a brand-new alarm.** `DEFECT-OAG-128` added
`loop-gate` check 12 (every recorded `ref:` must still exist in some readable repo, or the
loop blocks with the destroyed-work alarm). On its **first real run** it fired on `UC-XA5` —
so the very first firing of the alarm that means "work may have been annihilated" would have
been wrong, off this bug. §17i's point 3 exactly: the lesson was written down in this repo
and not swept.

**Fixed, both ends:**
- **Prescribed fix, implemented as written.** `ref` is never number-coerced at parse time
  (`EVENT_STRING_FIELDS`), so no new item can be damaged. Pinned by a test that a `ref` of
  `0605428` round-trips through a real item file with its zero intact.
- **Recovery for the damage already on disk**, which the slice did not anticipate needing:
  an all-digit ref is retried zero-padded when resolving (`_ref_candidates`), bounded to
  all-digit refs and to git's own 4-char abbreviation floor. `UC-XA5` now reads ON-TRUNK.
  11 of 202 registry refs are all-digit, so this was a standing hazard, not a one-off.

**The audit this slice asked for is CLOSED.** Run through the real parser over all 478 items:
the only fields parsed as numbers are `value`, `cost`, `tokens`, `duration_ms` — every one
numeric *by intent*. So `ref` was the sole live hazard. `id` and `job` are protected anyway,
at a population of **zero**: they are strings by intent (`DEFECT-OAG-128`, `J0`) and the only
reason they are not coerced today is that nobody has written an all-digit one, which is luck
rather than a property (§17h). `title` is always quoted and `defer_until` is date-shaped.

**Acceptance met on the slice's own terms** — it asked for the gate firing, not the code
landing. It fires: check 12 runs registry-wide before every pull, and `make loop-gate
PROJECT=OagEventSource` reports zero destroyed commits across 478 items, with `UC-XA5` no
longer among them.
