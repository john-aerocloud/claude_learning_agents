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

---

## UC-S018-2 — Cost-of-delay signals step + value-token scorer (THIS UC)

The real `CodStep` replacing step-2's placeholder + the pure `codScorer.js`.
Inherits the UC-S018-1 shell contract (drawer, focus/Esc, step machine,
indicator + de-emphasis rule, nav) — those conditions are NOT re-stated and MUST
NOT regress. These conditions are step-2-specific.

### Functional (from use-cases.md — restated for the tester)
- AC-S018-2-1: the Value selector shows THREE labelled options with
  plain-language descriptions (no raw token alone); selecting HIGH + Urgency =
  Yes produces a computed band = HIGH (visible in the readout, `data-cod-band="HIGH"`).
- AC-S018-2-2: selecting LOW + Urgency = No produces computed band = LOW.
- AC-S018-2-3: selecting MED with EITHER urgency, AND any other combination of
  CHOSEN values, produces computed band = MED.
- AC-S018-2-4: `codScorer.js` unit test (no DOM): `scoreCod` returns
  `token:'HIGH'` for `{value:'HIGH', timeCritical:true}`, `token:'LOW'` for
  `{value:'LOW', timeCritical:false}`, `token:'MED'` for every other CHOSEN
  combination, and `{token:null, band:null, complete:false, reason:''}` when
  `value` OR `timeCritical` is `null` (incomplete ≠ a defaulted MED).

### Scorer output contract (SCORE) — UI-designer co-authored
- **SCORE-S018-2-1 (shape):** `scoreCod({value, timeCritical})` returns
  `{ token, band, complete, reason }` — `token`/`band` ∈ HIGH|MED|LOW|null,
  `complete` boolean, `reason` string. `band === token` this slice.
- **SCORE-S018-2-2 (totality / purity):** defined for every input including
  `null`s; never throws; no DOM access; no network call (assert via the no-write
  spy that calling the scorer issues no fetch — it is pure).
- **SCORE-S018-2-3 (incomplete is null, not MED):** with `value=null` OR
  `timeCritical=null`, `token` and `band` are `null` and `complete` is `false`
  (the empty-inputs≠score guarantee at the source).

### Accessibility (AA) — UI-designer co-authored, tester-enforced
- **A11Y-S018-2-1 (radiogroup semantics — Value):** the Value group exposes
  `role="radiogroup"` with an accessible name matching `/value/i`; it is a
  SINGLE tab stop; ↑/↓/←/→ change the selection within the group (assert the
  checked radio moves with arrow keys and the group is one tab stop); each radio's
  accessible name is its FULL plain-language description (matches the option text,
  not the bare token). axe `aria-required-children`/`label` pass.
- **A11Y-S018-2-2 (radiogroup semantics — Urgency):** the Urgency group exposes
  `role="radiogroup"` name `/urgency/i`, single tab stop, arrow-key selection;
  options' accessible names match `/time-critical/i` and `/not time-sensitive/i`.
- **A11Y-S018-2-3 (no default selection):** on first render of step 2, NEITHER
  the Value nor the Urgency group has a checked radio (an unset signal is real —
  pairs with FIG-S018-2-3); assert no radio is `:checked` initially.
- **A11Y-S018-2-4 (labelled textareas):** the "why it matters now" and
  "risk-of-delay" textareas each have an associated programmatic `<label>` (axe
  `label` passes; placeholder is NOT the sole label); accessible names match
  `/why it matters now/i` and `/risk of delay|deferred/i`.
- **A11Y-S018-2-5 (within-step focus order):** forward Tab order within step 2 is
  Value group → Urgency group → "why now" textarea → risk-of-delay textarea →
  band readout → Back → Next. Assert the `document.activeElement` progression.
- **A11Y-S018-2-6 (heading order):** the CodStep sub-heading is an `<h3>`
  (`data-testid="cod-step-heading"`) under the wizard's `<h2>` — no skipped
  level introduced; axe `heading-order` passes.
- **A11Y-S018-2-7 (visible focus):** every radio, textarea, and the step-nav
  buttons show a visible `:focus-visible` indicator (`--focus-ring`); assert a
  non-empty computed box-shadow/outline on focus.
- **A11Y-S018-2-8 (target size):** each radio's hit box and the step-nav buttons
  are ≥ 24×24 CSS px (WCAG 2.2 §2.5.8); assert bounding-box width AND height ≥ 24.
