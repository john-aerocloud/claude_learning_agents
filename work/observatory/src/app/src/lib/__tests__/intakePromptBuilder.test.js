// @covers uc-s018-4
// @covers intakePromptBuilder
// @covers buildIntakePrompt
// UC-S018-4 — intakePromptBuilder: PURE total fn composing the captured JTBD +
// CoD + rank into a copy-ready /intake slash-command prompt the operator hands
// to Claude. No DOM, no fetch, never throws — this file passes standalone,
// without the server, without the DOM (BUILD-S018-4-2 / AC-S018-4-3).
//
// Contract pinned here (BUILD-S018-4-1..6 / FIG-S018-4-1..4):
//   - buildIntakePrompt({jtbd, codScore, cod, rank}) -> non-empty STRING;
//   - first line is the /intake command with composeJobSentence(jtbd) as the
//     argument (author-once with step 1 — BUILD-S018-4-4);
//   - the value line carries the token + codScore.reason (author-once with the
//     CodScoreReadout — BUILD-S018-4-5);
//   - the rank line is GATED: omitted when rank==null||!complete; the
//     empty-queue sentence when rank.empty; else rank.sentence VERBATIM
//     (author-once with step 3 — BUILD-S018-4-6);
//   - all four wizard inputs present; empty prose → "not stated"; no {{token}}
//     residue, no undefined/null/NaN, no raw refs (FIG-S018-4-1/2/3/4);
//   - total + pure: defined for empty JTBD / incomplete CoD / null rank / empty
//     prose; never throws; no side effects.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildIntakePrompt } from '../intakePromptBuilder.js';
import { composeJobSentence } from '../jobSentence.js';

const JTBD = {
  situation: 'the loop starves because no UI work is queued',
  motivation: 'see which queue is empty at a glance',
  outcome: 'replenish before the constraint goes idle',
};

const COD_SCORE_HIGH = {
  token: 'HIGH',
  band: 'HIGH',
  complete: true,
  reason: 'High value and time-critical — ranks with the top tier.',
};

const COD_PROSE = {
  value: 'HIGH',
  timeCritical: true,
  urgencyWhy: 'the loop is idle right now',
  riskOfDelay: 'engineers sit idle while the constraint stalls',
};

const RANK_READY = {
  complete: true,
  total: 6,
  ahead: 2,
  behind: 3,
  alongside: 1,
  token: 'HIGH',
  empty: false,
  sentence:
    'Your item (HIGH value) would rank ahead of 2 items and behind 3 items, ' +
    'alongside 1 at the same priority — placing it near the top of the queue.',
};

const FULL = { jtbd: JTBD, codScore: COD_SCORE_HIGH, cod: COD_PROSE, rank: RANK_READY };

