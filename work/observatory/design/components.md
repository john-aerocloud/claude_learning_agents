---
project: observatory
owner: ui-designer
seeded: s002-pipeline-map
library: none (token-based custom; no component library named in requirements)
---

# Component inventory

Each entry: states, stable selector (a11y contract + test hook), a11y notes,
library primitive (custom for all v1). Selectors are the engineer's build
contract AND the tester's specs.

## PipelineMap  (s002 / UC3)
- **Role:** the zoomed-out single-screen pull-system overview.
- **States:** default · empty ("no active project") · loading (initial fetch).
- **Selector:** `role="region"` + `aria-label="Pipeline map"`; `data-testid="pipeline-map"`.
- **A11y:** landmark region; contains the ordered list of QueueBoxes + FlowArrows.
- **Library:** custom.

## QueueBox  (s002 / UC3 + UC4 + UC5)
- **Role:** one queue (Intake | Ready | Deploy | Rework) with name + live count + buffer meta.
- **States:** `ok` · `starving` · `over-wip` (status) × `constraint` on/off (orthogonal) · focus · empty(0 count is a valid value, not empty).
- **Selector:** `role="group"` + `aria-label` = `"<Name> queue, <n> items, <state>"`;
  `data-testid="queue-<name>"` (name lowercased: intake|ready|deploy|rework);
  `data-status="ok|starving|over-wip"`; `data-constraint="true|false"`.
- **Focusable:** `tabindex="0"` (read-only, keyboard-reachable per AC3.5).
- **A11y:** accessible name includes count AND state (so a screen reader announces
  "Ready queue, 1 item, starving" — AC4.5). Visible focus ring (`--focus-ring`).
- **Library:** custom.

## BufferStateIndicator  (s002 / UC4)
- **Role:** the starving / over-WIP badge inside a QueueBox.
- **States:** starving · over-wip · (none when ok — element absent).
- **Selector:** `data-testid="state-badge"` on the badge; visible text `"starving"`/`"over-WIP"`;
  icon `<span aria-hidden="true">` (▽/△) + visible text label.
- **A11y:** REDUNDANT — icon (aria-hidden) + visible text + colour + box border.
  Never colour-only. Text label is the authoritative cue.
- **Library:** custom.

## ConstraintBadge  (s002 / UC5)
- **Role:** marks the QueueBox named as the ToC constraint in baseline.md.
- **States:** present (on the constraint box) · absent.
- **Selector:** `data-testid="constraint-badge"`; visible text `"constraint"`;
  icon `<span aria-hidden="true">◆</span>`. QueueBox carries `data-constraint="true"`.
- **A11y:** distinct visual channel (corner ribbon, diamond, magenta) so it can
  co-occur with a state badge; accessible name contribution "constraint".
- **Library:** custom.

## FlowArrow  (s002 / UC3)
- **Role:** the directional connector between queue boxes (inline SVG line/path + arrowhead).
- **States:** static (forward) · static (rework return loop).
- **Selector:** `data-testid="flow-arrow"` with `data-from`/`data-to`; SVG is
  `aria-hidden="true"` (decorative — topology is also conveyed by DOM order + region label).
- **A11y:** decorative; flow order is conveyed structurally, not only by the arrow.
- **Library:** custom (inline SVG).

## LiveStatusDot  (s002 / UC6)
- **Role:** indicates the SSE connection is live / reconnecting.
- **States:** connected · reconnecting · (last-known, on error).
- **Selector:** `data-testid="live-status"`; `aria-label` = `"Live updates: connected"` / `"reconnecting"`.
  Visible text/dot + label (not colour-only).
- **A11y:** `role="status"` `aria-live="polite"` so reconnect is announced once, not spammed.
- **Library:** custom.

---

# CHK-3 (s003) components — DORA panel / stage cards / time-thief

All attach to the existing dashboard `<main>` AROUND the PipelineMap (no re-layout
of the map). Data shapes are UC1's `DoraMetrics`, `AgentTaskTime[]`, `TimeThief[]`,
`constraint`. Every figure carries `data-source` (UC5 / §8 traceability).

## DoraPanel  (s003 / UC2)
- **Role:** the four-metric at-a-glance DORA panel (gross lead time, deploy freq,
  change-failure rate, MTTR) — the first CORE render of CHK-3.
- **Props:** `{ metrics: DoraMetrics; sourceRef: string }`.
- **States:** default (4 metrics) · empty ("No baseline computed yet", when all
  metrics null) · loading (initial fetch, before first parse).
- **Selector:** `role="region"` + `aria-label="DORA metrics"`; `data-testid="dora-panel"`.
  Contains four MetricCards as a labelled group/list.
- **A11y:** landmark region with a visible `<h2>` "DORA metrics"; the four cards
  are a `role="list"` of `role="listitem"` so a screen reader announces "4 items".
- **Library:** custom.

## MetricCard  (s003 / UC2)
- **Role:** one DORA metric — label, big value, computation window, source link.
- **Props:** `{ label: string; value: string; window: string; source: string }`.
- **States:** default · empty(metric null → card absent; panel empty-state covers it).
- **Selector:** `data-testid="metric-<key>"` (key ∈ glt|deploy-freq|cfr|mttr);
  the value element carries `data-metric` (UC5 traversal hook) AND
  `data-source="process/dora/baseline.md#four-key-metrics"`.
- **A11y:** the value has accessible context — the card is `role="listitem"` with
  the label as visible `<dt>`/heading text so the number is never announced bare
  (e.g. "Gross lead time (median): 3092 s, over 20 slice(s)"). Window line uses
  `--c-text-dim` (≥ 6:1). Geometry: cards lay out as a row/grid that WRAPS, not a
  single stacked column at desktop width (assert ≥ 2 cards share a top offset).
- **Library:** custom.

## StageCardGrid  (s003 / UC3)
- **Role:** the container for per-agent StageCards (one per `AgentTaskTime` row).
- **Props:** `{ agents: AgentTaskTime[]; constraint: string | null; sourceRef: string }`.
- **States:** default (N cards) · empty ("No agent task times yet", empty agents).
- **Selector:** `role="region"` + `aria-label="Per-agent task times"`;
  `data-testid="stage-cards"`. Cards are a `role="list"`.