- **A11Y-S018-2-9 (band readout live + non-colour):** the CodScoreReadout is
  `role="status"` `aria-live="polite"`; the band is conveyed by the visible WORD
  (HIGH/MED/LOW + tier sentence), NOT colour alone (assert the band word text
  node is present; any colour accent is redundant).
- **A11Y-S018-2-10 (contrast):** the band readout text (band word + reason) is
  ≥ 4.5:1 on `--c-surface-raised`; axe `color-contrast` passes for the readout
  and all three Value option labels.
- **A11Y-S018-2-11 (shell de-emphasis NOT regressed):** the inherited UC-S018-1
  e2e a11y pin (`e2e/intake-wizard-a11y.spec.js` "targeted" test — planned-step
  cumulative opacity = 1, ≥ 4.5:1, no opacity keyframe) STILL passes with step 2
  now live (CodStep introduces no opacity animation and no alpha de-emphasis).

### Geometry / visual-structural correctness — tester-enforced via bbox/computed style
- **GEO-S018-2-1 (step swap = zero external reflow):** advancing from step 1 to
  step 2 (placeholder → live CodStep) changes only content INSIDE the fixed
  drawer — the value-stream map bounding box AND `.observatory-main-col`
  scrollHeight are BYTE-IDENTICAL before vs after the swap (the drawer is
  `position:fixed`, zero flow height — same guard as GEO-S018-1-1). Assert
  getBoundingClientRect equality of `[data-testid="value-stream-map"]` and
  scrollHeight equality of `.observatory-main-col` across the step-1→step-2 swap.
- **GEO-S018-2-2 (CoD signals stack):** the three signal groups (Value /
  Urgency / Risk-of-delay) stack vertically — group top offsets strictly
  increase, shared left offset (a form column, not a row); assert monotonic tops
  + shared left (the s002-line guard applied to the CoD step).
- **GEO-S018-2-3 (drawer stays on-screen):** with step 2 live, the wizard's
  bounding box still sits fully within the viewport (right edge ≤ innerWidth, no
  document horizontal scrollbar) — the wider CoD content does not push the
  drawer off-screen or introduce horizontal scroll.

### Figure legibility (FIG) — the live band readout
- **FIG-S018-2-1 (band reads as words):** when both Value and Urgency are chosen,
  the readout text contains the band WORD plus its tier sentence (e.g. "HIGH" AND
  /top tier/i for HIGH; /middle tier/i for MED; /bottom tier/i for LOW) and the
  next-step hint (/rank|next step/i). It contains NONE of "undefined", "null",
  "NaN", and is NOT a bare number.
- **FIG-S018-2-2 (value tokens never bare):** each of the three Value radio
  options' visible label contains BOTH the token AND its plain-language sentence
  (e.g. "HIGH" AND "directly impacts the team's ability to deliver"); the token
  never stands alone as the label.
- **FIG-S018-2-3 (empty inputs ≠ a score):** on first render of step 2 (nothing
  chosen), the readout shows a NEUTRAL prompt (e.g. /choose a value and urgency/i),
  NOT a band word, NOT "MED", NOT "0", NOT blank; `data-cod-band` is absent.
  Selecting only Value (urgency still unchosen) still shows the neutral/incomplete
  prompt, not a band.

### No-write contract (NO-WRITE)
- **NOWRITE-S018-2-1:** changing any Value radio, Urgency radio, "why now" or
  risk-of-delay textarea, and pressing Back/Next on step 2 issue ZERO network
  requests with a write method (POST/PUT/PATCH/DELETE) — assert via the fetch/XHR
  spy across the full step-2 interaction. (Step 2, like step 1, issues no network
  call at all; the scorer is pure client-side.)
- **NOWRITE-S018-2-2:** the server write-guard remains active (write probe → 405)
  — the SM-CHK7-6 regression guard still passes.

### Selectors (SEL) — the build/test contract (stable, role-first)
- **SEL-S018-2-1:** CodStep resolvable by `[data-testid="cod-step"]`; its
  sub-heading by `[data-testid="cod-step-heading"]` (`<h3>`).
- **SEL-S018-2-2:** Value group resolvable by `getByRole('radiogroup', { name:
  /value/i })` and `[data-testid="cod-value"]`; options by their role+name and
  `[data-testid="cod-value-high|cod-value-med|cod-value-low"]` /
  `[data-value="HIGH|MED|LOW"]`.
