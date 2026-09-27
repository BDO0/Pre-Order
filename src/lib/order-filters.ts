import type { Prisma } from "@prisma/client";
import type { OrderStatus, PaymentStatus } from "@prisma/client";

/**
 * The values a URL is allowed to filter by.
 *
 * Written out rather than imported at runtime, and typed against Prisma's enums
 * so a status added to the schema fails `tsc` here instead of quietly becoming
 * unfilterable. The comment on `buildOrderWhere` has always promised that an
 * unrecognised value means "no filter". For these two it did not: the string went
 * straight into an enum comparison, so `?status=typo` - one keystroke away from a
 * link the dashboard generates - answered 500 instead of showing the full queue.
 */
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

/** A query parameter, but only when it actually names one of `allowed`. */
function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  const listed: readonly string[] = allowed;
  return value !== null && listed.includes(value) ? (value as T) : undefined;
}

/**
 * The one order filter, shared by the queue and the CSV export.
 *
 * Why shared: the orders screen reads `paymentStatus`, `customerType` and
 * `search` from the URL and the export read only `status` and `batchId`. The
 * download therefore contained every payment status while the screen it was
 * downloaded from showed only the unpaid ones â€” a file the operator sends to a
 * supplier disagreeing with the screen they checked it against. Two copies of a
 * filter is how that happens, so there is now one.
 *
 * There is deliberately no "orders in no batch" filter: `Order.batchId` is a
 * required column, because an order that belongs to no supplier run is an order
 * that will never be made. `batchId=none` therefore matches nothing, and callers
 * that used to pass it were describing a state this data cannot be in.
 */

/**
 * Builds the Prisma `where` clause for the order queue.
 *
 * Every parameter is optional and an unrecognised value means "no filter" rather
 * than an error: the queue is driven by links from the dashboard and the batch
 * screen, and a stale link should show the full queue rather than fail.
 */
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
