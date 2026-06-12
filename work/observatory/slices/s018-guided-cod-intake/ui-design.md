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
- CoD signals step + value-token scorer UI (UC-S018-2) — only its PLANNED step
  slot + placeholder is shown here.
- Queue-rank preview (UC-S018-3) — its step slot is planned-not-built.
- Intake prompt builder + copy/toast handoff (UC-S018-4) — its step slot is
  planned-not-built; reuses SteerPanel copy/toast then.
- Required-field validation gating on Next (arrives as the flow fills out in
  -2/-3).
- Mobile/responsive, draft persistence between sessions, WSJF/CD3 scoring,
  defect intake path, multi-project — all out per slice.md.
- The drawer-registry / layer-manager refactor of ObservatoryView — RETRO
  candidate, not designed in.
