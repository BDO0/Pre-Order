import { prisma } from "@/lib/db";

const DUPLICATE_WINDOW_MINUTES = 10;

/**
 * Detects if a new order might be a duplicate.
 * Flags (but does NOT block) if same phone + same campaign
 * was submitted within the duplicate window.
 *
 * Returns the reference of the potential duplicate order, or null.
 */
export async function detectDuplicate(
  mobileNumber: string,
  campaignId: string
): Promise<string | null> {
  const windowStart = new Date(
    Date.now() - DUPLICATE_WINDOW_MINUTES * 60 * 1000
  );

  const recentOrder = await prisma.order.findFirst({
    where: {
      campaignId,
      createdAt: { gte: windowStart },
      customerSnapshot: {
        path: ["mobileNumber"],
        equals: mobileNumber,
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
