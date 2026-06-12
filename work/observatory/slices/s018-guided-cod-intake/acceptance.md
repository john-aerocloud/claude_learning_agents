# Acceptance — s018 Guided cost-of-delay intake

Co-authored conditions. The UI-designer owns the A11Y / GEO / FIG / NO-WRITE /
SEL sections for each UC's UI surface (mirrored from ui-design.md); the engineer
+ tester own the functional ACs already in use-cases.md. The tester enforces
A11Y via axe + Playwright/Vitest, GEO via computed-style / bounding-box, FIG via
text assertions, NO-WRITE via the write-guard 405 + a fetch spy.

---

## UC-S018-1 — Intake wizard shell + JTBD capture step (THIS UC)

### Functional (from use-cases.md — restated for the tester)
- AC-S018-1-1: "New Work" launcher present in the main-column header (NOT a
  sidebar — see SEL/IA correction); clicking it opens the `IntakeWizard` with
  three fields labelled "Situation (when…)", "Motivation (I want to…)",
  "Outcome (so I can…)".
- AC-S018-1-2: typing in any of the three fields updates the job-sentence
  preview live (no reload): "When [situation], I want to [motivation], so I can
  [outcome]".
- AC-S018-1-3: opening the wizard does NOT displace the value-stream map / any
  view — map still renders fully (covered structurally by GEO-S018-1-1).
- AC-S018-1-4: console error-free on open and on all three field inputs.

### Accessibility (AA) — UI-designer co-authored, tester-enforced
- **A11Y-S018-1-1 (labels):** each of the three JTBD fields has an associated
  programmatic label (axe `label` rule passes); the accessible name of each
  textbox matches `/situation/i`, `/motivation/i`, `/outcome/i` respectively.
  Placeholders are NOT the sole label.
- **A11Y-S018-1-2 (keyboard operable):** the launcher opens the wizard on Enter
  AND Space (native button); every wizard control (fields, Next, ×) is reachable
  and operable by keyboard only; no keyboard trap (wizard is NON-modal — Tab can
  leave it to the map/tree).
- **A11Y-S018-1-3 (focus order):** on open, focus moves to the wizard heading
  (`data-testid="intake-wizard-heading"`, `tabindex=-1`). Forward Tab order is
  Situation → Motivation → Outcome → preview region → Next → Close. Assert the
  document.activeElement progression.
- **A11Y-S018-1-4 (focus return):** Esc, the × button, and Cancel each close the
  wizard AND return focus to the IntakeLauncher button.
- **A11Y-S018-1-5 (visible focus):** every interactive element shows a visible
  focus indicator on `:focus-visible` (the `--focus-ring`); assert a non-empty
  box-shadow/outline computed on focus.
- **A11Y-S018-1-6 (target size):** the launcher, Close ×, and Next have a hit
  box ≥ 24×24 CSS px (WCAG 2.2 §2.5.8); assert bounding-box width AND height
  ≥ 24.
- **A11Y-S018-1-7 (dialog role + name):** the wizard exposes `role="dialog"`
  with an accessible name (`aria-labelledby` → heading) matching
  `/new work|intake/i`, and is NON-modal (no `aria-modal="true"`).
- **A11Y-S018-1-8 (live preview announced):** the JobSentencePreview is a
  `role="status"` `aria-live="polite"` region so composed updates are announced
  once, not per-character-spammed (assert role + aria-live attributes present).
- **A11Y-S018-1-9 (step state non-colour):** each WizardStepIndicator step's
  state is conveyed by text/number/`aria-current` AND `data-step-state`, not
  colour alone; the current step carries `aria-current="step"`; planned steps
  carry visible "(soon)" text. Assert the current step has `aria-current` and a
  planned step has the visible "soon"/planned text node.
- **A11Y-S018-1-10 (contrast):** preview text ≥ 4.5:1 on its surface; empty-slot
  placeholder text ≥ 4.5:1 AND a different computed colour from filled text
  (axe `color-contrast` passes; assert distinct computed colour).
- **A11Y-S018-1-11 (reduced motion):** under `prefers-reduced-motion: reduce`
  the drawer slide-in animation-duration / transition-duration computes to 0ms.
- **A11Y-S018-1-12 (one h1; ordered headings):** the wizard heading is an `<h2>`
  (or appropriate level) under the page's existing single `<h1>`; no skipped
  heading levels introduced. axe `heading-order` + a single-h1 assertion pass.

