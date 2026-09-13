/**
 * PII redaction shared by the API and the admin UI.
 *
 * Client-safe on purpose: the constant lives here rather than in the route file
 * so the browser can recognise a withheld value by importing plain data, without
 * pulling a Prisma-bearing route handler into the client bundle.
 */

/** Marker substituted for withheld PII, so the UI can say "hidden" not "empty". */
export const REDACTED_FIELD = "[hidden for your role]";

/**
 * Returns a copy of a JSON snapshot with the named keys redacted.
 *
 * A copy is returned rather than mutating the row Prisma handed back, and the
 * key is replaced rather than deleted so the UI can render "withheld" instead of
 * a blank that looks like never-collected data.
 */
export function redactSnapshot(
  snapshot: Record<string, unknown> | null | undefined,
  keys: readonly string[]
): Record<string, unknown> {
  if (!snapshot || typeof snapshot !== "object") return {};

  const copy: Record<string, unknown> = { ...snapshot };
  for (const key of keys) {
    if (copy[key] !== undefined && copy[key] !== null && copy[key] !== "") {
      copy[key] = REDACTED_FIELD;
    }
  }
  return copy;
}

/** True when a value was withheld from this viewer. */
export function isRedacted(value: unknown): boolean {
  return value === REDACTED_FIELD;
}

/** Customer contact fields a role without `customers.read` must not receive. */
export const CUSTOMER_PII_FIELDS = [
  "mobileNumber",
  "email",
  "instagramHandle",
  "messengerName",
] as const;

/** Delivery fields that reveal where a customer lives. */
export const DELIVERY_PII_FIELDS = [
  "address",
  "phoneNumber",
  "postalCode",
  "additionalInstructions",
] as const;
