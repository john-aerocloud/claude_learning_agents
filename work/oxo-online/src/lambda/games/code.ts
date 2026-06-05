import { randomInt } from 'node:crypto';

/**
 * Unambiguous, Crockford-style alphabet: uppercase letters and digits with the
 * visually confusable characters removed (O, 0, 1, I, L). A player must be able
 * to read the code off one screen and type it on another without misreads.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

/**
 * Generate a 6-character share code from the unambiguous alphabet.
 * Uses a CSPRNG (`crypto.randomInt`) so codes are not predictable. Uniqueness is
 * NOT guaranteed here — collision handling is deferred to s005 (the join slice),
 * where a `code` GSI + conditional put is introduced.
 */
export function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}
