import type { OrderStatus } from "@prisma/client";

/**
 * Valid order status transitions.
 * Key = current status, Value = allowed next statuses.
 */
const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["AWAITING_PAYMENT", "PAYMENT_REVIEW", "CONFIRMED", "CANCELLED", "REJECTED"],
  AWAITING_PAYMENT: ["PAYMENT_REVIEW", "CONFIRMED", "CANCELLED", "REJECTED"],
  PAYMENT_REVIEW: ["CONFIRMED", "CANCELLED", "REJECTED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["READY", "CANCELLED"],
  READY: ["SHIPPED", "COMPLETED", "CANCELLED"],
  SHIPPED: ["COMPLETED"],
  COMPLETED: [], // terminal
  CANCELLED: [], // terminal
  REJECTED: [], // terminal
};

/**
 * Returns true if the status transition is valid.
 */
export function isValidStatusTransition(
  from: OrderStatus,
  to: OrderStatus
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Returns the list of statuses that a given status can transition to.
 */
export function getValidNextStatuses(current: OrderStatus): OrderStatus[] {
  return VALID_TRANSITIONS[current] ?? [];
}

/**
 * Throws if the transition is invalid.
 */
export function assertValidTransition(from: OrderStatus, to: OrderStatus): void {
  if (!isValidStatusTransition(from, to)) {
    throw new Error(
      `ORDER_INVALID_TRANSITION: Cannot move from ${from} to ${to}`
    );
  }
}

/**
 * Statuses that hand reserved capacity back to the pool when entered.
 *
 * Only a voided order releases stock. SHIPPED / COMPLETED / PROCESSING all
 * keep it consumed, and CANCELLED / REJECTED are terminal so a release can
 * only ever happen once per order.
 */
export const CAPACITY_RELEASING_STATUSES: OrderStatus[] = [
  "CANCELLED",
  "REJECTED",
];

/** True when entering `status` must return the order's reserved stock. */
export function releasesCapacity(status: OrderStatus): boolean {
  return CAPACITY_RELEASING_STATUSES.includes(status);
}
