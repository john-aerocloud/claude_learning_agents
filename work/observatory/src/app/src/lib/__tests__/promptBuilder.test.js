// @covers uc-s014-3
// @covers PromptBuilder
// @covers SteerPromptTemplates
// UC-S014-3 — promptBuilder: PURE function (action type + SteerContext +
// intent note → filled slash-command prompt string). AC-5 is this file: it
// passes standalone, without the server, without the DOM.
//
// Contract pinned here:
//   - one template per steer action type (raise-defect / re-prioritise /
//     re-slice / custom), shapes matching the project's REAL .claude/commands
//     (/defect's four fields are expected/actual/intent/importance);
//   - every output carries the HUMAN refs: item id + job sentence together,
//     the operator's intent VERBATIM (multiline preserved), never a raw row
//     ref (no sourceRef path, no row:N) — figure legibility;
//   - {{tokens}} are all resolved — no mustache residue ever reaches the
//     operator; absent source values render "—", never undefined/null/blank;
//   - project_id is derived from context.sourceRef (work/<project>/…);
//   - pure: no network, no DOM — same input, same output (AC-4).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildPrompt } from '../promptBuilder.js';

const CTX = {
  id: 'CHK-5',
  job: 'Compose a structured preview-first prompt',
  state: 'planned',
  value: 'HIGH',
  cost: 'M',
  sourceRef: 'work/demo/items/items.csv#id=CHK-5',
};

const INTENT = 'split this UC into two so the copy step ships first';
const ALL_TYPES = ['raise-defect', 're-prioritise', 're-slice', 'custom'];

afterEach(() => vi.restoreAllMocks());

describe('promptBuilder (UC-S014-3) — AC-5: every action type fills all required fields', () => {
  it.each(ALL_TYPES)('"%s" output contains item id, job sentence, and the intent verbatim', (type) => {
    const out = buildPrompt(type, CTX, INTENT);
    expect(out).toContain('CHK-5');
    expect(out).toContain(CTX.job);
    expect(out).toContain(INTENT); // operator intent VERBATIM
  });

  it.each(ALL_TYPES)('"%s" output has no unresolved {{token}} residue', (type) => {
    const out = buildPrompt(type, CTX, INTENT);
    expect(out).not.toMatch(/\{\{[^}]*\}\}/);
  });

  it.each(ALL_TYPES)('"%s" output carries human refs only — no raw row refs (figure legibility)', (type) => {
    const out = buildPrompt(type, CTX, INTENT);
    expect(out).not.toContain(CTX.sourceRef); // no raw CSV path ref
    expect(out).not.toMatch(/\brow:\d+/);
    expect(out).not.toContain('vc_ratio'); // no raw CSV keys
    // id is shown WITH its human job sentence ("CHK-5 — <job>")
    expect(out).toMatch(/CHK-5 — Compose a structured preview-first prompt/);
  });
});

describe('promptBuilder — per-action slash-command shapes match .claude/commands', () => {
  it('AC-1 "raise-defect" follows the /defect shape: verb + the four real fields', () => {
    const out = buildPrompt('raise-defect', CTX, INTENT);
    expect(out).toMatch(/^\/defect\b/); // the prompt IS the slash command
    expect(out).toContain('planned'); // current state
    // the REAL /defect fields are expected/actual/intent/importance
    // (commands/defect.md) — not "classification"
    expect(out).toMatch(/expected/i);
    expect(out).toMatch(/actual/i);
    expect(out).toMatch(/intent/i);
    expect(out).toMatch(/importance/i);
    expect(out).toContain('Project: demo'); // project_id derived from sourceRef
  });

  it('AC-2 "re-prioritise" follows the /intake update shape with the human verb', () => {
    const out = buildPrompt('re-prioritise', CTX, INTENT);
    expect(out).toMatch(/^\/intake\b/);
    expect(out).toMatch(/re-prioritis/i); // human verb, never a raw enum key alone
    expect(out).toContain('HIGH'); // current value
    expect(out).toContain('M');    // current cost
  });

  it('"re-slice" follows the /slice-next replenishment shape', () => {
    const out = buildPrompt('re-slice', CTX, INTENT);
    expect(out).toMatch(/^\/slice-next\b/);
    expect(out).toMatch(/re-slice/i);
    expect(out).toContain('planned');
  });

  it('"custom" is a freeform block: item context header + intent body', () => {
    const out = buildPrompt('custom', CTX, INTENT);
    expect(out).toMatch(/^Steer request — demo/); // project in the header (product wording)
    expect(out.indexOf('CHK-5')).toBeLessThan(out.indexOf(INTENT)); // context header, intent body
  });

  it('an unknown action type throws (programming error, not a blank prompt)', () => {
    expect(() => buildPrompt('nuke-it', CTX, INTENT)).toThrow(/unknown.*action/i);
  });
});

describe('promptBuilder — unknown ≠ blank (figure legibility §4)', () => {
  it('absent source values render as "—", never undefined/null/empty token', () => {
    const sparse = { id: 'CHK-9', job: '', state: '', value: '', cost: '', sourceRef: '' };
    const out = buildPrompt('re-slice', sparse, INTENT);
    expect(out).not.toMatch(/undefined|null/);
    expect(out).toContain('—'); // dashes where the source was empty
    expect(out).not.toMatch(/\{\{[^}]*\}\}/);
    expect(out).toContain('CHK-9');
  });

  it('a multiline intent note survives verbatim', () => {
    const multi = 'line one\nline two: keep | pipes & {braces}';
    const out = buildPrompt('custom', CTX, multi);
    expect(out).toContain(multi);
  });
});

describe('promptBuilder — purity (AC-4: no server call during generation)', () => {
  it('never touches the network and is deterministic', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('promptBuilder must not fetch');
    });
    const a = buildPrompt('raise-defect', CTX, INTENT);
    const b = buildPrompt('raise-defect', CTX, INTENT);
    expect(a).toBe(b);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