- **A11y / geometry:** CSS `grid` `repeat(auto-fill, minmax(var(--card-min),1fr))`
  with `gap: var(--gap-card)`. With 9 agents at desktop width the cards form a
  MULTI-ROW grid (≥ 2 rows, ≥ 2 columns) — NOT a single 9-high column and NOT a
  single 9-wide line. Assert via bounding-box: distinct top offsets > 1 AND
  distinct left offsets > 1. (This is the s002-board-as-a-line guard applied here:
  shape must be asserted, not assumed.)
- **Library:** custom.

## StageCard  (s003 / UC3)
- **Role:** one agent's task-time profile — name, n, modal / median / mean.
- **Props:** `{ agent: string; n: number; modal: string; median: string;
  mean: string; isConstraint: boolean; source: string }`.
- **States:** default · constraint (highlighted) · no-data (n=0, all `"—"` rendered
  as text "—") · focus(card is NOT interactive in s003 → not focusable; drill is CHK-4).
- **Selector:** `data-testid="stage-card-<agent>"` (agent lowercased, hyphenated);
  `data-constraint="true|false"`; each of modal/median/mean carries
  `data-agent-time` (UC5 hook) AND
  `data-source="process/dora/baseline.md#per-agent-task-completion"`.
- **Constraint highlight (REUSES s002 encoding):** the constraint agent's card
  carries `data-constraint="true"` AND a visible ConstraintBadge — `◆` glyph
  (`<span aria-hidden="true">◆</span>`) + visible text `"constraint"` +
  `--c-constraint` border. NON-COLOUR cue is the glyph + text; the accessible
  name includes "constraint" (so it reads "tester, constraint, median 1059 s").
- **A11y:** card is `role="listitem"`; agent name is the card heading; the three
  times are a definition list (modal/median/mean as `<dt>`/`<dd>`) so each number
  has a label. "—" no-data renders as literal text, not blank.
- **Library:** custom. ConstraintBadge primitive reused from s002.

## TimeThiefView  (s003 / UC4)
- **Role:** the ranked list of lead-time contributors from `flow.md`.
- **Props:** `{ thieves: TimeThief[]; sourceRef: string }`.
- **States:** default (N rows, source order = rank) · empty ("No flow data yet").
- **Selector:** `role="region"` + `aria-label="Time thieves"`;
  `data-testid="time-thief-view"`. Rows are a `role="list"`; each row
  `data-testid="thief-<index>"` carries `data-thief` (UC5 hook) AND
  `data-source="<project>/dora/flow.md#time-thieves"`.
- **A11y / geometry:** rows STACK vertically in source/rank order (a list, not a
  grid) — assert each row's top offset increases monotonically AND rows share a
  left offset. Name + value on one row, name as the label of the value.
- **Library:** custom.

## SourceLink  (s003 / UC5 — the traceability affordance)
- **Role:** the visible + machine-readable "this figure came from here" affordance
  carried by every figure (metric value, agent time, thief row). The §8
  traceability contract.
- **Props:** `{ source: string; label?: string }` where `source` = `"<file>#<anchor>"`.
- **Two layers (both required):**
  1. **Programmatic (always):** the figure element carries
     `data-source="<file>#<anchor>"` — the assertion hook UC5/T4 traverses
     (`[data-metric],[data-agent-time],[data-thief]` all have non-empty `data-source`).
  2. **Visible (per section, once):** a small `↗ source` caption per section
     header linking-conceptually to the source file (read-only; no navigation in
     s003 — it is a label, not a `<a href>` that leaves the SPA). Text "source" +
     `↗` glyph + `--c-source-link` colour — never colour-only.
- **Selector:** `data-testid="source-link"` on the visible caption; the
  programmatic layer is the `data-source` attribute on each figure.
- **A11y:** visible caption has accessible text ("source: baseline.md"); the
  `↗` is `aria-hidden`. The `data-source` attribute is the audit surface, not a
  control (so no extra tab stop in s003).
- **Library:** custom (convention, not a heavy component).

---

# CHK-2 re-scope (s004) components — value-stream map

REPLACES PipelineMap (s002) as the product's primary view. Reuses: FlowArrow,
the SourceLink `data-source` convention, the §8 redundant state-encoding rule, the
constraint `◆`/"constraint" channel, LiveStatusDot. Data shape = UC-S004-1
`StageFlow[]` (see slice ui-design.md §1). Every figure carries `data-source`.

## ValueStreamMap  (s004 / UC-S004-2 — top-level, replaces PipelineMap)
- **Role:** the whole value-stream region; owns lane layout + global flow order.
- **Props:** `{ stages: StageFlow[]; constraint?: string|null; sourceRef: string }`.
- **States:** default (10 nodes) · empty (all-zeros → full labelled skeleton of 10
  zero-nodes, not blank — AC2.6/CC1) · loading (region + lane headings immediate).
- **Selector:** `role="region"` + `aria-label="Value-stream map"`;
  `data-testid="value-stream-map"`. Three lane bands as labelled `role="group"`s,
  `data-testid="vsm-lane-<queue|build|release>"`. DOM order = canonical flow order.
- **A11y/geometry:** landmark region, visible `<h2>`; bands stack top→bottom
  (GEO-3); flow conveyed structurally, not only by arrows.
- **Library:** custom. Reuses FlowArrow.

## StageNode  (s004 / UC-S004-2/3/4/5 — one stage)
- **Props:** `{ stage; label; throughput; dwell_median_s; wip; rework; source_rows;
  wip_items?; isGate; isConstraint? }`.
- **States:** default · gate (diamond edge + GateMarker) · wip-active (InFlightBadge)
  · constraint (reuses `◆`/"constraint") · zero (fully rendered) · focus · loading.
- **Selector:** `role="group"` + accessible-summary `aria-label`;
  `data-testid="stage-<stage>"`; `data-stage-kind="gate|work"`; `data-wip="N"`;
  `data-wip-active="true|false"`; `data-constraint="true|false"`. `tabindex="0"`.