describe('buildIntakePrompt — shape & command form', () => {
  it('BUILD-S018-4-1: returns a non-empty string', () => {
    const out = buildIntakePrompt(FULL);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('AC-S018-4-3: the first line is the /intake command with the job sentence as its argument', () => {
    const out = buildIntakePrompt(FULL);
    const firstLine = out.split('\n')[0];
    const sentence = composeJobSentence(JTBD).text;
    expect(firstLine).toBe(`/intake ${sentence}`);
    expect(firstLine).toMatch(/^\/intake When .+, I want to .+, so I can .+\.$/);
  });

  it('BUILD-S018-4-4: the /intake argument equals composeJobSentence(jtbd) (author-once)', () => {
    const out = buildIntakePrompt(FULL);
    const sentence = composeJobSentence(JTBD).text;
    expect(out).toContain(`/intake ${sentence}`);
  });
});

describe('buildIntakePrompt — all four inputs present (FIG-S018-4-2 / AC-S018-4-1)', () => {
  it('contains the JTBD situation, motivation, outcome verbatim', () => {
    const out = buildIntakePrompt(FULL);
    expect(out).toContain(JTBD.situation);
    expect(out).toContain(JTBD.motivation);
    expect(out).toContain(JTBD.outcome);
  });

  it('BUILD-S018-4-5: the value line carries the token AND codScore.reason (author-once)', () => {
    const out = buildIntakePrompt(FULL);
    expect(out).toMatch(/Value signal:\s*HIGH\s*—\s*High value and time-critical/);
    expect(out).toContain(COD_SCORE_HIGH.reason);
  });

  it('contains the urgency prose and the risk prose verbatim', () => {
    const out = buildIntakePrompt(FULL);
    expect(out).toContain(COD_PROSE.urgencyWhy);
    expect(out).toContain(COD_PROSE.riskOfDelay);
  });
});

describe('buildIntakePrompt — rank line gated (BUILD-S018-4-6 / FIG-S018-4-3)', () => {
  it('rank===null → OMITS the rank line entirely (no fabricated rank)', () => {
    const out = buildIntakePrompt({ ...FULL, rank: null });
    expect(out).not.toMatch(/Queue rank/i);
  });

  it('rank.complete===false → OMITS the rank line entirely', () => {
    const out = buildIntakePrompt({ ...FULL, rank: { complete: false, sentence: '', empty: true } });
    expect(out).not.toMatch(/Queue rank/i);
  });

  it('rank.empty===true → the rank line is the empty-queue sentence', () => {
    const emptyRank = {
      complete: true,
      total: 0,
      ahead: 0,
      behind: 0,
      alongside: 0,
      token: 'HIGH',
      empty: true,
      sentence: 'The queue is currently empty — your item would be next.',
    };
    const out = buildIntakePrompt({ ...FULL, rank: emptyRank });
    expect(out).toMatch(/Queue rank/i);
    expect(out).toContain('The queue is currently empty — your item would be next.');
    expect(out).not.toMatch(/ahead of 0 .* behind 0/);
  });

  it('rank ready → the rank line is rank.sentence VERBATIM (author-once with step 3)', () => {
    const out = buildIntakePrompt(FULL);
    expect(out).toContain(RANK_READY.sentence);
  });
});

describe('buildIntakePrompt — totality, no residue, no junk (BUILD-S018-4-2/3 / FIG-S018-4-1)', () => {
  it('never leaves {{token}} residue / undefined / null / NaN — full inputs', () => {
    const out = buildIntakePrompt(FULL);
    expect(out).not.toMatch(/\{\{/);
    expect(out).not.toMatch(/undefined|null|NaN/);
  });

  it('empty optional prose renders "not stated", never a broken slot', () => {
    const out = buildIntakePrompt({
      ...FULL,
      cod: { ...COD_PROSE, urgencyWhy: '', riskOfDelay: '' },
    });
    expect(out).toMatch(/Urgency:\s*not stated/);
    expect(out).toMatch(/Risk of delay:\s*not stated/);
    expect(out).not.toMatch(/undefined|null/);
  });

  it('totality: empty JTBD + incomplete CoD + null rank → still a string, no throw, no junk', () => {
    const incomplete = {
      jtbd: { situation: '', motivation: '', outcome: '' },
      codScore: { token: null, band: null, complete: false, reason: '' },
      cod: { value: null, timeCritical: null, urgencyWhy: '', riskOfDelay: '' },
      rank: null,
    };
    let out;
    expect(() => {
      out = buildIntakePrompt(incomplete);
    }).not.toThrow();
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toMatch(/\{\{/);
    expect(out).not.toMatch(/undefined|null|NaN/);
    expect(out).not.toMatch(/Queue rank/i); // incomplete → no rank line
  });

  it('totality: called with NO argument → still a string, no throw', () => {
    let out;
    expect(() => {
      out = buildIntakePrompt();
    }).not.toThrow();
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('value line with an incomplete CoD reads "not stated", not a bare null', () => {
    const out = buildIntakePrompt({
      ...FULL,
      codScore: { token: null, band: null, complete: false, reason: '' },
    });
    expect(out).toMatch(/Value signal:/);
    expect(out).not.toMatch(/undefined|null/);
  });
});

describe('buildIntakePrompt — no raw refs, pure (FIG-S018-4-4 / BUILD-S018-4-2)', () => {
  it('contains no machine id / row:N / CSV key / sourceRef path', () => {
    const out = buildIntakePrompt(FULL);
    expect(out).not.toMatch(/row:\d+/);
    expect(out).not.toMatch(/work\/[^/]+\/items/);
    expect(out).not.toMatch(/vc_ratio|done_ts|sourceRef/);
  });

  it('is pure — issues no fetch (no network access)', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    buildIntakePrompt(FULL);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('is referentially transparent — same input, same output', () => {
    expect(buildIntakePrompt(FULL)).toBe(buildIntakePrompt(FULL));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
