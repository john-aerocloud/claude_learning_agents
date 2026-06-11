---
project: observatory
owner: product
updated: 2026-06-10
---

# Chunk plan — observatory

Per-chunk: job, done-condition, delivered slices (with outcomes), forecast remaining
slices (thinnest-first; revisable at every slice-next). Updated at slice-next (place
the new slice, re-cut remaining forecast) and at delivery (move to delivered, re-assess
done-condition).

---

## Summary table

| Chunk | Title | Job | Class | Status | Delivered slices | Next/forecast |
|-------|-------|-----|-------|--------|-----------------|---------------|
| CHK-1 | Read layer & project registry | J1/J2 enabler | CORE | DONE | s001 | — |
| CHK-2 | Value-stream map (full pipeline) | J1 — see the whole process live | CORE | IN PROGRESS | s002 (superseded thin map) | s004 (value-stream map) |
| CHK-4 | Work-item tree & zoom/drill | J2 — navigate and interrogate | CORE | BACKLOG | — | s005 (forecast) |
| CHK-5 | Prompt-handoff steer engine | J3 — steer without file edits | SECONDARY | PLANNED | — | s006 (forecast) |
| CHK-6 | Interrogate & slicing input | J3 — deeper steer | SECONDARY | DEFINED | — | s015 (defined; behind s013) |
| CHK-7 | Guided cost-of-delay intake | J4 — responsible work generation | SECONDARY | DEFINED | — | s018 (defined; dep on s014) |
| CHK-8 | Defects view | J-QUALITY — observe quality/MTTR without file grep | SECONDARY | DEFINED | — | s013 (defined) |

**RE-SCOPE NOTE (2026-06-09):** Original CHK-2 (thin 4-box queue map) and CHK-3 (DORA
panel + stage cards) merged into a single re-scoped CHK-2 with a new done-condition:
the full per-item delivery value-stream map with per-stage metrics from the ledger.
s002 (thin queue map, DELIVERED) is kept but superseded as the primary view. s003
(DORA panel, not yet built) is DROPPED — its outcome is absorbed into CHK-2's new
done-condition. Next slice is s004-value-stream-map.

---

## CHK-1 — Read layer & project registry

**Job served:** J1/J2 (data enabler — no views are possible without a trusted read layer).
**Classification:** CORE.

**Done condition:** Lists all `work/*` projects except `_TEMPLATE`; reads `ACTIVE`;
parses each queue CSV (incl. header-only), `items.csv`, `policy.csv`, `baseline.md`,
`flow.md`; fails soft on missing optional files; re-emits within Ns of a file change.

**Status: DONE.**

| Slice | Outcome |
|-------|---------|
| s001-read-layer | Express server on :3001; UC1–UC6 all green; 21 routes; SSE file-watch <1s; all §9 CHK-1 acceptance cases pass |

---

## CHK-2 — Value-stream map (full pipeline)  [RE-SCOPED 2026-06-09]

**Job served:** J1 — operator sees the WHOLE delivery process value-stream with
per-stage throughput, dwell, WIP, and rework, sourced from the live ledger.
**Classification:** CORE.

**Done condition (re-scoped):** The UI renders all canonical pipeline stages in
sequence (Intake → Decompose → Ready → Capabilities → UI-Design → Build/TDD →
UI-Validate → Deploy → Validate → Done) with the Rework loop and both gates; each
stage shows throughput, dwell median, in-flight WIP, and rework count sourced from
`process/dora/ledger.csv`; in-flight items are visible (not invisible after pull);
each figure links to its source ledger rows; map updates live on ledger change.
**Real-data acceptance required:** at least one stage's numbers hand-verified against
the live ledger by the tester. Fixture-only green tests do NOT close this chunk.

**Previously superseded:** original CHK-2 done-condition (4-box queue map, s002 DONE)
is subsumed — s002 stays in the codebase but is no longer the primary pipeline view.
Original CHK-3 (DORA panel, s003) is DROPPED; its value is absorbed here and into
a future follow-on slice if the human signals demand.

**Status: IN PROGRESS** — s004 defined; foundational ledger endpoint and map render
to build.

| Slice | Outcome |
|-------|---------|
| s002-pipeline-map | DELIVERED (thin 4-box queue map; superseded as primary view; 222 tests) |
| s003-dora-panel | DROPPED (absorbed into CHK-2 re-scope; not built) |
| s004-value-stream-map | _(defined; in build queue)_ |

**Forecast remaining slices:**
- s004 delivers the full value-stream map + per-stage metrics + live refresh
  (expected to complete CHK-2 done-condition if real-data acceptance passes)
- Follow-on improvement slice (forecast): DORA 4-metric panel from `baseline.md` if
  the human signals value after s004 ships

---

## CHK-4 — Work-item tree & zoom/drill

**Job served:** J2 — operator navigates REQ→CHK→SLC→UC, drills into any item
for full artifact + history, and returns to the map.
**Classification:** CORE.

**Done condition:** Renders tree from `items.csv`/`items-tree.md` with state +
value/cost; drill pipeline→queue→item→slice-artifact (markdown + `.mmd` rendered);
item history filtered from `ledger.csv` by `item_id`; explicit zoom-out;
`/process` vs `/work` visually distinct.

**Status: BACKLOG.**

| Slice | Outcome |
|-------|---------|
| _(none yet)_ | — |

