import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { releaseOrderCapacity } from "@/lib/order-service";
import { revalidateStorefront } from "@/lib/storefront-cache";

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

  try {
    const expiredOrders = await prisma.order.findMany({
      where: {
        archivedAt: null,
        status: "PENDING",
        createdAt: {
          lt: fortyEightHoursAgo,
        },
      },
      select: { id: true },
    });

    if (expiredOrders.length === 0) {
      return NextResponse.json({ success: true, count: 0, message: "No expired orders found" });
    }

    let cancelledCount = 0;
    for (const order of expiredOrders) {
      await prisma.$transaction(async (tx) => {
        const claim = await tx.order.updateMany({
          where: {
            id: order.id,
            status: "PENDING",
            archivedAt: null,
          },
          data: {
            status: "CANCELLED",
          },
        });

        if (claim.count === 1) {
          await tx.orderStatusHistory.create({
            data: {
              orderId: order.id,
              fromStatus: "PENDING",
              toStatus: "CANCELLED",
              changedBy: "system_cron",
              note: "Auto-cancelled after 48 hours of inactivity",
            },
          });

          await tx.auditLog.create({
            data: {
              orderId: order.id,
              actor: "system",
              action: "order.expired",
              metadata: { reason: "48_hour_timeout" },
            },
          });

          await releaseOrderCapacity(tx, order.id);
          cancelledCount++;
        }
      });
    }

    // Every cancellation above released capacity, which the storefront prints.
    if (cancelledCount > 0) revalidateStorefront();
    return NextResponse.json({ success: true, count: cancelledCount });
  } catch (error) {
    console.error("Failed to expire orders:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
