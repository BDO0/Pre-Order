import type { Prisma } from "@prisma/client";

/**
 * The one order filter, shared by the queue and the CSV export.
 *
 * Why shared: the orders screen reads `paymentStatus`, `customerType` and
 * `search` from the URL and the export read only `status` and `batchId`. The
 * download therefore contained every payment status while the screen it was
 * downloaded from showed only the unpaid ones — a file the operator sends to a
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
  const status = searchParams.get("status") ?? undefined;
  const paymentStatus = searchParams.get("paymentStatus") ?? undefined;
  const batchId = searchParams.get("batchId") ?? undefined;
  const customerType = searchParams.get("customerType") ?? undefined;
  const search = (searchParams.get("search") ?? "").trim();

  // Customers are searched by name and by their Instagram handle, because the
  // handle is the identity the operator actually knows — there is no phone
  // number to search on any more.
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
    ...(status ? { status: status as never } : {}),
    ...(paymentStatus ? { paymentStatus: paymentStatus as never } : {}),
    ...(batchId ? { batchId } : {}),
    // `customerType=new` is the "first-time customer" filter the dashboard links
    // to; anything else means "no filter".
    ...(customerType === "new" ? { isNewCustomer: true } : {}),
    ...searchFilter,
  };
}
