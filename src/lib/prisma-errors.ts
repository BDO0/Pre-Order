/**
 * Reading a unique-constraint violation out of whatever shape it arrives in.
 *
 * Prisma maps Postgres' 23505 to P2002, but with a driver adapter the raw code
 * can surface instead, so both are accepted. The interesting part is the
 * *target*: Prisma usually reports it as `meta.target` (a field list, or a single
 * field), a raw driver error reports only the constraint name, and Prisma 7 with
 * a driver adapter sometimes reports it only inside the message. All three shapes
 * are handled here because the callers all need the same answer: "which column
 * did somebody collide with?"
 *
 * Lives in its own module because it is not about orders: the product routes use
 * it to turn a duplicate `slug` into a 409 instead of a 500, and the order
 * service uses it to decide which collisions are worth retrying.
 */

/**
 * Returns the lower-cased target of a unique-constraint violation, or null if
 * the error is not a unique violation.
 */
export function uniqueViolationTarget(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;

  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== "P2002" && candidate.code !== "23505") return null;

  const target = candidate.meta?.target;
  if (Array.isArray(target)) return target.join(",").toLowerCase();
  if (typeof target === "string") return target.toLowerCase();

  const constraint = (error as { constraint?: unknown }).constraint;
  if (typeof constraint === "string") return constraint.toLowerCase();

  // Prisma 7 with a driver adapter can report the violation only through the
  // message ("Unique constraint failed on the constraint: `x_key`"), which made
  // this return "" and turned the caller's retry into dead code.
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message.toLowerCase() : "";
}
