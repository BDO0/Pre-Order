import type { BatchStatus, OrderStatus } from "@prisma/client";

export interface StatusMeta {
  label: string;
  badgeClass: string;
}

export const ORDER_STATUS_META: Record<OrderStatus, StatusMeta> = {
  PENDING: { label: "Pending", badgeClass: "badge-amber" },
  AWAITING_PAYMENT: { label: "Awaiting Payment", badgeClass: "badge-amber" },
  PAYMENT_REVIEW: { label: "Payment Review", badgeClass: "badge-amber" },
  CONFIRMED: { label: "Confirmed", badgeClass: "badge-info" },
  PROCESSING: { label: "In Production", badgeClass: "badge-info" },
  READY: { label: "Ready", badgeClass: "badge-info" },
  SHIPPED: { label: "Shipped", badgeClass: "badge-info" },
  COMPLETED: { label: "Completed", badgeClass: "badge-success" },
  CANCELLED: { label: "Cancelled", badgeClass: "badge-danger" },
  REJECTED: { label: "Rejected", badgeClass: "badge-danger" },
};

export function getOrderStatusMeta(status: string): StatusMeta {
  if (status in ORDER_STATUS_META) {
    return ORDER_STATUS_META[status as OrderStatus];
  }
  return {
    label: status.replace(/_/g, " "),
    badgeClass: "badge-neutral",
  };
}

export const BATCH_STATUS_META: Record<BatchStatus, StatusMeta> = {
  DRAFT: { label: "Draft", badgeClass: "badge-neutral" },
  SCHEDULED: { label: "Scheduled", badgeClass: "badge-amber" },
  OPEN: { label: "Open", badgeClass: "badge-success" },
  CLOSED: { label: "Closed", badgeClass: "badge-neutral" },
  ARCHIVED: { label: "Archived", badgeClass: "badge-neutral" },
};

export function getBatchStatusMeta(status: string): StatusMeta {
  if (status in BATCH_STATUS_META) {
    return BATCH_STATUS_META[status as BatchStatus];
  }
  return {
    label: status.replace(/_/g, " "),
    badgeClass: "badge-neutral",
  };
}
