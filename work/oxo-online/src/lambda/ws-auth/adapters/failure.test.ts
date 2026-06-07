import { describe, it, expect } from 'vitest';
import { categoriseDdbError } from './failure';

// §41 failure taxonomy: a 5xx/timeout from an external service after retry is
// EXTERNAL_DEPENDENCY (availability); a 4xx is INTERNAL (we built a bad request).
describe('categoriseDdbError', () => {
  it('5xx → EXTERNAL_DEPENDENCY', () => {
    expect(
      categoriseDdbError({ $metadata: { httpStatusCode: 500 } }),
    ).toBe('EXTERNAL_DEPENDENCY');
    expect(
      categoriseDdbError({ $metadata: { httpStatusCode: 503 } }),
    ).toBe('EXTERNAL_DEPENDENCY');
  });

  it('4xx → INTERNAL', () => {
    expect(
      categoriseDdbError({ $metadata: { httpStatusCode: 400 } }),
    ).toBe('INTERNAL');
    expect(
      categoriseDdbError({ $metadata: { httpStatusCode: 409 } }),
    ).toBe('INTERNAL');
  });

  it('no status code (timeout / conn refused) → EXTERNAL_DEPENDENCY', () => {
    expect(categoriseDdbError(new Error('ETIMEDOUT'))).toBe(
      'EXTERNAL_DEPENDENCY',
    );
  });
});
