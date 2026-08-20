# Personas and jobs-to-be-done — how they are USED

This file is about **method**. The live content is in
[`product/personas.md`](../product/personas.md) and
[`product/jtbd-map.md`](../product/jtbd-map.md). Read those for *who*; read this for *how the
project uses them*.

Terms in full on first use: **JTBD** = jobs-to-be-done; **UC** = use-case;
**AC** = acceptance criterion.

---

## 1. Personas and jobs are REFERENCE artifacts, not work items

They are not scheduled, not costed, and never appear in a queue. They are the vocabulary the
work items point at.

A use-case references them **by id**:

```yaml
personas: [P3, P5]
job: J7
```

**So the ids are load-bearing.** Renaming or renumbering a persona silently breaks the
meaning of every item that cites it. If you must change one, change it everywhere, and record
the change.

## 2. Why a persona exists here at all

Not for colour, and not for marketing. A persona exists so that two questions have a
defensible answer:

1. **Is this worth building?** — value is a claim about a *someone*. "The system should be
   faster" cannot be prioritised; "the on-call engineer currently takes 20 minutes to find
   which device failed" can.
2. **Is it done?** — a slice is finished when a named persona can get a named job done. That
   is checkable. "The feature is implemented" is not.

## 3. Jobs are drilled to a ROOT need before anything is built

A stated request is a *solution someone already picked*. The job is the need underneath it.
The technique is to keep asking why until the answer stops being about the system and starts
being about the person's situation.

> "I want a CSV export." → why? → "so I can build a pivot table" → why? → "so I can see
> which sites fail most" → why? → "because I have to decide where to send an engineer
> tomorrow morning."

The last answer is the job. It may well not need a CSV export.

**This is where the biggest savings in this project came from:** understanding the whole
problem through questions and design first is far cheaper than building the wrong thing and
rewriting it.

## 4. Failure modes are captured PER PERSONA

For each persona and job, we record what *failure looks like for them* — because the same
outage is a different problem to a support engineer, an integrator, and an end user. Those
per-persona failure modes are what runbooks and acceptance criteria are written against.

## 5. The operator classes

Every requirement is examined against the full set of operator classes, so a surface is not
built for its happy-path user alone and then discovered to be unsupportable. Read
`product/personas.md` for this project's actual set and their ids — **do not invent or
assume one**; the ids there are the ones the items cite.

At minimum, ask of every change: who *uses* it, who *operates* it, who *supports* it when it
breaks, and who *integrates* with it.

## 6. Using them in practice

| When you are… | Do this |
|---|---|
| taking a new requirement | identify the personas, drill each job to the root need, capture per-persona failure modes, and get the summary agreed before building |
| writing a use-case | set `personas:` and `job:` to real ids; write each AC as something a persona can observe |
| judging a slice | name the persona and the job they can now complete. If you cannot, the slice is not shaped right |
| writing a runbook | write for the **support** persona holding a symptom right now, not for the author |
| tempted to add a field or screen | find the job. No job, no build |

## 7. The honesty rule

If a persona is an assumption rather than someone real, **say so in
`product/personas.md`**. An assumed persona used to justify scope is how a project builds
confidently for nobody. Marking it as assumed costs one line and keeps the next person
honest.
