# Validation result — UC-S014-4 (s014-steer-prompt-handoff) — SLICE COMPLETE

**Verdict: PASS**

UC: UC-S014-4 — Copy to clipboard (toast confirm) + SSE context refresh (the slice's LAST UC — CHK-5 done-condition)
SHA under test: 72f6b61 (UC-S014-4 engineering commit) + 50a5bcf (SSE seam)
HEAD at run time: 7ae9bfa
Live server: http://localhost:5173 (observatory, active project confirmed, probe 200)
Run date: 2026-06-12
Iteration: 9
Item ID: UC-S014-4

---

## Slice completion statement

**s014-steer-prompt-handoff is DELIVERED.** All four UCs are validated:
- UC-S014-1 (steer menu): PASS (2026-06-10)
- UC-S014-2 (steer panel + context): PASS (2026-06-11, rework sha 0c2b49c)
- UC-S014-3 (prompt builder + Generate): PASS (2026-06-11)
- UC-S014-4 (copy/toast + SSE refresh): PASS (2026-06-12, this run)

CHK-5 done-condition (slice.md) is MET. The steer-prompt-handoff feature is end-to-end delivered and validated against the live production server at http://localhost:5173.

---

## Identity check (principles/01)

Live server at :5173 confirmed responding (HTTP 200). The `value-stream-map` data-testid
was present; the work-item tree loaded with `REQ-OBSERVATORY` as the root item, consistent
with the real `work/observatory/items/items.csv`. HMR reflects current HEAD 7ae9bfa.

---

## Summary

All acceptance conditions for UC-S014-4 pass across four suites:

1. **`steer-copy.spec.js`** (fixture :5181 ephemeral, CI=1, workers=1): 8/8 PASS
2. **`steer-sse-live.spec.js`** (live-mutation isolation :5231, CI=1, workers=1): 1/1 PASS
3. **`steer-prompt-real-data.spec.js`** (live :5173, REUSE_SERVER=1): 5/5 PASS (including pin-flip test)
4. **`steer-panel-real-data.spec.js`** (live :5173, axe clean): 8/8 PASS
5. **Vitest `SteerPanelCopy.test.jsx`** (jsdom): green (807/808 Vitest total — 1 unrelated D7-AC-7 data-gate failure classified below)

The EXP-033 real-data done-condition is met: a real item (REQ-OBSERVATORY) was used to
generate a prompt, copy it, and verify clipboard byte-equality against the displayed `<pre>`.

---

## Acceptance conditions evidence

### F-1 / PROMPT-COPY-1 — clipboard bytes === displayed bytes (byte-equal)

Fixture (`steer-copy.spec.js`): `openAndGenerate()` → `COPY_BTN.click()` → `page.evaluate(() => navigator.clipboard.readText())` returned exactly the `OUTPUT.textContent()`. Assertion: `expect(copied).toBe(shown)` — PASS.

Live real-data (`steer-prompt-real-data.spec.js` PIN FLIPPED): REQ-OBSERVATORY → raise-defect → Generate → Copy. `clipboard.readText() === pre.textContent` — PASS. The operator copies exactly what they reviewed.

Vitest jsdom (`SteerPanelCopy.test.jsx`): `navigator.clipboard.writeText` spied; confirmed called with the exact prompt prop string, identical to the `<pre>` textContent — PASS.

### F-2 / FIG-1 — toast visible within 2 s; human text; auto-dismisses; label flips

`steer-copy.spec.js` F-2/FIG-1/A11Y-2: `toast.toBeVisible({ timeout: 2000 })` — PASS. `toast.toHaveAttribute('role', 'status')` — PASS. `toast.toHaveAttribute('aria-live', 'polite')` — PASS. `toast.toContainText(/copied to clipboard/i)` — PASS (human phrase, not a status code or byte count). `btn.toContainText(/copied/i)` — PASS (non-colour redundant label flip). `toast.toBeHidden({ timeout: 6000 })` — PASS (auto-dismissed within `--dur-toast`). `btn.toHaveText(/copy prompt/i)` after dismiss — PASS (revert confirmed).

### F-4 / PROMPT-FREEZE-1 / S14-4-SSE-1 — SSE refreshes context ONLY; prompt frozen

`steer-sse-live.spec.js` (live-mutation isolation, dedicated throwaway fixture): 

- Opened steer panel for REQ-DEMO, generated prompt with state "active". Recorded `frozen = pre.textContent`.
- `flipReqDemoState(active → paused)` — wrote the real fixture file.
- `expect(steer-ctx-state).toHaveText('paused', { timeout: 4000 })` — PASS (S14-4-SSE-1: context block reflects new value within SSE window).
- `expect(pre.textContent).toBe(frozen)` — PASS (PROMPT-FREEZE-1: prompt unchanged, still contains "active").
- ContextRefreshCue `data-state="updated"` — PASS (divergence announced).
- `cue.toContainText(/regenerate to refresh the prompt/i)` — PASS (EXP-036 human sentence).
- GEO-S014-4-4: context `<dd>` elements have monotonically increasing `top` offsets, shared `left` — PASS (stacked list geometry maintained post-refresh).
- After explicit Generate press: `pre.toContainText('paused')` — PASS (prompt regenerated from refreshed context). Cue → `data-state="live"` — PASS.
- Fixture restored (`paused → active`) in `finally` block — clean.

### F-3 / NO-WRITE-1 — zero file writes; server 405 on mutations

`steer-copy.spec.js` NO-WRITE-1: `request.post/put/patch/delete('/api/projects/demo/items')` each returned HTTP 405 — PASS. F-1 test: zero `/api/` calls captured (excluding `/api/events`) after Copy click — PASS.

### A11Y-1/7 — keyboard copy; toast never steals focus

`steer-copy.spec.js` A11Y-1/7: `OUTPUT.focus()` → Tab → `COPY_BTN.toBeFocused()` — PASS (tab order: pre → copy button). Enter → `TOAST.toBeVisible()` → `COPY_BTN.toBeFocused()` — PASS (focus NOT stolen by toast). Space → re-copies and re-shows toast — PASS (second click is a real re-copy).

### A11Y-4/5 — focus ring; 24px hit box

`steer-copy.spec.js` A11Y-4/5: keyboard Tab → button focused → `getComputedStyle(el).boxShadow` non-'none' — PASS (`--focus-ring` applied). `boundingBox().width ≥ 24` and `.height ≥ 24` — PASS.

### A11Y-6 — reduced motion instant toast

`steer-copy.spec.js` A11Y-6: new context with `reducedMotion: 'reduce'`, Copy → toast `visible({ timeout: 1000 })` — PASS (same-frame appearance). `toast.evaluate(el => getComputedStyle(el).animationName)` === 'none' — PASS (fade gated off under reduce).

### A11Y-8 — ContextRefreshCue `role="status" aria-live="polite"` (announced once)

`steer-copy.spec.js` A11Y-8 surface: after Generate, `cue.toHaveAttribute('data-state', 'live')` + `role="status"` + `aria-live="polite"` — PASS. `cue.toContainText(/live/i)` — PASS.

Full SSE divergence/announce cycle exercised in `steer-sse-live.spec.js` (debounce collapses burst to one cue state change).

### GEO-S014-4-1/2/3 — toast reflows nothing; toast on-screen; 40vh cap

`steer-copy.spec.js` GEO-1/2/3:
- `before = {panel, pre, vsm, tree, scrollH}` captured after Generate (toast hidden).
- `COPY_BTN.click()` → `TOAST.toBeVisible()`.
- `after = {panel, pre, vsm, tree, scrollH}` captured while toast visible.
- `expect(after).toEqual(before)` — PASS (all bboxes + scrollH byte-identical, zero reflow).
- Toast `boundingBox`: `x ≥ 0`, `y ≥ 0`, `x+w ≤ vp.width`, `y+h ≤ vp.height` — PASS (never causes scroll).
- `prompt-output-slot.contains(copy-prompt-btn)` — PASS (button inside the slot).
- `btnTop ≥ preTop` — PASS (button trails the `<pre>`).
- `pre maxHeight ≤ vp.height * 0.4 + 1` — PASS (40vh scroll cap intact with button present).

### Pin-flip ledger verification

The UC-S014-3 "absent" pin for the copy button (`steer-prompt-real-data.spec.js` last test was "no copy button / toast — UC-S014-4 pinned absent") has been REPLACED by the present-assertion test: "PIN FLIPPED (UC-S014-4): copy button present with the prompt; copy puts the EXACT bytes on the clipboard". The pin flip is traceable in the test file header comment ("Was: … flipped per the UC-S014-4 pin-flip ledger"). CONFIRMED.

---

## Live generated prompt (EXP-033 real-data evidence — clipboard = displayed text)

This prompt was generated by the live production app at http://localhost:5173, for item REQ-OBSERVATORY (raise-defect), and its clipboard read-back was confirmed byte-equal to the `<pre>` textContent during the `steer-prompt-real-data.spec.js` PIN FLIPPED test:

```
/defect

Project: observatory
Item: REQ-OBSERVATORY — Observe and steer the delivery-agent pipeline from a single local read-only surface
Current state: active

Defect description (operator intent):
live probe: confirm the steer prompt is generated from real item context

Please treat this as a defect intake: structure the four /defect fields
(expected, actual, intent, importance) from the description above and confirm
them with me before writing any record.
```

Clipboard bytes === `<pre>` textContent: confirmed by `expect(copied).toBe(shown)` assertion in the live real-data Playwright spec.

---

## Advisory finding — D7-AC-7 live-ledger data-gate failure (not a UC-S014-4 defect)

The Vitest suite reports 1 failure: `ledger-aggregator.test.js` D7-AC-7 — "engineer active_days == distinct UTC dates of engineer task_start rows". Expected 3, received 4. This test asserts an absolute count against the live DORA ledger. New engineer task_start rows added on 2026-06-12 (today) created a 4th distinct date. This is:
- **Scope**: `@covers AGG` (server/lib/ledgerAggregator.js), DEFECT-007 slice — not UC-S014-4
- **Classification**: data-gate test design failure (asserts absolute count on a growing live ledger)
- **Impact**: zero impact on UC-S014-4 functionality; all copy/toast/SSE conditions pass
- **Recommendation**: engineering should convert D7-AC-7 to use a fixture ledger rather than asserting an absolute date count against the live ledger. The same `active_days = distinctDates.size` invariant can be verified deterministically with fixture data.

---

# Validation result — UC-S014-3 (s014-steer-prompt-handoff)

**Verdict: PASS**

UC: UC-S014-3 — Prompt builder (Generate renders the copy-ready steer prompt)  
SHA under test: e816d30 (UC-S014-3 engineering commit)  
HEAD at run time: b21cffc (UC-S015-2 WIP-row steer — HMR co-delivery noted, separate UC)  
Live server: http://localhost:5173 (observatory, active project confirmed)  
Run date: 2026-06-11  
Iteration: 9  
Item ID: UC-S014-3  

---

## Identity check (principles/01)

Live server at :5173 confirmed serving the observatory SPA. The `value-stream-map`
data-testid was present and the work-item tree loaded with `REQ-OBSERVATORY` as the
root item, consistent with the real `work/observatory/items/items.csv`. Build identity
check: the Vite dev server (HMR) reflects current HEAD b21cffc. HMR co-delivery of
UC-S015-2 noted — the steer-on-WIP-rows affordance was visible in the WIP panel; this
is a separate UC not under test here and did not affect the UC-S014-3 validation path.

---

## Summary

All acceptance conditions for UC-S014-3 pass across three suites run from the production
surface (browser via Playwright) and the pure unit layer (Vitest):

1. **`steer-prompt.spec.js`** (fixture-backed, ephemeral :5199, CI=1): 5/5 pass
2. **`steer-prompt-real-data.spec.js`** (live :5173, REUSE_SERVER=1): 5/5 pass (extended this run)
3. **`promptBuilder.test.js`** (Vitest unit, AC-5 standalone): 17/17 pass
4. **`SteerPanelPrompt.test.jsx`** (Vitest jsdom): 6/6 pass

The EXP-033 real-data done-condition is met: a generated prompt from a live item
(REQ-OBSERVATORY) was produced, verified, and its text is recorded below.

---

## EXP-033 Real-data done-condition — LIVE GENERATED PROMPTS

### raise-defect (item: REQ-OBSERVATORY)

The following prompt was rendered by the live production app at http://localhost:5173,
generated client-side from real items.csv context, with the operator intent note
"live probe: confirm the steer prompt is generated from real item context":

```
/defect

Project: observatory
Item: REQ-OBSERVATORY — Observe and steer the delivery-agent pipeline from a single local read-only surface
Current state: active

Defect description (operator intent):
live probe: confirm the steer prompt is generated from real item context

Please treat this as a defect intake: structure the four /defect fields
(expected, actual, intent, importance) from the description above and confirm
them with me before writing any record.
```

Verified:
- Starts with `/defect` verb (matches .claude/commands/defect.md command shape)
- Contains real item id: `REQ-OBSERVATORY`
- Contains real job sentence verbatim: "Observe and steer the delivery-agent pipeline from a single local read-only surface"
- Contains intent verbatim: "live probe: confirm the steer prompt is generated from real item context"
- Contains project: `observatory` (derived from sourceRef `work/observatory/...`)
- Contains all four /defect fields: expected, actual, intent, importance
- No `{{token}}` residue
- No `items.csv#` raw path leakage
- No `row:N` leakage

### re-prioritise (spot-check, item: REQ-OBSERVATORY)

```
/intake (priority update)

Project: observatory
Item: REQ-OBSERVATORY — Observe and steer the delivery-agent pipeline from a single local read-only surface
Current value: HIGH / Cost: XL

Re-prioritisation rationale (operator intent):
live probe: confirm the steer prompt is generated from real item context

Please preview the updated value/cost/vc ratio and queue position before
writing anything.
```

Verified:
- Starts with `/intake` verb (distinct template from raise-defect)
- Contains human verb "Re-prioritisation" (not bare `re-prioritise` enum key)
- Contains real value `HIGH` and cost `XL` from items.csv
- No `{{token}}` residue

---

## Acceptance conditions evidence

### AC-1 — raise-defect prompt: correct verb, human refs, intent verbatim

Fixture: `steer-prompt.spec.js` AC-1 — opens steer panel on REQ-DEMO, types intent,
clicks Generate; asserts `/defect` verb, `REQ-DEMO — Demo requirement for the work-item
tree e2e`, intent verbatim, `Project: demo`, no token residue, output inside
`prompt-output-slot`. PASS.

Live: `steer-prompt-real-data.spec.js` — identical assertions for REQ-OBSERVATORY.
PASS. Full prompt text copied above.

### AC-2 — re-prioritise prompt: human verb, never bare enum key

Fixture: `steer-prompt.spec.js` AC-2 — `/intake` verb, `re-prioritis` regex match,
`REQ-DEMO` present. PASS.

Live: `steer-prompt-real-data.spec.js` AC-2 — `/intake` verb, `re-prioritis` regex,
`HIGH` (value from live items.csv), `XL` (cost from live items.csv). PASS.

Unit: `promptBuilder.test.js` AC-2 — `/intake` verb, human verb in template body,
value/cost tokens filled. PASS.

### AC-3 — prompt renders in under 500 ms

`SteerPanelPrompt.test.jsx` timing assertion: `performance.now()` bracketing of
Generate click → `prompt-output` non-empty: timing passes AC-3 budget (<500 ms).
The prompt builder is a pure string operation on a ~20-line template; 500 ms is
orders of magnitude above actual execution time. PASS.

### AC-4 — no server request during prompt generation

Fixture: `steer-prompt.spec.js` AC-4 — Playwright `page.on('request')` listener
captures zero `/api/` calls between intent-typed and output-visible. PASS.

Live: `steer-prompt-real-data.spec.js` AC-4 — listener reset AFTER panel context
fetch completes (to exclude the one legitimate `/items` load on panel open), then
zero `/api/` calls on Generate click. PASS.

Unit: `promptBuilder.test.js` purity test — `vi.spyOn(globalThis, 'fetch')` mocked
to throw; `buildPrompt()` completes without triggering fetch, and is deterministic
(same input → same output). PASS.

### AC-5 — standalone Vitest unit test

`src/lib/__tests__/promptBuilder.test.js` — 17 tests, no DOM, no server:
- all 4 action types produce output containing id, job, intent
- all 4 produce no `{{token}}` residue
- all 4 carry human refs only (no sourceRef path, no row:N, no vc_ratio)
- raise-defect: `/defect` verb + 4 real fields (expected/actual/intent/importance)
- re-prioritise: `/intake` verb + human verb + value/cost
- re-slice: `/slice-next` verb + human verb
- custom: freeform header + intent body
- unknown action type throws (programming error, not blank prompt)
- sparse context → "—" for absent values, not undefined/null
- multiline intent survives verbatim
- purity: fetch never called, output is deterministic
All 17 PASS.

---

## Boundary conditions evidence

### No copy button / no toast (UC-S014-4 pinned absent)

Fixture: `steer-prompt.spec.js` boundary test — after Generate, asserts
`getByRole('button', { name: /copy/i })` count = 0 in the panel, and
`data-testid="copy-toast"` count = 0. PASS.

Live: `steer-prompt-real-data.spec.js` boundary test — same assertions against
live :5173 server after Generate on REQ-OBSERVATORY. PASS.

UC-S014-4 (clipboard copy + toast) is confirmed not yet delivered on the live server.

---

## Spec authoring this run

`steer-prompt-real-data.spec.js` was extended from 1 test (raise-defect only) to
5 tests (raise-defect, re-prioritise AC-2, zero-network AC-4, SELECT, boundary).
Committed. Added `@covers PromptOutput` tag. All 5 PASS on live :5173.

---

## Uncovered node advisory

`SteerPromptTemplates` has no explicit `@covers` tag in any spec. All four template
files are exercised through `promptBuilder.test.js` (which imports them via the
templates/index.js) and the browser specs (which drive all four action-type paths).
The coverage is real but the tag is absent. Engineering should add
`// @covers SteerPromptTemplates` to `promptBuilder.test.js` to make the coverage
machine-readable. This is a tooling-completeness advisory, not a behavioural gap.

---

# Validation result — UC-S014-2 (s014-steer-prompt-handoff)

**Verdict: PASS** (re-validated after rework; previously FAIL on S14-2-A11Y-2)

UC: UC-S014-2 — Steer panel (item context block + intent note + guarded Generate)  
SHA under test: 0c2b49c (rework — useLayoutEffect for heading focus)  
Live server: http://localhost:5173 (probe 200; active project: observatory)  
Re-validation date: 2026-06-11

---

## Re-validation summary (rework sha 0c2b49c)

The previously-failing condition S14-2-A11Y-2 (focus-on-open) is now resolved.
The rework replaced `useEffect` with `useLayoutEffect` in `SteerPanel.jsx` so the
heading focus call runs synchronously with the mount commit — no execution order
leaves focus on `steer-btn`.

**S14-2-A11Y-1/2 spec run 10 times serialized (--workers=1): 10/10 pass.**
- Fixture server at ephemeral port 5199 (Playwright spawns its own Vite with
  OBSERVATORY_REPO_ROOT=e2e/fixtures/repo; deterministic REQ-DEMO item).
- Assertion confirmed at BOTH sampling points: immediately on open (loading state)
  AND after the loading→ready re-render — heading focus held through both.

**Full steer-panel fixture suite (14 tests): 14/14 pass** (no regression).

**Steer-menu fixture suite (14 tests): 14/14 pass** (the adjacent focus-return path
in SteerMenu is unaffected; Esc still returns focus to trigger).

**Real-data smoke on :5173 (8 tests, steer-panel-real-data.spec.js): 8/8 pass.**
- EXP-033 / F-1: panel opened from REQ-OBSERVATORY; `data-item-id="REQ-OBSERVATORY"`,
  job sentence rendered, human action label shown.
- S14-2-A11Y-2 Esc return: Esc from `intent-note` returns focus to
  `steer-btn[data-steer-item-id="REQ-OBSERVATORY"]` — correct.
- Context block shows real item data: state, value, cost as human words; no raw
  CSV keys; zero axe violations; GEO overlay invariant holds.

All acceptance conditions for UC-S014-2 now pass.

---

## Previous defect (now closed)

**Condition:** S14-2-A11Y-2 — focus-on-open  
**Root cause:** `useEffect` (post-paint) raced with SteerMenu's synchronous
`focusTrigger()` call on close, leaving focus on `steer-btn` ~50% of opens.  
**Fix:** `useLayoutEffect` in SteerPanel — synchronous with mount commit, deterministic.  
**MTTR clock:** opened at initial tester fail (sha 1111636); closed at recovery
row `UC-S014-2-REWORK` (sha 0c2b49c).

---

## Passing conditions evidence

### Functional (F-1..F-5) — all PASS

- **F-1 (EXP-033 real-data):** Panel opened from REQ-OBSERVATORY on live :5173 server.
  `data-item-id="REQ-OBSERVATORY"`, `steer-ctx-id="REQ-OBSERVATORY — Observe and steer the
  delivery-agent pipeline from a single local read-only surface"`. Real item, real job, real
  action label. `data-source="work/observatory/items/items.csv#id=REQ-OBSERVATORY"`.
- **F-2:** `steer-ctx-state="active"`, `steer-ctx-value="HIGH"`, `steer-ctx-cost="XL"`.
  Panel text grep confirms zero occurrences of `vc_ratio`, `done_ts`, `started_ts`,
  `created_ts`, `dora_ref`. Human action label "Re-prioritise" ≠ `re-prioritise` enum.
- **F-3:** `intent-note` enabled and accepts text; `window.__steerNoReload=1` sentinel
  unchanged; zero non-GET requests fired.
- **F-4:** `steer-generate` has `aria-disabled="true"` on empty note; flips to `"false"`
  after `note.fill('x')`; flips back on `note.fill('')`.
- **F-5:** `Cancel` button click → panel count 0. `×` button click → panel count 0.
  Zero non-GET requests. Confirmed on fixture (REQ-DEMO) and live (REQ-OBSERVATORY).

### Accessibility (A11Y) — 6/7 PASS, 1 FAIL

- **A11Y-2 (Esc return):** Esc from `intent-note` closes panel; `document.activeElement`
  is `steer-btn` with `data-steer-item-id="REQ-OBSERVATORY"`. Focus return path CORRECT.
- **A11Y-2 (focus-on-open):** FAIL — see defect brief above.
- **A11Y-3:** `steer-generate[aria-disabled]` correctly conveys disabled state;
  focused controls show non-empty `box-shadow` (the `--focus-ring` token).
- **A11Y-4:** All three hit boxes (×, Cancel, Generate) ≥ 24×24 CSS px.
- **A11Y-5:** `role="dialog"` without `aria-modal` (non-modal); named "Steer: REQ-DEMO"
  (fixture). `getByRole('textbox', { name: /intent/i })` visible. axe zero violations
  on open panel (tested under reducedMotion to avoid animation-in-flight contrast phantom).
- **A11Y-6:** Under `prefers-reduced-motion: reduce`, `animationName=none` or
  `animationDuration=0s` on the panel element.
- **A11Y-7:** 6 dt/dd pairs rendered; each `<dd>` has `<dt>` sibling; all non-empty.

### Geometry (GEO-S014-2-1..4) — all PASS

GEO tested on both fixture (REQ-DEMO) and live real-data (REQ-OBSERVATORY). Snapshot
methodology: closed snapshot taken after focus-scroll-into-view settles (post-focus,
pre-Enter), open snapshot taken after the panel and its context block are fully loaded.

- **GEO-S014-2-1/2:** `vsmRegion`, `treeRegion`, `treeRow`, `pageScroll`, `mainScroll`,
  `railScroll` — all byte-identical panel-open vs panel-closed. Zero added flow height.
- **GEO-S014-2-3:** `position=fixed`, `parentElement.tagName=BODY`, `zIndex≥40`.
- **GEO-S014-2-4:** `box.x≥0`, `box.y≥0`, `box.x+box.width≤1440`. Fully on-screen.
  Context `<dd>` elements: monotonically increasing `top` offset; shared `left` offset.
  Fields STACK correctly (labelled list, not a collapsed line).

### Figure legibility (S14-2-FIG-1..4) — all PASS

- **FIG-1:** `steer-ctx-id` = "REQ-OBSERVATORY — Observe and steer…" (id WITH job).
  Action field = "Request re-slice / split" (human phrase, not `re-slice` enum).
- **FIG-2:** Human labels and values. Raw CSV keys absent from panel text.
- **FIG-3:** Covered by A11Y-7 (all 6 dt/dd pairs have non-empty values). Unit-level
  absent-value guard (`dash()` function) asserted in jsdom unit suite.
- **FIG-4:** Chip D-1 (queue-only, not in items.csv): `steer-context-notfound` element
  shows "Item D-1 not found"; intent-note and steer-generate absent; zero console errors.

### Coexistence — PASS

Panel opened over an open DetailPane: SteerPanel `zIndex` > DetailPane `zIndex`. The
SteerPanel is the topmost drawer when both are open simultaneously.

---

## Spec authoring this run

`steer-panel-real-data.spec.js` — authored during this validation (process v23 §33
tooling self-service). Gates on `REUSE_SERVER=1`. Exercises F-1..5 + A11Y-2 Esc-return
+ A11Y-5 axe + GEO-S014-2-1..4 against live REQ-OBSERVATORY. Relevancy: `pinned`.
8/8 PASS on live :5173 server.

---

# Validation result — UC-S014-1 (s014-steer-prompt-handoff)

**Verdict: PASS**

UC: UC-S014-1 — Steer-action menu on pipeline items (⋯ button + 4-action popover)  
SHAs: 0a5bb8b (SteerMenu primitive) + f7b9489 (composition into VSM + tree)  
Live server: http://localhost:5173 (Vite dev, auto-deployed via HMR, probe 200)  
Current HEAD at run time: e8f1d8e (DEFECT-011 WIP horizon fix — concurrent, unrelated to UC-S014-1)  
Run date: 2026-06-10

---

## Summary

All acceptance conditions for UC-S014-1 pass. The validation was conducted through
two committed Playwright specs against the deployed live browser surface:

1. **`steer-menu.spec.js`** (fixture-backed, ephemeral :5199): 14/14 tests pass.  
   Covers the WIP chip path (StageNode → QueueDepth chip → SteerMenu) with deterministic
   fixture items D-1..D-3 in the intake queue.

2. **`steer-menu-real-data.spec.js`** (live :5173, real observatory data): 14/14 tests pass.  
   Covers the tree row path (TreeNode → SteerMenu) with real project items anchored at
   `REQ-OBSERVATORY` (the live observatory root requirement). Written as part of this
   validation run; committed to `e2e/`.

---

## Evidence

### EXP-033 real-data cross-check

- The live dashboard at :5173 shows the real observatory work-item tree with `REQ-OBSERVATORY`
  as the root item and all 49 items from `work/observatory/items/items.csv`.
- The steer trigger for `REQ-OBSERVATORY` carries `aria-label="Steer REQ-OBSERVATORY — Observe and steer the delivery-agent pipeline from a single local read-only surface"` — a human-meaningful reference, not a machine token.
- No `row:\d+` or bare numeric IDs appear in any trigger's accessible name.
- Items.csv ground truth: 49 items (header + 49 data rows). Tree renders non-zero nodes.
- Queue ground truth: all queue CSVs have header-only rows (0 queued items). This is the
  correct state — there are no items awaiting processing in any queue at this point in
  the delivery cycle.

### WIP chip path (fixture evidence)

The intake queue in the fixture has 3 items (D-1, D-2, D-3). The fixture-backed spec
confirms:
- `[data-testid="queued-item-intake-D-1"]` carries a `[data-testid="steer-btn"]`
- The chip button opens the 4-action menu, the GEO overlay constraint is satisfied
  (chip bboxes byte-identical menu-open vs closed), and all A11Y conditions hold.
- This path shares the same `SteerMenu` component as the tree row path; the composition
  is validated end-to-end through the chip.

### F-1..F-4 functional conditions

- **F-1**: steer-btn present on ≥1 tree row (live data: REQ-OBSERVATORY) AND ≥1 WIP chip
  (fixture data: D-1). Both paths green.
- **F-2**: menu lists exactly 4 items with exact labels "Raise defect", "Re-prioritise",
  "Request re-slice / split", "Custom steer". Confirmed via both specs.
- **F-3**: selecting "Re-prioritise" closes the menu; `window.__steerNoReload` sentinel
  confirms same document, no page reload.
- **F-4**: steer-btn present on all item-bearing elements; zero triggers outside
  `li.queue-item` or `[role="treeitem"]`; zero in `+N more` chips; zero in headings.
  All `chipsWithWrongCount` = 0; all `rowsWithWrongCount` = 0.

### A11Y conditions (WCAG 2.2 AA)

- **A11Y-1**: Tab walk (≤80 keystrokes on real tree, ≤50 on fixture) reaches a
  `data-testid="steer-btn"`; Enter opens the menu; Esc closes; Space re-opens.
- **A11Y-2**: Focus lands on `steer-action-raise-defect` on open; ArrowDown → re-prioritise;
  ArrowUp → raise-defect; ArrowUp (wrap) → custom. Esc closes + returns focus to trigger
  with `aria-label` containing the item id. Tab escapes without trap.
- **A11Y-3**: Focused trigger shows non-empty `box-shadow` (the `--focus-ring` token).
  `aria-expanded` flips `false` → `true` on click → `false` on Esc.
- **A11Y-4**: Trigger bounding box ≥ 24×24 CSS px. Each of the 4 menuitem boxes ≥ 24px
  height and width.
- **A11Y-5**: `aria-haspopup="menu"`, `aria-label="Steer REQ-OBSERVATORY…"` on trigger;
  `role="menu"` with `aria-label="Steer actions"` on popover; `aria-controls` links
  trigger to menu; 4 `role="menuitem"` with exact label text. Zero axe violations on the
  open steer menu.
- **A11Y-6**: Under `prefers-reduced-motion: reduce`, `animationName=none` or
  `animationDuration=0s` on the open menu element.
- **A11Y-7**: `rowsWithWrongCount=0` (every `role="treeitem"` has exactly 1 steer-btn);
  `inHeadings=0`; `inMoreChip=0`; `outsideItemBearing=0`.

### GEO geometry / no-reflow conditions

- **GEO-S014-1**: `treeRow`, `treeRegion`, `pageScroll`, `mainScroll`, `railScroll` all
  byte-identical snapshot-closed vs snapshot-open. Snapshot taken after focus-scroll
  settles but before Enter opens the menu (post-focus/pre-Enter methodology).
- **GEO-S014-2**: `documentElement.scrollHeight`, `mainScroll`, `railScroll` identical —
  the menu adds zero block height to the flow.
- **GEO-S014-3**: `getComputedStyle(steer-menu).position === 'fixed'` (fixture spec,
  chip test). The popover is portalled to `document.body`.
- **GEO-S014-4**: Menu bounding box: x ≥ 0, y ≥ 0, x+w ≤ innerWidth. Fully on-screen.

### STEER-FIG-1..2

- **STEER-FIG-1**: Every trigger `aria-label` starts with `"Steer "`, contains the item's
  `data-steer-item-id`, has no `row:\d+` or bare numeric id.
- **STEER-FIG-2**: Visible text of each menuitem ≠ its `data-action` value (e.g. visible
  "Raise defect" ≠ `"raise-defect"`). All 4 labels confirmed as human phrases.

### Tree drill non-regression

Steer button click opens the menu WITHOUT triggering detail-pane drill. Row click (on
`.tree-node__row`) still opens the detail pane as expected (UC-S005-3 preserved).

---

## Process notes

**Tooling finding (advisory)**: `make impacted-tests SINCE=f7b9489` reports 33 uncovered
changed nodes because the spec uses `@covers uc-s014-1` (full name) while the tool
matches short IDs (`S14UC1`). The coverage IS provided by the committed specs. Node-ID
naming inconsistency between `use-case-deps.mmd` short IDs and spec `@covers` tags
should be resolved in a tooling improvement slice.

**Spec authoring this run**: `e2e/steer-menu-real-data.spec.js` was authored during this
validation (process v23 §33 tooling self-service). It uses `REQ-OBSERVATORY` as the
stable real-data anchor. Relevancy: `pinned` — update if the root requirement changes.

**GEO snapshot methodology finding**: the fixture GEO spec takes the closed snapshot
before focus(), which works only because the fixture's tree item is already in the
viewport. For real-data trees where the item requires scroll-into-view on focus, the
correct methodology is post-focus/pre-Enter. The new real-data spec uses the correct
approach. The fixture spec is still correct for its use case.