**Forecast remaining slices:**
- s004-item-tree — tree render + state/value/cost per node (thinnest first; delivers J2 "where is work" core)
- s005-drill-detail — click node → detail pane (slice artifacts + ledger history + deps) + zoom-out

---

## CHK-5 — Prompt-handoff steer engine

**Job served:** J3 — all steer actions emit a structured prompt; no UI writes.
**Classification:** SECONDARY.

**Done condition:** For any steer action, emits a prompt naming command + ids/paths
and instructing Claude to present (description + diagram + example) and await
acceptance before writing; UI performs zero file writes.

**Status: PLANNED** (after CHK-4 CORE jobs complete).

**Forecast remaining slices:**
- s005-prompt-handoff — compose + clipboard-hand-off engine for at least two steer actions

---

## CHK-6 — Interrogate & slicing input

**Job served:** J3 — when the operator needs to navigate WIP and propose
re-slice/split/merge/reprioritise actions, they want an action-specific flow
with before/after preview so steering is structured, not freeform.
**Classification:** SECONDARY.

**Done condition:** Operator can browse all in-flight WIP items sorted by
time-in-stage, select any item, and initiate at minimum the re-slice/split
action with a before/after preview (current scope + proposed Part A/B) that
produces a complete, copy-ready enriched prompt routed through the s014 steer
engine. All steering bypasses the agents only via the prompt-handoff gate.

**Status: DEFINED** — s015 decomposed (4 UCs; ~9.5h); scheduled after s013
(CHK-8 defects view) per secondary-job ranking and value argument below.

**Scheduling note — s013 vs s015:** s013 (defects view) ranks AHEAD of s015
because: (1) both are SECONDARY, (2) s013 is fully independent of the steer
engine whereas s015 depends on s014 completing first, (3) s013 delivers a
distinct observe capability (quality/MTTR visibility) that is ready to build
now, while s015 cannot start its s014-dependent UCs until s014 ships. The
correct scheduling is s013 → s015, not parallel. No value argument reverses
this; s015 provides no observe capability that s013 blocks.

| Slice | Outcome |
|-------|---------|
| s015-wip-navigate-reslice-preview | _(defined; 4 UCs; ~9.5h; awaiting s014 delivery + s013 sequencing)_ |

**Forecast remaining slices (thinnest-first):**
- s015 delivers: WIP navigation panel + re-slice/split before/after preview
  (completes CHK-6 first-slice done-condition if real-data acceptance passes)
- s016 (forecast): re-prioritise with queue-position before/after preview
  (second CHK-6 action type; can reuse WipPanel and ReslicePreviewPanel patterns)
- s017 (forecast): defect-raise action enriched with four-field pre-fill from
  item context (third action type; builds on s013 defects data contract)
- s018 (forecast): merge action (collapse two items; most complex; last)
  — revisit need after s015-s017 ship

---

## CHK-7 — Guided cost-of-delay intake

**Job served:** J4 — operator has a raw need and wants to be guided through JTBD
framing and cost-of-delay capture, see where it ranks in the queue, and hand off
a complete `/intake` prompt to Claude so work enters prioritisable, not vague.
**Classification:** SECONDARY. Scheduled after CHK-5/CHK-6 (depends on CHK-5's
SteerPanel clipboard-copy mechanic for UC-S018-4 handoff).

**Done condition:** Operator can open the intake wizard from the sidebar, complete
JTBD (situation/motivation/outcome) and CoD signals (value tier + urgency +
risk-of-delay), see a directional queue-rank preview, and generate + copy a
complete, template-compliant `/intake` prompt — without the UI writing a single
byte to the filesystem.

**Status: DEFINED** — s018 decomposed; 4 UCs; ~8h; awaiting CHK-5 (s014) delivery
(hard dep on UC-S014-4 clipboard-copy mechanic).

| Slice | Outcome |
|-------|---------|
| s018-guided-cod-intake | _(defined; 4 UCs; ~8h; depends on s014 UC-S014-4)_ |

**Forecast remaining slices (thinnest-first):**
- s018 is expected to complete CHK-7 done-condition if real-data acceptance passes
- Follow-on (forecast): richer CoD scoring (WSJF / CD3) if human signals demand
  after s018 ships; rank preview with precise insertion index once queue-costing
  is more mature

---

## CHK-8 — Defects view

**Job served:** J-QUALITY — when the operator wants to see the quality picture,
they want all defects with status + severity at a glance and can drill into any
one for the four fields, root cause, resolution, and MTTR timeline — so they can
assess quality/MTTR without grepping files.
**Classification:** SECONDARY.

**Done condition:** A Defects section renders all defects (DEFECT-*.md records)
with status + severity + MTTR (time-unit); clicking any row opens the existing
floating drawer with the four fields + root cause + resolution as styled HTML and
a MTTR timeline card; open (CONFIRMED) defects are visually distinct; list and
drawer refresh live on file change. Real-data acceptance required: all 10 live
defect records correct, DEFECT-001 MTTR hand-verified against ledger.

**Status: DEFINED** — s013 decomposed; in build queue (SECONDARY priority;
scheduled after CHK-4 CORE jobs advance).

| Slice | Outcome |
|-------|---------|
| s013-defects-view | _(defined; 4 UCs; ~7h; awaiting build)_ |

**Forecast remaining slices:**
- s013 is expected to complete CHK-8 done-condition if real-data acceptance passes
- Follow-on (forecast): source-events reveal on MTTR figures (EXP-033 pattern);
  MTTR trend/aggregate panel if operator signals demand after s013 ships
