import {
  CodeCollision,
  type CodeReservationPort,
} from '../../../lambda/games/codes/ports';

/**
 * LocalCodeReservation — in-memory CodeReservationPort for the local stand-up +
 * unit-injection (s005-h3 / delta 009, principles/02). Implements the SAME
 * domain-defined port the DynamoDB adapter implements, so the create-game
 * reserve→retry BRANCH stands up locally behind the same seam (§41) with no
 * cloud creds. A `Map<code, gameId>` whose `reserve` throws CodeCollision when
 * the key already exists reproduces the reject branch shape.
 *
 * Mocked-adapter caution (§12a, VERBATIM from the delta): a JS map reproduces the
 * reject BRANCH SHAPE, not real DynamoDB conditional ATOMICITY under genuine
 * concurrency. The platform atomicity guarantee is covered by the AC-6
 * ConditionExpression pin + the tester's AC-2 50-concurrent prod proof — NOT by
 * this adapter.
 */
export class LocalCodeReservation implements CodeReservationPort {
  private reserved = new Map<string, string>();

  async reserve(code: string, gameId: string): Promise<void> {
    if (this.reserved.has(code)) {
      throw new CodeCollision();
    }
    this.reserved.set(code, gameId);
  }
}
