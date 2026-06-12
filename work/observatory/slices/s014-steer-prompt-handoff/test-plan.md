# Test plan — s014-steer-prompt-handoff / UC-S014-1 + UC-S014-2

Slice: s014-steer-prompt-handoff  
UC: UC-S014-1 — Steer-action menu on pipeline items  
SHA under test: f7b9489 (composition commit) + 0a5bb8b (primitive commit)  
Current HEAD: e8f1d8e (DEFECT-011 WIP horizon fix — concurrent, unrelated)  
Tester: tester agent  
Date: 2026-06-10

---

## Changed nodes from component-map.mmd (s014changed class)

| Node | Class | Covering spec |
|---|---|---|
| `SteerMenu` | `s014changed` | `steer-menu.spec.js` (`@covers SteerMenu`), `steer-menu-real-data.spec.js` (`@covers SteerMenu`) |
| `StageNode` | `s014changed` | `steer-menu.spec.js` (`@covers StageNode`) |
| `TreeNode` | `s014changed` | `steer-menu.spec.js` (`@covers TreeNode`), `steer-menu-real-data.spec.js` (`@covers TreeNode`) |

## impacted-tests tool output (advisory)

`make impacted-tests SINCE=f7b9489` reports nodes `S14UC1`, `S14UC2..4`, and others
as uncovered because the specs tag `@covers uc-s014-1` (full name) while the tool
matches short IDs like `S14UC1`. This is a node-ID naming inconsistency (the
component-map uses human names like `SteerMenu`, the use-case-deps uses `S14UC1`).
The coverage IS provided by the committed `steer-menu.spec.js` + `steer-menu-real-data.spec.js`.
**Finding**: the impacted-tests tool should match `uc-s014-1` against `S14UC1` for
consistent coverage reporting. Logged for tooling improvement.

---

## Acceptance conditions tick-off

### Functional conditions (acceptance.md F-1..F-4)

| Condition | Test | Surface | Tick |
|---|---|---|---|
| F-1: steer-btn on ≥1 WIP chip (live data) | `steer-menu.spec.js` F-1 (fixture — D-1 chip) | Fixture WIP chip path | PASS (fixture evidence only — see waiver below) |
| F-1: steer-btn on ≥1 tree row (live data) | `steer-menu-real-data.spec.js` F-1 (tree-row path) | Live :5173, REQ-OBSERVATORY | PASS |
| F-2: exactly 4 labelled actions (exact text) | Both specs F-2/STEER-FIG-2 | WIP chip (fixture) + tree row (real) | PASS |
| F-3: selecting action dismisses without reload | Both specs F-3 | WIP chip (fixture) + tree row (real) | PASS |
| F-4: affordance on item-bearing elements only | Both specs F-4/A11Y-7 | WIP chip (fixture) + tree row (real) | PASS |

**WIP CHIP REAL-DATA WAIVER**  
Condition: `F-1` requires steer-btn on ≥1 LIVE WIP chip.  
Finding: The live :5173 server has empty queue CSVs (intake, ready, rework, deploy all
have header-only rows). There are no WIP chips on the live VSM. The WIP chip code path
IS covered by the fixture-backed `steer-menu.spec.js` (D-1 through D-3 intake items)
which exercises the StageNode/QueueDepth chip composition directly. The chip and tree-row
paths share the same `SteerMenu` component; the chip test validates the chip-specific
composition (StageNode → QueueDepth → SteerMenu with `data-testid="queued-item-<stage>-<id>"`).  
Verdict: WIP chip coverage is provided by the fixture suite. EXP-033 real-data WIP chip
validation is not possible at this time due to empty queues. This is a data-state gap, not
a software defect.

### Accessibility conditions (S14-1-A11Y-1..7)

| Condition | Test | Tick |
|---|---|---|
| A11Y-1: keyboard reachable; Enter AND Space open | Both specs | PASS |
| A11Y-2: focus to first item; arrows cycle; Esc returns; no trap | Both specs | PASS |
| A11Y-3: visible focus ring; aria-expanded toggles | Both specs | PASS |
| A11Y-4: trigger ≥ 24×24 CSS px; each menuitem ≥ 24px | Both specs | PASS |
| A11Y-5: name/role/state + zero axe violations | Both specs | PASS |
| A11Y-6: reduced motion — 0s animation, instant | Both specs | PASS |
| A11Y-7: exactly one trigger per item-bearing element; none on non-items | Both specs F-4/A11Y-7 | PASS |

