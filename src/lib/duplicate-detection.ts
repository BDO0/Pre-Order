import { prisma } from "@/lib/db";

const DUPLICATE_WINDOW_MINUTES = 10;

/**
 * Detects if a new order might be a duplicate.
 *
 * Flags (but does NOT block) if the same Instagram account ordered from the same
 * campaign inside the duplicate window.
 *
 * The key is the normalised Instagram handle, not the name: two people really
 * called "Juan dela Cruz" exist, and the previous implementation keyed on a phone
 * number that is no longer collected. The handle is also the customer's identity
 * everywhere else in the app, so "possible duplicate" means the same thing here
 * as it does in the order queue.
 *
 * Reads the snapshot rather than the customer row on purpose: the snapshot is
 * what the customer actually submitted, it is immutable, and it keeps this check
 * independent of when the customer row was created.
 *
 * Returns the reference of the potential duplicate order, or null.
 */
export async function detectDuplicate(
  instagramHandle: string,
  batchId: string
): Promise<string | null> {
  const windowStart = new Date(
    Date.now() - DUPLICATE_WINDOW_MINUTES * 60 * 1000
  );

  const recentOrder = await prisma.order.findFirst({
    where: {
      batchId,
      createdAt: { gte: windowStart },
      customerSnapshot: {
        path: ["instagramHandle"],
        equals: instagramHandle,
      },
      status: {
        notIn: ["CANCELLED", "REJECTED"],
      },
    },
    orderBy: { createdAt: "desc" },
    select: { reference: true },
  });

  return recentOrder?.reference ?? null;
}

