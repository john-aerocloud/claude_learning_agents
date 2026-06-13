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
