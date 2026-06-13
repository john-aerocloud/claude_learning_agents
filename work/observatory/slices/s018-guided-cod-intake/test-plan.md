# Test plan — UC-S018-1 (intake wizard shell + JTBD capture)

Iteration: 9
SHA under test: 6659ac8 (HEAD d7592ea at tester validation time)
Changed node window: 273e7fb..HEAD (impacted-tests --since 273e7fb)

---

## Changed nodes (11)

IntakeLauncher, IntakeWizard, JobSentenceLib, JobSentencePreview, JtbdFields,
WizardStepIndicator, WizardStepNav, ObservatoryDrawerLayer (surface),
ValueStreamScreen (surface), WipViewScreen (surface), DefectsViewScreen (surface)

---

## IMPACTED SPECS — tick-off

### IntakeLauncher (NEW)
- [ ] e2e/intake-wizard.spec.js — GEO-S018-1-3, AC-S018-1-1/2/4, A11Y-S018-1-4, NOWRITE-S018-1-1
- [ ] src/components/__tests__/IntakeLauncher.test.jsx — unit
- [ ] src/components/__tests__/ObservatoryViewIntake.test.jsx — integration mount

### IntakeWizard (NEW)
- [ ] e2e/intake-wizard.spec.js — GEO-S018-1-1/2, AC-S018-1-1/2/4, A11Y-S018-1-4, NOWRITE-S018-1-1
- [ ] src/components/__tests__/IntakeWizard.test.jsx — unit/integration
- [ ] src/components/__tests__/ObservatoryViewIntake.test.jsx — integration mount

### JobSentencePreview (NEW)
- [ ] src/components/__tests__/IntakeWizard.test.jsx
- [ ] src/lib/__tests__/jobSentence.test.js

### JtbdFields (NEW)
- [ ] src/components/__tests__/IntakeWizard.test.jsx

### WizardStepIndicator (NEW)
- [ ] src/components/__tests__/IntakeWizard.test.jsx

### WizardStepNav (NEW)
- [ ] src/components/__tests__/IntakeWizard.test.jsx

---

## UNCOVERED CHANGED NODES — waivers

| Node | Assessment | Waiver |
|------|-----------|--------|
| JobSentenceLib | Pure domain fn lib/jobSentence.js — covered BEHAVIORALLY by jobSentence.test.js (which carries @covers JobSentencePreview); no direct @covers tag on the lib node. Advisory finding — the lib is tested, tag is missing. | Advisory — covered by jobSentence.test.js functional assertions |
| DefectsViewScreen | Surface node: IntakeLauncher now renders on it (persistent launcher), but the surface component itself unchanged. GEO-S018-1-3 e2e assertion indirectly guards it (tablist unmoved across all views). | Waived: surface node, IntakeLauncher presence on all views covered by existing e2e and view-switch specs |
| ObservatoryDrawerLayer | Architectural surface: wizard was added as 5th consumer. The node itself is stable; its new consumer (IntakeWizard) is tested. | Waived: stable architectural node; new consumer tested via intake-wizard.spec.js |
| ValueStreamScreen | Surface node: same as DefectsViewScreen — launcher appears here, surface unchanged. | Waived: tested via GEO-S018-1-1/2/3 on the default Pipeline view |
| WipViewScreen | Surface node: same pattern | Waived: cross-view launcher persistence is a view-switch regression, not new behaviour |

---

## Tester-enforced additions (from task brief — TESTER-ENFORCED)

These acceptance conditions were explicitly called out as tester-enforced additions
not authored in the committed e2e/intake-wizard.spec.js:

| AC | Description | Plan |
|----|-------------|------|
| A11Y-S018-1-5 | Visible focus ring on all interactive elements (:focus-visible) | Write + run as part of this validation |
| A11Y-S018-1-6 | Target size ≥ 24×24 px for launcher, Close ×, Next | Write + run |
| A11Y-S018-1-10 | Contrast ≥ 4.5:1; empty-slot placeholder distinct color | Write + run |
| A11Y-S018-1-11 | Reduced motion → drawer animation 0ms | Write + run |
| A11Y-S018-1-12 | One h1; ordered headings; axe heading-order + axe color-contrast | Write + run |
| GEO-S018-1-3 (pre-s018 baseline comparison) | TabList bbox unchanged vs no-launcher baseline | Covered by committed spec GEO-S018-1-3 (asserts tablist keeps left edge + top alignment) |

---

## Acceptance cases mapped to specs

| AC | Spec |
|----|------|
| AC-S018-1-1 | e2e/intake-wizard.spec.js (one-click, three fields) |
| AC-S018-1-2 | e2e/intake-wizard.spec.js (live sentence) |
| AC-S018-1-3 | e2e/intake-wizard.spec.js GEO-S018-1-1 |
| AC-S018-1-4 | e2e/intake-wizard.spec.js (console error-free) |
| A11Y-S018-1-1..4, 7..9 | IntakeWizard.test.jsx + e2e |
| A11Y-S018-1-5,6,10,11,12 | TESTER-ENFORCED — new specs in this run |
| GEO-S018-1-1..4 | e2e/intake-wizard.spec.js |
| FIG-S018-1-1..3 | IntakeWizard.test.jsx + jobSentence.test.js |
| NOWRITE-S018-1-1..2 | e2e/intake-wizard.spec.js + existing write-guard spec |
| NAV-S018-1-1..2 | e2e/intake-wizard.spec.js NOWRITE test (Next+Back) |
| SEL-S018-1-1..5 | All specs (stable selectors throughout) |

---

## Final tick-off status

### IMPACTED SPECS — results
- [x] IntakeLauncher: e2e/intake-wizard.spec.js PASS; IntakeLauncher.test.jsx PASS; ObservatoryViewIntake.test.jsx PASS
- [x] IntakeWizard: e2e/intake-wizard.spec.js PASS; IntakeWizard.test.jsx PASS; ObservatoryViewIntake.test.jsx PASS
- [x] JobSentencePreview: IntakeWizard.test.jsx PASS; jobSentence.test.js PASS
- [x] JtbdFields: IntakeWizard.test.jsx PASS
- [x] WizardStepIndicator: IntakeWizard.test.jsx PASS
- [x] WizardStepNav: IntakeWizard.test.jsx PASS

### Tester-enforced A11Y — results
- [x] A11Y-5 (focus ring): PASS
- [x] A11Y-6 (target size ≥ 24×24): PASS
- [x] A11Y-10 (placeholder colour / no grammar breaks): PASS
- [x] A11Y-11 (reduced-motion 0ms): PASS
- [x] A11Y-12 (axe color-contrast + heading-order): PASS (rework ed7848c) — opacity removed; --c-text-dim (#a6adbb) at full alpha = 6.7:1 on --c-surface-raised; no heading-order violations; axe clean; 3-run anti-race confirmed

## Status: PASS — all acceptance conditions met (sha ed7848c, iteration 9, 2026-06-13)
