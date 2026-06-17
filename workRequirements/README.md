# workRequirements

Requirements specs to feed into the delivery-agent pipeline.

## observability-ui-requirements.md — Delivery Observatory

A local UI to **observe, interrogate, and steer** the agent pipeline. Reads repo
state via files (read-only); every write goes back through Claude with a
preview-and-accept gate. Phased: observe → interrogate/steer slicing →
cost-of-delay work generation.

### How to kick it off

```
/project-new observatory "Local UI to observe and steer the delivery-agent pipeline"
```

Then intake the chunks from §9 of the spec, highest-value first. Either paste a
chunk's JTBD line, or point intake at the file:

```
/intake "CHK-1 (see workRequirements/observability-ui-requirements.md §9): read layer & project registry — parse the repo's queues/items/DORA files and serve them locally read-only with file-watch refresh."
```

`/intake` will JTBD-frame, value/cost, and enqueue; `/slice-next` decomposes
into use-cases just-in-time; `/loop-run observatory` runs the pull loop.

### What the spec pins down
- The **data contract** (§4): the exact files/columns/locations the UI reads,
  verified against the current repo.
- The **write contract** (§6): UI composes preview-first prompts and hands them
  to chat; it never mutates the repo itself.
- **Phasing** (§7) and **intake-ready chunks** (§9) with acceptance criteria.