### Geometry / visual-structural correctness — tester-enforced via bbox/computed style
- **GEO-S018-1-1 (zero reflow — the key guard):** the value-stream map (active
  Pipeline view) bounding box AND `.observatory-main-col` scrollHeight are
  BYTE-IDENTICAL with the wizard open vs closed. The wizard is a body-portalled
  `position:fixed` overlay → zero flow height. (Same guard the SteerPanel /
  ReslicePreviewPanel GEO conditions use; SM-CHK7-7.) Assert
  getBoundingClientRect equality of `[data-testid="value-stream-map"]` and
  scrollHeight equality of `.observatory-main-col` before-open vs after-open.
- **GEO-S018-1-2 (on-screen, no horizontal scroll):** the open wizard's
  bounding box sits fully within the viewport (right edge ≤ innerWidth, no
  document horizontal scrollbar introduced).
- **GEO-S018-1-3 (header is a row, tablist unmoved):** the IntakeLauncher and
  the ViewSwitch tablist share a top offset (a header ROW, not stacked); the
  ViewSwitch tablist's bounding box is unchanged from its pre-s018 position
  (do-no-harm to the existing view-switch geometry). Assert the launcher and
  `[data-testid="view-switch"]` have approximately-equal top offsets AND the
  tablist bbox is unchanged vs the no-launcher baseline.
- **GEO-S018-1-4 (fields stack):** the three JTBD fields stack vertically — top
  offsets strictly increase, shared left offset (a form column, not a row);
  assert monotonic tops + shared left.

### Figure legibility (FIG) — the live job-sentence preview
- **FIG-S018-1-1 (real sentence, never raw concat):** with all three fields
  filled, the preview text equals "When <situation>, I want to <motivation>, so
  I can <outcome>." (the exact filled template) and contains NONE of the strings
  "undefined", "null", "[object Object]".
- **FIG-S018-1-2 (empty slot ≠ broken):** with one or two fields empty, the
  preview still reads as a grammatical sentence using a readable placeholder in
  each empty slot; it contains no "undefined"/"null" and no doubled punctuation
  or empty gap (e.g. never "When , I want to …"). Assert no forbidden tokens AND
  the placeholder text node is present.
- **FIG-S018-1-3 (all-empty ≠ skeleton):** with all three fields empty (initial
  open) the preview shows a single neutral prompt line (e.g. "Start typing to
  build your job sentence"), NOT a placeholder-filled sentence skeleton and NOT
  blank.

### No-write contract (NO-WRITE)
- **NOWRITE-S018-1-1:** opening the wizard, typing in any field, and pressing
  Next issue ZERO network requests with a write method
  (POST/PUT/PATCH/DELETE) — assert via a fetch/XHR spy that no write method
  fires across the full step-1 interaction. (Step 1 issues no network call at
  all; this UC is pure client-side.)
- **NOWRITE-S018-1-2:** the server write-guard remains active (a write probe to
  any project endpoint returns 405) — the existing SM-CHK7-6 guard test still
  passes (regression).

### Selectors (SEL) — the build/test contract (stable, role-first)
- **SEL-S018-1-1:** launcher resolvable by `getByRole('button', { name: 'New
  Work' })` and `[data-testid="intake-launcher"]`.
- **SEL-S018-1-2:** wizard resolvable by `getByRole('dialog', { name:
  /new work|intake/i })` and `[data-testid="intake-wizard"]`.
- **SEL-S018-1-3:** the three fields resolvable by their role+name (above) and
  by `[data-testid="jtbd-situation|jtbd-motivation|jtbd-outcome"]`.
- **SEL-S018-1-4:** preview resolvable by `[data-testid="job-sentence-preview"]`.
- **SEL-S018-1-5:** Next / Close / step indicator resolvable by the selectors in
  ui-design.md's selector table. No derived `nth(N)` / text-exclusion selectors.

### Step-navigation (later-steps-planned-not-dead) — observable behaviour
- **NAV-S018-1-1:** pressing "Next: Cost of delay" advances the step indicator
  to step 2 (`wizard-step-2` carries `data-step-state="current"` /
  `aria-current="step"`) AND renders a labelled placeholder
  `[data-testid="wizard-step-placeholder"]` reading the planned-step intent
  ("Cost-of-delay signals — coming…"); it does NOT crash, does NOT navigate
  away, and writes nothing. (Step 2's real CodStep is UC-S018-2.)
- **NAV-S018-1-2:** "Back" returns to step 1 with the JTBD fields' entered text
  preserved (draft retained while the drawer stays open).