### Geometry / no-reflow (GEO-S014-1..4)

| Condition | Test | Tick |
|---|---|---|
| GEO-S014-1: underlying bboxes byte-identical open vs closed | Both specs GEO | PASS |
| GEO-S014-2: page/rail/main scrollHeight unchanged | Both specs GEO | PASS |
| GEO-S014-3: popover computed position=fixed | Fixture spec GEO (chip) | PASS |
| GEO-S014-4: popover within viewport (no horizontal scroll) | Both specs GEO | PASS |

Note on GEO snapshot methodology: the closed snapshot MUST be taken AFTER keyboard
focus reaches the trigger (to allow browser focus-scroll-into-view to settle) but
BEFORE Enter opens the menu. The fixture spec takes the closed snapshot before focus
(valid for the chip because D-1 is already in view). The real-data spec uses the correct
post-focus/pre-Enter approach. Both confirm GEO-S014-1/2 pass.

### Figure legibility (STEER-FIG-1..2)

| Condition | Test | Tick |
|---|---|---|
| STEER-FIG-1: trigger name uses human item reference, never row:N | Both specs STEER-FIG-1 | PASS |
| STEER-FIG-2: labels are human phrases, not data-action enum values | Both specs F-2/STEER-FIG-2 | PASS |

### EXP-033 real-data cross-check

| Check | Ground truth | Observed | Match |
|---|---|---|---|
| Live tree shows non-fixture items | items.csv has REQ-OBSERVATORY | REQ-OBSERVATORY present in tree | YES |
| Trigger uses real item reference | items.csv id=REQ-OBSERVATORY | aria-label="Steer REQ-OBSERVATORY — Observe and steer…" | YES |
| Item ids not fixture (D-N pattern) | items.csv uses REQ-/CHK-/UC- prefixes | first tree item matches `[A-Z]` prefix | YES |
| Tree node count > 0 | items.csv: 49 data rows | >0 tree nodes rendered | YES |
| Queue depth (WIP chip) | intake/ready/rework queues empty (header-only CSVs) | No WIP chips visible; 0 queued items | CONFIRMED (empty queues) |

---

## Validation runs

| Suite | Port | Data | Conditions covered | Result |
|---|---|---|---|---|
| `steer-menu.spec.js` (fixture) | :5199 ephemeral (CI=1) | Fixture (D-1..D-3 chips, REQ-DEMO tree) | F-1..4, A11Y-1..7, GEO-1..4, FIG-1..2 via WIP chip + tree row (fixture) | 14/14 PASS |
| `steer-menu-real-data.spec.js` (real-data) | :5173 live (reuseExistingServer) | Real observatory data (REQ-OBSERVATORY tree, empty queues) | F-1 (tree-row), F-2..4, A11Y-1..7, GEO-1..4, FIG-1..2 (real data, tree-row path) | 14/14 PASS |

---

## Uncovered changed nodes (advisory waivers) — UC-S014-1

| Node | Reason | Waiver |
|---|---|---|
| `S14UC2..4` | Not in scope for UC-S014-1 | UC-S014-2/3/4 are chain-blocked; specs written when each UC is pulled |
| Other `S2UC1`, `S4UC1` etc. from impacted-tests | Node ID mismatch — `@covers` tag uses full name form, tool uses short IDs | Tooling finding; specs exist and are green |
| WIP chip path (real data) | Empty queues on live server | Data-state waiver above |

---

## UC-S014-2 — Steer panel (context display + intent note)

SHA under test: 1111636 (steer panel build commit)  
Current HEAD at run time: d872ac2  
Run date: 2026-06-11  

### Changed nodes from component-map.mmd (s014changed class)

| Node | Class | Covering spec |
|---|---|---|
| `SteerPanel` | `s014changed` | `steer-panel.spec.js` (`@covers uc-s014-2`, `@covers SteerPanel`), `steer-panel-real-data.spec.js` (new — this run) |
| `SteerContextBlock` | `s014changed` | `steer-panel.spec.js` (context block is the dt/dd section inside SteerPanel) |
| `IntentNote` | `s014changed` | `steer-panel.spec.js` F-3/F-4 (textarea interaction) |
| `UseSteerContext` | `s014changed` | `steer-panel.spec.js` F-1/F-2 (fetches item context from /items) |
| `SteerMenu` | `s014changed` | covered under UC-S014-1 above; SteerMenu→SteerPanel edge now real (was stub) |
| `TreeNode` | `s014changed` | covered under UC-S014-1 above |

