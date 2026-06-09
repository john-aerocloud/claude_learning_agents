// @covers parseConstraint
// @covers matchConstraintQueue
// UC-S002-5 — baseline.md constraint parser (jsdom/node; pure string logic).
//
// Two responsibilities, separated on purpose:
//   parseConstraint(raw)          -> the constraint NAME named in baseline.md
//                                    (lowercased, trimmed, markdown stripped), or null
//   matchConstraintQueue(name)    -> that name IF it is one of the four queue
//                                    names, else null (the map only highlights a
//                                    box when the constraint actually IS a queue)
//
// WHY the split (the decision this slice forces): the LIVE baseline.md names the
// ToC constraint as an AGENT ("Constraint (slowest median step): **tester**"),
// which is NOT a pipeline queue. parseConstraint must still EXTRACT it (so UC6 /
// a future constraint chip can surface the name truthfully), but
// matchConstraintQueue returns null for it, so PipelineMap highlights NO box —
// we never paint a false constraint onto a queue. When baseline names an actual
// queue ("Constraint: ready") the match returns it and the box lights up.
import { describe, it, expect } from 'vitest';
import { parseConstraint, matchConstraintQueue } from '../baseline.js';

describe('parseConstraint (UC-S002-5)', () => {
  it('extracts a plain "Constraint: ready" line, lowercased + trimmed (AC5.1)', () => {
    expect(parseConstraint('Some text\nConstraint: ready\nMore text')).toBe('ready');
  });

  it('extracts a "ToC: Deploy" line, lowercased (AC5.2)', () => {
    expect(parseConstraint('Some text\nToC: Deploy\nMore text')).toBe('deploy');
  });

  it('extracts a "Constraint (ToC): <name>" parenthetical form', () => {
    expect(parseConstraint('Constraint (ToC): Intake')).toBe('intake');
  });

  it('parses the REAL baseline.md form with a parenthetical + markdown bold', () => {
    // the actual computed baseline.md line — an agent, not a queue
    const real = '## Theory-of-Constraints read\n\n- Constraint (slowest median step): **tester**\n';
    expect(parseConstraint(real)).toBe('tester');
  });

  it('strips surrounding markdown bold/emphasis and trailing punctuation', () => {
    expect(parseConstraint('Constraint: **ready** — the floor is empty')).toBe('ready');
    expect(parseConstraint('ToC: _deploy_')).toBe('deploy');
  });

  it('is case-insensitive on the label itself', () => {
    expect(parseConstraint('CONSTRAINT: Rework')).toBe('rework');
  });

  it('returns null for null input — no crash (AC5.3)', () => {
    expect(parseConstraint(null)).toBeNull();
  });

  it('returns null when no constraint line is present (AC5.4)', () => {
    expect(parseConstraint('no constraint line here')).toBeNull();
  });

  it('returns null for an empty / whitespace constraint value', () => {
    expect(parseConstraint('Constraint:   \nmore')).toBeNull();
  });
});

describe('matchConstraintQueue (UC-S002-5)', () => {
  it('returns the queue name when the constraint IS one of the four queues', () => {
    expect(matchConstraintQueue('ready')).toBe('ready');
    expect(matchConstraintQueue('Deploy')).toBe('deploy'); // case/space-insensitive
    expect(matchConstraintQueue('  intake  ')).toBe('intake');
    expect(matchConstraintQueue('rework')).toBe('rework');
  });

  it('returns null when the constraint is NOT a queue (e.g. the real "tester")', () => {
    expect(matchConstraintQueue('tester')).toBeNull();
    expect(matchConstraintQueue('engineer')).toBeNull();
  });

  it('returns null for null / empty (fail soft)', () => {
    expect(matchConstraintQueue(null)).toBeNull();
    expect(matchConstraintQueue('')).toBeNull();
  });
});
