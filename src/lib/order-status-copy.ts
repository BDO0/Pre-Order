// Type-only import: this module is safe to import from client components
// (the copy is plain data, no Prisma runtime is pulled in).
import type { OrderStatus } from "@prisma/client";

/**
 * What the shop tells a customer about each status.
 *
 * The admin panel shows the raw enum, because the operator is the one moving
 * orders through the machine and the enum is the machine's vocabulary. A
 * customer needs the opposite: no jargon, one sentence of "what this means and
 * what happens next", and — where it applies — a nudge about the one thing the
 * order is still waiting on them for.
 *
 * Every status in the enum is covered, so a status added later fails the build
 * here rather than showing a customer a blank badge.
 */

export interface StatusCopy {
  /** Short form, for the badge. */
  label: string;
  /** One or two sentences: what this means, and what happens next. */
  detail: string;
  /** True when the ball is in the customer's court (payment, a reply in DM). */
  awaitingCustomer: boolean;
}

export const CUSTOMER_STATUS_COPY: Record<OrderStatus, StatusCopy> = {
  PENDING: {
    label: "Received",
    detail:
      "We have your order. The shop will message you on Instagram to confirm the details and arrange payment.",
    awaitingCustomer: true,
  },
  AWAITING_PAYMENT: {
    label: "Awaiting payment",
    detail:
      "Your pieces are held for you. Settle payment in Instagram DM and this will move along.",
    awaitingCustomer: true,
  },
  PAYMENT_REVIEW: {
    label: "Checking payment",
    detail:
      "We are matching your payment to this order. Nothing needed from you right now.",
    awaitingCustomer: false,
  },
  CONFIRMED: {
    label: "Confirmed",
    detail:
      "Your place in this drop is confirmed and your pieces are reserved.",
    awaitingCustomer: false,
  },
  PROCESSING: {
    label: "In production",
    detail: "Your pieces are with the supplier.",
    awaitingCustomer: false,
  },
  READY: {
    label: "Ready",
    detail: "Your order is ready to be shipped or picked up.",
    awaitingCustomer: false,
  },
  SHIPPED: {
    label: "Shipped",
    detail: "On its way to you.",
    awaitingCustomer: false,
  },
  COMPLETED: {
    label: "Completed",
    detail: "Delivered. Thank you for ordering from us.",
    awaitingCustomer: false,
  },
  CANCELLED: {
    label: "Cancelled",
    detail:
      "This order was cancelled and its stock returned to the drop. Message the shop if that is a surprise.",
    awaitingCustomer: false,
  },
  REJECTED: {
    label: "Not accepted",
    detail:
      "We could not take this order. Message the shop on Instagram and we will sort it out.",
    awaitingCustomer: false,
  },
};

/**
 * Copy for a status, tolerating a value this build does not know about.
 *
 * The lookup endpoint reads a status out of the database, and a database can
 * be ahead of the code that is serving it (a deploy that adds a status ships
 * before — or after — the migration that allows it). Falling back to a
 * de-underscored label is the honest answer: worse copy, still correct.
 */
export function customerStatusCopy(status: string): StatusCopy {
  const known = (CUSTOMER_STATUS_COPY as Record<string, StatusCopy | undefined>)[
    status
  ];
  if (known) return known;

  const derived = status.replace(/_/g, " ").trim().toLowerCase();

  return {
    // A blank or unnamed status still has to say *something*: an empty badge
    // reads as a broken page, and "in progress" is at least true of any order
    // that has not reached a terminal state.
    label: derived === "" ? "In progress" : derived,
    detail: "Message the shop on Instagram if you have any questions about this order.",
    awaitingCustomer: false,
  };
}
