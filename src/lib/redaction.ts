/**
 * PII redaction shared by the API and the admin UI.
 *
 * Client-safe on purpose: the constant lives here rather than in the route file
 * so the browser can recognise a withheld value by importing plain data, without
 * pulling a Prisma-bearing route handler into the client bundle.
 */

import {
  readSnapshotAnswers,
  type SnapshotAnswer,
} from "@/lib/order-answers";

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

/**
 * Customer fields a role without `customers.read` must not receive.
 *
 * The Instagram handle is contact information — it is how the operator reaches
 * the customer — so it is withheld from roles that have no business contacting
 * anyone. The name is kept: without it the order queue is unreadable, and a name
 * alone does not let anyone reach the customer.
 */
export const CUSTOMER_PII_FIELDS = ["instagramHandle"] as const;

/**
 * Redacts a `customerSnapshot`, including the operator-defined answers.
 *
 * An answer is withheld when the field was marked sensitive when the answer was
 * written, or when it is marked sensitive now — so flagging a field is
 * immediately effective on history without retroactively exposing anything when
 * the flag is removed.
 *
 * The label is kept while the value is replaced: a reviewer must be able to see
 * that an address was supplied and is withheld, rather than wondering whether the
 * customer answered at all.
 */
export function redactCustomerSnapshot(
  snapshot: Record<string, unknown> | null | undefined,
  sensitiveKeys: ReadonlySet<string>
): Record<string, unknown> {
  const redacted = redactSnapshot(snapshot, CUSTOMER_PII_FIELDS);

  const answers = readSnapshotAnswers(snapshot).map((answer: SnapshotAnswer) =>
    answer.sensitive || sensitiveKeys.has(answer.key)
      ? { ...answer, value: REDACTED_FIELD }
      : answer
  );

  return { ...redacted, answers };
}

