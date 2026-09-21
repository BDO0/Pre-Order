/**
 * The admin password policy, in one place.
 *
 * Three entry points enforce it — `POST /api/admin/password`, the admin seed and
 * `scripts/admin-create.ts` — and they were written at different times by
 * different hands. A setup script that accepts a password the app would then
 * refuse (or the reverse) is worse than either rule on its own, so the numbers
 * and the sentences live here and are imported rather than repeated.
 *
 * Deliberately dependency-free: no Prisma, no Node built-ins, nothing that stops
 * a client component or a plain Node script from importing it.
 */

/** Long enough to survive a real guess budget, short enough to be typeable. */
export const MIN_PASSWORD_LENGTH = 12;
/**
 * bcrypt hashes at most 72 bytes of input and *silently* ignores the rest, so a
 * 200-character password would be no stronger than its first 72 bytes. Refusing
 * it outright is more honest than pretending it was used in full.
 */
export const MAX_PASSWORD_LENGTH = 72;
/**
 * The password `prisma/seed.ts` used to ship for the demo admin.
 *
 * The demo seed no longer creates an admin at all, but the value is still
 * refused everywhere: a database seeded by an older version of this repo has it,
 * and "change the password to the one we told you to change" must not succeed.
 */
export const SEEDED_DEFAULT_PASSWORD = "admin123";

/**
 * Why `password` cannot be used, as a sentence to show somebody, or `null` when
 * it is acceptable.
 *
 * The phrasing is neutral ("A password must be...") because it is shown to an
 * operator changing their own password *and* printed by a setup script that is
 * refusing to create an account with it.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `A password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `A password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  if (password === SEEDED_DEFAULT_PASSWORD) {
    return "That is the password the setup script ships with. Please choose a different one.";
  }
  return null;
}

/**
 * A random password for a first-run account.
 *
 * Alphanumeric only: it is printed to a terminal and typed by hand, and a
 * password that dies to a shell's quoting rules or to a font's rendering of
 * `l`/`1`/`O`/`0` is a support call rather than security. 24 characters of
 * 56-symbol alphabet is ~139 bits, which is far past what the removed
 * characters could have bought.
 *
 * `crypto.getRandomValues` rather than `Math.random`, and rejection sampling
 * rather than a modulo fold, so no character is more likely than another.
 */
export function generatePassword(length = 24): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  // Bytes at or above the largest multiple of the alphabet length are discarded
  // instead of wrapped: 256 % 56 is 32, and folding would make the first 32
  // characters measurably likelier than the rest.
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;

  let password = "";
  while (password.length < length) {
    const bytes = new Uint8Array((length - password.length) * 2);
    crypto.getRandomValues(bytes);

    for (const byte of bytes) {
      if (byte >= limit) continue;
      password += alphabet[byte % alphabet.length];
      if (password.length === length) break;
    }
  }

  return password;
}
