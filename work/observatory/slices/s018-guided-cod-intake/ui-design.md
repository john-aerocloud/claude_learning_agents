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
