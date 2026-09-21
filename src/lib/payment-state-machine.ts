// Type-only import: safe to import from client components. The admin UI derives
// its buttons from these rules so it can never offer an action the API rejects.
import type { PaymentStatus } from "@prisma/client";

/**
 * The payment rules, reduced to what the business actually does.
 *
 * Money is collected in Instagram DM, outside the app. The only thing the app
 * can honestly know is whether the operator has confirmed receipt, so there is
 * exactly one transition in each direction and no review workflow to get stuck
 * in. Kept as its own module (rather than an inline `!paid`) because the admin UI
 * and the API must agree on what a toggle may do, and a type-only Prisma import
 * keeps it usable from client components.
 */

/** What a toggle request asks for, and what it moves the order to. */
export interface PaymentToggle {
  /** The action's verb, used in the audit log (`payment.paid`). */
  action: "MARK_PAID" | "MARK_UNPAID";
  to: PaymentStatus;
  label: string;
  hint: string;
}

export const PAYMENT_TOGGLES: Record<PaymentToggle["action"], PaymentToggle> = {
  MARK_PAID: {
    action: "MARK_PAID",
    to: "PAID",
    label: "Mark as paid",
    hint: "The money is in — record it so the reports stop asking.",
  },
  MARK_UNPAID: {
    action: "MARK_UNPAID",
    to: "UNPAID",
    label: "Mark as unpaid",
    hint: "Correct a mistake, or a payment that has been returned.",
  },
};

/** The status a `paid` boolean means. */
export function statusForPaid(paid: boolean): PaymentStatus {
  return paid ? "PAID" : "UNPAID";
}

/**
 * The toggle a `paid` boolean asks for.
 *
 * Derived from the target, not from the current status: asking for the state the
 * order is already in is not an error, so the same request always maps to the
 * same audit entry.
 */
export function toggleFor(paid: boolean): PaymentToggle {
  return statusForPaid(paid) === "PAID"
    ? PAYMENT_TOGGLES.MARK_PAID
    : PAYMENT_TOGGLES.MARK_UNPAID;
}

/** True when `paid` would change anything (the API treats a no-op as success). */
export function isPaymentChange(
  current: PaymentStatus,
  paid: boolean
): boolean {
  return statusForPaid(paid) !== current;
}

/** True for the one status that means money is in the bank. */
export function isPaid(status: PaymentStatus): boolean {
  return status === "PAID";
}

