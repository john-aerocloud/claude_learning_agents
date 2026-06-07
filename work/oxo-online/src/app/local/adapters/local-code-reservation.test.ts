import { describe, it, expect } from 'vitest';
import { LocalCodeReservation } from './local-code-reservation';
import { CodeCollision } from '../../../lambda/games/codes/ports';

// @covers adapterLocalCodeReservation (class-deps.mmd s005-h3)

describe('LocalCodeReservation — in-memory reject BRANCH SHAPE (§12a)', () => {
  it('reserves a fresh code without error', async () => {
    const store = new LocalCodeReservation();
    await expect(store.reserve('ABC234', 'g1')).resolves.toBeUndefined();
  });

  it('throws CodeCollision when the code is already reserved', async () => {
    const store = new LocalCodeReservation();
    await store.reserve('ABC234', 'g1');
    // A second reserve of the SAME code (a different game) collides — this is the
    // reject branch the SM-1/SM-4 injection tests exercise locally. §12a: this is
    // the branch SHAPE only, NOT real DynamoDB single-item CAS atomicity under
    // genuine concurrency (that is the AC-6 pin + AC-2 prod proof).
    await expect(store.reserve('ABC234', 'g2')).rejects.toBeInstanceOf(CodeCollision);
  });

  it('allows a different code after a collision (independent draws)', async () => {
    const store = new LocalCodeReservation();
    await store.reserve('ABC234', 'g1');
    await expect(store.reserve('XYZ789', 'g2')).resolves.toBeUndefined();
  });
});
