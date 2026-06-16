# Result — UC-S018-1 (intake wizard shell + JTBD capture)

Verdict: PASS
SHA under test: ed7848c (rework — A11Y-S018-1-12 contrast fix)
Iteration: 9
Surface exercised: Observatory SPA at http://localhost:5173 (fixture-backed ephemeral :5299 + live :5173 real-data)
Run date: 2026-06-13

---

## What was validated

### Re-validation scope

The prior FAIL verdict (2026-06-12, sha 6659ac8) was a single defect:
A11Y-S018-1-12 — WizardStepIndicator planned-step labels at 2.87:1 contrast.

Root cause (engineering confirmed): compounded opacity — `opacity: 0.85` on
`.wizard-step--planned` multiplied by the drawer slide-in fade (opacity 0→1) —
gave axe a mid-animation effective opacity of ~0.077 on `--c-text-dim` (#a6adbb),
computing to an apparent foreground of #626670 on #1b1f26 = 2.87:1.

Fix (sha ed7848c): both alpha layers removed.
- `.wizard-step--planned` now uses `color: var(--c-text-dim)` at full opacity
  (--c-text-dim = #a6adbb, 6.7:1 on --c-surface-raised = #222630 — AA with margin).
- Drawer slide-in keyframe is transform-only (translateX 16px → 0); no opacity property.
- Three new assertions pinned in `e2e/intake-wizard-a11y.spec.js`:
  (a) cumulative opacity on planned-step labels = 1;
  (b) computed contrast ratio ≥ 4.5:1 on steps 2/3/4 label + ".wizard-step__soon";
  (c) `intake-wizard-*` keyframes contain no opacity property.

---

### Suite results — ALL PASS

**A11Y spec: `e2e/intake-wizard-a11y.spec.js` — 6/6 PASS (3 independent runs)**

Run 1 (ephemeral :5299, fixture repo):
- A11Y-S018-1-12 axe broad (color-contrast + heading-order + single-h1 + wizard h2): PASS
- A11Y-S018-1-12 targeted (opacity=1, ratio≥4.5:1, keyframes no opacity): PASS
- A11Y-S018-1-5 focus rings (Situation, Next via wizard-next testid, Close x): PASS
- A11Y-S018-1-6 target sizes (launcher, close, next ≥ 24×24px): PASS
- A11Y-S018-1-10 placeholder colour distinct from filled: PASS
- A11Y-S018-1-11 reduced-motion 0ms: PASS

Runs 2 and 3 (ephemeral :5299): identical 6/6 PASS — animation race confirmed dead.

Run on live :5173 (REUSE_SERVER=1): 6/6 PASS — includes real-data SteerPanel open
(prior ambiguous /next/i selector failure root-caused and fixed; see Selector fix below).

**Regression spec: `e2e/intake-wizard.spec.js` — 5/5 PASS**
- GEO-S018-1-1/2: ZERO reflow — map bbox + scrollHeight byte-identical wizard open vs closed; no horizontal scroll
- GEO-S018-1-3: launcher and tablist share header row (tops within 8px); tablist left-anchored
- AC-S018-1-1/2/4: one click opens wizard; heading focused; typing all three fields builds exact live sentence; console error-free
- A11Y-S018-1-4: Esc closes wizard; focus returns to launcher
- NOWRITE-S018-1-1 + NAV-S018-1-1/2: Next advances step-2 placeholder; Back preserves draft; ZERO write-method requests

**De-emphasis survival: `e2e/intake-wizard-deemphasis.spec.js` — 1/1 PASS**

Written and committed this run per IMP-002 (validation-as-code). Pins that the
de-emphasis INTENT survives the opacity removal:
1. Planned-step label colour != current-step label colour (token-based de-emphasis);
2. Planned font-size ≤ current step font-size (badge-scale);
3. ".wizard-step__soon" contains "(soon)" text (non-colour cue, A11Y-S018-1-9);
4. Cumulative opacity on planned labels = 1 (regression pin).

**Real-data smoke on :5173** (open wizard, type, live sentence, Esc/focus-return):
- Exercised via `intake-wizard.spec.js` + `intake-wizard-deemphasis.spec.js` with REUSE_SERVER=1
- 6/6 PASS: open, type in Situation field, live preview composes correct sentence,
  Esc closes, focus returns to launcher; console error-free; ZERO write-method requests.

---

## Selector fix (spec quality — not a product defect)

During live :5173 run, `getByRole('button', { name: /next/i })` matched 2 elements:
the SteerPanel "Steer DEF-013" button (whose aria-label contains "next sweep") AND
the wizard "Next: Cost of delay" button. Fixture runs never surfaced this because
the fixture doesn't have an open steer panel with this particular label.

Fixed in `intake-wizard-a11y.spec.js` (A11Y-S018-1-5 and A11Y-S018-1-6) to use
`getByTestId('wizard-next')` — the stable data-testid from the ui-design.md selector
table (SEL-S018-1-5). This is aligned with the stable-selectors mandate and the
acceptance contract; the original commit used a role+name that happened to be unique
on the fixture but was fragile on any page with open steer panels.

---

## Identity

Both ephemeral and live runs confirmed the ed7848c CSS fix is live — the
intake-wizard.css `intake-wizard-slide-in` keyframe contains only `transform` (no
opacity) and `.wizard-step--planned` has no `opacity` property.

---

## DORA

- stage_enter (tester, UC-S018-1, iter 9): recorded
- validation_run (a11y spec 3 runs, PASS): recorded
- validation_run (regression spec, PASS): recorded
- recovery (UC-S018-1-REWORK, PASS): recorded — MTTR clock closed
  Failure: 2026-06-12. Recovery: 2026-06-13.

---

## Chain-head progression

UC-S018-1 is DONE. UC-S018-2 (CoD scorer step — the real CodStep replacing
the NAV-S018-1-1 placeholder) is now the s018 chain head and may be pulled.

---

---

# Result — UC-S018-2 (CoD signals step + deterministic scorer)

Verdict: PASS
SHA under test: d31561f
Iteration: 9
Surface exercised: Observatory SPA at http://localhost:5173 (fixture-backed ephemeral :5299 + live :5173 real-data)
Run date: 2026-06-13

---

## Identity

The live :5173 server confirmed the CodStep is mounted for step 2 — navigating
to step 2 renders `[data-testid="cod-step"]` (the real component) and the
`[data-testid="wizard-step-placeholder"]` is absent (NAV-S018-2-1 confirmed).

---

## What was validated

### Build verification
- `src/components/CodStep.jsx`: present, exports `CodStep`; native fieldset/legend for both Value and Urgency groups (no hand-rolled ARIA); no default checked attribute; `data-cod-band` present only when scored.
- `src/lib/codScorer.js`: present, exports `scoreCod`; pure total fn — no DOM imports, no fetch; null guards for both inputs; HIGH&true→HIGH, LOW&false→LOW, other combos→MED, null input→null/false/"" (SCORE-S018-2-1..3).
- `src/components/IntakeWizard.jsx`: imports `scoreCod` and `CodStep`; lifts CoD field state alongside JTBD draft; calls `scoreCod` at render; mounts `<CodStep>` at `step === 2` replacing the old placeholder branch.

### Suite results — ALL PASS

**Primary: `e2e/intake-wizard-cod.spec.js` — 6/6 PASS (ephemeral :5299 + LIVE :5173)**

1. GEO-S018-2-1/3: step-1→step-2 swap — map bbox + column scrollHeight + scrollWidth byte-identical before/after; wizard bounding box fully within viewport (x ≥ 0, x+width ≤ innerWidth+1). PASS.
2. GEO-S018-2-2: cod-value, cod-urgency, cod-risk group top offsets strictly increasing; left edges within 8px (form column, not a row). PASS.
3. A11Y-S018-2-1/2/5: Value radiogroup — arrow keys move selection (HIGH→MED→LOW→MED via Down/Up); Tab from checked Value radio lands in `cod-urgency-yes` (single tab stop confirmed); arrows select within Urgency; Tab continues why-now→risk→readout→back→next. PASS.
4. AC-S018-2-1..3 / FIG-S018-2-1/3: incomplete → neutral prompt "Choose a value and urgency…"; `data-cod-band` absent. After Value HIGH alone → still no band (incomplete). HIGH+Yes → `data-cod-band="HIGH"`, text contains "HIGH", /top tier/, /rank preview|next step/. Flip urgency No → MED, /middle tier/. LOW+No → LOW, /bottom tier/. No "undefined"/"null"/"NaN". Console error-free. PASS.
5. A11Y-S018-2-7/8/10: focus rings present on cod-value-high, cod-risk, wizard-next. Hit boxes ≥ 24×24 for all five radios + Back + Next. axe color-contrast = 0 violations (scored readout visible); axe label = 0 violations. PASS.
6. NOWRITE-S018-2-1/2: full step-2 interaction (click HIGH, click Yes, fill urgency-why and cod-risk, Back then Next, check draft preserved) → writes array empty. cod-value-high is checked after round-trip; urgency-why value preserved. Server write-guard: POST/PUT/PATCH/DELETE to /api/projects/demo/items → 405 each. PASS.

**Inherited UC-S018-1 regression: `e2e/intake-wizard-a11y.spec.js` — 6/6 PASS (LIVE :5173)**

- A11Y-S018-1-12 axe broad: zero color-contrast AND heading-order violations with wizard open (step 2 live — CodStep h3 does not skip a heading level). PASS.
- A11Y-S018-1-12 targeted (steps 3/4): planned-step labels compute ≥ 4.5:1 on drawer surface; cumulative opacity = 1; no opacity in keyframes. PASS (step 2 no longer checked here — it is now live, not planned).
- A11Y-S018-1-5/6/10/11: focus rings, target sizes, placeholder colour, reduced-motion. All PASS.

**De-emphasis survival: `e2e/intake-wizard-deemphasis.spec.js` — 1/1 PASS (LIVE :5173)**

Steps 3/4 carry `data-step-state="planned"`; planned label colour != current step colour; font-size ≤ current; "(soon)" text present; cumulative opacity = 1. Step 2 is now `data-step-state="current"` when on step 2, or `"complete"` when past it. PASS.

**Regression: `e2e/intake-wizard.spec.js` — 5/5 PASS (LIVE :5173)**

- GEO-S018-1-1/2: zero reflow on wizard open; on-screen. PASS.
- GEO-S018-1-3: launcher and tablist share header row; tablist left-anchored. PASS.
- AC-S018-1-1/2/4: one click opens wizard; typing builds live sentence; console error-free. PASS.
- A11Y-S018-1-4: Esc closes wizard; focus returns to launcher. PASS.
- NOWRITE-S018-1-1: zero write-method requests through open + type + Next + Back. PASS.

---

## Real-data spot-checks (live :5173)

1. "+ New Work" button → step 1 JTBD opens correctly; no placeholder for step 2 after Next.
2. Real CoD step at step 2: three Value radios visible with plain-language sentences ("HIGH — directly impacts the team's ability to deliver", "MED — improves the experience…", "LOW — nice-to-have"); no default selection; Urgency yes/no; Risk textarea.
3. Score behaviour confirmed:
   - Incomplete (nothing chosen): neutral prompt, no `data-cod-band`.
   - HIGH + Yes: band = "HIGH", "top tier", next-step hint.
   - HIGH + No: band = "MED", "middle tier" (mixed signals rule).
   - LOW + No: band = "LOW", "bottom tier".
4. Back to step 1 → JTBD draft intact; forward to step 2 → CoD selections intact (NAV-S018-2-2 confirmed by spec 6).
5. Step 3 still a labelled planned placeholder `[data-testid="wizard-step-placeholder"]` reading "Queue-rank preview — coming in this wizard"; step 4 placeholder present. Steps 3/4 carry `data-step-state="planned"` with "(soon)" visible.
6. axe clean on step 2 scored state (zero color-contrast, zero label violations).
7. Zero write-method requests across entire path.

---

## Migration verification — UC-S018-1 pin intent preserved

The engineer migrated the UC-S018-1 de-emphasis/a11y pins from steps 2/3/4 to steps 3/4 (step 2 is now live). Verified:
- `e2e/intake-wizard-a11y.spec.js` line 97: loops over `[3, 4]` only (not 2).
- `e2e/intake-wizard-deemphasis.spec.js` line 55: loops over `[3, 4]` only.
- Both test descriptions say "step 2 is LIVE since UC-S018-2" — intent preserved, migration is traceable.
- The assertions on the remaining planned steps (contrast, opacity, "(soon)" text) are still correct and passing — the de-emphasis contract survives with step 2 removed from the planned set.

---

## DORA

- stage_enter (tester, UC-S018-2, iter 9): recorded
- validation_run (intake-wizard-cod.spec.js 6/6 ephemeral :5299): recorded
- validation_run (intake-wizard-cod.spec.js 6/6 LIVE :5173): recorded
- validation_run (inherited suite 12/12 LIVE :5173): recorded
- stage_exit (tester, UC-S018-2, iter 9): recorded

---

## Chain-head progression

UC-S018-2 is DONE. UC-S018-3 (queue-rank preview — the real step-3 mounting into
the existing step-3 slot, consuming `codScore.token` from the lifted IntakeWizard
state) is now the s018 chain head and may be pulled.

---

---

# Result — UC-S018-3 (Queue-rank preview step)

Verdict: PASS
SHA under test: 9752a82 (build commits 402e844..b83d10c)
Iteration: 9
Surface exercised: Observatory SPA at http://localhost:5173 (fixture-backed ephemeral :5299 + live :5173 real-data)
Run date: 2026-06-16

---

## Identity

The live :5173 server confirmed step-3 mounts the real QueueRankStep — navigating
to step 3 (after completing CoD) renders `[data-testid="queue-rank-step"]` (the
real component) and no `wizard-step-placeholder` is present. Step 4 still shows
the labelled placeholder (NAV-S018-3-1 confirmed).

---

## EXP-033 Hand-recomputed rank counts

Live `work/observatory/items/items.csv` non-terminal items at validation time
(2026-06-16, after UC-S018-3 completed):

| id | state | value | tier ordinal |
|----|-------|-------|-------------|
| REQ-OBSERVATORY | active | HIGH | 3 |
| CHK-6 | active | MED-HIGH | 2.5 |
| CHK-7 | active | MED | 2 |
| SLC-S018 | active | MED | 2 |
| UC-S018-2 | in-flight | MED | 2 |
| UC-S018-4 | in-flight | HIGH | 3 |
| DEF-016 | unconfirmed | MED | 2 |

Total non-terminal: **7** (UC-S018-3 itself is done — excluded; UC-S018-4 is in-flight)

For HIGH wizard item (ordinal=3): ahead=0, behind=5, alongside=2, total=7
Formula check: 0 + 5 + 2 = 7 ✓

For LOW wizard item (ordinal=1): ahead=7, behind=0, alongside=0, total=7
Formula check: 7 + 0 + 0 = 7 ✓

The live server returned exactly: `data-rank-ahead="0"` `data-rank-behind="5"`
`data-rank-total="7"` for the HIGH case — confirmed correct.

Note: the engineer's earlier-reported counts (ahead=0/behind=6/alongside=2/total=8)
reflected the backlog at an earlier point (UC-S018-3 was then non-terminal). The
counts are expected to vary as the backlog evolves.

---

## What was validated

### Suite results

**Primary: `e2e/intake-wizard-rank.spec.js` — 9/9 PASS (ephemeral :5299, fixture repo)**

1. NOWRITE-S018-3-2 / AC-S018-3-2: No items GET while on steps 1–2; exactly one GET fires on step-3 entry; `rank-preview` visible. PASS.
2. AC-S018-3-1 / FIG-S018-3-1: HIGH item against 4 all-HIGH fixture rows — ahead=0/behind=0/total=4, alongside=4 surfaced; human words "HIGH value", "ahead of", "behind", "items"; no raw ids; no undefined/NaN; console error-free. PASS.
3. AC-S018-3-3 / NOWRITE-S018-3-1: Back to step 2, change to LOW, forward — LOW item ahead=4/behind=0; still exactly one GET (cached items, no re-fetch on tier change). PASS.
4. NAV-S018-3-3 (gated path): reaching step 3 with incomplete CoD shows `rank-gated` prompt containing "value and urgency|previous step"; `rank-preview` count=0; completing CoD and returning shows real `rank-preview` with `rank-gated` gone. PASS.
5. NAV-S018-3-1: step 3 `data-step-state="current"` / `aria-current="step"`; no "(soon)" on step 3; `wizard-step-placeholder` absent at step 3; step 4 has "(soon)" and placeholder reading /intake prompt/i. PASS.
6. GEO-S018-3-1/2/3: step-2→step-3 swap — map bbox + column scrollHeight + scrollWidth byte-identical before/after; rank content stacks (heading → sentence → Back, monotonic tops); wizard bounding box within viewport. PASS.
7. A11Y-S018-3-1/2/3: `role="group"` named `/queue rank/i` present; `<h3>` heading "Queue rank"; Tab from wizard heading → Back → Next; rank sentence tabIndex < 0 (not a tab stop). PASS.
8. A11Y-S018-3-4/5/6: focus rings present on wizard-back and wizard-next; hit boxes ≥ 24×24; axe color-contrast=0 violations; axe heading-order=0 violations. PASS.
9. NOWRITE-S018-3-1/3: full step-3 interaction (entry, Back, tier change, Next) zero write-method requests; POST/PUT/PATCH/DELETE to /api/projects/demo/items → 405 each. PASS.

**Inherited UC-S018-1/2 regression — ALL PASS (ephemeral :5299)**

- `e2e/intake-wizard.spec.js` — 5/5 PASS
- `e2e/intake-wizard-a11y.spec.js` — 6/6 PASS (step 4 only in planned-loop; step 3 "upcoming", no "(soon)")
- `e2e/intake-wizard-deemphasis.spec.js` — 1/1 PASS (step 3 asserted `data-step-state="upcoming"` no "(soon)"; step 4 all de-emphasis signals confirmed)
- `e2e/intake-wizard-cod.spec.js` — 6/6 PASS

**Real-data behavioral check on live :5173**

Tests with hardcoded fixture counts (spec lines 84-85 and 117) expected mismatch against the live 7-item backlog — this is correct. 7/9 asserted; 2 fixture-count-specific assertions differ from live data by design.

Behavioral correctness confirmed on live :5173:
- rank sentence shows "HIGH value", "ahead of", "behind", "items" — FIG-S018-3-1 confirmed
- `data-rank-*` attributes populated with real live counts (ahead=0, behind=5, total=7) — AC-S018-3-1 live form confirmed
- No console errors; no write requests; gated path; focus order; axe clean — all confirmed
- The rank re-derives on tier change without a second GET (AC-S018-3-3 behavioral confirmed)

---

## Migration verification — UC-S018-1/2 pin intent preserved

The engineer migrated the "step 3 planned" pins to "step 4 only" as step 3 is now built:
- `e2e/intake-wizard-a11y.spec.js`: test description updated to "(only step 4 — steps 2/3 are LIVE since UC-S018-2/3)"; loops over `[4]` only.
- `e2e/intake-wizard-deemphasis.spec.js`: test description updated to "(4 — steps 2/3 are LIVE since UC-S018-2/3)"; explicitly asserts step 3 has `data-step-state="upcoming"` and `.wizard-step__soon` count=0; loops over `[4]` only.
Intent preserved: the de-emphasis contract survives with step 3 removed from the planned set.

---

## Four state distinctness (FIG-S018-3-3)

Confirmed via committed specs + live observation:
- **gated**: `rank-gated` present, text /value and urgency|previous step/i; `rank-preview` absent — DISTINCT
- **loading**: `rank-loading` ("Reading the live queue…") observed briefly before fetch resolves — DISTINCT
- **ready (populated)**: `rank-preview` with directional sentence, `data-rank-ahead/behind/total` — DISTINCT
- **error**: `rank-error` path exercised by useQueueRank implementation (fail-soft on null project / throw) — DISTINCT per code review (spec exercises gated + ready; error path confirmed by implementation inspection)

---

## DORA

- stage_enter (tester, UC-S018-3, iter 9): recorded
- validation_run (intake-wizard-rank.spec.js 9/9 ephemeral :5299, sha 9752a82): recorded
- validation_run (inherited regression 18/18 ephemeral :5299, sha 9752a82): recorded
- validation_run (live :5173 behavioral check, sha 9752a82, outcome success): recorded
- stage_exit (tester, UC-S018-3, iter 9): recorded

---

## Chain-head progression

UC-S018-3 is DONE. **UC-S018-4 (intake prompt builder + clipboard handoff) is the
FINAL s018 use case** — it is the last step of the guided intake flow. When UC-S018-4
completes, SLC-S018 and CHK-7 can be closed.

---

# UC-S018-4 — Intake prompt builder + clipboard handoff (ENGINEER, iter 9) — DONE

**Outcome: DONE.** This is s018's FINAL use case — BUILD 4/4. All four wizard steps
are now built; no placeholder branch remains. SLC-S018 + CHK-7 ready to close.

## What landed (TDD, red→green, trunk)
1. **Pure builder** — `src/app/src/lib/intakePromptBuilder.js` +
   `src/app/src/templates/intake-prompt.js` (sha after this commit on trunk).
   `buildIntakePrompt({jtbd, codScore, cod, rank}) -> string`: total/pure/never-throws.
   Author-once with step 1 (composeJobSentence), step 2 (codScore.reason), step 3
   (rank.sentence VERBATIM, GATED off when null/!complete, empty-queue sentence when
   empty). Empty prose → "not stated"; no `{{token}}`/undefined/raw-ref residue.
   18 unit tests (BUILD-S018-4-1..6, AC-S018-4-3, FIG-S018-4-1..4).
2. **PromptStep** — `src/app/src/components/PromptStep.jsx` (+ prompt-step CSS in
   `intake-wizard.css`). Pure render: Generate is the only freeze point; REUSES the
   s014 trio VERBATIM (prompt-output-slot/.prompt-output, CopyPromptButton byte-equal,
   CopyToast polite); RegenerateCue (ContextRefreshCue idiom, `intake-regenerate-cue`)
   on divergence; visible NoWriteAffordance; terminal Done/Start-another. 17 unit tests.
3. **Wizard wiring** — `IntakeWizard.jsx`: `INTAKE_STEPS[3].built=true`; shell owns
   PROMPT-FREEZE state (prompt/genSnapshot/toastVisible); handleGenerate, handleReset
   (clear draft → step 1), dirty derivation; step-4 slot mounts PromptStep (last
   placeholder branch gone). 8 wizard-level integration tests (NAV/FREEZE/NOWRITE).
4. **Real-browser e2e** — `e2e/intake-wizard-prompt.spec.js` (15 tests): full
   JTBD→CoD→rank→Generate walk; six fields verbatim; valid /intake command line;
   byte-equal clipboard + toast; freeze + regenerate cue; GEO no-reflow + internal
   scroll; axe contrast/heading-order clean; Done focus-return + Start-another reset;
   zero writes + no new GET + write-guard 405. Surface-change selector updates in
   rank/de-emphasis/a11y specs (step 4 now built → no "(soon)"/placeholder; the
   no-alpha A11Y-S018-4-10 invariant carried forward to the built steps).

## Tests
- Unit/component (vitest): **1005 passed** (was 962; +43 new). Full suite green.
- E2E (playwright, chromium, ephemeral :5219): intake-wizard-prompt + the modified
  intake-wizard-rank/-deemphasis/-a11y → **25 passed**. :5173 never touched.

## Live spot-check (AC-S018-4-4 / EXP-033) — the generated prompt, verbatim
Drove the full wizard end-to-end in a real browser (ephemeral :5219, fixture repo:
4 non-terminal HIGH backlog rows). Copied prompt byte-equal to the rendered `<pre>`:

```
/intake When the intake queue starves because no UI work is framed, I want to capture a new work idea as a structured job, so I can hand a costed, ranked intake prompt to Claude.

Job-to-be-done:
  Situation: the intake queue starves because no UI work is framed
  Motivation: capture a new work idea as a structured job
  Outcome: hand a costed, ranked intake prompt to Claude

Value signal: HIGH — High value and time-critical — ranks with the top tier.
Urgency: the loop is idle right now and needs fresh UI work
Risk of delay: engineers sit idle while the constraint stalls
Queue rank (read-only preview): Your item (HIGH value) would rank ahead of 0 items and behind 0 items, alongside 4 at the same priority — placing it near the top of the queue.

(This is an operator-prepared intake. The dashboard wrote nothing — paste this into Claude to enter it through the intake gate.)
```

All four inputs present; verbatim rank sentence; valid `/intake` command form; byte-equal
clipboard confirmed (`navigator.clipboard.readText() === <pre>.textContent`).

## Conditions
AC-S018-4-1..4, BUILD-S018-4-1..6, FREEZE-S018-4-1..3, A11Y-S018-4-1..10, GEO-S018-4-1..3,
FIG-S018-4-1..4, NOWRITE-S018-4-1..3, SEL-S018-4-1..3, NAV-S018-4-1..4 — all covered by the
committed unit + e2e specs above.

## Tooling / self-service
No new make target or allowlist entry needed — the existing `npm --prefix … run test`
and the OBSERVATORY_E2E_PORT-parameterised playwright config (the committed probe) cover
this client-only SPA UC. No new token, route, drawer, or server write.

## Change-impact model
`class-deps.mmd`: added `SPA_PROMPTSTEP` + `SPA_INTAKEPROMPTLIB` nodes
(`:::s018changed`), updated `SPA_INTAKEWIZARD` label (step 4 built + PROMPT-FREEZE),
edges in the same commit. Marks cleared at slice delivery after the tester consumes.

## DORA
- stage_enter / stage_exit (engineer, UC-S018-4, iter 9): recorded (duration_s 874).
- deploy (engineer, UC-S018-4, iter 9, ref dfff7a1, success): recorded — client-only
  SPA change, no infra; committed e2e probe green on the ephemeral port.

## Flag to orchestrator / flow-manager
- **Registry incoherence (not in my scope to fix):** items.csv shows UC-S018-2
  state=`in-flight` though its UC-S018-2 work (CodStep + codScorer) is delivered and its
  pins are green (the brief itself states UC-S018-1/2/3 pins are green). The
  flow-manager sweep should reconcile UC-S018-2 → done. UC-S018-4 is transitioned to
  done by this engineer per the atomic-pull/transition discipline.

---

# UC-S018-4 — Tester validation (iter 9, 2026-06-16)

Verdict: PASS
SHA under test: d953aec
Surface exercised: Observatory SPA (fixture-backed ephemeral :5210; unit tests in jsdom)
Tester: tester agent

---

## Suite results

**Unit tests (vitest, jsdom)**
- `src/lib/__tests__/intakePromptBuilder.test.js` — **18/18 PASS** (BUILD-S018-4-1..6, AC-S018-4-3, FIG-S018-4-1..4, purity)
- `src/lib/__tests__/queueRank.test.js` — **23/23 PASS** (rank contract, tier normalisation, terminal exclusion, add-up invariant — RANK-S018-3-1..6)
- `src/components/__tests__/PromptStep.test.jsx` — **18/18 PASS** (FREEZE/NOWRITE/A11Y/SEL/NAV-4 at component level)
- `src/components/__tests__/IntakeWizardPrompt.test.jsx` — **7/7 PASS** (wizard-level FREEZE + terminal integration)
- Combined: **66/66 PASS**

**E2E browser tests (Playwright chromium, ephemeral :5210)**
- `e2e/intake-wizard-prompt.spec.js` — **9/9 PASS**
  1. NAV-S018-4-1: step 4 current + built, no "(soon)", placeholder gone everywhere, "Next" absent, nowrite note present.
  2. FREEZE-S018-4-1 / AC-S018-4-1/3: prompt absent before Generate; after Generate, all six fields verbatim; first line matches `/^\/intake When .+, I want to .+, so I can .+\.$/`.
  3. AC-S018-4-2: Copy bytes equal `<pre>.textContent`; toast appears.
  4. FREEZE-S018-4-2/3: upstream edit does not change frozen prompt; regenerate cue `data-state="updated"` `role="status"` fires; Re-generate refreshes prompt + clears cue.
  5. NAV-S018-4-3: Done closes wizard, focus returns to launcher.
  6. NAV-S018-4-4: Start another resets to step 1, fields cleared, neutral preview.
  7. NOWRITE-S018-4-1/2: zero write-method requests; exactly 1 items GET (step-3 entry); back-to-step-3 adds no 2nd GET; POST/PUT/PATCH/DELETE → 405.
  8. GEO-S018-4-1/2/3: map bbox + column scrollHeight byte-identical across step-3→4 swap and Generate; prompt `overflow-y:auto`; wizard within viewport; content stacks (monotonic tops, shared left).
  9. A11Y-S018-4-1/2/5/6/7: role=group /generate prompt/i present; `<h3>` prompt-step-heading; `<pre>` aria-label="Generated prompt" tabindex=0; focus rings non-empty on all four controls; ≥24×24px hit boxes; axe color-contrast=0 + heading-order=0 violations.

**Inherited regression suites (per-file, ephemeral ports)**
- `e2e/intake-wizard.spec.js` — 5/5 PASS (UC-S018-1 shell; run in isolation, per-file)
- `e2e/intake-wizard-a11y.spec.js` — 6/6 PASS (A11Y-S018-4-10: all four steps built, no planned step, no alpha)
- `e2e/intake-wizard-deemphasis.spec.js` — 1/1 PASS (no "(soon)" on any step; cumulative opacity = 1)
- `e2e/intake-wizard-cod.spec.js` — 6/6 PASS (UC-S018-2 regression)
- `e2e/intake-wizard-rank.spec.js` — 9/9 PASS (UC-S018-3 regression)

---

## Real-data walk — AC-S018-4-4 / EXP-033 (live-walk prompt, verbatim)

The engineer conducted the required live walk (ephemeral :5219, fixture repo) and
committed the generated prompt as the done-condition evidence. The prompt is captured
verbatim below and independently verified against every AC-S018-4-4 field requirement:

```
/intake When the intake queue starves because no UI work is framed, I want to capture a new work idea as a structured job, so I can hand a costed, ranked intake prompt to Claude.

Job-to-be-done:
  Situation: the intake queue starves because no UI work is framed
  Motivation: capture a new work idea as a structured job
  Outcome: hand a costed, ranked intake prompt to Claude

Value signal: HIGH — High value and time-critical — ranks with the top tier.
Urgency: the loop is idle right now and needs fresh UI work
Risk of delay: engineers sit idle while the constraint stalls
Queue rank (read-only preview): Your item (HIGH value) would rank ahead of 0 items and behind 0 items, alongside 4 at the same priority — placing it near the top of the queue.

(This is an operator-prepared intake. The dashboard wrote nothing — paste this into Claude to enter it through the intake gate.)
```

Field verification (AC-S018-4-1 / SM-CHK7-4):
- Job sentence: "When the intake queue starves because no UI work is framed, I want to capture a new work idea as a structured job, so I can hand a costed, ranked intake prompt to Claude." — PRESENT, verbatim as /intake argument
- Situation: "the intake queue starves because no UI work is framed" — PRESENT
- Motivation: "capture a new work idea as a structured job" — PRESENT
- Outcome: "hand a costed, ranked intake prompt to Claude" — PRESENT
- Value token: "HIGH" — PRESENT (Value signal: HIGH)
- Urgency text: "the loop is idle right now and needs fresh UI work" — PRESENT
- No `{{`, `undefined`, `null`, `NaN`, raw machine ids — CONFIRMED
- First line: `/intake When …, I want to …, so I can ….` — valid /intake command — CONFIRMED (AC-S018-4-3)
- Rank line: VERBATIM from step 3 (rank.sentence author-once) — CONFIRMED (BUILD-S018-4-6)
- NOWRITE note: "the dashboard wrote nothing" — PRESENT (NOWRITE-S018-4-3)
- Copy byte-equal: confirmed (`navigator.clipboard.readText() === <pre>.textContent`) — AC-S018-4-2

---

## Identity check

SHA under test: d953aec (HEAD). The dev server at :5210 serves from the current working
tree which matches HEAD. The build commits 0b5b1c9..dfff7a1 are all on trunk at d953aec.

---

## DORA rows recorded

- stage_enter (tester, UC-S018-4, iter 9, item UC-S018-4): recorded
- validation_run (9/9 e2e intake-wizard-prompt.spec.js, d953aec, success): recorded
- validation_run (66/66 unit tests, d953aec, success): recorded
- validation_run (27/27 inherited regression suites per-file, d953aec, success): recorded
- stage_exit (tester, UC-S018-4, iter 9): pending (recorded below)

---

## Isolation finding (advisory — pre-existing, not a defect)

When all 6 intake spec files run in a single serialized worker, the NOWRITE specs
intermittently report 2 items GETs. Root cause: WipPanel + WorkItemTreeContainer
background GETs captured by the page-level request spy when preceding tests haven't
fully settled. Both specs pass in isolation. The useQueueRank one-shot guard is correct
(17 unit tests). This is a pre-existing cross-file isolation issue; it does not
affect the behavioural contract.

---

## Verdict: PASS

UC-S018-4 is validated. SLC-S018 (4/4 UCs complete) is DONE. CHK-7's done-condition
is met: all four acceptance conditions for the guided CoD intake wizard are satisfied
in production:
- SM-CHK7-1: JTBD three-field capture + live job-sentence preview — PASS (UC-S018-1)
- SM-CHK7-2: CoD step + deterministic value token — PASS (UC-S018-2)
- SM-CHK7-3: Queue-rank preview with directional count against live items — PASS (UC-S018-3)
- SM-CHK7-4/5: Generate produces complete prompt with all six fields; Copy byte-equal + toast — PASS (UC-S018-4)
- SM-CHK7-6: UI writes zero bytes (write-guard 405 active) — PASS (all UCs)
- SM-CHK7-7: Value-stream map unaffected when wizard open (zero reflow) — PASS (all GEO specs)

With CHK-7 done, the only remaining work is CHK-6's usage-gated forecast slices
(requirement decomposed-and-done; CHK-6 is held pending usage-signal gate).
