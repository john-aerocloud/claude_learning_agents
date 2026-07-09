---
description: RETIRED (v83). The single upstream human gate split by concern — requirements now enter via /requirement (which adds persona + jobs-to-be-done elaboration and a human-signed dossier); defects enter via /defect (which owns capture/reproduce/prioritise/register + the gap-closing retro). This shim exists only so older references resolve.
argument-hint: (retired — use /requirement or /defect)
allowed-tools: Read
---

`/intake` is retired as of v83. Its two concerns are now separated:

- **New requirement** → `/requirement "<free text>" [project]` — elaborates personas
  (four mandatory operator classes) and jobs-to-be-done (drilled to root need via
  5-whys, per-persona failure modes) into a human-signed dossier, then frames
  value/cost and registers the event-sourced item.
- **Defect** → `/defect "<expected> | <actual> | <intent> | <importance>"` — captures
  the four fields, reproduces-to-confirm, prioritises (defects pre-empt, §F5),
  registers (`EVENT=reported`), then runs the mandatory gap-closing retro.

Route the request to whichever applies and stop.
