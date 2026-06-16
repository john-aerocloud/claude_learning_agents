# UI design — s018 Guided cost-of-delay intake (UC-S018-1: wizard shell + JTBD step 1)

Applies: **yes** — a new user-facing surface (the intake wizard) plus a new
launcher affordance in the main-column header.

Mode: STRUCTURE (before the engineer). Scope of THIS UC = the wizard SHELL +
step 1 (JTBD three-field capture with a live job-sentence preview) + its launch
IA. Steps 2–4 (CoD signals, queue-rank preview, prompt + copy handoff) are
UC-S018-2/3/4 — designed as visibly-planned step slots here, NOT built.

---

## IA decision (the dispatch question: 4th ViewSwitch tab vs action-launched drawer)

**Decision: an action-launched, body-portalled floating DRAWER, opened by a
persistent "New Work" launcher button placed in the main-column header beside
the `ViewSwitch` tablist.** NOT a 4th ViewSwitch tab.

Rationale (weighed exactly as the brief framed it):

- **The wizard is a FLOW, not a view.** Pipeline / In-flight WIP / Defects are
  read-only at-a-glance *views* of existing state — switching between them is
  lossless and stateful-free. The intake wizard COLLECTS multi-step input and
  ends in a handoff; it owns transient draft state and a terminal action. A
  routed view that unmounts on tab-switch (the ViewSwitch contract:
  hidden-AND-empty inactive tabpanel) would silently DISCARD a half-typed job
  sentence the instant the operator glanced at Pipeline. A drawer preserves the
  flow's state independently of which view is behind it. (This is the decisive
  factor.)
- **The "sidebar nav" in the slice/use-cases seam note does NOT exist.** The
  delivered layout is `[WorkItemTree rail] | [.observatory-main-col: ViewSwitch
  + tabpanels] | [floating drawer layer]` — there is no sidebar nav surface to
  add a "New Work" entry to. Spec'ing one would be inventing a brand-new nav
  region for a single launcher. The launcher button beside the tablist reuses
  the header the operator already reads on every load. (Seam-note correction —
  flagged to the engineer below.)
- **Discoverability for "add work" is met** by a persistent, always-visible,
  primary-styled button labelled "New Work" (`+ New Work`) — it is on screen at
  0 clicks on every view, not buried in a menu.
- **Click-path ≤ 2 honoured at 1 click** — see budget below.
- **Reuses the proven drawer family** (DetailPane / SteerPanel /
  ReslicePreviewPanel / DefectDrill — four existing consumers of the DEFECT-006
  idiom): `position:fixed`, portalled to `document.body`, own stacking context
  above the map, NON-modal, no scrim. This makes SM-CHK7-7 / AC-S018-1-3 / the
  GEO condition true BY CONSTRUCTION (a body-portalled fixed overlay has zero
  flow height — it cannot reflow the map or any view), exactly as the WIP/steer
  drawers already prove in tests.