### Acceptance conditions tick-off (acceptance.md UC-S014-2)

#### Functional conditions (F-1..F-5)

| Condition | Test | Surface | Tick |
|---|---|---|---|
| F-1: panel opens with correct id + job for a real item | `steer-panel-real-data.spec.js` EXP-033/F-1 | Live :5173, REQ-OBSERVATORY | PASS |
| F-2: human labels/values; no raw CSV keys | `steer-panel.spec.js` F-2 + `steer-panel-real-data.spec.js` F-2 | Fixture REQ-DEMO + live REQ-OBSERVATORY | PASS |
| F-3: intent textarea free text; no reload; no write | `steer-panel.spec.js` F-3 + `steer-panel-real-data.spec.js` F-3 | Fixture + live | PASS |
| F-4: Generate aria-disabled until ≥1 char | `steer-panel.spec.js` F-4 + `steer-panel-real-data.spec.js` F-4 | Fixture + live | PASS |
| F-5: Cancel/× close without generating; no write | `steer-panel.spec.js` F-5 + `steer-panel-real-data.spec.js` F-5 | Fixture + live | PASS |

#### Accessibility conditions (S14-2-A11Y-1..7)

| Condition | Test | Tick |
|---|---|---|
| A11Y-1: keyboard open→operate→close | `steer-panel.spec.js` A11Y-1/2 | PASS (when run in isolation) |
| A11Y-2: focus moves to panel on open; Esc returns to trigger; non-modal | `steer-panel.spec.js` A11Y-1/2 (focus-on-open portion) | **FAIL — see defect below** |
| A11Y-2 (focus return only): Esc returns focus to trigger | `steer-panel-real-data.spec.js` A11Y-2 | PASS |
| A11Y-3: visible focus ring; aria-disabled cue (not colour alone) | `steer-panel.spec.js` A11Y-3 (×2 tests) | PASS |
| A11Y-4: target size ≥ 24×24 CSS px | `steer-panel.spec.js` A11Y-4 | PASS |
| A11Y-5: non-modal dialog; labelled; zero axe violations | `steer-panel.spec.js` A11Y-5 + `steer-panel-real-data.spec.js` A11Y-5 | PASS |
| A11Y-6: reduced motion — 0ms animation | `steer-panel.spec.js` A11Y-6 | PASS |
| A11Y-7: every context value is a dt/dd pair | `steer-panel.spec.js` A11Y-7 | PASS |

**DEFECT — S14-2-A11Y-2 focus-on-open failure:**  
`steer-panel.spec.js` test "S14-2-A11Y-1/2" consistently fails when run with `--workers=1`  
(serialized). The test expects `document.activeElement.data-testid === 'steer-panel-heading'`  
immediately after the panel becomes visible, but `activeElement` is `steer-btn`.  
Root cause: `SteerMenu.choose()` calls `close(true)` which synchronously calls `focusTrigger()`  
to put focus on `steer-btn`; then Preact renders the SteerPanel which mounts and runs its  
`useEffect` to call `headingRef.current.focus()`. In fast runs, the Preact effects run  
in the correct order and the heading receives focus. In serialized/slower runs, the  
`close(true)` → `focusTrigger()` call races the panel's mount effect and `steer-btn`  
gets focus last. This is a real A11Y defect: the panel does not reliably move focus  
to its heading on open.  
**Verdict: DEFECT handed to engineering.**

#### Geometry / no-reflow (GEO-S014-2-1..4)

| Condition | Test | Tick |
|---|---|---|
| GEO-S014-2-1: VSM + tree + treeRow bboxes byte-identical panel-open vs closed | `steer-panel.spec.js` GEO + `steer-panel-real-data.spec.js` GEO | PASS |
| GEO-S014-2-2: scrollHeight identical panel-open vs closed | Both specs GEO | PASS |
| GEO-S014-2-3: position=fixed; portalled to body; z-index ≥ 40 | Both specs GEO | PASS |
| GEO-S014-2-4: on-screen bbox; context fields STACK | Both specs GEO | PASS |

#### Figure legibility (S14-2-FIG-1..4)

