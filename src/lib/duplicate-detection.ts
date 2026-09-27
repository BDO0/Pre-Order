import { prisma } from "@/lib/db";
const DUPLICATE_WINDOW_MINUTES = 10;
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