### Why NOT a 4th tab (the rejected option, recorded)
- Would extend the `view` union (`pipeline|wip|defects` → `…|intake`) and the
  `TABS` table, the `ViewSwitch` roving-tabindex cycle (3→4 tabs), and add a 4th
  `<div role="tabpanel">` to ObservatoryView — a LARGER composition-root delta
  than the drawer, touching the very S13UC2→S15UC2 hidden-edge seam the brief
  warns about (every tab extension touches ObservatoryView's routing union).
- Would make a stateful flow behave like a stateless view (loses draft on
  switch — the data-loss footgun above).
- A view is for *observing*; a tab in this tablist sets the reader's
  expectation "this is another read-only lens on existing work". The wizard is
  an authoring action — different affordance class.

### Hidden-edge seam containment (S13UC2→S15UC2: ObservatoryView is the join)
The drawer choice keeps the ObservatoryView delta MINIMAL and additive — it does
NOT touch the ViewSwitch routing union at all:
- ADD one piece of lifted state: `const [intakeOpen, setIntakeOpen] = useState(false);`
- ADD the launcher into the main-column header: render `<IntakeLauncher
  onOpen={() => setIntakeOpen(true)} />` as the FIRST child of
  `.observatory-main-col`, immediately before `<ViewSwitch …/>` (a header row
  wrapping the launcher + the tablist; see GEO note — the tablist must keep its
  existing position/behaviour, the launcher sits to its left or right within a
  flex header).
- ADD one drawer sibling at the END of `.observatory-layout`, alongside the
  existing drawer siblings (DetailPane / SteerPanel / ReslicePreviewPanel):
  `{intakeOpen ? <IntakeWizard onClose={() => setIntakeOpen(false)} /> : null}`.
- The `view` union, the `TABS` table, every existing tabpanel, VsmContainer,
  WipPanel, DefectsPanel — **UNCHANGED**. The drawer is orthogonal to the routed
  views (it floats over whichever view is active).

**Retro candidate (note, do NOT design in now):** ObservatoryView is now the
single composition root for THREE routed views + FOUR floating drawers
(DetailPane, SteerPanel, ReslicePreviewPanel, IntakeWizard) + the steer dispatch
switch. A standing **drawer-registry / layer-manager** refactor (one declarative
table of `{open, render}` drawer entries, like `TABS` is for views) would make
each new drawer a one-row addition instead of a new JSX sibling + a new
useState. Defer to retro — adding it now is scope creep on a shell UC.

---

## Surfaces touched
- **`.observatory-main-col` header** (existing) — gains a persistent
  `IntakeLauncher` button beside the `ViewSwitch` tablist. The tablist's
  position/roving behaviour is unchanged; the header becomes a flex row.
- **Floating drawer layer** (existing DEFECT-006 overlay) — gains the
  `IntakeWizard` drawer as a new body-portalled consumer. New surface.

---

## Navigation / IA delta
```
[WorkItemTree rail] | .observatory-main-col                       | [drawer layer]
                    |   ┌─ header (flex) ─────────────────────┐   |   DetailPane
                    |   │ [+ New Work]   ViewSwitch tablist    │   |   SteerPanel
                    |   └───────────────────────────────────────┘ |   ReslicePreviewPanel
                    |   tabpanel: Pipeline | WIP | Defects        |   IntakeWizard  ← NEW (floats)
```
- Entry point: the persistent "+ New Work" launcher (0-click visible, 1-click
  open) — on screen regardless of active view.
- Hierarchy: the wizard is a modal-less FLOW that floats over the dashboard; the
  dashboard (map/views) stays fully readable beside/behind it (the "whole and
  the part" idiom — non-modal, no scrim, like SteerPanel).
- Back/cancel/exit: × (close button, top-right), Esc, and "Cancel" — all close
  the drawer and **return focus to the launcher button** (the originating
  trigger), the established drawer focus-return contract. Entered field text is
  preserved while the drawer stays open; closing discards the draft (no
  cross-session persistence — explicitly out of scope per slice.md).

---

## Component decomposition (component → states → stable selector)

### IntakeLauncher (NEW — primary launcher button)
- **Role:** the persistent "add new work" affordance in the main-column header.
- **Props:** `{ onOpen() }` (pure).
- **States:** default · hover · focus-visible (`--focus-ring`) · active.
- **Selector:** `getByRole('button', { name: 'New Work' })`,
  `data-testid="intake-launcher"`. Native `<button type="button">`. The `+`
  glyph is `<span aria-hidden="true">` — accessible name is the text "New Work".
- **A11y:** hit box ≥ `--target-min`; keyboard-operable (native button);
  visible label text (never icon-only). Sits in the header but is NOT a tab —
  it is OUTSIDE the `role="tablist"` so it does not enter the roving-tabindex
  cycle (it is its own tab stop). Primary-action styling (filled, `--c-focus`
  accent) so it reads as the page's primary author action without competing
  with the tablist's selection band.
- **Library:** custom (token-based; reuses `--c-focus`/`--radius-badge`/
  `--target-min`/`--focus-ring`/`--sp-*`; no new token).

### IntakeWizard (NEW — the wizard shell drawer; THIS UC's spine)
- **Role:** the body-portalled, non-modal floating drawer hosting the guided
  intake flow. THIS UC delivers the SHELL (header + step indicator + step-1
  region + step nav) and STEP 1 ONLY. The CoD / rank / prompt regions are
  rendered as visibly-planned step SLOTS (see step nav below), not as live
  steps.
- **Props (THIS UC):** `{ onClose() }`. (UC-S018-2/3/4 add the step state +
  field-value lift; the shell owns the wizard step-index state machine — that IS
  this UC's "step container + step state machine" per the seam note.)
- **Drawer idiom (REUSES the DEFECT-006 / SteerPanel family — style reuse, NOT
  component composition):** `position:fixed`, portalled to `document.body`,
  `--z-drawer` (or `--z-drawer + 1` if it may co-open with a steer drawer —
  engineer to confirm; default `--z-drawer`), `--drawer-inset` / `--drawer-elev`
  / `--dur-drawer` (0ms under `prefers-reduced-motion`), NON-modal, NO scrim.
  Width: `min(480px, 90vw)` (a touch wider than `--drawer-width` 440px — the
  wizard hosts three labelled fields + a preview; engineer may reuse
  `--drawer-width` if it reads fine, else add `--wizard-width` ONCE). Zero flow
  height by construction → no reflow of the map/views (GEO + SM-CHK7-7).
- **States:** closed (absent — zero flow height) · open · step-1 (the only
  functional step this UC) · later-step-PLANNED (step 2/3/4 indicator dots
  visible but not navigable — see step nav).
- **Selector:** `getByRole('dialog', { name: /new work|intake/i })` — NON-modal
  (no `aria-modal`), `aria-labelledby` → the `<h2>` heading; `data-testid=
  "intake-wizard"`. Heading `<h2>` `data-testid="intake-wizard-heading"`
  `tabindex="-1"` (text e.g. "New work — describe the job", takes focus on open,
  the WipPanel/DefectDrill heading-focus idiom). Close × `getByRole('button',
  { name: /close/i })`, `data-testid="intake-wizard-close"` (× last in DOM,
  CSS-positioned top-right).
- **A11y:** focus → heading on open; Esc / × close and **return focus to the
  IntakeLauncher**; NON-modal (no focus trap — the map/tree stay operable);
  close target ≥ `--target-min`; `--focus-ring`.
- **Library:** custom (drawer-family style reuse; no off-token values).

### WizardStepIndicator (NEW — progress / step affordance)
- **Role:** shows the four steps of the flow and which is current, so the
  operator sees the wizard is multi-step and where they are. Makes the
  later-steps-PLANNED-not-dead promise visible.
- **Props:** `{ steps: {key,label}[]; currentKey; reachableKeys }`.
- **Steps (labels, operator language):** 1 "Describe the job" · 2 "Cost of
  delay" · 3 "Queue rank" · 4 "Generate prompt".
- **States (per step):** current (`aria-current="step"`) · complete · upcoming
  · **planned-not-yet-built** (THIS UC: steps 2–4 — rendered, visibly
  de-emphasised, NOT activatable; see step nav for the click behaviour).
- **Selector:** `role="list"` `aria-label="Intake steps"`,
  `data-testid="wizard-steps"`; each step
  `data-testid="wizard-step-<1..4>"` + `data-step-state="current|complete|
  upcoming|planned"`; current carries `aria-current="step"`.
- **A11y:** ordered list; step state is text + shape, never colour alone (number
  badge + label text authoritative; `--c-*` band redundant). The planned steps
  carry visible text "(soon)" so "planned-not-dead" is announced, not inferred
  from a greyed colour.
- **Library:** custom (token-based; reuses the labelled-list idiom).

### JtbdFields (NEW — the step-1 three-field capture group)
- **Role:** the three prompting JTBD inputs that assemble the job sentence.
- **Props:** `{ situation, motivation, outcome, onChange(field, value) }`.
- **Fields (each a labelled control — AC-S018-1-1):**
  - Situation — `<label>` "Situation (when…)", placeholder e.g. "the loop
    starves because no UI work is queued".
  - Motivation — `<label>` "Motivation (I want to…)", placeholder "see which
    queue is empty at a glance".
  - Outcome — `<label>` "Outcome (so I can…)", placeholder "replenish before the
    constraint goes idle".
  Single-line `<input>` or auto-grow `<textarea>` — engineer's call; labels +
  placeholders are the contract.
- **States (per field):** default · focus-visible · filled · empty.
- **Selector:** each field `getByRole('textbox', { name: /situation/i |
  /motivation/i | /outcome/i })`; `data-testid="jtbd-situation|jtbd-motivation|
  jtbd-outcome"`; associated `<label for>` (programmatic label, AC-S018-1-1).
- **A11y:** every field has an associated visible `<label>` (not placeholder-as-
  label); logical tab order Situation → Motivation → Outcome → preview-region →
  step nav; `--focus-ring`; hit box ≥ `--target-min`.
- **Library:** custom (token-based form fields; reuses the `.intent-note` field
  styling from SteerPanel where it fits — confirm with engineer).

### JobSentencePreview (NEW — the live composed-sentence figure; THE FIG surface)
- **Role:** the live, human-readable job sentence assembled from the three
  fields as the operator types (AC-S018-1-2 / SM-CHK7-1). This is the FIGURE of
  this UC — it must read as a SENTENCE, never a raw concatenation with empty
  slots reading "undefined".
- **Props:** `{ situation, motivation, outcome }`.
- **Composition rule (FIG contract — see conditions):** the template is
  "When [situation], I want to [motivation], so I can [outcome]." Each empty
  field renders a neutral, readable PLACEHOLDER token in its slot (e.g. a
  dimmed "…" or "[when something happens]"), NEVER the literal strings
  "undefined" / "null" / an empty gap that breaks the sentence grammar. When
  ALL three are empty the preview shows a single neutral prompt line ("Start
  typing to build your job sentence") — not a sentence skeleton full of
  placeholders, and not blank.
- **States:** empty (all three blank → neutral prompt line) · partial (some
  filled → readable sentence with placeholders for the gaps) · complete (a clean
  human sentence).
- **Selector:** `data-testid="job-sentence-preview"`; `role="status"`
  `aria-live="polite"` so each composed update is announced once (not spammed —
  debounce/throttle if needed). Accessible name = the composed sentence text.
- **A11y:** live region (polite); contrast ≥ 4.5:1 on `--c-surface-raised`;
  placeholder slots use `--c-text-dim` (≥ 4.5:1, AND distinct from the filled
  text so the operator can SEE which slots are still empty — but the sentence
  still reads).
- **Library:** custom (token-based; reuses `--fs-label`/`--c-text`/
  `--c-text-dim`; no new token).

### WizardStepNav (NEW — step navigation; only step 1 functional this UC)
- **Role:** the wizard's forward/back controls. THIS UC: "Next: Cost of delay"
  advances the step-index state machine to step 2. Step 2's region is a
  visibly-PLANNED placeholder (UC-S018-2 builds the real CodStep into it) — so
  "Next" is NOT dead: it moves the indicator to step 2 and shows a labelled
  "Coming next: cost-of-delay signals" placeholder region (no crash, no dead
  button). Back returns to step 1. This satisfies the "later steps
  visibly-planned-not-dead: state what a click does" requirement.
- **What "Next" does (THIS UC):** advances `currentStep` 1→2; the step-2 region
  renders a labelled placeholder `data-testid="wizard-step-placeholder"` reading
  "Cost-of-delay signals — coming in this wizard"; the step indicator marks step
  2 current. NO write, no validation gate this UC (the JTBD fields are not yet
  required-gated — that is a UC-S018-2/3 concern as the flow fills out).
- **Props:** `{ currentStep, canAdvance, onNext, onBack }`.
- **States:** Next default · Next disabled (`aria-disabled` — not used this UC;
  reserved for later gating) · Back default · Back hidden (on step 1).
- **Selector:** Next `getByRole('button', { name: /next/i })`,
  `data-testid="wizard-next"`; Back `getByRole('button', { name: /back/i })`,
  `data-testid="wizard-back"` (absent on step 1).
- **A11y:** native buttons; keyboard-operable; hit box ≥ `--target-min`;
  `--focus-ring`; disabled (when later used) is `aria-disabled` + non-colour
  inset cue.
- **Library:** custom (token-based).

---

## Click-path budget (per use case, with justification)

| Job (this UC) | Budget | Reality |
|---|---|---|
| "Start capturing a new work idea" (J4 entry) | **≤ 2 clicks → met at 1** | "+ New Work" launcher is 0-click visible; ONE click opens the wizard focused on the heading; the Situation field is one Tab away. Justified: the launcher is persistent (no menu to open first), the drawer opens directly to step 1. |
| "See my idea as a job sentence" (SM-CHK7-1) | **0 clicks after opening** | the JobSentencePreview updates live on every keystroke; no submit/refresh step. |
| "Cancel / back out" | **1 click / 1 key** | × · Cancel · Esc — focus returns to the launcher. |
| "Advance to cost-of-delay" (toward UC-S018-2) | **1 click** | "Next: Cost of delay" advances the step machine. |

No step is added that a default can remove: the launcher pre-opens to step 1,
the preview needs no submit, the heading auto-focuses.

---

## Figure legibility (the live preview — applies the standing checklist)
The JobSentencePreview is the only data-bearing figure this UC; it must pass:
1. **Reads as a sentence** — composed via the fixed template, never a bare
   field concatenation.
2. **Empty/unknown ≠ broken** — empty slots render a readable placeholder, never
   "undefined"/"null"/a grammar-breaking gap; all-empty renders a neutral prompt
   line, not a skeleton sentence.
3. **The operator can see what's still empty** — placeholder slots are visually
   distinct (`--c-text-dim`) yet the sentence stays readable.
(No units/rates apply — this UC has no numeric metric; CoD value token + queue
rank are UC-S018-2/3, where the count/unit rules will apply.)

---

## NO-WRITE contract (this UC and the whole slice)
The wizard writes ZERO bytes. THIS UC has no server call at all (step 1 is pure
client-side field state + sentence assembly). The server write-guard (405) check
stays active (SM-CHK7-6). No `fetch`/`POST`/`PUT`/`PATCH`/`DELETE` is issued on
open, on any keystroke, or on Next. (The first read call — GET /items for the
rank preview — arrives in UC-S018-3; still no write.)

---

## Accessibility conditions (AA) → mirrored into acceptance.md
See acceptance.md UC-S018-1 section for the testable AC-S018-1-A11Y / GEO / FIG /
NOWRITE / SEL cases. Summary: labelled fields, keyboard-operable + logical focus
order, focus-on-open to heading + focus-return-to-launcher on close, Esc closes,
visible focus ring, target sizes ≥ 24px, live-region preview, non-colour step
state, contrast ≥ AA, reduced-motion drawer.

---

## Stable selectors handed to the engineer (the build contract + test hooks)
| Element | Selector contract |
|---|---|
| Launcher | `getByRole('button', { name: 'New Work' })` · `data-testid="intake-launcher"` |
| Wizard drawer | `getByRole('dialog', { name: /new work|intake/i })` (non-modal) · `data-testid="intake-wizard"` |
| Wizard heading | `data-testid="intake-wizard-heading"` `tabindex="-1"` |
| Close × | `getByRole('button', { name: /close/i })` · `data-testid="intake-wizard-close"` |
| Step indicator | `role="list"` `aria-label="Intake steps"` · `data-testid="wizard-steps"`; steps `data-testid="wizard-step-<1..4>"` + `data-step-state` |
| Situation field | `getByRole('textbox', { name: /situation/i })` · `data-testid="jtbd-situation"` |
| Motivation field | `getByRole('textbox', { name: /motivation/i })` · `data-testid="jtbd-motivation"` |
| Outcome field | `getByRole('textbox', { name: /outcome/i })` · `data-testid="jtbd-outcome"` |
| Job-sentence preview | `data-testid="job-sentence-preview"` · `role="status"` `aria-live="polite"` |
| Next | `getByRole('button', { name: /next/i })` · `data-testid="wizard-next"` |
| Back | `getByRole('button', { name: /back/i })` · `data-testid="wizard-back"` (absent on step 1) |
| Step-2 placeholder | `data-testid="wizard-step-placeholder"` (visibly-planned region) |

---

## Engineer needs (hand-off)
1. **Seam-note correction:** the slice.md / use-cases.md "sidebar nav entry
   'New Work'" does not match the delivered layout (there is no sidebar nav).
   Build the launcher as `IntakeLauncher` in the `.observatory-main-col` header
   beside `ViewSwitch`, and the wizard as a drawer sibling in
   `.observatory-layout`. ObservatoryView delta = one `useState` + one header
   child + one conditional drawer sibling; the `view` union / `TABS` / tabpanels
   are UNCHANGED.
2. **Drawer idiom reuse, not component reuse:** reuse the SteerPanel /
   ReslicePreviewPanel drawer CSS idiom (fixed + body-portalled + drawer tokens
   + focus move/return + Esc/×). Do NOT compose `DetailPane.jsx` (item-coupled)
   or `SteerPanel.jsx` (steer-context-coupled). New `IntakeWizard.jsx`.
3. **Header becomes a flex row** hosting `[IntakeLauncher][ViewSwitch tablist]`.
   GEO: the ViewSwitch tablist keeps its existing position/roving behaviour and
   bounding box (do not regress the existing view-switch tests); the launcher is
   OUTSIDE `role="tablist"`.
4. **Step state machine** lives in `IntakeWizard.jsx` (this UC's owned scope);
   expose `currentStep` + Next/Back so UC-S018-2/3/4 mount their real steps into
   the existing step slots without re-architecting the shell.
5. **No new token unless needed:** prefer existing drawer/spacing/colour tokens;
   if the wizard width needs to differ from `--drawer-width`, add `--wizard-width`
   ONCE in tokens.css (additive), not an inline literal.
6. **TDD selectors above are the contract** — author the smoke/component specs
   against the role+name selectors, not derived `nth`/text-exclusion.

---

## NOT designed yet (deferred to later UCs / explicitly out)
- Queue-rank preview (UC-S018-3) — its step slot is planned-not-built.
- Intake prompt builder + copy/toast handoff (UC-S018-4) — its step slot is
  planned-not-built; reuses SteerPanel copy/toast then.
- Required-field validation gating on Next (arrives as the flow fills out in
  -2/-3).
- Mobile/responsive, draft persistence between sessions, WSJF/CD3 scoring,
  defect intake path, multi-project — all out per slice.md.
- The drawer-registry / layer-manager refactor of ObservatoryView — RETRO
  candidate, not designed in.

---
---

# UI design — UC-S018-2: Cost-of-delay signals step + value-token scorer

Applies: **yes** — the real step-2 content surface (the `CodStep` component)
that REPLACES the UC-S018-1 `wizard-step-placeholder` in the wizard's step-2
mount slot, plus its pure `codScorer.js` scoring fn.

Mode: STRUCTURE (before the engineer). Scope of THIS UC = the three CoD signal
inputs (Value selector + Urgency + Risk-of-delay), the deterministic
`codScorer.js` pure fn, and a live score/band readout — mounted INTO the
existing step-2 slot the shell already owns. The shell's step state machine,
step indicator, step nav, drawer/focus/Esc contract, and the planned-step
de-emphasis rule are UC-S018-1 and **MUST NOT be regressed**. The queue-rank
preview (UC-S018-3) consumes this step's scorer OUTPUT but is NOT built here.

---

## What the shell already guarantees (inherited, do-no-harm)
The delivered IntakeWizard (UC-S018-1) owns and this UC reuses unchanged:
- the **4-step state machine** + `currentStep` (the mount seam — CodStep mounts
  where `wizard-step-placeholder` currently renders for step 2);
- the **WizardStepIndicator** (step 2 marked `data-step-state="current"` /
  `aria-current="step"` when active) and its **de-emphasis rule** — planned
  steps are de-emphasised via COLOUR + size + "(soon)" text, **NEVER alpha**
  (A11Y-S018-1-12 rework, ratified in components.md). CodStep introduces no new
  de-emphasis channel and adds no opacity animation.
- the **drawer/focus/Esc/×/Cancel + focus-return-to-launcher** contract;
- the **WizardStepNav** (Next/Back); this UC adds Back→step-1 draft-preservation
  and step-2-current as testable step-2-specific conditions (NAV-S018-2-*).
- the **NON-MODAL, body-portalled, zero-flow-height** drawer (GEO basis): a step
  SWAP is an internal content change inside the fixed drawer — it reflows
  nothing outside (GEO-S018-2-1 below pins this).

This UC adds NO new design token and NO new drawer; it is a content component
mounted into an existing slot.

---

## Surfaces touched
- **IntakeWizard step-2 slot** (existing mount seam) — the
  `wizard-step-placeholder` is replaced by the live `CodStep` when `currentStep`
  is step 2. (The placeholder remains for steps 3–4 until -3/-4 build them.)
- **`src/app/lib/codScorer.js`** (NEW pure fn — no DOM, no fetch). The
  deterministic value-token rule; its OUTPUT is the UC-S018-3 / UC-S018-4
  contract (spec'd below).
- **`src/app/components/CodStep.jsx`** (NEW) — the three CoD inputs + the live
  band readout; pure render of lifted field state + the scorer result.

---

## Input idioms (accessible, design-system-consistent)

The decisive idiom question for each of the three signals — radio group vs
select vs checkbox vs textarea — resolved against the design system and WCAG:

### Value — a RADIO GROUP, not a `<select>` (decision, recorded)
- **Three mutually-exclusive options, EACH with a one-line plain-language
  description that must be VISIBLE** (slice.md: "HIGH — directly impacts the
  team's ability to deliver"; "MED — improves the experience but work continues
  without it"; "LOW — nice-to-have"). A `<select>` hides those descriptions
  behind a click and reduces each option to a bare token — violating the FIG
  "no raw token alone" rule and adding an interaction step. A **radio group**
  shows all three labelled options at once (0 extra clicks to read them) and is
  the canonical single-select-from-small-labelled-set idiom.
- **Token integrity:** the radio LABEL is the human description; the bare token
  (HIGH/MED/LOW) is shown WITH it, never alone (FIG-S018-2-2).
- Rejected: `<select>` (hides descriptions, +1 click, FIG violation); a custom
  listbox (heavier ARIA than native radios buy us nothing here).

### Urgency — a yes/no RADIO GROUP + a labelled "why now" textarea
- slice.md: "time-critical? yes/no + free text 'why it matters now'". The yes/no
  is the binary the SCORER reads → a 2-option radio group ("Yes — time-critical"
  / "No — not time-sensitive"). The "why now" is operator prose for the prompt
  (UC-S018-4) and does NOT affect the score → a labelled, **optional** textarea
  reusing the `.intent-note` field treatment.
- Rejected: a single checkbox for time-critical (a lone checkbox's
  checked/unchecked state is less scannable than an explicit Yes/No pair, and the
  scorer's "no urgency" branch reads more clearly off an explicit No than off an
  unchecked box). A radio pair makes the binary an explicit, labelled choice.

### Risk-of-delay — a single labelled OPTIONAL textarea
- slice.md: "what worsens if this is deferred? free text, optional". Pure prose
  for the prompt; does NOT feed the scorer this slice. Labelled textarea, reuses
  `.intent-note`. Empty is valid (→ "n/a" downstream, UC-S018-4).

---

## The deterministic scorer — `lib/codScorer.js` (pure fn, the cross-UC contract)

**Signature (pure, no DOM, no fetch — unit-testable in isolation, AC-S018-2-4):**
```js
// scoreCod(signals) -> CodScore
scoreCod({ value, timeCritical })
```

**Input** (`signals`):
| field | type | source | notes |
|---|---|---|---|
| `value` | `'HIGH' \| 'MED' \| 'LOW' \| null` | Value radio group | `null` = not yet chosen |
| `timeCritical` | `boolean \| null` | Urgency yes/no radio | `null` = not yet chosen |

(The `urgencyWhy` and `riskOfDelay` free-text fields are NOT scorer inputs — they
are prompt material only, carried in the wizard's lifted state for UC-S018-4.)

**Rule (verbatim from slice.md §2 / AC-S018-2):**
- `value === 'HIGH'` AND `timeCritical === true` → token `'HIGH'`
- `value === 'LOW'` AND `timeCritical === false` → token `'LOW'`
- **every other combination of CHOSEN values** → token `'MED'`
- **inputs incomplete** (`value` is `null` OR `timeCritical` is `null`) →
  `token: null`, `complete: false` — NOT a default of MED, NOT a score (the
  empty-inputs≠-a-score FIG rule; an unchosen signal must not silently read as
  a real MED band).

**Output shape (`CodScore`) — the UC-S018-3 + UC-S018-4 consumption contract:**
```js
{
  token: 'HIGH' | 'MED' | 'LOW' | null, // the computed value token (null until complete)
  band:  'HIGH' | 'MED' | 'LOW' | null, // === token this slice (kept as a separate
                                        //   field so a future graded score can widen
                                        //   without breaking consumers; equal for now)
  complete: boolean,                    // true iff value AND timeCritical both chosen
  reason: string                        // human one-line WHY, for the FIG readout AND
                                        //   the UC-S018-4 "value: … with reasoning" block
}
```
- `reason` examples (operator language, no enum jargon):
  - HIGH: `"High value and time-critical — ranks with the top tier."`
  - LOW: `"Low value and not time-sensitive — ranks in the bottom tier."`
  - MED: `"Mixed signals — ranks in the middle tier."`
  - incomplete: `""` (empty; the readout shows its own neutral prompt, not a
    reason for a non-existent score).

**Why this shape (contract note, mirrors the useSteerContext six-field note):**
- `token` is what UC-S018-3's `useQueueRank` compares against the Intake-queue
  items by tier (HIGH > MED > LOW) — a single discrete tier, exactly the value
  the rank counter needs; no rank logic leaks into the scorer.
- `band` duplicates `token` deliberately as the **stable readout/rank field**:
  if a later slice adds a WSJF/CD3 numeric score (explicitly a deferred
  follow-on per slice.md), `token` stays the coarse tier and `band` can carry
  the graded band — consumers already read `band`, so they don't break. This UC
  sets `band === token`.
- `complete` lets UC-S018-3 hold the rank preview until a real token exists
  (no "rank for a null tier") and lets UC-S018-4 gate "Generate".
- `reason` is authored ONCE here so both the live readout (this UC) and the
  prompt's "value: … reasoning" line (UC-S018-4) read identically — the operator
  sees in the readout exactly what the prompt will say.

`scoreCod` is a **total pure function**: defined for every input including
`null`s; never throws; no side effects. (AC-S018-2-4 unit-tests it with no DOM.)

---

## Component decomposition (component → states → stable selector)

### CodStep (NEW — the step-2 content; mounts into the wizard's step-2 slot)
- **Role:** the cost-of-delay signals capture surface — Value selector + Urgency
  (yes/no + why) + Risk-of-delay + the live band readout. Pure render of lifted
  field state + the `scoreCod` result. Owns NO drawer, NO step machine (those are
  the shell's) — it is the content the shell mounts when `currentStep` = 2.
- **Props (pure):** `{ value, timeCritical, urgencyWhy, riskOfDelay, score,
  onChange(field, value) }` where `score` is the `CodScore` the shell computed
  by calling `scoreCod({value, timeCritical})` (the shell owns the lifted CoD
  state so UC-S018-3/4 can read `value`/`token` from one place — same lift
  pattern the JTBD fields use).
- **States:** default (nothing chosen → band readout shows neutral prompt) ·
  partial (one of value/urgency chosen → still no band) · scored (both chosen →
  band + reason shown).
- **Selector:** `data-testid="cod-step"`; the region wrapping the three signals
  is `role="group"` `aria-labelledby` → the step-2 sub-heading (`<h3>` e.g.
  "Cost of delay", `data-testid="cod-step-heading"`). NOT a second `role=dialog`
  — it is content inside the wizard dialog (one dialog, A11Y heading order:
  the wizard `<h2>` then this `<h3>`).
- **A11y:** logical forward tab order WITHIN the step — Value radio group →
  Urgency radio group → "why now" textarea → Risk-of-delay textarea → band
  readout → step nav (Back → Next). No skipped heading level (`<h3>` under the
  wizard `<h2>`).
- **Library:** custom (token-based; reuses existing fieldset/radio + `.intent-note`
  treatments; NO new token).

### CodValueSelect (NEW — the Value HIGH/MED/LOW radio group; child of CodStep)
- **Role:** the single-select value signal with VISIBLE plain-language labels.
- **Idiom:** a native `<fieldset>` + `<legend>` "Value" wrapping three
  `<input type="radio" name="cod-value">` each with an associated `<label>`
  carrying the FULL description (token + dash + plain sentence).
- **Options (labels — token NEVER bare, FIG-S018-2-2):**
  - HIGH — "HIGH — directly impacts the team's ability to deliver"
  - MED — "MED — improves the experience but work continues without it"
  - LOW — "LOW — nice-to-have"
- **States (per radio):** default · hover · focus-visible (`--focus-ring`) ·
  checked · (group) none-selected (initial — no default selection; the operator
  must choose, so an unchosen value reads as genuinely unset, FIG empty≠score).
- **Selector:** group `getByRole('radiogroup', { name: /value/i })`,
  `data-testid="cod-value"`; each option
  `getByRole('radio', { name: /high|med|low/i })`,
  `data-testid="cod-value-high|cod-value-med|cod-value-low"` +
  `data-value="HIGH|MED|LOW"`; the group carries `data-cod-value` reflecting the
  chosen token (or absent/empty when none).
- **A11y (WAI-ARIA radiogroup semantics — A11Y-S018-2-1):** native radios in a
  `<fieldset>`/`<legend>` give the radiogroup role + name for free; **arrow keys
  move selection within the group, the group is a SINGLE tab stop** (native
  radio roving behaviour — Tab enters the group at the checked/first radio, ↑/↓/
  ←/→ change selection, Tab leaves the group). Each radio's accessible name is
  its full description (token + sentence). Hit box ≥ `--target-min`;
  `--focus-ring` on `:focus-visible`. No default check (an unset signal is real).
- **Library:** custom (native radios; token-based styling; no new token).

### CodUrgency (NEW — Urgency yes/no radio + "why now" textarea; child of CodStep)
- **Role:** the time-critical binary (scorer input) + optional prose.
- **Idiom:** a `<fieldset>`/`<legend>` "Urgency" with two radios
  (`name="cod-urgency"`): "Yes — time-critical" / "No — not time-sensitive";
  plus a labelled OPTIONAL `<textarea>` "Why it matters now (optional)".
- **States:** (radios) none-selected (initial) · Yes checked · No checked ·
  focus-visible; (textarea) empty · filled · focus-visible.
- **Selector:** group `getByRole('radiogroup', { name: /urgency/i })`,
  `data-testid="cod-urgency"`; options `getByRole('radio', { name:
  /time-critical|not time-sensitive/i })`,
  `data-testid="cod-urgency-yes|cod-urgency-no"` + `data-urgency="yes|no"`;
  textarea `getByRole('textbox', { name: /why it matters now/i })`,
  `data-testid="cod-urgency-why"`.
- **A11y:** radiogroup keyboard semantics as above (single tab stop, arrows
  select); the "why now" textarea has a real `<label for>` (placeholder is NOT
  the label); `--focus-ring`; hit boxes ≥ `--target-min`. Maps `timeCritical`:
  Yes→`true`, No→`false`, none→`null`.
- **Library:** custom (native radios + `.intent-note` textarea; no new token).

### CodRiskOfDelay (NEW — optional risk-of-delay textarea; child of CodStep)
- **Role:** "what worsens if this is deferred?" — optional prose for the prompt.
- **Idiom:** a single labelled optional `<textarea>` reusing `.intent-note`.
- **States:** empty (valid) · filled · focus-visible.
- **Selector:** `getByRole('textbox', { name: /risk of delay|deferred/i })`,
  `data-testid="cod-risk"`; associated `<label for>`.
- **A11y:** real `<label for>` (placeholder NOT the label); optional (no required
  semantics, no error state — empty is fine); `--focus-ring`.
- **Library:** custom (`.intent-note` reuse; no new token).

### CodScoreReadout (NEW — the live band readout; THE FIG surface of this UC)
- **Role:** the live, human-readable computed-band statement — the figure of
  this UC. Reads the `CodScore` and renders the band AS WORDS with its reason and
  a forward hint to the rank preview. Updates live as Value/Urgency change.
- **Composition rule (FIG contract):**
  - **scored** (`score.complete === true`): renders the BAND AS WORDS plus the
    forward hint, e.g. **"HIGH — your item would rank in the top tier (see the
    rank preview on the next step)."** The token is shown as a labelled word, the
    `reason` sentence beneath it. NEVER a bare number, NEVER the enum alone.
  - **incomplete** (`score.complete === false`): renders a NEUTRAL prompt, e.g.
    **"Choose a value and urgency to see where this item would rank."** — NOT a
    band, NOT "MED" (an unscored item must not read as a real MED), NOT blank.
- **States:** neutral/incomplete (no band yet) · scored (band word + reason +
  next-step hint).
- **Selector:** `data-testid="cod-score-readout"`; `role="status"`
  `aria-live="polite"` (each band change announced once, not per-keystroke
  spammed — only Value/Urgency changes flip the band, so this is naturally
  low-frequency); the band word carries `data-cod-band="HIGH|MED|LOW"` (absent
  when incomplete) as the cross-check hook.
- **A11y:** live region (polite); contrast ≥ 4.5:1 on `--c-surface-raised`; the
  band is conveyed by the WORD (authoritative) — any colour accent is redundant,
  never the sole cue. Accessible name = the composed band + reason sentence.
- **FIG legibility (the standing checklist applied):**
  1. **Reads as words, not a bare number** — "HIGH — top tier", never "12" or a
     bare "HIGH" with no context.
  2. **Empty/unknown ≠ a score** — incomplete state is a distinct neutral prompt,
     never a defaulted MED, never "0", never blank.
  3. **No unit/rate trap** — the band is an ordinal tier, NOT a count or a rate,
     so it carries NO numeric unit; it is named as a tier ("top/middle/bottom
     tier"), which is its correct dimension. (The numeric N/M counts arrive in
     UC-S018-3, where the count/unit FIG rules apply.)
- **Library:** custom (token-based; reuses `--c-text`/`--c-text-dim`/`--fs-label`;
  the band-tier colour accent reuses `--c-state-*`/`--c-tree-state-*` channels
  redundantly only — text is authoritative; no new token).

---

## Click-path budget (this UC, with justification)

| Job (this UC) | Budget | Reality |
|---|---|---|
| "Record value + urgency + risk" (the CoD capture) | **≤ 3 clicks** | 1 click Value radio + 1 click Urgency radio = the two SCORED signals (2 clicks); the band appears with ZERO further action (live). Risk-of-delay + "why now" are optional prose (keystrokes, not gating clicks). Justified: radios are 1-click each and all options are visible (no menu to open); no submit step. |
| "See the computed band" | **0 clicks after the two radios** | CodScoreReadout updates live; no compute/submit button. |
| "Go back, keep my draft" | **1 click** | Back returns to step 1 with JTBD draft preserved (NAV-S018-2-2). |
| "Advance to rank preview" | **1 click** | Next (toward UC-S018-3). |

No step is added that a default can remove: no "compute" button (the band is
live), no `<select>` open-click (radios are inline), no required-prose gating
(risk/why are optional).

---

## Figure legibility (the band readout — applies the standing checklist)
The CodScoreReadout is the only data-bearing figure this UC; it passes:
1. **Band reads as words** — "HIGH — your item would rank in the top tier", with
   the `reason` sentence; never a bare number, never the enum token alone.
2. **Empty inputs ≠ a score** — the incomplete state is a distinct neutral prompt
   ("Choose a value and urgency…"), NOT a defaulted MED, NOT 0, NOT blank.
3. **Unit matches dimension** — the band is an ordinal TIER (no per-time/count
   unit applies); it is NAMED as a tier, not mislabelled a rate or a count.
4. **Value-radio tokens are never bare** — each HIGH/MED/LOW option carries its
   plain-language sentence; the token alone never stands as the label.

---

## NO-WRITE contract (this UC)
CodStep + codScorer issue ZERO network calls — the scorer is a pure client-side
fn, the inputs are local field state. No `fetch`/`POST`/`PUT`/`PATCH`/`DELETE` on
any radio change, textarea keystroke, Back, or Next. The server write-guard (405)
stays active (SM-CHK7-6 regression). (The first READ call — GET /items for the
rank preview — still arrives only in UC-S018-3.)

---

## Geometry — the step swap is an INTERNAL content change (do-no-harm)
The wizard is a body-portalled `position:fixed` drawer with zero flow height
(UC-S018-1 GEO basis). Replacing the step-2 placeholder with the live CodStep is
an internal content change INSIDE that fixed drawer — it reflows nothing on the
page (map/views/tree unchanged) and must not change the drawer's own anchored
box. GEO-S018-2-1 pins this; GEO-S018-2-2 pins that the three CoD signal groups
STACK (a form column, not a row — the s002-line guard applied here).

---

## Accessibility conditions (AA) → mirrored into acceptance.md
See acceptance.md UC-S018-2 section for AC-S018-2-A11Y / GEO / FIG / NOWRITE /
NAV / SEL. Summary: radiogroup keyboard semantics (single tab stop, arrows
select, no default check) for Value + Urgency; real `<label for>` on every
textarea (placeholder never the label); logical within-step focus order; `<h3>`
under the wizard `<h2>` (no skipped level); live-region band readout (band as
words); band conveyed by text not colour alone; target sizes ≥ 24px; visible
focus ring; the inherited shell de-emphasis/focus/Esc contract NOT regressed.

---

## Stable selectors handed to the engineer (the build contract + test hooks)
| Element | Selector contract |
|---|---|
| CodStep region | `data-testid="cod-step"` · `role="group"` `aria-labelledby`→`<h3>` |
| CodStep heading | `data-testid="cod-step-heading"` (`<h3>`, "Cost of delay") |
| Value radio group | `getByRole('radiogroup', { name: /value/i })` · `data-testid="cod-value"` · `data-cod-value` |
| Value options | `getByRole('radio', { name: /high\|med\|low/i })` · `data-testid="cod-value-high\|cod-value-med\|cod-value-low"` · `data-value` |
| Urgency radio group | `getByRole('radiogroup', { name: /urgency/i })` · `data-testid="cod-urgency"` |
| Urgency options | `data-testid="cod-urgency-yes\|cod-urgency-no"` · `data-urgency` |
| Urgency "why now" | `getByRole('textbox', { name: /why it matters now/i })` · `data-testid="cod-urgency-why"` |
| Risk-of-delay | `getByRole('textbox', { name: /risk of delay\|deferred/i })` · `data-testid="cod-risk"` |
| Band readout | `data-testid="cod-score-readout"` · `role="status"` `aria-live="polite"` · `data-cod-band` (absent when incomplete) |

(All `cod-*` per the wizard's `<step>-<field>` testid convention; no derived
`nth`/text-exclusion selectors.)

---

## Engineer needs (hand-off, UC-S018-2)
1. **`lib/codScorer.js` is a pure total fn** — `scoreCod({value, timeCritical})`
   → the `CodScore` shape above. No DOM, no fetch, never throws, defined for
   `null` inputs (returns `{token:null, band:null, complete:false, reason:""}`).
   Author the unit test FIRST (red→green): HIGH for (HIGH,true), LOW for
   (LOW,false), MED for every other CHOSEN combination, and incomplete/null when
   either input is null (AC-S018-2-4 + the new null case).
2. **Lift the CoD field state into IntakeWizard** (alongside the JTBD fields) so
   UC-S018-3's `useQueueRank` and UC-S018-4's prompt builder read `value`/
   `score.token`/`urgencyWhy`/`riskOfDelay` from ONE place — the same lift the
   JTBD fields already use. CodStep is a pure render of that lifted state +
   `score`; the wizard calls `scoreCod` and passes the result down.
3. **Mount CodStep into the EXISTING step-2 slot** — replace the
   `wizard-step-placeholder` render for `currentStep === 2` with `<CodStep …/>`.
   Do NOT touch the shell's step machine, indicator, nav, drawer, focus, or
   de-emphasis rule (UC-S018-1 regression surface — the e2e a11y pin must still
   pass). Steps 3–4 keep the placeholder until -3/-4.
4. **Native radios in `<fieldset>`/`<legend>`** for Value + Urgency — do NOT
   hand-roll ARIA radiogroups; the native elements give the radiogroup role +
   name + roving keyboard for free and pass axe. No default `checked` (an unset
   signal must read as genuinely unset — FIG empty≠score).
5. **No new token, no new drawer.** Reuse `.intent-note` for the textareas and
   the existing radio/fieldset styling; band-tier colour accents reuse
   `--c-state-*` channels redundantly (text authoritative). If a radio/fieldset
   style does not yet exist as a reusable rule, add it as a token-based rule (no
   off-token literals), not a one-off.
6. **TDD selectors above are the contract** — author the component/e2e specs
   against role+name (radiogroup/radio/textbox) + the `cod-*` testids, not
   derived selectors. `data-cod-band` is the band cross-check; `data-cod-value`/
   `data-urgency` are the input cross-checks.

---
---

# UI design — UC-S018-3: Queue-rank preview

Applies: **yes** — the real step-3 content surface (a `QueueRankStep` region +
the `useQueueRank` hook) that REPLACES the surviving `wizard-step-placeholder`
branch (the shell's `currentStep === 3` else-branch in `IntakeWizard.jsx`) with
a live, directional rank preview computed from the live items.csv. NO new server
route, NO write — exactly ONE GET.

Mode: STRUCTURE (before the engineer). Scope of THIS UC = (a) the `useQueueRank`
hook (the slice's FIRST and ONLY read call: GET `/api/projects/:id/items`,
fetched on STEP ENTRY, not on wizard open), (b) a pure `rankPreview` domain fn
that compares the wizard item's `codScore.token` tier against currently-queued/
planned items and produces a DIRECTIONAL sentence, and (c) the `QueueRankStep`
region that renders that sentence with distinct loading / empty / error / gated
states. The shell's step machine, indicator, nav, drawer/focus/Esc contract, the
de-emphasis rule, AND the delivered step-1/step-2 content are UC-S018-1/2 and
**MUST NOT be regressed**. The prompt builder + clipboard handoff (UC-S018-4)
CONSUMES this step's rank sentence but is NOT built here.

---

## What the shell already guarantees (inherited, do-no-harm)
The delivered IntakeWizard (UC-S018-1/2) owns and this UC reuses unchanged:
- the **4-step state machine** + `currentStep`. The mount seam for THIS UC is the
  shell's CURRENT `else` branch (the `wizard-step-placeholder` rendered when
  `step` is neither 1 nor 2) — i.e. `currentStep === 3` (and 4, until -4). The
  shell change is the same shape UC-S018-2 made: extend the step ternary so
  `step === 3` renders `<QueueRankStep …/>` and the placeholder survives only
  for step 4.
- the **lifted CoD draft** (`cod` + `codScore` in `IntakeWizard.jsx`,
  lines 205–213). `codScore` is the `{token, band, complete, reason}` value this
  UC reads. THIS UC adds NO new lifted state EXCEPT the hook's own fetch state
  (loading/data/error) and the derived rank preview — the inputs already exist.
- the **WizardStepIndicator** (step 3 marked `data-step-state="current"` /
  `aria-current="step"` when active) + its **de-emphasis rule** (COLOUR + size +
  "(soon)" text, NEVER alpha — A11Y-S018-1-12). Building step 3 flips its
  `INTAKE_STEPS[2].built` to `true` (the "(soon)" tag disappears for step 3).
- the **drawer/focus/Esc/×/Cancel + focus-return-to-launcher** contract and the
  **NON-MODAL, body-portalled, zero-flow-height** drawer (GEO basis): the step
  swap to step 3 is an internal content change inside the fixed drawer — it
  reflows nothing outside (GEO-S018-3-1 pins this).

This UC adds NO new design token and NO new drawer; it is a content component +
a read-only data hook mounted into an existing slot.

---

## Surfaces touched
- **IntakeWizard step-3 slot** (existing mount seam) — the surviving
  `wizard-step-placeholder` for `currentStep === 3` is replaced by the live
  `QueueRankStep`. (The placeholder remains for step 4 until UC-S018-4.)
- **`src/app/src/hooks/useQueueRank.js`** (NEW) — the slice's only read call.
  Wraps `getItems(project)` (existing `api/client.js` adapter — the SAME loader
  `useWipItems` uses), exposes `{status, items}` fetch state. Fetches on STEP
  ENTRY (mounted only when step 3 is active), NOT on wizard open.
- **`src/app/src/lib/queueRank.js`** (NEW pure fn — no DOM, no fetch) — the
  directional-rank domain rule + the human sentence composer. Its OUTPUT is the
  UC-S018-4 consumption contract (spec'd below).
- **`src/app/src/components/QueueRankStep.jsx`** (NEW) — the step-3 region: a
  pure render of the hook's fetch state + the lifted `codScore` + the
  `rankPreview` result. Owns NO drawer, NO step machine, NO fetch logic.

---

## The read call — `useQueueRank` (READ-ONLY discipline, fetch-on-step-entry)

**Exactly ONE GET, zero writes.** The hook calls `getItems(project)` (which is
`GET /api/projects/:id/items` — parsed `ItemRecord[]`, raw §4 string fields).
This is the slice's FIRST and ONLY network call (steps 1–2 were pure
client-side). No POST/PUT/PATCH/DELETE on entry, on a Value/Urgency change that
re-derives the rank, on Back, or on Next.

**When it fetches — on STEP ENTRY, not on wizard open (decision, recorded):**
`useQueueRank` is invoked from `QueueRankStep`, and `QueueRankStep` is mounted by
the shell ONLY when `currentStep === 3`. So the GET fires when the operator first
reaches step 3 (the hook's mount), NOT when the drawer opens at step 1.
Rationale: (a) the queue snapshot is freshest if read at the moment the operator
wants to see their rank, not stale from minutes earlier at open; (b) an operator
who opens the wizard and cancels at step 1 issues ZERO network calls — the
read-only footprint is minimal; (c) it matches the slice.md/use-cases.md trigger
("before generating the prompt, the panel calls the items endpoint"). The hook
does NOT re-fetch on every Value-radio flip — the item set doesn't change; only
the operator's own `codScore.token` does, and the rank is RE-DERIVED from the
already-fetched items (no extra GET, AC-S018-3-3). A live SSE re-fetch is OUT of
scope this UC (the wizard is a transient flow; the snapshot at step entry is the
contract) — deferred, noted below.

**Hook shape:**
```js
// useQueueRank({ loadActive?, loadItems? }) ->
//   { status: 'loading' | 'ready' | 'error', items: ItemRecord[] }
useQueueRank()
```
- resolves the active project (`getActive`, the `useWipItems` idiom), then
  `getItems(project)`; fail-soft on a null project or a throw → `status:'error'`
  (the QueueRankStep renders a distinct error state, never a fabricated rank).
- `status:'loading'` until the GET resolves; `status:'ready'` with `items` (possibly
  `[]` — an empty/header-only items.csv is a VALID ready state, NOT an error —
  AC-S018-3-4); `status:'error'` on a failed/absent fetch.
- defaulted loaders (`loadActive`/`loadItems`) so the hook is unit-testable with
  a mock items endpoint (AC-S018-3 done-condition: "independently testable with a
  mock items endpoint").

---

## The directional-rank domain fn — `lib/queueRank.js` (pure, the cross-UC contract)

**Signature (pure, no DOM, no fetch — unit-testable in isolation):**
```js
// rankPreview({ token, items }) -> RankPreview
rankPreview({ token, items })
```

**Input:**
| field | type | source | notes |
|---|---|---|---|
| `token` | `'HIGH'\|'MED'\|'LOW'\|null` | `codScore.token` (lifted) | `null` = CoD step incomplete |
| `items` | `ItemRecord[]` | `useQueueRank().items` | raw items.csv records (§4 strings) |

**Which items count as "in the queue" (the comparison set — decision):**
the rank is against items NOT yet delivered or dropped — i.e. items still
competing for prioritisation. From the live items.csv `state` vocabulary
(`active|planned|in-flight|unconfirmed|done|dropped`), the comparison set =
records whose `state` is one of **`planned`, `unconfirmed`, `in-flight`,
`active`** (work that is queued, being triaged, or in progress — the queue the
new item would join), EXCLUDING `done` and `dropped` (terminal — out of the
ranking). Type is NOT filtered (a directional count across the queued backlog;
the slice's "Intake-queue items" maps to this not-yet-terminal set, since the
observatory items.csv is the single live backlog). This set + the exclusion is
exported as a named predicate so the test can pin it.

**Value-tier normalisation (real-data nuance — the live items.csv carries
`MED-HIGH`, not just HIGH/MED/LOW):** the rank orders tiers HIGH > MED > LOW.
Real records carry intermediate/blank tiers (`MED-HIGH`, `""`). The fn maps each
record's raw `value` to a coarse rank ordinal via a total normaliser:
`HIGH → 3`, `MED-HIGH → 2.5` (sits between — ranks AHEAD of a MED item, BEHIND a
HIGH item), `MED → 2`, `LOW → 1`, anything else/blank → `2` (MED-equivalent;
unscored existing items default to the middle, NOT dropped from the count and NOT
treated as 0). The wizard item's own `token` maps the same way (HIGH/MED/LOW →
3/2/1). This keeps the count HONEST against the real backlog rather than silently
ignoring the rows that don't match three exact enums.

**The directional rule:**
- `ahead` = count of comparison items whose tier ordinal is **strictly greater**
  than the wizard item's ordinal (items that would rank ABOVE the new item).
- `behind` = count of comparison items whose tier ordinal is **strictly less**
  than the wizard item's ordinal (items that would rank BELOW the new item).
- items at the SAME ordinal are neither ahead nor behind (the new item would sit
  among its tier peers — surfaced as a third "alongside" count so the sentence is
  truthful, see composer).

**Output shape (`RankPreview`) — the UC-S018-4 consumption contract:**
```js
{
  complete: boolean,   // === (token != null); false → render the gated prompt, no rank
  total:    number,    // comparison-set size (queued, non-terminal items)
  ahead:    number,    // items that would rank ABOVE the new item (higher tier)
  behind:   number,    // items that would rank BELOW the new item (lower tier)
  alongside:number,    // items in the SAME tier (peers)
  token:    'HIGH'|'MED'|'LOW'|null, // the wizard item's tier (echoed for the sentence)
  sentence: string,    // the human directional sentence (THE figure + UC-S018-4 input)
  empty:    boolean    // true iff total === 0 (the queue is currently empty)
}
```

**The sentence composer (FIG contract — directional, human, tier-words not enums):**
- **gated** (`token === null`, CoD incomplete): `sentence: ""`, `complete:false`.
  The step renders a PROMPT to finish step 2 — never a fabricated rank.
- **empty queue** (`total === 0`): `"The queue is currently empty — your item
  would be next."` (empty ≠ broken, AC-S018-3-4; NOT "ranks after 0 and before
  0", which reads as a bug).
- **populated**, full directional form (operator language, tier WORDS):
  `"Your item (HIGH value) would rank ahead of 6 items and behind 0 — placing it
  near the top of the queue."` — i.e. `ahead`/`behind` as real counts WITH the
  unit "items", the wizard item's tier named as a WORD ("HIGH value"), and a
  plain-language placement hint derived from the ratio (near the top / in the
  middle / near the bottom). When `alongside > 0` the sentence appends
  ", alongside N at the same priority" so the same-tier peers aren't silently
  dropped (a count that doesn't add up is a FIG legibility failure).
- **tier summary, not raw ids (FIG — "summarised by tier not raw ids unless
  few"):** the sentence summarises the ahead/behind sets BY TIER + COUNT, never by
  dumping machine ids. A secondary, optional detail line MAY name the ahead items
  by tier-grouped count ("ahead: 4 HIGH, 2 MED-HIGH"); it names raw ids ONLY when
  a set is small (≤ 2) and even then WITH the human job sentence, never a bare
  `UC-S018-x` token (the EXP-033 / DEFECT-005 rule). For this thin slice the
  primary sentence is the contract; the tier-grouped detail line is OPTIONAL
  polish the engineer MAY add — the acceptance pins the tier-word + count form,
  not raw ids.

`rankPreview` is a **total pure function**: defined for `token === null`, for
`items === []`, for `items` carrying unknown/blank `value` strings; never throws;
no side effects. Unit-tested with a fixed `items` fixture (AC-S018-3 mock-endpoint
done-condition).

**Why this shape (contract note for UC-S018-4):**
- `sentence` is authored ONCE here so the live step-3 readout AND the
  UC-S018-4 intake prompt's rank line read IDENTICALLY (the operator sees in the
  preview exactly what the generated prompt will say — the same author-once
  discipline `codScorer.reason` uses).
- `ahead`/`behind`/`alongside`/`total` are exposed as discrete numbers so
  UC-S018-4 (or a future richer prompt) can recompose the line without
  re-deriving the rank; `complete` lets UC-S018-4 gate whether a rank line is
  included at all (an incomplete CoD → no rank line in the prompt, consistent
  with the gated step).

---

## Component decomposition (component → states → stable selector)

### QueueRankStep (NEW — the step-3 content; mounts into the wizard's step-3 slot)
- **Role:** the queue-rank preview surface — renders the directional rank
  sentence (or the gated / loading / empty / error state) from `useQueueRank`'s
  fetch state + the lifted `codScore`. Pure render + the one hook call; owns NO
  drawer, NO step machine.
- **Props (pure render of):** `{ score }` (the lifted `CodScore`); the hook is
  called INSIDE the component (it is the step's own data concern). (Engineer MAY
  inject the hook for testability, mirroring CodStep's `score` prop pattern.)
- **States:**
  - **gated** (`score.complete === false`): the CoD step isn't finished → a
    PROMPT, not a rank ("Choose a value and urgency on the previous step to see
    where your item would rank."), with no fetch attempted (or fetched but not
    rendered as a rank) — never a fabricated number. The hook MAY still load
    items in the background; the rank is simply not shown until `complete`.
  - **loading** (`score.complete && hook.status === 'loading'`): a labelled
    "Reading the live queue…" indicator — DISTINCT from empty and from error.
  - **ready-populated** (`complete && status==='ready' && total>0`): the
    directional rank sentence.
  - **ready-empty** (`complete && status==='ready' && total===0`): the
    empty-queue sentence ("The queue is currently empty — your item would be
    next.") — DISTINCT from loading and error; the queue genuinely has no
    competing items, which is a valid happy state, not a fault.
  - **error** (`complete && status==='error'`): "Couldn't read the live queue —
    your rank preview is unavailable. You can still generate the prompt." — a
    fail-soft message, NOT a fabricated rank, and NOT blank.
- **Selector:** region `data-testid="queue-rank-step"`; `role="group"`
  `aria-labelledby` → the step-3 sub-heading (`<h3>` "Queue rank",
  `data-testid="rank-step-heading"`). NOT a second `role=dialog` (one dialog;
  heading order: wizard `<h2>` → this `<h3>`). The rank sentence itself is
  `data-testid="rank-preview"` `role="status"` `aria-live="polite"`
  (re-derivation on a tier change is announced once).
- **A11y:** logical forward tab order — (the sentence is `role=status`, not a
  control) heading region → step nav (Back → Next); `<h3>` under the wizard
  `<h2>` (no skipped level). The sentence is a labelled status region so a SR
  announces the directional outcome.
- **Library:** custom (token-based; reuses `--c-text`/`--c-text-dim`/`--fs-label`
  + the CodScoreReadout/JobSentencePreview status-line idiom; NO new token).

### RankPreviewSentence (the figure inside QueueRankStep — THE FIG surface)
- **Role:** the live, human directional sentence — the figure of this UC. Reads
  the `RankPreview.sentence` and renders it as a readable status line; the
  `ahead`/`behind`/`alongside` counts carry the unit "items" and the tier is a
  WORD, never an enum.
- **Selector:** `data-testid="rank-preview"` (carries `data-rank-ahead` /
  `data-rank-behind` / `data-rank-total` as numeric cross-check hooks — the
  tester asserts these match the live items.csv comparison-set counts);
  `role="status"` `aria-live="polite"`.
- **FIG legibility (the standing checklist applied):**
  1. **Has a unit / reads in human words** — counts carry "items" ("ahead of 6
     items"); the tier is the WORD "HIGH value", never a bare enum or a bare
     number. NO unitless count.
  2. **References are human-meaningful** — the ahead/behind sets are summarised
     BY TIER + count (tier-words), NOT by raw machine ids; an optional detail
     line names ids ONLY when ≤ 2 and WITH the human job sentence.
  3. **Empty/unknown ≠ zero ≠ broken** — `total===0` → "the queue is currently
     empty; your item would be next" (a distinct, correct sentence), never "ranks
     after 0 and before 0"; the error state is a distinct fail-soft message, never
     a 0-rank; the gated state is a prompt, never a fabricated rank.
  4. **Counts add up** — `ahead + behind + alongside === total` (the
     same-tier peers are surfaced via "alongside N", never silently dropped).
- **Library:** custom (token-based; the status-line idiom).

---

## Click-path budget (this UC, with justification)

| Job (this UC) | Budget | Reality |
|---|---|---|
| "See where my item would rank" | **1 click from step 2** | "Next: Queue rank" advances the step machine to step 3; the rank is fetched on entry and shown with ZERO further action (no "compute rank" button). |
| "Refine and re-check the rank" | **0 extra clicks / 0 extra GETs** | changing a Value/Urgency radio (on step 2, then Next) re-derives the rank from the already-fetched items — no page reload, no second fetch (AC-S018-3-3). |
| "Go back, keep my draft" | **1 click** | Back returns to step 2 with the CoD draft preserved (inherited NAV-S018-2-2). |
| "Advance to the prompt" | **1 click** | Next (toward UC-S018-4). |

No step is added that a default can remove: the fetch is automatic on entry, the
rank is live, there is no submit/compute button.

---

## Geometry — the step swap is an INTERNAL content change (do-no-harm)
The wizard is a body-portalled `position:fixed` drawer with zero flow height
(UC-S018-1 GEO basis). Replacing the step-3 placeholder with the live
QueueRankStep is an internal content change INSIDE that fixed drawer — it reflows
nothing on the page (map/views/tree unchanged) and must not change the drawer's
own anchored box. GEO-S018-3-1 pins this; GEO-S018-3-2 pins that the rank-step
content STACKS (heading → sentence → any detail line → nav, a column not a row —
the s002-line guard applied to step 3).

---

## NO-WRITE / READ-ONLY contract (this UC)
- **Exactly ONE GET** (`/api/projects/:id/items`, fetched on step-3 entry); the
  `rankPreview` fn is a pure client-side computation. ZERO writes
  (POST/PUT/PATCH/DELETE) on entry, on a tier re-derivation, on Back/Next.
- The server write-guard (405) stays active (SM-CHK7-6 regression).
- No second GET on a Value-radio change — the items set is fetched once per step
  entry; the rank is re-derived locally (NOWRITE-S018-3-1 + the single-GET pin).

---

## Accessibility conditions (AA) → mirrored into acceptance.md
See acceptance.md UC-S018-3 section for AC-S018-3-A11Y / GEO / FIG / READ-ONLY /
NAV / SEL / RANK. Summary: the rank preview is a labelled `role=status`
`aria-live=polite` region inside a `role=group` named `/queue rank/i`; `<h3>`
under the wizard `<h2>` (no skipped level); logical within-step focus order;
loading ≠ empty ≠ error states are textually distinct; the gated state is a
prompt not a rank; target sizes ≥ 24px on the step-nav buttons; visible focus
ring; the inherited shell focus/Esc/de-emphasis contract NOT regressed.

---

## Stable selectors handed to the engineer (the build contract + test hooks)
| Element | Selector contract |
|---|---|
| Rank step region | `data-testid="queue-rank-step"` · `role="group"` `aria-labelledby`→`<h3>` |
| Rank step heading | `data-testid="rank-step-heading"` (`<h3>`, "Queue rank") |
| Rank preview sentence | `data-testid="rank-preview"` · `role="status"` `aria-live="polite"` · `data-rank-ahead` · `data-rank-behind` · `data-rank-total` (numeric cross-check; absent in gated state) |
| Loading state | `data-testid="rank-loading"` (distinct text "Reading the live queue…") |
| Empty-queue state | reuses `data-testid="rank-preview"` with the empty sentence + `data-rank-total="0"` |
| Error state | `data-testid="rank-error"` (distinct fail-soft text) |
| Gated state | `data-testid="rank-gated"` (the "finish step 2" prompt; `rank-preview` absent) |

(All `rank-*` per the wizard's `<step>-<field>` testid convention; no derived
`nth`/text-exclusion selectors.)

---

## Output / state contract UC-S018-4 consumes (the rank sentence joins the prompt)
UC-S018-4's `intakePromptBuilder` reads the SAME `RankPreview` object this UC
produces (the wizard lifts it beside `cod`/`codScore`, exactly as `codScore` is
lifted today):
- `rank.sentence` is the verbatim human line that joins the generated `/intake`
  prompt's rank section (author-once: the prompt says exactly what the operator
  saw).
- `rank.complete === false` (CoD incomplete) → UC-S018-4 OMITS the rank line from
  the prompt (no fabricated rank in the handoff), consistent with the gated step.
- `rank.empty === true` → the prompt's rank line is the empty-queue sentence
  ("the queue is currently empty — this item would be next").
- the discrete `ahead`/`behind`/`alongside`/`total`/`token` fields are available
  if UC-S018-4 wants to recompose rather than embed the sentence verbatim.

**Lift note for the engineer:** the cleanest seam is for `IntakeWizard.jsx` to
own the `RankPreview` the same way it owns `codScore` — but the rank depends on a
FETCH, so the hook lives in `QueueRankStep` and the resulting `RankPreview` is
lifted up via an `onRankChange(rank)` callback (or the shell calls the hook
itself when `step >= 3`). Engineer's call on the exact lift mechanism; the
CONTRACT is that UC-S018-4 can read the current `RankPreview` from the wizard's
lifted state without re-fetching.

---

## Engineer needs (hand-off, UC-S018-3)
1. **`lib/queueRank.js` is a pure total fn** — `rankPreview({token, items})` →
   the `RankPreview` shape above. No DOM, no fetch, never throws, defined for
   `token===null` (→ `{complete:false, sentence:'', ...zeros}`), `items===[]`
   (→ `empty:true`, the empty-queue sentence), and unknown/blank `value` strings
   (→ MED-equivalent ordinal, counted not dropped). Export the comparison-set
   predicate (non-terminal states: planned|unconfirmed|in-flight|active) and the
   tier normaliser as named functions so the tests pin them. Author the unit test
   FIRST (red→green) with a fixed items fixture covering: a HIGH token vs a mixed
   backlog, a LOW token, an empty backlog, a MED-HIGH record in the backlog, and
   incomplete (token null).
2. **`useQueueRank` is the slice's ONLY read call** — wraps `getActive` +
   `getItems` (the `useWipItems` loader idiom; defaulted/injectable loaders for
   tests). Exposes `{status:'loading'|'ready'|'error', items}`. Fail-soft → error
   (never a throw, never a fabricated rank). Fetch on the hook's MOUNT (= step-3
   entry), NOT on wizard open. NO write call, ever. NO re-fetch on a tier change.
3. **Mount QueueRankStep into the EXISTING step-3 slot** — extend the shell's step
   ternary so `step === 3` renders `<QueueRankStep score={codScore} …/>` (the
   placeholder survives only for step 4); flip `INTAKE_STEPS[2].built = true`.
   Do NOT touch the shell's step machine, indicator de-emphasis rule, nav, drawer,
   or focus contract (UC-S018-1/2 regression surface — the e2e a11y pin + the
   GEO-S018-1-1/2-1 reflow guards must still pass).
4. **Loading ≠ empty ≠ error ≠ gated — four textually-distinct states.** Each has
   its own testid + distinct copy (the FIG-S018-3-3 distinctness pin). The gated
   state is a prompt to finish step 2, never a rank.
5. **Lift the `RankPreview` to the wizard** (beside `cod`/`codScore`) so
   UC-S018-4 reads it without re-fetching — via an `onRankChange` callback or by
   calling the hook in the shell when `step >= 3`. Engineer's call on mechanism;
   the contract above is what UC-S018-4 needs.
6. **No new token, no new drawer, no new server route.** Reuse the
   status-line/readout idiom + existing colour/spacing/type tokens; the data
   comes entirely from the existing `/items` endpoint.
7. **TDD selectors above are the contract** — author the component/e2e specs
   against the `rank-*` testids + role+name (`role=group` name `/queue rank/i`,
   `role=status`), not derived selectors. `data-rank-ahead`/`-behind`/`-total`
   are the numeric cross-check hooks the tester matches against the live
   items.csv comparison set.

---

## NOT designed yet (deferred to UC-S018-4 / explicitly out)
- The intake prompt builder + clipboard/toast handoff (UC-S018-4) — its step-4
  slot stays the planned placeholder; it CONSUMES this UC's `RankPreview`.
- LIVE SSE re-fetch of the rank while the wizard is open — OUT this UC (the
  wizard is a transient flow; the step-entry snapshot is the contract). A
  follow-on if the human signals the need.
- A precise insertion index / per-item ordered list — OUT per slice.md (the rank
  is DIRECTIONAL only; no write-side commitment).
- Per-type queue scoping (intake vs ready vs deploy) — the comparison set is the
  whole non-terminal backlog; a finer queue split is a deliberate follow-on.

---
---

# UI design — UC-S018-4: Intake prompt builder + clipboard-copy handoff (CLOSES the wizard)

Applies: **yes** — the FINAL step-4 content surface (a `PromptStep` region) that
REPLACES the surviving `wizard-step-placeholder` branch (the shell's
`currentStep === 4` else-branch in `IntakeWizard.jsx`), plus the pure
`intakePromptBuilder.js` fn. It composes the captured JTBD + CoD + rank into a
structured `/intake` slash-command prompt the operator COPIES and hands to Claude
— so new work enters through the SAME human-accept gate as steer actions, never
written by the UI. This is the slice's only handoff; it REUSES (does not fork)
the delivered s014 PromptOutput + CopyPromptButton + CopyToast.

Mode: STRUCTURE (before the engineer). Scope of THIS UC = (a) `intakePromptBuilder.js`
(a pure fn: the lifted JTBD fields + `codScore` + the CoD prose + `rank` → the
filled prompt string), (b) the `PromptStep` region that renders the prompt via
the REUSED PromptOutput + Copy idiom with a frozen-prompt regenerate cue and a
NO-WRITE affordance, and (c) the wizard's TERMINAL affordance (what the operator
does after copying — Done/close + Start another/reset). The shell's step machine,
indicator, nav, drawer/focus/Esc contract, the de-emphasis rule, AND the
delivered step-1/2/3 content are UC-S018-1/2/3 and **MUST NOT be regressed**.

---

## What the shell already guarantees (inherited, do-no-harm)
The delivered IntakeWizard (UC-S018-1/2/3) owns and this UC reuses unchanged:
- the **4-step state machine** + `currentStep`. The mount seam for THIS UC is the
  shell's CURRENT `else` branch (`wizard-step-placeholder` rendered when `step`
  is 4 — the only surviving placeholder). The shell change is the same shape
  UC-S018-2/3 made: extend the step ternary so `step === 4` renders
  `<PromptStep …/>`; the placeholder branch is then GONE entirely (all four steps
  built). Flip `INTAKE_STEPS[3].built = true` (step 4 loses its "(soon)" tag).
- the **lifted draft** already in `IntakeWizard.jsx`: `fields`
  (situation/motivation/outcome), `cod` (value/timeCritical/urgencyWhy/
  riskOfDelay), the derived `codScore` ({token,band,complete,reason}), and the
  derived `rank` (the `RankPreview` or `null`). THIS UC reads ALL of these from
  the shell — it adds NO new lifted field EXCEPT the frozen `prompt` string + the
  generation snapshot (the PROMPT-FREEZE state, below). The inputs all exist.
- the **WizardStepIndicator** (step 4 marked current / `aria-current="step"` when
  active) + its **de-emphasis rule** (COLOUR + size + "(soon)" text, NEVER alpha —
  A11Y-S018-1-12). With step 4 built, NO step remains de-emphasised; the e2e
  no-alpha pin still passes (no planned step left to de-emphasise).
- the **drawer/focus/Esc/×/Cancel + focus-return-to-launcher** contract and the
  **NON-MODAL, body-portalled, zero-flow-height** drawer (GEO basis): the step
  swap to step 4 and the prompt RENDER inside it are internal content changes
  inside the fixed drawer — they reflow nothing outside (GEO-S018-4-1 pins this).
- the **WizardStepNav** — on step 4 `nextStep` is `null`, so "Next" is ABSENT by
  construction (Back + Cancel remain). The wizard's forward motion ENDS at the
  Generate/Copy/terminal affordances THIS UC adds inside the step, not at a 5th
  step. (This is the design reason the terminal affordance is THIS UC's concern.)

This UC adds NO new design token and NO new drawer; it mounts a content component
into an existing slot and REUSES three delivered s014 components verbatim.

---

## Surfaces touched
- **IntakeWizard step-4 slot** (existing mount seam) — the surviving
  `wizard-step-placeholder` for `currentStep === 4` is replaced by the live
  `PromptStep`. (No placeholder branch remains after this UC.)
- **`src/app/src/lib/intakePromptBuilder.js`** (NEW pure fn — no DOM, no fetch).
  The JTBD + CoD + rank → `/intake` prompt composer; its template lives in
  `src/app/src/templates/intake-prompt.txt` (or `templates/intake-prompt.js` —
  engineer's call, matching the `templates/steer-prompts/` idiom). Sibling of
  `lib/promptBuilder.js`; REUSES its `dash()` (unknown → "—") + `{{token}}`
  substitution discipline. NOT a fork of `buildPrompt` (different inputs/template);
  if `dash` is worth sharing the engineer MAY extract it to `lib/` — optional.
- **`src/app/src/components/PromptStep.jsx`** (NEW) — the step-4 region: a pure
  render that (1) renders the frozen prompt via the REUSED PromptOutput `<pre>` +
  CopyPromptButton + CopyToast, (2) shows the NO-WRITE affordance + the
  regenerate cue, (3) hosts the Generate trigger + the terminal Done/Start-another
  affordance. Owns NO drawer, NO step machine, NO fetch.

---

## Component / idiom REUSE (the s014 handoff family — NOT forked, the brief's hard rule)
THIS UC renders + copies the prompt through the EXACT delivered s014 components
(components.md "PromptOutput" / "CopyPromptButton" / "CopyToast"), not copies of
them:
- **PromptOutput** — the read-only, SELECTABLE `<pre class="prompt-output"
  data-testid="prompt-output" aria-label="Generated prompt" tabindex="0">` inside
  a `data-testid="prompt-output-slot"` wrapper. PromptStep renders the SAME slot
  markup SteerPanel uses (mono font, `pre-wrap`, `max-height:40vh` internal
  scroll, `user-select:text`) — the ratified `steer-panel.css` `.prompt-output`
  rule applies (reuse the existing class; do NOT author a second prompt CSS rule).
- **`CopyPromptButton`** — imported verbatim (`import { CopyPromptButton } from
  './CopyPromptButton.jsx'`). Props `{ prompt, onCopied }`. Byte-equal copy of the
  `<pre>` text (PROMPT-COPY-1 inherited); "Copy prompt" → "Copied ✓"; a FAILED
  write shows NO success cue. NOT re-implemented.
- **`CopyToast` + `toastDurationMs()`** — imported verbatim. Polite status region,
  body-portalled, zero flow height, fades under no-preference / instant under
  reduced-motion. PromptStep owns the `toastVisible` boolean + the auto-dismiss
  timer (the SteerPanel pattern — `onCopied` sets visible, a `toastDurationMs()`
  timer clears it). The component renders or doesn't.

This is the SAME composition SteerPanel/ReslicePreviewPanel use for the steer
handoff. The ONLY new code is `intakePromptBuilder.js` + the `PromptStep` shell
that wires the existing pieces — the byte-equal clipboard path is unchanged.

---

## The pure prompt builder — `lib/intakePromptBuilder.js` (the engineer's contract)

**Signature (pure, no DOM, no fetch — unit-testable in isolation):**
```js
// buildIntakePrompt(input) -> string
buildIntakePrompt({ jtbd, codScore, cod, rank })
```

**Input** (all from the wizard's already-lifted state — NO new fetch):
| field | type | source | notes |
|---|---|---|---|
| `jtbd` | `{ situation, motivation, outcome }` (strings) | `IntakeWizard.fields` | the step-1 JTBD draft |
| `codScore` | `{ token, band, complete, reason }` | derived `codScore` | the step-2 value token + its `reason` (authored once in codScorer) |
| `cod` | `{ urgencyWhy, riskOfDelay }` (strings; + value/timeCritical) | `IntakeWizard.cod` | the urgency/risk PROSE (not scorer inputs) |
| `rank` | `RankPreview \| null` | derived `rank` | the step-3 directional rank; `null` until CoD complete + items ready |

**Output** — a complete, copy-ready `/intake` prompt STRING following the
`.claude/commands/intake.md` argument shape (`/intake <free text, JTBD-framed>`).
The composed JOB SENTENCE is the command argument; the CoD signals + rank form a
structured body Claude reads at the gate. Template shape (the engineer pins the
exact wording with product if needed; this is the contract):

```
/intake When [situation], I want to [motivation], so I can [outcome].

Job-to-be-done:
  Situation: [situation]
  Motivation: [motivation]
  Outcome: [outcome]

Value signal: [token] — [codScore.reason]
Urgency: [why-now prose, or "not stated"]
Risk of delay: [risk prose, or "not stated"]

Queue rank (read-only preview): [rank.sentence]

(This is an operator-prepared intake. The dashboard wrote nothing — paste this
into Claude to enter it through the intake gate.)
```

**Composition rules (the FIG contract — see conditions):**
1. **Human-meaningful, no `{{token}}` residue** — every template token resolves;
   the rendered prompt contains NO `{{…}}` and NO `undefined`/`null`/`NaN`
   (reuse `dash()` → "—" for empties; for prose fields prefer the explicit
   "not stated" word over a bare dash so the prompt reads as a sentence).
2. **All four wizard inputs PRESENT** — the JTBD (situation/motivation/outcome),
   the value token + its reason, the urgency prose, the risk prose all appear in
   the prompt body, verbatim where the operator typed prose (SM-CHK7-4: job
   sentence, situation, motivation, outcome, value token, urgency text — all
   present). Empty optional prose renders "not stated", never silently dropped.
3. **The job sentence reads as a SENTENCE** — reuse the step-1 `composeJobSentence`
   rule (the same "When …, I want to …, so I can …" template the JobSentencePreview
   already renders) so the prompt's argument is IDENTICAL to what the operator saw
   on step 1 (author-once; the prompt says exactly what the preview showed). If a
   JTBD field is empty the sentence degrades to its readable placeholder form, NOT
   a broken grammar gap.
4. **The rank line is GATED, honest** (the cross-UC contract UC-S018-3 specified):
   - `rank == null` OR `rank.complete === false` (CoD incomplete) → **OMIT** the
     "Queue rank" line entirely (no fabricated rank in the handoff).
   - `rank.empty === true` → the rank line is the empty-queue sentence ("the queue
     is currently empty — this item would be next").
   - else → `rank.sentence` VERBATIM (the operator sees in the prompt exactly the
     line step 3 showed — author-once with `queueRank.js`).
5. **No raw refs** — no machine ids, `row:N`, sourceRef paths, or CSV keys appear
   (the EXP-033 / DEFECT-005 rule); the prompt is operator + Claude language only.

`buildIntakePrompt` is a **total pure function**: defined for empty JTBD fields,
`codScore.complete === false`, `rank === null`, and empty prose; never throws;
no side effects. (Unit-tested with no DOM — the FIRST red→green test.)

**Why this shape (contract note):** the builder reads the SAME lifted objects the
live previews read (`composeJobSentence` for the sentence, `codScore.reason` for
the value reasoning, `rank.sentence` for the rank) so the prompt is a faithful
transcript of the wizard the operator just filled — no value re-derivation, no
divergence between what they saw and what they hand off.

---

## PROMPT-FREEZE (the EXP-036 lesson, applied to the wizard)
The prompt is built on an explicit **Generate** press and FROZEN thereafter — it
does NOT live-update as the operator edits earlier steps. This mirrors
SteerPanelContainer's PROMPT-FREEZE-1 (prompt state mutates ONLY in
handleGenerate). The wizard already re-derives `codScore`/`rank` live; the
PROMPT must not, or the operator could copy a prompt that silently changed.
- **State:** `IntakeWizard` (or `PromptStep`) holds `prompt` (string|null) +
  `genSnapshot` (the `{jtbd, codScore.token, urgencyWhy, riskOfDelay, rank.sentence}`
  captured at the last Generate). Engineer's call on which level owns it; the
  CONTRACT is the prompt freezes at Generate and a divergence is signalled.
- **Generate** (the only mutation of `prompt`): builds via `buildIntakePrompt`,
  renders it into the PromptOutput slot, snapshots the inputs.
- **Regenerate cue** (REUSES the `ContextRefreshCue` idiom — text + aria-hidden
  glyph + polite status, never colour alone): when a prompt EXISTS and the current
  lifted inputs DIVERGE from `genSnapshot` (the operator went Back, changed a
  field, returned), the cue reads "Inputs changed — regenerate to refresh the
  prompt" (state `updated`); otherwise it is `live`. The displayed prompt stays
  frozen until the operator presses Generate again. This is how the operator KNOWS
  the copy would be stale.

---

## Component decomposition (component → states → stable selector)

### PromptStep (NEW — the step-4 content; mounts into the wizard's step-4 slot)
- **Role:** the final handoff surface — the Generate trigger, the frozen prompt
  (rendered via the REUSED PromptOutput slot), the Copy button + toast (reused),
  the NO-WRITE affordance, the regenerate cue, and the terminal Done/Start-another
  affordance. Pure render of lifted state + the one `buildIntakePrompt` call on
  Generate; owns NO drawer, NO step machine, NO fetch.
- **Props (pure render of the lifted draft):** `{ jtbd, codScore, cod, rank,
  prompt, onGenerate, onCopied, toastVisible, dirty, onReset, onClose }` — where
  `prompt` is the frozen string (null before first Generate), `dirty` is the
  divergence flag (drives the regenerate cue), `onGenerate` builds+freezes,
  `onReset` clears the draft + returns to step 1 ("Start another"), `onClose`
  closes the wizard ("Done"). (Engineer MAY co-locate `prompt`/`dirty` state in
  PromptStep and lift only `jtbd/codScore/cod/rank` + `onClose`/`onReset` — the
  CONTRACT is the freeze + the divergence signal, not the exact ownership level.)
- **States:**
  - **pre-generate** (`prompt == null`): the inputs summary + the Generate button
    + the NO-WRITE affordance; NO prompt slot, NO Copy button yet.
  - **generated** (`prompt` set, `!dirty`): the frozen prompt in the PromptOutput
    `<pre>` + the Copy button + (after a copy) the toast + the terminal affordance.
  - **generated-stale** (`prompt` set, `dirty`): same as generated PLUS the
    regenerate cue ("Inputs changed — regenerate…"); the SHOWN prompt is the old
    frozen one until Generate is pressed again (never silently refreshed).
  - **copied** (transient): Copy button "Copied ✓" + CopyToast visible (reused
    s014 states); reverts after `--dur-toast`.
- **Selector:** region `data-testid="prompt-step"`; `role="group"`
  `aria-labelledby` → the step-4 sub-heading (`<h3>` "Generate prompt",
  `data-testid="prompt-step-heading"`). NOT a second `role=dialog` (one dialog;
  heading order: wizard `<h2>` → this `<h3>`).
- **A11y:** logical within-step forward Tab order — heading region → Generate
  (pre-generate) / → prompt `<pre>` (tabbable, the s014 idiom) → Copy → Done →
  Start another → step nav (Back); `<h3>` under the wizard `<h2>` (no skipped
  level). The regenerate cue is a `role=status` (announced, not a tab stop).
- **Library:** custom shell (token-based) that COMPOSES the reused PromptOutput
  slot + CopyPromptButton + CopyToast; NO new token, NO new drawer.

### GenerateIntakeButton (NEW — the Generate trigger; child of PromptStep)
- **Role:** the explicit "build the intake prompt" action (the PROMPT-FREEZE
  mutation point). Reuses the SteerPanel "Generate" affordance styling.
- **Idiom:** native `<button type="button">`; label "Generate intake prompt"
  (pre-generate) / "Regenerate prompt" (when `prompt` already exists). A divergence
  (`dirty`) makes the regenerate cue appear beside it; the button itself is NEVER
  disabled in the gated case — instead, when CoD/JTBD are incomplete the prompt
  STILL builds (the builder is total: it omits the rank line + dashes empties),
  matching the slice's "no required-field gating" stance; the prompt is just
  thinner. (No `aria-disabled` guard this UC — the builder handles every input.)
- **States:** default · hover · focus-visible (`--focus-ring`) · active ·
  label-variant (Generate ↔ Regenerate).
- **Selector:** `getByRole('button', { name: /generate.*prompt/i })` — stable
  across BOTH labels (both match `/generate/i`… use `/generate intake prompt|regenerate prompt/i`
  or keep "Generate" in both: "Generate intake prompt" / "Re-generate prompt");
  `data-testid="intake-generate"`.
- **A11y:** native button (Enter+Space); hit box ≥ `--target-min`; `--focus-ring`.
- **Library:** custom (reuses the SteerPanel Generate button styling; no new token).

### PromptOutput (REUSED — s014 ratified component; NOT new)
- **Role/selector:** the read-only SELECTABLE `<pre data-testid="prompt-output"
  aria-label="Generated prompt" tabindex="0">` inside `data-testid=
  "prompt-output-slot"`, present ONLY when `prompt` is a non-empty string (absent,
  never empty, otherwise — the s014 slot rule). Mono font + `pre-wrap` +
  `max-height:40vh` internal scroll via the ratified `.prompt-output` class.
- **A11y/GEO:** inherits the s014 contract (focusable, `--focus-ring`, internal
  scroll = no drawer reflow). NO new CSS rule — reuse `steer-panel.css`'s
  `.prompt-output` (or hoist the rule if PromptStep doesn't import that sheet;
  engineer's call — the CONTRACT is one prompt-output presentation, not a fork).

### CopyPromptButton + CopyToast (REUSED verbatim — s014 components; NOT new)
- Imported as-is; `{ prompt, onCopied }` on the button; `{ visible }` on the toast.
  Byte-equal clipboard copy of the displayed `<pre>` text; "Copied ✓"; polite
  toast; failed write → no false cue. Present ONLY when `prompt` is set (the slot
  rule). The clipboard is the app's ONLY write surface (NO-WRITE — the same as
  s014; the FILESYSTEM stays untouched).

### NoWriteAffordance (NEW — the "this hands off to Claude, the UI writes nothing" note)
- **Role:** the explicit, always-visible NOWRITE affordance — tells the operator
  the dashboard does NOT submit/write; copy-and-paste to Claude is the handoff.
  The social signal the slice.md "work authority stays with the agents" demands.
- **Idiom:** a small labelled note (the LiveStatusDot/SourceLink caption idiom),
  visible in step 4 from pre-generate onward; text e.g. "The dashboard writes
  nothing — copy this prompt and paste it to Claude to enter it through the intake
  gate." Glyph (`✋`/`↗`) is `aria-hidden`; the TEXT is authoritative.
- **States:** present (always, in step 4).
- **Selector:** `data-testid="intake-nowrite-note"`; visible text contains
  "writes nothing" (or "the UI writes nothing") — assertable copy.
- **A11y:** static labelled text (not a control, no tab stop); contrast ≥ 4.5:1.
- **Library:** custom (caption idiom; reuses `--c-text-dim`/`--fs-label`; no new token).

### RegenerateCue (REUSES the ContextRefreshCue idiom — divergence signal)
- **Role:** signals the displayed (frozen) prompt is STALE relative to the current
  inputs — "Inputs changed — regenerate to refresh the prompt." Present only when
  `prompt` exists AND `dirty`.
- **States:** absent (no prompt yet, or prompt matches inputs) · `updated` (prompt
  exists + inputs diverged — text + ⟳ glyph + `--c-state-over` band, text
  authoritative).
- **Selector:** `data-testid="intake-regenerate-cue"`; `role="status"`
  `aria-live="polite"`; `data-state="updated"`.
- **A11y:** polite status (announce-once); never colour-only (text + glyph);
  contrast ≥ 4.5:1.
- **Library:** custom (the s014 ContextRefreshCue idiom; no new token).

### WizardComplete (NEW — the TERMINAL affordance: what the operator does after copying)
- **Role:** the wizard's terminal close-out — after the prompt is generated (and
  typically copied), the operator either FINISHES ("Done — close") or starts a
  fresh capture ("Start another"). This is the "wizard complete" affordance the
  brief requires; the wizard has no 5th step, so its forward motion ENDS here.
- **Idiom:** two native buttons in a terminal action row, shown once `prompt` is
  set: "Done" (closes the wizard = `onClose`, focus returns to the launcher — the
  inherited drawer focus-return contract) and "Start another" (`onReset` — clears
  the JTBD + CoD draft and returns `currentStep` to 1; the rank re-fetches on the
  next step-3 entry). A brief confirmation that the prompt was generated reads as
  the section's lead (e.g. "Your intake prompt is ready — copy it, then hand it to
  Claude.").
- **States:** absent (pre-generate) · present (prompt generated).
- **Selector:** Done `getByRole('button', { name: /done/i })`,
  `data-testid="intake-done"`; Start-another `getByRole('button', { name:
  /start another/i })`, `data-testid="intake-start-another"`.
- **A11y:** native buttons; keyboard-operable; hit box ≥ `--target-min`;
  `--focus-ring`; "Done" returns focus to the launcher (inherited contract);
  "Start another" moves focus to the wizard heading (the open-focus idiom).
- **Library:** custom (token-based; no new token).

---

## Click-path budget (this UC, with justification)

| Job (this UC) | Budget | Reality |
|---|---|---|
| "Generate the intake prompt" | **1 click from step 4** | "Next: Generate prompt" reaches step 4 (counted in step-3 budget); ONE click on "Generate intake prompt" builds + renders the frozen prompt. The builder reads the already-lifted draft — no re-entry of any field. |
| "Copy the prompt to hand to Claude" | **1 click** | the reused CopyPromptButton — byte-equal copy + toast (the s014 path). |
| "Finish / start another" | **1 click** | "Done" closes (focus → launcher); "Start another" resets to step 1. |
| "Refresh a stale prompt after editing" | **1 click** | the regenerate cue tells the operator; one "Regenerate prompt" press re-freezes the current inputs. |

No step is added that a default can remove: the builder reads the lifted draft (no
re-typing), Copy is one click (reused), the terminal affordance closes in one.

---

## Geometry — the step swap + the prompt render are INTERNAL content changes (do-no-harm)
The wizard is a body-portalled `position:fixed` drawer with zero flow height
(UC-S018-1 GEO basis). Replacing the step-4 placeholder with PromptStep AND
rendering the prompt `<pre>` (which has its OWN `max-height:40vh` internal scroll)
are content changes INSIDE that fixed drawer — they reflow nothing on the page
(map/views/tree unchanged) and must not change the drawer's own anchored box.
GEO-S018-4-1 pins the external no-reflow; GEO-S018-4-2 pins that the prompt
`<pre>` scrolls INTERNALLY (a long prompt does not grow the drawer past the
viewport / does not introduce a document scrollbar); GEO-S018-4-3 pins that the
prompt-step content STACKS (heading → nowrite note → generate → prompt → copy →
terminal row → nav — a column, not a row; the s002-line guard applied to step 4).

---

## Figure legibility (the generated prompt — applies the standing checklist)
The generated prompt is the data-bearing figure this UC; it passes:
1. **Human-meaningful, no token residue** — the rendered prompt contains NO
   `{{…}}`, NO `undefined`/`null`/`NaN`; empties are "—" or "not stated", never a
   broken slot.
2. **All four wizard inputs present + readable** — JTBD (situation/motivation/
   outcome), value token + its reason, urgency prose, risk prose all appear; the
   job sentence reads as a sentence (the step-1 composer, author-once).
3. **Gated / empty states honest** — an incomplete CoD OMITS the rank line (no
   fabricated rank); an empty queue uses the empty-queue sentence; nothing reads
   as a fabricated 0-rank.
4. **No raw refs** — no machine id / `row:N` / CSV key / sourceRef path in the
   prompt (operator + Claude language only).

---

## NO-WRITE / READ-ONLY contract (this UC + the social signal)
- **The wizard writes ZERO bytes to the filesystem.** `intakePromptBuilder` is a
  pure client-side fn; PromptStep issues NO `fetch`/`POST`/`PUT`/`PATCH`/`DELETE`
  on Generate, Copy, Done, or Start-another. The clipboard is the app's ONLY write
  surface (inherited from s014 — and even that is the OS clipboard, not the FS).
- The server write-guard (405) stays active (SM-CHK7-6 regression).
- The **NOWRITE affordance** (NoWriteAffordance) makes the "hands off to Claude,
  the UI writes nothing" promise VISIBLE to the operator — not just true, but
  legibly true (the slice's "work authority stays with the agents" social signal).
- No new GET this UC: the rank was fetched on step-3 entry; step 4 reads the
  already-lifted `rank` (NOWRITE-S018-4-2 — the items GET count stays 1 across the
  whole flow including step 4).

---

## Accessibility conditions (AA) → mirrored into acceptance.md
See acceptance.md UC-S018-4 section for AC-S018-4-* / BUILD / A11Y / GEO / FIG /
NOWRITE / FREEZE / SEL / NAV. Summary: the prompt step is a `role=group` named
`/generate prompt/i`; `<h3>` under the wizard `<h2>` (no skipped level); the
reused PromptOutput `<pre>` is focusable + labelled; CopyPromptButton + CopyToast
behave per the s014 contract (byte-equal, polite toast, no false cue); the
regenerate cue + nowrite note are non-colour-only labelled text; Generate / Done /
Start-another are keyboard-operable ≥ 24px native buttons; Done returns focus to
the launcher; the inherited shell focus/Esc/de-emphasis contract NOT regressed.

---

## Stable selectors handed to the engineer (the build contract + test hooks)
| Element | Selector contract |
|---|---|
| Prompt step region | `data-testid="prompt-step"` · `role="group"` `aria-labelledby`→`<h3>` |
| Prompt step heading | `data-testid="prompt-step-heading"` (`<h3>`, "Generate prompt") |
| Generate trigger | `getByRole('button', { name: /generate.*prompt/i })` · `data-testid="intake-generate"` (label flips Generate↔Regenerate, both match `/generate/i`) |
| Prompt output (REUSED) | `[data-testid="prompt-output"]` inside `[data-testid="prompt-output-slot"]` · `role`/`aria-label="Generated prompt"` · `tabindex="0"` |
| Copy button (REUSED) | `getByRole('button', { name: /copy/i })` · `data-testid="copy-prompt-btn"` · `data-copied` |
| Copy toast (REUSED) | `[data-testid="copy-toast"]` · `role="status"` `aria-live="polite"` |
| NoWrite note | `data-testid="intake-nowrite-note"` (visible text contains "writes nothing") |
| Regenerate cue | `data-testid="intake-regenerate-cue"` · `role="status"` `aria-live="polite"` · `data-state="updated"` (absent when not dirty) |
| Done (terminal) | `getByRole('button', { name: /done/i })` · `data-testid="intake-done"` |
| Start another (terminal) | `getByRole('button', { name: /start another/i })` · `data-testid="intake-start-another"` |

(No derived `nth(N)`/text-exclusion selectors. The three REUSED selectors are the
delivered s014 contract — unchanged.)

---

## Engineer needs (hand-off, UC-S018-4)
1. **`lib/intakePromptBuilder.js` is a pure total fn** — `buildIntakePrompt({jtbd,
   codScore, cod, rank})` → the `/intake` prompt STRING above. No DOM, no fetch,
   never throws, defined for empty JTBD fields / `codScore.complete===false` /
   `rank===null` / empty prose. REUSE `dash()` (or extract it to a shared `lib/`
   helper) + the `{{token}}`-substitution idiom from `promptBuilder.js`; the
   template lives in `templates/intake-prompt.txt`/`.js` (the steer-prompts idiom).
   Author the unit test FIRST (red→green): full inputs → all six fields + the rank
   line present and no `{{`/`undefined`; `rank===null`/`!complete` → NO rank line;
   `rank.empty` → the empty-queue sentence; empty prose → "not stated"; the job
   sentence equals `composeJobSentence(jtbd)` (author-once with step 1).
2. **REUSE, do not fork, the s014 handoff trio** — import `CopyPromptButton`,
   `CopyToast` (+ `toastDurationMs`) and render the prompt into the SAME
   `prompt-output-slot` + `.prompt-output` `<pre>` markup SteerPanel uses
   (components.md "PromptOutput"). The byte-equal clipboard path + the polite toast
   are unchanged. PromptStep owns the `toastVisible` boolean + the auto-dismiss
   timer (the SteerPanel pattern).
3. **PROMPT-FREEZE** — the `prompt` string mutates ONLY on a Generate press
   (mirror SteerPanelContainer's PROMPT-FREEZE-1). Snapshot the inputs at Generate;
   when the current lifted inputs diverge, show the RegenerateCue (the
   ContextRefreshCue idiom) — the SHOWN prompt stays frozen until Generate is
   pressed again. Do NOT live-rebuild the prompt as the operator edits earlier
   steps.
4. **Mount PromptStep into the EXISTING step-4 slot** — extend the shell's step
   ternary so `step === 4` renders `<PromptStep jtbd={fields} codScore={codScore}
   cod={cod} rank={rank} …/>` (the `wizard-step-placeholder` branch is then GONE);
   flip `INTAKE_STEPS[3].built = true`. Do NOT touch the shell's step machine,
   indicator de-emphasis rule, nav, drawer, or focus contract (UC-S018-1/2/3
   regression surface — the e2e a11y pin + the GEO-S018-*-1 reflow guards must
   still pass). On step 4, `nextStep` is null → "Next" is already absent; the
   terminal Done/Start-another affordance lives INSIDE PromptStep.
5. **Terminal affordance** — "Done" calls `onClose` (focus returns to the launcher,
   the inherited contract); "Start another" clears the JTBD + CoD draft and sets
   `currentStep` back to 1 (focus → wizard heading). Both appear only once a prompt
   is generated.
6. **NOWRITE affordance + no new GET** — render the visible "the UI writes nothing"
   note (NoWriteAffordance) in step 4; issue NO new network call (the rank is read
   from the already-lifted `rank`; the items GET count stays 1 across the whole
   flow). The clipboard is the only write surface; the FILESYSTEM is untouched
   (write-guard 405 still active).
7. **No new token, no new drawer, no new server route, no fork.** Reuse the s014
   prompt-output + copy + toast + Generate-button styling and existing colour/
   spacing/type tokens. The only new files are `lib/intakePromptBuilder.js` +
   `templates/intake-prompt.*` + `components/PromptStep.jsx`.
8. **TDD selectors above are the contract** — author the component/e2e specs
   against role+name (`role=group` `/generate prompt/i`, the Generate/Copy/Done/
   Start-another buttons) + the `intake-*`/reused testids, not derived selectors.

---

## NOT designed yet / explicitly out (UC-S018-4 closes the slice)
- Automatic submission of the prompt to Claude — copy-paste handoff ONLY (slice.md
  hard exclusion); the dashboard never POSTs the prompt anywhere.
- Required-field validation GATING on Generate — the builder is total (it dashes
  empties + omits the rank line), so the prompt always builds; a "complete enough"
  gate is a deliberate follow-on if the human wants it.
- Cost estimation in the prompt — left for the intake agent (slice.md); the prompt
  carries value signals only.
- Cross-session draft persistence — closing/Done discards the draft (no storage).
- The drawer-registry / layer-manager refactor of ObservatoryView — RETRO
  candidate (logged at UC-S018-1), not designed in.
- Defect intake path / multi-project / WSJF-CD3 numeric scoring — all out per
  slice.md.