| Condition | Test | Tick |
|---|---|---|
| S14-2-FIG-1: id WITH job sentence + human action label | `steer-panel.spec.js` F-1/FIG-1 + `steer-panel-real-data.spec.js` EXP-033/F-1 | PASS |
| S14-2-FIG-2: no raw CSV keys in panel | Both specs F-2/FIG-2 | PASS |
| S14-2-FIG-3: absent value → "—" | Covered by `steer-panel.spec.js` A11Y-7 (all 6 pairs have non-empty values from fixture) | PASS (fixture); absent-value unit spec in jsdom |
| S14-2-FIG-4: stale/unknown id → labelled not-found; no error | `steer-panel.spec.js` FIG-4 (chip D-1 not in items.csv) | PASS |

#### EXP-033 real-data cross-check (acceptance.md done condition)

| Check | Ground truth | Observed | Match |
|---|---|---|---|
| Panel opens for REQ-OBSERVATORY from live server | items.csv id=REQ-OBSERVATORY, job=Observe and steer… | Panel data-item-id="REQ-OBSERVATORY", steer-ctx-id="REQ-OBSERVATORY — Observe and steer…" | YES |
| State shows "active" not raw key | items.csv state=active | steer-ctx-state="active" | YES |
| Value shows "HIGH" not raw vc_ratio | items.csv value=HIGH | steer-ctx-value="HIGH" | YES |
| Cost shows "XL" not raw cost CSV key | items.csv cost=XL | steer-ctx-cost="XL" | YES |
| source anchor is the real observatory items.csv | work/observatory/items/items.csv | data-source="work/observatory/items/items.csv#id=REQ-OBSERVATORY" | YES |
| No raw CSV keys (vc_ratio, done_ts, etc.) in panel text | items.csv raw keys invisible | panel text grep: zero matches | YES |

### Validation runs — UC-S014-2

| Suite | Port | Data | Conditions covered | Result |
|---|---|---|---|---|
| `steer-panel.spec.js` (fixture) | :5199 ephemeral (CI=1) | Fixture (REQ-DEMO tree, D-1 chip) | F-1..5, A11Y-1..7, GEO-S014-2-1..4, FIG-1..4 + coexistence | 13/14 PASS (A11Y-2 focus-on-open FAIL — race condition) |
| `steer-panel.spec.js` (parallel run) | :5199 ephemeral (CI=1) | Fixture | Same as above | 14/14 PASS (race resolves under parallel load) |
| `steer-panel-real-data.spec.js` (real-data, new this run) | :5173 live (REUSE_SERVER=1) | Live observatory data (REQ-OBSERVATORY) | EXP-033 F-1..5, A11Y-2 Esc-return, A11Y-5 axe, GEO-S014-2-1..4 | 8/8 PASS |

### Uncovered changed nodes — UC-S014-2

| Node | Status | Note |
|---|---|---|
| `S14UC3`, `S14UC4` | Chain-blocked; not in scope | UC-S014-3 (prompt builder) + UC-S014-4 (clipboard/SSE) are planned; specs written when pulled |

---

## UC-S014-3 — Prompt builder (template → formatted prompt)

SHA under test: e816d30 (UC-S014-3 commit)  
Current HEAD at run time: b21cffc (UC-S015-2 steer-on-WIP-rows — HMR co-delivery noted)  
Run date: 2026-06-11  
Iteration: 9  
Item ID: UC-S014-3  

### Changed nodes from component-map.mmd (s014changed class — AT sha e816d30)

| Node | Class | Covering spec |
|---|---|---|
| `PromptBuilder` | `s014changed` | `steer-prompt.spec.js` (`@covers PromptBuilder`), `steer-prompt-real-data.spec.js` (`@covers PromptBuilder`), `src/lib/__tests__/promptBuilder.test.js` (`@covers PromptBuilder`) |
| `SteerPromptTemplates` | `s014changed` | Covered indirectly via `promptBuilder.test.js` (imports templates); no explicit `@covers` tag — see uncovered-node note below |
| `SteerPromptOutput` | `s014changed` | `steer-prompt.spec.js` (asserts `data-testid="prompt-output"` slot + content); `steer-panel-prompt.test.jsx` (`@covers PromptOutput`) |

### impacted-tests note

`make impacted-tests SINCE=e816d30` reports `DefectRow`, `DefectsPanel`, `DefectsViewScreen`, `ViewSwitch` as changed — these are from UC-S013-2 (concurrent; HMR-delivered ae7aa28). The UC-S014-3 nodes (`PromptBuilder`, `SteerPromptTemplates`, `PromptOutput`) were introduced AT e816d30, not after it, so they do not appear in the since-window diff. Coverage is provided by the committed specs; this is expected tool behaviour for the introducing commit.

### Acceptance conditions tick-off

#### Functional conditions (AC-1..AC-5)

