# Observatory — User Guide

## What does this do?

Observatory is a local Vite dashboard that observes and steers a multi-project delivery pipeline. It shows the full delivery value-stream in real time — every stage (Intake → Decompose → Ready → Capabilities → Build-TDD → UI-Validate → Deploy → Validate → Done) with throughput, dwell time, in-flight WIP, and rework. Navigate the work-item tree to drill into any requirement, chunk, slice, or use case; see its ledger history and dependencies in context. Steer the pipeline from the dashboard (re-prioritise, request re-slice, raise defect, custom prompts) without hand-editing files — all writes go through Claude's preview-accept gate. Browse in-flight WIP in a dedicated panel sorted by longest-waiting-first; preview before/after split proposals before handing them to Claude. Observe defect records with status, severity, and MTTR (time-to-repair) to assess quality. All data is read-only in the browser; live-refresh on file change via SSE.

**Not yet in scope:** inline artifact editing.

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

CONFIRMED defects are grouped first (these are the ones that need attention). Click any defect row or press Enter to open a drawer with the full record: the four problem-statement fields (rendered as formatted text, not raw markdown), classification, root cause, resolution, all fix commit SHAs as code references, and an MTTR card showing the reported time, resolved time, and total duration. For open defects, the card shows "Not yet resolved" instead of a duration. The list updates live when defect files change; an open drawer never silently updates — a cue message says "Record updated — re-open to refresh" to signal a change and prompt you to close and re-open if you want the latest data.

### Steer actions

On every WIP chip in the value-stream map and every node in the work-item tree, a **⋯ "Steer" button** opens a menu of four actions:

1. **Raise defect** — compose a prompt to report a new defect
2. **Re-prioritise** — request that this item move up or down the queue
3. **Request re-slice / split** — request that this item be broken into smaller pieces
4. **Custom steer** — write a free-text intent (use this for any other instruction)

Select an action, type your intent note, and the steer panel shows a copy-ready prompt containing your item id, its current job sentence, the action, and your intent verbatim. Review it, click "Copy prompt", and paste it into your Claude session. The UI never writes to the repo — all writes happen through Claude's accept gate.

**For "Request re-slice / split":** The panel opens a before/after preview showing the current item alongside two free-text fields for proposing Part A and Part B job sentences. When you've filled both parts, click "Looks right — generate prompt" to see a preview of the split proposal, then copy and paste to Claude.

### New Work — Guided intake wizard (full end-to-end)

Click **"+ New Work"** (a button beside the view tabs) to open the guided intake wizard. This is a four-step form to capture, cost, rank, and hand off a new work item to Claude — the entire intake flow without opening a text editor.

**Step 1 — JTBD capture:** Three fields ("Situation (when…)", "Motivation (I want to…)", "Outcome (so I can…)") build a complete job-to-be-done sentence as you type: "When [situation], I want to [motivation], so I can [outcome]." The live preview updates in real time. Click "Next" to proceed to cost-of-delay signals.

**Step 2 — Cost-of-delay signals:** Three inputs shape the work's priority:
- **Value** — choose HIGH (directly impacts delivery ability), MED (improves experience but not blocking), or LOW (nice-to-have). Plain-language labels visible for each.
- **Urgency** — is this time-critical? Yes / No.
- **Risk of delay** — what worsens if deferred? (optional free text).

As you select, a live "value band" readout shows the computed priority tier (HIGH, MED, or LOW). The rule is deterministic: HIGH + time-critical → HIGH; LOW + no urgency → LOW; all other combinations → MED. If you haven't chosen both Value and Urgency, the readout prompts you to complete the signals.

**Step 3 — Queue-rank preview:** The dashboard reads the live backlog and shows exactly where your item would rank: "Your item (HIGH value) would rank ahead of N items and behind M items." This is a directional preview only — you see tiers, not absolute insertion order. No writes are made; the rank refreshes if you go back and change the value signal.

**Step 4 — Generate intake prompt:** Click "Generate intake prompt" to compose a complete `/intake` slash-command prompt containing all four captured signals (job sentence, situation, motivation, outcome, value tier, urgency note, risk note, and live queue rank). The prompt is frozen — editing the wizard steps above does not silently rebuild it; a "updated" cue appears if you change inputs, and you can regenerate if needed. Click "Copy prompt" to send it to your clipboard, then paste into your Claude session. The dashboard writes nothing; all work enters the queue through Claude's accept gate.

The wizard is non-modal — you can click elsewhere on the dashboard while it's open. When done, click "Done" to close (focus returns to the launcher) or "Start another" to reset to step 1 and capture another idea.

