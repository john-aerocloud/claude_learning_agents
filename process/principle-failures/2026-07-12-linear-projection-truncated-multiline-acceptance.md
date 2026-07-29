---
date: 2026-07-12
project: ROC
iteration: 1
principle: "board projection is a pure render of the item (linear-mapping §2a)"
dora_metric_harmed: change_failure_rate
---

## Expected
The `linear` agent, told to compose a "pure render of the item — never invented",
would faithfully reproduce each work item's acceptance criteria on the board (the
human-facing surface humans actually read).

## Actual
The agent composed the issue description by hand (LLM prose) and emitted only the
FIRST physical line of each multi-line acceptance-criterion bullet — the item files
hard-wrap ACs across several indented lines, and the continuation lines were dropped.
UC-ROC-015's board issue (ROC-16) showed "AC-015-1: Given a real issue key, when the
real adapter's teardown" and stopped — three ACs reduced to nonsense fragments. The
human reviewing the board flagged them as gibberish. A faithful-looking-but-lossy
projection is an escaped defect on the exact surface the board exists to serve, and
nothing measured it (item files were correct; only the projection lied).

## Why the principle did not hold
"Pure render" was an INSTRUCTION to an LLM, not a mechanism. An LLM composing free
text will paraphrase/compress/first-line-summarise multi-line content — fidelity is
not guaranteed by telling it to be faithful. Same family as the false-green /
presence-not-correctness failures: "it looks done" ≠ "it is correct", now on the
projection surface.

## Guidance for next time
A projection that must be FAITHFUL must be DETERMINISTIC, not hand-composed. Fixed by
`.claude/tools/linear-project.py` (stdlib Python, `make board-project PROJECT= ID=`):
parses the item, joins each AC's wrapped continuation lines into the complete
criterion, renders the five §2a sections, and upserts idempotently via the Linear
API — proven by `make test-board-project` (35 offline assertions) + a live read-back.
The `linear` agent now SHELLS OUT to it and must never hand-compose (linear.md v89).
Detection signal: a board description whose bullet text ends mid-clause vs the item
file. NOTE: `jira.md` has the same latent hand-compose bug — when a project next uses
the Jira board, give it an equivalent tested renderer rather than repeating this.
</content>
