# Observatory Support Runbook

**Service:** Observatory dashboard — local Vite SPA + API for observing and steering a multi-project delivery pipeline.

**Surfaces:** 
- **SPA:** http://localhost:5173 (browser, Preact/signals via Vite HMR)
- **API:** /api/* routes served same-origin from Vite dev server (no separate process)
- **Events:** GET /api/events (SSE stream, live file-change push)

---

## Build identity and version diagnostics

### Read the build version

Every `/api/*` response includes the header `X-Observatory-Sha`:

```bash
curl -I http://localhost:5173/api/projects 2>&1 | grep X-Observatory-Sha
```

Expected: `X-Observatory-Sha: <commit-SHA>` (or `dev` if running `npm run dev` without GIT_SHA set).

Compare deployed SHA against the expected commit:

```bash
# In the repo root
git rev-parse HEAD

# Should match X-Observatory-Sha
```

**Version skew diagnosis:** If the browser is loading an old SPA while the API reports a new SHA (or vice versa), clear browser cache (Ctrl+Shift+R on :5173) and reload. If skew persists, restart the dev server (`npm --prefix work/observatory/src/app run dev`).

### Check app initialization

Browser console (F12 → Console tab):

- **No errors on load** — if you see red errors, note the error message and check the "Failure categories" section below.
- **SSE connection established** — look for no console warnings; the `/api/events` stream should open silently on page load.
- **Items tree renders** — the left sidebar should show at least the root item (REQ-OBSERVATORY, currently 49 total). If empty, check "Data anomalies" below.

---

## Failure categories and diagnosis

### 1. API responds with error (5xx or 4xx)

**How to detect:** Browser Network tab (F12 → Network) shows red `GET /api/...` requests, or the detail panel displays "Failed to load ...".

**Failure subcategories:**

#### 1a. 405 Method Not Allowed
- **Root cause:** A POST/PUT/DELETE/PATCH request reached the API.
- **Log evidence:** HTTP 405 response, body contains `{ error: "read-only: method not allowed", method: "POST" }`.
- **Diagnosis:** This is either a bug in the UI (a component sent a write request) or a security attempt. Check browser console for the fetch() call. If it came from the app, file a defect.
- **First response:** Confirm it's not user action (copy-to-clipboard is safe; check if they hit keyboard shortcuts that might trigger a form submit).
- **Escalation:** If the failing API route is new (s013 defects, s014 steer), check the route handler for unguarded POST paths.

#### 1b. 404 Not Found
- **Root cause:** Request path is malformed or the artifact does not exist.
- **Log evidence:** HTTP 404 response, body contains `{ error: "not found" }` or `{ error: "unknown artifact" }`.
- **Examples:**
  - `GET /api/projects/typo-project-name/items` (project doesn't exist)
  - `GET /api/projects/observatory/slices/s001-typo/slice.md` (slice directory renamed or deleted)
  - `GET /api/projects/observatory/queues/typo-queue-name` (queue CSV doesn't exist — missing file, not app bug)
- **Diagnosis:** Check that the request path matches the actual directory structure in `work/<project>/`. Verify `work/ACTIVE` contains a valid project name.
- **First response:** Confirm the file/directory exists in the working tree. If it's a slice artifact, check that the slug matches (e.g. `s001-read-layer` not `s001-read layer` or `s001`).

#### 1c. 400 Bad Request (safe-segment validation)
- **Root cause:** Request path contains unsafe characters (e.g. `..`, `/`, `\0`).
- **Log evidence:** HTTP 400, body contains `{ error: "invalid project id" }` or `{ error: "unknown artifact" }`.
- **Diagnosis:** This is a path-traversal safety check. The request was rejected before the file was opened. Not a data availability issue; the app sent a malformed request (likely a UI bug if the user didn't manually craft a URL).
- **First response:** Check browser console for the fetch() URL. File a defect against the component that built that URL.

#### 1d. Timeout or connection refused (API not running)
- **Root cause:** The Vite dev server is not running or crashed.
- **Log evidence:** Browser shows "Failed to fetch" or "ERR_CONNECTION_REFUSED" in console and Network tab.
- **Diagnosis:** The API is served from the Vite dev server (not a separate process). If you see connection refused on port 5173, the server is not running.
- **First response:** Restart the dev server: `npm --prefix work/observatory/src/app run dev`. Wait for "✓ built in Nms" message. Refresh the browser.
- **If restart fails:** Check for port conflicts (`lsof -i :5173` on macOS/Linux). If port 5173 is in use, kill the process or configure a different port in `vite.config.js`.

### 2. Data anomalies (wrong numbers, missing items, stale state)

**How to detect:** Dashboard renders but numbers are zero, missing items, or don't match expectations.

**Failure subcategories:**

#### 2a. All WIP counts are zero; all stages empty
- **Root cause:** Items.csv or ledger.csv is missing, invalid, or the active project is wrong.
- **Log evidence:** Value-Stream Map renders stage cards but all throughput/dwell/WIP/rework are 0 or "—".
- **Diagnosis:**
  1. Check `work/ACTIVE` file: `cat work/ACTIVE`. Should contain exactly one line with your project name (e.g. `observatory`).
  2. Verify items.csv exists: `ls work/<project>/items/items.csv`. Should exist and have a header row + at least 1 data row.
  3. Verify ledger.csv exists: `ls process/dora/ledger.csv`. Should exist and have a header row.
  4. Check for parse errors: `curl http://localhost:5173/api/projects/<project>/items 2>&1 | jq .` — if the JSON has an `error` field, a parser failed.
- **First response:**
  1. Confirm `work/ACTIVE` is set to the correct active project.
  2. Reload the browser (Ctrl+R or F5).
  3. If still empty, restart the dev server.
- **If data is actually missing:** This is expected during setup (no items.csv yet). The error is not a crash; the API gracefully returns empty arrays. File a feature request to seed the project with template data.

#### 2b. Defects list shows fewer than 10 records; expected 10 DEFECT-*.md files
- **Root cause:** A defect markdown file is missing, or the server failed to parse it.
- **Log evidence:** Defects panel shows N < 10 rows. Browser console may show a failed `GET /api/projects/observatory/defects` request.
- **Diagnosis:**
  1. List actual defect files: `ls work/observatory/defects/ | grep DEFECT | wc -l`. Should be 10.
  2. Fetch the API response: `curl http://localhost:5173/api/projects/observatory/defects 2>&1 | jq '. | length'`. Should be 10.
  3. If the JSON has an `error` field, the parser failed. Check the error message.
- **First response:**
  1. Verify all 10 DEFECT-*.md files exist.
  2. Reload the browser.
  3. Check `process/dora/ledger.csv` for corresponding `failure` and `recovery` rows (if a defect MTTR shows "open" when it should have a duration, the recovery row is missing).

#### 2c. WIP staleness: A task shows in the WIP panel or value-stream map even though it's been idle for >2 hours
- **Root cause:** WIP recency horizon is 2 hours by design. Items with no events in the last 2 hours remain visible in the WIP panel but are flagged "stale — over 2h" as a warning; in the value-stream map, very old items self-clear from the WIP count.
- **Log evidence:** WIP panel shows an item with a "stale — over 2h" badge; ledger shows the item's last `task_start` event >2 hours ago with no matching `task_end`.
- **Diagnosis:** This is expected behaviour (shipped in DEFECT-011 fix, s012 slice; s015 WIP panel includes stale items for visibility). The 2-hour window prevents orphan items (stuck, silent) from inflating the WIP count in the value-stream map, but the WIP panel makes them visible to the operator with a visual warning. If the item should no longer be in-flight, add a `task_end` ledger row to close it. If the item is still actively being worked, add a new `task_start` row to reset its dwell timer.
- **First response:** No action needed if this is the intended behaviour. If the horizon should be different, file a feature request to adjust the constant in `server/apiMiddleware.js` (search for `DEFECT-009` or `DEFECT-011`).

#### 2d. WIP panel shows an item but value-stream map shows it in the count as 0
- **Root cause:** Discrepancy between the WIP panel (includes stale items >2h old) and the value-stream map WIP count (excludes stale items).
- **Log evidence:** WIP panel lists an item with "stale — over 2h" badge; the same item's stage on the value-stream map shows WIP count that doesn't include it.
- **Diagnosis:** This is expected behaviour. The WIP panel visibly surfaces all in-flight items (with stale warning) for operator action; the WIP count on the map is a recency metric (2h) to show active throughput. Stale items are removed from the throughput count but kept visible in the WIP panel so the operator can see and act on stuck items.
- **First response:** No action needed. This is intentional design (shipped in s015 slice, DEFECT-011 guard). The stale badge alerts the operator to items that need intervention (re-start with a new ledger row, or close with a `task_end`).

#### 2e. Defect MTTR shows wrong duration or "open" when it should show a time
- **Root cause:** Ledger join failed — no recovery row found for the defect's failure row.
- **Log evidence:** DEFECT-001 MTTR shows "open", but you expect "13 min".
- **Diagnosis:**
  1. Find the defect's failure row in `process/dora/ledger.csv`: `grep "DEFECT-001.*failure" process/dora/ledger.csv`. Note the row number and timestamp.
  2. Look for a matching recovery row after the failure: `grep "DEFECT-001.*recovery" process/dora/ledger.csv`. Should exist with a later timestamp.
  3. If the recovery row is missing, the defect is truly still open (no fix deployed yet). If it exists but wasn't matched, the parser has a bug.
- **First response:**
  1. Verify the recovery row exists and has the correct `ref=DEFECT-NNN` value (no typos).
  2. Reload the browser to re-fetch.
  3. If the row is missing and the defect should be closed, add a recovery row to the ledger and reload.

### 3. UI-layer failures (buttons don't work, steer menu broken, tree doesn't drill)

**How to detect:** Visual defects, unresponsive UI, or missing affordances.

**Failure subcategories:**

#### 3a. Steer button (⋯) missing from WIP chips, tree nodes, or WIP panel rows
- **Root cause:** SPA failed to render the component; s014 steer-prompt-handoff not yet loaded or has a rendering error.
- **Log evidence:** Browser console shows no errors; button is simply absent. Or, console shows a React/Preact render error.
- **Diagnosis:**
  1. Check that you're on the latest build: Network tab → one of the JS bundles should have a recent timestamp (within minutes of last dev server restart). If it's old, clear browser cache (Ctrl+Shift+R).
  2. Open browser console (F12) and search for `data-testid="steer-btn"`. Should find at least 1 match if the tree has items or the WIP panel is open.
  3. If the button is missing from the WIP panel specifically, verify s015 is deployed (`git log --oneline | grep s015-wip-navigate`).
  4. If console shows a render error, note the component name and stack trace.
- **First response:** Clear browser cache and reload. If the error persists, check `src/app/src/components/SteerMenu.jsx` was committed (s014 slice should have added it) and `src/app/src/components/WipPanel.jsx` (s015 should have added it).
- **If error persists:** Restart the dev server. If it still fails, file a defect and include the exact error from the console.

#### 3b. Tree doesn't expand or drill-down doesn't open the detail panel
- **Root cause:** SSE stream broke (no live file updates reaching the browser), or a click handler was not wired.
- **Log evidence:** Tree nodes render but clicking them does nothing. Detail panel never appears. SSE connection may be closed.
- **Diagnosis:**
  1. Check SSE connection: Browser DevTools → Network → filter type "eventsource". You should see a long-lived `GET /api/events` request. Status should be 200, and you should see `data:` events flowing (every 30 seconds as a heartbeat minimum).
  2. Try clicking a tree node. If nothing happens, check the browser console for a JavaScript error.
  3. Verify the tree node has `role="treeitem"` and `data-item-id` attributes (inspect the DOM, F12 → Inspector).
- **First response:**
  1. If SSE is closed, reload the page. SSE auto-reconnects on page load.
  2. If the click handler is missing, restart the dev server and reload.

#### 3c. Copy-to-clipboard button in steer panel doesn't work
- **Root cause:** Browser clipboard API is blocked (permissions, not HTTPS, or sandbox restrictions).
- **Log evidence:** User clicks "Copy prompt"; no toast appears, or a permission error shows in console.
- **Diagnosis:**
  1. Check browser console for a `ClipboardError` or `NotAllowedError`. This indicates the browser denied clipboard write.
  2. Verify the site is served over https (if required by the browser's clipboard policy). Local http://localhost:5173 is usually allowed.
  3. Check browser permissions: Settings → Site settings → Clipboard → check if http://localhost:5173 is allowed.
- **First response:**
  1. Allow clipboard access in browser settings.
  2. If running on localhost, clipboard should be permitted by default. If denied, check if the browser is running in a sandbox or restricted mode.
  3. As a workaround, the user can manually select and copy the prompt text from the panel (not ideal, but functional).

#### 3d. Intake wizard (+ New Work) button missing or doesn't open

- **Root cause:** s018 (guided intake wizard) not yet loaded or a rendering error occurred.
- **Log evidence:** Button labeled "+ New Work" is absent from the header beside the view tabs. Or, clicking it does nothing.
- **Diagnosis:**
  1. Check that you're on the latest build: Network tab → check a JS bundle timestamp (should be recent).
  2. Open browser console (F12) and search for `data-testid="intake-launcher"`. Should find 1 match if the header is rendered.
  3. If present but clicking does nothing, a JavaScript error may have occurred. Check console for render errors.
  4. Verify s018 is deployed: `git log --oneline | grep s018-guided-cod-intake`. Should appear in recent commits.
- **First response:** Clear browser cache (Ctrl+Shift+R) and reload. If the button still doesn't appear, restart the dev server.

#### 3e. Intake wizard steps 2–4 open but are blank or show "(soon)" placeholder

- **Root cause:** s018 is partially loaded. Steps 1 (JTBD) is built, but steps 2–4 may still show placeholders if the slice build is incomplete.
- **Log evidence:** Clicking "+ New Work" opens the wizard at step 1 (JTBD fields visible). Clicking "Next" advances to step 2, but step 2 shows a heading "Cost of delay — coming..." instead of the live form.
- **Diagnosis:** This is expected behaviour during development. Steps 2–4 were added in later commits:
  1. UC-S018-2 (Cost-of-delay signals step) — added `CodStep.jsx` + `codScorer.js`; step 2 should show Value/Urgency/Risk fields.
  2. UC-S018-3 (Queue-rank preview) — added `QueueRankStep` + `useQueueRank`; step 3 should show rank preview.
  3. UC-S018-4 (Prompt generation) — added `PromptStep` + `intakePromptBuilder`; step 4 should show "Generate" button and prompt output.
  
  If step 1 is live but steps 2–4 still show "(soon)", the build was interrupted or the commits did not merge.
- **First response:**
  1. Check `git log --oneline | head -30 | grep s018`. Should show recent UC-S018-4 commits.
  2. If the commits exist, restart the dev server: `npm --prefix work/observatory/src/app run dev`. This recompiles all components.
  3. Clear browser cache and reload.
- **If error persists:** Check `src/app/src/components/` for the presence of `CodStep.jsx`, `QueueRankStep.jsx`, and `PromptStep.jsx`. If any are missing, the slice was not fully deployed.

#### 3f. Intake wizard step 3 (queue rank) shows all items as "ahead of 0, behind 0" even when items exist in the backlog

- **Root cause:** The `/api/projects/:id/items` endpoint returned successfully but the items list was empty, or the tier comparison is not working.
- **Log evidence:** Step 3 queue-rank preview shows "Your item (MED value) would rank ahead of 0 items and behind 0 items" even though you know the items.csv has 10+ entries.
- **Diagnosis:**
  1. Check the items endpoint directly: `curl http://localhost:5173/api/projects/observatory/items 2>&1 | jq '. | length'`. Should return a count > 0.
  2. Verify the active project is correct: `cat work/ACTIVE`. Should match your expected project.
  3. Check the terminal items are excluded: `curl http://localhost:5173/api/projects/observatory/items 2>&1 | jq '.[] | select(.state=="done" or .state=="dropped") | .id' | wc -l`. The rank preview should exclude these.
  4. Filter by non-terminal items: `curl http://localhost:5173/api/projects/observatory/items 2>&1 | jq '[.[] | select(.state!="done" and .state!="dropped")] | length'`. This is the comparison set; rank counts should sum to this total.
- **First response:**
  1. Verify items.csv has the expected rows and is not malformed: `head -5 work/observatory/items/items.csv`.
  2. Reload the page to re-fetch items.
  3. If the endpoint returns the correct count but the rank still shows 0, restart the dev server.

#### 3g. Intake wizard copy-to-clipboard (step 4) doesn't work

- **Root cause:** Same as 3c (clipboard API is blocked). The copy button in the prompt step uses the same mechanism as the steer panel.
- **Log evidence:** User clicks "Copy prompt" in step 4; no toast appears ("Copied ✓").
- **Diagnosis:** See section 3c for full diagnosis steps.
- **First response:** See section 3c for recovery steps.

#### 3i. Re-slice/split preview panel doesn't open when selecting "Request re-slice / split"
- **Root cause:** s015 (WIP panel + re-slice preview) not yet deployed, or the dispatch routing is broken.
- **Log evidence:** User selects "Request re-slice / split" from the steer menu; SteerPanel opens instead of ReslicePreviewPanel (the before/after two-column preview).
- **Diagnosis:**
  1. Check that s015 is deployed: `git log --oneline | grep s015-wip-navigate`. Should show recent commits.
  2. If s015 is in the log, verify the dispatch routing in `src/app/src/hooks/useSteerContext.js` or the WIP row's action handler. The `re-slice` action should route to `ReslicePreviewPanel`, not `SteerPanel`.
  3. If the old `SteerPanel` opens, the dispatch re-point was not applied.
- **First response:**
  1. Clear browser cache (Ctrl+Shift+R) and reload.
  2. Restart the dev server to ensure all s015 components are hot-loaded.
  3. If the issue persists, check the commit SHAs: the re-point should be in the s015 slice commit.
- **If error persists:** File a defect citing the exact action taken (item id, action selected) and whether SteerPanel or an error appeared instead.

### 4. SSE live-refresh failures (changes to items.csv, ledger, defects don't auto-update)

**How to detect:** You edit a file in the working tree; the dashboard does not reflect the change within ~5 seconds.

**Failure subcategories:**

#### 4a. SSE stream is open but events are not flowing
- **Root cause:** File watcher (chokidar) is not detecting changes, or the watcher crashed.
- **Log evidence:** Network tab shows `GET /api/events` is open (200), but no `data:` events are seen even after you edit and save a file.
- **Diagnosis:**
  1. Check that the file you edited is within the watched directories (typically `work/`, `process/dora/`).
  2. Verify the file was actually saved (check the file's mtime: `stat work/observatory/items/items.csv | grep Modify`).
  3. Check dev server logs for chokidar warnings (e.g. "too many open files", "ENOSPC on watch"). These indicate the watcher overload.
- **First response:**
  1. Force a refresh (Ctrl+R) to reload all data.
  2. Restart the dev server to reset the file watcher.
- **If error persists:** The system may have too many open files. Check system limits: `ulimit -n` on macOS/Linux. If < 1024, increase it: `ulimit -n 4096`.

#### 4b. SSE stream is closed (status 0 or connection lost)
- **Root cause:** Browser tab was backgrounded too long, or the server-client connection was severed.
- **Log evidence:** Network tab shows `GET /api/events` is no longer visible or has status 0 (aborted).
- **Diagnosis:** This is expected if the browser was in sleep or the network was disconnected. SSE is a long-lived connection and is fragile over unstable networks.
- **First response:** Reload the page (F5 or Ctrl+R). SSE re-connects on page load. Once reconnected, edits will update again.

---

## Operational posture and SLAs

**Observatory is a development-time tool, not a production service.** It is meant to run locally with one operator and is not designed for high availability, authentication, or remote scaling.

### Expectations

- **Availability:** Operator-dependent. The service is available when the dev server is running (`npm run dev`) and the working directory is accessible.
- **Data consistency:** All data is read-only from the browser. Staleness window: ~2 seconds (SSE polling interval). File-system consistency is the operator's responsibility.
- **Recovery:** Restart the dev server. This is the universal fix for most failures.

### When to escalate to engineering

1. **Repeated 5xx errors** after restart — indicates a parsing or infrastructure bug in the server code.
2. **Stale data not updating within 10 seconds** — file watcher or SSE stream is broken.
3. **Missing affordances** (steer button, defects list) after cache clear — shipped feature did not deploy correctly.
4. **Data corruption** (wrong MTTR, phantom items) — ledger or CSV parser has a bug.

Escalations should include:

- Exact error message and response body
- Steps to reproduce (if not always-on)
- Actual vs. expected value
- Current build SHA (`X-Observatory-Sha` header) and git HEAD
- List of recent edits or file changes that preceded the failure

---

## Metrics and observability gaps

Observatory ships with minimal observability:

- **Browser console errors** — check F12 → Console for JavaScript exceptions.
- **HTTP status codes** — check Network tab for failed API requests.
- **File-watcher status** — no metrics exposed; check dev server logs for chokidar warnings.

**Gaps (not yet shipped):**

- No APM or performance monitoring
- No server-side error logs (writes to stdout/stderr only)
- No client-side telemetry or error reporting
- No SLA dashboards or health checks

These can be added in future slices if operational visibility becomes critical.