- **SEL-S018-2-3:** Urgency group resolvable by `getByRole('radiogroup', { name:
  /urgency/i })` and `[data-testid="cod-urgency"]`; options by
  `[data-testid="cod-urgency-yes|cod-urgency-no"]` / `[data-urgency="yes|no"]`.
- **SEL-S018-2-4:** the two textareas resolvable by their role+name and
  `[data-testid="cod-urgency-why"]` / `[data-testid="cod-risk"]`.
- **SEL-S018-2-5:** band readout resolvable by `[data-testid="cod-score-readout"]`
  with `role="status"`; the band word carries `[data-cod-band="HIGH|MED|LOW"]`
  when scored (absent when incomplete). No derived `nth(N)`/text-exclusion
  selectors.

### Step-navigation (step-2-specific) — observable behaviour
- **NAV-S018-2-1:** when `currentStep` is step 2, the WizardStepIndicator marks
  step 2 `data-step-state="current"` / `aria-current="step"`, and the live
  `CodStep` (`[data-testid="cod-step"]`) renders in the step-2 slot in place of
  the `wizard-step-placeholder` (the placeholder is gone for step 2).
- **NAV-S018-2-2:** pressing "Back" from step 2 returns to step 1 with the JTBD
  draft preserved AND, on returning to step 2, the previously chosen CoD signals
  (Value, Urgency, textareas) are still set — the wizard's lifted draft is
  retained while the drawer stays open (no reset on step navigation).

---

## UC-S018-3 — Queue-rank preview (THIS UC)

The real `QueueRankStep` + `useQueueRank` hook + the pure `queueRank.js`
directional-rank fn, replacing step-3's `wizard-step-placeholder`. Inherits the
UC-S018-1/2 shell contract (drawer, focus/Esc, step machine, indicator +
de-emphasis rule, nav, lifted CoD draft + `codScore`) — those conditions are NOT
re-stated and MUST NOT regress. These conditions are step-3-specific.

### Functional (from use-cases.md — restated for the tester)
- AC-S018-3-1: the rank preview text contains a DIRECTIONAL count — "ahead of N
  items" AND "behind M items" (tier-word form, e.g. "Your item (HIGH value)
  would rank ahead of N items and behind M") where N and M are non-negative
  integers matching the comparison-set (non-terminal items) counts from the live
  items.csv. `data-rank-ahead="N"` / `data-rank-behind="M"` cross-check the text.
- AC-S018-3-2: `useQueueRank` issues exactly ONE GET `/api/projects/:id/items`
  (plus the active-project resolve) and ZERO write requests during the rank
  preview — assert via a fetch/XHR spy: exactly one items GET, no write method.
- AC-S018-3-3: changing the Value selector (step 2) from HIGH to LOW and
  returning to step 3 updates the rank preview counts (ahead increases, behind
  decreases) WITHOUT a page reload AND WITHOUT a second items GET (the rank is
  re-derived from the already-fetched items; assert the GET count is still 1).
- AC-S018-3-4: if the items endpoint returns an empty or header-only CSV
  (`items === []`), the preview renders the empty-queue sentence gracefully
  ("The queue is currently empty — your item would be next."), `data-rank-total="0"`,
  NOT "ahead of 0 and behind 0", NOT an error, NOT blank.

### Rank-fn output contract (RANK) — UI-designer co-authored
- **RANK-S018-3-1 (shape):** `rankPreview({token, items})` returns
  `{ complete, total, ahead, behind, alongside, token, sentence, empty }` —
  `complete` boolean, `total`/`ahead`/`behind`/`alongside` non-negative ints,
  `token` ∈ HIGH|MED|LOW|null, `sentence` string, `empty` boolean.
- **RANK-S018-3-2 (totality / purity):** defined for every input including
  `token===null`, `items===[]`, and records with unknown/blank `value` strings;
  never throws; no DOM access; no network call (assert calling the fn issues no
  fetch — it is pure).
- **RANK-S018-3-3 (incomplete → gated, not a rank):** with `token===null`,
  `complete===false`, `sentence===""`, and all counts 0 — the gated case yields
  NO fabricated rank.
- **RANK-S018-3-4 (counts add up):** `ahead + behind + alongside === total` for
  every input (same-tier peers are counted as `alongside`, never silently dropped).
