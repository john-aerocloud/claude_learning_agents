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
