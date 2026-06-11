# Observatory — User Guide

## What does this do?

Observatory is a local Vite dashboard that observes and steers a multi-project delivery pipeline. It shows the full delivery value-stream in real time — every stage (Intake → Decompose → Ready → Capabilities → Build-TDD → UI-Validate → Deploy → Validate → Done) with throughput, dwell time, in-flight WIP, and rework. Navigate the work-item tree to drill into any requirement, chunk, slice, or use case; see its ledger history and dependencies in context. Steer the pipeline from the dashboard (re-prioritise, request re-slice, raise defect, custom prompts) without hand-editing files — all writes go through Claude's preview-accept gate. Observe defect records with status, severity, and MTTR (time-to-repair) to assess quality. All data is read-only in the browser; live-refresh on file change via SSE.

**Not yet in scope:** guided cost-of-delay intake (CHK-7, later), detailed WIP navigation panel for split/merge analysis (CHK-6, in progress), inline artifact editing.

---

## How do I run it?

### Prerequisites

- Node.js 18+
- The Claufe Code agent design repo cloned locally
- Repo initialised: `npm --prefix work/observatory/src/app install` (usually done once)

### Start the dev server

```bash
npm --prefix work/observatory/src/app run dev
```

The dashboard opens at **http://localhost:5173**.

- **SPA (React/Preact)** served with hot-module reloading (HMR) — edits to `.jsx` files auto-refresh
- **API** (`/api/*` routes) served from the same origin via a Vite plugin — no separate server process, no CORS
- **SSE stream** (`/api/events`) pushes file-change events from the working tree; all views auto-refresh when source files change (ledger, items CSV, defects, slices)

The server runs until you stop it (Ctrl+C).

---

## How do I use it?

### Main view: Value-Stream Map

On app load, you see the **full delivery pipeline map** with every stage labelled in sequence. Each stage shows four numbers:

- **Throughput** (items/day) — delivery rate through the stage
- **Dwell** (hours) — average time spent in the stage
- **In-flight WIP** (count) — open tasks right now (items in the stage within the last 2 hours)
- **Rework** (count) — items that cycled back to this stage

Click any row to drill into the work-item tree; click the stage card to see all items in that stage.

### Work-Item Tree

Click **"Work Items"** to see the full tree: every requirement, chunk, slice, and use case anchored at `REQ-OBSERVATORY` with its tree path, status, and current flow stage. Every node is clickable to drill into its artifact detail (metadata, description, design, test plan, result, dependencies, ledger history). The tree auto-filters: items not yet in your active project do not appear.

### Defects

Click **"Defects"** to see all known defect records. Every row shows:

- **ID** — DEFECT-001 etc.
- **Status** — CONFIRMED (open) or CLOSED (resolved)
- **Severity** — HIGH, MED-HIGH, MED, or LOW
- **MTTR** — time from when the defect was first reported to when it was fixed (e.g. "13 min", "1 h 21 min"), or "open" if still unresolved

CONFIRMED defects are grouped first (these are the ones that need attention). Click any defect row to open the full record in the detail panel: the four problem-statement fields (Expected, Actual, Intent, Importance), root cause, resolution (including the fix commit SHA), and a timeline showing when it was reported, when it was fixed, and how long it took.

### Steer actions

On every WIP chip in the value-stream map and every node in the work-item tree, a **⋯ "Steer" button** opens a menu of four actions:

1. **Raise defect** — compose a prompt to report a new defect
2. **Re-prioritise** — request that this item move up or down the queue
3. **Request re-slice / split** — request that this item be broken into smaller pieces or merged
4. **Custom steer** — write a free-text intent (use this for any other instruction)

Select an action, type your intent note, and the steer panel shows a copy-ready prompt. Review it, click "Copy prompt", and paste it into your Claude session. The UI never writes to the repo — all writes happen through Claude's accept gate.

**Note:** The steer panel is under active development; the four action types are routed correctly, but the prompt generation and context enrichment are still building. Use `/defect`, `/slice-next`, and slash commands in Claude for now if you need full detail.

### Live refresh

Any change to the working tree — a new defect file, a ledger entry, items.csv edit, slice artifact update — automatically refreshes the relevant dashboard section within ~2 seconds. No manual reload needed.

### Reading the numbers

All figures in the map are traceable to source:

- **Throughput, dwell, WIP, rework** — sourced from `process/dora/ledger.csv` (the same source of truth the orchestrator commits to on every loop)
- **Items and queues** — read from `work/<project>/items/items.csv` and `work/<project>/queues/*.csv`
- **Slice artifacts** — read from `work/<project>/slices/*/`
- **Defects** — read from `work/<project>/defects/DEFECT-*.md` and matched to ledger rows for MTTR

Hover over or click any metric to see the source row (coming in a follow-on pass).

### Known limitations

- **WIP staleness horizon:** WIP counts include only tasks with events in the last 2 hours. Very old orphan items (no recent progress) self-clear from the count after 2 hours of silence.
- **Steer actions:** The four menu options are present and route correctly; full prompt context enrichment (e.g. auto-fill the four DEFECT fields for "Raise defect") is under development.
- **Single project only:** The dashboard observes the active project (set via `work/ACTIVE` file). Switching projects requires editing the file and reloading the dashboard.

---

## Error messages and what they mean

- **"Item <id> not found"** — You clicked steer on an item that is no longer in items.csv. This can happen if the item was deleted or the CSV was edited between page load and click. Refresh the page to reload the tree.
- **"No data loaded"** — The API is running but one of the required source files (items.csv, ledger.csv) is missing or invalid. Check that the active project is set correctly in `work/ACTIVE`.
- **502 Bad Gateway** — The Vite dev server crashed or did not start. Restart it with `npm --prefix work/observatory/src/app run dev`.

---

## Troubleshooting

| Problem | Check |
|---------|-------|
| Dashboard shows 0 WIP / all stages empty | Verify `work/ACTIVE` contains your project name (e.g. `observatory`). Refresh the page. |
| Steer button doesn't appear on a WIP chip or tree node | Ensure you're using a recent build (Ctrl+Shift+R to force-refresh the browser). If a node is a "+N more" collapsed chip, expand it first. |
| Defects list shows fewer than 10 records | Check `work/observatory/defects/` for all `DEFECT-*.md` files. Verify `process/dora/ledger.csv` has matching `failure` and `recovery` rows. |
| Live refresh is slow (>5 seconds) | The file-watch system is catching up. Check system disk I/O. If the issue persists, restart the dev server. |
| Copy prompt to clipboard didn't work | Ensure your browser allows clipboard access (check security settings). If denied, you can still manually copy the prompt from the panel. |

---

## Next steps

- **Report a bug:** create a new file `work/observatory/defects/DEFECT-NNN.md` following the template in an existing defect, or use the "Raise defect" steer action.
- **Request a feature:** use the "Custom steer" action to compose a prompt and paste it into Claude, or edit `work/observatory/open-items.md`.
- **Dive deeper:** read `work/observatory/project.md` (product vision), `work/observatory/slices/*/slice.md` (what shipped each iteration), and `process/dora/baseline.md` (current delivery health metrics).
