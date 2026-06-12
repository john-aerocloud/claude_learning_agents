// @covers uc-s014-3
// @covers uc-s015-4
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

describe('promptBuilder — UC-S015-4 enriched re-slice/split (partAJob/partBJob)', () => {
  const PARTS = { partAJob: 'Part A delivers the read path', partBJob: 'Part B delivers the write path' };

  it('AC-1/AC-2: with both parts, the output carries all five fields verbatim + the labelled "Proposed split:" block', () => {
    const out = buildPrompt('re-slice', CTX, INTENT, PARTS);
    expect(out).toMatch(/^\/slice-next\b/); // still the /slice-next command form
    expect(out).toMatch(/CHK-5 — Compose a structured preview-first prompt/); // id WITH job (before)
    expect(out).toContain(`Part A: ${PARTS.partAJob}`); // after
    expect(out).toContain(`Part B: ${PARTS.partBJob}`); // after
    expect(out).toContain(INTENT); // operator intent verbatim
    expect(out).toContain('Proposed split:');
    // instructs Claude to PREVIEW the split before writing anything
    expect(out).toMatch(/before\/after/i);
    expect(out).toMatch(/before writing/i);
  });

  it('AC-2: the before figures (state/value/cost) ride along so Claude can preview queue impact', () => {
    const out = buildPrompt('re-slice', CTX, INTENT, PARTS);
    expect(out).toContain('planned');
    expect(out).toContain('HIGH');
    expect(out).toContain('Project: demo');
  });

  it('AC-3: both parts empty (the plain 3-arg s014 path) → output is UNCHANGED, no "Proposed split:" block', () => {
    const plain = buildPrompt('re-slice', CTX, INTENT);
    expect(plain).not.toContain('Proposed split:');
    expect(plain).not.toContain('Part A');
    // the s014 closing sentence is intact (backward-compat regression, AC-5)
    expect(plain).toContain('Please propose the thinnest split');
    // empty/absent opts are byte-identical to the 3-arg call
    expect(buildPrompt('re-slice', CTX, INTENT, {})).toBe(plain);
    expect(buildPrompt('re-slice', CTX, INTENT, { partAJob: '', partBJob: '' })).toBe(plain);
  });

  it('unknown ≠ blank: ONE part empty still renders the block, dashing the missing part', () => {
    const out = buildPrompt('re-slice', CTX, INTENT, { partAJob: 'only A', partBJob: '' });
    expect(out).toContain('Part A: only A');
    expect(out).toContain('Part B: —');
    expect(out).not.toMatch(/undefined|null/);
  });

  it('no unresolved {{token}} residue in the enriched output', () => {
    const out = buildPrompt('re-slice', CTX, INTENT, PARTS);
    expect(out).not.toMatch(/\{\{[^}]*\}\}/);
  });

  it('the other three action types IGNORE the parts option (additive, backward-compatible)', () => {
    for (const type of ['raise-defect', 're-prioritise', 'custom']) {
      expect(buildPrompt(type, CTX, INTENT, PARTS)).toBe(buildPrompt(type, CTX, INTENT));
    }
  });

  it('still pure: same input same output, no network', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('promptBuilder must not fetch');
    });
    const a = buildPrompt('re-slice', CTX, INTENT, PARTS);
    const b = buildPrompt('re-slice', CTX, INTENT, { ...PARTS });
    expect(a).toBe(b);
    expect(fetchSpy).not.toHaveBeenCalled();
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