- **RANK-S018-3-5 (comparison set = non-terminal):** the comparison set EXCLUDES
  `done` and `dropped` items and INCLUDES `planned|unconfirmed|in-flight|active`;
  assert `total` equals the count of non-terminal items in a fixed fixture (and
  that adding a `done`/`dropped` row does not change `total`).
- **RANK-S018-3-6 (tier normalisation — real-data nuance):** a backlog record
  with `value="MED-HIGH"` ranks AHEAD of a MED wizard item and BEHIND a HIGH one;
  a blank/unknown `value` is counted at the MED-equivalent ordinal (NOT dropped,
  NOT treated as 0). Assert via a fixture containing a `MED-HIGH` and a blank-value
  record.

### Accessibility (AA) — UI-designer co-authored, tester-enforced
- **A11Y-S018-3-1 (labelled status region):** the rank preview is a
  `role="status"` `aria-live="polite"` element (`data-testid="rank-preview"`)
  inside a `role="group"` (`data-testid="queue-rank-step"`) with an accessible
  name matching `/queue rank/i` (`aria-labelledby` → the `<h3>`). Assert role +
  aria-live attributes present and the group's accessible name.
- **A11Y-S018-3-2 (heading order):** the QueueRankStep sub-heading is an `<h3>`
  (`data-testid="rank-step-heading"`, "Queue rank") under the wizard's `<h2>` —
  no skipped level introduced; axe `heading-order` passes.
- **A11Y-S018-3-3 (within-step focus order):** forward Tab order within step 3 is
  the rank-step region (the sentence is a `role=status`, not a tab stop) → Back →
  Next. Assert the `document.activeElement` progression reaches Back then Next; the
  rank sentence is NOT a focus stop.
- **A11Y-S018-3-4 (visible focus):** the step-nav buttons (Back/Next) show a
  visible `:focus-visible` indicator (`--focus-ring`); assert a non-empty computed
  box-shadow/outline on focus.
- **A11Y-S018-3-5 (target size):** the Back/Next buttons are ≥ 24×24 CSS px
  (WCAG 2.2 §2.5.8); assert bounding-box width AND height ≥ 24.
- **A11Y-S018-3-6 (contrast):** the rank sentence text is ≥ 4.5:1 on its surface
  (`--c-surface-raised`); axe `color-contrast` passes for the rank preview and the
  loading/empty/error/gated copy.
- **A11Y-S018-3-7 (live announce, not spammed):** the rank sentence updates are
  announced via the polite live region; a tier re-derivation flips the sentence at
  most once per change (not per keystroke — only the discrete Value/Urgency choice
  changes the tier). Assert `role=status` + `aria-live="polite"`.
- **A11Y-S018-3-8 (shell contract NOT regressed):** the inherited UC-S018-1 e2e
  a11y pin (planned-step de-emphasis = colour+size+text, NO alpha/opacity keyframe)
  STILL passes with step 3 now built (step 3 loses its "(soon)" tag; step 4
  remains planned and de-emphasised the same way).

### Geometry / visual-structural correctness — tester-enforced via bbox/computed style
- **GEO-S018-3-1 (step swap = zero external reflow):** advancing from step 2 to
  step 3 (placeholder/CodStep → live QueueRankStep) changes only content INSIDE the
  fixed drawer — the value-stream map bounding box AND `.observatory-main-col`
  scrollHeight are BYTE-IDENTICAL before vs after the swap (the drawer is
  `position:fixed`, zero flow height — same guard as GEO-S018-1-1/2-1). Assert
  getBoundingClientRect equality of `[data-testid="value-stream-map"]` and
  scrollHeight equality of `.observatory-main-col` across the step-2→step-3 swap.
- **GEO-S018-3-2 (rank-step content stacks):** the rank-step content (heading →
  sentence → any detail line → nav) STACKS vertically — top offsets strictly
  increase, shared left offset (a column, not a row); assert monotonic tops +
  shared left (the s002-line guard applied to step 3).
- **GEO-S018-3-3 (drawer stays on-screen):** with step 3 live, the wizard's
  bounding box still sits fully within the viewport (right edge ≤ innerWidth, no
  document horizontal scrollbar).

