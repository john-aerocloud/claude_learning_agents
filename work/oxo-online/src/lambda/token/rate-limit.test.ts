import { describe, it, expect } from 'vitest';
import { decideRateLimit } from './rate-limit';

// S-A2.1 [S6] — pure per-IP budget decision. Deny when count has reached the
// threshold, Allow below it. The count passed in is the value AFTER this
// connect's increment (so the threshold-th attempt is the first to Deny).
describe('decideRateLimit — pure per-IP budget (S6)', () => {
  it('allows when the post-increment count is below the threshold', () => {
    expect(decideRateLimit(1, 5)).toBe('Allow');
    expect(decideRateLimit(4, 5)).toBe('Allow');
  });

  it('denies when the post-increment count has reached the threshold', () => {
    expect(decideRateLimit(5, 5)).toBe('Deny');
  });

  it('denies when the count is above the threshold', () => {
    expect(decideRateLimit(9, 5)).toBe('Deny');
  });
});