### In-flight WIP panel

Click **"In-flight WIP"** (next to "Pipeline") to see all items currently in progress. The list is sorted by longest-waiting first — the items most likely to need action. Each row shows:

- **Item ID** — the requirement, chunk, slice, or use case id
- **Job** — the human-readable job sentence
- **Current stage** — which pipeline stage the item is in
- **Value & Cost** — the item's priority and effort estimate
- **Time in stage** — how long the item has been in its current stage (e.g. "5 h 30 min")
- **Stale badge** — if the item has been waiting more than 2 hours, it's flagged "stale — over 2h" as a visual warning

Click the **⋯ Steer button** on any WIP row to propose action (re-slice, re-prioritise, raise defect, etc.) without navigating away to the tree or value-stream map. The WIP panel stays open behind the steer panel, and you can cancel and pick a different row.

### Live refresh

Any change to the working tree — a new defect file, a ledger entry, items.csv edit, slice artifact update — automatically refreshes the relevant dashboard section within ~2 seconds. No manual reload needed.

### Reading the numbers

All figures in the map are traceable to source:

- **Throughput, dwell, WIP, rework** — sourced from `process/dora/ledger.csv` (the same source of truth the orchestrator commits to on every loop)
- **Items and queues** — read from `work/<project>/items/items.csv` and `work/<project>/queues/*.csv`
- **Slice artifacts** — read from `work/<project>/slices/*/`
- **Defects** — read from `work/<project>/defects/DEFECT-*.md` and matched to ledger rows for MTTR

Hover over any metric label on the value-stream map or click it to see a provenance panel showing which ledger rows contributed to that number (e.g. throughput, dwell, WIP, rework). The panel shows all four metrics in one overlay, sectioned by type.

### Known limitations

- **WIP staleness horizon:** WIP counts (both on the map and in the WIP panel) include only tasks with events in the last 2 hours. Very old orphan items (no recent progress) self-clear from the count after 2 hours of silence. Items stale by this definition remain visible in the WIP panel and are flagged with a "stale" badge.
- **Re-slice prompt enrichment:** The re-slice/split action currently generates a prompt with the before/after proposal fields; Claude must still structure the four /slice-next intake fields (job, scope, value, cost) from the operator's intent. Full auto-fill of those fields is landing in a follow-on slice.
- **Single project only:** The dashboard observes the active project (set via `work/ACTIVE` file). Switching projects requires editing the file and reloading the dashboard.
- **Intake queue rank is directional only:** The queue-rank preview in step 3 of the wizard shows how many items rank ahead and behind your item by tier, not the exact insertion position. The preview reflects the current live backlog and is read-only (no commitment is made until the operator pastes the prompt to Claude).

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
| Steer button doesn't appear on a WIP chip, tree node, or WIP panel row | Ensure you're using a recent build (Ctrl+Shift+R to force-refresh the browser). If a node is a "+N more" collapsed chip, expand it first. Check that the item is in `items.csv`. |
| In-flight WIP panel is empty when there should be items in progress | Verify the ledger has `task_start` rows for items with no matching `task_end` row within the last 2 hours. Items older than 2 hours may be marked "stale" but are still included in the list. Refresh the page to reload ledger data. |
| Defects list shows fewer than 10 records | Check `work/observatory/defects/` for all `DEFECT-*.md` files. Verify `process/dora/ledger.csv` has matching `failure` and `recovery` rows. |
| Re-slice/split panel doesn't open when I select "Request re-slice / split" | Ensure s015 has been deployed (check the git log for `s015-wip-navigate-reslice-preview`). Force a browser cache clear (Ctrl+Shift+R) and reload. |
| Live refresh is slow (>5 seconds) | The file-watch system is catching up. Check system disk I/O. If the issue persists, restart the dev server. |
| Copy prompt to clipboard didn't work | Ensure your browser allows clipboard access (check security settings). If denied, you can still manually copy the prompt from the panel. |

---

## Next steps

- **Report a bug:** create a new file `work/observatory/defects/DEFECT-NNN.md` following the template in an existing defect, or use the "Raise defect" steer action.
- **Request a feature:** use the "Custom steer" action to compose a prompt and paste it into Claude, or edit `work/observatory/open-items.md`.
- **Dive deeper:** read `work/observatory/project.md` (product vision), `work/observatory/slices/*/slice.md` (what shipped each iteration), and `process/dora/baseline.md` (current delivery health metrics).