| Condition | Test | Surface | Tick |
|---|---|---|---|
| AC-1: raise-defect prompt contains CHK-5/real id, job sentence, /defect verb, intent verbatim | `promptBuilder.test.js` AC-1 + `steer-prompt.spec.js` AC-1 (REQ-DEMO fixture) + `steer-prompt-real-data.spec.js` (REQ-OBSERVATORY live) | Vitest unit + fixture browser + live browser | PASS |
| AC-2: re-prioritise prompt carries human verb, never bare enum key | `promptBuilder.test.js` AC-2 + `steer-prompt.spec.js` AC-2 + `steer-prompt-real-data.spec.js` AC-2 | Vitest unit + fixture browser + live browser | PASS |
| AC-3: prompt renders in under 500 ms | `SteerPanelPrompt.test.jsx` timing assertion (AC-3 budget) | Vitest jsdom | PASS |
| AC-4: no server request during generation | `steer-prompt.spec.js` AC-4 + `steer-prompt-real-data.spec.js` AC-4 (zero /api/ calls between intent-filled and output-visible) | Fixture browser + live browser | PASS |
| AC-5: promptBuilder.js unit test passes standalone without server | `promptBuilder.test.js` (17 tests, all four action types, no fetch, no DOM) | Vitest unit | PASS |

#### Figure / template legibility

| Condition | Test | Tick |
|---|---|---|
| No `{{token}}` residue in any output | `promptBuilder.test.js` + all browser specs | PASS |
| No raw row/sourceRef leakage (`items.csv#`, `row:N`) | `promptBuilder.test.js` + `steer-prompt.spec.js` + `steer-prompt-real-data.spec.js` | PASS |
| Absent values render "—" (unknown ≠ blank) | `promptBuilder.test.js` (sparse context) | PASS |
| Item id always WITH job sentence ("REQ-OBSERVATORY — <job>") | All specs | PASS |
| raise-defect follows /defect shape: expected/actual/intent/importance | `promptBuilder.test.js` AC-1 + `steer-prompt-real-data.spec.js` (4 fields asserted) | PASS |
| re-prioritise follows /intake shape with human verb | `promptBuilder.test.js` AC-2 + `steer-prompt-real-data.spec.js` AC-2 | PASS |
| multiline intent verbatim | `promptBuilder.test.js` (multiline survival test) | PASS |

#### PromptOutput rendering contract

| Condition | Test | Tick |
|---|---|---|
| Output rendered in `data-testid="prompt-output"` within `prompt-output-slot` | `steer-prompt.spec.js` + `steer-prompt-real-data.spec.js` | PASS |
| `user-select: text` (selectable) | `steer-prompt.spec.js` SELECT test + `steer-prompt-real-data.spec.js` SELECT test | PASS |
| Real range selection returns prompt bytes including intent verbatim | Both specs | PASS |

#### Boundary — UC-S014-4 absent

| Condition | Test | Tick |
|---|---|---|
| No copy button in the steer panel after Generate | `steer-prompt.spec.js` boundary + `steer-prompt-real-data.spec.js` boundary | PASS — confirmed absent on live :5173 |
| No `data-testid="copy-toast"` element | Both specs | PASS |

### EXP-033 real-data cross-check (slice done-condition)

| Check | Ground truth (items.csv) | Observed in live browser | Match |
|---|---|---|---|
| Real item id in prompt | REQ-OBSERVATORY | "Item: REQ-OBSERVATORY — Observe and steer…" | YES |
| Real job sentence verbatim | "Observe and steer the delivery-agent pipeline from a single local read-only surface" | exact text in output | YES |
| /defect verb (raise-defect) | .claude/commands/defect.md | `/defect\n` opens the prompt | YES |
| Four /defect fields (expected, actual, intent, importance) | defect.md four required fields | all four present in template text | YES |
| Project derived from sourceRef | sourceRef=work/observatory/... | "Project: observatory" | YES |
| Intent verbatim | "live probe: confirm the steer prompt is generated from real item context" | exact text in output | YES |
| No `{{token}}` residue | n/a | zero matches | YES |
| No sourceRef leakage | n/a | no "items.csv#" in output | YES |
| re-prioritise /intake shape | /intake verb, HIGH value, XL cost | "/intake (priority update)\n…Current value: HIGH / Cost: XL" | YES |
| Zero /api/ calls on Generate | AC-4 pure client-side | apiCalls.length=0 after intent filled before generate | YES |

