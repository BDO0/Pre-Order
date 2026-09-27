import type { Prisma } from "@prisma/client";
import type { OrderStatus, PaymentStatus } from "@prisma/client";
const ORDER_STATUSES: readonly OrderStatus[] = [
  "PENDING",
  "AWAITING_PAYMENT",
  "PAYMENT_REVIEW",
  "CONFIRMED",
  "PROCESSING",
  "READY",
  "SHIPPED",
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
];
const PAYMENT_STATUSES: readonly PaymentStatus[] = ["UNPAID", "PAID"];
function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  const listed: readonly string[] = allowed;
  return value !== null && listed.includes(value) ? (value as T) : undefined;
}
export function buildOrderWhere(searchParams: URLSearchParams): Prisma.OrderWhereInput {
  const status = oneOf(searchParams.get("status"), ORDER_STATUSES);
  const paymentStatus = oneOf(searchParams.get("paymentStatus"), PAYMENT_STATUSES);
  const batchId = searchParams.get("batchId") ?? undefined;
  const customerType = searchParams.get("customerType") ?? undefined;
  const search = (searchParams.get("search") ?? "").trim();
  const searchFilter = search
    ? {
        OR: [
          { reference: { contains: search, mode: "insensitive" as const } },
          {
            customerSnapshot: {
              path: ["fullName"],
              string_contains: search,
            },
          },
          {
            customerSnapshot: {
              path: ["instagramHandle"],
              string_contains: search,
            },
          },
        ],
      }
    : {};
  return {
    ...(status ? { status } : {}),
    ...(paymentStatus ? { paymentStatus } : {}),
    ...(batchId ? { batchId } : {}),
    ...(customerType === "new" ? { isNewCustomer: true } : {}),
    ...searchFilter,
  };
}