- **A11y:** name carries figures so numbers are never bare ("Build / TDD stage,
  throughput 42, dwell 12 minutes, WIP 2 in-flight, rework 3"); gate prepends
  "gate:"; constraint appends ", constraint". Focus ring (`--focus-ring`).
- **Library:** custom.

## StageMetric  (s004 / UC-S004-3 — one labelled figure)
- **Props:** `{ kind: throughput|dwell|wip|rework; label; value; raw; source }`.
- **States:** default · zero (rendered, not blank) · wip-active (the wip kind, raw>0,
  renders AS InFlightBadge).
- **Selector:** `data-testid="metric-<stage>-<kind>"`; value carries `data-metric`
  + non-empty `data-source` (the node's source_rows).
- **A11y:** `<dt>` label + `<dd>` value (labelled). Contrast ≥ 4.5:1 (AC3.6). Ints as
  ints (AC3.2); dwell humanised w/ unit s/m/h (AC3.3).
- **Library:** custom. Reuses SourceLink convention.

## InFlightBadge  (s004 / UC-S004-4 — the WIP>0 prominence component)
- **Role:** prominent non-colour-redundant in-flight indicator replacing the plain
  WIP StageMetric when wip>0. The fix for "pulled items disappear".
- **Props:** `{ count; items?; source }`.
- **States:** present (wip>0) · absent (wip=0 → plain "WIP 0" StageMetric; AC4.3).
- **Selector:** `data-testid="inflight-<stage>"`; `data-inflight="N"`. Visible
  "● N in-flight"; `●` is `aria-hidden`.
- **A11y:** literal "in-flight" + count is the authoritative cue; glyph aria-hidden;
  pill silhouette = shape cue; `--c-wip` colour redundant; contributes
  ", N in-flight" to the node name. Pulse only under reduced-motion: no-preference.
- **Library:** custom.

## GateMarker  (s004 / UC-S004-2 — gate distinction)
- **Props:** `{ gate: "intake"|"deploy" }`.
- **States:** present (gate nodes) · absent (work nodes).
- **Selector:** `data-testid="gate-<intake|deploy>"`; visible text "gate"; `◇` glyph
  aria-hidden; node carries `data-stage-kind="gate"` + diamond-edge border.
- **A11y:** "gate" text + `◇` shape + border-shape — three non-colour cues; node name
  prepends "gate:". (AC2.3.)
- **Library:** custom.

## ReworkLoopConnector  (s004 / UC-S004-2 — the rework loop, not a node)
- **Props:** `{ from: "validate"; to: "engineer"; label: "Rework" }`.
- **States:** static (always drawn — process topology; AC2.4).
- **Selector:** `data-testid="rework-loop"` + `data-from`/`data-to`; SVG path
  `aria-hidden`; visible DOM text "Rework" OUTSIDE the SVG (assertable by text).
- **A11y:** topology via the visible "Rework" label + per-stage rework figures; arrow
  decorative; right→left direction. (AC2.4/2.5.)
- **Library:** custom (inline SVG + visible label). Specialises FlowArrow.

## MetricSource  (s004 / UC-S004-5 — traceability reveal; the 1-interaction path)
- **Props:** `{ source_rows: string[]; metricLabel }`.
- **States:** value>0 (≥ 1 row ref — AC5.1/5.2) · value=0 ("no events recorded" —
  AC5.3, not blank/broken).
- **Selector:** `data-testid="metric-source-<stage>-<kind>"`; `role="tooltip"`
  referenced by the metric via `aria-describedby`.
- **A11y:** keyboard-triggerable (focus+Enter, not hover-only), dismissible (Esc);
  text row refs. Reuses SourceLink "↗ source" affordance.
- **Library:** custom. Reuses s003 SourceLink convention.

---

# CHK-4 (s005) components — work-item tree & zoom/drill

J2 (CORE). The tree opens as a left-rail landmark beside the existing `<main>`;
drilling opens a right DetailPane (non-modal) over `<main>` without covering the
rail. Reuses: the §8 redundant state-encoding rule, the `data-source`/SourceLink
convention, LiveStatusDot, the existing SSE channel, `--focus-ring`,
`--target-min`. See `slices/s005-workitem-tree/ui-design.md` for IA + GEO/A11Y.

## WorkItemTree  (s005 / UC-S005-2)
- **Role:** left-rail landmark holding the full REQ→CHK→SLC→UC hierarchy as a
  keyboard-navigable WAI-ARIA tree.
- **Props:** `{ items: ItemRecord[]; selectedId: string|null; onSelect(id);
  expanded: Set<id>; onToggle(id); sourceRef: string }`.
- **States:** default (N nodes) · empty ("No work items") · loading · live (SSE).
- **Selector:** `role="tree"` + `aria-label="Work items"`;
  `data-testid="work-item-tree"`. Tree built from `parent`/`children`; REQ at root.
- **A11y:** WAI-ARIA `tree` with roving `tabindex` (A11Y-1); ↑/↓ move focus,
  →/← expand/collapse, Enter/Space drills. Node count = items.csv rows
  (AC-S005-2-1).
- **Library:** custom.

## TreeNode  (s005 / UC-S005-2)
- **Role:** one work item — disclosure toggle, type glyph, name/job, state badge,
  value/cost badge, SpaceTagBadge.
- **Props:** `{ item: ItemRecord; depth; isExpanded; hasChildren; isSelected;
  onSelect; onToggle }`.
- **States:** default · hover · focus(roving) · selected · expanded · collapsed ·
  leaf · state-variant (`done|in-progress|backlog|blocked`) · space-variant
  (`work|process`).
- **Selector:** `role="treeitem"`; `data-testid="tree-node"` (every node);
  `data-item-id`, `data-type="REQ|CHK|SLC|UC|DEF"`, `data-state`,
  `data-space="work|process"`, `data-value`, `data-cost`, `aria-level`,
  `aria-expanded` (branches), `aria-selected`.
- **Accessible name (A11Y-2):** type + state text + value/cost (e.g. "CHK-4,
  checkpoint, state backlog, value high, cost M"). State text is a visible
  sibling (`data-state` + text — AC-S005-2-6), never colour-only.
- **State encoding (REUSES §8):** glyph (shape) + visible text (authoritative) +
  `--c-tree-state-*` band.
- **Geometry (GEO-1):** child content left offset > parent by ≥ `--tree-indent`
  across ≥ 2 levels — an indented hierarchy, NOT a flat list (the s002-line guard
  applied to the tree).
- **Library:** custom.

## SpaceTagBadge  (s005 / UC-S005-2 — /process vs /work distinction)
- **Role:** the non-colour-redundant `/work` vs `/process` space tag per node.
- **Props:** `{ space: "work"|"process" }`.
- **States:** work · process.
- **Selector:** `data-testid="space-tag"`; node carries `data-space`.
- **A11y (A11Y-6 / §6/§8/§175):** visible text "work"/"process" (authoritative) +
  icon (`▤`/`⚙`, aria-hidden) + `--c-space-work`/`--c-space-process` band. Three
  cues; distinct data-space → distinct visible text + distinct computed colour
  (AC-S005-2-4/5).
- **Library:** custom.

## DetailPane  (s005 / UC-S005-3 shell; UC-S005-4/5 compose in · DEFECT-006 re-positioned)
- **Role:** right-anchored non-modal **floating drawer** opened on drill. **DEFECT-006:
  re-positioned from an in-flow sticky column sibling of the map to a `position:fixed`
  drawer that floats OVER the map** (own stacking context, `--z-drawer`). The map's
  layout is identical whether the pane is open or closed. CONTENT is unchanged
  (breadcrumb, identity, ArtifactView, ItemHistoryPanel) — only POSITIONING/containment changed.
- **Props:** `{ item: ItemRecord|null; artifact: ArtifactPayload|null;
  history: LedgerRow[]; onClose; sourceRef }`.
- **States:** closed (absent) · open · loading · artifact-absent
  ("not yet available", no crash — AC-S005-3-4).
- **Selector:** `role="region"` + `aria-label="Item detail: <id>"`;
  `data-testid="detail-pane"`. Contains ZoomBreadcrumb, ArtifactView,
  ItemHistoryPanel.
- **Positioning (DEFECT-006):** `position: fixed`; `top/right/bottom: var(--drawer-inset)`;
  `width: var(--drawer-width)` (fixed → never reflows the map); `z-index: var(--z-drawer)`;
  `--drawer-elev` shadow. NON-MODAL, NO scrim (map stays readable beside/behind it —
  "the whole and the part"). Slide-in `--dur-drawer`, `0ms` under reduced-motion.
- **A11y (A11Y-3):** labelled region (NOT modal — `aria-modal` absent, no focus trap;
  tree + map stay operable). On open, focus MOVES into the pane heading; on close
  (Esc / × / "Back to map") focus RETURNS to the originating tree node (regression-safe
  upgrade on "return to map"; "Back to map" additionally surfaces `value-stream-map` as
  the primary visible region — AC-S005-3-6). Esc closes.
- **GEO (DEFECT-006):** **GEO-S005-3b** — the value-stream map's bounding box is
  IDENTICAL with the pane open vs closed (the key regression guard); the
  `.observatory-main-col` height does NOT grow when the pane opens. The drawer floats
  above the map (intentional overlap by z-index), is anchored within the viewport (no
  horizontal scroll), and its left edge sits well right of the tree-rail right edge
  (GEO-S005-3 — no illegible rail overlap).
- **Library:** custom.

## ArtifactView  (s005 / UC-S005-3/4)
- **Role:** renders the item's slice artifact — markdown→HTML, `.mmd`→Mermaid SVG.
- **Props:** `{ kind: "md"|"mmd"|null; text: string|null; source: string }`.
- **Composes:** MarkdownRenderer (tables `<table>`, code `<pre><code>`,
  headings/lists — AC-S005-4-1/2) + MmdRenderer (`<svg>` in
  `data-testid="mmd-render"` — AC-S005-3-3).
- **States:** md · mmd · empty/null ("not yet available", no throw — AC-S005-4-3/4).
- **Selector:** `data-testid="artifact-view"` + non-empty `data-source`; markdown
  output has NO top-level `<pre>` of raw source (AC-S005-3-2).
- **A11y (A11Y-10):** real semantic HTML (headings reachable); Mermaid `<svg>` gets
  `role="img"` + `aria-label`; decorative internals `aria-hidden`. Both fail soft.
- **Library:** custom wrapper; markdown + mermaid are client-side deps (version +
  bundle size confirmed at architect gate).

## ItemHistoryPanel  (s005 / UC-S005-5)
- **Role:** the item's ledger event history — primary interrogation affordance (SM1).
- **Props:** `{ rows: LedgerRow[]; itemId; source }`.
- **States:** default (N rows newest-first) · empty ("no history yet" —
  AC-S005-5-4) · loading · live (SSE — AC-S005-6-3).
- **Selector:** `role="region"` + `aria-label="Item history: <id>"`;
  `data-testid="item-history"`. Rows `role="list"`; each `data-testid="history-row"`
  + `data-timestamp`. `data-source="process/dora/ledger.csv#item_id=<id>"`.
- **Each row (AC-S005-5-3):** timestamp · event · agent · duration_s (when present)
  · outcome · note. Newest-first (AC-S005-5-2).
- **A11y/geometry (GEO-2):** rows STACK vertically by timestamp — top offsets
  strictly increase, shared left offset (s003 TimeThiefView guard reused). Labelled
  rows. REAL-DATA default view (EXP-033 — AC-S005-5-1).
- **Library:** custom.

## SteerMenu  (s014 / UC-S014-1 — per-item steer affordance)
- **Role:** the item-scoped steer affordance — an explicit trailing trigger
  button (`⋯`) + a body-portalled `role="menu"` popover listing the FOUR steer
  action types ("Raise defect" / "Re-prioritise" / "Request re-slice / split" /
  "Custom steer"). Composed read-only into the VSM queue chips (StageNode) and
  every work-item tree row (TreeNode); fires `onSteer(itemId, actionType)`
  (UC-S014-2's panel-open seam).
- **Props:** `{ itemId: string; itemLabel?: string; onSteer?(itemId, actionType) }`.
- **States:** trigger default · hover · focus-visible · expanded(aria-expanded) ×
  popover closed(absent) · open; menuitem default · hover · focus-visible.
- **Selector:** trigger `getByRole('button', { name: /steer <itemId>/i })`,
  `data-testid="steer-btn"`, **`data-steer-item-id`** (NOT `data-item-id` — that
  attribute remains the treeitem `<li>`'s UNIQUE selector contract; duplicating
  it on the trigger broke `[data-item-id="X"]` strict-mode selection — selector
  contract amended from the s014 ui-design table). Popover
  `getByRole('menu', { name: 'Steer actions' })`, `data-testid="steer-menu"`,
  linked via the trigger's `aria-controls`. Items
  `getByRole('menuitem', { name: '<exact label>' })`,
  `data-testid="steer-action-<actionType>"` + `data-action`.
- **A11y:** Tab-reachable trigger; opens on Enter/Space/ArrowDown; focus → first
  menuitem; arrows cycle (wrap); Esc closes + returns focus to trigger; Tab
  escapes (no trap); click-outside closes. Hit boxes ≥ `--target-min`.
  `--focus-ring` on trigger + items. Accessible name carries the HUMAN item
  reference ("Steer CHK-5[ — job sentence]"), never a positional token.
- **Geometry (GEO-S014-1..4):** popover is `position:fixed` AND portalled to
  `document.body` (own stacking context above both surfaces) — zero flow
  height; underlying bboxes + scrollHeights byte-identical open vs closed;
  clamped inside the viewport. Stops propagation of its own click/keydown so
  the row drill (UC-S005-3) and StageNode reveal are untouched. Companion
  change: `.metric-source` reveals are `pointer-events:none` (passive tooltips
  must not intercept the chip triggers under node-hover).
- **Library:** custom (token-based; `--c-surface-raised`/`--c-border`/
  `--elev-box`+`--drawer-elev`/`--radius-badge`/`--dur-fast`, 0ms animation
  under reduced motion).

## SteerPanel  (s014 / UC-S014-2 — steer drawer: context + intent + guarded Generate)
- **Role:** the right-anchored NON-MODAL floating drawer a SteerMenu action
  opens — item context block + intent-note textarea + guarded "Generate
  prompt" + Cancel/×. Reuses the DEFECT-006 drawer IDIOM (not the DetailPane
  component): `position:fixed`, portalled to `document.body`, drawer tokens,
  `z-index: calc(--z-drawer + 1)` (topmost over a co-open DetailPane). The
  UC-S014-3 prompt output renders into the marked
  `data-testid="prompt-output-slot"` below the action row.
- **Props (pure render):** `{ itemId; actionType; status:
  "loading"|"ready"|"not-found"|"error"; context: SteerContext|null;
  onCancel(); onGenerate(intentNote, {itemId, actionType, context}) }`.
  `SteerPanelContainer` (same file) wires `useSteerContext` → panel.
- **States:** loading (labelled "Loading item context…" skeleton, textarea
  disabled) · ready · not-found ("Item <id> not found" — stale/queue-only id,
  fail-soft; form hidden, Cancel/× stay) · error ("Could not load item context
  — try again").
- **Selector:** `getByRole('dialog', { name: /steer: <itemId>/i })` — NON-modal
  (no `aria-modal`), `aria-labelledby` → heading; `data-testid="steer-panel"` +
  `data-item-id` + `data-action`. Close ×
  `getByRole('button', { name: /close steer panel/i })` /
  `steer-panel-close`; Cancel `steer-cancel`; Generate `steer-generate`
  (`aria-disabled` reflects the empty-intent guard).
- **A11y:** focus → heading on open; keyboard order heading → textarea →
  Generate → Cancel → × (× is LAST in DOM, CSS-positioned top-right); Esc/×/
  Cancel close and focus RETURNS to the opening steer trigger; no trap
  (non-modal). Hit boxes ≥ `--target-min`; `--focus-ring`; the Generate guard
  is `aria-disabled` + non-colour inset cue. NOTE: the panel header is a
  `<div>`, not `<header>` — a `<header>` inside `role=dialog` still maps to a
  page banner landmark (axe `landmark-no-duplicate-banner`).
- **Geometry (GEO-S014-2-1..4):** pure overlay — underlying VSM/tree bboxes +
  scrollHeights byte-identical open vs closed; on-screen within the viewport;
  slide-in `--dur-drawer`, instant under reduced motion.
- **Library:** custom (drawer + surface + focus tokens; no off-token values).

## SteerContextBlock  (s014 / UC-S014-2 — labelled item context, inside SteerPanel)
- **Role:** the figure surface of the steer flow: six `<dt>`/`<dd>` pairs —
  Item ("<id> — <job sentence>", never the id alone), Job, State, Value, Cost,
  Steering action (the HUMAN label, never the `data-action` enum).
- **Selector:** `data-testid="steer-context"` (carries
  `data-source="work/<project>/items/items.csv#id=<id>"` — SourceLink
  convention); each field `data-testid="steer-ctx-<id|job|state|value|cost|action>"`.
- **Legibility:** human labels/values only — no raw CSV keys (`vc_ratio`,
  `done_ts`, …); absent values render "—" (unknown ≠ blank/zero); fields STACK
  (single-column grid: shared dd left edge, monotonic tops).
- **Library:** custom (reuses the s003/s004 labelled dt/dd pattern).

## IntentNote  (s014 / UC-S014-2 — free-text intent textarea, inside SteerPanel)
- **Role:** the operator's natural-language intent; gates Generate (≥1 char).
- **Selector:** `getByRole('textbox', { name: /intent/i })`;
  `data-testid="intent-note"`; associated `<label for>`; placeholder
  "Describe what you want to happen (e.g. split this UC into two…)".
- **States:** empty (Generate guarded) · non-empty (Generate live) · disabled
  (loading; hidden in not-found/error).
- **Library:** custom.

## PromptOutput  (s014 / UC-S014-3, RATIFIED at UC-S014-4 — read-only prompt surface)
- **Role:** the generated, copy-ready prompt: a read-only, SELECTABLE `<pre>`
  in SteerPanel's `prompt-output-slot`. Promoted from a UC-S014-3 build detail
  to a design-system component so future prompt surfaces (UC-S015-4's enriched
  re-slice preview) inherit it rather than re-derive.
- **Presentation (pinned in steer-panel.css):** mono font (`--font-mono`) —
  "code/command, copy exactly"; `white-space: pre-wrap` + `overflow-wrap:
  anywhere` (line structure kept, no horizontal scroll); `max-height: 40vh` +
  `overflow-y: auto` (long prompts scroll INSIDE the drawer); `user-select:
  text` + `cursor: text` explicit (manual select+copy always possible);
  `tabindex="0"` + `aria-label="Generated prompt"` + `--focus-ring`.
- **Selector:** `data-testid="prompt-output"` inside
  `data-testid="prompt-output-slot"`.
- **Library:** custom (existing tokens only — a ratification, not a redesign).

## CopyPromptButton  (s014 / UC-S014-4 — one-click clipboard handoff)
- **Role:** copies the displayed prompt to the clipboard — the terminal step of
  the steer handoff. Present ONLY when a prompt is displayed (absent, never
  disabled, otherwise); rendered INSIDE `prompt-output-slot` AFTER the `<pre>`
  (tab order: prompt → copy).
- **Copy contract (PROMPT-COPY-1):** payload byte-equal to the `prompt` prop ==
  the `<pre>` textContent — no re-serialisation/trimming. A FAILED write shows
  NO success cue (the UI never lies); a second click re-copies + re-toasts.
- **States:** idle ("Copy prompt") · copied ("Copied ✓", the ✓ aria-hidden;
  reverts after `--dur-toast`) · focus-visible (`--focus-ring`) · active.
- **Selector:** `getByRole('button', { name: /copy/i })` — stable across BOTH
  label states; `data-testid="copy-prompt-btn"`; `data-copied`.
- **A11y:** native `<button>` (Enter+Space); hit box ≥ `--target-min`; success
  is label TEXT + toast, never colour alone.
- **Library:** custom (token-based).

## CopyToast  (s014 / UC-S014-4 — polite copy confirmation)
- **Role:** transient "Copied to clipboard" confirmation. A status region, not
  a dialog: it NEVER takes focus and has no dismiss control.
- **Props:** `{ visible; message }` — visibility + the auto-dismiss timer are
  the caller's (SteerPanel's); hidden renders NOTHING (absent, not invisible).
- **Geometry:** portalled to `document.body` + `position:fixed` bottom-right —
  own stacking context, ZERO flow height (showing it reflows nothing,
  GEO-S014-4-1); always inside the viewport.
- **Selector:** `data-testid="copy-toast"`; `role="status"`
  `aria-live="polite"` (never `alert`/`assertive` — a confirmation, not an
  interruption).
- **Motion:** fade `--dur-fast` under no-preference; INSTANT under
  `prefers-reduced-motion: reduce`. Visible duration = `--dur-toast` (the
  UC's ONE new token; read by `toastDurationMs()` so JS+CSS share a source).
- **Library:** custom (token-based; `--c-state-ok` accent is redundant only).

## ContextRefreshCue  (s014 / UC-S014-4 — EXP-036 stale/live cue on the steer context)
- **Role:** tells the operator whether the displayed item context is live,
  refreshing, or has DIVERGED from the prompt they already generated — the
  PROMPT-FREEZE-1 companion: context refreshes live, the prompt stays frozen,
  and this cue is how the operator KNOWS to regenerate.
- **States:** `live` ("Live", ● glyph) · `refreshing` ("Refreshing…") ·
  `updated` ("Context updated — regenerate to refresh the prompt", ⟳ glyph +
  `--c-state-over` band — text authoritative, never colour alone). Unknown
  state falls back to `live` (never blank).
- **Derivation:** SteerPanelContainer — `refreshing` from useSteerContext's
  additive flag; `updated` = a prompt exists AND the context JSON diverged
  from the snapshot taken at the last Generate.
- **Selector:** `data-testid="steer-context-live"`; `data-state`;
  `role="status"` `aria-live="polite"` (announce-once — the SSE debounce
  collapses a frame burst, S14-4-A11Y-8); accessible name carries the full
  state ("Item context: …").
- **Library:** custom (the LiveStatusDot idiom — text + aria-hidden glyph +
  polite status; reuses the `--c-state-over` attention channel).

## ViewSwitch  (s015 / UC-S015-1 — main-column two-view tablist)
- **Role:** the explicit two-view navigation ("Pipeline" | "In-flight WIP") at the
  top of the main column. ROUTED VIEW (EXP-016): activating a tab swaps the
  main-column content — the two surfaces never co-exist (no overlay reflow by
  construction). Default view = Pipeline (J1 stays 0-click).
- **Props:** `{ active: "pipeline"|"wip"; onSelect(view) }` (pure fn of props).
- **States:** per tab — default · hover · focus-visible · selected (`aria-selected`).
- **Selector:** `getByRole('tablist', { name: 'Dashboard view' })`,
  `data-testid="view-switch"`; tabs `getByRole('tab', { name: 'Pipeline' | 'In-flight WIP' })`,
  `data-testid="view-tab-pipeline|view-tab-wip"`, `data-view`, `aria-selected`,
  `aria-controls="view-panel-<view>"`.
- **A11y (S15-1-A11Y-1/4):** roving tabindex (active tab = single tab stop);
  Arrow/Home/End move focus; Enter/Space activate (manual activation); hit boxes
  ≥ `--target-min`; `--focus-ring`. Selected state = aria + underline band + colour
  (never colour alone).
- **Library:** custom (token-based).

## WipPanel  (s015 / UC-S015-1 — the in-flight WIP view region)
- **Role:** lists every item with an open in-event (ANY age — stale-open items are
  flagged, never dropped: S15-1-WIP-2/DEFECT-011), pre-sorted longest-in-stage
  first (sort is upstream in `useWipItems`; the panel is presentational).
- **Props:** `{ items: WipItem[]; status: "loading"|"ready"|"empty"; horizonMs;
  sourceRef }` — `horizonMs` is the LIVE recency horizon from `/stage-flow`
  `wip_horizon_ms` (never a client literal — S15-1-WIP-1).
- **States:** default (N rows) · empty ("No items currently in flight") · loading
  (region + heading immediate) · live (SSE re-fetch via the hook).
- **Selector:** `getByRole('region', { name: 'In-flight WIP' })`,
  `data-testid="wip-panel"` (+ `data-source`); visible `<h2>` "In-flight WIP"
  (takes focus on mount — S15-1-A11Y-2); row list `role="list"`; count line
  `data-testid="wip-count"` `role="status"` `aria-live="polite"` (S15-1-A11Y-7).
- **Library:** custom (token-based; reuses `--c-text-dim`, `--fs-tree*`, `--sp-*`,
  `--radius-*`, `--focus-ring`, `--target-min`).

## WipRow  (s015 / UC-S015-1 — one in-flight item; child of WipPanel)
- **Role:** one scannable line of labelled figures: id · job sentence · human
  stage label · value · cost · time-in-stage (unit-bearing — S15-1-FIG-1/2;
  unknown dwell renders "—", never "0 s" — S15-1-FIG-3).
- **Props:** `{ item: WipItem; horizonMs }`.
- **States:** default · stale-open (dwell > horizon) · (steer-affordance slot —
  populated by UC-S015-2, not here).
- **Selector:** `role="listitem"`, `data-testid="wip-row"`,
  **`data-item-id="<id>"`** (the UC-S015-2 SteerMenu composition contract),
  `data-stale="true|false"`, `data-stage`; figures are `<dt>`/`<dd>` pairs
  (`wip-id|wip-job|wip-stage|wip-value|wip-cost|wip-dwell`); stale badge
  `data-testid="stale-badge"`.
- **Stale cue (REUSES §8, never colour-only):** visible text "stale — over Nh"
  (authoritative) + `⏳` glyph (`aria-hidden`) + `--c-state-over` left band;
  accessible name appends ", stale, over Nh".
- **A11y (S15-1-A11Y-5):** row `aria-label` carries id + job + stage + dwell
  (+ stale) so no figure is announced bare.
- **Library:** custom (token-based).

## ZoomBreadcrumb  (s005 / UC-S005-3/6)
- **Role:** zoom-path trail + the explicit zoom-OUT controls.
- **Props:** `{ path: BreadcrumbStep[]; onZoomTo(step); onBackToMap }`.
- **States:** pipeline-level · item-level ("Pipeline ▸ CHK-4 ▸ s005 ▸ UC-…" —
  AC-S005-6-1).
- **Selector:** `data-testid="breadcrumb"`; root `data-testid="breadcrumb-root"`;
  "Back to map" `data-testid="back-to-map"`. Text includes selected item id
  (AC-S005-3-5).
- **A11y (A11Y-4/5):** `<nav aria-label="Zoom path">`; `aria-current` on current
  crumb; each crumb keyboard-operable (Tab+Enter — AC-S005-6-4); `▸` aria-hidden.
  Back-to-map returns focus to the map.
- **Library:** custom. Specialises the SourceLink text+glyph affordance style.

---

# CHK-8 (s013) components — defects view

UC-S013-2. Reuses: the `ViewSwitch` tablist (s015, EXTENDED to a third "Defects"
tab — routed view, no overlay/reflow), the WipPanel/WipRow `<dl>` figure layout +
heading-focus + count-live-region idiom, the WipRow stale-badge idiom (re-skinned
as the open badge), the §8 redundant state-encoding rule, the `data-source`
SourceLink convention, the tree DEF glyph "⚠", and tree-state/space/spacing tokens.
**No new design tokens.** See `slices/s013-defects-view/ui-design.md`.

## ViewSwitch  (EXTENDED s013 / UC-S013-2 — third tab)
- **Change:** the s015 two-tab tablist gains a third tab "Defects"
  (`data-view="defects"`, `data-testid="view-tab-defects"`, `aria-controls=
  "view-panel-defects"`). `active`/`onSelect` contract unchanged; `active` now
  ranges `pipeline|wip|defects`. Roving tabindex cycles THREE tabs.
- **A11y (S13-2-A11Y-1):** Arrow/Home/End cycle all three; `aria-selected` reflects
  the active view; tab name "Defects". Selected = aria + underline band + colour
  (never colour alone). Hit box ≥ `--target-min`.
- **Library:** custom (no fork — extend the existing component).

## DefectsPanel  (s013 / UC-S013-2)
- **Role:** the Defects view-region; lists every defect GROUPED open-first
  (CONFIRMED) then CLOSED, each group id-ascending.
- **Props:** `{ defects: DefectRow[]; status: "loading"|"ready"|"empty"; openCount;
  sourceRef }` (grouping/sort/MTTR-humanisation in `useDefects.js`; panel is pure
  render; `DefectsPanelContainer` is the hook→panel wiring).
- **States:** default (two groups) · empty ("No defects recorded") · loading
  (region + heading immediate) · live (SSE — UC-S013-4 slot).
- **Selector:** `getByRole('region', { name: 'Defects' })`, `data-testid=
  "defects-panel"` (+ `data-source`); visible `<h2>` "Defects" (takes focus on
  mount — reuses WipPanel heading-focus); count line `data-testid="defects-count"`
  `role="status"` `aria-live="polite"` ("N defects, M open"); group headings `<h3>`
  `data-testid="defects-group-open"` ("Open — needs attention", present iff ≥1
  CONFIRMED) / `defects-group-closed` ("Closed"); per-group row list `role="list"`.
- **A11y/geometry (S13-2-A11Y-2/6, GEO-S013-2-1/4):** one `<h2>` under page `<h1>`,
  `<h3>` group headings (no skipped levels); lossless view-switch (VSM unmounted,
  bbox identical before→Defects→back); open group leads geometrically.
- **Library:** custom (reuses WipPanel idiom).

## DefectRow  (s013 / UC-S013-2 — one defect; child of DefectsPanel)
- **Role:** one scannable line of labelled figures: id · title (sentence) · status
  badge · severity badge · MTTR (unit-bearing or "open"). Mirrors WipRow `<dl>`.
- **Props:** `{ defect: DefectRow }`.
- **States:** default (CLOSED) · open (CONFIRMED — leads, distinct cue) · hover ·
  focus-visible (clickable in UC-S013-3) · severity-unknown (null → "—").
- **Selector:** `role="listitem"`, `data-testid="defect-row"`, **`data-defect-id`**
  (the UC-S013-3 drill hook — DEDICATED attr, NOT `data-item-id`, which is the
  tree/WIP unique contract — same lesson as s014's `data-steer-item-id`);
  `data-status="CONFIRMED|CLOSED"`, `data-open`, `data-severity`. Figures are
  `<dt>`/`<dd>` pairs (`defect-id|defect-title|defect-status|defect-severity|
  defect-mttr`); status badge `defect-status-badge`, severity badge
  `defect-severity-badge`. Accessible name carries id+title+status+severity+MTTR.
- **Open cue (REUSES §8 + WipRow stale idiom, never colour-only):** visible text
  "OPEN" (CONFIRMED→operator's word; authoritative) + `⚠` glyph (`aria-hidden`,
  the tree DEF glyph) + `--c-state-over` left band; CLOSED = "CLOSED" text +
  done channel + ✓-style glyph. `data-open="true|false"`.
- **Severity badge (REUSES §8):** text "HIGH/MED-HIGH/MED/LOW" authoritative; null
  (ledger-only DEFECT-011) renders "—" (unknown ≠ blank ≠ defaulted LOW).
- **Figure legibility (S13-2-FIG-1..5):** MTTR unit-bearing ("13 min") or "open"
  (`mttr_s=null`, never "0"); title is a sentence shown WITH the id (never a
  `row:N` ref); status in the operator's word.
- **Library:** custom (reuses WipRow figure layout + badge idiom).

## ReslicePreviewPanel  (s015 / UC-S015-3 — two-column before/after re-slice preview drawer)
- **Role:** the destination of the `re-slice` steer action (RESLICE-DISPATCH-1
  re-point): a NON-MODAL right-anchored drawer previewing a proposed 2-way split
  beside the live item context. PREVIEW-ONLY — writes nothing; Generate's only
  output is the `onGenerate({itemId, context, partAJob, partBJob, intentNote})`
  seam (UC-S015-4's verbatim input contract). Output slot pinned EMPTY until -4.
- **Family:** SIBLING of SteerPanel in the SAME drawer family — reuses the
  `steer-panel.css` idiom (fixed + body-portalled + `--z-drawer`+1, focus
  move/return, Esc/×/Cancel, aria-disabled Generate guard styling); style reuse,
  NOT component composition. `reslice-preview-panel.css` adds ONLY the
  two-column geometry (width `min(720px, 100vw − 2·inset)`, 2-col grid,
  gap `--sp-4` — no new token).
- **Props:** pure render — `{ itemId; status; context (useSteerContext six-field
  contract); partAJob; partBJob; intentNote; canGenerate; costNote; onPartAChange;
  onPartBChange; onIntentChange; onCancel; onGenerate }`. Container wires
  `useSteerContext(itemId)` + `useReslicePreview()` (pure local After state).
- **States:** loading (Before placeholder, fields disabled) · ready · not-found
  ("Item <id> not found", After + Generate hidden, fail-soft) · error.
- **Selector:** `getByRole('dialog', { name: /re-slice.*: <id>/i })` (non-modal,
  no `aria-modal`); `data-testid="reslice-preview-panel"` + `data-item-id`;
  Generate `reslice-generate` ("Looks right — generate prompt", `aria-disabled`
  until Part A + Part B + intent ALL non-empty); `reslice-cancel`; `reslice-close`
  (× last in DOM, CSS top-right); slot `prompt-output-slot` (EMPTY).
- **A11y/geometry:** h2 panel title → two h3 column headings; keyboard path
  heading → Part A → Part B → intent → Generate → Cancel → ×; focus returns to
  the opening SteerMenu trigger; reduced-motion → instant; pure overlay (zero
  reflow, GEO-S015-3-1); columns side-by-side at desktop (GEO-S015-3-2).
- **Library:** custom (drawer-family reuse; no new tokens).

## BeforeColumn  (s015 / UC-S015-3 — "Current item", read-only; child of ReslicePreviewPanel)
- **Role:** PURE render of the `useSteerContext` six-field contract VERBATIM —
  the same labelled `<dt>`/`<dd>` figure surface as SteerContextBlock, so the
  operator sees identical context whether steering or re-slicing. Plus the fixed
  expectation note "After split, this item will be replaced by Part A and Part B".
- **Fields:** Item ("<id> — <job>"), Job, Value, Cost, Current stage — human
  labels/values only, `—` for unknowns; never a raw CSV key.
- **Selector:** `data-testid="reslice-before"` + `data-source={sourceRef}`;
  fields `reslice-before-<id|job|value|cost|stage>`; note `reslice-before-note`.
- **Library:** custom (reuses `.steer-context` dt/dd grid).

## AfterColumn  (s015 / UC-S015-3 — "Proposed split", operator input; child of ReslicePreviewPanel)
- **Role:** collects the proposed 2-way split: Part A / Part B job-sentence
  textareas (labelled "Part A job sentence" / "Part B job sentence", human
  placeholders) + the computed directional cost note "Each part will be smaller
  than the original — favours flow" shown ONLY when BOTH parts are non-empty
  (S15-3-FIG-3: an unfilled split is NOT a staged proposal — absent, not "—").
- **State source:** `useReslicePreview()` — pure local `{partAJob, partBJob,
  intentNote, canGenerate, costNote}`; no server calls.
- **Selector:** `data-testid="reslice-after"`; fields `part-a-job` / `part-b-job`
  (`getByRole('textbox', { name: /part [ab] job/i })`); note `reslice-cost-note`
  (absent when either part is empty).
- **Library:** custom (reuses `.intent-note` field styling; fields stack —
  GEO-S015-3-3).