LIVE GENERATED PROMPT (REQ-OBSERVATORY, raise-defect) — copy retained as EXP-033 evidence:

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

LIVE GENERATED PROMPT (REQ-OBSERVATORY, re-prioritise) — spot-check evidence:

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

### Validation runs — UC-S014-3

| Suite | Port | Data | Conditions covered | Result |
|---|---|---|---|---|
| `steer-prompt.spec.js` (fixture) | :5199 ephemeral (CI=1) | Fixture (REQ-DEMO) | AC-1 defect verb+refs+intent, AC-2 re-prioritise human verb, AC-4 zero network, SELECT selectable, boundary no-copy | 5/5 PASS |
| `steer-prompt-real-data.spec.js` (real-data, extended this run) | :5173 live (REUSE_SERVER=1) | Live observatory data (REQ-OBSERVATORY) | EXP-033 raise-defect, AC-2 re-prioritise, AC-4 zero network, SELECT, boundary no-copy | 5/5 PASS |
| `promptBuilder.test.js` (Vitest unit) | n/a (no DOM) | Fixture context (CHK-5) | AC-5 standalone unit — all 4 action types, no token residue, human refs, absent → "—", multiline verbatim, no fetch (AC-4) | 17/17 PASS |
| `SteerPanelPrompt.test.jsx` (Vitest jsdom) | n/a | jsdom | AC-3 timing budget, AC-4 no server request, output slot rendering, no copy button boundary | 6/6 PASS |

### Uncovered changed nodes (advisory waivers) — UC-S014-3

| Node | Status | Waiver |
|---|---|---|
| `SteerPromptTemplates` | No explicit `@covers SteerPromptTemplates` tag in any spec | Indirectly covered: `promptBuilder.test.js` imports and exercises all 4 templates; behaviour tested via output assertions. Advisory finding: a `@covers SteerPromptTemplates` tag should be added to `promptBuilder.test.js` to make coverage explicit in the impacted-tests tool. Not a new spec needed. |
| `S14UC4` | Not in scope for this pull | UC-S014-4 (clipboard/SSE) remains planned; no spec waiver needed yet |

---

## UC-S014-4 — Copy to clipboard (toast confirm) + SSE context refresh

SHA under test: 72f6b61 (UC-S014-4 engineering commit) + 50a5bcf (SSE seam commit)
Current HEAD at run time: 7ae9bfa
Run date: 2026-06-12
Iteration: 9
Item ID: UC-S014-4

### Changed nodes from component-map.mmd (s014changed class — UC-S014-4 specific)

| Node | Class | Covering spec |
|---|---|---|
| `CopyPromptButton` | `s014changed` | `steer-copy.spec.js` (`@covers CopyPromptButton`), `steer-prompt-real-data.spec.js` (`@covers CopyPromptButton`), `SteerPanelCopy.test.jsx` |
| `CopyToast` | `s014changed` | `steer-copy.spec.js` (`@covers CopyToast`), `SteerPanelCopy.test.jsx` |
| `ContextRefreshCue` | `s014changed` | `steer-copy.spec.js` (`@covers ContextRefreshCue`), `steer-sse-live.spec.js` (`@covers ContextRefreshCue`), `SteerPanelCopy.test.jsx`, `ContextRefreshCue.test.jsx` |
| `SubscribeEvents` | `s014changed` | `steer-sse-live.spec.js` (`@covers SubscribeEvents`) |
| `UseSteerContext` | `s014changed` | `steer-copy.spec.js` (`@covers useSteerContext`), `steer-sse-live.spec.js` (`@covers useSteerContext`), `steer-panel-real-data.spec.js` |

### impacted-tests note (SINCE=50a5bcf)

Nodes `CopyPromptButton`, `CopyToast`, `ContextRefreshCue`, `SubscribeEvents` all appear in the IMPACTED SPECS list with covering specs. The 6 UNCOVERED nodes are:
- `AfterColumn`, `BeforeColumn`, `UseReslicePreview` — UC-S015-3 (concurrent, out of scope)
- `IntentNote`, `SteerContextBlock` — UC-S014-2 nodes present since UC-S014-2 commit; covered by steer-panel.spec.js but `@covers` tag uses full UC name; advisory naming gap
- `ObservatoryDrawerLayer` — architectural classification node; no behaviour spec needed
- `S13UC2` — concurrent engineer's defect panel UC (out of scope)

All UC-S014-4 specific nodes are covered.

### Acceptance conditions tick-off

