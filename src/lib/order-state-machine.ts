import type { OrderStatus } from "@prisma/client";
const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["AWAITING_PAYMENT", "PAYMENT_REVIEW", "CONFIRMED", "CANCELLED", "REJECTED"],
  AWAITING_PAYMENT: ["PAYMENT_REVIEW", "CONFIRMED", "CANCELLED", "REJECTED"],
  PAYMENT_REVIEW: ["CONFIRMED", "CANCELLED", "REJECTED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["READY", "CANCELLED"],
  READY: ["SHIPPED", "COMPLETED", "CANCELLED"],
  SHIPPED: ["COMPLETED"],
  COMPLETED: [], 
  CANCELLED: [], 
  REJECTED: [], 
};
export function isValidStatusTransition(
  from: OrderStatus,
  to: OrderStatus
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
export function getValidNextStatuses(current: OrderStatus): OrderStatus[] {
  return VALID_TRANSITIONS[current] ?? [];
}
export function assertValidTransition(from: OrderStatus, to: OrderStatus): void {
  if (!isValidStatusTransition(from, to)) {
    throw new Error(
      `ORDER_INVALID_TRANSITION: Cannot move from ${from} to ${to}`
    );
  }
}
export const CAPACITY_RELEASING_STATUSES: OrderStatus[] = [
  "CANCELLED",
  "REJECTED",
];
export function releasesCapacity(status: OrderStatus): boolean {
  return CAPACITY_RELEASING_STATUSES.includes(status);
}