### Figure legibility (FIG) — the directional rank sentence
- **FIG-S018-3-1 (directional sentence legibility):** with a chosen tier and a
  populated backlog, the rank sentence contains the wizard item's tier as a WORD
  (e.g. "HIGH value" / "MED value" / "LOW value"), the words "ahead of" AND
  "behind", and the unit "items" on the counts; it contains NONE of "undefined",
  "null", "NaN", and the counts are real integers (not bare unitless numbers).
- **FIG-S018-3-2 (tier words, not enums; no raw ids):** the ahead/behind sets are
  summarised by tier-word + count (or the directional count), NEVER by dumping
  raw machine ids (no `UC-S018-x` / `row:N` token appears in the primary
  sentence); if an optional detail line names items, it does so only for a small
  set (≤ 2) AND with the human job sentence, never a bare id.
- **FIG-S018-3-3 (loading ≠ empty ≠ error ≠ gated — distinct states):** the four
  states render textually-DISTINCT copy with distinct testids:
  `rank-loading` ("Reading the live queue…") ≠ the empty-queue `rank-preview`
  sentence (`data-rank-total="0"`) ≠ `rank-error` (fail-soft "couldn't read the
  live queue") ≠ `rank-gated` ("finish step 2"). Assert each state renders its own
  copy and the others are absent. The gated state shows NO rank/number; the error
  state shows NO fabricated rank; the empty state is NOT an error.
- **FIG-S018-3-4 (counts add up / empty ≠ zero):** when populated,
  `data-rank-ahead + data-rank-behind + alongside === data-rank-total`; when the
  backlog is empty the sentence is the empty-queue form (NOT "ahead of 0 and
  behind 0"); a `done`/`dropped` item is never counted (RANK-S018-3-5 surface).

### Read-only / no-write contract (READ-ONLY)
- **NOWRITE-S018-3-1 (exactly one GET, zero writes):** across the full step-3
  interaction (entry, a tier re-derivation, Back, Next) the network spy records
  exactly ONE GET `/api/projects/:id/items` (plus the active-project resolve) and
  ZERO requests with a write method (POST/PUT/PATCH/DELETE). No second GET on a
  Value-radio change.
- **NOWRITE-S018-3-2 (no fetch before step 3):** opening the wizard and staying on
  steps 1–2 issues NO items GET — the read fires only on step-3 entry (assert the
  spy records zero items GETs while `currentStep < 3`).
- **NOWRITE-S018-3-3 (write-guard active):** the server write-guard remains active
  (write probe → 405) — the SM-CHK7-6 regression guard still passes.

### Selectors (SEL) — the build/test contract (stable, role-first)
- **SEL-S018-3-1:** QueueRankStep resolvable by `getByRole('group', { name:
  /queue rank/i })` and `[data-testid="queue-rank-step"]`; its sub-heading by
  `[data-testid="rank-step-heading"]` (`<h3>`).
- **SEL-S018-3-2:** the rank sentence resolvable by `[data-testid="rank-preview"]`
  with `role="status"`; the numeric cross-checks `[data-rank-ahead]` /
  `[data-rank-behind]` / `[data-rank-total]` present when a rank is shown (absent
  in the gated state).
- **SEL-S018-3-3:** the loading / error / gated states resolvable by
  `[data-testid="rank-loading"]` / `[data-testid="rank-error"]` /
  `[data-testid="rank-gated"]` respectively. No derived `nth(N)`/text-exclusion
  selectors.

### Step-navigation (step-3-specific) — observable behaviour
- **NAV-S018-3-1:** when `currentStep` is step 3, the WizardStepIndicator marks
  step 3 `data-step-state="current"` / `aria-current="step"`, step 3 has LOST its
  "(soon)" tag (now built), and the live `QueueRankStep`
  (`[data-testid="queue-rank-step"]`) renders in the step-3 slot in place of the
  `wizard-step-placeholder` (the placeholder is gone for step 3; it survives only
  for step 4).
- **NAV-S018-3-2:** pressing "Back" from step 3 returns to step 2 with the CoD +
  JTBD draft preserved; returning to step 3 re-shows the rank WITHOUT a second
  items GET (the items set is cached for the wizard session; the rank re-derives
  from the lifted `codScore`).
- **NAV-S018-3-3 (gated path):** if the operator reaches step 3 with an incomplete
  CoD step (`codScore.complete === false`), step 3 shows the `rank-gated` prompt
  to finish step 2 (NOT a rank, NOT a crash); completing step 2 and returning shows
  the real rank.