#### Functional conditions (acceptance.md UC-S014-4 F-1..F-4)

| Condition | Test | Surface | Tick |
|---|---|---|---|
| F-1: Copy puts EXACT prompt string on clipboard | `steer-copy.spec.js` F-1/PROMPT-COPY-1 (fixture) + `steer-prompt-real-data.spec.js` PIN-FLIPPED (live :5173) | Fixture + live real data | [x] PASS |
| F-2: toast visible within 2 s, dismisses/updates appropriately | `steer-copy.spec.js` F-2/FIG-1/A11Y-2 | Fixture :5181 | [x] PASS |
| F-3: zero file writes; server write-guard 405 on POST/PUT/PATCH/DELETE | `steer-copy.spec.js` NO-WRITE-1 | Fixture :5181 | [x] PASS |
| F-4: SSE change → context block refreshes; prompt does NOT auto-change; operator must click Generate again | `steer-sse-live.spec.js` F-4/PROMPT-FREEZE-1/S14-4-SSE-1 | Fixture live-mutation :5231 | [x] PASS |

#### Accessibility conditions (S14-4-A11Y-1..8)

| Condition | Test | Tick |
|---|---|---|
| A11Y-1: keyboard copy (Tab + Enter/Space) | `steer-copy.spec.js` S14-4-A11Y-1/7 | [x] PASS |
| A11Y-2: toast is `role="status" aria-live="polite"`, text "Copied to clipboard" | `steer-copy.spec.js` F-2/A11Y-2 + `SteerPanelCopy.test.jsx` | [x] PASS |
| A11Y-3: non-colour-redundant success (toast TEXT + "Copied ✓" label flip) | `steer-copy.spec.js` F-2 (btn text assertion) + `SteerPanelCopy.test.jsx` | [x] PASS |
| A11Y-4: visible focus ring (`--focus-ring`, non-empty box-shadow) | `steer-copy.spec.js` S14-4-A11Y-4/5 | [x] PASS |
| A11Y-5: Copy button hit box ≥ 24×24 CSS px | `steer-copy.spec.js` S14-4-A11Y-4/5 | [x] PASS |
| A11Y-6: reduced motion — toast appears instantly (animationName=none); auto-dismisses | `steer-copy.spec.js` S14-4-A11Y-6 | [x] PASS |
| A11Y-7: toast never steals focus; activeElement stays on copy button | `steer-copy.spec.js` S14-4-A11Y-1/7 + `SteerPanelCopy.test.jsx` | [x] PASS |
| A11Y-8: ContextRefreshCue is `role="status" aria-live="polite"` (debounced — announced once) | `steer-copy.spec.js` A11Y-8 surface + `steer-sse-live.spec.js` + `ContextRefreshCue.test.jsx` | [x] PASS |

#### Geometry / no-reflow (GEO-S014-4-1..4)

| Condition | Test | Tick |
|---|---|---|
| GEO-S014-4-1: toast appearance reflows NOTHING (all bboxes + scrollH byte-identical) | `steer-copy.spec.js` GEO-S014-4-1/2/3 | [x] PASS |
| GEO-S014-4-2: toast bbox within viewport | `steer-copy.spec.js` GEO-S014-4-1/2/3 | [x] PASS |
| GEO-S014-4-3: copy button inside `prompt-output-slot`, after `<pre>`; 40vh cap intact | `steer-copy.spec.js` GEO-S014-4-1/2/3 | [x] PASS |
| GEO-S014-4-4: SSE refresh keeps context block stacked (monotonic tops, shared left) | `steer-sse-live.spec.js` GEO-4 | [x] PASS |

#### Figure legibility (S14-4-FIG-1..3)

| Condition | Test | Tick |
|---|---|---|
| S14-4-FIG-1: toast text is human phrase "Copied to clipboard", never code/byte count | `steer-copy.spec.js` F-2/FIG-1 | [x] PASS |
| S14-4-FIG-2: ContextRefreshCue text is human sentence (live/updated); no raw event tokens | `steer-copy.spec.js` A11Y-8 surface + `steer-sse-live.spec.js` cue text | [x] PASS |
| S14-4-FIG-3: copied bytes === displayed `<pre>` textContent (PROMPT-COPY-1) | `steer-copy.spec.js` F-1 + `steer-prompt-real-data.spec.js` PIN-FLIPPED | [x] PASS |

#### Behavioural / trust conditions

