// Type-only import: safe to import from client components. The admin UI derives
// its buttons from these rules so it can never offer an action the API rejects.
import type { PaymentStatus } from "@prisma/client";

/**
 * Payment verification actions an admin can take.
 *
 * Kept separate from the ORDER state machine because money and fulfilment move
 * independently: an order can sit in PAYMENT_REVIEW while the payment is
 * verified, and a verified payment is not proof that anything shipped.
 */
export type PaymentAction = "VERIFY" | "REJECT" | "REFUND";

interface PaymentActionRule {
  /** Payment statuses this action may be applied to. */
  from: readonly PaymentStatus[];
  /** The status it moves the order into. */
  to: PaymentStatus;
  /** Button label for the admin UI. */
  label: string;
  /** Short explanation shown next to the button. */
  hint: string;
}

export const PAYMENT_ACTIONS: Record<PaymentAction, PaymentActionRule> = {
  VERIFY: {
    from: ["UNPAID", "PENDING_REVIEW"],
    to: "PAID",
    label: "Verify payment",
    hint: "Money received — mark this order as paid.",
  },
  REJECT: {
    // Only a payment still under review can be rejected. Rejecting an already
    // PAID payment would silently un-receive money that was really sent.
    from: ["PENDING_REVIEW"],
    to: "UNPAID",
    label: "Reject proof",
    hint: "The proof is unreadable or does not match — send it back to unpaid.",
  },
  REFUND: {
    from: ["PAID"],
    to: "REFUNDED",
    label: "Mark refunded",
    hint: "Money has been returned to the customer.",
  },
};

/** True when `action` is legal from `current`. */
export function isValidPaymentAction(
  current: PaymentStatus,
  action: PaymentAction
): boolean {
  return PAYMENT_ACTIONS[action]?.from.includes(current) ?? false;
}

/** The actions an admin may take on a payment currently in `current`. */
export function allowedPaymentActions(current: PaymentStatus): PaymentAction[] {
  return (Object.keys(PAYMENT_ACTIONS) as PaymentAction[]).filter((action) =>
    isValidPaymentAction(current, action)
  );
}

/**
 * Returns the status `action` moves to, or throws when the action is illegal.
 *
 * The API catches the prefix to answer 422, mirroring assertValidTransition.
 */
export function applyPaymentAction(
  current: PaymentStatus,
  action: PaymentAction
): PaymentStatus {
  if (!isValidPaymentAction(current, action)) {
    throw new Error(
      `PAYMENT_INVALID_ACTION: Cannot ${action} a payment in ${current}`
    );
  }
  return PAYMENT_ACTIONS[action].to;
}