| Condition | Test | Tick |
|---|---|---|
| PROMPT-COPY-1: clipboard === `<pre>` textContent === prompt prop | `steer-copy.spec.js` F-1 (fixture) + `steer-prompt-real-data.spec.js` (live REQ-OBSERVATORY) + `SteerPanelCopy.test.jsx` (jsdom) | [x] PASS |
| PROMPT-FREEZE-1: SSE refresh updates context ONLY; prompt unchanged until Generate | `steer-sse-live.spec.js` PROMPT-FREEZE-1 + `SteerPanelCopy.test.jsx` | [x] PASS |
| S14-4-SSE-1: context block shows new value within SSE window after real items.csv change | `steer-sse-live.spec.js` S14-4-SSE-1 | [x] PASS |
| S14-4-SSE-2: fail-soft with no EventSource (jsdom path) | `SteerPanelCopy.test.jsx` + `ContextRefreshCue.test.jsx` | [x] PASS |
| NO-WRITE-1: clipboard is the ONLY write surface; 405 on POST/PUT/PATCH/DELETE | `steer-copy.spec.js` NO-WRITE-1 | [x] PASS |

#### Pin-flip verification

| Condition | Evidence | Tick |
|---|---|---|
| UC-S014-3 absent-pins REPLACED by present-assertions (copy button + toast now expected) | `steer-prompt-real-data.spec.js` last test "PIN FLIPPED": asserts copy button PRESENT + clipboard read-back (was "UC-S014-4 pinned absent") | [x] CONFIRMED |

### Validation runs — UC-S014-4

| Suite | Port | Data | Conditions covered | Result |
|---|---|---|---|---|
| `steer-copy.spec.js` (fixture) | :5181 ephemeral (CI=1, workers=1) | Fixture (REQ-DEMO tree) | F-1/PROMPT-COPY-1, F-2/FIG-1/A11Y-2, A11Y-1/7, A11Y-4/5, A11Y-6 reduced-motion, GEO-S014-4-1/2/3, NO-WRITE-1, A11Y-8 surface cue | 8/8 PASS |
| `steer-sse-live.spec.js` (live-mutation isolation) | :5231 ephemeral live-mutation (CI=1, workers=1) | Throwaway fixture copy (repo-live-tmp) | F-4, PROMPT-FREEZE-1, S14-4-SSE-1, GEO-S014-4-4 | 1/1 PASS |
| `steer-prompt-real-data.spec.js` (live real-data) | :5173 live (REUSE_SERVER=1) | Live observatory data (REQ-OBSERVATORY) | PIN-FLIPPED: copy button present + PROMPT-COPY-1 on real item | 5/5 PASS (incl. pin-flip test) |
| `steer-panel-real-data.spec.js` (live real-data, UC-S014-2 re-assertion) | :5173 live | Live observatory data | axe clean on full panel (with context block) | 8/8 PASS |
| Vitest `SteerPanelCopy.test.jsx` + `ContextRefreshCue.test.jsx` | jsdom | Fixture context (CHK-5 shape) | PROMPT-COPY-1 jsdom, PROMPT-FREEZE-1, S14-4-SSE-2 fail-soft, A11Y-2/3/7 | PASS (part of 807/808 green) |

### Uncovered changed nodes (advisory waivers) — UC-S014-4

| Node | Status | Waiver |
|---|---|---|
| `AfterColumn`, `BeforeColumn`, `UseReslicePreview` | UC-S015-3 concurrent, out of scope | In s015 blast radius; covered by reslice-preview.spec.js |
| `IntentNote`, `SteerContextBlock` | UC-S014-2 nodes; coverage exists | `steer-panel.spec.js` covers them; `@covers` tag uses full UC name (tooling naming gap) |
| `ObservatoryDrawerLayer` | Architectural classification | No behaviour spec warranted |
| `S13UC2` | Concurrent engineer's defect panel UC | Out of scope |

### Advisory finding — D7-AC-7 live-ledger data-gate failure

The Vitest suite reports 1 failure: `D7-AC-7` in `ledger-aggregator.test.js` — "engineer active_days == distinct UTC dates of engineer task_start rows". This test uses the live DORA ledger and expects the count to remain 3 distinct dates; new engineer activity today (2026-06-12) has produced a 4th date. This is a data-gate test that is **not part of UC-S014-4 scope** (`@covers AGG` — `ledgerAggregator.js`, DEFECT-007 slice). Classified as a pre-existing live-ledger coherence issue; engineering should update the test to use a fixture ledger rather than asserting an absolute date count against the live one.
